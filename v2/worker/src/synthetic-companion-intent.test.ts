import { describe, expect, it } from 'vitest';
import {
  COMPANION_FEE_SOURCE,
  COMPANION_QUOTE_SOURCE,
  MAX_DURABLE_COMPANION_SESSIONS,
  describeSyntheticCompanionIntent,
  reserveSyntheticCompanionIntent,
  revokeSyntheticCompanionIntent,
  syntheticCompanionIntentSchema,
  type IntentWriteOutcome,
  type SyntheticCompanionIntent,
  type SyntheticCompanionIntentJournal,
} from './synthetic-companion-intent.js';
import {
  COMPANION_REQUEST_TTL_MS,
  createSyntheticCompanion,
  type CompanionTerms,
} from './synthetic-companion.js';

const terms: CompanionTerms = {
  account: 'synthetic-companion-account-a', route: 'RHS', instrument: 'SYNTH-USD',
  side: 'BUY', type: 'LIMIT', timeInForce: 'DAY', quantity: '0.1', limitPrice: '99.90', revision: 0,
};
const ownerSession = (index = 0) => index === 0 ? 's'.repeat(43) : `s${index.toString(16).padStart(42, '0')}`;
const identityId = (index = 0) => index.toString(16).padStart(32, '0');

interface TestRow { expiresAt: number; intent?: SyntheticCompanionIntent; revoked: boolean }
/** Test-only behavioral model. It is not a persistence implementation or crash test. */
class MemoryJournal implements SyntheticCompanionIntentJournal {
  calls = 0;
  now = 100_000;
  ambiguousAfterCommit = false;
  readonly rows: Map<string, TestRow>;
  constructor(rows = new Map<string, TestRow>()) { this.rows = rows; }
  private prune() {
    for (const [session, row] of this.rows) if (row.expiresAt <= this.now) this.rows.delete(session);
  }
  reserve(intent: SyntheticCompanionIntent): IntentWriteOutcome {
    this.calls++;
    this.prune();
    if (intent.sessionExpiresAt <= this.now) return 'unknown';
    if (this.rows.has(intent.sessionDigest)) return 'duplicate';
    if (this.rows.size >= MAX_DURABLE_COMPANION_SESSIONS) return 'capacity';
    this.rows.set(intent.sessionDigest, { expiresAt: intent.sessionExpiresAt, intent, revoked: false });
    if (this.ambiguousAfterCommit) { this.ambiguousAfterCommit = false; return 'unknown'; }
    return 'committed';
  }
  revoke(sessionDigest: string): IntentWriteOutcome {
    this.calls++;
    this.prune();
    const row = this.rows.get(sessionDigest);
    if (!row) return 'unknown';
    row.revoked = true; // preserve the original immutable row expiry
    return 'committed';
  }
}

function intent(session = ownerSession(), id = identityId(), nextTerms = terms, expiresAt = 160_000) {
  return describeSyntheticCompanionIntent({ ownerSession: session, identityId: id, terms: nextTerms, sessionExpiresAt: expiresAt });
}
function reserve(journal: SyntheticCompanionIntentJournal, session = ownerSession(), id = identityId(), nextTerms = terms, expiresAt = 160_000) {
  return reserveSyntheticCompanionIntent(journal, { ownerSession: session, identityId: id, terms: nextTerms, sessionExpiresAt: expiresAt });
}

describe('ZAR-240 one-use synthetic companion intent contract seam', () => {
  it('binds owner session, identity, canonical exact terms and both explicit synthetic sources', () => {
    const base = intent();
    expect(base.sessionDigest).not.toBe(ownerSession());
    expect(base.identityDigest).not.toBe(identityId());
    expect(base.termsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(base.sourceAssociation).toEqual({ quote: COMPANION_QUOTE_SOURCE, fee: COMPANION_FEE_SOURCE });
    expect(base.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(intent(ownerSession(1)).binding).not.toBe(base.binding);
    expect(intent(ownerSession(), identityId(1)).binding).not.toBe(base.binding);
    expect(intent(ownerSession(), identityId(), { ...terms, revision: 1 }).binding).not.toBe(base.binding);
    expect(() => reserveSyntheticCompanionIntent(undefined, {
      ownerSession: ownerSession(), identityId: identityId(), terms, sessionExpiresAt: 160_000,
    })).toThrow(/storage unavailable/);
  });

  it('does not treat a changed source association as an accepted stored intent', () => {
    const value = intent();
    expect(() => syntheticCompanionIntentSchema.parse({
      ...value, sourceAssociation: { ...value.sourceAssociation, quote: 'market-provider' },
    })).toThrow();
  });

  it('atomically permits only one identity and terms set for a session under concurrent calls', async () => {
    const journal = new MemoryJournal();
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => reserve(journal, ownerSession(), identityId(), terms)),
      Promise.resolve().then(() => reserve(journal, ownerSession(), identityId(1), { ...terms, revision: 1 })),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(journal.rows.size).toBe(1);
    expect(() => reserve(journal, ownerSession(), identityId(2), terms)).toThrow(/unavailable/);
    expect(() => reserve(journal, ownerSession(), identityId(), { ...terms, quantity: '0.2' })).toThrow(/unavailable/);
  });

  it('retains the per-session reservation across a reconstructed journal view and tombstones revocation', () => {
    const persistedRows = new Map<string, TestRow>();
    const beforeRestart = new MemoryJournal(persistedRows);
    reserve(beforeRestart);
    const afterRestart = new MemoryJournal(persistedRows);
    expect(() => reserve(afterRestart, ownerSession(), identityId(1))).toThrow(/unavailable/);
    expect(afterRestart.rows.size).toBe(1);
    revokeSyntheticCompanionIntent(afterRestart, ownerSession());
    expect(afterRestart.rows.get(intent().sessionDigest)?.revoked).toBe(true);
    expect(() => reserve(afterRestart, ownerSession(), identityId(2))).toThrow(/unavailable/);
  });

  it('derives tombstone expiry from the committed row and rejects missing reservations', () => {
    const journal = new MemoryJournal();
    reserve(journal);
    const sessionDigest = intent().sessionDigest;
    revokeSyntheticCompanionIntent(journal, ownerSession());
    expect(journal.rows.get(sessionDigest)).toMatchObject({ expiresAt: 160_000, revoked: true });
    expect(() => reserve(journal, ownerSession(), identityId(9))).toThrow(/unavailable/);

    const absent = new MemoryJournal();
    expect(() => revokeSyntheticCompanionIntent(absent, ownerSession(9))).toThrow(/unavailable/);
    expect(absent.rows.size).toBe(0);
  });

  it('expires only expired rows and never evicts an unexpired session to admit the 65th', () => {
    const journal = new MemoryJournal();
    for (let i = 0; i < MAX_DURABLE_COMPANION_SESSIONS; i++) reserve(journal, ownerSession(i), identityId(i));
    expect(journal.rows.size).toBe(64);
    expect(() => reserve(journal, ownerSession(64), identityId(64))).toThrow(/unavailable/);
    expect(journal.rows.size).toBe(64);
    journal.now = 160_000;
    expect(reserve(journal, ownerSession(64), identityId(64), terms, 220_000).sessionExpiresAt).toBe(220_000);
    expect(journal.rows.size).toBe(1);
  });

  it('fails closed on ambiguous writes without retrying or freeing the reservation', () => {
    const journal = new MemoryJournal();
    journal.ambiguousAfterCommit = true;
    expect(() => reserve(journal)).toThrow(/unavailable/);
    expect(journal.calls).toBe(1);
    expect(journal.rows.size).toBe(1);
    expect(() => reserve(journal)).toThrow(/unavailable/);
    expect(journal.calls).toBe(2);
    const failed: SyntheticCompanionIntentJournal = {
      reserve: () => { throw new Error('storage details must not escape'); },
      revoke: () => 'unknown',
    };
    expect(() => reserve(failed)).toThrow('synthetic intent outcome unknown');
    expect(() => revokeSyntheticCompanionIntent(failed, ownerSession())).toThrow('synthetic intent unavailable');
  });

  it('keeps preview output sourced, exact-decimal and explicitly non-broker/non-execution', () => {
    const now = 100_000;
    const channel = createSyntheticCompanion({ enabled: true, now: () => now, sources: {
      quote: (_terms, at, binding) => ({ source: COMPANION_QUOTE_SOURCE, instrument: 'SYNTH-USD', currency: 'USD', binding, price: '9.00', observedAt: at, expiresAt: at + 1000 }),
      fee: (_terms, at, binding) => ({ source: COMPANION_FEE_SOURCE, currency: 'USD', binding, amount: '0.01', observedAt: at, expiresAt: at + 1000 }),
    } });
    const identity = channel.provision(ownerSession(), now + 60_000);
    const preview = channel.preview({
      version: 'v1', operation: 'synthetic-preview', identityId: identity.identityId,
      nonce: 'n'.repeat(43), issuedAt: now, expiresAt: now + COMPANION_REQUEST_TTL_MS, terms,
    }, { remoteAddress: '127.0.0.1', session: ownerSession(), identityId: identity.identityId, credential: identity.credential });
    expect(preview).toMatchObject({
      quote: { source: COMPANION_QUOTE_SOURCE, price: '9.00' },
      fee: { source: COMPANION_FEE_SOURCE, amount: '0.01' },
      notional: '9.990', total: '10.000', synthetic: true,
      brokerFacts: false, execution: false,
    });
  });
});
