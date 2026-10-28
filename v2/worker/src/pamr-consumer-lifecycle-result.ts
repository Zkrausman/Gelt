import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { decimalSchema, ledgerId, projectionSchema, type Projection } from './ledger-contract.js';
import { pamrConsumerActionSchema, pamrConsumerBindingSchema, pamrConsumerDecisionSchema, pamrConsumerDisclosure } from './pamr-consumer-contract.js';
import { pamrConsumptionEvidenceLinkSchema } from './pamr-consumer-evidence-contract.js';
import { simulationHash, simulationPortfolioReadSchema, simulationTimestamp } from './synthetic-simulation-economics.js';
import { syntheticMockStatusSchema } from './synthetic-mock-robinhood-contract.js';
import { joinSyntheticLifecycle, SyntheticLifecycleJoinCorruption } from './synthetic-lifecycle-join.js';
import type { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';

const identifier = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/);
const resultSchema = z.object({
  schema: z.literal('gelt.pamr-consumer-lifecycle-result.v1'),
  classification: z.literal('constructed_offline_test'), effectScope: z.literal('SIMULATED_ONLY'),
  binding: pamrConsumerBindingSchema,
  adaptation: z.literal(pamrConsumerDisclosure.adaptation),
  pamrConsumption: pamrConsumptionEvidenceLinkSchema,
  pureDecision: pamrConsumerDecisionSchema, pureAction: pamrConsumerActionSchema,
  requested: z.object({ side: z.enum(['buy', 'sell']), quantity: decimalSchema, limitPrice: decimalSchema }).strict(),
  simulatedOrder: z.object({
    dispatchId: ledgerId, previewId: ledgerId, simulatedOrderId: identifier,
    status: syntheticMockStatusSchema, cancelAcknowledged: z.boolean(),
    executions: z.array(z.object({
      simulatedExecutionId: identifier, simulatedReceiptId: ledgerId,
      quantity: decimalSchema, price: decimalSchema, fee: decimalSchema, currency: z.literal('USD'),
      observedAt: simulationTimestamp, availableAt: simulationTimestamp, observationSha256: simulationHash,
      observedByLifecycle: z.boolean(),
    }).strict()).max(16),
  }).strict(),
  actualMockPortfolio: simulationPortfolioReadSchema,
  lifecycle: z.object({
    disposition: z.enum(['settled', 'unsettled', 'unknown']), dispatchUnknown: z.boolean(),
    observedExecutionCount: z.number().int().min(0).max(16),
    factCount: z.number().int().min(0).max(1000), factsSha256: simulationHash,
  }).strict(),
  evidence: z.literal('existing_owner_transaction_replay'),
  consistency: z.literal('matched_owner_reads_not_cross_store_transaction'),
  completion: z.literal('unestablished'), provenance: z.literal('not_authenticated'),
  marketEvaluation: z.literal('not_established'), effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
  operatingAdmission: z.object({
    production: z.literal('CLOSED'), operations: z.literal('DEFER'),
    acquisitionAllowed: z.literal(false), dispatchAllowed: z.literal(false),
  }).strict(),
}).strict();

// Called only from the existing protected history operation.
export function readPAMRConsumerLifecycleResult(store: SyntheticMockRobinhoodStore, rawProjection: Projection,
  ownerUnresolved: boolean, ownerUnknown: boolean) {
  try {
    const projection = projectionSchema.parse(rawProjection);
    const x = store.readPAMRConsumer(projection.intent.intentId);
    if (!x) return { state: 'unavailable' as const };
    const { preview, order, input, proposal, portfolio } = x;
    if (!preview.pamrConsumption || preview.sizingEvidence
      || canonical(order.pamrConsumption) !== canonical(preview.pamrConsumption)
      || canonical(proposal.decision.binding) !== canonical(input.binding)
      || preview.decisionId !== proposal.decision.decisionId
      || preview.inputSha256 !== proposal.decision.inputSha256
      || preview.decisionAt !== input.decisionAt || proposal.action.outcome !== 'proposal') throw new Error();
    const joined = joinSyntheticLifecycle(projection, preview, order, x.termsHash, portfolio, ownerUnresolved, ownerUnknown);
    const observedIds = new Set(joined.observed.map(e => e.executionId));
    const view = resultSchema.parse({
      schema: 'gelt.pamr-consumer-lifecycle-result.v1', classification: 'constructed_offline_test', effectScope: 'SIMULATED_ONLY',
      binding: input.binding, adaptation: pamrConsumerDisclosure.adaptation, pamrConsumption: preview.pamrConsumption,
      pureDecision: proposal.decision, pureAction: proposal.action,
      requested: { side: preview.order.side, quantity: preview.order.quantity, limitPrice: preview.order.limitPrice },
      simulatedOrder: { dispatchId: order.dispatchId, previewId: order.previewId, simulatedOrderId: order.mockOrderId,
        status: order.status, cancelAcknowledged: order.cancelAcknowledged,
        executions: joined.fills.map(e => ({ simulatedExecutionId: e.executionId, simulatedReceiptId: e.receiptId,
          quantity: e.quantity, price: e.price, fee: e.fee, currency: e.currency,
          observedAt: e.observation.observedAt, availableAt: e.observation.availableAt,
          observationSha256: e.observation.evidenceSha256, observedByLifecycle: observedIds.has(e.executionId) })) },
      actualMockPortfolio: portfolio,
      lifecycle: { disposition: joined.disposition, dispatchUnknown: joined.dispatchUnknown,
        observedExecutionCount: joined.observed.length, factCount: projection.eventCount, factsSha256: digest(canonical(projection)) },
      evidence: 'existing_owner_transaction_replay', consistency: 'matched_owner_reads_not_cross_store_transaction',
      completion: 'unestablished', provenance: 'not_authenticated', marketEvaluation: 'not_established',
      effectAuthority: 'none', promotionAllowed: false,
      operatingAdmission: { production: 'CLOSED', operations: 'DEFER', acquisitionAllowed: false, dispatchAllowed: false },
    });
    if (Buffer.byteLength(JSON.stringify(view), 'utf8') > 32768) throw new Error();
    return { state: 'available' as const, view };
  } catch {
    throw new SyntheticLifecycleJoinCorruption();
  }
}

export type PAMRConsumerLifecycleResult = ReturnType<typeof readPAMRConsumerLifecycleResult>;
