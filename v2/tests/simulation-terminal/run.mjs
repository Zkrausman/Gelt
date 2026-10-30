import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runRecordedTerminal } from '../../scripts/recorded-terminal-demo.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--offline-test-only' || process.env.NODE_ENV !== 'test'
  || process.env.GELT_SYNTHETIC_ORDER_HARNESS !== 'offline-test-only' || process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only') throw Error('Explicit G03 offline test gates required');
assert.equal(Number(process.versions.node.split('.')[0]), 22); assert.notEqual(process.platform, 'win32', 'Hosted sandboxed browser gate is POSIX only');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(repo, 'tests/research-browser/package.json'));
const { chromium, expect } = require('@playwright/test');
const screenshots = process.env.GELT_SIMULATION_SCREENSHOTS;
assert.ok(screenshots && process.env.GELT_TEST_BROWSER_PATH, 'Existing approved browser and evidence paths required');
mkdirSync(screenshots, { recursive: true });
const stages = [], externalOrigins = []; let browser, accepted = false, browserCloseAttempted = false, browserCloseConfirmed = false, failureStage = 'fixture-startup';
const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }); assert.equal(tree.status, 0);
const pass = value => { stages.push(value); console.log('PASS G03 ' + value); };
try {
  await runRecordedTerminal(async ({ grant, snapshot }) => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.GELT_TEST_BROWSER_PATH, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('openterminal-workspace', JSON.stringify({ version: 0, state: {
      widgets: [{ id: 'old-ai', type: 'ai', linked: false }, { id: 'old-portfolio', type: 'portfolio', linked: false }],
      layout: [{ i: 'old-ai', x: 0, y: 0, w: 4, h: 8 }, { i: 'old-portfolio', x: 4, y: 0, w: 4, h: 8 }],
    } })));
    await context.route('**/*', async route => { const url = new URL(route.request().url()); if (url.origin !== 'http://127.0.0.1:3000' && !['data:', 'blob:'].includes(url.protocol)) { externalOrigins.push(url.origin); await route.abort(); } else await route.continue(); });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    try {
      failureStage = 'gelt-home'; await page.goto('http://127.0.0.1:3000/');
      await expect(page).toHaveTitle('Gelt — Evidence workspace');
      await expect(page.getByRole('heading', { name: 'Evidence before execution.', exact: true })).toBeVisible();
      await expect(page.getByText('SAFETY GATE — trading is disabled', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Inspect research evidence →', exact: true })).toHaveAttribute('href', '/research');
      await expect(page.getByRole('link', { name: 'View recorded results →', exact: true })).toHaveAttribute('href', '/simulation');
      await expect(page.locator('input')).toHaveCount(0);
      await expect(page.getByText('OPENTERMINAL', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: join(screenshots, 'GELT-home-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(screenshots, 'GELT-home-narrow.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.setViewportSize({ width: 1280, height: 900 });
      pass('Gelt home explains source limits and links evidence/readiness/results without protected data');
      failureStage = 'unauthenticated-shell'; await page.goto('http://127.0.0.1:3000/simulation');
      await expect(page.getByRole('button', { name: 'Load recorded runs', exact: true })).toBeDisabled();
      await expect(page.locator('tbody tr')).toHaveCount(0);
      const denied = await context.request.post('http://127.0.0.1:3000/api/connection/simulation-list', { headers: { Origin: 'http://127.0.0.1:3000' }, data: {} }); assert.equal(denied.status(), 401);
      pass('unauthenticated shell contains no protected fixture data');
      failureStage = 'synthetic-viewer-login'; await page.goto('http://127.0.0.1:3000/connect'); await page.getByLabel('One-use owner bootstrap').fill(grant);
      await page.getByRole('button', { name: 'Open owner session', exact: true }).click();
      await expect(page.getByText('Owner session opened. Read status; this does not enable an order.', { exact: true })).toBeVisible();
      // Constructed CLIENT response fixtures only: exercise page state isolation,
      // not private-worker auth or actual account/history evidence. Real protected
      // recorded-fixture reads resume after every interception is removed.
      failureStage = 'orders-credential-race'; await page.goto('http://127.0.0.1:3000/orders');
      const credentialInput = page.getByLabel('Restore CSRF', { exact: true });
      await expect(credentialInput).not.toHaveValue('');
      const savedDraft = await credentialInput.inputValue(), accountHandle = 'a'.repeat(43);
      const connectionFixture = label => ({ version: 'v1', state: 'connected', reason: 'ready', expiresAt: Date.now() + 30000,
        accounts: [{ handle: accountHandle, label }], selected: accountHandle, execution: false });
      let seenOld, releaseOld, deliveredOld, statusCalls = 0;
      const oldSeen = new Promise(resolve => { seenOld = resolve; }), oldHeld = new Promise(resolve => { releaseOld = resolve; }), oldDelivered = new Promise(resolve => { deliveredOld = resolve; });
      const statusRoute = '**/api/connection/status', surfaceRoute = '**/api/connection/order-status', piRoute = '**/api/connection/pi-status', historyRoute = '**/api/connection/history';
      await page.route(statusRoute, async route => {
        if (++statusCalls === 1) {
          seenOld(); await oldHeld;
          try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(connectionFixture('Account ••••1111')) }); }
          catch { /* canceled old response is allowed; generation also fences abort-ignoring transports in unit tests */ }
          finally { deliveredOld(); }
        } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(connectionFixture('Account ••••2222')) });
      });
      await page.route(surfaceRoute, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, reconciliation: false, reason: 'production_adapter_unsupported' }) }));
      await page.route(piRoute, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v1', source: 'synthetic-offline-pi-handoff', enabled: false, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: [] }) }));
      await page.route(historyRoute, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v1', accountHandle, account: { ACCOUNT: 'CLIENT-FIXTURE', RHS: true, RHC: false }, items: [{ intentId: 'client-fixture-only', recordedAt: '2026-10-29T00:00:00Z', source: 'intercepted-client-test-only', instrumentId: 'PRIVATE-CLIENT-FIXTURE', side: 'buy', requestedQuantity: '1', requestedLimitPrice: '1', currency: 'USD', executionCount: 0 }], hasMore: false }) }));
      try {
        await page.getByRole('button', { name: 'Read protected status', exact: true }).click(); await oldSeen;
        await credentialInput.fill('client-test-changed-context'); await credentialInput.fill(savedDraft);
        await expect(page.getByText('Credential context changed. Protected results cleared; refresh before use.', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Read protected status', exact: true }).click();
        await expect(page.getByText('Account ••••2222', { exact: true })).toBeVisible();
        releaseOld(); await oldDelivered;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.getByText('Account ••••1111', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Account ••••2222', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Load durable history', exact: true }).click();
        await expect(page.getByText('PRIVATE-CLIENT-FIXTURE', { exact: true })).toBeVisible();
        await credentialInput.fill('another-client-test-context');
        await expect(page.getByText('PRIVATE-CLIENT-FIXTURE', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Account ••••2222', { exact: true })).toHaveCount(0);
        for (const name of ['Request fresh exact preview — unavailable', 'Confirm exact terms — unavailable', 'Request cancel — unavailable']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
      } finally {
        releaseOld();
        for (const pattern of [statusRoute, surfaceRoute, piRoute, historyRoute]) await page.unroute(pattern);
      }
      pass('intercepted CLIENT-ONLY orders credential ABA/late-response and data-clearing regression; no worker/account evidence claim');
      failureStage = 'protected-recorded-read'; await page.goto('http://127.0.0.1:3000/simulation');
      const load = page.getByRole('button', { name: 'Load recorded runs', exact: true }), select = page.getByLabel('Recorded run', { exact: true });
      await load.click(); await expect(select.locator('option')).toHaveCount(3);
      const a = snapshot.runs.find(x => x.id === 'recorded-partial-cancel'), b = snapshot.runs.find(x => x.id === 'recorded-unknown'); assert.ok(a && b);
      await select.selectOption(a.id); await expect(page.getByText('Recorded mock facts loaded. This is a scripted fixture, not an autonomous agent run.', { exact: true })).toBeVisible();
      await page.getByRole('navigation', { name: 'Simulation panels' }).getByRole('button', { name: 'orders', exact: true }).click();
      await expect(page.getByText(`Independent mock order ${a.mock.mockOrderId} · dispatch ${a.mock.dispatchId}`, { exact: true })).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(a.mock.executions.length);
      await expect(page.locator('tbody tr').first()).toContainText(a.mock.executions[0].quantity.value);
      await expect(page.locator('tbody tr').first()).toContainText(a.mock.executions[0].fee.value);
      const layoutOnly = await page.evaluate(() => localStorage.getItem('openterminal-workspace') ?? '');
      assert.ok(layoutOnly.includes('old-ai'), 'retired preferences left untouched but never activated'); assert.equal(layoutOnly.includes(a.mock.dispatchId), false); assert.equal(layoutOnly.includes(a.id), false); assert.equal(layoutOnly.includes(grant), false);
      await page.screenshot({ path: join(screenshots, 'SYNTHETIC-orders-desktop.png'), fullPage: true });
      pass('real G01 login -> protected BFF -> recorded G02 independent partial fill and cancellation');
      // Old cached widgets never activate on the simulation route.
      failureStage = 'panel-whitelist'; await page.keyboard.press('Alt+9'); await expect(page.getByText('AI Assistant', { exact: true })).toHaveCount(0);
      await page.keyboard.press('Control+k'); await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Simulation panels' }).getByRole('button', { name: 'results', exact: true }).click();
      await expect(page.getByText('Cash, positions, P&L and strategy results are unavailable in this fixture view; no value is invented.', { exact: true })).toBeVisible();
      pass('six plain panels; retired shortcuts/cache cannot activate market or AI widgets');
      failureStage = 'late-run-response'; let release, observed, delayedFailed = false; const held = new Promise(r => { release = r; }), seen = new Promise(r => { observed = r; });
      const delayed = async route => { if (route.request().postDataJSON().runId !== a.id) return route.continue(); let response;
        try { response = await route.fetch(); } catch { delayedFailed = true; observed(); return; }
        observed(); await held; try { await route.fulfill({ response }); } catch { /* browser abort is expected */ } };
      await page.route('**/api/connection/simulation-detail', delayed);
      await select.selectOption(a.id); await seen; assert.equal(delayedFailed, false); await expect(page.locator('tbody tr')).toHaveCount(0);
      await select.selectOption(b.id); await expect(page.getByText('No observed mock fills.', { exact: true })).toBeVisible(); release();
      await page.unroute('**/api/connection/simulation-detail', delayed);
      await expect(page.getByText('No observed mock fills.', { exact: true })).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Simulation panels' }).getByRole('button', { name: 'run', exact: true }).click();
      await expect(page.getByText(/UNKNOWN — fenced; no automatic redispatch/)).toBeVisible();
      pass('run switching clears old data and late actual response cannot replace current UNKNOWN fixture');
      failureStage = 'denial-and-recovery'; const forbidden = async route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ version: 'v1', error: 'forbidden' }) });
      await page.route('**/api/connection/simulation-detail', forbidden); await select.selectOption(a.id);
      await expect(page.getByText('Recorded fixture unavailable. No result inferred.', { exact: true })).toBeVisible();
      await expect(load).toBeEnabled(); await expect(page.locator('tbody tr')).toHaveCount(0);
      await page.unroute('**/api/connection/simulation-detail', forbidden); await select.selectOption(b.id);
      await expect(page.getByText(/UNKNOWN — fenced; no automatic redispatch/)).toBeVisible();
      pass('403 clears fixture data without claiming authoritative owner-session expiry; read recovers');
      failureStage = 'narrow-results'; await page.getByRole('navigation', { name: 'Simulation panels' }).getByRole('button', { name: 'results', exact: true }).click();
      await select.selectOption(a.id); await expect(page.locator('tbody tr')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(screenshots, 'SYNTHETIC-results-narrow.png'), fullPage: true });
      await page.getByRole('main').hover(); await page.mouse.wheel(0, 1200);
      await expect(page.getByText('Cash, positions, P&L and strategy results are unavailable in this fixture view; no value is invented.', { exact: true })).toBeInViewport();
      pass('desktop and narrow recorded results are reachable without invented cash/positions/P&L');
      failureStage = 'viewer-expiry'; await page.clock.install({ time: new Date() }); await page.clock.fastForward(3600001);
      await expect(load).toBeDisabled(); await expect(page.locator('tbody tr')).toHaveCount(0);
      await expect(page.getByText('Viewer session expired. Recorded data cleared.', { exact: true })).toBeVisible();
      pass('browser-clock session expiry clears data; real server expiry is separately unit-tested');
      assert.deepEqual(externalOrigins, []);
    } finally { try { await context.close(); } finally { browserCloseAttempted = true; await browser.close(); browserCloseConfirmed = true; browser = null; } }
  });
  accepted = true;
} catch {
  // Locator errors can include fill() values. Never print raw Playwright errors,
  // synthetic grants, request bodies, cookies or CSRF material into CI logs.
  throw Error(`G03 recorded-terminal acceptance failed at ${failureStage}; inspect the non-secret stage receipt`);
} finally {
  if (browser && !browserCloseAttempted) { browserCloseAttempted = true; try { await browser.close(); browserCloseConfirmed = true; } catch { accepted = false; } }
  writeFileSync(join(screenshots, 'SYNTHETIC-results.json'), JSON.stringify({ outcome: accepted ? 'passed' : 'failed', failureStage: accepted ? null : failureStage, browserCloseConfirmed, ownedWebAndSnapshotCleanup: accepted ? 'confirmed' : 'unconfirmed-see-retained-fixtures', label: 'G03 RECORDED SCRIPTED MOCK FIXTURE; NOT AUTONOMOUS AGENT ACCEPTANCE', sourceTree: tree.stdout.trim(), stages, externalOrigins, visualReview: 'pending-pixel-inspection', ownerAcceptance: 'unobserved', agentDecision: 'not_run', productionTrading: 'disabled' }, null, 2));
}
