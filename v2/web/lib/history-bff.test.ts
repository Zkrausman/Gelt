import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConnectionBff } from './connection-bff';
import { storageFixture } from '../../worker/src/storage-fixture';
import { replacePrivate, writePrivateNew } from '../../worker/src/private-files';
import { candleOverlayDecision } from './history-chart';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
const bootstrap = 'b'.repeat(43), serviceSecret = 's'.repeat(43), ingress = 'i'.repeat(43);
const history = { version: 'v1', accountHandle: 'h'.repeat(43), account: { ACCOUNT: '••••1234', RHS: '••••5678', RHC: '••••9012' }, items: [], after: 0, limit: 50, hasMore: false };
function fixture() {
  const dir = storageFixture('gelt-history-bff-'); dirs.push(dir);
  writePrivateNew(join(dir, 'bff.json'), JSON.stringify({ serviceSecret }));
  writePrivateNew(join(dir, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: 20000 }));
  const transport = vi.fn(async () => Response.json(history));
  let now = 10000;
  const bff = new ConnectionBff(join(dir, 'bff.json'), transport, () => now, ingress);
  let cookie = '', csrf = '';
  const call = (operation: string, body: unknown = {}, overrides: Record<string, string> = {}) => bff.handle(new Request(`http://127.0.0.1:3000/api/connection/${operation}`, { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-gelt-ingress': ingress, cookie, 'x-gelt-csrf': csrf, ...overrides }, body: JSON.stringify(body) }), operation);
  const login = async () => { const response = await call('bootstrap', { bootstrap }); cookie = response.headers.get('set-cookie')!.split(';')[0]; csrf = (await response.json()).csrf; };
  return { call, login, transport, expire: () => { now += 3600001; }, replaceSession: async () => {
    // Windows retains a consumed grant tombstone; this test-owned reissue uses
    // the existing private replacement primitive on both platforms.
    replacePrivate(join(dir, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: now + 10000 }));
    await login();
  } };
}
const listBody = { after: 0, limit: 50 };
it('protected BFF reads bounded named history and detail, preserving exact worker facts', async () => {
  const f = fixture(); await f.login();
  const list = await f.call('history', listBody);
  expect(list.status).toBe(200); expect(await list.json()).toEqual(history);
  const [url, init] = f.transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:4100/v1/history/list'); expect(init.headers).toMatchObject({ Authorization: `Bearer ${serviceSecret}` });
  expect(JSON.parse(init.body as string)).toEqual(listBody);
  const detail = { version: 'v1', accountHandle: history.accountHandle, intent: { intentId: '00000000-0000-4000-8000-000000000003', recordedAt: '2026-01-01T00:00:00.000Z', source: 'robinhood-official-mcp', account: history.account, route: 'RHS', instrumentId: 'BTC-USD', side: 'buy', currency: 'USD', requestedQuantity: '0.010', requestedLimitPrice: '1.00', eventCount: 0, executionCount: 0 }, eventCount: 0, after: 0, limit: 50, hasMore: false, timeline: [] };
  f.transport.mockResolvedValueOnce(Response.json(detail));
  const response = await f.call('intent', { ...listBody, intentId: detail.intent.intentId });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(detail);
  const calls = f.transport.mock.calls as unknown as [string, RequestInit][];
  expect(calls[1][0]).toBe('http://127.0.0.1:4100/v1/history/intent');
});
it('retains session, exact Origin/Host/CSRF, rejects invalid selectors before worker transport', async () => {
  const f = fixture(); await f.login();
  expect((await f.call('history', listBody, { 'x-gelt-csrf': 'wrong' })).status).toBe(403);
  expect((await f.call('history', listBody, { host: 'attacker' })).status).toBe(403);
  expect((await f.call('history', listBody, { origin: 'https://attacker.test' })).status).toBe(403);
  expect((await f.call('history', { after: 0, limit: 51 })).status).toBe(409);
  expect((await f.call('intent', { intentId: 'not-a-uuid', after: 0, limit: 50 })).status).toBe(409);
  expect(f.transport).not.toHaveBeenCalled();
});
it('rejects malformed worker output without relaying it', async () => {
  const f = fixture(); await f.login(); f.transport.mockResolvedValueOnce(Response.json({ ...history, items: [{ intentId: 'SECRET' }] }));
  const response = await f.call('history', listBody);
  expect(response.status).toBe(409); expect(await response.text()).not.toContain('SECRET');
});

const order = { source: 'robinhood-official-mcp', instrumentId: 'BTC-USD', currency: 'USD', occurredAt: '2026-01-01T00:00:30.000Z' };
const candle = { source: 'independent-market-feed', independentOf: 'robinhood-official-mcp', instrumentId: 'BTC-USD', quoteCurrency: 'USD', bucketStart: '2026-01-01T00:00:00.000Z', bucketEnd: '2026-01-01T00:01:00.000Z', observedAt: '2026-01-01T00:00:31.000Z' };
it('chart overlay requires independent source, exact instrument/currency and compatible event time', () => {
  expect(candleOverlayDecision(order, candle)).toEqual({ supported: true });
  expect(candleOverlayDecision(order)).toEqual({ supported: false, reason: 'unsupported' });
  expect(candleOverlayDecision(order, { ...candle, source: order.source })).toEqual({ supported: false, reason: 'source-mismatch' });
  expect(candleOverlayDecision(order, { ...candle, instrumentId: 'ETH-USD' })).toEqual({ supported: false, reason: 'instrument-mismatch' });
  expect(candleOverlayDecision(order, { ...candle, quoteCurrency: 'USDT' })).toEqual({ supported: false, reason: 'currency-mismatch' });
  expect(candleOverlayDecision(order, { ...candle, observedAt: '2026-01-01T00:05:00.000Z' })).toEqual({ supported: false, reason: 'stale-or-incompatible-time' });
});

it('distinguishes explicit owner-session denial from CSRF and private-worker failures', async () => {
  const f = fixture();
  const noSession = await f.call('history', listBody);
  expect(noSession.status).toBe(401);
  expect(await noSession.json()).toEqual({ version: 'v1', error: 'unauthorized' });
  expect(f.transport).not.toHaveBeenCalled();
  await f.login();
  const wrongDraft = await f.call('history', listBody, { 'x-gelt-csrf': 'edited-draft' });
  expect(wrongDraft.status).toBe(403);
  expect(await wrongDraft.json()).toEqual({ version: 'v1', error: 'forbidden' });
  f.transport.mockResolvedValueOnce(Response.json({ error: 'private detail must not escape' }, { status: 401 }));
  const privateDenial = await f.call('history', listBody);
  expect(privateDenial.status).toBe(409);
  expect(await privateDenial.json()).toEqual({ version: 'v1', error: 'connection_unavailable' });
  const restoredDraft = await f.call('history', listBody);
  expect(restoredDraft.status).toBe(200);
  expect(await restoredDraft.json()).toEqual(history);
});


it.each([['history', 'expiry'], ['history', 'replacement'], ['intent', 'expiry'], ['intent', 'replacement']])('reports authoritative late owner-session %s/%s without exposing worker output', async (operation, change) => {
  const f = fixture(); await f.login();
  let release!: (response: Response) => void;
  f.transport.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
  const pending = f.call(operation, { ...listBody, ...(operation === 'intent' ? { intentId: '00000000-0000-4000-8000-000000000003' } : {}) });
  await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(1));
  if (change === 'expiry') f.expire(); else await f.replaceSession();
  release(Response.json({ ...history, secret: 'must-not-escape' }));
  const response = await pending;
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ version: 'v1', error: 'unauthorized' });
});
