import { randomUUID, createHash } from 'node:crypto';
import { confirmationInputSchema } from './order-lifecycle.js';
import type { OrderAdapter, OrderPreview } from './order-lifecycle.js';
import { canonical } from './ledger-canonical.js';
import {
  syntheticMockFee, syntheticMockInstrument, syntheticMockPreviewSchema, syntheticMockQuote,
  syntheticMockSource, type SyntheticMockPreview,
} from './synthetic-mock-robinhood-contract.js';
import { SyntheticMockRobinhoodClient } from './synthetic-mock-robinhood-transport.js';
import { SyntheticPreviewDiagnostics } from './synthetic-preview-diagnostics.js';

function enabled(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only';
}
function tokenDigest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

export class SyntheticMockRobinhoodAdapter implements OrderAdapter {
  private prepared?: SyntheticMockPreview;
  private pending?: { preview: SyntheticMockPreview; confirmationToken: string; termsHash: string; handle: string };
  private admitting = false;

  constructor(private readonly client: SyntheticMockRobinhoodClient, private readonly now: () => number = Date.now,
    private readonly previewDiagnostics?: SyntheticPreviewDiagnostics) {
    if (!enabled()) throw new Error('synthetic mock disabled');
  }

  async preview(input: Parameters<OrderAdapter['preview']>[0]): Promise<unknown> {
    if (!enabled()) throw new Error('synthetic mock unavailable');
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 60000) throw new Error('synthetic mock unavailable');
    if (!this.admitting && this.prepared && Date.parse(this.prepared.expiresAt) <= now) this.prepared = undefined;
    if (!this.admitting && this.pending && Date.parse(this.pending.preview.expiresAt) <= now) this.pending = undefined;
    if (this.admitting || this.prepared || this.pending || input.account.accountId !== '00000000-0000-4000-8000-000000000002'
      || input.order.route !== 'RHS' || input.order.side !== 'buy' || input.order.currency !== 'USD'
      || input.order.instrumentId !== syntheticMockInstrument) throw new Error('synthetic mock unavailable');
    const preview = syntheticMockPreviewSchema.parse({
      version: 1, source: syntheticMockSource, previewId: randomUUID(), principal: 'gelt-test-principal-v1', account: 'gelt-test-account-v1',
      policyId: 'synthetic-limit-fee-cap-10.v1',
      quote: { instrumentId: syntheticMockInstrument, price: syntheticMockQuote, source: 'gelt-synthetic-robinhood-quote-v1' },
      fee: { amount: syntheticMockFee, currency: 'USD', source: 'gelt-synthetic-robinhood-fee-v1' },
      order: { instrumentId: syntheticMockInstrument, route: 'RHS', side: 'buy', type: 'limit', timeInForce: 'day',
        quantity: input.order.requestedQuantity, limitPrice: input.order.requestedLimitPrice, currency: 'USD' },
      expiresAt: new Date(now + 60000).toISOString(),
    });
    this.prepared = preview;
    return { previewId: preview.previewId, order: input.order, fee: syntheticMockFee, feeCurrency: 'USD', expiresAt: preview.expiresAt };
  }

  // Called only by the test-owned harness before the exact preview is returned to its caller.
  async admitPreview(preview: OrderPreview): Promise<void> {
    const prepared = this.prepared;
    const terms = preview.terms;
    const termsHash = preview.termsHash;
    const confirmationToken = preview.confirmationToken;
    if (!enabled() || !prepared || this.admitting || this.pending || terms.previewId !== prepared.previewId
      || termsHash !== tokenDigest(canonical({ ownerId: terms.ownerId, accountId: terms.accountId,
        routing: terms.routing, order: terms.order, previewId: terms.previewId,
        fee: terms.fee, feeCurrency: terms.feeCurrency, expiresAt: terms.expiresAt }))
      || terms.order.instrumentId !== syntheticMockInstrument) throw new Error('synthetic mock unavailable');
    this.admitting = true;
    try {
      const admission = await this.client.admit({ preview: prepared, termsHash, confirmationToken });
      if (this.prepared !== prepared || this.pending) throw new Error('synthetic mock unavailable');
      this.pending = { preview: prepared, confirmationToken, termsHash, handle: admission.handle };
      this.prepared = undefined;
    } finally {
      this.admitting = false;
      // An admission without a returned handle can never dispatch. The durable
      // unused admission is retired by storage only after expiry.
      if (this.prepared === prepared) this.prepared = undefined;
    }
  }

  discardUnadmittedPreview(): void {
    if (this.admitting) return;
    this.prepared = undefined;
  }

  discardRejectedConfirmation(input: unknown): void {
    const pending = this.pending;
    const confirmation = confirmationInputSchema.safeParse(input);
    if (!enabled() || !pending || !confirmation.success) return;
    // OrderLifecycle consumes a token before checking its bound terms hash.
    // Retire the matching mock admission only for that exact, schema-valid,
    // conclusive pre-dispatch mismatch; dispatch clears pending synchronously
    // before any network await.
    if (confirmation.data.confirmationToken === pending.confirmationToken
      && confirmation.data.termsHash !== pending.termsHash) this.pending = undefined;
  }

  async dispatch(input: Parameters<OrderAdapter['dispatch']>[0]): Promise<unknown> {
    this.previewDiagnostics?.record('mock-dispatch', 'started');
    try {
      const pending = this.pending;
      this.pending = undefined; // the fixture never retries an uncertain submission
      if (!enabled() || !pending || input.feeCurrency !== 'USD' || canonical(input.fee) !== canonical(syntheticMockFee)
        || input.intent.order.instrumentId !== syntheticMockInstrument || input.intent.order.side !== 'buy'
        || input.intent.order.route !== 'RHS' || input.intent.order.currency !== 'USD'
        || input.intent.order.requestedQuantity.value !== pending.preview.order.quantity.value
        || input.intent.order.requestedQuantity.precision !== pending.preview.order.quantity.precision
        || input.intent.order.requestedQuantity.scale !== pending.preview.order.quantity.scale
        || input.intent.order.requestedLimitPrice.value !== pending.preview.order.limitPrice.value
        || input.intent.order.requestedLimitPrice.precision !== pending.preview.order.limitPrice.precision
        || input.intent.order.requestedLimitPrice.scale !== pending.preview.order.limitPrice.scale) throw new Error('synthetic mock unavailable');
      const order = await this.client.submit({ dispatchId: input.dispatchId, preview: pending.preview, termsHash: pending.termsHash,
        confirmationToken: pending.confirmationToken, admissionHandle: pending.handle });
      this.previewDiagnostics?.record('mock-dispatch', 'succeeded');
      return { outcome: 'accepted', brokerOrderId: order.mockOrderId };
    } catch (error) { this.previewDiagnostics?.record('mock-dispatch', 'rejected', undefined, error); throw error; }
  }

  async reconcile(input: Parameters<OrderAdapter['reconcile']>[0]): Promise<unknown> {
    if (!enabled() || !input.brokerOrderId) return { status: 'unknown', executions: [] };
    const order = await this.client.read(input.dispatchId);
    if (order.mockOrderId !== input.brokerOrderId) return { status: 'unknown', executions: [] };
    const status = order.status === 'accepted' ? 'open' : order.status;
    return { status, brokerOrderId: order.mockOrderId, executions: order.executions.map(execution => ({
      executionId: execution.executionId, brokerOrderId: order.mockOrderId, observedQuantity: execution.quantity,
      observedPrice: execution.price, ...(execution.fee ? { observedFee: execution.fee } : {}), currency: execution.currency,
    })) };
  }

  async cancel(input: Parameters<OrderAdapter['cancel']>[0]): Promise<unknown> {
    if (!enabled()) throw new Error('synthetic mock disabled');
    const order = await this.client.cancel(input.intent.intentId);
    if (order.mockOrderId !== input.brokerOrderId) throw new Error('synthetic mock unavailable');
    return { acknowledged: order.cancelAcknowledged };
  }

  readMockOrder(dispatchId: string) { return this.client.read(dispatchId); }
}
