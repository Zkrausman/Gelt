import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import {
  a64HistoryBindingSchema, a64InspectionCaseSchema,
  a64InspectionEvidenceLimits, boundedA64InspectionEvidenceText,
} from './pamr-a64-inspection-evidence-contract.js';

// Two bounded declaration contexts inside one finite request. These are data
// preparation limits, not a second artifact/history allowance or handling grant.
export const prospectiveDeclarationLimits = Object.freeze({
  input: a64InspectionEvidenceLimits.input,
  declaration: a64InspectionEvidenceLimits.context,
  output: a64InspectionEvidenceLimits.assessment,
});
export const prospectiveDeclarationInputSchemaId = 'gelt.agent.a64-prospective-declaration-input.v1';
const hash = z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/);
const proposedId = z.string().min(1).max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}(?![\s\S])/);
const timestamp = z.string().length(24).datetime({ precision: 3 }).refine(s => {
  try { return Date.parse(s) >= 0 && new Date(s).toISOString() === s; }
  catch { return false; }
});
const sessionDate = z.string().length(10).regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?![\s\S])/)
  .refine(s => {
    try { return Date.parse(s + 'T00:00:00.000Z') >= 0
      && new Date(s + 'T00:00:00.000Z').toISOString().slice(0, 10) === s; }
    catch { return false; }
  });

const schedule = z.discriminatedUnion('knowledge', [
  z.object({ knowledge: z.literal('unknown') }).strict(),
  z.object({ knowledge: z.literal('declared_only'), calendarSha256: hash,
    sessions: z.array(sessionDate).length(253) }).strict(),
]);
const utcBoundaryMapping = z.discriminatedUnion('knowledge', [
  z.object({ knowledge: z.literal('unknown') }).strict(),
  z.object({ knowledge: z.literal('declared_only'), firstSessionStartsAt: timestamp, lastSessionCompletesAt: timestamp }).strict(),
]);
const revision = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial_declaration') }).strict(),
  z.object({ kind: z.literal('revised_declaration'), predecessorSha256: hash,
    changeObservedAt: timestamp.nullable() }).strict(),
]);

// No accepted future request/profile or actual supplier is represented here.
// Dates are proposed session LABELS. No provider/session/UTC mapping is inferred.
export const prospectiveDeclarationSchema = z.object({
  schema: z.literal('gelt.a64-prospective-profile-declaration.v1'),
  purpose: z.literal('engineering_evidence_chain_integrity_preparation_only'),
  case: a64InspectionCaseSchema,
  proposedEpochId: proposedId,
  profileRevision: proposedId,
  profileDeclaredAt: timestamp,
  historyProposal: a64HistoryBindingSchema,
  window: z.object({ startSessionDate: sessionDate, endSessionDateExclusive: sessionDate,
    schedule, utcBoundaryMapping }).strict(),
  timing: z.object({
    declaredWindowCompletedAt: timestamp.nullable(),
    sourceReceivedAt: timestamp.nullable(),
    sourceCompletedAt: timestamp.nullable(),
    assertedCompleteInputAvailableAt: timestamp.nullable(),
    proposedDecisionAt: timestamp,
    proposedEvaluationAt: timestamp,
  }).strict(),
  collectedInputSha256: hash.nullable(),
  revision,
}).strict();
export type ProspectiveDeclaration = z.infer<typeof prospectiveDeclarationSchema>;

const inputSchema = z.object({
  schema: z.literal(prospectiveDeclarationInputSchemaId),
  currentText: z.string().max(prospectiveDeclarationLimits.declaration),
  predecessorText: z.string().max(prospectiveDeclarationLimits.declaration).nullable(),
}).strict();

export function parseProspectiveDeclarationInput(raw: unknown): {
  current: ProspectiveDeclaration; predecessor: ProspectiveDeclaration | null;
} {
  const outerText = boundedA64InspectionEvidenceText(raw, 'input');
  const input = inputSchema.parse(parseResearchJSON(Buffer.from(outerText, 'utf8')));
  const read = (text: string) => prospectiveDeclarationSchema.parse(parseResearchJSON(
    Buffer.from(boundedA64InspectionEvidenceText(text, 'context'), 'utf8'),
  ));
  return { current: read(input.currentText),
    predecessor: input.predecessorText === null ? null : read(input.predecessorText) };
}

// Whole supplied declaration data only; no authenticity, issuance or ownership.
export function prospectiveDeclarationSha256(value: ProspectiveDeclaration): string {
  return digest(canonical({ domain: 'gelt.a64-prospective-profile-declaration.v1/data', value }));
}
