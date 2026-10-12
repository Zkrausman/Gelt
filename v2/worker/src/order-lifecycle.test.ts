import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { Ledger } from './ledger.js';
import { canonical, digest } from './ledger-canonical.js';
import { eventSchema } from './ledger-contract.js';
import { event, id, intent } from './ledger-fixture.js';
import { storageFixture } from './storage-fixture.js';
import { createLedgerDirectory } from './ledger-storage.js';
import { OrderLifecycle, UnsupportedOrderAdapter, type OrderAdapter } from './order-lifecycle.js';

// This adapter and every response below are offline synthetic test data only.
function fixture() {
  const root = storageFixture('m5-'), dir = join(root, 'data');
  createLedgerDirectory(dir);
  const path = join(dir, 'ledger.sqlite'), ledger = new Ledger(path, id(1));
  let now = Date.parse('2026-01-01T00:00:00.000Z'), next = 100;
  let dispatchOutcome: unknown = { outcome: 'accepted', brokerOrderId: 'broker-order-1' }, dispatchThrows = false;
  let reconcileOutcomes: unknown[] = [];
  let fee: unknown = { value: '0.01', precision: 3, scale: 2 }, feeCurrency: unknown = 'USD', returnedOrder: unknown | undefined;
  let selected = { accountId: id(2), routing: intent.routing };
  let dispatchCalls = 0, cancelCalls = 0, reconcileCalls = 0;
  const adapter: OrderAdapter = {
    async preview({ order }) { return { previewId: id(next++), order: returnedOrder ?? order, fee, feeCurrency, expiresAt: new Date(now + 60000).toISOString() }; },
    async dispatch() { dispatchCalls++; if (dispatchThrows) throw new Error('synthetic ambiguous transport'); return dispatchOutcome; },
    async reconcile() { reconcileCalls++; return reconcileOutcomes.shift() ?? { status: 'unknown', executions: [] }; },
    async cancel() { cancelCalls++; return { acknowledged: true }; },
  };
  const lifecycle = () => new OrderLifecycle(ledger, id(1), () => selected, adapter, () => now);
  return {
    path, ledger, adapter, lifecycle,
    setNow(value: number) { now = value; },
    setOutcome(value: unknown) { dispatchOutcome = value; },
    setDispatchThrows(value: boolean) { dispatchThrows = value; },
    setReconcile(...values: unknown[]) { reconcileOutcomes.push(...values); },
    setFee(value: unknown) { fee = value; },
    setFeeCurrency(value: unknown) { feeCurrency = value; },
    setReturnedOrder(value: unknown | undefined) { returnedOrder = value; },
    setSelected(value: typeof selected) { selected = value; },
    counts: () => ({ dispatchCalls, cancelCalls, reconcileCalls }),
    cleanup() { try { ledger.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); },
  };
}

async function ready(manager: OrderLifecycle) { await manager.resumeNewOrders(); }

it('requires exact preview terms, nonexpired confirmation and exact fee-inclusive cap', async () => {
  const f = fixture();
  try {
    const manager = f.lifecycle(); await ready(manager);
    const changedPrice = { ...intent.order, requestedLimitPrice: { value: '1000.00', precision: 6, scale: 2 } };
    await expect(manager.preview(changedPrice)).rejects.toThrow('order lifecycle unavailable');
    f.setFee({ value: '0.00', precision: 3, scale: 2 });
    expect((await manager.preview(changedPrice)).terms.order.requestedLimitPrice.value).toBe('1000.00');
    f.setFee({ value: '0.01', precision: 3, scale: 2 });
    f.setFeeCurrency('EUR');
    await expect(manager.preview(intent.order)).rejects.toThrow('order lifecycle unavailable');
    f.setFeeCurrency('USD');
    f.setReturnedOrder({ ...intent.order, instrumentId: 'different-instrument' });
    await expect(manager.preview(intent.order)).rejects.toThrow('order lifecycle unavailable');
    f.setReturnedOrder(undefined);
    expect(f.counts().dispatchCalls).toBe(0);
    const preview = await manager.preview(intent.order);
    await expect(manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: '0'.repeat(64) })).rejects.toThrow();
    await expect(manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(0);
    const expired = await manager.preview(intent.order);
    f.setNow(Date.parse(expired.terms.expiresAt) + 1);
    await expect(manager.confirm({ confirmationToken: expired.confirmationToken, termsHash: expired.termsHash })).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(0);
  } finally { f.cleanup(); }
});

it('binds one-use confirmation to selected owner/account/route/order and dispatches once under repeated clicks', async () => {
  const f = fixture();
  try {
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    const input = { confirmationToken: preview.confirmationToken, termsHash: preview.termsHash };
    const results = await Promise.allSettled([manager.confirm(input), manager.confirm(input)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(f.counts().dispatchCalls).toBe(1);
  } finally { f.cleanup(); }
});

it('serializes simultaneous confirmations for two previews to one in-flight account order', async () => {
  const f = fixture();
  try {
    const manager = f.lifecycle(); await ready(manager);
    const first = await manager.preview(intent.order), second = await manager.preview(intent.order);
    const outcomes = await Promise.allSettled([
      manager.confirm({ confirmationToken: first.confirmationToken, termsHash: first.termsHash }),
      manager.confirm({ confirmationToken: second.confirmationToken, termsHash: second.termsHash }),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
    expect(f.counts().dispatchCalls).toBe(1);
  } finally { f.cleanup(); }
});

it('changed selected account rejects the exact preview without dispatch', async () => {
  const f = fixture();
  try {
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    f.setSelected({ accountId: id(20), routing: { ...intent.routing, ACCOUNT: 'account-2', RHS: 'rhs-2', RHC: 'rhc-2' } });
    await expect(manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(0);
  } finally { f.cleanup(); }
});

it('unknown dispatch outcome is durably claimed, halts submissions and restart never redispatches', async () => {
  const f = fixture();
  let reopened: Ledger | undefined;
  try {
    f.setDispatchThrows(true);
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    const receipt = await manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash });
    expect(receipt.outcome).toBe('unknown');
    expect(f.counts().dispatchCalls).toBe(1);
    f.ledger.close();
    reopened = new Ledger(f.path, id(1));
    let reconcileCalls = 0, dispatchCalls = 0;
    const recovery: OrderAdapter = {
      async preview() { throw new Error('not used'); },
      async dispatch() { dispatchCalls++; throw new Error('must not redispatch'); },
      async reconcile() { reconcileCalls++; return { status: 'unknown', executions: [] }; },
      async cancel() { throw new Error('not used'); },
    };
    const recovered = new OrderLifecycle(reopened, id(1), () => ({ accountId: id(2), routing: intent.routing }), recovery);
    await expect(recovered.resumeNewOrders()).rejects.toThrow();
    expect(await recovered.reconcileAll()).toBe(1);
    expect(reconcileCalls).toBe(1);
    expect(dispatchCalls).toBe(0);
    await expect(recovered.resumeNewOrders()).rejects.toThrow();
  } finally { try { reopened?.close(); } catch {} f.cleanup(); }
});

it('an unknown dispatch in account A cannot be bypassed by selecting empty account B', async () => {
  const f = fixture();
  try {
    f.setDispatchThrows(true);
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    expect((await manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).outcome).toBe('unknown');
    f.setSelected({ accountId: id(20), routing: { ...intent.routing, ACCOUNT: 'account-2', RHS: 'rhs-2', RHC: 'rhc-2' } });
    await expect(manager.resumeNewOrders()).rejects.toThrow();
    await expect(manager.preview(intent.order)).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(1);
  } finally { f.cleanup(); }
});

it('a terminal response without a proven order correlation cannot release an unknown dispatch', async () => {
  const f = fixture();
  try {
    f.setDispatchThrows(true);
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    expect((await manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).outcome).toBe('unknown');
    f.setReconcile({ status: 'filled', executions: [] }, {
      status: 'filled', brokerOrderId: 'unproven-order',
      executions: [{ executionId: 'unattributed-fill', brokerOrderId: 'unproven-order',
        observedQuantity: { value: '0.004', precision: 4, scale: 3 },
        observedPrice: { value: '1.01', precision: 3, scale: 2 }, currency: 'USD' }],
    });
    expect(await manager.reconcileAll()).toBe(1);
    await expect(manager.resumeNewOrders()).rejects.toThrow();
    expect(await manager.reconcileAll()).toBe(1);
    await expect(manager.resumeNewOrders()).rejects.toThrow();
    const history = f.ledger.history({ ownerId: id(1), accountId: id(2) }, { after: 0, limit: 10 });
    expect(history.ok && history.value[0].facts.some(e => e.type === 'broker-status-observed' && e.status === 'filled')).toBe(false);
    expect(history.ok && history.value[0].facts.some(e => e.type === 'reconciliation-unavailable' || e.type === 'execution-observed')).toBe(false);
    expect(f.counts().dispatchCalls).toBe(1);
  } finally { f.cleanup(); }
});

it('uncorrelated partial read cannot attribute an execution or authorize cancellation', async () => {
  const f = fixture();
  try {
    f.setDispatchThrows(true);
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    const unknown = await manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash });
    expect(unknown.outcome).toBe('unknown');
    f.setReconcile(
      { status: 'partially-filled', brokerOrderId: 'unproven-order', executions: [{
        executionId: 'unproven-fill', brokerOrderId: 'unproven-order',
        observedQuantity: { value: '0.004', precision: 4, scale: 3 },
        observedPrice: { value: '1.01', precision: 3, scale: 2 }, currency: 'USD',
      }] },
      { status: 'partially-filled', brokerOrderId: 'unproven-order', executions: [] },
    );
    expect(await manager.reconcileAll()).toBe(1);
    expect(await manager.reconcileAll()).toBe(1);
    await expect(manager.cancel(unknown.intentId)).rejects.toThrow();
    await expect(manager.resumeNewOrders()).rejects.toThrow();
    const history = f.ledger.history({ ownerId: id(1), accountId: id(2) }, { after: 0, limit: 10 });
    expect(history.ok && history.value[0].facts.some(e => e.type === 'reconciliation-observed' || e.type === 'broker-status-observed'
      || e.type === 'execution-observed' || e.type === 'cancel-requested')).toBe(false);
    expect(f.counts().cancelCalls).toBe(0);
    expect(f.counts().dispatchCalls).toBe(1);
  } finally { f.cleanup(); }
});

it('explicit observed rejection is terminal; partial execution and cancel acknowledgement are not', async () => {
  const f = fixture();
  try {
    f.setOutcome({ outcome: 'rejected', brokerOrderId: 'broker-reject-1' });
    const manager = f.lifecycle(); await ready(manager);
    const rejected = await manager.preview(intent.order);
    expect((await manager.confirm({ confirmationToken: rejected.confirmationToken, termsHash: rejected.termsHash })).outcome).toBe('rejected');
    const rejectedIntent = f.ledger.history({ ownerId: id(1), accountId: id(2) }, { after: 0, limit: 10 });
    expect(rejectedIntent.ok && rejectedIntent.value[0].facts.some(e => e.type === 'broker-status-observed' && e.status === 'rejected')).toBe(true);

    f.setOutcome({ outcome: 'accepted', brokerOrderId: 'broker-order-2' });
    const activePreview = await manager.preview(intent.order);
    const active = await manager.confirm({ confirmationToken: activePreview.confirmationToken, termsHash: activePreview.termsHash });
    f.setReconcile({ status: 'partially-filled', brokerOrderId: 'broker-order-2', executions: [{ executionId: 'fill-1', brokerOrderId: 'broker-order-2', observedQuantity: { value: '0.004', precision: 4, scale: 3 }, observedPrice: { value: '1.01', precision: 3, scale: 2 }, observedFee: { value: '0.01', precision: 3, scale: 2 }, currency: 'USD' }] });
    expect(await manager.reconcileAll()).toBe(1);
    expect(await manager.cancel(active.intentId)).toBe('acknowledged');
    expect(f.counts().cancelCalls).toBe(1);
    await expect(manager.cancel(active.intentId)).rejects.toThrow();
    expect(f.counts().cancelCalls).toBe(1);
    // A cancel acknowledgement is only a receipt; a post-cancel partial fill keeps the account locked.
    f.setReconcile({ status: 'partially-filled', brokerOrderId: 'broker-order-2', executions: [{ executionId: 'fill-2', brokerOrderId: 'broker-order-2', observedQuantity: { value: '0.002', precision: 4, scale: 3 }, observedPrice: { value: '1.02', precision: 3, scale: 2 }, currency: 'USD' }] });
    expect(await manager.reconcileAll()).toBe(1);
    await expect(manager.resumeNewOrders()).rejects.toThrow();
    f.setReconcile({ status: 'canceled', brokerOrderId: 'broker-order-2', executions: [] });
    expect(await manager.reconcileAll()).toBe(1);
    await manager.resumeNewOrders();
    const histories = f.ledger.history({ ownerId: id(1), accountId: id(2) }, { after: 0, limit: 10 });
    expect(histories.ok && histories.value.some(p => p.facts.some(e => e.type === 'execution-observed' && e.execution.executionId === 'fill-2' && e.execution.observedFee === undefined))).toBe(true);
    expect(f.counts().dispatchCalls).toBe(2);
  } finally { f.cleanup(); }
});

it('ambiguous durable claim failure poisons the ledger and never invokes dispatch', async () => {
  const f = fixture(), raw = new Database(f.path);
  try {
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    raw.exec("CREATE TRIGGER fail_dispatch_claim BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.type')='dispatch-claimed' BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END");
    await expect(manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(0);
    expect(f.ledger.available()).toBe(false);
  } finally { raw.close(); f.cleanup(); }
});

it('canonical ledger replay rejects semantically corrupted but rehashed M5 confirmation facts', async () => {
  const f = fixture();
  let raw: Database.Database | undefined;
  try {
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    await manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash });
    const records = f.ledger.history({ ownerId: id(1), accountId: id(2) }, { after: 0, limit: 10 });
    expect(records.ok).toBe(true);
    if (!records.ok) throw new Error(records.error);
    const projection = records.value[0];
    raw = new Database(f.path);
    const intentRow = raw.prepare('SELECT body FROM intents WHERE owner=? AND account=? AND id=?').get(id(1), id(2), projection.intent.intentId) as { body: string };
    const rows = raw.prepare('SELECT seq,body FROM events WHERE owner=? AND account=? AND intent=? ORDER BY seq').all(id(1), id(2), projection.intent.intentId) as { seq: number; body: string }[];
    const altered = rows.map(row => {
      const event = eventSchema.parse(JSON.parse(row.body));
      return event.type === 'preview-confirmed' ? { ...event, fee: { value: '0.02', precision: 3, scale: 2 } } : event;
    });
    let previous = digest(intentRow.body);
    raw.transaction(() => {
      altered.forEach((event, index) => {
        const body = canonical(event), hash = digest(previous + body);
        raw!.prepare('UPDATE events SET body=?,previous=?,hash=? WHERE owner=? AND account=? AND intent=? AND seq=?').run(body, previous, hash, id(1), id(2), projection.intent.intentId, index + 1);
        previous = hash;
      });
      raw!.prepare('UPDATE intents SET projection=? WHERE owner=? AND account=? AND id=?').run(canonical({ version: 1, intent: projection.intent, eventCount: altered.length, facts: altered }), id(1), id(2), projection.intent.intentId);
    }).immediate();
    expect(f.ledger.getIntent({ ownerId: id(1), accountId: id(2), intentId: projection.intent.intentId })).toMatchObject({ error: 'unavailable' });
  } finally { try { raw?.close(); } catch {} f.cleanup(); }
});

it('account halt and preview invalidation are shared by lifecycle handles for one worker ledger', async () => {
  const f = fixture();
  try {
    const first = f.lifecycle(); await ready(first);
    const second = f.lifecycle();
    const preview = await second.preview(intent.order);
    first.haltNewOrders();
    await expect(second.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash })).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(0);
  } finally { f.cleanup(); }
});

it('ambiguous pre-M5 ledger observations stop lifecycle resume instead of assuming a terminal state', async () => {
  const f = fixture();
  try {
    expect(f.ledger.recordIntent(intent).ok).toBe(true);
    expect(f.ledger.append(event).ok).toBe(true);
    const manager = f.lifecycle();
    await expect(manager.resumeNewOrders()).rejects.toThrow();
    expect(f.counts().dispatchCalls).toBe(0);
  } finally { f.cleanup(); }
});

it('halt blocks new previews but does not block read-only reconciliation; unsupported production adapter fails closed', async () => {
  const f = fixture();
  try {
    const unsupported = new OrderLifecycle(f.ledger, id(1), () => ({ accountId: id(2), routing: intent.routing }), new UnsupportedOrderAdapter());
    await ready(unsupported);
    await expect(unsupported.preview(intent.order)).rejects.toThrow();
    const manager = f.lifecycle(); await ready(manager);
    const preview = await manager.preview(intent.order);
    f.setOutcome({ outcome: 'accepted', brokerOrderId: 'broker-order-3' });
    const active = await manager.confirm({ confirmationToken: preview.confirmationToken, termsHash: preview.termsHash });
    manager.haltNewOrders();
    await expect(manager.preview(intent.order)).rejects.toThrow();
    f.setReconcile({ status: 'open', brokerOrderId: 'broker-order-3', executions: [] });
    expect(await manager.reconcileAll()).toBe(1);
    expect(f.counts().reconcileCalls).toBe(1);
    expect(active.outcome).toBe('acknowledged');
  } finally { f.cleanup(); }
});
