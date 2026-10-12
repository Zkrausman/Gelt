import { describe, expect, it } from 'vitest';
import {
  COMPANION_REQUEST_TTL_MS,
  MAX_COMPANION_IDENTITIES,
  MAX_COMPANION_NONCES,
  createSyntheticCompanion,
  type CompanionCaller,
  type CompanionRequest,
  type CompanionTerms,
} from './synthetic-companion.js';

const session = 's'.repeat(43);
const otherSession = 'o'.repeat(43);
const terms: CompanionTerms = {
  account: 'synthetic-companion-account-a', route: 'RHS', instrument: 'SYNTH-USD',
  side: 'BUY', type: 'LIMIT', timeInForce: 'DAY', quantity: '0.1', limitPrice: '99.90', revision: 0,
};
function fixture(sources?: Parameters<typeof createSyntheticCompanion>[0]['sources']) {
  let now = 100_000;
  const fixtureSources = sources ?? {
    quote: (_terms: CompanionTerms, at: number, binding: string) => ({ source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', binding, observedAt: at, expiresAt: at + 1000 }),
    fee: (_terms: CompanionTerms, at: number, binding: string) => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', amount: '0.01', binding, observedAt: at, expiresAt: at + 1000 }),
  };
  // Existing adverse-source fixtures omit binding so their intended stale/source
  // failure stays isolated; an explicitly wrong binding must never be replaced.
  const boundSources = {
    quote: (t: CompanionTerms, at: number, binding: string) => {
      const value = fixtureSources.quote(t, at, binding);
      return typeof value === 'object' && value !== null ? { binding, ...value } : value;
    },
    fee: (t: CompanionTerms, at: number, binding: string) => {
      const value = fixtureSources.fee(t, at, binding);
      return typeof value === 'object' && value !== null ? { binding, ...value } : value;
    },
  };
  const channel = createSyntheticCompanion({ enabled: true, now: () => now, sources: boundSources });
  const identity = channel.provision(session, now + 60_000);
  const caller: CompanionCaller = {
    remoteAddress: '127.0.0.1', session,
    identityId: identity.identityId, credential: identity.credential,
  };
  const request = (overrides: Partial<CompanionRequest> = {}, nextTerms = terms): CompanionRequest => ({
    version: 'v1', operation: 'synthetic-preview', identityId: identity.identityId,
    nonce: 'n'.repeat(43), issuedAt: now, expiresAt: now + COMPANION_REQUEST_TTL_MS,
    terms: nextTerms, ...overrides,
  });
  return { channel, identity, caller, request, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('separate synthetic companion preview kernel', () => {
  it('is disabled by default and has no authority even when explicitly enabled', () => {
    const offline = createSyntheticCompanion({ now: () => 100_000 });
    expect(offline.status()).toMatchObject({ enabled: false, activeIdentities: 0, execution: false, brokerPreview: false, orderAuthority: false });
    expect(() => offline.provision(session, 110_000)).toThrow();
    const f = fixture();
    expect(f.channel.status()).toMatchObject({ enabled: true, activeIdentities: 1, execution: false, brokerPreview: false, orderAuthority: false });
  });

  it('rejects enabled previews without explicit sources and rejects wrong terms association', () => {
    const noSources = createSyntheticCompanion({ enabled: true, now: () => 100_000 });
    const identity = noSources.provision(session, 160_000);
    const caller = { remoteAddress: '127.0.0.1', session, identityId: identity.identityId, credential: identity.credential };
    const request = { version: 'v1', operation: 'synthetic-preview', identityId: identity.identityId,
      nonce: 'n'.repeat(43), issuedAt: 100_000, expiresAt: 130_000, terms };
    expect(() => noSources.preview(request, caller)).toThrow(/source/);
    const f = fixture({
      quote: (_terms, now, binding) => ({ source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', binding, observedAt: now, expiresAt: now + 1000 }),
      fee: (_terms, now) => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', amount: '0.01', binding: '0'.repeat(64), observedAt: now, expiresAt: now + 1000 }),
    });
    expect(() => f.channel.preview(f.request(), f.caller)).toThrow(/association/);
  });

  it('bounds identity and session state without eviction', () => {
    let now = 100_000;
    const channel = createSyntheticCompanion({ enabled: true, now: () => now });
    for (let i = 0; i < MAX_COMPANION_IDENTITIES; i++) {
      const ownerSession = 'x'.repeat(40) + i.toString(36).padStart(3, '0');
      channel.provision(ownerSession, now + 60_000);
    }
    expect(channel.status().activeIdentities).toBe(MAX_COMPANION_IDENTITIES);
    expect(() => channel.provision('z'.repeat(43), now + 60_000)).toThrow();
    now += 60_000;
    expect(channel.status().activeIdentities).toBe(0);
    expect(channel.provision('z'.repeat(43), now + 60_000).expiresAt).toBe(now + 60_000);
  });

  it('creates an independently random session-bound expiring identity and returns sourced exact preview only', () => {
    const f = fixture();
    const other = f.channel.provision(otherSession, f.now() + 60_000);
    expect(other.credential).not.toBe(f.identity.credential);
    expect(f.identity.credential).not.toBe('s'.repeat(43));
    const value = f.channel.preview(f.request(), f.caller);
    expect(value).toMatchObject({
      source: 'synthetic-companion-preview-v1', identityId: f.identity.identityId,
      terms, notional: '9.990', total: '10.000', currency: 'USD',
      quote: { source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', price: '9.00' },
      fee: { source: 'synthetic-companion-fee-v1', amount: '0.01' },
      synthetic: true, authorizing: false, brokerFacts: false, execution: false,
    });
    expect(JSON.stringify(value)).not.toContain(f.identity.credential);
  });

  it('rejects forged, cross-session, wrong-identity and non-loopback callers before use', () => {
    const f = fixture(), request = f.request();
    expect(() => f.channel.preview(request, { ...f.caller, credential: 'x'.repeat(43) })).toThrow();
    expect(() => f.channel.preview(request, { ...f.caller, session: otherSession })).toThrow();
    expect(() => f.channel.preview({ ...request, identityId: 'a'.repeat(32) }, f.caller)).toThrow();
    expect(() => f.channel.preview(request, { ...f.caller, remoteAddress: '127.0.0.2' })).toThrow();
    expect(() => f.channel.preview(request, { ...f.caller, remoteAddress: '::1' })).toThrow();
    expect(f.channel.preview(request, f.caller).total).toBe('10.000');
  });

  it('rejects malformed, future, expired and overlong requests', () => {
    const f = fixture();
    expect(() => f.channel.preview({ ...f.request(), extra: true }, f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ issuedAt: f.now() + 1 }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ expiresAt: f.now() }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ expiresAt: f.now() + COMPANION_REQUEST_TTL_MS + 1 }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 'bad' }), f.caller)).toThrow();
    f.advance(COMPANION_REQUEST_TTL_MS);
    expect(() => f.channel.preview(f.request({ issuedAt: 100_000, expiresAt: 100_000 + COMPANION_REQUEST_TTL_MS }), f.caller)).toThrow();
  });

  it('bounds nonce and duplicate-request state without evicting replay history', () => {
    const f = fixture();
    for (let i = 0; i < MAX_COMPANION_NONCES; i++) {
      const nonce = i.toString(36).padStart(43, 'n');
      const nextTerms = { ...terms, revision: i };
      f.channel.preview(f.request({ nonce }, nextTerms), f.caller);
    }
    const last = f.request({ nonce: 'z'.repeat(43) }, { ...terms, revision: MAX_COMPANION_NONCES });
    expect(() => f.channel.preview(last, f.caller)).toThrow(/capacity/);
    expect(() => f.channel.preview(f.request({ nonce: 'n'.repeat(42) + '0' }, terms), f.caller)).toThrow(/replay/);
  });

  it('rejects nonce replay and duplicate terms; changed revision invalidates prior request keys', () => {
    const f = fixture(), first = f.request();
    expect(f.channel.preview(first, f.caller).total).toBe('10.000');
    expect(() => f.channel.preview(first, f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 'm'.repeat(43) }), f.caller)).toThrow();
    expect(f.channel.invalidate(session, 1).execution).toBe(false);
    const changed = { ...terms, revision: 1 };
    expect(f.channel.preview(f.request({ nonce: 'p'.repeat(43) }, changed), f.caller).terms.revision).toBe(1);
    expect(() => f.channel.preview(f.request({ nonce: 'q'.repeat(43) }, terms), f.caller)).toThrow();
  });

  it('retains identity-local nonce and duplicate guards past request expiry', () => {
    const f = fixture();
    expect(f.channel.preview(f.request(), f.caller).total).toBe('10.000');
    f.advance(COMPANION_REQUEST_TTL_MS + 1);
    const fresh = { expiresAt: f.now() + 1000 };
    expect(() => f.channel.preview(f.request(fresh), f.caller)).toThrow(/replay/);
    expect(() => f.channel.preview(f.request({ ...fresh, nonce: 'm'.repeat(43) }), f.caller)).toThrow(/duplicate/);
    f.channel.invalidate(session, 0);
    expect(() => f.channel.preview(f.request({ ...fresh, nonce: 'p'.repeat(43) }), f.caller)).toThrow(/duplicate/);
  });

  it('keeps duplicate preview checks identity-local, not a durable session-wide intent', () => {
    const f = fixture();
    expect(f.channel.preview(f.request(), f.caller).total).toBe('10.000');
    const second = f.channel.provision(session, f.now() + 60_000);
    const secondCaller: CompanionCaller = { ...f.caller, identityId: second.identityId, credential: second.credential };
    const sameTerms = f.request({ identityId: second.identityId, nonce: 'u'.repeat(43) });
    expect(f.channel.preview(sameTerms, secondCaller).total).toBe('10.000');
    expect(() => f.channel.preview(f.request({ nonce: 'v'.repeat(43) }), f.caller)).toThrow(/duplicate/);
    expect(() => f.channel.preview(f.request({ identityId: second.identityId, nonce: 'w'.repeat(43) }), secondCaller)).toThrow(/duplicate/);
  });

  it('binds synthetic account, supported route, instrument and complete terms', () => {
    const f = fixture();
    expect(() => f.channel.preview(f.request({ nonce: 'a'.repeat(43) }, { ...terms, route: 'RHC' }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 'b'.repeat(43) }, { ...terms, instrument: 'BTC-USD' as 'SYNTH-USD' }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 'c'.repeat(43) }, { ...terms, side: 'SELL' as 'BUY' }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 'd'.repeat(43) }, { ...terms, quantity: '0' }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 'e'.repeat(43), terms: { ...terms, padding: true } as CompanionTerms }), f.caller)).toThrow();
    expect(() => f.channel.preview(f.request({ nonce: 't'.repeat(43) }, { ...terms, timeInForce: 'GTC' as 'DAY' }), f.caller)).toThrow();
    f.channel.invalidate(session, 2);
    expect(() => f.channel.preview(f.request({ nonce: 'f'.repeat(43) }, { ...terms, revision: 1 }), f.caller)).toThrow();
  });

  it('requires an attributable fresh synthetic quote and rejects quote-source failures', () => {
    const forged = fixture({
      quote: (_terms, now) => ({ source: 'market-provider', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: now, expiresAt: now + 1000 }),
      fee: (_terms, now) => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', amount: '0.01', observedAt: now, expiresAt: now + 1000 }),
    });
    expect(() => forged.channel.preview(forged.request(), forged.caller)).toThrow();
    for (const quote of [
      { source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: 90_000, expiresAt: 100_500 },
      { source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: 100_001, expiresAt: 101_000 },
      { source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: 100_000, expiresAt: 100_000 },
      { source: 'synthetic-companion-quote-v1', instrument: 'OTHER', currency: 'USD', price: '9.00', observedAt: 100_000, expiresAt: 101_000 },
      { source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '100.00', observedAt: 100_000, expiresAt: 101_000 },
    ]) {
      const f = fixture({ quote: () => quote, fee: (_terms, now) => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', amount: '0.01', observedAt: now, expiresAt: now + 1000 }) });
      expect(() => f.channel.preview(f.request(), f.caller)).toThrow();
    }
  });

  it('requires attributable fresh fees and applies the exact fee-inclusive ten-dollar ceiling', () => {
    const unsourced = fixture({
      quote: (_terms, now) => ({ source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: now, expiresAt: now + 1000 }),
      fee: (_terms, now) => ({ currency: 'USD', amount: '0.01', observedAt: now, expiresAt: now + 1000 }),
    });
    expect(() => unsourced.channel.preview(unsourced.request(), unsourced.caller)).toThrow();
    const staleFee = fixture({
      quote: (_terms, now) => ({ source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: now, expiresAt: now + 1000 }),
      fee: () => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', amount: '0.01', observedAt: 90_000, expiresAt: 100_500 }),
    });
    expect(() => staleFee.channel.preview(staleFee.request(), staleFee.caller)).toThrow();
    const expensiveFee = fixture({
      quote: (_terms, now) => ({ source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', price: '9.00', observedAt: now, expiresAt: now + 1000 }),
      fee: (_terms, now) => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', amount: '0.02', observedAt: now, expiresAt: now + 1000 }),
    });
    expect(() => expensiveFee.channel.preview(expensiveFee.request(), expensiveFee.caller)).toThrow(/cap/);
    const overCap = fixture();
    expect(() => overCap.channel.preview(overCap.request({}, { ...terms, quantity: '1', limitPrice: '10.00' }), overCap.caller)).toThrow(/cap/);
  });

  it('expires identities, revokes on session loss and does not restore them after restart', () => {
    const f = fixture();
    f.advance(f.identity.expiresAt - f.now());
    expect(() => f.channel.preview(f.request(), f.caller)).toThrow();
    const g = fixture();
    g.channel.revokeSession(session);
    expect(g.channel.status().activeIdentities).toBe(0);
    expect(() => g.channel.preview(g.request(), g.caller)).toThrow();
    const h = fixture();
    const restarted = createSyntheticCompanion({ enabled: true, now: h.now });
    expect(() => restarted.preview(h.request(), h.caller)).toThrow();
  });
});
