import { randomBytes, randomUUID, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { canonical, decode } from './ledger-canonical.js';
import { LedgerStorage } from './ledger-storage.js';
import { reopenPhaseForTest, rememberReopenFailureForTest } from './synthetic-reopen-diagnostics.js';
import {
  compareSyntheticDecimals, syntheticMockAdmissionInputSchema, syntheticMockDigest,
  syntheticMockExecutionSchema, syntheticMockOrderViewSchema, syntheticMockPreviewSchema,
  syntheticMockSource, syntheticMockSubmitInputSchema, withinSyntheticFeeCap,
  type SyntheticMockAdmissionInput, type SyntheticMockExecution, type SyntheticMockOrderView,
  type SyntheticMockPreview, type SyntheticMockSubmitInput,
} from './synthetic-mock-robinhood-contract.js';

const applicationId = 1196184660;
const schemaVersion = 1;
const rowLimit = 1000;
const byteLimit = 8 * 1024 * 1024;
const bodyLimit = 8192;
const schema = [
  `CREATE TABLE mock_meta (id INTEGER PRIMARY KEY CHECK(id=1), source TEXT NOT NULL CHECK(source='${syntheticMockSource}')) STRICT`,
  `CREATE TABLE mock_admissions (
    preview_id TEXT PRIMARY KEY, preview_json TEXT NOT NULL, preview_sha TEXT NOT NULL,
    terms_hash TEXT NOT NULL, confirmation_sha TEXT NOT NULL, handle_sha TEXT NOT NULL,
    expires_ms INTEGER NOT NULL, consumed_dispatch TEXT
  ) STRICT`,
  `CREATE TABLE mock_orders (
    dispatch_id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, preview_id TEXT NOT NULL UNIQUE REFERENCES mock_admissions(preview_id),
    payload_json TEXT NOT NULL, payload_sha TEXT NOT NULL, projection_json TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE mock_events (
    dispatch_id TEXT NOT NULL REFERENCES mock_orders(dispatch_id), sequence INTEGER NOT NULL,
    event_json TEXT NOT NULL, PRIMARY KEY(dispatch_id, sequence)
  ) STRICT`,
];

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted'), at: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('cancel-requested'), at: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('cancel-acknowledged'), at: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('execution-observed'), at: z.number().int().nonnegative(), execution: syntheticMockExecutionSchema }).strict(),
  z.object({ type: z.literal('cancellation-settled'), at: z.number().int().nonnegative() }).strict(),
]);
type MockEvent = z.infer<typeof eventSchema>;

type AdmissionRow = { preview_id: unknown; preview_json: unknown; preview_sha: unknown; terms_hash: unknown; confirmation_sha: unknown; handle_sha: unknown; expires_ms: unknown; consumed_dispatch: unknown };
type OrderRow = { dispatch_id: unknown; order_id: unknown; preview_id: unknown; payload_json: unknown; payload_sha: unknown; projection_json: unknown };
type EventRow = { sequence: unknown; event_json: unknown };
const storedSubmitSchema = z.object({
  dispatchId: z.string().uuid(),
  preview: syntheticMockPreviewSchema,
  termsHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  admissionDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

class Rejected extends Error {}
function fail(): never { throw new Rejected('synthetic mock request unavailable'); }
function sha(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function checkedText(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('synthetic mock storage unavailable');
  return value;
}
function checkedInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('synthetic mock storage unavailable');
  return value;
}
function decodeMockProjection(body: string): SyntheticMockOrderView {
  // Keep this fixture decoder aligned with the mock store's own 8 KiB bound.
  // The shared ledger decoder deliberately has a smaller, unrelated limit.
  if (body.length > bodyLimit || Buffer.byteLength(body, 'utf8') > bodyLimit) throw new Error('synthetic mock storage unavailable');
  const projection = syntheticMockOrderViewSchema.parse(JSON.parse(body));
  if (canonical(projection) !== body) throw new Error('synthetic mock storage unavailable');
  return projection;
}
function digestSecret(value: string): string { return sha(value); }
function validPreview(preview: SyntheticMockPreview, now: number): boolean {
  const expires = Date.parse(preview.expiresAt);
  return validPreviewPolicy(preview) && Number.isSafeInteger(now) && now >= 0 && expires > now && expires <= now + 300000;
}
function validPreviewPolicy(preview: SyntheticMockPreview): boolean {
  return preview.source === syntheticMockSource
    && preview.quote.price.value === '0.90' && preview.quote.price.precision === 3 && preview.quote.price.scale === 2
    && preview.fee.amount.value === '0.01' && preview.fee.amount.precision === 3 && preview.fee.amount.scale === 2
    && withinSyntheticFeeCap(preview.order, preview.fee.amount)
    && compareSyntheticDecimals(preview.order.limitPrice, preview.quote.price) <= 0;
}
function storedSubmit(input: SyntheticMockSubmitInput) {
  return {
    dispatchId: input.dispatchId,
    preview: input.preview,
    termsHash: input.termsHash,
    confirmationDigest: digestSecret(input.confirmationToken),
    admissionDigest: digestSecret(input.admissionHandle),
  };
}

export class SyntheticMockRobinhoodStore {
  private readonly storage: LedgerStorage;
  private readonly db: Database.Database;
  private closed = false;
  private persistenceFaultPending = false;
  private admissionFaultPending = false;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.storage = reopenPhaseForTest('mock-ledger-construction', () => new LedgerStorage(path));
    this.db = this.storage.db;
    try {
      this.atomic(() => {
        const existing = this.db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as { type: string; name: string }[];
        if (!existing.length) {
          if (this.db.pragma('application_id', { simple: true }) !== 0 || this.db.pragma('user_version', { simple: true }) !== 0) throw new Error();
          this.db.pragma(`application_id = ${applicationId}`);
          this.db.pragma(`user_version = ${schemaVersion}`);
          for (const statement of schema) this.db.exec(statement);
          this.db.prepare('INSERT INTO mock_meta(id, source) VALUES(1, ?)').run(syntheticMockSource);
        }
        this.validateSchema();
        reopenPhaseForTest('mock-replay', () => this.replayAll());
      });
    } catch (error) {
      this.storage.poisoned = true;
      try { this.storage.close(); } catch { /* ownership marker is intentionally retained */ }
      throw error;
    }
  }

  private validateSchema(): void {
    const objects = this.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as { type: unknown; name: unknown; sql: unknown }[];
    const names = objects.map(row => checkedText(row.name, 128));
    const expected = ['mock_admissions', 'mock_events', 'mock_meta', 'mock_orders'];
    const actualSchema = objects.map(row => {
      if (row.type !== 'table' || typeof row.sql !== 'string' || Buffer.byteLength(row.sql, 'utf8') > 2048) throw new Error('synthetic mock storage unavailable');
      return row.sql;
    });
    const expectedSchema = [...schema].sort((a, b) => a.match(/TABLE (\w+)/)![1].localeCompare(b.match(/TABLE (\w+)/)![1]));
    if (this.db.pragma('application_id', { simple: true }) !== applicationId || this.db.pragma('user_version', { simple: true }) !== schemaVersion
      || canonical(names) !== canonical(expected) || canonical(actualSchema) !== canonical(expectedSchema)) throw new Error('synthetic mock storage unavailable');
    const meta = this.db.prepare('SELECT id, source FROM mock_meta').all() as { id: unknown; source: unknown }[];
    if (meta.length !== 1 || checkedInteger(meta[0].id) !== 1 || checkedText(meta[0].source, 128) !== syntheticMockSource) throw new Error('synthetic mock storage unavailable');
  }

  private atomic<T>(work: () => T): T {
    if (this.closed || this.storage.poisoned) throw new Error('synthetic mock storage unavailable');
    try {
      reopenPhaseForTest('mock-initial-validation', () => this.validateStorage());
      const result = this.db.transaction(() => {
        reopenPhaseForTest('mock-transaction-validation', () => this.validateStorage());
        let value: T;
        let workThrew = false;
        let workError: unknown;
        try { value = work(); }
        catch (error) { workThrew = true; workError = error; throw error; }
        finally {
          try { this.validateStorage(); }
          catch (error) { rememberReopenFailureForTest(error, 'mock-final-validation', { threw: workThrew, error: workError }); throw error; }
        }
        return value;
      }).immediate();
      reopenPhaseForTest('mock-post-validation', () => this.validateStorage());
      return result;
    }
    catch (error) {
      if (!(error instanceof Rejected)) this.storage.poisoned = true;
      throw error;
    }
  }
  private validateStorage(): void {
    try { this.storage.validate(); }
    catch (error) { this.storage.poisoned = true; throw error; }
  }
  private time(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) fail();
    return value;
  }

  private bytes(): number {
    const stored = this.db.prepare(`SELECT coalesce(sum(length(CAST(preview_json AS BLOB)) + length(preview_id) + length(preview_sha) + length(terms_hash)
      + length(confirmation_sha) + length(handle_sha) + coalesce(length(consumed_dispatch),0)
      + coalesce(length(CAST(payload_json AS BLOB)),0) + coalesce(length(CAST(payload_sha AS BLOB)),0)
      + coalesce(length(CAST(projection_json AS BLOB)),0) + coalesce(length(order_id),0) + coalesce(length(dispatch_id),0)),0) AS bytes
      FROM mock_admissions LEFT JOIN mock_orders USING(preview_id)`).get() as { bytes: unknown };
    const events = this.db.prepare(`SELECT coalesce(sum(length(CAST(event_json AS BLOB)) + length(dispatch_id) + 8),0) AS bytes FROM mock_events`).get() as { bytes: unknown };
    const total = checkedInteger(stored.bytes) + checkedInteger(events.bytes);
    if (!Number.isSafeInteger(total)) throw new Error('synthetic mock storage unavailable');
    return total;
  }

  admit(raw: SyntheticMockAdmissionInput): { previewId: string; handle: string; expiresAt: string } {
    const input = syntheticMockAdmissionInputSchema.parse(raw);
    const now = this.time();
    if (!validPreview(input.preview, now) || input.termsHash.length !== 64) fail();
    const previewJson = canonical(input.preview);
    if (Buffer.byteLength(previewJson, 'utf8') > bodyLimit) fail();
    const handle = randomBytes(32).toString('base64url');
    const expiresMs = Date.parse(input.preview.expiresAt);
    return this.atomic(() => {
      this.replayAll();
      const currentTime = this.time();
      if (!validPreview(input.preview, currentTime)) fail();
      const active = this.db.prepare(`SELECT count(*) AS count,
        coalesce(sum(length(CAST(preview_json AS BLOB)) + length(preview_id) + length(preview_sha) + length(terms_hash)
          + length(confirmation_sha) + length(handle_sha) + coalesce(length(consumed_dispatch),0)
          + coalesce(length(CAST(payload_json AS BLOB)),0) + coalesce(length(CAST(payload_sha AS BLOB)),0)
          + coalesce(length(CAST(projection_json AS BLOB)),0) + coalesce(length(order_id),0) + coalesce(length(dispatch_id),0)),0) AS bytes
        FROM mock_admissions LEFT JOIN mock_orders USING(preview_id)
        WHERE expires_ms>? OR consumed_dispatch IS NOT NULL`).get(currentTime) as { count: unknown; bytes: unknown };
      const admissionBytes = Buffer.byteLength(previewJson, 'utf8') + Buffer.byteLength(input.preview.previewId, 'utf8') + (64 * 4) + 8;
      if (checkedInteger(active.count) >= rowLimit || checkedInteger(active.bytes) + admissionBytes > byteLimit) fail();
      this.db.prepare('DELETE FROM mock_admissions WHERE expires_ms<=? AND consumed_dispatch IS NULL').run(currentTime);
      if (this.db.prepare('SELECT 1 FROM mock_admissions WHERE preview_id=?').get(input.preview.previewId)) fail();
      if (this.admissionFaultPending) { this.admissionFaultPending = false; throw new Error('synthetic mock admission persistence fault'); }
      this.db.prepare(`INSERT INTO mock_admissions(preview_id,preview_json,preview_sha,terms_hash,confirmation_sha,handle_sha,expires_ms,consumed_dispatch)
        VALUES(?,?,?,?,?,?,?,NULL)`).run(input.preview.previewId, previewJson, syntheticMockDigest(input.preview), input.termsHash,
        digestSecret(input.confirmationToken), digestSecret(handle), expiresMs);
      return { previewId: input.preview.previewId, handle, expiresAt: input.preview.expiresAt };
    });
  }

  submit(raw: SyntheticMockSubmitInput): SyntheticMockOrderView {
    const input = syntheticMockSubmitInputSchema.parse(raw);
    if (!validPreviewPolicy(input.preview)) fail();
    const previewJson = canonical(input.preview);
    const payload = storedSubmit(input);
    const payloadJson = canonical(payload);
    if (Buffer.byteLength(payloadJson, 'utf8') > bodyLimit) fail();
    const payloadSha = syntheticMockDigest(payload);
    return this.atomic(() => {
      this.replayAll();
      const currentTime = this.time();
      const existing = this.orderRow(input.dispatchId);
      if (existing) {
        const view = this.readOrder(existing);
        const oldPayload = this.readStoredPayload(existing);
        const oldPayloadJson = canonical(oldPayload);
        if (oldPayloadJson !== payloadJson || syntheticMockDigest(oldPayload) !== checkedText(existing.payload_sha, 64)
          || checkedText(existing.payload_sha, 64) !== payloadSha || view.previewId !== input.preview.previewId) fail();
        return view;
      }
      if (!validPreview(input.preview, currentTime)) fail();
      const admission = this.admissionRow(input.preview.previewId);
      if (!admission) fail();
      const admittedPreviewText = checkedText(admission.preview_json, bodyLimit);
      const admittedPreview = decode(syntheticMockPreviewSchema, admittedPreviewText);
      if (canonical(admittedPreview) !== admittedPreviewText || syntheticMockDigest(admittedPreview) !== checkedText(admission.preview_sha, 64)
        || admittedPreviewText !== previewJson || checkedText(admission.terms_hash, 64) !== input.termsHash
        || checkedText(admission.confirmation_sha, 64) !== payload.confirmationDigest
        || checkedText(admission.handle_sha, 64) !== payload.admissionDigest || checkedInteger(admission.expires_ms) <= currentTime) fail();
      if (admission.consumed_dispatch !== null || this.orderCount() >= rowLimit || this.eventCount() + 1 > rowLimit) fail();
      const orderId = randomUUID();
      const acceptedEvent = { type: 'accepted' as const, at: currentTime };
      const initial = this.project(input.dispatchId, orderId, input.preview, [acceptedEvent]);
      const initialEvent = canonical(acceptedEvent), initialProjection = canonical(initial);
      const initialBytes = Buffer.byteLength(payloadJson, 'utf8') + 64 + Buffer.byteLength(initialProjection, 'utf8')
        + Buffer.byteLength(input.dispatchId, 'utf8') + Buffer.byteLength(orderId, 'utf8') + Buffer.byteLength(input.preview.previewId, 'utf8')
        + Buffer.byteLength(initialEvent, 'utf8') + Buffer.byteLength(input.dispatchId, 'utf8') + 8;
      if (this.bytes() + initialBytes > byteLimit) fail();
      this.db.prepare('INSERT INTO mock_orders(dispatch_id,order_id,preview_id,payload_json,payload_sha,projection_json) VALUES(?,?,?,?,?,?)')
        .run(input.dispatchId, orderId, input.preview.previewId, payloadJson, payloadSha, initialProjection);
      this.db.prepare('UPDATE mock_admissions SET consumed_dispatch=? WHERE preview_id=? AND consumed_dispatch IS NULL').run(input.dispatchId, input.preview.previewId);
      this.insertEvent(input.dispatchId, 1, acceptedEvent);
      const created = this.orderRow(input.dispatchId);
      if (!created) throw new Error('synthetic mock storage unavailable');
      return this.readOrder(created);
    });
  }

  read(dispatchId: string): SyntheticMockOrderView | undefined {
    return this.atomic(() => {
      this.replayAll();
      const row = this.orderRow(dispatchId);
      return row ? this.readOrder(row) : undefined;
    });
  }

  cancel(dispatchId: string): SyntheticMockOrderView {
    return this.atomic(() => {
      this.replayAll();
      const row = this.orderRow(dispatchId);
      if (!row) fail();
      const current = this.readOrder(row);
      if (current.cancelAcknowledged || current.status === 'filled' || current.status === 'canceled') fail();
      const events = this.readEvents(dispatchId);
      const now = this.time();
      this.insertEvent(dispatchId, events.length + 1, { type: 'cancel-requested', at: now });
      this.insertEvent(dispatchId, events.length + 2, { type: 'cancel-acknowledged', at: now });
      return this.persistProjection(row, this.project(dispatchId, checkedText(row.order_id, 64), this.readStoredPayload(row).preview, [...events,
        { type: 'cancel-requested', at: now }, { type: 'cancel-acknowledged', at: now }]));
    });
  }

  // Fixture-only observation hook. The loopback protocol has no fill or settlement route.
  observeExecution(dispatchId: string, executionRaw: SyntheticMockExecution): SyntheticMockOrderView {
    const execution = syntheticMockExecutionSchema.parse(executionRaw);
    return this.atomic(() => {
      this.replayAll();
      const row = this.orderRow(dispatchId);
      if (!row) fail();
      const events = this.readEvents(dispatchId);
      const view = this.readOrder(row);
      if (view.status === 'filled' || view.status === 'canceled') fail();
      if (events.some(event => event.type === 'execution-observed' && event.execution.executionId === execution.executionId)) fail();
      const payload = this.readStoredPayload(row);
      if (events.filter(event => event.type === 'execution-observed').length >= 16
        || compareSyntheticDecimals(execution.price, payload.preview.order.limitPrice) > 0) fail();
      const prior = events.flatMap(event => event.type === 'execution-observed' ? [event.execution] : []);
      const next = [...prior, execution];
      const common = Math.max(payload.preview.order.quantity.scale, ...next.map(item => item.quantity.scale));
      const quantity = next.reduce((sum, item) => sum + BigInt(item.quantity.value.replace('.', '')) * 10n ** BigInt(common - item.quantity.scale), 0n);
      const cap = BigInt(payload.preview.order.quantity.value.replace('.', '')) * 10n ** BigInt(common - payload.preview.order.quantity.scale);
      if (quantity > cap) fail();
      const event = { type: 'execution-observed' as const, at: this.time(), execution };
      this.insertEvent(dispatchId, events.length + 1, event);
      return this.persistProjection(row, this.project(dispatchId, checkedText(row.order_id, 64), payload.preview, [...events, event]));
    });
  }

  // Fixture-only terminal observation; never exposed by the HTTP transport.
  settleCanceled(dispatchId: string): SyntheticMockOrderView {
    return this.atomic(() => {
      this.replayAll();
      const row = this.orderRow(dispatchId);
      if (!row) fail();
      const events = this.readEvents(dispatchId);
      const view = this.readOrder(row);
      if (!view.cancelAcknowledged || view.status === 'filled' || view.status === 'canceled') fail();
      const event = { type: 'cancellation-settled' as const, at: this.time() };
      this.insertEvent(dispatchId, events.length + 1, event);
      const payload = this.readStoredPayload(row);
      return this.persistProjection(row, this.project(dispatchId, checkedText(row.order_id, 64), payload.preview, [...events, event]));
    });
  }

  failNextInsertForTest(): void {
    if (process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only') throw new Error('synthetic mock disabled');
    this.persistenceFaultPending = true;
  }
  failNextAdmissionInsertForTest(): void {
    if (process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only') throw new Error('synthetic mock disabled');
    this.admissionFaultPending = true;
  }

  private orderCount(): number { return checkedInteger((this.db.prepare('SELECT count(*) AS n FROM mock_orders').get() as { n: unknown }).n); }
  private eventCount(): number { return checkedInteger((this.db.prepare('SELECT count(*) AS n FROM mock_events').get() as { n: unknown }).n); }
  private replayAll(): void {
    const admissionCount = checkedInteger((this.db.prepare('SELECT count(*) AS n FROM mock_admissions').get() as { n: unknown }).n);
    const ordersCount = this.orderCount();
    const eventsCount = this.eventCount();
    if (admissionCount > rowLimit || ordersCount > rowLimit || eventsCount > rowLimit) throw new Error('synthetic mock storage unavailable');
    const foreignKeyErrors = this.db.pragma('foreign_key_check') as unknown[];
    if (foreignKeyErrors.length) throw new Error('synthetic mock storage unavailable');

    const admissionGuards = this.db.prepare(`SELECT typeof(preview_id) AS id_type, length(preview_id) AS id_bytes,
      typeof(preview_json) AS body_type, length(CAST(preview_json AS BLOB)) AS body_bytes,
      typeof(preview_sha) AS digest_type, length(preview_sha) AS digest_bytes,
      typeof(terms_hash) AS terms_type, length(terms_hash) AS terms_bytes,
      typeof(confirmation_sha) AS confirmation_type, length(confirmation_sha) AS confirmation_bytes,
      typeof(handle_sha) AS handle_type, length(handle_sha) AS handle_bytes, typeof(expires_ms) AS expiry_type,
      typeof(consumed_dispatch) AS consumed_type, length(consumed_dispatch) AS consumed_bytes
      FROM mock_admissions`).all() as Record<string, unknown>[];
    if (admissionGuards.length !== admissionCount || admissionGuards.some(row => row.id_type !== 'text' || checkedInteger(row.id_bytes) > 64
      || row.body_type !== 'text' || checkedInteger(row.body_bytes) > bodyLimit
      || row.digest_type !== 'text' || checkedInteger(row.digest_bytes) !== 64
      || row.terms_type !== 'text' || checkedInteger(row.terms_bytes) !== 64
      || row.confirmation_type !== 'text' || checkedInteger(row.confirmation_bytes) !== 64
      || row.handle_type !== 'text' || checkedInteger(row.handle_bytes) !== 64
      || row.expiry_type !== 'integer' || (row.consumed_type !== 'null' && (row.consumed_type !== 'text' || checkedInteger(row.consumed_bytes) > 64)))) {
      throw new Error('synthetic mock storage unavailable');
    }
    const admissionIds = this.db.prepare('SELECT preview_id FROM mock_admissions ORDER BY preview_id').all() as { preview_id: unknown }[];
    const consumed = new Map<string, string | null>();
    for (const idRow of admissionIds) {
      const previewId = checkedText(idRow.preview_id, 64);
      const row = this.admissionRow(previewId);
      if (!row) throw new Error('synthetic mock storage unavailable');
      const body = checkedText(row.preview_json, bodyLimit);
      const preview = decode(syntheticMockPreviewSchema, body);
      const expires = checkedInteger(row.expires_ms);
      const dispatchId = row.consumed_dispatch === null ? null : checkedText(row.consumed_dispatch, 64);
      const previewSha = checkedText(row.preview_sha, 64);
      const termsHash = checkedText(row.terms_hash, 64);
      const confirmationSha = checkedText(row.confirmation_sha, 64);
      const handleSha = checkedText(row.handle_sha, 64);
      if (![previewSha, termsHash, confirmationSha, handleSha].every(value => /^[a-f0-9]{64}$/.test(value))
        || (dispatchId !== null && !z.string().uuid().safeParse(dispatchId).success)
        || preview.previewId !== previewId || canonical(preview) !== body || syntheticMockDigest(preview) !== previewSha
        || !validPreviewPolicy(preview) || Date.parse(preview.expiresAt) !== expires) throw new Error('synthetic mock storage unavailable');
      consumed.set(previewId, dispatchId);
    }

    const orderIdsGuard = this.db.prepare(`SELECT typeof(dispatch_id) AS type, length(dispatch_id) AS bytes FROM mock_orders`).all() as Record<string, unknown>[];
    if (orderIdsGuard.length !== ordersCount || orderIdsGuard.some(row => row.type !== 'text' || checkedInteger(row.bytes) > 64)) throw new Error('synthetic mock storage unavailable');
    const orderIds = this.db.prepare('SELECT dispatch_id FROM mock_orders ORDER BY dispatch_id').all() as { dispatch_id: unknown }[];
    const usedAdmissions = new Set<string>();
    let replayedEvents = 0;
    for (const idRow of orderIds) {
      const dispatchId = checkedText(idRow.dispatch_id, 64);
      const row = this.orderRow(dispatchId);
      if (!row) throw new Error('synthetic mock storage unavailable');
      const view = this.readOrder(row);
      const payload = this.readStoredPayload(row);
      if (consumed.get(payload.preview.previewId) !== dispatchId || usedAdmissions.has(payload.preview.previewId)) throw new Error('synthetic mock storage unavailable');
      usedAdmissions.add(payload.preview.previewId);
      replayedEvents += this.readEvents(dispatchId).length;
      if (view.dispatchId !== dispatchId) throw new Error('synthetic mock storage unavailable');
    }
    const orderDispatchIds = new Set(orderIds.map(row => checkedText(row.dispatch_id, 64)));
    const consumedDispatchIds = [...consumed.values()].filter((dispatchId): dispatchId is string => dispatchId !== null);
    if (replayedEvents !== eventsCount || usedAdmissions.size !== ordersCount || consumedDispatchIds.length !== ordersCount
      || consumedDispatchIds.some(dispatchId => !orderDispatchIds.has(dispatchId))) {
      throw new Error('synthetic mock storage unavailable');
    }
  }

  private admissionRow(previewId: string): AdmissionRow | undefined {
    const guard = this.db.prepare(`SELECT typeof(preview_json) AS preview_type, length(CAST(preview_json AS BLOB)) AS preview_bytes,
      typeof(preview_sha) AS preview_sha_type, length(preview_sha) AS preview_sha_bytes,
      typeof(terms_hash) AS terms_type, length(terms_hash) AS terms_bytes,
      typeof(confirmation_sha) AS confirmation_type, length(confirmation_sha) AS confirmation_bytes,
      typeof(handle_sha) AS handle_type, length(handle_sha) AS handle_bytes,
      typeof(expires_ms) AS expires_type, typeof(consumed_dispatch) AS consumed_type, length(consumed_dispatch) AS consumed_bytes
      FROM mock_admissions WHERE preview_id=?`).get(previewId) as Record<string, unknown> | undefined;
    if (!guard) return undefined;
    if (guard.preview_type !== 'text' || checkedInteger(guard.preview_bytes) > bodyLimit
      || guard.preview_sha_type !== 'text' || checkedInteger(guard.preview_sha_bytes) !== 64
      || guard.terms_type !== 'text' || checkedInteger(guard.terms_bytes) !== 64
      || guard.confirmation_type !== 'text' || checkedInteger(guard.confirmation_bytes) !== 64
      || guard.handle_type !== 'text' || checkedInteger(guard.handle_bytes) !== 64
      || guard.expires_type !== 'integer' || (guard.consumed_type !== 'null' && (guard.consumed_type !== 'text' || checkedInteger(guard.consumed_bytes) > 64))) {
      throw new Error('synthetic mock storage unavailable');
    }
    return this.db.prepare('SELECT * FROM mock_admissions WHERE preview_id=?').get(previewId) as AdmissionRow;
  }
  private orderRow(dispatchId: string): OrderRow | undefined {
    const guard = this.db.prepare(`SELECT typeof(dispatch_id) AS dispatch_type, length(dispatch_id) AS dispatch_bytes,
      typeof(order_id) AS order_type, length(order_id) AS order_bytes, typeof(preview_id) AS preview_type, length(preview_id) AS preview_bytes,
      typeof(payload_json) AS payload_type, length(CAST(payload_json AS BLOB)) AS payload_bytes,
      typeof(payload_sha) AS digest_type, length(payload_sha) AS digest_bytes,
      typeof(projection_json) AS projection_type, length(CAST(projection_json AS BLOB)) AS projection_bytes
      FROM mock_orders WHERE dispatch_id=?`).get(dispatchId) as Record<string, unknown> | undefined;
    if (!guard) return undefined;
    if (guard.dispatch_type !== 'text' || checkedInteger(guard.dispatch_bytes) > 64
      || guard.order_type !== 'text' || checkedInteger(guard.order_bytes) > 64
      || guard.preview_type !== 'text' || checkedInteger(guard.preview_bytes) > 64
      || guard.payload_type !== 'text' || checkedInteger(guard.payload_bytes) > bodyLimit
      || guard.digest_type !== 'text' || checkedInteger(guard.digest_bytes) !== 64
      || guard.projection_type !== 'text' || checkedInteger(guard.projection_bytes) > bodyLimit) throw new Error('synthetic mock storage unavailable');
    return this.db.prepare('SELECT * FROM mock_orders WHERE dispatch_id=?').get(dispatchId) as OrderRow;
  }
  private readStoredPayload(row: OrderRow): { dispatchId: string; preview: SyntheticMockPreview; termsHash: string; confirmationDigest: string; admissionDigest: string } {
    const body = checkedText(row.payload_json, bodyLimit);
    const value = storedSubmitSchema.parse(JSON.parse(body));
    if (canonical(value) !== body || value.dispatchId !== checkedText(row.dispatch_id, 64)
      || syntheticMockDigest(value) !== checkedText(row.payload_sha, 64)
      || checkedText(row.preview_id, 64) !== value.preview.previewId) throw new Error('synthetic mock storage unavailable');
    return value;
  }
  private readEvents(dispatchId: string): MockEvent[] {
    const count = checkedInteger((this.db.prepare('SELECT count(*) AS n FROM mock_events WHERE dispatch_id=?').get(dispatchId) as { n: unknown }).n);
    if (count === 0 || count > rowLimit) throw new Error('synthetic mock storage unavailable');
    const guards = this.db.prepare(`SELECT typeof(sequence) AS sequence_type, sequence,
      typeof(event_json) AS event_type, length(CAST(event_json AS BLOB)) AS event_bytes
      FROM mock_events WHERE dispatch_id=? ORDER BY sequence`).all(dispatchId) as Record<string, unknown>[];
    if (guards.length !== count || guards.some((row, index) => row.sequence_type !== 'integer' || checkedInteger(row.sequence) !== index + 1
      || row.event_type !== 'text' || checkedInteger(row.event_bytes) > 2048)) throw new Error('synthetic mock storage unavailable');
    const rows = this.db.prepare('SELECT sequence,event_json FROM mock_events WHERE dispatch_id=? ORDER BY sequence').all(dispatchId) as EventRow[];
    if (rows.length === 0 || rows.length > rowLimit) throw new Error('synthetic mock storage unavailable');
    return rows.map((row, index) => {
      if (checkedInteger(row.sequence) !== index + 1) throw new Error('synthetic mock storage unavailable');
      const text = checkedText(row.event_json, 2048);
      const event = decode(eventSchema, text);
      if (canonical(event) !== text) throw new Error('synthetic mock storage unavailable');
      return event;
    });
  }
  private project(dispatchId: string, orderId: string, preview: SyntheticMockPreview, events: MockEvent[]): SyntheticMockOrderView {
    if (!z.string().uuid().safeParse(orderId).success) throw new Error('synthetic mock storage unavailable');
    const requestIndex = events.findIndex(event => event.type === 'cancel-requested');
    const ackIndex = events.findIndex(event => event.type === 'cancel-acknowledged');
    const settledIndex = events.findIndex(event => event.type === 'cancellation-settled');
    const accepted = events[0];
    if (!accepted || accepted.type !== 'accepted' || !validPreview(preview, accepted.at)
      || events.filter(event => event.type === 'accepted').length !== 1
      || events.filter(event => event.type === 'cancel-requested').length > 1
      || events.filter(event => event.type === 'cancel-acknowledged').length !== events.filter(event => event.type === 'cancel-requested').length
      || events.filter(event => event.type === 'cancellation-settled').length > 1
      || (requestIndex >= 0 && ackIndex !== requestIndex + 1)
      || (settledIndex >= 0 && (settledIndex <= ackIndex || settledIndex !== events.length - 1))) {
      const error = new Error('synthetic mock storage unavailable');
      rememberReopenFailureForTest(error, 'mock-replay', undefined, true);
      throw error;
    }
    if (events.some((event, index) => index > 0 && event.at < events[index - 1].at)) throw new Error('synthetic mock storage unavailable');
    const executions = events.flatMap(event => event.type === 'execution-observed' ? [event.execution] : []);
    if (executions.length > 16 || executions.some(item => compareSyntheticDecimals(item.price, preview.order.limitPrice) > 0)) throw new Error('synthetic mock storage unavailable');
    const executionIds = new Set<string>();
    for (const execution of executions) {
      if (executionIds.has(execution.executionId)) throw new Error('synthetic mock storage unavailable');
      executionIds.add(execution.executionId);
    }
    const common = Math.max(preview.order.quantity.scale, ...executions.map(item => item.quantity.scale));
    let quantity = 0n;
    const cap = BigInt(preview.order.quantity.value.replace('.', '')) * 10n ** BigInt(common - preview.order.quantity.scale);
    let fullIndex = -1;
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (event.type !== 'execution-observed') continue;
      quantity += BigInt(event.execution.quantity.value.replace('.', '')) * 10n ** BigInt(common - event.execution.quantity.scale);
      if (quantity > cap) throw new Error('synthetic mock storage unavailable');
      if (quantity === cap) fullIndex = index;
    }
    if ((settledIndex >= 0 && (requestIndex < 0 || ackIndex < 0 || settledIndex <= ackIndex || quantity === cap))
      || (requestIndex >= 0 && fullIndex >= 0 && fullIndex < requestIndex)
      || (fullIndex >= 0 && fullIndex !== events.length - 1)) throw new Error('synthetic mock storage unavailable');
    const status = events.some(event => event.type === 'cancellation-settled') ? 'canceled'
      : quantity === cap ? 'filled'
      : quantity > 0n ? 'partially-filled'
      : events.some(event => event.type === 'cancel-requested') ? 'pending-cancel' : 'accepted';
    return syntheticMockOrderViewSchema.parse({ source: syntheticMockSource, dispatchId, mockOrderId: `mock-${orderId}`,
      previewId: preview.previewId, status, executions, cancelAcknowledged: events.some(event => event.type === 'cancel-acknowledged') });
  }
  private readOrder(row: OrderRow): SyntheticMockOrderView {
    const payload = this.readStoredPayload(row);
    const admission = this.admissionRow(payload.preview.previewId);
    if (!admission) throw new Error('synthetic mock storage unavailable');
    const admitted = checkedText(admission.preview_json, bodyLimit);
    const consumed = admission.consumed_dispatch;
    if (admitted !== canonical(payload.preview) || syntheticMockDigest(payload.preview) !== checkedText(admission.preview_sha, 64)
      || checkedText(admission.terms_hash, 64) !== payload.termsHash || checkedText(admission.confirmation_sha, 64) !== payload.confirmationDigest
      || checkedText(admission.handle_sha, 64) !== payload.admissionDigest || consumed !== payload.dispatchId) throw new Error('synthetic mock storage unavailable');
    const events = this.readEvents(payload.dispatchId);
    const actual = this.project(payload.dispatchId, checkedText(row.order_id, 64), payload.preview, events);
    const storedProjection = checkedText(row.projection_json, bodyLimit);
    const decodedProjection = decodeMockProjection(storedProjection);
    if (canonical(actual) !== storedProjection || canonical(decodedProjection) !== storedProjection) throw new Error('synthetic mock storage unavailable');
    return actual;
  }
  private persistProjection(row: OrderRow, projection: SyntheticMockOrderView): SyntheticMockOrderView {
    const oldProjection = checkedText(row.projection_json, bodyLimit);
    const nextProjection = canonical(projection);
    if (Buffer.byteLength(nextProjection, 'utf8') > bodyLimit || this.bytes() - Buffer.byteLength(oldProjection, 'utf8')
      + Buffer.byteLength(nextProjection, 'utf8') > byteLimit) fail();
    this.db.prepare('UPDATE mock_orders SET projection_json=? WHERE dispatch_id=?').run(nextProjection, checkedText(row.dispatch_id, 64));
    const updated = this.orderRow(checkedText(row.dispatch_id, 64));
    if (!updated) throw new Error('synthetic mock storage unavailable');
    return this.readOrder(updated);
  }
  private insertEvent(dispatchId: string, sequence: number, event: MockEvent): void {
    const text = canonical(event);
    if (Buffer.byteLength(text, 'utf8') > 2048 || sequence > rowLimit || this.eventCount() >= rowLimit
      || this.bytes() + Buffer.byteLength(text, 'utf8') + Buffer.byteLength(dispatchId, 'utf8') + 8 > byteLimit) fail();
    if (this.persistenceFaultPending) { this.persistenceFaultPending = false; throw new Error('synthetic mock persistence fault'); }
    this.db.prepare('INSERT INTO mock_events(dispatch_id,sequence,event_json) VALUES(?,?,?)').run(dispatchId, sequence, text);
  }

  close(): void { if (this.closed) return; this.closed = true; this.storage.close(); }
}
