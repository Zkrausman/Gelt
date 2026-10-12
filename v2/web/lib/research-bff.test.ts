import { afterEach, expect, it, vi } from 'vitest';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConnectionBff } from './connection-bff';
import { storageFixture } from '../../worker/src/storage-fixture';
import { replacePrivate, writePrivateNew } from '../../worker/src/private-files';
import { provisionResearch, importResearchFile } from '../../worker/src/research-store';
import { researchFixture } from '../../worker/src/research-fixture';
import { ResearchRequests, requestResearch } from './research-requests';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function dir() { const value = storageFixture('gelt-research-bff-'); dirs.push(value); return value; }
const bootstrap = 'b'.repeat(43), serviceSecret = 's'.repeat(43), ingress = 'i'.repeat(43);
function fixture(configured = true, evidence = JSON.stringify(researchFixture())) {
  const bffRoot = dir(), root = dir(), inputRoot = dir();
  const excluded = [bffRoot, dir(), dir(), dir(), dir()];
  provisionResearch(root, excluded);
  writePrivateNew(join(bffRoot, 'bff.json'), JSON.stringify({ serviceSecret }));
  writePrivateNew(join(bffRoot, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: 20000 }));
  const input = join(inputRoot, 'evidence.json');
  writePrivateNew(input, evidence);
  const transport = vi.fn(async () => { throw new Error('No worker or broker permitted'); });
  let now = 10000;
  const bff = new ConnectionBff(join(bffRoot, 'bff.json'), transport, () => now, ingress, configured ? root : '');
  let cookie = '', csrf = '';
  const call = (operation = 'research-list', body: unknown = {}, overrides: Record<string, string> = {}, method = 'POST', suffix = '') => bff.handle(new Request(`http://127.0.0.1:3000/api/connection/${operation}${suffix}`, { method, headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-gelt-ingress': ingress, cookie, 'x-gelt-csrf': csrf, ...overrides }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }), operation);
  const login = async () => { const response = await call('bootstrap', { bootstrap }); cookie = response.headers.get('set-cookie')!.split(';')[0]; csrf = (await response.json()).csrf; };
  return { call, login, transport, root, import: () => importResearchFile(root, input), expire: () => { now += 3600001; } };
}
it('requires exact owner session and ingress/Host/Origin/CSRF without contacting worker', async () => {
  const f = fixture();
  expect((await f.call()).status).toBe(401); await f.login();
  for (const overrides of ([{ host: 'localhost:3000' }, { origin: 'https://evil.test' }, { 'x-gelt-ingress': '' }, { 'x-gelt-csrf': '' }, { forwarded: 'for=evil' }, { 'x-forwarded-host': 'evil' }, { cookie: '' }] as Record<string, string>[])) expect((await f.call('research-list', {}, overrides)).status).toBe(overrides.cookie === '' ? 401 : 403);
  expect((await f.call('research-list', {}, {}, 'GET')).status).toBe(405);
  expect((await f.call('research-list', {}, {}, 'POST', '?root=/tmp')).status).toBe(400);
  expect((await f.call('research-list', { root: '/tmp' })).status).toBe(409);
  expect((await f.call('research-detail', { evidenceId: '../../secret' })).status).toBe(409);
  expect((await f.call('research-run')).status).toBe(404);
  f.expire(); expect((await f.call()).status).toBe(401);
  expect(f.transport).not.toHaveBeenCalled();
});
it('reads empty, imported and persisted research without a broker account', async () => {
  const f = fixture(); await f.login();
  expect(await (await f.call()).json()).toMatchObject({ state: 'available', items: [] });
  const imported = f.import();
  const response = await f.call();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ version: 'v1', sessionExpiresAt: 3610000, state: 'available', items: [{ evidenceId: 'synthetic-reference-test', state: 'available' }] });
  const detail = await f.call('research-detail', { evidenceId: 'synthetic-reference-test' });
  expect(await detail.json()).toEqual({ version: 'v1', sessionExpiresAt: 3610000, state: 'available', record: imported.record });
  expect(f.transport).not.toHaveBeenCalled();
});
it('truthfully distinguishes missing/corrupt evidence and unavailable configuration', async () => {
  const f = fixture(); await f.login();
  expect(await (await f.call('research-detail', { evidenceId: 'absent' })).json()).toMatchObject({ state: 'missing' });
  f.import(); const path = join(f.root, 'evidence-synthetic-reference-test.json');
  const corrupt = JSON.parse(readFileSync(path, 'utf8')); corrupt.originalSha256 = '0'.repeat(64);
  replacePrivate(path, JSON.stringify(corrupt));
  expect(await (await f.call()).json()).toMatchObject({ state: 'available', items: [{ state: 'corrupt' }] });
  expect(await (await f.call('research-detail', { evidenceId: 'synthetic-reference-test' })).json()).toMatchObject({ state: 'corrupt' });
  const unconfigured = fixture(false); await unconfigured.login();
  expect(await (await unconfigured.call()).json()).toMatchObject({ state: 'unavailable' });
  expect(await (await unconfigured.call('research-detail', { evidenceId: 'absent' })).json()).toMatchObject({ state: 'unavailable' });
});

it('displays the exact real MCP reference artifact through protected reads, with no execution', async () => {
  const original = readFileSync(new URL('../../../research/paper2agent/artifacts/evidence.json', import.meta.url), 'utf8');
  expect(createHash('sha256').update(original).digest('hex')).toBe('c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96');
  const f = fixture(true, original); await f.login(); const imported = f.import();
  const detail = await f.call('research-detail', { evidenceId: imported.record.evidence.evidenceId });
  const value = await detail.json();
  expect(value.record.originalSha256).toBe('c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96');
  expect(value.record.evidence.results).toHaveLength(18);
  expect(value.record.geltChecks.numericComparison.status).toBe('passed');
  expect(value.record.geltChecks.scientificReproduction).toBe('not_run');
  expect(value.record.evidence.recommendation).toMatchObject({ decision: 'insufficient_evidence', promotionAllowed: false });
  expect(f.transport).not.toHaveBeenCalled();
});

it('decodes an actual BFF response after compact numeric artifact expansion', async () => {
  const evidence = researchFixture();
  evidence.inputs = Array.from({ length: 3 }, (_, i) => ({ name: `compact-${i}`, values: Array(4096).fill(1e20), units: 'test' }));
  const original = JSON.stringify(evidence).replaceAll('100000000000000000000', '1e20');
  expect(Buffer.byteLength(original)).toBeLessThanOrEqual(65536);
  const f = fixture(true, original); await f.login(); const imported = f.import();
  const response = await f.call('research-detail', { evidenceId: evidence.evidenceId });
  expect(response.status).toBe(200);
  expect(Buffer.byteLength(await response.clone().text())).toBeGreaterThan(262144);
  const read = new ResearchRequests().begin('research-detail', 'test-captured-token', evidence.evidenceId);
  const parsed = await requestResearch(read, vi.fn(async () => response), () => 10000);
  expect(parsed).toMatchObject({ state: 'available', record: imported.record });
  expect(f.transport).not.toHaveBeenCalled();
});
