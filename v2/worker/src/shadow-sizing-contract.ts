import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';
import { shadowRuleInputSchema, shadowRuleReceiptSchema } from './shadow-rule-contract.js';
import { simulationRunSchema, simulationPortfolioReadSchema, simulationObservationSchema,
  simulationTimestamp, simulationClassification, simulationHash, simulationInstrument, paperSizingPolicyId,
  units, decimal } from './synthetic-simulation-economics.js';

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

// G06 is a separate constructed-fixture contract. It does not extend or relax
// the legacy simulation schemas above; in particular, it has no caller cap.
const hash = simulationHash;
const fixedMoney = (value: string) => decimalSchema.refine(d => d.scale === 8 && d.value === value);
const fixedQuantity = (value: string) => decimalSchema.refine(d => d.scale === 18 && d.value === value);
const paperTimestamp = simulationTimestamp.refine(s => Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);
const paperDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const parsed = Date.parse(`${s}T00:00:00.000Z`);
  return Number.isSafeInteger(parsed) && new Date(parsed).toISOString().slice(0, 10) === s;
});
const paperCommit = z.string().regex(/^[a-f0-9]{40}$/);
const paperScenarioId = z.enum(['base', 'stress']);

export const paperScenarioCostsSchema = z.object({
  scenarioId: paperScenarioId,
  commissionPerOrder: fixedMoney('1.00000000'), spreadFraction: decimalSchema, slippageFraction: decimalSchema,
  evidenceSha256: hash, stressScenarioSha256: hash,
}).strict().refine(c => c.scenarioId === 'base'
  ? c.spreadFraction.value === '0.0002' && c.spreadFraction.scale === 4
    && c.slippageFraction.value === '0.0003' && c.slippageFraction.scale === 4
  : c.spreadFraction.value === '0.001' && c.spreadFraction.scale === 3
    && c.slippageFraction.value === '0.0015' && c.slippageFraction.scale === 4);
export type PaperScenarioCosts = z.infer<typeof paperScenarioCostsSchema>;

export const paperSizingConfigSchema = z.object({
  schema: z.literal('gelt.paper-sizing-config.v1'), version: z.literal(1),
  policyId: z.literal(paperSizingPolicyId), runId: z.string().uuid(), sourceCommit: paperCommit,
  classification: z.literal('constructed_offline_test'), scenarioId: paperScenarioId,
  internalInstrumentId: z.literal(simulationInstrument), currency: z.literal('USD'),
  genesis: z.object({ cash: fixedMoney('10000.00000000'), quantity: fixedQuantity('0.000000000000000000') }).strict(),
  targetExposureCeiling: fixedQuantity('0.950000000000000000'),
  quantityQuantum: fixedQuantity('1.000000000000000000'), scheduleSha256: hash, mappingSha256: hash,
  costs: paperScenarioCostsSchema,
  signalMaxAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxDecisionAgeMs: z.literal(960000), maxObservationAgeMs: z.literal(5000), validThrough: paperTimestamp,
  rounding: z.literal('adverse-price-8-cumulative-cash-8.v1'),
}).strict().refine(c => c.scenarioId === c.costs.scenarioId);
export type PaperSizingConfig = z.infer<typeof paperSizingConfigSchema>;

export const paperInstrumentMappingSchema = z.object({
  schema: z.literal('gelt.paper-instrument-map.v1'),
  underlying: z.object({ symbol: z.literal('SPY'), listingVenue: z.literal('NYSE Arca'),
    currency: z.literal('USD'), quantityUnit: z.literal('whole SPY shares') }).strict(),
  signal: z.object({ provider: z.literal('Alpaca-data-v2'), feed: z.literal('IEX'),
    timeframe: z.literal('1Day'), adjustment: z.literal('all'), asof: paperDate,
    entitySha256: hash, calendarSha256: hash, productSha256: hash, sourceSha256: hash }).strict(),
  internal: z.object({ instrumentId: z.literal(simulationInstrument), currency: z.literal('USD') }).strict(),
}).strict();
export type PaperInstrumentMapping = z.infer<typeof paperInstrumentMappingSchema>;

const paperMoney = decimalSchema.refine(d => d.scale === 8);
const paperQuantity = decimalSchema.refine(d => d.scale === 18);
export const paperPortfolioHistoryEntrySchema = z.object({
  revision: z.number().int().min(1).max(1000), occurredAt: paperTimestamp,
  stateKind: z.literal('constructed_state'), cash: paperMoney, quantity: paperQuantity,
}).strict();
export const paperPortfolioSnapshotSchema = z.object({
  schema: z.literal('gelt.paper-portfolio-snapshot.v1'), version: z.literal(1),
  runId: z.string().uuid(), sourceCommit: paperCommit, policyId: z.literal(paperSizingPolicyId),
  classification: z.literal('constructed_offline_test'), scenarioId: paperScenarioId,
  underlyingSymbol: z.literal('SPY'), internalInstrumentId: z.literal(simulationInstrument), currency: z.literal('USD'),
  configSha256: hash, mappingSha256: hash, genesisSha256: hash,
  revision: z.number().int().min(0).max(1000), history: z.array(paperPortfolioHistoryEntrySchema).max(1000),
  cash: paperMoney, quantity: paperQuantity,
}).strict().refine(s => s.revision === s.history.length
  && s.history.every((item, i) => item.revision === i + 1)
  && (s.revision === 0 || s.history[s.history.length - 1].cash.value === s.cash.value
    && s.history[s.history.length - 1].quantity.value === s.quantity.value));
export type PaperPortfolioSnapshot = z.infer<typeof paperPortfolioSnapshotSchema>;
export const paperPortfolioReadSchema = z.object({ snapshot: paperPortfolioSnapshotSchema, state: z.enum(['settled', 'unsettled']) }).strict();

export const paperSizingObservationSchema = z.object({
  instrumentId: z.literal('SPY'), mappingSha256: hash, referencePrice: positive,
  observedAt: paperTimestamp, availableAt: paperTimestamp, evidenceSha256: hash,
}).strict();
export type PaperSizingObservation = z.infer<typeof paperSizingObservationSchema>;

export const paperSizingInputSchema = z.object({
  schema: z.literal('gelt.paper-sizing-input.v1'), policyId: z.literal(paperSizingPolicyId),
  ruleInput: shadowRuleInputSchema, ruleReceipt: shadowRuleReceiptSchema,
  config: paperSizingConfigSchema, mapping: paperInstrumentMappingSchema,
  portfolio: paperPortfolioReadSchema, lifecycleDisposition: z.enum(['settled', 'unknown']),
  observation: paperSizingObservationSchema, buyLimitPrice: positive, sellLimitPrice: positive,
  evaluationAt: paperTimestamp,
}).strict().refine(v => v.ruleInput.instrument.id === 'SPY'
  && v.ruleInput.instrument.currency === 'USD'
  && v.ruleInput.data.classification === 'constructed_offline_test'
  && v.ruleInput.data.eligibility === 'declared'
  && v.ruleInput.policy.exposureCap.value === '0.95'
  && v.ruleInput.policy.exposureCap.scale === 2
  && v.ruleInput.instrument.calendarSha256 === v.mapping.signal.calendarSha256
  && v.mapping.internal.instrumentId === v.config.internalInstrumentId
  && v.mapping.internal.currency === v.config.currency
  && v.portfolio.snapshot.underlyingSymbol === v.mapping.underlying.symbol
  && v.portfolio.snapshot.internalInstrumentId === v.config.internalInstrumentId);
export type PaperSizingInput = z.infer<typeof paperSizingInputSchema>;

export const paperSizingReasons = [
  'buy_proposal', 'cash_exit_proposal', 'already_at_ceiling', 'already_cash', 'zero_equity',
  'positive_target_overweight_unsupported', 'rule_abstain', 'lifecycle_unknown', 'unsettled_portfolio',
  'invalid_input', 'input_too_large', 'receipt_mismatch', 'binding_mismatch', 'invalid_observation',
  'limit_incompatible', 'cash_exit_not_on_grid', 'cash_exit_exceeds_cap', 'cash_exit_fee_cash_unavailable',
  'current_position_not_on_grid', 'no_buy_lot_fits', 'unrepresentable_economics',
] as const;
const paperHypothesisSchema = z.object({
  bindingBasis: z.literal('hypothetical_full_fill_same_supplied_mark_per_order_fee'),
  referenceMark: positive, modeledFillPrice: positive.refine(d => d.scale === 8), orderLimit: positive,
  commissionPerOrder: paperMoney, modeledPostCash: paperMoney, modeledPostQuantity: paperQuantity,
  modeledCeilingRelation: z.enum(['equal', 'below']), limitPostCash: paperMoney,
  limitPostQuantity: paperQuantity, limitWithinCeiling: z.literal(true),
}).strict();
const paperInvalidReasons: readonly string[] = ['invalid_input', 'input_too_large', 'receipt_mismatch', 'binding_mismatch'];
const paperNoActionReasons: readonly string[] = ['already_at_ceiling', 'already_cash', 'zero_equity'];
const nullableCorrelations = [
  'runId', 'sourceCommit', 'classification', 'scenarioId', 'policySha256', 'scenarioSha256',
  'genesisSha256', 'configSha256', 'mappingSha256', 'portfolioSnapshotSha256', 'historySha256',
  'historyRevision', 'ruleInputSha256', 'ruleReceiptSha256', 'evaluationAt', 'underlyingSymbol',
  'internalInstrumentId',
] as const;
export const paperSizingProposalSchema = z.object({
  schema: z.literal('gelt.paper-sizing-proposal.v1'), policyId: z.literal(paperSizingPolicyId),
  proposalId: z.string().regex(/^paper-sizing-[a-f0-9]{64}$/),
  inputValidation: z.enum(['valid', 'invalid']), inputSha256: hash.nullable(),
  inputDigestKind: z.enum(['canonical_validated_input', 'rejected_bytes', 'unbound']),
  runId: z.string().uuid().nullable(), sourceCommit: paperCommit.nullable(),
  classification: z.literal('constructed_offline_test').nullable(), scenarioId: paperScenarioId.nullable(),
  policySha256: hash.nullable(), scenarioSha256: hash.nullable(), genesisSha256: hash.nullable(),
  configSha256: hash.nullable(), mappingSha256: hash.nullable(), portfolioSnapshotSha256: hash.nullable(),
  historySha256: hash.nullable(), historyRevision: z.number().int().min(0).max(1000).nullable(),
  ruleInputSha256: hash.nullable(), ruleReceiptSha256: hash.nullable(),
  evaluationAt: paperTimestamp.nullable(), underlyingSymbol: z.literal('SPY').nullable(),
  internalInstrumentId: z.literal(simulationInstrument).nullable(),
  targetExposure: decimalSchema.nullable(), outcome: z.enum(['proposal', 'no_action', 'abstain']),
  reason: z.enum(paperSizingReasons),
  attainment: z.enum(['modeled_exact_ceiling', 'limit_quantized_underallocation', 'constraint_limited_underallocation',
    'cash_exit', 'no_action', 'not_applicable']),
  side: z.enum(['buy', 'sell']).nullable(), quantity: paperQuantity.nullable(),
  hypothetical: paperHypothesisSchema.nullable(),
  liquidationDisposition: z.enum(['not_applicable', 'hypothetical_full_exit_proposal', 'holdings_retained_incomplete']).nullable(),
  effectAuthority: z.literal('none'), marketEvaluation: z.literal('not_established'), promotionAllowed: z.literal(false),
  sourceAndProvenance: z.literal('caller_assertions_not_independently_verified'),
}).strict().refine(p => {
  const correlated = nullableCorrelations.map(key => p[key]);
  if (p.inputValidation === 'invalid') {
    if (!paperInvalidReasons.includes(p.reason) || correlated.some(v => v !== null) || p.targetExposure !== null
      || p.inputDigestKind === 'canonical_validated_input' || p.liquidationDisposition !== null) return false;
  } else if (paperInvalidReasons.includes(p.reason) || correlated.some(v => v === null) || p.inputSha256 === null
    || p.inputDigestKind !== 'canonical_validated_input') return false;
  if (p.inputDigestKind === 'unbound' ? p.inputSha256 !== null : p.inputSha256 === null) return false;
  if (p.outcome === 'proposal') return p.inputValidation === 'valid' && p.targetExposure !== null
    && p.quantity !== null && p.hypothetical !== null
    && (p.reason === 'buy_proposal' && p.side === 'buy'
      && ['modeled_exact_ceiling', 'limit_quantized_underallocation', 'constraint_limited_underallocation'].includes(p.attainment)
      && p.liquidationDisposition === 'not_applicable'
      || p.reason === 'cash_exit_proposal' && p.side === 'sell' && p.attainment === 'cash_exit'
      && p.liquidationDisposition === 'hypothetical_full_exit_proposal');
  if (p.side !== null || p.quantity !== null || p.hypothetical !== null) return false;
  if (p.reason === 'cash_exit_exceeds_cap') return p.outcome === 'abstain'
    && p.liquidationDisposition === 'holdings_retained_incomplete';
  if (p.reason === 'cash_exit_not_on_grid' || p.reason === 'cash_exit_fee_cash_unavailable') return p.outcome === 'abstain'
    && p.liquidationDisposition === 'holdings_retained_incomplete';
  if (p.liquidationDisposition === 'holdings_retained_incomplete') return p.outcome === 'abstain'
    && ['limit_incompatible', 'unrepresentable_economics'].includes(p.reason);
  return p.outcome === 'no_action' ? p.inputValidation === 'valid' && p.targetExposure !== null
    && paperNoActionReasons.includes(p.reason) && p.attainment === 'no_action'
    && p.liquidationDisposition === 'not_applicable'
    : !paperNoActionReasons.includes(p.reason) && !['buy_proposal', 'cash_exit_proposal'].includes(p.reason)
      && p.attainment === 'not_applicable';
});
export type PaperSizingProposal = z.infer<typeof paperSizingProposalSchema>;
