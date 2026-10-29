import { afterEach, expect, it, vi } from 'vitest';
import { acquireAlpacaIexDailyBars } from './alpaca-iex-connector.js';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import { connectorPin, snapshotCommit, reviewAuthority, reviewLimits, checkIds } from './alpaca-byte-review-contract.js';
import { spy253ReviewRevisions, type Spy253ReviewBindingV1 } from './alpaca-spy253-review-profile.js';
import { createSpy253PAMRInspection, type Spy253PAMRInspectionResult } from './spy253-pamr-inspection.js';
import { canonical } from './ledger-canonical.js';
import { parsePAMRRequest, pamrRequestLimit, spy253PAMRInspectionLimit } from './paper-conversion-contract.js';
import { derivePAMRConsumerPrefix } from './pamr-consumer-adapter.js';
import * as math from './pamr-reference-artifact.js';

const at = '2026-10-28T13:00:00.000Z', syntheticHash = 'a'.repeat(64);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const holidays = new Set(['2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07']);
const defaultPrices = () => [...Array(188).fill('16'), '8', '1', '1.5', '3', ...Array(61).fill('1.5')] as string[];
async function fixture(attemptId: string, prices = defaultPrices(), stamp?: (s: string, i: number) => string) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(at));
  const sessions = [];
  for (let epoch = Date.parse('2025-10-24T00:00:00.000Z'); epoch <= Date.parse('2026-10-27T00:00:00.000Z'); epoch += 86400000) {
    const date = new Date(epoch).toISOString().slice(0, 10), day = new Date(epoch).getUTCDay();
    if (day === 0 || day === 6 || holidays.has(date)) continue;
    const daylight = date < '2025-11-02' || date >= '2026-03-08', early = date === '2025-11-28' || date === '2025-12-24';
    const closedAt = date + (early ? 'T18:00:00.000Z' : daylight ? 'T20:00:00.000Z' : 'T21:00:00.000Z');
    sessions.push({ providerTimestamp: date + (daylight ? 'T04:00:00.000Z' : 'T05:00:00.000Z'), sessionOrdinal: sessions.length + 1,
      closedAt, completedAt: new Date(Date.parse(closedAt) + 60000).toISOString(), completed: true as const, completionEvidenceSha256: syntheticHash });
  }
  expect(sessions).toHaveLength(253); expect(prices).toHaveLength(253);
  const calendar = { symbol: 'SPY', sessions, sha256: alpacaSessionCalendarDigest({ symbol: 'SPY', sessions }) };
  const descending = sessions.map((s, i) => ({ timestamp: stamp?.(s.providerTimestamp, i) ?? s.providerTimestamp, price: prices[i] })).reverse();
  let offset = 0, page = 0;
  const fetcher = vi.fn(async () => {
    const rows = descending.slice(offset, offset + Math.min(100, 253 - offset)).map(s =>
      `{"t":"${s.timestamp}","o":${s.price},"h":${s.price},"l":${s.price},"c":${s.price},"v":10,"n":1,"vw":${s.price}}`);
    offset += rows.length; page++;
    return new Response(`{"bars":{"SPY":[${rows.join(',')}]},"next_page_token":${offset === 253 ? 'null' : JSON.stringify('SYNTHETIC_INSPECTION_' + page)}}`,
      { headers: { 'content-type': 'application/json' } });
  });
  const original = await acquireAlpacaIexDailyBars({ enabled: true, symbol: 'SPY', feed: 'iex', adjustment: 'all',
    start: sessions[0].providerTimestamp, end: sessions[252].providerTimestamp, asof: '2026-10-27', calendar },
  { keyId: 'SYNTHETIC_INSPECTION_KEY_123456', secretKey: 'SYNTHETIC_INSPECTION_SECRET_12345678901234567890' }, { fetcher: fetcher as typeof fetch });
  const binding: Spy253ReviewBindingV1 = copy({
    schema: 'gelt.spy253-review-binding.v1', attemptId, revisions: spy253ReviewRevisions,
    source: { repositoryId: 1415613140, snapshotCommit, connectorPin, runtimeClosureRevision: 'spy253.runtime.unadmitted.v1' },
    request: original.request, receipt: { receivedAt: original.receivedAt, decisionAt: at },
    pages: original.pages.map(({ page, byteLength, sha256 }) => ({ page, byteLength, sha256 })),
    evidence: { revision: 'SPY253-DOCS-V4', calendar, availability: sessions.map(s => ({ providerTimestamp: s.providerTimestamp, availableAt: at, evidenceSha256: syntheticHash })),
      context: null, completion: 'unknown', closeCompatibility: 'unknown', adjustedPagination: 'unknown', providerRevisions: null, candidate: null },
    limits: reviewLimits, authority: reviewAuthority,
  });
  return { original, binding, sessions, fetcher };
}
function computed(result: Spy253PAMRInspectionResult) {
  expect(result.status).toBe('computed');
  if (result.status !== 'computed') throw new Error('fixture inspection rejected');
  return result.artifact;
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('inspects 253 closes and maps exactly the newest65 to64 chronological pairs with independent exact oracles', async () => {
  const adapter = createSpy253PAMRInspection(), f = await fixture(adapter.attemptId);
  const a = computed(adapter.inspect(f.original, f.binding));
  expect(f.fetcher).toHaveBeenCalledTimes(3);
  expect(a.request.selected.map(s => s.sourceIndex)).toEqual(Array.from({ length: 65 }, (_, i) => 64 - i));
  expect(a.request.selected.map(s => s.sessionOrdinal)).toEqual(Array.from({ length: 65 }, (_, i) => 189 + i));
  expect(a.request.selected.map(s => s.providerTimestamp)).toEqual(f.sessions.slice(188).map(s => s.providerTimestamp));
  expect(a.request.rows).toEqual([['0.125', '1'], ['1.5', '1'], ['2', '1'], ['0.5', '1'], ...Array.from({ length: 60 }, () => ['1', '1'])]);
  expect(a.pairs.map(p => [p.earlierSourceIndex, p.laterSourceIndex])).toEqual(Array.from({ length: 64 }, (_, i) => [64 - i, 63 - i]));
  expect(a.steps[0]).toMatchObject({ weightsBefore: ['1/2', '1/2'], loss: '1/16', tau: '8/49', weightsAfter: ['4/7', '3/7'] });
  expect(a.steps.slice(1, 5).map(s => s.weightsAfter)).toEqual([['0/1', '1/1'], ['0/1', '1/1'], ['1/1', '0/1'], ['1/1', '0/1']]);
  // A preceding 16 ->8 interval would first put all strategy weight in risk;
  // the following 8 ->1 interval would retain it. That is not this initialization.
  expect(a.steps[0].weightsAfter).not.toEqual(['1/1', '0/1']);
  expect(a.request.discardedCount).toBe(188); expect(a.steps).toHaveLength(64);
  expect(a.request.lineage.review.checks.map(c => c.id)).toEqual(checkIds);
  expect(a.request.lineage.review.checks.map(c => c.result)).toEqual([...Array(6).fill('pass'), ...Array(9).fill('unknown'), 'pass']);
  expect(a).toMatchObject({ updates: 64, operationalDecisions: 0, consumptionAttempts: 0, actualEligibility: 'not_established',
    actualAvailability: 'unknown', actualCalendarCompletion: 'unknown', handling: 'not_established', uncertainty: 'latched',
    effectScope: 'NONE', dispatchAllowed: false, promotionAllowed: false, production: 'CLOSED', operations: 'DEFER' });
  expect(Buffer.byteLength(canonical(a))).toBeLessThanOrEqual(spy253PAMRInspectionLimit);
  expect(Buffer.byteLength(canonical(a.request))).toBeLessThanOrEqual(pamrRequestLimit);
  expect(math.verifySpy253PAMRInspectionData(canonical(a)).status).toBe('verified_data');
  expect(adapter.current()).toEqual({ status: 'computed', artifact: a });
});
it('binds discarded prices and original decimal spellings without changing selected mathematics', async () => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId), first = computed(a.inspect(f.original, f.binding));
  const prices = defaultPrices(); prices[0] = '32';
  const b = createSpy253PAMRInspection(), g = await fixture(b.attemptId, prices), second = computed(b.inspect(g.original, g.binding));
  expect(second.steps).toEqual(first.steps);
  expect(second.request.lineage.allObservationsSha256).not.toBe(first.request.lineage.allObservationsSha256);
  expect(second.request.lineage.originalSha256).not.toBe(first.request.lineage.originalSha256);
  const c = createSpy253PAMRInspection(), h = await fixture(c.attemptId, defaultPrices().map(p => p.includes('.') ? p + '0' : p + '.0'));
  const third = computed(c.inspect(h.original, h.binding));
  expect(third.request.rows).toEqual(first.request.rows); expect(third.steps).toEqual(first.steps);
  expect(third.request.lineage.originalSha256).not.toBe(first.request.lineage.originalSha256);
});
it.each([['1.5', '1', '1.5'], ['1', '8', '0.125'], ['1.00', '1.0', '1'], ['0.000000000000000001', '1', '0.000000000000000001'],
  ['1', '1000000000000000000000000000000', '0.' + '0'.repeat(29) + '1']])('derives exact %s/%s', (later, earlier, expected) => {
  expect(math.exactSpy253CloseRatio(d(later), d(earlier))).toBe(expected);
});
it.each([['1', '3'], ['0', '1'], ['-1', '1'], ['1e2', '1'], [' 1', '1'], ['1\n', '1'], ['1\r', '1'],
  ['1', '0'], ['1', '0.000000000000000001'], ['100000000000000000000000000000000', '1']])('rejects invalid or unrepresentable ratio %s/%s when outside its exact domain', (later, earlier) => {
  if (later === '1' && earlier === '0.000000000000000001') expect(math.exactSpy253CloseRatio(d(later), d(earlier))).toBe('1000000000000000000');
  else expect(() => math.exactSpy253CloseRatio(d(later), d(earlier))).toThrow();
});
it('rejects a repeating selected ratio without reaching into discarded history', async () => {
  const prices = defaultPrices(); prices[188] = '3'; prices[189] = '1';
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId, prices);
  expect(a.inspect(f.original, f.binding).status).toBe('rejected'); expect(a.current().status).toBe('rejected');
});
it('allows absent availability declarations only as UNKNOWN, but rejects absent calendar mapping', async () => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId); f.binding.evidence.availability = null;
  const value = computed(a.inspect(f.original, f.binding));
  expect(value.request.lineage.declaredPrefixAvailableAt).toBeNull(); expect(value.actualAvailability).toBe('unknown');
  const b = createSpy253PAMRInspection(), g = await fixture(b.attemptId); g.binding.evidence.calendar = null;
  expect(b.inspect(g.original, g.binding).status).toBe('rejected');
});
it.each(['calendar', 'request', 'page', 'revision', 'availability', 'pagination', 'checkpoint'] as const)('rejects a contradictory %s declaration', async field => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId);
  if (field === 'calendar') f.binding.evidence.calendar!.sessions[190].sessionOrdinal++;
  if (field === 'request') f.binding.request.adjustment = 'raw';
  if (field === 'page') f.binding.pages[0].sha256 = 'b'.repeat(64);
  if (field === 'revision') f.binding.evidence.providerRevisions = ['A', 'B', null];
  if (field === 'availability') f.binding.evidence.availability![0].availableAt = '2026-10-29T13:00:00.000Z';
  if (field === 'pagination') f.binding.evidence.adjustedPagination = 'contradicted';
  if (field === 'checkpoint') f.binding.receipt.decisionAt = '2026-10-29T13:00:00.000Z';
  expect(a.inspect(f.original, f.binding).status).toBe('rejected');
});
it('rejects an issued but calendar-incompatible collection and never guesses the missing session', async () => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId, defaultPrices(), (s, i) => i === 190 ? s.replace('T04:', 'T03:') : s);
  expect(a.inspect(f.original, f.binding).status).toBe('rejected');
});
it('rejects clones, reuse and repeated attempts; no completion-acceptance API is exposed', async () => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId);
  expect(a.inspect(copy(f.original), f.binding).status).toBe('rejected');
  const b = createSpy253PAMRInspection(), g = await fixture(b.attemptId); computed(b.inspect(g.original, g.binding));
  expect(b.inspect(g.original, g.binding)).toEqual({ status: 'rejected', reason: 'already_attempted' });
  expect(b.current().status).toBe('rejected');
  const c = createSpy253PAMRInspection(); g.binding.attemptId = c.attemptId;
  expect(c.inspect(g.original, g.binding).status).toBe('rejected');
  expect('acceptCompletion' in c).toBe(false); expect('produce' in c).toBe(false); expect('reserve' in c).toBe(false);
});
it.each(['markCancelled', 'markPriorUncertainty', 'markClockUnavailable'] as const)('rejects %s before inspection', async method => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId); a[method]();
  expect(a.inspect(f.original, f.binding).status).toBe('rejected');
});
it.each(['mutation', 'deadline', 'cancellation', 'uncertainty'] as const)('observes %s after conversion before returning an artifact', async event => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId), replay = math.replaySpy253PAMRInspectionRequest;
  vi.spyOn(math, 'replaySpy253PAMRInspectionRequest').mockImplementationOnce(text => {
    const result = replay(text);
    if (event === 'mutation') f.binding.evidence.completion = 'contradicted';
    if (event === 'deadline') vi.setSystemTime(new Date(Date.parse(at) + 60000));
    if (event === 'cancellation') a.markCancelled();
    if (event === 'uncertainty') a.markPriorUncertainty();
    return result;
  });
  expect(a.inspect(f.original, f.binding).status).toBe('rejected'); expect(a.current().status).toBe('rejected');
});
it('invalidates the retained result on later mutation or deadline and bounds sanitized errors', async () => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId); computed(a.inspect(f.original, f.binding));
  f.binding.evidence.calendar = copy(f.binding.evidence.calendar); expect(a.current().status).toBe('rejected');
  const b = createSpy253PAMRInspection(), g = await fixture(b.attemptId); computed(b.inspect(g.original, g.binding));
  vi.setSystemTime(new Date(Date.parse(at) + 60000)); expect(b.current().status).toBe('rejected');
  const c = createSpy253PAMRInspection(), result = c.inspect({ secret: 'PRIVATE_SENTINEL' }, {});
  expect(canonical(result)).not.toContain('PRIVATE_SENTINEL'); expect(Buffer.byteLength(canonical(result))).toBeLessThan(128);
});
it('rejects altered whole-object data, oversized parsing and every legacy extraction route', async () => {
  const a = createSpy253PAMRInspection(), f = await fixture(a.attemptId), artifact = computed(a.inspect(f.original, f.binding));
  for (const change of [(v: any) => { v.request.selected[0].close.value = '7'; }, (v: any) => { v.pairs[0].laterSourceIndex = 0; },
    (v: any) => { v.request.lineage.review.checks[6].result = 'pass'; }, (v: any) => { v.steps[0].tau = '0/1'; },
    (v: any) => { v.dispatchAllowed = true; }, (v: any) => { v.request.lineage.originalSha256 = syntheticHash; }]) {
    const v = copy(artifact); change(v); expect(math.verifySpy253PAMRInspectionData(canonical(v)).status).toBe('rejected');
  }
  for (const value of [artifact, artifact.request, { ...artifact, classification: 'constructed_offline_test' }]) {
    const text = canonical(value); expect(math.verifyPAMRArtifact(text).status).toBe('rejected');
    expect(() => parsePAMRRequest(text)).toThrow(); expect(() => derivePAMRConsumerPrefix(text)).toThrow();
  }
  expect(canonical(artifact)).not.toContain('gelt.pamr-inert-candidate.v1');
  expect(math.replaySpy253PAMRInspectionRequest(' '.repeat(32769)).status).toBe('rejected');
  expect(math.verifySpy253PAMRInspectionData(' '.repeat(180001)).status).toBe('rejected');
});
