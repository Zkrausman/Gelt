import { describe, expect, it } from 'vitest';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import { canonical } from './ledger-canonical.js';
import { shadowRuleId, shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { simulationDigest } from './synthetic-simulation-economics.js';
import { bindPaperCalendar, matchesPaperCalendarBinding, type PaperCalendarBindingInput } from './paper-calendar-binding.js';

// All records/calendars in this suite are constructed; no market admission.
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const epoch = Date.parse('2026-10-14T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();
const bars = (decision: 'target_long' | 'target_cash' = 'target_long') => Array.from({ length: 253 }, (_, i) => ({
  sessionOrdinal: i + 100, closedAt: iso(epoch - 120000 - (252 - i) * 86400000),
  availableAt: iso(epoch - 120000 - (252 - i) * 86400000), adjustedClose: d(decision === 'target_long' ? i === 252 ? '101' : '100' : i === 252 ? '99' : '100'),
}));

function fixture(scenarioId: 'base' | 'stress' = 'base', decision: 'target_long' | 'target_cash' = 'target_long'): PaperCalendarBindingInput {
  const spread = scenarioId === 'base' ? d('0.0002') : d('0.001');
  const slippage = scenarioId === 'base' ? d('0.0003') : d('0.0015');
  const mapping: PaperCalendarBindingInput['mapping'] = {
    schema: 'gelt.paper-instrument-map.v1',
    underlying: { symbol: 'SPY', listingVenue: 'NYSE Arca', currency: 'USD', quantityUnit: 'whole SPY shares' },
    signal: { provider: 'Alpaca-data-v2', feed: 'IEX', timeframe: '1Day', adjustment: 'all', asof: '2025-10-14',
      entitySha256: '4'.repeat(64), calendarSha256: '5'.repeat(64), productSha256: '6'.repeat(64), sourceSha256: '7'.repeat(64) },
    internal: { instrumentId: 'SYNTH-RH-USD', currency: 'USD' },
  };
  const mappingSha256 = simulationDigest(mapping);
  const config: PaperCalendarBindingInput['config'] = {
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
  const ruleInput: PaperCalendarBindingInput['ruleInput'] = {
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
  const calendar: PaperCalendarBindingInput['calendar'] = {
    symbol: 'SPY', sha256: '', sessions: ruleInput.bars.map(bar => ({
      providerTimestamp: iso(Date.parse(bar.closedAt) - 1000), sessionOrdinal: bar.sessionOrdinal,
      closedAt: bar.closedAt, completedAt: bar.availableAt, completed: true, completionEvidenceSha256: 'e'.repeat(64),
    })),
  };
  calendar.sha256 = alpacaSessionCalendarDigest(calendar);
  mapping.signal.calendarSha256 = calendar.sha256; config.mappingSha256 = simulationDigest(mapping);
  ruleInput.instrument.calendarSha256 = calendar.sha256;
  return { schema: 'gelt.paper-calendar-binding-input.v1', policyId: config.policyId, config, mapping,
    ruleInput, ruleReceipt: evaluateShadowRule(bytes(ruleInput)), calendar };
}
const bytes = (value: unknown) => Buffer.from(canonical(value));
const run = (value: unknown) => bindPaperCalendar(bytes(value));
const refreshRule = (v: PaperCalendarBindingInput) => { v.ruleReceipt = evaluateShadowRule(bytes(v.ruleInput)); };
function refreshCalendar(v: PaperCalendarBindingInput): void {
  v.calendar.sha256 = alpacaSessionCalendarDigest(v.calendar);
  v.mapping.signal.calendarSha256 = v.calendar.sha256; v.config.mappingSha256 = simulationDigest(v.mapping);
  v.ruleInput.instrument.calendarSha256 = v.calendar.sha256; refreshRule(v);
}
const rejected = { schema: 'gelt.paper-calendar-binding.v1', status: 'rejected', reason: 'invalid_input' };

describe('constructed exact supplied paper calendar binding', () => {
  it('binds every original bar and receipt with distinct existing calendar and canonical hashes', () => {
    const input = fixture(), original = canonical(input), result = run(input);
    expect(result).toMatchObject({ status: 'bound', barCount: 253, firstSessionOrdinal: 100, lastSessionOrdinal: 352,
      lastClosedAt: input.ruleInput.bars[252].closedAt, inputSha256: simulationDigest(input),
      calendarSha256: alpacaSessionCalendarDigest(input.calendar), calendarInputSha256: simulationDigest(input.calendar),
      barsSha256: simulationDigest(input.ruleInput.bars), ruleReceiptSha256: simulationDigest(input.ruleReceipt),
      calendarAuthenticity: 'not_established', effectAuthority: 'none', promotionAllowed: false });
    expect(input.calendar.sha256).not.toEqual(simulationDigest(input.calendar));
    expect(matchesPaperCalendarBinding(bytes(input), result)).toBe(true);
    expect(run(input)).toEqual(result); expect(canonical(input)).toEqual(original);
  });
  it.each(['base', 'stress'] as const)('preserves %s context and cash outcome', scenario => {
    const input = fixture(scenario, 'target_cash');
    expect(input.ruleReceipt.decision).toBe('target_cash'); expect(run(input).status).toBe('bound');
  });
  it.each(['unknown', 'unverified costs', 'warmup'] as const)('binds %s abstention without promotion', kind => {
    const input = fixture();
    if (kind === 'unknown') input.ruleInput.portfolio.state = 'unknown';
    if (kind === 'unverified costs') input.ruleInput.costs.status = 'unverified';
    if (kind === 'warmup') { input.ruleInput.bars = input.ruleInput.bars.slice(-1); input.calendar.sessions = input.calendar.sessions.slice(-1); }
    refreshCalendar(input); expect(input.ruleReceipt.decision).toBe('abstain');
    const result = run(input); expect(result).toMatchObject({ status: 'bound', effectAuthority: 'none', promotionAllowed: false });
    expect(matchesPaperCalendarBinding(bytes(input), result)).toBe(true);
  });
  it('rejects empty windows and refuses calendar subset or surplus', () => {
    const empty = fixture(); empty.ruleInput.bars = []; empty.calendar.sessions = []; refreshCalendar(empty);
    expect(run(empty)).toEqual(rejected);
    const subset = fixture(); subset.calendar.sessions.shift(); refreshCalendar(subset); expect(run(subset)).toEqual(rejected);
    const surplus = fixture(); surplus.ruleInput.bars.shift(); refreshRule(surplus); expect(run(surplus)).toEqual(rejected);
  });
  const changes: [string, (v: PaperCalendarBindingInput) => void][] = [
    ['same ordinal wrong last close', v => { v.calendar.sessions[252].closedAt = iso(epoch - 120001); refreshCalendar(v); }],
    ['middle close mismatch', v => { v.calendar.sessions[100].closedAt = iso(Date.parse(v.calendar.sessions[100].closedAt) - 1); refreshCalendar(v); }],
    ['same close wrong ordinal', v => { v.calendar.sessions[252].sessionOrdinal++; refreshCalendar(v); }],
    ['duplicate ordinal', v => { v.calendar.sessions[100].sessionOrdinal--; refreshCalendar(v); }],
    ['matched ordinal gap', v => { v.calendar.sessions[252].sessionOrdinal++; v.ruleInput.bars[252].sessionOrdinal++; refreshCalendar(v); }],
    ['reversal', v => { v.calendar.sessions.reverse(); v.ruleInput.bars.reverse(); refreshCalendar(v); }],
    ['provider reversal', v => { v.calendar.sessions[100].providerTimestamp = v.calendar.sessions[99].providerTimestamp; refreshCalendar(v); }],
    ['matched duplicate close', v => { v.calendar.sessions[100].closedAt = v.calendar.sessions[99].closedAt; v.ruleInput.bars[100].closedAt = v.calendar.sessions[99].closedAt; refreshCalendar(v); }],
    ['provider after close', v => { v.calendar.sessions[100].providerTimestamp = iso(Date.parse(v.calendar.sessions[100].closedAt) + 1); refreshCalendar(v); }],
    ['completion before close', v => { v.calendar.sessions[100].completedAt = iso(Date.parse(v.calendar.sessions[100].closedAt) - 1); refreshCalendar(v); }],
    ['completion after availability', v => { v.calendar.sessions[100].completedAt = iso(Date.parse(v.ruleInput.bars[100].availableAt) + 1); refreshCalendar(v); }],
    ['availability after decision', v => { v.ruleInput.bars[252].availableAt = iso(epoch); refreshRule(v); }],
    ['noncompleted', v => { Object.assign(v.calendar.sessions[100], { completed: false }); refreshCalendar(v); }],
    ['negative provider time', v => { v.calendar.sessions[0].providerTimestamp = '1969-12-31T23:59:59.999Z'; refreshCalendar(v); }],
    ['invalid completion evidence', v => { v.calendar.sessions[100].completionEvidenceSha256 = 'bad'; refreshCalendar(v); }],
    ['calendar digest', v => { v.calendar.sha256 = '0'.repeat(64); }],
    ['canonical recipe substitution', v => { v.calendar.sha256 = simulationDigest(v.calendar); }],
    ['symbol', v => { v.calendar.symbol = 'OTHER'; refreshCalendar(v); }],
    ['mapping digest', v => { v.config.mappingSha256 = '0'.repeat(64); }],
    ['mapping calendar', v => { v.mapping.signal.calendarSha256 = '0'.repeat(64); v.config.mappingSha256 = simulationDigest(v.mapping); }],
    ['rule calendar', v => { v.ruleInput.instrument.calendarSha256 = '0'.repeat(64); refreshRule(v); }],
    ['runId', v => { v.config.runId = '00000000-0000-4000-8000-000000000007'; }],
    ['sourceCommit', v => { v.config.sourceCommit = 'b'.repeat(40); }],
    ['receipt', v => { v.ruleReceipt.decisionId = `shadow-decision-${'0'.repeat(64)}`; }],
    ['rule price without replay', v => { v.ruleInput.bars[0].adjustedClose = d('2'); }],
    ['market classification', v => { v.ruleInput.data.classification = 'market_shadow_input'; refreshRule(v); }],
    ['unverified data', v => { v.ruleInput.data.eligibility = 'unverified'; refreshRule(v); }],
    ['instrument', v => { v.ruleInput.instrument.id = 'OTHER'; refreshRule(v); }],
    ['currency', v => { v.ruleInput.instrument.currency = 'EUR'; refreshRule(v); }],
    ['schedule', v => { v.ruleInput.policy.scheduleSha256 = '0'.repeat(64); refreshRule(v); }],
    ['age', v => { v.ruleInput.policy.maxAgeMs++; refreshRule(v); }],
    ['exposure', v => { v.ruleInput.policy.exposureCap = d('0.94'); refreshRule(v); }],
  ];
  it.each(changes)('rejects complete input for %s', (_name, change) => {
    const input = fixture(); change(input); expect(run(input)).toEqual(rejected);
    expect(matchesPaperCalendarBinding(bytes(input), run(input))).toBe(false);
  });
  it('accepts equality for provider/close/completed/availability/decision boundaries', () => {
    const input = fixture(), last = input.calendar.sessions[252], bar = input.ruleInput.bars[252];
    last.providerTimestamp = last.closedAt; last.completedAt = input.ruleInput.decisionAt;
    bar.availableAt = input.ruleInput.decisionAt; refreshCalendar(input);
    expect(run(input).status).toBe('bound');
  });
  it('commits precise adjustedClose metadata without an official close equality assumption', () => {
    const input = fixture(); input.ruleInput.bars[100].adjustedClose = d('123456789.000000000000000001'); refreshRule(input);
    const raw = bytes(input), result = bindPaperCalendar(raw); expect(result.status).toBe('bound');
    raw.fill(0); expect(matchesPaperCalendarBinding(bytes(input), result)).toBe(true);
    input.ruleInput.bars[100].adjustedClose = d('123456789.0000000000000000010'); refreshRule(input);
    // More than18 fractional digits is schema-invalid, never silently rounded.
    expect(run(input)).toEqual(rejected);
  });
  it.each(['inputSha256', 'configSha256', 'mappingSha256', 'ruleInputSha256', 'ruleReceiptSha256', 'calendarSha256',
    'calendarInputSha256', 'barsSha256', 'bindingId', 'decisionId', 'barCount', 'firstSessionOrdinal', 'lastSessionOrdinal',
    'lastClosedAt', 'effectAuthority', 'promotionAllowed', 'extra'])('refuses result tampering: %s', field => {
    const input = bytes(fixture()), result = bindPaperCalendar(input);
    expect(matchesPaperCalendarBinding(input, { ...result, [field]: null })).toBe(false);
  });
  it('refuses old receipt after rehashed calendar or exact price metadata changes', () => {
    const input = fixture(), result = run(input);
    input.calendar.sessions[100].completionEvidenceSha256 = 'f'.repeat(64); refreshCalendar(input);
    expect(run(input).status).toBe('bound'); expect(matchesPaperCalendarBinding(bytes(input), result)).toBe(false);
    const price = fixture(); price.ruleInput.bars[100].adjustedClose = d('100.0'); refreshRule(price);
    expect(run(price).status).toBe('bound'); expect(matchesPaperCalendarBinding(bytes(price), result)).toBe(false);
  });
  it.each(['callback', 'enabled', 'evaluationAt', 'portfolio', 'acquisition'])('rejects extra root field %s', field => {
    expect(run({ ...fixture(), [field]: true })).toEqual(rejected);
  });
  it('rejects nested extras, foreign schemas and oversized calendar', () => {
    const nested = fixture(); Object.assign(nested.calendar.sessions[0], { officialClose: d('100') });
    expect(run(nested)).toEqual(rejected);
    const tooMany = fixture(); tooMany.calendar.sessions.push(tooMany.calendar.sessions[252]); refreshCalendar(tooMany);
    expect(run(tooMany)).toEqual(rejected);
    expect(run({ ...fixture(), schema: 'gelt.paper-observation-selection-input.v1' })).toEqual(rejected);
    expect(matchesPaperCalendarBinding(bytes(fixture()), { ...run(fixture()), schema: 'gelt.paper-observation-selection.v1' })).toBe(false);
  });
  it.each([
    ['nonbuffer', 'text'], ['oversize', Buffer.alloc(shadowRuleMaxBytes + 1)], ['invalid JSON', Buffer.from('{')],
    ['UTF8', Buffer.from([0xff])], ['duplicate keys', Buffer.from('{"schema":1,"schema":2}')],
    ['depth', Buffer.from('['.repeat(17) + '0' + ']'.repeat(17))],
  ])('sanitizes %s rejection', (_name, raw) => {
    expect(bindPaperCalendar(raw as Buffer)).toEqual(rejected);
    expect(matchesPaperCalendarBinding(raw as Buffer, rejected)).toBe(false);
  });
});

