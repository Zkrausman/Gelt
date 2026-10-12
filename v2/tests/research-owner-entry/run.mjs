// New G01 browser regression. Real Chromium, real UI/BFF/store path, synthetic owner grant only.
// Writes only allow-listed, non-secret evidence; it never persists raw grant, response body, cookie or CSRF.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const nodeMajor = Number(process.versions.node.split('.')[0]);
assert.equal(nodeMajor, 22, 'G01 browser regression requires approved Node 22.');
assert.notEqual(process.platform, 'win32', 'G01 browser regression requires POSIX process-group isolation for bounded launcher cleanup.');
function requiredPath(name) {
  const raw = process.env[name];
  assert.ok(typeof raw === 'string' && raw.trim() !== '', `${name} must be set to an approved path.`);
  const value = resolve(raw);
  assert.ok(value !== '/', `${name} must not name the filesystem root.`);
  return value;
}
const appRoot = requiredPath('GELT_TEST_APP_ROOT');
const sourceRoot = requiredPath('GELT_TEST_SOURCE_ROOT');
const playwrightRoot = requiredPath('GELT_TEST_PLAYWRIGHT_ROOT');
const browserLaunchPath = requiredPath('GELT_TEST_BROWSER_PATH');
let browserPath;
try { browserPath = realpathSync(browserLaunchPath); }
catch { throw new Error('recorded-browser-path-unavailable'); }
const browserRoot = requiredPath('GELT_TEST_BROWSERS_PATH');
const privateParent = requiredPath('GELT_TEST_PRIVATE_PARENT');
const sourceBaseCommit = process.env.GELT_TEST_SOURCE_BASE;
assert.equal(sourceBaseCommit, '9debdf6d055137d4f4f6e0121bd5930a43e18755', 'G01 evidence must be bound to the sanitized publication root commit.');
const baseAncestry = spawnSync('git', ['merge-base', '--is-ancestor', sourceBaseCommit, 'HEAD'], { cwd: sourceRoot, stdio: 'ignore' });
assert.equal(baseAncestry.status, 0, 'G01 source checkout must actually contain the sanitized publication root as an ancestor.');
const parentStat = lstatSync(privateParent);
assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink() && parentStat.uid === process.getuid() && (parentStat.mode & 0o777) === 0o700, 'Synthetic fixture parent must already be owner-private.');
assert.ok(lstatSync(browserPath).isFile() && (lstatSync(browserPath).mode & 0o111), 'Recorded Chromium binary must exist and be executable.');
const runRoot = join(privateParent, 'gelt-g01-browser-' + randomBytes(16).toString('hex'));
const appFile = p => join(appRoot, p);
const sourceFile = p => join(sourceRoot, p);
const importApp = async p => import(pathToFileURL(appFile(p)).href);
const playwrightPackage = JSON.parse(readFileSync(join(playwrightRoot, 'node_modules/playwright/package.json'), 'utf8'));
assert.equal(typeof playwrightPackage.version, 'string', 'Approved Playwright package must report its installed version.');
let assertLoopbackPortsFree, replacePrivate, chromium;
let demo, browser, context, page;
let grant = null;
let stdoutCarry = '';
let readyLineSeen = false;
let expectGrantNext = false;
let demoSpawnErrorSeen = false;
let failureStage = 'startup';
const externalOrigins = [];
const observations = [];
const browserDirs = [];
let launcherCleanupVerified = false;
let testRootRemoved = false;
let browserProfileRemoved = true;
let browserLaunchAttempted = false;
let browserCloseVerified = false;
let launcherShutdownEscalated = false;
let demoProcessGroupIsolated = false;
let browserLaunchDiagnostic = null;
const sourcePaths = [
  { source: 'v2/scripts/research-owner-demo.mjs', installed: 'scripts/research-owner-demo.mjs' },
  { source: 'v2/scripts/web.mjs', installed: 'scripts/web.mjs' },
  { source: 'v2/scripts/web-ipc.mjs', installed: 'scripts/web-ipc.mjs' },
  { source: 'v2/web/lib/connection-bff.ts', installed: 'web/lib/connection-bff.ts' },
  { source: 'v2/web/app/connect/page.tsx', installed: 'web/app/connect/page.tsx' },
  { source: 'v2/web/lib/connection-bff.test.ts', installed: 'web/lib/connection-bff.test.ts' },
  { source: 'v2/tests/research-owner-entry/run.mjs', installed: null },
];
function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
const sourceInventory = Object.fromEntries(sourcePaths.map(({ source, installed }) => {
  const sourcePath = sourceFile(source);
  assert.ok(existsSync(sourcePath), `Source input must exist: ${source}`);
  const sourceSha256 = sha256File(sourcePath);
  const installedPath = installed ? appFile(installed) : null;
  let installedSha256 = null;
  if (installedPath) {
    assert.ok(existsSync(installedPath), `Installed G01 input must exist: ${installed}`);
    const installedStat = lstatSync(installedPath);
    assert.ok(installedStat.isFile() && !installedStat.isSymbolicLink(), `Installed G01 input must be a regular file: ${installed}`);
    installedSha256 = sha256File(installedPath);
    assert.equal(installedSha256, sourceSha256, `Installed G01 input must match source: ${source}`);
  }
  return [source, { sourceSha256, installedPath: installed, installedSha256 }];
}));
const allowedStages = new Set(['request', 'host-validated', 'ingress-validated', 'origin-validated', 'path-validated', 'method-validated', 'configuration-validated', 'body-validated', 'grant-read', 'grant-validated', 'grant-consumed', 'session-created']);
const allowedOutcomes = new Set(['unavailable', 'grant-expired', 'grant-mismatch', 'grant-expired-after-consumption', 'session-created']);
const safeCookieBlockReasons = new Map([
  ['SecureOnly', 'secure-cookie-policy'], ['CookiePrefix', 'cookie-prefix-policy'], ['CookieNoPrefix', 'cookie-prefix-policy'],
  ['SameSiteNoneInsecure', 'same-site-secure-policy'], ['DomainMismatch', 'domain-policy'], ['NotOnPath', 'path-policy'],
  ['SameSiteStrict', 'same-site-policy'], ['SameSiteLax', 'same-site-policy'], ['SameSiteUnspecifiedTreatedAsLax', 'same-site-policy'],
  ['UserPreferences', 'browser-policy'], ['ThirdPartyPhaseout', 'third-party-policy'], ['ThirdPartyBlockedInFirstPartySet', 'third-party-policy'],
  ['StorageAccessAPI', 'storage-access-policy'], ['SchemefulSameSiteStrict', 'same-site-policy'], ['SchemefulSameSiteLax', 'same-site-policy'],
  ['SchemefulSameSiteUnspecifiedTreatedAsLax', 'same-site-policy'], ['SamePartyFromCrossPartyContext', 'same-site-policy'],
  ['SamePartyConflictsWithSameSite', 'same-site-policy'], ['NameValuePairExceedsMaxSize', 'size-policy'], ['DisallowedCharacter', 'syntax'],
  ['NoCookieContent', 'syntax'], ['CookieDomainNonASCII', 'domain-policy'], ['CookiePathEmpty', 'path-policy'],
]);
const browserCookieBlockReasons = new Set();
function expectedBootstrapMessage(response, body) {
  const status = response.status();
  if (response.ok() && typeof body?.csrf === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.csrf)) return 'Owner session opened. Read status; this does not enable an order.';
  const stage = response.headers()['x-gelt-bootstrap-stage'] ?? null;
  const outcome = response.headers()['x-gelt-bootstrap-outcome'] ?? null;
  const safeStage = stage && allowedStages.has(stage) ? `; stage ${stage}` : '';
  const safeOutcome = outcome && allowedOutcomes.has(outcome) ? `; outcome ${outcome}` : '';
  const responseShape = body === null || typeof body !== 'object' || Array.isArray(body)
    ? '; response body invalid'
    : response.ok() ? '; response shape invalid' : '';
  return `Owner session unavailable (HTTP ${status}${safeStage}${safeOutcome}${responseShape}). No connection or order outcome is assumed.`;
}
async function record(name, response, body, pageMessage, cookieObservation) {
  const status = response.status();
  const responseOk = response.ok();
  const responseBodyVersionValid = body?.version === 'v1';
  const responseBodyErrorPresent = typeof body?.error === 'string';
  const csrfShapeValid = typeof body?.csrf === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.csrf);
  const setCookie = await response.headerValue('set-cookie') ?? '';
  const responseCookiePresent = /^__Host-gelt=[^;]+/i.test(setCookie);
  const responseCookieHttpOnly = /;\s*httponly(?:;|$)/i.test(setCookie);
  const responseCookieSecure = /;\s*secure(?:;|$)/i.test(setCookie);
  const responseCookieRootPath = /;\s*path=\/(?:;|$)/i.test(setCookie);
  const responseCookieDomainless = responseCookiePresent && !/;\s*domain=/i.test(setCookie);
  const stage = response.headers()['x-gelt-bootstrap-stage'] ?? null;
  const outcome = response.headers()['x-gelt-bootstrap-outcome'] ?? null;
  assert.equal(stage === null || allowedStages.has(stage), true, 'Bootstrap stage must be a fixed safe enum.');
  assert.equal(outcome === null || allowedOutcomes.has(outcome), true, 'Bootstrap outcome must be a fixed safe enum.');
  const visibleMessageClass = pageMessage.includes('Owner session opened')
    ? 'owner-session-opened'
    : pageMessage.includes('Owner session unavailable') ? 'owner-session-unavailable' : 'other';
  const ownerCookie = cookieObservation?.stored ?? null;
  observations.push({ case: name, httpStatus: status, responseOk, responseBodyVersionValid, responseBodyErrorPresent, csrfShapeValid, responseCookiePresent, responseCookieHttpOnly, responseCookieSecure, responseCookieRootPath, responseCookieDomainless, browserCookieBlockReasons: [...browserCookieBlockReasons].sort(), ownerCookieStored: Boolean(ownerCookie), ownerCookieRequestUrlEligible: Boolean(cookieObservation?.requestUrlEligible), ownerCookieSecure: ownerCookie?.secure ?? false, ownerCookieHttpOnly: ownerCookie?.httpOnly ?? false, ownerCookieRootPath: ownerCookie?.path === '/', ownerCookieSameSiteLax: ownerCookie?.sameSite === 'Lax', stage, outcome, visibleMessageClass, visibleMessageReportsHttpStatus: pageMessage.includes(`HTTP ${status}`) });
  browserCookieBlockReasons.clear();
  return { status, responseOk, responseBodyVersionValid, responseBodyErrorPresent, csrfShapeValid, stage, outcome, visibleMessageClass };
}
function classifyBrowserLaunchError(error) {
  const message = error instanceof Error ? error.message.slice(0, 4096) : '';
  const signals = [
    ['browser-closed', /target page, context or browser has been closed|browser has been closed/i],
    ['devtools-endpoint', /DevToolsActivePort|remote[- ]debugging (?:endpoint|port)/i],
    ['crashpad', /crashpad/i],
    ['linux-namespace', /namespace/i],
    ['display-server', /\bDISPLAY\b|X server|display server/i],
    ['dbus', /\bD-?Bus\b/i],
    ['sandbox', /sandbox/i],
  ].filter(([, pattern]) => pattern.test(message)).map(([name]) => name);
  let category = 'unclassified';
  if (/executable[^\n]{0,120}(?:does not exist|doesn't exist|not found)/i.test(message)) category = 'executable-missing';
  else if (/\b(?:EACCES|EPERM)\b|permission denied|operation not permitted/i.test(message)) category = 'permission-denied';
  else if (/error while loading shared libraries|cannot open shared object file|shared librar(?:y|ies)[^\n]{0,120}not found/i.test(message)) category = 'missing-runtime-library';
  else if (/sandbox/i.test(message)) category = 'sandbox-startup';
  else if (/\b(?:ETIMEDOUT|timeout|timed out)\b/i.test(message)) category = 'launch-timeout';
  else if (/failed to launch|browser process[^\n]{0,120}(?:exited|closed)|process exited/i.test(message) || signals.includes('browser-closed')) category = 'browser-process-startup';
  const allowedCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'EPIPE']);
  const code = error && typeof error === 'object' && typeof error.code === 'string' && allowedCodes.has(error.code) ? error.code : null;
  return { category, ...(signals.length ? { signals } : {}), ...(code ? { osErrorCode: code } : {}) };
}
async function submitBootstrap(caseName, value) {
  await page.getByLabel('One-use owner bootstrap').fill(value);
  const responseWait = page.waitForResponse(r => r.url().endsWith('/api/connection/bootstrap'), { timeout: 15000 });
  await page.getByRole('button', { name: 'Open owner session', exact: true }).click();
  const response = await responseWait;
  let body = null;
  try { body = await response.json(); } catch {}
  const expectedText = expectedBootstrapMessage(response, body);
  await page.getByText(expectedText, { exact: true }).waitFor({ state: 'visible' });
  const paragraphs = await page.locator('section[aria-labelledby="connection-heading"] p').allTextContents();
  const visibleMessage = paragraphs.find(x => x.includes('Owner session')) ?? '';
  const readOwnerCookie = async deadline => {
    const remainingMs = deadline - Date.now();
    assert.ok(remainingMs > 0, 'Owner cookie inspection must remain within its bounded diagnostic window.');
    let timer;
    return Promise.race([
      (async () => {
        const stored = (await context.cookies()).find(c => c.name === '__Host-gelt') ?? null;
        const requestUrlEligible = (await context.cookies('http://127.0.0.1:3000')).some(c => c.name === '__Host-gelt');
        return { stored, requestUrlEligible };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('owner-cookie-inspection-timeout')), remainingMs); }),
    ]).finally(() => clearTimeout(timer));
  };
  const cookieDeadline = Date.now() + 1500;
  let cookieObservation = await readOwnerCookie(cookieDeadline);
  while (response.ok() && !cookieObservation.stored && Date.now() < cookieDeadline) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, Math.min(25, cookieDeadline - Date.now())));
    if (Date.now() < cookieDeadline) cookieObservation = await readOwnerCookie(cookieDeadline);
  }
  return record(caseName, response, body, visibleMessage, cookieObservation);
}
function captureDemoOutput(chunk) {
  stdoutCarry += chunk;
  while (true) {
    const end = stdoutCarry.indexOf('\n');
    if (end < 0) return;
    const line = stdoutCarry.slice(0, end);
    stdoutCarry = stdoutCarry.slice(end + 1);
    if (expectGrantNext) {
      expectGrantNext = false;
      if (/^[A-Za-z0-9_-]{43}$/.test(line)) grant = line;
      continue;
    }
    if (line === 'Temporary research-only view ready at http://127.0.0.1:3000/connect') readyLineSeen = true;
    if (line === 'Enter this one-use synthetic owner grant before it expires, then inspect /research:') expectGrantNext = true;
  }
}

function waitForDemoClose(child, timeoutMs) {
  if (child.__geltClosed) return Promise.resolve(true);
  return new Promise(resolveClose => {
    let settled = false;
    const finish = closed => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolveClose(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', onClose);
    if (child.__geltClosed) finish(true);
  });
}
function ownedDemoGroupPresent(pid) {
  if (!demoProcessGroupIsolated || !pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error && typeof error === 'object' && 'code' in error && error.code !== 'ESRCH'; }
}
function signalOwnedDemoGroup(pid, signal) {
  if (!demoProcessGroupIsolated || !pid) return false;
  try { process.kill(-pid, signal); return true; }
  catch (error) { return error && typeof error === 'object' && 'code' in error && error.code !== 'ESRCH'; }
}
async function waitForDemoGroupGone(pid, timeoutMs) {
  if (!demoProcessGroupIsolated) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!ownedDemoGroupPresent(pid)) return true;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  return !ownedDemoGroupPresent(pid);
}
async function stopOwnedDemo() {
  if (!demo) return { closed: true, exitCode: 0, processGroupGone: true, cleanupVerified: true };
  const current = demo;
  if (!current.__geltClosed) {
    try { current.kill('SIGTERM'); } catch {}
    await waitForDemoClose(current, 5000);
  }
  let groupGone = await waitForDemoGroupGone(current.pid, 500);
  if (!current.__geltClosed || !groupGone) {
    launcherShutdownEscalated = true;
    signalOwnedDemoGroup(current.pid, 'SIGTERM');
    await waitForDemoClose(current, 2000);
    groupGone = await waitForDemoGroupGone(current.pid, 2000);
    if (!current.__geltClosed || !groupGone) {
      signalOwnedDemoGroup(current.pid, 'SIGKILL');
      await waitForDemoClose(current, 2000);
      groupGone = await waitForDemoGroupGone(current.pid, 2000);
    }
  }
  const closed = Boolean(current.__geltClosed);
  const exitCode = current.exitCode;
  const cleanupVerified = closed && groupGone && exitCode === 0 && !launcherShutdownEscalated && !demoSpawnErrorSeen;
  return { closed, exitCode, processGroupGone: groupGone, cleanupVerified };
}
function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup-timeout')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
async function closeBrowserForCleanup() {
  if (context) {
    try { await withTimeout(context.close(), 5000); context = null; } catch {}
  }
  if (browser) {
    try { await withTimeout(browser.close(), 5000); browser = null; browserCloseVerified = true; } catch {}
  } else if (!browserLaunchAttempted) browserCloseVerified = true;
  if (browserCloseVerified) {
    for (const path of browserDirs) { try { rmSync(path, { recursive: true, force: true }); } catch {} }
  }
  browserProfileRemoved = browserDirs.every(path => !existsSync(path));
  return browserCloseVerified;
}
try {
  mkdirSync(runRoot, { mode: 0o700 });
  process.env.TMPDIR = runRoot;
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  ({ chromium } = createRequire(join(playwrightRoot, 'node_modules/playwright/index.js'))('playwright'));
  [{ assertLoopbackPortsFree }, { replacePrivate }] = await Promise.all([
    importApp('scripts/research-owner-demo.mjs'),
    importApp('worker/dist/private-files.js'),
  ]);
  await assertLoopbackPortsFree();
  const nodeDir = dirname(process.execPath);
  failureStage = 'owner-demo-startup';
  demoProcessGroupIsolated = true;
  demo = (await import('node:child_process')).spawn(process.execPath, [appFile('scripts/research-owner-demo.mjs'), '--owner-demo-only'], {
    cwd: appRoot,
    env: { PATH: `${nodeDir}:/usr/bin:/bin`, TMPDIR: runRoot, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });
  demo.on('error', () => { demoSpawnErrorSeen = true; });
  demo.on('close', () => { demo.__geltClosed = true; });
  assert.ok(demo.stdout, 'Owned demo launcher must expose its captured startup stream.');
  demo.stdout.setEncoding('utf8');
  demo.stdout.on('data', captureDemoOutput);
  const startDeadline = Date.now() + 45000;
  while (Date.now() < startDeadline && !grant) {
    if (demoSpawnErrorSeen) throw Error('isolated-demo-spawn-failed');
    if (demo.exitCode !== null) throw Error('isolated-demo-exited-before-ready');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  assert.ok(grant && readyLineSeen, 'Isolated launcher should publish one synthetic grant after readiness.');
  const roots = readdirSync(runRoot, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => join(runRoot, x.name));
  const bffRoot = roots.find(x => basename(x).startsWith('gelt-research-owner-bff-'));
  assert.ok(bffRoot, 'Isolated launcher should create its private BFF fixture.');
  const bootstrapPath = join(bffRoot, 'bootstrap.json');
  // Keep Chromium's profile and Playwright's generated user-data directory
  // close to the already-private parent so Unix-domain socket paths stay short.
  const browserScratchRoot = join(privateParent, `b-${randomBytes(4).toString('hex')}`);
  assert.ok(Buffer.byteLength(browserScratchRoot) <= 72, 'Private browser scratch path must leave room for Chromium Unix-domain socket names.');
  mkdirSync(browserScratchRoot, { mode: 0o700 });
  browserDirs.push(browserScratchRoot);
  const profile = join(browserScratchRoot, 'p'), cache = join(browserScratchRoot, 'c');
  for (const x of [profile, cache]) mkdirSync(x, { mode: 0o700 });
  browserProfileRemoved = false;
  browserLaunchAttempted = true;
  failureStage = 'chromium-launch';
  const demoTempDir = process.env.TMPDIR;
  process.env.TMPDIR = browserScratchRoot;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: browserPath, ignoreDefaultArgs: ['--unsafely-disable-devtools-self-xss-warnings', '--disable-ipc-flooding-protection'], env: { PATH: '/usr/bin:/bin', HOME: profile, TMPDIR: browserScratchRoot, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: cache, LANG: 'C.UTF-8', PLAYWRIGHT_BROWSERS_PATH: browserRoot } });
  } catch (error) {
    browserLaunchDiagnostic = classifyBrowserLaunchError(error);
    throw error;
  } finally {
    process.env.TMPDIR = demoTempDir;
  }
  failureStage = 'browser-navigation';
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3000') await route.continue();
    else { externalOrigins.push(url.origin); await route.abort('blockedbyclient'); }
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(20000);
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.enable');
  devtools.on('Network.responseReceivedExtraInfo', event => {
    for (const blocked of event.blockedCookies ?? []) {
      if (typeof blocked.cookieLine !== 'string' || !blocked.cookieLine.startsWith('__Host-gelt=')) continue;
      for (const reason of blocked.blockedReasons ?? []) browserCookieBlockReasons.add(safeCookieBlockReasons.get(reason) ?? 'other');
    }
  });
  await page.goto('http://127.0.0.1:3000/connect');

  await page.evaluate(() => sessionStorage.setItem('gelt-csrf', 'c'.repeat(43)));
  await page.route('**/api/connection/bootstrap', route => route.fulfill({
    status: 502,
    contentType: 'text/plain',
    headers: { 'X-Gelt-Bootstrap-Stage': 'request', 'X-Gelt-Bootstrap-Outcome': 'unavailable' },
    body: '',
  }), { times: 1 });
  failureStage = 'bootstrap-non-json';
  const invalidResponse = await submitBootstrap('non-json-bootstrap-response', 'n'.repeat(43));
  assert.deepEqual([invalidResponse.status, invalidResponse.responseOk, invalidResponse.visibleMessageClass, invalidResponse.stage, invalidResponse.outcome], [502, false, 'owner-session-unavailable', 'request', 'unavailable']);
  assert.equal(observations.at(-1).visibleMessageReportsHttpStatus, true);
  assert.equal(await page.evaluate(() => { const saved = sessionStorage.getItem('gelt-csrf'); return typeof saved === 'string' && /^[A-Za-z0-9_-]{43}$/.test(saved); }), true, 'A non-JSON bootstrap failure must preserve the saved value for a possibly existing owner session.');
  await page.unroute('**/api/connection/bootstrap');

  await replacePrivate(bootstrapPath, JSON.stringify({ digest: createHash('sha256').update(grant).digest('hex'), expiresAt: Date.now() + 30000 }));
  failureStage = 'bootstrap-wrong-grant';
  const wrong = await submitBootstrap('wrong-grant', 'x'.repeat(43));
  assert.deepEqual([wrong.status, wrong.responseOk, wrong.responseBodyVersionValid, wrong.responseBodyErrorPresent, wrong.stage, wrong.outcome, wrong.visibleMessageClass], [403, false, true, true, 'grant-read', 'grant-mismatch', 'owner-session-unavailable']);
  assert.equal(observations.at(-1).visibleMessageReportsHttpStatus, true);
  assert.equal(observations.at(-1).ownerCookieStored, false);

  await replacePrivate(bootstrapPath, JSON.stringify({ digest: createHash('sha256').update(grant).digest('hex'), expiresAt: Date.now() - 1 }));
  failureStage = 'bootstrap-expired';
  const expired = await submitBootstrap('expired-grant', grant);
  assert.deepEqual([expired.status, expired.responseOk, expired.responseBodyVersionValid, expired.responseBodyErrorPresent, expired.stage, expired.outcome, expired.visibleMessageClass], [403, false, true, true, 'grant-read', 'grant-expired', 'owner-session-unavailable']);
  assert.equal(observations.at(-1).visibleMessageReportsHttpStatus, true);
  assert.equal(observations.at(-1).ownerCookieStored, false);

  await replacePrivate(bootstrapPath, JSON.stringify({ digest: createHash('sha256').update(grant).digest('hex'), expiresAt: Date.now() + 30000 }));
  failureStage = 'bootstrap-success';
  const successful = await submitBootstrap('success', grant);
  assert.deepEqual([successful.status, successful.responseOk, successful.responseBodyVersionValid, successful.responseBodyErrorPresent, successful.stage, successful.outcome, successful.csrfShapeValid, successful.visibleMessageClass], [200, true, true, false, 'session-created', 'session-created', true, 'owner-session-opened']);
  assert.equal(observations.at(-1).ownerCookieStored, true);
  assert.equal(await page.evaluate(() => { const saved = sessionStorage.getItem('gelt-csrf'); return typeof saved === 'string' && /^[A-Za-z0-9_-]{43}$/.test(saved); }), true, 'A successful bootstrap must save a restorable CSRF value.');
  failureStage = 'protected-research-navigation';
  await page.goto('http://127.0.0.1:3000/research');
  failureStage = 'protected-research-restore';
  await page.getByRole('button', { name: 'Restore saved CSRF', exact: true }).click();
  failureStage = 'protected-research-library';
  await page.getByRole('button', { name: 'Load research library', exact: true }).click();
  await page.getByText('Research library read complete.', { exact: true }).waitFor({ state: 'visible' });
  failureStage = 'protected-research-detail-open';
  await page.getByRole('button', { name: `Inspect evidence pyportfolioopt-min-variance-e5d60a73f45f77f1edf7234b`, exact: true }).click();
  await page.getByRole('article', { name: 'Research evidence detail' }).waitFor({ state: 'visible' });
  failureStage = 'protected-research-detail-rows';
  assert.equal(await page.getByRole('region', { name: 'Research numeric results' }).locator('tbody tr').count(), 18);
  failureStage = 'protected-research-recommendation';
  assert.equal(await page.getByRole('heading', { name: 'Recommendation: insufficient_evidence', exact: true }).count(), 1);
  failureStage = 'protected-research-not-run';
  assert.equal(await page.getByText('Independent scientific reproduction: not_run.', { exact: true }).count(), 1);
  failureStage = 'protected-research-promotion-status';
  assert.equal(await page.getByText('Promotion allowed: false. Historical evaluation, shadow observation and cost evaluation: not_run.', { exact: true }).count(), 1);

  failureStage = 'bootstrap-replay-navigation';
  await page.goto('http://127.0.0.1:3000/connect');
  failureStage = 'bootstrap-replay';
  const replay = await submitBootstrap('replay', grant);
  assert.deepEqual([replay.status, replay.responseOk, replay.responseBodyVersionValid, replay.responseBodyErrorPresent, replay.stage, replay.outcome, replay.visibleMessageClass], [409, false, true, true, 'grant-read', 'unavailable', 'owner-session-unavailable']);
  assert.equal(observations.at(-1).visibleMessageReportsHttpStatus, true);
  assert.equal(observations.at(-1).ownerCookieStored, true);
  assert.equal(await page.evaluate(() => { const saved = sessionStorage.getItem('gelt-csrf'); return typeof saved === 'string' && /^[A-Za-z0-9_-]{43}$/.test(saved); }), true, 'Replay denial must preserve the saved CSRF for the existing session.');
  failureStage = 'post-replay-research-navigation';
  await page.goto('http://127.0.0.1:3000/research');
  failureStage = 'post-replay-research-restore';
  await page.getByRole('button', { name: 'Restore saved CSRF', exact: true }).click();
  failureStage = 'post-replay-research-library';
  await page.getByRole('button', { name: 'Load research library', exact: true }).click();
  await page.getByText('Research library read complete.', { exact: true }).waitFor({ state: 'visible' });
  assert.deepEqual(externalOrigins, []);
  assert.equal(await closeBrowserForCleanup(), true, 'Chromium close must be confirmed before removing its private profile.');
  assert.equal(browserProfileRemoved, true, 'Synthetic browser profile must be removed after context close.');
  const launcherShutdown = await stopOwnedDemo();
  launcherCleanupVerified = launcherShutdown.cleanupVerified;
  assert.equal(launcherCleanupVerified, true, 'Owned launcher and isolated process group must exit cleanly before fixture removal.');
  const remainder = readdirSync(runRoot);
  assert.deepEqual(remainder, [], 'Only remove this private test root after launcher fixture cleanup is confirmed.');
  rmSync(runRoot, { recursive: true, force: true });
  testRootRemoved = !existsSync(runRoot);
  assert.equal(testRootRemoved, true, 'Synthetic browser root must be removed after owned launcher cleanup.');
  grant = null;
  stdoutCarry = '';
  const report = {
    label: 'SYNTHETIC OFFLINE OWNER SESSION / G01 BROWSER REGRESSION',
    sourceBaseCommit,
    sourceInventory,
    nodeMajor,
    nodeVersion: process.version,
    playwrightVersion: playwrightPackage.version,
    chromiumSha256: sha256File(browserPath),
    observations,
    protectedResearchDetail: 'passed',
    promotionAllowed: false,
    scientificReproduction: 'not_run',
    marketPerformance: 'not_run',
    historicalTesting: 'not_run',
    shadowObservation: 'not_run',
    costEvaluation: 'not_run',
    externalBrowserRequests: externalOrigins.length,
    grantOrTokenValuesPersisted: false,
    cleanup: { ownedLauncherExitCode: demo.exitCode, launcherClosed: Boolean(demo.__geltClosed), launcherProcessGroupGone: launcherShutdown.processGroupGone, launcherShutdownEscalated, launcherCleanupVerified, browserCloseVerified, browserProfileRemoved, privateFixtureRootRemoved: testRootRemoved },
    ownerAcceptance: 'not_claimed',
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  try { await closeBrowserForCleanup(); } catch {}
  let launcherShutdown = { closed: !demo, exitCode: demo ? null : 0, processGroupGone: !demo, cleanupVerified: !demo };
  try { launcherShutdown = await stopOwnedDemo(); } catch {}
  launcherCleanupVerified = launcherShutdown.cleanupVerified;
  if (launcherCleanupVerified && browserProfileRemoved && existsSync(runRoot)) {
    try {
      if (readdirSync(runRoot).length === 0) rmSync(runRoot, { recursive: true, force: true });
    } catch {}
  }
  testRootRemoved = !existsSync(runRoot);
  grant = null;
  stdoutCarry = '';
  const errorName = error instanceof Error ? error.name : '';
  const errorKind = errorName === 'AssertionError' ? 'AssertionError' : errorName === 'TimeoutError' ? 'TimeoutError' : 'Error';
  process.stderr.write(JSON.stringify({ label: 'SYNTHETIC OFFLINE OWNER SESSION / G01 BROWSER REGRESSION', outcome: 'failed', failureStage, errorKind, ...(failureStage === 'chromium-launch' && browserLaunchDiagnostic ? { browserLaunchDiagnostic } : {}), observations, externalBrowserRequests: externalOrigins.length, cleanup: { ownedLauncherExitCode: demo?.exitCode ?? null, launcherClosed: Boolean(demo?.__geltClosed), launcherProcessGroupGone: launcherShutdown.processGroupGone, launcherShutdownEscalated, launcherCleanupVerified, browserCloseVerified, browserProfileRemoved, privateFixtureRootRemoved: testRootRemoved }, ownerAcceptance: 'not_claimed' }) + '\n');
  process.exitCode = 1;
}
