import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer, connect } from 'node:net';
import { readPrivate } from '../worker/dist/private-files.js';
import { storageFixture } from '../worker/dist/storage-fixture.js';
import { launch, ready, root, childEnvironment } from './runtime.mjs';
import { capabilitiesSchema, healthSchema } from '../worker/dist/contract.js';
import { verifyAgentDataCommands } from './agent-data-conformance.mjs';
verifyAgentDataCommands();
let group = launch();
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true; process.exitCode = 1; void group.stop(); });
const timer = setTimeout(() => { console.error('Smoke deadline exceeded'); process.exitCode = 1; void group.stop(); }, process.platform === 'win32' ? 300000 : 60000);
async function get(port, path, options = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, { ...options, signal: AbortSignal.timeout(process.platform === 'win32' ? 60000 : 2000) });
}
try {
  await ready(group);
  healthSchema.parse(await (await get(4100, '/v1/health')).json());
  capabilitiesSchema.parse(await (await get(4100, '/v1/capabilities')).json());
  assert.equal((await get(4100, '/v1/orders', { method: 'POST' })).status, 405);
  assert.equal((await get(4100, '/v1/health', { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await get(4000, '/api/quote/AAPL')).status, 503);
  assert.equal((await get(4000, '/api/portfolios', { method: 'POST' })).status, 405);
  assert.equal((await get(3000, '/api/anything', { method: 'POST' })).status, 503);
  group.assertAlive();
  if (interrupted) throw new Error('Smoke interrupted');
  await group.stop();
  async function assertPortsClosed(ports) {
    for (const port of ports) {
      await new Promise((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('Port probe timeout')); });
        socket.on('connect', () => { socket.destroy(); reject(new Error(`Service left on ${port}`)); });
        socket.on('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
      });
    }
  }
  await assertPortsClosed([3000, 4000, 4100]);
  // Real supervisor interruption must join its services, not just itself.
  group = launch([['scripts/start.mjs']]);
  await ready(group);
  await group.stop();
  await assertPortsClosed([3000, 4000, 4100]);
  // Losing a supervisor's parent channel also cooperatively joins grandchildren.
  group = launch([['scripts/start.mjs']]);
  await ready(group); group.children[0].child.disconnect();
  await group.exited; assert.equal(group.children[0].result, '0/null');
  await assertPortsClosed([3000, 4000, 4100]);
  // Occupied API port must fail startup and clean up web/worker siblings.
  const blocker = createServer(socket => socket.destroy());
  await new Promise(resolve => blocker.listen(4000, '127.0.0.1', resolve));
  try {
    group = launch([['scripts/start.mjs']]);
    await group.exited;
    assert.equal(group.children[0].result, '1/null');
    await group.stop();
    await assertPortsClosed([3000, 4100]);
  } finally { await new Promise(resolve => blocker.close(resolve)); }
  // Built Next + actual private worker, synthetic owner setup, NO provider requests.
  const temp = storageFixture('gelt-smoke-');
  const dirs = ['registration', 'key', 'worker', 'bff', 'owner', 'ledger'].map(name => join(temp, name));
  const [registrationDir, , workerDir, bffDir, ownerDir] = dirs;
  const registration = { clientId: 'offline-fixture-not-a-registration', redirectUri: 'http://127.0.0.1:3000/api/connection/callback', issuer: 'https://agent.robinhood.com/mcp/trading', authorizationEndpoint: 'https://robinhood.com/oauth', tokenEndpoint: 'https://api.robinhood.com/oauth2/token/', scope: 'internal', tokenEndpointAuthMethod: 'none', pkce: 'S256' };
  try {
    for (const [script, args, input] of [['prepare', dirs, JSON.stringify(registration)], ['provision', [join(registrationDir, 'registration.json'), ...dirs.slice(1)], '']]) {
      const result = spawnSync(process.execPath, ['--import', new URL('offline-guard.mjs', import.meta.url).href, `worker/dist/${script}.js`, ...args], {
        cwd: root, env: childEnvironment(), input, encoding: 'utf8', timeout: 120000, maxBuffer: 8192, windowsHide: true,
      });
      assert.equal(result.status, 0, 'synthetic private provisioning failed');
    }
  } catch (error) { rmSync(temp, { recursive: true, force: true }); throw error; }
  process.env.GELT_MODE = 'official-worker'; process.env.GELT_WORKER_CONFIG = join(workerDir, 'worker.json'); process.env.GELT_BFF_CONFIG = join(bffDir, 'bff.json');
  try {
    const bootstrap = readPrivate(join(ownerDir, 'bootstrap.txt')).toString('utf8');
    group = launch(); await ready(group, process.platform === 'win32' ? 120000 : 20000);
    assert.equal((await (await get(4100, '/v1/capabilities')).json()).ledger, true);
    assert.equal((await get(4100, '/v1/ledger', { method: 'POST' })).status, 405);
    let cookie = '', csrf = '';
    const call = (operation, body = {}, overrides = {}) => get(3000, `/api/connection/${operation}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', Cookie: cookie, 'X-Gelt-CSRF': csrf, ...overrides }, body: JSON.stringify(body) });
    { const response = await call('status'); assert.equal(response.status, 401, await response.text()); }
    assert.equal((await call('bootstrap', { bootstrap }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await call('bootstrap', { bootstrap }, { 'X-Forwarded-Host': '127.0.0.1:3000' })).status, 403);
    // Use node:http for hostile Host: Node fetch normalizes that header.
    assert.equal(await new Promise((resolve, reject) => { const req = request({ host: '127.0.0.1', port: 3000, path: '/api/connection/status', method: 'POST', headers: { Host: 'evil.test' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); }), 403);
    const login = await call('bootstrap', { bootstrap }); assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
    assert.equal((await call('bootstrap', { bootstrap })).status, 409);
    assert.equal((await call('status', {}, { 'X-Gelt-CSRF': '' })).status, 403);
    const status = await call('status'); assert.equal(status.status, 200); assert.equal((await status.json()).state, 'disconnected');
    const started = await call('initiate'); assert.equal(started.status, 200); assert.equal(new URL((await started.json()).authorizationUrl).origin, 'https://robinhood.com');
    assert.equal((await (await call('status')).json()).state, 'authorizing');
    assert.equal((await call('tools', { name: 'place_order' })).status, 404);
    assert.equal((await call('disconnect')).status, 200); { const response = await call('status'); assert.equal(response.status, 401, await response.text()); }
    group.assertAlive();
    await group.stop();
    assert.throws(() => readPrivate(join(dirs[5], 'execution.sqlite.lock')), error => error.code === 'ENOENT');
    const lock = join(workerDir, 'credentials.vault.lock');
    assert.throws(() => readPrivate(lock), error => error.code === 'ENOENT');
    // Real abrupt worker termination leaves ownership evidence; restart refuses it.
    group = launch(); await ready(group, process.platform === 'win32' ? 120000 : 20000);
    group.children[1].child.kill('SIGKILL'); await group.children[1].done; await group.stop();
    assert.equal(readPrivate(lock).toString(), 'owned');
    assert.match(readPrivate(join(dirs[5], 'execution.sqlite.lock')).toString(), /^[a-f0-9-]{36}$/);
    group = launch(); await group.exited; await group.stop();
    assert.equal(group.children[1].result, '1/null');
  } finally {
    try { await group.stop(); }
    finally { delete process.env.GELT_MODE; delete process.env.GELT_WORKER_CONFIG; delete process.env.GELT_BFF_CONFIG; rmSync(temp, { recursive: true, force: true }); }
  }
  await assertPortsClosed([3000, 4000, 4100]);
  console.log('PASS protected owner bootstrap/BFF/private worker without provider calls');
  console.log('PASS offline built services, disabled boundaries, interruption and occupied-port cleanup');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(timer); await group.stop(); }
assert.ok(group.children.every(c => c.exited), 'all direct service processes joined');
