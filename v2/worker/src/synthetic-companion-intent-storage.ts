import { basename, dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { createLedgerDirectory, LedgerStorage } from './ledger-storage.js';
import { canonical, decode, digest } from './ledger-canonical.js';
import { ledgerId } from './ledger-contract.js';
import { privateDirectory, separateDirectories, writePrivateNew } from './private-files.js';
import { MAX_DURABLE_COMPANION_SESSIONS, syntheticCompanionIntentSchema, type IntentWriteOutcome, type SyntheticCompanionIntent, type SyntheticCompanionIntentJournal } from './synthetic-companion-intent.js';

const applicationId = 0x474c5435;
const databaseName = 'synthetic-companion-intents.sqlite';
const directoryName = 'synthetic-companion-intents';
const migration = `
CREATE TABLE synthetic_intent_owner(owner_id TEXT PRIMARY KEY) STRICT;
CREATE TABLE synthetic_intent_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT;
CREATE TABLE synthetic_companion_intents(session_digest TEXT PRIMARY KEY, intent_body TEXT NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at > 0), revoked INTEGER NOT NULL CHECK(revoked IN (0,1))) STRICT;
`;
type StoredRow = { session_digest: string; intent_body: string; expires_at: number; revoked: number };

function unavailable(): Error { return new Error('synthetic intent storage unavailable'); }
function validPaths(databasePath: string, executionLedgerPath: string) {
  if (databasePath !== resolve(databasePath) || basename(databasePath) !== databaseName
    || executionLedgerPath !== resolve(executionLedgerPath) || basename(executionLedgerPath) !== 'execution.sqlite'
    || !separateDirectories(dirname(databasePath), dirname(executionLedgerPath))) throw unavailable();
}
function physicalSeparation(databasePath: string, executionLedgerPath: string) {
  // The ledger parent must already be a trusted private directory; string-only
  // comparison cannot detect a symlink/junction alias to the intent parent.
  privateDirectory(dirname(databasePath));
  privateDirectory(dirname(executionLedgerPath));
  if (!separateDirectories(realpathSync.native(dirname(databasePath)), realpathSync.native(dirname(executionLedgerPath)))) throw unavailable();
}
function timestamp(): number {
  const now = Date.now();
  if (!Number.isSafeInteger(now) || now < 1) throw new Error();
  return now;
}
function verifySchema(db: Database.Database) {
  if (db.pragma('user_version', { simple: true }) !== 1 || db.pragma('application_id', { simple: true }) !== applicationId) throw new Error();
  const migrations = db.prepare('SELECT version,checksum FROM synthetic_intent_migrations').all() as { version: number; checksum: string }[];
  if (migrations.length !== 1 || migrations[0].version !== 1 || migrations[0].checksum !== digest(migration)) throw new Error();
  const tables = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { sql: string }[];
  const expected = migration.trim().split(';').map(part => part.trim()).filter(Boolean).sort();
  if (JSON.stringify(tables.map(row => row.sql).sort()) !== JSON.stringify(expected)) throw new Error();
  if ((db.prepare("SELECT name FROM sqlite_master WHERE type NOT IN ('table') AND name NOT LIKE 'sqlite_%'").all() as unknown[]).length) throw new Error();
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok'
    || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error();
}
function migrate(db: Database.Database, ownerId: string, allowInitialize: boolean) {
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true });
    const app = db.pragma('application_id', { simple: true });
    if (version === 0) {
      if (!allowInitialize || app !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length) throw new Error();
      db.exec(migration);
      db.prepare('INSERT INTO synthetic_intent_owner VALUES(?)').run(ownerId);
      db.prepare('INSERT INTO synthetic_intent_migrations VALUES(1,?)').run(digest(migration));
      db.pragma(`application_id = ${applicationId}`);
      db.pragma('user_version = 1');
    } else if (version !== 1 || app !== applicationId) throw new Error();
    verifySchema(db);
    const owner = db.prepare('SELECT owner_id FROM synthetic_intent_owner').all();
    if (canonical(owner) !== canonical([{ owner_id: ownerId }])) throw new Error();
  }).immediate();
}

/**
 * Private, offline-only durable journal. It owns one separately provisioned
 * SQLite file and never shares execution-ledger state. There is intentionally
 * no startup, transport, provider or broker integration.
 */
export class DurableSyntheticCompanionIntentJournal implements SyntheticCompanionIntentJournal {
  private readonly storage: LedgerStorage;
  private readonly ownerId: string;
  private poisoned = false;
  private closed = false;

  private constructor(path: string, ownerId: string, allowInitialize: boolean) {
    this.ownerId = ownerId;
    this.storage = new LedgerStorage(path, { createIfMissing: false });
    try {
      migrate(this.storage.db, ownerId, allowInitialize);
      this.storage.db.transaction(() => this.load()).deferred();
      this.storage.validate();
    } catch {
      this.poisoned = true;
      this.storage.poisoned = true;
      try { this.storage.close(); } catch { /* keep ownership evidence */ }
      throw unavailable();
    }
  }

  static open(path: string, executionLedgerPath: string, ownerId: string): DurableSyntheticCompanionIntentJournal {
    validPaths(path, executionLedgerPath);
    if (!ledgerId.safeParse(ownerId).success) throw unavailable();
    try {
      physicalSeparation(path, executionLedgerPath);
      return new DurableSyntheticCompanionIntentJournal(path, ownerId, false);
    }
    catch { throw unavailable(); }
  }

  /** Explicit first-time provisioning; an existing directory is never reused or repaired. */
  static provision(directory: string, executionLedgerPath: string, ownerId: string): DurableSyntheticCompanionIntentJournal {
    if (directory !== resolve(directory) || basename(directory) !== directoryName) throw unavailable();
    const path = resolve(directory, databaseName);
    validPaths(path, executionLedgerPath);
    if (!ledgerId.safeParse(ownerId).success) throw unavailable();
    try {
      createLedgerDirectory(directory);
      physicalSeparation(path, executionLedgerPath);
      // Create the private main file only at this explicit provisioning boundary.
      writePrivateNew(path, Buffer.alloc(0));
      return new DurableSyntheticCompanionIntentJournal(path, ownerId, true);
    } catch { throw unavailable(); }
  }

  available(): boolean { return !this.closed && !this.poisoned && !this.storage.poisoned; }

  // Reconstruct and validate every persisted fact inside the caller's SQLite
  // transaction. Neither a cached projection nor schema validation is enough.
  private load(): Map<string, { intent: SyntheticCompanionIntent; revoked: boolean }> {
    const db = this.storage.db;
    verifySchema(db);
    const owners = db.prepare('SELECT owner_id FROM synthetic_intent_owner').all();
    if (canonical(owners) !== canonical([{ owner_id: this.ownerId }])) throw new Error();
    const rows = db.prepare('SELECT session_digest,intent_body,expires_at,revoked FROM synthetic_companion_intents ORDER BY session_digest LIMIT 65').all() as StoredRow[];
    if (rows.length > MAX_DURABLE_COMPANION_SESSIONS) throw new Error();
    const result = new Map<string, { intent: SyntheticCompanionIntent; revoked: boolean }>();
    for (const row of rows) {
      if (typeof row.session_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.session_digest)
        || typeof row.intent_body !== 'string' || !Number.isSafeInteger(row.expires_at) || row.expires_at <= 0
        || (row.revoked !== 0 && row.revoked !== 1)) throw new Error();
      const intent = decode(syntheticCompanionIntentSchema, row.intent_body);
      if (intent.sessionDigest !== row.session_digest || intent.sessionExpiresAt !== row.expires_at
        || result.has(row.session_digest)) throw new Error();
      result.set(row.session_digest, { intent, revoked: row.revoked === 1 });
    }
    return result;
  }

  private transact(action: (state: Map<string, { intent: SyntheticCompanionIntent; revoked: boolean }>, now: number) => IntentWriteOutcome): IntentWriteOutcome {
    if (!this.available()) return 'unknown';
    try {
      this.storage.validate();
      const transaction = this.storage.db.transaction(() => {
        const state = this.load();
        const now = timestamp();
        this.storage.db.prepare('DELETE FROM synthetic_companion_intents WHERE expires_at <= ?').run(now);
        const live = this.load();
        const outcome = action(live, now);
        this.load();
        this.storage.validate();
        return outcome;
      });
      const outcome = transaction.immediate() as IntentWriteOutcome;
      this.storage.validate();
      return outcome;
    } catch {
      this.poisoned = true;
      this.storage.poisoned = true;
      return 'unknown';
    }
  }

  reserve(input: SyntheticCompanionIntent): IntentWriteOutcome {
    const parsed = syntheticCompanionIntentSchema.safeParse(input);
    if (!parsed.success) return 'unknown';
    const intent = parsed.data;
    return this.transact((state, now) => {
      if (intent.sessionExpiresAt <= now) return 'unknown';
      if (state.has(intent.sessionDigest)) return 'duplicate';
      if (state.size >= MAX_DURABLE_COMPANION_SESSIONS) return 'capacity';
      this.storage.db.prepare('INSERT INTO synthetic_companion_intents(session_digest,intent_body,expires_at,revoked) VALUES(?,?,?,0)')
        .run(intent.sessionDigest, canonical(intent), intent.sessionExpiresAt);
      return 'committed';
    });
  }

  revoke(sessionDigest: string): IntentWriteOutcome {
    if (!/^[a-f0-9]{64}$/.test(sessionDigest)) return 'unknown';
    return this.transact(state => {
      const stored = state.get(sessionDigest);
      if (!stored) return 'unknown';
      // Expiry is only ever read from the validated stored row; caller data is absent.
      const result = this.storage.db.prepare('UPDATE synthetic_companion_intents SET revoked=1 WHERE session_digest=? AND expires_at=?')
        .run(sessionDigest, stored.intent.sessionExpiresAt);
      if (result.changes !== 1) throw new Error();
      return 'committed';
    });
  }

  close(): void {
    if (this.closed) return;
    if (!this.poisoned && !this.storage.poisoned) {
      try {
        this.storage.validate();
        this.storage.db.transaction(() => this.load()).deferred();
        this.storage.validate();
      } catch {
        this.poisoned = true;
        this.storage.poisoned = true;
      }
    }
    this.closed = true;
    try { this.storage.close(); }
    catch { this.poisoned = true; throw unavailable(); }
    if (this.poisoned) throw unavailable();
  }
}

export function provisionSyntheticCompanionIntentJournal(directory: string, executionLedgerPath: string, ownerId: string) {
  return DurableSyntheticCompanionIntentJournal.provision(directory, executionLedgerPath, ownerId);
}
export function openSyntheticCompanionIntentJournal(path: string, executionLedgerPath: string, ownerId: string) {
  return DurableSyntheticCompanionIntentJournal.open(path, executionLedgerPath, ownerId);
}
