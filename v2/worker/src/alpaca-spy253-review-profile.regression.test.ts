import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireAlpacaIexDailyBars } from './alpaca-iex-connector.js';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import {
  connectorPin, snapshotCommit, reviewAuthority, reviewLimits,
  type CheckId, type ReviewChecksV1,
} from './alpaca-byte-review-contract.js';
import {
  createSpy253ByteReviewLane, inspectSpy253Review, spy253ReviewRevisions,
  type Spy253ReviewBindingV1,
} from './alpaca-spy253-review-profile.js';
import { createSpy253OriginalProcessReviewAdapter } from './alpaca-original-process-review-adapter.js';

// Independently selected behavioral oracles from SPY253-001/002/003/013/015/
// 018/019/024/027/037/039/041/043. These are synthetic source tests only.
const decisionAt = '2026-10-28T13:00:00.000Z';
const syntheticHash = 'a'.repeat(64);
const credentials = {
  keyId: 'SYNTHETIC_REGRESSION_KEY_123456',
  secretKey: 'SYNTHETIC_REGRESSION_SECRET_12345678901234567890',
};
const holidays = new Set([
  '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16',
  '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
]);

async function originalAndBinding(
  attemptId: string,
  price = '12345678901234567890.123456789012345678',
  sizes = [99, 100, 54],
) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(decisionAt));
  const sessions = [];
  for (let epoch = Date.parse('2025-10-24T00:00:00.000Z');
    epoch <= Date.parse('2026-10-27T00:00:00.000Z'); epoch += 86_400_000) {
    const date = new Date(epoch).toISOString().slice(0, 10);
    const weekday = new Date(epoch).getUTCDay();
    if (weekday === 0 || weekday === 6 || holidays.has(date)) continue;
    const daylight = date < '2025-11-02' || date >= '2026-03-08';
    const early = date === '2025-11-28' || date === '2025-12-24';
    const closedAt = date + (early ? 'T18:00:00.000Z'
      : daylight ? 'T20:00:00.000Z' : 'T21:00:00.000Z');
    sessions.push({
      providerTimestamp: date + (daylight ? 'T04:00:00.000Z' : 'T05:00:00.000Z'),
      sessionOrdinal: sessions.length + 1, closedAt,
      // Required by the pre-existing transport schema, as explicit synthetic
      // declarations. They are never actual completion/admission evidence.
      completedAt: new Date(Date.parse(closedAt) + 60_000).toISOString(),
      completed: true as const, completionEvidenceSha256: syntheticHash,
    });
  }
  if (sessions.length !== 253) throw new Error('Synthetic fixture count mismatch');
  const calendar = {
    symbol: 'SPY', sessions,
    sha256: alpacaSessionCalendarDigest({ symbol: 'SPY', sessions }),
  };
  const descending = [...sessions].reverse();
  let offset = 0;
  let page = 0;
  const fetcher = vi.fn(async () => {
    const rows = descending.slice(offset, offset + sizes[page]).map(session =>
      `{"t":"${session.providerTimestamp}","o":${price},"h":${price},"l":${price},"c":${price},"v":10,"n":1,"vw":${price}}`);
    offset += rows.length;
    page++;
    return new Response(`{"bars":{"SPY":[${rows.join(',')}]},"next_page_token":${
      offset === 253 ? 'null' : JSON.stringify('SYNTHETIC_PART_' + page)}}`, {
      headers: { 'content-type': 'application/json' },
    });
  });
  const original = await acquireAlpacaIexDailyBars({
    enabled: true, symbol: 'SPY', feed: 'iex', adjustment: 'all',
    start: sessions[0].providerTimestamp, end: sessions[252].providerTimestamp,
    asof: '2026-10-27', calendar,
  }, credentials, { fetcher: fetcher as typeof fetch });
  const binding: Spy253ReviewBindingV1 = JSON.parse(JSON.stringify({
    schema: 'gelt.spy253-review-binding.v1', attemptId,
    revisions: spy253ReviewRevisions,
    source: { repositoryId: 1415613140, snapshotCommit, connectorPin,
      runtimeClosureRevision: 'spy253.runtime.unadmitted.v1' },
    request: original.request, receipt: { receivedAt: original.receivedAt, decisionAt },
    pages: original.pages.map(({ page, byteLength, sha256 }) => ({ page, byteLength, sha256 })),
    evidence: {
      revision: 'SPY253-DOCS-V4', calendar,
      availability: sessions.map(session => ({ providerTimestamp: session.providerTimestamp,
        availableAt: decisionAt, evidenceSha256: syntheticHash })),
      context: null, completion: 'unknown', closeCompatibility: 'unknown',
      adjustedPagination: 'unknown', providerRevisions: null, candidate: null,
    }, limits: reviewLimits, authority: reviewAuthority,
  }));
  return { original, binding, fetcher };
}

function state(checks: ReviewChecksV1, id: CheckId) {
  return checks.find(check => check.id === id)!;
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('independent SPY253 source regression oracles', () => {
  it('preserves a 38-digit decimal token across a different valid page partition', async () => {
    const lane = createSpy253ByteReviewLane();
    const f = await originalAndBinding(lane.attemptId);
    expect(f.original.observations[0].close).toEqual({
      value: '12345678901234567890.123456789012345678', precision: 38, scale: 18,
    });
    const checks = inspectSpy253Review(f.original, f.binding);
    for (const id of ['C01_ISSUANCE', 'C02_PAGE_BYTES', 'C03_REQUEST_CURSOR',
      'C04_ROWS_DECIMALS', 'C05_OBSERVATIONS'] as const) {
      expect(state(checks, id).result).toBe('pass');
    }
    for (const id of ['C07_CLOSURE_REVISIONS', 'C13_REVIEWER_ADMISSION', 'C14_HANDLING'] as const) {
      expect(state(checks, id).result).toBe('unknown');
    }
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects an explicitly wrong checkpoint even when context evidence is absent', async () => {
    const lane = createSpy253ByteReviewLane();
    const f = await originalAndBinding(lane.attemptId);
    f.binding.receipt.decisionAt = '2026-10-29T13:00:00.000Z';
    expect(f.binding.evidence.context).toBeNull();
    const checks = inspectSpy253Review(f.original, f.binding);
    expect(state(checks, 'C10_CONTEXT_POLICY').result).toBe('fail');
    expect(state(checks, 'C16_IMMUTABILITY').result).toBe('pass');
  });

  it('rejects altered calendar contents retaining the old declared digest', async () => {
    const lane = createSpy253ByteReviewLane();
    const f = await originalAndBinding(lane.attemptId);
    f.binding.evidence.calendar!.sessions[0].completionEvidenceSha256 = 'b'.repeat(64);
    const checks = inspectSpy253Review(f.original, f.binding);
    expect(state(checks, 'C08_CALENDAR').result).toBe('fail');
    expect(state(checks, 'C16_IMMUTABILITY').result).toBe('pass');
  });

  it('distinguishes exact observed bytes from equal numerical price values', async () => {
    const lane = createSpy253ByteReviewLane();
    const a = await originalAndBinding(lane.attemptId, '25.0');
    const b = await originalAndBinding(lane.attemptId, '25.00');
    expect(a.original.pages[0].sha256).not.toBe(b.original.pages[0].sha256);
    a.binding.pages = b.binding.pages;
    expect(state(inspectSpy253Review(a.original, a.binding), 'C02_PAGE_BYTES').result).toBe('fail');
  });

  it('does not traverse an unissued original containing a payload getter', () => {
    let calls = 0;
    const original = Object.defineProperty({}, 'pages', {
      enumerable: true, get() { calls++; throw new Error('SYNTHETIC_PRIVATE_MARKER'); },
    });
    expect(state(inspectSpy253Review(original, null), 'C01_ISSUANCE').result).toBe('fail');
    expect(calls).toBe(0);
  });

  it('keeps identical caller revision declarations unadmitted', async () => {
    const lane = createSpy253ByteReviewLane();
    const f = await originalAndBinding(lane.attemptId);
    f.binding.evidence.providerRevisions = ['CLAIMED_V1', 'CLAIMED_V1', 'CLAIMED_V1'];
    const checks = inspectSpy253Review(f.original, f.binding);
    expect(state(checks, 'C09_AVAILABILITY').result).toBe('unknown');
    expect(state(checks, 'C07_CLOSURE_REVISIONS').result).toBe('unknown');
    lane.reserve(f.original, f.binding, null);
    expect(lane.accept(lane.produce())).toMatchObject({
      accepted: true, verdict: { outcome: 'incomplete' },
    });
  });

  it('preserves emission and own ack while detecting a later binding mutation', async () => {
    const adapter = createSpy253OriginalProcessReviewAdapter();
    const f = await originalAndBinding(adapter.attemptId);
    const handle = adapter.reserve(f.original, f.binding)!;
    adapter.acceptCompletion(handle, adapter.completeReview(handle));
    const emitted = adapter.emitSummary()!;
    const ack = adapter.recipientComplete()!;
    expect(adapter.acknowledge(ack)).not.toBeNull();
    const before = adapter.snapshot();
    f.binding.evidence.completion = 'contradicted';
    const after = adapter.snapshot();
    expect(after.emitted).toBe(emitted);
    expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
    expect(after.current).toMatchObject({
      outcome: 'provenance_mismatch', review: 'unknown', summaryDelivery: 'acknowledged',
      execution: 'unknown', disposal: 'not_established',
    });
    expect(adapter.emitSummary()).toBeNull();
  });

  it('rejects an observed local backwards clock without asserting settlement', async () => {
    const lane = createSpy253ByteReviewLane();
    const f = await originalAndBinding(lane.attemptId);
    lane.reserve(f.original, f.binding, null);
    const ticket = lane.produce();
    vi.setSystemTime(new Date(Date.parse(decisionAt) - 1));
    expect(lane.accept(ticket)).toMatchObject({ accepted: false, reason: 'timing_unknown' });
  });

  it('rejects effect authority instead of promoting an unknown source review', async () => {
    const lane = createSpy253ByteReviewLane();
    const f = await originalAndBinding(lane.attemptId);
    const binding = { ...f.binding, authority: { ...f.binding.authority, effectAuthority: 'orders' } };
    expect(state(inspectSpy253Review(f.original, binding), 'C12_AUTHORITY_FENCES').result).toBe('fail');
  });

  it.each([
    [false, 'mutation'], [true, 'mutation'], [false, 'deadline'], [true, 'deadline'],
    [false, 'clock-then-mutation'], [true, 'clock-then-mutation'],
  ] as const)('retains later adverse facts after cancellation (ack=%s, %s)', async (acked, adverse) => {
    const adapter = createSpy253OriginalProcessReviewAdapter();
    const f = await originalAndBinding(adapter.attemptId);
    const handle = adapter.reserve(f.original, f.binding)!;
    expect(adapter.acceptCompletion(handle, adapter.completeReview(handle)).accepted).toBe(true);
    const emitted = acked ? adapter.emitSummary()! : null;
    if (acked) expect(adapter.acknowledge(adapter.recipientComplete())).not.toBeNull();
    adapter.queueCancellation();
    const before = adapter.snapshot();
    expect(before.current.outcome).toBe('cancelled');
    if (adverse === 'deadline') vi.setSystemTime(new Date(Date.parse(decisionAt) + 60000));
    else {
      if (adverse === 'clock-then-mutation') adapter.markClockUnavailable();
      f.binding.evidence.completion = 'contradicted';
    }
    const after = adapter.snapshot();
    const expected = adverse === 'deadline' ? 'timed_out' : 'provenance_mismatch';
    expect(after.current).toMatchObject({ outcome: expected, review: 'unknown',
      summaryDelivery: acked ? 'acknowledged' : 'not_attempted',
      execution: 'unknown', disposal: 'not_established' });
    expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
    expect(after.receipts.some(r => r.kind === 'cancelled')).toBe(true);
    expect(after.receipts.some(r => r.kind === expected)).toBe(true);
    if (adverse === 'clock-then-mutation') expect(after.receipts.some(r => r.kind === 'order_unavailable')).toBe(true);
    expect(after.emitted).toBe(emitted);
    expect(adapter.snapshot().receipts).toEqual(after.receipts);
    if (acked) expect(adapter.emitSummary()).toBeNull();
    else expect(adapter.emitSummary()!.status.outcome).toBe(expected);
  });

  it.each([[false, 'mutation'], [true, 'mutation'], [false, 'deadline'], [true, 'deadline']] as const)(
    'records final adverse facts before dropping references (ack=%s, %s)', async (acked, adverse) => {
      const adapter = createSpy253OriginalProcessReviewAdapter();
      const f = await originalAndBinding(adapter.attemptId);
      const handle = adapter.reserve(f.original, f.binding)!;
      expect(adapter.acceptCompletion(handle, adapter.completeReview(handle)).accepted).toBe(true);
      const emitted = acked ? adapter.emitSummary()! : null;
      if (acked) expect(adapter.acknowledge(adapter.recipientComplete())).not.toBeNull();
      const before = adapter.snapshot();
      if (adverse === 'mutation') f.binding.evidence.completion = 'contradicted';
      else vi.setSystemTime(new Date(Date.parse(decisionAt) + 60000));
      expect(adapter.dropLocalCheckerReferences()).toBe(true);
      const after = adapter.snapshot();
      const expected = adverse === 'mutation' ? 'provenance_mismatch' : 'timed_out';
      expect(after.current).toMatchObject({ outcome: expected, review: 'unknown',
        summaryDelivery: acked ? 'acknowledged' : 'not_attempted',
        execution: 'unknown', disposal: 'not_established' });
      expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
      const adverseIndex = after.receipts.findIndex(r => r.kind === expected);
      expect(adverseIndex).toBeGreaterThanOrEqual(0);
      expect(adverseIndex).toBeLessThan(after.receipts.findIndex(r => r.kind === 'local_checker_references_dropped'));
      expect(after.emitted).toBe(emitted);
      expect(adapter.dropLocalCheckerReferences()).toBe(false);
      if (acked) expect(adapter.emitSummary()).toBeNull();
      else expect(adapter.emitSummary()!.status.outcome).toBe(expected);
    });

  it('shares the existing source-inspection allocation ceiling across both profiles', async () => {
    vi.resetModules();
    const legacy = await import('./alpaca-byte-review-checker.js');
    const spy = await import('./alpaca-spy253-review-profile.js');
    for (let i = 0; i < 128; i++) {
      legacy.createConstructedByteReviewLane();
      spy.createSpy253ByteReviewLane();
    }
    expect(() => legacy.createConstructedByteReviewLane()).toThrow();
    expect(() => spy.createSpy253ByteReviewLane()).toThrow();
  });
});
