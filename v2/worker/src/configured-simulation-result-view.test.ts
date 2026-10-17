import { describe, expect, it } from 'vitest';
import { projectConfiguredSimulationResult } from './configured-simulation-result-view.js';
import {
  simulationDigest, snapshot, type SimulationRun, type SimulationSnapshot,
} from './synthetic-simulation-economics.js';
import { simulationSnapshotSchema as recordedSchema } from './simulation-view-contract.js';
import { simulationViewTestFixture } from './fixtures/simulation-view.js';

// Every identity, balance, hash and lifecycle declaration below is constructed.
const d = (value: string) => ({ value, scale: value.split('.')[1]?.length ?? 0, precision: value.replace('.', '').length });
interface Input {
  schema: 'gelt.constructed-result-view-input.v1';
  config: SimulationRun;
  portfolio: { snapshot: SimulationSnapshot; state: 'settled' | 'unsettled' };
  lifecycle?: null | { runId: string; configSha256: string; snapshotSha256: string; disposition: 'settled' | 'unknown' };
}
function fixture(): Input {
  const config: SimulationRun = {
    version: 2, runId: '00000000-0000-4000-8000-000000000008', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: d('10.00000000'), quantity: d('0.000000000000000000') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0.0002'), slippageFraction: d('0.0003') },
    calibrationEvidenceSha256: '1'.repeat(64), maxDecisionAgeMs: 1000, maxObservationAgeMs: 1000,
    validThrough: '2026-10-17T00:00:00.000Z', rounding: 'adverse-price-8-cumulative-cash-8.v1',
  };
  const value: Input = { schema: 'gelt.constructed-result-view-input.v1', config,
    portfolio: { snapshot: snapshot(config, 1000000000n, 0n, []), state: 'settled' } };
  bindLifecycle(value);
  return value;
}
function bindLifecycle(value: Input, disposition: 'settled' | 'unknown' = 'settled'): void {
  const s = value.portfolio.snapshot;
  value.lifecycle = { runId: s.runId, configSha256: s.configSha256,
    snapshotSha256: simulationDigest(s), disposition };
}
function projected(input: unknown) {
  const result = projectConfiguredSimulationResult(input);
  expect(result.status).toBe('projected');
  if (result.status !== 'projected') throw new Error('expected constructed projection');
  return result.view;
}
const rejected = { status: 'rejected', reason: 'invalid_constructed_input' };

describe('constructed configured result projection', () => {
  it('preserves exact identity and reported balances without claiming run acceptance', () => {
    const input = fixture(), s = input.portfolio.snapshot, view = projected(input);
    expect(view).toEqual({
      schema: 'gelt.constructed-result-view.v1', source: s.source,
      classification: 'constructed_offline_test', evidence: 'caller_supplied_constructed_snapshot',
      runId: input.config.runId, sourceCommit: input.config.sourceCommit,
      instrumentId: input.config.instrumentId, currency: input.config.currency,
      configSha256: simulationDigest(input.config), genesisSha256: simulationDigest(input.config.genesis),
      historySha256: s.historySha256, snapshotSha256: simulationDigest(s), revision: 0,
      reportedPortfolio: { state: 'settled', cash: s.cash, quantity: s.quantity },
      reportedLifecycle: 'settled', completion: 'unestablished', durableReplay: 'not_established',
      provenance: 'not_authenticated', marketEvaluation: 'not_established',
    });
    expect(projectConfiguredSimulationResult(input)).toEqual(projectConfiguredSimulationResult(structuredClone(input)));
  });

  const mismatches: [string, (input: Input) => void][] = [
    ['run', v => { v.portfolio.snapshot.runId = '00000000-0000-4000-8000-000000000009'; }],
    ['config commitment', v => { v.portfolio.snapshot.configSha256 = '2'.repeat(64); }],
    ['genesis commitment', v => { v.portfolio.snapshot.genesisSha256 = '2'.repeat(64); }],
    ['source commit', v => { v.config.sourceCommit = 'b'.repeat(40); }],
    ['config costs', v => { v.config.costs.commissionPerOrder = d('0.02'); }],
    ['changed genesis', v => { v.config.genesis.cash = d('9.00'); }],
    ['classification', v => { v.portfolio.snapshot.classification = 'declared_market_uncalibrated'; }],
    ['lifecycle run', v => { v.lifecycle!.runId = '00000000-0000-4000-8000-000000000009'; }],
    ['lifecycle config', v => { v.lifecycle!.configSha256 = '2'.repeat(64); }],
    ['lifecycle snapshot', v => { v.lifecycle!.snapshotSha256 = '2'.repeat(64); }],
    ['stale lifecycle cash', v => { v.portfolio.snapshot.cash = d('9.00'); }],
    ['stale lifecycle quantity', v => { v.portfolio.snapshot.quantity = d('1.00'); }],
    ['stale lifecycle revision', v => { v.portfolio.snapshot.revision = 1; }],
    ['stale lifecycle history', v => { v.portfolio.snapshot.historySha256 = '2'.repeat(64); }],
  ];
  it.each(mismatches)('rejects %s mismatch rather than joining unrelated reports', (_name, mutate) => {
    const input = fixture(); mutate(input);
    expect(projectConfiguredSimulationResult(input)).toEqual(rejected);
  });

  it.each(['runId', 'configSha256', 'genesisSha256'] as const)('checks %s without a lifecycle declaration', key => {
    const input = fixture(); delete input.lifecycle;
    input.portfolio.snapshot[key] = key === 'runId'
      ? '00000000-0000-4000-8000-000000000009' : '2'.repeat(64);
    expect(projectConfiguredSimulationResult(input)).toEqual(rejected);
  });

  it('rejects a consistently rebound non-constructed classification', () => {
    const input = fixture();
    input.config.classification = input.portfolio.snapshot.classification = 'declared_market_uncalibrated';
    input.portfolio.snapshot.configSha256 = simulationDigest(input.config); bindLifecycle(input);
    expect(projectConfiguredSimulationResult(input)).toEqual(rejected);
  });

  it.each(['settled', 'unsettled'] as const)('preserves unknown lifecycle with %s portfolio', state => {
    const input = fixture(); input.portfolio.state = state; bindLifecycle(input, 'unknown');
    const view = projected(input);
    expect(view.reportedPortfolio.state).toBe(state);
    expect(view.reportedLifecycle).toBe('unknown');
    expect(view.completion).toBe('unestablished');
  });
  it('does not clear unsettled portfolio from a settled lifecycle declaration', () => {
    const input = fixture(); input.portfolio.state = 'unsettled';
    const view = projected(input);
    expect(view.reportedPortfolio.state).toBe('unsettled');
    expect(view.reportedLifecycle).toBe('settled'); expect(view.completion).toBe('unestablished');
  });
  it.each(['omitted', 'null'] as const)('keeps %s lifecycle unestablished', mode => {
    const input = fixture();
    if (mode === 'omitted') delete input.lifecycle; else input.lifecycle = null;
    expect(projected(input).reportedLifecycle).toBe('unestablished');
    expect(projected(input).completion).toBe('unestablished');
  });

  it('keeps precision beyond JS numbers and detaches both directions without mutating input', () => {
    const input = fixture(), s = input.portfolio.snapshot;
    s.revision = 1; s.historySha256 = '3'.repeat(64);
    s.cash = d('12345678901234567890.123456789012345678');
    s.quantity = d('0.000000000000000001'); bindLifecycle(input);
    const before = structuredClone(input), view = projected(input);
    expect(input).toEqual(before);
    expect(view.reportedPortfolio.cash).toEqual(s.cash);
    expect(view.reportedPortfolio.quantity).toEqual(s.quantity);
    s.cash.value = '0'; s.quantity.scale = 0;
    expect(view.reportedPortfolio.cash).toEqual(before.portfolio.snapshot.cash);
    view.reportedPortfolio.quantity.value = '0';
    expect(input.portfolio.snapshot.quantity.value).toBe('0.000000000000000001');
  });
  it('accepts frozen data, with no input writes', () => {
    const input = fixture();
    function freeze(value: object) {
      for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
      Object.freeze(value);
    }
    freeze(input); expect(projectConfiguredSimulationResult(input).status).toBe('projected');
  });
  it('never promotes zero holdings or a caller history hash to completed/durable truth', () => {
    const input = fixture(); input.portfolio.snapshot.cash = d('0.00');
    input.portfolio.snapshot.revision = 1000; input.portfolio.snapshot.historySha256 = 'f'.repeat(64);
    bindLifecycle(input); const view = projected(input);
    expect(view.completion).toBe('unestablished'); expect(view.durableReplay).toBe('not_established');
    expect(view.provenance).toBe('not_authenticated'); expect(view.marketEvaluation).toBe('not_established');
    for (const key of ['decisionId', 'orderId', 'receiptId', 'fills', 'fees', 'price', 'pnl', 'timeline', 'authority']) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it.each([
    ['missing', undefined], ['null', null], ['array', []], ['text', 'secret-input'],
    ['paper proposal', { schema: 'gelt.paper-sizing-proposal.v1', authority: 'dispatch' }],
  ])('rejects %s rather than converting namespaces', (_name, input) => {
    expect(projectConfiguredSimulationResult(input)).toEqual(rejected);
  });
  it('preserves the existing valid recorded fixture and rejects it as configured input', () => {
    const legacy = simulationViewTestFixture(), before = structuredClone(legacy);
    expect(recordedSchema.safeParse(legacy).success).toBe(true);
    expect(projectConfiguredSimulationResult(legacy)).toEqual(rejected);
    expect(legacy).toEqual(before);
  });
  it.each([
    ['config', 'instrumentId', 'robinhood-official-mcp'], ['config', 'currency', 'EUR'],
    ['snapshot', 'instrumentId', 'SPY'], ['snapshot', 'currency', 'EUR'],
    ['snapshot', 'source', 'gelt-recorded-mock-view-v1'], ['snapshot', 'revision', -1],
    ['snapshot', 'revision', 1001], ['snapshot', 'historySha256', 'not-a-hash'],
    ['snapshot', 'cash', { value: 'NaN', scale: 0, precision: 3 }],
    ['snapshot', 'quantity', { value: '0.1', scale: 18, precision: 2 }],
    ['lifecycle', 'disposition', 'completed'], ['lifecycle', 'disposition', 'unestablished'],
    ['lifecycle', 'snapshotSha256', 'A'.repeat(64)],
  ])('rejects malformed %s.%s', (target, key, value) => {
    const input = fixture();
    const object = target === 'snapshot' ? input.portfolio.snapshot : target === 'config' ? input.config : input.lifecycle;
    Object.assign(object!, { [key]: value });
    expect(projectConfiguredSimulationResult(input)).toEqual(rejected);
  });
  it.each(['root', 'config', 'portfolio', 'snapshot', 'cash', 'lifecycle'])('rejects extra authority at %s with sanitized output', target => {
    const input = fixture();
    const object = target === 'root' ? input : target === 'config' ? input.config
      : target === 'portfolio' ? input.portfolio : target === 'snapshot' ? input.portfolio.snapshot
        : target === 'cash' ? input.portfolio.snapshot.cash : input.lifecycle;
    Object.assign(object!, { authority: 'PRIVATE_MARKER_DO_NOT_ECHO' });
    const result = projectConfiguredSimulationResult(input);
    expect(result).toEqual(rejected); expect(JSON.stringify(result)).not.toContain('PRIVATE_MARKER');
  });
});
