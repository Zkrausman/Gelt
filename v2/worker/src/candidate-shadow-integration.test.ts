import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { canonical } from './ledger-canonical.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { candidateShadowArtifact, candidateShadowManifestSchema, candidateShadowId,
  candidateShadowOperatingAdmission } from './candidate-shadow-contract.js';
import { evaluateCandidateShadowDecision } from './candidate-shadow-adapter.js';
import { shadowRuleId, type ShadowRuleInput } from './shadow-rule-contract.js';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { simulationRunSchema, simulationDigest, snapshot, units, decimal, executionPrice,
  type SimulationRun, type SimulationSnapshot } from './synthetic-simulation-economics.js';

const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const iso = (time: number) => new Date(time).toISOString();
const initial = Date.parse('2026-10-27T10:00:00.000Z');
const harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
const roots: string[] = [];
beforeEach(() => {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
});
afterEach(async () => {
  for (const h of harnesses.splice(0)) { try { await h.close(); } catch { /* retain poisoned ownership until fixture disposal */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
  delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
});
function config(): SimulationRun {
  return simulationRunSchema.parse({ version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: d('20'), quantity: d('0') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0'), slippageFraction: d('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 3600000, maxObservationAgeMs: 60000,
    validThrough: iso(initial + 3600000), rounding: 'adverse-price-8-cumulative-cash-8.v1' });
}
function rule(c: SimulationRun, p: SimulationSnapshot, now: number, long: boolean): ShadowRuleInput {
  return { schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId, runId: c.runId, sourceCommit: c.sourceCommit,
    decisionAt: iso(now - 200), instrument: { id: c.instrumentId, currency: 'USD', calendarSha256: 'c'.repeat(64) },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: 'd'.repeat(64),
      rightsEvidenceSha256: 'e'.repeat(64), pointInTimeEvidenceSha256: 'f'.repeat(64) },
    policy: { scheduleSha256: '1'.repeat(64), maxAgeMs: 86400000, exposureCap: d('0.25') },
    costs: { status: 'declared', evidenceSha256: c.calibrationEvidenceSha256, stressScenarioSha256: '2'.repeat(64),
      commissionPerTrade: c.costs.commissionPerOrder, spreadFraction: c.costs.spreadFraction, slippageFraction: c.costs.slippageFraction },
    controls: { passiveSha256: '3'.repeat(64), cashAssumptionSha256: '4'.repeat(64) },
    portfolio: { state: 'settled', snapshotSha256: simulationDigest(p) },
    bars: Array.from({ length: 253 }, (_, i) => ({ sessionOrdinal: i,
      closedAt: iso(now - 1000 - (252 - i) * 86400000), availableAt: iso(now - 1000 - (252 - i) * 86400000),
      adjustedClose: d(i === 252 ? long ? '101' : '99' : '100') })) };
}
function manifest(c: SimulationRun) {
  const i = rule(c, snapshot(c, units(c.genesis.cash, 8), units(c.genesis.quantity, 18), []), initial, true);
  return candidateShadowManifestSchema.parse({ schema: 'gelt.candidate-shadow-manifest.v1', version: 1,
    classification: 'constructed_offline_test', effectScope: 'SIMULATED_ONLY',
    runId: c.runId, sourceCommit: c.sourceCommit, configSha256: simulationDigest(c), artifact: candidateShadowArtifact,
    ruleBinding: { instrument: i.instrument, data: i.data, policy: i.policy, costs: i.costs, controls: i.controls } });
}
async function fixture() {
  const c = config(), m = manifest(c);
  let now = initial, long = true, calls = 0;
  const observation = () => ({ referencePrice: d('1'), observedAt: iso(now - 100), availableAt: iso(now - 100), evidenceSha256: '5'.repeat(64) });
  const h = createSyntheticOrderHarness(() => now, { applicationMock: true, simulationRun: { config: c,
    sizingBinding: { policy: { schema: 'gelt.synthetic-sizing-binding-policy.v1', version: 1,
      classification: 'constructed_offline_test', runId: c.runId, sourceCommit: c.sourceCommit,
      configSha256: simulationDigest(c), sizingPolicyId: shadowSizingPolicyId,
      quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'), candidate: m },
    producer: context => {
      calls++;
      const result = evaluateCandidateShadowDecision(canonical(m),
        canonical(rule(c, context.portfolio.snapshot, now, long)), canonical(observation()));
      if (result.status !== 'evaluated') throw new Error('constructed candidate rejected');
      return result.context;
    } } } });
  harnesses.push(h); roots.push(dirname(dirname(h.path)));
  const makeRequest = (opened: typeof h, port: number) => async (operation: string, body: unknown = {}, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/synthetic-orders/${operation}`, { method: 'POST',
      headers: { authorization: `Bearer ${opened.auth.bearer}`, 'x-gelt-session': opened.auth.session,
        'x-gelt-session-expires': String(opened.auth.expiresAt), 'content-type': 'application/json', ...extra },
      body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const request = makeRequest(h, await h.start());
  expect((await request('resume')).status).toBe(200);
  const prepare = async () => {
    const p = await h.previewSizingBound();
    if ('noOrder' in p) throw new Error('expected constructed proposal');
    return p;
  };
  const confirm = async () => {
    const p = await prepare();
    const response = await request('confirm', { confirmationToken: p.confirmationToken, termsHash: p.termsHash });
    expect(response.status).toBe(200);
    return { prepared: p, result: response.body.value };
  };
  const read = async (id: string) => (await request('history', { candidateDispatchId: id })).body.value;
  const fill = (id: string, decisionId: string, quantity: ReturnType<typeof d>, first = true, side: 'buy' | 'sell' = 'buy') => {
    now += 100;
    const execution = { version: 2 as const, executionId: randomUUID(), receiptId: randomUUID(),
      runId: c.runId, configSha256: simulationDigest(c), decisionId, quantity, price: executionPrice(c, side, d('1')),
      fee: first ? c.costs.commissionPerOrder : d('0'), currency: 'USD' as const,
      observation: { referencePrice: d('1'), observedAt: iso(now), availableAt: iso(now), evidenceSha256: '6'.repeat(64) } };
    h.mockStore!.observeExecution(id, execution);
    return execution;
  };
  return { h, c, m, request, read, prepare, confirm, fill, makeRequest,
    advance: (delta = 1000) => { now += delta; }, cash: () => { long = false; }, calls: () => calls };
}

it('joins fixed G05 entry and whole exit, actual fees/cash/positions and read-only reopen through protected history', async () => {
  const f = await fixture();
  let lastId = '';
  for (const side of ['buy', 'sell'] as const) {
    if (side === 'sell') { f.advance(); f.cash(); }
    const { prepared, result } = await f.confirm(); lastId = result.intentId;
    expect(result.outcome).toBe('acknowledged');
    const before = await f.read(lastId);
    expect(before.state).toBe('available'); expect(before.view.simulatedOrder.executions).toEqual([]);
    expect(before.view.requested.side).toBe(side); expect(before.view.lifecycle.disposition).toBe('unsettled');
    const e = f.fill(lastId, before.view.decision.decisionId, prepared.terms.order.requestedQuantity, true, side);
    const portfolio = f.h.mockStore!.portfolio();
    f.h.mockStore!.observeExecution(lastId, e);
    expect(f.h.mockStore!.portfolio()).toEqual(portfolio);
    expect((await f.request('reconcile')).status).toBe(200);
    const joined = await f.read(lastId);
    expect(joined.view.candidateId).toBe(candidateShadowId(f.m));
    expect(joined.view.lifecycle.disposition).toBe('settled');
    expect(joined.view.simulatedOrder.executions[0].receiptId).toBe(e.receiptId);
    expect(joined.view.completion).toBe('unestablished');
    for (const secret of [f.h.auth.bearer, f.h.auth.session, prepared.confirmationToken])
      expect(JSON.stringify(joined).includes(secret)).toBe(false);
  }
  const before = await f.read(lastId);
  expect(before.view.portfolio.snapshot.cash.value).toBe('19.98000000');
  expect(before.view.portfolio.snapshot.quantity.value).toBe('0.000000000000000000');
  await f.h.close();
  const reopened = f.h.reopen(); harnesses.push(reopened);
  const request = f.makeRequest(reopened, await reopened.start());
  expect((await request('history', { candidateDispatchId: lastId })).body.value).toEqual(before);
  expect((await request('resume')).status).toBe(409);
  expect((await request('preview', {})).status).toBe(409);
  await expect(reopened.previewSizingBound()).rejects.toThrow();
  expect(f.calls()).toBe(2);
}, 15000);

it('preserves actual dispatch UNKNOWN across protected reads and reopen without restoring authority', async () => {
  const f = await fixture(), prepared = await f.prepare();
  f.h.mockTransport!.loseNextSubmitResponseForTest();
  const response = await f.request('confirm', { confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
  const result = response.body.value;
  expect(result.outcome).toBe('unknown');
  const before = await f.read(result.intentId);
  expect(before.view.lifecycle.disposition).toBe('unknown');
  expect(before.view.lifecycle.dispatchUnknown).toBe(true);
  await f.h.close();
  const reopened = f.h.reopen(); harnesses.push(reopened);
  const request = f.makeRequest(reopened, await reopened.start());
  expect((await request('history', { candidateDispatchId: result.intentId })).body.value).toEqual(before);
  expect((await request('confirm', { confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).status).toBe(409);
}, 15000);

it('keeps partial/cancel/late fills distinct and retains holdings after cancellation settlement', async () => {
  const f = await fixture(), { result } = await f.confirm(), id = result.intentId;
  const initialView = await f.read(id), decisionId = initialView.view.decision.decisionId;
  f.fill(id, decisionId, d('2'));
  await f.request('reconcile');
  const beforeCancel = f.h.mockStore!.portfolio().snapshot;
  expect((await f.request('cancel', { intentId: id })).status).toBe(200);
  expect(f.h.mockStore!.portfolio().snapshot.cash).toEqual(beforeCancel.cash);
  f.fill(id, decisionId, d('1'), false);
  f.h.mockStore!.settleCanceled(id);
  await f.request('reconcile');
  const view = (await f.read(id)).view;
  expect(view.simulatedOrder.status).toBe('canceled');
  expect(view.portfolio.snapshot.quantity.value).toBe('3.000000000000000000');
  expect(view.portfolio.snapshot.cash.value).toBe('16.99000000');
  expect(view.completion).toBe('unestablished');
});

it('rejects boundary bypasses and unavailable joins without returning bodies or invented history', async () => {
  const f = await fixture(), { result } = await f.confirm();
  for (const extra of [{ authorization: '' }, { origin: 'https://invalid.test' }, { forwarded: 'invalid' }, { 'x-forwarded-host': 'invalid' }])
    expect((await f.request('history', { candidateDispatchId: result.intentId }, extra)).status).toBe(403);
  expect((await f.read(randomUUID())).state).toBe('unavailable');
  expect((await f.request('history', { candidateDispatchId: result.intentId, path: '/unavailable' })).status).toBe(409);
  f.advance(300001);
  expect((await f.request('history', { candidateDispatchId: result.intentId })).status).toBe(403);
});

it('rejects changed durable candidate evidence and retains unavailable classification', async () => {
  const f = await fixture(), { result } = await f.confirm();
  const before = await f.read(result.intentId);
  const key = before.view.sizing.evidenceManifestSha256;
  writeFileSync(join(f.h.mockPath! + '.sizing-evidence', key, 'manifest.json'), '{}');
  expect((await f.read(result.intentId)).state).toBe('unavailable');
  expect(() => f.h.mockStore!.portfolio()).toThrow();
});

it.each(['artifact', 'run', 'parameter', 'market', 'duplicate', 'oversize', 'object'] as const)
('rejects %s before producing a candidate decision context', fault => {
  const c = config(), m = manifest(c), p = snapshot(c, units(c.genesis.cash, 8), 0n, []);
  const input = rule(c, p, initial, true), observation = canonical({ referencePrice: d('1'),
    observedAt: iso(initial - 100), availableAt: iso(initial - 100), evidenceSha256: '5'.repeat(64) });
  let manifestText: unknown = canonical(m), inputText = canonical(input);
  if (fault === 'artifact') manifestText = canonical({ ...m, artifact: { ...m.artifact, evaluator: 'other' } });
  if (fault === 'run') inputText = canonical({ ...input, runId: randomUUID() });
  if (fault === 'parameter') inputText = canonical({ ...input, policy: { ...input.policy, exposureCap: d('0.5') } });
  if (fault === 'market') inputText = canonical({ ...input, data: { ...input.data, classification: 'market_shadow_input' } });
  if (fault === 'duplicate') manifestText = '{"schema":"one","schema":"two"}';
  if (fault === 'oversize') inputText = ' '.repeat(262145);
  if (fault === 'object') manifestText = { get schema() { throw new Error('must not inspect'); } };
  expect(evaluateCandidateShadowDecision(manifestText, inputText, observation)).toEqual({ status: 'rejected', reason: 'invalid_candidate_input' });
  expect(candidateShadowOperatingAdmission()).toMatchObject({ production: 'CLOSED', operations: 'DEFER',
    acquisitionAllowed: false, dispatchAllowed: false, C07_CLOSURE_REVISIONS: 'UNKNOWN',
    C13_REVIEWER_ADMISSION: 'UNKNOWN', C14_HANDLING: 'UNKNOWN' });
});

// Owner-written catalog oracles: these assert cross-boundary outcomes, not an
// imagined private implementation or actual market/handling qualification.
it('retains candidate-bound no-effect evidence without an order or invented joined history', async () => {
  const f = await fixture(); f.cash();
  const result = await f.h.previewSizingBound();
  expect(result).toHaveProperty('noOrder.reason', 'already_cash');
  const root = f.h.mockPath! + '.sizing-evidence';
  const artifacts = readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name));
  expect(artifacts).toHaveLength(1);
  const manifest = JSON.parse(readFileSync(join(root, artifacts[0], 'manifest.json'), 'utf8'));
  expect(manifest.candidateId).toBe(candidateShadowId(f.m));
  expect((await f.request('history')).body.value.items).toEqual([]);
  expect((await f.read(randomUUID())).state).toBe('unavailable');
  expect(f.h.mockStore!.portfolio().snapshot.cash.value).toBe('20.00000000');
  expect(f.h.mockStore!.portfolio().snapshot.quantity.value).toBe('0.000000000000000000');
});

it('rejects a stale prepared candidate without refreshing its evidence or producing an order', async () => {
  const f = await fixture(), prepared = await f.prepare();
  const root = f.h.mockPath! + '.sizing-evidence';
  const names = readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name));
  const before = readFileSync(join(root, names[0], 'input.json'));
  f.advance(60001);
  const result = await f.request('confirm', { confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
  expect(result.status).toBe(409);
  expect((await f.request('history')).body.value.items).toEqual([]);
  expect(readFileSync(join(root, names[0], 'input.json'))).toEqual(before);
  expect(f.calls()).toBe(1);
  expect(f.h.mockStore!.portfolio().snapshot.cash.value).toBe('20.00000000');
});

it('caller manifest mutation cannot rewrite the persisted candidate or executed terms', async () => {
  const f = await fixture(), { result } = await f.confirm();
  const before = await f.read(result.intentId);
  const id = candidateShadowId(f.m);
  f.m.runId = randomUUID();
  f.m.ruleBinding.policy.exposureCap = d('0.5');
  expect((await f.read(result.intentId))).toEqual(before);
  expect(before.view.candidateId).toBe(id);
  await expect(f.h.previewSizingBound()).rejects.toThrow();
  expect((await f.read(result.intentId)).view.candidateId).toBe(id);
});

it.each([300001, -1])('denies a joined read if its owner clock crosses expiry or goes backwards during replay (%s)', async delta => {
  const f = await fixture(), { result } = await f.confirm();
  const store = f.h.mockStore!, original = store.readCandidateShadow.bind(store);
  const spy = vi.spyOn(store, 'readCandidateShadow').mockImplementation(id => {
    const value = original(id);
    f.advance(delta);
    return value;
  });
  let response: Awaited<ReturnType<typeof f.request>>;
  try { response = await f.request('history', { candidateDispatchId: result.intentId }); }
  finally { spy.mockRestore(); }
  expect(response.status).toBe(403);
  expect(response.body.value).toBeUndefined();
}, 15000);

it('pins the fixed baseline descriptor to the inspected evaluator, contract and reference source bytes', () => {
  for (const claim of [candidateShadowArtifact.ruleSource, candidateShadowArtifact.contractSource, candidateShadowArtifact.referenceSource]) {
    const [path, sha256] = claim.split('@');
    const source = readFileSync(new URL('../../../' + path, import.meta.url));
    expect(createHash('sha256').update(source).digest('hex')).toBe(sha256);
  }
});

it.each(['live', 'reopened'] as const)('rejects duplicate lifecycle fill A substituted for missing B through protected %s reads', async mode => {
  const f = await fixture(), { prepared, result } = await f.confirm();
  const id = result.intentId, decisionId = (await f.read(id)).view.decision.decisionId;
  f.fill(id, decisionId, d('1'));
  f.fill(id, decisionId, decimal(units(prepared.terms.order.requestedQuantity, 18) - units(d('1'), 18), 18), false);
  // A legitimate lag in lifecycle observation remains UNKNOWN until reconcile.
  expect((await f.read(id)).view.lifecycle.disposition).toBe('unknown');
  expect((await f.request('reconcile')).status).toBe(200);
  expect((await f.read(id)).view.lifecycle.disposition).toBe('settled');
  let pending: Awaited<ReturnType<typeof f.prepare>> | undefined;
  if (mode === 'live') { f.cash(); pending = await f.prepare(); }
  // Deliberate test-owned corruption: preserve distinct event identities and a
  // matching stored projection, but replace observation B's complete value by A.
  const db = new Database(f.h.path);
  try {
    db.transaction(() => {
      const rows = db.prepare('SELECT sequence,body FROM synthetic_events WHERE intent=? ORDER BY sequence').all(id) as { sequence: number; body: string }[];
      const events = rows.map(row => JSON.parse(row.body));
      const positions = events.flatMap((event, index) => event.type === 'execution-observed' ? [index] : []);
      expect(positions).toHaveLength(2);
      events[positions[1]].execution = events[positions[0]].execution;
      db.prepare('UPDATE synthetic_events SET body=? WHERE intent=? AND sequence=?').run(canonical(events[positions[1]]), id, rows[positions[1]].sequence);
      const stored = db.prepare('SELECT projection FROM synthetic_intents WHERE id=?').get(id) as { projection: string };
      const projection = JSON.parse(stored.projection); projection.facts = events;
      db.prepare('UPDATE synthetic_intents SET projection=? WHERE id=?').run(canonical(projection), id);
    }).immediate();
  } finally { db.close(); }
  let active = f.h, request = f.request;
  if (mode === 'live') {
    expect((await f.read(id)).state).toBe('unavailable');
  } else {
    await f.h.close();
    active = f.h.reopen(); harnesses.push(active);
    request = f.makeRequest(active, await active.start());
    expect((await request('history', { candidateDispatchId: id })).body.value.state).toBe('unavailable');
  }
  if (pending) {
    expect((await request('confirm', { confirmationToken: pending.confirmationToken, termsHash: pending.termsHash })).status).toBe(409);
  }
  expect((await request('resume')).status).toBe(409);
  const calls = f.calls();
  await expect(active.previewSizingBound()).rejects.toThrow();
  expect(f.calls()).toBe(calls);
  await expect(active.close()).rejects.toThrow();
  expect(existsSync(active.path + '.lock')).toBe(true);
  expect(existsSync(active.mockPath! + '.lock')).toBe(true);
  expect(() => active.reopen()).toThrow();
}, 20000);

it('a missing candidate selection does not poison clean owners or block valid preparation', async () => {
  const f = await fixture();
  expect((await f.read(randomUUID())).state).toBe('unavailable');
  await expect(f.h.previewSizingBound()).resolves.not.toHaveProperty('noOrder');
  expect(f.calls()).toBe(1);
  await expect(f.h.close()).resolves.toBeUndefined();
  expect(existsSync(f.h.path + '.lock')).toBe(false);
  expect(existsSync(f.h.mockPath! + '.lock')).toBe(false);
});
