import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireAlpacaIexDailyBars,
  isConnectorIssuedAlpacaAcquisition,
} from './alpaca-iex-connector.js';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import { buildAlpacaShadowCandidate } from './alpaca-shadow-candidate.js';
import {
  checkFailureReasons,
  checkIds,
  connectorPin,
  parseVerdictStructure,
  reviewAuthority,
  reviewLimits,
  snapshotCommit,
  type CheckId,
  type ReviewChecksV1,
} from './alpaca-byte-review-contract.js';
import {
  constructedByteReviewProfile as profile,
  createConstructedByteReviewLane,
  inspectByteReviewPage,
  inspectConstructedByteReview,
  productionByteReviewAvailability,
} from './alpaca-byte-review-checker.js';

const evidenceHash = 'a'.repeat(64);
const syntheticPair = {
  keyId: 'SYNTHETIC_KEY_ID_123456',
  secretKey: 'SYNTHETIC_SECRET_12345678901234567890',
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function rawPage(body: string, page = 1) {
  return {
    page,
    byteLength: Buffer.byteLength(body, 'utf8'),
    sha256: sha(body),
    bodyBase64: Buffer.from(body, 'utf8').toString('base64'),
  };
}

function result(checks: ReviewChecksV1, id: typeof checkIds[number]) {
  return checks.find(item => item.id === id)!;
}

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(profile.receivedAt));
  const lane = createConstructedByteReviewLane();
  const sessions = [
    '2024-01-02T00:00:00.000Z',
    '2024-01-03T00:00:00.000Z',
  ].map((providerTimestamp, sessionOrdinal) => ({
    providerTimestamp,
    sessionOrdinal,
    closedAt: providerTimestamp,
    completedAt: providerTimestamp,
    completed: true as const,
    completionEvidenceSha256: evidenceHash,
  }));
  const calendar = {
    symbol: profile.request.symbol,
    sessions,
    sha256: alpacaSessionCalendarDigest({ symbol: profile.request.symbol, sessions }),
  };
  const calls: string[] = [];
  const fetcher: typeof fetch = vi.fn(async input => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const body = url.searchParams.has('page_token')
      ? profile.pageBodies[1] : profile.pageBodies[0];
    return new Response(body, {
      headers: { 'content-type': 'application/json' },
    });
  });
  const original = await acquireAlpacaIexDailyBars({
    enabled: true,
    symbol: profile.request.symbol,
    feed: profile.request.feed,
    adjustment: profile.request.adjustment,
    start: profile.request.start,
    end: profile.request.end,
    asof: profile.request.asof,
    calendar,
  }, syntheticPair, { fetcher });

  const availability = sessions.map(session => ({
    providerTimestamp: session.providerTimestamp,
    availableAt: profile.receivedAt,
    evidenceSha256: evidenceHash,
  }));
  const context = {
    runId: lane.attemptId,
    sourceCommit: '9'.repeat(40),
    expectedCalendarSha256: calendar.sha256,
    expectedWindow: {
      firstSessionOrdinal: 0,
      lastSessionOrdinal: 1,
      observationCount: 2,
    },
    rightsEvidenceSha256: evidenceHash,
    policy: {
      scheduleSha256: evidenceHash,
      maxAgeMs: 0,
      exposureCap: { value: '1', precision: 1, scale: 0 },
    },
    costs: {
      status: 'unverified',
      evidenceSha256: evidenceHash,
      stressScenarioSha256: evidenceHash,
      commissionPerTrade: { value: '0', precision: 1, scale: 0 },
      spreadFraction: { value: '0', precision: 1, scale: 0 },
      slippageFraction: { value: '0', precision: 1, scale: 0 },
    },
    controls: {
      passiveSha256: evidenceHash,
      cashAssumptionSha256: evidenceHash,
    },
    portfolio: { state: 'unknown', snapshotSha256: evidenceHash },
  };
  const built = buildAlpacaShadowCandidate(original, {
    source: 'alpaca-data-v2',
    feed: 'iex',
    symbol: profile.request.symbol,
    adjustment: 'raw',
    asof: profile.request.asof,
    calendar,
    availability,
    receivedAt: original.receivedAt,
    decisionAt: original.receivedAt,
  }, context);
  if (built.status !== 'candidate') throw new Error('Synthetic fixture unavailable');

  // Construct owned, alias-free evidence before invoking the new checker.
  // The connector original is retained unchanged and is never reconstructed.
  const candidate = copy(built);
  const binding = copy({
    schema: 'gelt.review-before-discard-binding.v1',
    attemptId: lane.attemptId,
    revisions: { ...profile.revisions },
    source: {
      repositoryId: 1415613140,
      snapshotCommit,
      connectorPin: { ...connectorPin },
      runtimeClosureRevision: profile.runtimeClosureRevision,
    },
    request: original.request,
    receipt: {
      receivedAt: original.receivedAt,
      decisionAt: original.receivedAt,
    },
    pages: original.pages.map(({ page, byteLength, sha256 }) =>
      ({ page, byteLength, sha256 })),
    evidence: {
      calendar,
      availability,
      context,
      candidateCanonicalInput: built.canonicalInput,
      candidateReceipt: built.receipt,
      candidateManifest: built.manifest,
    },
    limits: { ...reviewLimits },
    authority: { ...reviewAuthority },
  });
  return { lane, original, binding, candidate, fetcher, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fixed independent checker, synthetic transport only', () => {
  it('reconstructs the byte/candidate predicates without manufacturing admission', async () => {
    const f = await fixture();
    expect(isConnectorIssuedAlpacaAcquisition(f.original)).toBe(true);
    const checks = inspectConstructedByteReview(f.original, f.binding, f.candidate);
    expect(checks.map(item => item.id)).toEqual(checkIds);
    for (const item of checks) {
      if ([
        'C07_CLOSURE_REVISIONS', 'C13_REVIEWER_ADMISSION',
        'C14_HANDLING', 'C15_LIFECYCLE',
      ].includes(item.id)) {
        expect(item.result).toBe('unknown');
        expect(item.reason).toBe('evidence_missing');
      } else expect(item).toMatchObject({ result: 'pass', reason: 'none' });
    }
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.calls.map(url => new URL(url).searchParams.get('limit'))).toEqual(['2', '1']);
  });

  it('checks issuance before reading a clone or its ordinary getters', async () => {
    const f = await fixture();
    const clone = copy(f.original);
    let getterCalls = 0;
    Object.defineProperty(clone, 'request', {
      enumerable: true,
      get() { getterCalls++; throw new Error('SYNTHETIC_DIAGNOSTIC'); },
    });
    const checks = inspectConstructedByteReview(clone, f.binding, f.candidate);
    expect(result(checks, 'C01_ISSUANCE')).toMatchObject({
      result: 'fail', reason: 'issuance_mismatch',
    });
    expect(checks.slice(1).every(item => item.result === 'unknown')).toBe(true);
    expect(getterCalls).toBe(0);
  });

  it('rejects an ordinary accessor or alias in newly supplied evidence', async () => {
    const f = await fixture();
    let calls = 0;
    Object.defineProperty(f.binding.evidence.context, 'policy', {
      enumerable: true,
      get() { calls++; return {}; },
    });
    const checks = inspectConstructedByteReview(f.original, f.binding, f.candidate);
    expect(result(checks, 'C16_IMMUTABILITY').result).toBe('fail');
    expect(calls).toBe(0);

    const g = await fixture();
    const aliased = g.binding as unknown as {
      evidence: { candidateManifest: unknown; context: { controls: unknown } };
    };
    aliased.evidence.candidateManifest = aliased.evidence.context.controls;
    expect(result(inspectConstructedByteReview(
      g.original, g.binding, g.candidate,
    ), 'C16_IMMUTABILITY').result).toBe('fail');
  });

  it('detects bound page, cursor and receipt substitutions', async () => {
    const f = await fixture();
    f.binding.pages[0].byteLength++;
    expect(result(inspectConstructedByteReview(
      f.original, f.binding, f.candidate,
    ), 'C02_PAGE_BYTES').result).toBe('fail');

    const g = await fixture();
    g.binding.request.pageRequests[1].pageTokenSha256 = 'b'.repeat(64);
    expect(result(inspectConstructedByteReview(
      g.original, g.binding, g.candidate,
    ), 'C03_REQUEST_CURSOR').result).toBe('fail');

    const h = await fixture();
    h.binding.receipt.receivedAt = '2024-01-03T23:59:59.999Z';
    expect(result(inspectConstructedByteReview(
      h.original, h.binding, h.candidate,
    ), 'C06_RECEIPT').result).toBe('fail');
  });

  it('checks calendar mapping and receipt-based availability independently', async () => {
    const f = await fixture();
    f.binding.evidence.calendar.sessions[1].sessionOrdinal = 3;
    f.binding.evidence.calendar.sha256 =
      alpacaSessionCalendarDigest(f.binding.evidence.calendar);
    expect(result(inspectConstructedByteReview(
      f.original, f.binding, f.candidate,
    ), 'C08_CALENDAR').result).toBe('fail');

    const g = await fixture();
    g.binding.evidence.availability[0].availableAt = '2024-01-03T23:59:59.999Z';
    expect(result(inspectConstructedByteReview(
      g.original, g.binding, g.candidate,
    ), 'C09_AVAILABILITY').result).toBe('fail');

    const h = await fixture();
    h.binding.evidence.context.expectedWindow.observationCount = 1;
    expect(result(inspectConstructedByteReview(
      h.original, h.binding, h.candidate,
    ), 'C10_CONTEXT_POLICY').result).toBe('fail');
  });

  it('rejects candidate canonical, receipt, manifest and authority tampering', async () => {
    const f = await fixture();
    f.candidate.canonicalInput += ' ';
    expect(result(inspectConstructedByteReview(
      f.original, f.binding, f.candidate,
    ), 'C11_CANDIDATE').result).toBe('fail');

    const g = await fixture();
    g.candidate.receipt.reason = 'invalid_input';
    expect(result(inspectConstructedByteReview(
      g.original, g.binding, g.candidate,
    ), 'C11_CANDIDATE').result).toBe('fail');

    const h = await fixture();
    h.candidate.manifest.g05InputSha256 = 'b'.repeat(64);
    expect(result(inspectConstructedByteReview(
      h.original, h.binding, h.candidate,
    ), 'C11_CANDIDATE').result).toBe('fail');

    const j = await fixture();
    const promoted = j.candidate as unknown as { promotionAllowed: boolean };
    promoted.promotionAllowed = true;
    const checks = inspectConstructedByteReview(j.original, j.binding, j.candidate);
    expect(result(checks, 'C12_AUTHORITY_FENCES')).toMatchObject({
      result: 'fail', reason: 'authority_escalation',
    });
  });

  it('does not convert matching revision labels or hashes into actual admission', async () => {
    const f = await fixture();
    const checks = inspectConstructedByteReview(f.original, f.binding, f.candidate);
    for (const id of [
      'C07_CLOSURE_REVISIONS', 'C13_REVIEWER_ADMISSION', 'C14_HANDLING',
    ] as const) expect(result(checks, id).result).toBe('unknown');
    expect(productionByteReviewAvailability()).toEqual({
      available: false, reason: 'admission_unavailable',
    });
  });
});

describe('initial content defects are distinct from construction and mutation', () => {
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Case = readonly [string, CheckId, (f: Fixture) => void];

  const cases: readonly Case[] = [
    ['page reference', 'C02_PAGE_BYTES', f => { f.binding.pages[0].byteLength = 0; }],
    ['request', 'C03_REQUEST_CURSOR', f => { f.binding.request.pageRequests[0].limit = 0; }],
    ['policy', 'C10_CONTEXT_POLICY', f => { f.binding.evidence.context.policy.maxAgeMs = -1; }],
    ['nonfinite policy scalar', 'C10_CONTEXT_POLICY', f => {
      f.binding.evidence.context.policy.maxAgeMs = NaN;
    }],
    ['negative-zero policy scalar', 'C10_CONTEXT_POLICY', f => {
      f.binding.evidence.context.policy.maxAgeMs = -0;
    }],
    ['candidate', 'C11_CANDIDATE', f => { f.candidate.canonicalInput = ''; }],
    ['candidate value', 'C11_CANDIDATE', f => {
      (f.candidate as unknown as { input: unknown }).input = NaN;
    }],
    ['revision', 'C07_CLOSURE_REVISIONS', f => {
      (f.binding.revisions as unknown as { consumer: string }).consumer = '1.0';
    }],
    ['revision Unicode', 'C07_CLOSURE_REVISIONS', f => {
      (f.binding.revisions as unknown as { request: string }).request = '\ud800';
    }],
    ['calendar', 'C08_CALENDAR', f => {
      f.binding.evidence.calendar.sha256 = '0'.repeat(64);
    }],
    ['availability', 'C09_AVAILABILITY', f => {
      f.binding.evidence.availability[0].availableAt = 'invalid';
    }],
    ['receipt', 'C06_RECEIPT', f => { f.binding.receipt.decisionAt = 'invalid'; }],
    ['bound candidate receipt', 'C11_CANDIDATE', f => {
      (f.binding.evidence.candidateReceipt as unknown as { reason: string }).reason = 'invalid';
    }],
  ];

  it.each(cases)('classifies initial %s without fabricating mutation', async (_name, id, mutate) => {
    const f = await fixture();
    mutate(f);
    const checks = inspectConstructedByteReview(f.original, f.binding, f.candidate);
    expect(checks.map(item => item.id)).toEqual(checkIds);
    expect(result(checks, id)).toEqual({
      id, result: 'fail', reason: checkFailureReasons[id],
    });
    expect(result(checks, 'C01_ISSUANCE').result).toBe('pass');
    expect(result(checks, 'C16_IMMUTABILITY')).toEqual({
      id: 'C16_IMMUTABILITY', result: 'pass', reason: 'none',
    });
    expect(result(checks, 'C13_REVIEWER_ADMISSION').result).toBe('unknown');
    expect(result(checks, 'C14_HANDLING').result).toBe('unknown');
    expect(result(checks, 'C07_CLOSURE_REVISIONS').result).not.toBe('pass');
    expect(JSON.stringify(checks)).not.toContain('mutation_detected');
  });

  it('retains multiple independently established initial content failures', async () => {
    const f = await fixture();
    f.binding.pages[0].sha256 = 'invalid';
    f.binding.receipt.decisionAt = 'invalid';
    f.binding.evidence.context.policy.maxAgeMs = -1;
    f.binding.evidence.calendar.sha256 = '0'.repeat(64);
    const checks = inspectConstructedByteReview(f.original, f.binding, f.candidate);
    for (const id of [
      'C02_PAGE_BYTES', 'C06_RECEIPT', 'C08_CALENDAR', 'C10_CONTEXT_POLICY',
    ] as const) expect(result(checks, id).result).toBe('fail');
    expect(result(checks, 'C16_IMMUTABILITY').result).toBe('pass');
    expect(result(checks, 'C04_ROWS_DECIMALS')).toMatchObject({
      result: 'unknown', reason: 'evaluation_incomplete',
    });
  });

  it('leaves an unclassified envelope defect unknown', async () => {
    const f = await fixture();
    const binding = { ...f.binding, unexpected: true };
    const checks = inspectConstructedByteReview(f.original, binding, f.candidate);
    expect(result(checks, 'C16_IMMUTABILITY').result).toBe('pass');
    expect(checks.some(check => check.result === 'fail')).toBe(false);
    expect(result(checks, 'C02_PAGE_BYTES')).toMatchObject({
      result: 'unknown', reason: 'evaluation_incomplete',
    });
    expect(result(checks, 'C14_HANDLING')).toMatchObject({
      result: 'unknown', reason: 'evidence_missing',
    });
  });

  it('reports incomplete bounded graph inspection without claiming mutation', async () => {
    const f = await fixture();
    const binding = copy(f.binding) as unknown as { pages: unknown[] };
    binding.pages = Array.from({ length: 254 }, () => null);
    const checks = inspectConstructedByteReview(f.original, binding, f.candidate);
    expect(result(checks, 'C16_IMMUTABILITY')).toMatchObject({
      result: 'unknown', reason: 'evaluation_incomplete',
    });
    expect(checks.some(check => check.result === 'fail')).toBe(false);
  });

  it('still rejects positively observed unsupported construction', async () => {
    const f = await fixture();
    const candidate = copy(f.candidate) as unknown as { input: unknown };
    candidate.input = new Date(0);
    const checks = inspectConstructedByteReview(f.original, f.binding, candidate);
    expect(result(checks, 'C16_IMMUTABILITY')).toMatchObject({
      result: 'fail', reason: 'mutation_detected',
    });
    expect(result(checks, 'C11_CANDIDATE')).toMatchObject({
      result: 'unknown', reason: 'evaluation_incomplete',
    });
  });

  it('does not execute an accessor even when a preceding scalar is invalid', async () => {
    const f = await fixture();
    f.binding.evidence.context.policy.maxAgeMs = NaN;
    let calls = 0;
    Object.defineProperty(f.candidate, 'input', {
      enumerable: true,
      get() { calls++; throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
    });
    const checks = inspectConstructedByteReview(f.original, f.binding, f.candidate);
    expect(result(checks, 'C16_IMMUTABILITY').result).toBe('fail');
    expect(calls).toBe(0);
    expect(JSON.stringify(checks)).not.toContain('SYNTHETIC_PRIVATE_FRAGMENT');
  });

  it('still rejects an accessor installed after reservation without executing it', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    let calls = 0;
    Object.defineProperty(f.binding.evidence.context, 'policy', {
      enumerable: true,
      get() { calls++; return {}; },
    });
    expect(f.lane.accept(completion)).toMatchObject({
      accepted: false, reason: 'provenance_mismatch', uncertainty: 'latched',
    });
    expect(calls).toBe(0);
  });
});

describe('independent page-token inspection without an issuance claim', () => {
  it('accepts the exact decimal tokens, not reconstructed binary64 price strings', () => {
    const page = rawPage(profile.pageBodies[0]);
    expect(inspectByteReviewPage(page, 'BRCFIX', 2)).toEqual({
      bytes: 'pass', rows: 'pass',
    });
    expect(profile.pageBodies[0]).toContain('"c":123.450');
  });

  it.each([
    ['exponent', (body: string) => body.replace('"c":123.450', '"c":1.23450e2')],
    ['negative-zero', (body: string) => body.replace('"v":10', '"v":-0')],
    ['fractional-count', (body: string) => body.replace('"n":1', '"n":1.0')],
    ['ohlc', (body: string) => body.replace('"h":124.00', '"h":100.00')],
    ['duplicate-key', (body: string) => body.replace('"v":10', '"v":10,"v":10')],
    ['extra-root', (body: string) => body.replace('{"bars":', '{"extra":0,"bars":')],
    ['bad-cursor', (body: string) => body.replace('SYNTHETIC_NEXT', 'SYNTHETIC NEXT')],
  ])('rejects %s with matching replacement length/digest metadata', (_name, mutate) => {
    const page = rawPage(mutate(profile.pageBodies[0]));
    expect(inspectByteReviewPage(page, 'BRCFIX', 2)).toEqual({
      bytes: 'pass', rows: 'fail',
    });
  });

  it('rejects canonical-base64 and digest defects separately from row validity', () => {
    const page = rawPage(profile.pageBodies[0]);
    expect(inspectByteReviewPage({ ...page, bodyBase64: page.bodyBase64 + '\n' }, 'BRCFIX', 2))
      .toEqual({ bytes: 'fail', rows: 'fail' });
    expect(inspectByteReviewPage({ ...page, sha256: 'b'.repeat(64) }, 'BRCFIX', 2))
      .toEqual({ bytes: 'fail', rows: 'fail' });
  });

  it('rejects stale original observation reconstruction at the issuance boundary', async () => {
    const f = await fixture();
    const clone = copy(f.original);
    clone.observations[0].close.value = '123.45';
    clone.observations[0].close.precision = 5;
    clone.observations[0].close.scale = 2;
    expect(result(inspectConstructedByteReview(
      clone, f.binding, f.candidate,
    ), 'C01_ISSUANCE').result).toBe('fail');
    expect(isConnectorIssuedAlpacaAcquisition(clone)).toBe(false);
  });
});

describe('private fixed producer/completion linkage, constructed only', () => {
  it('reserves before producing and accepts an authentic incomplete vector only in fixture scope', async () => {
    const f = await fixture();
    const invocation = f.lane.reserve(f.original, f.binding, f.candidate);
    expect(invocation.attemptId).toBe(f.lane.attemptId);
    expect(invocation.invocationId).toBe(f.lane.invocationId);
    expect(invocation.deadlineAt).toBe('2024-01-04T00:01:00.000Z');
    f.lane.advanceFixtureElapsedTo(1);
    const completion = f.lane.produce();
    expect(Reflect.ownKeys(completion)).toEqual([]);
    const accepted = f.lane.accept(completion);
    expect(accepted).toMatchObject({
      scope: 'constructed_only',
      accepted: true,
      reason: 'none',
      uncertainty: 'latched',
    });
    expect(accepted.verdict?.outcome).toBe('incomplete');
    expect(accepted.verdict?.checks).toHaveLength(16);
    expect(result(accepted.verdict!.checks, 'C15_LIFECYCLE').result).toBe('pass');
    expect(parseVerdictStructure(accepted.verdict)).toEqual(accepted.verdict);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('accepts authentic negative consistency separately from completion uncertainty', async () => {
    const f = await fixture();
    f.binding.pages[0].sha256 = 'b'.repeat(64);
    f.lane.reserve(f.original, f.binding, f.candidate);
    const accepted = f.lane.accept(f.lane.produce());
    expect(accepted.accepted).toBe(true);
    expect(accepted.verdict?.outcome).toBe('rejected');
    expect(result(accepted.verdict!.checks, 'C02_PAGE_BYTES').result).toBe('fail');
    expect(result(accepted.verdict!.checks, 'C14_HANDLING').result).toBe('unknown');
    expect(accepted.uncertainty).toBe('latched');
  });

  it('rejects a cloned original without establishing a new invocation', async () => {
    const f = await fixture();
    expect(() => f.lane.reserve(copy(f.original), f.binding, f.candidate))
      .toThrow('Byte review unavailable');
    expect(f.lane.current().accepted).toBe(false);
    expect(f.lane.current().uncertainty).toBe('latched');
    expect(() => f.lane.produce()).toThrow('Byte review unavailable');
  });

  it('rejects fabricated IDs, verdict-shaped objects and registry self-admission', async () => {
    const f = await fixture();
    const invocation = f.lane.reserve(f.original, f.binding, f.candidate);
    f.lane.produce();
    const forged = {
      ...invocation,
      schema: 'gelt.review-before-discard-verdict.v1',
      authorityId: profile.authorityId,
      checks: checkIds.map(id => ({ id, result: 'pass', reason: 'none' })),
      outcome: 'consistent_unverified',
    };
    expect(f.lane.accept(forged)).toMatchObject({
      accepted: false, reason: 'authenticity_failed', uncertainty: 'latched', verdict: null,
    });
    const constructor = createConstructedByteReviewLane as unknown as
      (input: unknown) => unknown;
    expect(() => constructor({
      authorityId: profile.authorityId,
      handlingSha256: evidenceHash,
      reviewer: () => forged,
    })).toThrow('Byte review unavailable');
    expect(productionByteReviewAvailability().available).toBe(false);
  });

  it('rejects cross-invocation completion tickets', async () => {
    const f = await fixture();
    const g = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    g.lane.reserve(g.original, g.binding, g.candidate);
    const first = f.lane.produce();
    const second = g.lane.produce();
    expect(f.lane.accept(second).reason).toBe('authenticity_failed');
    expect(g.lane.accept(first).reason).toBe('authenticity_failed');
  });

  it('consumes a forged first submission and permits no later completion retry', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    expect(f.lane.accept(Object.freeze({})).accepted).toBe(false);
    expect(f.lane.accept(completion)).toMatchObject({
      accepted: false, uncertainty: 'latched', verdict: null,
    });
  });

  it('invalidates current acceptance on duplicate completion without another review', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    const historical = f.lane.accept(completion);
    expect(historical.accepted).toBe(true);
    expect(f.lane.accept(completion)).toMatchObject({
      accepted: false, reason: 'duplicate_completion', uncertainty: 'latched',
    });
    expect(f.lane.current().accepted).toBe(false);
    expect(historical.verdict?.outcome).toBe('incomplete');
    expect(Object.isFrozen(historical.verdict)).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects producer replay and reuse of the same connector original', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    f.lane.produce();
    expect(f.lane.accept(completion).accepted).toBe(false);

    const other = createConstructedByteReviewLane();
    const rebound = copy(f.binding);
    rebound.attemptId = other.attemptId;
    expect(() => other.reserve(f.original, rebound, f.candidate))
      .toThrow('Byte review unavailable');
  });

  it('rechecks ordinary mutation synchronously at acceptance', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    f.binding.evidence.context.rightsEvidenceSha256 = 'b'.repeat(64);
    expect(f.lane.accept(completion)).toMatchObject({
      accepted: false, reason: 'provenance_mismatch', uncertainty: 'latched',
    });
  });

  it('detects replacement by an equal-looking candidate subtree', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    f.candidate.input = copy(f.candidate.input);
    expect(f.lane.accept(completion).reason).toBe('provenance_mismatch');
  });

  it.each(['cancelled', 'late', 'clock', 'uncertain'] as const)(
    'rejects %s completion and never manufactures settlement',
    async kind => {
      const f = await fixture();
      f.lane.reserve(f.original, f.binding, f.candidate);
      const completion = f.lane.produce();
      if (kind === 'cancelled') f.lane.markCancelled();
      if (kind === 'late') f.lane.advanceFixtureElapsedTo(60000);
      if (kind === 'clock') f.lane.markFixtureClockUnavailable();
      if (kind === 'uncertain') f.lane.markPriorUncertainty();
      const accepted = f.lane.accept(completion);
      expect(accepted.accepted).toBe(false);
      expect(accepted.uncertainty).toBe('latched');
      expect(accepted.verdict).toBe(null);
      expect(Object.keys(accepted).sort()).toEqual([
        'scope', 'accepted', 'reason', 'uncertainty', 'verdict',
      ].sort());
    },
  );

  it('accepts completion at 59999ms but rejects the exact 60000ms boundary', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    f.lane.advanceFixtureElapsedTo(59999);
    expect(f.lane.accept(f.lane.produce()).accepted).toBe(true);
    f.lane.advanceFixtureElapsedTo(60000);
    expect(f.lane.current().accepted).toBe(false);

    const g = await fixture();
    g.lane.reserve(g.original, g.binding, g.candidate);
    g.lane.advanceFixtureElapsedTo(60000);
    expect(g.lane.accept(g.lane.produce()).accepted).toBe(false);
  });

  it('does not admit arbitrary data through a fixture label', async () => {
    const f = await fixture();
    const wrongReceipt = copy(f.original);
    wrongReceipt.receivedAt = '2024-01-04T00:00:00.001Z';
    expect(() => f.lane.reserve(wrongReceipt, f.binding, f.candidate))
      .toThrow('Byte review unavailable');
    expect(productionByteReviewAvailability().available).toBe(false);
  });

  it('returns no raw page, cursor, candidate input or transport credential material', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const accepted = f.lane.accept(f.lane.produce());
    const text = JSON.stringify(accepted);
    for (const forbidden of [
      profile.pageBodies[0],
      f.original.pages[0].bodyBase64,
      'SYNTHETIC_NEXT',
      '"c":123.450',
      f.binding.evidence.candidateCanonicalInput,
      syntheticPair.keyId,
      syntheticPair.secretKey,
      'bodyBase64',
      'candidateManifest',
    ]) expect(text).not.toContain(forbidden);
  });

  it('can drop this closure’s payload references without asserting disposal or settlement', async () => {
    const f = await fixture();
    f.lane.reserve(f.original, f.binding, f.candidate);
    const completion = f.lane.produce();
    f.lane.discardPayloadReferences();
    expect(f.lane.current()).toMatchObject({
      accepted: false, uncertainty: 'latched', verdict: null,
    });
    expect(f.lane.accept(completion).accepted).toBe(false);
    expect(JSON.stringify(f.lane.current())).not.toContain('references_released');
  });
});
