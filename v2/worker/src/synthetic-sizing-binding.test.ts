import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { canonical, digest } from './ledger-canonical.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';
import { type EvidenceStage } from './synthetic-sizing-binding-evidence.js';
import { sizingBindingPolicySchema, sizingBindingRejectionSchema, syntheticMockRunPreviewSchema,
  type SizingBindingPolicy, type SyntheticRunPreview } from './synthetic-mock-robinhood-contract.js';
import { simulationRunSchema, simulationDigest, executionPrice, type SimulationRun, type SimulationSnapshot } from './synthetic-simulation-economics.js';
import { shadowRuleId, type ShadowRuleInput } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { matchesShadowSizingProposal } from './shadow-sizing.js';
import type { SimulationDecisionContext } from './synthetic-mock-robinhood-adapter.js';
import { OrderLifecycle, hasUnresolvedLifecycle, assertConfiguredSubmitPermit, consumeConfiguredSubmitPermit,
  type LifecycleFacts, type OrderAdapter } from './order-lifecycle.js';
import { intentSchema, eventSchema, type Projection, type Result, type WriteReceipt } from './ledger-contract.js';

// Constructed clocks/bars/costs only. These are not provider or prospective-run evidence.
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const iso = (time: number) => new Date(time).toISOString();
const initial = Date.parse('2026-10-14T10:00:00.000Z');
const owner = '00000000-0000-4000-8000-000000000001', account = '00000000-0000-4000-8000-000000000002';
const routing = { provider: 'robinhood-official-mcp' as const, ACCOUNT: 'synthetic-account', RHS: 'synthetic-rhs', RHC: 'synthetic-rhc' };
const roots: string[] = [];
let harnesses: ReturnType<typeof createSyntheticOrderHarness>[] = [];
beforeEach(() => {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only'; process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
});
afterEach(async () => {
  for (const h of harnesses) { try { await h.close(); } catch { /* poison ownership is asserted before fixture disposal */ } }
  harnesses = []; vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS; delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
});
function config(cash = '20', quantity = '0'): SimulationRun {
  return simulationRunSchema.parse({ version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD', currency: 'USD',
    classification: 'constructed_offline_test', genesis: { cash: d(cash), quantity: d(quantity) },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0.001'), slippageFraction: d('0.002') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 3600000, maxObservationAgeMs: 60000,
    validThrough: iso(initial + 3600000), rounding: 'adverse-price-8-cumulative-cash-8.v1' });
}
function policy(c: SimulationRun): SizingBindingPolicy {
  return sizingBindingPolicySchema.parse({ schema: 'gelt.synthetic-sizing-binding-policy.v1', version: 1,
    classification: 'constructed_offline_test', runId: c.runId, sourceCommit: c.sourceCommit, configSha256: simulationDigest(c),
    sizingPolicyId: shadowSizingPolicyId, quantityQuantum: d('0.01'), buyLimitPrice: d('1.10'), sellLimitPrice: d('0.90') });
}
function decision(c: SimulationRun, snapshot: SimulationSnapshot, now: number, long = true): SimulationDecisionContext {
  const closed = now - 1000;
  const input: ShadowRuleInput = { schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId, runId: c.runId, sourceCommit: c.sourceCommit,
    decisionAt: iso(now - 200), instrument: { id: c.instrumentId, currency: 'USD', calendarSha256: 'c'.repeat(64) },
    data: { classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256: 'd'.repeat(64), rightsEvidenceSha256: 'e'.repeat(64), pointInTimeEvidenceSha256: 'f'.repeat(64) },
    policy: { scheduleSha256: '1'.repeat(64), maxAgeMs: 86400000, exposureCap: d('0.25') },
    costs: { status: 'declared', evidenceSha256: c.calibrationEvidenceSha256, stressScenarioSha256: '2'.repeat(64),
      commissionPerTrade: c.costs.commissionPerOrder, spreadFraction: c.costs.spreadFraction, slippageFraction: c.costs.slippageFraction },
    controls: { passiveSha256: '3'.repeat(64), cashAssumptionSha256: '4'.repeat(64) },
    portfolio: { state: 'settled', snapshotSha256: simulationDigest(snapshot) },
    bars: Array.from({ length: 253 }, (_, i) => ({ sessionOrdinal: i, closedAt: iso(closed - (252 - i) * 86400000),
      availableAt: iso(closed - (252 - i) * 86400000), adjustedClose: d(i === 252 ? long ? '101' : '99' : '100') })) };
  const inputBytes = Buffer.from(canonical(input));
  return { inputBytes, receipt: evaluateShadowRule(inputBytes), observation: { referencePrice: d('1'), observedAt: iso(now - 100),
    availableAt: iso(now - 100), evidenceSha256: '5'.repeat(64) } };
}
async function fixture(c = config(), p = policy(c), stage?: (stage: EvidenceStage) => void) {
  let now = initial, long = true, edit: (ctx: SimulationDecisionContext) => SimulationDecisionContext = x => x, calls = 0;
  const h = createSyntheticOrderHarness(() => now, { applicationMock: true, sizingEvidenceStageForTest: stage,
    simulationRun: { config: c, sizingBinding: { policy: p, producer: context => { calls++; return edit(decision(c, context.portfolio.snapshot, now, long)); } } } });
  harnesses.push(h); roots.push(dirname(dirname(h.path))); const port = await h.start();
  const request = async (operation: string, body: unknown = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/synthetic-orders/${operation}`, { method: 'POST',
      headers: { authorization: `Bearer ${h.auth.bearer}`, 'x-gelt-session': h.auth.session,
        'x-gelt-session-expires': String(h.auth.expiresAt), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as { value: unknown } };
  };
  expect((await request('resume')).status).toBe(200);
  const db = <T>(read: (db: Database.Database) => T): T => { const db = new Database(h.mockPath!, { readonly: true }); try { return read(db); } finally { db.close(); } };
  const admissions = () => db(db => db.prepare('SELECT preview_json FROM mock_admissions').all() as { preview_json: string }[]);
  const previews = () => admissions().map(r => syntheticMockRunPreviewSchema.parse(JSON.parse(r.preview_json)));
  const counts = () => db(db => [db.prepare('SELECT count(*) AS n FROM mock_admissions').get(), db.prepare('SELECT count(*) AS n FROM mock_orders').get()]);
  const prepare = async () => { const result = await h.previewSizingBound(); if ('noOrder' in result) throw new Error('expected proposal'); return result; };
  return { h, c, p, request, db, previews, counts, prepare, evidenceRoot: h.mockPath! + '.sizing-evidence',
    edit: (fn: typeof edit) => { edit = fn; }, cash: (isLong: boolean) => { long = isLong; },
    time: (value: number) => { now = value; }, getCalls: () => calls };
}
function fullEvidence(f: Awaited<ReturnType<typeof fixture>>, preview: SyntheticRunPreview) {
  const key = preview.sizingEvidence!.evidenceManifestSha256, dir = join(f.evidenceRoot, key);
  return { dir, input: Buffer.from(readFileSync(join(dir, 'input.json'))), proposal: JSON.parse(readFileSync(join(dir, 'proposal.json'), 'utf8')) };
}
describe('actual constructed G05 sizing to isolated durable simulator', () => {
  it.each(['buy', 'sell'] as const)('binds a real rule-generated %s proposal, confirms its own claim and reconciles observed fills', async side => {
    const f = await fixture(config('20', side === 'sell' ? '5' : '0')); f.cash(side === 'buy');
    const prepared = await f.prepare(), preview = f.previews()[0], evidence = fullEvidence(f, preview);
    expect(f.getCalls()).toBe(1); expect(matchesShadowSizingProposal(evidence.input, evidence.proposal)).toBe(true);
    expect(prepared.terms.order.requestedQuantity.value).toBe(side === 'buy' ? '4.870000000000000000' : '5.000000000000000000');
    expect(preview.sizingEvidence!.policySha256).toBe(simulationDigest(f.p));
    const result = await f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
    expect(result.outcome).toBe('acknowledged'); const order = f.h.mockStore!.read(result.intentId)!;
    expect(order.sizingEvidence).toEqual(preview.sizingEvidence);
    f.time(initial + 100);
    f.h.mockStore!.observeExecution(result.intentId, { version: 2, executionId: 'constructed-binding-full-fill', receiptId: randomUUID(),
      runId: f.c.runId, configSha256: simulationDigest(f.c), decisionId: preview.decisionId, quantity: preview.order.quantity,
      price: executionPrice(f.c, side, d('1')), fee: f.c.costs.commissionPerOrder, currency: 'USD',
      observation: { referencePrice: d('1'), observedAt: iso(initial + 100), availableAt: iso(initial + 100), evidenceSha256: '6'.repeat(64) } });
    expect((await f.request('reconcile')).status).toBe(200);
    expect(f.h.mockStore!.portfolio().snapshot.quantity.value).toBe(side === 'buy' ? '4.870000000000000000' : '0.000000000000000000');
    const files = readdirSync(evidence.dir).map(n => readFileSync(join(evidence.dir, n), 'utf8')).join('');
    for (const secret of [f.h.auth.bearer, f.h.auth.session, prepared.confirmationToken]) expect(files.includes(secret)).toBe(false);
    expect(/confirmationToken|admissionHandle|authorization|cookie|csrf/i.test(files)).toBe(false);
    expect((await f.request('preview', prepared.terms.order)).status).toBe(409);
  }, 10000);
  it.each([['cash', '20', '0', false, 'already_cash'], ['zero', '0', '0', true, 'zero_equity'],
    ['overweight', '20', '20', true, 'positive_target_overweight_unsupported'], ['off-grid exit', '20', '5.005', false, 'cash_exit_not_on_grid']] as const)
  ('retains full valid %s no-effect evidence without an admission', async (_name, cash, quantity, long, reason) => {
    const f = await fixture(config(cash, quantity)); f.cash(long);
    const result = await f.h.previewSizingBound(); expect(result).toHaveProperty('noOrder.reason', reason);
    expect(f.counts()).toEqual([{ n: 0 }, { n: 0 }]);
    const dirs = readdirSync(f.evidenceRoot).filter(n => /^[a-f0-9]{64}$/.test(n)); expect(dirs).toHaveLength(1);
    const dir = join(f.evidenceRoot, dirs[0]);
    expect(matchesShadowSizingProposal(readFileSync(join(dir, 'input.json')), JSON.parse(readFileSync(join(dir, 'proposal.json'), 'utf8')))).toBe(true);
  });
  it.each(['malformed', 'oversize', 'receipt', 'source', 'missing'] as const)('keeps invalid %s input response-only', async kind => {
    const f = await fixture(); f.edit(context => {
      if (kind === 'missing') return undefined as unknown as SimulationDecisionContext;
      if (kind === 'malformed') return { ...context, inputBytes: Buffer.from('{"secret":"NEVER-RETAIN-THIS"') };
      if (kind === 'oversize') return { ...context, inputBytes: Buffer.alloc(262145, 120) };
      if (kind === 'receipt') return { ...context, receipt: {} };
      const input = JSON.parse(context.inputBytes.toString()); input.sourceCommit = 'f'.repeat(40);
      const bytes = Buffer.from(canonical(input)); return { ...context, inputBytes: bytes, receipt: evaluateShadowRule(bytes) };
    });
    const result = await f.h.previewSizingBound(); expect('noOrder' in result).toBe(true);
    if ('noOrder' in result) expect(sizingBindingRejectionSchema.safeParse(result.noOrder).success).toBe(true);
    expect(readdirSync(f.evidenceRoot)).toEqual(['policy.json']); expect(f.counts()).toEqual([{ n: 0 }, { n: 0 }]);
  });
  it('rejects current stale confirmation without changing the pinned evaluation time or creating a claim', async () => {
    const f = await fixture(), prepared = await f.prepare(), before = fullEvidence(f, f.previews()[0]).input;
    f.time(initial + 60001);
    await expect(f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
    expect(fullEvidence(f, f.previews()[0]).input).toEqual(before); expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
    expect((await f.request('history')).body).toHaveProperty('value.items', []);
  });
  it('fences a committed admission with a lost response and never returns dispatch authority', async () => {
    const f = await fixture(), client = f.h.mockTransport!.client, original = client.admit.bind(client);
    vi.spyOn(client, 'admit').mockImplementation(async input => { await original(input); throw new Error('constructed response loss'); });
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.getCalls()).toBe(1);
  });
  it('invalidates generation after admission commit while the lifecycle queue remains held', async () => {
    const f = await fixture(), client = f.h.mockTransport!.client, original = client.admit.bind(client);
    vi.spyOn(client, 'admit').mockImplementation(async input => { const result = await original(input); f.h.haltSizingBound(); return result; });
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
  });
  it('records real submission response loss as UNKNOWN after permit consumption, with one durable order', async () => {
    const f = await fixture(), prepared = await f.prepare(), client = f.h.mockTransport!.client, original = client.submit.bind(client);
    vi.spyOn(client, 'submit').mockImplementation(async input => { await original(input); throw new Error('constructed response loss'); });
    const result = await f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
    expect(result.outcome).toBe('unknown'); expect(f.counts()).toEqual([{ n: 1 }, { n: 1 }]);
    expect((await f.request('resume')).status).toBe(409);
    await expect(f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
    expect(f.counts()).toEqual([{ n: 1 }, { n: 1 }]);
  });
  it('rejects loss before permit consumption while retaining the unresolved claim without an order', async () => {
    const f = await fixture(), prepared = await f.prepare(), client = f.h.mockTransport!.client, original = client.portfolio.bind(client); let n = 0;
    vi.spyOn(client, 'portfolio').mockImplementation(async () => { if (++n === 2) throw new Error('constructed pre-submit read loss'); return original(); });
    await expect(f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow('order lifecycle unavailable');
    expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
    const history = await f.request('history'); expect(JSON.stringify(history.body)).toContain('dispatch-claimed');
    expect(JSON.stringify(history.body)).not.toContain('dispatch-outcome-unknown');
    expect((await f.request('resume')).status).toBe(409);
  });
  it('allows exact submit duplicates as reads and rejects changed order terms without another effect', async () => {
    const f = await fixture(), prepared = await f.prepare(), client = f.h.mockTransport!.client;
    const submit = vi.spyOn(client, 'submit');
    const result = await f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
    const payload = submit.mock.calls[0][0];
    expect(f.h.mockStore!.submit(payload)).toEqual(f.h.mockStore!.read(result.intentId));
    expect(f.counts()).toEqual([{ n: 1 }, { n: 1 }]);
    const changed = JSON.parse(JSON.stringify(payload)); changed.preview.order.quantity = d('0.01');
    expect(() => f.h.mockStore!.submit(changed)).toThrow(); expect(f.counts()).toEqual([{ n: 1 }, { n: 1 }]);
  });
  it.each(['snapshot', 'config', 'observation'] as const)('rejects changed current %s binding before creating a claim', async kind => {
    const f = await fixture(), prepared = await f.prepare(), client = f.h.mockTransport!.client, original = client.portfolio.bind(client);
    if (kind === 'observation') f.time(initial + 60001);
    else vi.spyOn(client, 'portfolio').mockImplementation(async () => { const value = await original();
      if (kind === 'snapshot') value.snapshot.historySha256 = 'f'.repeat(64); else value.snapshot.configSha256 = 'f'.repeat(64); return value; });
    await expect(f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
    expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
    expect((await f.request('history')).body).toHaveProperty('value.items', []);
  });
  it('keeps the owner policy independent from mutations of the caller object', async () => {
    const c = config(), p = policy(c), f = await fixture(c, p); p.quantityQuantum = d('100'); p.buyLimitPrice = d('0.01');
    const prepared = await f.prepare(); expect(prepared.terms.order.requestedQuantity.value).toBe('4.870000000000000000');
    expect(JSON.parse(readFileSync(join(f.evidenceRoot, 'policy.json'), 'utf8')).quantityQuantum).toEqual(d('0.01'));
  });
  it('rejects expiry after admission commit without replacing the observation or evaluating again', async () => {
    const f = await fixture(), client = f.h.mockTransport!.client, original = client.admit.bind(client);
    vi.spyOn(client, 'admit').mockImplementation(async input => { const value = await original(input); f.time(initial + 60001); return value; });
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.getCalls()).toBe(1); expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
  });
  it('keeps sizing-bound reopen read-only with exact durable evidence and no policy downgrade', async () => {
    const f = await fixture(), prepared = await f.prepare();
    const result = await f.h.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash });
    const before = f.h.mockStore!.read(result.intentId); await f.h.close();
    const reopened = f.h.reopen(); harnesses.push(reopened);
    expect(reopened.mockStore!.sizingBoundReadOnly).toBe(true); expect(reopened.mockStore!.read(result.intentId)).toEqual(before);
    await expect(reopened.previewSizingBound()).rejects.toThrow();
    await expect(reopened.confirmSizingBound({ confirmationToken: prepared.confirmationToken, termsHash: prepared.termsHash })).rejects.toThrow();
    expect(() => reopened.mockStore!.cancel(result.intentId)).toThrow(); await reopened.close();
    expect(() => new SyntheticMockRobinhoodStore(f.h.mockPath!, () => initial, undefined, { simulationRun: f.c })).toThrow();
  });
  it.each(['input', 'proposal', 'manifest', 'missing', 'symlink', 'oversize', 'policy'] as const)('fails closed on retained %s evidence damage', async kind => {
    const f = await fixture(); await f.prepare(); const preview = f.previews()[0], evidence = fullEvidence(f, preview);
    const file = join(evidence.dir, kind === 'proposal' ? 'proposal.json' : kind === 'manifest' ? 'manifest.json' : 'input.json');
    if (kind === 'policy') writeFileSync(join(f.evidenceRoot, 'policy.json'), '{}');
    else if (kind === 'missing') rmSync(file);
    else if (kind === 'symlink') { rmSync(file); symlinkSync(join(f.evidenceRoot, 'policy.json'), file); }
    else writeFileSync(file, kind === 'oversize' ? Buffer.alloc(262145) : '{}');
    expect(() => f.h.mockStore!.portfolio()).toThrow(); expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
  });
  it('publishes all file and directory durability stages before DB admission', async () => {
    const stages: EvidenceStage[] = [], f = await fixture(undefined, undefined, stage => stages.push(stage)); await f.prepare();
    expect(stages.slice(0, 5)).toEqual(['root-parent-sync', 'policy-file-sync', 'policy-staging-sync', 'policy-publish', 'policy-root-sync']);
    expect(stages.slice(5)).toEqual(['artifact-file-sync', 'artifact-file-sync', 'artifact-file-sync', 'artifact-staging-sync', 'artifact-publish', 'artifact-root-sync']);
    expect(f.counts()).toEqual([{ n: 1 }, { n: 0 }]);
  });
  it.each(['artifact-file-sync', 'artifact-staging-sync', 'artifact-publish', 'artifact-root-sync'] as const)
  ('does not admit after uncertain %s evidence persistence', async stage => {
    const f = await fixture(undefined, undefined, s => { if (s === stage) throw new Error('constructed fsync fault'); });
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.counts()).toEqual([{ n: 0 }, { n: 0 }]);
    expect(() => f.h.mockStore!.portfolio()).toThrow();
  });
  it('rejects aggregate evidence capacity before adding a new artifact or admission', async () => {
    const f = await fixture();
    for (let n = 0; n < 32; n++) { const dir = join(f.evidenceRoot, n.toString(16).padStart(64, '0')); mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, 'input.json'), Buffer.alloc(n === 31 ? 240000 : 262144), { mode: 0o600 }); }
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.counts()).toEqual([{ n: 0 }, { n: 0 }]);
    expect(readdirSync(f.evidenceRoot).filter(n => /^[a-f0-9]{64}$/.test(n))).toHaveLength(32);
  });
  it('rejects artifact count capacity before creating a new admission', async () => {
    const f = await fixture();
    for (let n = 0; n < 1000; n++) mkdirSync(join(f.evidenceRoot, n.toString(16).padStart(64, '0')), { mode: 0o700 });
    await expect(f.h.previewSizingBound()).rejects.toThrow(); expect(f.counts()).toEqual([{ n: 0 }, { n: 0 }]);
  });
});

// Isolated lifecycle state-machine tests use an explicit in-memory facts fixture;
// the integrated cases above use the actual isolated native stores/transport.
function permitFixture(dispatch: OrderAdapter['dispatch']) {
  const records = new Map<string, Projection>();
  const ok = <T>(value: T): Result<T> => ({ version: 1, ok: true, value });
  const facts: LifecycleFacts = {
    recordIntent: raw => { const input = intentSchema.parse(raw); const projection = { version: 1 as const, intent: input, eventCount: 0, facts: [] }; records.set(input.intentId, projection); return ok({ disposition: 'committed', projection } as WriteReceipt); },
    append: raw => { const input = eventSchema.parse(raw); const old = records.get(input.intentId)!; const projection = { ...old, eventCount: old.eventCount + 1, facts: [...old.facts, input] }; records.set(input.intentId, projection); return ok({ disposition: 'committed', projection } as WriteReceipt); },
    history: (rawScope, rawPage) => { const scope = rawScope as { accountId: string }, page = rawPage as { after: number; limit: number }; return ok([...records.values()].filter(p => p.intent.accountId === scope.accountId).slice(page.after, page.after + page.limit)); },
    ownerHasUnresolvedLifecycle: () => ok(hasUnresolvedLifecycle([...records.values()])),
  };
  const order = { instrumentId: 'SYNTH-RH-USD', currency: 'USD', route: 'RHS', side: 'buy', type: 'limit', timeInForce: 'day', requestedQuantity: d('1'), requestedLimitPrice: d('1.10') };
  const adapter: OrderAdapter = { preview: async input => ({ previewId: randomUUID(), order: input.order, fee: d('0.01'), feeCurrency: 'USD', expiresAt: iso(initial + 60000) }),
    dispatch, reconcile: async () => ({ status: 'unknown', executions: [] }), cancel: async () => ({ acknowledged: true }) };
  const lifecycle = new OrderLifecycle(facts, owner, () => ({ accountId: account, routing }), adapter, () => initial, randomUUID, undefined,
    { configuredSimulation: true, boundBeforeClaim: async () => {}, boundClaimCheck: (_owner, expected) => {
      if (canonical(records.get(expected.intent.intentId)) !== canonical(expected)
        || hasUnresolvedLifecycle([...records.values()].filter(p => p.intent.intentId !== expected.intent.intentId))) throw new Error('claim mismatch');
    } });
  const prepare = async () => { await lifecycle.resumeNewOrders(); const value = await lifecycle.previewBoundSimulation(async () => ({ order, sizingBinding: 'exact-test-context' }), async () => {}); if ('noOrder' in value) throw new Error(); return value; };
  return { lifecycle, records, prepare };
}
describe('phase-specific lifecycle-owned permit', () => {
  it('mints only for the exact new own claim and consumes once; forged, cloned, changed and reused permits reject', async () => {
    let saved: unknown, calls = 0;
    const f = permitFixture(async input => {
      saved = input.configuredSubmitPermit;
      expect(() => assertConfiguredSubmitPermit({}, 'exact-test-context')).toThrow();
      expect(() => assertConfiguredSubmitPermit({ ...(saved as object) }, 'exact-test-context')).toThrow();
      expect(() => assertConfiguredSubmitPermit(saved, 'different')).toThrow();
      assertConfiguredSubmitPermit(saved, 'exact-test-context'); consumeConfiguredSubmitPermit(saved, 'exact-test-context'); calls++;
      expect(() => consumeConfiguredSubmitPermit(saved, 'exact-test-context')).toThrow();
      return { outcome: 'accepted', brokerOrderId: 'mock-permit-fixture' };
    });
    const preview = await f.prepare(); expect((await f.lifecycle.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).outcome).toBe('acknowledged');
    expect(calls).toBe(1); expect(() => assertConfiguredSubmitPermit(saved, 'exact-test-context')).toThrow();
  });
  it('halts after claim but before invocation without recording a fictitious submitted UNKNOWN', async () => {
    const f = permitFixture(async input => { f.lifecycle.haltNewOrders(); consumeConfiguredSubmitPermit(input.configuredSubmitPermit, 'exact-test-context'); return { outcome: 'accepted', brokerOrderId: 'mock-unused' }; });
    const preview = await f.prepare(); await expect(f.lifecycle.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow('order lifecycle unavailable');
    expect([...f.records.values()][0].facts.map(e => e.type)).toEqual(['preview-confirmed', 'dispatch-claimed']);
    await expect(f.lifecycle.resumeNewOrders()).rejects.toThrow();
  });
  it('preserves UNKNOWN when invocation consumed the permit before an exception', async () => {
    const f = permitFixture(async input => { consumeConfiguredSubmitPermit(input.configuredSubmitPermit, 'exact-test-context'); throw new Error('post-invocation loss'); });
    const preview = await f.prepare(); expect((await f.lifecycle.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).outcome).toBe('unknown');
    expect([...f.records.values()][0].facts.at(-1)!.type).toBe('dispatch-outcome-unknown'); await expect(f.lifecycle.resumeNewOrders()).rejects.toThrow();
  });
  it('rejects a competing valid open claim in another account after minting the own permit', async () => {
    const f = permitFixture(async input => {
      const other = JSON.parse(canonical(f.records.get(input.dispatchId))) as Projection;
      other.intent.accountId = randomUUID(); other.intent.intentId = randomUUID(); other.intent.idempotencyKey = randomUUID();
      const confirmation = other.facts[0]; if (confirmation.type !== 'preview-confirmed') throw new Error();
      const termsHash = digest(canonical({ ownerId: other.intent.ownerId, accountId: other.intent.accountId, routing: other.intent.routing,
        order: other.intent.order, previewId: confirmation.previewId, fee: confirmation.fee, feeCurrency: confirmation.feeCurrency, expiresAt: confirmation.expiresAt }));
      for (const event of other.facts) { event.accountId = other.intent.accountId; event.intentId = other.intent.intentId; event.eventId = randomUUID(); event.idempotencyKey = randomUUID();
        if (event.type === 'preview-confirmed') { event.confirmationId = randomUUID(); event.termsHash = termsHash; }
        if (event.type === 'dispatch-claimed') { event.dispatchId = other.intent.intentId; event.confirmationId = confirmation.confirmationId; event.termsHash = termsHash; } }
      f.records.set(other.intent.intentId, other);
      consumeConfiguredSubmitPermit(input.configuredSubmitPermit, 'exact-test-context'); return { outcome: 'accepted', brokerOrderId: 'mock-unused' };
    });
    const preview = await f.prepare(); await expect(f.lifecycle.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow();
    expect(f.records.size).toBe(2); expect([...f.records.values()].flatMap(p => p.facts).some(e => e.type === 'broker-acknowledged')).toBe(false);
  });
  it('rejects an unexpected fact in the own just-minted claim', async () => {
    const f = permitFixture(async input => { const own = f.records.get(input.dispatchId)!; own.eventCount++; own.facts.push(own.facts[0]);
      consumeConfiguredSubmitPermit(input.configuredSubmitPermit, 'exact-test-context'); return { outcome: 'accepted', brokerOrderId: 'mock-unused' }; });
    const preview = await f.prepare(); await expect(f.lifecycle.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow();
    expect([...f.records.values()][0].facts).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'broker-acknowledged' })]));
  });
});
