import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { configuration, createWorker } from "./service.js";
import { MAX_REVISION_FLOORS, offlinePiHandoff } from './pi-handoff.js';
import { capabilities, capabilitiesSchema, health, healthSchema } from "./contract.js";

const server = createWorker();
const privateServer = createWorker(undefined, 'service-secret-for-test-only');
let port: number;
let privatePort: number;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => privateServer.listen(0, "127.0.0.1", resolve));
  privatePort = (privateServer.address() as { port: number }).port;
});
afterAll(async () => {
  server.closeAllConnections(); privateServer.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await new Promise<void>(resolve => privateServer.close(() => resolve()));
});
function call(path: string, method = "GET", headers = {}, body?: string, targetPort = port) {
  return new Promise<{ code: number; body: any }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: targetPort, path, method, headers }, res => {
      let text = ""; res.on("data", b => text += b); res.on("end", () => resolve({ code: res.statusCode!, body: text ? JSON.parse(text) : null }));
    }); req.on("error", reject); req.end(body);
  });
}
describe('private offline Pi fixture handoff', () => {
  it('defaults disabled; rejects forged, stale, oversized, cross-session and post-restart reviews without dispatch', async () => {
    const expires = String(Date.now() + 60000), session = 'a'.repeat(43), other = 'b'.repeat(43);
    const headers = { authorization: 'Bearer test-token', 'x-gelt-session': session, 'x-gelt-session-expires': expires, 'content-type': 'application/json' };
    const post = (path: string, value: unknown, extra: Record<string, string> = {}, target = privatePort) => {
      const body = JSON.stringify(value);
      return call('/v1/pi-handoff/' + path, 'POST', { ...headers, 'content-length': String(Buffer.byteLength(body)), ...extra }, body, target);
    };
    expect((await post('status', {})).body).toMatchObject({ enabled: false, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: [] });
    const draft = { account: 'synthetic-pi-account-a', route: 'RHS', instrument: 'BTC-USD', side: 'BUY', type: 'LIMIT', quantity: '0.001', limitPrice: '100.00', revision: 0 };
    expect((await post('prepare', draft)).code).toBe(409);
    const previous = process.env.GELT_OFFLINE_PI_HANDOFF, nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test'; process.env.GELT_OFFLINE_PI_HANDOFF = 'fixture-only';
    let tick = Date.now();
    const fixture = offlinePiHandoff(() => tick);
    const injected = createWorker(undefined, 'service-secret-for-test-only', undefined, undefined, undefined, fixture);
    await new Promise<void>(resolve => injected.listen(0, '127.0.0.1', resolve));
    const injectedPort = (injected.address() as { port: number }).port;
    try {
      expect((await post('status', {}, {}, injectedPort)).body).toMatchObject({ enabled: true, accounts: ['synthetic-pi-account-a', 'synthetic-pi-account-b'], dispatch: false });
      expect((await post('prepare', draft, { authorization: 'Bearer wrong' }, injectedPort)).code).toBe(403);
      expect((await post('prepare', draft, { origin: 'http://evil.test' }, injectedPort)).code).toBe(403);
      expect((await post('prepare', draft, { 'x-gelt-session-expires': '1' }, injectedPort)).code).toBe(403);
      expect((await post('prepare', { ...draft, padding: 'x'.repeat(5000) }, {}, injectedPort)).code).toBe(400);
      expect((await post('prepare', { ...draft, account: 'M3-oauth-account' }, {}, injectedPort)).code).toBe(409);
      const prepared = await post('prepare', draft, {}, injectedPort);
      expect(prepared.code).toBe(200);
      const { id, digest } = prepared.body;
      expect(prepared.body).toMatchObject({ source: 'synthetic-offline-pi-handoff', authority: false, brokerFacts: false, draft });
      const review = { id, digest, draft };
      expect((await post('review', review, { 'x-gelt-session': other }, injectedPort)).code).toBe(409);
      expect((await post('review', { ...review, digest: '0'.repeat(64) }, {}, injectedPort)).code).toBe(409);
      expect((await post('review', { ...review, draft: { ...draft, revision: 1 } }, {}, injectedPort)).code).toBe(409);
      expect((await post('review', { ...review, draft: { ...draft, account: 'synthetic-pi-account-b' } }, {}, injectedPort)).code).toBe(409);
      expect((await post('review', review, {}, injectedPort)).code).toBe(200);
      expect((await post('review', review, {}, injectedPort)).code).toBe(200); // repeated review is not dispatch

      // Regression: invalidating B must not overwrite A's higher revision floor.
      expect((await post('invalidate', { revision: 3 }, {}, injectedPort)).code).toBe(200);
      expect((await post('invalidate', { revision: 1 }, { 'x-gelt-session': other }, injectedPort)).code).toBe(200);
      expect((await post('review', review, {}, injectedPort)).code).toBe(409); // A's prior pending draft was invalidated
      expect((await post('prepare', { ...draft, revision: 2 }, {}, injectedPort)).code).toBe(409); // delayed A revision 2 remains stale
      const freshDraft = { ...draft, revision: 3 };
      const fresh = await post('prepare', freshDraft, {}, injectedPort);
      expect(fresh.code).toBe(200); // A can prepare at its current floor
      const freshReview = { id: fresh.body.id, digest: fresh.body.digest, draft: freshDraft };
      expect((await post('review', freshReview, { 'x-gelt-session': other }, injectedPort)).code).toBe(409); // no cross-session review
      expect((await post('review', freshReview, {}, injectedPort)).code).toBe(200);
      expect((await post('review', freshReview, {}, injectedPort)).code).toBe(200); // repeated review is not dispatch

      const restart = createWorker(undefined, 'service-secret-for-test-only', undefined, undefined, undefined, offlinePiHandoff());
      await new Promise<void>(resolve => restart.listen(0, '127.0.0.1', resolve));
      try { expect((await post('review', freshReview, {}, (restart.address() as { port: number }).port)).code).toBe(409); }
      finally { restart.closeAllConnections(); await new Promise<void>(resolve => restart.close(() => resolve())); }

      expect((await post('invalidate', { revision: 4 }, {}, injectedPort)).code).toBe(200);
      expect((await post('review', freshReview, {}, injectedPort)).code).toBe(409);
      expect((await post('prepare', freshDraft, {}, injectedPort)).code).toBe(409); // delayed pre-edit request
      const nextDraft = { ...draft, revision: 4 };
      const next = await post('prepare', nextDraft, {}, injectedPort);
      expect(next.code).toBe(200);
      tick += 30000;
      const nextReview = { id: next.body.id, digest: next.body.digest, draft: nextDraft };
      expect((await post('review', nextReview, {}, injectedPort)).code).toBe(409); // expired fixture record

      // Fill the bounded table without eviction; overflow permanently closes this instance.
      for (let i = 0; i < MAX_REVISION_FLOORS - 2; i++) {
        const capacitySession = 'c'.repeat(40) + i.toString(36).padStart(3, '0');
        expect((await post('invalidate', { revision: 1 }, { 'x-gelt-session': capacitySession }, injectedPort)).code).toBe(200);
      }
      expect((await post('invalidate', { revision: 5 }, {}, injectedPort)).code).toBe(200); // known floor still updates at capacity
      const overflowDraft = { ...draft, account: 'synthetic-pi-account-b', revision: 1 };
      const overflowPending = await post('prepare', overflowDraft, { 'x-gelt-session': other }, injectedPort);
      expect(overflowPending.code).toBe(200);
      const overflowReview = { id: overflowPending.body.id, digest: overflowPending.body.digest, draft: overflowDraft };
      expect((await post('invalidate', { revision: 1 }, { 'x-gelt-session': 'd'.repeat(43) }, injectedPort)).code).toBe(409);
      expect((await post('review', overflowReview, { 'x-gelt-session': other }, injectedPort)).code).toBe(409); // overflow clears pending state
      expect((await post('status', {}, {}, injectedPort)).body).toMatchObject({ enabled: false, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: [] });
      expect((await post('prepare', { ...draft, revision: 5 }, {}, injectedPort)).code).toBe(409); // overflow remains fail-closed
      expect((await post('invalidate', { revision: 2 }, {}, injectedPort)).code).toBe(409); // no recovery by a later known-session edit
      expect((await post('dispatch', {}, {}, injectedPort)).code).toBe(404);
    } finally {
      injected.closeAllConnections(); await new Promise<void>(resolve => injected.close(() => resolve()));
      if (previous === undefined) delete process.env.GELT_OFFLINE_PI_HANDOFF; else process.env.GELT_OFFLINE_PI_HANDOFF = previous;
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
    }
  });
});
describe("closed contracts", () => {
  it("accepts only honest disabled state", () => {
    expect(healthSchema.parse(health)).toEqual(health);
    expect(capabilitiesSchema.parse(capabilities)).toEqual(capabilities);
    for (const [schema, value] of [[healthSchema, health], [capabilitiesSchema, capabilities]] as const) {
      expect(schema.safeParse({ ...value, extra: true }).success).toBe(false);
      for (const key of Object.keys(value)) {
        const missing = { ...value } as Record<string, unknown>; delete missing[key];
        expect(schema.safeParse(missing).success).toBe(false);
        expect(schema.safeParse({ ...value, [key]: "invalid" }).success).toBe(false);
      }
    }
    expect(capabilitiesSchema.safeParse({ ...capabilities, execution: true }).success).toBe(false);
    expect(capabilitiesSchema.safeParse({ ...capabilities, operations: ["submit"] }).success).toBe(false);
  });
  it("rejects non-loopback configuration and malformed ports", () => {
    expect(configuration({})).toEqual({ host: "127.0.0.1", port: 4100 });
    for (const host of ["0.0.0.0", "::", "localhost", "example.org"]) expect(() => configuration({ WORKER_HOST: host })).toThrow();
    for (const port of ["0", "65536", "1x", "NaN", "", "1.5"]) expect(() => configuration({ WORKER_PORT: port })).toThrow();
  });
});
describe("real local HTTP", () => {
  it("serves validated health and capabilities", async () => {
    expect(await call("/v1/health")).toEqual({ code: 200, body: health });
    expect(await call("/v1/capabilities")).toEqual({ code: 200, body: capabilities });
  });
  it("rejects unsafe Host and Origin", async () => {
    for (const headers of [{ host: "evil.test" }, { origin: "null" }, { origin: "https://evil.test" }, { origin: "http://127.0.0.1:3000" }]) expect((await call("/v1/health", "GET", headers)).code).toBe(403);
  });
  it("rejects other methods, paths, versions, queries and bodies", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) expect((await call("/v1/health", method)).code).toBe(405);
    for (const path of ["/", "/v2/health", "/v1/orders", "/v1/orders/status?x=1", "/v1/credentials", "/mcp", "/v1/health?x=1", "/v1/%68ealth"]) expect((await call(path)).code).toBe(404);
    expect((await call("/v1/health", "GET", { "content-length": "1" })).code).toBe(400);
    expect((await call("/v1/health", "GET", { "transfer-encoding": "chunked" })).code).toBe(400);
  });
  it("keeps the named private order-surface status explicitly disabled", async () => {
    const session = 'a'.repeat(43), expires = String(Date.now() + 60_000);
    const headers = {
      authorization: 'Bearer test-token', 'x-gelt-session': session,
      'x-gelt-session-expires': expires, 'content-type': 'application/json', 'content-length': '2',
    };
    expect((await call('/v1/orders/status', 'POST', { ...headers, authorization: 'Bearer wrong' }, '{}', privatePort)).code).toBe(403);
    const result = await call('/v1/orders/status', 'POST', headers, '{}', privatePort);
    expect(result).toEqual({ code: 200, body: {
      version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false,
      dispatch: false, cancellation: false, reconciliation: false, reason: 'production_adapter_unsupported',
    } });
    const invalidBody = '{"extra":true}';
    expect((await call('/v1/orders/status', 'POST', { ...headers, 'content-length': String(Buffer.byteLength(invalidBody)) }, invalidBody, privatePort)).code).toBe(409);
    expect((await call('/v1/orders/status?x=1', 'POST', headers, '{}', privatePort)).code).toBe(404);
  });
});
