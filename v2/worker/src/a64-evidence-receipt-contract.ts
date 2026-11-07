import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';

export const a64ReceiptLimits = Object.freeze({
  input: 262144, artifact: 180000, context: 8192,
  assessment: 8192, receipt: 8192, store: 8388608, records: 1,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const a64ReceiptBindingSchema = z.object({
  schema: z.literal('gelt.a64-evidence-retention-binding.v1'),
  ownerNamespaceSha256: hash,
  caseEpochSha256: hash,
}).strict();
export type A64ReceiptBinding = z.infer<typeof a64ReceiptBindingSchema>;

export const a64ReceiptDisclosure = Object.freeze({
  purpose: 'evidence_retention_only',
  persistence: 'evidence_record_only',
  classification: 'source_inspection_only',
  receiptSequence: 1,
  previousReceiptSha256: null,
  historyUpdates: 64,
  operationalDecisions: 0,
  consumptionAttempts: 0,
  effectAuthority: 'none',
  authenticity: 'not_established',
  runtimeQualification: 'not_established',
  dispatchAllowed: false,
  promotionAllowed: false,
  qualification: 'NOT_READY',
  production: 'CLOSED',
  operations: 'DEFER',
} as const);
const bodySchema = z.object({
  schema: z.literal('gelt.a64-evidence-retention-receipt.v1'),
  binding: a64ReceiptBindingSchema,
  inputBytes: z.number().int().positive().max(a64ReceiptLimits.input),
  rawInputSha256: hash,
  assessmentSha256: hash,
  artifactSha256: hash,
  contextSha256: hash,
  ...Object.fromEntries(Object.entries(a64ReceiptDisclosure).map(([k, v]) => [k, z.literal(v)])),
}).strict();
export function a64ReceiptHash(value: unknown): string {
  return digest(canonical({ domain: 'gelt.a64-evidence-retention.v1/receipt', value }));
}
export const a64ReceiptSchema = bodySchema.extend({ receiptSha256: hash }).strict()
  .refine(({ receiptSha256, ...body }) => receiptSha256 === a64ReceiptHash(body));
export type A64EvidenceReceipt = z.infer<typeof a64ReceiptSchema>;
export class A64EvidenceReceiptError extends Error {
  constructor(readonly reason: 'invalid_input' | 'unavailable' | 'already_retained' | 'readonly' | 'uncertain') {
    super('A64 evidence retention unavailable');
  }
}
export function parseA64Receipt(text: string): A64EvidenceReceipt {
  if (typeof text !== 'string' || Buffer.byteLength(text) > a64ReceiptLimits.receipt) {
    throw new A64EvidenceReceiptError('invalid_input');
  }
  try { return a64ReceiptSchema.parse(parseResearchJSON(Buffer.from(text))); }
  catch { throw new A64EvidenceReceiptError('invalid_input'); }
}
