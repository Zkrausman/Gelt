// Offline integration: real built Next -> existing ingress/owner BFF -> core store.
// Genuine Playwright interactions. Synthetic owner session only; no broker or market data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
if (process.argv.length !== 3 || process.argv[2] !== '--offline-test-only' || process.env.NODE_ENV !== 'test' || process.env.GELT_OFFLINE_RESEARCH !== 'fixture-only') throw Error('Explicit offline research test gates required');
const repo = resolve(process.env.GELT_TEST_REPO_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
const moduleAt = p => import(pathToFileURL(join(repo, 'v2', p)).href);
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
const { root, childEnvironment } = await moduleAt('scripts/runtime.mjs');
const { storageFixture } = await moduleAt('worker/dist/storage-fixture.js');
const { writePrivateNew, replacePrivate } = await moduleAt('worker/dist/private-files.js');
const { provisionResearch, importResearchFile } = await moduleAt('worker/dist/research-store.js');
const { researchFixture } = await moduleAt('worker/dist/research-fixture.js');
const dirs = [];
const dir = () => { const path = storageFixture('gelt-research-http-'); dirs.push(path); return path; };
let web, browser, context, output = '';
const screenshots = resolve(process.env.GELT_RESEARCH_SCREENSHOTS ?? join(repo, 'tests', 'research-browser', 'test-results', 'synthetic-research-playwright'));
mkdirSync(screenshots, { recursive: true });
const completed = [], externalRequests = [];
let outcome = 'failed';
const pass = name => { completed.push(name); console.log(`PASS ${name}`); };
const deadline = setTimeout(() => { console.error('Playwright acceptance deadline exceeded'); process.exitCode = 1; void browser?.close(); if (web?.connected) web.send({ type: 'gelt:shutdown' }); }, 180000);
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
try {
  const bffRoot = dir(), research = dir(), sourceRoot = dir();
  provisionResearch(research, [bffRoot, dir(), dir(), dir(), dir()]);
  const original = readFileSync(join(repo, 'research/paper2agent/artifacts/evidence.json'));
  assert.equal(createHash('sha256').update(original).digest('hex'), 'c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96');
  const source = join(sourceRoot, 'evidence.json'); writePrivateNew(source, original.toString('utf8'));
  const imported = importResearchFile(research, source), evidenceId = imported.record.evidence.evidenceId;
  const precision = researchFixture(); precision.evidenceId = 'synthetic-raw-zero-mismatch';
  const precisionBytes = Buffer.from(JSON.stringify({ ...precision, results: '__RAW__' }).replace('"__RAW__"',
    '[{"name":"synthetic precision mismatch","actual":9007199254740992,"expected":9007199254740993,"absoluteTolerance":0,"relativeTolerance":0}]'));
  const precisionSource = join(sourceRoot, 'precision.json'); writePrivateNew(precisionSource, precisionBytes);
  const precisionImported = importResearchFile(research, precisionSource);
  assert.equal(precisionImported.record.geltChecks.numericComparison.status, 'failed');
  const bff = join(bffRoot, 'bff.json'); writePrivateNew(bff, JSON.stringify({ serviceSecret: randomBytes(32).toString('base64url') }));
  await start(bff, research);
  const browserHome = dir(), browserTemp = dir();
  const browserEnv = process.platform === 'win32'
    ? { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: 'C:\\Windows\\System32;C:\\Windows', USERPROFILE: browserHome, LOCALAPPDATA: browserHome, APPDATA: browserHome, TEMP: browserTemp, TMP: browserTemp }
    : { PATH: '/usr/bin:/bin', HOME: browserHome, TMPDIR: browserTemp, XDG_CONFIG_HOME: browserHome, XDG_CACHE_HOME: browserHome, LANG: 'C.UTF-8' };
  browser = await chromium.launch({ env: browserEnv, headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--unsafely-disable-devtools-self-xss-warnings', '--disable-ipc-flooding-protection'], ...(process.env.GELT_TEST_BROWSER_PATH ? { executablePath: process.env.GELT_TEST_BROWSER_PATH } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3000') await route.continue();
    else { externalRequests.push(`${url.protocol}//${url.host}`); await route.abort('blockedbyclient'); }
  });
  const page = await context.newPage();
  await page.clock.install(); // Install before any application timers are created.
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(20000);
  async function screenshot(name) {
    // Label evidence pixels, but never replace application data or network responses.
    await page.evaluate(() => {
      document.getElementById('gelt-test-artifact-label')?.remove();
      const label = document.createElement('div'); label.id = 'gelt-test-artifact-label';
      label.textContent = 'SYNTHETIC OFFLINE SESSION / REFERENCE COMPUTATION / NOT BROKER OR MARKET DATA';
      label.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#fff;color:#000;border:3px solid #c00;padding:8px;font:14px monospace;text-align:center'; document.body.append(label);
    });
    await page.screenshot({ path: join(screenshots, `SYNTHETIC-${name}.png`), fullPage: true, animations: 'disabled', mask: [page.getByLabel('CSRF token', { exact: true }), page.getByLabel('One-use owner bootstrap')] });
  }
  async function login() {
    const bootstrap = randomBytes(32).toString('base64url');
    replacePrivate(join(bffRoot, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: Date.now() + 30000 }));
    await page.goto('http://127.0.0.1:3000/connect');
    await page.getByLabel('One-use owner bootstrap').fill(bootstrap);
    await page.getByRole('button', { name: 'Open owner session', exact: true }).click();
    await expect(page.getByText('Owner session opened. Read status; this does not enable an order.', { exact: true })).toBeVisible();
    await page.goto('http://127.0.0.1:3000/research');
    await expect(page.getByRole('button', { name: 'Load research library' })).toBeEnabled();
  }
  async function loadDetail() {
    await page.getByRole('button', { name: 'Load research library' }).click();
    await page.getByRole('button', { name: `Inspect evidence ${evidenceId}`, exact: true }).click();
    await expect(page.getByRole('article', { name: 'Research evidence detail' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Research numeric results' }).locator('tbody tr')).toHaveCount(18);
    await expect(page.getByText('Independent scientific reproduction: not_run.', { exact: true })).toBeVisible();
  }
  async function verifyVerticalNavigation(label) {
    const main = page.getByRole('main', { name: 'Research evidence workspace' });
    const numeric = page.getByRole('region', { name: 'Research numeric results' });
    const tail = page.getByText('This reference computation does not establish a trading strategy, market edge, broker execution, or permission to activate one.', { exact: true });
    await main.focus(); await page.keyboard.press('Home');
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(0);
    const bounds = await main.boundingBox(); assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
    // Actual wheel events, never a script that assigns scrollTop. A screenshot
    // of offscreen content cannot substitute for user-reachable scrolling.
    for (let step = 0; step < 30; step++) {
      const box = await numeric.boundingBox(), height = page.viewportSize().height;
      if (box && box.y < height - 80 && box.y + box.height > 80) break;
      await page.mouse.wheel(0, Math.floor(height / 2)); await page.waitForTimeout(50);
    }
    await expect(numeric).toBeInViewport();
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await screenshot(`${label}-numeric-wheel`);
    await main.focus(); await page.keyboard.press('End');
    await expect(tail).toBeInViewport(); await screenshot(`${label}-bottom-keyboard`);
    await main.focus(); await page.keyboard.press('Home');
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(0);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
    await page.mouse.wheel(0, 100000);
    await expect(tail).toBeInViewport();
    await page.getByRole('heading', { name: 'Recommendation: insufficient_evidence', exact: true }).scrollIntoViewIfNeeded();
    await screenshot(`${label}-recommendation`);
    pass(`${label}: actual wheel reaches numbers/bottom; keyboard End reaches final recommendation`);
  }
  await page.goto('http://127.0.0.1:3000/research');
  await expect(page.getByRole('button', { name: 'Load research library' })).toBeDisabled();
  await screenshot('unauthenticated-desktop');
  await login(); await loadDetail(); await screenshot('evidence-desktop');
  pass('Real browser bootstrap -> protected Next BFF -> immutable store -> 18 actual reference outputs');
  await page.getByRole('button', { name: `Inspect evidence ${precision.evidenceId}`, exact: true }).click();
  await expect(page.getByText(/Numeric comparison: failed/)).toBeVisible();
  await expect(page.getByText(/Zero-tolerance results compare exact original decimal values: 1 compared, 1 unequal/)).toBeVisible();
  const precisionTable = page.getByRole('region', { name: 'Research numeric results' });
  await precisionTable.scrollIntoViewIfNeeded();
  await expect(precisionTable.getByRole('cell', { name: '9007199254740992', exact: true })).toHaveCount(2);
  await expect(page.getByText(/Identical displayed values can therefore fail the exact comparison/)).toBeVisible();
  await screenshot('raw-zero-mismatch-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await precisionTable.scrollIntoViewIfNeeded();
  await expect(page.getByText(/Identical displayed values can therefore fail the exact comparison/)).toBeVisible();
  await screenshot('raw-zero-mismatch-narrow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadDetail();
  pass('Synthetic raw zero-tolerance mismatch fails; rounded equal table values have an exact-comparison explanation at desktop and narrow widths');
  await verifyVerticalNavigation('desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('evidence-narrow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'narrow viewport must not overflow document');
  await verifyVerticalNavigation('narrow');
  await page.getByRole('button', { name: 'Clear evidence', exact: true }).focus();
  await page.keyboard.press('Enter'); await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Evidence cleared.');
  pass('Narrow viewport and keyboard Clear evidence');
  await loadDetail(); await page.reload(); await expect(page.getByRole('article')).toHaveCount(0);
  await loadDetail(); await page.getByLabel('CSRF token', { exact: true }).fill('invalid');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load research library' }).click();
  await expect(page.getByRole('status')).toContainText('Protected research read failed.');
  await screenshot('csrf-rejected');
  await page.getByRole('button', { name: 'Restore saved CSRF' }).click(); await loadDetail();
  pass('Reload clears evidence; invalid CSRF rejected and clears protected display');
  // Delay a REAL response only; never fabricate status or evidence payloads.
  let release, observed, delivered, rejectWait, rejectDelivery;
  const delivery = new Promise((resolve, reject) => { delivered = resolve; rejectDelivery = reject; });
  const waiting = new Promise((resolve, reject) => { observed = resolve; rejectWait = reject; });
  // Attach handlers immediately so a fetch failure cannot become an unhandled rejection.
  void delivery.catch(() => {}); void waiting.catch(() => {});
  const held = new Promise(resolve => { release = resolve; });
  const routeTimer = setTimeout(() => { const error = Error('Held response timed out'); rejectWait(error); rejectDelivery(error); release(); }, 15000);
  await page.route('**/api/connection/research-detail', async route => {
    try { const response = await route.fetch({ timeout: 10000 }); observed(); await held; await route.fulfill({ response }); delivered(); }
    catch (error) { rejectWait(error); rejectDelivery(error); }
  });
  await page.getByRole('button', { name: `Inspect evidence ${evidenceId}`, exact: true }).click();
  await waiting;
  await page.getByRole('button', { name: 'Clear evidence', exact: true }).click(); release(); await delivery; clearTimeout(routeTimer);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.unroute('**/api/connection/research-detail');
  await page.getByRole('button', { name: 'Load research library' }).dblclick();
  await expect(page.getByRole('button', { name: `Inspect evidence ${evidenceId}`, exact: true })).toBeEnabled();
  pass('Delayed genuine response after Clear cannot restore evidence; repeated library action recovers');
  await loadDetail();
  await page.getByRole('link', { name: 'Workspace', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await expect(page.getByRole('heading', { name: 'Order & execution workspace', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('http://127.0.0.1:3000/research');
  await expect(page.getByRole('button', { name: 'Load research library' })).toBeEnabled();
  await expect(page.getByRole('article')).toHaveCount(0); await loadDetail();
  await stop(); await start(bff, research);
  await page.getByRole('button', { name: 'Load research library' }).click();
  await expect(page.getByRole('status')).toContainText('Owner session unavailable');
  await expect(page.getByRole('article')).toHaveCount(0);
  await login(); await loadDetail();
  pass('Navigation clears evidence; real service restart invalidates session and retains immutable artifact');
  const path = join(research, `evidence-${evidenceId}.json`), storedOriginal = readFileSync(path, 'utf8'), corrupt = JSON.parse(storedOriginal);
  corrupt.originalSha256 = '0'.repeat(64); replacePrivate(path, JSON.stringify(corrupt));
  await page.getByRole('button', { name: `Inspect evidence ${evidenceId}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evidence corrupt', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0); await screenshot('tamper-fails-closed');
  await page.getByRole('button', { name: 'Load research library' }).click();
  await expect(page.getByRole('button', { name: `Inspect evidence ${evidenceId}`, exact: true })).toBeDisabled();
  pass('Actual on-disk tamper is re-read, fails closed and disables selection');
  // Browser-only clock advancement exercises UI expiry, not server-time expiry.
  replacePrivate(path, storedOriginal);
  await loadDetail();
  await page.clock.fastForward(3600001);
  await expect(page.getByRole('status')).toContainText('Owner session expired. Evidence cleared.');
  await expect(page.getByRole('article')).toHaveCount(0); await screenshot('ui-expiry');
  pass('Browser clock advances UI expiry and clears evidence; server expiry remains unit-tested');
  assert.deepEqual(externalRequests, []);
  pass('No external browser network requests; no broker process or credentials');
  outcome = 'passed';
} finally {
  clearTimeout(deadline);
  await context?.close(); await browser?.close(); await stop();
  dirs.reverse().forEach(path => rmSync(path, { recursive: true, force: true }));
  writeFileSync(join(screenshots, 'SYNTHETIC-results.json'), JSON.stringify({ label: 'SYNTHETIC OFFLINE SESSION; REFERENCE COMPUTATION ONLY', outcome, completed, externalRequests, visualApproval: 'pending-human-pixel-review', scientificReproduction: 'not_run', productionTrading: 'disabled' }, null, 2));
}
