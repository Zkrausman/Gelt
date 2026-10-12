import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { connect } from 'node:net';
import { createSyntheticCompanionTransport, type SyntheticCompanionTransport } from './synthetic-companion-transport.js';
import { COMPANION_IDENTITY_TTL_MS, type CompanionIdentity, type CompanionRequest, type CompanionTerms } from './synthetic-companion.js';

const ownerSession = 's'.repeat(43);
const otherSession = 'o'.repeat(43);
const terms: CompanionTerms = {
  account: 'synthetic-companion-account-a', route: 'RHS', instrument: 'SYNTH-USD',
  side: 'BUY', type: 'LIMIT', timeInForce: 'DAY', quantity: '0.1', limitPrice: '99.90', revision: 0,
};
const transports: SyntheticCompanionTransport[] = [];
let tick = 100_000;
function createTransport() {
  const transport = createSyntheticCompanionTransport({
    enabled: true,
    now: () => tick,
    sources: {
      quote: (_terms, now, binding) => ({ source: 'synthetic-companion-quote-v1', instrument: 'SYNTH-USD', currency: 'USD', binding, price: '9.00', observedAt: now, expiresAt: now + 1000 }),
      fee: (_terms, now, binding) => ({ source: 'synthetic-companion-fee-v1', currency: 'USD', binding, amount: '0.01', observedAt: now, expiresAt: now + 1000 }),
    },
  });
  transports.push(transport);
  return transport;
}
function input(identity: CompanionIdentity, overrides: Partial<CompanionRequest> = {}): CompanionRequest {
  return {
    version: 'v1', operation: 'synthetic-preview', identityId: identity.identityId,
    nonce: 'n'.repeat(43), issuedAt: tick, expiresAt: tick + 30_000, terms, ...overrides,
  };
}
async function call(port: number, identity: CompanionIdentity, body: unknown, options: {
  headers?: Record<string, string | string[]>;
  rawBody?: string;
  localAddress?: string;
} = {}): Promise<{ status: number; body: string }> {
  const text = options.rawBody ?? JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | string[]> = {
      Host: `127.0.0.1:${port}`,
      Authorization: `Bearer ${identity.credential}`,
      'X-Gelt-Session': ownerSession,
      'X-Gelt-Session-Expires': String(tick + 60_000),
      'X-Companion-Identity': identity.identityId,
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(text)),
      ...options.headers,
    };
    const req = request({ hostname: '127.0.0.1', port, path: '/v1/synthetic-companion/preview', method: 'POST', headers, localAddress: options.localAddress }, res => {
      let response = '';
      res.on('data', chunk => response += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body: response }));
    });
    req.setTimeout(7000, () => req.destroy(new Error('test request timeout')));
    req.on('error', reject);
    req.end(text);
  });
}
async function provision(transport: SyntheticCompanionTransport, session = ownerSession) {
  const port = await transport.start();
  const identity = transport.provisionIdentity(session, tick + 60_000);
  return { port, identity };
}
function openStalled(port: number, identity: CompanionIdentity) {
  const text = JSON.stringify(input(identity));
  const req = request({ hostname: '127.0.0.1', port, path: '/v1/synthetic-companion/preview', method: 'POST', headers: {
    Host: `127.0.0.1:${port}`, Authorization: `Bearer ${identity.credential}`,
    'X-Gelt-Session': ownerSession, 'X-Gelt-Session-Expires': String(tick + 60_000),
    'X-Companion-Identity': identity.identityId, 'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(text)),
  } });
  req.on('error', () => {});
  req.write(text.slice(0, 1));
  return req;
}
afterEach(async () => {
  while (transports.length) await transports.pop()!.stop();
  tick = 100_000;
});

describe('bounded private synthetic companion HTTP transport', () => {
  it('is inert by default and provisions only outside HTTP after explicit loopback start', async () => {
    const disabled = createSyntheticCompanionTransport();
    expect(disabled.status()).toMatchObject({ enabled: false, activeIdentities: 0, execution: false, orderAuthority: false });
    await expect(disabled.start()).rejects.toThrow();
    expect(() => disabled.provisionIdentity(ownerSession, tick + 60_000)).toThrow();

    const transport = createTransport();
    const { port, identity } = await provision(transport);
    expect(port).toBeGreaterThan(0);
    expect(identity.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transport.status()).toMatchObject({ enabled: true, activeIdentities: 1, execution: false, orderAuthority: false });
    const result = await call(port, identity, input(identity));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ synthetic: true, authorizing: false, brokerFacts: false, execution: false, total: '10.000' });
    expect(result.body).not.toContain(identity.credential);
  });

  it('binds peer from the accepted socket and rejects forged credentials, identity, owner session and host', async () => {
    const transport = createTransport();
    const { port, identity } = await provision(transport);
    const body = input(identity);
    const credentialEcho = await call(port, identity, input(identity, { nonce: identity.credential }));
    expect(credentialEcho.status).toBe(409);
    expect(credentialEcho.body).not.toContain(identity.credential);
    const cases = [
      { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } },
      { headers: { 'X-Companion-Identity': 'f'.repeat(32) } },
      { headers: { 'X-Gelt-Session': otherSession } },
      { headers: { Host: '127.0.0.1:1' } },
      { headers: { 'X-Forwarded-For': '127.0.0.1' } },
      { headers: { 'X-Gelt-Session': [ownerSession, ownerSession] } },
    ];
    for (const attempt of cases) {
      const result = await call(port, identity, body, attempt);
      expect(result.status).not.toBe(200);
      expect(result.body).toBe('{"version":"v1","error":"companion_unavailable"}');
      expect(result.body).not.toContain(identity.credential);
    }
    const wrongPeer = await call(port, identity, body, { localAddress: '127.0.0.2' });
    expect(wrongPeer.status).toBe(403);
    expect(wrongPeer.body).not.toContain(identity.credential);
    const success = await call(port, identity, body);
    expect(success.status).toBe(200);
    const forgedBodyPeer = await call(port, identity, { ...body, remoteAddress: '127.0.0.1', nonce: 'p'.repeat(43) });
    expect(forgedBodyPeer.status).toBe(409);
  });

  it('rejects duplicate/replayed, expired, revoked, malformed and oversized requests without detail leakage', async () => {
    const transport = createTransport();
    const { port, identity } = await provision(transport);
    const duplicate = input(identity);
    expect((await call(port, identity, duplicate)).status).toBe(200);
    const replay = await call(port, identity, duplicate);
    expect(replay.status).toBe(409);
    expect(replay.body).toBe('{"version":"v1","error":"companion_unavailable"}');

    const expired = await call(port, identity, input(identity, {
      nonce: 'e'.repeat(43), issuedAt: tick - 30_001, expiresAt: tick - 1,
    }));
    expect(expired.status).toBe(409);
    const malformed = await call(port, identity, { ...input(identity, { nonce: 'm'.repeat(43) }), extra: true });
    expect(malformed.status).toBe(409);
    const oversized = await call(port, identity, {}, { rawBody: 'x'.repeat(5000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toBe('{"version":"v1","error":"companion_unavailable"}');

    transport.revokeSession(ownerSession);
    const revoked = await call(port, identity, input(identity, { nonce: 'r'.repeat(43) }));
    expect(revoked.status).toBe(403);
    expect(revoked.body).not.toContain(identity.credential);
  });

  it('closes eight accepted, trickling incomplete headers by the accept-time deadline', async () => {
    const transport = createTransport();
    const port = await transport.start();
    const sockets = Array.from({ length: 8 }, () => connect({ host: '127.0.0.1', port }));
    const openedAt: number[] = [];
    let trickleWrites = 0;
    let trickle: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.all(sockets.map((socket, index) => new Promise<void>((resolve, reject) => {
        socket.once('connect', () => {
          openedAt[index] = Date.now();
          socket.write(`POST /v1/synthetic-companion/preview HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Stall: `);
          resolve();
        });
        socket.once('error', reject);
      })));
      const closures = sockets.map(socket => new Promise<number>(resolve => socket.once('close', () => resolve(Date.now()))));
      trickle = setInterval(() => {
        for (const socket of sockets) if (!socket.destroyed) { socket.write('a'); trickleWrites++; }
      }, 200);
      // A ninth complete request must connect and then be dropped while the
      // eight accepted sockets occupy every slot. A refused connect is not proof.
      await new Promise<void>((resolve, reject) => {
        const probe = connect({ host: '127.0.0.1', port });
        let connected = false, response = false;
        const watchdog = setTimeout(() => { probe.destroy(); reject(new Error('ninth slot was not rejected')); }, 1500);
        probe.on('data', () => { response = true; });
        probe.once('connect', () => {
          connected = true;
          probe.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
        });
        probe.once('error', error => { if (!connected) reject(error); });
        probe.once('close', () => {
          clearTimeout(watchdog);
          if (!connected || response || sockets.some(socket => socket.destroyed)) reject(new Error('eight accepted slots were not saturated'));
          else resolve();
        });
      });
      const closedAt = await Promise.race([
        Promise.all(closures),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('trickling header socket stayed open')), 6500); }),
      ]);
      expect(trickleWrites).toBeGreaterThanOrEqual(sockets.length * 3);
      for (let i = 0; i < sockets.length; i++) {
        expect(closedAt[i] - openedAt[i]).toBeGreaterThanOrEqual(4200);
        expect(closedAt[i] - openedAt[i]).toBeLessThan(6500);
      }
    } finally {
      if (deadline) clearTimeout(deadline);
      if (trickle) clearInterval(trickle);
      for (const socket of sockets) socket.destroy();
    }
  }, 9000);

  it('bounds concurrent slow requests and releases capacity after they close', async () => {
    const transport = createTransport();
    const { port, identity } = await provision(transport);
    const stalled = Array.from({ length: 4 }, () => openStalled(port, identity));
    try {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
      const overloaded = await call(port, identity, input(identity, { nonce: 'c'.repeat(43) }));
      expect(overloaded.status).toBe(503);
      expect(overloaded.body).toBe('{"version":"v1","error":"companion_unavailable"}');
    } finally {
      for (const req of stalled) req.destroy();
    }
    await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
    expect((await call(port, identity, input(identity, { nonce: 'c'.repeat(43) }))).status).toBe(200);
  });

  it('expires an identity independently of its still-live owner session', async () => {
    const transport = createTransport();
    const port = await transport.start();
    const sessionExpiresAt = tick + 600_000;
    const identity = transport.provisionIdentity(ownerSession, sessionExpiresAt);
    tick += COMPANION_IDENTITY_TTL_MS;
    const result = await call(port, identity, input(identity), {
      headers: { 'X-Gelt-Session-Expires': String(sessionExpiresAt) },
    });
    expect(result.status).toBe(409);
    expect(result.body).not.toContain(identity.credential);
    expect(transport.status().activeIdentities).toBe(0);
  });

  it('rejects an owner session after expiry and cannot reuse credentials after stop/restart', async () => {
    const transport = createTransport();
    const { port: oldPort, identity: oldIdentity } = await provision(transport);
    expect((await call(oldPort, oldIdentity, input(oldIdentity))).status).toBe(200);
    await transport.stop();

    const newPort = await transport.start();
    const oldAfterRestart = await call(newPort, oldIdentity, input(oldIdentity, { nonce: 'z'.repeat(43) }));
    expect(oldAfterRestart.status).not.toBe(200);
    expect(oldAfterRestart.body).not.toContain(oldIdentity.credential);
    const newIdentity = transport.provisionIdentity(ownerSession, tick + 60_000);
    expect(newIdentity.identityId).not.toBe(oldIdentity.identityId);
    expect(newIdentity.credential).not.toBe(oldIdentity.credential);
    expect((await call(newPort, newIdentity, input(newIdentity))).status).toBe(200);

    tick += 60_000;
    const expiredSession = await call(newPort, newIdentity, input(newIdentity, { nonce: 'q'.repeat(43) }));
    expect(expiredSession.status).toBe(403);
    expect(transport.status().activeIdentities).toBe(0);
  });
});
