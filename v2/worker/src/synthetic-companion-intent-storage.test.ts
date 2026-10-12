import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { storageFixture } from './storage-fixture.js';
import { createPrivateDirectory, writePrivateNew } from './private-files.js';
import {
  MAX_DURABLE_COMPANION_SESSIONS,
  describeSyntheticCompanionIntent,
  reserveSyntheticCompanionIntent,
  revokeSyntheticCompanionIntent,
  type IntentWriteOutcome,
  type SyntheticCompanionIntent,
  type SyntheticCompanionIntentJournal,
} from './synthetic-companion-intent.js';
import {
  openSyntheticCompanionIntentJournal,
  provisionSyntheticCompanionIntentJournal,
} from './synthetic-companion-intent-storage.js';
import type { CompanionTerms } from './synthetic-companion.js';

// Native private-file checks and 64 physical commits exceed the generic worker
// test timeout. Scope this bound to this real-file suite; hosted job deadlines
// remain separate and cannot be waived by this per-test setting.
vi.setConfig({ testTimeout: 450_000 });

const terms: CompanionTerms = {
  account: 'synthetic-companion-account-a', route: 'RHS', instrument: 'SYNTH-USD',
  side: 'BUY', type: 'LIMIT', timeInForce: 'DAY', quantity: '0.1', limitPrice: '99.90', revision: 0,
};
const ownerSession = (index = 0) => index === 0 ? 's'.repeat(43) : `s${index.toString(16).padStart(42, '0')}`;
const identityId = (index = 0) => index.toString(16).padStart(32, '0');
const ownerId = '00000000-0000-4000-8000-000000000001';

function fixture() {
  const root = storageFixture('synthetic-intent-journal-');
  const directory = join(root, 'synthetic-companion-intents');
  const path = join(directory, 'synthetic-companion-intents.sqlite');
  const executionPath = join(root, 'execution', 'execution.sqlite');
  createPrivateDirectory(join(root, 'execution'));
  const open = () => openSyntheticCompanionIntentJournal(path, executionPath, ownerId);
  const journal = provisionSyntheticCompanionIntentJournal(directory, executionPath, ownerId);
  return {
    root, path, open, journal,
    cleanup() {
      try { journal.close(); } catch { /* preserve test cleanup after poisoned storage */ }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function intent(session = ownerSession(), identity = identityId(), nextTerms = terms, expiresAt = Date.now() + 60_000) {
  return describeSyntheticCompanionIntent({ ownerSession: session, identityId: identity, terms: nextTerms, sessionExpiresAt: expiresAt });
}
function reserve(journal: SyntheticCompanionIntentJournal, session = ownerSession(), identity = identityId(), nextTerms = terms, expiresAt = Date.now() + 60_000) {
  return reserveSyntheticCompanionIntent(journal, { ownerSession: session, identityId: identity, terms: nextTerms, sessionExpiresAt: expiresAt });
}

describe('ZAR-240 private SQLite synthetic intent journal', () => {
  it('rejects an existing uninitialized database through open without explicit provisioning', () => {
    const root = storageFixture('synthetic-intent-uninitialized-');
    const directory = join(root, 'synthetic-companion-intents');
    const path = join(directory, 'synthetic-companion-intents.sqlite');
    try {
      createPrivateDirectory(join(root, 'execution'));
      createPrivateDirectory(directory);
      writePrivateNew(path, Buffer.alloc(0));
      expect(() => openSyntheticCompanionIntentJournal(path, join(root, 'execution', 'execution.sqlite'), ownerId))
        .toThrow(/unavailable/);
      const raw = new Database(path);
      try { expect(raw.pragma('user_version', { simple: true })).toBe(0); }
      finally { raw.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('requires an existing trusted execution-ledger parent', () => {
    const root = storageFixture('synthetic-intent-execution-parent-');
    try {
      expect(() => provisionSyntheticCompanionIntentJournal(join(root, 'synthetic-companion-intents'),
        join(root, 'missing-execution', 'execution.sqlite'), ownerId)).toThrow(/unavailable/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('atomically reserves a session against alternate identities and changed terms', () => {
    const f = fixture();
    try {
      reserve(f.journal);
      expect(() => reserve(f.journal, ownerSession(), identityId(1), { ...terms, revision: 1 })).toThrow(/unavailable/);
      expect(() => reserve(f.journal, ownerSession(), identityId(2), { ...terms, quantity: '0.2' })).toThrow(/unavailable/);
    } finally { f.cleanup(); }
  });

  it('persists the duplicate reservation across clean journal-handle reopen', () => {
    const f = fixture();
    try {
      const original = intent();
      expect(f.journal.reserve(original)).toBe('committed');
      f.journal.close();
      const reopened = f.open();
      try {
        expect(reopened.reserve(intent(ownerSession(), identityId(1), { ...terms, revision: 1 }))).toBe('duplicate');
        expect(() => reserve(reopened, ownerSession(), identityId(2))).toThrow(/unavailable/);
      } finally { reopened.close(); }
    } finally { f.cleanup(); }
  });

  it('does not synthesize a tombstone when revoking a missing session', () => {
    const f = fixture();
    try {
      const absent = intent(ownerSession(99));
      expect(f.journal.revoke(absent.sessionDigest)).toBe('unknown');
      const raw = new Database(f.path);
      try {
        expect(raw.prepare('SELECT COUNT(*) AS count FROM synthetic_companion_intents').get()).toEqual({ count: 0 });
      } finally { raw.close(); }
    } finally { f.cleanup(); }
  });

  it('reopens a revocation tombstone with the persisted original expiry', () => {
    const f = fixture();
    try {
      const original = intent();
      expect(f.journal.reserve(original)).toBe('committed');
      revokeSyntheticCompanionIntent(f.journal, ownerSession());
      f.journal.close();
      const raw = new Database(f.path);
      try {
        expect(raw.prepare('SELECT expires_at,revoked FROM synthetic_companion_intents WHERE session_digest=?').get(original.sessionDigest))
          .toEqual({ expires_at: original.sessionExpiresAt, revoked: 1 });
      } finally { raw.close(); }
      const reopened = f.open();
      try {
        expect(reopened.reserve(intent(ownerSession(), identityId(1)))).toBe('duplicate');
      } finally { reopened.close(); }
    } finally { f.cleanup(); }
  });

  it('retains the revoked row until its exact expiry, then retires it transactionally', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = 1_750_000_000_000;
    vi.setSystemTime(now);
    let f: ReturnType<typeof fixture> | undefined;
    try {
      f = fixture();
      const original = intent(ownerSession(), identityId(), terms, now + 1_000);
      expect(f.journal.reserve(original)).toBe('committed');
      expect(f.journal.revoke(original.sessionDigest)).toBe('committed');
      f.journal.close();
      const reopened = f.open();
      try {
        vi.setSystemTime(now + 999);
        expect(reopened.reserve(intent(ownerSession(), identityId(1), terms, now + 2_000))).toBe('duplicate');
        vi.setSystemTime(now + 1_000);
        expect(reopened.reserve(original)).toBe('unknown');
        const successor = intent(ownerSession(), identityId(1), terms, now + 2_000);
        expect(reopened.reserve(successor)).toBe('committed');
        const raw = new Database(f.path);
        try {
          expect(raw.prepare('SELECT session_digest,expires_at,revoked FROM synthetic_companion_intents').all())
            .toEqual([{ session_digest: successor.sessionDigest, expires_at: successor.sessionExpiresAt, revoked: 0 }]);
        } finally { raw.close(); }
      } finally { reopened.close(); }
    } finally { try { f?.cleanup(); } finally { vi.useRealTimers(); } }
  });

  it('retains all 64 unexpired sessions and rejects the 65th without eviction', () => {
    // Diagnostic only: externally retained milestones are not buffered by Vitest.
    const diagnosticPath = process.env.GELT_ZAR240_DIAGNOSTIC_LOG;
    const startedAt = Date.now();
    const record = (event: string, index?: number, outcome?: string) => {
      if (diagnosticPath) appendFileSync(diagnosticPath,
        JSON.stringify({ event, index, outcome, elapsedMs: Date.now() - startedAt }) + '\n', { flag: 'a', mode: 0o600 });
    };
    record('fixture-start');
    const f = fixture();
    record('fixture-ready');
    try {
      // Native private-storage checks can make 64 real commits exceed one minute.
      // Keep the sessions live throughout this capacity test; expiry is separate.
      const expiresAt = startedAt + 15 * 60_000;
      for (let i = 0; i < MAX_DURABLE_COMPANION_SESSIONS; i++) {
        record('reserve-start', i);
        const outcome = f.journal.reserve(intent(ownerSession(i), identityId(i), terms, expiresAt));
        const now = Date.now();
        record('reserve-end', i, outcome);
        expect(outcome, `reservation ${i + 1}/64 after ${now - startedAt}ms, expiry in ${expiresAt - now}ms, journal available=${f.journal.available()}`).toBe('committed');
      }
      record('capacity-check');
      expect(f.journal.reserve(intent(ownerSession(64), identityId(64), terms, expiresAt))).toBe('capacity');
      f.journal.close();
      const reopened = f.open();
      try {
        expect(reopened.reserve(intent(ownerSession(0), identityId(65), terms, expiresAt))).toBe('duplicate');
        expect(reopened.reserve(intent(ownerSession(64), identityId(64), terms, expiresAt))).toBe('capacity');
      } finally { reopened.close(); }
    } finally { record('cleanup-start'); f.cleanup(); record('cleanup-end'); }
  });

  it('fails closed after a durable write whose acknowledgement is ambiguous, without retry', () => {
    const f = fixture();
    try {
      let calls = 0;
      const uncertain: SyntheticCompanionIntentJournal = {
        reserve(value: SyntheticCompanionIntent): IntentWriteOutcome {
          calls++;
          const committed = f.journal.reserve(value);
          return committed === 'committed' ? 'unknown' : committed;
        },
        revoke: sessionDigest => f.journal.revoke(sessionDigest),
      };
      expect(() => reserveSyntheticCompanionIntent(uncertain, {
        ownerSession: ownerSession(), identityId: identityId(), terms, sessionExpiresAt: Date.now() + 60_000,
      })).toThrow(/unavailable/);
      expect(calls).toBe(1);
      f.journal.close();
      const reopened = f.open();
      try {
        expect(reopened.reserve(intent())).toBe('duplicate');
        expect(calls).toBe(1);
      } finally { reopened.close(); }
    } finally { f.cleanup(); }
  });

  it('rejects noncanonical persisted intent facts and retains the writer marker', () => {
    const f = fixture();
    try {
      const original = intent();
      expect(f.journal.reserve(original)).toBe('committed');
      f.journal.close();
      const raw = new Database(f.path);
      try {
        raw.prepare('UPDATE synthetic_companion_intents SET intent_body=? WHERE session_digest=?')
          .run(JSON.stringify(original, null, 1), original.sessionDigest);
      } finally { raw.close(); }
      expect(() => f.open()).toThrow(/unavailable/);
      expect(existsSync(f.path + '.lock')).toBe(true);
    } finally { f.cleanup(); }
  });
});
