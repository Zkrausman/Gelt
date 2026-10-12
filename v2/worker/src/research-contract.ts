import { z } from 'zod';

export const MAX_RESEARCH_BYTES = 65_536;
// Compact exponent literals expand during JSON serialization. Share the actual
// wire bound; reserve 4 KiB beyond canonical evidence for Gelt/session metadata.
export const MAX_RESEARCH_RESPONSE_BYTES = 524_288;
export const MAX_CANONICAL_RESEARCH_BYTES = MAX_RESEARCH_RESPONSE_BYTES - 4096;
export const researchIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(2048);
const label = z.string().min(1).max(128);
const number = z.number().finite();
// Citations are inert display data, never fetch targets. No arbitrary endpoint field.
const citation = z.object({ title: text, identifier: text, license: label }).strict();
export const researchStageSchema = z.object({
  status: z.enum(['passed', 'failed', 'blocked', 'not_run']), detail: text,
}).strict();
const notRunStage = z.object({ status: z.literal('not_run'), detail: text }).strict();
const stages = z.object({
  reference: researchStageSchema, mcp: researchStageSchema,
  reproduction: researchStageSchema, historical: notRunStage,
  shadow: notRunStage, costs: notRunStage,
}).strict();
export const researchEvidenceSchema = z.object({
  schema: z.literal('gelt.research-evidence.v1'),
  kind: z.literal('reference_computation'), evidenceId: researchIdSchema,
  createdAt: z.string().datetime({ precision: 3 }), title: text,
  source: z.object({
    paper: citation, code: citation.extend({ commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
    paper2agent: citation.extend({ commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  }).strict(),
  inputs: z.array(z.object({ name: label, values: z.array(number).min(1).max(4096), units: label }).strict()).min(1).max(32),
  dependencyLock: z.object({ sha256: sha256Schema, packages: z.array(z.object({ name: label, version: label }).strict()).min(1).max(128) }).strict(),
  results: z.array(z.object({
    name: label, actual: number, expected: number,
    absoluteTolerance: number.nonnegative(), relativeTolerance: number.nonnegative(),
  }).strict()).min(1).max(256),
  provenance: z.object({
    adapterVersion: label, runtime: label, seed: z.number().int().min(0).max(2_147_483_647),
    inputSha256: sha256Schema, outputSha256: sha256Schema,
    data: z.array(citation).min(1).max(32), assumptions: z.array(text).min(1).max(32),
  }).strict(),
  producerClaims: stages,
  limitations: z.array(text).min(1).max(32),
  recommendation: z.object({ decision: z.literal('insufficient_evidence'), promotionAllowed: z.literal(false), reasons: z.array(text).min(1).max(32) }).strict(),
}).strict().superRefine((evidence, context) => {
  if (new TextEncoder().encode(JSON.stringify(evidence)).length > MAX_CANONICAL_RESEARCH_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'serialized evidence exceeds response budget' });
  }
  for (const [path, names] of [
    ['inputs', evidence.inputs.map(item => item.name)],
    ['results', evidence.results.map(item => item.name)],
    ['dependencyLock', evidence.dependencyLock.packages.map(item => item.name)],
  ] as const) {
    if (new Set(names).size !== names.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: 'duplicate named evidence item' });
  }
});
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;
export const researchRecordSchema = z.object({
  evidence: researchEvidenceSchema, originalSha256: sha256Schema,
  originalBytes: z.number().int().min(1).max(MAX_RESEARCH_BYTES),
  importedAt: z.string().datetime({ precision: 3 }),
  geltChecks: z.object({ schema: z.literal('passed'), integrity: z.literal('passed'),
    numericComparison: researchStageSchema, scientificReproduction: z.literal('not_run') }).strict(),
}).strict();
export type ResearchRecord = z.infer<typeof researchRecordSchema>;
export type ResearchRead = { state: 'available'; record: ResearchRecord } | { state: 'missing' | 'corrupt' | 'unavailable' };
