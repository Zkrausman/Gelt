import { describe, expect, it } from 'vitest';
import { canonical, digest } from './ledger-canonical.js';
import { shadowRuleId, shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { simulationDigest, snapshot } from './synthetic-simulation-economics.js';
import { proposeShadowSizing, matchesShadowSizingProposal } from './shadow-sizing.js';
import { shadowSizingPolicyId, shadowSizingInputSchema, shadowSizingProposalSchema, type ShadowSizingInput } from './shadow-sizing-contract.js';

// Explicitly constructed offline data/portfolio/policy values, never market proof.
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const epoch = Date.parse('2026-10-14T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();
function fixture(): ShadowSizingInput {
  const config: ShadowSizingInput['config'] = { version: 2, runId: '00000000-0000-4000-8000-000000000001', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test', genesis: { cash: d('20'), quantity: d('0') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0.001'), slippageFraction: d('0.002') }, calibrationEvidenceSha256: 'b'.repeat(64),
    maxDecisionAgeMs: 3600000, maxObservationAgeMs: 60000, validThrough: iso(epoch + 3600000), rounding: 'adverse-price-8-cumulative-cash-8.v1' };
  const portfolio = { snapshot: snapshot(config, 2000000000n, 0n, []), state: 'settled' as const };
  const ruleInput: ShadowSizingInput['ruleInput'] = { schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId,
    runId: config.runId, sourceCommit: config.sourceCommit, decisionAt: iso(epoch - 60000),
    instrument: { id: config.instrumentId, currency: 'USD', calendarSha256: 'c'.repeat(64) },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: 'd'.repeat(64), rightsEvidenceSha256: 'e'.repeat(64), pointInTimeEvidenceSha256: 'f'.repeat(64) },
    policy: { scheduleSha256: '1'.repeat(64), maxAgeMs: 86400000, exposureCap: d('0.25') },
    costs: { status: 'declared', evidenceSha256: config.calibrationEvidenceSha256, stressScenarioSha256: '2'.repeat(64), commissionPerTrade: config.costs.commissionPerOrder,
      spreadFraction: config.costs.spreadFraction, slippageFraction: config.costs.slippageFraction },
    controls: { passiveSha256: '3'.repeat(64), cashAssumptionSha256: '4'.repeat(64) }, portfolio: { state: 'settled', snapshotSha256: simulationDigest(portfolio.snapshot) },
    bars: Array.from({ length: 253 }, (_, i) => ({ sessionOrdinal: i, closedAt: iso(epoch - 120000 - (252 - i) * 86400000),
      availableAt: iso(epoch - 120000 - (252 - i) * 86400000), adjustedClose: d(i === 252 ? '101' : '100') })) };
  return { schema: 'gelt.shadow-sizing-input.v1', sizingPolicyId: shadowSizingPolicyId, ruleInput,
    ruleReceipt: evaluateShadowRule(Buffer.from(canonical(ruleInput))), config, portfolio, lifecycleDisposition: 'settled',
    observation: { referencePrice: d('1'), observedAt: iso(epoch - 30000), availableAt: iso(epoch - 29000), evidenceSha256: '5'.repeat(64) },
    buyLimitPrice: d('1.10'), sellLimitPrice: d('0.90'), quantityQuantum: d('0.01'), evaluationAt: iso(epoch) };
}
function refresh(v: ShadowSizingInput): void {
  v.portfolio.snapshot.configSha256 = simulationDigest(v.config); v.portfolio.snapshot.genesisSha256 = simulationDigest(v.config.genesis);
  v.ruleInput.portfolio.snapshotSha256 = simulationDigest(v.portfolio.snapshot);
  v.ruleReceipt = evaluateShadowRule(Buffer.from(canonical(v.ruleInput)));
}
function free(v: ShadowSizingInput): void {
  v.config.costs = { commissionPerOrder: d('0'), spreadFraction: d('0'), slippageFraction: d('0') };
  v.ruleInput.costs = { ...v.ruleInput.costs, commissionPerTrade: d('0'), spreadFraction: d('0'), slippageFraction: d('0') };
  v.buyLimitPrice = d('1'); v.sellLimitPrice = d('1'); refresh(v);
}
const bytes = (v: unknown) => Buffer.from(canonical(v));
const run = (v: unknown) => proposeShadowSizing(bytes(v));
function none(v: unknown, reason: string) {
  const p = run(v); expect(p.reason).toBe(reason); expect(p.side).toBeNull(); expect(p.quantity).toBeNull(); expect(p.hypothetical).toBeNull(); return p;
}

describe('standalone pure sizing (constructed offline evidence only)', () => {
  it('chooses maximum lot under distinct modeled/limit prices; hypothetical values do not fabricate fills', () => {
    const v = fixture(), p = run(v);
    expect(p.quantity?.value).toBe('4.870000000000000000'); expect(p.attainment).toBe('limit_quantized_underallocation');
    expect(p.hypothetical).toMatchObject({ referenceMark: d('1'), modeledFillPrice: d('1.00300000'), orderLimit: d('1.10'),
      modeledPostCash: d('15.10539000'), limitPostCash: d('14.63300000'), modeledCeilingRelation: 'below' });
    expect(p).toMatchObject({ effectAuthority: 'none', marketEvaluation: 'not_established', promotionAllowed: false });
  });
  it('exact target without fee produces a maximum BUY; no new policy values selected', () => {
    const v = fixture(); free(v); v.quantityQuantum = d('1');
    const p = run(v); expect(p.quantity?.value).toBe('5.000000000000000000'); expect(p.attainment).toBe('modeled_exact_ceiling');
    expect(p.hypothetical?.modeledPostCash.value).toBe('15.00000000');
  });
  it('cash cap produces explicit constrained underallocation, never a second effect', () => {
    const v = fixture(); free(v); v.portfolio.snapshot.cash = d('100'); v.ruleInput.policy.exposureCap = d('0.75'); v.quantityQuantum = d('1'); refresh(v);
    const p = run(v); expect(p.quantity?.value).toBe('10.000000000000000000'); expect(p.attainment).toBe('constraint_limited_underallocation');
    expect(p.hypothetical?.modeledCeilingRelation).toBe('below');
  });
  it('commission changes marked equity and therefore quantity; declaration never proves calibration', () => {
    const v = fixture(); free(v); v.quantityQuantum = d('0.001'); const before = run(v);
    v.config.costs.commissionPerOrder = d('1'); v.ruleInput.costs.commissionPerTrade = d('1'); refresh(v);
    const after = run(v); expect(before.quantity?.value).toBe('5.000000000000000000'); expect(after.quantity?.value).toBe('4.750000000000000000');
    expect(after.hypothetical?.modeledPostCash.value).toBe('14.25000000'); expect(after.marketEvaluation).toBe('not_established');
  });
  it('exact full cash exit with costs sells only the supplied settled quantity', () => {
    const v = fixture(); v.portfolio.snapshot.quantity = d('5'); v.ruleInput.bars[252].adjustedClose = d('99'); refresh(v);
    const p = run(v); expect(p.side).toBe('sell'); expect(p.quantity?.value).toBe('5.000000000000000000'); expect(p.attainment).toBe('cash_exit');
    expect(p.hypothetical?.modeledPostCash.value).toBe('24.97500000'); expect(p.hypothetical?.modeledPostQuantity.value).toBe('0.000000000000000000');
  });
  it.each(['zero', 'cash', 'ceiling'] as const)('no action at %s pays no commission or invents an order', kind => {
    const v = fixture();
    if (kind === 'zero') { v.portfolio.snapshot.cash = d('0'); refresh(v); none(v, 'zero_equity'); }
    if (kind === 'cash') { v.ruleInput.bars[252].adjustedClose = d('99'); refresh(v); none(v, 'already_cash'); }
    if (kind === 'ceiling') { v.portfolio.snapshot.quantity = d('5'); v.portfolio.snapshot.cash = d('15'); refresh(v); none(v, 'already_at_ceiling'); }
    expect(run(v).outcome).toBe('no_action');
  });
  it('overweight positive target abstains without relaxing current adapter direction', () => {
    const v = fixture(); v.portfolio.snapshot.quantity = d('20'); refresh(v); expect(none(v, 'positive_target_overweight_unsupported').outcome).toBe('abstain');
  });
  it.each(['grid', 'cap', 'fee', 'limit'] as const)('whole cash exit rejects %s without a partial quantity', fault => {
    const v = fixture(); v.portfolio.snapshot.quantity = d(fault === 'cap' ? '20' : '1'); v.ruleInput.bars[252].adjustedClose = d('99');
    if (fault === 'grid') v.quantityQuantum = d('0.3'); if (fault === 'fee') v.portfolio.snapshot.cash = d('0');
    if (fault === 'limit') v.sellLimitPrice = d('2'); refresh(v);
    none(v, { grid: 'cash_exit_not_on_grid', cap: 'cash_exit_exceeds_cap', fee: 'cash_exit_fee_cash_unavailable', limit: 'limit_incompatible' }[fault]);
  });
  it.each(['quantum', 'fee', 'limit'] as const)('no positive BUY lot fits %s constraints', fault => {
    const v = fixture();
    if (fault === 'quantum') v.quantityQuantum = d('100'); if (fault === 'fee') { v.portfolio.snapshot.cash = d('0.005'); refresh(v); }
    if (fault === 'limit') v.buyLimitPrice = d('0.90');
    none(v, fault === 'limit' ? 'limit_incompatible' : 'no_buy_lot_fits');
  });
  it('a one-quantum neighbor violates the limit-mark ceiling; bounded search reaches the last feasible fractional lot', () => {
    const v = fixture(); free(v); v.portfolio.snapshot.cash = d('1'); v.ruleInput.policy.exposureCap = d('0.333333333333333333');
    v.quantityQuantum = d('0.000000000000000001'); refresh(v);
    const p = run(v); expect(p.quantity?.value).toBe('0.333333330000000000');
    // ceil8 debit is 0.33333333. Exact fee-free E=1, so the next 1e-18 lot
    // changes ceil8 to0.33333334 and pushes the position beyond its exact ceiling.
    expect(p.attainment).toBe('limit_quantized_underallocation');
  });
  it('small-grid independent integer oracle agrees with maximum lots across cash/fee/limit/cap combinations', () => {
    for (const cashCents of [25, 100, 2000]) for (const feeCents of [0, 1, 10]) for (const limitCents of [100, 110, 200]) {
      const v = fixture(); free(v); v.portfolio.snapshot.cash = d((cashCents / 100).toFixed(2));
      v.config.costs.commissionPerOrder = d((feeCents / 100).toFixed(2)); v.ruleInput.costs.commissionPerTrade = v.config.costs.commissionPerOrder;
      v.buyLimitPrice = d((limitCents / 100).toFixed(2)); v.quantityQuantum = d('0.01'); refresh(v);
      let largest = 0;
      // Independent small integer oracle: hundredths of units, prices/cash in
      // cents; ceiling is 1/4. No use of implementation economics/search helpers.
      for (let n = 1; n <= 1000; n++) {
        const costUnits = n * limitCents + feeCents * 100, afterCash = cashCents * 100 - costUnits;
        const h = n * 100;
        if (costUnits <= 100000 && afterCash >= 0 && h * 4 <= afterCash + h) largest = n;
      }
      const p = run(v); if (largest === 0) expect(p.reason).toBe('no_buy_lot_fits');
      else expect(p.quantity?.value).toBe((largest / 100).toFixed(2).padEnd((largest / 100).toFixed(2).length + 16, '0'));
    }
  });
  it.each(['lifecycle', 'rule-state', 'portfolio', 'rule'] as const)('fences %s without an action', fault => {
    const v = fixture();
    if (fault === 'lifecycle') v.lifecycleDisposition = 'unknown';
    if (fault === 'rule-state') { v.ruleInput.portfolio.state = 'unknown'; refresh(v); }
    if (fault === 'portfolio') v.portfolio.state = 'unsettled';
    if (fault === 'rule') { v.ruleInput.data.eligibility = 'unverified'; refresh(v); }
    const p = none(v, fault === 'portfolio' ? 'unsettled_portfolio' : fault === 'rule' ? 'rule_abstain' : 'lifecycle_unknown');
    expect(matchesShadowSizingProposal(bytes(v), p)).toBe(true);
  });
  it.each(['future', 'before-close', 'stale', 'expiry', 'negative-epoch'] as const)('rejects %s observation/time', fault => {
    const v = fixture();
    if (fault === 'future') v.observation.availableAt = iso(epoch + 1);
    if (fault === 'before-close') v.observation.observedAt = v.ruleInput.decisionAt;
    if (fault === 'stale') v.config.maxObservationAgeMs = 29999;
    if (fault === 'expiry') v.config.validThrough = iso(epoch - 1);
    if (fault === 'negative-epoch') { v.observation.observedAt = iso(-1000); v.observation.availableAt = iso(-1000); }
    refresh(v); none(v, 'invalid_observation');
  });
  it('inclusive observation/decision/expiry bounds with explicit frozen evaluation time', () => {
    const v = fixture(); v.config.maxDecisionAgeMs = 60000; v.config.maxObservationAgeMs = 30000; v.config.validThrough = iso(epoch); refresh(v);
    expect(run(v).outcome).toBe('proposal'); v.evaluationAt = iso(epoch + 1); none(v, 'invalid_observation');
  });
  it.each(['receipt', 'source', 'run', 'class', 'currency', 'snapshot', 'genesis', 'fee', 'spread', 'cost-evidence'] as const)('rejects mismatched %s before correlation or sizing', fault => {
    const v = fixture();
    if (fault === 'receipt') v.ruleReceipt.decisionId = `shadow-decision-${'9'.repeat(64)}`;
    if (fault === 'source') v.ruleInput.sourceCommit = 'b'.repeat(40);
    if (fault === 'run') v.ruleInput.runId = '00000000-0000-4000-8000-000000000002';
    if (fault === 'class') v.ruleInput.data.classification = 'market_shadow_input';
    if (fault === 'currency') v.ruleInput.instrument.currency = 'USDT';
    if (fault === 'snapshot') v.portfolio.snapshot.historySha256 = '9'.repeat(64);
    if (fault === 'genesis') v.portfolio.snapshot.genesisSha256 = '9'.repeat(64);
    if (fault === 'fee') v.ruleInput.costs.commissionPerTrade = d('0.02');
    if (fault === 'spread') v.ruleInput.costs.spreadFraction = d('0.002');
    if (fault === 'cost-evidence') v.ruleInput.costs.evidenceSha256 = '9'.repeat(64);
    if (!['receipt', 'snapshot', 'genesis'].includes(fault)) v.ruleReceipt = evaluateShadowRule(bytes(v.ruleInput));
    const p = none(v, fault === 'receipt' ? 'receipt_mismatch' : 'binding_mismatch');
    expect(p.inputValidation).toBe('invalid'); expect(p.runId).toBeNull(); expect(matchesShadowSizingProposal(bytes(v), p)).toBe(false);
  });
  it.each(['scale-large', 'scale-negative', 'scale-fraction', 'value', 'precision', 'quantum-zero', 'cash-scale', 'cash-overflow', 'quantity-overflow', 'fee-scale', 'extra'] as const)('strict bounds reject %s without unsafe arithmetic', fault => {
    const v: any = fixture();
    if (fault === 'scale-large') v.quantityQuantum.scale = 1000000000; if (fault === 'scale-negative') v.quantityQuantum.scale = -1;
    if (fault === 'scale-fraction') v.quantityQuantum.scale = 0.5; if (fault === 'value') v.quantityQuantum.value = 'bad';
    if (fault === 'precision') v.quantityQuantum.precision = 39; if (fault === 'quantum-zero') v.quantityQuantum = d('0');
    if (fault === 'cash-scale') v.portfolio.snapshot.cash = d('0.000000001');
    if (fault === 'cash-overflow') v.portfolio.snapshot.cash = d('9'.repeat(38));
    if (fault === 'quantity-overflow') v.portfolio.snapshot.quantity = d('9'.repeat(38));
    if (fault === 'fee-scale') v.ruleInput.costs.commissionPerTrade = d('0.010000000'); if (fault === 'extra') v.observation.extra = 'no';
    expect(shadowSizingInputSchema.safeParse(v).success).toBe(false); none(v, 'invalid_input');
  });
  it('malformed encoding, duplicate keys, oversized and structurally excessive input are uncorrelated', () => {
    const v = bytes(fixture()); const duplicate = Buffer.from(v.toString().replace('"schema":"gelt.shadow-sizing-input.v1"', '"schema":"gelt.shadow-sizing-input.v1","schema":"gelt.shadow-sizing-input.v1"'));
    for (const b of [Buffer.from([0xff]), Buffer.from('{'), duplicate, Buffer.from('['.repeat(18) + '0' + ']'.repeat(18))]) {
      const p = proposeShadowSizing(b); expect(p.reason).toBe('invalid_input'); expect(p.runId).toBeNull(); expect(p.quantity).toBeNull();
    }
    expect(proposeShadowSizing(Buffer.alloc(shadowRuleMaxBytes + 1)).inputDigestKind).toBe('unbound');
  });
  it('unrepresentable modeled price and nonpositive modeled sell fail with no partial proposal', () => {
    const v = fixture(); v.observation.referencePrice = d('9'.repeat(38)); none(v, 'unrepresentable_economics');
    const sell = fixture(); sell.portfolio.snapshot.quantity = d('1'); sell.ruleInput.bars[252].adjustedClose = d('99');
    sell.config.costs.spreadFraction = d('1'); sell.ruleInput.costs.spreadFraction = d('1'); refresh(sell); none(sell, 'unrepresentable_economics');
  });
  it('cash output overflow is rejected without changing supplied holdings', () => {
    const v = fixture(); free(v); v.portfolio.snapshot.cash = d('999999999999999999999999999999'); v.portfolio.snapshot.quantity = d('1');
    v.ruleInput.bars[252].adjustedClose = d('99'); refresh(v); none(v, 'unrepresentable_economics');
  });
  it('semantic replay is exact, complete and does not mutate input; hashes cover whole output', () => {
    const v = fixture(), original = structuredClone(v), p = run(v); expect(v).toEqual(original);
    expect(run(Object.fromEntries(Object.entries(v).reverse()))).toEqual(p); expect(matchesShadowSizingProposal(bytes(v), p)).toBe(true);
    const { proposalId, ...body } = p; expect(proposalId).toBe(`shadow-sizing-${digest(canonical(body))}`);
    expect(p.inputSha256).toBe(digest(canonical(shadowSizingInputSchema.parse(v))));
  });
  it.each(['quantum', 'limit', 'time', 'observation', 'controls', 'history', 'cash', 'source'] as const)('binds changed %s to a new identity', field => {
    const v = fixture(), before = run(v);
    if (field === 'quantum') v.quantityQuantum = d('0.001'); if (field === 'limit') v.buyLimitPrice = d('1.2');
    if (field === 'time') v.evaluationAt = iso(epoch + 1); if (field === 'observation') v.observation.evidenceSha256 = '9'.repeat(64);
    if (field === 'controls') { v.ruleInput.controls.cashAssumptionSha256 = '9'.repeat(64); refresh(v); }
    if (field === 'history') { v.portfolio.snapshot.revision++; v.portfolio.snapshot.historySha256 = '9'.repeat(64); refresh(v); }
    if (field === 'cash') { v.portfolio.snapshot.cash = d('21'); refresh(v); }
    if (field === 'source') { v.config.sourceCommit = 'b'.repeat(40); v.ruleInput.sourceCommit = v.config.sourceCommit; refresh(v); }
    const changed = run(v); expect(changed.proposalId).not.toBe(before.proposalId); expect(matchesShadowSizingProposal(bytes(v), before)).toBe(false);
  });
  it.each(['quantity', 'hypothesis', 'attainment', 'id', 'authority', 'scope', 'scale', 'extra'] as const)('rejects malformed/tampered %s proposals', field => {
    const v = fixture(), p: any = run(v);
    if (field === 'quantity') p.quantity.value = '0'; if (field === 'hypothesis') p.hypothetical.modeledPostCash.value = '0';
    if (field === 'attainment') p.attainment = 'cash_exit'; if (field === 'id') p.proposalId = `shadow-sizing-${'9'.repeat(64)}`;
    if (field === 'authority') p.effectAuthority = 'dispatch'; if (field === 'scope') p.marketEvaluation = 'established';
    if (field === 'scale') p.quantity.scale = 1000000000; if (field === 'extra') p.extra = true;
    expect(matchesShadowSizingProposal(bytes(v), p)).toBe(false);
  });
  it('market classification is only a caller declaration, never calibration/terms/market admission', () => {
    const v = fixture(); v.config.classification = 'declared_market_uncalibrated'; v.portfolio.snapshot.classification = v.config.classification;
    v.ruleInput.data.classification = 'market_shadow_input'; refresh(v); expect(run(v).marketEvaluation).toBe('not_established');
  });
  it('closed output refuses action fragments and invalid-input correlated identities', () => {
    const v = fixture(); const p: any = run(v); p.outcome = 'abstain'; p.reason = 'no_buy_lot_fits'; p.attainment = 'not_applicable';
    expect(shadowSizingProposalSchema.safeParse(p).success).toBe(false);
    const invalid: any = proposeShadowSizing(Buffer.from('{')); invalid.runId = v.config.runId; expect(shadowSizingProposalSchema.safeParse(invalid).success).toBe(false);
  });
});
