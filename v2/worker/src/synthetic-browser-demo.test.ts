import { request } from 'node:http';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { createSyntheticBrowserDemo } from './synthetic-browser-demo.js';

const order = { route: 'RHS', instrumentId: 'synthetic-instrument', side: 'buy', requestedQuantity: { value: '0.010', precision: 4, scale: 3 }, requestedLimitPrice: { value: '1.00', precision: 3, scale: 2 }, currency: 'USD' };
async function http(port: number, path: string, method = 'POST', body: unknown = {}, headers: Record<string,string> = {}) {
  const text = JSON.stringify(body);
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: {
      Host: `127.0.0.1:${port}`, ...(method === 'POST' ? { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)) } : {}), ...headers,
    } }, res => { let response = ''; res.on('data', chunk => response += chunk); res.on('end', () => resolve({ status: res.statusCode!, body: response, headers: res.headers })); });
    req.on('error', reject); req.end(method === 'POST' ? text : undefined);
  });
}
function enable() { process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only'; }

it('is opt-in, isolated from the production runtime and serves a visibly synthetic browser page without leaking harness credentials', async () => {
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
  expect(() => createSyntheticBrowserDemo()).toThrow('synthetic demo disabled');
  enable(); const demo = createSyntheticBrowserDemo(); const port = await demo.start();
  try {
    const page = await http(port, '/', 'GET');
    expect(page.status).toBe(200);
    expect(page.body).toContain('SYNTHETIC OFFLINE TEST / NOT BROKER DATA');
    expect(page.body).toContain('Confirm exact synthetic terms');
    expect(page.body).toContain('Each execution-observed fact shows its own observed quantity, price and fee');
    expect(page.body).not.toContain('Bearer ');
    expect(page.body).not.toContain('X-Gelt-Session');
    expect(page.headers['set-cookie']).toEqual([expect.stringContaining('HttpOnly; SameSite=Strict')]);
    // Execute the shipped inline UI script against a small DOM double: any edit
    // after preview must revoke agreement and disable the old exact-term confirm.
    const elements = new Map<string, any>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, { value: id === 'quantity' ? '0.010' : '', checked: false,
        disabled: true, textContent: '', listeners: new Map<string, () => void>(),
        addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn); } });
      return elements.get(id);
    };
    const script = page.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const response = { ok: true, json: async () => ({ value: { previewId: 'synthetic-preview', termsHash: 'a'.repeat(64),
      terms: { order, fee: { value: '0.01' }, expiresAt: new Date(Date.now() + 60000).toISOString() } } }) };
    const historyResponse = { ok: true, json: async () => ({ value: { items: [{ source: 'synthetic-offline-v1', facts: [
      { source: 'synthetic-offline-v1', syntheticType: 'execution-observed', syntheticExecutionId: 'synthetic-fill-1',
        observedQuantity: { value: '0.004', precision: 4, scale: 3 }, observedPrice: { value: '1.01', precision: 3, scale: 2 },
        observedFee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' },
    ] }] } }) };
    let delayResponse = false;
    let releaseResponse: (() => void) | undefined;
    runInNewContext(script!, { document: { getElementById: element }, fetch: (path: string) => path === '/demo/history'
      ? Promise.resolve(historyResponse) : delayResponse
        ? new Promise(resolve => { releaseResponse = () => resolve(response); }) : Promise.resolve(response) });
    await element('preview').onclick();
    element('agree').checked = true;
    element('agree').onchange();
    expect(element('confirm').disabled).toBe(false);
    for (const id of ['instrument', 'quantity', 'price']) {
      expect(element(id).listeners.has('input')).toBe(true);
      element(id).listeners.get('input')!();
      expect(element('confirm').disabled).toBe(true);
      expect(element('agree').checked).toBe(false);
      expect(element('terms').textContent).toContain('No valid preview');
    }
    // Reproduce a late server response after an edit while Preview is in flight.
    delayResponse = true;
    const pendingPreview = element('preview').onclick();
    expect(releaseResponse).toBeTypeOf('function');
    element('quantity').listeners.get('input')!();
    releaseResponse!();
    await pendingPreview;
    expect(element('confirm').disabled).toBe(true);
    expect(element('agree').checked).toBe(false);
    expect(element('terms').textContent).toContain('No valid preview');
    expect(element('status').textContent).toContain('Draft changed during preview');
    await element('history').onclick();
    expect(element('facts').textContent).toContain('SYNTHETIC OFFLINE TEST / NOT BROKER DATA');
    for (const value of ['synthetic-fill-1', '0.004', '1.01', '0.003']) expect(element('facts').textContent).toContain(value);
    expect((await http(port, '/', 'GET', {}, { Host: 'evil' })).status).toBe(403);
    expect((await http(port, '/', 'GET', {}, { Forwarded: 'host=evil' })).status).toBe(403);
  } finally { await demo.close(); rmSync(dirname(dirname(demo.path)), { recursive: true, force: true }); delete process.env.GELT_SYNTHETIC_ORDER_HARNESS; }
});

it('enforces bounded cookie, exact Origin/Host, CSRF, allowlist, expiry and no scenario bridge', async () => {
  enable(); let now = Date.now(); const demo = createSyntheticBrowserDemo(() => now); const port = await demo.start();
  try {
    const page = await http(port, '/', 'GET');
    const csrf = JSON.parse(page.body.match(/const csrf=("[^"]+")/)![1]) as string;
    const cookie = (page.headers['set-cookie'] as string[])[0].split(';')[0];
    const auth = { Cookie: cookie, 'X-Demo-CSRF': csrf };
    expect((await http(port, '/demo/resume', 'POST', {}, auth)).status).toBe(200);
    for (const headers of [{ ...auth, Origin: 'http://evil' }, { ...auth, Host: 'evil' }, { ...auth, 'X-Demo-CSRF': 'bad' }, { ...auth, Cookie: 'demo=bad' }, { ...auth, 'X-Forwarded-Host': 'evil' }])
      expect((await http(port, '/demo/history', 'POST', {}, headers)).status).toBe(403);
    expect((await http(port, '/demo/scenario', 'POST', { dispatch: 'unknown' }, auth)).status).toBe(404);
    expect((await http(port, '/demo/preview?x=1', 'POST', order, auth)).status).toBe(404);
    expect((await http(port, '/demo/history', 'POST', { extra: true }, auth)).status).toBe(409);
    expect((await http(port, '/demo/preview', 'POST', { ...order, extra: true }, auth)).status).toBe(409);
    expect((await http(port, '/demo/preview', 'POST', { ...order, requestedLimitPrice: { value: '1000.00', precision: 6, scale: 2 } }, auth)).status).toBe(409);
    now += 300000;
    expect((await http(port, '/demo/history', 'POST', {}, auth)).status).toBe(403);
    expect((await http(port, '/', 'GET')).status).toBe(403);
  } finally { await demo.close(); rmSync(dirname(dirname(demo.path)), { recursive: true, force: true }); delete process.env.GELT_SYNTHETIC_ORDER_HARNESS; }
});

it('browser preview → exact single-use confirm → synthetic history, runner-only partial/cancel scenario', async () => {
  enable(); const demo = createSyntheticBrowserDemo(); const port = await demo.start();
  try {
    const page = await http(port, '/', 'GET');
    const csrf = JSON.parse(page.body.match(/const csrf=("[^"]+")/)![1]) as string;
    const auth = { Cookie: (page.headers['set-cookie'] as string[])[0].split(';')[0], 'X-Demo-CSRF': csrf };
    const post = async (op: string, input: unknown = {}) => http(port, `/demo/${op}`, 'POST', input, auth);
    expect((await post('resume')).status).toBe(200);
    const response = await post('preview', order); expect(response.status).toBe(200);
    const value = JSON.parse(response.body).value;
    expect(value.terms.order).toEqual(order); expect(value.terms.fee.value).toBe('0.01');
    expect(value).not.toHaveProperty('confirmationToken');
    expect(value.terms).not.toHaveProperty('routing');
    expect((await post('confirm', { previewId: value.previewId, termsHash: '0'.repeat(64) })).status).toBe(409);
    expect((await post('confirm', { previewId: value.previewId, termsHash: value.termsHash })).status).toBe(409);
    const second = JSON.parse((await post('preview', order)).body).value;
    const confirmed = await post('confirm', { previewId: second.previewId, termsHash: second.termsHash });
    expect(confirmed.status, confirmed.body).toBe(200);
    const intent = JSON.parse(confirmed.body).value.syntheticIntentId;
    expect((await post('confirm', { previewId: second.previewId, termsHash: second.termsHash })).status).toBe(409);
    await demo.testRunnerScenario({ reconcile: 'partial' });
    expect((await post('reconcile')).status).toBe(200);
    const firstHistory = JSON.parse((await post('history')).body).value.items[0];
    expect(firstHistory.facts.filter((fact: { syntheticType: string }) => fact.syntheticType === 'execution-observed')).toEqual([
      expect.objectContaining({ source: 'synthetic-offline-v1', syntheticExecutionId: 'synthetic-fill-1',
        observedQuantity: { value: '0.004', precision: 4, scale: 3 }, observedPrice: { value: '1.01', precision: 3, scale: 2 },
        observedFee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' }),
    ]);
    expect(JSON.parse((await post('cancel', { intentId: intent })).body).value.outcome).toBe('acknowledged');
    await demo.testRunnerScenario({ reconcile: 'late-partial' });
    expect((await post('reconcile')).status).toBe(200);
    const history = JSON.parse((await post('history')).body).value.items;
    expect(history[0].source).toBe('synthetic-offline-v1');
    expect(history[0].syntheticIntentId).toBe(intent);
    const executions = history[0].facts.filter((fact: { syntheticType: string }) => fact.syntheticType === 'execution-observed');
    expect(executions).toEqual([expect.objectContaining({ syntheticExecutionId: 'synthetic-fill-1',
      observedQuantity: { value: '0.004', precision: 4, scale: 3 }, observedPrice: { value: '1.01', precision: 3, scale: 2 },
      observedFee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' }),
      expect.objectContaining({ syntheticExecutionId: 'synthetic-fill-2',
        observedQuantity: { value: '0.002', precision: 4, scale: 3 }, observedPrice: { value: '1.02', precision: 3, scale: 2 },
        observedFee: { value: '0.002', precision: 4, scale: 3 }, currency: 'USD' })]);
    expect(executions.every((fact: Record<string, unknown>) => !('requestedQuantity' in fact) && !('requestedLimitPrice' in fact) && !('total' in fact))).toBe(true);
    expect(history[0].facts.every((fact: { source: string }) => fact.source === 'synthetic-offline-v1')).toBe(true);
    expect(history[0]).not.toHaveProperty('intent');
    expect((await post('resume')).status).toBe(409); // cancel acknowledgement did not resolve order
  } finally { await demo.close(); rmSync(dirname(dirname(demo.path)), { recursive: true, force: true }); delete process.env.GELT_SYNTHETIC_ORDER_HARNESS; }
});
