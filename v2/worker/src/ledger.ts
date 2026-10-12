import type { z } from 'zod';
import { ledgerStorageError, storageDiagnosticForTest, rememberStorageDiagnostic, clearStorageDiagnostic } from './storage-diagnostics.js';
import { LedgerStorage } from './ledger-storage.js';
import { hasUnresolvedLifecycle, validateLifecycleProjections } from './order-lifecycle.js';
import { migrate, validateSchema } from './ledger-migrations.js';
import { canonical, decode, digest } from './ledger-canonical.js';
import { eventSchema, intentSchema, ledgerId, pageSchema, querySchema, getIntentInputSchema, historyInputSchema, routingSchema, replay, type Intent, type LedgerEvent, type Projection, type Result, type WriteReceipt } from './ledger-contract.js';
type Row = Record<string, string | number | null>;
class Rejected extends Error { constructor(readonly code: 'invalid' | 'conflict' | 'not_found' | 'capacity') { super(code); } }
const key = (...parts: unknown[]) => canonical(parts);
function fact(e: LedgerEvent, i: Intent): [string, string] {
  let id: string;
  switch (e.type) {
    case 'execution-observed': id = e.execution.executionId; break;
    case 'broker-acknowledged': id = e.brokerOrderId; break;
    case 'dispatch-attempted': id = e.attemptId; break;
    case 'order-requested': id = e.requestId; break;
    case 'reconciliation-observed': id = e.reconciliationId; break;
    case 'preview-confirmed': id = e.previewId; break;
    case 'dispatch-claimed': id = e.dispatchId; break;
    case 'dispatch-outcome-unknown': id = e.outcomeId; break;
    case 'reconciliation-unavailable': id = e.reconciliationId; break;
    case 'broker-status-observed': id = e.observationId; break;
    case 'cancel-requested': case 'cancel-acknowledged': id = e.cancelId; break;
  }
  return [i.order.route + ':' + e.type, id];
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const r = schema.safeParse(input); if (!r.success) throw new Rejected('invalid'); return r.data; }
function routeMatches(stored: Intent['routing'], selected: Intent['routing']): boolean {
  return stored.provider === selected.provider && stored.ACCOUNT === selected.ACCOUNT && stored.RHS === selected.RHS && (stored.RHC === undefined || stored.RHC === selected.RHC);
}
export class Ledger {
  private readonly storage: LedgerStorage;
  private closed = false;
  constructor(path: string, private readonly ownerId: string) {
    if (!ledgerId.safeParse(ownerId).success) throw new Error('ledger unavailable');
    this.storage = new LedgerStorage(path);
    try { migrate(this.storage.db, ownerId); this.storage.db.transaction(() => this.load()).deferred(); }
    catch (error) { this.storage.poisoned = true; try { this.storage.close(); } catch {} throw ledgerStorageError(error); }
  }
  available = () => !this.closed && !this.storage.poisoned;
  private rows(sql: string, ...args: (string | number)[]): Row[] { return this.storage.db.prepare(sql).all(...args) as Row[]; }
  // One transaction-local validator for EVERY read and write, including duplicates.
  // Limits bound replay/memory; foreign-key/index sets are reconstructed, not trusted.
  private load(): Map<string, Projection> {
    const db = this.storage.db;
    validateSchema(db);
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error();
    if (canonical(this.rows('SELECT * FROM ledger_owner')) !== canonical([{ owner: this.ownerId }])) throw new Error();
    const accounts = this.rows('SELECT * FROM accounts LIMIT 1001');
    const intents = this.rows('SELECT * FROM intents ORDER BY owner,account,id LIMIT 1001');
    const events = this.rows('SELECT * FROM events ORDER BY owner,account,intent,seq LIMIT 1001');
    const facts = this.rows('SELECT * FROM facts LIMIT 1001');
    if ([accounts, intents, events, facts].some(a => a.length > 1000)) throw new Error();
    const accountMap = new Map<string, string>(); const routeSet = new Set<string>();
    for (const a of accounts) {
      if (a.owner !== this.ownerId || !ledgerId.safeParse(a.account).success) throw new Error();
      const r = decode(routingSchema, a.body as string);
      if (r.ACCOUNT !== a.account_route || r.RHS !== a.rhs || (r.RHC ?? null) !== a.rhc) throw new Error();
      for (const name of ['ACCOUNT', 'RHS', 'RHC'] as const) if (r[name] !== undefined) {
        const k = key(a.owner, name, r[name]); if (routeSet.has(k)) throw new Error(); routeSet.add(k);
      }
      accountMap.set(key(a.owner, a.account), a.body as string);
    }
    const result = new Map<string, Projection>(); const expectedFacts: string[] = []; const usedAccounts = new Set<string>();
    const intentKeys = new Set<string>(); const eventKeys = new Set<string>(); const eventIds = new Set<string>(); let consumed = 0;
    for (const row of intents) {
      const i = decode(intentSchema, row.body as string);
      if (i.ownerId !== this.ownerId || i.ownerId !== row.owner || i.accountId !== row.account || i.intentId !== row.id || i.idempotencyKey !== row.key || digest(row.body as string) !== row.hash) throw new Error();
      const ak = key(i.ownerId, i.accountId); usedAccounts.add(ak);
      if (accountMap.get(ak) !== canonical(i.routing)) throw new Error();
      const ik = key(i.ownerId, i.accountId, i.idempotencyKey); if (intentKeys.has(ik)) throw new Error(); intentKeys.add(ik);
      let previous = row.hash; const decoded: LedgerEvent[] = [];
      for (const e of events.filter(e => e.owner === row.owner && e.account === row.account && e.intent === row.id)) {
        const value = decode(eventSchema, e.body as string);
        if (value.ownerId !== e.owner || value.accountId !== e.account || value.intentId !== e.intent || value.eventId !== e.id || value.idempotencyKey !== e.key || value.type !== e.type || e.seq !== decoded.length + 1 || e.previous !== previous || e.hash !== digest(previous + (e.body as string))) throw new Error();
        const ek = key(e.owner, e.account, e.key), id = key(e.owner, e.account, e.id);
        if (eventKeys.has(ek) || eventIds.has(id)) throw new Error(); eventKeys.add(ek); eventIds.add(id);
        const [namespace, factId] = fact(value, i);
        expectedFacts.push(canonical({ owner: e.owner, account: e.account, namespace, id: factId, event: e.id }));
        decoded.push(value); previous = e.hash; consumed++;
      }
      const projection = replay(i, decoded);
      if (row.projection !== canonical(projection)) throw new Error();
      result.set(key(i.ownerId, i.accountId, i.intentId), projection);
    }
    if (consumed !== events.length || usedAccounts.size !== accounts.length || canonical(expectedFacts.sort()) !== canonical(facts.map(canonical).sort())) throw new Error();
    validateLifecycleProjections([...result.values()]);
    return result;
  }
  private run<T>(write: boolean, body: (state: Map<string, Projection>) => T): Result<T> {
    if (!this.available()) return { version: 1, ok: false, error: 'unavailable' };
    clearStorageDiagnostic(this);
    try {
      this.storage.validate();
      const transaction = this.storage.db.transaction(() => {
        const state = this.load(); // append derives ONLY after this comparison, under IMMEDIATE
        const value = body(state);
        if (write) this.load();
        this.storage.validate();
        return value;
      });
      const value = write ? transaction.immediate() : transaction.deferred();
      return { version: 1, ok: true, value };
    } catch (error) {
      if (error instanceof Rejected) return { version: 1, ok: false, error: error.code };
      rememberStorageDiagnostic(this, storageDiagnosticForTest(ledgerStorageError(error)));
      this.storage.poisoned = true;
      return { version: 1, ok: false, error: 'unavailable' };
    }
  }
  private owner(owner: string) { if (owner !== this.ownerId) throw new Rejected('invalid'); }
  recordIntent(input: unknown): Result<WriteReceipt> {
    return this.run(true, state => {
      const i = parse(intentSchema, input); this.owner(i.ownerId);
      const existing = [...state.values()].find(p => p.intent.accountId === i.accountId && (p.intent.intentId === i.intentId || p.intent.idempotencyKey === i.idempotencyKey));
      if (existing) { if (canonical(existing.intent) !== canonical(i)) throw new Rejected('conflict'); return { disposition: 'duplicate', projection: existing }; }
      if (state.size >= 1000) throw new Rejected('capacity');
      const accounts = this.rows('SELECT * FROM accounts WHERE owner=?', i.ownerId);
      const a = accounts.find(a => a.account === i.accountId);
      if (a && a.body !== canonical(i.routing) || accounts.some(a => a.account !== i.accountId && (a.account_route === i.routing.ACCOUNT || a.rhs === i.routing.RHS || i.routing.RHC !== undefined && a.rhc === i.routing.RHC))) throw new Rejected('conflict');
      const db = this.storage.db;
      if (!a) db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(i.ownerId, i.accountId, i.routing.ACCOUNT, i.routing.RHS, i.routing.RHC ?? null, canonical(i.routing));
      const projection = replay(i, []), body = canonical(i);
      db.prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?)').run(i.ownerId, i.accountId, i.intentId, i.idempotencyKey, body, digest(body), canonical(projection));
      return { disposition: 'committed', projection };
    });
  }
  append(input: unknown): Result<WriteReceipt> {
    return this.run(true, state => {
      const e = parse(eventSchema, input); this.owner(e.ownerId);
      const p = state.get(key(e.ownerId, e.accountId, e.intentId)); if (!p) throw new Rejected('not_found');
      const all = [...state.values()].flatMap(p => p.facts);
      const existing = all.find(v => v.accountId === e.accountId && (v.eventId === e.eventId || v.idempotencyKey === e.idempotencyKey));
      if (existing) { if (canonical(existing) !== canonical(e)) throw new Rejected('conflict'); return { disposition: 'duplicate', projection: p }; }
      if (all.length >= 1000) throw new Rejected('capacity');
      const [namespace, id] = fact(e, p.intent);
      if (this.rows('SELECT * FROM facts WHERE owner=? AND account=? AND namespace=? AND id=?', e.ownerId, e.accountId, namespace, id).length) throw new Rejected('conflict');
      const seq = p.eventCount + 1;
      const previous = seq === 1 ? digest(canonical(p.intent)) : this.rows('SELECT hash FROM events WHERE owner=? AND account=? AND intent=? AND seq=?', e.ownerId, e.accountId, e.intentId, seq - 1)[0].hash as string;
      const body = canonical(e), db = this.storage.db;
      db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(e.ownerId, e.accountId, e.intentId, e.eventId, e.idempotencyKey, seq, e.type, body, digest(previous + body), previous);
      db.prepare('INSERT INTO facts VALUES(?,?,?,?,?)').run(e.ownerId, e.accountId, namespace, id, e.eventId);
      const projection = replay(p.intent, [...p.facts, e]);
      db.prepare('UPDATE intents SET projection=? WHERE owner=? AND account=? AND id=?').run(canonical(projection), e.ownerId, e.accountId, e.intentId);
      return { disposition: 'committed', projection };
    });
  }
  getIntent(input: unknown): Result<Projection> {
    return this.run(false, state => {
      const q = parse(getIntentInputSchema, input); this.owner(q.ownerId);
      if ('accountId' in q) {
        const p = state.get(key(q.ownerId, q.accountId, q.intentId)); if (!p) throw new Rejected('not_found'); return p;
      }
      const matches = [...state.values()].filter(p => p.intent.intentId === q.intentId && routeMatches(p.intent.routing, q.routing));
      if (matches.length !== 1) throw new Rejected('not_found');
      return matches[0];
    });
  }
  private lookup(state: Map<string, Projection>, input: unknown) {
    const q = parse(querySchema, input); this.owner(q.ownerId);
    const p = state.get(key(q.ownerId, q.accountId, q.intentId)); if (!p) throw new Rejected('not_found'); return p;
  }
  timeline(input: unknown, page: unknown): Result<LedgerEvent[]> {
    return this.run(false, state => { const p = this.lookup(state, input), q = parse(pageSchema, page); return p.facts.slice(q.after, q.after + q.limit); });
  }
  history(input: unknown, page: unknown): Result<Projection[]> {
    return this.run(false, state => {
      const s = parse(historyInputSchema, input), q = parse(pageSchema, page); this.owner(s.ownerId);
      const records = [...state.values()].filter(p => 'accountId' in s ? p.intent.accountId === s.accountId : routeMatches(p.intent.routing, s.routing));
      return records.slice(q.after, q.after + q.limit);
    });
  }
  // Internal owner-wide safety check under the same transaction-local replay.
  // No browser, BFF or service route exposes this method.
  ownerHasUnresolvedLifecycle(ownerId: string): Result<boolean> {
    return this.run(false, state => {
      this.owner(ledgerId.parse(ownerId));
      return hasUnresolvedLifecycle([...state.values()].filter(p => p.intent.ownerId === ownerId));
    });
  }
  close() { if (this.closed) return; if (!this.storage.poisoned) this.run(false, () => true); this.closed = true; this.storage.close(); }
}
