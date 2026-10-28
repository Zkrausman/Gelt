// Constructed offline source conformance only; no provider or campaign.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { canonical } from './ledger-canonical.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { convertPAMR } from './pamr-reference-artifact.js';
import { pamrRecipe } from './paper-conversion-contract.js';
import { pamrConsumerDisclosure, pamrConsumerPolicyId } from './pamr-consumer-contract.js';
import { pamrConsumerPolicySha256 } from './pamr-consumer-adapter.js';
import { pamrConsumptionBounds, pamrConsumptionOwnerPolicySchema } from './pamr-consumer-evidence-contract.js';
import { PAMRConsumptionRejected, type EvidenceStage } from './synthetic-sizing-binding-evidence.js';
import { syntheticMockPAMRRunPreviewSchema } from './synthetic-mock-robinhood-contract.js';
import { simulationDigest, executionPrice, decimal, units, type SimulationRun } from './synthetic-simulation-economics.js';
import type { PAMRProducerContext } from './synthetic-mock-robinhood-adapter.js';

const initial = Date.parse('2026-10-28T15:00:00.000Z');
const iso = (n: number) => new Date(n).toISOString();
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const trace = [['2', '1'], ['0.5', '1'], ['2', '1']];
const roots: string[] = [], harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of harnesses.splice(0)) { try { await h.close(); } catch { /* retained owner markers are asserted before disposal */ } }
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function config(): SimulationRun {
  return { version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD', currency: 'USD',
    classification: 'constructed_offline_test', genesis: { cash: d('20'), quantity: d('0') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0'), slippageFraction: d('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 120000, maxObservationAgeMs: 120000,
    validThrough: iso(initial + 1000000), rounding: 'adverse-price-8-cumulative-cash-8.v1' };
}
function policy(c: SimulationRun) {
  return pamrConsumptionOwnerPolicySchema.parse({
    schema: 'gelt.pamr-consumption-owner-policy.v1', version: 1, classification: 'constructed_offline_test',
    runId: c.runId, sourceCommit: c.sourceCommit, configSha256: simulationDigest(c), consumerPolicyId: pamrConsumerPolicyId,
    purePolicyDefinitionSha256: pamrConsumerPolicySha256, adaptation: pamrConsumerDisclosure.adaptation,
    quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'), feeInclusiveOrderCapUSD: '10', bounds: pamrConsumptionBounds,
  });
}
function artifact(rows: string[][], assets = ['SYNTH-RISK', 'SYNTH-RESERVE']) {
  const result = convertPAMR(canonical({ schema: 'gelt.pamr-constructed-request.v1',
    classification: 'constructed_offline_test', recipe: pamrRecipe, assets, rows }));
  if (result.status !== 'computed') throw new Error('constructed fixture unavailable');
  return canonical(result.artifact);
}
async function fixture(c = config(), stage?: (s: EvidenceStage) => void) {
  let now = initial, ordinal = 1, calls = 0;
  let edit: (x: PAMRProducerContext) => PAMRProducerContext = x => x;
  const p = policy(c);
  const h = createSyntheticOrderHarness(() => now, { applicationMock: true, sizingEvidenceStageForTest: stage,
    simulationRun: { config: c, pamrBinding: { policy: p, producer: context => {
      calls++; expect(context.config).toEqual(c);
      const value = edit({ artifactText: artifact(trace.slice(0, ordinal)), prefixAvailableAt: iso(now - 201),
        decisionAt: iso(now - 200), observation: { referencePrice: d('1'), observedAt: iso(now - 100),
          availableAt: iso(now - 100), evidenceSha256: 'c'.repeat(64) } });
      context.config.genesis.cash = d('999'); context.portfolio.snapshot.cash = d('999');
      return value;
    } } } });
  harnesses.push(h); roots.push(dirname(dirname(h.path)));
  const makeRequest = (active: typeof h, port: number) => async (operation: string, body: unknown = {}, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/synthetic-orders/${operation}`, {
      method: 'POST', headers: { authorization: `Bearer ${active.auth.bearer}`, 'x-gelt-session': active.auth.session,
        'x-gelt-session-expires': String(active.auth.expiresAt), 'content-type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const request = makeRequest(h, await h.start());
  expect((await request('resume')).status).toBe(200);
  const query = <T>(path: string, work: (db: Database.Database) => T) => {
    const db = new Database(path, { readonly: true }); try { return work(db); } finally { db.close(); }
  };
  const counts = () => query(h.mockPath!, db => ['mock_admissions', 'mock_orders', 'mock_events']
    .map(table => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n));
  const previews = () => query(h.mockPath!, db => (db.prepare('SELECT preview_json FROM mock_admissions ORDER BY rowid').all() as { preview_json: string }[])
    .map(row => syntheticMockPAMRRunPreviewSchema.parse(JSON.parse(row.preview_json))));
  const records = () => readdirSync(h.mockPath! + '.sizing-evidence').filter(n => /^[a-f0-9]{64}$/.test(n));
  const prepare = async () => { const value = await h.previewPAMRBound(); if ('noOrder' in value) throw new Error('expected proposal'); return value; };
  const confirm = async () => {
    const prepared = await prepare();
    const result = await h.confirmPAMRBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
    return { prepared, result, preview: previews().at(-1)! };
  };
  const read = async (id: string) => (await request('history', { pamrConsumerDispatchId: id })).body.value;
  const fill = (id: string, pv: ReturnType<typeof previews>[number], quantity = pv.order.quantity, first = true) => {
    now += 100;
    return h.mockStore!.observeExecution(id, { version: 2, executionId: randomUUID(), receiptId: randomUUID(),
      runId: c.runId, configSha256: simulationDigest(c), decisionId: pv.decisionId, quantity,
      price: executionPrice(c, pv.order.side, d('1')), fee: first ? c.costs.commissionPerOrder : d('0'), currency: 'USD',
      observation: { referencePrice: d('1'), observedAt: iso(now), availableAt: iso(now), evidenceSha256: 'd'.repeat(64) } });
  };
  const next = (n: number) => { now += 1000; ordinal = n; };
  return { h, c, p, request, makeRequest, counts, previews, records, prepare, confirm, read, fill, next,
    edit: (fn: typeof edit) => { edit = fn; }, advance: (n: number) => { now += n; }, calls: () => calls };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function entry(f: Fixture) {
  const first = await f.h.previewPAMRBound();
  expect(first).toHaveProperty('noOrder.proposal.action.reason', 'already_cash');
  expect(first).toHaveProperty('noOrder.pamrConsumption.ordinal', 1);
  expect(first).toHaveProperty('noOrder.proposal.consumption', 'not_performed');
  expect(f.counts()).toEqual([0, 0, 0]); expect(f.records()).toHaveLength(1);
  f.next(2); return f.confirm();
}
function mutateFacts(f: Fixture, id: string, change: (events: any[]) => void) {
  const db = new Database(f.h.path);
  try {
    db.transaction(() => {
      const rows = db.prepare('SELECT sequence,body FROM synthetic_events WHERE intent=? ORDER BY sequence').all(id) as { sequence: number; body: string }[];
      const events = rows.map(row => JSON.parse(row.body)); change(events);
      for (let i = 0; i < rows.length; i++) db.prepare('UPDATE synthetic_events SET body=? WHERE intent=? AND sequence=?')
        .run(canonical(events[i]), id, rows[i].sequence);
      const row = db.prepare('SELECT projection FROM synthetic_intents WHERE id=?').get(id) as { projection: string };
      const projection = JSON.parse(row.projection); projection.facts = events;
      db.prepare('UPDATE synthetic_intents SET projection=? WHERE id=?').run(canonical(projection), id);
    }).immediate();
  } finally { db.close(); }
}
async function expectFenced(f: Fixture, active = f.h) {
  await expect(active.previewPAMRBound()).rejects.toThrow();
  await expect(active.close()).rejects.toThrow();
  expect(existsSync(active.path + '.lock')).toBe(true); expect(existsSync(active.mockPath! + '.lock')).toBe(true);
  expect(() => active.reopen()).toThrow();
}

it('consumes 0, enters one quarter, and exits actual reconciled holdings through protected history and reopen', async () => {
  const f = await fixture(), prepare = vi.spyOn(f.h.mockStore!, 'preparePAMRConsumption');
  const a = await entry(f);
  expect(a.prepared.terms.order.requestedQuantity.value).toBe('4.990000000000000000');
  expect(a.result.outcome).toBe('acknowledged'); expect(f.counts()).toEqual([1, 1, 1]);
  await expect(f.h.confirmPAMRBound({ confirmationToken: a.prepared.confirmationToken,
    termsHash: a.prepared.termsHash })).rejects.toThrow();
  expect(f.counts()).toEqual([1, 1, 1]);
  expect(a.preview.decisionId).toMatch(/^pamr-consumer-decision-/); expect(a.preview.sizingEvidence).toBeUndefined();
  expect(a.preview.pamrConsumption.configuredOwnerPolicySha256).not.toBe(pamrConsumerPolicySha256);
  const before = await f.read(a.result.intentId);
  expect(before.view.pureAction.hypothetical.modeledPostQuantity.value).toBe('4.990000000000000000');
  expect(before.view.actualMockPortfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  f.fill(a.result.intentId, a.preview);
  expect((await f.read(a.result.intentId)).view.lifecycle.disposition).toBe('unknown');
  expect((await f.request('reconcile')).status).toBe(200);
  const bought = (await f.read(a.result.intentId)).view;
  expect(bought.actualMockPortfolio.snapshot.cash.value).toBe('15.00000000');
  expect(bought.actualMockPortfolio.snapshot.quantity.value).toBe('4.990000000000000000');
  expect(bought.lifecycle.disposition).toBe('settled'); expect(bought.simulatedOrder.executions[0].observedByLifecycle).toBe(true);
  f.next(3); const b = await f.confirm(); expect(b.preview.order.side).toBe('sell');
  f.fill(b.result.intentId, b.preview); await f.request('reconcile');
  const final = await f.read(b.result.intentId);
  expect(final.view.actualMockPortfolio.snapshot.cash.value).toBe('19.98000000');
  expect(final.view.actualMockPortfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  expect(final.view.lifecycle.disposition).toBe('settled'); expect(prepare).toHaveBeenCalledTimes(3);
  expect(f.counts()).toEqual([2, 2, 4]); expect(f.records()).toHaveLength(3);
  const serialized = JSON.stringify(final);
  for (const secret of [f.h.auth.bearer, f.h.auth.session, a.prepared.confirmationToken, b.prepared.confirmationToken, f.h.path])
    expect(serialized.includes(secret)).toBe(false);
  expect(serialized).not.toMatch(/artifactText|inputBytes|admissionHandle|confirmationToken|ruleReceipt/);
  await f.h.close(); const reopened = f.h.reopen(); harnesses.push(reopened);
  const request = f.makeRequest(reopened, await reopened.start());
  expect((await request('history', { pamrConsumerDispatchId: b.result.intentId })).body.value).toEqual(final);
  expect((await request('resume')).status).toBe(409); await expect(reopened.previewPAMRBound()).rejects.toThrow();
  await expect(reopened.confirmPAMRBound({ confirmationToken: b.prepared.confirmationToken, termsHash: b.prepared.termsHash })).rejects.toThrow();
}, 20000);

it('exits actual partial holdings only after cancel acknowledgement, settlement and lifecycle reconciliation', async () => {
  const f = await fixture(), a = await entry(f);
  f.fill(a.result.intentId, a.preview, d('2')); await f.request('reconcile');
  expect((await f.request('cancel', { intentId: a.result.intentId })).status).toBe(200);
  expect(f.h.mockStore!.portfolio().snapshot.quantity.value).toBe('2.000000000000000000');
  await expect(f.h.previewPAMRBound()).rejects.toThrow(); expect(f.records()).toHaveLength(2);
  f.h.mockStore!.settleCanceled(a.result.intentId); await f.request('reconcile'); await f.request('resume');
  f.next(3); const b = await f.confirm(); expect(b.preview.order.quantity.value).toBe('2.000000000000000000');
  f.fill(b.result.intentId, b.preview); await f.request('reconcile');
  expect((await f.read(b.result.intentId)).view.actualMockPortfolio.snapshot).toMatchObject({
    cash: { value: '19.98000000' }, quantity: { value: '0.000000000000000000' },
  });
}, 20000);

it.each(['same', 'fresh clock', 'whitespace'] as const)('does not reissue no-action ordinal with %s wrapper', async variant => {
  const f = await fixture(); await f.h.previewPAMRBound();
  if (variant === 'fresh clock') f.advance(1000);
  if (variant === 'whitespace') f.edit(x => ({ ...x, artifactText: ` \n${x.artifactText}\n ` }));
  expect(await f.h.previewPAMRBound()).toHaveProperty('noOrder.reason', 'already_consumed');
  expect(f.records()).toHaveLength(1); expect(f.counts()).toEqual([0, 0, 0]);
  f.next(2); await f.prepare(); expect(f.records()).toHaveLength(2);
});

it.each(['object', 'oversize', 'forged', 'profile', 'parent', 'future', 'stale', 'receipt', 'override'] as const)
('rejects %s producer data without admission or consuming a usable new prefix', async fault => {
  const f = await fixture();
  f.edit(x => {
    if (fault === 'object') return { ...x, artifactText: {} } as unknown as PAMRProducerContext;
    if (fault === 'oversize') return { ...x, artifactText: ' '.repeat(180001) };
    if (fault === 'forged') return { ...x, artifactText: x.artifactText.replace('"weightsFinal":', '"unexpected":') };
    if (fault === 'profile') return { ...x, artifactText: artifact([['2', '1']], ['OTHER', 'SYNTH-RESERVE']) };
    if (fault === 'parent') return { ...x, artifactText: artifact(trace.slice(0, 2)) };
    if (fault === 'future') return { ...x, prefixAvailableAt: iso(initial + 1) };
    if (fault === 'stale') return { ...x, decisionAt: iso(initial - 120001), prefixAvailableAt: iso(initial - 120002) };
    return { ...x, [fault === 'receipt' ? 'receipt' : 'requestedQuantity']: {} } as PAMRProducerContext;
  });
  expect(await f.h.previewPAMRBound()).toHaveProperty('noOrder');
  expect(f.records()).toHaveLength(0); expect(f.counts()).toEqual([0, 0, 0]);
});

it.each(['positive overweight', 'exit cap'] as const)('consumes a valid %s abstention without splitting an order', async fault => {
  const c = config(); c.genesis.quantity = d('20'); const f = await fixture(c);
  const first = await f.h.previewPAMRBound(); expect(first).toHaveProperty('noOrder.proposal.action.reason', 'cash_exit_exceeds_cap');
  if (fault === 'positive overweight') {
    f.next(2); expect(await f.h.previewPAMRBound()).toHaveProperty('noOrder.proposal.action.reason', 'positive_target_overweight_unsupported');
  }
  expect(f.counts()).toEqual([0, 0, 0]);
});

it.each(['expiry', 'terms', 'halt'] as const)('spends a prepared ordinal on %s without retry', async fault => {
  const f = await fixture(); await f.h.previewPAMRBound(); f.next(2); const p = await f.prepare();
  if (fault === 'expiry') f.advance(60001); if (fault === 'halt') f.h.haltPAMRBound();
  await expect(f.h.confirmPAMRBound({ confirmationToken: p.confirmationToken, termsHash: fault === 'terms' ? '0'.repeat(64) : p.termsHash })).rejects.toThrow();
  await expect(f.h.confirmPAMRBound({ confirmationToken: p.confirmationToken, termsHash: p.termsHash })).rejects.toThrow();
  expect(f.counts()).toEqual([1, 0, 0]); expect(f.records()).toHaveLength(2);
});

it.each(['portfolio', 'clock', 'halt'] as const)('checks %s drift across the preclaim await', async fault => {
  const f = await fixture(); await f.h.previewPAMRBound(); f.next(2); const p = await f.prepare();
  const client = f.h.mockTransport!.client, original = client.portfolio.bind(client);
  vi.spyOn(client, 'portfolio').mockImplementation(async () => {
    const value = await original();
    if (fault === 'portfolio') value.snapshot.historySha256 = 'f'.repeat(64);
    if (fault === 'clock') f.advance(60001); if (fault === 'halt') f.h.haltPAMRBound();
    return value;
  });
  await expect(f.h.confirmPAMRBound({ confirmationToken: p.confirmationToken, termsHash: p.termsHash })).rejects.toThrow();
  expect(f.counts()).toEqual([1, 0, 0]); expect((await f.request('history')).body.value.items).toEqual([]);
});

it('serializes competing previews and preserves a copied producer DTO across awaits', async () => {
  const f = await fixture(); let saved: PAMRProducerContext;
  f.edit(x => { saved = x; return x; }); await f.h.previewPAMRBound(); f.next(2);
  const client = f.h.mockTransport!.client, original = client.portfolio.bind(client); let calls = 0;
  vi.spyOn(client, 'portfolio').mockImplementation(async () => {
    const result = await original();
    if (++calls === 2) { saved.artifactText = '{}'; saved.observation.referencePrice = d('999'); }
    return result;
  });
  const outcomes = await Promise.allSettled([f.h.previewPAMRBound(), f.h.previewPAMRBound()]);
  expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(f.counts()).toEqual([1, 0, 0]); expect(f.previews()[0].quote.referencePrice).toEqual(d('1'));
});

it('preserves durable submission UNKNOWN and incomplete read-only reopen', async () => {
  const f = await fixture(); await f.h.previewPAMRBound(); f.next(2); const p = await f.prepare();
  f.h.mockTransport!.loseNextSubmitResponseForTest();
  const result = await f.h.confirmPAMRBound({ confirmationToken: p.confirmationToken, termsHash: p.termsHash });
  expect(result.outcome).toBe('unknown'); expect(f.counts()).toEqual([1, 1, 1]);
  expect((await f.read(result.intentId)).view.lifecycle).toMatchObject({ disposition: 'unknown', dispatchUnknown: true });
  expect((await f.request('resume')).status).toBe(409);
  await f.h.close(); const reopened = f.h.reopen(); harnesses.push(reopened);
  const request = f.makeRequest(reopened, await reopened.start());
  expect((await request('history', { pamrConsumerDispatchId: result.intentId })).body.value.view.lifecycle.disposition).toBe('unknown');
  await expect(reopened.previewPAMRBound()).rejects.toThrow();
}, 15000);

it.each(['artifact-file-sync', 'artifact-staging-sync', 'artifact-publish', 'artifact-root-sync'] as const)
('retains both owner markers after uncertain %s publication, including typed errors', async stage => {
  const f = await fixture(undefined, s => { if (s === stage) throw new PAMRConsumptionRejected('already_consumed'); });
  await expect(f.h.previewPAMRBound()).rejects.toThrow(); expect(f.counts()).toEqual([0, 0, 0]);
  expect(readdirSync(f.h.mockPath! + '.sizing-evidence').length).toBeGreaterThan(1); await expectFenced(f);
});

it('retains both owners on writer loss after complete consumption publication', async () => {
  let marker = '';
  const f = await fixture(undefined, stage => { if (stage === 'artifact-root-sync') writeFileSync(marker, 'different-writer'); });
  marker = f.h.mockPath! + '.lock';
  await expect(f.h.previewPAMRBound()).rejects.toThrow(); expect(f.records()).toHaveLength(1);
  await expectFenced(f); expect(readFileSync(marker, 'utf8')).toBe('different-writer');
});

it.each(['live', 'reopened'] as const)('fences duplicate observed A substituted for missing B on %s history', async mode => {
  const f = await fixture(), a = await entry(f);
  f.fill(a.result.intentId, a.preview, d('1'));
  f.fill(a.result.intentId, a.preview, decimal(units(a.preview.order.quantity, 18) - units(d('1'), 18), 18), false);
  await f.request('reconcile');
  let pending: Awaited<ReturnType<typeof f.prepare>> | undefined;
  if (mode === 'live') { f.next(3); pending = await f.prepare(); }
  mutateFacts(f, a.result.intentId, events => {
    const fills = events.filter(e => e.type === 'execution-observed'); fills[1].execution = fills[0].execution;
  });
  let active = f.h, request = f.request;
  if (mode === 'reopened') { await active.close(); active = active.reopen(); harnesses.push(active); request = f.makeRequest(active, await active.start()); }
  expect((await request('history', { pamrConsumerDispatchId: a.result.intentId })).body.value.state).toBe('unavailable');
  if (pending) expect((await request('confirm', { confirmationToken: pending.confirmationToken, termsHash: pending.termsHash })).status).toBe(409);
  await expectFenced(f, active);
}, 20000);

it.each((['live', 'reopened'] as const).flatMap(mode => ([
  ['canceled', 'filled', false], ['filled', 'rejected', false], ['filled', 'canceled', false],
  ['accepted', 'filled', false], ['accepted', 'canceled', false], ['accepted', 'rejected', false],
  ['canceled', 'filled', true], ['filled', 'rejected', true],
] as const).map(([actual, falseStatus, hidden]) => ({ mode, actual, falseStatus, hidden }))))
('fences retained terminal contradiction $actual/$falseStatus hidden=$hidden on $mode', async ({ mode, actual, falseStatus, hidden }) => {
  const f = await fixture(), a = await entry(f), id = a.result.intentId;
  if (hidden) await f.request('reconcile');
  if (actual === 'filled') f.fill(id, a.preview);
  if (actual === 'canceled') { await f.request('cancel', { intentId: id }); f.h.mockStore!.settleCanceled(id); }
  await f.request('reconcile');
  let pending: Awaited<ReturnType<typeof f.prepare>> | undefined;
  if (mode === 'live' && actual !== 'accepted') { f.next(3); const p = await f.h.previewPAMRBound(); if (!('noOrder' in p)) pending = p; }
  mutateFacts(f, id, events => {
    const statuses = events.filter(e => e.type === 'broker-status-observed'); (hidden ? statuses[0] : statuses.at(-1)).status = falseStatus;
  });
  let active = f.h, request = f.request;
  if (mode === 'reopened') { await active.close(); active = active.reopen(); harnesses.push(active); request = f.makeRequest(active, await active.start()); }
  expect((await request('history', { pamrConsumerDispatchId: id })).body.value.state).toBe('unavailable');
  if (pending) expect((await request('confirm', { confirmationToken: pending.confirmationToken, termsHash: pending.termsHash })).status).toBe(409);
  await expectFenced(f, active);
}, 20000);

it('keeps missing selections benign and enforces selector, session and transport boundaries', async () => {
  const f = await fixture();
  expect((await f.read(randomUUID())).state).toBe('unavailable');
  const a = await entry(f), id = a.result.intentId;
  for (const extra of [{ authorization: '' }, { origin: 'https://invalid.test' }, { forwarded: 'invalid' }, { 'x-forwarded-host': 'invalid' }])
    expect((await f.request('history', { pamrConsumerDispatchId: id }, extra)).status).toBe(403);
  for (const body of [{ pamrConsumerDispatchId: id, candidateDispatchId: id }, { pamrConsumerDispatchId: id, path: '/private' }])
    expect((await f.request('history', body)).status).toBe(409);
  expect((await f.request('preview', a.prepared.terms.order)).status).toBe(409);
  const store = f.h.mockStore!, original = store.readPAMRConsumer.bind(store);
  vi.spyOn(store, 'readPAMRConsumer').mockImplementation(selected => { const value = original(selected); f.advance(300001); return value; });
  expect((await f.request('history', { pamrConsumerDispatchId: id })).status).toBe(403);
});
