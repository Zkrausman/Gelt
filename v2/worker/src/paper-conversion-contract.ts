import { z } from 'zod';
import { parseResearchJSON } from './research-json.js';
import { alpacaIexDecimalSchema, alpacaIexRequestEvidenceSchema } from './alpaca-iex-contract.js';
import { parseVerdictStructure, type ReviewVerdictV1 } from './alpaca-byte-review-contract.js';

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

// A separate mathematical-inspection vocabulary; never a constructed request.
export const spy253PAMRInspectionLimit = 180000;
const fullDecimal = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?![\s\S])/;
export const spy253InspectionCloseSchema = alpacaIexDecimalSchema
  .refine(d => fullDecimal.test(d.value) && /[1-9]/.test(d.value));
const inspectionTime = z.string().datetime({ precision: 3 }).refine(s => new Date(s).toISOString() === s);
const inspectionHash = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const inspectionReview = z.custom<ReviewVerdictV1>(raw => {
  try {
    const v = parseVerdictStructure(raw);
    return v.outcome === 'incomplete'
      && v.authorityId === 'spy253.inspection.no-market-authority.v1'
      && v.reviewerRevision === 'gelt.spy253-source-inspector.v1'
      && v.checks.every((c, i) => c.result === (i < 6 || i === 15 ? 'pass' : 'unknown') && c.reason === (i < 6 || i === 15 ? 'none' : 'evidence_missing'));
  } catch { return false; }
});
export const spy253InspectionSourceRequestSchema = alpacaIexRequestEvidenceSchema.extend({
  symbol: z.literal('SPY'), feed: z.literal('iex'), adjustment: z.literal('all'),
  start: z.literal('2025-10-24T04:00:00.000Z'),
  end: z.literal('2026-10-27T04:00:00.000Z'), asof: z.literal('2026-10-27'),
  timeframe: z.literal('1Day'), currency: z.literal('USD'), sort: z.literal('desc'),
}).strict();
const inspectionSelected = z.object({
  sourceIndex: z.number().int().min(0).max(64), sessionOrdinal: z.number().int().min(189).max(253),
  providerTimestamp: inspectionTime, declaredAvailableAt: inspectionTime.nullable(),
  close: spy253InspectionCloseSchema,
}).strict();
export const spy253PAMRInspectionRequestSchema = z.object({
  schema: z.literal('gelt.spy253-pamr-inspection-request.v1'),
  classification: z.literal('source_inspection_only'),
  recipe: recipeSchema,
  assets: z.tuple([z.literal('SPY-CLOSE-RELATIVE'), z.literal('DECLARED-UNIT-RESERVE')]),
  rows: z.array(z.tuple([positiveDecimal.refine(s => fullDecimal.test(s)), z.literal('1')])).length(64),
  selection: z.literal('newest65_declared_calendar_compatible_reversed_to_chronological'),
  initialization: z.literal('equal_weights_at_selected_history_start'),
  discardedCount: z.literal(188),
  selected: z.array(inspectionSelected).length(65),
  lineage: z.object({
    originalSha256: inspectionHash, allObservationsSha256: inspectionHash,
    request: spy253InspectionSourceRequestSchema,
    pages: z.array(z.object({ page: z.number().int().min(1).max(3),
      byteLength: z.number().int().min(1).max(524288), sha256: inspectionHash }).strict()).min(1).max(3),
    calendarSha256: inspectionHash, declarationsSha256: inspectionHash,
    availabilitySha256: inspectionHash.nullable(), providerRevisionsSha256: inspectionHash,
    receivedAt: inspectionTime,
    decisionAt: z.literal('2026-10-28T13:00:00.000Z'),
    declaredPrefixAvailableAt: inspectionTime.nullable(),
    review: inspectionReview,
  }).strict(),
}).strict().superRefine((v, ctx) => {
  const bad = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid inspection binding' });
  if (Date.parse(v.lineage.receivedAt) > Date.parse(v.lineage.decisionAt)) bad();
  if (v.lineage.pages.length !== v.lineage.request.pageRequests.length || v.lineage.pages.some((p, i) => p.page !== i + 1)) bad();
  for (let i = 0; i < v.selected.length; i++) {
    const s = v.selected[i];
    if (s.sourceIndex !== 64 - i || s.sessionOrdinal !== 189 + i
      || s.providerTimestamp < v.lineage.request.start || s.providerTimestamp > v.lineage.request.end
      || (i > 0 && s.providerTimestamp <= v.selected[i - 1].providerTimestamp)
      || (s.declaredAvailableAt !== null && (s.declaredAvailableAt < v.lineage.receivedAt || s.declaredAvailableAt > v.lineage.decisionAt))) {
      bad();
    }
  }
  const declared = v.selected.map(s => s.declaredAvailableAt);
  const prefix = declared.every((s): s is string => s !== null) ? declared.reduce((a, b) => a > b ? a : b) : null;
  if (prefix !== v.lineage.declaredPrefixAvailableAt || (v.lineage.availabilitySha256 === null) !== declared.every(s => s === null)) bad();
});
export type Spy253PAMRInspectionRequest = z.infer<typeof spy253PAMRInspectionRequestSchema>;
export function parseSpy253PAMRInspectionRequest(text: unknown): Spy253PAMRInspectionRequest {
  return spy253PAMRInspectionRequestSchema.parse(parsePAMRJSON(text, 'request'));
}
