import { expect, it } from 'vitest';
import { calculateLongCashSizing, type LongCashSizingInput } from './long-cash-sizing-kernel.js';
import { snapshot, units, type SimulationRun } from './synthetic-simulation-economics.js';
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const now = Date.parse('2026-10-28T15:00:00.000Z');
const time = (n: number) => new Date(n).toISOString();
function fixture(cash = '20', quantity = '0'): LongCashSizingInput {
  const config: SimulationRun = { version: 2, runId: '11111111-1111-4111-8111-111111111111', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: d('20'), quantity: d('0') }, costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0'), slippageFraction: d('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 1000, maxObservationAgeMs: 1000,
    validThrough: time(now + 1000), rounding: 'adverse-price-8-cumulative-cash-8.v1' };
  return { config, portfolio: { snapshot: snapshot(config, units(d(cash), 8), units(d(quantity), 18), []), state: 'settled' },
    lifecycleDisposition: 'settled', inputPortfolioUnknown: false, decision: 'target_long', decisionAt: time(now - 200),
    targetExposure: d('0.25'), observation: { referencePrice: d('1'), observedAt: time(now - 100), availableAt: time(now - 100), evidenceSha256: 'c'.repeat(64) },
    quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'), evaluationAt: time(now) };
}
it('matches independent full-fill cash/quarter-ceiling/grid arithmetic without any rule receipt', () => {
  const x = calculateLongCashSizing(fixture());
  expect(x).toMatchObject({ outcome: 'proposal', side: 'buy', reason: 'buy_proposal',
    quantity: { value: '4.990000000000000000' },
    hypothetical: { modeledPostCash: { value: '15.00000000' }, modeledPostQuantity: { value: '4.990000000000000000' }, limitWithinCeiling: true } });
  // (20 - .01) / 4 = 4.9975, floored to .01 quantity grid -> 4.99.
  expect(x.attainment).toBe('limit_quantized_underallocation');
});
it('matches independent half-weight quarter scaling (one-eighth target)', () => {
  const v = fixture(); v.targetExposure = d('0.125');
  expect(calculateLongCashSizing(v)).toMatchObject({ quantity: { value: '2.490000000000000000' }, hypothetical: { modeledPostCash: { value: '17.50000000' } } });
});
it('cash exit uses observed portfolio and a second actual fee hypothesis', () => {
  const v = fixture('15', '4.99'); v.decision = 'target_cash'; v.targetExposure = d('0');
  expect(calculateLongCashSizing(v)).toMatchObject({ outcome: 'proposal', side: 'sell', attainment: 'cash_exit',
    quantity: { value: '4.990000000000000000' }, hypothetical: { modeledPostCash: { value: '19.98000000' }, modeledPostQuantity: { value: '0.000000000000000000' } } });
});
it('retains explicit positive-overweight abstention rather than inventing partial sells', () => {
  const v = fixture('15', '4.99'); v.observation.referencePrice = d('2');
  expect(calculateLongCashSizing(v)).toMatchObject({ outcome: 'abstain', reason: 'positive_target_overweight_unsupported', side: null, quantity: null });
});
it('retains lifecycle/portfolio uncertainty and stale observation abstentions', () => {
  const a = fixture(); a.lifecycleDisposition = 'unknown'; expect(calculateLongCashSizing(a).reason).toBe('lifecycle_unknown');
  const b = fixture(); b.inputPortfolioUnknown = true; expect(calculateLongCashSizing(b).reason).toBe('lifecycle_unknown');
  const c = fixture(); c.portfolio.state = 'unsettled'; expect(calculateLongCashSizing(c).reason).toBe('unsettled_portfolio');
  const e = fixture(); e.evaluationAt = time(now + 1001); expect(calculateLongCashSizing(e).reason).toBe('invalid_observation');
});
it('preserves cash-exit cap/grid rejection and no-action states', () => {
  const v = fixture('15', '4.99'); v.decision = 'target_cash'; v.targetExposure = d('0'); v.observation.referencePrice = d('3'); v.sellLimitPrice = d('3');
  expect(calculateLongCashSizing(v).reason).toBe('cash_exit_exceeds_cap');
  const g = fixture('15', '0.005'); g.decision = 'target_cash'; g.targetExposure = d('0');
  expect(calculateLongCashSizing(g).reason).toBe('cash_exit_not_on_grid');
  const n = fixture(); n.decision = 'target_cash'; n.targetExposure = d('0'); expect(calculateLongCashSizing(n).reason).toBe('already_cash');
});
