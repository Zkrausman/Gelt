import type Database from 'better-sqlite3';
import { digest } from './ledger-canonical.js';
export const applicationId = 0x474c5434;
export const migration = `
CREATE TABLE ledger_owner(owner TEXT PRIMARY KEY) STRICT;
CREATE TABLE migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT;
CREATE TABLE accounts(owner TEXT NOT NULL, account TEXT NOT NULL, account_route TEXT NOT NULL, rhs TEXT NOT NULL, rhc TEXT, body TEXT NOT NULL, PRIMARY KEY(owner,account), UNIQUE(owner,account_route), UNIQUE(owner,rhs), UNIQUE(owner,rhc)) STRICT;
CREATE TABLE intents(owner TEXT NOT NULL, account TEXT NOT NULL, id TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, projection TEXT NOT NULL, PRIMARY KEY(owner,account,id), UNIQUE(owner,account,key), FOREIGN KEY(owner,account) REFERENCES accounts(owner,account)) STRICT;
CREATE TABLE events(owner TEXT NOT NULL, account TEXT NOT NULL, intent TEXT NOT NULL, id TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 1000), type TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, previous TEXT NOT NULL, PRIMARY KEY(owner,account,id), UNIQUE(owner,account,key), UNIQUE(owner,account,intent,seq), FOREIGN KEY(owner,account,intent) REFERENCES intents(owner,account,id)) STRICT;
CREATE TABLE facts(owner TEXT NOT NULL, account TEXT NOT NULL, namespace TEXT NOT NULL, id TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY(owner,account,namespace,id), UNIQUE(owner,account,event), FOREIGN KEY(owner,account,event) REFERENCES events(owner,account,id)) STRICT;
`;
export function migrate(db: Database.Database, owner: string) {
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true });
    const app = db.pragma('application_id', { simple: true });
    if (version === 0) {
      if (app !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length) throw new Error();
      db.exec(migration);
      db.prepare('INSERT INTO ledger_owner VALUES(?)').run(owner);
      db.prepare('INSERT INTO migrations VALUES(1,?)').run(digest(migration));
      db.pragma(`application_id = ${applicationId}`); db.pragma('user_version = 1');
    } else if (version !== 1 || app !== applicationId) throw new Error();
    validateSchema(db);
    if (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view')").all().length) throw new Error();
    if ((db.pragma('integrity_check') as {integrity_check: string}[]).some(r => r.integrity_check !== 'ok') || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error();
  }).immediate();
}

export function validateSchema(db: Database.Database) {
  if (db.pragma('user_version', { simple: true }) !== 1 || db.pragma('application_id', { simple: true }) !== applicationId) throw new Error();
  const rows = db.prepare('SELECT version,checksum FROM migrations').all() as {version: number; checksum: string}[];
  if (rows.length !== 1 || rows[0].version !== 1 || rows[0].checksum !== digest(migration)) throw new Error();
  // Compare actual DDL, not just a self-reported migration stamp.
  const tables = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {sql: string}[];
  const expected = migration.trim().split(';').map(s => s.trim()).filter(Boolean).sort();
  if (JSON.stringify(tables.map(t => t.sql).sort()) !== JSON.stringify(expected)) throw new Error();
}
