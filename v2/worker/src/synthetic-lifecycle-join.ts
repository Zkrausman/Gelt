import { canonical } from './ledger-canonical.js';
import { projectionSchema, type Projection } from './ledger-contract.js';
import { validateLifecycleProjections } from './order-lifecycle.js';
import { simulationPortfolioReadSchema } from './synthetic-simulation-economics.js';
import { syntheticMockRunPreviewSchema, syntheticMockOrderViewSchema, syntheticMockRunExecutionSchema, type SyntheticRunPreview, type SyntheticMockOrderView } from './synthetic-mock-robinhood-contract.js';

// Internal contradiction signal. The owning harness fences both owners.
export class SyntheticLifecycleJoinCorruption extends Error {
  constructor() { super('synthetic lifecycle join unavailable'); }
}

// Matched owner reads, not a cross-store transaction or provenance authenticator.
// Current post-trade balances are deliberately not compared to the old preview.
export function joinSyntheticLifecycle(rawProjection: Projection, rawPreview: SyntheticRunPreview,
  rawOrder: SyntheticMockOrderView, termsHash: string,
  rawPortfolio: ReturnType<typeof simulationPortfolioReadSchema.parse>, ownerUnresolved: boolean, ownerUnknown: boolean) {
  try {
    const projection = projectionSchema.parse(rawProjection);
    validateLifecycleProjections([projection]);
    const preview = syntheticMockRunPreviewSchema.parse(rawPreview);
    const order = syntheticMockOrderViewSchema.parse(rawOrder);
    const portfolio = simulationPortfolioReadSchema.parse(rawPortfolio);
    const confirmed = projection.facts.find(e => e.type === 'preview-confirmed');
    const claimed = projection.facts.find(e => e.type === 'dispatch-claimed');
    const acknowledged = projection.facts.find(e => e.type === 'broker-acknowledged');
    const canceled = projection.facts.some(e => e.type === 'cancel-acknowledged');
    const statuses = projection.facts.filter(e => e.type === 'broker-status-observed');
    const lastStatus = statuses.at(-1);
    const requested = { instrumentId: preview.order.instrumentId, currency: preview.order.currency,
      route: preview.order.route, side: preview.order.side, requestedQuantity: preview.order.quantity,
      requestedLimitPrice: preview.order.limitPrice };
    if (!confirmed || !claimed || confirmed.previewId !== preview.previewId || claimed.previewId !== preview.previewId
      || confirmed.termsHash !== termsHash || claimed.termsHash !== termsHash
      || canonical(confirmed.fee) !== canonical(preview.fee.amount) || confirmed.feeCurrency !== preview.fee.currency
      || confirmed.expiresAt !== preview.expiresAt || canonical(projection.intent.order) !== canonical(requested)
      || order.dispatchId !== projection.intent.intentId || order.previewId !== preview.previewId || order.source !== preview.source
      || portfolio.snapshot.runId !== preview.runId || portfolio.snapshot.configSha256 !== preview.configSha256
      || portfolio.snapshot.classification !== preview.classification) throw new Error();
    const brokerIds = projection.facts.flatMap(e =>
      e.type === 'broker-acknowledged' || e.type === 'cancel-requested' || e.type === 'cancel-acknowledged' ? [e.brokerOrderId]
        : e.type === 'broker-status-observed' && e.brokerOrderId ? [e.brokerOrderId]
        : e.type === 'execution-observed' ? [e.execution.brokerOrderId] : []);
    if (brokerIds.some(id => id !== order.mockOrderId)) throw new Error();
    const fills = order.executions.map(e => syntheticMockRunExecutionSchema.parse(e));
    if (fills.some(e => e.runId !== preview.runId || e.configSha256 !== preview.configSha256
      || e.decisionId !== preview.decisionId)) throw new Error();
    const observed = projection.facts.flatMap(e => e.type === 'execution-observed' ? [e.execution] : []);
    const fillsById = new Map(fills.map(fill => [fill.executionId, fill]));
    if (fillsById.size !== fills.length) throw new Error();
    const observedIds = new Set<string>();
    for (const observation of observed) {
      if (observedIds.has(observation.executionId)) throw new Error();
      observedIds.add(observation.executionId);
      const fill = fillsById.get(observation.executionId);
      if (!fill || canonical(observation) !== canonical({ executionId: fill.executionId,
        brokerOrderId: order.mockOrderId, observedQuantity: fill.quantity, observedPrice: fill.price,
        observedFee: fill.fee, currency: fill.currency })) throw new Error();
    }
    if (canceled && !order.cancelAcknowledged) throw new Error();
    const dispatchUnknown = projection.facts.some(e => e.type === 'dispatch-outcome-unknown');
    const missingObservations = observedIds.size !== fillsById.size || canceled !== order.cancelAcknowledged;
    // Every retained terminal assertion matters, including an overwritten one.
    if (statuses.some(status => ['filled', 'canceled', 'rejected'].includes(status.status)
      && status.status !== order.status)) throw new Error();
    const terminalAligned = !!acknowledged && lastStatus?.brokerOrderId === order.mockOrderId
      && (order.status === 'filled' || order.status === 'canceled') && lastStatus.status === order.status;
    const disposition = ownerUnknown || dispatchUnknown || missingObservations ? 'unknown' as const
      : ownerUnresolved || portfolio.state === 'unsettled' ? 'unsettled' as const
      : terminalAligned ? 'settled' as const : 'unknown' as const;
    return { fills, observed, dispatchUnknown, disposition };
  } catch {
    throw new SyntheticLifecycleJoinCorruption();
  }
}
