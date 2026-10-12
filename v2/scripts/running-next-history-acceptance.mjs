// Explicit SYNTHETIC/OFFLINE acceptance only. Never imported by start.mjs.
// This runs the real Next page -> named BFF -> private createWorker -> real SQLite
// Ledger. The browser gate only delays actual HTTP responses; it never makes up
// history, status codes, or provider results. No production adapter is enabled.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createProbe } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { appendBoundedText, createBoundedTextBuffer, discoverBrowserPage, formatStartupFailure, readBoundedText } from './history-startup-diagnostics.mjs';

const preflightStartedAt = Date.now();
const preflightDeadline = preflightStartedAt + 180000;
const invalidInvocation = process.argv.length !== 3 || process.argv[2] !== '--offline-test-only' || process.env.NODE_ENV !== 'test' || process.env.GELT_OFFLINE_HISTORY !== 'fixture-only';
const browserPath = process.env.GELT_TEST_BROWSER_PATH ?? process.env.GELT_TEST_EDGE_PATH ?? (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : '/usr/bin/chromium');
const preflightFailure = invalidInvocation ? { reason: 'invalid-invocation', error: Error('Requires NODE_ENV=test GELT_OFFLINE_HISTORY=fixture-only and --offline-test-only') }
  : !existsSync(browserPath) ? { reason: 'browser-unavailable', error: Error('Local Chromium/Edge executable unavailable; running browser evidence is blocked') }
    : process.getuid?.() === 0 ? { reason: 'non-root-user-required', error: Error('Run this browser acceptance as a non-root user with the browser security sandbox enabled') } : null;
if (preflightFailure) {
  console.error(formatStartupFailure({ error: preflightFailure.error, reason: preflightFailure.reason, phase: 'preflight', startedAt: preflightStartedAt, now: Date.now(), deadlineAt: preflightDeadline }));
  process.exitCode = 1;
} else {
const appDir = fileURLToPath(new URL('../', import.meta.url));
const screenshotDir = process.env.GELT_HISTORY_SCREENSHOTS ? resolve(process.env.GELT_HISTORY_SCREENSHOTS) : null;
const startedAt = Date.now();
const deadline = startedAt + 180000;
let phase = 'startup', root, profile, web, browser, worker, ledger, connection, cdp;
let ledgerAvailable = true;
const webStderr = createBoundedTextBuffer(), browserStderr = createBoundedTextBuffer();
let webSpawnError = null, browserSpawnError = null;
const diagnosticSecrets = new Set();
let lastStartupRequest = null;
const completed = [];
function noteStartupRequest(label, outcome, status, error) {
  const attempts = lastStartupRequest?.label === label ? lastStartupRequest.attempts + 1 : 1;
  lastStartupRequest = { label, outcome, status, attempts, error };
}
async function startupFetch(label, url, options) {
  try {
    const response = await fetch(url, options);
    noteStartupRequest(label, response.ok ? 'http-ok' : 'http-error', response.status);
    return response;
  } catch (error) {
    noteStartupRequest(label, 'network-error', null, error);
    throw error;
  }
}
function diagnostics(error, diagnosticPhase = phase) {
  return formatStartupFailure({
    error, phase: diagnosticPhase, startedAt, now: Date.now(), deadlineAt: deadline,
    children: {
      browser: { process: browser, spawnError: browserSpawnError, stderr: readBoundedText(browserStderr, diagnosticSecrets) },
      Next: { process: web, spawnError: webSpawnError, stderr: readBoundedText(webStderr, diagnosticSecrets) },
    },
    request: lastStartupRequest,
    secrets: [...diagnosticSecrets],
  });
}
const check = () => { if (Date.now() >= deadline) throw Error(`Acceptance deadline exceeded during ${phase}`); };
const wait = async (fn, label, limit = 15000) => {
  const end = Math.min(deadline, Date.now() + limit);
  let lastError;
  while (Date.now() < end) {
    if (web?.exitCode !== null && web?.exitCode !== undefined) throw Error(`Owned Next process exited (${web.exitCode})`);
    if (browser?.exitCode !== null && browser?.exitCode !== undefined) throw Error(`Owned browser exited (${browser.exitCode})`);
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await delay(50);
  }
  throw Error(`${label}: timeout during ${phase}${lastError ? ` (${lastError.message})` : ''}`);
};
const pass = label => { completed.push(label); console.log(`PASS ${label}`); };
// A successful bind, rather than an HTTP response, establishes port ownership.
async function portFree(port) {
  const probe = createProbe();
  await new Promise((resolveProbe, reject) => {
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, resolveProbe);
  }).catch(error => {
    const failure = Error(`Port ${port} unavailable; refusing to touch an existing process (${error.code})`);
    failure.code = `PORT_${port}_UNAVAILABLE`;
    throw failure;
  });
  await new Promise(resolveProbe => probe.close(resolveProbe));
}
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.send({ type: 'gelt:shutdown' });
  else child.kill('SIGTERM');
  await Promise.race([new Promise(resolveChild => child.once('exit', resolveChild)), delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else child.kill('SIGKILL');
    await Promise.race([new Promise(resolveChild => child.once('exit', resolveChild)), delay(2000)]);
  }
}
async function browserPage(port) {
  const page = await discoverBrowserPage(port, {
    onRequest: request => noteStartupRequest(request.label, request.outcome, request.status, request.error),
  });
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveSocket, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('CDP connection timeout')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveSocket(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('CDP connection failed')); }, { once: true });
  });
  let serial = 0;
  const pending = new Map();
  const listeners = new Map();
  const rejectAll = error => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  socket.addEventListener('close', () => rejectAll(Error('CDP socket closed')));
  socket.addEventListener('error', () => rejectAll(Error('CDP socket error')));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) { for (const listener of listeners.get(message.method) ?? []) listener(message.params); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result);
  });
  return {
    on(method, callback) { listeners.set(method, [...listeners.get(method) ?? [], callback]); },
    send(method, params = {}) {
      check();
      return new Promise((resolveCall, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP ${method} timeout during ${phase}`)); }, Math.min(12000, Math.max(1, deadline - Date.now())));
        pending.set(id, { resolve: value => { clearTimeout(timer); resolveCall(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    async close() {
      rejectAll(Error('CDP closing'));
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise(resolveSocket => {
        const timer = setTimeout(resolveSocket, 1000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolveSocket(); }, { once: true });
        socket.close();
      });
    },
  };
}
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(`Browser evaluation failed during ${phase}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}
const query = expression => evaluate(`(() => (${expression}))()`);
const text = () => query('document.body.innerText');
const status = () => query(`document.querySelector('[role="status"]')?.textContent ?? ''`);
const rows = () => query(`[...document.querySelectorAll('tbody tr')].map(row => row.innerText)`);
const sequences = () => query(`[...document.querySelectorAll('[aria-label="Order details"] li strong')].map(item => Number(item.textContent.replace('Sequence ', '')))`);
const detailId = () => query(`document.querySelector('[aria-label="Order details"] h2')?.textContent.replace('Intent ', '') ?? null`);
async function click(label, index = 0) {
  const value = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].filter(item => item.textContent.trim() === ${JSON.stringify(label)})[${index}]; if (!button || button.disabled) return false; button.click(); return true; })()`);
  assert.equal(value, true, `enabled button required: ${label} (${index})`);
}
const disabled = label => query(`[...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)})?.disabled ?? null`);
const setCsrf = value => evaluate(`(() => { const input = document.querySelector('input[aria-label="CSRF token"]'); if (!input) throw Error('Missing CSRF draft'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const genericMessage = 'History unavailable. Displayed records, if any, are a previous partial snapshot. Reload selected account history. No order outcome is inferred.';
const draftMessage = 'Draft CSRF changed or restored. Displayed records are a previous partial snapshot; reload selected account history.';
const conflictMessage = 'History changed while paging. Displayed records are a previous partial snapshot; reload selected account history.';
const authMessage = 'Owner session unavailable. Displayed history cleared. Restore an authenticated session in Connect, then reload history.';
const accountMessage = 'Selected account changed. Displayed history cleared; reload selected account history.';
const gateScript = `(() => {
  const original = window.fetch.bind(window);
  const state = window.__historyAcceptance = { original, rules: [], calls: [], held: new Map(), serial: 0, realm: Math.random().toString(36) };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!['/api/connection/history', '/api/connection/intent'].includes(url.pathname)) return original(input, init);
    const operation = url.pathname.endsWith('/history') ? 'history' : 'intent';
    const body = JSON.parse(init.body ?? '{}');
    const index = state.rules.findIndex(rule => rule.operation === operation && (rule.after === undefined || rule.after === body.after));
    const rule = index < 0 ? null : state.rules.splice(index, 1)[0];
    const call = { id: ++state.serial, operation, after: body.after, intentId: body.intentId, tag: rule?.tag, complete: false, released: !rule?.hold, delivered: false, signal: init.signal };
    state.calls.push(call);
    const options = { ...init };
    // Ignore cancellation only for the selected held response. The real server
    // response still has to arrive. This proves epoch guards independently of
    // cooperative abort behavior; production fetch is never modified.
    if (rule?.hold) delete options.signal;
    if (rule?.omitCookie) options.credentials = 'omit';
    if (rule?.wrongCsrf) options.headers = { ...init.headers, 'X-Gelt-CSRF': 'synthetic-invalid-csrf' };
    let release;
    const held = rule?.hold ? new Promise(resolve => { release = resolve; }) : null;
    if (held) state.held.set(rule.tag, () => { call.released = true; release(); });
    let response, failure;
    try {
      response = await original(input, options);
      call.status = response.status;
      // Inspect a clone for evidence; return the untouched real Response below.
      call.value = await response.clone().json();
    } catch (error) { call.networkFailure = true; failure = error; }
    call.complete = true;
    if (held) await held;
    call.delivered = true;
    if (failure) throw failure;
    return response;
  };
})()`;
async function arm(rule) { await evaluate(`window.__historyAcceptance.rules.push(${JSON.stringify(rule)})`); }
const callFor = tag => query(`(() => { const call = window.__historyAcceptance.calls.find(item => item.tag === ${JSON.stringify(tag)}); if (!call) return null; const { signal, ...safe } = call; return { ...safe, aborted: signal?.aborted ?? false }; })()`);
async function held(tag, expectedStatus = 200) {
  const call = await wait(async () => { const current = await callFor(tag); return current?.complete && current; }, `real response ${tag}`);
  assert.equal(call.status, expectedStatus, `${tag} must originate from actual HTTP ${expectedStatus}`);
  assert.equal(call.delivered, false, `${tag} remains unresolved in the UI`);
  return call;
}
async function release(tag) {
  await evaluate(`(() => { const release = window.__historyAcceptance.held.get(${JSON.stringify(tag)}); if (!release) throw Error('Missing held response'); release(); })()`);
  await wait(async () => (await callFor(tag))?.delivered, `release ${tag}`);
  // React state microtasks and two real animation frames must settle first.
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
async function loadHistory(expectedCount = 50) {
  await click('Load selected account history');
  await wait(async () => await status() === 'Ledger history loaded.' && (await rows()).length === expectedCount, 'fresh history');
}
async function loadDetail(index = 0) {
  await click('Open timeline', index);
  await wait(async () => await status() === 'Persistent ledger detail loaded.', 'fresh detail');
}
async function screenshot(name) {
  if (!screenshotDir) return;
  // Never capture connection screens, session drafts, tokens, or private files.
  assert.equal(await query('location.pathname'), '/history');
  assert.equal(await query(`document.querySelector('input[aria-label="CSRF token"]')?.type`), 'password');
  await evaluate(`(() => {
    let banner = document.getElementById('history-acceptance-banner');
    if (!banner) { banner = document.createElement('div'); banner.id = 'history-acceptance-banner'; document.body.append(banner); }
    banner.textContent = 'SYNTHETIC / OFFLINE ACCEPTANCE FIXTURE — NO LIVE BROKER CONNECTION';
    Object.assign(banner.style, { position:'fixed', top:'0', left:'0', right:'0', padding:'10px', background:'#fff5c2', color:'#141414', zIndex:'2147483647', font:'bold 15px system-ui', textAlign:'center' });
    ${name.includes('timeline') ? "document.querySelector('[aria-label=\"Order details\"]')?.scrollIntoView({ block:'start' }); window.scrollBy(0, -50);" : 'window.scrollTo(0, 0);'}
  })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  mkdirSync(screenshotDir, { recursive: true, mode: 0o700 });
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(screenshotDir, `${name}.png`), Buffer.from(result.data, 'base64'), { mode: 0o600 });
}

try {
  phase = 'port ownership checks';
  await portFree(3000); await portFree(4100);
  phase = 'browser discovery';
  const version = spawnSync(browserPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
  noteStartupRequest('Browser version probe', version.error ? 'process-error' : version.status === 0 ? 'process-exit-zero' : 'process-exit-nonzero', null, version.error);
  lastStartupRequest.processStatus = Number.isInteger(version.status) ? version.status : null;
  assert.equal(version.status, 0, 'browser version probe');
  console.log(`Browser: ${version.stdout.trim()}; default security sandbox required (no bypass flags); fixture-only synthetic records`);
  // Fail on unsupported browser hosts before claiming any running-UI evidence.
  profile = mkdtempSync(join(tmpdir(), 'gelt-history-browser-'));
  browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  browser.stdout.on('data', () => {});
  browser.stderr.on('data', data => { appendBoundedText(browserStderr, data, diagnosticSecrets); });
  browser.on('error', error => { browserSpawnError = error; });
  phase = 'browser readiness';
  const debugPort = await wait(() => {
    if (browser.signalCode) throw Error(`Browser exited on ${browser.signalCode}`);
    const path = join(profile, 'DevToolsActivePort');
    return existsSync(path) && Number(readFileSync(path, 'utf8').split('\n')[0]);
  }, 'sandboxed browser readiness', 10000);
  phase = 'browser target discovery';
  cdp = await browserPage(debugPort);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  // All navigations and page requests are confined to this test-owned local Next
  // origin. The synthetic Connection never talks to an external provider.
  const externalRequests = [];
  cdp.on('Network.requestWillBeSent', params => {
    const url = new URL(params.request.url);
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:3000') externalRequests.push(url.origin);
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
  cdp.on('Fetch.requestPaused', params => {
    const allowed = new URL(params.request.url).origin === 'http://127.0.0.1:3000';
    void cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  const [{ createWorker }, { Connection }, { registrationSchema }, { Ledger }, { createLedgerDirectory }, { storageFixture }, { createPrivateDirectory, writePrivateNew }, { id, intent, event }] = await Promise.all([
    import('../worker/dist/service.js'), import('../worker/dist/connection.js'), import('../worker/dist/connection-contract.js'), import('../worker/dist/ledger.js'), import('../worker/dist/ledger-storage.js'), import('../worker/dist/storage-fixture.js'), import('../worker/dist/private-files.js'), import('../worker/dist/ledger-fixture.js'),
  ]);
  root = storageFixture('gelt-next-history-');
  const ledgerDir = join(root, 'ledger'), bffDir = join(root, 'bff');
  createLedgerDirectory(ledgerDir); createPrivateDirectory(bffDir);
  const secret = randomBytes(32).toString('base64url'), bootstrap = randomBytes(32).toString('base64url');
  diagnosticSecrets.add(secret); diagnosticSecrets.add(bootstrap);
  writePrivateNew(join(bffDir, 'bff.json'), JSON.stringify({ serviceSecret: secret }));
  writePrivateNew(join(bffDir, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: Date.now() + 120000 }));
  ledger = new Ledger(join(ledgerDir, 'execution.sqlite'), id(1));
  const selectedAccount = { account_number: 'SYNTHETICA1', rhs_account_number: 'SYNTHETICA2', rhc_account_number: 'SYNTHETICA3', eligible: true, agent_accessible: true, status: 'active', account_type: 'cash', ownership: 'individual' };
  const otherAccount = { ...selectedAccount, account_number: 'SYNTHETICB1', rhs_account_number: 'SYNTHETICB2', rhc_account_number: 'SYNTHETICB3' };
  const routing = account => ({ provider: 'robinhood-official-mcp', ACCOUNT: account.account_number, RHS: account.rhs_account_number, RHC: account.rhc_account_number });
  const makeIntent = (n, account = selectedAccount, accountId = id(2)) => ({ ...intent, intentId: id(n), idempotencyKey: id(10000 + n), accountId, routing: routing(account), order: { ...intent.order, instrumentId: `SYNTHETIC-HISTORY-${account === selectedAccount ? 'A' : 'B'}-${n}` } });
  const written = result => assert.equal(result.ok, true, `real ledger fixture write: ${JSON.stringify(result.ok ? { ok: true } : result)}`);
  for (let n = 1000; n < 1055; n++) written(ledger.recordIntent(makeIntent(n)));
  for (let n = 2000; n < 2002; n++) written(ledger.recordIntent(makeIntent(n, otherAccount, id(20))));
  const fact = (n, intentNumber = 1000) => ({ version: 1, ownerId: id(1), accountId: id(2), intentId: id(intentNumber), eventId: id(30000 + n), idempotencyKey: id(40000 + n), occurredAt: '2026-01-01T00:00:03.000Z' });
  written(ledger.append({ ...fact(1), type: 'order-requested', requestId: id(50001), occurredAt: '2026-01-01T00:00:10.000Z' }));
  const observed = structuredClone(event.execution); delete observed.observedFee; observed.brokerOrderId = 'synthetic-order-1';
  written(ledger.append({ ...fact(2), type: 'execution-observed', occurredAt: '2026-01-01T00:00:01.000Z', execution: observed }));
  written(ledger.append({ ...fact(3), type: 'broker-acknowledged', brokerOrderId: 'synthetic-order-1' }));
  for (let n = 4; n <= 55; n++) written(ledger.append({ ...fact(n), type: 'reconciliation-observed', reconciliationId: id(50000 + n), observation: 'unknown' }));
  written(ledger.append({ ...fact(56, 1001), type: 'broker-acknowledged', brokerOrderId: 'synthetic-order-2' }));
  written(ledger.append({ ...fact(57, 1001), type: 'reconciliation-observed', reconciliationId: id(50057), observation: 'unknown' }));
  let credentials = null;
  const providerCalls = { exchange: 0, refresh: 0, accounts: 0 };
  const provider = {
    async exchange() { providerCalls.exchange++; return { access: 'synthetic-access', refresh: 'synthetic-refresh', expiresAt: Date.now() + 600000 }; },
    async refresh() { providerCalls.refresh++; return { access: 'synthetic-access', refresh: 'synthetic-refresh', expiresAt: Date.now() + 600000 }; },
    async accounts() { providerCalls.accounts++; return { accounts: [selectedAccount, otherAccount] }; },
  };
  const registration = registrationSchema.parse({ clientId: 'offline-history-fixture', redirectUri: 'http://127.0.0.1:3000/api/connection/callback', issuer: 'https://agent.robinhood.com/mcp/trading', authorizationEndpoint: 'https://robinhood.com/oauth', tokenEndpoint: 'https://api.robinhood.com/oauth2/token/', scope: 'internal', tokenEndpointAuthMethod: 'none', pkce: 'S256' });
  connection = new Connection(provider, { read: () => credentials, write: value => { credentials = value; } }, registration);
  const syntheticSession = randomBytes(32).toString('base64url');
  diagnosticSecrets.add(syntheticSession);
  const state = new URL(connection.initiate(syntheticSession).authorizationUrl).searchParams.get('state');
  const connected = await connection.callback(syntheticSession, { state, code: 'synthetic-code' });
  const selectA = () => connection.select({ account: connected.accounts[0].handle });
  const selectB = () => connection.select({ account: connected.accounts[1].handle });
  selectA();
  worker = createWorker(connection, secret, () => ledgerAvailable && ledger.available(), ledger, id(1));
  await new Promise((resolveWorker, reject) => { worker.once('error', reject); worker.listen(4100, '127.0.0.1', resolveWorker); });
  phase = 'Next startup';
  web = spawn(process.execPath, ['--import', new URL('./offline-guard.mjs', import.meta.url).href, 'scripts/web.mjs'], { cwd: appDir, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, GELT_WINDOWS_PRIVATE_PARENT: process.env.GELT_WINDOWS_PRIVATE_PARENT, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', GELT_BFF_CONFIG: join(bffDir, 'bff.json') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  web.stdout.on('data', () => {});
  web.stderr.on('data', data => { appendBoundedText(webStderr, data, diagnosticSecrets); });
  web.on('error', error => { webSpawnError = error; });
  phase = 'Next HTTP readiness';
  await wait(async () => (await startupFetch('Next HTTP readiness', 'http://127.0.0.1:3000/history', { signal: AbortSignal.timeout(1000) })).ok, 'running Next readiness', 30000);
  phase = 'bootstrap and real initial load';
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/history' });
  await wait(() => query(`document.querySelector('input[aria-label="CSRF token"]') !== null`), 'hydrated history page');
  const login = await evaluate(`fetch('/api/connection/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bootstrap: ${JSON.stringify(bootstrap)} }) }).then(async response => ({ status: response.status, value: await response.json() }))`);
  assert.equal(login.status, 200);
  diagnosticSecrets.add(login.value.csrf);
  await evaluate(`sessionStorage.setItem('gelt-csrf', ${JSON.stringify(login.value.csrf)})`);
  await click('Restore saved CSRF');
  await wait(() => query(`document.querySelector('input[aria-label="CSRF token"]')?.value === ${JSON.stringify(login.value.csrf)}`), 'restored CSRF');
  await evaluate(gateScript);
  await loadHistory();
  assert.equal((await rows()).every(row => row.includes('SYNTHETIC-HISTORY-A-')), true);
  assert.equal((await rows())[0].includes('0.010'), true, 'requested quantity remains exact');
  assert.equal((await rows())[0].includes('1.00'), true, 'requested price remains exact');
  await loadDetail();
  assert.equal(await detailId(), id(1000));
  assert.deepEqual(await sequences(), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.match(await text(), /Observed quantity 0\.001; price 0\.99 USD; fee not supplied\./);
  assert.match(await text(), /Reconciliation observation: unknown; this is not execution evidence\./);
  assert.match(await text(), /2026-01-01T00:00:10\.000Z[\s\S]*2026-01-01T00:00:01\.000Z/);
  await click('Load more timeline');
  await wait(async () => (await sequences()).length === 55, 'contiguous timeline append');
  assert.deepEqual(await sequences(), Array.from({ length: 55 }, (_, index) => index + 1));
  assert.equal(await disabled('Load more timeline'), null);
  await screenshot('synthetic-exact-timeline');
  await click('Load more history');
  await wait(async () => (await rows()).length === 55, 'contiguous history append');
  assert.equal(new Set(await rows()).size, 55);
  assert.equal(await disabled('Load more history'), null);
  pass('real named BFF/private worker/SQLite; exact decimals, missing fee, unknown observation, storage-order and contiguous 50+5 pagination');

  phase = 'newer initial history beats older success';
  await arm({ operation: 'history', after: 0, tag: 'old-list-success', hold: true });
  await click('Load selected account history');
  await held('old-list-success'); selectB();
  await loadHistory(2);
  const newestRows = await rows(), newestMessage = await status();
  await release('old-list-success');
  assert.deepEqual(await rows(), newestRows); assert.equal(await status(), newestMessage);
  assert.equal(newestRows.every(row => row.includes('SYNTHETIC-HISTORY-B-')), true);
  assert.equal((await callFor('old-list-success')).aborted, true, 'superseded request signal is aborted too');
  pass('newer initial load wins over older real HTTP 200; stale success cannot change data/message/busy state');

  for (const staleStatus of [409, 401]) {
    phase = `newer initial history beats older ${staleStatus}`;
    selectA();
    if (staleStatus === 409) ledgerAvailable = false;
    const tag = `old-list-${staleStatus}`;
    await arm({ operation: 'history', after: 0, tag, hold: true, omitCookie: staleStatus === 401 });
    await click('Load selected account history'); await held(tag, staleStatus);
    ledgerAvailable = true;
    await loadHistory();
    const before = await rows();
    await release(tag);
    assert.deepEqual(await rows(), before); assert.equal(await status(), 'Ledger history loaded.');
    assert.equal(await disabled('Load more history'), false);
  }
  pass('newer initial load wins over older worker 409 and confirmed owner-session 401; stale failures cannot clear current history');

  phase = 'CSRF draft edit and restore while request unresolved';
  const snapshot = await rows();
  await arm({ operation: 'history', after: 50, tag: 'draft-pending', hold: true });
  await click('Load more history'); await held('draft-pending');
  await setCsrf('synthetic-draft-edit');
  await wait(async () => await status() === draftMessage, 'draft invalidation');
  await click('Restore saved CSRF');
  await wait(() => query(`document.querySelector('input[aria-label="CSRF token"]')?.value === ${JSON.stringify(login.value.csrf)}`), 'same saved CSRF restored');
  assert.equal((await callFor('draft-pending')).delivered, false, 'draft edit and restoration both precede response resolution');
  await release('draft-pending');
  assert.deepEqual(await rows(), snapshot); assert.equal(await status(), draftMessage);
  assert.equal(await disabled('Load more history'), true);
  assert.equal(await disabled('Open timeline'), true);
  assert.equal((await callFor('draft-pending')).aborted, true);
  const sameSession = await evaluate(`window.__historyAcceptance.original('/api/connection/order-status', { method:'POST', headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')}, body:'{}' }).then(response => response.status)`);
  assert.equal(sameSession, 200, 'draft mutation is not a session transition');
  await loadHistory();
  pass('draft-CSRF edit plus restore invalidates an unresolved response without claiming owner-session expiry; stale snapshot cannot append');

  phase = 'newest selected detail wins';
  for (const order of ['newer-first', 'older-first']) {
    const oldTag = `old-detail-${order}`, newTag = `new-detail-${order}`;
    await arm({ operation: 'intent', after: 0, tag: oldTag, hold: true });
    await click('Open timeline', 0); await held(oldTag);
    await arm({ operation: 'intent', after: 0, tag: newTag, hold: true });
    await click('Open timeline', 1); await held(newTag);
    if (order === 'older-first') {
      await release(oldTag);
      assert.equal(await detailId(), null);
      assert.equal(await status(), 'Loading persistent ledger detail.');
      assert.equal(await disabled('Load more history'), true, 'stale finally must not clear the newer request busy state');
    }
    await release(newTag);
    await wait(async () => await detailId() === id(1001) && await status() === 'Persistent ledger detail loaded.', 'newest detail');
    if (order === 'newer-first') await release(oldTag);
    assert.equal(await detailId(), id(1001));
    assert.equal(await status(), 'Persistent ledger detail loaded.');
    assert.equal((await callFor(oldTag)).aborted, true);
    assert.equal(await disabled('Load more history'), false);
    assert.match(await text(), /Reconciliation observation: unknown/);
  }
  pass('newest detail wins in both completion orders; stale finally cannot clear newer busy state; unknown acknowledgement is not a fill');

  phase = 'worker-selected account changes during paging';
  await loadHistory(); selectB();
  await click('Load more history');
  await wait(async () => await status() === accountMessage, 'account-scope invalidation');
  assert.deepEqual(await rows(), []); assert.equal(await detailId(), null);
  await loadHistory(2); selectA(); await loadHistory();
  pass('account-handle change on real next-page response clears old account data; explicit reload recovers');

  phase = 'real ledger insertion shifts offset into overlap';
  const beforeShift = await rows();
  // Ledger iteration uses canonical intent ID order. A new lower ID shifts the
  // real offset boundary and makes the prior page's final row reappear.
  written(ledger.recordIntent(makeIntent(999)));
  await arm({ operation: 'history', after: 50, tag: 'real-overlap' });
  await click('Load more history');
  await wait(async () => await status() === conflictMessage, 'overlap rejected');
  assert.deepEqual(await rows(), beforeShift, 'overlap must not produce a duplicate appended row');
  const overlap = await callFor('real-overlap');
  assert.equal(overlap.status, 200); assert.equal(overlap.value.items[0].intentId, id(1049));
  assert.equal(await disabled('Load more history'), true); assert.equal(await disabled('Open timeline'), true);
  await screenshot('synthetic-offset-overlap-reload-required');
  await loadHistory();
  assert.match((await rows())[0], /SYNTHETIC-HISTORY-A-999/);
  await click('Load more history'); await wait(async () => (await rows()).length === 56, 'offset-shift reload recovery');
  assert.equal(new Set(await rows()).size, 56);
  pass('real SQLite insertion creates duplicate/overlapping offset page; previous partial snapshot is retained and a fresh contiguous reload recovers');

  for (const failure of ['403', 'worker', 'network']) {
    phase = `${failure} does not claim session expiry`;
    await loadHistory();
    const before = await rows();
    const tag = `active-${failure}`;
    await arm({ operation: 'history', after: 50, tag, wrongCsrf: failure === '403' });
    if (failure === 'worker') ledgerAvailable = false;
    if (failure === 'network') await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await click('Load more history');
      await wait(async () => await status() === genericMessage, `${failure} partial snapshot`);
      assert.deepEqual(await rows(), before);
      assert.equal(await disabled('Load more history'), true);
      const failed = await callFor(tag);
      if (failure === 'network') assert.equal(failed.networkFailure, true, 'actual browser network error');
      else assert.equal(failed.status, failure === '403' ? 403 : 409);
      assert.notEqual(await status(), authMessage);
    } finally {
      ledgerAvailable = true;
      if (failure === 'network') await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
  }
  pass('actual BFF 403, generic private-worker 409 and browser transport failure retain only a partial snapshot and require reload');

  phase = 'confirmed 401 clears active list and detail';
  await loadHistory(); await loadDetail(1); // lower inserted ID precedes the 55-event intent
  assert.equal(await detailId(), id(1000));
  await arm({ operation: 'intent', after: 50, tag: 'active-401', omitCookie: true });
  await click('Load more timeline');
  await wait(async () => await status() === authMessage, '401 owner session invalidation');
  assert.equal((await callFor('active-401')).status, 401);
  assert.deepEqual(await rows(), []); assert.equal(await detailId(), null);
  await loadHistory();
  pass('current real owner-session 401 clears both list and detail; 403/network/worker errors remain distinct');

  phase = 'client navigation unmount ignores late response';
  await arm({ operation: 'history', after: 0, tag: 'unmounted-list', hold: true });
  await click('Load selected account history'); await held('unmounted-list');
  const realm = await query('window.__historyAcceptance.realm');
  await evaluate(`document.querySelector('a[href="/connect"]').click()`);
  await wait(() => query(`location.pathname === '/connect'`), 'client-side connection navigation');
  assert.equal(await query('window.__historyAcceptance?.realm'), realm, 'Next Link preserves the JS realm so this proves React unmount, not document replacement');
  await wait(async () => (await callFor('unmounted-list'))?.aborted, 'unmount aborts the request');
  await release('unmounted-list');
  assert.equal(await query('location.pathname'), '/connect');
  assert.equal(await query(`document.querySelector('[aria-label="Order details"]')`), null);
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/history' });
  await wait(() => query(`document.querySelector('input[aria-label="CSRF token"]')?.value === ${JSON.stringify(login.value.csrf)}`), 'new history mount');
  assert.deepEqual(await rows(), []); assert.equal(await detailId(), null);
  pass('genuine Next client-side unmount aborts a held request; late actual response cannot contaminate a new history mount');

  phase = 'execution capability remains closed';
  const capability = await evaluate(`fetch('/api/connection/order-status', { method:'POST', headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')}, body:'{}' }).then(async response => ({ status:response.status,value:await response.json() }))`);
  assert.equal(capability.status, 200);
  assert.deepEqual(capability.value, { version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, reconciliation: false, reason: 'production_adapter_unsupported' });
  assert.equal(await evaluate(`fetch('/api/connection/confirm', { method:'POST', headers:{'Content-Type':'application/json','X-Gelt-CSRF':sessionStorage.getItem('gelt-csrf')}, body:'{}' }).then(response=>response.status)`), 404);
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
  await wait(() => query(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim() === 'Request fresh exact preview — unavailable')`), 'disabled order controls');
  assert.deepEqual(await query(`[...document.querySelectorAll('button')].filter(button => /^(Request fresh exact preview|Confirm exact terms|Request cancel)/.test(button.textContent.trim())).map(button => ({ label:button.textContent.trim(),disabled:button.disabled }))`), [
    { label: 'Request fresh exact preview — unavailable', disabled: true },
    { label: 'Confirm exact terms — unavailable', disabled: true },
    { label: 'Request cancel — unavailable', disabled: true },
  ]);
  assert.deepEqual(providerCalls, { exchange: 1, refresh: 0, accounts: 1 }, 'only explicitly injected in-memory fixture setup ran');
  assert.deepEqual(externalRequests, [], 'browser made no external provider or market request');
  pass('production execution, preview, confirmation, dispatch, cancellation and reconciliation remain false; order controls disabled; no live connection');
  console.log(`PASS running history acceptance: ${completed.length} completed stages; all displayed records are synthetic offline fixtures`);
} catch (error) {
  console.error(diagnostics(error));
  console.error(`Completed stages: ${completed.length}. Unreached stages remain unverified; no browser or deployment acceptance is implied.`);
  process.exitCode = 1;
} finally {
  if (cdp) {
    try { await cdp.send('Browser.close'); } catch { /* owned browser may already have exited */ }
    await cdp.close();
  }
  for (const child of [browser, web]) {
    try {
      await stopChild(child);
      assert.ok(!child?.pid || child.exitCode !== null || child.signalCode !== null, 'owned child must be joined before cleanup completes');
    } catch (error) { console.error(diagnostics(error, 'cleanup')); process.exitCode = 1; }
  }
  if (worker) { worker.closeAllConnections(); await new Promise(resolveWorker => worker.close(resolveWorker)); }
  try { ledger?.close(); } catch (error) { console.error(diagnostics(error, 'cleanup')); process.exitCode = 1; }
  try { connection?.shutdown(); } catch (error) { console.error(diagnostics(error, 'cleanup')); process.exitCode = 1; }
  for (const path of [root, profile]) if (path) {
    try { rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); assert.equal(existsSync(path), false, 'owned fixture removed'); }
    catch (error) { console.error(diagnostics(error, 'cleanup')); process.exitCode = 1; }
  }
  // Never kill an unowned listener to make cleanup pass.
  try {
    await portFree(3000); await portFree(4100);
    if (!process.exitCode) console.log('PASS cleanup: owned browser and Next children joined, private worker closed, ports 3000/4100 free, temporary ledger/BFF/profile removed');
  }
  catch (error) { console.error(diagnostics(error, 'cleanup')); process.exitCode = 1; }
}
}
