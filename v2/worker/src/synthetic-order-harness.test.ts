import { request } from 'node:http';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { it, expect } from 'vitest';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';

const order = { route: 'RHS', instrumentId: 'synthetic-instrument', side: 'buy', requestedQuantity: { value: '0.010', precision: 4, scale: 3 }, requestedLimitPrice: { value: '1.00', precision: 3, scale: 2 }, currency: 'USD' };
type Fixture = ReturnType<typeof createSyntheticOrderHarness>;
const ports = new WeakMap<Fixture, number>();
async function listen(f: Fixture) { ports.set(f, await f.start()); }
async function post(f: Fixture, op: string, input: unknown = {}, extra: Record<string, string> = {}) {
  const body = JSON.stringify(input), port = ports.get(f)!;
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: `/v1/synthetic-orders/${op}`, method: 'POST', headers: {
      Host: `127.0.0.1:${port}`, Authorization: `Bearer ${f.auth.bearer}`, 'X-Gelt-Session': f.auth.session,
      'X-Gelt-Session-Expires': String(f.auth.expiresAt), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extra,
    } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) })); });
    req.on('error', reject); req.end(body);
  });
}
function enabled(sessionClock?: () => number): Fixture {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  return createSyntheticOrderHarness(sessionClock);
}
async function cleanup(f: Fixture) {
  try { await f.close(); } catch { /* poisoned fixture retains marker until test-owned cleanup */ }
  rmSync(dirname(dirname(f.path)), { recursive: true, force: true });
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
}

it('is opt-in only, independently authenticated/loopback-bound and never adds production order routes', async () => {
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
  expect(() => createSyntheticOrderHarness()).toThrow('synthetic harness disabled');
  const f = enabled(); await listen(f);
  try {
    for (const headers of [{ Authorization: 'Bearer wrong' }, { 'X-Gelt-Session': 'wrong' }, { Origin: 'http://127.0.0.1' }, { Host: 'evil' }, { Forwarded: 'host=evil' }, { 'X-Gelt-Session-Expires': '1' }]) expect((await post(f, 'resume', {}, headers)).status).toBe(403);
    for (const route of ['tools', 'funding', 'place_order', 'status?x=1']) expect((await post(f, route)).status).toBe(404);
    expect((await post(f, 'preview', { ...order, extra: true })).status).toBe(409);
    expect((await post(f, 'resume')).body.source).toBe('synthetic-offline-v1');
  } finally { await cleanup(f); }
});

it('expires the server-issued session even when the caller replaces its expiry header', async () => {
  let now = Date.now();
  const f = enabled(() => now); await listen(f);
  try {
    expect((await post(f, 'resume')).status).toBe(200);
    now = f.auth.expiresAt;
    expect((await post(f, 'history', {}, { 'X-Gelt-Session-Expires': String(now + 300000) })).status).toBe(403);
    expect((await post(f, 'history')).status).toBe(403);
  } finally { await cleanup(f); }
});

it('enforces exact preview, fee-inclusive ten-dollar cap, single-use confirmation and durable synthetic provenance', async () => {
  const f = enabled(); await listen(f);
  try {
    expect((await post(f, 'resume')).status).toBe(200);
    const above = { ...order, requestedLimitPrice: { value: '1000.00', precision: 6, scale: 2 } };
    expect((await post(f, 'preview', above)).status).toBe(409); // 10.00 + 0.01
    const preview = (await post(f, 'preview', order)).body.value;
    expect(preview.terms.order).toEqual(order);
    const wrong = await post(f, 'confirm', { confirmationToken: preview.confirmationToken, termsHash: '0'.repeat(64) });
    expect(wrong.status).toBe(409);
    expect((await post(f, 'confirm', { confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).status).toBe(409);
    const next = (await post(f, 'preview', order)).body.value;
    const input = { confirmationToken: next.confirmationToken, termsHash: next.termsHash };
    const confirmations = await Promise.all([post(f, 'confirm', input), post(f, 'confirm', input)]);
    expect(confirmations.map(r => r.status).sort()).toEqual([200, 409]);
    expect(confirmations.find(r => r.status === 200)!.body.value.outcome).toBe('acknowledged');
    const db = new Database(f.path, { readonly: true });
    try {
      expect((db.prepare('SELECT source FROM synthetic_intents').all() as {source: string}[]).map(r => r.source)).toEqual(['synthetic-offline-v1']);
      expect((db.prepare('SELECT source FROM synthetic_events').all() as {source: string}[]).map(r => r.source)).toEqual(['synthetic-offline-v1', 'synthetic-offline-v1', 'synthetic-offline-v1']);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='intents' OR name='events'").all()).toEqual([]);
    } finally { db.close(); }
  } finally { await cleanup(f); }
});

it('unknown outcome persists across restart and refuses automatic redispatch or release by uncorrelated reconciliation', async () => {
  let f = enabled(); await listen(f);
  try {
    await post(f, 'resume'); await post(f, 'scenario', { dispatch: 'unknown' });
    const preview = (await post(f, 'preview', order)).body.value;
    expect((await post(f, 'confirm', { confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).body.value.outcome).toBe('unknown');
    const before = (await post(f, 'history')).body.value.items;
    expect(before).toHaveLength(1);
    await f.close(); f = f.reopen(); await listen(f);
    expect((await post(f, 'resume')).status).toBe(409);
    expect((await post(f, 'preview', order)).status).toBe(409);
    expect((await post(f, 'reconcile')).body.value.observations).toBe(1);
    expect((await post(f, 'resume')).status).toBe(409);
    const after = (await post(f, 'history')).body.value.items;
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual({ source: 'synthetic-offline-v1', syntheticIntentId: before[0].syntheticIntentId,
      eventCount: after[0].facts.length, facts: expect.any(Array) });
    expect(after[0]).not.toHaveProperty('intent');
    expect(after[0]).not.toHaveProperty('routing');
    expect(after[0].facts.length).toBeGreaterThan(0);
    expect(after[0].facts.every((e: {source: string; syntheticType: string}) => e.source === 'synthetic-offline-v1' && e.syntheticType.length > 0)).toBe(true);
    expect(after[0].facts[0]).not.toHaveProperty('type');
    expect(after[0].facts.some((e: {syntheticType: string}) => e.syntheticType === 'execution-observed' || e.syntheticType === 'broker-status-observed')).toBe(false);
  } finally { await cleanup(f); }
});

it.each(['oversized', 'too-many'] as const)('fails closed before reading %s stored synthetic facts', async (kind) => {
  const f = enabled(); await listen(f);
  try {
    await post(f, 'resume');
    const preview = (await post(f, 'preview', order)).body.value;
    expect((await post(f, 'confirm', { confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).status).toBe(200);
    const db = new Database(f.path);
    try {
      if (kind === 'oversized') db.prepare('UPDATE synthetic_events SET body=? WHERE sequence=1').run('\0' + 'x'.repeat(1024 * 1024));
      else {
        const intent = (db.prepare('SELECT id FROM synthetic_intents').get() as {id: string}).id;
        db.transaction(() => {
          const insert = db.prepare('INSERT INTO synthetic_events(intent,sequence,source,body) VALUES(?,?,?,?)');
          for (let sequence = 4; sequence <= 1004; sequence++) insert.run(intent, sequence, 'synthetic-offline-v1', 'x');
        }).immediate();
      }
    } finally { db.close(); }
    expect((await post(f, 'history')).status).toBe(409);
    expect((await post(f, 'history')).status).toBe(409);
  } finally { await cleanup(f); }
});

it('records correlated partial fills and post-cancel race without inferring terminal from cancel acknowledgement', async () => {
  const f = enabled(); await listen(f);
  try {
    await post(f, 'resume');
    const preview = (await post(f, 'preview', order)).body.value;
    const confirmed = (await post(f, 'confirm', { confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).body.value;
    await post(f, 'scenario', { reconcile: 'partial' });
    expect((await post(f, 'reconcile')).status).toBe(200);
    const first = (await post(f, 'history')).body.value.items[0].facts.filter((e: {syntheticType: string}) => e.syntheticType === 'execution-observed');
    expect(first).toEqual([expect.objectContaining({ source: 'synthetic-offline-v1', syntheticType: 'execution-observed',
      syntheticExecutionId: 'synthetic-fill-1', observedQuantity: { value: '0.004', precision: 4, scale: 3 },
      observedPrice: { value: '1.01', precision: 3, scale: 2 }, observedFee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' })]);
    expect((await post(f, 'cancel', { intentId: confirmed.intentId })).body.value.outcome).toBe('acknowledged');
    expect((await post(f, 'cancel', { intentId: confirmed.intentId })).status).toBe(409);
    await post(f, 'scenario', { reconcile: 'late-partial' });
    expect((await post(f, 'reconcile')).status).toBe(200);
    expect((await post(f, 'resume')).status).toBe(409);
    const facts = (await post(f, 'history')).body.value.items[0].facts;
    const executions = facts.filter((e: {syntheticType: string}) => e.syntheticType === 'execution-observed');
    expect(executions).toEqual([first[0], expect.objectContaining({ source: 'synthetic-offline-v1', syntheticType: 'execution-observed',
      syntheticExecutionId: 'synthetic-fill-2', observedQuantity: { value: '0.002', precision: 4, scale: 3 },
      observedPrice: { value: '1.02', precision: 3, scale: 2 }, observedFee: { value: '0.002', precision: 4, scale: 3 }, currency: 'USD' })]);
    expect(executions.every((e: Record<string, unknown>) => !('requestedQuantity' in e) && !('requestedLimitPrice' in e) && !('total' in e))).toBe(true);
    expect(facts.filter((e: {syntheticType: string}) => e.syntheticType === 'cancel-acknowledged')).toHaveLength(1);
    await post(f, 'scenario', { reconcile: 'canceled' });
    expect((await post(f, 'reconcile')).status).toBe(200);
    expect((await post(f, 'resume')).status).toBe(200);
  } finally { await cleanup(f); }
});
