// Explicitly opt-in, offline TEST FIXTURE. Not imported by setup, service or bootstrap.
// Its SQLite schema and row-level provenance are deliberately incompatible with the
// production execution ledger. It neither imports a provider nor accepts credentials.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';
import { LedgerStorage, createLedgerDirectory } from './ledger-storage.js';
import { storageFixture } from './storage-fixture.js';
import { reopenPhaseForTest } from './synthetic-reopen-diagnostics.js';
import { canonical } from './ledger-canonical.js';
import { decimalSchema, eventSchema, intentSchema, ledgerId, orderSchema, projectionSchema, routingSchema, type Projection, type Result, type WriteReceipt } from './ledger-contract.js';
import { OrderLifecycle, hasUnresolvedLifecycle, validateLifecycleProjections, type OrderAdapter } from './order-lifecycle.js';
import { equalSecret } from './security.js';
import { SyntheticMockRobinhoodAdapter } from './synthetic-mock-robinhood-adapter.js';
import { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';
import { SyntheticMockRobinhoodTransport } from './synthetic-mock-robinhood-transport.js';

const source = 'synthetic-offline-v1' as const;
const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const route = routingSchema.parse({ provider: 'robinhood-official-mcp', ACCOUNT: 'synthetic-account', RHS: 'synthetic-rhs', RHC: 'synthetic-rhc' });
const schema = [
  "CREATE TABLE synthetic_meta (id INTEGER PRIMARY KEY CHECK(id=1), source TEXT NOT NULL CHECK(source='synthetic-offline-v1'), owner TEXT NOT NULL)",
  "CREATE TABLE synthetic_intents (id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK(source='synthetic-offline-v1'), body TEXT NOT NULL, projection TEXT NOT NULL)",
  "CREATE TABLE synthetic_events (intent TEXT NOT NULL REFERENCES synthetic_intents(id), sequence INTEGER NOT NULL, source TEXT NOT NULL CHECK(source='synthetic-offline-v1'), body TEXT NOT NULL, PRIMARY KEY(intent,sequence))",
];
const unavailable = <T>(): Result<T> => ({ version: 1, ok: false, error: 'unavailable' });
const ok = <T>(value: T): Result<T> => ({ version: 1, ok: true, value });
const maxStoredRows = 1000;
const maxStoredBodyBytes = 4096;
const maxStoredProjectionBytes = 4 * 1024 * 1024;
const maxStoredTextBytes = 8 * 1024 * 1024;

// Never project the raw official-shaped Intent/Projection over the fixture HTTP
// boundary. Each independently usable item and fact names its synthetic source.
const syntheticFactBase = z.object({ source: z.literal(source), occurredAt: z.string().datetime() });
const syntheticFactSchema = z.discriminatedUnion('syntheticType', [
  syntheticFactBase.extend({ syntheticType: z.enum([
    'dispatch-attempted', 'order-requested', 'broker-acknowledged', 'reconciliation-observed',
    'preview-confirmed', 'dispatch-claimed', 'dispatch-outcome-unknown', 'reconciliation-unavailable',
    'broker-status-observed', 'cancel-requested', 'cancel-acknowledged',
  ]) }).strict(),
  syntheticFactBase.extend({ syntheticType: z.literal('execution-observed'), syntheticExecutionId: z.string().min(1).max(64),
    observedQuantity: decimalSchema, observedPrice: decimalSchema, observedFee: decimalSchema.optional(), currency: z.literal('USD') }).strict(),
]);
const syntheticHistoryItemSchema = z.object({ source: z.literal(source), syntheticIntentId: ledgerId, eventCount: z.number().int().min(0).max(maxStoredRows), facts: z.array(syntheticFactSchema).max(maxStoredRows) }).strict();
function syntheticHistoryItem(projection: Projection) {
  return syntheticHistoryItemSchema.parse({ source, syntheticIntentId: projection.intent.intentId, eventCount: projection.eventCount,
    facts: projection.facts.map(event => syntheticFactSchema.parse(event.type === 'execution-observed'
      ? { source, syntheticType: event.type, occurredAt: event.occurredAt, syntheticExecutionId: event.execution.executionId,
        observedQuantity: event.execution.observedQuantity, observedPrice: event.execution.observedPrice,
        ...(event.execution.observedFee ? { observedFee: event.execution.observedFee } : {}), currency: event.execution.currency }
      : { source, syntheticType: event.type, occurredAt: event.occurredAt })) });
}

// No official ledger tables, no official ledger row and no export to production.
// Each stored row carries an enforced and replay-checked synthetic source; all
// reads replay complete bounded facts inside a consistent SQLite transaction.
class SyntheticFacts {
  private readonly storage: LedgerStorage;
  private poisoned = false;
  constructor(path: string) {
    this.storage = new LedgerStorage(path);
    try {
      const db = this.storage.db;
      const existing = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
      if (!existing.length) {
        db.transaction(() => {
          db.pragma('application_id = 1196184629'); // distinct from production GLT4
          db.pragma('user_version = 1');
          for (const sql of schema) db.exec(sql);
          db.prepare('INSERT INTO synthetic_meta(id,source,owner) VALUES(1,?,?)').run(source, owner);
        }).immediate();
      }
      const tables = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { sql: string }[];
      if (db.pragma('application_id', { simple: true }) !== 1196184629 || db.pragma('user_version', { simple: true }) !== 1
        || canonical(tables.map(t => t.sql)) !== canonical([...schema].sort((a, b) => a.match(/TABLE (\w+)/)![1].localeCompare(b.match(/TABLE (\w+)/)![1])))) throw new Error('synthetic storage unavailable');
      const meta = db.prepare('SELECT * FROM synthetic_meta').all();
      if (canonical(meta) !== canonical([{ id: 1, source, owner }])) throw new Error('synthetic storage unavailable');
      db.transaction(() => this.read())();
    } catch { this.poisoned = true; this.storage.poisoned = true; throw new Error('synthetic storage unavailable'); }
  }
  private guard<T>(fn: () => Result<T>): Result<T> {
    if (this.poisoned) return unavailable();
    try { this.storage.validate(); return fn(); }
    catch { this.poisoned = true; this.storage.poisoned = true; return unavailable(); }
  }
  private read(): Projection[] {
    const db = this.storage.db;
    // COUNT and metadata-only lengths run before fetching any stored body TEXT.
    // Both tables and the combined text budget are bounded before materialization.
    const intentCount = db.prepare('SELECT COUNT(*) AS count FROM synthetic_intents').get() as { count: number };
    const eventCount = db.prepare('SELECT COUNT(*) AS count FROM synthetic_events').get() as { count: number };
    if (intentCount.count > maxStoredRows || eventCount.count > maxStoredRows) throw new Error();
    const intentSizes = db.prepare('SELECT length(CAST(id AS BLOB)) AS idBytes, length(CAST(source AS BLOB)) AS sourceBytes, length(CAST(body AS BLOB)) AS bodyBytes, length(CAST(projection AS BLOB)) AS projectionBytes FROM synthetic_intents LIMIT 1001').all() as { idBytes: number; sourceBytes: number; bodyBytes: number; projectionBytes: number }[];
    const eventSizes = db.prepare('SELECT length(CAST(intent AS BLOB)) AS intentBytes, length(CAST(source AS BLOB)) AS sourceBytes, length(CAST(body AS BLOB)) AS bodyBytes FROM synthetic_events LIMIT 1001').all() as { intentBytes: number; sourceBytes: number; bodyBytes: number }[];
    if (intentSizes.length !== intentCount.count || eventSizes.length !== eventCount.count) throw new Error();
    let totalBytes = 0;
    for (const row of intentSizes) {
      if (row.idBytes !== 36 || row.sourceBytes !== Buffer.byteLength(source) || row.bodyBytes > maxStoredBodyBytes || row.projectionBytes > maxStoredProjectionBytes) throw new Error();
      totalBytes += row.idBytes + row.sourceBytes + row.bodyBytes + row.projectionBytes;
    }
    for (const row of eventSizes) {
      if (row.intentBytes !== 36 || row.sourceBytes !== Buffer.byteLength(source) || row.bodyBytes > maxStoredBodyBytes) throw new Error();
      totalBytes += row.intentBytes + row.sourceBytes + row.bodyBytes;
    }
    if (totalBytes > maxStoredTextBytes) throw new Error();
    const intents = db.prepare('SELECT * FROM synthetic_intents ORDER BY id').all() as { id: string; source: string; body: string; projection: string }[];
    const rows = db.prepare('SELECT * FROM synthetic_events ORDER BY intent,sequence').all() as { intent: string; sequence: number; source: string; body: string }[];
    if (intents.length !== intentCount.count || rows.length !== eventCount.count) throw new Error();
    const eventIds = new Set<string>(), eventKeys = new Set<string>(), intentKeys = new Set<string>();
    const projections = intents.map(row => {
      if (Buffer.byteLength(row.body) > maxStoredBodyBytes || Buffer.byteLength(row.projection) > maxStoredProjectionBytes) throw new Error();
      const intent = intentSchema.parse(JSON.parse(row.body));
      if (row.source !== source || row.id !== intent.intentId || intent.ownerId !== owner || intent.accountId !== account
        || canonical(intent.routing) !== canonical(route) || row.body !== canonical(intent) || intentKeys.has(intent.idempotencyKey)) throw new Error();
      intentKeys.add(intent.idempotencyKey);
      const facts = rows.filter(e => e.intent === row.id).map((e, index) => {
        if (Buffer.byteLength(e.body) > maxStoredBodyBytes) throw new Error();
        const fact = eventSchema.parse(JSON.parse(e.body));
        if (e.source !== source || e.sequence !== index + 1 || e.body !== canonical(fact)
          || fact.intentId !== row.id || fact.ownerId !== owner || fact.accountId !== account
          || eventIds.has(fact.eventId) || eventKeys.has(fact.idempotencyKey)) throw new Error();
        eventIds.add(fact.eventId); eventKeys.add(fact.idempotencyKey);
        return fact;
      });
      const projection = projectionSchema.parse({ version: 1, intent, eventCount: facts.length, facts });
      if (row.projection !== canonical(projection)) throw new Error();
      return projection;
    });
    if (rows.length !== projections.reduce((count, p) => count + p.eventCount, 0)) throw new Error();
    validateLifecycleProjections(projections);
    return projections;
  }
  recordIntent(input: unknown): Result<WriteReceipt> {
    const parsed = intentSchema.safeParse(input);
    if (!parsed.success || parsed.data.ownerId !== owner || parsed.data.accountId !== account || canonical(parsed.data.routing) !== canonical(route)) return { version: 1, ok: false, error: 'invalid' };
    return this.guard(() => this.storage.db.transaction(() => {
      const all = this.read();
      if (all.length >= 1000) return { version: 1, ok: false, error: 'capacity' } as const;
      if (all.some(p => p.intent.intentId === parsed.data.intentId || p.intent.idempotencyKey === parsed.data.idempotencyKey)) return { version: 1, ok: false, error: 'conflict' } as const;
      const projection = { version: 1 as const, intent: parsed.data, eventCount: 0, facts: [] };
      this.storage.db.prepare('INSERT INTO synthetic_intents(id,source,body,projection) VALUES(?,?,?,?)').run(parsed.data.intentId, source, canonical(parsed.data), canonical(projection));
      this.read(); return ok({ disposition: 'committed' as const, projection });
    }).immediate());
  }
  append(input: unknown): Result<WriteReceipt> {
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) return { version: 1, ok: false, error: 'invalid' };
    return this.guard(() => this.storage.db.transaction(() => {
      const all = this.read(), event = parsed.data;
      const projection = all.find(p => p.intent.intentId === event.intentId);
      if (!projection || event.ownerId !== owner || event.accountId !== account) return { version: 1, ok: false, error: 'not_found' } as const;
      if (all.some(p => p.facts.some(f => f.eventId === event.eventId || f.idempotencyKey === event.idempotencyKey))) return { version: 1, ok: false, error: 'conflict' } as const;
      if (all.reduce((n, p) => n + p.eventCount, 0) >= 1000) return { version: 1, ok: false, error: 'capacity' } as const;
      const next = projectionSchema.parse({ ...projection, eventCount: projection.eventCount + 1, facts: [...projection.facts, event] });
      validateLifecycleProjections(all.map(p => p === projection ? next : p));
      this.storage.db.prepare('INSERT INTO synthetic_events(intent,sequence,source,body) VALUES(?,?,?,?)').run(event.intentId, next.eventCount, source, canonical(event));
      this.storage.db.prepare('UPDATE synthetic_intents SET projection=? WHERE id=?').run(canonical(next), event.intentId);
      this.read(); return ok({ disposition: 'committed' as const, projection: next });
    }).immediate());
  }
  history(input: unknown, page: unknown): Result<Projection[]> {
    const query = z.object({ ownerId: ledgerId, accountId: ledgerId }).strict().safeParse(input);
    const paging = z.object({ after: z.number().int().min(0).max(1000), limit: z.number().int().min(1).max(100) }).strict().safeParse(page);
    if (!query.success || !paging.success) return { version: 1, ok: false, error: 'invalid' };
    return this.guard(() => ok(this.storage.db.transaction(() => this.read().filter(p => p.intent.ownerId === query.data.ownerId && p.intent.accountId === query.data.accountId).slice(paging.data.after, paging.data.after + paging.data.limit))()));
  }
  ownerHasUnresolvedLifecycle(ownerId: string): Result<boolean> {
    if (ownerId !== owner) return { version: 1, ok: false, error: 'invalid' };
    return this.guard(() => ok(this.storage.db.transaction(() => {
      const all = this.read();
      // The production lifecycle helper applies the same open/unknown semantics.
      return hasUnresolvedLifecycle(all);
    })()));
  }
  close(): void { this.storage.poisoned ||= this.poisoned; this.storage.close(); }
}
const scenarioSchema = z.object({ dispatch: z.enum(['accepted', 'rejected', 'unknown']).optional(), reconcile: z.enum(['partial', 'late-partial', 'canceled', 'filled', 'unknown']).optional() }).strict().refine(v => Object.keys(v).length === 1);
const cancelInput = z.object({ intentId: ledgerId }).strict();
const empty = z.object({}).strict();
const maxBody = 4096;
const sessionLifetimeMs = 300000;

function fixtureEnabled() {
  return process.env.NODE_ENV === 'test' && process.env.GELT_SYNTHETIC_ORDER_HARNESS === 'offline-test-only';
}
export function createSyntheticOrderHarness(sessionClock: () => number = Date.now, options: { applicationMock?: boolean; mockRequestTimeoutMsForTest?: number } = {}) {
  if (!fixtureEnabled() || (options.applicationMock && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only')) throw new Error('synthetic harness disabled');
  const mockRequestTimeoutMsForTest = options.mockRequestTimeoutMsForTest === undefined ? 5000 : options.mockRequestTimeoutMsForTest;
  // Validate the explicit test budget before creating any private fixture/lock.
  if (!Number.isSafeInteger(mockRequestTimeoutMsForTest) || mockRequestTimeoutMsForTest < 5000 || mockRequestTimeoutMsForTest > 30000
    || (options.mockRequestTimeoutMsForTest !== undefined && !options.applicationMock)) throw new Error('synthetic harness disabled');
  const root = storageFixture('synthetic-orders-'), dir = join(root, 'data');
  createLedgerDirectory(dir);
  const path = join(dir, 'synthetic-orders.sqlite');
  // A restart must use this closure's same private fixture, not a caller-supplied
  // ledger/config path. No connection, vault, provider or production service exists.
  const open = () => {
    if (!fixtureEnabled()) throw new Error('synthetic harness disabled');
    const issuedAt = sessionClock();
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || issuedAt > Number.MAX_SAFE_INTEGER - sessionLifetimeMs) throw new Error('synthetic harness disabled');
    // Validate the test clock before acquiring the persistent private SQLite lock.
    const mockPath = join(dir, 'synthetic-mock-robinhood.sqlite');
    const facts = reopenPhaseForTest('facts-ledger-construction', () => new SyntheticFacts(path));
    let mockStore: SyntheticMockRobinhoodStore | undefined;
    let mockTransport: SyntheticMockRobinhoodTransport | undefined;
    let mockAdapter: SyntheticMockRobinhoodAdapter | undefined;
    try {
      mockStore = options.applicationMock ? new SyntheticMockRobinhoodStore(mockPath, sessionClock) : undefined;
      mockTransport = mockStore ? new SyntheticMockRobinhoodTransport(mockStore, mockRequestTimeoutMsForTest) : undefined;
      mockAdapter = mockTransport ? new SyntheticMockRobinhoodAdapter(mockTransport.client, sessionClock) : undefined;
    } catch (error) {
      try { mockTransport ? void mockTransport.close() : mockStore?.close(); } catch { /* preserve uncertain writer ownership */ }
      try { facts.close(); } catch { /* preserve uncertain lifecycle ownership */ }
      throw error;
    }
    const auth = { bearer: randomBytes(32).toString('base64url'), session: randomBytes(32).toString('base64url'), expiresAt: issuedAt + sessionLifetimeMs };
    let dispatch: 'accepted' | 'rejected' | 'unknown' = 'accepted';
    let reconcile: 'partial' | 'late-partial' | 'canceled' | 'filled' | 'unknown' = 'unknown';
    const fee = decimalSchema.parse({ value: '0.01', precision: 3, scale: 2 });
    const adapter: OrderAdapter = mockAdapter ?? {
      async preview({ order }) { return { previewId: randomUUID(), order, fee, feeCurrency: 'USD', expiresAt: new Date(sessionClock() + 60000).toISOString() }; },
      async dispatch({ dispatchId }) { return dispatch === 'accepted' ? { outcome: 'accepted', brokerOrderId: `synthetic-${dispatchId}` } : { outcome: dispatch }; },
      async reconcile({ brokerOrderId }) {
        if (!brokerOrderId) return { status: 'unknown', executions: [] };
        const fill = (n: number) => ({ executionId: `synthetic-fill-${n}`, brokerOrderId,
          observedQuantity: { value: n === 1 ? '0.004' : '0.002', precision: 4, scale: 3 },
          observedPrice: { value: n === 1 ? '1.01' : '1.02', precision: 3, scale: 2 },
          observedFee: { value: n === 1 ? '0.003' : '0.002', precision: 4, scale: 3 }, currency: 'USD' });
        if (reconcile === 'partial') return { status: 'partially-filled', brokerOrderId, executions: [fill(1)] };
        if (reconcile === 'late-partial') return { status: 'partially-filled', brokerOrderId, executions: [fill(1), fill(2)] };
        return { status: reconcile === 'unknown' ? 'unknown' : reconcile, brokerOrderId, executions: [] };
      },
      async cancel() { return { acknowledged: true }; },
    };
    const lifecycle = new OrderLifecycle(facts, owner, () => ({ accountId: account, routing: route }), adapter, sessionClock);
    let mockPreviewAdmissionTail = Promise.resolve();
    const previewAndAdmitMock = async (rawOrder: unknown) => {
      let release!: () => void;
      const preceding = mockPreviewAdmissionTail;
      mockPreviewAdmissionTail = new Promise<void>(resolve => { release = resolve; });
      await preceding;
      try {
        try {
          const preview = await lifecycle.preview(rawOrder);
          if (!mockAdapter) throw new Error('synthetic mock unavailable');
          await mockAdapter.admitPreview(preview);
          return preview;
        } catch (error) {
          mockAdapter?.discardUnadmittedPreview();
          throw error;
        }
      } finally { release(); }
    };
    const server: Server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      const fail = (status: number) => { res.writeHead(status); res.end(JSON.stringify({ version: 1, source, error: 'synthetic request unavailable' })); };
      const address = server.address();
      if (!fixtureEnabled() || !address || typeof address === 'string' || address.address !== '127.0.0.1'
        || req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin !== undefined
        || Object.keys(req.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-'))) return fail(403);
      if (!equalSecret(req.headers.authorization as string, `Bearer ${auth.bearer}`) || !equalSecret(req.headers['x-gelt-session'] as string, auth.session)) return fail(403);
      const expires = Number(req.headers['x-gelt-session-expires']);
      const current = sessionClock();
      if (!/^[0-9]+$/.test(req.headers['x-gelt-session-expires'] as string ?? '') || !Number.isSafeInteger(current)
        || expires !== auth.expiresAt || current < issuedAt || current >= auth.expiresAt) return fail(403);
      if (!req.url?.startsWith('/v1/synthetic-orders/')) return fail(404);
      const operation = req.url.slice('/v1/synthetic-orders/'.length);
      if (!['resume', 'preview', 'confirm', 'reconcile', 'cancel', 'scenario', 'history', 'mock-history'].includes(operation)
        || (operation === 'mock-history' && !mockAdapter) || (operation === 'scenario' && mockAdapter)) return fail(404);
      if (req.method !== 'POST') return fail(405);
      if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] !== undefined
        || !/^[0-9]+$/.test(req.headers['content-length'] ?? '') || Number(req.headers['content-length']) > maxBody) return fail(400);
      try {
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > maxBody) throw new Error(); }
        if (Buffer.byteLength(body) !== Number(req.headers['content-length'])) throw new Error();
        const input: unknown = JSON.parse(body);
        let value: unknown;
        switch (operation) {
          case 'resume': empty.parse(input); await lifecycle.resumeNewOrders(); value = { ready: true }; break;
          case 'preview': {
            const order = orderSchema.parse(input);
            const preview = mockAdapter ? await previewAndAdmitMock(order) : await lifecycle.preview(order);
            value = preview;
          } break;
          case 'confirm': {
            try { value = await lifecycle.confirm(input); }
            catch (error) { mockAdapter?.discardRejectedConfirmation(input); throw error; }
          } break;
          case 'reconcile': empty.parse(input); value = { observations: await lifecycle.reconcileAll() }; break;
          case 'cancel': value = { outcome: await lifecycle.cancel(cancelInput.parse(input).intentId) }; break;
          case 'scenario': {
            const selected = scenarioSchema.parse(input);
            if (selected.dispatch) dispatch = selected.dispatch;
            if (selected.reconcile) reconcile = selected.reconcile;
            value = { configured: true }; break;
          }
          case 'history': empty.parse(input); {
            const result = facts.history({ ownerId: owner, accountId: account }, { after: 0, limit: 100 });
            if (!result.ok) throw new Error();
            value = { items: result.value.map(syntheticHistoryItem) };
          } break;
          case 'mock-history': {
            const query = z.object({ dispatchId: ledgerId }).strict().parse(input);
            if (!mockAdapter) throw new Error();
            value = { order: await mockAdapter.readMockOrder(query.dispatchId) };
          } break;
        }
        res.end(JSON.stringify({ version: 1, source, value }));
      } catch { fail(409); }
    });
    server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
    return {
      auth, path,
      mockPath: mockAdapter ? mockPath : undefined,
      mockStore,
      mockTransport,
      start: async () => {
        if (!fixtureEnabled()) throw new Error('synthetic harness disabled');
        try {
          if (mockTransport) await mockTransport.start();
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
          });
          return (server.address() as { port: number }).port;
        } catch (error) {
          try { if (mockTransport) await mockTransport.close(); } catch { /* uncertain mock ownership remains */ }
          try { facts.close(); } catch { /* uncertain lifecycle ownership remains */ }
          throw error;
        }
      },
      close: async () => {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        let failure: unknown;
        try { if (mockTransport) await mockTransport.close(); } catch (error) { failure = error; }
        try { facts.close(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
      },
      reopen: open,
    };
  };
  return open();
}
