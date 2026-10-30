// Explicit, offline test-only running Next/Edge acceptance. Never loaded by start.mjs.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { request } from 'node:http';
import { createWorker } from '../worker/dist/service.js';
import { offlinePiHandoff } from '../worker/dist/pi-handoff.js';
import { storageFixture } from '../worker/dist/storage-fixture.js';
import { writePrivateNew } from '../worker/dist/private-files.js';

if (process.argv.length !== 3 || process.argv[2] !== '--offline-test-only' || process.env.NODE_ENV !== 'test' || process.env.GELT_OFFLINE_PI_HANDOFF !== 'fixture-only')
  throw Error('Requires NODE_ENV=test GELT_OFFLINE_PI_HANDOFF=fixture-only and --offline-test-only');
const edge = process.env.GELT_TEST_EDGE_PATH ?? (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : '/usr/bin/microsoft-edge');
if (!existsSync(edge)) throw Error('Local Edge executable unavailable; no browser evidence');
const deadline = Date.now() + 115000;
let phase = 'startup';
const check = () => { if (Date.now() > deadline) throw Error('running Next acceptance deadline exceeded'); };
const wait = async (fn, label) => { while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch { /* readiness retry */ } await delay(180); } throw Error(`${label}: deadline exceeded`); };
const portFree = async port => { try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(900) }); } catch (e) { if (e.cause?.code === 'ECONNREFUSED') return; } throw Error(`port ${port} not free; refusing existing process ownership`); };
await portFree(3000); await portFree(4100);
let root, web, browser, worker, cdp, bffDir, profile;
const stopWorker = async () => { if (!worker) return; const current = worker; worker = null; current.closeAllConnections(); await new Promise(resolve => current.close(resolve)); };
const startWorker = async handoff => { worker = createWorker(undefined, secret, undefined, undefined, undefined, handoff); await new Promise((resolve, reject) => { worker.once('error', reject); worker.listen(4100, '127.0.0.1', resolve); }); };
const secret = randomBytes(32).toString('base64url'), bootstrap = randomBytes(32).toString('base64url');
async function raw(path, headers = {}, body = '{}') {
  check();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const req = request({ host: '127.0.0.1', port: 3000, path, method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, res => {
      let output = '';
      res.on('data', chunk => { output += chunk; if (output.length > 8192) req.destroy(Error('raw response too large')); });
      res.on('end', () => finish(null, { status: res.statusCode, body: output }));
      res.on('error', error => finish(error));
      res.on('aborted', () => finish(Error('raw response aborted')));
    });
    const timer = setTimeout(() => { const error = Error(`raw ${path} timed out during ${phase}`); finish(error); req.destroy(error); }, Math.min(12000, Math.max(1, deadline - Date.now())));
    req.on('error', error => finish(error));
    req.end(body);
  });
}
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}
const query = async expression => evaluate(`(() => ${expression})()`);
const click = async label => { const result = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return { clicked:false, disabled:b?.disabled, csrf:document.querySelector('input[aria-label="Restore CSRF"]')?.value, state:document.readyState }; b.click(); return {clicked:true}; })()`); assert.equal(result.clicked, true, `button unavailable: ${label} ${JSON.stringify(result)}`); };
const visible = async text => query(`document.body.innerText.includes(${JSON.stringify(text)})`);
const assertOrderControlsDisabled = async () => assert.deepEqual(await query(`[...document.querySelectorAll('button')].filter(b => /^(Request fresh exact preview|Confirm exact terms|Request cancel)/.test(b.textContent.trim())).map(b => ({ label: b.textContent.trim(), disabled: b.disabled }))`), [
  { label: 'Request fresh exact preview — unavailable', disabled: true },
  { label: 'Confirm exact terms — unavailable', disabled: true },
  { label: 'Request cancel — unavailable', disabled: true },
]);
const visibleDraft = text => {
  const terms = text.match(/(synthetic-pi-account-[a-z]+) \/ (RHS|RHC) \/ ([A-Za-z0-9-]+) \/ BUY LIMIT ([0-9.]+) at ([0-9.]+) USD \/ revision (\d+)/);
  assert.ok(terms, 'complete fixture draft must be visible');
  return { account: terms[1], route: terms[2], instrument: terms[3], side: 'BUY', type: 'LIMIT', quantity: terms[4], limitPrice: terms[5], revision: Number(terms[6]) };
};
async function browserPage(port) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const page = pages.find(p => p.type === 'page'); assert.ok(page?.webSocketDebuggerUrl);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('CDP connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('CDP connection failed')); }, { once: true });
    socket.addEventListener('close', () => { clearTimeout(timer); reject(Error('CDP connection closed')); }, { once: true });
  });
  let id = 0; const pending = new Map();
  const rejectPending = error => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  socket.addEventListener('close', () => rejectPending(Error('CDP socket closed')));
  socket.addEventListener('error', () => rejectPending(Error('CDP socket error')));
  socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (!msg.id) return; const entry = pending.get(msg.id); if (!entry) return; pending.delete(msg.id); msg.error ? entry.reject(Error(msg.error.message)) : entry.resolve(msg.result); });
  return {
    send(method, params = {}) {
      check();
      return new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP ${method} timed out during ${phase}`)); }, Math.min(12000, Math.max(1, deadline - Date.now())));
        pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        try { socket.send(JSON.stringify({ id: key, method, params })); }
        catch (error) { pending.delete(key); clearTimeout(timer); reject(error); }
      });
    },
    close() {
      rejectPending(Error('CDP socket closing'));
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 1500);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        if (socket.readyState === WebSocket.OPEN) socket.close();
      });
    },
  };
}
try {
  root = storageFixture('gelt-next-pi-'); bffDir = join(root, 'bff');
  // Only the fixture owner creates private files. No production worker setup/index injection.
  const { createPrivateDirectory } = await import('../worker/dist/private-files.js');
  createPrivateDirectory(bffDir);
  writePrivateNew(join(bffDir, 'bff.json'), JSON.stringify({ serviceSecret: secret }));
  writePrivateNew(join(bffDir, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: Date.now() + 90000 }));
  await startWorker();
  web = spawn(process.execPath, ['scripts/web.mjs'], { cwd: new URL('../', import.meta.url), env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, GELT_WINDOWS_PRIVATE_PARENT: process.env.GELT_WINDOWS_PRIVATE_PARENT, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', GELT_BFF_CONFIG: join(bffDir, 'bff.json') }, stdio: 'ignore', windowsHide: true });
  web.on('error', () => {});
  await wait(async () => (await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(2000) })).ok, 'Next readiness');
  assert.equal((await raw('/api/connection/pi-status')).status, 401, 'no browser session');
  assert.equal((await raw('/api/connection/bootstrap', { Origin: 'http://evil.test' }, JSON.stringify({ bootstrap }))).status, 403);
  profile = mkdtempSync(join(tmpdir(), 'gelt-next-edge-profile-'));
  browser = spawn(edge, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  browser.on('error', () => {});
  const debugPort = await wait(() => { const path = join(profile, 'DevToolsActivePort'); return existsSync(path) && Number(readFileSync(path, 'utf8').split('\n')[0]); }, 'Edge CDP readiness');
  cdp = await browserPage(debugPort);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  phase = 'home hydration';
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/orders' });
  await wait(() => visible('Offline Pi handoff — fixture review, not authorization'), 'hydrated home');
  assert.equal(await visible('Fixture state: disabled / unavailable'), true);
  assert.equal(await query(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Prepare synthetic handoff')`), false);
  phase = 'bootstrap';
  const login = await evaluate(`fetch('/api/connection/bootstrap', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bootstrap:${JSON.stringify(bootstrap)}})}).then(async r => ({status:r.status,value:await r.json()}))`);
  assert.equal(login.status, 200);
  await evaluate(`sessionStorage.setItem('gelt-csrf', ${JSON.stringify(login.value.csrf)})`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await wait(() => query(`document.querySelector('input[aria-label="Restore CSRF"]')?.value === ${JSON.stringify(login.value.csrf)}`), 'CSRF restored');
  await click('Read protected status');
  await wait(() => visible('Protected M3 status loaded.'), 'default-disabled protected status');
  assert.equal(await visible('Fixture state: disabled / unavailable'), true);
  assert.equal(await query(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Prepare synthetic handoff')`), false);
  assert.equal(await evaluate(`fetch('/api/connection/pi-prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')},body:'{}'}).then(r=>r.status)`), 409);
  phase = 'injected worker';
  const initialHandoff = offlinePiHandoff();
  let preparedDraft;
  await stopWorker(); await startWorker({ ...initialHandoff, prepare(session, input) {
    const value = initialHandoff.prepare(session, input);
    preparedDraft = value.draft; // test-only in-memory observation, never logged
    return value;
  } });
  await click('Read protected status');
  await wait(() => visible('Fixture state: explicit test-only injection enabled'), 'injected protected status');
  assert.equal(await visible('Worker confirms the production order adapter is unsupported'), true);
  await click('Prepare synthetic handoff');
  await wait(() => visible('SYNTHETIC OFFLINE FIXTURE / NOT BROKER DATA. ID'), 'browser prepare');
  phase = 'edit invalidation';
  const old = await query(`document.querySelector('[aria-label="Synthetic handoff review"]')?.innerText`);
  assert.match(old, /Authority: false/);
  assert.match(old, /BUY LIMIT 0\.0001 at 50000\.00 USD \/ revision 0/);
  const oldId = old.match(/ID ([a-f0-9]{32})/)?.[1], oldDigest = old.match(/canonical digest ([a-f0-9]{64})/)?.[1];
  assert.ok(oldId && oldDigest);
  await evaluate(`(() => {
    const originalFetch = window.fetch;
    window.__piInvalidation = new Promise(resolve => {
      window.fetch = (...args) => {
        const response = originalFetch(...args);
        if (String(args[0]).endsWith('/api/connection/pi-invalidate')) {
          window.fetch = originalFetch;
          response.then(r => resolve(r.status), () => resolve(0));
        }
        return response;
      };
    });
    const el=document.querySelector('input[aria-label="Exact quantity"]');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(el,'0.0002'); el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await wait(() => query(`!document.querySelector('[aria-label="Synthetic handoff review"]')`), 'edit invalidation');
  assert.equal(await evaluate(`window.__piInvalidation`), 200, 'edit reached the worker invalidation endpoint');
  const oldReview = await evaluate(`fetch('/api/connection/pi-review',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')},body:JSON.stringify(${JSON.stringify({ id: oldId, digest: oldDigest, draft: { account: 'synthetic-pi-account-a', route: 'RHS', instrument: 'BTC-USD', side: 'BUY', type: 'LIMIT', quantity: '0.0001', limitPrice: '50000.00', revision: 0 } })})}).then(r=>r.status)`);
  assert.equal(oldReview, 409, 'old prepared record must be rejected under the valid session before re-prepare');
  const denied = await raw('/api/connection/pi-review', { Cookie: `__Host-gelt=${'wrong'}`, 'X-Gelt-CSRF': login.value.csrf }, JSON.stringify({})); assert.equal(denied.status, 401);
  const csrfDenied = await evaluate(`fetch('/api/connection/pi-prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':'wrong'},body:'{}'}).then(r=>r.status)`); assert.equal(csrfDenied, 403);
  assert.equal((await raw('/api/connection/pi-prepare', { Host: 'evil.test' })).status, 403);
  assert.equal((await raw('/api/connection/pi-prepare', { 'X-Forwarded-Host': 'evil.test' })).status, 403);
  assert.equal(await evaluate(`fetch('/api/connection/confirm',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')},body:'{}'}).then(r=>r.status)`), 404);
  phase = 'fresh review';
  await click('Prepare synthetic handoff');
  await wait(() => visible('SYNTHETIC OFFLINE FIXTURE / NOT BROKER DATA. ID'), 'fresh prepare');
  await click('Review fixture terms (no submission)');
  await wait(() => visible('Reviewed synthetic fixture terms only.'), 'browser review');
  assert.equal(await visible('No Pi session, broker approval or order submission.'), true);
  await assertOrderControlsDisabled();
  phase = 'worker restart with visible fixture';
  const beforeRestart = await query(`document.querySelector('[aria-label="Synthetic handoff review"]')?.innerText`);
  const staleId = beforeRestart.match(/ID ([a-f0-9]{32})/)?.[1], staleDigest = beforeRestart.match(/canonical digest ([a-f0-9]{64})/)?.[1];
  assert.ok(staleId && staleDigest);
  const staleDraft = visibleDraft(beforeRestart);
  assert.deepEqual(staleDraft, preparedDraft, 'visible draft exactly matches the first worker prepared record');
  const restartedHandoff = offlinePiHandoff();
  let restartedReviewCalls = 0, restartedReviewRejections = 0;
  await stopWorker(); await startWorker({ ...restartedHandoff, review(session, input) {
    restartedReviewCalls++;
    try { return restartedHandoff.review(session, input); }
    catch (error) { restartedReviewRejections++; throw error; }
  } });
  assert.equal(await query(`document.querySelector('[aria-label="Synthetic handoff review"]')?.innerText.includes(${JSON.stringify(staleId)})`), true, 'fixture still visible before stale review');
  const staleReview = await evaluate(`fetch('/api/connection/pi-review',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')},body:JSON.stringify(${JSON.stringify({ id: staleId, digest: staleDigest, draft: staleDraft })})}).then(r=>r.status)`);
  assert.equal(staleReview, 409, 'restart loses the pending fixture even under the valid owner session');
  assert.equal(restartedReviewCalls, 1, 'the restarted worker received the stale review');
  assert.equal(restartedReviewRejections, 1, 'the restarted handoff rejected that review');
  await click('Review fixture terms (no submission)');
  await wait(() => visible('Fixture review expired or unavailable. Nothing submitted.'), 'restart failure displayed');
  assert.equal(await query(`!document.querySelector('[aria-label="Synthetic handoff review"]')`), true, 'failed review clears visible fixture');
  await assertOrderControlsDisabled();
  const closedSurface = await evaluate(`fetch('/api/connection/order-status',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')},body:'{}'}).then(async r=>({status:r.status,value:await r.json()}))`);
  assert.equal(closedSurface.status, 200);
  assert.deepEqual(closedSurface.value, { version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, reconciliation: false, reason: 'production_adapter_unsupported' });
  phase = 'restart recovery';
  await click('Prepare synthetic handoff');
  await wait(() => visible('SYNTHETIC OFFLINE FIXTURE / NOT BROKER DATA. ID'), 'prepare after restart');
  const recovered = await query(`document.querySelector('[aria-label="Synthetic handoff review"]')?.innerText`);
  assert.deepEqual(visibleDraft(recovered), staleDraft, 'recovery must retain the complete draft including account, route and instrument');
  assert.notEqual(recovered.match(/ID ([a-f0-9]{32})/)?.[1], staleId, 'recovery must prepare a new record');
  await click('Review fixture terms (no submission)');
  await wait(() => visible('Reviewed synthetic fixture terms only.'), 'review after restart');
  await assertOrderControlsDisabled();
  const prepared = await query(`document.querySelector('[aria-label="Synthetic handoff review"]')?.innerText`);
  const id = prepared.match(/ID ([a-f0-9]{32})/)?.[1], digest = prepared.match(/canonical digest ([a-f0-9]{64})/)?.[1];
  assert.ok(id && digest);
  phase = 'fixture expiry';
  await delay(31000); check();
  await wait(() => query(`!document.querySelector('[aria-label="Synthetic handoff review"]')`), '30-second fixture expiry');
  assert.equal(await visible('Confirm exact terms — unavailable'), true);
  const expiredReview = await evaluate(`fetch('/api/connection/pi-review',{method:'POST',headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')},body:JSON.stringify(${JSON.stringify({ id, digest, draft: { account: 'synthetic-pi-account-a', route: 'RHS', instrument: 'BTC-USD', side: 'BUY', type: 'LIMIT', quantity: '0.0002', limitPrice: '50000.00', revision: 1 } })})}).then(r=>r.status)`);
  assert.equal(expiredReview, 409);
  console.log('PASS running Edge protected-status page → raw-gated Next named BFF → private injected worker: disabled/status/prepare/edit/review/restart stale rejection + recovery/expiry/security; execution false');
} catch (error) {
  console.error('Running Next acceptance failed:', error);
  process.exitCode = 1;
} finally {
  if (cdp) {
    try { await cdp.send('Browser.close'); } catch { /* browser may already have exited */ }
    await cdp.close();
  }
  for (const child of [browser, web]) if (child?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else child.kill('SIGTERM');
  }
  await delay(700);
  await stopWorker();
  for (const path of [root, profile]) if (path) try { rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); } catch (error) { console.error('Fixture cleanup failed:', path, error); process.exitCode = 1; }
  try { await portFree(3000); await portFree(4100); } catch (error) { console.error('Test listener cleanup failed:', error); process.exitCode = 1; }
}
