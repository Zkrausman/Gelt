import { Connection } from "./connection.js";
import { empty, opaque } from "./connection-contract.js";
import type { Ledger } from './ledger.js';
import { readHistory, readIntentHistory } from './order-history.js';
import { equalSecret } from "./security.js";
import { createServer } from "node:http";
import { capabilities, capabilitiesSchema, health, healthSchema, orderSurfaceSchema } from "./contract.js";
import { handoffStatusSchema } from './pi-handoff-contract.js';
import type { OfflinePiHandoff } from './pi-handoff.js';

export function configuration(env: NodeJS.ProcessEnv) {
  const host = env.WORKER_HOST ?? "127.0.0.1";
  const raw = env.WORKER_PORT ?? "4100";
  if (host !== "127.0.0.1") throw new Error("WORKER_HOST must be 127.0.0.1");
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error("Invalid WORKER_PORT");
  return { host, port: Number(raw) };
}

export function createWorker(connection = new Connection(), serviceSecret?: string, ledgerAvailable: () => boolean = () => false, ledger?: Ledger, ownerId?: string, handoff?: OfflinePiHandoff) {
  const server = createServer(async (req, res) => {
    const authority = `127.0.0.1:${(server.address() as { port: number }).port}`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const fail = (code: number) => { res.writeHead(code); res.end(JSON.stringify({ error: "unsupported request" })); };
    if (req.headers.host !== authority || (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`)) return fail(403);
    if (Object.keys(req.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-'))) return fail(403);
    if (req.url?.startsWith('/v1/connection/')) {
      if (!serviceSecret || !equalSecret(req.headers.authorization as string, `Bearer ${serviceSecret}`) || !opaque.safeParse(req.headers['x-gelt-session']).success || req.headers.origin !== undefined) return fail(403);
      const sessionExpires = Number(req.headers['x-gelt-session-expires']);
      if (!Number.isSafeInteger(sessionExpires) || sessionExpires <= Date.now() || sessionExpires > Date.now() + 3600000) return fail(403);
      const operation = req.url.slice('/v1/connection/'.length);
      if (!['status', 'initiate', 'callback', 'discover', 'select', 'disconnect'].includes(operation)) return fail(404);
      if (req.method !== 'POST') return fail(405);
      if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] || !/^\d+$/.test(req.headers['content-length'] ?? '') || Number(req.headers['content-length']) > 4096) return fail(400);
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) throw new Error('large input'); }
        const input = JSON.parse(body), session = req.headers['x-gelt-session'] as string;
        if (!['callback', 'select'].includes(operation)) empty.parse(input);
        let result;
        switch (operation) {
          case 'status': result = connection.status(); break;
          case 'initiate': result = connection.initiate(session, sessionExpires); break;
          case 'callback': result = await connection.callback(session, input); break;
          case 'discover': result = await connection.discover(sessionExpires); break;
          case 'select': result = connection.select(input); break;
          case 'disconnect': result = connection.disconnect(); break;
        }
        return res.end(JSON.stringify(result));
      } catch { res.writeHead(409); return res.end(JSON.stringify({ version: 'v1', error: 'connection_unavailable' })); }
    }
    if (req.url?.startsWith('/v1/history/')) {
      if (!serviceSecret || !equalSecret(req.headers.authorization as string, `Bearer ${serviceSecret}`) || !opaque.safeParse(req.headers['x-gelt-session']).success || req.headers.origin !== undefined) return fail(403);
      const sessionExpires = Number(req.headers['x-gelt-session-expires']);
      if (!Number.isSafeInteger(sessionExpires) || sessionExpires <= Date.now() || sessionExpires > Date.now() + 3600000) return fail(403);
      const path = req.url;
      if (path !== '/v1/history/list' && path !== '/v1/history/intent') return fail(404);
      if (req.method !== 'POST') return fail(405);
      if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] || !/^\d+$/.test(req.headers['content-length'] ?? '') || Number(req.headers['content-length']) > 4096) return fail(400);
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) throw new Error('large input'); }
        const input = JSON.parse(body);
        const scope = connection.selectedAccountScope();
        if (!ledger || !ownerId || !ledgerAvailable() || !scope) throw new Error('history unavailable');
        const result = path === '/v1/history/list' ? readHistory(ledger, ownerId, scope.account, scope.handle, input) : readIntentHistory(ledger, ownerId, scope.account, scope.handle, input);
        return res.end(JSON.stringify(result));
      } catch { res.writeHead(409); return res.end(JSON.stringify({ version: 'v1', error: 'history_unavailable' })); }
    }
    if (req.url?.startsWith('/v1/pi-handoff/')) {
      const operation = req.url.slice('/v1/pi-handoff/'.length);
      if (!['status', 'prepare', 'review', 'invalidate'].includes(operation)) return fail(404);
      if (!serviceSecret || !equalSecret(req.headers.authorization as string, `Bearer ${serviceSecret}`) || !opaque.safeParse(req.headers['x-gelt-session']).success || req.headers.origin !== undefined) return fail(403);
      const sessionExpires = Number(req.headers['x-gelt-session-expires']);
      if (!Number.isSafeInteger(sessionExpires) || sessionExpires <= Date.now() || sessionExpires > Date.now() + 3600000) return fail(403);
      if (req.method !== 'POST') return fail(405);
      if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] || !/^[0-9]+$/.test(req.headers['content-length'] ?? '') || Number(req.headers['content-length']) > 4096) return fail(400);
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) throw new Error('large input'); }
        const input = JSON.parse(body), session = req.headers['x-gelt-session'] as string;
        if (operation === 'status') { empty.parse(input); return res.end(JSON.stringify(handoff ? handoff.status() : handoffStatusSchema.parse({ version: 'v1', source: 'synthetic-offline-pi-handoff', enabled: false, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: [] }))); }
        if (!handoff) throw new Error('fixture disabled');
        if (operation === 'invalidate') return res.end(JSON.stringify(handoff.invalidate(session, input)));
        return res.end(JSON.stringify(operation === 'prepare' ? handoff.prepare(session, input) : handoff.review(session, input)));
      } catch { res.writeHead(409); return res.end(JSON.stringify({ version: 'v1', error: 'handoff_unavailable' })); }
    }
    if (req.url?.startsWith('/v1/orders/') && req.url !== '/v1/orders/status') return fail(404);
    if (req.url === '/v1/orders/status') {
      if (!serviceSecret || !equalSecret(req.headers.authorization as string, `Bearer ${serviceSecret}`) || !opaque.safeParse(req.headers['x-gelt-session']).success || req.headers.origin !== undefined) return fail(403);
      const sessionExpires = Number(req.headers['x-gelt-session-expires']);
      if (!Number.isSafeInteger(sessionExpires) || sessionExpires <= Date.now() || sessionExpires > Date.now() + 3600000) return fail(403);
      if (req.method !== 'POST') return fail(405);
      if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] || !/^[0-9]+$/.test(req.headers['content-length'] ?? '') || Number(req.headers['content-length']) > 4096) return fail(400);
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) throw new Error('large input'); }
        empty.parse(JSON.parse(body));
        return res.end(JSON.stringify(orderSurfaceSchema.parse({
          version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false,
          dispatch: false, cancellation: false, reconciliation: false,
          reason: 'production_adapter_unsupported',
        })));
      } catch { res.writeHead(409); return res.end(JSON.stringify({ version: 'v1', error: 'order_surface_unavailable' })); }
    }
    if (req.method !== "GET") return fail(405);
    if (req.headers["transfer-encoding"] !== undefined || (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0")) return fail(400);
    if (req.url === "/v1/health") return res.end(JSON.stringify(healthSchema.parse(serviceSecret ? { ...health, configuration: "protected" } : health)));
    if (req.url === "/v1/capabilities") return res.end(JSON.stringify(capabilitiesSchema.parse(serviceSecret ? { ...capabilities, ledger: ledgerAvailable(), credentials: true, operations: ['connection.status', 'connection.initiate', 'connection.callback', 'connection.discover', 'connection.select', 'connection.disconnect', 'history.list', 'history.intent', 'orders.status'] } : capabilities)));
    return fail(404);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}
