import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
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
type ForwardFailure = 'overflow' | 'aborted' | 'premature-close' | 'request-error' | 'response-error' | 'trickle';
function controlledForwardRequest(failure: ForwardFailure) {
  let requestCount = 0, requestDestroyCount = 0, responseDestroyCount = 0;
  let trickle: ReturnType<typeof setInterval> | undefined;
  let response: PassThrough | undefined;
  const forwardRequest = ((_: unknown, onResponse: (response: any) => void) => {
    requestCount++;
    const req: any = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => {
      if (!req.destroyed) { req.destroyed = true; requestDestroyCount++; }
      return req;
    };
    req.end = () => {
      queueMicrotask(() => {
        if (failure === 'request-error') { req.emit('error', new Error('injected request error')); return; }
        response = new PassThrough();
        (response as any).statusCode = 200;
        const destroy = response.destroy.bind(response);
        (response as any).destroy = (...args: any[]) => {
          if (!response!.destroyed) responseDestroyCount++;
          return destroy(...args);
        };
        response.once('close', () => { if (trickle) clearInterval(trickle); });
        onResponse(response);
        switch (failure) {
          case 'overflow': response.write(Buffer.alloc(65537)); break;
          case 'aborted':
            response.emit('aborted');
            response.emit('error', new Error('injected late response error'));
            break;
          case 'premature-close': response.emit('close'); break;
          case 'response-error': response.emit('error', new Error('injected response error')); break;
          case 'trickle':
            response.write('x');
            trickle = setInterval(() => response?.write('x'), 5);
            break;
        }
      });
      return req;
    };
    return req;
  }) as unknown as typeof request;
  return {
    forwardRequest,
    get requestCount() { return requestCount; },
    get requestDestroyCount() { return requestDestroyCount; },
    get responseDestroyCount() { return responseDestroyCount; },
    dispose() {
      if (trickle) clearInterval(trickle);
      if (response && !response.destroyed) response.destroy();
    },
  };
}
async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('synthetic browser operation did not settle')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function expectForwardFailure(failure: ForwardFailure, forwardDeadlineMs = 500): Promise<void> {
  enable();
  const controlled = controlledForwardRequest(failure);
  const demo = createSyntheticBrowserDemo(Date.now, {}, { forwardRequest: controlled.forwardRequest, forwardDeadlineMs });
  const port = await demo.start();
  try {
    const page = await bounded(http(port, '/', 'GET'), 1000);
    const csrf = JSON.parse(page.body.match(/const csrf=("[^"]+")/)![1]) as string;
    const cookie = (page.headers['set-cookie'] as string[])[0].split(';')[0];
    const result = await bounded(http(port, '/demo/preview', 'POST', order, { Cookie: cookie, 'X-Demo-CSRF': csrf }), 1500);
    expect(result.status).toBe(409);
    expect(controlled.requestCount).toBe(1);
    expect(controlled.requestDestroyCount).toBe(1);
    expect(controlled.responseDestroyCount).toBe(failure === 'request-error' ? 0 : 1);
  } finally {
    controlled.dispose();
    await demo.close();
    rmSync(dirname(dirname(demo.path)), { recursive: true, force: true });
    delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
    delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  }
}
function enable() {
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
}
function enableApplicationMock() {
  enable();
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
}

it('is opt-in, isolated from the production runtime and serves a visibly synthetic browser page without leaking harness credentials', async () => {
  delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
  expect(() => createSyntheticBrowserDemo()).toThrow('synthetic demo disabled');
  enable(); const demo = createSyntheticBrowserDemo(); const port = await demo.start();
  try {
    const page = await http(port, '/', 'GET');
    expect(page.status).toBe(200);
    expect(page.body).toContain('SYNTHETIC OFFLINE TEST / NOT BROKER DATA');
    expect(page.body).toContain('Confirm exact synthetic terms');
    expect(page.body).toContain('id="price" value="1.00"');
    expect(page.body).not.toContain('Read durable mock state');
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

it('rejects and destroys an oversized internal harness response', async () => {
  await expectForwardFailure('overflow');
});

it('settles once when the internal harness response aborts after headers', async () => {
  await expectForwardFailure('aborted');
});

it('rejects an internal harness response error', async () => {
  await expectForwardFailure('response-error');
});

it('rejects an internal harness request error', async () => {
  await expectForwardFailure('request-error');
});

it('rejects an internal harness response that closes before end', async () => {
  await expectForwardFailure('premature-close');
});

it('enforces an absolute forwarding deadline despite a never-ending response trickle', async () => {
  await expectForwardFailure('trickle', 35);
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

it('explicit application-mock mode displays lifecycle history beside independently read durable mock state', async () => {
  enableApplicationMock();
  let now = Date.parse('2025-02-03T04:05:06.000Z');
  const demo = createSyntheticBrowserDemo(() => now, { applicationMock: true }, { previewDiagnosticsForTest: true });
  const port = await demo.start();
  try {
    const page = await http(port, '/', 'GET');
    expect(page.status).toBe(200);
    expect(page.body).toContain('SYNTHETIC APPLICATION MOCK / NOT OFFICIAL ROBINHOOD OR MCP');
    expect(page.body).toContain('Independent durable application-mock state');
    expect(page.body).toContain('Fixed test fixture quote: 0.90 USD; fixed test fee: 0.01 USD');
    expect(page.body).toContain('Read durable mock state');
    expect((await http(port, '/demo/scenario', 'POST', { dispatch: 'unknown' })).status).toBe(404);
    const csrf = JSON.parse(page.body.match(/const csrf=("[^"]+")/)![1]) as string;
    const auth = { Cookie: (page.headers['set-cookie'] as string[])[0].split(';')[0], 'X-Demo-CSRF': csrf };
    const post = async (op: string, input: unknown = {}) => http(port, `/demo/${op}`, 'POST', input, auth);
    const elements = new Map<string, any>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, { value: id === 'instrument' ? 'SYNTH-RH-USD' : id === 'quantity' ? '0.010' : id === 'price' ? '0.90' : '',
        checked: false, disabled: id === 'confirm', textContent: '', listeners: new Map<string, () => void>(),
        addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn); } });
      return elements.get(id);
    };
    const script = page.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const calls: string[] = [], previews: any[] = [];
    let replacementAttempt = false, replacementIssued = false;
    let replacementStatus: number | 'no-response' = 'no-response';
    const BrowserDate = class extends Date { static now() { return now; } };
    runInNewContext(script!, { Date: BrowserDate, document: { getElementById: element }, fetch: async (path: string, init: { body: string }) => {
      const op = path.slice('/demo/'.length); calls.push(op);
      if (replacementAttempt && op === 'preview') replacementIssued = true;
      const response = await post(op, JSON.parse(init.body));
      if (replacementAttempt && op === 'preview') replacementStatus = response.status;
      if (op === 'preview' && response.status === 200) previews.push(JSON.parse(response.body).value);
      return { ok: response.status === 200, status: response.status, json: async () => JSON.parse(response.body) };
    } });
    await element('resume').onclick();
    await element('preview').onclick();
    expect(element('terms').textContent).toContain('SYNTH-RH-USD');
    expect(element('terms').textContent).toContain('0.90');
    const firstPreview = previews[0];
    expect(firstPreview.terms.order.requestedLimitPrice.value).toBe('0.90');
    element('quantity').value = '0.020';
    element('quantity').listeners.get('input')!();
    expect(element('confirm').disabled).toBe(true);
    expect(element('agree').checked).toBe(false);
    expect(element('terms').textContent).toContain('0.010');
    expect(element('status').textContent).toContain('remains reserved until');
    await element('preview').onclick();
    expect(previews).toHaveLength(1);
    expect(element('status').textContent).toContain('wait for expiry');
    const prematureReplacement = await post('preview', { ...order, instrumentId: 'SYNTH-RH-USD', requestedQuantity: { value: '0.020', precision: 4, scale: 3 }, requestedLimitPrice: { value: '0.90', precision: 3, scale: 2 } });
    expect(prematureReplacement.status).toBe(409);

    now = Date.parse(firstPreview.terms.expiresAt);
    demo.beginPreviewDiagnosticsForTest();
    replacementAttempt = true;
    await element('preview').onclick();
    console.log('SYNTHETIC replacement preview receipt', JSON.stringify({ requestIssued: replacementIssued,
      httpStatus: replacementStatus, ...demo.previewFailureReceiptForTest() }));
    replacementAttempt = false;
    expect(previews).toHaveLength(2);
    const replacement = previews[1];
    expect(replacement.previewId).not.toBe(firstPreview.previewId);
    expect(replacement.terms.order.requestedQuantity.value).toBe('0.020');
    expect(replacement.terms.order.requestedLimitPrice.value).toBe('0.90');
    const staleId = await post('confirm', { previewId: firstPreview.previewId, termsHash: replacement.termsHash });
    expect(staleId.status).toBe(409);
    const mismatchedHash = await post('confirm', { previewId: replacement.previewId, termsHash: firstPreview.termsHash });
    expect(mismatchedHash.status).toBe(409);

    element('agree').checked = true;
    element('agree').onchange();
    expect(element('confirm').disabled).toBe(false);
    await element('confirm').onclick();
    const intentId = element('intent').value;
    expect(intentId).toMatch(/^[0-9a-f-]{36}$/);
    await element('history').onclick();
    expect(element('facts').textContent).toContain('preview-confirmed');
    expect(element('facts').textContent).toContain('broker-acknowledged');
    expect(element('facts').textContent).toContain(intentId);
    const displayedHistory = element('facts').textContent as string;
    expect(displayedHistory).not.toContain(replacement.previewId);
    const publicItems = JSON.parse(displayedHistory.slice(displayedHistory.indexOf('\n') + 1)) as Array<{ facts: Array<Record<string, unknown>> }>;
    expect(publicItems[0].facts.some(fact => fact.syntheticType === 'preview-confirmed')).toBe(true);
    expect(publicItems[0].facts.some(fact => fact.syntheticType === 'dispatch-claimed')).toBe(true);
    expect(publicItems[0].facts.every(fact => !('previewId' in fact))).toBe(true);
    const lifecycleDb = new Database(demo.path, { readonly: true });
    try {
      const storedEvents = lifecycleDb.prepare('SELECT body FROM synthetic_events WHERE intent=? ORDER BY sequence').all(intentId) as { body: string }[];
      const persistedFacts = storedEvents.map(({ body }) => JSON.parse(body) as { type: string; previewId?: string });
      expect(persistedFacts.find(fact => fact.type === 'preview-confirmed')?.previewId).toBe(replacement.previewId);
      expect(persistedFacts.find(fact => fact.type === 'dispatch-claimed')?.previewId).toBe(replacement.previewId);
    } finally { lifecycleDb.close(); }
    await element('mock-state').onclick();
    expect(element('mock-facts').textContent).toContain('gelt-synthetic-robinhood-mock-v1');
    expect(element('mock-facts').textContent).toContain(intentId);
    expect(element('mock-facts').textContent).toContain('accepted');
    expect(element('mock-facts').textContent).not.toContain('confirmationToken');
    expect(calls).toContain('mock-state');

    await element('cancel').onclick();
    expect(element('status').textContent).toContain('acknowledged');
    expect(element('status').textContent).toContain('not terminal proof');
    await element('history').onclick();
    expect(element('facts').textContent).toContain('cancel-acknowledged');
    await element('mock-state').onclick();
    const afterAck = JSON.parse(element('mock-facts').textContent.slice(element('mock-facts').textContent.indexOf('{')));
    expect(afterAck).toMatchObject({ status: 'pending-cancel', cancelAcknowledged: true });
    expect(afterAck.status).not.toBe('canceled');
  } finally {
    await demo.close();
    rmSync(dirname(dirname(demo.path)), { recursive: true, force: true });
    delete process.env.GELT_SYNTHETIC_ORDER_HARNESS;
    delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  }
});
