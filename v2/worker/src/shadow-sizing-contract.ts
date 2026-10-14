import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';
import { shadowRuleInputSchema, shadowRuleReceiptSchema } from './shadow-rule-contract.js';
import { simulationRunSchema, simulationPortfolioReadSchema, simulationObservationSchema,
  simulationTimestamp, simulationClassification, simulationHash, units, decimal } from './synthetic-simulation-economics.js';

export const shadowSizingPolicyId = 'gelt.long-cash-limit-bounded-sizing.v1' as const;
function representable(raw: unknown, scale: number): boolean {
  const d = decimalSchema.safeParse(raw);
  if (!d.success || d.data.scale > scale) return false;
  try { decimal(units(d.data, scale), scale); return true; } catch { return false; }
}
const positive = decimalSchema.refine(d => /[1-9]/.test(d.value));
const money = decimalSchema.refine(d => representable(d, 8));
const quantity = decimalSchema.refine(d => representable(d, 18));
const quantum = quantity.refine(d => /[1-9]/.test(d.value));
const normalizedMoney = money.refine(d => d.scale === 8);
const normalizedQuantity = quantum.refine(d => d.scale === 18);
const evaluationTime = simulationTimestamp.refine(s => Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);

export const shadowSizingInputSchema = z.object({
  schema: z.literal('gelt.shadow-sizing-input.v1'), sizingPolicyId: z.literal(shadowSizingPolicyId),
  ruleInput: shadowRuleInputSchema, ruleReceipt: shadowRuleReceiptSchema, config: simulationRunSchema,
  portfolio: simulationPortfolioReadSchema, lifecycleDisposition: z.enum(['settled', 'unknown']),
  observation: simulationObservationSchema, buyLimitPrice: positive, sellLimitPrice: positive,
  quantityQuantum: quantum, evaluationAt: evaluationTime,
}).strict().refine(v => representable(v.ruleInput.costs.commissionPerTrade, 8)
  && representable(v.portfolio.snapshot.cash, 8) && representable(v.portfolio.snapshot.quantity, 18));
export type ShadowSizingInput = z.infer<typeof shadowSizingInputSchema>;

export const shadowSizingReasons = [
  'buy_proposal', 'cash_exit_proposal', 'already_at_ceiling', 'already_cash', 'zero_equity',
  'positive_target_overweight_unsupported', 'rule_abstain', 'lifecycle_unknown', 'unsettled_portfolio',
  'invalid_input', 'input_too_large', 'receipt_mismatch', 'binding_mismatch', 'invalid_observation',
  'limit_incompatible', 'cash_exit_not_on_grid', 'cash_exit_exceeds_cap', 'cash_exit_fee_cash_unavailable',
  'no_buy_lot_fits', 'unrepresentable_economics',
] as const;
const hypothesisSchema = z.object({
  bindingBasis: z.literal('hypothetical_full_fill_same_supplied_mark_per_order_fee'),
  referenceMark: positive, modeledFillPrice: positive.refine(d => d.scale === 8), orderLimit: positive,
  commissionPerOrder: money, modeledPostCash: normalizedMoney,
  modeledPostQuantity: quantity.refine(d => d.scale === 18), modeledCeilingRelation: z.enum(['equal', 'below']),
  limitPostCash: normalizedMoney, limitPostQuantity: quantity.refine(d => d.scale === 18), limitWithinCeiling: z.literal(true),
}).strict();
const invalidReasons: readonly string[] = ['invalid_input', 'input_too_large', 'receipt_mismatch', 'binding_mismatch'];
const noActionReasons: readonly string[] = ['already_at_ceiling', 'already_cash', 'zero_equity'];

export const shadowSizingProposalSchema = z.object({
  schema: z.literal('gelt.shadow-sizing-proposal.v1'), sizingPolicyId: z.literal(shadowSizingPolicyId),
  proposalId: z.string().regex(/^shadow-sizing-[a-f0-9]{64}$/),
  inputValidation: z.enum(['valid', 'invalid']), inputSha256: simulationHash.nullable(),
  inputDigestKind: z.enum(['canonical_validated_input', 'rejected_bytes', 'unbound']),
  runId: z.string().uuid().nullable(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  ruleDecisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/).nullable(),
  configSha256: simulationHash.nullable(), portfolioSnapshotSha256: simulationHash.nullable(),
  evaluationAt: evaluationTime.nullable(), classification: simulationClassification.nullable(),
  targetExposure: shadowRuleReceiptSchema.shape.targetExposure,
  outcome: z.enum(['proposal', 'no_action', 'abstain']), reason: z.enum(shadowSizingReasons),
  attainment: z.enum(['modeled_exact_ceiling', 'limit_quantized_underallocation', 'constraint_limited_underallocation', 'cash_exit', 'no_action', 'not_applicable']),
  side: z.enum(['buy', 'sell']).nullable(), quantity: normalizedQuantity.nullable(), hypothetical: hypothesisSchema.nullable(),
  effectAuthority: z.literal('none'), marketEvaluation: z.literal('not_established'), promotionAllowed: z.literal(false),
  sourceAndProvenance: z.literal('caller_assertions_not_independently_verified'),
}).strict().refine(p => {
  const correlated = [p.runId, p.sourceCommit, p.ruleDecisionId, p.configSha256, p.portfolioSnapshotSha256, p.evaluationAt, p.classification];
  if (p.inputValidation === 'invalid') {
    if (!invalidReasons.includes(p.reason) || correlated.some(v => v !== null) || p.targetExposure !== null
      || p.inputDigestKind === 'canonical_validated_input') return false;
  } else if (invalidReasons.includes(p.reason) || correlated.some(v => v === null) || p.inputSha256 === null
    || p.inputDigestKind !== 'canonical_validated_input') return false;
  if (p.inputDigestKind === 'unbound' ? p.inputSha256 !== null : p.inputSha256 === null) return false;
  if (p.outcome === 'proposal') return p.inputValidation === 'valid' && p.targetExposure !== null
    && p.quantity !== null && p.hypothetical !== null
    && (p.reason === 'buy_proposal' && p.side === 'buy' && ['modeled_exact_ceiling', 'limit_quantized_underallocation', 'constraint_limited_underallocation'].includes(p.attainment)
      || p.reason === 'cash_exit_proposal' && p.side === 'sell' && p.attainment === 'cash_exit');
  if (p.side !== null || p.quantity !== null || p.hypothetical !== null) return false;
  return p.outcome === 'no_action' ? p.inputValidation === 'valid' && p.targetExposure !== null && noActionReasons.includes(p.reason) && p.attainment === 'no_action'
    : !noActionReasons.includes(p.reason) && !['buy_proposal', 'cash_exit_proposal'].includes(p.reason) && p.attainment === 'not_applicable';
});
export type ShadowSizingProposal = z.infer<typeof shadowSizingProposalSchema>;
