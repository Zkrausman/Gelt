import { randomBytes, createHash } from 'node:crypto';
import { listResearch, readResearch } from '../../worker/src/research-store';
import { MAX_RESEARCH_RESPONSE_BYTES } from '../../worker/src/research-contract';
import { researchDetailInput, researchListResponse, researchDetailResponse } from './research-response';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { readPrivate, consumePrivate } from '../../worker/src/private-files';
import { equalSecret } from '../../worker/src/security';
import { opaque, empty, selectionInput, statusSchema, initiatedSchema, callbackInput } from '../../worker/src/connection-contract';
import { historyPageInputSchema, historyDetailInputSchema, historyListResponseSchema, historyDetailResponseSchema } from '../../worker/src/history-contract';
import { orderSurfaceSchema } from '../../worker/src/contract';
import { handoffDraftSchema, handoffReviewInputSchema, handoffInvalidateInputSchema, handoffResponseSchema, handoffStatusSchema } from '../../worker/src/pi-handoff-contract';
const ORIGIN = 'http://127.0.0.1:3000';
const COOKIE = '__Host-gelt';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const json = (value: Record<string, unknown>, status = 200, extra = {}) => Response.json({ version: 'v1', ...value }, { status, headers: { ...headers, ...extra } });
export class ConnectionBff {
  private session: { id: string; csrf: string; expires: number } | null = null;
  constructor(private configPath?: string, private transport: typeof fetch = fetch, private now = Date.now, private ingressSecret = process.env.GELT_INGRESS_SECRET, private researchRoot = process.env.GELT_RESEARCH_ROOT) {}
  private config() { return z.object({ serviceSecret: opaque }).strict().parse(JSON.parse(readPrivate(this.configPath!).toString('utf8'))); }
  async handle(req: Request, operation: string): Promise<Response> {
    try {
      const url = new URL(req.url);
      // Next synthesizes request.url with localhost; authority comes from raw gated Host, never that synthetic origin.
      if (req.headers.get('host') !== '127.0.0.1:3000') return json({ error: 'forbidden' }, 403);
      if (!this.ingressSecret || !equalSecret(req.headers.get('x-gelt-ingress'), this.ingressSecret)) return json({ error: 'forbidden' }, 403);
      const generated: Record<string, string> = { 'x-forwarded-host': '127.0.0.1:3000', 'x-forwarded-port': '3000', 'x-forwarded-proto': 'http', 'x-forwarded-for': '127.0.0.1' };
      if ([...req.headers].some(([k, v]) => (k === 'forwarded' || k.startsWith('x-forwarded-')) && generated[k] !== v)) return json({ error: 'forbidden' }, 403);
      const callback = operation === 'callback';
      if (!callback && req.headers.get('origin') !== ORIGIN) return json({ error: 'forbidden' }, 403);
      if (url.pathname !== `/api/connection/${operation}` || (!callback && url.search)) return json({ error: 'invalid_request' }, 400);
      if (callback ? req.method !== 'GET' : req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      if (!this.configPath) return json({ error: 'setup_required' }, 503);
      const config = this.config();
      let input: unknown = {};
      if (!callback) {
        if (req.headers.get('content-type') !== 'application/json') return json({ error: 'invalid_request' }, 400);
        // Stream bound rather than trusting Content-Length from the browser.
        if (!req.body) return json({ error: 'invalid_request' }, 400);
        const reader = req.body.getReader(); let bytes = 0; const parts: Uint8Array[] = [];
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; void reader.cancel(); }, 3000);
        try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 4096) throw new Error('input too large'); parts.push(value); } if (timedOut) throw new Error('input timeout'); input = JSON.parse(Buffer.concat(parts).toString('utf8')); }
        finally { clearTimeout(timeout); await reader.cancel(); }
      }
      if (operation === 'bootstrap') {
        const { bootstrap } = z.object({ bootstrap: opaque }).strict().parse(input);
        const path = join(dirname(this.configPath), 'bootstrap.json');
        const grantBytes = readPrivate(path);
        const grant = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int() }).strict().parse(JSON.parse(grantBytes.toString('utf8')));
        if (grant.expiresAt <= this.now() || !equalSecret(createHash('sha256').update(bootstrap).digest('hex'), grant.digest)) return json({ error: 'forbidden' }, 403);
        // Synchronous durable consumption before granting a session; restarts cannot replay.
        consumePrivate(path, grantBytes);
        if (grant.expiresAt <= this.now()) return json({ error: 'forbidden' }, 403);
        this.session = { id: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url'), expires: this.now() + 3600000 };
        return json({ version: 'v1', csrf: this.session.csrf }, 200, { 'Set-Cookie': `${COOKIE}=${this.session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600` });
      }
      const cookies = (req.headers.get('cookie') ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='));
      const s = this.session;
      if (!s || s.expires <= this.now() || cookies.length !== 1 || !equalSecret(cookies[0].slice(COOKIE.length + 1), s.id)) return json({ error: 'unauthorized' }, 401);
      if (!callback && !equalSecret(req.headers.get('x-gelt-csrf'), s.csrf)) return json({ error: 'forbidden' }, 403);
      if (!['status', 'initiate', 'callback', 'discover', 'select', 'disconnect', 'history', 'intent', 'order-status', 'pi-status', 'pi-prepare', 'pi-review', 'pi-invalidate', 'research-list', 'research-detail'].includes(operation)) return json({ error: 'unsupported_operation' }, 404);
      // Research reads share only the owner-session boundary. No account lookup,
      // worker dispatch, provisioning, artifact execution or caller-chosen root.
      if (operation === 'research-list' || operation === 'research-detail') {
        const selected = operation === 'research-detail' ? researchDetailInput.parse(input) : (empty.parse(input), null);
        const result = !this.researchRoot ? { state: 'unavailable' as const } : selected
          ? readResearch(this.researchRoot, selected.evidenceId) : listResearch(this.researchRoot);
        if (this.session !== s || s.expires <= this.now()) return json({ error: 'unauthorized' }, 401);
        const value = operation === 'research-list' && result.state === 'available' && 'items' in result
          ? { state: 'available', items: result.items.map(item => ({ evidenceId: item.evidenceId, state: item.result.state })) }
          : result;
        const schema = operation === 'research-list' ? researchListResponse : researchDetailResponse;
        const payload = schema.parse({ ...value, version: 'v1', sessionExpiresAt: s.expires });
        if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_RESEARCH_RESPONSE_BYTES) throw new Error('research response too large');
        return json(payload);
      }
      if (callback) {
        const keys = [...url.searchParams.keys()];
        if (keys.length !== 2 || new Set(keys).size !== 2 || (!keys.includes('code') && !keys.includes('error')) || !keys.includes('state')) throw new Error('callback rejected');
        input = callbackInput.parse(Object.fromEntries(url.searchParams));
      } else if (operation === 'select') input = selectionInput.parse(input);
      else if (operation === 'history') input = historyPageInputSchema.parse(input);
      else if (operation === 'intent') input = historyDetailInputSchema.parse(input);
      else if (operation === 'pi-prepare') input = handoffDraftSchema.parse(input);
      else if (operation === 'pi-review') input = handoffReviewInputSchema.parse(input);
      else if (operation === 'pi-invalidate') input = handoffInvalidateInputSchema.parse(input);
      else empty.parse(input);
      const body = JSON.stringify(input);
      const workerPath = operation === 'history' ? 'history/list' : operation === 'intent' ? 'history/intent' : operation === 'order-status' ? 'orders/status' : operation.startsWith('pi-') ? `pi-handoff/${operation.slice(3)}` : `connection/${operation}`;
      const response = await this.transport(`http://127.0.0.1:4100/v1/${workerPath}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.serviceSecret}`, 'X-Gelt-Session': s.id, 'X-Gelt-Session-Expires': String(s.expires) }, body });
      // Worker is private but output is still untrusted. Never relay raw errors.
      const reader = response.body?.getReader(); if (!reader) throw new Error('empty worker response');
      let size = 0; const parts: Uint8Array[] = [];
      const maxOutput = operation === 'history' || operation === 'intent' ? 131072 : 32768;
      try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > maxOutput) throw new Error('large worker output'); parts.push(value); } }
      finally { await reader.cancel(); }
      // History may finish after the authoritative owner session expires or is
      // replaced. Classify only that known denial; private-worker errors remain
      // generic and never become a claim about the browser's authenticated state.
      if ((operation === 'history' || operation === 'intent') && (this.session !== s || s.expires <= this.now())) return json({ error: 'unauthorized' }, 401);
      if (!response.ok || this.session !== s || s.expires <= this.now()) throw new Error('worker unavailable');
      const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (operation === 'history') return json(historyListResponseSchema.parse(value) as unknown as Record<string, unknown>);
      if (operation === 'intent') return json(historyDetailResponseSchema.parse(value) as unknown as Record<string, unknown>);
      if (operation === 'order-status') return json(orderSurfaceSchema.parse(value) as unknown as Record<string, unknown>);
      if (operation.startsWith('pi-')) return json((operation === 'pi-prepare' || operation === 'pi-review' ? handoffResponseSchema : handoffStatusSchema).parse(value) as unknown as Record<string, unknown>);
      const output = operation === 'initiate' ? initiatedSchema.parse(value) : statusSchema.parse(value);
      if ('expiresAt' in output && output.expiresAt !== null && output.expiresAt <= this.now()) throw new Error('expired output');
      if (callback) return new Response(null, { status: 303, headers: { ...headers, Location: '/connect' } });
      if (operation === 'disconnect') { this.session = null; return json(output, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }); }
      return json(output);
    } catch {
      // Never include callback URLs, codes, Zod issues, transport errors or provider output.
      if (operation === 'callback') return new Response(null, { status: 303, headers: { ...headers, Location: '/connect' } });
      return json({ version: 'v1', error: 'connection_unavailable' }, 409);
    }
  }
}
// Next production single-process deployment only. No persisted browser sessions.
const globals = globalThis as typeof globalThis & { geltBff?: ConnectionBff };
export function connectionBff() { return globals.geltBff ??= new ConnectionBff(process.env.GELT_BFF_CONFIG); }
