// Offline integration: real built Next -> existing ingress/owner BFF -> core store.
// This is HTTP read-path evidence, NOT browser/visual acceptance or scientific execution.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { root, childEnvironment } from './runtime.mjs';
import { storageFixture } from '../worker/dist/storage-fixture.js';
import { writePrivateNew, replacePrivate } from '../worker/dist/private-files.js';
import { readResearch } from '../worker/dist/research-store.js';
if (process.argv.length !== 3 || process.argv[2] !== '--offline-test-only' || process.env.NODE_ENV !== 'test' || process.env.GELT_OFFLINE_RESEARCH !== 'fixture-only') throw Error('Explicit offline research test gates required');
const dirs = [];
const dir = () => { const path = storageFixture('gelt-research-http-'); dirs.push(path); return path; };
let web, output = '', cookie = '', csrf = '';
async function stop() {
  if (!web || web.exitCode !== null || web.signalCode !== null) return;
  const current = web;
  if (current.connected) current.send({ type: 'gelt:shutdown' }); else current.kill('SIGTERM');
  await Promise.race([new Promise(resolve => current.once('exit', resolve)), delay(3000)]);
  if (current.exitCode === null && current.signalCode === null) throw Error('Owned web did not stop; refusing restart');
}
async function portFree() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen({ host: '127.0.0.1', port: 3000, exclusive: true }, resolve); });
  await new Promise(resolve => probe.close(resolve));
}
async function start(bff, research) {
  await portFree();
  web = spawn(process.execPath, ['--import', './scripts/offline-guard.mjs', 'scripts/web.mjs'], { cwd: root, env: { ...childEnvironment(), GELT_BFF_CONFIG: bff, GELT_RESEARCH_ROOT: research }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  web.stdout.on('data', x => { output = (output + x).slice(-8000); }); web.stderr.on('data', x => { output = (output + x).slice(-8000); });
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (web.exitCode !== null) throw Error(`Owned web exited: ${output}`);
    try { const r = await fetch('http://127.0.0.1:3000/research', { signal: AbortSignal.timeout(1000) }); if (r.ok && (await r.text()).includes('Research evidence')) return; } catch {}
    await delay(100);
  }
  throw Error(`Owned web readiness failed: ${output}`);
}
async function call(operation, body = {}, headers = {}) {
  return fetch(`http://127.0.0.1:3000/api/connection/${operation}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', Cookie: cookie, 'X-Gelt-CSRF': csrf, ...headers }, body: JSON.stringify(body) });
}
try {
  const bffRoot = dir(), research = dir(), sourceRoot = dir();
  const operator = args => {
    const result = spawnSync(process.execPath, ['worker/dist/research-operator.js', ...args], { cwd: root, env: childEnvironment(), encoding: 'utf8', timeout: 120000, maxBuffer: 65536 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, 'built local research operator must succeed');
    return result.stdout.trim();
  };
  operator(['provision', research, bffRoot, dir(), dir(), dir(), dir()]);
  const original = readFileSync(new URL('../../research/paper2agent/artifacts/evidence.json', import.meta.url));
  assert.equal(createHash('sha256').update(original).digest('hex'), 'c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96');
  const source = join(sourceRoot, 'evidence.json'); writePrivateNew(source, original.toString('utf8'));
  const receipt = JSON.parse(operator(['import', research, source]));
  assert.equal(receipt.status, 'imported');
  const evidenceId = receipt.evidenceId, imported = readResearch(research, evidenceId);
  assert.equal(imported.state, 'available');
  assert.equal(receipt.originalSha256, imported.record.originalSha256);
  assert.equal(JSON.parse(operator(['import', research, source])).status, 'identical');
  console.log('PASS actual built local operator provision/import/digest-idempotency; exact original bytes retained');
  const bff = join(bffRoot, 'bff.json'); writePrivateNew(bff, JSON.stringify({ serviceSecret: randomBytes(32).toString('base64url') }));
  async function login() {
    const bootstrap = randomBytes(32).toString('base64url');
    replacePrivate(join(bffRoot, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: Date.now() + 30000 }));
    const response = await call('bootstrap', { bootstrap }); assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0]; csrf = (await response.json()).csrf;
  }
  await start(bff, research);
  assert.equal((await call('research-list')).status, 401);
  await login();
  for (const headers of [{ Origin: 'https://invalid.test' }, { 'X-Gelt-CSRF': 'invalid' }, { 'X-Gelt-Ingress': 'invalid' }, { 'X-Forwarded-Host': 'evil' }]) assert.equal((await call('research-list', {}, headers)).status, 403);
  assert.equal((await call('research-run')).status, 404);
  assert.equal((await call('research-detail', { evidenceId: '../secret' })).status, 409);
  const list = await (await call('research-list')).json(); assert.deepEqual(list.items, [{ evidenceId, state: 'available' }]);
  const detail = await (await call('research-detail', { evidenceId })).json(); assert.deepEqual(detail.record, imported.record);
  assert.equal(detail.record.evidence.results.length, 18); assert.equal(detail.record.geltChecks.scientificReproduction, 'not_run');
  console.log('PASS real Next protected list/detail, real MCP artifact, denial controls; no worker/broker process');
  await stop(); await start(bff, research);
  assert.equal((await call('research-list')).status, 401); await login();
  assert.deepEqual((await (await call('research-detail', { evidenceId })).json()).record, imported.record);
  console.log('PASS restart retains immutable evidence and rejects old owner session');
  const path = join(research, `evidence-${evidenceId}.json`), corrupt = JSON.parse(readFileSync(path, 'utf8')); corrupt.originalSha256 = '0'.repeat(64); replacePrivate(path, JSON.stringify(corrupt));
  assert.equal((await (await call('research-detail', { evidenceId })).json()).state, 'corrupt');
  assert.deepEqual((await (await call('research-list')).json()).items, [{ evidenceId, state: 'corrupt' }]);
  assert.equal((await (await call('research-detail', { evidenceId: 'missing' })).json()).state, 'missing');
  console.log('PASS tamper re-read fails closed; missing artifact is truthful');
  console.log('HTTP smoke complete. Browser rendering, interactions and visual acceptance remain separate gates.');
} finally { await stop(); dirs.reverse().forEach(path => rmSync(path, { recursive: true, force: true })); }
