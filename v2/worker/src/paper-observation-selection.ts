import { z } from 'zod';
import { canonical } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { shadowRuleInputSchema, shadowRuleMaxBytes, shadowRuleReceiptSchema } from './shadow-rule-contract.js';
import { matchesShadowRuleReceipt } from './shadow-rule.js';
import { paperInstrumentMappingSchema, paperSizingConfigSchema, paperSizingObservationSchema } from './shadow-sizing-contract.js';
import { paperSizingPolicyId, simulationDigest, simulationHash, simulationTimestamp } from './synthetic-simulation-economics.js';

const timestamp = simulationTimestamp.refine(s => Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);
const inputSchema = z.object({
  schema: z.literal('gelt.paper-observation-selection-input.v1'), policyId: z.literal(paperSizingPolicyId),
  config: paperSizingConfigSchema, mapping: paperInstrumentMappingSchema,
  ruleInput: shadowRuleInputSchema, ruleReceipt: shadowRuleReceiptSchema,
  evaluationAt: timestamp, observations: z.array(paperSizingObservationSchema).max(64),
}).strict();
export type PaperObservationSelectionInput = z.infer<typeof inputSchema>;

const rejectedSchema = z.object({
  schema: z.literal('gelt.paper-observation-selection.v1'), status: z.literal('rejected'), reason: z.literal('invalid_input'),
}).strict();
const common = {
  schema: z.literal('gelt.paper-observation-selection.v1'),
  selectionId: z.string().regex(/^paper-observation-[a-f0-9]{64}$/),
  inputSha256: simulationHash, inputDigestKind: z.literal('canonical_validated_input'),
  batchSha256: simulationHash, configSha256: simulationHash, mappingSha256: simulationHash,
  ruleInputSha256: simulationHash, ruleReceiptSha256: simulationHash,
  runId: z.string().uuid(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/), decisionAt: timestamp, evaluationAt: timestamp,
  classification: z.literal('constructed_offline_test'), selectionBasis: z.literal('first_eligible_in_supplied_batch'),
  globalFirstObservation: z.literal('not_established'), durableFreeze: z.literal('not_established'),
  sourceAndProvenance: z.literal('caller_assertions_not_independently_verified'),
  marketEvaluation: z.literal('not_established'), effectAuthority: z.literal('none'), promotionAllowed: z.literal(false),
};
const resultSchema = z.discriminatedUnion('status', [rejectedSchema, z.object({
  ...common, status: z.literal('selected'), reason: z.literal('first_eligible'),
  selectedIndex: z.number().int().min(0).max(63), observation: paperSizingObservationSchema, observationSha256: simulationHash,
}).strict(), z.object({
  ...common, status: z.literal('not_selected'), reason: z.enum(['decision_outside_window', 'no_eligible_observation']),
  selectedIndex: z.null(), observation: z.null(), observationSha256: z.null(),
}).strict()]);
export type PaperObservationSelection = z.infer<typeof resultSchema>;
const rejected = (): PaperObservationSelection => ({ schema: 'gelt.paper-observation-selection.v1', status: 'rejected', reason: 'invalid_input' });

// Pure supplied-batch selection only: no wall clock, acquisition, economic
// branch, persistent freeze, admission or downstream sizing/dispatch.
export function selectPaperObservation(bytes: Buffer): PaperObservationSelection {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > shadowRuleMaxBytes) return rejected();
    const input = inputSchema.parse(parseResearchJSON(bytes));
    const { config: c, mapping: m, ruleInput: i, ruleReceipt: r, observations } = input;
    const mappingSha256 = simulationDigest(m);
    if (!matchesShadowRuleReceipt(Buffer.from(canonical(i)), r) || r.inputValidation !== 'valid'
      || i.runId !== c.runId || r.runId !== c.runId || i.sourceCommit !== c.sourceCommit || r.sourceCommit !== c.sourceCommit
      || i.data.classification !== c.classification || r.classification !== c.classification || i.data.eligibility !== 'declared'
      || i.instrument.id !== m.underlying.symbol || i.instrument.currency !== m.underlying.currency
      || i.instrument.calendarSha256 !== m.signal.calendarSha256 || c.mappingSha256 !== mappingSha256
      || c.internalInstrumentId !== m.internal.instrumentId || c.currency !== m.internal.currency
      || i.policy.scheduleSha256 !== c.scheduleSha256 || i.policy.maxAgeMs !== c.signalMaxAgeMs
      || i.policy.exposureCap.value !== '0.95' || i.policy.exposureCap.scale !== 2) return rejected();
    const evaluation = Date.parse(input.evaluationAt), decision = Date.parse(i.decisionAt);
    for (let index = 0; index < observations.length; index++) {
      const o = observations[index], observed = Date.parse(o.observedAt), available = Date.parse(o.availableAt);
      if (o.mappingSha256 !== mappingSha256 || available < observed || available > evaluation
        || index > 0 && observed <= Date.parse(observations[index - 1].observedAt)) return rejected();
    }
    const outside = evaluation < decision || evaluation > Date.parse(c.validThrough) || evaluation - decision > c.maxDecisionAgeMs;
    const index = outside ? -1 : observations.findIndex(o => Date.parse(o.observedAt) > decision
      && evaluation - Date.parse(o.observedAt) <= c.maxObservationAgeMs);
    const branch = index >= 0 ? {
      status: 'selected' as const, reason: 'first_eligible' as const, selectedIndex: index,
      observation: observations[index], observationSha256: simulationDigest(observations[index]),
    } : {
      status: 'not_selected' as const, reason: outside ? 'decision_outside_window' as const : 'no_eligible_observation' as const,
      selectedIndex: null, observation: null, observationSha256: null,
    };
    const body = {
      schema: 'gelt.paper-observation-selection.v1' as const,
      inputSha256: simulationDigest(input), inputDigestKind: 'canonical_validated_input' as const,
      batchSha256: simulationDigest(observations), configSha256: simulationDigest(c), mappingSha256,
      ruleInputSha256: simulationDigest(i), ruleReceiptSha256: simulationDigest(r),
      runId: c.runId, sourceCommit: c.sourceCommit, decisionId: r.decisionId, decisionAt: i.decisionAt, evaluationAt: input.evaluationAt,
      classification: 'constructed_offline_test' as const, selectionBasis: 'first_eligible_in_supplied_batch' as const,
      globalFirstObservation: 'not_established' as const, durableFreeze: 'not_established' as const,
      sourceAndProvenance: 'caller_assertions_not_independently_verified' as const,
      marketEvaluation: 'not_established' as const, effectAuthority: 'none' as const, promotionAllowed: false as const, ...branch,
    };
    return resultSchema.parse({ ...body, selectionId: `paper-observation-${simulationDigest(body)}` });
  } catch { return rejected(); }
}

// Matching proves deterministic linkage only; a caller can supply a new batch.
export function matchesPaperObservationSelection(bytes: Buffer, value: unknown): boolean {
  try {
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success || parsed.data.status === 'rejected') return false;
    const expected = selectPaperObservation(bytes);
    return expected.status !== 'rejected' && canonical(parsed.data) === canonical(expected);
  } catch { return false; }
}
