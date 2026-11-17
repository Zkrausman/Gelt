import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import fsMutable, { rmSync } from 'node:fs';
import { canonical } from './ledger-canonical.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import {
  projectConstructedSpyRawMark,
  type ConstructedSpyRawMarkResult,
} from './constructed-spy-raw-mark.js';
import {
  ConstructedSpyRawMarkSourceStore,
  type ConstructedSpyRawMarkSourceOwner,
} from './constructed-spy-raw-mark-source-retention.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { sizingBindingPolicySchema } from './synthetic-mock-robinhood-contract.js';
import {
  executionPrice, simulationDigest, simulationRunSchema, snapshot, units,
  type SimulationRun,
} from './synthetic-simulation-economics.js';
import type { SpyDailyInputRequest } from './spy-daily-input-consistency.js';
import { storageFixture } from './storage-fixture.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (value: number) => new Date(value).toISOString();
const plus = (value: string, amount: number) => iso(Date.parse(value) + amount);
const decimal = (value: string) => ({
  value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0,
});
const roots: string[] = [];
const harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
const sourceStores: ConstructedSpyRawMarkSourceStore[] = [];
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

function rawMarkOwner(input: Buffer, result: Extract<ConstructedSpyRawMarkResult, { status: 'projected' }>): ConstructedSpyRawMarkSourceOwner {
  const outer = JSON.parse(input.toString('utf8')) as { dailyRequestText: string; consumer: { config: SimulationRun } };
  const daily = JSON.parse(outer.dailyRequestText) as SpyDailyInputRequest;
  return {
    schema: 'gelt.constructed-spy-raw-mark-source-owner.v1',
    caseEpochId: daily.epochId,
    runId: outer.consumer.config.runId,
    sourceCommit: outer.consumer.config.sourceCommit,
    configSha256: simulationDigest(outer.consumer.config),
    bindingId: result.bindingId,
    projectionId: result.projection.projectionId,
    candidateId: candidateShadowId(parseCandidateShadowManifest(result.projection.manifestText)),
    originalInputSha256: createHash('sha256').update(input).digest('hex'),
  };
}

function closeSourceStore(store: ConstructedSpyRawMarkSourceStore): void {
  store.close();
  const index = sourceStores.indexOf(store);
  if (index >= 0) sourceStores.splice(index, 1);
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
  for (const store of sourceStores.splice(0)) {
    try { store.close(); } catch (error) { failures.push(error); }
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
  const archiveRoot = storageFixture('constructed-raw-mark-source-consumer-');
  roots.push(archiveRoot);
  let archiveOwnerBytes: Buffer | undefined;
  let callbackInput: Buffer | undefined;
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
  let callbackOwner: ConstructedSpyRawMarkSourceOwner | undefined;
  let archiveWriter: ConstructedSpyRawMarkSourceStore | undefined;
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
          const owner = rawMarkOwner(callbackBytes, result);
          // A valid setup-only 19-cash declaration cannot stand in for the
          // producer's actual owner-read 20-cash portfolio bytes.
          const decoyRoot = storageFixture('constructed-raw-mark-decoy-owner-');
          roots.push(decoyRoot);
          const decoyOwner = rawMarkOwner(setupBytes, setupResult);
          expect(() => ConstructedSpyRawMarkSourceStore.create(
            decoyRoot, Buffer.from(canonical(decoyOwner), 'utf8'), callbackBytes,
          )).toThrow('constructed SPY raw-mark source unavailable');
          expect(fsMutable.readdirSync(decoyRoot)).toEqual([]);

          callbackInput = Buffer.from(callbackBytes);
          callbackOwner = owner;
          const ownedOwnerBytes = Buffer.from(canonical(owner), 'utf8');
          archiveOwnerBytes = ownedOwnerBytes;
          archiveWriter = ConstructedSpyRawMarkSourceStore.create(archiveRoot, ownedOwnerBytes, callbackBytes);
          sourceStores.push(archiveWriter);
          const retained = archiveWriter.read();
          if (!retained.originalInput.equals(callbackBytes)) throw new Error('complete raw-mark source changed');
          if (canonical(retained.result) !== canonical(result)) throw new Error('raw-mark replay changed');
          latest = retained.result;
          return {
            inputBytes: Buffer.from(retained.result.projection.ruleInputText, 'utf8'),
            receipt: retained.result.projection.ruleReceipt,
            observation: retained.result.projection.observation,
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
  expect(callbackOwner).toBeDefined();
  expect(callbackInput).toBeDefined();
  expect(archiveOwnerBytes).toBeDefined();
  expect(archiveWriter).toBeDefined();
  expect(latest!.markRecord.price).toEqual(decimal('3'));
  expect(latest!.projection.observation.referencePrice).toEqual(decimal('3'));
  expect(JSON.parse(latest!.projection.ruleInputText).bars[252].adjustedClose).toEqual(decimal('2.00'));
  expect(latest!.originalMarkPersistence).toBe('not_performed_by_this_api');
  expect(latest!.projection).not.toEqual(setupResult.projection);
  const retainedAtDecision = archiveWriter!.read();
  expect(retainedAtDecision.originalInput).toEqual(callbackInput);
  expect(retainedAtDecision.result).toEqual(latest);
  expect(retainedAtDecision.receipt.sourceRetention).toBe('outer_raw_mark_input_exact_bytes_in_separate_archive');
  expect(retainedAtDecision.receipt.originalInputSha256).toBe(callbackOwner!.originalInputSha256);
  const retainedOuter = JSON.parse(retainedAtDecision.originalInput.toString('utf8'));
  expect(retainedOuter.consumer.config).toEqual(run);
  expect(retainedOuter.consumer.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(retainedOuter.consumer.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(retainedOuter.consumer.portfolio.snapshot.cash.value).not.toBe('19.00000000');
  const originalRawBytes = Buffer.from(retainedAtDecision.originalInput);
  const originalRawResult = canonical(retainedAtDecision.result);
  const originalRawReceipt = canonical(retainedAtDecision.receipt);

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
  expect(retainedAtDecision.receipt.markEvidenceSha256).toBe(durable.input.observation.evidenceSha256);
  expect(retainedAtDecision.receipt.bindingId).toBe(latest!.bindingId);
  expect(retainedAtDecision.receipt.projectionId).toBe(latest!.projection.projectionId);
  expect(retainedAtDecision.receipt.candidateId).toBe(candidateShadowId(durable.candidate));
  expect(retainedAtDecision.receipt.decisionId).toBe(durable.input.ruleReceipt.decisionId);
  expect(retainedAtDecision.receipt.originalInputBytes).toBe(callbackInput!.length);
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
  expect(archiveWriter!.read().originalInput).toEqual(originalRawBytes);
  expect(canonical(archiveWriter!.read().result)).toBe(originalRawResult);
  expect(canonical(archiveWriter!.read().receipt)).toBe(originalRawReceipt);
  harness.haltSizingBound();
  await expect(harness.previewSizingBound()).rejects.toThrow();
  await expect(harness.confirmSizingBound({
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).rejects.toThrow();
  expect((await request(harness, 'history', { candidateDispatchId: intentId })).body.value).toEqual(fixedHistory);
  expect(harness.mockStore!.readCandidateShadow(intentId)).toEqual(durableAfterFill);
  const priorProducerCalls = producerCalls;

  expect(archiveWriter!.read().originalInput).toEqual(originalRawBytes);
  expect(canonical(archiveWriter!.read().result)).toBe(originalRawResult);
  expect(canonical(archiveWriter!.read().receipt)).toBe(originalRawReceipt);
  const writerToClose = archiveWriter!;
  closeSourceStore(writerToClose);
  archiveWriter = undefined;
  const archivePath = join(archiveRoot, 'raw-mark-source.json');
  const archiveBefore = { bytes: fsMutable.readFileSync(archivePath), file: fsMutable.statSync(archivePath),
    directory: fsMutable.statSync(archiveRoot), names: fsMutable.readdirSync(archiveRoot).sort() };
  const readonlyArchive = ConstructedSpyRawMarkSourceStore.reopen(archiveRoot, archiveOwnerBytes!);
  sourceStores.push(readonlyArchive);
  const reopenedSource = readonlyArchive.read();
  expect(reopenedSource.originalInput).toEqual(originalRawBytes);
  expect(canonical(reopenedSource.result)).toBe(originalRawResult);
  expect(canonical(reopenedSource.receipt)).toBe(originalRawReceipt);
  closeSourceStore(readonlyArchive);
  const archiveAfter = { bytes: fsMutable.readFileSync(archivePath), file: fsMutable.statSync(archivePath),
    directory: fsMutable.statSync(archiveRoot), names: fsMutable.readdirSync(archiveRoot).sort() };
  expect(archiveAfter.bytes).toEqual(archiveBefore.bytes);
  expect(archiveAfter.file.ino).toBe(archiveBefore.file.ino);
  expect(archiveAfter.file.mtimeMs).toBe(archiveBefore.file.mtimeMs);
  expect(archiveAfter.directory.ino).toBe(archiveBefore.directory.ino);
  expect(archiveAfter.directory.mtimeMs).toBe(archiveBefore.directory.mtimeMs);
  expect(archiveAfter.names).toEqual(['raw-mark-source.json']);

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

it('retains the complete callback-owned raw source through a lost-submit UNKNOWN, halt, and readonly reopen', async () => {
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
  const archiveRoot = storageFixture('constructed-raw-mark-unknown-source-');
  roots.push(archiveRoot);
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
  let callbackInput: Buffer | undefined;
  let ownerBytes: Buffer | undefined;
  let latest: Extract<ConstructedSpyRawMarkResult, { status: 'projected' }> | undefined;
  let archiveWriter: ConstructedSpyRawMarkSourceStore | undefined;
  const harness = createSyntheticOrderHarness(() => now, {
    applicationMock: true,
    simulationRun: {
      config: run,
      sizingBinding: {
        policy,
        producer: context => {
          producerCalls++;
          const input = rawMarkBytes(dailyText, context.config, context.portfolio, iso(now));
          const result = projectConstructedSpyRawMark(input);
          if (result.status !== 'projected' || result.projection.manifestText !== setupResult.projection.manifestText) {
            throw new Error('callback-owned constructed raw-mark projection unavailable');
          }
          const owner = rawMarkOwner(input, result);
          const decoyRoot = storageFixture('constructed-raw-mark-unknown-decoy-');
          roots.push(decoyRoot);
          const decoyOwner = rawMarkOwner(setupBytes, setupResult);
          expect(() => ConstructedSpyRawMarkSourceStore.create(
            decoyRoot, Buffer.from(canonical(decoyOwner), 'utf8'), input,
          )).toThrow('constructed SPY raw-mark source unavailable');
          expect(fsMutable.readdirSync(decoyRoot)).toEqual([]);

          callbackInput = Buffer.from(input);
          ownerBytes = Buffer.from(canonical(owner), 'utf8');
          archiveWriter = ConstructedSpyRawMarkSourceStore.create(archiveRoot, ownerBytes, input);
          sourceStores.push(archiveWriter);
          const retained = archiveWriter.read();
          if (!retained.originalInput.equals(input) || canonical(retained.result) !== canonical(result)) {
            throw new Error('complete raw-mark source replay changed');
          }
          latest = retained.result;
          return {
            inputBytes: Buffer.from(retained.result.projection.ruleInputText, 'utf8'),
            receipt: retained.result.projection.ruleReceipt,
            observation: retained.result.projection.observation,
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
  expect(producerCalls).toBe(1);
  expect(callbackInput).toBeDefined();
  expect(ownerBytes).toBeDefined();
  expect(latest).toBeDefined();
  expect(archiveWriter).toBeDefined();
  const originalBytes = Buffer.from(callbackInput!);
  const originalHash = createHash('sha256').update(originalBytes).digest('hex');
  const sourceBeforeUnknown = archiveWriter!.read();
  const sourceResultText = canonical(sourceBeforeUnknown.result);
  const sourceReceiptText = canonical(sourceBeforeUnknown.receipt);
  expect(sourceBeforeUnknown.originalInput).toEqual(originalBytes);
  expect(sourceBeforeUnknown.result).toEqual(latest);
  expect(sourceBeforeUnknown.receipt.originalInputBytes).toBe(originalBytes.length);
  expect(sourceBeforeUnknown.receipt.originalInputSha256).toBe(originalHash);
  expect(sourceBeforeUnknown.receipt.resultSha256).toBe(
    createHash('sha256').update(canonical(sourceBeforeUnknown.result)).digest('hex'),
  );
  expect(sourceBeforeUnknown.receipt.projectionSha256).toBe(
    createHash('sha256').update(canonical(sourceBeforeUnknown.result.projection)).digest('hex'),
  );
  expect(sourceBeforeUnknown.receipt.bindingId).toBe(latest!.bindingId);
  expect(sourceBeforeUnknown.receipt.projectionId).toBe(latest!.projection.projectionId);
  expect(sourceBeforeUnknown.receipt.markSha256).toBe(latest!.markSha256);
  expect(sourceBeforeUnknown.receipt.markEvidenceSha256).toBe(latest!.markEvidenceSha256);
  expect(latest!.originalInputSha256).toBe(originalHash);
  expect(latest!.markRecord.price).toEqual(decimal('3'));
  expect(JSON.parse(latest!.projection.ruleInputText).bars[252].adjustedClose).toEqual(decimal('2.00'));
  const callbackOuter = JSON.parse(originalBytes.toString('utf8'));
  expect(callbackOuter.consumer.config).toEqual(run);
  expect(callbackOuter.consumer.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(callbackOuter.consumer.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(callbackOuter.consumer.portfolio.snapshot.cash.value).not.toBe('19.00000000');
  const portfolioBeforeSubmit = harness.mockStore!.portfolio();
  expect(portfolioBeforeSubmit.snapshot.cash.value).toBe('20.00000000');
  expect(portfolioBeforeSubmit.snapshot.quantity.value).toBe('0.000000000000000000');

  // The one response-loss injection precedes the one guarded confirmation.
  harness.mockTransport!.loseNextSubmitResponseForTest();
  const confirmation = await request(harness, 'confirm', {
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  });
  expect(confirmation.status).toBe(200);
  const result = confirmation.body.value;
  expect(result.outcome).toBe('unknown');
  const intentId = result.intentId as string;
  const historyResponse = await request(harness, 'history', { candidateDispatchId: intentId });
  expect(historyResponse.status).toBe(200);
  const unknownHistory = historyResponse.body.value;
  expect(unknownHistory.state).toBe('available');
  expect(unknownHistory.view.lifecycle.disposition).toBe('unknown');
  expect(unknownHistory.view.lifecycle.dispatchUnknown).toBe(true);
  expect(unknownHistory.view.simulatedOrder.executions).toEqual([]);
  expect(unknownHistory.view.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(unknownHistory.view.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');

  const durableUnknown = harness.mockStore!.readCandidateShadow(intentId)!;
  expect(durableUnknown.input.config).toEqual(run);
  expect(durableUnknown.input.portfolio).toEqual(callbackOuter.consumer.portfolio);
  expect(durableUnknown.input.observation.referencePrice).toEqual(decimal('3'));
  expect(durableUnknown.input.observation.evidenceSha256).toBe(latest!.markEvidenceSha256);
  expect(durableUnknown.input.ruleReceipt).toEqual(latest!.projection.ruleReceipt);
  expect(durableUnknown.input.ruleInput).toEqual(JSON.parse(latest!.projection.ruleInputText));
  expect(durableUnknown.input.observation.evidenceSha256).toBe(sourceBeforeUnknown.receipt.markEvidenceSha256);
  expect(candidateShadowId(durableUnknown.candidate)).toBe(sourceBeforeUnknown.receipt.candidateId);
  expect(durableUnknown.input.ruleReceipt.decisionId).toBe(sourceBeforeUnknown.receipt.decisionId);
  expect(unknownHistory.view.decision.decisionId).toBe(sourceBeforeUnknown.receipt.decisionId);
  expect(durableUnknown.portfolio.snapshot.cash.value).toBe('20.00000000');
  expect(durableUnknown.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(durableUnknown.order.executions).toEqual([]);
  expect(canonical(durableUnknown.input)).not.toContain('trade-1');
  expect(canonical(durableUnknown.input)).not.toContain('dailyRequestText');

  // UNKNOWN remains unresolved; the assertions describe recorded fixture state,
  // not whether a submitted order could exist outside the lost response.
  const portfolioAfterUnknown = harness.mockStore!.portfolio();
  expect(portfolioAfterUnknown.snapshot.cash.value).toBe('20.00000000');
  expect(portfolioAfterUnknown.snapshot.quantity.value).toBe('0.000000000000000000');
  const callsAfterUnknown = producerCalls;
  expect(archiveWriter!.read().originalInput).toEqual(originalBytes);
  expect(canonical(archiveWriter!.read().result)).toBe(sourceResultText);
  expect(canonical(archiveWriter!.read().receipt)).toBe(sourceReceiptText);

  harness.haltSizingBound();
  await expect(harness.previewSizingBound()).rejects.toThrow();
  expect((await request(harness, 'confirm', {
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).status).toBe(409);
  expect((await request(harness, 'history', { candidateDispatchId: intentId })).body.value).toEqual(unknownHistory);
  expect(harness.mockStore!.readCandidateShadow(intentId)).toEqual(durableUnknown);
  expect(harness.mockStore!.portfolio()).toEqual(portfolioAfterUnknown);
  expect(producerCalls).toBe(callsAfterUnknown);

  const sourceWriter = archiveWriter!;
  closeSourceStore(sourceWriter);
  archiveWriter = undefined;
  const archivePath = join(archiveRoot, 'raw-mark-source.json');
  const archiveBeforeReopen = { bytes: fsMutable.readFileSync(archivePath), file: fsMutable.statSync(archivePath),
    directory: fsMutable.statSync(archiveRoot), names: fsMutable.readdirSync(archiveRoot).sort() };
  const readonlyArchive = ConstructedSpyRawMarkSourceStore.reopen(archiveRoot, ownerBytes!);
  sourceStores.push(readonlyArchive);
  const sourceAfterReopen = readonlyArchive.read();
  expect(sourceAfterReopen.originalInput).toEqual(originalBytes);
  expect(canonical(sourceAfterReopen.result)).toBe(sourceResultText);
  expect(canonical(sourceAfterReopen.receipt)).toBe(sourceReceiptText);
  closeSourceStore(readonlyArchive);
  const archiveAfterReopen = { bytes: fsMutable.readFileSync(archivePath), file: fsMutable.statSync(archivePath),
    directory: fsMutable.statSync(archiveRoot), names: fsMutable.readdirSync(archiveRoot).sort() };
  expect(archiveAfterReopen.bytes).toEqual(archiveBeforeReopen.bytes);
  expect(archiveAfterReopen.file.ino).toBe(archiveBeforeReopen.file.ino);
  expect(archiveAfterReopen.file.mtimeMs).toBe(archiveBeforeReopen.file.mtimeMs);
  expect(archiveAfterReopen.directory.ino).toBe(archiveBeforeReopen.directory.ino);
  expect(archiveAfterReopen.directory.mtimeMs).toBe(archiveBeforeReopen.directory.mtimeMs);
  expect(archiveAfterReopen.names).toEqual(['raw-mark-source.json']);

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
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(unknownHistory);
  expect(reopened.mockStore!.readCandidateShadow(intentId)).toEqual(durableUnknown);
  expect(reopened.mockStore!.portfolio()).toEqual(portfolioAfterUnknown);
  expect(reopened.mockStore!.readCandidateShadow(intentId)!.order.executions).toEqual([]);
  expect((await reopenedRequest('resume')).status).toBe(409);
  expect((await reopenedRequest('preview', {})).status).toBe(409);
  expect((await reopenedRequest('confirm', {
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).status).toBe(409);
  await expect(reopened.previewSizingBound()).rejects.toThrow();
  await expect(reopened.confirmSizingBound({
    confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash,
  })).rejects.toThrow();
  expect((await reopenedRequest('history', { candidateDispatchId: intentId })).body.value).toEqual(unknownHistory);
  expect(reopened.mockStore!.readCandidateShadow(intentId)).toEqual(durableUnknown);
  expect(reopened.mockStore!.portfolio()).toEqual(portfolioAfterUnknown);
  expect(producerCalls).toBe(callsAfterUnknown);
  const archiveFinal = { bytes: fsMutable.readFileSync(archivePath), file: fsMutable.statSync(archivePath),
    directory: fsMutable.statSync(archiveRoot), names: fsMutable.readdirSync(archiveRoot).sort() };
  expect(archiveFinal.bytes).toEqual(archiveAfterReopen.bytes);
  expect(archiveFinal.file.ino).toBe(archiveAfterReopen.file.ino);
  expect(archiveFinal.file.mtimeMs).toBe(archiveAfterReopen.file.mtimeMs);
  expect(archiveFinal.directory.ino).toBe(archiveAfterReopen.directory.ino);
  expect(archiveFinal.directory.mtimeMs).toBe(archiveAfterReopen.directory.mtimeMs);
  expect(archiveFinal.names).toEqual(['raw-mark-source.json']);
}, 20_000);
