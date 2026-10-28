import { expect, it } from 'vitest';
import { canonical, digest } from './ledger-canonical.js';
import { convertPAMR } from './pamr-reference-artifact.js';
import { pamrRecipe } from './paper-conversion-contract.js';
import { snapshot, units, simulationDigest, type SimulationRun } from './synthetic-simulation-economics.js';
import { derivePAMRConsumerPrefix, pamrConsumerPolicySha256, evaluatePAMRConsumer, proposePAMRConsumer, matchesPAMRConsumerDecision, matchesPAMRConsumerProposal } from './pamr-consumer-adapter.js';
import { pamrConsumerPolicyId, type PAMRConsumerInput, type PAMRConsumerProposal } from './pamr-consumer-contract.js';
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const now = Date.parse('2026-10-28T15:00:00.000Z');
const time = (n: number) => new Date(n).toISOString();
const hash = (domain: string, value: unknown) => digest(canonical({ domain, value }));
function artifactText(rows: string[][], assets = ['SYNTH-RISK', 'SYNTH-RESERVE']): string {
  const result = convertPAMR(canonical({ schema: 'gelt.pamr-constructed-request.v1', classification: 'constructed_offline_test', recipe: pamrRecipe, assets, rows }));
  if (result.status !== 'computed') throw new Error('fixture conversion rejected');
  return canonical(result.artifact);
}
function fixture(rows = [['2', '1'], ['0.5', '1']], cash = '20', quantity = '0'): PAMRConsumerInput {
  const config: SimulationRun = {
    version: 2, runId: '11111111-1111-4111-8111-111111111111', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: d('20'), quantity: d('0') }, costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0'), slippageFraction: d('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 1000, maxObservationAgeMs: 1000,
    validThrough: time(now + 1000), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  };
  const portfolio = { snapshot: snapshot(config, units(d(cash), 8), units(d(quantity), 18), cash === '20' && quantity === '0' ? [] : [{ hypothetical: true }]), state: 'settled' as const };
  const observation = { referencePrice: d('1'), observedAt: time(now - 100), availableAt: time(now - 100), evidenceSha256: 'c'.repeat(64) };
  const decisionAt = time(now - 200), prefixAvailableAt = time(now - 201), evaluationAt = time(now);
  const artifact = artifactText(rows);
  return {
    schema: 'gelt.pamr-consumer-input.v1', policyId: pamrConsumerPolicyId, artifactText: artifact,
    config, portfolio, lifecycleDisposition: 'settled', inputPortfolioUnknown: false,
    decisionAt, prefixAvailableAt, evaluationAt, observation,
    quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'),
    binding: {
      ...derivePAMRConsumerPrefix(artifact), runId: config.runId, sourceCommit: config.sourceCommit,
      configSha256: simulationDigest(config), policySha256: pamrConsumerPolicySha256, portfolioSnapshotSha256: simulationDigest(portfolio.snapshot),
      costsSha256: hash('gelt.pamr-consumer.costs.v1', config.costs), observationSha256: hash('gelt.pamr-consumer.observation.v1', observation),
      clockSha256: hash('gelt.pamr-consumer.clock.v1', { decisionAt, prefixAvailableAt, evaluationAt }),
    },
  };
}
function proposal(input: PAMRConsumerInput): PAMRConsumerProposal {
  const result = proposePAMRConsumer(canonical(input));
  expect(result.status).toBe('computed');
  if (result.status !== 'computed') throw new Error(result.reason);
  return result.value;
}
it('matches the independent 0,1,0 strategy trace and entry/exit cash oracles', () => {
  const rows = [['2', '1'], ['0.5', '1'], ['2', '1']];
  const values = rows.map((_, i) => proposal(fixture(rows.slice(0, i + 1))).decision);
  expect(values.map(v => v.riskyWeight)).toEqual(['0/1', '1/1', '0/1']);
  expect(values.map(v => v.targetExposure?.value)).toEqual(['0.000000000000000000', '0.250000000000000000', '0.000000000000000000']);
  const entry = proposal(fixture(rows.slice(0, 2)));
  expect(entry.action).toMatchObject({ outcome: 'proposal', side: 'buy', quantity: { value: '4.990000000000000000' }, hypothetical: { modeledPostCash: { value: '15.00000000' } } });
  const exit = proposal(fixture(rows, '15', '4.99'));
  expect(exit.action).toMatchObject({ outcome: 'proposal', side: 'sell', quantity: { value: '4.990000000000000000' }, hypothetical: { modeledPostCash: { value: '19.98000000' }, modeledPostQuantity: { value: '0.000000000000000000' } } });
});
it('matches the independent equal-row one-eighth target and fee arithmetic', () => {
  const p = proposal(fixture([['1', '1']]));
  expect(p.decision).toMatchObject({ riskyWeight: '1/2', targetExposure: { value: '0.125000000000000000' }, binding: { expectedPreviousPrefixSha256: null } });
  expect(p.action).toMatchObject({ quantity: { value: '2.490000000000000000' }, hypothetical: { modeledPostCash: { value: '17.50000000' } } });
});
it('rejects every foreign binding component, including previous prefix and ordinal', () => {
  const original = fixture();
  for (const key of Object.keys(original.binding) as (keyof PAMRConsumerInput['binding'])[]) {
    const v = structuredClone(original);
    (v.binding as Record<string, unknown>)[key] = key === 'ordinal' ? 1 : '0'.repeat(64);
    expect(proposePAMRConsumer(canonical(v)).status).toBe('rejected');
  }
});
it('rejects unsupported profiles and complete-artifact tampering', () => {
  const texts = [artifactText([['1', '1']], ['SYNTH-OTHER', 'SYNTH-RESERVE']), artifactText([['1', '1.0']])];
  for (const text of texts) { const v = fixture(); v.artifactText = text; expect(proposePAMRConsumer(canonical(v)).status).toBe('rejected'); }
  const changes = [(a: any) => { a.steps.reverse(); }, (a: any) => { a.steps[1] = a.steps[0]; }, (a: any) => { a.weightsFinal = ['0/1', '1/1']; }, (a: any) => { a.input.rows[0][0] = '3'; }, (a: any) => { a.dispatchAllowed = true; }];
  for (const change of changes) { const v = fixture(), a = JSON.parse(v.artifactText); change(a); v.artifactText = canonical(a); expect(proposePAMRConsumer(canonical(v)).status).toBe('rejected'); }
});
it('rejects changed config, costs, portfolio and observation against the original binding', () => {
  const changes = [(v: PAMRConsumerInput) => { v.config.runId = '22222222-2222-4222-8222-222222222222'; }, (v: PAMRConsumerInput) => { v.config.costs.commissionPerOrder = d('0.02'); }, (v: PAMRConsumerInput) => { v.portfolio.snapshot.cash = d('19'); }, (v: PAMRConsumerInput) => { v.observation.referencePrice = d('2'); }];
  for (const change of changes) { const v = fixture(); change(v); expect(proposePAMRConsumer(canonical(v)).status).toBe('rejected'); }
});
it('abstains for UNKNOWN and unsettled hypotheses', () => {
  const changes = [(v: PAMRConsumerInput) => { v.lifecycleDisposition = 'unknown'; }, (v: PAMRConsumerInput) => { v.inputPortfolioUnknown = true; }, (v: PAMRConsumerInput) => { v.portfolio.state = 'unsettled'; }];
  for (const change of changes) { const v = fixture(); change(v); const p = proposal(v); expect(p.decision.decision).toBe('abstain'); expect(p.action).toMatchObject({ outcome: 'abstain', side: null, quantity: null }); }
});
it('abstains for future, stale and noncausal clock hypotheses even when their hashes agree', () => {
  const changes = [(v: PAMRConsumerInput) => { v.evaluationAt = time(now + 1001); }, (v: PAMRConsumerInput) => { v.prefixAvailableAt = v.decisionAt; }, (v: PAMRConsumerInput) => { v.decisionAt = time(now + 1); }, (v: PAMRConsumerInput) => { v.observation.observedAt = time(now - 2000); v.observation.availableAt = v.observation.observedAt; }];
  for (const change of changes) {
    const v = fixture(); change(v);
    v.binding.clockSha256 = hash('gelt.pamr-consumer.clock.v1', { decisionAt: v.decisionAt, prefixAvailableAt: v.prefixAvailableAt, evaluationAt: v.evaluationAt });
    v.binding.observationSha256 = hash('gelt.pamr-consumer.observation.v1', v.observation);
    expect(proposal(v).decision).toMatchObject({ decision: 'abstain', reason: 'invalid_clock', targetExposure: null });
  }
});
it('retains overweight abstention and fixed cap, grid and fee exit restrictions', () => {
  const overweight = fixture(undefined, '15', '4.99'); overweight.observation.referencePrice = d('2');
  overweight.binding.observationSha256 = hash('gelt.pamr-consumer.observation.v1', overweight.observation);
  expect(proposal(overweight).action.reason).toBe('positive_target_overweight_unsupported');
  const rows = [['2', '1'], ['0.5', '1'], ['2', '1']], capped = fixture(rows, '15', '4.99');
  capped.observation.referencePrice = d('3'); capped.sellLimitPrice = d('3');
  capped.binding.observationSha256 = hash('gelt.pamr-consumer.observation.v1', capped.observation);
  expect(proposal(capped).action.reason).toBe('cash_exit_exceeds_cap');
  expect(proposal(fixture(rows, '15', '0.005')).action.reason).toBe('cash_exit_not_on_grid');
  expect(proposal(fixture(rows, '0', '1')).action.reason).toBe('cash_exit_fee_cash_unavailable');
});
it('replays deterministically without claiming consumption or external facts', () => {
  const v = fixture(), text = canonical(v), p = proposal(v), decision = evaluatePAMRConsumer(text);
  expect(proposal(v)).toEqual(p);
  expect(p).toMatchObject({ effectAuthority: 'none', authenticity: 'not_established', consumption: 'not_performed', facts: 'self_consistent_pure_inputs_only' });
  expect(matchesPAMRConsumerProposal(text, canonical(p))).toBe(true);
  expect(decision.status === 'computed' && matchesPAMRConsumerDecision(text, canonical(decision.value))).toBe(true);
  const { proposalId: ignored, ...body } = structuredClone(p); body.action.quantity = d('1.000000000000000000');
  const forged = { ...body, proposalId: `pamr-consumer-proposal-${hash('gelt.pamr-consumer.proposal.v1', body)}` };
  expect(matchesPAMRConsumerProposal(text, canonical(forged))).toBe(false);
  expect(matchesPAMRConsumerProposal(text, JSON.stringify(p).replace('"effectAuthority":"none"', '"effectAuthority":"live"'))).toBe(false);
});
it('rejects malformed public input and output boundaries without leaking source text', () => {
  expect(proposePAMRConsumer({ artifactText: 'private' })).toEqual({ status: 'rejected', reason: 'invalid_input' });
  expect(proposePAMRConsumer('{"private":"sentinel","private":1}')).toEqual({ status: 'rejected', reason: 'invalid_input' });
  const v = fixture(); expect(matchesPAMRConsumerProposal(canonical(v), {})).toBe(false);
  expect(proposePAMRConsumer(canonical({ ...v, unexpected: true })).status).toBe('rejected');
});
