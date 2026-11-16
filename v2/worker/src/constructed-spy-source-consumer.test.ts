import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { canonical } from './ledger-canonical.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { projectConstructedSpyG05, type ProjectedConstructedSpyG05 } from './constructed-spy-g05-projection.js';
import {
  ConstructedSpySourceStore, type ConstructedSpySourceOwner,
} from './constructed-spy-source-retention.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { sizingBindingPolicySchema } from './synthetic-mock-robinhood-contract.js';
import {
  executionPrice, simulationDigest, simulationRunSchema, snapshot, units,
  type SimulationRun,
} from './synthetic-simulation-economics.js';
import { storageFixture } from './storage-fixture.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (time: number) => new Date(time).toISOString();
const plus = (value: string, delta: number) => iso(Date.parse(value) + delta);
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const roots: string[] = [];
const harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
const sourceStores: ConstructedSpySourceStore[] = [];
let cleanupBlocked = false;

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(date + 'T00:00:00.000Z') + (daylight ? 4 : 5) * hour);
}

function dailyRequest() {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(sessionDate + 'T00:00:00.000Z') + day).toISOString().slice(0, 10);
    return { sessionDate, ordinal: 100 + index, dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate) };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const issuedAt = lastEnd, receivedAt = plus(issuedAt, 1_000), availableAt = plus(receivedAt, 1_000);
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
    },
    predecessor: null,
    revision: 0 as const,
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

function consumerInput(daily: ReturnType<typeof dailyRequest>, run: SimulationRun,
  portfolio: { snapshot: ReturnType<typeof snapshot>; state: 'settled' | 'unsettled' }, evaluationAt: string) {
  return {
    config: run, portfolio, lifecycleDisposition: 'settled' as const,
    observation: { referencePrice: d('3'), observedAt: plus(daily.decisionAt, 100),
      availableAt: plus(daily.decisionAt, 200), evidenceSha256: 'c'.repeat(64) },
    evaluationAt, controls: { passiveSha256: 'd'.repeat(64), cashAssumptionSha256: 'e'.repeat(64) },
    markBasis: 'constructed_raw_reference' as const, corporateActionState: 'constructed_none' as const,
  };
}

function sourceBytes(daily: ReturnType<typeof dailyRequest>, supplied: ReturnType<typeof consumerInput>): Buffer {
  return Buffer.from(canonical({
    schema: 'gelt.constructed-spy-g05-projection-input.v1',
    dailyRequestText: canonical(daily),
    consumer: supplied,
  }), 'utf8');
}

function project(daily: ReturnType<typeof dailyRequest>, run: SimulationRun,
  portfolio: { snapshot: ReturnType<typeof snapshot>; state: 'settled' | 'unsettled' }, evaluationAt: string): ProjectedConstructedSpyG05 {
  const result = projectConstructedSpyG05(sourceBytes(daily, consumerInput(daily, run, portfolio, evaluationAt)));
  if (result.status !== 'projected') throw new Error('synthetic G05 projection unavailable');
  return result;
}

function ownerFor(input: Buffer, projection: ProjectedConstructedSpyG05, daily: ReturnType<typeof dailyRequest>,
  run: SimulationRun): ConstructedSpySourceOwner {
  return {
    schema: 'gelt.constructed-spy-source-owner.v1',
    caseEpochId: daily.epochId,
    runId: run.runId,
    sourceCommit: run.sourceCommit,
    configSha256: simulationDigest(run),
    candidateId: candidateShadowId(parseCandidateShadowManifest(projection.manifestText)),
    projectionId: projection.projectionId,
    originalInputSha256: createHash('sha256').update(input).digest('hex'),
  };
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
  for (const harness of closing) { try { await harness.close(); } catch (error) { failures.push(error); } }
  for (const store of sourceStores.splice(0)) { try { store.close(); } catch (error) { failures.push(error); } }
  vi.unstubAllEnvs();
  if (failures.length > 0) {
    cleanupBlocked = true;
    throw new Error('synthetic source-consumer cleanup unsettled; disposable roots retained');
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('joins callback-owned original bytes to a modeled fill and actual durable consumer evidence across stop and readonly reopen', async () => {
  const daily = dailyRequest();
  let now = Date.parse(daily.decisionAt) + 1_000;
  const evaluationAt = iso(now);
  const run = config(evaluationAt);
  // A constructed setup-only decoy portfolio freezes the same candidate
  // manifest, but its complete projection differs from owner-read callback
  // context; the retained source must therefore come from the producer call.
  const setupDecoy = {
    snapshot: snapshot(run, units(d('19'), 8), units(run.genesis.quantity, 18), []),
    state: 'settled' as const,
  };
  const setupProjection = project(daily, run, setupDecoy, evaluationAt);
  const manifest = parseCandidateShadowManifest(setupProjection.manifestText);
  const policy = sizingBindingPolicySchema.parse({
    schema: 'gelt.synthetic-sizing-binding-policy.v1', version: 1, classification: 'constructed_offline_test',
    runId: run.runId, sourceCommit: run.sourceCommit, configSha256: simulationDigest(run),
    sizingPolicyId: shadowSizingPolicyId, quantityQuantum: d('0.01'), buyLimitPrice: d('3'), sellLimitPrice: d('3'), candidate: manifest,
  });
  const archiveRoot = storageFixture('constructed-spy-source-consumer-');
  roots.push(archiveRoot);
  let archive: ConstructedSpySourceStore | undefined;
  let retainedInput: Buffer | undefined;
  let retainedProjection: ProjectedConstructedSpyG05 | undefined;
  let retainedOwner: ConstructedSpySourceOwner | undefined;
  let producerCalls = 0;
  const harness = createSyntheticOrderHarness(() => now, { applicationMock: true, simulationRun: {
    config: run,
    sizingBinding: { policy, producer: context => {
      producerCalls++;
      // Capture the complete outer projection input from the actual callback
      // owner-read config and portfolio, not from the setup projection above.
      const supplied = consumerInput(daily, context.config, context.portfolio, iso(now));
      const callbackInput = sourceBytes(daily, supplied);
      retainedInput = callbackInput;
      const projected = projectConstructedSpyG05(callbackInput);
      if (projected.status !== 'projected' || projected.manifestText !== setupProjection.manifestText) {
        throw new Error('frozen candidate changed');
      }
      retainedProjection = projected;
      const callbackOwner = ownerFor(callbackInput, projected, daily, context.config);
      retainedOwner = callbackOwner;
      const writer = ConstructedSpySourceStore.create(archiveRoot, callbackOwner, callbackInput);
      archive = writer;
      sourceStores.push(writer);
      return {
        inputBytes: Buffer.from(projected.ruleInputText, 'utf8'),
        receipt: projected.ruleReceipt,
        observation: projected.observation,
      };
    } },
  } });
  harnesses.push(harness);
  roots.push(dirname(dirname(harness.path)));

  const port = await harness.start();
  const request = async (active: ReturnType<typeof createSyntheticOrderHarness>, operation: string, body: unknown = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/synthetic-orders/' + operation, {
      method: 'POST', headers: { authorization: 'Bearer ' + active.auth.bearer, 'x-gelt-session': active.auth.session,
        'x-gelt-session-expires': String(active.auth.expiresAt), 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  expect((await request(harness, 'resume')).status).toBe(200);
  const prepared = await harness.previewSizingBound();
  if ('noOrder' in prepared) throw new Error('expected synthetic proposal');
  expect(prepared.terms.order.side).toBe('buy');
  expect(producerCalls).toBe(1);
  expect(archive).toBeDefined();
  expect(retainedInput).toBeDefined();
  expect(retainedProjection).toBeDefined();
  expect(retainedOwner).toBeDefined();
  expect(retainedProjection!.projectionId).not.toBe(setupProjection.projectionId);
  expect(retainedProjection!.manifestText).toBe(setupProjection.manifestText);

  const confirmation = await request(harness, 'confirm', {
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  });
  expect(confirmation.status).toBe(200);
  const intentId = confirmation.body.value.intentId as string;
  const durable = harness.mockStore!.readCandidateShadow(intentId)!;
  const archived = archive!.read();
  expect(archived.originalInput).toEqual(retainedInput);
  expect(archived.projection.manifestText).toBe(durable.candidate ? canonical(durable.candidate) : '');
  expect(JSON.parse(archived.projection.ruleInputText)).toEqual(durable.input.ruleInput);
  expect(archived.projection.ruleReceipt).toEqual(durable.input.ruleReceipt);
  expect(archived.projection.observation).toEqual(durable.input.observation);
  expect(durable.input.ruleInput).toEqual(JSON.parse(retainedProjection!.ruleInputText));
  expect(durable.input.ruleReceipt).toEqual(retainedProjection!.ruleReceipt);
  const callbackOuter = JSON.parse(retainedInput!.toString('utf8'));
  expect(callbackOuter.consumer.config).toEqual(durable.input.config);
  expect(callbackOuter.consumer.portfolio).toEqual(durable.input.portfolio);
  expect(durable.input.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(durable.input.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(durable.proposal).toMatchObject({ outcome: 'proposal', side: 'buy',
    quantity: d('1.660000000000000000'), ruleDecisionId: retainedProjection!.ruleReceipt.decisionId });
  expect(durable.candidate).toEqual(manifest);

  now += 100;
  const execution = {
    version: 2 as const, executionId: randomUUID(), receiptId: randomUUID(), runId: run.runId,
    configSha256: simulationDigest(run), decisionId: retainedProjection!.ruleReceipt.decisionId,
    quantity: d('1.660000000000000000'),
    price: executionPrice(run, 'buy', d('3')), fee: run.costs.commissionPerOrder, currency: 'USD' as const,
    observation: { referencePrice: d('3'), observedAt: iso(now), availableAt: iso(now), evidenceSha256: 'f'.repeat(64) },
  };
  expect(execution.quantity).toEqual(d('1.660000000000000000'));
  harness.mockStore!.observeExecution(intentId, execution);
  expect((await request(harness, 'reconcile')).status).toBe(200);
  const afterFill = await request(harness, 'history', { candidateDispatchId: intentId });
  const durableAfterFill = harness.mockStore!.readCandidateShadow(intentId)!;
  expect(afterFill.body.value.view.simulatedOrder.executions).toHaveLength(1);
  expect(afterFill.body.value.view.simulatedOrder.executions[0]).toMatchObject({
    quantity: execution.quantity, fee: execution.fee, price: execution.price,
  });
  expect(afterFill.body.value.view.portfolio.snapshot.quantity).toEqual(execution.quantity);
  expect(afterFill.body.value.view.portfolio.snapshot.cash).toEqual(d('15.01000000'));
  expect(durableAfterFill.input).toEqual(durable.input);
  expect(durableAfterFill.proposal).toEqual(durable.proposal);
  expect(durableAfterFill.candidate).toEqual(durable.candidate);
  expect(durableAfterFill.order.executions).toHaveLength(1);
  expect(durableAfterFill.portfolio.snapshot.cash).toEqual(d('15.01000000'));
  expect(durableAfterFill.portfolio.snapshot.quantity).toEqual(execution.quantity);
  expect(archived.projection.projectionId).toBe(retainedProjection!.projectionId);
  expect(archived.projection.ruleInputText).toBe(retainedProjection!.ruleInputText);

  const fixedHistory = afterFill.body.value;
  harness.haltSizingBound();
  await expect(harness.previewSizingBound()).rejects.toThrow();
  expect((await request(harness, 'history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(harness.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  expect(archive!.read()).toEqual(archived);
  await expect(harness.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
  expect((await request(harness, 'history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(harness.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  expect(archive!.read()).toEqual(archived);
  expect(producerCalls).toBe(1);
  archive!.close();
  await harness.close();

  const reopened = harness.reopen();
  harnesses.push(reopened);
  const readonlyArchive = ConstructedSpySourceStore.reopen(archiveRoot, retainedOwner);
  sourceStores.push(readonlyArchive);
  const reopenedPort = await reopened.start();
  const reopenedRequest = async (operation: string, body: unknown = {}) => {
    const response = await fetch('http://127.0.0.1:' + reopenedPort + '/v1/synthetic-orders/' + operation, {
      method: 'POST', headers: { authorization: 'Bearer ' + reopened.auth.bearer, 'x-gelt-session': reopened.auth.session,
        'x-gelt-session-expires': String(reopened.auth.expiresAt), 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const replayed = readonlyArchive.read();
  const reopenedDurable = reopened.mockStore!.readCandidateShadow(intentId)!;
  expect(replayed.originalInput).toEqual(retainedInput);
  expect(replayed.projection.manifestText).toBe(canonical(reopenedDurable.candidate));
  expect(JSON.parse(replayed.projection.ruleInputText)).toEqual(reopenedDurable.input.ruleInput);
  expect(replayed.projection.ruleReceipt).toEqual(reopenedDurable.input.ruleReceipt);
  expect(reopenedDurable.input).toEqual(durableAfterFill.input);
  expect(reopenedDurable.proposal).toEqual(durableAfterFill.proposal);
  expect(reopenedDurable.order.executions).toEqual(durableAfterFill.order.executions);
  expect(reopenedDurable.portfolio.snapshot.cash).toEqual(d('15.01000000'));
  expect(reopenedDurable.portfolio.snapshot.quantity).toEqual(execution.quantity);
  const retainedOuter = JSON.parse(replayed.originalInput.toString('utf8'));
  expect(retainedOuter.consumer.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(retainedOuter.consumer.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(reopenedDurable.portfolio.snapshot.cash.value).toBe('15.01000000');
  expect((await reopenedRequest('resume')).status).toBe(409);
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(await reopened.mockStore!.readCandidateShadow(intentId)).toEqual(reopenedDurable);
  expect(readonlyArchive.read()).toEqual(replayed);
  expect((await reopenedRequest('preview', {})).status).toBe(409);
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(await reopened.mockStore!.readCandidateShadow(intentId)).toEqual(reopenedDurable);
  expect(readonlyArchive.read()).toEqual(replayed);
  expect((await reopenedRequest('confirm', { confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).status).toBe(409);
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(await reopened.mockStore!.readCandidateShadow(intentId)).toEqual(reopenedDurable);
  expect(readonlyArchive.read()).toEqual(replayed);
  expect(producerCalls).toBe(1);
  readonlyArchive.close();
  await reopened.close();
}, 20_000);
