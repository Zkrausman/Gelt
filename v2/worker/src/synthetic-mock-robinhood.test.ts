import { createServer, request, type RequestListener } from 'node:http';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { formatRunnerReport, reportAndExit } from '../../scripts/synthetic-mock-acceptance.mjs';
import { canonical } from './ledger-canonical.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import {
  syntheticMockAccount, syntheticMockFee, syntheticMockInstrument, syntheticMockPolicy, syntheticMockPrincipal,
  syntheticMockQuote, syntheticMockSource, syntheticMockPreviewSchema,
} from './synthetic-mock-robinhood-contract.js';
import { syntheticMockDigest } from './synthetic-mock-robinhood-contract.js';
import { SyntheticMockRobinhoodClient } from './synthetic-mock-robinhood-transport.js';
import { reopenFailureReceiptForTest } from './synthetic-reopen-diagnostics.js';

const order = {
  route: 'RHS', instrumentId: syntheticMockInstrument, side: 'buy',
  requestedQuantity: { value: '0.010', precision: 4, scale: 3 },
  requestedLimitPrice: { value: '0.90', precision: 3, scale: 2 }, currency: 'USD',
};
type Fixture = ReturnType<typeof createSyntheticOrderHarness>;

async function listen(fixture: Fixture) { return fixture.start(); }
async function withMockClient(handler: RequestListener, exercise: (client: SyntheticMockRobinhoodClient) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const port = (server.address() as { port: number }).port;
  try { await exercise(new SyntheticMockRobinhoodClient(() => port, 'synthetic-test-bearer')); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
async function post(fixture: Fixture, port: number, operation: string, input: unknown = {}, extra: Record<string, string> = {}) {
  const body = JSON.stringify(input);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: `/v1/synthetic-orders/${operation}`, method: 'POST', headers: {
      Host: `127.0.0.1:${port}`, Authorization: `Bearer ${fixture.auth.bearer}`, 'X-Gelt-Session': fixture.auth.session,
      'X-Gelt-Session-Expires': String(fixture.auth.expiresAt), 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body), ...extra,
    } }, res => {
      let text = '';
      res.on('data', chunk => text += chunk.toString('utf8'));
      res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject);
    req.end(body);
  });
}
function enabled(clock: () => number = Date.now): Fixture {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
  return createSyntheticOrderHarness(clock, { applicationMock: true, mockRequestTimeoutMsForTest: 30000 });
}
async function cleanup(fixture: Fixture): Promise<void> {
  try { await fixture.close(); } catch { /* uncertain fixture ownership stays until test-root cleanup */ }
  rmSync(dirname(dirname(fixture.path)), { recursive: true, force: true });
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
  delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
}
function mockPreview(previewId: string, expiresAt: string) {
  return syntheticMockPreviewSchema.parse({
    version: 1, source: syntheticMockSource, previewId, principal: syntheticMockPrincipal, account: syntheticMockAccount,
    policyId: syntheticMockPolicy,
    quote: { instrumentId: syntheticMockInstrument, price: syntheticMockQuote, source: 'gelt-synthetic-robinhood-quote-v1' },
    fee: { amount: syntheticMockFee, currency: 'USD', source: 'gelt-synthetic-robinhood-fee-v1' },
    order: { instrumentId: syntheticMockInstrument, route: 'RHS', side: 'buy', type: 'limit', timeInForce: 'day',
      quantity: order.requestedQuantity, limitPrice: order.requestedLimitPrice, currency: 'USD' },
    expiresAt,
  });
}
async function rejectCorruptedAcceptedTimestamp(offsetFromExpiryMs: number): Promise<void> {
  let now = 1000;
  const fixture = enabled(() => now);
  let reopened: Fixture | undefined;
  let fixtureClosed = false;
  try {
    const expiresAt = now + 5000;
    const preview = mockPreview('00000000-0000-4000-8000-000000000095', new Date(expiresAt).toISOString());
    const confirmationToken = 'T'.repeat(43);
    const termsHash = 'f'.repeat(64);
    const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
    const dispatchId = '00000000-0000-4000-8000-000000000096';
    fixture.mockStore!.submit({ dispatchId, preview, termsHash, confirmationToken, admissionHandle: admission.handle });
    await fixture.close();
    fixtureClosed = true;

    const db = new Database(fixture.mockPath!);
    try {
      db.prepare('UPDATE mock_events SET event_json=? WHERE dispatch_id=? AND sequence=1')
        .run(canonical({ type: 'accepted', at: expiresAt + offsetFromExpiryMs }), dispatchId);
    } finally { db.close(); }

    expect(() => {
      try { reopened = fixture.reopen(); }
      catch (error) {
        console.log('SYNTHETIC expiry-corruption reopen failure receipt', JSON.stringify({
          ...reopenFailureReceiptForTest(error), mockMarkerExists: existsSync(`${fixture.mockPath}.lock`),
        }));
        throw error;
      }
    }).toThrow('synthetic mock storage unavailable');
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
  } finally {
    if (reopened) await cleanup(reopened);
    else {
      if (!fixtureClosed) { try { await fixture.close(); } catch { /* retain corruption ownership until fixture cleanup */ } }
      rmSync(dirname(dirname(fixture.path)), { recursive: true, force: true });
      delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
      delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
    }
  }
}

it('rejects invalid or non-mock fixture deadlines before acquiring private storage', () => {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
  try {
    for (const mockRequestTimeoutMsForTest of [4000, 30001, 5000.5, NaN, Infinity]) {
      expect(() => createSyntheticOrderHarness(Date.now, { applicationMock: true, mockRequestTimeoutMsForTest }))
        .toThrow('synthetic harness disabled');
    }
    expect(() => createSyntheticOrderHarness(Date.now, { mockRequestTimeoutMsForTest: 30000 }))
      .toThrow('synthetic harness disabled');
    delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
    expect(() => createSyntheticOrderHarness(Date.now, { applicationMock: true, mockRequestTimeoutMsForTest: 30000 }))
      .toThrow('synthetic harness disabled');
  } finally {
    delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
    delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  }
});

it('keeps the opt-in mock separate, scopes exact previews, persists single-use admission, and displays durable order history', async () => {
  delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  expect(() => createSyntheticOrderHarness(Date.now, { applicationMock: true })).toThrow('synthetic harness disabled');
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
  const fixture = createSyntheticOrderHarness(Date.now, { applicationMock: true, mockRequestTimeoutMsForTest: 30000 });
  const port = await listen(fixture);
  try {
    expect((await post(fixture, port, 'resume')).status).toBe(200);
    expect((await post(fixture, port, 'preview', { ...order, instrumentId: 'real-symbol' })).status).toBe(409);
    const feeOverCap = { ...order, requestedQuantity: { value: '20.000', precision: 5, scale: 3 } };
    expect((await post(fixture, port, 'preview', feeOverCap)).status).toBe(409);
    const shown = (await post(fixture, port, 'preview', order)).body.value;
    expect(shown.terms.order).toEqual(order);
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect(db.pragma('application_id', { simple: true })).not.toBe(1196184629);
      expect((db.prepare('SELECT count(*) AS n FROM mock_admissions').get() as { n: number }).n).toBe(1);
      const admission = db.prepare('SELECT confirmation_sha,handle_sha,preview_sha FROM mock_admissions').get() as Record<string, string>;
      expect(admission.confirmation_sha).not.toBe(shown.confirmationToken);
      expect(admission.handle_sha).not.toBe(shown.confirmationToken);
      expect(admission.preview_sha).toMatch(/^[a-f0-9]{64}$/);
      const mockTables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
      expect(mockTables).not.toContain('synthetic_intents');
    } finally { db.close(); }
    expect(fixture.path).not.toBe(fixture.mockPath);
    const lifecycleDb = new Database(fixture.path, { readonly: true });
    try {
      const lifecycleTables = (lifecycleDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
      expect(lifecycleTables).not.toContain('mock_orders');
    } finally { lifecycleDb.close(); }
    const confirm = { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash };
    const results = await Promise.all([post(fixture, port, 'confirm', confirm), post(fixture, port, 'confirm', confirm)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const accepted = results.find(result => result.status === 200)!.body.value;
    const mockPort = fixture.mockTransport!.port!;
    const authorizedControl = await fixture.mockTransport!.client.read(accepted.intentId);
    expect(authorizedControl.dispatchId).toBe(accepted.intentId);
    const wrongBearer = new SyntheticMockRobinhoodClient(() => mockPort, 'wrong-bearer');
    await expect(wrongBearer.read(accepted.intentId)).rejects.toThrow('synthetic mock unavailable');
    await expect(fixture.mockTransport!.client.readWithScopeForTest(accepted.intentId, 'orders:cancel'))
      .rejects.toThrow('synthetic mock unavailable');
    const history = await post(fixture, port, 'mock-history', { dispatchId: accepted.intentId });
    expect(history.status).toBe(200);
    expect(history.body.value.order).toMatchObject({ source: syntheticMockSource, dispatchId: accepted.intentId, status: 'accepted', executions: [] });
    const orders = new Database(fixture.mockPath!, { readonly: true });
    try { expect((orders.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: number }).n).toBe(1); }
    finally { orders.close(); }
  } finally { await cleanup(fixture); }
});

it('uses one fixed fixture clock at the exact preview expiry boundary and for a fresh confirmation', async () => {
  const fixedEpoch = Date.parse('2025-02-03T04:05:06.000Z');
  for (const applicationMock of [true, false]) {
    let now = fixedEpoch;
    process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
    if (applicationMock) process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
    else delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
    const fixture = createSyntheticOrderHarness(() => now, { applicationMock,
      ...(applicationMock ? { mockRequestTimeoutMsForTest: 30000 } : {}),
    });
    try {
      const port = await listen(fixture);
      expect((await post(fixture, port, 'resume')).status).toBe(200);
      const expired = await post(fixture, port, 'preview', order);
      expect(expired.status).toBe(200);
      expect(expired.body.value.terms.expiresAt).toBe(new Date(fixedEpoch + 60000).toISOString());

      now += 60000;
      const fresh = await post(fixture, port, 'preview', order);
      expect(fresh.status).toBe(200);
      expect(fresh.body.value.terms.expiresAt).toBe(new Date(now + 60000).toISOString());
      expect(fresh.body.value.terms.previewId).not.toBe(expired.body.value.terms.previewId);

      const staleConfirmation = await post(fixture, port, 'confirm', {
        confirmationToken: expired.body.value.confirmationToken, termsHash: expired.body.value.termsHash,
      });
      expect(staleConfirmation.status).toBe(409);
      const confirmed = await post(fixture, port, 'confirm', {
        confirmationToken: fresh.body.value.confirmationToken, termsHash: fresh.body.value.termsHash,
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.value.outcome).toBe('acknowledged');

      const intentId = confirmed.body.value.intentId as string;
      const lifecycleDb = new Database(fixture.path, { readonly: true });
      try {
        const intents = lifecycleDb.prepare('SELECT id FROM synthetic_intents').all() as { id: string }[];
        expect(intents).toEqual([{ id: intentId }]);
        const lifecycleFacts = lifecycleDb.prepare('SELECT intent,body FROM synthetic_events ORDER BY intent,sequence')
          .all() as { intent: string; body: string }[];
        expect(lifecycleFacts).toHaveLength(3);
        const persistedFacts = lifecycleFacts.map(row => ({ rowIntent: row.intent, ...(JSON.parse(row.body) as {
          intentId: string; type: string; previewId?: string; dispatchId?: string;
        }) }));
        expect(persistedFacts.map(fact => fact.type)).toEqual([
          'preview-confirmed', 'dispatch-claimed', 'broker-acknowledged',
        ]);
        expect(persistedFacts.every(fact => fact.intentId === intentId && fact.rowIntent === intentId)).toBe(true);
        const previewConfirmed = persistedFacts.find(fact => fact.type === 'preview-confirmed')!;
        const dispatchClaimed = persistedFacts.find(fact => fact.type === 'dispatch-claimed')!;
        expect(previewConfirmed.previewId).toBe(fresh.body.value.terms.previewId);
        expect(dispatchClaimed.previewId).toBe(fresh.body.value.terms.previewId);
        expect(dispatchClaimed.dispatchId).toBe(intentId);
        expect(persistedFacts.some(fact => fact.previewId === expired.body.value.terms.previewId)).toBe(false);
      } finally { lifecycleDb.close(); }

      if (applicationMock) {
        const mockDb = new Database(fixture.mockPath!, { readonly: true });
        let storedOrder: { dispatch_id: string; order_id: string; preview_id: string; payload_json: string };
        try {
          const mockOrders = mockDb.prepare('SELECT dispatch_id,order_id,preview_id,payload_json FROM mock_orders').all() as typeof storedOrder[];
          expect(mockOrders).toHaveLength(1);
          storedOrder = mockOrders[0];
          expect((mockDb.prepare('SELECT count(*) AS n FROM mock_events').get() as { n: number }).n).toBe(1);
          expect(storedOrder.dispatch_id).toBe(intentId);
          expect(storedOrder.preview_id).toBe(fresh.body.value.terms.previewId);
          expect(JSON.parse(storedOrder.payload_json).preview.previewId).toBe(fresh.body.value.terms.previewId);
        } finally { mockDb.close(); }
        const independentMockOrder = await fixture.mockTransport!.client.read(intentId);
        expect(independentMockOrder.mockOrderId).toBe(`mock-${storedOrder!.order_id}`);
        expect(independentMockOrder.dispatchId).toBe(intentId);
        expect(independentMockOrder.previewId).toBe(fresh.body.value.terms.previewId);
      }

      const history = await post(fixture, port, 'history');
      expect(history.body.value.items).toHaveLength(1);
      expect(history.body.value.items[0].facts.map((fact: { syntheticType: string }) => fact.syntheticType)).toEqual([
        'preview-confirmed', 'dispatch-claimed', 'broker-acknowledged',
      ]);
    } finally { await cleanup(fixture); }
  }
});

it('replays one durable mock order for synchronous identical submits and rejects changed payloads', async () => {
  const fixture = enabled();
  try {
    const preview = mockPreview('00000000-0000-4000-8000-000000000011', new Date(Date.now() + 60000).toISOString());
    const confirmationToken = 'C'.repeat(43);
    const termsHash = syntheticMockDigest({ ownerId: '00000000-0000-4000-8000-000000000001', accountId: '00000000-0000-4000-8000-000000000002',
      routing: { provider: 'robinhood-official-mcp', ACCOUNT: 'synthetic-account', RHS: 'synthetic-rhs', RHC: 'synthetic-rhc' },
      order: { route: 'RHS', instrumentId: syntheticMockInstrument, side: 'buy', requestedQuantity: order.requestedQuantity,
        requestedLimitPrice: order.requestedLimitPrice, currency: 'USD' }, previewId: preview.previewId,
      fee: syntheticMockFee, feeCurrency: 'USD', expiresAt: preview.expiresAt });
    const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
    const input = { dispatchId: '00000000-0000-4000-8000-000000000012', preview, termsHash, confirmationToken, admissionHandle: admission.handle };
    const left = fixture.mockStore!.submit(input);
    const right = fixture.mockStore!.submit(input);
    expect(left.mockOrderId).toBe(right.mockOrderId);
    expect(fixture.mockStore!.read(input.dispatchId)).toEqual(left);
    const changed = { ...input, preview: { ...preview, order: { ...preview.order, limitPrice: { value: '0.89', precision: 3, scale: 2 } } } };
    expect(() => fixture.mockStore!.submit(changed)).toThrow();
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect((db.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT count(*) AS n FROM mock_events').get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

it('replays concurrent identical submissions through the loopback HTTP route exactly once', async () => {
  const fixture = enabled();
  try {
    await listen(fixture);
    const client = fixture.mockTransport!.client.withRequestTimeoutForTest(30000);
    const preview = mockPreview('00000000-0000-4000-8000-000000000013', new Date(Date.now() + 60000).toISOString());
    const termsHash = 'd'.repeat(64);
    const confirmationToken = 'H'.repeat(43);
    const admission = await client.admit({ preview, termsHash, confirmationToken });
    const input = { dispatchId: '00000000-0000-4000-8000-000000000014', preview, termsHash, confirmationToken, admissionHandle: admission.handle };
    const [left, right] = await Promise.all([
      client.submit(input), client.submit(input),
    ]);
    expect(left).toEqual(right);
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect((db.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT count(*) AS n FROM mock_events').get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

it('retires expired unused admissions only when a new admission can commit', async () => {
  let now = Date.now();
  const fixture = enabled(() => now);
  try {
    const first = mockPreview('00000000-0000-4000-8000-000000000021', new Date(now + 5000).toISOString());
    fixture.mockStore!.admit({ preview: first, termsHash: 'a'.repeat(64), confirmationToken: 'A'.repeat(43) });
    now += 6000;
    const second = mockPreview('00000000-0000-4000-8000-000000000022', new Date(now + 60000).toISOString());
    fixture.mockStore!.admit({ preview: second, termsHash: 'b'.repeat(64), confirmationToken: 'B'.repeat(43) });
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect(db.prepare('SELECT preview_id FROM mock_admissions').all()).toEqual([{ preview_id: second.previewId }]);
      expect((db.prepare('SELECT consumed_dispatch FROM mock_admissions').get() as { consumed_dispatch: unknown }).consumed_dispatch).toBeNull();
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

it('retains UNKNOWN and one stored mock order across two clean fixture reopens after pre-header response loss', async () => {
  let fixture = enabled();
  try {
    let port = await listen(fixture);
    await post(fixture, port, 'resume');
    const shown = (await post(fixture, port, 'preview', order)).body.value;
    fixture.mockTransport!.loseNextSubmitResponseForTest();
    const result = await post(fixture, port, 'confirm', { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash });
    expect(result.status).toBe(200);
    expect(result.body.value.outcome).toBe('unknown');
    const dispatchId = result.body.value.intentId;
    let stableMockOrderId: string | undefined;
    let stableOrderId: string | undefined;
    let stablePayloadDigest: string | undefined;
    for (let reopen = 0; reopen < 2; reopen++) {
      await fixture.close();
      fixture = fixture.reopen();
      port = await listen(fixture);
      expect((await post(fixture, port, 'resume')).status).toBe(409);
      expect((await post(fixture, port, 'preview', order)).status).toBe(409);
      const lifecycleBeforeRead = await post(fixture, port, 'history');
      const unknownFact = lifecycleBeforeRead.body.value.items.find((item: { syntheticIntentId: string }) => item.syntheticIntentId === dispatchId)
        ?.facts.find((fact: { syntheticType: string }) => fact.syntheticType === 'dispatch-outcome-unknown');
      expect(unknownFact).toBeDefined();
      const history = await post(fixture, port, 'mock-history', { dispatchId });
      expect(history.status).toBe(200);
      expect(history.body.value.order).toMatchObject({ dispatchId, status: 'accepted' });
      stableMockOrderId ??= history.body.value.order.mockOrderId;
      expect(history.body.value.order.mockOrderId).toBe(stableMockOrderId);
      const db = new Database(fixture.mockPath!, { readonly: true });
      try {
        expect((db.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: number }).n).toBe(1);
        const row = db.prepare('SELECT order_id,payload_sha FROM mock_orders WHERE dispatch_id=?').get(dispatchId) as { order_id: string; payload_sha: string };
        stableOrderId ??= row.order_id;
        stablePayloadDigest ??= row.payload_sha;
        expect(row).toEqual({ order_id: stableOrderId, payload_sha: stablePayloadDigest });
        expect(history.body.value.order.mockOrderId).toBe(`mock-${row.order_id}`);
      }
      finally { db.close(); }
      expect((await post(fixture, port, 'reconcile')).status).toBe(200);
      const lifecycleAfterReconcile = await post(fixture, port, 'history');
      expect(lifecycleAfterReconcile.body.value.items.find((item: { syntheticIntentId: string }) => item.syntheticIntentId === dispatchId)
        ?.facts.some((fact: { syntheticType: string }) => fact.syntheticType === 'dispatch-outcome-unknown')).toBe(true);
      expect((await post(fixture, port, 'mock-history', { dispatchId })).body.value.order.mockOrderId).toBe(stableMockOrderId);
      const afterReconcileDb = new Database(fixture.mockPath!, { readonly: true });
      try {
        const row = afterReconcileDb.prepare('SELECT order_id,payload_sha FROM mock_orders WHERE dispatch_id=?').get(dispatchId) as { order_id: string; payload_sha: string };
        expect(row).toEqual({ order_id: stableOrderId, payload_sha: stablePayloadDigest });
      } finally { afterReconcileDb.close(); }
    }
  } finally { await cleanup(fixture); }
});

it('preserves cancel acknowledgement separately from a late partial fill and terminal cancellation', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const shown = (await post(fixture, port, 'preview', order)).body.value;
    const accepted = (await post(fixture, port, 'confirm', { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash })).body.value;
    const cancel = await post(fixture, port, 'cancel', { intentId: accepted.intentId });
    expect(cancel.status).toBe(200);
    const acknowledged = await post(fixture, port, 'mock-history', { dispatchId: accepted.intentId });
    expect(acknowledged.body.value.order).toMatchObject({ status: 'pending-cancel', cancelAcknowledged: true });
    const late = fixture.mockStore!.observeExecution(accepted.intentId, { executionId: 'fill-late-1', quantity: { value: '0.004', precision: 4, scale: 3 },
      price: { value: '0.89', precision: 3, scale: 2 }, fee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' });
    expect(late).toMatchObject({ status: 'partially-filled', cancelAcknowledged: true });
    expect((await post(fixture, port, 'reconcile')).status).toBe(200);
    const observed = (await post(fixture, port, 'history')).body.value.items[0];
    expect(observed.facts.some((fact: { syntheticType: string }) => fact.syntheticType === 'execution-observed')).toBe(true);
    expect(fixture.mockStore!.settleCanceled(accepted.intentId)).toMatchObject({ status: 'canceled', cancelAcknowledged: true });
    expect((await post(fixture, port, 'reconcile')).status).toBe(200);
    const settled = (await post(fixture, port, 'history')).body.value.items[0];
    expect(settled.facts.at(-1).syntheticType).toBe('broker-status-observed');
    expect((await post(fixture, port, 'mock-history', { dispatchId: accepted.intentId })).body.value.order.status).toBe('canceled');
  } finally { await cleanup(fixture); }
});

it('rolls back a failed mock append, retains its writer marker, and keeps the lifecycle fence closed', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const shown = (await post(fixture, port, 'preview', order)).body.value;
    fixture.mockStore!.failNextInsertForTest();
    const result = await post(fixture, port, 'confirm', { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash });
    expect(result.status).toBe(200);
    expect(result.body.value.outcome).toBe('unknown');
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect((db.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT count(*) AS n FROM mock_events').get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT consumed_dispatch FROM mock_admissions').get() as { consumed_dispatch: unknown }).consumed_dispatch).toBeNull();
    } finally { db.close(); }
    expect((await post(fixture, port, 'resume')).status).toBe(409);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('recomputes a stored payload digest from the persisted preview before serving an order', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const shown = (await post(fixture, port, 'preview', order)).body.value;
    const accepted = (await post(fixture, port, 'confirm', { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash })).body.value;
    const db = new Database(fixture.mockPath!);
    try {
      db.prepare("UPDATE mock_orders SET payload_json=replace(payload_json,'0.90','0.89') WHERE dispatch_id=?").run(accepted.intentId);
    } finally { db.close(); }
    expect((await post(fixture, port, 'mock-history', { dispatchId: accepted.intentId })).status).toBe(409);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('checks serialized text bounds in SQLite before loading stored payload bodies', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const shown = (await post(fixture, port, 'preview', order)).body.value;
    const accepted = (await post(fixture, port, 'confirm', { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash })).body.value;
    const db = new Database(fixture.mockPath!);
    try { db.prepare('UPDATE mock_orders SET payload_json=? WHERE dispatch_id=?').run('x'.repeat(8193), accepted.intentId); }
    finally { db.close(); }
    expect((await post(fixture, port, 'mock-history', { dispatchId: accepted.intentId })).status).toBe(409);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('checks mock projection byte bounds in SQLite before materializing stored projections', async () => {
  const fixture = enabled();
  try {
    const preview = mockPreview('00000000-0000-4000-8000-000000000075', new Date(Date.now() + 60000).toISOString());
    const confirmationToken = 'Z'.repeat(43);
    const termsHash = 'f'.repeat(64);
    const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
    const dispatchId = '00000000-0000-4000-8000-000000000076';
    fixture.mockStore!.submit({ dispatchId, preview, termsHash, confirmationToken, admissionHandle: admission.handle });
    const db = new Database(fixture.mockPath!);
    try { db.prepare('UPDATE mock_orders SET projection_json=? WHERE dispatch_id=?').run('x'.repeat(8193), dispatchId); }
    finally { db.close(); }
    expect(() => fixture.mockStore!.read(dispatchId)).toThrow('synthetic mock storage unavailable');
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('serializes concurrent preview and durable admission before exposing either result', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const previews = await Promise.all([post(fixture, port, 'preview', order), post(fixture, port, 'preview', order)]);
    expect(previews.map(result => result.status).sort()).toEqual([200, 409]);
    const shown = previews.find(result => result.status === 200)!.body.value;
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect((db.prepare('SELECT count(*) AS n FROM mock_admissions').get() as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT preview_id FROM mock_admissions').get() as { preview_id: string }).preview_id).toBe(shown.terms.previewId);
    } finally { db.close(); }
    const confirmed = await post(fixture, port, 'confirm', { confirmationToken: shown.confirmationToken, termsHash: shown.termsHash });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.value.outcome).toBe('acknowledged');
  } finally { await cleanup(fixture); }
});

it('retires an expired pending preview so a fresh preview can be admitted', async () => {
  let now = Date.now();
  const fixture = enabled(() => now);
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const first = await post(fixture, port, 'preview', order);
    expect(first.status).toBe(200);
    now += 61000;
    const second = await post(fixture, port, 'preview', order);
    expect(second.status).toBe(200);
    expect(second.body.value.terms.previewId).not.toBe(first.body.value.terms.previewId);
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect(db.prepare('SELECT preview_id FROM mock_admissions').all()).toEqual([{ preview_id: second.body.value.terms.previewId }]);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

it('retires pending mock state after a conclusive wrong-terms confirmation rejection', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const first = (await post(fixture, port, 'preview', order)).body.value;
    const wrongTermsHash = first.termsHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
    expect((await post(fixture, port, 'confirm', { confirmationToken: first.confirmationToken, termsHash: wrongTermsHash })).status).toBe(409);
    const second = await post(fixture, port, 'preview', order);
    expect(second.status).toBe(200);
    const confirmed = await post(fixture, port, 'confirm', { confirmationToken: second.body.value.confirmationToken, termsHash: second.body.value.termsHash });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.value.outcome).toBe('acknowledged');
  } finally { await cleanup(fixture); }
});

it('preserves preview A after an extra-field rejection so preview B cannot steal its confirmation', async () => {
  const fixture = enabled();
  const port = await listen(fixture);
  try {
    await post(fixture, port, 'resume');
    const previewA = (await post(fixture, port, 'preview', order)).body.value;
    const wrongTermsHash = previewA.termsHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
    const malformed = await post(fixture, port, 'confirm', {
      confirmationToken: previewA.confirmationToken, termsHash: wrongTermsHash, extra: true,
    });
    expect(malformed.status).toBe(409);
    const previewB = await post(fixture, port, 'preview', order);
    expect(previewB.status).toBe(409);

    const confirmedA = await post(fixture, port, 'confirm', {
      confirmationToken: previewA.confirmationToken, termsHash: previewA.termsHash,
    });
    expect(confirmedA.status).toBe(200);
    expect(confirmedA.body.value.outcome).toBe('acknowledged');
    const mockOrder = await post(fixture, port, 'mock-history', { dispatchId: confirmedA.body.value.intentId });
    expect(mockOrder.status).toBe(200);
    expect(mockOrder.body.value.order.previewId).toBe(previewA.terms.previewId);
  } finally { await cleanup(fixture); }
});

it('replays the exact stored effect after admission expiry and a clean reopen', async () => {
  let now = Date.now();
  let fixture = enabled(() => now);
  const preview = mockPreview('00000000-0000-4000-8000-000000000031', new Date(now + 5000).toISOString());
  const confirmationToken = 'R'.repeat(43);
  const termsHash = 'd'.repeat(64);
  const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
  const input = { dispatchId: '00000000-0000-4000-8000-000000000032', preview, termsHash, confirmationToken, admissionHandle: admission.handle };
  const first = fixture.mockStore!.submit(input);
  now += 6000;
  await fixture.close();
  fixture = fixture.reopen();
  try {
    const replay = fixture.mockStore!.submit(input);
    expect(replay).toEqual(first);
    const db = new Database(fixture.mockPath!, { readonly: true });
    try {
      expect((db.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT count(*) AS n FROM mock_events').get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  } finally { await cleanup(fixture); }
});

it('rejects an accepted event corrupted to the exact preview expiry on reopen and retains ownership', async () => {
  await rejectCorruptedAcceptedTimestamp(0);
});

it('rejects an accepted event corrupted after the preview expiry on reopen and retains ownership', async () => {
  await rejectCorruptedAcceptedTimestamp(1);
});

it('keeps a duplicate admission conflict recoverable', async () => {
  const fixture = enabled();
  try {
    const preview = mockPreview('00000000-0000-4000-8000-000000000041', new Date(Date.now() + 60000).toISOString());
    const input = { preview, termsHash: 'e'.repeat(64), confirmationToken: 'D'.repeat(43) };
    fixture.mockStore!.admit(input);
    expect(() => fixture.mockStore!.admit(input)).toThrow();
    const next = mockPreview('00000000-0000-4000-8000-000000000042', new Date(Date.now() + 60000).toISOString());
    expect(fixture.mockStore!.admit({ preview: next, termsHash: 'f'.repeat(64), confirmationToken: 'N'.repeat(43) }).previewId).toBe(next.previewId);
  } finally { await cleanup(fixture); }
});

it('poisons and retains ownership after admission persistence failure', async () => {
  const fixture = enabled();
  try {
    const preview = mockPreview('00000000-0000-4000-8000-000000000051', new Date(Date.now() + 60000).toISOString());
    const input = { preview, termsHash: 'a'.repeat(64), confirmationToken: 'P'.repeat(43) };
    fixture.mockStore!.failNextAdmissionInsertForTest();
    expect(() => fixture.mockStore!.admit(input)).toThrow('synthetic mock admission persistence fault');
    const next = mockPreview('00000000-0000-4000-8000-000000000052', new Date(Date.now() + 60000).toISOString());
    expect(() => fixture.mockStore!.admit({ ...input, preview: next })).toThrow();
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('replays cancellation settlement only after a cancel request and acknowledgement', async () => {
  const fixture = enabled(() => 1000);
  try {
    const now = 1000;
    const preview = mockPreview('00000000-0000-4000-8000-000000000061', new Date(61000).toISOString());
    const confirmationToken = 'S'.repeat(43);
    const termsHash = 'b'.repeat(64);
    const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
    const dispatchId = '00000000-0000-4000-8000-000000000062';
    const accepted = fixture.mockStore!.submit({ dispatchId, preview, termsHash, confirmationToken, admissionHandle: admission.handle });
    const db = new Database(fixture.mockPath!);
    try {
      db.prepare('INSERT INTO mock_events(dispatch_id,sequence,event_json) VALUES(?,?,?)').run(dispatchId, 2,
        canonical({ type: 'cancellation-settled', at: now }));
      const coherentCanceledView = { ...accepted, status: 'canceled' };
      db.prepare('UPDATE mock_orders SET projection_json=? WHERE dispatch_id=?').run(canonical(coherentCanceledView), dispatchId);
      expect(JSON.parse((db.prepare('SELECT projection_json FROM mock_orders WHERE dispatch_id=?').get(dispatchId) as { projection_json: string }).projection_json))
        .toEqual(coherentCanceledView);
    }
    finally { db.close(); }
    expect(() => fixture.mockStore!.read(dispatchId)).toThrow();
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('rejects duplicate execution identifiers during persisted event replay', async () => {
  const fixture = enabled(() => 1000);
  try {
    const preview = mockPreview('00000000-0000-4000-8000-000000000071', new Date(61000).toISOString());
    const confirmationToken = 'X'.repeat(43);
    const termsHash = 'c'.repeat(64);
    const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
    const dispatchId = '00000000-0000-4000-8000-000000000072';
    fixture.mockStore!.submit({ dispatchId, preview, termsHash, confirmationToken, admissionHandle: admission.handle });
    const execution = { executionId: 'duplicate-fill', quantity: { value: '0.001', precision: 4, scale: 3 },
      price: { value: '0.89', precision: 3, scale: 2 }, currency: 'USD' as const };
    const singleFill = fixture.mockStore!.observeExecution(dispatchId, execution);
    const duplicatedView = { ...singleFill, executions: [execution, execution] };
    const db = new Database(fixture.mockPath!);
    try {
      db.prepare('INSERT INTO mock_events(dispatch_id,sequence,event_json) VALUES(?,?,?)').run(dispatchId, 3,
        canonical({ type: 'execution-observed', at: 1000, execution }));
      db.prepare('UPDATE mock_orders SET projection_json=? WHERE dispatch_id=?').run(canonical(duplicatedView), dispatchId);
      expect(JSON.parse((db.prepare('SELECT projection_json FROM mock_orders WHERE dispatch_id=?').get(dispatchId) as { projection_json: string }).projection_json))
        .toEqual(duplicatedView);
    }
    finally { db.close(); }
    expect(() => fixture.mockStore!.read(dispatchId)).toThrow();
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('accepts a canonical 16-execution mock projection above the shared ledger decoder limit', async () => {
  const fixture = enabled(() => 1000);
  try {
    const preview = mockPreview('00000000-0000-4000-8000-000000000073', new Date(61000).toISOString());
    const confirmationToken = 'Y'.repeat(43);
    const termsHash = 'e'.repeat(64);
    const admission = fixture.mockStore!.admit({ preview, termsHash, confirmationToken });
    const dispatchId = '00000000-0000-4000-8000-000000000074';
    fixture.mockStore!.submit({ dispatchId, preview, termsHash, confirmationToken, admissionHandle: admission.handle });
    for (let index = 0; index < 16; index++) {
      const executionId = `fill-${String(index).padStart(2, '0')}-${'x'.repeat(56)}`;
      fixture.mockStore!.observeExecution(dispatchId, {
        executionId, quantity: { value: '0.0001', precision: 5, scale: 4 },
        price: { value: '0.89', precision: 3, scale: 2 },
        fee: { value: '0.123456789012345678', precision: 19, scale: 18 }, currency: 'USD',
      });
    }
    const stored = fixture.mockStore!.read(dispatchId)!;
    const body = canonical(stored);
    expect(stored.executions).toHaveLength(16);
    expect(body.length).toBeGreaterThan(4096);
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(8192);
  } finally { await cleanup(fixture); }
});

it('rejects a consumed admission that has no matching order on reopen', async () => {
  let fixture = enabled();
  const preview = mockPreview('00000000-0000-4000-8000-000000000081', new Date(Date.now() + 60000).toISOString());
  fixture.mockStore!.admit({ preview, termsHash: 'c'.repeat(64), confirmationToken: 'O'.repeat(43) });
  await fixture.close();
  const db = new Database(fixture.mockPath!);
  try { db.prepare('UPDATE mock_admissions SET consumed_dispatch=? WHERE preview_id=?').run('00000000-0000-4000-8000-000000000082', preview.previewId); }
  finally { db.close(); }
  try {
    expect(() => fixture.reopen()).toThrow();
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
  } finally { await cleanup(fixture); }
});

it.skipIf(process.platform === 'win32')('poisons the store when SQLite file permissions change between operations', async () => {
  const { chmodSync } = await import('node:fs');
  const fixture = enabled();
  try {
    chmodSync(fixture.mockPath!, 0o644);
    expect(() => fixture.mockStore!.read('00000000-0000-4000-8000-000000000091')).toThrow();
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('poisons the store and retains the lock when writer ownership changes', async () => {
  const fixture = enabled();
  try {
    writeFileSync(`${fixture.mockPath}.lock`, 'foreign-owner');
    expect(() => fixture.mockStore!.read('00000000-0000-4000-8000-000000000094')).toThrow();
    expect(existsSync(`${fixture.mockPath}.lock`)).toBe(true);
    await expect(fixture.close()).rejects.toThrow();
  } finally { await cleanup(fixture); }
});

it('settles client failures before headers, on aborted or premature responses, and on oversized responses', async () => {
  let requestNumber = 0;
  await withMockClient((_req, res) => {
    switch (requestNumber++) {
      case 0: res.socket?.destroy(); break;
      case 1: res.writeHead(200, { 'Content-Length': '100' }); res.write('partial'); res.destroy(); break;
      case 2: res.writeHead(200); res.write('partial'); res.socket?.destroy(); break;
      case 3: res.writeHead(200, { 'Content-Length': '8193' }); res.end(); break;
      default: res.writeHead(200); res.end(Buffer.alloc(8193, 120)); break;
    }
  }, async client => {
    const dispatchId = '00000000-0000-4000-8000-000000000092';
    for (let index = 0; index < 5; index++) await expect(client.read(dispatchId)).rejects.toThrow('synthetic mock unavailable');
  });
});

it('bounds runner exit and records when descendant termination is unconfirmed', () => {
  const writes: string[] = [];
  const exits: number[] = [];
  let scheduled: (() => void) | undefined;
  let delay = 0;
  const fakeProcess = {
    stderr: { write(line: string) { writes.push(line); } },
    exitCode: undefined as number | undefined,
    exit(code: number) { exits.push(code); },
  };
  const report = formatRunnerReport({ timedOut: true, childExitCode: null, childSignal: null,
    descendants: 'unconfirmed', termination: 'timeout' });
  reportAndExit(124, report, fakeProcess, (callback: () => void, ms: number) => {
    scheduled = callback;
    delay = ms;
    return 1;
  });
  expect(writes.join('')).toContain('"descendants":"unconfirmed"');
  expect(delay).toBe(250);
  expect(fakeProcess.exitCode).toBe(124);
  expect(exits).toEqual([]);
  scheduled!();
  expect(exits).toEqual([124]);
});

it('enforces the absolute five-second response deadline despite regular response chunks', async () => {
  const started = performance.now();
  await withMockClient((_req, res) => {
    res.writeHead(200);
    res.flushHeaders();
    const keepAlive = setInterval(() => { res.write(' '); }, 100);
    res.once('close', () => clearInterval(keepAlive));
  }, async client => {
    await expect(client.read('00000000-0000-4000-8000-000000000093')).rejects.toThrow('synthetic mock unavailable');
  });
  const elapsed = performance.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(4800);
  expect(elapsed).toBeLessThan(6500);
}, 7500);
