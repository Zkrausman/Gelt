import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { TextDecoder } from 'node:util';
import { canonical } from './ledger-canonical.js';
import {
  syntheticMockAccount, syntheticMockAdmissionSchema, syntheticMockIssuer, syntheticMockAudience,
  syntheticMockOrderViewSchema, syntheticMockPrincipal, syntheticMockSource,
  type SyntheticMockAdmissionInput, type SyntheticMockSubmitInput,
} from './synthetic-mock-robinhood-contract.js';
import { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';

const prefix = '/v1/mock-robinhood/v1';
const maxBodyBytes = 8192;
type Operation = 'orders:admit' | 'orders:submit' | 'orders:read' | 'orders:cancel';
function enabled(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only';
}
function equalSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function response(res: ServerResponse, status: number, value?: unknown): void {
  const body = value === undefined ? '' : JSON.stringify({ version: 1, source: syntheticMockSource, value });
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function claims(operation: Operation) {
  return { issuer: syntheticMockIssuer, audience: syntheticMockAudience, principal: syntheticMockPrincipal,
    account: syntheticMockAccount, scope: operation };
}
function operationFor(method: string, path: string): Operation | undefined {
  if (method === 'POST' && path === `${prefix}/admissions`) return 'orders:admit';
  if (method === 'POST' && path === `${prefix}/orders`) return 'orders:submit';
  if (method === 'GET' && new RegExp(`^${prefix}/orders/[0-9a-f-]{36}$`).test(path)) return 'orders:read';
  if (method === 'POST' && new RegExp(`^${prefix}/orders/[0-9a-f-]{36}/cancel$`).test(path)) return 'orders:cancel';
  return undefined;
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const length = req.headers['content-length'];
  if (typeof length !== 'string' || !/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maxBodyBytes
    || req.headers['transfer-encoding'] !== undefined || req.headers['content-type'] !== 'application/json') throw new Error();
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString('utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBodyBytes) throw new Error();
  }
  if (Buffer.byteLength(text, 'utf8') !== Number(length)) throw new Error();
  return JSON.parse(text);
}

export class SyntheticMockRobinhoodTransport {
  private readonly server: Server;
  private readonly bearer = randomBytes(32).toString('base64url');
  private listening = false;
  private dropNextSubmitResponse = false;
  private portValue?: number;
  readonly client: SyntheticMockRobinhoodClient;
  get port(): number | undefined { return this.portValue; }

  constructor(private readonly store: SyntheticMockRobinhoodStore) {
    if (!enabled()) throw new Error('synthetic mock disabled');
    this.server = createServer((req, res) => { void this.handle(req, res); });
    this.server.requestTimeout = 5000;
    this.server.headersTimeout = 5000;
    this.server.maxHeadersCount = 24;
    this.client = new SyntheticMockRobinhoodClient(() => this.portValue, this.bearer);
  }

  async start(): Promise<number> {
    if (!enabled() || this.listening) throw new Error('synthetic mock unavailable');
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('synthetic mock unavailable');
    this.portValue = address.port;
    this.listening = true;
    return address.port;
  }

  // Test-only response-loss injection runs after the durable submit transaction commits.
  loseNextSubmitResponseForTest(): void {
    if (!enabled()) throw new Error('synthetic mock disabled');
    this.dropNextSubmitResponse = true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = this.server.address();
    const expectedHost = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
    const rawUrl = req.url ?? '';
    const routePath = rawUrl.split('?', 1)[0];
    const operation = operationFor(req.method ?? '', routePath);
    const expectedClaim = operation && canonical(claims(operation));
    const remote = req.socket.remoteAddress;
    if (!enabled() || !this.listening || !address || typeof address === 'string' || address.address !== '127.0.0.1'
      || (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') || req.headers.host !== expectedHost
      || req.headers.origin !== undefined || !equalSecret(req.headers.authorization, `Bearer ${this.bearer}`)
      || !expectedClaim || req.headers['x-gelt-mock-claims'] !== expectedClaim
      || Object.keys(req.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'))
      || rawUrl !== routePath) { response(res, operation ? 403 : 404); return; }
    try {
      if (operation === 'orders:admit') {
        const result = this.store.admit(await readBody(req) as SyntheticMockAdmissionInput);
        response(res, 200, syntheticMockAdmissionSchema.parse(result));
      } else if (operation === 'orders:submit') {
        const result = this.store.submit(await readBody(req) as SyntheticMockSubmitInput);
        if (this.dropNextSubmitResponse) { this.dropNextSubmitResponse = false; req.socket.destroy(); return; }
        response(res, 200, syntheticMockOrderViewSchema.parse(result));
      } else if (operation === 'orders:read') {
        if (req.headers['content-length'] !== undefined || req.headers['transfer-encoding'] !== undefined) { response(res, 400); return; }
        const dispatchId = routePath.slice(`${prefix}/orders/`.length);
        const order = this.store.read(dispatchId);
        if (!order) { response(res, 404); return; }
        response(res, 200, syntheticMockOrderViewSchema.parse(order));
      } else if (operation === 'orders:cancel') {
        const dispatchId = routePath.slice(`${prefix}/orders/`.length, -'/cancel'.length);
        const body = await readBody(req) as { dispatchId?: unknown };
        if (canonical(body) !== canonical({ dispatchId })) { response(res, 400); return; }
        response(res, 200, syntheticMockOrderViewSchema.parse(this.store.cancel(dispatchId)));
      }
    } catch {
      if (!res.destroyed) response(res, 409);
    }
  }

  async close(): Promise<void> {
    if (this.listening) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
      this.listening = false;
      this.portValue = undefined;
    }
    this.store.close();
  }
}

export class SyntheticMockRobinhoodClient {
  constructor(private readonly port: () => number | undefined, private readonly bearer: string,
    private readonly requestTimeoutMs = 5000) {
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 5000 || requestTimeoutMs > 30000
      || (requestTimeoutMs !== 5000 && !enabled())) throw new Error('synthetic mock disabled');
  }

  withRequestTimeoutForTest(timeoutMs: number): SyntheticMockRobinhoodClient {
    if (!enabled() || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 5000 || timeoutMs > 30000)
      throw new Error('synthetic mock disabled');
    return new SyntheticMockRobinhoodClient(this.port, this.bearer, timeoutMs);
  }

  admit(input: SyntheticMockAdmissionInput) { return this.call('POST', '/admissions', 'orders:admit', input, syntheticMockAdmissionSchema); }
  submit(input: SyntheticMockSubmitInput) { return this.call('POST', '/orders', 'orders:submit', input, syntheticMockOrderViewSchema); }
  read(dispatchId: string) { return this.call('GET', `/orders/${dispatchId}`, 'orders:read', undefined, syntheticMockOrderViewSchema); }
  cancel(dispatchId: string) { return this.call('POST', `/orders/${dispatchId}/cancel`, 'orders:cancel', { dispatchId }, syntheticMockOrderViewSchema); }

  readWithScopeForTest(dispatchId: string, claimedScope: Operation) {
    if (!enabled()) return Promise.reject(new Error('synthetic mock disabled'));
    return this.call('GET', `/orders/${dispatchId}`, 'orders:read', undefined, syntheticMockOrderViewSchema, claimedScope);
  }

  private call<T>(method: 'GET' | 'POST', suffix: string, scope: Operation, input: unknown,
    schema: { parse(value: unknown): T }, claimedScope: Operation = scope): Promise<T> {
    const port = this.port();
    if (!port) return Promise.reject(new Error('synthetic mock unavailable'));
    const path = `${prefix}${suffix}`;
    const body = input === undefined ? '' : canonical(input);
    if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) return Promise.reject(new Error('synthetic mock unavailable'));
    return new Promise<T>((resolve, reject) => {
      let req: ClientRequest | undefined;
      let settled = false;
      let responseReceived = false;
      let responseEnded = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const fail = () => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        req?.destroy();
        reject(new Error('synthetic mock unavailable'));
      };
      const settleValue = (value: T) => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        resolve(value);
      };
      const request = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: {
        Host: `127.0.0.1:${port}`, Authorization: `Bearer ${this.bearer}`, 'X-Gelt-Mock-Claims': canonical(claims(claimedScope)),
        ...(input === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body, 'utf8') }),
      }, timeout: this.requestTimeoutMs }, res => {
        responseReceived = true;
        const declared = res.headers['content-length'];
        if (declared !== undefined && (typeof declared !== 'string' || !/^(0|[1-9][0-9]*)$/.test(declared)
          || !Number.isSafeInteger(Number(declared)) || Number(declared) > maxBodyBytes)) {
          fail(); res.destroy(); return;
        }
        if (res.statusCode !== 200) { fail(); res.destroy(); return; }
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        res.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += bytes.byteLength;
          if (receivedBytes > maxBodyBytes) { fail(); res.destroy(); return; }
          chunks.push(bytes);
        });
        res.once('aborted', fail);
        res.once('error', fail);
        res.on('end', () => {
          responseEnded = true;
          try {
            if (!res.complete || res.aborted || receivedBytes > maxBodyBytes) throw new Error();
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, receivedBytes));
            const envelope = JSON.parse(text) as { version?: unknown; source?: unknown; value?: unknown };
            if (envelope.version !== 1 || envelope.source !== syntheticMockSource) throw new Error();
            settleValue(schema.parse(envelope.value));
          } catch { fail(); }
        });
        res.once('close', () => { if (!responseEnded || !res.complete) fail(); });
      });
      req = request;
      deadline = setTimeout(fail, this.requestTimeoutMs);
      request.on('timeout', fail);
      request.on('error', fail);
      request.once('close', () => { if (!responseReceived) fail(); });
      if (input === undefined) request.end(); else request.end(body);
    });
  }
}
