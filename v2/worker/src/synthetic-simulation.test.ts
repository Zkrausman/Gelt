import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { dirname } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonical } from './ledger-canonical.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';
import { syntheticMockRunPreviewSchema, type SyntheticRunPreview, type SyntheticRunExecution } from './synthetic-mock-robinhood-contract.js';
import { simulationRunSchema, simulationDigest, simulationSource, simulationPolicy, executionPrice, checkObservation, units,
  rounded, notional, decimal, type SimulationRun } from './synthetic-simulation-economics.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { shadowRuleId, type ShadowRuleInput } from './shadow-rule-contract.js';
import { type SimulationDecisionContext } from './synthetic-mock-robinhood-adapter.js';

// All prices/calibration/bars/clock bounds here are constructed offline TEST inputs.
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const iso = (time: number) => new Date(time).toISOString();
const initialTime = Date.parse('2026-10-14T10:00:00.000Z');
function config(): SimulationRun {
  return simulationRunSchema.parse({ version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD', currency: 'USD',
    classification: 'constructed_offline_test', genesis: { cash: d('20'), quantity: d('0') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0.001'), slippageFraction: d('0.002') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 3600000, maxObservationAgeMs: 60000,
    validThrough: iso(initialTime + 3600000), rounding: 'adverse-price-8-cumulative-cash-8.v1' });
}
let roots: string[] = [];
beforeEach(() => {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only'; process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
});
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true }); roots = [];
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS; delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
});
function fixture(c = config()) {
  let time = initialTime, context: SimulationDecisionContext;
  const h = createSyntheticOrderHarness(() => time, { applicationMock: true, simulationRun: { config: c, decision: () => context } });
  roots.push(dirname(dirname(h.path)));
  const set = (side: 'buy' | 'sell', price = '1') => {
    const decisionAt = time - 200, closed = time - 1000;
    const p = h.mockStore!.portfolio().snapshot;
    const input: ShadowRuleInput = { schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId, runId: c.runId, sourceCommit: c.sourceCommit,
      decisionAt: iso(decisionAt), instrument: { id: c.instrumentId, currency: 'USD', calendarSha256: 'c'.repeat(64) },
      data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: 'd'.repeat(64), rightsEvidenceSha256: 'e'.repeat(64), pointInTimeEvidenceSha256: 'f'.repeat(64) },
      policy: { scheduleSha256: '1'.repeat(64), maxAgeMs: 86400000, exposureCap: d('0.25') },
      costs: { status: 'declared', evidenceSha256: c.calibrationEvidenceSha256, stressScenarioSha256: '2'.repeat(64),
        commissionPerTrade: c.costs.commissionPerOrder, spreadFraction: c.costs.spreadFraction, slippageFraction: c.costs.slippageFraction },
      controls: { passiveSha256: '3'.repeat(64), cashAssumptionSha256: '4'.repeat(64) }, portfolio: { state: 'settled', snapshotSha256: simulationDigest(p) },
      bars: Array.from({ length: 253 }, (_, i) => ({ sessionOrdinal: i, closedAt: iso(closed - (252 - i) * 86400000),
        availableAt: iso(closed - (252 - i) * 86400000), adjustedClose: d(i === 252 ? side === 'buy' ? '101' : '99' : '100') })) };
    const bytes = Buffer.from(canonical(input)); context = { inputBytes: bytes, receipt: evaluateShadowRule(bytes),
      observation: { referencePrice: d(price), observedAt: iso(time - 100), availableAt: iso(time - 100), evidenceSha256: '5'.repeat(64) } };
    return context;
  };
  const preview = (side: 'buy' | 'sell', quantity = '1', limit = side === 'buy' ? '1.10' : '0.90'): SyntheticRunPreview => {
    return syntheticMockRunPreviewSchema.parse({ version: 2, source: simulationSource, previewId: randomUUID(), principal: 'gelt-test-principal-v1', account: 'gelt-test-account-v1',
      policyId: simulationPolicy, runId: c.runId, configSha256: simulationDigest(c), sourceCommit: c.sourceCommit,
      decisionId: `shadow-decision-${randomUUID().replaceAll('-', '').padEnd(64, 'a')}`, decisionAt: iso(time - 200), inputSha256: '6'.repeat(64),
      portfolioSnapshotSha256: simulationDigest(h.mockStore!.portfolio().snapshot), classification: c.classification,
      quote: { referencePrice: d('1'), price: executionPrice(c, side, d('1')), observedAt: iso(time - 100), availableAt: iso(time - 100),
        evidenceSha256: '5'.repeat(64), instrumentId: c.instrumentId, source: 'declared-simulated-observation-v2' },
      fee: { amount: c.costs.commissionPerOrder, currency: 'USD', source: 'declared-simulated-cost-v2' },
      order: { instrumentId: c.instrumentId, route: 'RHS', side, type: 'limit', timeInForce: 'day', quantity: d(quantity), limitPrice: d(limit), currency: 'USD' },
      expiresAt: iso(time + 60000) });
  };
  const submit = (p: SyntheticRunPreview) => {
    const token = 'T'.repeat(43), termsHash = '7'.repeat(64);
    const a = h.mockStore!.admit({ preview: p, termsHash, confirmationToken: token });
    const input = { dispatchId: randomUUID(), preview: p, termsHash, confirmationToken: token, admissionHandle: a.handle };
    h.mockStore!.submit(input); return input;
  };
  const fill = (order: { dispatchId: string; preview: SyntheticRunPreview }, quantity = '1', reference = '1', first = true): SyntheticRunExecution => ({
    version: 2, runId: c.runId, configSha256: simulationDigest(c), decisionId: order.preview.decisionId, receiptId: randomUUID(), executionId: randomUUID(),
    quantity: d(quantity), price: executionPrice(c, order.preview.order.side, d(reference)), fee: first ? c.costs.commissionPerOrder : d('0'), currency: 'USD',
    observation: { referencePrice: d(reference), observedAt: iso(time), availableAt: iso(time), evidenceSha256: '8'.repeat(64) },
  });
  return { h, c, set, preview, submit, fill, now: () => time, advance: (delta = 1000) => time += delta, changeContext: (fn: (x: SimulationDecisionContext) => void) => fn(context) };
}
async function post(h: ReturnType<typeof createSyntheticOrderHarness>, port: number, operation: string, input: unknown = {}) {
  const body = canonical(input);
  return new Promise<{ status: number; value: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: `/v1/synthetic-orders/${operation}`, method: 'POST', headers: {
      Host: `127.0.0.1:${port}`, Authorization: `Bearer ${h.auth.bearer}`, 'X-Gelt-Session': h.auth.session, 'X-Gelt-Session-Expires': String(h.auth.expiresAt),
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { try { resolve({ status: res.statusCode!, value: JSON.parse(text).value }); } catch (e) { reject(e); } });
    }); req.on('error', reject); req.end(body);
  });
}
const order = (side: 'buy' | 'sell', quantity = '1', limit = side === 'buy' ? '1.10' : '0.90') => ({ route: 'RHS', instrumentId: 'SYNTH-RH-USD', side, currency: 'USD', requestedQuantity: d(quantity), requestedLimitPrice: d(limit) });

it.each([['0.01', '0.001', '0.002', '19.97400000'], ['0.02', '0.01', '0.01', '19.92000000']])('actual rules direction -> lifecycle/mock BUY then SELL reconciles costs %s/%s/%s', async (fee, spread, slip, endingCash) => {
  const c = config(); c.costs = { commissionPerOrder: d(fee), spreadFraction: d(spread), slippageFraction: d(slip) };
  const f = fixture(c); let port = await f.h.start();
  try {
    expect((await post(f.h, port, 'resume')).status).toBe(200);
    for (const side of ['buy', 'sell'] as const) {
      const decision = f.set(side); expect((decision.receipt as any).decision).toBe(side === 'buy' ? 'target_long' : 'target_cash');
      const p = await post(f.h, port, 'preview', order(side)); expect(p.status).toBe(200);
      const accepted = await post(f.h, port, 'confirm', { confirmationToken: p.value.confirmationToken, termsHash: p.value.termsHash });
      expect(accepted.value.outcome).toBe('acknowledged');
      const mock = f.h.mockStore!.read(accepted.value.intentId)!; expect(mock.executions).toEqual([]);
      const execution: SyntheticRunExecution = { ...f.fill({ dispatchId: accepted.value.intentId, preview: { decisionId: (decision.receipt as any).decisionId, order: { side } } as SyntheticRunPreview }), price: executionPrice(c, side, d('1')) };
      f.advance(); execution.observation.observedAt = iso(f.now()); execution.observation.availableAt = iso(f.now());
      f.h.mockStore!.observeExecution(accepted.value.intentId, execution);
      expect((await post(f.h, port, 'reconcile')).status).toBe(200);
      const history = await post(f.h, port, 'history'); expect(history.value.items.at(-1).facts.some((x: any) => x.syntheticType === 'execution-observed')).toBe(true);
      f.advance();
    }
    const final = await f.h.mockTransport!.client.portfolio(); expect(final.state).toBe('settled'); expect(final.snapshot.quantity.value).toBe('0.000000000000000000');
    expect(final.snapshot.cash.value).toBe(endingCash); expect(final.snapshot.marketEvaluation).toBe('not_established');
    await f.h.close(); const reopened = f.h.reopen(); try { expect(reopened.mockStore!.portfolio()).toEqual(final); } finally { await reopened.close(); }
  } finally { await f.h.close(); }
});

it('partial/cancel/late fill never creates a cash exit; only an actual SELL reduces holdings', async () => {
  const f = fixture();
  try {
    const a = f.submit(f.preview('buy')); f.advance(); f.h.mockStore!.observeExecution(a.dispatchId, f.fill(a, '0.25'));
    const p = f.h.mockStore!.portfolio().snapshot; expect(p.cash.value).toBe('19.73925000'); expect(p.quantity.value).toBe('0.250000000000000000');
    f.h.mockStore!.cancel(a.dispatchId); expect(f.h.mockStore!.portfolio().snapshot.cash).toEqual(p.cash);
    f.advance(); f.h.mockStore!.observeExecution(a.dispatchId, f.fill(a, '0.25', '1', false)); f.h.mockStore!.settleCanceled(a.dispatchId);
    expect(f.h.mockStore!.portfolio().snapshot.quantity.value).toBe('0.500000000000000000');
    const sell = f.submit(f.preview('sell', '0.50')); f.advance(); f.h.mockStore!.observeExecution(sell.dispatchId, f.fill(sell, '0.50'));
    expect(f.h.mockStore!.portfolio().snapshot.quantity.value).toBe('0.000000000000000000');
  } finally { await f.h.close(); }
});

it('rounds cumulative split-fill cash once, keeps reservation and fee even at sub-money-unit edges', async () => {
  const c = config(); c.costs = { commissionPerOrder: d('0'), spreadFraction: d('0'), slippageFraction: d('0') }; c.genesis.cash = d('1');
  const f = fixture(c);
  try {
    const a = f.submit(f.preview('buy', '1', '1')); f.advance();
    for (let i = 0; i < 3; i++) f.h.mockStore!.observeExecution(a.dispatchId, f.fill(a, '0.333333333333333333', '1', i === 0));
    expect(f.h.mockStore!.portfolio().snapshot.cash.value).toBe('0.00000000');
    f.h.mockStore!.observeExecution(a.dispatchId, f.fill(a, '0.000000000000000001', '1', false));
    expect(f.h.mockStore!.read(a.dispatchId)!.status).toBe('filled');
    expect(f.h.mockStore!.portfolio().snapshot.quantity.value).toBe('1.000000000000000000');
  } finally { await f.h.close(); }
});

it.each(['buy-overfill', 'sell-below-limit', 'buy-above-limit', 'wrong-run', 'wrong-config', 'wrong-decision', 'wrong-fee', 'future', 'stale', 'before-admission'] as const)('rejects %s fill before any event/portfolio mutation', async fault => {
  const c = config(); c.genesis.quantity = d('1'); const f = fixture(c);
  try {
    const side = fault === 'sell-below-limit' ? 'sell' : 'buy', a = f.submit(f.preview(side)); f.advance();
    const e = f.fill(a), oldOrder = f.h.mockStore!.read(a.dispatchId), oldPortfolio = f.h.mockStore!.portfolio();
    if (fault === 'buy-overfill') { e.quantity = d('1.000000000000000001'); e.observation.referencePrice = d('0.10'); e.price = executionPrice(c, 'buy', d('0.10')); expect(rounded(notional(e.quantity, e.price), 36, 8, true) + units(e.fee, 8)).toBeLessThan(110000000n + units(c.costs.commissionPerOrder, 8)); }
    if (fault === 'sell-below-limit' || fault === 'buy-above-limit') { e.observation.referencePrice = d(fault === 'sell-below-limit' ? '0.50' : '2'); e.price = executionPrice(c, side, e.observation.referencePrice); }
    if (fault === 'wrong-run') e.runId = randomUUID(); if (fault === 'wrong-config') e.configSha256 = '9'.repeat(64);
    if (fault === 'wrong-decision') e.decisionId = `shadow-decision-${'9'.repeat(64)}`; if (fault === 'wrong-fee') e.fee = d('0');
    if (fault === 'future') e.observation.availableAt = iso(f.now() + 1);
    if (fault === 'stale') f.advance(c.maxObservationAgeMs + 1);
    if (fault === 'before-admission') e.observation.observedAt = iso(initialTime - 1);
    expect(() => f.h.mockStore!.observeExecution(a.dispatchId, e)).toThrow();
    expect(f.h.mockStore!.read(a.dispatchId)).toEqual(oldOrder); expect(f.h.mockStore!.portfolio()).toEqual(oldPortfolio);
  } finally { await f.h.close(); }
});

it('accepts exact directional limits and total quantity, rejects one minimum unit beyond', async () => {
  const c = config(); c.genesis.quantity = d('1'); const f = fixture(c);
  try {
    const a = f.submit(f.preview('sell', '1', '0.99700000')); f.advance(); const e = f.fill(a);
    expect(f.h.mockStore!.observeExecution(a.dispatchId, e).status).toBe('filled');
    expect(f.h.mockStore!.observeExecution(a.dispatchId, e).status).toBe('filled');
    expect(() => f.h.mockStore!.observeExecution(a.dispatchId, { ...e, quantity: d('1.000000000000000001') })).toThrow();
  } finally { await f.h.close(); }
});

it('retains exact dispatch/fill duplicates but rejects changed payloads and reused decision after cancel/reopen', async () => {
  const f = fixture();
  try {
    const p = f.preview('buy'), a = f.submit(p), first = f.h.mockStore!.read(a.dispatchId);
    expect(f.h.mockStore!.submit(a)).toEqual(first);
    expect(() => f.h.mockStore!.submit({ ...a, dispatchId: randomUUID() })).toThrow();
    expect(() => f.h.mockStore!.submit({ ...a, termsHash: '9'.repeat(64) })).toThrow();
    f.h.mockStore!.cancel(a.dispatchId); f.h.mockStore!.settleCanceled(a.dispatchId);
    const after = f.h.mockStore!.portfolio().snapshot; expect(after.cash.value).toBe('20.00000000');
    expect(simulationDigest(after)).not.toBe(p.portfolioSnapshotSha256); expect(after.revision).toBe(4);
    await f.h.close(); const reopened = f.h.reopen();
    try {
      const newPreview = { ...p, previewId: randomUUID(), portfolioSnapshotSha256: simulationDigest(after) };
      expect(() => reopened.mockStore!.admit({ preview: newPreview, termsHash: '7'.repeat(64), confirmationToken: 'T'.repeat(43) })).toThrow();
      expect(reopened.mockStore!.portfolio().snapshot).toEqual(after);
    } finally { await reopened.close(); }
  } finally { await f.h.close(); }
});

it('keeps expired unused decision tombstones and refuses overlapping cash/position reservations', async () => {
  const f = fixture();
  try {
    const p = f.preview('buy'); f.h.mockStore!.admit({ preview: p, termsHash: '7'.repeat(64), confirmationToken: 'T'.repeat(43) });
    expect(() => f.submit(f.preview('buy'))).toThrow();
    f.advance(60001);
    expect(() => f.h.mockStore!.admit({ preview: { ...p, previewId: randomUUID(), expiresAt: iso(f.now() + 60000), quote: { ...p.quote, observedAt: iso(f.now() - 100), availableAt: iso(f.now() - 100) } }, termsHash: '7'.repeat(64), confirmationToken: 'T'.repeat(43) })).toThrow();
    expect(f.h.mockStore!.portfolio().state).toBe('settled');
    expect(f.submit(f.preview('buy')).dispatchId).toBeTruthy();
  } finally { await f.h.close(); }
});

it.each(['oversell', 'cash', 'cap', 'snapshot', 'currency', 'decision-age'] as const)('rejects %s admission before an order effect', async fault => {
  const c = config(); if (fault === 'cash') c.genesis.cash = d('0'); const f = fixture(c);
  try {
    const p: any = f.preview(fault === 'oversell' ? 'sell' : 'buy', fault === 'cap' ? '10' : '1');
    if (fault === 'snapshot') p.portfolioSnapshotSha256 = '9'.repeat(64); if (fault === 'currency') p.order.currency = 'EUR';
    if (fault === 'decision-age') { p.decisionAt = iso(f.now() - c.maxDecisionAgeMs - 1); }
    const before = f.h.mockStore!.portfolio(); expect(() => f.submit(p)).toThrow(); expect(f.h.mockStore!.portfolio()).toEqual(before);
  } finally { await f.h.close(); }
});

it('inclusive ages/validity boundaries and fresh previews cannot launder stale decision/observations', () => {
  const c = config(), observation = { referencePrice: d('1'), observedAt: iso(initialTime - 100), availableAt: iso(initialTime), evidenceSha256: '1'.repeat(64) };
  expect(() => checkObservation(c, iso(initialTime - c.maxDecisionAgeMs), observation, initialTime)).not.toThrow();
  expect(() => checkObservation(c, iso(initialTime - c.maxDecisionAgeMs - 1), observation, initialTime)).toThrow();
  observation.observedAt = iso(initialTime - c.maxObservationAgeMs); expect(() => checkObservation(c, iso(initialTime - c.maxDecisionAgeMs), observation, initialTime)).not.toThrow();
  observation.observedAt = iso(initialTime - c.maxObservationAgeMs - 1); expect(() => checkObservation(c, iso(initialTime - c.maxDecisionAgeMs), observation, initialTime)).toThrow();
  observation.observedAt = c.validThrough; observation.availableAt = c.validThrough;
  expect(() => checkObservation(c, iso(Date.parse(c.validThrough) - 1), observation, Date.parse(c.validThrough))).not.toThrow();
  expect(() => checkObservation(c, iso(Date.parse(c.validThrough) - 1), observation, Date.parse(c.validThrough) + 1)).toThrow();
});

it.each(['negative-scale', 'huge-scale', 'bad-value', 'overflow-genesis'] as const)('bounds economics parsing before arithmetic: %s', fault => {
  const c: any = config();
  if (fault === 'negative-scale') c.costs.spreadFraction.scale = -1;
  if (fault === 'huge-scale') c.costs.slippageFraction.scale = 1000000000;
  if (fault === 'bad-value') c.costs.spreadFraction.value = 'bogus';
  if (fault === 'overflow-genesis') c.genesis.cash = d('9'.repeat(38));
  expect(simulationRunSchema.safeParse(c).success).toBe(false);
});

it('explicit adverse rounding rejects nonpositive sell prices and never silently drops declared costs', () => {
  const c = config(); expect(executionPrice(c, 'buy', d('1.000000001')).value).toBe('1.00300001');
  expect(executionPrice(c, 'sell', d('1.000000001')).value).toBe('0.99700000');
  c.costs.spreadFraction = d('1'); expect(() => executionPrice(c, 'sell', d('1'))).toThrow();
  c.costs.spreadFraction = d('0'); c.costs.slippageFraction = d('0'); expect(() => executionPrice(c, 'sell', d('0.000000001'))).toThrow();
});

it('response loss keeps lifecycle UNKNOWN, durable reservation and refuses resume/new dispatch after reopen', async () => {
  const f = fixture(); const port = await f.h.start();
  try {
    f.set('buy'); await post(f.h, port, 'resume'); const p = await post(f.h, port, 'preview', order('buy')); expect(p.status).toBe(200);
    f.h.mockTransport!.loseNextSubmitResponseForTest(); const lost = await post(f.h, port, 'confirm', { confirmationToken: p.value.confirmationToken, termsHash: p.value.termsHash });
    expect(lost.value.outcome).toBe('unknown'); expect(f.h.mockStore!.portfolio().state).toBe('unsettled');
    await f.h.close(); const reopened = f.h.reopen(); const reopenedPort = await reopened.start();
    try { expect((await post(reopened, reopenedPort, 'resume')).status).toBe(409); expect((await post(reopened, reopenedPort, 'preview', order('buy'))).status).toBe(409); expect(reopened.mockStore!.read(lost.value.intentId)!.executions).toEqual([]); }
    finally { await reopened.close(); }
  } finally { await f.h.close(); }
});

it.each(['config', 'projection', 'buy-limit', 'sell-limit', 'quantity'] as const)('persisted %s corruption rejects reopen and retains ownership', async corruption => {
  const c = config(); c.genesis.quantity = d('1'); const f = fixture(c); const a = f.submit(f.preview(corruption === 'sell-limit' ? 'sell' : 'buy')); f.advance(); f.h.mockStore!.observeExecution(a.dispatchId, f.fill(a)); await f.h.close();
  const db = new Database(f.h.mockPath!);
  try {
    if (corruption === 'config') db.prepare('UPDATE mock_meta SET config_sha=?').run('9'.repeat(64));
    else if (corruption === 'projection') { const raw = JSON.parse((db.prepare('SELECT portfolio_json FROM mock_meta').get() as any).portfolio_json); raw.cash = decimal(0n, 8); db.prepare('UPDATE mock_meta SET portfolio_json=?').run(canonical(raw)); }
    else {
      const row = db.prepare('SELECT event_json FROM mock_events WHERE sequence=2').get() as any; const e = JSON.parse(row.event_json);
      if (corruption === 'quantity') e.execution.quantity = d('1.000000000000000001');
      else { const side = corruption === 'sell-limit' ? 'sell' : 'buy', price = side === 'sell' ? '0.50' : '2'; e.execution.observation.referencePrice = d(price); e.execution.price = executionPrice(f.c, side, d(price)); }
      db.prepare('UPDATE mock_events SET event_json=? WHERE sequence=2').run(canonical(e));
    }
  } finally { db.close(); }
  expect(() => f.h.reopen()).toThrow(); expect(existsSync(f.h.mockPath! + '.lock')).toBe(true);
});

it.each(['changed-config', 'default-v1'] as const)('incompatible %s reopen refuses without migration', async mode => {
  const f = fixture(); await f.h.close(); const changed = { ...f.c, calibrationEvidenceSha256: '9'.repeat(64) };
  expect(() => new SyntheticMockRobinhoodStore(f.h.mockPath!, f.now, undefined, mode === 'changed-config' ? { simulationRun: changed } : {})).toThrow();
  expect(existsSync(f.h.mockPath! + '.lock')).toBe(true);
});

it('default lifecycle still refuses SELL and configured scope refuses disabled flags', async () => {
  const legacy = createSyntheticOrderHarness(() => initialTime, { applicationMock: true }); roots.push(dirname(dirname(legacy.path)));
  const port = await legacy.start(); try { await post(legacy, port, 'resume'); expect((await post(legacy, port, 'preview', order('sell'))).status).toBe(409); } finally { await legacy.close(); }
  const f = fixture(); delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  expect(() => f.h.mockStore!.portfolio()).toThrow('synthetic mock disabled');
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only'; await f.h.close();
});


it.each(['tampered-receipt', 'direction', 'cost', 'stale-portfolio'] as const)('actual G05 binding rejects %s before dispatch', async fault => {
  const f = fixture(); const port = await f.h.start();
  try {
    f.set('buy');
    if (fault === 'tampered-receipt') f.changeContext(x => { (x.receipt as any).decisionId = `shadow-decision-${'9'.repeat(64)}`; });
    if (fault === 'direction') f.set('sell');
    if (fault === 'cost' || fault === 'stale-portfolio') f.changeContext(x => {
      const input = JSON.parse(x.inputBytes.toString());
      if (fault === 'cost') input.costs.commissionPerTrade = d('0.02'); else input.portfolio.snapshotSha256 = '9'.repeat(64);
      x.inputBytes = Buffer.from(canonical(input)); x.receipt = evaluateShadowRule(x.inputBytes);
    });
    const before = f.h.mockStore!.portfolio(); await post(f.h, port, 'resume'); expect((await post(f.h, port, 'preview', order('buy'))).status).toBe(409);
    expect(f.h.mockStore!.portfolio()).toEqual(before); expect((await post(f.h, port, 'history')).value.items).toEqual([]);
  } finally { await f.h.close(); }
});

it('concurrent confirmations admit exactly one order', async () => {
  const f = fixture(); const port = await f.h.start();
  try {
    f.set('buy'); await post(f.h, port, 'resume'); const p = await post(f.h, port, 'preview', order('buy'));
    expect(p.status).toBe(200);
    const confirmation = { confirmationToken: p.value.confirmationToken, termsHash: p.value.termsHash };
    const results = await Promise.all([post(f.h, port, 'confirm', confirmation), post(f.h, port, 'confirm', confirmation)]);
    expect(results.filter(x => x.status === 200)).toHaveLength(1); expect(results.filter(x => x.status === 409)).toHaveLength(1);
    expect((await post(f.h, port, 'history')).value.items).toHaveLength(1);
  } finally { await f.h.close(); }
});

it('global receipt/execution identity reuse and stale equal-balance snapshots do not create another effect', async () => {
  const c = config(); c.genesis.quantity = d('1'); const f = fixture(c);
  try {
    const first = f.submit(f.preview('buy')); f.advance(); const e = f.fill(first); f.h.mockStore!.observeExecution(first.dispatchId, e);
    const second = f.submit(f.preview('sell')); f.advance();
    const before = f.h.mockStore!.portfolio(), orderBefore = f.h.mockStore!.read(second.dispatchId);
    const newFill = { ...f.fill(second), executionId: e.executionId }; expect(() => f.h.mockStore!.observeExecution(second.dispatchId, newFill)).toThrow();
    expect(f.h.mockStore!.portfolio()).toEqual(before); expect(f.h.mockStore!.read(second.dispatchId)).toEqual(orderBefore);
  } finally { await f.h.close(); }
});


// Controlled SQLite corruption in fresh private test fixtures only. Restoring
// the exact STRICT declaration leaves an invalid BLOB cell for replay guards.
function corruptMetadata(path: string, column: 'config_json' | 'config_sha' | 'portfolio_json', kind: 'TEXT' | 'BLOB'): void {
  let db = new Database(path);
  try {
    if (kind === 'TEXT') { db.prepare(`UPDATE mock_meta SET ${column}=? WHERE id=1`).run('x'.repeat(8193)); return; }
    const original = (db.prepare("SELECT sql FROM sqlite_schema WHERE name='mock_meta'").get() as { sql: string }).sql;
    const version = db.pragma('schema_version', { simple: true }) as number;
    db.unsafeMode(true); // Only this fresh corruption fixture disables SQLite defensive mode.
    db.pragma('writable_schema=ON'); db.prepare("UPDATE sqlite_schema SET sql=? WHERE name='mock_meta'").run(original.replace(/ STRICT$/, ''));
    db.pragma(`schema_version=${version + 1}`); db.close(); db = new Database(path);
    db.prepare(`UPDATE mock_meta SET ${column}=? WHERE id=1`).run(Buffer.alloc(8193));
    db.unsafeMode(true); // Restore the exact declaration on the fixture connection.
    db.pragma('writable_schema=ON'); db.prepare("UPDATE sqlite_schema SET sql=? WHERE name='mock_meta'").run(original);
    db.pragma(`schema_version=${version + 2}`);
  } finally { if (db.open) db.close(); }
}
const metadataCases = (['config_json', 'config_sha', 'portfolio_json'] as const).flatMap(column =>
  (['TEXT', 'BLOB'] as const).flatMap(kind => (['read', 'reopen'] as const).map(phase => ({ column, kind, phase }))));
it.each(metadataCases)('rejects oversized $kind $column on $phase before body materialization and retains ownership', async ({ column, kind, phase }) => {
  const f = fixture(); if (phase === 'reopen') await f.h.close();
  corruptMetadata(f.h.mockPath!, column, kind);
  const spy = vi.spyOn(Database.prototype, 'prepare');
  try {
    if (phase === 'reopen') expect(() => f.h.reopen()).toThrow(); else expect(() => f.h.mockStore!.portfolio()).toThrow();
    // The native driver never receives a statement that fetches these bodies.
    expect(spy.mock.calls.some(([sql]) => /^SELECT (config_json|portfolio_json)/.test(sql))).toBe(false);
  } finally { spy.mockRestore(); try { await f.h.close(); } catch { /* poisoned fixture keeps its marker */ } }
  expect(existsSync(f.h.mockPath! + '.lock')).toBe(true);
});

it('unsupported default-v1 portfolio reads reject without poisoning or affecting subsequent order reads', async () => {
  const legacy = createSyntheticOrderHarness(() => initialTime, { applicationMock: true }); roots.push(dirname(dirname(legacy.path)));
  await legacy.start();
  try {
    expect(() => legacy.mockStore!.portfolio()).toThrow();
    await expect(legacy.mockTransport!.client.portfolio()).rejects.toThrow();
    expect(legacy.mockStore!.read(randomUUID())).toBeUndefined();
    expect(existsSync(legacy.mockPath! + '.lock')).toBe(true);
  } finally { await legacy.close(); }
  expect(existsSync(legacy.mockPath! + '.lock')).toBe(false);
});

it('a decision remains consumed after a filled order even with its refreshed current snapshot', async () => {
  const f = fixture();
  try {
    const p = f.preview('buy'), a = f.submit(p); f.advance(); f.h.mockStore!.observeExecution(a.dispatchId, f.fill(a));
    const state = f.h.mockStore!.portfolio(); expect(state.state).toBe('settled');
    expect(() => f.h.mockStore!.admit({ preview: { ...p, previewId: randomUUID(), portfolioSnapshotSha256: simulationDigest(state.snapshot) }, termsHash: '7'.repeat(64), confirmationToken: 'T'.repeat(43) })).toThrow();
    expect(f.h.mockStore!.portfolio()).toEqual(state);
  } finally { await f.h.close(); }
});
