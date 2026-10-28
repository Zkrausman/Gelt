import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';
import { parseResearchJSON } from './research-json.js';
import { simulationRunSchema, simulationPortfolioReadSchema, simulationObservationSchema, simulationTimestamp, simulationHash, decimal, units } from './synthetic-simulation-economics.js';
export const pamrConsumerPolicyId = 'gelt.pamr-risk-reserve-quarter-floor18.v1' as const;
export const pamrConsumerLimits = Object.freeze({ input: 262144, artifact: 180000, decision: 4096, proposal: 8192 });
export const pamrConsumerDisclosure = Object.freeze({ effectAuthority: 'none', authenticity: 'not_established', consumption: 'not_performed', facts: 'self_consistent_pure_inputs_only', adaptation: 'fixed_risk_reserve_quarter_floor18_not_full_portfolio_fidelity' } as const);
const inertShape = { effectAuthority: z.literal('none'), authenticity: z.literal('not_established'), consumption: z.literal('not_performed'), facts: z.literal('self_consistent_pure_inputs_only'), adaptation: z.literal('fixed_risk_reserve_quarter_floor18_not_full_portfolio_fidelity') };
const timestamp = simulationTimestamp.refine(s => Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);
function representable(raw: unknown, scale: number): boolean {
  try { decimal(units(decimalSchema.parse(raw), scale), scale); return true; } catch { return false; }
}
const money = decimalSchema.refine(d => representable(d, 8));
const quantity = decimalSchema.refine(d => representable(d, 18));
const positive = quantity.refine(d => /[1-9]/.test(d.value));
export const pamrConsumerBindingSchema = z.object({
  artifactSha256: simulationHash, recipeSha256: simulationHash,
  prefixSha256: simulationHash, ordinal: z.number().int().min(1).max(64),
  expectedPreviousPrefixSha256: simulationHash.nullable(),
  runId: z.string().uuid(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  configSha256: simulationHash, policySha256: simulationHash,
  portfolioSnapshotSha256: simulationHash, costsSha256: simulationHash,
  observationSha256: simulationHash, clockSha256: simulationHash,
}).strict();
export const pamrConsumerInputSchema = z.object({
  schema: z.literal('gelt.pamr-consumer-input.v1'), policyId: z.literal(pamrConsumerPolicyId),
  artifactText: z.string().max(pamrConsumerLimits.artifact), binding: pamrConsumerBindingSchema, config: simulationRunSchema,
  portfolio: simulationPortfolioReadSchema, lifecycleDisposition: z.enum(['settled', 'unknown']),
  inputPortfolioUnknown: z.boolean(), decisionAt: timestamp, prefixAvailableAt: timestamp,
  evaluationAt: timestamp, observation: simulationObservationSchema,
  quantityQuantum: positive, buyLimitPrice: positive, sellLimitPrice: positive,
}).strict().refine(v => representable(v.portfolio.snapshot.cash, 8) && representable(v.portfolio.snapshot.quantity, 18) && representable(v.config.costs.commissionPerOrder, 8) && representable(v.observation.referencePrice, 18));
export type PAMRConsumerInput = z.infer<typeof pamrConsumerInputSchema>;
const reasons = [
  'buy_proposal', 'cash_exit_proposal', 'already_at_ceiling', 'already_cash', 'zero_equity',
  'positive_target_overweight_unsupported', 'decision_abstain', 'rule_abstain', 'lifecycle_unknown', 'unsettled_portfolio',
  'invalid_observation', 'limit_incompatible', 'cash_exit_not_on_grid', 'cash_exit_exceeds_cap',
  'cash_exit_fee_cash_unavailable', 'no_buy_lot_fits', 'unrepresentable_economics',
] as const;
const hypothesisSchema = z.object({
  bindingBasis: z.literal('hypothetical_full_fill_same_supplied_mark_per_order_fee'),
  referenceMark: positive, modeledFillPrice: positive.refine(d => d.scale === 8), orderLimit: positive,
  commissionPerOrder: money, modeledPostCash: money.refine(d => d.scale === 8),
  modeledPostQuantity: quantity.refine(d => d.scale === 18), modeledCeilingRelation: z.enum(['equal', 'below']),
  limitPostCash: money.refine(d => d.scale === 8), limitPostQuantity: quantity.refine(d => d.scale === 18), limitWithinCeiling: z.literal(true),
}).strict();
export const pamrConsumerActionSchema = z.object({
  outcome: z.enum(['proposal', 'no_action', 'abstain']), reason: z.enum(reasons),
  attainment: z.enum(['modeled_exact_ceiling', 'limit_quantized_underallocation', 'constraint_limited_underallocation', 'cash_exit', 'no_action', 'not_applicable']),
  side: z.enum(['buy', 'sell']).nullable(), quantity: positive.refine(d => d.scale === 18).nullable(), hypothetical: hypothesisSchema.nullable(),
}).strict().refine(a => {
  const holds: readonly string[] = ['already_at_ceiling', 'already_cash', 'zero_equity'];
  if (a.outcome === 'proposal') return a.quantity !== null && a.hypothetical !== null
    && (a.reason === 'buy_proposal' && a.side === 'buy' && ['modeled_exact_ceiling', 'limit_quantized_underallocation', 'constraint_limited_underallocation'].includes(a.attainment)
      || a.reason === 'cash_exit_proposal' && a.side === 'sell' && a.attainment === 'cash_exit');
  if (a.side !== null || a.quantity !== null || a.hypothetical !== null) return false;
  return a.outcome === 'no_action' ? holds.includes(a.reason) && a.attainment === 'no_action'
    : !holds.includes(a.reason) && !['buy_proposal', 'cash_exit_proposal'].includes(a.reason) && a.attainment === 'not_applicable';
});
export type PAMRConsumerAction = z.infer<typeof pamrConsumerActionSchema>;
export const pamrConsumerDecisionSchema = z.object({
  schema: z.literal('gelt.pamr-consumer-decision.v1'), policyId: z.literal(pamrConsumerPolicyId),
  decisionId: z.string().regex(/^pamr-consumer-decision-[a-f0-9]{64}$/),
  inputSha256: simulationHash, binding: pamrConsumerBindingSchema,
  decisionAt: timestamp, prefixAvailableAt: timestamp, evaluationAt: timestamp,
  riskyWeight: z.string().max(2470).regex(/^(0|[1-9][0-9]*)\/[1-9][0-9]*$/),
  targetExposure: quantity.nullable(), decision: z.enum(['target_cash', 'target_long', 'abstain']),
  reason: z.enum(['mapped_target', 'lifecycle_unknown', 'unsettled_portfolio', 'invalid_clock']),
  ...inertShape,
}).strict().refine(d => {
  if (d.decision === 'abstain') return d.targetExposure === null && d.reason !== 'mapped_target';
  return d.reason === 'mapped_target' && d.targetExposure !== null && units(d.targetExposure, 18) <= 250000000000000000n && (d.decision === 'target_cash' ? units(d.targetExposure, 18) === 0n : units(d.targetExposure, 18) > 0n);
});
export type PAMRConsumerDecision = z.infer<typeof pamrConsumerDecisionSchema>;
export const pamrConsumerProposalSchema = z.object({
  schema: z.literal('gelt.pamr-consumer-proposal.v1'), policyId: z.literal(pamrConsumerPolicyId),
  proposalId: z.string().regex(/^pamr-consumer-proposal-[a-f0-9]{64}$/), decision: pamrConsumerDecisionSchema, action: pamrConsumerActionSchema,
  ...inertShape,
}).strict().refine(p => p.decision.decision === 'abstain' ? p.action.outcome === 'abstain'
  : p.action.outcome !== 'proposal' || p.action.side === (p.decision.decision === 'target_cash' ? 'sell' : 'buy'));
export type PAMRConsumerProposal = z.infer<typeof pamrConsumerProposalSchema>;
export type PAMRConsumerRejection = 'invalid_input' | 'unsupported_profile' | 'artifact_mismatch' | 'binding_mismatch' | 'resource_limit';
export type PAMRConsumerResult<T> = { status: 'computed'; value: T } | { status: 'rejected'; reason: PAMRConsumerRejection };
export class PAMRConsumerBoundaryError extends Error {
  constructor(readonly reason: PAMRConsumerRejection) { super('PAMR consumer unavailable'); }
}
export function parsePAMRConsumerText(text: unknown, kind: keyof typeof pamrConsumerLimits): unknown {
  if (typeof kind !== 'string' || !Object.hasOwn(pamrConsumerLimits, kind) || typeof text !== 'string') throw new PAMRConsumerBoundaryError('invalid_input');
  const limit = pamrConsumerLimits[kind];
  if (text.length > limit || Buffer.byteLength(text, 'utf8') > limit) throw new PAMRConsumerBoundaryError('resource_limit');
  return parseResearchJSON(Buffer.from(text, 'utf8'));
}
