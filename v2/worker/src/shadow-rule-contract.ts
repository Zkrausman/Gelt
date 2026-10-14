import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';

export const shadowRuleId = 'gelt-long-cash-sign-return-252.v1' as const;
export const shadowRuleMaxBytes = 256 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ precision: 3 }).refine(s => {
  try { return new Date(s).toISOString() === s; } catch { return false; }
});
const label = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const positive = decimalSchema.refine(d => /[1-9]/.test(d.value));
const fraction = decimalSchema.refine(d => decimalCompare(d, { value: '1', precision: 1, scale: 0 }) <= 0);
const exposure = fraction.refine(d => /[1-9]/.test(d.value));

// Compare exact decimal strings across scales; never convert money to Number.
export function decimalCompare(a: z.infer<typeof decimalSchema>, b: z.infer<typeof decimalSchema>): number {
  const left = BigInt(a.value.replace('.', '')) * 10n ** BigInt(b.scale);
  const right = BigInt(b.value.replace('.', '')) * 10n ** BigInt(a.scale);
  return left > right ? 1 : left < right ? -1 : 0;
}

export const shadowRuleInputSchema = z.object({
  schema: z.literal('gelt.shadow-rule-input.v1'),
  ruleId: z.literal(shadowRuleId),
  runId: z.string().uuid(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  decisionAt: timestamp,
  instrument: z.object({ id: label, currency: label, calendarSha256: hash }).strict(),
  data: z.object({
    classification: z.enum(['constructed_offline_test', 'market_shadow_input']),
    eligibility: z.enum(['declared', 'unverified']),
    datasetSha256: hash, rightsEvidenceSha256: hash, pointInTimeEvidenceSha256: hash,
  }).strict(),
  policy: z.object({
    scheduleSha256: hash, maxAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    exposureCap: exposure,
  }).strict(),
  costs: z.object({
    status: z.enum(['declared', 'unverified']), evidenceSha256: hash, stressScenarioSha256: hash,
    commissionPerTrade: decimalSchema, spreadFraction: fraction, slippageFraction: fraction,
  }).strict(),
  controls: z.object({ passiveSha256: hash, cashAssumptionSha256: hash }).strict(),
  portfolio: z.object({ state: z.enum(['settled', 'unknown']), snapshotSha256: hash }).strict(),
  // Exactly the last 253 completed trading observations, or a shorter warm-up.
  // Ordinals are checked for gaps; calendar/provenance remain caller assertions.
  bars: z.array(z.object({
    sessionOrdinal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    closedAt: timestamp, availableAt: timestamp, adjustedClose: positive,
  }).strict()).max(253),
}).strict();
export type ShadowRuleInput = z.infer<typeof shadowRuleInputSchema>;

export const shadowRuleReasons = [
  'positive_return', 'nonpositive_return', 'invalid_input', 'unverified_data',
  'unverified_costs', 'execution_unknown', 'insufficient_warmup',
  'ineligible_timestamp', 'noncontiguous_observations', 'stale_input',
] as const;
export const shadowRuleReceiptSchema = z.object({
  schema: z.literal('gelt.shadow-rule-receipt.v1'), ruleId: z.literal(shadowRuleId),
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/),
  runId: z.string().uuid().nullable(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  decisionAt: timestamp.nullable(), inputSha256: hash.nullable(),
  inputDigestKind: z.enum(['canonical_validated_input', 'rejected_bytes', 'unbound']),
  inputValidation: z.enum(['valid', 'invalid']),
  classification: z.enum(['constructed_offline_test', 'market_shadow_input']).nullable(),
  decision: z.enum(['target_long', 'target_cash', 'abstain']), reason: z.enum(shadowRuleReasons),
  targetExposure: fraction.nullable(),
  evidence: z.object({ datasetSha256: hash, costsSha256: hash, controlsSha256: hash, portfolioSha256: hash }).strict().nullable(),
  scope: z.literal('paper-derived-rule-adaptation'),
  sourceAndProvenance: z.literal('caller_assertions_not_independently_verified'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'), promotionAllowed: z.literal(false),
}).strict();
export type ShadowRuleReceipt = z.infer<typeof shadowRuleReceiptSchema>;
