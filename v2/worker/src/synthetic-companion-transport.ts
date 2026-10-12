// Explicitly constructed, private loopback transport for the inert synthetic
// preview kernel. This module is intentionally absent from worker startup/routes.
import { createServer, type Server } from 'node:http';
import { opaque } from './connection-contract.js';
import { equalSecret } from './security.js';
import {
  companionRequestSchema,
  createSyntheticCompanion,
  type CompanionIdentity,
  type CompanionSources,
  type SyntheticCompanion,
} from './synthetic-companion.js';

export const COMPANION_TRANSPORT_MAX_BODY_BYTES = 4096;
export const COMPANION_TRANSPORT_MAX_RESPONSE_BYTES = 8192;
export const COMPANION_TRANSPORT_MAX_CONNECTIONS = 8;
export const COMPANION_TRANSPORT_MAX_CONCURRENCY = 4;
export const COMPANION_TRANSPORT_TIMEOUT_MS = 5000;
const MAX_HEADER_BYTES = 4096;
const approvedHeaders = new Set([
  'host', 'authorization', 'x-gelt-session', 'x-gelt-session-expires',
  'x-companion-identity', 'content-type', 'content-length', 'connection',
  'accept', 'user-agent',
]);
const unavailable = JSON.stringify({ version: 'v1', error: 'companion_unavailable' });
const denied = JSON.stringify({ version: 'v1', error: 'companion_unavailable' });

export interface SyntheticCompanionTransportOptions {
  enabled?: boolean;
  now?: () => number;
  sources?: CompanionSources;
}

interface ProvisionedSession { expiresAt: number }

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}
function strictHeaders(rawHeaders: string[]): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (!approvedHeaders.has(name) || seen.has(name)) return false;
    seen.add(name);
  }
  return true;
}
function safeClock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER - 3_600_000) throw new Error('unavailable');
  return value;
}

/**
 * The returned object is a private provisioning/lifecycle seam, not an HTTP
 * control plane. It is inert unless explicitly enabled and started by its
 * owner. Credentials are returned only to the in-process provisioner and are
 * never put in a URL, response, or log by this transport.
 */
export function createSyntheticCompanionTransport(options: SyntheticCompanionTransportOptions = {}) {
  const enabled = options.enabled === true;
  const now = options.now ?? Date.now;
  const kernel: SyntheticCompanion = createSyntheticCompanion({ enabled, now, sources: options.sources });
  const sessions = new Map<string, ProvisionedSession>();
  let server: Server | undefined;
  let listening = false;
  let starting = false;
  let lifecycleGeneration = 0;
  let activeRequests = 0;

  const revokeAll = () => {
    for (const session of sessions.keys()) {
      try { kernel.revokeSession(session); } catch { /* credential state is removed before kernel status is built */ }
    }
    sessions.clear();
  };
  const pruneSessions = (at: number) => {
    for (const [session, binding] of sessions) {
      if (binding.expiresAt <= at) {
        sessions.delete(session);
        kernel.revokeSession(session);
      }
    }
  };

  const status = () => kernel.status();

  const provisionIdentity = (ownerSession: string, ownerSessionExpiresAt: number): CompanionIdentity => {
    try {
      if (!enabled || !listening || !server?.listening) throw new Error();
      opaque.parse(ownerSession);
      const at = safeClock(now);
      pruneSessions(at);
      const prior = sessions.get(ownerSession);
      if (prior && prior.expiresAt !== ownerSessionExpiresAt) throw new Error();
      const identity = kernel.provision(ownerSession, ownerSessionExpiresAt);
      sessions.set(ownerSession, { expiresAt: ownerSessionExpiresAt });
      return identity;
    } catch {
      throw new Error('companion provisioning unavailable');
    }
  };

  const revokeSession = (ownerSession: string): void => {
    try { opaque.parse(ownerSession); } catch { throw new Error('companion revocation unavailable'); }
    sessions.delete(ownerSession);
    kernel.revokeSession(ownerSession);
  };

  const start = async (port = 0): Promise<number> => {
    if (!enabled || server || starting || !Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('companion listener unavailable');
    starting = true;
    const generation = ++lifecycleGeneration;
    const instance = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (req, res) => {
      const remoteAddress = req.socket.remoteAddress;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.shouldKeepAlive = false;
      void (async () => {
        if (activeRequests >= COMPANION_TRANSPORT_MAX_CONCURRENCY) {
          send(res, 503, unavailable);
          return;
        }
        activeRequests++;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          activeRequests--;
        };
        res.once('finish', release);
        res.once('close', release);
        try {
          const address = instance.address();
          if (!listening || !address || typeof address === 'string' || address.address !== '127.0.0.1'
            || remoteAddress === undefined || !strictHeaders(req.rawHeaders)
            || req.headers.host !== `127.0.0.1:${address.port}`
            || req.method !== 'POST' || req.url !== '/v1/synthetic-companion/preview'
            || req.headers['content-type'] !== 'application/json'
            || req.headers.origin !== undefined || req.headers['transfer-encoding'] !== undefined) {
            send(res, 400, unavailable);
            return;
          }
          const contentLength = req.headers['content-length'];
          if (typeof contentLength !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(contentLength)
            || Number(contentLength) < 2 || Number(contentLength) > COMPANION_TRANSPORT_MAX_BODY_BYTES) {
            send(res, 413, unavailable);
            return;
          }
          if (!isLoopback(remoteAddress)) {
            send(res, 403, denied);
            return;
          }
          const authorization = req.headers.authorization;
          const session = req.headers['x-gelt-session'];
          const sessionExpiryText = req.headers['x-gelt-session-expires'];
          const identityId = req.headers['x-companion-identity'];
          const credentialMatch = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization) : null;
          const sessionExpiresAt = typeof sessionExpiryText === 'string' && /^(?:0|[1-9][0-9]*)$/.test(sessionExpiryText)
            ? Number(sessionExpiryText) : NaN;
          if (!credentialMatch || typeof session !== 'string' || !opaque.safeParse(session).success
            || typeof identityId !== 'string' || !/^[a-f0-9]{32}$/.test(identityId)
            || !Number.isSafeInteger(sessionExpiresAt)) {
            send(res, 403, denied);
            return;
          }
          const at = safeClock(now);
          pruneSessions(at);
          const boundSession = sessions.get(session);
          if (!listening || !boundSession || boundSession.expiresAt !== sessionExpiresAt || sessionExpiresAt <= at) {
            send(res, 403, denied);
            return;
          }

          req.socket.setTimeout(COMPANION_TRANSPORT_TIMEOUT_MS, () => req.destroy());
          const chunks: Buffer[] = [];
          let bodyBytes = 0;
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bodyBytes += bytes.byteLength;
            if (bodyBytes > COMPANION_TRANSPORT_MAX_BODY_BYTES) {
              send(res, 413, unavailable);
              return;
            }
            chunks.push(bytes);
          }
          if (bodyBytes !== Number(contentLength) || !listening) {
            send(res, 400, unavailable);
            return;
          }
          const input: unknown = JSON.parse(Buffer.concat(chunks, bodyBytes).toString('utf8'));
          const request = companionRequestSchema.parse(input);
          if (equalSecret(request.nonce, credentialMatch[1])) throw new Error();
          const preview = kernel.preview(request, {
            remoteAddress,
            session,
            identityId,
            credential: credentialMatch[1],
          });
          if (!listening) {
            send(res, 409, unavailable);
            return;
          }
          const output = JSON.stringify(preview);
          if (Buffer.byteLength(output) > COMPANION_TRANSPORT_MAX_RESPONSE_BYTES) {
            send(res, 503, unavailable);
            return;
          }
          send(res, 200, output);
        } catch {
          send(res, 409, unavailable);
        } finally {
          release();
        }
      })();
    });
    instance.requestTimeout = COMPANION_TRANSPORT_TIMEOUT_MS;
    instance.headersTimeout = 3000;
    instance.keepAliveTimeout = 1000;
    instance.maxHeadersCount = 12;
    instance.maxConnections = COMPANION_TRANSPORT_MAX_CONNECTIONS;
    // Hard wall-clock deadline from TCP accept, including incomplete headers.
    // An idle timeout alone can be extended indefinitely by trickled bytes.
    instance.on('connection', socket => {
      const deadline = setTimeout(() => socket.destroy(), COMPANION_TRANSPORT_TIMEOUT_MS);
      socket.once('close', () => clearTimeout(deadline));
    });
    instance.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    instance.on('error', () => {
      if (server !== instance) return;
      listening = false;
      revokeAll();
      instance.closeAllConnections();
    });
    server = instance;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = () => reject(new Error('companion listener unavailable'));
        instance.once('error', onError);
        instance.listen(port, '127.0.0.1', () => {
          instance.off('error', onError);
          resolve();
        });
      });
      const address = instance.address();
      if (server !== instance || generation !== lifecycleGeneration || !address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error();
      listening = true;
      starting = false;
      return address.port;
    } catch {
      listening = false;
      starting = false;
      revokeAll();
      if (server === instance) server = undefined;
      if (instance.listening) await new Promise<void>(resolve => instance.close(() => resolve()));
      throw new Error('companion listener unavailable');
    }
  };

  const stop = async (): Promise<void> => {
    lifecycleGeneration++;
    listening = false;
    revokeAll();
    const instance = server;
    if (!instance) return;
    instance.closeAllConnections();
    if (instance.listening) {
      await new Promise<void>(resolve => instance.close(() => resolve()));
    } else if (starting) {
      await new Promise<void>(resolve => {
        const onListening = () => {
          instance.off('error', onError);
          instance.closeAllConnections();
          if (instance.listening) instance.close(() => resolve());
          else resolve();
        };
        const onError = () => {
          instance.off('listening', onListening);
          resolve();
        };
        instance.once('listening', onListening);
        instance.once('error', onError);
      });
    }
    if (server === instance) server = undefined;
  };

  return { status, start, stop, provisionIdentity, revokeSession };
}

function send(res: import('node:http').ServerResponse, status: number, body: string): void {
  if (res.destroyed || res.writableEnded) return;
  const bytes = Buffer.byteLength(body);
  res.writeHead(status, { 'Content-Length': String(bytes), Connection: 'close' });
  res.end(body);
}
export type SyntheticCompanionTransport = ReturnType<typeof createSyntheticCompanionTransport>;
