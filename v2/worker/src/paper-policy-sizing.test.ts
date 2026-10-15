import { describe, expect, it } from 'vitest';
import { canonical } from './ledger-canonical.js';
import { shadowRuleId, shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { decimal, feeCap, simulationDigest, simulationRunSchema, snapshot, type SimulationRun } from './synthetic-simulation-economics.js';
import { matchesPaperSizingProposal, matchesShadowSizingProposal, proposePaperSizing, proposeShadowSizing } from './shadow-sizing.js';
import { shadowSizingInputSchema, type PaperSizingInput, type ShadowSizingInput } from './shadow-sizing-contract.js';

// Every source, price, mapping, and state in this file is a constructed fixture.
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const epoch = Date.parse('2026-10-14T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();
const bars = (decision: 'target_long' | 'target_cash' = 'target_long') => Array.from({ length: 253 }, (_, i) => ({
  sessionOrdinal: i + 100, closedAt: iso(epoch - 120000 - (252 - i) * 86400000),
  availableAt: iso(epoch - 120000 - (252 - i) * 86400000), adjustedClose: d(decision === 'target_long' ? i === 252 ? '101' : '100' : i === 252 ? '99' : '100'),
}));

function paperFixture(scenarioId: 'base' | 'stress' = 'base', decision: 'target_long' | 'target_cash' = 'target_long', mark = '1'): PaperSizingInput {
  const spread = scenarioId === 'base' ? d('0.0002') : d('0.001');
  const slippage = scenarioId === 'base' ? d('0.0003') : d('0.0015');
  const mapping: PaperSizingInput['mapping'] = {
    schema: 'gelt.paper-instrument-map.v1',
    underlying: { symbol: 'SPY', listingVenue: 'NYSE Arca', currency: 'USD', quantityUnit: 'whole SPY shares' },
    signal: { provider: 'Alpaca-data-v2', feed: 'IEX', timeframe: '1Day', adjustment: 'all', asof: '2025-10-14',
      entitySha256: '4'.repeat(64), calendarSha256: '5'.repeat(64), productSha256: '6'.repeat(64), sourceSha256: '7'.repeat(64) },
    internal: { instrumentId: 'SYNTH-RH-USD', currency: 'USD' },
  };
  const mappingSha256 = simulationDigest(mapping);
  const config: PaperSizingInput['config'] = {
    schema: 'gelt.paper-sizing-config.v1', version: 1, policyId: 'gelt.spy-long-cash-paper-policy.v1',
    runId: '00000000-0000-4000-8000-000000000006', sourceCommit: 'a'.repeat(40), classification: 'constructed_offline_test',
    scenarioId, internalInstrumentId: 'SYNTH-RH-USD', currency: 'USD',
    genesis: { cash: d('10000.00000000'), quantity: d('0.000000000000000000') },
    targetExposureCeiling: d('0.950000000000000000'), quantityQuantum: d('1.000000000000000000'),
    scheduleSha256: '1'.repeat(64), mappingSha256, signalMaxAgeMs: 86400000,
    costs: { scenarioId, commissionPerOrder: d('1.00000000'), spreadFraction: spread, slippageFraction: slippage,
      evidenceSha256: '2'.repeat(64), stressScenarioSha256: '3'.repeat(64) },
    maxDecisionAgeMs: 960000, maxObservationAgeMs: 5000, validThrough: iso(epoch + 900000),
    rounding: 'adverse-price-8-cumulative-cash-8.v1',
  };
  const configSha256 = simulationDigest(config);
  const snapshotValue: PaperSizingInput['portfolio']['snapshot'] = {
    schema: 'gelt.paper-portfolio-snapshot.v1', version: 1, runId: config.runId, sourceCommit: config.sourceCommit,
    policyId: config.policyId, classification: config.classification, scenarioId,
    underlyingSymbol: 'SPY', internalInstrumentId: 'SYNTH-RH-USD', currency: 'USD',
    configSha256, mappingSha256, genesisSha256: simulationDigest(config.genesis), revision: 0, history: [],
    cash: config.genesis.cash, quantity: config.genesis.quantity,
  };
  const ruleInput: PaperSizingInput['ruleInput'] = {
    schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId, runId: config.runId, sourceCommit: config.sourceCommit,
    decisionAt: iso(epoch - 60000), instrument: { id: 'SPY', currency: 'USD', calendarSha256: mapping.signal.calendarSha256 },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: '8'.repeat(64),
      rightsEvidenceSha256: '9'.repeat(64), pointInTimeEvidenceSha256: 'b'.repeat(64) },
    policy: { scheduleSha256: config.scheduleSha256, maxAgeMs: config.signalMaxAgeMs, exposureCap: d('0.95') },
    costs: { status: 'declared', evidenceSha256: config.costs.evidenceSha256, stressScenarioSha256: config.costs.stressScenarioSha256,
      commissionPerTrade: config.costs.commissionPerOrder, spreadFraction: config.costs.spreadFraction, slippageFraction: config.costs.slippageFraction },
    controls: { passiveSha256: 'c'.repeat(64), cashAssumptionSha256: 'd'.repeat(64) },
    portfolio: { state: 'settled', snapshotSha256: simulationDigest(snapshotValue) }, bars: bars(decision),
  };
  const referencePrice = d(mark);
  const buyLimit = scenarioId === 'base' ? d(mark === '100' ? '100.05' : '1.0005') : d(mark === '100' ? '100.25' : '1.0025');
  const sellLimit = scenarioId === 'base' ? d(mark === '100' ? '99.95' : '0.9995') : d(mark === '100' ? '99.75' : '0.9975');
  return {
    schema: 'gelt.paper-sizing-input.v1', policyId: config.policyId, ruleInput,
    ruleReceipt: evaluateShadowRule(Buffer.from(canonical(ruleInput))), config, mapping,
    portfolio: { snapshot: snapshotValue, state: 'settled' }, lifecycleDisposition: 'settled',
    observation: { instrumentId: 'SPY', mappingSha256, referencePrice, observedAt: iso(epoch - 4000), availableAt: iso(epoch - 3000), evidenceSha256: 'e'.repeat(64) },
    buyLimitPrice: buyLimit, sellLimitPrice: sellLimit, evaluationAt: iso(epoch),
  };
}

function refreshPortfolioBindings(v: PaperSizingInput): void {
  const s = v.portfolio.snapshot;
  s.configSha256 = simulationDigest(v.config); s.mappingSha256 = simulationDigest(v.mapping); s.genesisSha256 = simulationDigest(v.config.genesis);
  v.ruleInput.portfolio.snapshotSha256 = simulationDigest(s);
  v.ruleReceipt = evaluateShadowRule(Buffer.from(canonical(v.ruleInput)));
}

function setPosition(v: PaperSizingInput, cash: string, quantity: string): void {
  const s = v.portfolio.snapshot;
  s.revision = 1; s.cash = d(cash); s.quantity = d(quantity);
  s.history = [{ revision: 1, occurredAt: iso(epoch - 1000), stateKind: 'constructed_state', cash: { ...s.cash }, quantity: { ...s.quantity } }];
  refreshPortfolioBindings(v);
}

const bytes = (v: unknown) => Buffer.from(canonical(v));
const run = (v: unknown) => proposePaperSizing(bytes(v));

function legacyFixture(mark: string): ShadowSizingInput {
  const config: SimulationRun = {
    version: 2, runId: '00000000-0000-4000-8000-000000000106', sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD',
    currency: 'USD', classification: 'constructed_offline_test', genesis: { cash: d('10000'), quantity: d('0') },
    costs: { commissionPerOrder: d('1'), spreadFraction: d('0.0002'), slippageFraction: d('0.0003') },
    calibrationEvidenceSha256: '2'.repeat(64), maxDecisionAgeMs: 960000, maxObservationAgeMs: 5000,
    validThrough: iso(epoch + 900000), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  };
  const portfolio = { snapshot: snapshot(config, 1_000_000_000_000n, 0n, []), state: 'settled' as const };
  const ruleInput: ShadowSizingInput['ruleInput'] = {
    schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId, runId: config.runId, sourceCommit: config.sourceCommit,
    decisionAt: iso(epoch - 60000), instrument: { id: 'SYNTH-RH-USD', currency: 'USD', calendarSha256: '5'.repeat(64) },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: '8'.repeat(64), rightsEvidenceSha256: '9'.repeat(64), pointInTimeEvidenceSha256: 'b'.repeat(64) },
    policy: { scheduleSha256: '1'.repeat(64), maxAgeMs: 86400000, exposureCap: d('0.95') },
    costs: { status: 'declared', evidenceSha256: config.calibrationEvidenceSha256, stressScenarioSha256: '3'.repeat(64),
      commissionPerTrade: config.costs.commissionPerOrder, spreadFraction: config.costs.spreadFraction, slippageFraction: config.costs.slippageFraction },
    controls: { passiveSha256: 'c'.repeat(64), cashAssumptionSha256: 'd'.repeat(64) },
    portfolio: { state: 'settled', snapshotSha256: simulationDigest(portfolio.snapshot) }, bars: bars(),
  };
  return {
    schema: 'gelt.shadow-sizing-input.v1', sizingPolicyId: 'gelt.long-cash-limit-bounded-sizing.v1', ruleInput,
    ruleReceipt: evaluateShadowRule(Buffer.from(canonical(ruleInput))), config, portfolio, lifecycleDisposition: 'settled',
    observation: { referencePrice: d(mark), observedAt: iso(epoch - 4000), availableAt: iso(epoch - 3000), evidenceSha256: 'e'.repeat(64) },
    buyLimitPrice: d(mark === '100' ? '100.05' : '1.0005'), sellLimitPrice: d(mark === '100' ? '99.95' : '0.9995'),
    quantityQuantum: d('1'), evaluationAt: iso(epoch),
  };
}

describe('isolated pure G06 constructed paper sizing', () => {
  it('uses fixed base/stress economics with whole shares and binds the full SPY-to-synthetic identity', () => {
    const baseBytes = bytes(paperFixture('base')), base = proposePaperSizing(baseBytes);
    const stressBytes = bytes(paperFixture('stress')), stress = proposePaperSizing(stressBytes);
    expect(base).toMatchObject({ outcome: 'proposal', side: 'buy', quantity: d('9494.000000000000000000'), scenarioId: 'base',
      underlyingSymbol: 'SPY', internalInstrumentId: 'SYNTH-RH-USD', liquidationDisposition: 'not_applicable',
      effectAuthority: 'none', marketEvaluation: 'not_established', promotionAllowed: false });
    expect(base.hypothetical).toMatchObject({ modeledFillPrice: d('1.00050000'), modeledPostCash: d('500.25300000'), limitWithinCeiling: true });
    expect(stress).toMatchObject({ outcome: 'proposal', side: 'buy', quantity: d('9476.000000000000000000'), scenarioId: 'stress' });
    expect(stress.hypothetical).toMatchObject({ modeledFillPrice: d('1.00250000'), modeledPostCash: d('499.31000000'), limitWithinCeiling: true });
    expect(base.policySha256).toMatch(/^[a-f0-9]{64}$/); expect(base.mappingSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(base.portfolioSnapshotSha256).toMatch(/^[a-f0-9]{64}$/); expect(base.historyRevision).toBe(0);
    expect(matchesPaperSizingProposal(baseBytes, base)).toBe(true);
    expect(matchesPaperSizingProposal(stressBytes, stress)).toBe(true);
    const changedEvaluation = { ...base, evaluationAt: iso(epoch + 1) };
    expect(matchesPaperSizingProposal(baseBytes, changedEvaluation)).toBe(false);
  });

  it('accepts a paper allocation above USD10 while the unchanged legacy cap and legacy API refuse it', () => {
    const input = paperFixture('base', 'target_long', '100'), inputBytes = bytes(input), paper = proposePaperSizing(inputBytes);
    expect(paper.outcome).toBe('proposal');
    expect(paper.quantity?.value).toBe('94.000000000000000000');
    expect(feeCap(paper.quantity!, paper.hypothetical!.modeledFillPrice, d('1'))).toBe(false);
    const legacy = proposeShadowSizing(bytes(legacyFixture('100')));
    expect(legacy).toMatchObject({ outcome: 'abstain', reason: 'no_buy_lot_fits', side: null, quantity: null });
    expect(matchesShadowSizingProposal(inputBytes, paper)).toBe(false);
    expect(shadowSizingInputSchema.safeParse(input).success).toBe(false);
    expect(simulationRunSchema.safeParse(input.config).success).toBe(false);
  });

  it('abstains on overweight without trimming and preserves holdings when a full cash exit exceeds the fixed cap', () => {
    const overweight = paperFixture('base', 'target_long', '100');
    setPosition(overweight, '1000.00000000', '100.000000000000000000');
    const over = run(overweight);
    expect(over).toMatchObject({ outcome: 'abstain', reason: 'positive_target_overweight_unsupported', side: null, quantity: null });

    const exit = paperFixture('base', 'target_cash', '100');
    setPosition(exit, '1000.00000000', '200.000000000000000000');
    const cashExit = run(exit);
    expect(cashExit).toMatchObject({ outcome: 'abstain', reason: 'cash_exit_exceeds_cap', side: null, quantity: null,
      hypothetical: null, liquidationDisposition: 'holdings_retained_incomplete', effectAuthority: 'none', marketEvaluation: 'not_established' });
    expect(matchesPaperSizingProposal(bytes(exit), cashExit)).toBe(true);

    const fractionalExit = paperFixture('base', 'target_cash', '100');
    setPosition(fractionalExit, '1000.00000000', '2.500000000000000000');
    expect(run(fractionalExit)).toMatchObject({ outcome: 'abstain', reason: 'cash_exit_not_on_grid', quantity: null,
      liquidationDisposition: 'holdings_retained_incomplete' });

    const fractional = paperFixture('base', 'target_long');
    setPosition(fractional, '9999.00000000', '0.500000000000000000');
    expect(run(fractional)).toMatchObject({ outcome: 'abstain', reason: 'current_position_not_on_grid', quantity: null });
  });

  it('preserves the original G05 SPY receipt and rejects identity, history, receipt, and cap-field substitutions', () => {
    const original = paperFixture(), originalReceipt = canonical(original.ruleReceipt);
    expect(original.ruleInput.instrument.id).toBe('SPY');
    expect(matchesPaperSizingProposal(bytes(original), run(original))).toBe(true);
    expect(canonical(original.ruleReceipt)).toBe(originalReceipt);

    const cap = structuredClone(original) as PaperSizingInput & { paperOrderCap?: string };
    cap.paperOrderCap = '1000000000';
    expect(run(cap).inputValidation).toBe('invalid');
    const scenario = structuredClone(original); scenario.config.scenarioId = 'stress';
    expect(run(scenario).inputValidation).toBe('invalid');
    const mapping = structuredClone(original); mapping.mapping.signal.productSha256 = 'f'.repeat(64);
    refreshPortfolioBindings(mapping);
    expect(run(mapping).reason).toBe('binding_mismatch');
    const genesis = structuredClone(original); genesis.config.genesis.cash = d('9999.00000000');
    expect(run(genesis).inputValidation).toBe('invalid');
    const runId = structuredClone(original); runId.config.runId = '00000000-0000-4000-8000-000000000007';
    expect(run(runId).reason).toBe('binding_mismatch');
    const source = structuredClone(original); source.config.sourceCommit = 'b'.repeat(40);
    expect(run(source).reason).toBe('binding_mismatch');
    const history = structuredClone(original); history.portfolio.snapshot.revision = 1;
    history.portfolio.snapshot.history = [{ revision: 1, occurredAt: iso(epoch - 2000), stateKind: 'constructed_state',
      cash: history.portfolio.snapshot.cash, quantity: history.portfolio.snapshot.quantity }];
    expect(run(history).reason).toBe('binding_mismatch');

    const alteredGenesisState = structuredClone(original);
    alteredGenesisState.portfolio.snapshot.cash = d('9999.00000000');
    alteredGenesisState.portfolio.snapshot.quantity = d('1.000000000000000000');
    refreshPortfolioBindings(alteredGenesisState);
    expect(run(alteredGenesisState).reason).toBe('binding_mismatch');

    const futureHistory = paperFixture(); setPosition(futureHistory, '9999.00000000', '1.000000000000000000');
    futureHistory.portfolio.snapshot.history[0].occurredAt = iso(epoch + 1);
    refreshPortfolioBindings(futureHistory);
    expect(run(futureHistory).reason).toBe('binding_mismatch');

    const nonmonotoneHistory = paperFixture(); setPosition(nonmonotoneHistory, '9999.00000000', '1.000000000000000000');
    nonmonotoneHistory.portfolio.snapshot.revision = 2;
    nonmonotoneHistory.portfolio.snapshot.history = [
      { revision: 1, occurredAt: iso(epoch - 3000), stateKind: 'constructed_state', cash: d('9999.00000000'), quantity: d('1.000000000000000000') },
      { revision: 2, occurredAt: iso(epoch - 4000), stateKind: 'constructed_state', cash: d('9999.00000000'), quantity: d('1.000000000000000000') },
    ];
    refreshPortfolioBindings(nonmonotoneHistory);
    expect(run(nonmonotoneHistory).reason).toBe('binding_mismatch');

    const receipt = structuredClone(original); receipt.ruleReceipt.decisionId = `shadow-decision-${'f'.repeat(64)}`;
    expect(run(receipt).reason).toBe('receipt_mismatch');
  });

  it('rejects market or unverified candidates, malformed decimals, oversize inputs, and added callback fields', () => {
    const market = paperFixture(); market.ruleInput.data.classification = 'market_shadow_input';
    expect(run(market).inputValidation).toBe('invalid');
    const unverified = paperFixture(); unverified.ruleInput.data.eligibility = 'unverified';
    expect(run(unverified).inputValidation).toBe('invalid');
    const badDecimal = paperFixture(); badDecimal.observation.referencePrice = { value: '1e999', precision: 5, scale: 0 } as never;
    expect(run(badDecimal).inputValidation).toBe('invalid');
    const timestampAsOf = paperFixture(); timestampAsOf.mapping.signal.asof = iso(epoch) as never;
    expect(run(timestampAsOf).inputValidation).toBe('invalid');
    const impossibleAsOf = paperFixture(); impossibleAsOf.mapping.signal.asof = '2026-02-30' as never;
    expect(run(impossibleAsOf).inputValidation).toBe('invalid');
    const callback = { ...paperFixture(), callback: true };
    expect(run(callback).inputValidation).toBe('invalid');
    const invalid = proposePaperSizing(Buffer.from('{'));
    expect(invalid).toMatchObject({ inputValidation: 'invalid', outcome: 'abstain', reason: 'invalid_input', runId: null,
      configSha256: null, mappingSha256: null, portfolioSnapshotSha256: null, targetExposure: null });
    const oversize = proposePaperSizing(Buffer.alloc(shadowRuleMaxBytes + 1));
    expect(oversize).toMatchObject({ inputValidation: 'invalid', reason: 'input_too_large', inputSha256: null, runId: null });
  });

  it('handles a full hypothetical cash exit, no-action, stale observation, and unknown lifecycle', () => {
    const exit = paperFixture('base', 'target_cash', '100');
    setPosition(exit, '1000.00000000', '2.000000000000000000');
    const fullExit = run(exit);
    expect(fullExit).toMatchObject({ outcome: 'proposal', reason: 'cash_exit_proposal', side: 'sell',
      quantity: d('2.000000000000000000'), liquidationDisposition: 'hypothetical_full_exit_proposal', effectAuthority: 'none',
      marketEvaluation: 'not_established', promotionAllowed: false });
    expect(fullExit.hypothetical).toMatchObject({ modeledPostQuantity: d('0.000000000000000000') });
    expect(matchesPaperSizingProposal(bytes(exit), fullExit)).toBe(true);

    expect(run(paperFixture('base', 'target_cash'))).toMatchObject({ outcome: 'no_action', reason: 'already_cash' });
    const stale = paperFixture(); stale.observation.observedAt = iso(epoch - 5001); stale.observation.availableAt = iso(epoch - 5000);
    expect(run(stale)).toMatchObject({ inputValidation: 'valid', outcome: 'abstain', reason: 'invalid_observation' });
    const unknown = paperFixture(); unknown.lifecycleDisposition = 'unknown';
    expect(run(unknown)).toMatchObject({ inputValidation: 'valid', outcome: 'abstain', reason: 'lifecycle_unknown' });
  });
});
