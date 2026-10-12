import { request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createWorker } from './service.js';
import { Connection } from './connection.js';
import { registrationSchema, type Credentials } from './connection-contract.js';
import type { Provider } from './provider.js';
import { Ledger } from './ledger.js';
import type { LedgerEvent } from './ledger-contract.js';
import { createLedgerDirectory } from './ledger-storage.js';
import { storageFixture } from './storage-fixture.js';
import { event, id, intent } from './ledger-fixture.js';

const roots: string[] = [], ledgers: Ledger[] = [], ownerId = id(1), secret = 's'.repeat(43), session = 'a'.repeat(43);
afterEach(() => { for (const ledger of ledgers.splice(0)) { try { ledger.close(); } catch {} } roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
const registration = registrationSchema.parse({ clientId: 'offline-fixture', redirectUri: 'http://127.0.0.1:3000/api/connection/callback', issuer: 'https://agent.robinhood.com/mcp/trading', authorizationEndpoint: 'https://robinhood.com/oauth', tokenEndpoint: 'https://api.robinhood.com/oauth2/token/', scope: 'internal', tokenEndpointAuthMethod: 'none', pkce: 'S256' });
const selectedAccount = { account_number: 'ACCOUNT1', rhs_account_number: 'RHS2', rhc_account_number: 'RHC3', eligible: true as const, agent_accessible: true as const, status: 'active' as const, account_type: 'cash' as const, ownership: 'individual' as const };
const emptyAccount = { account_number: 'EMPTY1', rhs_account_number: 'EMPTY2', rhc_account_number: 'EMPTY3', eligible: true as const, agent_accessible: true as const, status: 'active' as const, account_type: 'cash' as const, ownership: 'individual' as const };
function selectedConnection() {
  let persisted: Credentials | null = null;
  const provider = { exchange: async () => ({ access: 'synthetic-access', refresh: 'synthetic-refresh', expiresAt: Date.now() + 600000 }), refresh: async () => ({ access: 'synthetic-access', refresh: 'synthetic-refresh', expiresAt: Date.now() + 600000 }), accounts: async () => ({ accounts: [selectedAccount, emptyAccount] }) } satisfies Provider;
  const vault = { read: () => persisted, write: (value: Credentials | null) => { persisted = value; } };
  const connection = new Connection(provider, vault, registration);
  return { connection, async select() { const state = new URL(connection.initiate(session).authorizationUrl).searchParams.get('state')!; const status = await connection.callback(session, { state, code: 'synthetic-code' }); connection.select({ account: status.accounts[0].handle }); return status; } };
}
async function listen(server: ReturnType<typeof createWorker>) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return (server.address() as { port: number }).port; }
async function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return new Promise<{ status: number; value: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'X-Gelt-Session': session, 'X-Gelt-Session-Expires': String(Date.now() + 300000), 'Content-Length': Buffer.byteLength(text), ...headers } }, res => {
      let response = ''; res.setEncoding('utf8'); res.on('data', chunk => response += chunk); res.on('end', () => { try { resolve({ status: res.statusCode!, value: JSON.parse(response) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(text);
  });
}
function close(server: ReturnType<typeof createWorker>) { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }
const routedIntent = (intentId: string, accountId: string, routing: typeof intent.routing, instrumentId: string) => ({ ...intent, intentId, accountId, routing, order: { ...intent.order, instrumentId } });

it('offline synthetic records survive SQLite restart; selected-account read is isolated, exact, and timeline follows storage sequence', async () => {
  const root = storageFixture('order-history-'); roots.push(root); const dir = join(root, 'data'); createLedgerDirectory(dir); const path = join(dir, 'execution.sqlite');
  let ledger = new Ledger(path, ownerId); ledgers.push(ledger);
  const first = routedIntent(id(3), id(2), { provider: 'robinhood-official-mcp', ACCOUNT: 'ACCOUNT1', RHS: 'RHS2', RHC: 'RHC3' }, 'BTC-USD');
  const acknowledged = { ...routedIntent(id(30), id(2), { provider: 'robinhood-official-mcp', ACCOUNT: 'ACCOUNT1', RHS: 'RHS2', RHC: 'RHC3' }, 'ETH-USD'), idempotencyKey: id(32) };
  const otherAccount = routedIntent(id(40), id(41), { provider: 'robinhood-official-mcp', ACCOUNT: 'OTHER1', RHS: 'OTHER2', RHC: 'OTHER3' }, 'DOGE-USD');
  expect(ledger.recordIntent({ ...first, order: { ...first.order, currency: 'USDT' as never } })).toMatchObject({ ok: false, error: 'invalid' });
  expect(ledger.recordIntent(first)).toMatchObject({ ok: true }); expect(ledger.recordIntent(acknowledged)).toMatchObject({ ok: true }); expect(ledger.recordIntent(otherAccount)).toMatchObject({ ok: true });
  const lateRequested = { version: 1 as const, ownerId, accountId: id(2), intentId: id(3), eventId: id(70), idempotencyKey: id(71), occurredAt: '2026-01-01T00:00:10.000Z', type: 'order-requested' as const, requestId: id(72) };
  const observedNoFee = structuredClone(event) as Extract<LedgerEvent, { type: 'execution-observed' }>;
  observedNoFee.occurredAt = '2026-01-01T00:00:01.000Z'; delete observedNoFee.execution.observedFee;
  expect(ledger.append(lateRequested)).toMatchObject({ ok: true }); expect(ledger.append(observedNoFee)).toMatchObject({ ok: true });
  const ack = { version: 1 as const, ownerId, accountId: id(2), intentId: id(30), eventId: id(73), idempotencyKey: id(74), occurredAt: '2026-01-01T00:00:02.000Z', type: 'broker-acknowledged' as const, brokerOrderId: 'broker-observation' };
  const unknown = { version: 1 as const, ownerId, accountId: id(2), intentId: id(30), eventId: id(75), idempotencyKey: id(76), occurredAt: '2026-01-01T00:00:03.000Z', type: 'reconciliation-observed' as const, reconciliationId: id(77), observation: 'unknown' as const };
  expect(ledger.append(ack)).toMatchObject({ ok: true }); expect(ledger.append(unknown)).toMatchObject({ ok: true }); ledger.close();

  const offline = selectedConnection(); const connected = await offline.select();
  ledger = new Ledger(path, ownerId); ledgers.push(ledger); // a new handle after a clean worker-like restart
  let server = createWorker(offline.connection, secret, ledger.available, ledger, ownerId); let port = await listen(server);
  try {
    const listed = await post(port, '/v1/history/list', { after: 0, limit: 50 });
    expect(listed.status).toBe(200); expect(listed.value.accountHandle).toBe(connected.accounts[0].handle);
    expect(listed.value.items.map((row: any) => row.intentId)).toEqual([id(3), id(30)]);
    const fill = listed.value.items.find((row: any) => row.intentId === id(3));
    expect(fill).toMatchObject({ source: 'robinhood-official-mcp', account: { ACCOUNT: '••••UNT1', RHS: '••••RHS2', RHC: '••••RHC3' }, requestedQuantity: '0.010', requestedLimitPrice: '1.00', currency: 'USD', executionCount: 1 });
    expect(listed.value.items.some((row: any) => row.intentId === id(40))).toBe(false);
    const detail = await post(port, '/v1/history/intent', { intentId: id(3), after: 0, limit: 50 });
    expect(detail.status).toBe(200); expect(detail.value.accountHandle).toBe(connected.accounts[0].handle);
    expect(detail.value.timeline.map((item: any) => item.sequence)).toEqual([1, 2]);
    expect(detail.value.timeline.map((item: any) => item.event.occurredAt)).toEqual(['2026-01-01T00:00:10.000Z', '2026-01-01T00:00:01.000Z']);
    expect(detail.value.intent.requestedQuantity).toBe('0.010'); expect(detail.value.timeline[1].event.execution.observedQuantity.value).toBe('0.001');
    expect(detail.value.timeline[1].event.execution.observedPrice.value).toBe('0.99'); expect('observedFee' in detail.value.timeline[1].event.execution).toBe(false);
    expect(detail.value.timeline[1].event).not.toHaveProperty('accountId'); expect(detail.value.timeline[1].event.execution).not.toHaveProperty('executionId');
    const ackOnly = await post(port, '/v1/history/intent', { intentId: id(30), after: 0, limit: 50 });
    expect(ackOnly.value.intent.executionCount).toBe(0); expect(ackOnly.value.timeline.map((item: any) => item.event.type)).toEqual(['broker-acknowledged', 'reconciliation-observed']);
    expect(ackOnly.value.timeline[1].event.observation).toBe('unknown');
    expect((await post(port, '/v1/history/intent', { intentId: id(40), after: 0, limit: 50 })).status).toBe(409);
    expect((await post(port, '/v1/history/list', { after: 0, limit: 50, accountId: id(41) })).status).toBe(409);
    expect((await post(port, '/v1/history/list', { after: 0, limit: 50 }, { Authorization: 'Bearer wrong' })).status).toBe(403);
    offline.connection.select({ account: connected.accounts[1].handle });
    const empty = await post(port, '/v1/history/list', { after: 0, limit: 50 });
    expect(empty.status).toBe(200); expect(empty.value.items).toEqual([]); expect(empty.value.account.ACCOUNT).toBe('••••PTY1');
    expect(empty.value.accountHandle).toBe(connected.accounts[1].handle);
    expect(empty.value.accountHandle).not.toBe(listed.value.accountHandle);
    await close(server); server = createWorker(offline.connection, secret, () => false, ledger, ownerId); port = await listen(server);
    const unavailable = await post(port, '/v1/history/list', { after: 0, limit: 50 });
    expect(unavailable.status).toBe(409); expect(unavailable.value).not.toHaveProperty('items');
  } finally { await close(server); ledger.close(); offline.connection.shutdown(); }
});
