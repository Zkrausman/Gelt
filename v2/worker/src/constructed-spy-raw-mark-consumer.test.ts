import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { canonical } from './ledger-canonical.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import {
  projectConstructedSpyRawMark,
  type ConstructedSpyRawMarkResult,
} from './constructed-spy-raw-mark.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { sizingBindingPolicySchema } from './synthetic-mock-robinhood-contract.js';
import {
  executionPrice, simulationDigest, simulationRunSchema, snapshot, units,
  type SimulationRun,
} from './synthetic-simulation-economics.js';
import type { SpyDailyInputRequest } from './spy-daily-input-consistency.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (value: number) => new Date(value).toISOString();
const plus = (value: string, amount: number) => iso(Date.parse(value) + amount);
const decimal = (value: string) => ({
  value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0,
});
const roots: string[] = [];
const harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
let cleanupBlocked = false;

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(date + 'T00:00:00.000Z') + (daylight ? 4 : 5) * hour);
}

function dailyRequest(): SpyDailyInputRequest {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(sessionDate + 'T00:00:00.000Z') + day).toISOString().slice(0, 10);
    return {
      sessionDate, ordinal: 100 + index,
      dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate),
    };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const issuedAt = lastEnd;
  const receivedAt = plus(issuedAt, 1_000);
  const availableAt = plus(receivedAt, 1_000);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1',
    classification: 'constructed_offline_test',
    epochId: '33333333-3333-4333-8333-333333333333',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(availableAt, 1_000),
    current: {
      feed: 'iex', symbol: 'SPY', currency: 'USD', timeframe: '1Day', adjustment: 'all', asof: '2026-01-01',
      requestStart: calendar[0].dayStartsAt, requestEnd: plus(lastEnd, -1),
      issuedAt, receivedAt, availableAt, calendar,
      bars: calendar.map((row, index) => ({
        providerTimestamp: row.dayStartsAt, adjustedClose: decimal(index === 252 ? '2.00' : '1.00'),
      })),
    },
    predecessor: null,
    revision: 0,
  };
}

function config(evaluationAt: string): SimulationRun {
  return simulationRunSchema.parse({
    version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD',
    currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: decimal('20'), quantity: decimal('0') },
    costs: { commissionPerOrder: decimal('0.01'), spreadFraction: decimal('0'), slippageFraction: decimal('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 960_000, maxObservationAgeMs: 5_000,
    validThrough: plus(evaluationAt, hour), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  });
}

function rawMarkBytes(dailyText: string, run: SimulationRun,
  portfolio: { snapshot: ReturnType<typeof snapshot>; state: 'settled' | 'unsettled' }, evaluationAt: string): Buffer {
  const daily = JSON.parse(dailyText) as SpyDailyInputRequest;
  return Buffer.from(canonical({
    schema: 'gelt.constructed-spy-mark-g05-input.v1',
    classification: 'constructed_offline_test',
    dailyRequestText: dailyText,
    consumer: {
      config: run,
      portfolio,
      lifecycleDisposition: 'settled',
      evaluationAt,
      controls: { passiveSha256: 'c'.repeat(64), cashAssumptionSha256: 'd'.repeat(64) },
    },
    mark: {
      schema: 'gelt.constructed-spy-raw-trade.v1',
      classification: 'constructed_offline_test',
      source: 'supplied_fixture',
      feed: 'iex',
      symbol: 'SPY',
      currency: 'USD',
      priceBasis: 'unadjusted_trade',
      tradeId: 'trade-1',
      price: decimal('3'),
      providerTimestamp: plus(daily.decisionAt, 100),
      receivedAt: plus(daily.decisionAt, 150),
      availableAt: plus(daily.decisionAt, 200),
    },
  }), 'utf8');
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
  for (const harness of closing) {
    try { await harness.close(); } catch (error) { failures.push(error); }
  }
  vi.unstubAllEnvs();
  if (failures.length > 0) {
    cleanupBlocked = true;
    throw new Error('synthetic raw-mark consumer cleanup unsettled; disposable roots retained');
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('binds the callback-owned raw mark to actual durable G05 evidence across fill, stop, and readonly reopen', async () => {
  const dailyText = canonical(dailyRequest());
  const daily = JSON.parse(dailyText) as SpyDailyInputRequest;
  let now = Date.parse(daily.decisionAt) + 1_000;
  const evaluationAt = iso(now);
  const run = config(evaluationAt);
  const setupDecoy = {
    snapshot: snapshot(run, units(decimal('19'), 8), units(run.genesis.quantity, 18), []),
    state: 'settled' as const,
  };
  const setupBytes = rawMarkBytes(dailyText, run, setupDecoy, evaluationAt);
  const setupResult = projectConstructedSpyRawMark(setupBytes);
  if (setupResult.status !== 'projected') throw new Error('constructed raw-mark setup projection unavailable');
  const setupManifest = parseCandidateShadowManifest(setupResult.projection.manifestText);
  const policy = sizingBindingPolicySchema.parse({
    schema: 'gelt.synthetic-sizing-binding-policy.v1',
    version: 1,
    classification: 'constructed_offline_test',
    runId: run.runId,
    sourceCommit: run.sourceCommit,
    configSha256: simulationDigest(run),
    sizingPolicyId: shadowSizingPolicyId,
    quantityQuantum: decimal('0.01'),
    buyLimitPrice: decimal('3'),
    sellLimitPrice: decimal('3'),
    candidate: setupManifest,
  });

  let producerCalls = 0;
  let latest: Extract<ConstructedSpyRawMarkResult, { status: 'projected' }> | undefined;
  const harness = createSyntheticOrderHarness(() => now, {
    applicationMock: true,
    simulationRun: {
      config: run,
      sizingBinding: {
        policy,
        producer: context => {
          producerCalls++;
          const callbackBytes = rawMarkBytes(dailyText, context.config, context.portfolio, iso(now));
          const result = projectConstructedSpyRawMark(callbackBytes);
          if (result.status !== 'projected' || result.projection.manifestText !== setupResult.projection.manifestText) {
            throw new Error('callback-owned constructed raw-mark projection unavailable');
          }
          latest = result;
          return {
            inputBytes: Buffer.from(result.projection.ruleInputText, 'utf8'),
            receipt: result.projection.ruleReceipt,
            observation: result.projection.observation,
          };
        },
      },
    },
  });
  harnesses.push(harness);
  roots.push(dirname(dirname(harness.path)));

  const port = await harness.start();
  const request = async (active: ReturnType<typeof createSyntheticOrderHarness>, operation: string, body: unknown = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/synthetic-orders/' + operation, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + active.auth.bearer,
        'x-gelt-session': active.auth.session,
        'x-gelt-session-expires': String(active.auth.expiresAt),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };

  expect((await request(harness, 'resume')).status).toBe(200);
  const prepared = await harness.previewSizingBound();
  if ('noOrder' in prepared) throw new Error('expected constructed synthetic proposal');
  expect(prepared.terms.order.side).toBe('buy');
  expect(prepared.terms.order.requestedQuantity).toEqual(decimal('1.660000000000000000'));
  expect(producerCalls).toBe(1);
  expect(latest).toBeDefined();
  expect(latest!.markRecord.price).toEqual(decimal('3'));
  expect(latest!.projection.observation.referencePrice).toEqual(decimal('3'));
  expect(JSON.parse(latest!.projection.ruleInputText).bars[252].adjustedClose).toEqual(decimal('2.00'));
  expect(latest!.originalMarkPersistence).toBe('not_performed_by_this_api');

  const confirmation = await request(harness, 'confirm', {
    confirmationToken: prepared.confirmationToken,
    termsHash: prepared.termsHash,
  });
  expect(confirmation.status).toBe(200);
  const intentId = confirmation.body.value.intentId as string;
  const beforeFill = await request(harness, 'history', { candidateDispatchId: intentId });
  expect(beforeFill.body.value.view.candidateId).toBe(candidateShadowId(setupManifest));
  expect(beforeFill.body.value.view.decision.reason).toBe('positive_return');

  const durable = harness.mockStore!.readCandidateShadow(intentId)!;
  expect(latest).toBeDefined();
  const callbackConsumer = JSON.parse(latest!.projectionInputText).consumer;
  expect(callbackConsumer.config).toEqual(durable.input.config);
  expect(callbackConsumer.portfolio).toEqual(durable.input.portfolio);
  expect(callbackConsumer.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(callbackConsumer.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(durable.input.observation.referencePrice).toEqual(decimal('3'));
  expect(durable.input.observation.evidenceSha256).toBe(latest!.markEvidenceSha256);
  expect(durable.input.ruleReceipt).toEqual(latest!.projection.ruleReceipt);
  expect(durable.input.ruleInput).toEqual(JSON.parse(latest!.projection.ruleInputText));
  expect(durable.proposal).toMatchObject({
    outcome: 'proposal',
    side: 'buy',
    quantity: decimal('1.660000000000000000'),
    ruleDecisionId: latest!.projection.ruleReceipt.decisionId,
  });
  expect(durable.candidate).toEqual(setupManifest);
  expect(canonical(durable.input)).not.toContain('dailyRequestText');
  expect(canonical(durable.input)).not.toContain('trade-1');

  now += 100;
  const execution = {
    version: 2 as const,
    executionId: randomUUID(),
    receiptId: randomUUID(),
    runId: run.runId,
    configSha256: simulationDigest(run),
    decisionId: latest!.projection.ruleReceipt.decisionId,
    quantity: prepared.terms.order.requestedQuantity,
    price: executionPrice(run, 'buy', decimal('3')),
    fee: run.costs.commissionPerOrder,
    currency: 'USD' as const,
    observation: {
      referencePrice: decimal('3'),
      observedAt: iso(now),
      availableAt: iso(now),
      evidenceSha256: 'f'.repeat(64),
    },
  };
  expect(execution.quantity).toEqual(decimal('1.660000000000000000'));
  expect(execution.price).toEqual(decimal('3.00000000'));
  expect(execution.fee).toEqual(decimal('0.01'));
  harness.mockStore!.observeExecution(intentId, execution);
  expect((await request(harness, 'reconcile')).status).toBe(200);
  const afterFill = await request(harness, 'history', { candidateDispatchId: intentId });
  expect(afterFill.body.value.view.simulatedOrder.executions).toHaveLength(1);
  expect(afterFill.body.value.view.portfolio.snapshot.quantity).toEqual(execution.quantity);
  expect(afterFill.body.value.view.portfolio.snapshot.cash).toEqual(decimal('15.01000000'));

  const fixedHistory = afterFill.body.value;
  const durableAfterFill = harness.mockStore!.readCandidateShadow(intentId)!;
  expect(durableAfterFill.input).toEqual(durable.input);
  expect(durableAfterFill.order.executions).toHaveLength(1);
  expect(durableAfterFill.portfolio.snapshot.cash).toEqual(decimal('15.01000000'));
  expect(durableAfterFill.portfolio.snapshot.quantity).toEqual(decimal('1.660000000000000000'));
  const portfolioAfterFill = harness.mockStore!.portfolio();
  harness.haltSizingBound();
  await expect(harness.previewSizingBound()).rejects.toThrow();
  await expect(harness.confirmSizingBound({
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).rejects.toThrow();
  expect((await request(harness, 'history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(harness.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  const priorProducerCalls = producerCalls;

  await harness.close();
  const reopened = harness.reopen();
  harnesses.push(reopened);
  expect(reopened.mockStore!.sizingBoundReadOnly).toBe(true);
  const reopenedPort = await reopened.start();
  const reopenedRequest = async (operation: string, body: unknown = {}) => {
    const response = await fetch('http://127.0.0.1:' + reopenedPort + '/v1/synthetic-orders/' + operation, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + reopened.auth.bearer,
        'x-gelt-session': reopened.auth.session,
        'x-gelt-session-expires': String(reopened.auth.expiresAt),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(reopened.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  expect((await reopenedRequest('resume')).status).toBe(409);
  expect((await reopenedRequest('preview', {})).status).toBe(409);
  expect((await reopenedRequest('confirm', {
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).status).toBe(409);
  await expect(reopened.previewSizingBound()).rejects.toThrow();
  await expect(reopened.confirmSizingBound({
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).rejects.toThrow();
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(reopened.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  expect(reopened.mockStore!.portfolio()).toEqual(portfolioAfterFill);
  expect(producerCalls).toBe(priorProducerCalls);
  expect(durableAfterFill.input.observation.evidenceSha256).toBe(latest!.markEvidenceSha256);
}, 20_000);
