import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { childEnvironment, launch, ready, root } from './runtime.mjs';

test('minimal environment does not propagate secrets or process options', () => {
  const original = { ...process.env };
  process.env.ANTHROPIC_API_KEY = 'test-only'; process.env.NODE_OPTIONS = '--invalid-test';
  process.env.TEMP = 'untrusted'; process.env.TMP = 'untrusted'; process.env.HTTPS_PROXY = 'untrusted'; process.env.PATH = 'untrusted';
  process.env.GELT_WINDOWS_PRIVATE_PARENT = 'C:\\';
  try {
    const env = childEnvironment();
    for (const name of ['ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'TEMP', 'TMP', 'HTTPS_PROXY', 'PATH']) assert.equal(env[name], undefined);
    assert.equal(env.GELT_WINDOWS_PRIVATE_PARENT, process.platform === 'win32' ? 'C:\\' : undefined);
  } finally { process.env = original; }
});
test('all processes are joined on child failure and repeated cleanup', async () => {
  const group = launch([['-e', 'process.exit(2)'], ['-e', 'setInterval(()=>{},1000)']]);
  await group.exited;
  assert.throws(() => group.assertAlive());
  await group.stop(); await group.stop();
  assert.ok(group.children.every(c => c.exited));
});
test('occupied loopback port fails rather than leaving sibling running', async () => {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  const group = launch([['-e', `require('net').createServer().listen(${port},'127.0.0.1')`], ['-e', 'setInterval(()=>{},1000)']]);
  try { await group.exited; assert.throws(() => group.assertAlive()); }
  finally { await group.stop(); await new Promise(resolve => listener.close(resolve)); }
  assert.ok(group.children.every(c => c.exited));
});
test('offline guard blocks external TCP, fetch and DNS before traffic', () => {
  for (const code of ["require('net').connect(443,'example.com')", "fetch('https://example.com')", "require('dns').lookup('example.com',()=>{})"]) {
    const result = spawnSync(process.execPath, ['--import', './scripts/offline-guard.mjs', '-e', code], { cwd: root, env: childEnvironment(), encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 78, result.stderr); assert.match(result.stderr, /OFFLINE_EGRESS_DENIED/);
  }
});
test('readiness timeout is bounded and cleanup joins children', async () => {
  const { ready } = await import('./runtime.mjs');
  const group = launch([['-e', 'setInterval(()=>{},1000)']]);
  try { await assert.rejects(ready(group, 1), /readiness timeout/); }
  finally { await group.stop(); }
  assert.ok(group.children.every(c => c.exited));
});
test('readiness refuses stale baseline page and accepts the current safety banner', async () => {
  const originalFetch = globalThis.fetch;
  let home = 'Offline baseline';
  const group = { assertAlive() {} };
  globalThis.fetch = async url => new Response(url.endsWith(':4000/v1/health') ? 'market-analysis'
    : url.endsWith(':4100/v1/health') ? 'execution-worker' : home);
  try {
    await assert.rejects(ready(group, 250), /readiness timeout/);
    home = 'GELT WORKSPACE — SAFETY GATE';
    await ready(group, 1000);
  } finally { globalThis.fetch = originalFetch; }
});
test('official configuration is worker-only; market never receives service or broker setup', () => {
  process.env.GELT_MODE = 'official-worker'; process.env.GELT_WORKER_CONFIG = '/fixture/worker'; process.env.GELT_BFF_CONFIG = '/fixture/bff';
  try {
    assert.equal(childEnvironment('worker').GELT_WORKER_CONFIG, '/fixture/worker'); assert.equal(childEnvironment('worker').GELT_BFF_CONFIG, undefined);
    assert.equal(childEnvironment('web').GELT_BFF_CONFIG, '/fixture/bff'); assert.equal(childEnvironment('web').GELT_WORKER_CONFIG, undefined);
    assert.equal(childEnvironment().GELT_WORKER_CONFIG, undefined); assert.equal(childEnvironment().GELT_BFF_CONFIG, undefined);
  } finally { delete process.env.GELT_MODE; delete process.env.GELT_WORKER_CONFIG; delete process.env.GELT_BFF_CONFIG; }
});
test('official worker guard still denies arbitrary TLS/TCP/DNS and raw official TCP', () => {
  for (const code of ["fetch('https://example.com')", "require('net').connect(443,'agent.robinhood.com')", "require('dns').lookup('evil.test',()=>{})", "require('tls').connect({host:'agent.robinhood.com',port:443,servername:'evil.test'})", "require('tls').connect({host:'agent.robinhood.com',port:443,servername:'agent.robinhood.com',rejectUnauthorized:false})"]) {
    const result = spawnSync(process.execPath, ['--import', './scripts/official-worker-guard.mjs', '-e', code], { cwd: root, env: childEnvironment(), encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 78, result.stderr); assert.match(result.stderr, /WORKER_EGRESS_DENIED/);
  }
});
test('official guard admits pinned TLS shape to an offline DNS sink, not real broker traffic', () => {
  const code = `
    const dns = await import('node:dns');
    dns.default.lookup = (host, options, callback) => { const cb = typeof options === 'function' ? options : callback; cb(null, [{address:'127.0.0.1',family:4}]); };
    await import('./scripts/official-worker-guard.mjs');
    // Closed loopback port: only tests the allowed guard path, never official DNS/traffic.
    try { await fetch('https://agent.robinhood.com/mcp/trading', {signal:AbortSignal.timeout(1000)}); } catch { process.exit(0); }
    process.exit(1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: childEnvironment(), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(result.stderr, /WORKER_EGRESS_DENIED/);
});

test('explicit research root reaches only the protected web role in configured mode', () => {
  const original = { ...process.env };
  try {
    process.env.GELT_RESEARCH_ROOT = '/fixture/private-research';
    delete process.env.GELT_MODE;
    assert.equal(childEnvironment('web').GELT_RESEARCH_ROOT, undefined);
    process.env.GELT_MODE = 'official-worker';
    assert.equal(childEnvironment('web').GELT_RESEARCH_ROOT, '/fixture/private-research');
    assert.equal(childEnvironment('worker').GELT_RESEARCH_ROOT, undefined);
    assert.equal(childEnvironment().GELT_RESEARCH_ROOT, undefined);
  } finally { process.env = original; }
});
