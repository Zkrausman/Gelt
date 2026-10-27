import { z } from 'zod';
import { parseResearchJSON } from './research-json.js';

// Selected mathematical profile only. The original implementation is neither
// executed nor copied; these pins identify the inspected discrepancy, not trust.
export const pamrRecipe = Object.freeze({
  schema: 'gelt.pamr-mathematical-recipe.v1', algorithm: 'PAMR-base',
  paper: 'doi:10.1007/s10994-012-5281-z',
  reference: 'OLPS/OLPS@9120783cd59a7966b0f78e2b5668030a4378b8af',
  referenceRunSha256: 'ad57382eabfd98677d29f3e765ccb61f94fd5fe9fceaa25f1ece7465ea341de7',
  profile: 'exact-rational-simplex-zero-norm-tau0.v1', epsilon: '0.5', transactionCost: '0',
  discrepancy: 'original-first-zero-norm-eta-uninitialized; mathematical-tau0-explicit',
});
export const pamrRequestLimit = 32768;
export const pamrArtifactLimit = 2097152;
const recipeSchema = z.object({
  schema: z.literal(pamrRecipe.schema), algorithm: z.literal(pamrRecipe.algorithm),
  paper: z.literal(pamrRecipe.paper), reference: z.literal(pamrRecipe.reference),
  referenceRunSha256: z.literal(pamrRecipe.referenceRunSha256), profile: z.literal(pamrRecipe.profile),
  epsilon: z.literal(pamrRecipe.epsilon), transactionCost: z.literal(pamrRecipe.transactionCost),
  discrepancy: z.literal(pamrRecipe.discrepancy),
}).strict();
const positiveDecimal = z.string().min(1).max(32).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
  .refine(s => /[1-9]/.test(s));
export const pamrRequestSchema = z.object({
  schema: z.literal('gelt.pamr-constructed-request.v1'),
  classification: z.literal('constructed_offline_test'), recipe: recipeSchema,
  assets: z.array(z.string().regex(/^SYNTH-[A-Z][A-Z0-9_]{0,15}$/)).min(2).max(8),
  rows: z.array(z.array(positiveDecimal).min(2).max(8)).min(1).max(64),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.assets).size !== v.assets.length || v.rows.some(row => row.length !== v.assets.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid dimensions' });
  }
});
export type PAMRRequest = z.infer<typeof pamrRequestSchema>;

// Public input is text, never caller objects, callbacks, modules or file paths.
// Character check precedes byte allocation; duplicate keys/depth/nodes are
// checked by the existing strict parser before whole-tree JSON.parse.
export function parsePAMRJSON(text: unknown, kind: 'request' | 'artifact'): unknown {
  const limit = kind === 'request' ? pamrRequestLimit : pamrArtifactLimit;
  if (typeof text !== 'string' || text.length > limit || Buffer.byteLength(text, 'utf8') > limit) {
    throw new Error('invalid PAMR data');
  }
  return parseResearchJSON(Buffer.from(text, 'utf8'));
}
export function parsePAMRRequest(text: unknown): PAMRRequest {
  return pamrRequestSchema.parse(parsePAMRJSON(text, 'request'));
}
