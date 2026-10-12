import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConnectionBff } from './connection-bff';
import { storageFixture } from '../../worker/src/storage-fixture';
import { writePrivateNew, replacePrivate } from '../../worker/src/private-files';
import { simulationViewTestFixture } from '../../worker/src/fixtures/simulation-view';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: false })));
function setup(enabled = true) {
  const root = storageFixture('gelt-simulation-bff-'); roots.push(root);
  const bytes = JSON.stringify(simulationViewTestFixture()), path = join(root, 'recorded.json'); writePrivateNew(path, bytes);
  const bootstrap = 'b'.repeat(43), ingress = 'i'.repeat(43);
  writePrivateNew(join(root, 'bff.json'), JSON.stringify({ serviceSecret: 's'.repeat(43) }));
  writePrivateNew(join(root, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: 20000 }));
  const transport = vi.fn(async () => { throw Error('No worker or broker permitted'); }); let now = 10000, cookie = '', csrf = '';
  const bff = new ConnectionBff(join(root, 'bff.json'), transport, () => now, ingress, '', enabled ? { path, digest: createHash('sha256').update(bytes).digest('hex') } : { path: undefined, digest: undefined });
  const call = (op = 'simulation-list', body: unknown = {}, extra = {}) => bff.handle(new Request(`http://127.0.0.1:3000/api/connection/${op}`, { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-gelt-ingress': ingress, cookie, 'x-gelt-csrf': csrf, ...extra }, body: JSON.stringify(body) }), op);
  return { call, transport, path, login: async () => { const r = await call('bootstrap', { bootstrap }); expect(r.status).toBe(200); cookie = r.headers.get('set-cookie')!.split(';')[0]; csrf = (await r.json()).csrf; }, expire: () => { now += 3600001; } };
}
it('requires owner boundary and accepts named reads only without touching worker or broker', async () => {
  const f = setup(); expect((await f.call()).status).toBe(401); await f.login();
  for (const extra of [{ host: 'evil' }, { origin: 'https://evil.test' }, { 'x-gelt-csrf': '' }, { 'x-gelt-ingress': '' }, { forwarded: 'evil' }]) expect((await f.call('simulation-list', {}, extra)).status).toBe(403);
  expect((await f.call('simulation-list', { path: '/other' })).status).toBe(409);
  expect((await f.call('simulation-detail', { runId: '../secret' })).status).toBe(409);
  expect((await f.call('simulation-execute')).status).toBe(404);
  expect(await (await f.call('simulation-detail', { runId: 'recorded-unit' })).json()).toMatchObject({ state: 'available', run: simulationViewTestFixture().runs[0] });
  f.expire(); expect((await f.call()).status).toBe(401); expect(f.transport).not.toHaveBeenCalled();
});
it('classifies missing configuration, selection and modified snapshot without inventing data', async () => {
  const f = setup(); await f.login(); expect(await (await f.call('simulation-detail', { runId: 'recorded-absent' })).json()).toMatchObject({ state: 'missing' });
  replacePrivate(f.path, JSON.stringify({ ...simulationViewTestFixture(), token: 'untrusted' }));
  expect(await (await f.call()).json()).toMatchObject({ state: 'corrupt', items: [] });
  const off = setup(false); await off.login(); expect(await (await off.call()).json()).toMatchObject({ state: 'unavailable', items: [] });
});
