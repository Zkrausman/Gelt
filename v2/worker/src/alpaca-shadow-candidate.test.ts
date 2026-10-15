import { describe, expect, it } from 'vitest';
import { acquireAlpacaIexDailyBars } from './alpaca-iex-connector.js';
import {
  alpacaIexMaxObservations,
  alpacaSessionCalendarDigest,
  type AlpacaIexRequest,
} from './alpaca-iex-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { shadowRuleId, type ShadowRuleInput } from './shadow-rule-contract.js';
import { buildAlpacaShadowCandidate, type AlpacaShadowCandidateContext } from './alpaca-shadow-candidate.js';

const syntheticKeyPair = {
  keyId: 'SYNTHETIC_KEY_ID_123456',
  secretKey: 'SYNTHETIC_SECRET_12345678901234567890',
};
const hash = (character: string) => character.repeat(64);
const addMs = (timestamp: string, milliseconds: number) => new Date(Date.parse(timestamp) + milliseconds).toISOString();

function makeRequest(count = 253, adjustment: AlpacaIexRequest['adjustment'] = 'raw', calendarMarker = 'a'): AlpacaIexRequest {
  const sessions = Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    return {
      providerTimestamp: `${day}T14:30:00.000Z`,
      sessionOrdinal: 1000 + index,
      closedAt: `${day}T21:00:00.000Z`,
      completedAt: `${day}T21:05:00.000Z`,
      completed: true as const,
      completionEvidenceSha256: hash(calendarMarker),
    };
  });
  return {
    enabled: true,
    symbol: 'AAPL',
    feed: 'iex',
    adjustment,
    start: sessions[0].providerTimestamp,
    end: sessions[sessions.length - 1].providerTimestamp,
    asof: '2026-10-14',
    calendar: {
      symbol: 'AAPL',
      sha256: alpacaSessionCalendarDigest({ symbol: 'AAPL', sessions }),
      sessions,
    },
  };
}

function rawBar(timestamp: string, close: string) {
  return `{"t":${JSON.stringify(timestamp)},"o":${close},"h":${close},"l":${close},"c":${close},"v":12.5,"n":7,"vw":${close}}`;
}

function response(bytes: Buffer): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
}

function pageBody(symbol: string, rows: string[], nextPageToken: string | null): Buffer {
  return Buffer.from(`{"bars":{"${symbol}":[${rows.join(',')}]},"next_page_token":${JSON.stringify(nextPageToken)}}`);
}

type CaptureOptions = Readonly<{
  count?: number;
  adjustment?: AlpacaIexRequest['adjustment'];
  calendarMarker?: string;
  latestClose?: string;
  transformFirstPage?: (bytes: Buffer) => Buffer;
}>;

async function capture(options: CaptureOptions = {}) {
  const request = makeRequest(options.count ?? 253, options.adjustment ?? 'raw', options.calendarMarker ?? 'a');
  const descending = [...request.calendar.sessions].reverse();
  const acquisition = await acquireAlpacaIexDailyBars(request, syntheticKeyPair, {
    fetcher: async input => {
      const url = new URL(String(input));
      const token = url.searchParams.get('page_token');
      const offset = token === 'page-two' ? 100 : token === 'page-three' ? 200 : 0;
      const limit = Number(url.searchParams.get('limit'));
      const selected = descending.slice(offset, offset + limit);
      const rows = selected.map(session => rawBar(
        session.providerTimestamp,
        session.providerTimestamp === request.calendar.sessions[request.calendar.sessions.length - 1].providerTimestamp
          ? options.latestClose ?? '101.00'
          : '100.00',
      ));
      const hasMore = offset + selected.length < descending.length;
      const next = hasMore ? offset + selected.length >= 200 ? 'page-three' : 'page-two' : null;
      let bytes = pageBody('AAPL', rows, next);
      if (offset === 0 && options.transformFirstPage) bytes = options.transformFirstPage(bytes);
      return response(bytes);
    },
  });
  const normalizationInput = {
    source: 'alpaca-data-v2' as const,
    feed: 'iex' as const,
    symbol: request.symbol,
    adjustment: request.adjustment,
    asof: request.asof,
    calendar: request.calendar,
    availability: request.calendar.sessions.map(session => ({
      providerTimestamp: session.providerTimestamp,
      availableAt: acquisition.receivedAt,
      evidenceSha256: hash('c'),
    })),
    receivedAt: acquisition.receivedAt,
    decisionAt: addMs(acquisition.receivedAt, 60_000),
  };
  const context: AlpacaShadowCandidateContext = {
    runId: '00000000-0000-4000-8000-000000000001',
    // Synthetic caller assertion. The independently bound connector pin is in the manifest.
    sourceCommit: '9'.repeat(40),
    expectedCalendarSha256: request.calendar.sha256,
    expectedWindow: {
      firstSessionOrdinal: request.calendar.sessions[0].sessionOrdinal,
      lastSessionOrdinal: request.calendar.sessions[request.calendar.sessions.length - 1].sessionOrdinal,
      observationCount: request.calendar.sessions.length,
    },
    rightsEvidenceSha256: hash('d'),
    policy: {
      scheduleSha256: hash('e'),
      maxAgeMs: 172_800_000,
      exposureCap: { value: '0.5', precision: 2, scale: 1 },
    },
    costs: {
      status: 'unverified',
      evidenceSha256: hash('f'),
      stressScenarioSha256: hash('1'),
      commissionPerTrade: { value: '0.01', precision: 3, scale: 2 },
      spreadFraction: { value: '0.001', precision: 4, scale: 3 },
      slippageFraction: { value: '0.001', precision: 4, scale: 3 },
    },
    controls: { passiveSha256: hash('2'), cashAssumptionSha256: hash('3') },
    portfolio: { state: 'unknown', snapshotSha256: hash('4') },
  };
  return { request, acquisition, normalizationInput, context };
}

function candidate(fixture: Awaited<ReturnType<typeof capture>>, overrides: {
  acquisition?: unknown;
  normalizationInput?: unknown;
  context?: unknown;
} = {}) {
  return buildAlpacaShadowCandidate(
    overrides.acquisition ?? fixture.acquisition,
    (overrides.normalizationInput ?? fixture.normalizationInput) as never,
    overrides.context ?? fixture.context,
  );
}

function constructedInput(count = 253, overrides: Partial<ShadowRuleInput> = {}): ShadowRuleInput {
  const base: ShadowRuleInput = {
    schema: 'gelt.shadow-rule-input.v1',
    ruleId: shadowRuleId,
    runId: '00000000-0000-4000-8000-000000000001',
    sourceCommit: 'a'.repeat(40),
    decisionAt: '2026-10-15T00:00:00.000Z',
    instrument: { id: 'TEST', currency: 'USD', calendarSha256: hash('b') },
    data: {
      classification: 'constructed_offline_test', eligibility: 'declared',
      datasetSha256: hash('c'), rightsEvidenceSha256: hash('d'), pointInTimeEvidenceSha256: hash('e'),
    },
    policy: { scheduleSha256: hash('f'), maxAgeMs: 86_400_000, exposureCap: { value: '0.25', precision: 3, scale: 2 } },
    costs: {
      status: 'declared', evidenceSha256: hash('1'), stressScenarioSha256: hash('2'),
      commissionPerTrade: { value: '0.01', precision: 3, scale: 2 },
      spreadFraction: { value: '0.001', precision: 4, scale: 3 },
      slippageFraction: { value: '0.001', precision: 4, scale: 3 },
    },
    controls: { passiveSha256: hash('3'), cashAssumptionSha256: hash('4') },
    portfolio: { state: 'settled', snapshotSha256: hash('5') },
    bars: Array.from({ length: count }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 15) - (count - index) * 86_400_000).toISOString();
      return {
        sessionOrdinal: index,
        closedAt: day,
        availableAt: day,
        adjustedClose: { value: index === count - 1 ? '101' : '100', precision: 3, scale: 0 },
      };
    }),
  };
  return { ...base, ...overrides };
}

describe('in-memory Alpaca-to-G05 candidate bridge (synthetic transport only)', () => {
  it('C01 preserves a lossless 253-bar capture in the canonical unverified G05 candidate and exact receipt replay', async () => {
    const fixture = await capture({ latestClose: '9007199254740992.01' });
    const result = candidate(fixture);
    expect(result.status).toBe('candidate');
    if (result.status !== 'candidate') return;
    expect(result.input.bars).toHaveLength(253);
    expect(result.input.bars[252].adjustedClose).toEqual({ value: '9007199254740992.01', precision: 18, scale: 2 });
    expect(result.input.data).toMatchObject({ classification: 'market_shadow_input', eligibility: 'unverified' });
    expect(result.receipt).toMatchObject({
      inputValidation: 'valid', classification: 'market_shadow_input', decision: 'abstain', reason: 'unverified_data',
      marketEvaluation: 'not_established', effectAuthority: 'none', promotionAllowed: false,
    });
    expect(result.replayMatches).toBe(true);
    expect(Object.keys(result.knownMissingGates)).toHaveLength(7);
    expect(result.knownMissingGates).toMatchObject({ A1_source_rights: 'not_established', A7_initial_portfolio_risk_context: 'not_established' });
    expect(result.manifest.source).toMatchObject({ sourceCommit: fixture.context.sourceCommit, connectorPin: { mergeCommit: '17a745bf152d7295b6ea44d3348b8160af21e351' } });
    expect(result.manifest.datasetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.manifest.dataBody)).toBe(true);
    expect(Object.isFrozen(result.manifest.pointInTimeBody)).toBe(true);
    expect(Object.isFrozen(result.manifest.pointInTimeBody.calendar)).toBe(true);
    expect(Object.isFrozen(result.input.bars)).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
  });

  it('C02 blocks missing required context without a payload and rejects extra authority fields', async () => {
    const fixture = await capture({ count: 2 });
    const { costs: _costs, ...missing } = fixture.context;
    const blockedMissing = candidate(fixture, { context: missing });
    expect(blockedMissing).toMatchObject({ status: 'blocked', reason: 'missing_context' });
    if (blockedMissing.status === 'blocked') {
      expect(blockedMissing.missingContextFields).toContain('costs');
      expect(Object.hasOwn(blockedMissing, 'input')).toBe(false);
    }
    expect(candidate(fixture, { context: { ...fixture.context, costs: undefined } }))
      .toMatchObject({ status: 'blocked', reason: 'missing_context', missingContextFields: ['costs'] });
    const extra = { ...fixture.context, approval: true, eligibility: 'declared' };
    expect(candidate(fixture, { context: extra })).toMatchObject({ status: 'blocked', reason: 'invalid_context' });
  });

  it.each([
    ['rights reference', (context: AlpacaShadowCandidateContext) => {
      const { rightsEvidenceSha256: _rights, ...rest } = context;
      return rest;
    }, 'rightsEvidenceSha256'],
    ['schedule reference', (context: AlpacaShadowCandidateContext) => {
      const { scheduleSha256: _schedule, ...policy } = context.policy;
      return { ...context, policy };
    }, 'policy.scheduleSha256'],
    ['controls', (context: AlpacaShadowCandidateContext) => {
      const { controls: _controls, ...rest } = context;
      return rest;
    }, 'controls'],
    ['portfolio', (context: AlpacaShadowCandidateContext) => {
      const { portfolio: _portfolio, ...rest } = context;
      return rest;
    }, 'portfolio'],
  ] as const)('C02 blocks missing %s context without fabricating G05 values', async (_name, omit, field) => {
    const fixture = await capture({ count: 2 });
    const result = candidate(fixture, { context: omit(fixture.context) });
    expect(result).toMatchObject({ status: 'blocked', reason: 'missing_context' });
    if (result.status === 'blocked') {
      expect(result.missingContextFields).toContain(field);
      expect(Object.hasOwn(result, 'input')).toBe(false);
    }
  });

  it('rejects nested accessors before invoking them or allowing decisionAt mutation', async () => {
    const fixture = await capture({ count: 2 });
    const secret = 'SYNTHETIC_PRIVATE_GETTER_VALUE';
    let normalizationGetterCalls = 0;
    const attackedNormalization = structuredClone(fixture.normalizationInput);
    const attackedFact = { ...attackedNormalization.availability[0] };
    Object.defineProperty(attackedFact, 'evidenceSha256', {
      enumerable: true,
      get() {
        normalizationGetterCalls++;
        attackedNormalization.decisionAt = '2020-01-01T00:00:00.000Z';
        throw new Error(secret);
      },
    });
    attackedNormalization.availability[0] = attackedFact;
    const normalizationBlocked = candidate(fixture, { normalizationInput: attackedNormalization });
    expect(normalizationBlocked).toMatchObject({ status: 'blocked', reason: 'invalid_normalization_input' });
    expect(normalizationGetterCalls).toBe(0);
    expect(attackedNormalization.decisionAt).toBe(fixture.normalizationInput.decisionAt);
    expect(JSON.stringify(normalizationBlocked)).not.toContain(secret);

    let contextGetterCalls = 0;
    const attackedContext = { ...fixture.context };
    Object.defineProperty(attackedContext, 'policy', {
      enumerable: true,
      get() { contextGetterCalls++; throw new Error(secret); },
    });
    const contextBlocked = candidate(fixture, { context: attackedContext });
    expect(contextBlocked).toMatchObject({ status: 'blocked', reason: 'invalid_context' });
    expect(contextGetterCalls).toBe(0);
    expect(JSON.stringify(contextBlocked)).not.toContain(secret);

    const throwingProxy = new Proxy(fixture.context, {
      getOwnPropertyDescriptor() { throw new Error(secret); },
    });
    const proxyBlocked = candidate(fixture, { context: throwingProxy });
    expect(proxyBlocked).toMatchObject({ status: 'blocked', reason: 'invalid_context' });
    expect(JSON.stringify(proxyBlocked)).not.toContain(secret);
  });

  it('bounds owned snapshots and rejects cycles, symbols, and oversized arrays', async () => {
    const fixture = await capture({ count: 2 });
    const cyclic: any = { ...fixture.normalizationInput };
    cyclic.loop = cyclic;
    expect(candidate(fixture, { normalizationInput: cyclic }))
      .toMatchObject({ status: 'blocked', reason: 'invalid_normalization_input' });

    const symbolContext = { ...fixture.context, [Symbol('extra')]: true };
    expect(candidate(fixture, { context: symbolContext }))
      .toMatchObject({ status: 'blocked', reason: 'invalid_context' });

    const oversized = {
      ...fixture.normalizationInput,
      availability: Array.from({ length: alpacaIexMaxObservations + 1 }, () => fixture.normalizationInput.availability[0]),
    };
    expect(candidate(fixture, { normalizationInput: oversized }))
      .toMatchObject({ status: 'blocked', reason: 'invalid_normalization_input' });
  });

  it('C03 keeps raw-number and connector issuance defenses in force', async () => {
    const request = makeRequest(1);
    const invalidBodies = [
      Buffer.from('{"bars":{"AAPL":[]},"bars":{"AAPL":[]},"next_page_token":null}'),
      pageBody('AAPL', [rawBar(request.calendar.sessions[0].providerTimestamp, '1e3')], null),
    ];
    for (const bytes of invalidBodies) {
      await expect(acquireAlpacaIexDailyBars(request, syntheticKeyPair, { fetcher: async () => response(bytes) }))
        .rejects.toThrow('Alpaca market data unavailable');
    }
    const fixture = await capture({ count: 2 });
    const copied = structuredClone(fixture.acquisition) as any;
    const cloned = candidate(fixture, { acquisition: copied });
    expect(cloned).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });
    copied.pages[0].sha256 = hash('9');
    expect(candidate(fixture, { acquisition: copied })).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });

    for (const [field, expectedReason] of [
      ['source', 'invalid_normalization_input'],
      ['symbol', 'normalization_rejected'],
      ['asof', 'normalization_rejected'],
      ['adjustment', 'normalization_rejected'],
    ] as const) {
      const altered = { ...fixture.normalizationInput };
      if (field === 'source') altered.source = 'other-source' as never;
      if (field === 'symbol') altered.symbol = 'MSFT';
      if (field === 'asof') altered.asof = '2026-10-13';
      if (field === 'adjustment') altered.adjustment = 'split';
      expect(candidate(fixture, { normalizationInput: altered }))
        .toMatchObject({ status: 'blocked', reason: expectedReason });
    }
  });

  it('C04 rejects copied/backdated captures, changed calendars, chronology, and late availability', async () => {
    const fixture = await capture({ count: 3 });
    const backdated = structuredClone(fixture.acquisition);
    backdated.receivedAt = '2025-01-01T00:00:00.000Z';
    expect(candidate(fixture, { acquisition: backdated })).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });

    const changedCalendar = structuredClone(fixture.normalizationInput);
    changedCalendar.calendar.sessions[0].closedAt = addMs(changedCalendar.calendar.sessions[0].closedAt, 1_000);
    expect(candidate(fixture, { normalizationInput: changedCalendar })).toMatchObject({ status: 'blocked', reason: 'invalid_normalization_input' });

    const lateAvailability = structuredClone(fixture.normalizationInput);
    lateAvailability.availability[0].availableAt = addMs(lateAvailability.decisionAt, 1_000);
    expect(candidate(fixture, { normalizationInput: lateAvailability })).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });

    const beforeReceipt = { ...fixture.normalizationInput, decisionAt: addMs(fixture.acquisition.receivedAt, -1) };
    expect(candidate(fixture, { normalizationInput: beforeReceipt })).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });

    const unfinished = structuredClone(fixture.normalizationInput) as any;
    unfinished.calendar.sessions[0].completed = false;
    expect(candidate(fixture, { normalizationInput: unfinished })).toMatchObject({ status: 'blocked', reason: 'invalid_normalization_input' });

    const renumbered = structuredClone(fixture.normalizationInput);
    renumbered.calendar.sessions[1].sessionOrdinal += 2;
    renumbered.calendar.sha256 = alpacaSessionCalendarDigest(renumbered.calendar);
    expect(candidate(fixture, { normalizationInput: renumbered })).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });

    const removedSession = structuredClone(fixture.normalizationInput);
    removedSession.calendar.sessions.pop();
    removedSession.calendar.sha256 = alpacaSessionCalendarDigest(removedSession.calendar);
    expect(candidate(fixture, { normalizationInput: removedSession })).toMatchObject({ status: 'blocked', reason: 'normalization_rejected' });

    const expectedCalendarMismatch = { ...fixture.context, expectedCalendarSha256: hash('8') };
    expect(candidate(fixture, { context: expectedCalendarMismatch })).toMatchObject({ status: 'blocked', reason: 'calendar_mismatch' });
    const expectedWindowMismatch = {
      ...fixture.context,
      expectedWindow: { ...fixture.context.expectedWindow, firstSessionOrdinal: fixture.context.expectedWindow.firstSessionOrdinal + 1 },
    };
    expect(candidate(fixture, { context: expectedWindowMismatch })).toMatchObject({ status: 'blocked', reason: 'window_mismatch' });
  });

  it('C05 allows short warm-up only, checks the separately frozen bounds, and rejects a 254th observation', async () => {
    const short = await capture({ count: 2 });
    const warmup = candidate(short);
    expect(warmup).toMatchObject({ status: 'candidate', receipt: { decision: 'abstain', reason: 'unverified_data' } });
    const changedWindow = { ...short.context, expectedWindow: { ...short.context.expectedWindow, observationCount: 3 } };
    expect(candidate(short, { context: changedWindow })).toMatchObject({ status: 'blocked', reason: 'window_mismatch' });

    let fetchCalls = 0;
    await expect(acquireAlpacaIexDailyBars(makeRequest(alpacaIexMaxObservations + 1), syntheticKeyPair, {
      fetcher: async () => { fetchCalls++; return response(Buffer.from('{}')); },
    })).rejects.toThrow('Alpaca market data unavailable');
    expect(fetchCalls).toBe(0);
  });

  it('C06 binds corrected prices, request/adjustment revisions, and availability revisions to separate identities', async () => {
    const first = await capture({ count: 2, latestClose: '101.00', adjustment: 'raw' });
    const firstCandidate = candidate(first);
    const replay = candidate(first);
    expect(firstCandidate.status).toBe('candidate');
    expect(replay.status).toBe('candidate');
    if (firstCandidate.status !== 'candidate' || replay.status !== 'candidate') return;
    expect(replay.canonicalInput).toBe(firstCandidate.canonicalInput);
    expect(replay.receipt).toEqual(firstCandidate.receipt);

    const corrected = await capture({ count: 2, latestClose: '102.00', adjustment: 'raw' });
    const correctedCandidate = candidate(corrected);
    expect(correctedCandidate.status).toBe('candidate');
    if (correctedCandidate.status === 'candidate') {
      expect(correctedCandidate.manifest.datasetSha256).not.toBe(firstCandidate.manifest.datasetSha256);
      expect(correctedCandidate.manifest.dataBody.normalizedBarsSha256)
        .not.toBe(firstCandidate.manifest.dataBody.normalizedBarsSha256);
      expect(correctedCandidate.receipt.decisionId).not.toBe(firstCandidate.receipt.decisionId);
    }

    const split = await capture({ count: 2, latestClose: '101.00', adjustment: 'split' });
    const splitCandidate = candidate(split);
    expect(splitCandidate.status).toBe('candidate');
    if (splitCandidate.status === 'candidate') {
      expect(splitCandidate.manifest.datasetSha256).not.toBe(firstCandidate.manifest.datasetSha256);
      expect(splitCandidate.manifest.dataBody.adjustment).toBe('split');
      expect(splitCandidate.manifest.dataBody.request).toMatchObject({ adjustment: 'split' });
    }

    const calendarRevision = await capture({ count: 2, latestClose: '101.00', adjustment: 'raw', calendarMarker: 'b' });
    const calendarCandidate = candidate(calendarRevision);
    expect(calendarCandidate.status).toBe('candidate');
    if (calendarCandidate.status === 'candidate') {
      expect(calendarCandidate.manifest.dataBody.calendarSha256)
        .not.toBe(firstCandidate.manifest.dataBody.calendarSha256);
      expect(calendarCandidate.manifest.pointInTimeBody.calendar.sha256)
        .not.toBe(firstCandidate.manifest.pointInTimeBody.calendar.sha256);
    }

    const availabilityRevision = structuredClone(first.normalizationInput);
    availabilityRevision.availability[0].evidenceSha256 = hash('5');
    const revisedCandidate = candidate(first, { normalizationInput: availabilityRevision });
    expect(revisedCandidate.status).toBe('candidate');
    if (revisedCandidate.status === 'candidate') {
      expect(revisedCandidate.manifest.pointInTimeEvidenceSha256).not.toBe(firstCandidate.manifest.pointInTimeEvidenceSha256);
      expect(revisedCandidate.receipt.decisionId).not.toBe(firstCandidate.receipt.decisionId);
    }
    expect(Object.isFrozen(first.acquisition.pages)).toBe(true);
  });

  it('C07 keeps large raw page bodies outside the bounded canonical G05 input', async () => {
    const fixture = await capture({
      count: 1,
      transformFirstPage: bytes => Buffer.concat([Buffer.alloc(270 * 1024, 0x20), bytes]),
    });
    const result = candidate(fixture);
    expect(result.status).toBe('candidate');
    if (result.status !== 'candidate') return;
    expect(result.manifest.dataBody.rawPages).toEqual([{ page: 1, byteLength: expect.any(Number), sha256: expect.any(String) }]);
    expect(result.manifest.rawBodies).toBe('not_included');
    expect(result.manifest.retentionAuthority).toBe('none');
    expect(Buffer.byteLength(result.canonicalInput, 'utf8')).toBeLessThan(256 * 1024);
    expect(result.canonicalInput).not.toContain('bodyBase64');
    expect(result.canonicalInput).not.toContain('SYNTHETIC_SECRET');
  });

  it('C08 rejects eligibility promotion, constructed relabeling, approval switches, and authority extras', async () => {
    const fixture = await capture({ count: 2 });
    const attacks = [
      { ...fixture.context, eligibility: 'declared' },
      { ...fixture.context, classification: 'constructed_offline_test' },
      { ...fixture.context, approved: true },
      { ...fixture.context, effectAuthority: 'orders' },
    ];
    for (const attack of attacks) {
      const result = candidate(fixture, { context: attack });
      expect(result).toMatchObject({ status: 'blocked', reason: 'invalid_context', effectAuthority: 'none', promotionAllowed: false });
      expect(Object.hasOwn(result, 'input')).toBe(false);
    }
  });

  it('C09 keeps existing constructed G05 warm-up, freshness, UNKNOWN, costs, long, and cash behavior separate', () => {
    const evaluate = (input: ShadowRuleInput) => evaluateShadowRule(Buffer.from(JSON.stringify(input)));
    expect(evaluate(constructedInput(2))).toMatchObject({ decision: 'abstain', reason: 'insufficient_warmup' });
    expect(evaluate(constructedInput(253, { policy: { scheduleSha256: hash('f'), maxAgeMs: 1, exposureCap: { value: '0.25', precision: 3, scale: 2 } } })))
      .toMatchObject({ decision: 'abstain', reason: 'stale_input' });
    expect(evaluate(constructedInput(253, { portfolio: { state: 'unknown', snapshotSha256: hash('5') } })))
      .toMatchObject({ decision: 'abstain', reason: 'execution_unknown' });
    expect(evaluate(constructedInput(253, { costs: { ...constructedInput().costs, status: 'unverified' } })))
      .toMatchObject({ decision: 'abstain', reason: 'unverified_costs' });
    expect(evaluate(constructedInput())).toMatchObject({ decision: 'target_long', reason: 'positive_return' });
    const cashBars = constructedInput().bars.map(bar => ({ ...bar, adjustedClose: { value: '100', precision: 3, scale: 0 } }));
    expect(evaluate(constructedInput(253, { bars: cashBars }))).toMatchObject({ decision: 'target_cash', reason: 'nonpositive_return' });
  });
});
