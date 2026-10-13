// Test-runner-owned loopback UI. Never imported by production service, setup or start.
import { randomBytes } from 'node:crypto';
import { createServer, request, type ClientRequest, type IncomingMessage, type Server } from 'node:http';
import { z } from 'zod';
import { orderSchema, ledgerId, decimalSchema } from './ledger-contract.js';
import { createSyntheticOrderHarness } from './synthetic-order-harness.js';
import { syntheticMockOrderViewSchema } from './synthetic-mock-robinhood-contract.js';
import type { PreviewOutcome } from './synthetic-preview-diagnostics.js';

const source = 'synthetic-offline-v1' as const;
const empty = z.object({}).strict();
const draft = orderSchema.refine(order => order.side === 'buy' && order.route === 'RHS');
const preview = z.object({ terms: z.object({ version: z.literal(1), previewId: ledgerId, ownerId: ledgerId, accountId: ledgerId,
  routing: z.object({ provider: z.literal('robinhood-official-mcp'), ACCOUNT: z.string(), RHS: z.string(), RHC: z.string().optional() }).strict(),
  order: orderSchema, fee: decimalSchema, feeCurrency: z.literal('USD'), expiresAt: z.string().datetime(),
}).strict(), confirmationToken: z.string().length(43), termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const confirmation = z.object({ intentId: ledgerId, outcome: z.enum(['acknowledged', 'rejected', 'unknown']) }).strict();
const history = z.object({ items: z.array(z.object({ source: z.literal(source), syntheticIntentId: ledgerId,
  eventCount: z.number().int().min(0).max(1000), facts: z.array(z.discriminatedUnion('syntheticType', [
    z.object({ source: z.literal(source), syntheticType: z.enum([
      'dispatch-attempted', 'order-requested', 'broker-acknowledged', 'reconciliation-observed',
      'preview-confirmed', 'dispatch-claimed', 'dispatch-outcome-unknown', 'reconciliation-unavailable',
      'broker-status-observed', 'cancel-requested', 'cancel-acknowledged',
    ]), occurredAt: z.string().datetime() }).strict(),
    z.object({ source: z.literal(source), syntheticType: z.literal('execution-observed'), occurredAt: z.string().datetime(),
      syntheticExecutionId: z.string().min(1).max(64), observedQuantity: decimalSchema, observedPrice: decimalSchema,
      observedFee: decimalSchema.optional(), currency: z.literal('USD') }).strict(),
  ])).max(1000) }).strict()).max(100) }).strict();
const operations = ['resume', 'preview', 'confirm', 'history', 'reconcile', 'cancel', 'mock-state'] as const;
type Operation = typeof operations[number];
type HarnessOperation = Exclude<Operation, 'mock-state'> | 'mock-history';
const mockState = z.object({ order: syntheticMockOrderViewSchema }).strict();
const maxBody = 4096, maxOutput = 65536, lifetime = 300000;
const forwardDeadlineMs = 45000;
const token = () => randomBytes(32).toString('base64url');

type SyntheticBrowserDemoTestHooks = {
  forwardRequest?: typeof request;
  forwardDeadlineMs?: number;
  previewDiagnosticsForTest?: boolean;
};

// This response shape is deliberately not a broker ledger projection.
const html = (csrf: string, applicationMock: boolean) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic offline order laboratory</title>
<style>body{font:16px system-ui;background:#090e16;color:#edf2fa;margin:2rem auto;max-width:1000px;padding:0 1rem}section{background:#152033;border:1px solid #526584;padding:1rem;margin:1rem 0}input,button{font:inherit;margin:.4rem;padding:.5rem}input{max-width:12rem}button{background:#ffd477;color:#141414;border:0;cursor:pointer}button:disabled{opacity:.5}strong{color:#ffcc64}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<header><h1>Order &amp; execution laboratory</h1><strong>SYNTHETIC OFFLINE TEST / NOT BROKER DATA</strong><p>Separate test-only loopback UI. No account, quote, broker order, execution, fill or fee is real. Production trading remains disabled.</p></header>
<section><h2>01 / BUY LIMIT synthetic draft</h2><label>Instrument ID <input id="instrument" value="${applicationMock ? 'SYNTH-RH-USD' : 'synthetic-instrument'}" maxlength="64"></label><label>Quantity <input id="quantity" value="0.010" maxlength="40" inputmode="decimal"></label><label>Limit USD <input id="price" value="${applicationMock ? '0.90' : '1.00'}" maxlength="40" inputmode="decimal"></label><p>Route RHS; currency USD. Exact decimals only. The lifecycle, not this browser, enforces the fee-inclusive $10 ceiling.</p><button id="resume">Resume if safe</button><button id="preview">Request synthetic preview</button></section>
<section><h2>02 / Exact synthetic confirmation</h2><strong>SYNTHETIC OFFLINE TEST / NOT BROKER DATA</strong><pre id="terms">No preview. No order submitted.</pre><label><input id="agree" type="checkbox"> I confirm these exact synthetic terms, fee-inclusive ≤$10, before the nonrenewable expiry.</label><button id="confirm" disabled>Confirm exact synthetic terms</button></section>
<section><h2>03 / Synthetic history and reconciliation</h2><p>Each execution-observed fact shows its own observed quantity, price and fee (when observed), not requested terms or a projected total.</p><button id="history">Refresh synthetic history</button><button id="reconcile">Reconcile synthetic observations</button><pre id="facts">No synthetic history loaded.</pre><label>Synthetic intent ID for cancel request <input id="intent" maxlength="36"></label><button id="cancel">Request synthetic cancel</button><p>Acknowledgement is not a fill or terminal cancellation. Unknown outcome requires manual review; no automatic retry.</p></section>${applicationMock ? '<section><h2>04 / Independent durable application-mock state</h2><strong>SYNTHETIC APPLICATION MOCK / NOT OFFICIAL ROBINHOOD OR MCP</strong><p>Fixed test fixture quote: 0.90 USD; fixed test fee: 0.01 USD. This reads the separate mock SQLite projection by the confirmed synthetic intent ID. It is independent mock state, not broker evidence.</p><button id="mock-state">Read durable mock state</button><pre id="mock-facts">No mock state read.</pre></section>' : ''}<p role="status" id="status">Ready; test fixture only.</p><footer><strong>SYNTHETIC OFFLINE TEST / NOT BROKER DATA</strong></footer>
<script>const csrf=${JSON.stringify(csrf)},applicationMock=${applicationMock};let active=null,revision=0;const byId=id=>document.getElementById(id);function clear(){revision++;active=null;byId('agree').checked=false;byId('confirm').disabled=true;byId('terms').textContent='No valid preview. No order submitted.'}function draftMatchesActive(){if(!active)return false;const order=active.terms.order,decimal=value=>({value,precision:value.replace('.','').length,scale:(value.split('.')[1]||'').length});return byId('instrument').value===order.instrumentId&&JSON.stringify(decimal(byId('quantity').value))===JSON.stringify(order.requestedQuantity)&&JSON.stringify(decimal(byId('price').value))===JSON.stringify(order.requestedLimitPrice)}function draftEdited(){if(applicationMock&&active){revision++;const matches=draftMatchesActive();byId('agree').checked=false;byId('confirm').disabled=true;byId('status').textContent=matches?'The original admitted preview is restored. Review its exact terms and confirm again if it is still valid.':'Draft changed. This exact admitted mock preview remains reserved until '+active.terms.expiresAt+'. Restore the displayed draft or wait for expiry before requesting another preview.';return}clear()}function showTerms(value){byId('terms').textContent='SYNTHETIC OFFLINE TEST / NOT BROKER DATA\\n'+JSON.stringify(value.terms,null,2)+'\\nFee-inclusive maximum: $10 USD; expiry: '+value.terms.expiresAt}async function call(op,body={}){const r=await fetch('/demo/'+op,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Demo-CSRF':csrf},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error('Synthetic operation unavailable ('+r.status+').');return data.value}async function run(fn){try{byId('status').textContent='Working…';await fn()}catch(e){byId('status').textContent=e.message}}byId('resume').onclick=()=>run(async()=>{await call('resume');byId('status').textContent='Synthetic lifecycle resumed.'});byId('preview').onclick=()=>run(async()=>{if(applicationMock&&active&&Date.parse(active.terms.expiresAt)>Date.now()){byId('status').textContent='An admitted mock preview remains reserved until '+active.terms.expiresAt+'. Restore its exact draft or wait for expiry before requesting another preview.';return}if(applicationMock){revision++;byId('agree').checked=false;byId('confirm').disabled=true}else clear();const submittedRevision=revision;const q=byId('quantity').value,p=byId('price').value;const dec=x=>({value:x,precision:x.replace('.','').length,scale:(x.split('.')[1]||'').length});const value=await call('preview',{route:'RHS',instrumentId:byId('instrument').value,side:'buy',requestedQuantity:dec(q),requestedLimitPrice:dec(p),currency:'USD'});if(submittedRevision!==revision){if(applicationMock){active=value;byId('agree').checked=false;byId('confirm').disabled=true;showTerms(value);byId('status').textContent='Draft changed while the preview was created. Its exact mock admission remains reserved until '+value.terms.expiresAt+'. Restore these displayed terms or wait for expiry.'}else byId('status').textContent='Draft changed during preview. Request a fresh synthetic preview.';return}active=value;showTerms(value);byId('status').textContent='Review exact terms; confirmation is separate.'});for(const id of ['instrument','quantity','price'])byId(id).addEventListener('input',draftEdited);byId('agree').onchange=()=>byId('confirm').disabled=!active||!byId('agree').checked;byId('confirm').onclick=()=>run(async()=>{if(!active||!byId('agree').checked)return;if(applicationMock&&!draftMatchesActive()){byId('agree').checked=false;byId('confirm').disabled=true;byId('status').textContent='The draft differs from the admitted preview. Restore its exact terms or wait for expiry; no order was submitted.';return}const id=active.previewId,hash=active.termsHash;clear();const v=await call('confirm',{previewId:id,termsHash:hash});byId('intent').value=v.syntheticIntentId;byId('status').textContent='Synthetic outcome: '+v.outcome+'; not a broker fill. Refresh history.'});byId('history').onclick=()=>run(async()=>{const v=await call('history');byId('facts').textContent='SYNTHETIC OFFLINE TEST / NOT BROKER DATA\\n'+JSON.stringify(v.items,null,2);byId('status').textContent='Synthetic facts loaded; no broker fills inferred.'});byId('reconcile').onclick=()=>run(async()=>{const v=await call('reconcile');byId('status').textContent='Synthetic reconciliation observations: '+v.observations});byId('cancel').onclick=()=>run(async()=>{const v=await call('cancel',{intentId:byId('intent').value});byId('status').textContent='Synthetic cancellation request: '+v.outcome+'; not terminal proof.'});if(applicationMock)byId('mock-state').onclick=()=>run(async()=>{const dispatchId=byId('intent').value;if(!dispatchId){byId('status').textContent='Confirm a synthetic preview before reading mock state.';return}const value=await call('mock-state',{dispatchId});byId('mock-facts').textContent='SYNTHETIC APPLICATION MOCK / NOT OFFICIAL ROBINHOOD OR MCP\\n'+JSON.stringify(value.order,null,2);byId('status').textContent='Independent durable mock state loaded; no broker facts inferred.'});</script></html>`;

export function createSyntheticBrowserDemo(now: () => number = Date.now, options: { applicationMock?: boolean } = {}, testHooks: SyntheticBrowserDemoTestHooks = {}) {
  if (process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_ORDER_HARNESS !== 'offline-test-only') throw new Error('synthetic demo disabled');
  const applicationMock = options.applicationMock === true;
  if (applicationMock && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only') throw new Error('synthetic demo disabled');
  const requestToHarness = testHooks.forwardRequest ?? request;
  const requestDeadline = testHooks.forwardDeadlineMs ?? forwardDeadlineMs;
  if (!Number.isSafeInteger(requestDeadline) || requestDeadline < 1 || requestDeadline > lifetime) throw new Error('synthetic demo disabled');
  const issuedAt = now();
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || issuedAt > Number.MAX_SAFE_INTEGER - lifetime) throw new Error('synthetic demo disabled');
  const fixture = createSyntheticOrderHarness(now, { applicationMock, previewDiagnosticsForTest: testHooks.previewDiagnosticsForTest });
  let harnessPort = 0;
  const cookie = token(), csrf = token();
  let saved: z.infer<typeof preview> | null = null;
  let closed = false;
  async function forward(op: HarnessOperation, body: unknown): Promise<unknown> {
    const text = JSON.stringify(body);
    const diagnostics = op === 'preview' ? fixture.previewDiagnosticsForTest : undefined;
    diagnostics?.record('demo-forward', 'started');
    return new Promise((resolve, reject) => {
      let settled = false;
      let req: ClientRequest | undefined;
      let res: IncomingMessage | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown, value?: unknown, outcome: PreviewOutcome = 'rejected') => {
        if (settled) return;
        settled = true;
        if (deadline !== undefined) clearTimeout(deadline);
        if (error !== undefined) {
          diagnostics?.record('demo-forward', outcome, res?.statusCode, error);
          try { if (res && !res.destroyed) res.destroy(); } catch { /* keep the operation failed */ }
          try { if (req && !req.destroyed) req.destroy(); } catch { /* keep the operation failed */ }
          reject(Error('synthetic operation unavailable'));
        } else { diagnostics?.record('demo-forward', 'succeeded', res?.statusCode); resolve(value); }
      };
      // This is an absolute bound from request creation through complete body receipt;
      // socket inactivity timeouts alone can be renewed by a peer that keeps trickling.
      deadline = setTimeout(() => finish(Error('synthetic request deadline'), undefined, 'deadline'), requestDeadline);
      try {
        req = requestToHarness({ hostname: '127.0.0.1', port: harnessPort, method: 'POST', path: `/v1/synthetic-orders/${op}`, headers: {
          Host: `127.0.0.1:${harnessPort}`, Authorization: `Bearer ${fixture.auth.bearer}`, 'X-Gelt-Session': fixture.auth.session,
          'X-Gelt-Session-Expires': String(fixture.auth.expiresAt), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text),
        } }, incoming => {
          res = incoming;
          let outputBytes = 0;
          let responseEnded = false;
          const chunks: Buffer[] = [];
          incoming.on('data', chunk => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            outputBytes += bytes.length;
            if (outputBytes > maxOutput) { finish(Error('synthetic response exceeded size limit'), undefined, 'oversized-response'); return; }
            chunks.push(bytes);
          });
          incoming.once('aborted', () => finish(Error('synthetic response aborted'), undefined, 'transport-error'));
          incoming.once('error', () => finish(Error('synthetic response failed'), undefined, 'transport-error'));
          incoming.once('close', () => { if (!responseEnded) finish(Error('synthetic response closed prematurely'), undefined, 'premature-close'); });
          incoming.once('end', () => {
            responseEnded = true;
            try {
              const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const envelope = z.object({ version: z.literal(1), source: z.literal(source), value: z.unknown() }).strict().parse(parsed);
              if (incoming.statusCode !== 200) throw Error();
              finish(undefined, envelope.value);
            } catch { finish(Error('synthetic response unavailable'), undefined, incoming.statusCode === 200 ? 'invalid-response' : 'non-200'); }
          });
        });
        req.once('error', () => finish(Error('synthetic request failed'), undefined, 'transport-error'));
        req.end(text);
      } catch { finish(Error('synthetic request unavailable'), undefined, 'transport-error'); }
    });
  }
  const server: Server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const fail = (status: number) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ source, error: 'synthetic operation unavailable' })); };
    const address = server.address();
    if (closed || !address || typeof address === 'string' || address.address !== '127.0.0.1' || req.headers.host !== `127.0.0.1:${address.port}`
      || Object.keys(req.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'))) return fail(403);
    if (req.method === 'GET' && req.url === '/' && req.headers.origin === undefined) {
      if (now() < issuedAt || now() >= issuedAt + lifetime) return fail(403);
      res.setHeader('Set-Cookie', `demo=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html(csrf, applicationMock));
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/demo/') || !operations.includes(req.url.slice(6) as Operation)) return fail(404);
    if (req.headers.origin !== `http://127.0.0.1:${address.port}` || req.headers.cookie !== `demo=${cookie}` || req.headers['x-demo-csrf'] !== csrf || (req.url.slice(6) === 'mock-state' && !applicationMock)
      || now() < issuedAt || now() >= issuedAt + lifetime) return fail(403);
    if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] !== undefined || !/^[0-9]+$/.test(req.headers['content-length'] ?? '')
      || Number(req.headers['content-length']) > maxBody) return fail(400);
    try {
      let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > maxBody) throw Error(); }
      if (Buffer.byteLength(text) !== Number(req.headers['content-length'])) throw Error();
      const input: unknown = JSON.parse(text);
      const op = req.url.slice(6) as Operation;
      let value: unknown;
      switch (op) {
        case 'resume': empty.parse(input); value = z.object({ ready: z.literal(true) }).strict().parse(await forward(op, {})); break;
        case 'preview': {
          if (applicationMock && saved && Date.parse(saved.terms.expiresAt) > now()) throw Error();
          saved = null;
          const result = preview.parse(await forward(op, draft.parse(input)));
          saved = result;
          value = { previewId: result.terms.previewId, termsHash: result.termsHash,
            terms: { order: result.terms.order, fee: result.terms.fee, feeCurrency: result.terms.feeCurrency, expiresAt: result.terms.expiresAt } };
          break;
        }
        case 'confirm': {
          const selected = z.object({ previewId: ledgerId, termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(input);
          const pending = saved;
          const matches = !!pending && pending.terms.previewId === selected.previewId && pending.termsHash === selected.termsHash;
          if (!applicationMock || matches) saved = null; // fallback attempts are single-use; stale mock confirmations retain the current preview
          if (!pending || !matches) throw Error();
          if (Date.parse(pending.terms.expiresAt) <= now()) throw Error();
          const result = confirmation.parse(await forward(op, { confirmationToken: pending.confirmationToken, termsHash: pending.termsHash }));
          value = { syntheticIntentId: result.intentId, outcome: result.outcome }; break;
        }
        case 'history': empty.parse(input); value = history.parse(await forward(op, {})); break;
        case 'reconcile': empty.parse(input); value = z.object({ observations: z.number().int().min(0).max(1000) }).strict().parse(await forward(op, {})); break;
        case 'cancel': value = z.object({ outcome: z.enum(['acknowledged', 'unknown']) }).strict().parse(await forward(op, z.object({ intentId: ledgerId }).strict().parse(input))); break;
        case 'mock-state': {
          const query = z.object({ dispatchId: ledgerId }).strict().parse(input);
          value = mockState.parse(await forward('mock-history', query));
          break;
        }
      }
      const output = JSON.stringify({ version: 1, source, value });
      if (Buffer.byteLength(output) > maxOutput) throw Error();
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(output);
    } catch (error) {
      if (req.url === '/demo/preview') fixture.previewDiagnosticsForTest?.record('demo-validation', 'rejected', 409, error);
      fail(409);
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  return {
    path: fixture.path,
    beginPreviewDiagnosticsForTest: () => fixture.previewDiagnosticsForTest?.reset(),
    previewFailureReceiptForTest: () => fixture.previewDiagnosticsForTest?.receipt(),
    start: async () => {
      if (closed || process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_ORDER_HARNESS !== 'offline-test-only') throw Error('synthetic demo disabled');
      harnessPort = await fixture.start();
      try { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); }
      catch (error) { await fixture.close(); throw error; }
      return (server.address() as {port: number}).port;
    },
    close: async () => { closed = true; server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); await fixture.close(); },
    // Only the test runner holds this closure. No browser operation can configure scenarios or restart.
    testRunnerScenario: async (input: { dispatch?: 'accepted' | 'rejected' | 'unknown'; reconcile?: 'partial' | 'late-partial' | 'canceled' | 'filled' | 'unknown' }) => {
      const text = JSON.stringify(input);
      return new Promise<void>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: harnessPort, path: '/v1/synthetic-orders/scenario', method: 'POST', headers: {
          Host: `127.0.0.1:${harnessPort}`, Authorization: `Bearer ${fixture.auth.bearer}`, 'X-Gelt-Session': fixture.auth.session,
          'X-Gelt-Session-Expires': String(fixture.auth.expiresAt), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text),
        } }, res => { res.resume(); res.on('end', () => res.statusCode === 200 ? resolve() : reject(Error('scenario unavailable'))); });
        req.on('error', reject); req.end(text);
      });
    },
  };
}
