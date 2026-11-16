import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { canonical } from './ledger-canonical.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { projectConstructedSpyG05, type ProjectedConstructedSpyG05 } from './constructed-spy-g05-projection.js';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { sizingBindingPolicySchema } from './synthetic-mock-robinhood-contract.js';
import {
  executionPrice, simulationDigest, simulationRunSchema, snapshot, units,
  type SimulationRun,
} from './synthetic-simulation-economics.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (time: number) => new Date(time).toISOString();
const plus = (value: string, delta: number) => iso(Date.parse(value) + delta);
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const bytes = (value: unknown) => Buffer.from(canonical(value), 'utf8');
const roots: string[] = [];
const harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
let cleanupBlocked = false;

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(`${date}T00:00:00.000Z`) + (daylight ? 4 : 5) * hour);
}

function dailyRequest() {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(`${sessionDate}T00:00:00.000Z`) + day).toISOString().slice(0, 10);
    return { sessionDate, ordinal: 100 + index, dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate) };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const issuedAt = lastEnd;
  const receivedAt = plus(issuedAt, 1_000);
  const availableAt = plus(receivedAt, 1_000);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1' as const,
    classification: 'constructed_offline_test' as const,
    epochId: '33333333-3333-4333-8333-333333333333',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(availableAt, 1_000),
    current: {
      feed: 'iex' as const, symbol: 'SPY' as const, currency: 'USD' as const, timeframe: '1Day' as const,
      adjustment: 'all' as const, asof: '2026-01-01', requestStart: calendar[0].dayStartsAt,
      requestEnd: plus(lastEnd, -1), issuedAt, receivedAt, availableAt, calendar,
      bars: calendar.map((row, index) => ({ providerTimestamp: row.dayStartsAt, adjustedClose: d(index === 252 ? '2.00' : '1.00') })),
    }, predecessor: null, revision: 0 as const,
  };
}

function config(evaluationAt: string): SimulationRun {
  return simulationRunSchema.parse({
    version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD', currency: 'USD',
    classification: 'constructed_offline_test', genesis: { cash: d('20'), quantity: d('0') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0'), slippageFraction: d('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 960_000, maxObservationAgeMs: 5_000,
    validThrough: plus(evaluationAt, hour), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  });
}

function projectionInput(daily: ReturnType<typeof dailyRequest>, run: SimulationRun,
  portfolio: { snapshot: ReturnType<typeof snapshot>; state: 'settled' | 'unsettled' }, evaluationAt: string) {
  return {
    schema: 'gelt.constructed-spy-g05-projection-input.v1',
    dailyRequestText: canonical(daily),
    consumer: {
      config: run, portfolio, lifecycleDisposition: 'settled',
      observation: { referencePrice: d('3'), observedAt: plus(daily.decisionAt, 100),
        availableAt: plus(daily.decisionAt, 200), evidenceSha256: 'c'.repeat(64) },
      evaluationAt,
      controls: { passiveSha256: 'd'.repeat(64), cashAssumptionSha256: 'e'.repeat(64) },
      markBasis: 'constructed_raw_reference', corporateActionState: 'constructed_none',
    },
  };
}

function project(daily: ReturnType<typeof dailyRequest>, run: SimulationRun,
  portfolio: { snapshot: ReturnType<typeof snapshot>; state: 'settled' | 'unsettled' }, evaluationAt: string): ProjectedConstructedSpyG05 {
  const result = projectConstructedSpyG05(bytes(projectionInput(daily, run, portfolio, evaluationAt)));
  if (result.status !== 'projected') throw new Error('synthetic G05 projection unavailable');
  return result;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
});
afterEach(async () => {
  if (cleanupBlocked) return;
  const closing = harnesses.splice(0);
  const failures: unknown[] = [];
  for (const h of closing) { try { await h.close(); } catch (error) { failures.push(error); } }
  vi.unstubAllEnvs();
  if (failures.length > 0) {
    cleanupBlocked = true;
    throw new Error('synthetic fixture cleanup unsettled; disposable roots retained');
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('connects a constructed projection to one modeled fill, reconciled durable evidence, stop, and protected read-only reopen', async () => {
  const daily = dailyRequest();
  let now = Date.parse(daily.decisionAt) + 1_000;
  const evaluationAt = iso(now);
  const run = config(evaluationAt);
  const genesis = { snapshot: snapshot(run, units(run.genesis.cash, 8), units(run.genesis.quantity, 18), []), state: 'settled' as const };
  // This setup projection identifies a fixed candidate only. The producer below
  // recomputes with the independently supplied owner-read portfolio.
  const setupProjection = project(daily, run, genesis, evaluationAt);
  const manifest = parseCandidateShadowManifest(setupProjection.manifestText);
  const policy = sizingBindingPolicySchema.parse({
    schema: 'gelt.synthetic-sizing-binding-policy.v1', version: 1, classification: 'constructed_offline_test',
    runId: run.runId, sourceCommit: run.sourceCommit, configSha256: simulationDigest(run),
    sizingPolicyId: shadowSizingPolicyId, quantityQuantum: d('0.01'), buyLimitPrice: d('3'), sellLimitPrice: d('3'), candidate: manifest,
  });
  let producerCalls = 0;
  let latestProjection: ProjectedConstructedSpyG05 | undefined;
  const harness = createSyntheticOrderHarness(() => now, { applicationMock: true, simulationRun: {
    config: run,
    sizingBinding: { policy, producer: context => {
      producerCalls++;
      latestProjection = project(daily, context.config, context.portfolio, iso(now));
      if (latestProjection.manifestText !== setupProjection.manifestText) throw new Error('frozen candidate changed');
      return {
        inputBytes: Buffer.from(latestProjection.ruleInputText, 'utf8'),
        receipt: latestProjection.ruleReceipt,
        observation: latestProjection.observation,
      };
    } },
  } });
  harnesses.push(harness);
  roots.push(dirname(dirname(harness.path)));

  const port = await harness.start();
  const request = async (active: typeof harness, operation: string, body: unknown = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/synthetic-orders/${operation}`, {
      method: 'POST', headers: { authorization: `Bearer ${active.auth.bearer}`, 'x-gelt-session': active.auth.session,
        'x-gelt-session-expires': String(active.auth.expiresAt), 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  expect((await request(harness, 'resume')).status).toBe(200);
  const prepared = await harness.previewSizingBound();
  if ('noOrder' in prepared) throw new Error('expected synthetic proposal');
  expect(prepared.terms.order.side).toBe('buy');
  expect(producerCalls).toBe(1);
  expect(latestProjection?.observation.referencePrice).toEqual(d('3'));
  expect(JSON.parse(latestProjection!.ruleInputText).bars[252].adjustedClose).toEqual(d('2.00'));

  const confirmation = await request(harness, 'confirm', {
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  });
  expect(confirmation.status).toBe(200);
  const intentId = confirmation.body.value.intentId as string;
  const beforeFill = await request(harness, 'history', { candidateDispatchId: intentId });
  expect(beforeFill.body.value.view.candidateId).toBe(candidateShadowId(manifest));
  expect(beforeFill.body.value.view.decision.reason).toBe('positive_return');

  const durable = harness.mockStore!.readCandidateShadow(intentId)!;
  expect(durable.input.ruleInput).toEqual(JSON.parse(latestProjection!.ruleInputText));
  expect(durable.input.ruleReceipt).toEqual(latestProjection!.ruleReceipt);
  expect(durable.proposal).toMatchObject({ outcome: 'proposal', side: 'buy',
    quantity: prepared.terms.order.requestedQuantity, ruleDecisionId: latestProjection!.ruleReceipt.decisionId });
  expect(durable.candidate).toEqual(manifest);
  expect(canonical(durable.input)).not.toContain('dailyRequestText');
  expect(durable.input.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(durable.input.observation.referencePrice).toEqual(d('3'));

  now += 100;
  const execution = {
    version: 2 as const, executionId: randomUUID(), receiptId: randomUUID(), runId: run.runId,
    configSha256: simulationDigest(run), decisionId: latestProjection!.ruleReceipt.decisionId,
    quantity: prepared.terms.order.requestedQuantity,
    price: executionPrice(run, 'buy', d('3')), fee: run.costs.commissionPerOrder, currency: 'USD' as const,
    observation: { referencePrice: d('3'), observedAt: iso(now), availableAt: iso(now), evidenceSha256: 'f'.repeat(64) },
  };
  expect(execution.quantity).toEqual(d('1.660000000000000000'));
  harness.mockStore!.observeExecution(intentId, execution);
  expect((await request(harness, 'reconcile')).status).toBe(200);
  const afterFill = await request(harness, 'history', { candidateDispatchId: intentId });
  expect(afterFill.body.value.view.simulatedOrder.executions).toHaveLength(1);
  expect(afterFill.body.value.view.simulatedOrder.executions[0]).toMatchObject({
    quantity: execution.quantity, fee: execution.fee, price: execution.price,
  });
  expect(afterFill.body.value.view.portfolio.snapshot.quantity).toEqual(execution.quantity);
  expect(afterFill.body.value.view.portfolio.snapshot.cash).toEqual(d('15.01000000'));
  expect(afterFill.body.value.view.decision.inputSha256).toBe(durable.input.ruleReceipt.inputSha256);
  expect(afterFill.body.value.view.marketEvaluation).toBe('not_established');
  expect(afterFill.body.value.view.effectAuthority).toBe('none');
  const fillsAndPortfolio = harness.mockStore!.portfolio();
  expect(fillsAndPortfolio.snapshot.cash).toEqual(afterFill.body.value.view.portfolio.snapshot.cash);
  expect(fillsAndPortfolio.snapshot.quantity).toEqual(execution.quantity);
  const durableAfterFill = harness.mockStore!.readCandidateShadow(intentId)!;
  expect(durableAfterFill.input).toEqual(durable.input);
  expect(durableAfterFill.proposal).toEqual(durable.proposal);
  expect(durableAfterFill.candidate).toEqual(durable.candidate);
  expect(durableAfterFill.order.executions).toHaveLength(1);
  expect(durableAfterFill.portfolio.snapshot.cash).toEqual(d('15.01000000'));
  expect(durableAfterFill.portfolio.snapshot.quantity).toEqual(d('1.660000000000000000'));

  const fixedHistory = afterFill.body.value;
  harness.haltSizingBound();
  await expect(harness.previewSizingBound()).rejects.toThrow();
  await expect(harness.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
  expect((await request(harness, 'history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(harness.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  const priorCallCount = producerCalls;
  await harness.close();
  const reopened = harness.reopen();
  harnesses.push(reopened);
  expect(reopened.mockStore!.sizingBoundReadOnly).toBe(true);
  const reopenedPort = await reopened.start();
  const reopenedRequest = async (operation: string, body: unknown = {}) => {
    const response = await fetch(`http://127.0.0.1:${reopenedPort}/v1/synthetic-orders/${operation}`, {
      method: 'POST', headers: { authorization: `Bearer ${reopened.auth.bearer}`, 'x-gelt-session': reopened.auth.session,
        'x-gelt-session-expires': String(reopened.auth.expiresAt), 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(reopened.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  expect((await reopenedRequest('resume')).status).toBe(409);
  expect((await reopenedRequest('preview', {})).status).toBe(409);
  expect((await reopenedRequest('confirm', { confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).status).toBe(409);
  await expect(reopened.previewSizingBound()).rejects.toThrow();
  await expect(reopened.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(reopened.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  expect(producerCalls).toBe(priorCallCount);
  expect(reopened.mockStore!.portfolio()).toEqual(fillsAndPortfolio);
}, 20_000);
