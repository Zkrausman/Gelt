import { z } from 'zod';
import { alpacaSessionCalendarSchema } from './alpaca-iex-contract.js';
import { canonical } from './ledger-canonical.js';
import { decimalSchema } from './ledger-contract.js';
import { matchesPaperCalendarBinding, type PaperCalendarBinding } from './paper-calendar-binding.js';
import { matchesPaperObservationSelection, type PaperObservationSelection } from './paper-observation-selection.js';
import { parseResearchJSON } from './research-json.js';
import { shadowRuleInputSchema, shadowRuleMaxBytes, shadowRuleReceiptSchema } from './shadow-rule-contract.js';
import { paperInstrumentMappingSchema, paperPortfolioReadSchema, paperSizingConfigSchema,
  paperSizingInputSchema, paperSizingObservationSchema, paperSizingProposalSchema } from './shadow-sizing-contract.js';
import { proposePaperSizing } from './shadow-sizing.js';
import { paperSizingPolicyId, simulationDigest, simulationHash, simulationTimestamp } from './synthetic-simulation-economics.js';

const timestamp = simulationTimestamp.refine(s => Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);
const positive = decimalSchema.refine(d => /[1-9]/.test(d.value));
const inputSchema = z.object({
  schema: z.literal('gelt.paper-selection-sizing-input.v1'), policyId: z.literal(paperSizingPolicyId),
  config: paperSizingConfigSchema, mapping: paperInstrumentMappingSchema,
  ruleInput: shadowRuleInputSchema, ruleReceipt: shadowRuleReceiptSchema, calendar: alpacaSessionCalendarSchema,
  observations: z.array(paperSizingObservationSchema).max(64), evaluationAt: timestamp,
  selectionReceipt: z.unknown(), calendarBindingReceipt: z.unknown(),
  portfolio: paperPortfolioReadSchema, lifecycleDisposition: z.enum(['settled', 'unknown']),
  buyLimitPrice: positive, sellLimitPrice: positive,
}).strict();
export type PaperSelectionSizingInput = z.infer<typeof inputSchema>;
const resultSchema = z.discriminatedUnion('status', [z.object({
  schema: z.literal('gelt.paper-selection-sizing.v1'), status: z.literal('rejected'), reason: z.literal('invalid_input'),
}).strict(), z.object({
  schema: z.literal('gelt.paper-selection-sizing.v1'), status: z.literal('not_composed'), reason: z.literal('no_selected_observation'),
}).strict(), z.object({
  schema: z.literal('gelt.paper-selection-sizing.v1'), status: z.literal('composed'), reason: z.literal('selected_observation_sized'),
  compositionId: z.string().regex(/^paper-selection-sizing-[a-f0-9]{64}$/),
  inputSha256: simulationHash, inputDigestKind: z.literal('canonical_validated_input'), sizingInputSha256: simulationHash,
  selectionId: z.string().regex(/^paper-observation-[a-f0-9]{64}$/), calendarBindingId: z.string().regex(/^paper-calendar-[a-f0-9]{64}$/),
  selectedIndex: z.number().int().min(0).max(63), observationSha256: simulationHash,
  runId: z.string().uuid(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/), evaluationAt: timestamp,
  proposal: paperSizingProposalSchema.refine(p => p.inputValidation === 'valid'),
  classification: z.literal('constructed_offline_test'), selectionBasis: z.literal('first_eligible_in_supplied_batch'),
  globalFirstObservation: z.literal('not_established'), durableFreeze: z.literal('not_established'),
  calendarAuthenticity: z.literal('not_established'), marketEvaluation: z.literal('not_established'),
  sourceAndProvenance: z.literal('caller_assertions_not_independently_verified'),
  effectAuthority: z.literal('none'), promotionAllowed: z.literal(false),
}).strict()]);
export type PaperSelectionSizing = z.infer<typeof resultSchema>;
const rejected = (): PaperSelectionSizing => ({ schema: 'gelt.paper-selection-sizing.v1', status: 'rejected', reason: 'invalid_input' });

// Pure composition, not durable selection, admission or a prospective runner.
// No caller observation can replace the exact replayed selection.
export function composePaperSelectionSizing(bytes: Buffer): PaperSelectionSizing {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > shadowRuleMaxBytes) return rejected();
    const input = inputSchema.parse(parseResearchJSON(bytes));
    const { policyId, config, mapping, ruleInput, ruleReceipt, observations, evaluationAt, calendar } = input;
    const selectionBytes = Buffer.from(canonical({ schema: 'gelt.paper-observation-selection-input.v1',
      policyId, config, mapping, ruleInput, ruleReceipt, observations, evaluationAt }));
    const calendarBytes = Buffer.from(canonical({ schema: 'gelt.paper-calendar-binding-input.v1',
      policyId, config, mapping, ruleInput, ruleReceipt, calendar }));
    if (!matchesPaperObservationSelection(selectionBytes, input.selectionReceipt)
      || !matchesPaperCalendarBinding(calendarBytes, input.calendarBindingReceipt)) return rejected();
    // These casts follow the existing strict full-schema/replay matchers above;
    // neither unknown receipt is used or trusted before both matchers pass.
    const selection = input.selectionReceipt as PaperObservationSelection;
    const binding = input.calendarBindingReceipt as PaperCalendarBinding;
    if (binding.status !== 'bound') return rejected();
    if (selection.status === 'not_selected') return {
      schema: 'gelt.paper-selection-sizing.v1', status: 'not_composed', reason: 'no_selected_observation',
    };
    if (selection.status !== 'selected') return rejected();
    const sizingInput = paperSizingInputSchema.parse({ schema: 'gelt.paper-sizing-input.v1', policyId,
      config, mapping, ruleInput, ruleReceipt, portfolio: input.portfolio, lifecycleDisposition: input.lifecycleDisposition,
      observation: selection.observation, buyLimitPrice: input.buyLimitPrice, sellLimitPrice: input.sellLimitPrice, evaluationAt });
    const sizingBytes = Buffer.from(canonical(sizingInput));
    // Exactly one sizing call on this branch, including semantic rejection.
    // No retry on quantity/cost/limit/portfolio/UNKNOWN/affordability outcomes.
    const proposal = proposePaperSizing(sizingBytes);
    if (proposal.inputValidation !== 'valid') return rejected();
    const body = {
      schema: 'gelt.paper-selection-sizing.v1' as const, status: 'composed' as const, reason: 'selected_observation_sized' as const,
      inputSha256: simulationDigest(input), inputDigestKind: 'canonical_validated_input' as const,
      sizingInputSha256: simulationDigest(sizingInput), selectionId: selection.selectionId, calendarBindingId: binding.bindingId,
      selectedIndex: selection.selectedIndex, observationSha256: selection.observationSha256,
      runId: config.runId, sourceCommit: config.sourceCommit, decisionId: ruleReceipt.decisionId, evaluationAt, proposal,
      classification: 'constructed_offline_test' as const, selectionBasis: 'first_eligible_in_supplied_batch' as const,
      globalFirstObservation: 'not_established' as const, durableFreeze: 'not_established' as const,
      calendarAuthenticity: 'not_established' as const, marketEvaluation: 'not_established' as const,
      sourceAndProvenance: 'caller_assertions_not_independently_verified' as const,
      effectAuthority: 'none' as const, promotionAllowed: false as const,
    };
    return resultSchema.parse({ ...body, compositionId: `paper-selection-sizing-${simulationDigest(body)}` });
  } catch { return rejected(); }
}

export function matchesPaperSelectionSizing(bytes: Buffer, value: unknown): boolean {
  try {
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success || parsed.data.status !== 'composed') return false;
    const expected = composePaperSelectionSizing(bytes);
    return expected.status === 'composed' && canonical(parsed.data) === canonical(expected);
  } catch { return false; }
}
