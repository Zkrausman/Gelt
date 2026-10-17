import { describe, expect, it } from 'vitest';
import { canonical } from './ledger-canonical.js';
import { shadowRuleId, shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { simulationDigest } from './synthetic-simulation-economics.js';
import { matchesPaperObservationSelection, selectPaperObservation, type PaperObservationSelectionInput } from './paper-observation-selection.js';

// Constructed records only; no feed/calendar/rights or durable-first evidence.
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const epoch = Date.parse('2026-10-14T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();
const bars = (decision: 'target_long' | 'target_cash' = 'target_long') => Array.from({ length: 253 }, (_, i) => ({
  sessionOrdinal: i + 100, closedAt: iso(epoch - 120000 - (252 - i) * 86400000),
  availableAt: iso(epoch - 120000 - (252 - i) * 86400000), adjustedClose: d(decision === 'target_long' ? i === 252 ? '101' : '100' : i === 252 ? '99' : '100'),
}));

function fixture(scenarioId: 'base' | 'stress' = 'base', decision: 'target_long' | 'target_cash' = 'target_long'): PaperObservationSelectionInput {
  const spread = scenarioId === 'base' ? d('0.0002') : d('0.001');
  const slippage = scenarioId === 'base' ? d('0.0003') : d('0.0015');
  const mapping: PaperObservationSelectionInput['mapping'] = {
    schema: 'gelt.paper-instrument-map.v1',
    underlying: { symbol: 'SPY', listingVenue: 'NYSE Arca', currency: 'USD', quantityUnit: 'whole SPY shares' },
    signal: { provider: 'Alpaca-data-v2', feed: 'IEX', timeframe: '1Day', adjustment: 'all', asof: '2025-10-14',
      entitySha256: '4'.repeat(64), calendarSha256: '5'.repeat(64), productSha256: '6'.repeat(64), sourceSha256: '7'.repeat(64) },
    internal: { instrumentId: 'SYNTH-RH-USD', currency: 'USD' },
  };
  const mappingSha256 = simulationDigest(mapping);
  const config: PaperObservationSelectionInput['config'] = {
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
  const ruleInput: PaperObservationSelectionInput['ruleInput'] = {
    schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId, runId: config.runId, sourceCommit: config.sourceCommit,
    decisionAt: iso(epoch - 60000), instrument: { id: 'SPY', currency: 'USD', calendarSha256: mapping.signal.calendarSha256 },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: '8'.repeat(64),
      rightsEvidenceSha256: '9'.repeat(64), pointInTimeEvidenceSha256: 'b'.repeat(64) },
    policy: { scheduleSha256: config.scheduleSha256, maxAgeMs: config.signalMaxAgeMs, exposureCap: d('0.95') },
    costs: { status: 'declared', evidenceSha256: config.costs.evidenceSha256, stressScenarioSha256: config.costs.stressScenarioSha256,
      commissionPerTrade: config.costs.commissionPerOrder, spreadFraction: config.costs.spreadFraction, slippageFraction: config.costs.slippageFraction },
    controls: { passiveSha256: 'c'.repeat(64), cashAssumptionSha256: 'd'.repeat(64) },
    portfolio: { state: 'settled', snapshotSha256: 'f'.repeat(64) }, bars: bars(decision),
  };
  return {
    schema: 'gelt.paper-observation-selection-input.v1', policyId: config.policyId, config, mapping, ruleInput,
    ruleReceipt: evaluateShadowRule(bytes(ruleInput)), evaluationAt: iso(epoch),
    observations: [-5000, -4000, -3000].map((offset, index) => ({
      instrumentId: 'SPY', mappingSha256, referencePrice: d(index === 0 ? '99999' : '1'),
      observedAt: iso(epoch + offset), availableAt: iso(epoch + offset + 500), evidenceSha256: 'e'.repeat(64),
    })),
  };
}
const bytes = (v: unknown) => Buffer.from(canonical(v));
const run = (v: unknown) => selectPaperObservation(bytes(v));
const refresh = (v: PaperObservationSelectionInput) => { v.ruleReceipt = evaluateShadowRule(bytes(v.ruleInput)); };
const rejected = { schema: 'gelt.paper-observation-selection.v1', status: 'rejected', reason: 'invalid_input' };

describe('constructed supplied-batch paper observation selection', () => {
  it('selects the first expensive observation without trying later affordable prices and binds all originals', () => {
    const input = fixture(), result = run(input);
    expect(result).toMatchObject({ status: 'selected', selectedIndex: 0, observation: input.observations[0],
      inputSha256: simulationDigest(input), batchSha256: simulationDigest(input.observations),
      configSha256: simulationDigest(input.config), mappingSha256: simulationDigest(input.mapping),
      ruleInputSha256: simulationDigest(input.ruleInput), ruleReceiptSha256: simulationDigest(input.ruleReceipt),
      observationSha256: simulationDigest(input.observations[0]), effectAuthority: 'none', promotionAllowed: false,
      globalFirstObservation: 'not_established', durableFreeze: 'not_established', marketEvaluation: 'not_established' });
    expect(matchesPaperObservationSelection(bytes(input), result)).toBe(true);
    expect(run(input)).toEqual(result);
    input.observations[0].referencePrice = d('0.000000000000000001');
    const cheap = run(input);
    expect(cheap).toMatchObject({ status: 'selected', selectedIndex: 0 });
    expect(cheap).not.toEqual(result);
    expect(matchesPaperObservationSelection(bytes(input), result)).toBe(false);
  });

  it('preserves arbitrary exact decimal metadata and detaches output from bytes and caller objects', () => {
    const input = fixture(); input.observations[0].referencePrice = d('123456789.000000000000000001');
    const original = structuredClone(input.observations[0]), raw = bytes(input), result = selectPaperObservation(raw);
    raw.fill(0); input.observations[0].referencePrice.value = '1';
    expect(result).toMatchObject({ status: 'selected', observation: original });
    const fresh = fixture(); fresh.observations[0] = original;
    expect(matchesPaperObservationSelection(bytes(fresh), result)).toBe(true);
  });

  it.each(['base', 'stress'] as const)('supports fixed %s context and cash decisions without economic branching', scenario => {
    const input = fixture(scenario, 'target_cash');
    expect(input.ruleReceipt.decision).toBe('target_cash');
    expect(run(input)).toMatchObject({ status: 'selected', selectedIndex: 0 });
  });

  it.each(['costs', 'unknown', 'warmup'] as const)('does not promote a valid %s abstention', kind => {
    const input = fixture();
    if (kind === 'costs') input.ruleInput.costs.status = 'unverified';
    if (kind === 'unknown') input.ruleInput.portfolio.state = 'unknown';
    if (kind === 'warmup') input.ruleInput.bars = [];
    refresh(input); expect(input.ruleReceipt.decision).toBe('abstain');
    const result = run(input);
    expect(result).toMatchObject({ status: 'selected', effectAuthority: 'none', promotionAllowed: false });
    expect(matchesPaperObservationSelection(bytes(input), result)).toBe(true);
  });

  const mutations: [string, (v: PaperObservationSelectionInput) => void][] = [
    ['mapping digest', v => { v.config.mappingSha256 = '0'.repeat(64); }],
    ['mapping identity', v => { v.mapping.signal.productSha256 = '0'.repeat(64); }],
    ['run', v => { v.config.runId = '00000000-0000-4000-8000-000000000007'; }],
    ['source', v => { v.config.sourceCommit = 'b'.repeat(40); }],
    ['rule receipt', v => { v.ruleReceipt.decisionId = `shadow-decision-${'0'.repeat(64)}`; }],
    ['rule input', v => { v.ruleInput.controls.passiveSha256 = '0'.repeat(64); }],
    ['market classification', v => { v.ruleInput.data.classification = 'market_shadow_input'; refresh(v); }],
    ['unverified data', v => { v.ruleInput.data.eligibility = 'unverified'; refresh(v); }],
    ['instrument', v => { v.ruleInput.instrument.id = 'OTHER'; refresh(v); }],
    ['currency', v => { v.ruleInput.instrument.currency = 'EUR'; refresh(v); }],
    ['calendar', v => { v.ruleInput.instrument.calendarSha256 = '0'.repeat(64); refresh(v); }],
    ['schedule', v => { v.ruleInput.policy.scheduleSha256 = '0'.repeat(64); refresh(v); }],
    ['signal age', v => { v.ruleInput.policy.maxAgeMs++; refresh(v); }],
    ['exposure', v => { v.ruleInput.policy.exposureCap = d('0.94'); refresh(v); }],
    ['observation mapping', v => { v.observations[2].mappingSha256 = '0'.repeat(64); }],
    ['later malformed price', v => { v.observations[2].referencePrice.value = '1e3'; }],
    ['duplicate timestamp', v => { v.observations[1].observedAt = v.observations[0].observedAt; }],
    ['reversed chronology', v => { v.observations.reverse(); }],
    ['availability before observation', v => { v.observations[2].availableAt = iso(epoch - 3001); }],
    ['future availability', v => { v.observations[2].availableAt = iso(epoch + 1); }],
    ['future observation', v => { v.observations[2].observedAt = iso(epoch + 1); v.observations[2].availableAt = iso(epoch + 1); }],
  ];
  it.each(mutations)('rejects the entire batch/context for %s', (_name, change) => {
    const input = fixture(); change(input);
    expect(run(input)).toEqual(rejected);
    expect(matchesPaperObservationSelection(bytes(input), run(input))).toBe(false);
  });

  it.each(['callback', 'quantity', 'buyLimitPrice', 'portfolio', 'costFilter', 'orderCap'])('rejects extra root branch field %s', field => {
    expect(run({ ...fixture(), [field]: true })).toEqual(rejected);
  });
  it('rejects nested branch fields and foreign result namespaces', () => {
    const input = fixture(); Object.assign(input.observations[0], { availableQuantity: d('1') });
    expect(run(input)).toEqual(rejected);
    expect(matchesPaperObservationSelection(bytes(fixture()), { ...run(fixture()), schema: 'gelt.paper-sizing-proposal.v1' })).toBe(false);
  });

  it.each([-1, 0, 1])('requires observation strictly after decision (%i ms)', offset => {
    const input = fixture(), decision = Date.parse(input.ruleInput.decisionAt);
    input.evaluationAt = iso(decision + 1000);
    input.observations = [{ ...input.observations[0], observedAt: iso(decision + offset), availableAt: iso(decision + offset) }];
    expect(run(input)).toMatchObject({ status: offset > 0 ? 'selected' : 'not_selected',
      reason: offset > 0 ? 'first_eligible' : 'no_eligible_observation' });
  });
  it.each([4999, 5000, 5001])('enforces inclusive freshness (%i ms)', age => {
    const input = fixture(); input.observations = [{ ...input.observations[0], observedAt: iso(epoch - age), availableAt: iso(epoch) }];
    expect(run(input)).toMatchObject({ status: age <= 5000 ? 'selected' : 'not_selected' });
  });
  it.each([-1, 0, 960000, 960001])('enforces inclusive decision window (%i ms)', age => {
    const input = fixture(), decision = Date.parse(input.ruleInput.decisionAt);
    input.config.validThrough = iso(decision + 2000000); input.evaluationAt = iso(decision + age); input.observations = [];
    const result = run(input);
    expect(result).toMatchObject({ status: 'not_selected', reason: age < 0 || age > 960000 ? 'decision_outside_window' : 'no_eligible_observation' });
    expect(matchesPaperObservationSelection(bytes(input), result)).toBe(true);
  });
  it.each([-1, 0, 1])('enforces validThrough inclusively (%i ms)', offset => {
    const input = fixture(); input.config.validThrough = iso(epoch - offset);
    expect(run(input)).toMatchObject({ status: offset > 0 ? 'not_selected' : 'selected' });
  });
  it('skips stale structural records without sorting and allows nonmonotone availability', () => {
    const input = fixture(); input.observations[0].observedAt = iso(epoch - 5001);
    input.observations[0].availableAt = iso(epoch);
    expect(run(input)).toMatchObject({ status: 'selected', selectedIndex: 1 });
  });
  it('accepts empty and 64-record batches but rejects 65', () => {
    const input = fixture(); input.observations = [];
    expect(run(input)).toMatchObject({ status: 'not_selected', reason: 'no_eligible_observation', selectedIndex: null, observation: null, observationSha256: null });
    const o = fixture().observations[0];
    input.observations = Array.from({ length: 64 }, (_, n) => ({ ...o, observedAt: iso(epoch - 64 + n), availableAt: iso(epoch) }));
    expect(run(input)).toMatchObject({ status: 'selected', selectedIndex: 0 });
    input.observations.push({ ...o, observedAt: iso(epoch), availableAt: iso(epoch) });
    expect(run(input)).toEqual(rejected);
  });

  it.each(['selectionId', 'inputSha256', 'batchSha256', 'configSha256', 'mappingSha256', 'ruleInputSha256', 'ruleReceiptSha256',
    'decisionId', 'selectedIndex', 'observation', 'observationSha256', 'effectAuthority', 'extra'])('rejects result tampering: %s', field => {
    const input = bytes(fixture()), result = selectPaperObservation(input);
    expect(matchesPaperObservationSelection(input, { ...result, [field]: null })).toBe(false);
  });
  it('rejects a plausible later selection, changed evaluation, batch suffix and caller evidence', () => {
    const input = fixture(), result = run(input);
    expect(matchesPaperObservationSelection(bytes(input), { ...result, selectedIndex: 1, observation: input.observations[1], observationSha256: simulationDigest(input.observations[1]) })).toBe(false);
    input.evaluationAt = iso(epoch + 1); expect(matchesPaperObservationSelection(bytes(input), result)).toBe(false);
    input.evaluationAt = iso(epoch); input.observations.pop(); expect(matchesPaperObservationSelection(bytes(input), result)).toBe(false);
    const changed = fixture(); changed.observations[2].evidenceSha256 = 'f'.repeat(64);
    expect(matchesPaperObservationSelection(bytes(changed), result)).toBe(false);
  });

  it.each([
    ['nonbuffer', 'text'], ['malformed', Buffer.from('{')], ['invalid UTF8', Buffer.from([0xff])],
    ['oversize', Buffer.alloc(shadowRuleMaxBytes + 1)], ['duplicate keys', Buffer.from('{"schema":1,"schema":2}')],
    ['deep JSON', Buffer.from('['.repeat(17) + '0' + ']'.repeat(17))],
  ])('sanitizes %s input', (_name, raw) => {
    expect(selectPaperObservation(raw as Buffer)).toEqual(rejected);
    expect(matchesPaperObservationSelection(raw as Buffer, rejected)).toBe(false);
  });
});

