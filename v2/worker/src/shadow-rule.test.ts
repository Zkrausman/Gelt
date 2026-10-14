import { describe, expect, it } from 'vitest';
import { canonical, digest } from './ledger-canonical.js';
import { evaluateShadowRule, matchesShadowRuleReceipt } from './shadow-rule.js';
import { shadowRuleId, shadowRuleMaxBytes, shadowRuleReceiptSchema, type ShadowRuleInput } from './shadow-rule-contract.js';

// Constructed unit inputs only; no market/source/license/cost acceptance claim.
function fixture(): ShadowRuleInput {
  return {
    schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId,
    runId: '00000000-0000-4000-8000-000000000001', sourceCommit: 'a'.repeat(40),
    decisionAt: '2026-10-14T01:00:00.000Z',
    instrument: { id: 'TEST', currency: 'USD', calendarSha256: 'b'.repeat(64) },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: 'c'.repeat(64), rightsEvidenceSha256: 'd'.repeat(64), pointInTimeEvidenceSha256: 'e'.repeat(64) },
    policy: { scheduleSha256: 'f'.repeat(64), maxAgeMs: 86_400_000, exposureCap: { value: '0.25', precision: 3, scale: 2 } },
    costs: { status: 'declared', evidenceSha256: '1'.repeat(64), stressScenarioSha256: '2'.repeat(64), commissionPerTrade: { value: '0.01', precision: 3, scale: 2 }, spreadFraction: { value: '0.001', precision: 4, scale: 3 }, slippageFraction: { value: '0.002', precision: 4, scale: 3 } },
    controls: { passiveSha256: '3'.repeat(64), cashAssumptionSha256: '4'.repeat(64) },
    portfolio: { state: 'settled', snapshotSha256: '5'.repeat(64) },
    bars: Array.from({ length: 253 }, (_, i) => {
      const time = new Date(Date.UTC(2026, 9, 14) - (252 - i) * 86_400_000).toISOString();
      return { sessionOrdinal: i, closedAt: time, availableAt: time, adjustedClose: { value: i === 252 ? '101' : '100', precision: 3, scale: 0 } };
    }),
  };
}
const run = (input: unknown) => evaluateShadowRule(Buffer.from(JSON.stringify(input)));

describe('frozen shadow-rule adaptation (constructed offline cases)', () => {
  it('computes long/cash sign with exact cross-scale prices, no rounding or invented sizing', () => {
    const a = fixture(); a.bars[0].adjustedClose = { value: '9007199254740992.00', precision: 18, scale: 2 };
    a.bars[252].adjustedClose = { value: '9007199254740992.01', precision: 18, scale: 2 };
    const positive = run(a); expect(positive.decision).toBe('target_long'); expect(positive.targetExposure).toEqual(a.policy.exposureCap);
    a.bars[252].adjustedClose = { value: '9007199254740992', precision: 16, scale: 0 };
    expect(run(a).decision).toBe('target_cash');
    a.bars[252].adjustedClose = { value: '9007199254740991.99', precision: 18, scale: 2 };
    expect(run(a).decision).toBe('target_cash');
  });
  it('replays identical semantic inputs deterministically without mutating caller input', () => {
    const a = fixture(), before = structuredClone(a), result = run(a);
    expect(run(a)).toEqual(result); expect(a).toEqual(before);
    const reverseKeys = Object.fromEntries(Object.entries(a).reverse()); expect(run(reverseKeys)).toEqual(result);
    expect(result.inputSha256).toBe(digest(canonical(a))); expect(shadowRuleReceiptSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ classification: 'constructed_offline_test', marketEvaluation: 'not_established', effectAuthority: 'none', promotionAllowed: false });
  });
  it.each(['run', 'source', 'price', 'cost', 'control', 'portfolio', 'calendar', 'rights', 'policy'] as const)('binds changed %s to a distinct decision receipt', field => {
    const a = fixture(), old = run(a);
    if (field === 'run') a.runId = '00000000-0000-4000-8000-000000000002';
    if (field === 'source') a.sourceCommit = 'b'.repeat(40);
    if (field === 'price') a.bars[252].adjustedClose.value = '102';
    if (field === 'cost') a.costs.evidenceSha256 = '6'.repeat(64);
    if (field === 'control') a.controls.passiveSha256 = '6'.repeat(64);
    if (field === 'portfolio') a.portfolio.snapshotSha256 = '6'.repeat(64);
    if (field === 'calendar') a.instrument.calendarSha256 = '6'.repeat(64);
    if (field === 'rights') a.data.rightsEvidenceSha256 = '6'.repeat(64);
    if (field === 'policy') a.policy.scheduleSha256 = '6'.repeat(64);
    expect(run(a).decisionId).not.toBe(old.decisionId); expect(run(a).inputSha256).not.toBe(old.inputSha256);
  });
  it.each(['data', 'costs', 'unknown', 'warmup'] as const)('abstains on %s readiness without implying an effect', reason => {
    const a = fixture();
    if (reason === 'data') a.data.eligibility = 'unverified';
    if (reason === 'costs') a.costs.status = 'unverified';
    if (reason === 'unknown') a.portfolio.state = 'unknown';
    if (reason === 'warmup') a.bars.pop();
    const expected = { data: 'unverified_data', costs: 'unverified_costs', unknown: 'execution_unknown', warmup: 'insufficient_warmup' };
    expect(run(a)).toMatchObject({ decision: 'abstain', reason: expected[reason], targetExposure: null, effectAuthority: 'none' });
  });
  it.each(['futureAvailability', 'earlyAvailability', 'futureClose', 'duplicate', 'gap', 'reorder', 'stale'] as const)('rejects %s chronology before a signal', caseName => {
    const a = fixture();
    if (caseName === 'futureAvailability') a.bars[100].availableAt = '2026-10-15T00:00:00.000Z';
    if (caseName === 'earlyAvailability') a.bars[1].availableAt = a.bars[0].closedAt;
    if (caseName === 'futureClose') a.bars[252].closedAt = a.bars[252].availableAt = '2026-10-15T00:00:00.000Z';
    if (caseName === 'duplicate') a.bars[1] = { ...a.bars[0] };
    if (caseName === 'gap') a.bars[1].sessionOrdinal++;
    if (caseName === 'reorder') [a.bars[0], a.bars[1]] = [a.bars[1], a.bars[0]];
    if (caseName === 'stale') a.policy.maxAgeMs = 1;
    expect(run(a).decision).toBe('abstain'); expect(run(a).targetExposure).toBeNull();
  });
  it('uses inclusive availability/freshness boundaries; later availability and one millisecond older are rejected', () => {
    const a = fixture(); a.decisionAt = a.bars[252].closedAt; a.policy.maxAgeMs = 0;
    expect(run(a).decision).toBe('target_long');
    a.bars[252].availableAt = new Date(Date.parse(a.decisionAt) + 1).toISOString(); expect(run(a).reason).toBe('ineligible_timestamp');
    a.bars[252].availableAt = a.bars[252].closedAt; a.decisionAt = new Date(Date.parse(a.decisionAt) + 1).toISOString(); expect(run(a).reason).toBe('stale_input');
  });
  it.each(['extra', 'missingCosts', 'numberPrice', 'zero', 'negative', 'wrongPrecision', 'overexposure', 'invalidDate', 'wrongRule', 'tooManyBars'] as const)('fails closed on %s schema', caseName => {
    const a: any = fixture();
    if (caseName === 'extra') a.endpoint = 'forbidden';
    if (caseName === 'missingCosts') delete a.costs;
    if (caseName === 'numberPrice') a.bars[0].adjustedClose.value = 100;
    if (caseName === 'zero') a.bars[0].adjustedClose = { value: '0', precision: 1, scale: 0 };
    if (caseName === 'negative') a.bars[0].adjustedClose.value = '-10';
    if (caseName === 'wrongPrecision') a.bars[0].adjustedClose.precision = 1;
    if (caseName === 'overexposure') a.policy.exposureCap = { value: '1.01', precision: 3, scale: 2 };
    if (caseName === 'invalidDate') a.decisionAt = '2026-02-30T00:00:00.000Z';
    if (caseName === 'wrongRule') a.ruleId = 'tuned-lookback';
    if (caseName === 'tooManyBars') a.bars.push(a.bars[252]);
    expect(run(a)).toMatchObject({ decision: 'abstain', reason: 'invalid_input', runId: null, evidence: null });
  });
  it('rejects duplicate keys, malformed UTF8/JSON and oversized inputs without leaking content', () => {
    const a = JSON.stringify(fixture()), duplicate = a.replace('"schema":', '"schema":"duplicate","schema":');
    for (const bytes of [Buffer.from(duplicate), Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(shadowRuleMaxBytes + 1)]) {
      const r = evaluateShadowRule(bytes); expect(r.decision).toBe('abstain'); expect(r.reason).toBe('invalid_input');
      expect(JSON.stringify(r)).not.toContain('duplicate'); expect(r.runId).toBeNull();
    }
    expect(evaluateShadowRule(Buffer.alloc(shadowRuleMaxBytes + 1)).inputDigestKind).toBe('unbound');
  });
  it('does not promote declared provenance into market acceptance or order authority', () => {
    const a = fixture(); a.data.classification = 'market_shadow_input';
    expect(run(a)).toMatchObject({ decision: 'target_long', sourceAndProvenance: 'caller_assertions_not_independently_verified', marketEvaluation: 'not_established', effectAuthority: 'none', promotionAllowed: false });
  });
  it('replays exact receipt linkage and refuses changed inputs, targets, IDs or authority', () => {
    const a = fixture(), bytes = Buffer.from(JSON.stringify(a)), r = evaluateShadowRule(bytes);
    expect(matchesShadowRuleReceipt(bytes, r)).toBe(true);
    a.bars[252].adjustedClose.value = '102'; expect(matchesShadowRuleReceipt(Buffer.from(JSON.stringify(a)), r)).toBe(false);
    for (const changed of [{ ...r, decisionId: `shadow-decision-${'0'.repeat(64)}` }, { ...r, targetExposure: { value: '0.50', precision: 3, scale: 2 } }, { ...r, runId: '00000000-0000-4000-8000-000000000002' }, { ...r, effectAuthority: 'submit' }]) {
      expect(matchesShadowRuleReceipt(bytes, changed)).toBe(false);
    }
    const invalid = evaluateShadowRule(Buffer.from('{')); expect(matchesShadowRuleReceipt(Buffer.from('{'), invalid)).toBe(false);
  });
  it.each([
    { value: 'not-a-decimal', precision: 13, scale: 0 },
    { value: '1', precision: 1, scale: 1_000_000_000 },
    { value: '1', precision: 1, scale: -1 },
    { value: '1', precision: 1, scale: 0.5 },
  ])('rejects malformed fraction %j before bounded arithmetic in input and receipt', bad => {
    const original = fixture(), bytes = Buffer.from(JSON.stringify(original)), receipt = evaluateShadowRule(bytes);
    for (const field of ['exposure', 'spread', 'slippage']) {
      const a: any = fixture();
      if (field === 'exposure') a.policy.exposureCap = bad;
      if (field === 'spread') a.costs.spreadFraction = bad;
      if (field === 'slippage') a.costs.slippageFraction = bad;
      expect(run(a)).toMatchObject({ decision: 'abstain', reason: 'invalid_input' });
    }
    expect(() => matchesShadowRuleReceipt(bytes, { ...receipt, targetExposure: bad })).not.toThrow();
    expect(matchesShadowRuleReceipt(bytes, { ...receipt, targetExposure: bad })).toBe(false);
  });
});
