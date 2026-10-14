import { createHash } from 'node:crypto';
import { z } from 'zod';
import { shadowSizingPolicyId } from './shadow-sizing-contract.js';
import { canonical } from './ledger-canonical.js';
import { decimalSchema } from './ledger-contract.js';
import { simulationSource, simulationPolicy, simulationHash, simulationTimestamp, simulationClassification, simulationObservationSchema } from './synthetic-simulation-economics.js';

export const syntheticMockSource = 'gelt-synthetic-robinhood-mock-v1' as const;
export const syntheticMockIssuer = 'urn:gelt:synthetic-mock-robinhood:v1' as const;
export const syntheticMockAudience = 'loopback://gelt/synthetic-mock-robinhood/v1' as const;
export const syntheticMockPrincipal = 'gelt-test-principal-v1' as const;
export const syntheticMockAccount = 'gelt-test-account-v1' as const;
export const syntheticMockInstrument = 'SYNTH-RH-USD' as const;
export const syntheticMockPolicy = 'synthetic-limit-fee-cap-10.v1' as const;
export const syntheticMockFee = decimalSchema.parse({ value: '0.01', precision: 3, scale: 2 });
export const syntheticMockQuote = decimalSchema.parse({ value: '0.90', precision: 3, scale: 2 });

const positiveDecimal = decimalSchema.refine(value => /[1-9]/.test(value.value));
const identifier = z.string().uuid();
const timestamp = z.string().datetime({ precision: 3 }).refine(value => {
  try { return new Date(value).toISOString() === value; } catch { return false; }
});

export const syntheticMockOrderSchema = z.object({
  instrumentId: z.literal(syntheticMockInstrument),
  route: z.literal('RHS'),
  side: z.literal('buy'),
  type: z.literal('limit'),
  timeInForce: z.literal('day'),
  quantity: positiveDecimal,
  limitPrice: positiveDecimal,
  currency: z.literal('USD'),
}).strict();

export const syntheticMockV1PreviewSchema = z.object({
  version: z.literal(1),
  source: z.literal(syntheticMockSource),
  previewId: identifier,
  principal: z.literal(syntheticMockPrincipal),
  account: z.literal(syntheticMockAccount),
  policyId: z.literal(syntheticMockPolicy),
  quote: z.object({ instrumentId: z.literal(syntheticMockInstrument), price: decimalSchema, source: z.literal('gelt-synthetic-robinhood-quote-v1') }).strict(),
  fee: z.object({ amount: decimalSchema, currency: z.literal('USD'), source: z.literal('gelt-synthetic-robinhood-fee-v1') }).strict(),
  order: syntheticMockOrderSchema,
  expiresAt: timestamp,
}).strict();

// Optional versioned binding metadata leaves all old v1/v2 records readable.
export const sizingBindingPolicySchema = z.object({
  schema: z.literal('gelt.synthetic-sizing-binding-policy.v1'), version: z.literal(1),
  classification: z.literal('constructed_offline_test'), runId: identifier,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), configSha256: simulationHash,
  sizingPolicyId: z.literal(shadowSizingPolicyId), quantityQuantum: positiveDecimal.refine(d => d.scale <= 18),
  buyLimitPrice: positiveDecimal, sellLimitPrice: positiveDecimal,
}).strict();
export type SizingBindingPolicy = z.infer<typeof sizingBindingPolicySchema>;
export const sizingEvidenceSchema = z.object({ version: z.literal(1), policyId: z.literal(shadowSizingPolicyId),
  policySha256: simulationHash, proposalId: z.string().regex(/^shadow-sizing-[a-f0-9]{64}$/),
  sizingInputSha256: simulationHash, proposalSha256: simulationHash, evidenceManifestSha256: simulationHash,
}).strict();
export type SizingEvidence = z.infer<typeof sizingEvidenceSchema>;
export const sizingReplayManifestSchema = z.object({
  schema: z.literal('gelt.synthetic-sizing-replay-evidence.v1'), version: z.literal(1),
  classification: z.literal('constructed_offline_test'), runId: identifier,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), configSha256: simulationHash,
  portfolioSnapshotSha256: simulationHash, decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/),
  policyId: z.literal(shadowSizingPolicyId), policySha256: simulationHash,
  proposalId: z.string().regex(/^shadow-sizing-[a-f0-9]{64}$/), inputSha256: simulationHash, proposalSha256: simulationHash,
  inputBytes: z.number().int().positive().max(262144), proposalBytes: z.number().int().positive().max(8192),
}).strict();
export const sizingBindingRejectionSchema = z.object({
  schema: z.literal('gelt.synthetic-sizing-binding-rejection.v1'), version: z.literal(1),
  classification: z.literal('constructed_offline_test'), outcome: z.literal('no_order'),
  reason: z.enum(['invalid_input', 'input_too_large', 'receipt_mismatch', 'binding_mismatch']),
}).strict();

export const syntheticMockRunPreviewSchema = syntheticMockV1PreviewSchema.extend({
  version: z.literal(2), source: z.literal(simulationSource), policyId: z.literal(simulationPolicy),
  order: syntheticMockOrderSchema.extend({ side: z.enum(['buy', 'sell']) }).strict(),
  runId: identifier, configSha256: simulationHash, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/), decisionAt: simulationTimestamp,
  sizingEvidence: sizingEvidenceSchema.optional(),
  inputSha256: simulationHash, portfolioSnapshotSha256: simulationHash, classification: simulationClassification,
  quote: simulationObservationSchema.extend({ instrumentId: z.literal(syntheticMockInstrument), price: positiveDecimal,
    source: z.literal('declared-simulated-observation-v2') }).strict(),
  fee: z.object({ amount: decimalSchema, currency: z.literal('USD'), source: z.literal('declared-simulated-cost-v2') }).strict(),
}).strict();
export const syntheticMockPreviewSchema = z.union([syntheticMockV1PreviewSchema, syntheticMockRunPreviewSchema]);
export type SyntheticRunPreview = z.infer<typeof syntheticMockRunPreviewSchema>;

export const syntheticMockAdmissionInputSchema = z.object({
  preview: syntheticMockPreviewSchema,
  termsHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationToken: z.string().length(43),
}).strict();

export const syntheticMockAdmissionSchema = z.object({
  previewId: identifier,
  handle: z.string().length(43),
  expiresAt: timestamp,
}).strict();

export const syntheticMockSubmitInputSchema = z.object({
  dispatchId: identifier,
  preview: syntheticMockPreviewSchema,
  termsHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationToken: z.string().length(43),
  admissionHandle: z.string().length(43),
}).strict();

export const syntheticMockStatusSchema = z.enum(['accepted', 'open', 'partially-filled', 'pending-cancel', 'filled', 'canceled']);

export const syntheticMockV1ExecutionSchema = z.object({
  executionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/),
  quantity: positiveDecimal,
  price: positiveDecimal,
  fee: decimalSchema.optional(),
  currency: z.literal('USD'),
}).strict();

export const syntheticMockRunExecutionSchema = syntheticMockV1ExecutionSchema.extend({
  version: z.literal(2), runId: identifier, configSha256: simulationHash, receiptId: identifier,
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/), fee: decimalSchema,
  observation: simulationObservationSchema,
}).strict();
export const syntheticMockExecutionSchema = z.union([syntheticMockV1ExecutionSchema, syntheticMockRunExecutionSchema]);
export type SyntheticRunExecution = z.infer<typeof syntheticMockRunExecutionSchema>;

export const syntheticMockOrderViewSchema = z.object({
  source: z.enum([syntheticMockSource, simulationSource]),
  dispatchId: identifier,
  mockOrderId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/),
  previewId: identifier,
  sizingEvidence: sizingEvidenceSchema.optional(),
  status: syntheticMockStatusSchema,
  executions: z.array(syntheticMockExecutionSchema).max(16),
  cancelAcknowledged: z.boolean(),
}).strict();

export type SyntheticMockOrder = z.infer<typeof syntheticMockOrderSchema> | SyntheticRunPreview['order'];
export type SyntheticMockPreview = z.infer<typeof syntheticMockPreviewSchema>;
export type SyntheticMockAdmissionInput = z.infer<typeof syntheticMockAdmissionInputSchema>;
export type SyntheticMockSubmitInput = z.infer<typeof syntheticMockSubmitInputSchema>;
export type SyntheticMockExecution = z.infer<typeof syntheticMockExecutionSchema>;
export type SyntheticMockOrderView = z.infer<typeof syntheticMockOrderViewSchema>;

export function syntheticMockDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function coefficient(value: z.infer<typeof decimalSchema>): bigint { return BigInt(value.value.replace('.', '')); }
function scale(value: z.infer<typeof decimalSchema>): number { return value.scale; }
function power10(value: number): bigint { return 10n ** BigInt(value); }
export function compareSyntheticDecimals(left: z.infer<typeof decimalSchema>, right: z.infer<typeof decimalSchema>): number {
  const common = Math.max(scale(left), scale(right));
  const a = coefficient(left) * power10(common - scale(left));
  const b = coefficient(right) * power10(common - scale(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function withinSyntheticFeeCap(order: SyntheticMockOrder, fee: z.infer<typeof decimalSchema>): boolean {
  const productScale = order.quantity.scale + order.limitPrice.scale;
  const common = Math.max(productScale, fee.scale);
  const gross = coefficient(order.quantity) * coefficient(order.limitPrice) * power10(common - productScale)
    + coefficient(fee) * power10(common - fee.scale);
  return gross <= 10n * power10(common);
}

export function sameSyntheticOrder(left: SyntheticMockOrder, right: SyntheticMockOrder): boolean {
  return canonical(left) === canonical(right);
}
