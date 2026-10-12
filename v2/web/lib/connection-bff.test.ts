import { it, expect, vi, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConnectionBff } from './connection-bff';
import { createWorker } from '../../worker/src/service';
import { offlinePiHandoff } from '../../worker/src/pi-handoff';
import { storageFixture } from '../../worker/src/storage-fixture';
import { writePrivateNew, readPrivate } from '../../worker/src/private-files';
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const bootstrap = 'b'.repeat(43), serviceSecret = 's'.repeat(43), ingress = 'i'.repeat(43);
function fixture(realClock = false, readNow?: () => number) {
  const dir = storageFixture('gelt-bff-'); dirs.push(dir);
  let now = realClock ? Date.now() : 10000;
  writePrivateNew(join(dir, 'bff.json'), JSON.stringify({ serviceSecret }));
  writePrivateNew(join(dir, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: now + (realClock ? 60000 : 10000) }));
  const status = { version: 'v1', state: 'disconnected', reason: 'not_connected', expiresAt: null, accounts: [], selected: null, execution: false };
  const transport = vi.fn(async () => Response.json(status));
  const bff = new ConnectionBff(join(dir, 'bff.json'), transport, readNow ?? (() => now), ingress);
  let cookie = '', csrf = '';
  const request = (operation: string, body: unknown = {}, overrides: Record<string, string> = {}, query = '') => new Request(`http://127.0.0.1:3000/api/connection/${operation}${query}`, { method: operation === 'callback' ? 'GET' : 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-gelt-ingress': ingress, cookie, 'x-gelt-csrf': csrf, ...overrides }, ...(operation === 'callback' ? {} : { body: JSON.stringify(body) }) });
  const call = (operation: string, body: unknown = {}, overrides = {}, query = '') => bff.handle(request(operation, body, overrides, query), operation);
  const login = async () => { const res = await call('bootstrap', { bootstrap }); cookie = res.headers.get('set-cookie')!.split(';')[0]; csrf = (await res.json()).csrf; return res; };
  return { dir, bff, call, login, transport, time: () => { now += 3600001; }, status };
}
it('one-use protected bootstrap, secure opaque cookie, actual session + CSRF; no raw worker output', async () => {
  const f = fixture(); expect((await f.call('status')).status).toBe(401);
  expect((await f.call('bootstrap', { bootstrap: 'x'.repeat(43) })).status).toBe(403);
  const login = await f.login(); expect(login.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/); if (process.platform === 'win32') expect(JSON.parse(readPrivate(join(f.dir, 'bootstrap.json')).toString())).toEqual({ consumed: true }); else expect(existsSync(join(f.dir, 'bootstrap.json'))).toBe(false);
  expect((await f.call('bootstrap', { bootstrap })).status).toBe(409);
  expect((await f.call('status')).status).toBe(200); expect(f.transport).toHaveBeenCalledTimes(1);
  const [url, init] = (f.transport.mock.calls as any)[0]; expect(url).toBe('http://127.0.0.1:4100/v1/connection/status'); expect(init.headers.Authorization).toBe(`Bearer ${serviceSecret}`);
  f.transport.mockResolvedValueOnce(Response.json({ ...f.status, access_token: 'SECRET' })); const response = await f.call('status'); expect(response.status).toBe(409); expect(await response.text()).not.toContain('SECRET');
  f.time(); expect((await f.call('status')).status).toBe(401);
});
it('simulation bootstrap diagnostics report safe stages, status and outcomes without changing one-use behavior', async () => {
  vi.stubEnv('GELT_SIMULATION_DIAGNOSTICS', '1');
  const f = fixture();
  const mismatch = await f.call('bootstrap', { bootstrap: 'x'.repeat(43) });
  expect(mismatch.status).toBe(403);
  expect(mismatch.headers.get('x-gelt-bootstrap-stage')).toBe('grant-read');
  expect(mismatch.headers.get('x-gelt-bootstrap-outcome')).toBe('grant-mismatch');
  expect(await mismatch.text()).not.toContain('x'.repeat(43));

  const success = await f.login();
  expect(success.status).toBe(200);
  expect(success.headers.get('x-gelt-bootstrap-stage')).toBe('session-created');
  expect(success.headers.get('x-gelt-bootstrap-outcome')).toBe('session-created');
  const replay = await f.call('bootstrap', { bootstrap });
  expect(replay.status).toBe(409);
  expect(replay.headers.get('x-gelt-bootstrap-stage')).toBe('grant-read');
  expect(replay.headers.get('x-gelt-bootstrap-outcome')).toBe('unavailable');
  expect(await replay.text()).not.toContain(bootstrap);

  const expired = fixture(); expired.time();
  const denial = await expired.call('bootstrap', { bootstrap });
  expect(denial.status).toBe(403);
  expect(denial.headers.get('x-gelt-bootstrap-stage')).toBe('grant-read');
  expect(denial.headers.get('x-gelt-bootstrap-outcome')).toBe('grant-expired');
  expect(existsSync(join(expired.dir, 'bootstrap.json'))).toBe(true);
  expect(existsSync(join(expired.dir, 'bootstrap.json.lock'))).toBe(false);
});
it('simulation diagnostics identify a denial after the one-use grant was consumed', async () => {
  vi.stubEnv('GELT_SIMULATION_DIAGNOSTICS', '1');
  const clock = [19999, 20000];
  const f = fixture(false, () => clock.shift() ?? 20000);
  const response = await f.call('bootstrap', { bootstrap });
  expect(response.status).toBe(403);
  expect(response.headers.get('x-gelt-bootstrap-stage')).toBe('grant-consumed');
  expect(response.headers.get('x-gelt-bootstrap-outcome')).toBe('grant-expired-after-consumption');
  if (process.platform === 'win32') expect(JSON.parse(readPrivate(join(f.dir, 'bootstrap.json')).toString())).toEqual({ consumed: true });
  else expect(existsSync(join(f.dir, 'bootstrap.json'))).toBe(false);
  expect(existsSync(join(f.dir, 'bootstrap.json.lock'))).toBe(false);
  expect((await f.call('status')).status).toBe(401);
});

it('simulation bootstrap diagnostics stay absent outside the temporary demo mode', async () => {
  vi.stubEnv('GELT_SIMULATION_DIAGNOSTICS', '');
  const f = fixture();
  const response = await f.login();
  expect(response.status).toBe(200);
  expect(response.headers.has('x-gelt-bootstrap-stage')).toBe(false);
  expect(response.headers.has('x-gelt-bootstrap-outcome')).toBe(false);
});

it('rejects hostile host/origin/forwarded/CSRF/ingress and generic tools before private transport', async () => {
  const f = fixture(); await f.login();
  for (const h of [{ host: 'evil' }, { origin: 'https://evil.test' }, { origin: '' }, { 'x-gelt-csrf': '' }, { 'x-gelt-csrf': 'wrong' }, { forwarded: 'host=evil' }, { 'x-forwarded-host': 'evil' }, { 'x-forwarded-extra': 'evil' }, { 'x-gelt-ingress': '' }]) expect((await f.call('status', {}, h)).status).toBe(403);
  expect((await f.call('tools', { name: 'place_order', args: {} })).status).toBe(404);
  expect((await f.call('status', { extra: true })).status).toBe(409);
  expect((await f.call('status', {}, {}, '?secret=1')).status).toBe(400);
  expect(f.transport).not.toHaveBeenCalled();
});
it('only callback omits Origin/CSRF, still requires session, strict query, clean redirect and no-referrer', async () => {
  const f = fixture(), query = '?state=' + 'a'.repeat(43) + '&code=SECRET-code';
  expect((await f.call('callback', {}, { origin: '', 'x-gelt-csrf': '' }, query)).status).toBe(401); await f.login();
  const res = await f.call('callback', {}, { origin: '', 'x-gelt-csrf': '' }, query);
  expect(res.status).toBe(303); expect(res.headers.get('location')).toBe('/connect'); expect(res.headers.get('referrer-policy')).toBe('no-referrer'); expect(await res.text()).toBe('');
  const calls = f.transport.mock.calls.length;
  await f.call('callback', {}, {}, query + '&state=bad'); expect(f.transport).toHaveBeenCalledTimes(calls);
});
it('bounds input and refuses setup-less sessions, expired bootstrap and provider errors', async () => {
  const f = fixture(); f.time(); expect((await f.call('bootstrap', { bootstrap })).status).toBe(403);
  const g = fixture(); await g.login(); expect((await g.call('status', { data: 's'.repeat(5000) })).status).toBe(409);
  g.transport.mockRejectedValueOnce(new Error('SECRET')); expect(await (await g.call('status')).text()).not.toContain('SECRET');
});
it('forwards only the protected read-only order status and rejects unsafe worker output', async () => {
  const f = fixture(); await f.login();
  const disabled = {
    version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false,
    dispatch: false, cancellation: false, reconciliation: false, reason: 'production_adapter_unsupported',
  };
  f.transport.mockResolvedValueOnce(Response.json(disabled));
  const response = await f.call('order-status');
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject(disabled);
  const [url, init] = (f.transport.mock.calls as any)[0];
  expect(url).toBe('http://127.0.0.1:4100/v1/orders/status');
  expect(init.method).toBe('POST'); expect(JSON.parse(init.body)).toEqual({});
  f.transport.mockResolvedValueOnce(Response.json({ ...disabled, dispatch: true }));
  expect((await f.call('order-status')).status).toBe(409);
  expect(f.transport).toHaveBeenCalledTimes(2);
});
it('protects named fixture handoff operations and refuses forged worker authority', async () => {
  const f = fixture(); await f.login();
  const draft = { account: 'synthetic-pi-account-a', route: 'RHS', instrument: 'BTC-USD', side: 'BUY', type: 'LIMIT', quantity: '0.001', limitPrice: '100.00', revision: 1 };
  const status = { version: 'v1', source: 'synthetic-offline-pi-handoff', enabled: false, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: [] };
  f.transport.mockResolvedValueOnce(Response.json(status));
  expect((await f.call('pi-status')).status).toBe(200);
  expect((f.transport.mock.calls as any)[0][0]).toBe('http://127.0.0.1:4100/v1/pi-handoff/status');
  expect((await f.call('pi-prepare', draft, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await f.call('pi-prepare', draft, { 'x-gelt-csrf': 'invalid' })).status).toBe(403);
  expect((await f.call('pi-prepare', { ...draft, padding: 'x'.repeat(5000) })).status).toBe(409);
  expect(f.transport).toHaveBeenCalledTimes(1);
  f.transport.mockResolvedValueOnce(Response.json({ ...status, enabled: true, accounts: ['synthetic-pi-account-a', 'synthetic-pi-account-b'], dispatch: true }));
  expect((await f.call('pi-status')).status).toBe(409);
  const prepared = { version: 'v1', source: 'synthetic-offline-pi-handoff', id: 'a'.repeat(32), digest: 'b'.repeat(64), expiresAt: Date.now() + 30000, draft, authority: false, brokerFacts: false };
  f.transport.mockResolvedValueOnce(Response.json(prepared));
  expect((await f.call('pi-prepare', draft)).status).toBe(200);
  expect((f.transport.mock.calls as any)[2][0]).toBe('http://127.0.0.1:4100/v1/pi-handoff/prepare');
  expect(JSON.parse((f.transport.mock.calls as any)[2][1].body)).toEqual(draft);
  f.transport.mockResolvedValueOnce(Response.json({ ...prepared, authority: true }));
  expect((await f.call('pi-review', { id: prepared.id, digest: prepared.digest, draft })).status).toBe(409);
  expect((f.transport.mock.calls as any)[3][0]).toBe('http://127.0.0.1:4100/v1/pi-handoff/review');
  expect((await f.call('pi-review', { id: prepared.id, digest: prepared.digest, draft: { ...draft, account: 'other' } })).status).toBe(409);
  expect(f.transport).toHaveBeenCalledTimes(4);
});
it('round-trips authenticated fixture prepare/review through the real private worker without execution', async () => {
  const old = process.env.GELT_OFFLINE_PI_HANDOFF;
  process.env.GELT_OFFLINE_PI_HANDOFF = 'fixture-only';
  const worker = createWorker(undefined, serviceSecret, undefined, undefined, undefined, offlinePiHandoff());
  await new Promise<void>(resolve => worker.listen(0, '127.0.0.1', resolve));
  try {
    const f = fixture(true); await f.login();
    const port = (worker.address() as { port: number }).port;
    f.transport.mockImplementation(((url: string, init: RequestInit) => fetch(url.replace('127.0.0.1:4100', `127.0.0.1:${port}`), init)) as typeof f.transport);
    const status = await f.call('pi-status'); expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ enabled: true, dispatch: false });
    const draft = { account: 'synthetic-pi-account-a', route: 'RHS', instrument: 'BTC-USD', side: 'BUY', type: 'LIMIT', quantity: '0.001', limitPrice: '100.00', revision: 0 };
    const prepared = await f.call('pi-prepare', draft); expect(prepared.status).toBe(200);
    const value = await prepared.json(); expect(value).toMatchObject({ draft, authority: false, brokerFacts: false });
    const review = await f.call('pi-review', { id: value.id, digest: value.digest, draft });
    expect(review.status).toBe(200); expect(await review.json()).toMatchObject(value);
    expect((await f.call('pi-invalidate', { revision: 1 })).status).toBe(200);
    expect((await f.call('pi-review', { id: value.id, digest: value.digest, draft })).status).toBe(409);
  } finally {
    worker.closeAllConnections(); await new Promise<void>(resolve => worker.close(() => resolve()));
    if (old === undefined) delete process.env.GELT_OFFLINE_PI_HANDOFF; else process.env.GELT_OFFLINE_PI_HANDOFF = old;
  }
});
it('disconnect destroys browser session; callback query errors never bypass bound worker validation', async () => {
  const f = fixture(); await f.login();
  expect((await f.call('callback', {}, { origin: '' }, '?state=' + 'a'.repeat(43) + '&error=access_denied')).status).toBe(303);
  expect(f.transport).toHaveBeenCalledTimes(1);
  const res = await f.call('disconnect'); expect(res.headers.get('set-cookie')).toContain('Max-Age=0'); expect((await f.call('status')).status).toBe(401);
});
