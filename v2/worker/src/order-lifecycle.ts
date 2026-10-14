import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Ledger } from './ledger.js';
import { canonical, digest } from './ledger-canonical.js';
import {
  decimalSchema, eventSchema, intentSchema, ledgerId, orderSchema, projectionSchema,
  routingSchema, type Intent, type LedgerEvent, type Projection, type Result,
} from './ledger-contract.js';

const safeId = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).refine(s => !/token|secret|bearer|password|oauth|pkce/i.test(s));
const isoMillis = z.string().datetime({ precision: 3 }).refine(s => {
  try { return new Date(s).toISOString() === s; } catch { return false; }
});
const orderStatus = z.enum(['accepted', 'open', 'partially-filled', 'pending-cancel', 'rejected', 'filled', 'canceled', 'unknown', 'not-found']);
const termsObjectSchema = z.object({
  version: z.literal(1), previewId: ledgerId, ownerId: ledgerId, accountId: ledgerId,
  routing: routingSchema, order: orderSchema, fee: decimalSchema, feeCurrency: z.literal('USD'), expiresAt: isoMillis,
}).strict();
const termsSchema = termsObjectSchema.refine(t => t.order.side === 'buy' && (t.order.route !== 'RHC' || t.routing.RHC !== undefined));
const previewResponseSchema = z.object({ previewId: ledgerId, order: orderSchema, fee: decimalSchema, feeCurrency: z.literal('USD'), expiresAt: isoMillis }).strict();
const dispatchResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('accepted'), brokerOrderId: safeId }).strict(),
  z.object({ outcome: z.literal('rejected'), brokerOrderId: safeId.optional() }).strict(),
  z.object({ outcome: z.literal('unknown') }).strict(),
]);
const observedExecutionSchema = z.object({
  executionId: safeId, brokerOrderId: safeId,
  observedQuantity: decimalSchema.refine(d => /[1-9]/.test(d.value)),
  observedPrice: decimalSchema.refine(d => /[1-9]/.test(d.value)),
  observedFee: decimalSchema.optional(), currency: z.literal('USD'),
}).strict();
const reconciliationResponseSchema = z.object({
  status: orderStatus, brokerOrderId: safeId.optional(), executions: z.array(observedExecutionSchema).max(100),
}).strict();
const cancelResponseSchema = z.object({ acknowledged: z.boolean() }).strict();
export const orderPreviewSchema = z.object({ terms: termsSchema, confirmationToken: z.string().length(43), termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const confirmationInputSchema = z.object({ confirmationToken: z.string().length(43), termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const simulationPreviewSchema = z.object({ terms: termsObjectSchema, confirmationToken: z.string().length(43), termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type OrderTerms = z.infer<typeof termsSchema>;
export type OrderPreview = z.infer<typeof orderPreviewSchema>;
export type BrokerObservation = z.infer<typeof reconciliationResponseSchema>;

export interface SelectedOrderAccount { accountId: string; routing: Intent['routing'] }
export interface OrderAdapter {
  preview(input: { account: SelectedOrderAccount; order: z.infer<typeof orderSchema> }): Promise<unknown>;
  dispatch(input: { dispatchId: string; intent: Intent; fee: z.infer<typeof decimalSchema>; feeCurrency: 'USD' }): Promise<unknown>;
  reconcile(input: { dispatchId: string; intent: Intent; brokerOrderId?: string }): Promise<unknown>;
  cancel(input: { cancelId: string; intent: Intent; brokerOrderId: string }): Promise<unknown>;
}

// ZAR-212 owner GO permits feasibility work, not live activation. Actual fill,
// replay and unknown-outcome recovery semantics need reviewed integration evidence.
// This unsupported adapter performs no network or credential IO.
export class UnsupportedOrderAdapter implements OrderAdapter {
  async preview(): Promise<never> { throw new Error('order preview unsupported'); }
  async dispatch(): Promise<never> { throw new Error('order dispatch unsupported'); }
  async reconcile(): Promise<never> { throw new Error('order reconciliation unsupported'); }
  async cancel(): Promise<never> { throw new Error('order cancellation unsupported'); }
}

const pow10 = (n: number) => 10n ** BigInt(n);
function coefficient(decimal: z.infer<typeof decimalSchema>): bigint { return BigInt(decimal.value.replace('.', '')); }
function withinFeeInclusiveCap(quantity: z.infer<typeof decimalSchema>, price: z.infer<typeof decimalSchema>, fee: z.infer<typeof decimalSchema>): boolean {
  const productScale = quantity.scale + price.scale;
  const commonScale = Math.max(productScale, fee.scale);
  const gross = coefficient(quantity) * coefficient(price) * pow10(commonScale - productScale)
    + coefficient(fee) * pow10(commonScale - fee.scale);
  return gross <= 10n * pow10(commonScale);
}
function sameAccount(left: SelectedOrderAccount, right: SelectedOrderAccount): boolean {
  return left.accountId === right.accountId && canonical(left.routing) === canonical(right.routing);
}
function currentTime(now: () => number): string { return new Date(now()).toISOString(); }
function copy<T>(value: T): T { return JSON.parse(canonical(value)) as T; }
function binding(intent: Pick<Intent, 'ownerId' | 'accountId' | 'routing' | 'order'>, previewId: string, fee: z.infer<typeof decimalSchema>, feeCurrency: 'USD', expiresAt: string): string {
  return digest(canonical({ ownerId: intent.ownerId, accountId: intent.accountId, routing: intent.routing, order: intent.order, previewId, fee, feeCurrency, expiresAt }));
}
function successful<T>(result: Result<T>): T {
  if (!result.ok) throw new Error('order lifecycle unavailable');
  return result.value;
}
function append(ledger: LifecycleFacts, event: LedgerEvent): void {
  const receipt = successful(ledger.append(event));
  if (receipt.disposition !== 'committed') throw new Error('order lifecycle unavailable');
}
function eventBase(intent: Intent, now: () => number) {
  return { version: 1 as const, ownerId: intent.ownerId, accountId: intent.accountId, intentId: intent.intentId, eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: currentTime(now) };
}
function isLifecycle(event: LedgerEvent): boolean {
  return event.type === 'preview-confirmed' || event.type === 'dispatch-claimed' || event.type === 'dispatch-outcome-unknown' || event.type === 'reconciliation-unavailable' || event.type === 'broker-status-observed' || event.type === 'cancel-requested' || event.type === 'cancel-acknowledged';
}
function terminalStatus(status: z.infer<typeof orderStatus>): boolean { return status === 'rejected' || status === 'filled' || status === 'canceled'; }
function projectionState(projection: Projection): { lifecycle: boolean; open: boolean; dispatchId: string; brokerOrderId?: string } {
  const facts = projection.facts;
  const lifecycleFacts = facts.filter(isLifecycle);
  if (!lifecycleFacts.some(e => e.type === 'preview-confirmed')) {
    if (lifecycleFacts.length) throw new Error('order lifecycle unavailable');
    // M4 facts do not define terminal order state. Any attempted/requested/acknowledged
    // or execution/reconciliation fact is ambiguous to M5 and blocks a new dispatch.
    const ambiguous = facts.some(event => event.type === 'dispatch-attempted' || event.type === 'order-requested' || event.type === 'broker-acknowledged' || event.type === 'reconciliation-observed' || event.type === 'execution-observed');
    return { lifecycle: false, open: ambiguous, dispatchId: projection.intent.intentId };
  }
  const confirmed = lifecycleFacts.filter((e): e is Extract<LedgerEvent, {type:'preview-confirmed'}> => e.type === 'preview-confirmed');
  const claimed = lifecycleFacts.filter((e): e is Extract<LedgerEvent, {type:'dispatch-claimed'}> => e.type === 'dispatch-claimed');
  if (confirmed.length !== 1 || claimed.length > 1) throw new Error('order lifecycle unavailable');
  const c = confirmed[0];
  if (projection.intent.recordedAt !== c.occurredAt || Date.parse(c.occurredAt) > Date.parse(c.expiresAt) || c.termsHash !== binding(projection.intent, c.previewId, c.fee, c.feeCurrency, c.expiresAt)) throw new Error('order lifecycle unavailable');
  if (claimed.length) {
    const claim = claimed[0];
    if (claim.previewId !== c.previewId || claim.confirmationId !== c.confirmationId || claim.termsHash !== c.termsHash || claim.dispatchId !== projection.intent.intentId || facts.indexOf(claim) <= facts.indexOf(c) || claim.occurredAt < c.occurredAt || Date.parse(claim.occurredAt) >= Date.parse(c.expiresAt)) throw new Error('order lifecycle unavailable');
  }
  const claimIndex = claimed.length ? facts.indexOf(claimed[0]) : -1;
  for (const fact of facts) {
    if ((fact.type === 'broker-status-observed' || fact.type === 'cancel-requested' || fact.type === 'cancel-acknowledged' || fact.type === 'broker-acknowledged' || fact.type === 'execution-observed' || fact.type === 'dispatch-attempted' || fact.type === 'order-requested' || fact.type === 'reconciliation-observed' || fact.type === 'dispatch-outcome-unknown' || fact.type === 'reconciliation-unavailable') && (claimIndex < 0 || facts.indexOf(fact) <= claimIndex)) throw new Error('order lifecycle unavailable');
    if ((fact.type === 'dispatch-outcome-unknown' || fact.type === 'reconciliation-unavailable') && fact.dispatchId !== projection.intent.intentId) throw new Error('order lifecycle unavailable');
  }
  const cancelRequests = facts.filter((e): e is Extract<LedgerEvent, {type:'cancel-requested'}> => e.type === 'cancel-requested');
  const cancelAcks = facts.filter((e): e is Extract<LedgerEvent, {type:'cancel-acknowledged'}> => e.type === 'cancel-acknowledged');
  if (cancelRequests.length > 1 || cancelAcks.length > 1 || cancelAcks.some(a => {
    const request = cancelRequests.find(r => r.cancelId === a.cancelId && r.brokerOrderId === a.brokerOrderId);
    return !request || facts.indexOf(request) >= facts.indexOf(a);
  })) throw new Error('order lifecycle unavailable');
  for (const request of cancelRequests) {
    const known = facts.slice(0, facts.indexOf(request)).some(e => e.type === 'broker-acknowledged' && e.brokerOrderId === request.brokerOrderId || e.type === 'broker-status-observed' && e.brokerOrderId === request.brokerOrderId);
    if (!known) throw new Error('order lifecycle unavailable');
  }
  const brokerIds = facts.flatMap(e => e.type === 'broker-acknowledged' ? [e.brokerOrderId] : e.type === 'broker-status-observed' && e.brokerOrderId ? [e.brokerOrderId] : e.type === 'execution-observed' ? [e.execution.brokerOrderId] : e.type === 'cancel-requested' || e.type === 'cancel-acknowledged' ? [e.brokerOrderId] : []);
  if (new Set(brokerIds).size > 1) throw new Error('order lifecycle unavailable');
  const statuses = facts.filter((e): e is Extract<LedgerEvent, {type:'broker-status-observed'}> => e.type === 'broker-status-observed');
  const lastStatus = statuses.at(-1);
  const lastStatusIndex = lastStatus ? facts.indexOf(lastStatus) : -1;
  const lastExecutionIndex = facts.reduce((last, event, index) => event.type === 'execution-observed' ? index : last, -1);
  const lastUncertaintyIndex = facts.reduce((last, event, index) => event.type === 'dispatch-outcome-unknown' || event.type === 'reconciliation-unavailable' || event.type === 'dispatch-attempted' || event.type === 'order-requested' || event.type === 'broker-acknowledged' || event.type === 'reconciliation-observed' ? index : last, -1);
  // A status observed after an unknown dispatch does not establish that it
  // belongs to that dispatch. Keep the durable uncertainty until a separately
  // reviewed correlation/recovery contract exists; never infer closure from time.
  const unknownDispatch = facts.some(event => event.type === 'dispatch-outcome-unknown');
  const correlatedTerminal = lastStatus && terminalStatus(lastStatus.status)
    && (lastStatus.status === 'rejected' && !unknownDispatch
      || !!lastStatus.brokerOrderId && facts.some(event => event.type === 'broker-acknowledged' && event.brokerOrderId === lastStatus.brokerOrderId));
  const open = unknownDispatch || !lastStatus || !terminalStatus(lastStatus.status) || !correlatedTerminal
    || lastExecutionIndex > lastStatusIndex || lastUncertaintyIndex > lastStatusIndex;
  return { lifecycle: true, open, dispatchId: projection.intent.intentId, ...(brokerIds.length ? { brokerOrderId: brokerIds.at(-1) } : {}) };
}

// Called inside Ledger's transaction-local canonical replay on every read/write.
// It rejects malformed M5 facts and multiple in-flight orders for one account.
export function hasUnresolvedLifecycle(projections: Projection[]): boolean {
  return projections.some(projection => projectionState(projection).open);
}

export function validateLifecycleProjections(projections: Projection[]): void {
  const inFlight = new Set<string>(), confirmationIds = new Set<string>();
  for (const projection of projections) {
    const state = projectionState(projection);
    if (state.lifecycle) {
      const confirmation = projection.facts.find((event): event is Extract<LedgerEvent, {type:'preview-confirmed'}> => event.type === 'preview-confirmed');
      if (!confirmation) throw new Error('order lifecycle unavailable');
      const confirmationKey = `${projection.intent.ownerId}:${confirmation.confirmationId}`;
      if (confirmationIds.has(confirmationKey)) throw new Error('order lifecycle unavailable');
      confirmationIds.add(confirmationKey);
    }
    if (!state.lifecycle || !state.open) continue;
    const scope = `${projection.intent.ownerId}:${projection.intent.accountId}`;
    if (inFlight.has(scope)) throw new Error('order lifecycle unavailable');
    inFlight.add(scope);
  }
}

// The offline fixture implements only this facts contract in its own synthetic
// schema. Production still supplies the native Ledger and never constructs it.
export type LifecycleFacts = Pick<Ledger, 'recordIntent' | 'append' | 'history' | 'ownerHasUnresolvedLifecycle'>;
type LifecycleControl = { halted: boolean; generation: number; tail: Promise<void> };
const lifecycleControls = new WeakMap<LifecycleFacts, LifecycleControl>();

export class OrderLifecycle {
  private readonly control: LifecycleControl;
  private readonly previews = new Map<string, { terms: OrderTerms; termsHash: string; generation: number }>();
  constructor(private readonly ledger: LifecycleFacts, private readonly ownerId: string, private readonly selected: () => SelectedOrderAccount | null, private readonly adapter: OrderAdapter, private readonly now = Date.now, private readonly uuid = randomUUID, private readonly token = () => randomBytes(32).toString('base64url'), private readonly options: { configuredSimulation?: true } = {}) {
    ledgerId.parse(ownerId);
    if (options.configuredSimulation) this.simulationScope();
    const shared = lifecycleControls.get(ledger);
    this.control = shared ?? { halted: true, generation: 0, tail: Promise.resolve() };
    if (!shared) lifecycleControls.set(ledger, this.control);
  }
  private simulationScope(order?: z.infer<typeof orderSchema>): void {
    const account = this.selected();
    if (process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_ORDER_HARNESS !== 'offline-test-only'
      || process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only'
      || this.ownerId !== '00000000-0000-4000-8000-000000000001'
      || account?.accountId !== '00000000-0000-4000-8000-000000000002'
      || canonical(account.routing) !== canonical({ provider: 'robinhood-official-mcp', ACCOUNT: 'synthetic-account', RHS: 'synthetic-rhs', RHC: 'synthetic-rhc' })
      || (order && (order.route !== 'RHS' || order.instrumentId !== 'SYNTH-RH-USD' || order.currency !== 'USD'))) throw new Error('order lifecycle unavailable');
  }
  private exclusive<T>(body: () => Promise<T>): Promise<T> {
    const previous = this.control.tail;
    let release!: () => void;
    this.control.tail = new Promise<void>(resolve => { release = resolve; });
    return previous.then(body).finally(release);
  }
  private scope(): SelectedOrderAccount {
    const value = this.selected();
    if (!value || !ledgerId.safeParse(value.accountId).success || !routingSchema.safeParse(value.routing).success) throw new Error('order lifecycle unavailable');
    return { accountId: value.accountId, routing: routingSchema.parse(value.routing) };
  }
  private projections(account: SelectedOrderAccount): Projection[] {
    const all: Projection[] = [];
    for (let after = 0; after <= 1000; after += 100) {
      const page = successful(this.ledger.history({ ownerId: this.ownerId, accountId: account.accountId }, { after, limit: 100 }));
      all.push(...page);
      if (page.length < 100) break;
    }
    return all.map(value => projectionSchema.parse(value));
  }
  private states(account: SelectedOrderAccount) {
    const projections = this.projections(account);
    if (projections.some(projection => !sameAccount({ accountId: projection.intent.accountId, routing: projection.intent.routing }, account))) throw new Error('order lifecycle unavailable');
    validateLifecycleProjections(projections);
    return projections.map(projection => ({ projection, state: projectionState(projection) }));
  }
  private stopNewOrders(): void { this.control.halted = true; this.control.generation++; this.previews.clear(); }
  haltNewOrders(): void { this.stopNewOrders(); }
  async resumeNewOrders(): Promise<void> {
    await this.exclusive(async () => {
      try {
        const scope = this.scope();
        // The halt is shared across selected accounts. Never clear it by
        // switching to an empty account while another account is unresolved.
        if (successful(this.ledger.ownerHasUnresolvedLifecycle(this.ownerId)) || this.states(scope).some(({ state }) => state.open)) throw new Error('order lifecycle unavailable');
        this.control.halted = false;
      } catch { this.stopNewOrders(); throw new Error('order lifecycle unavailable'); }
    });
  }
  async preview(input: unknown): Promise<OrderPreview> {
    return this.exclusive(async () => {
      if (this.control.halted) throw new Error('order lifecycle unavailable');
      try {
        const account = this.scope();
        if (this.states(account).some(({ state }) => state.open)) throw new Error('order lifecycle unavailable');
        const order = orderSchema.parse(input);
        if (this.options.configuredSimulation) this.simulationScope(order);
        if ((!this.options.configuredSimulation && order.side !== 'buy') || (order.route === 'RHC' && account.routing.RHC === undefined)) throw new Error('order lifecycle unavailable');
        const requestedOrder = canonical(order);
        const response = previewResponseSchema.parse(await this.adapter.preview({ account: copy(account), order: copy(order) }));
        if (canonical(response.order) !== requestedOrder) throw new Error('order lifecycle unavailable');
        const now = this.now(), expiry = Date.parse(response.expiresAt);
        if (!Number.isSafeInteger(now) || expiry <= now || expiry > now + 300000) throw new Error('order lifecycle unavailable');
        if (!sameAccount(account, this.scope()) || this.control.halted) throw new Error('order lifecycle unavailable');
        const terms = (this.options.configuredSimulation ? termsObjectSchema : termsSchema).parse({ version: 1, ownerId: this.ownerId, ...account, order, previewId: response.previewId, fee: response.fee, feeCurrency: response.feeCurrency, expiresAt: response.expiresAt });
        if (!withinFeeInclusiveCap(order.requestedQuantity, order.requestedLimitPrice, response.fee)) throw new Error('order lifecycle unavailable');
        for (const [key, value] of this.previews) if (Date.parse(value.terms.expiresAt) <= now) this.previews.delete(key);
        if (this.previews.size >= 100) throw new Error('order lifecycle unavailable');
        const termsHash = binding(terms, terms.previewId, terms.fee, terms.feeCurrency, terms.expiresAt);
        const confirmationToken = this.token();
        if (typeof confirmationToken !== 'string' || confirmationToken.length !== 43 || this.previews.has(confirmationToken)) throw new Error('order lifecycle unavailable');
        this.previews.set(confirmationToken, { terms, termsHash, generation: this.control.generation });
        return (this.options.configuredSimulation ? simulationPreviewSchema : orderPreviewSchema).parse({ terms, confirmationToken, termsHash });
      } catch { throw new Error('order lifecycle unavailable'); }
    });
  }
  async confirm(input: unknown): Promise<{ intentId: string; outcome: 'acknowledged' | 'rejected' | 'unknown' }> {
    return this.exclusive(async () => {
      const decoded = confirmationInputSchema.safeParse(input);
      if (!decoded.success) throw new Error('order lifecycle unavailable');
      const saved = this.previews.get(decoded.data.confirmationToken);
      this.previews.delete(decoded.data.confirmationToken); // one use, even on expiry or changed terms
      if (!saved || saved.termsHash !== decoded.data.termsHash || saved.generation !== this.control.generation || this.control.halted) throw new Error('order lifecycle unavailable');
      let dispatchStarted = false;
      try {
        const account = this.scope();
        if (this.options.configuredSimulation) this.simulationScope(saved.terms.order);
        if (saved.terms.ownerId !== this.ownerId || saved.terms.accountId !== account.accountId || !sameAccount({ accountId: saved.terms.accountId, routing: saved.terms.routing }, account)) throw new Error('order lifecycle unavailable');
        const now = this.now();
        if (Date.parse(saved.terms.expiresAt) <= now || Date.parse(saved.terms.expiresAt) > now + 300000) throw new Error('order lifecycle unavailable');
        if (!withinFeeInclusiveCap(saved.terms.order.requestedQuantity, saved.terms.order.requestedLimitPrice, saved.terms.fee)) throw new Error('order lifecycle unavailable');
        if (this.states(account).some(({ state }) => state.open)) throw new Error('order lifecycle unavailable');
        const occurredAt = currentTime(this.now);
        const intent = intentSchema.parse({ version: 1, ownerId: this.ownerId, accountId: account.accountId, intentId: this.uuid(), idempotencyKey: this.uuid(), recordedAt: occurredAt, routing: account.routing, order: saved.terms.order });
        const intentReceipt = successful(this.ledger.recordIntent(intent));
        if (intentReceipt.disposition !== 'committed') throw new Error('order lifecycle unavailable');
        const confirmationId = this.uuid();
        const termsHash = binding(intent, saved.terms.previewId, saved.terms.fee, saved.terms.feeCurrency, saved.terms.expiresAt);
        append(this.ledger, eventSchema.parse({ ...eventBase(intent, () => Date.parse(occurredAt)), type: 'preview-confirmed', previewId: saved.terms.previewId, confirmationId, fee: saved.terms.fee, feeCurrency: saved.terms.feeCurrency, expiresAt: saved.terms.expiresAt, termsHash }));
        append(this.ledger, eventSchema.parse({ ...eventBase(intent, this.now), type: 'dispatch-claimed', dispatchId: intent.intentId, previewId: saved.terms.previewId, confirmationId, termsHash }));
        // The durable claim above is the only authorization to invoke an injected adapter.
        // Recheck expiry immediately before the call; a stale claim remains unresolved.
        if (Date.parse(saved.terms.expiresAt) <= this.now()) throw new Error('order lifecycle unavailable');
        // It is never replayed as a dispatch after restart.
        dispatchStarted = true;
        let outcome: z.infer<typeof dispatchResponseSchema>;
        try { outcome = dispatchResponseSchema.parse(await this.adapter.dispatch({ dispatchId: intent.intentId, intent: copy(intent), fee: copy(saved.terms.fee), feeCurrency: saved.terms.feeCurrency })); }
        catch { outcome = { outcome: 'unknown' }; }
        if (outcome.outcome === 'accepted' && outcome.brokerOrderId) {
          append(this.ledger, eventSchema.parse({ ...eventBase(intent, this.now), type: 'broker-acknowledged', brokerOrderId: outcome.brokerOrderId }));
          return { intentId: intent.intentId, outcome: 'acknowledged' };
        }
        if (outcome.outcome === 'rejected') {
          append(this.ledger, eventSchema.parse({ ...eventBase(intent, this.now), type: 'broker-status-observed', observationId: this.uuid(), status: 'rejected', ...(outcome.brokerOrderId ? { brokerOrderId: outcome.brokerOrderId } : {}) }));
          return { intentId: intent.intentId, outcome: 'rejected' };
        }
        append(this.ledger, eventSchema.parse({ ...eventBase(intent, this.now), type: 'dispatch-outcome-unknown', outcomeId: this.uuid(), dispatchId: intent.intentId }));
        this.stopNewOrders();
        return { intentId: intent.intentId, outcome: 'unknown' };
      } catch {
        this.stopNewOrders();
        // Any error after the durable claim may hide a completed provider action.
        if (dispatchStarted) throw new Error('order outcome unknown; reconciliation required');
        throw new Error('order lifecycle unavailable');
      }
    });
  }
  async reconcileAll(): Promise<number> {
    return this.exclusive(async () => {
      let observations = 0;
      try {
        const account = this.scope();
        for (const { projection, state } of this.states(account)) {
          if (!state.lifecycle || !state.open) continue;
          const acknowledgedBrokerOrderId = projection.facts.find(event => event.type === 'broker-acknowledged')?.brokerOrderId;
          let response: z.infer<typeof reconciliationResponseSchema>;
          try {
            response = reconciliationResponseSchema.parse(await this.adapter.reconcile({ dispatchId: state.dispatchId, intent: copy(projection.intent), ...(acknowledgedBrokerOrderId ? { brokerOrderId: acknowledgedBrokerOrderId } : {}) }));
          } catch {
            append(this.ledger, eventSchema.parse({ ...eventBase(projection.intent, this.now), type: 'reconciliation-unavailable', reconciliationId: this.uuid(), dispatchId: state.dispatchId }));
            this.stopNewOrders(); observations++;
            continue;
          }
          // Every status and execution, not just a terminal one, needs a
          // previously acknowledged matching broker order. An unknown dispatch
          // cannot acquire identity merely because a read asserts an ID.
          if (!acknowledgedBrokerOrderId || state.brokerOrderId !== acknowledgedBrokerOrderId
            || response.brokerOrderId !== acknowledgedBrokerOrderId
            || projection.facts.some(event => event.type === 'dispatch-outcome-unknown')
            || response.executions.some(execution => execution.brokerOrderId !== acknowledgedBrokerOrderId)) {
            // The read succeeded but is not correlated to this intent. Do not
            // record a false read failure, status, or attributed execution.
            this.stopNewOrders(); observations++;
            continue;
          }
          const observation = response.status === 'not-found' ? 'not-found' : response.status === 'unknown' ? 'unknown' : 'present';
          append(this.ledger, eventSchema.parse({ ...eventBase(projection.intent, this.now), type: 'reconciliation-observed', reconciliationId: this.uuid(), observation }));
          const knownExecutions = new Map(projection.facts.flatMap(event => event.type === 'execution-observed' ? [[event.execution.executionId, event.execution] as const] : []));
          for (const execution of response.executions) {
            const known = knownExecutions.get(execution.executionId);
            if (known) {
              if (canonical(known) !== canonical(execution)) throw new Error('order lifecycle unavailable');
              continue;
            }
            append(this.ledger, eventSchema.parse({ ...eventBase(projection.intent, this.now), type: 'execution-observed', execution }));
            knownExecutions.set(execution.executionId, execution);
          }
          append(this.ledger, eventSchema.parse({ ...eventBase(projection.intent, this.now), type: 'broker-status-observed', observationId: this.uuid(), status: response.status, ...(response.brokerOrderId ? { brokerOrderId: response.brokerOrderId } : {}) }));
          observations++;
        }
        return observations;
      } catch { this.stopNewOrders(); throw new Error('order lifecycle unavailable'); }
    });
  }
  async cancel(intentId: unknown): Promise<'acknowledged' | 'unknown'> {
    return this.exclusive(async () => {
      try {
        const queryId = ledgerId.parse(intentId), account = this.scope();
        const projection = this.states(account).map(item => item.projection).find(p => p.intent.intentId === queryId);
        if (!projection) throw new Error('order lifecycle unavailable');
        const state = projectionState(projection);
        const acknowledgedBrokerOrderId = projection.facts.find(event => event.type === 'broker-acknowledged')?.brokerOrderId;
        if (!state.lifecycle || !state.open || !acknowledgedBrokerOrderId || state.brokerOrderId !== acknowledgedBrokerOrderId
          || projection.facts.some(e => e.type === 'dispatch-outcome-unknown' || e.type === 'cancel-requested')) throw new Error('order lifecycle unavailable');
        const cancelId = this.uuid();
        append(this.ledger, eventSchema.parse({ ...eventBase(projection.intent, this.now), type: 'cancel-requested', cancelId, brokerOrderId: state.brokerOrderId }));
        let response: z.infer<typeof cancelResponseSchema>;
        try { response = cancelResponseSchema.parse(await this.adapter.cancel({ cancelId, intent: copy(projection.intent), brokerOrderId: state.brokerOrderId })); }
        catch { this.stopNewOrders(); return 'unknown'; }
        if (response.acknowledged) {
          append(this.ledger, eventSchema.parse({ ...eventBase(projection.intent, this.now), type: 'cancel-acknowledged', cancelId, brokerOrderId: state.brokerOrderId }));
          // An acknowledgement is only an observed request receipt. Reconciliation remains required.
          return 'acknowledged';
        }
        this.stopNewOrders();
        return 'unknown';
      } catch { this.stopNewOrders(); throw new Error('order lifecycle unavailable'); }
    });
  }
}
