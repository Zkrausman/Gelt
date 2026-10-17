import { afterEach, describe, expect, it, vi } from 'vitest';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import { canonical } from './ledger-canonical.js';
import { bindPaperCalendar } from './paper-calendar-binding.js';
import { selectPaperObservation, type PaperObservationSelection } from './paper-observation-selection.js';
import { shadowRuleId, shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { simulationDigest } from './synthetic-simulation-economics.js';
import type { PaperSizingInput } from './shadow-sizing-contract.js';
import * as sizing from './shadow-sizing.js';
import { composePaperSelectionSizing, matchesPaperSelectionSizing, type PaperSelectionSizingInput } from './paper-selection-sizing.js';

// All quotes, calendars, costs and portfolios are constructed offline fixtures.
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

const bytes = (value: unknown) => Buffer.from(canonical(value));
const run = (value: unknown) => composePaperSelectionSizing(bytes(value));
const selectionOriginal = (v: PaperSelectionSizingInput) => ({ schema: 'gelt.paper-observation-selection-input.v1',
  policyId: v.policyId, config: v.config, mapping: v.mapping, ruleInput: v.ruleInput, ruleReceipt: v.ruleReceipt,
  observations: v.observations, evaluationAt: v.evaluationAt });
const calendarOriginal = (v: PaperSelectionSizingInput) => ({ schema: 'gelt.paper-calendar-binding-input.v1',
  policyId: v.policyId, config: v.config, mapping: v.mapping, ruleInput: v.ruleInput, ruleReceipt: v.ruleReceipt, calendar: v.calendar });
function refresh(v: PaperSelectionSizingInput): void {
  v.calendar.sha256 = alpacaSessionCalendarDigest(v.calendar); v.mapping.signal.calendarSha256 = v.calendar.sha256;
  v.config.mappingSha256 = simulationDigest(v.mapping);
  v.observations.forEach(o => { o.mappingSha256 = v.config.mappingSha256; });
  const snapshot = v.portfolio.snapshot;
  snapshot.configSha256 = simulationDigest(v.config); snapshot.mappingSha256 = v.config.mappingSha256;
  snapshot.genesisSha256 = simulationDigest(v.config.genesis);
  v.ruleInput.instrument.calendarSha256 = v.calendar.sha256; v.ruleInput.portfolio.snapshotSha256 = simulationDigest(snapshot);
  v.ruleReceipt = evaluateShadowRule(bytes(v.ruleInput));
  v.selectionReceipt = selectPaperObservation(bytes(selectionOriginal(v)));
  v.calendarBindingReceipt = bindPaperCalendar(bytes(calendarOriginal(v)));
}
function fixture(scenario: 'base' | 'stress' = 'base', decision: 'target_long' | 'target_cash' = 'target_long', mark = '100'): PaperSelectionSizingInput {
  const original = paperFixture(scenario, decision, mark);
  const { schema: _schema, observation, ...context } = original;
  const v: PaperSelectionSizingInput = {
    ...context, schema: 'gelt.paper-selection-sizing-input.v1',
    calendar: { symbol: 'SPY', sha256: '', sessions: original.ruleInput.bars.map(b => ({
      sessionOrdinal: b.sessionOrdinal, providerTimestamp: iso(Date.parse(b.closedAt) - 1000), closedAt: b.closedAt,
      completedAt: b.availableAt, completed: true, completionEvidenceSha256: 'e'.repeat(64),
    })) },
    observations: [observation, { ...observation, observedAt: iso(epoch - 3000), availableAt: iso(epoch - 2000), referencePrice: d('1') }],
    selectionReceipt: null, calendarBindingReceipt: null,
  };
  refresh(v);
  return v;
}
function derivedSizing(v: PaperSelectionSizingInput): PaperSizingInput {
  const selection = v.selectionReceipt as PaperObservationSelection;
  if (selection.status !== 'selected') throw new Error('Test fixture requires selected observation');
  return { schema: 'gelt.paper-sizing-input.v1', policyId: v.policyId, config: v.config, mapping: v.mapping,
    ruleInput: v.ruleInput, ruleReceipt: v.ruleReceipt, portfolio: v.portfolio, lifecycleDisposition: v.lifecycleDisposition,
    observation: selection.observation, buyLimitPrice: v.buyLimitPrice, sellLimitPrice: v.sellLimitPrice, evaluationAt: v.evaluationAt };
}
function position(v: PaperSelectionSizingInput, cash: string, quantity: string): void {
  const s = v.portfolio.snapshot; s.revision = 1; s.cash = d(cash); s.quantity = d(quantity);
  s.history = [{ revision: 1, occurredAt: iso(epoch - 1000), stateKind: 'constructed_state', cash: { ...s.cash }, quantity: { ...s.quantity } }];
  refresh(v);
}
const rejected = { schema: 'gelt.paper-selection-sizing.v1', status: 'rejected', reason: 'invalid_input' };
const notComposed = { schema: 'gelt.paper-selection-sizing.v1', status: 'not_composed', reason: 'no_selected_observation' };
afterEach(() => vi.restoreAllMocks());

describe('constructed selection/calendar to existing paper sizing', () => {
  it('fits the253-bar/calendar input within256KiB and preserves exact original replay links', () => {
    const input = fixture(), raw = bytes(input), original = canonical(input), result = composePaperSelectionSizing(raw);
    expect(raw.length).toBeLessThanOrEqual(shadowRuleMaxBytes);
    expect(input.ruleInput.bars).toHaveLength(253); expect(input.calendar.sessions).toHaveLength(253);
    expect(result).toMatchObject({ status: 'composed', selectedIndex: 0, inputSha256: simulationDigest(input),
      sizingInputSha256: simulationDigest(derivedSizing(input)), runId: input.config.runId, decisionId: input.ruleReceipt.decisionId,
      effectAuthority: 'none', promotionAllowed: false, globalFirstObservation: 'not_established', durableFreeze: 'not_established',
      calendarAuthenticity: 'not_established', marketEvaluation: 'not_established' });
    expect(canonical(input)).toBe(original);
    if (result.status !== 'composed') throw new Error('Expected constructed composition');
    expect(result.proposal).toEqual(sizing.proposePaperSizing(bytes(derivedSizing(input))));
    expect(sizing.matchesPaperSizingProposal(bytes(derivedSizing(input)), result.proposal)).toBe(true);
    expect(matchesPaperSelectionSizing(raw, result)).toBe(true); expect(run(input)).toEqual(result);
    expect(result.selectionId).toBe((input.selectionReceipt as { selectionId: string }).selectionId);
    expect(result.calendarBindingId).toBe((input.calendarBindingReceipt as { bindingId: string }).bindingId);
  });

  it('calls the existing sizer exactly once with the exact chosen observation, never the later cheap quote', () => {
    const input = fixture(), spy = vi.spyOn(sizing, 'proposePaperSizing');
    const result = run(input); expect(result.status).toBe('composed'); expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual(bytes(derivedSizing(input)));
    expect(JSON.parse(spy.mock.calls[0][0].toString()).observation.referencePrice.value).toBe('100');
  });
  it('retains the first unaffordable quote rather than sizing a later affordable quote', () => {
    const input = fixture('base', 'target_long', '100000'); input.buyLimitPrice = d('100050'); input.sellLimitPrice = d('99950');
    const spy = vi.spyOn(sizing, 'proposePaperSizing'), result = run(input);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'composed', selectedIndex: 0,
      proposal: { inputValidation: 'valid', outcome: 'abstain', reason: 'no_buy_lot_fits', quantity: null, effectAuthority: 'none' } });
    const later = { ...derivedSizing(input), observation: input.observations[1], buyLimitPrice: d('1.0005'), sellLimitPrice: d('0.9995') };
    expect(sizing.proposePaperSizing(bytes(later)).outcome).toBe('proposal');
    expect(matchesPaperSelectionSizing(bytes(input), result)).toBe(true);
  });
  it.each(['limit', 'unknown', 'unsettled', 'overweight', 'offgrid'] as const)('keeps selection and one sizing call on %s refusal', kind => {
    const input = fixture();
    if (kind === 'limit') input.buyLimitPrice = d('1');
    if (kind === 'unknown') input.lifecycleDisposition = 'unknown';
    if (kind === 'unsettled') input.portfolio.state = 'unsettled';
    if (kind === 'overweight') position(input, '100.00000000', '100.000000000000000000');
    if (kind === 'offgrid') position(input, '9999.00000000', '0.500000000000000000');
    const spy = vi.spyOn(sizing, 'proposePaperSizing'), result = run(input);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'composed', selectedIndex: 0, proposal: { outcome: 'abstain', quantity: null, effectAuthority: 'none' } });
    if (result.status === 'composed') expect(result.observationSha256).toBe(simulationDigest(input.observations[0]));
  });
  it.each(['bad portfolio binding', 'unverified costs'] as const)('sanitizes selected semantic %s rejection after one call', kind => {
    const input = fixture();
    if (kind === 'bad portfolio binding') input.portfolio.snapshot.runId = '00000000-0000-4000-8000-000000000007';
    else { input.ruleInput.costs.status = 'unverified'; refresh(input); }
    const spy = vi.spyOn(sizing, 'proposePaperSizing'); expect(run(input)).toEqual(rejected); expect(spy).toHaveBeenCalledTimes(1);
  });
  it.each(['cash', 'exit', 'exit cap', 'rule abstain', 'rule unknown', 'stress'] as const)('preserves existing %s proposal semantics exactly', kind => {
    const input = fixture(kind === 'stress' ? 'stress' : 'base', ['cash', 'exit', 'exit cap'].includes(kind) ? 'target_cash' : 'target_long');
    if (kind === 'exit') position(input, '1000.00000000', '2.000000000000000000');
    if (kind === 'exit cap') position(input, '1000.00000000', '200.000000000000000000');
    if (kind === 'rule abstain') { input.ruleInput.bars = input.ruleInput.bars.slice(-1); input.calendar.sessions = input.calendar.sessions.slice(-1); refresh(input); }
    if (kind === 'rule unknown') { input.ruleInput.portfolio.state = 'unknown'; refresh(input); }
    const expected = sizing.proposePaperSizing(bytes(derivedSizing(input))), result = run(input);
    expect(expected.inputValidation).toBe('valid'); expect(result).toMatchObject({ status: 'composed', proposal: expected });
    expect(matchesPaperSelectionSizing(bytes(input), result)).toBe(true);
    if (kind === 'cash') expect(expected.reason).toBe('already_cash');
    if (kind === 'exit') expect(expected.side).toBe('sell');
    if (kind === 'exit cap') expect(expected.liquidationDisposition).toBe('holdings_retained_incomplete');
    if (kind === 'rule abstain') expect(expected.reason).toBe('rule_abstain');
    if (kind === 'rule unknown') expect(expected.reason).toBe('lifecycle_unknown');
  });

  it.each(['empty', 'stale', 'window'] as const)('does not size a valid %s no-selection receipt', kind => {
    const input = fixture();
    if (kind === 'empty') input.observations = [];
    if (kind === 'stale') input.evaluationAt = iso(epoch + 10000);
    if (kind === 'window') input.config.validThrough = iso(epoch - 1);
    refresh(input); expect((input.selectionReceipt as { status: string }).status).toBe('not_selected');
    const spy = vi.spyOn(sizing, 'proposePaperSizing'); expect(run(input)).toEqual(notComposed); expect(spy).not.toHaveBeenCalled();
    expect(matchesPaperSelectionSizing(bytes(input), notComposed)).toBe(false);
  });
  it('still requires calendar binding for no-selection and does not certify sizing semantics on that branch', () => {
    const input = fixture(); input.observations = []; refresh(input);
    input.portfolio.snapshot.runId = '00000000-0000-4000-8000-000000000007';
    const spy = vi.spyOn(sizing, 'proposePaperSizing'); expect(run(input)).toEqual(notComposed);
    input.calendarBindingReceipt = rejected; expect(run(input)).toEqual(rejected); expect(spy).not.toHaveBeenCalled();
  });

  const stale: [string, (v: PaperSelectionSizingInput) => void][] = [
    ['selection', v => { v.selectionReceipt = { ...(v.selectionReceipt as object), selectedIndex: 1 }; }],
    ['selected price', v => { v.observations[0].referencePrice = d('1'); }],
    ['batch suffix', v => { v.observations.pop(); }],
    ['evaluation', v => { v.evaluationAt = iso(epoch + 1); }],
    ['source', v => { v.config.sourceCommit = 'b'.repeat(40); }],
    ['calendar receipt', v => { v.calendarBindingReceipt = { ...(v.calendarBindingReceipt as object), lastSessionOrdinal: 999 }; }],
    ['middle calendar', v => { v.calendar.sessions[100].closedAt = iso(Date.parse(v.calendar.sessions[100].closedAt) - 1); }],
    ['rule receipt', v => { v.ruleReceipt.decisionId = `shadow-decision-${'0'.repeat(64)}`; }],
    ['unverified input', v => { v.ruleInput.data.eligibility = 'unverified'; refresh(v); }],
    ['market input', v => { v.ruleInput.data.classification = 'market_shadow_input'; refresh(v); }],
  ];
  it.each(stale)('rejects %s mismatch before sizing', (_name, change) => {
    const input = fixture(); change(input); const spy = vi.spyOn(sizing, 'proposePaperSizing');
    expect(run(input)).toEqual(rejected); expect(spy).not.toHaveBeenCalled();
  });
  it('refuses receipts from a different shared context even when each is valid elsewhere', () => {
    const input = fixture(), other = fixture('stress'); input.selectionReceipt = other.selectionReceipt;
    const spy = vi.spyOn(sizing, 'proposePaperSizing'); expect(run(input)).toEqual(rejected);
    input.selectionReceipt = fixture().selectionReceipt; input.calendarBindingReceipt = other.calendarBindingReceipt;
    expect(run(input)).toEqual(rejected); expect(spy).not.toHaveBeenCalled();
  });

  it.each(['observation', 'quantity', 'quantityQuantum', 'cap', 'callback', 'sizer', 'enabled', 'runId'])('rejects added root selector/effect field %s', field => {
    const input = fixture(), spy = vi.spyOn(sizing, 'proposePaperSizing');
    expect(run({ ...input, [field]: true })).toEqual(rejected); expect(spy).not.toHaveBeenCalled();
  });
  it('refuses extra receipt fields and nested candidate branch filters', () => {
    const input = fixture(), spy = vi.spyOn(sizing, 'proposePaperSizing');
    input.selectionReceipt = { ...(input.selectionReceipt as object), costFilter: true }; expect(run(input)).toEqual(rejected);
    refresh(input); Object.assign(input.observations[0], { availableQuantity: d('100') });
    expect(run(input)).toEqual(rejected); expect(spy).not.toHaveBeenCalled();
  });
  it('preserves selected decimal metadata and detaches the nested proposal', () => {
    const input = fixture(); input.observations[0].referencePrice = d('100.000000000000000001'); refresh(input);
    // Adverse rounding exceeds the old100.05 limit by one price unit; preserve
    // that refusal, then use an explicit compatible limit for proposal metadata.
    expect(run(input)).toMatchObject({ status: 'composed', proposal: { outcome: 'abstain', reason: 'limit_incompatible' } });
    input.buyLimitPrice = d('100.06');
    const raw = bytes(input), result = composePaperSelectionSizing(raw); expect(result.status).toBe('composed');
    if (result.status !== 'composed') throw new Error('Expected constructed composition');
    const proposal = structuredClone(result.proposal); raw.fill(0); input.observations[0].referencePrice.value = '1';
    expect(result.proposal).toEqual(proposal);
    expect(result.proposal.hypothetical?.referenceMark).toEqual(d('100.000000000000000001'));
  });
  it.each(['compositionId', 'inputSha256', 'sizingInputSha256', 'selectionId', 'calendarBindingId', 'selectedIndex',
    'observationSha256', 'runId', 'sourceCommit', 'decisionId', 'evaluationAt', 'proposal', 'effectAuthority', 'extra'])('rejects outer result tampering: %s', field => {
    const input = bytes(fixture()), result = composePaperSelectionSizing(input);
    expect(matchesPaperSelectionSizing(input, { ...result, [field]: null })).toBe(false);
  });
  it('rejects nested quantity tampering and stale result after limits or portfolio changes', () => {
    const input = fixture(), result = run(input); expect(result.status).toBe('composed');
    if (result.status !== 'composed') throw new Error('Expected constructed composition');
    const modified = structuredClone(result); modified.proposal.quantity = d('1.000000000000000000');
    expect(matchesPaperSelectionSizing(bytes(input), modified)).toBe(false);
    input.buyLimitPrice = d('100.06'); expect(matchesPaperSelectionSizing(bytes(input), result)).toBe(false);
    const state = fixture(); state.lifecycleDisposition = 'unknown'; expect(matchesPaperSelectionSizing(bytes(state), result)).toBe(false);
  });
  it('refuses foreign namespaces, invalid decimal metadata and large history without truncation', () => {
    const input = fixture(), spy = vi.spyOn(sizing, 'proposePaperSizing');
    expect(run({ ...input, schema: 'gelt.paper-sizing-input.v1' })).toEqual(rejected);
    input.buyLimitPrice = { value: '1e3', precision: 3, scale: 0 }; expect(run(input)).toEqual(rejected);
    const large = fixture(); large.portfolio.snapshot.history = Array.from({ length: 1000 }, (_, index) => ({
      revision: index + 1, occurredAt: iso(epoch - 1000), stateKind: 'constructed_state',
      cash: d('10000.00000000'), quantity: d('0.000000000000000000'),
    })); large.portfolio.snapshot.revision = 1000; refresh(large);
    expect(bytes(large).length).toBeGreaterThan(shadowRuleMaxBytes); expect(run(large)).toEqual(rejected);
    expect(large.portfolio.snapshot.history).toHaveLength(1000); expect(spy).not.toHaveBeenCalled();
  });
  it.each([
    ['nonbuffer', 'text'], ['oversize', Buffer.alloc(shadowRuleMaxBytes + 1)], ['invalid JSON', Buffer.from('{')],
    ['UTF8', Buffer.from([0xff])], ['duplicate keys', Buffer.from('{"schema":1,"schema":2}')],
    ['depth', Buffer.from('['.repeat(17) + '0' + ']'.repeat(17))],
  ])('sanitizes %s before any sizing', (_name, raw) => {
    const spy = vi.spyOn(sizing, 'proposePaperSizing'); expect(composePaperSelectionSizing(raw as Buffer)).toEqual(rejected);
    expect(matchesPaperSelectionSizing(raw as Buffer, rejected)).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
});

