import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { checkIds } from './alpaca-byte-review-contract.js';
import {
  pamrRecipe,
  spy253InspectionSourceRequestSchema,
} from './paper-conversion-contract.js';

export const a64InspectionEvidenceLimits = Object.freeze({
  input: 262144,
  artifact: 180000,
  context: 8192,
  assessment: 8192,
});

export type A64InspectionEvidenceRejection =
  | 'invalid_input'
  | 'artifact_mismatch'
  | 'binding_mismatch'
  | 'resource_limit';

export class A64InspectionEvidenceBoundaryError extends Error {
  constructor(readonly reason: A64InspectionEvidenceRejection) {
    super('A64 inspection evidence unavailable');
  }
}

function literals<T extends Record<string, string | number | boolean>>(value: T) {
  const shape = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, z.literal(item)]),
  ) as { [K in keyof T]: z.ZodLiteral<T[K]> };
  return z.object(shape).strict();
}

export const a64InspectionHistory = Object.freeze({
  schema: 'gelt.pamr-a64-history-binding.v1',
  originalCloses: 253,
  selectedCloses: 65,
  historyUpdates: 64,
  firstSessionOrdinal: 189,
  lastSessionOrdinal: 253,
  excludedObservations: 188,
  selection: 'newest65_declared_calendar_compatible_reversed_to_chronological',
  initialization: 'equal_weights_at_selected_history_start',
} as const);

export const a64HistoryBindingSchema = literals(a64InspectionHistory);
export type A64HistoryBindingV1 = z.infer<typeof a64HistoryBindingSchema>;

export const a64InspectionUnknownFacts = Object.freeze({
  actualOriginalIssuance: 'unknown',
  privateCompletion: 'unknown',
  currentOriginalValidity: 'unknown',
  actualSupplier: 'unknown',
  inputRights: 'unknown',
  clockAuthentication: 'unknown',
  causalAvailability: 'unknown',
  calendarCompletion: 'unknown',
  providerCompletion: 'unknown',
  providerRevisionCoherence: 'unknown',
  reviewerAdmission: 'unknown',
  handling: 'unknown',
  ownerAdmission: 'unknown',
  ownAcknowledgement: 'unknown',
  releaseSettlement: 'unknown',
  RCurrentCImmutableE: 'unknown',
  economicPolicy: 'unknown',
  prospectiveProfileAdmission: 'unknown',
  observationPolicy: 'unknown',
  lifecycleState: 'unknown',
} as const);

export const a64InspectionUnknownFactsSchema = literals(a64InspectionUnknownFacts);

// These are copied disclosures of the complete verified DATA artifact.
// They do not describe an authenticated original or current private state.
export const a64InspectionInheritedDisclosures = Object.freeze({
  fidelity: 'selected_64_intervals_only_not_full_252_history',
  initialization: 'equal_weights_at_selected_history_start',
  reserveConvention: 'declared_mathematical_unit_relative_1_not_cash_return_evidence',
  selectionBasis: 'structural_declaration_compatibility_only',
  actualEligibility: 'not_established',
  actualCalendarCompletion: 'unknown',
  actualAvailability: 'unknown',
  historicalDecisionAvailability: 'not_established',
  providerCompletion: 'unknown',
  providerRevisionCoherence: 'unknown',
  reviewerAdmission: 'not_established',
  handling: 'not_established',
  causalAvailability: 'unknown',
  uncertainty: 'latched',
  lineageAuthentication: 'not_established_by_serialized_data',
  fullOriginalReconstruction: 'unavailable_from_digests',
  digestMeaning: 'bindings_not_authenticity',
  rawPages: 'not_included',
  referenceExecution: 'not_performed',
  authentication: 'not_established',
  effectScope: 'NONE',
  dispatchAllowed: false,
  promotionAllowed: false,
  production: 'CLOSED',
  operations: 'DEFER',
} as const);

export const a64InspectionEvidenceHolds = Object.freeze({
  historyUpdates: 64,
  operationalDecisions: 0,
  consumptionAttempts: 0,
  persistence: 'not_performed',
  effectAuthority: 'none',
  dispatchAllowed: false,
  promotionAllowed: false,
  prospectiveReadiness: 'NOT_READY',
  caseReadiness: 'NOT_READY',
  qualification: 'NOT_READY',
  production: 'CLOSED',
  operations: 'DEFER',
  C07: 'UNKNOWN',
  C13: 'UNKNOWN',
  C14: 'UNKNOWN',
} as const);

export const a64InspectionEvidenceReasons = Object.freeze([
  'historical_source_profile_only',
  'prospective_profile_not_admitted',
  'availability_and_clock_not_authenticated',
  'provider_completion_and_revision_coherence_unknown',
  'actual_supplier_rights_and_handling_unknown',
  'private_completion_and_current_original_unknown',
  'serialized_checks_are_not_current_private_checks',
  'R_current_C_immutable_E_and_own_ack_unestablished',
  'runtime_reviewer_and_owner_admission_unknown',
  'economic_observation_and_finite_operation_policy_unknown',
  'no_durable_or_active_consumer_admission',
] as const);

const hash = z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/);
const proposedId = z.string().min(1).max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}(?![\s\S])/);
const timestamp = z.string().length(24).datetime({ precision: 3 }).refine(s => {
  try {
    return Number.isSafeInteger(Date.parse(s))
      && Date.parse(s) >= 0
      && new Date(s).toISOString() === s;
  } catch {
    return false;
  }
});

export const a64InspectionCaseSchema = z.object({
  id: z.literal('GELT-PAMR-A64-EVIDENCE-001'),
  revision: z.literal('proposal-2'),
}).strict();

export const a64InspectionSourceProfileSchema = z.object({
  inspectorRevision: z.literal('gelt.spy253-source-inspector.v1'),
  requestSchema: z.literal('gelt.spy253-pamr-inspection-request.v1'),
  artifactSchema: z.literal('gelt.spy253-pamr-inert-inspection.v1'),
  classification: z.literal('source_inspection_only'),
  sourceRequest: spy253InspectionSourceRequestSchema,
  mathematicalProfile: z.literal(pamrRecipe.profile),
  selection: z.literal(a64InspectionHistory.selection),
  initialization: z.literal(a64InspectionHistory.initialization),
}).strict();

export const a64InspectionEvidenceBindingsSchema = z.object({
  caseEpochSha256: hash,
  sourceProfileSha256: hash,
  historySha256: hash,
  sourceRequestSha256: hash,
  inspectionRequestSha256: hash,
  calendarSha256: hash,
  declarationsSha256: hash,
  originalSha256: hash,
  selectedPairsSha256: hash,
  recipeSha256: hash,
  artifactSha256: hash,
}).strict();

export const a64ProspectiveTimingProposalSchema = z.object({
  schema: z.literal('gelt.pamr-a64-prospective-timing-proposal.v1'),
  sourceReceivedAt: timestamp,
  sourceDecisionAt: timestamp,
  sourceReviewCompletedAt: timestamp,
  sourceDeclaredPrefixAvailableAt: timestamp.nullable(),
  proposedAssessmentAt: timestamp,
  proposedDecisionAt: timestamp,
  proposedEvaluationAt: timestamp,
  assertedCompleteInputAvailableAt: timestamp.nullable(),
}).strict().superRefine((v, ctx) => {
  // Only ordering of supplied declarations is checked. No wall clock is read.
  const bad = () => ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'invalid declared timing order',
  });
  if (v.sourceReceivedAt > v.sourceDecisionAt
    || v.sourceReceivedAt > v.sourceReviewCompletedAt
    || v.sourceDecisionAt > v.proposedAssessmentAt
    || v.sourceReviewCompletedAt > v.proposedAssessmentAt
    || v.proposedAssessmentAt > v.proposedDecisionAt
    || v.proposedDecisionAt > v.proposedEvaluationAt) bad();

  const sourceAvailability = v.sourceDeclaredPrefixAvailableAt;
  if (sourceAvailability !== null
    && (sourceAvailability < v.sourceReceivedAt
      || sourceAvailability > v.sourceDecisionAt)) bad();

  const asserted = v.assertedCompleteInputAvailableAt;
  if (asserted !== null
    && (asserted < v.sourceReceivedAt
      || asserted < v.sourceDecisionAt
      || asserted < v.sourceReviewCompletedAt
      || asserted > v.proposedAssessmentAt
      || asserted >= v.proposedDecisionAt)) bad();
});
export type A64ProspectiveTimingProposalV1 =
  z.infer<typeof a64ProspectiveTimingProposalSchema>;

export const a64InspectionEvidenceContextSchema = z.object({
  schema: z.literal('gelt.pamr-a64-inspection-evidence-context.v1'),
  version: z.literal(1),
  classification: z.literal('source_inspection_only'),
  purpose: z.literal('evidence_only_no_operational_admission'),
  case: a64InspectionCaseSchema,
  proposedEpochId: proposedId,
  sourceProfile: a64InspectionSourceProfileSchema,
  history: a64HistoryBindingSchema,
  bindings: a64InspectionEvidenceBindingsSchema,
  timing: a64ProspectiveTimingProposalSchema,
  facts: a64InspectionUnknownFactsSchema,
}).strict();
export type A64InspectionEvidenceContextV1 =
  z.infer<typeof a64InspectionEvidenceContextSchema>;

export const a64InspectionEvidenceInputSchema = z.object({
  schema: z.literal('gelt.pamr-a64-inspection-evidence-input.v1'),
  artifactText: z.string().max(a64InspectionEvidenceLimits.artifact),
  contextText: z.string().max(a64InspectionEvidenceLimits.context),
}).strict();
export type A64InspectionEvidenceInputV1 =
  z.infer<typeof a64InspectionEvidenceInputSchema>;

const inheritedChecksSchema = z.array(z.object({
  id: z.enum(checkIds),
  result: z.enum(['pass', 'unknown']),
  reason: z.enum(['none', 'evidence_missing']),
}).strict()).length(16).refine(checks => checks.every((check, i) => {
  const passing = i < 6 || i === 15;
  return check.id === checkIds[i]
    && check.result === (passing ? 'pass' : 'unknown')
    && check.reason === (passing ? 'none' : 'evidence_missing');
}));

const assessmentBodySchema = z.object({
  schema: z.literal('gelt.pamr-a64-inspection-evidence-assessment.v1'),
  version: z.literal(1),
  classification: z.literal('source_inspection_only'),
  dataStatus: z.literal('consistent_data_only'),
  inputSha256: hash,
  contextSha256: hash,
  timingSha256: hash,
  bindings: a64InspectionEvidenceBindingsSchema,
  history: a64HistoryBindingSchema,
  sourceDeclaredAvailability: z.enum(['unknown', 'declared_only_not_authenticated']),
  proposedAvailability: z.enum(['unknown', 'declared_only_not_authenticated']),
  facts: a64InspectionUnknownFactsSchema,
  inheritedChecks: inheritedChecksSchema,
  checkInterpretation: z.literal('serialized_structure_not_current_private_validation'),
  inheritedDisclosures: literals(a64InspectionInheritedDisclosures),
  unresolvedReasons: z.array(z.enum(a64InspectionEvidenceReasons))
    .length(a64InspectionEvidenceReasons.length)
    .refine(v => v.every((reason, i) => reason === a64InspectionEvidenceReasons[i])),
  ...literals(a64InspectionEvidenceHolds).shape,
}).strict();

export const a64InspectionEvidenceAssessmentSchema = assessmentBodySchema.extend({
  assessmentSha256: hash,
}).strict().superRefine((value, ctx) => {
  const { assessmentSha256, ...body } = value;
  const expected = digest(canonical({
    domain: 'gelt.pamr-a64-inspection-evidence.v1/assessment',
    value: body,
  }));
  if (assessmentSha256 !== expected) ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'invalid assessment data binding',
  });
});
export type A64InspectionEvidenceAssessmentV1 =
  z.infer<typeof a64InspectionEvidenceAssessmentSchema>;

export type A64InspectionEvidenceResult =
  | Readonly<{
      status: 'assessed_data';
      value: A64InspectionEvidenceAssessmentV1;
    }>
  | Readonly<{
      status: 'rejected';
      reason: A64InspectionEvidenceRejection;
    }>;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Limits apply to each supplied text, including whitespace and JSON escaping.
// This does not accept caller objects or coerce primitives.
export function boundedA64InspectionEvidenceText(
  text: unknown,
  kind: keyof typeof a64InspectionEvidenceLimits,
): string {
  if (typeof kind !== 'string'
    || !Object.hasOwn(a64InspectionEvidenceLimits, kind)
    || typeof text !== 'string') {
    throw new A64InspectionEvidenceBoundaryError('invalid_input');
  }
  const limit = a64InspectionEvidenceLimits[kind];
  if (text.length > limit) {
    throw new A64InspectionEvidenceBoundaryError('resource_limit');
  }

  // Reject lossy UTF-16-to-UTF-8 conversion before allocating a Buffer.
  for (let i = 0; i < text.length; i++) {
    const first = text.charCodeAt(i);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = text.charCodeAt(++i);
      if (!(second >= 0xdc00 && second <= 0xdfff)) {
        throw new A64InspectionEvidenceBoundaryError('invalid_input');
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      throw new A64InspectionEvidenceBoundaryError('invalid_input');
    }
  }
  if (Buffer.byteLength(text, 'utf8') > limit) {
    throw new A64InspectionEvidenceBoundaryError('resource_limit');
  }
  return text;
}

export function parseA64InspectionEvidenceText(
  text: unknown,
  kind: keyof typeof a64InspectionEvidenceLimits,
): unknown {
  try {
    const bounded = boundedA64InspectionEvidenceText(text, kind);
    // Existing duplicate-key, depth-16 and node-20,000 parser, unchanged.
    return parseResearchJSON(Buffer.from(bounded, 'utf8'));
  } catch (error) {
    if (error instanceof A64InspectionEvidenceBoundaryError) throw error;
    throw new A64InspectionEvidenceBoundaryError('invalid_input');
  }
}

function parseContract<T>(read: () => T): T {
  try {
    return freeze(read());
  } catch (error) {
    if (error instanceof A64InspectionEvidenceBoundaryError) throw error;
    throw new A64InspectionEvidenceBoundaryError('invalid_input');
  }
}

export function parseA64InspectionEvidenceInput(
  text: unknown,
): A64InspectionEvidenceInputV1 {
  return parseContract(() => {
    const value = a64InspectionEvidenceInputSchema.parse(
      parseA64InspectionEvidenceText(text, 'input'),
    );
    boundedA64InspectionEvidenceText(value.artifactText, 'artifact');
    boundedA64InspectionEvidenceText(value.contextText, 'context');
    return value;
  });
}

export function parseA64InspectionEvidenceContext(
  text: unknown,
): A64InspectionEvidenceContextV1 {
  return parseContract(() => a64InspectionEvidenceContextSchema.parse(
    parseA64InspectionEvidenceText(text, 'context'),
  ));
}

// Detached assessment parsing establishes bounded structure and its data hash,
// not artifact validation, authenticity, admission or current private validity.
export function parseA64InspectionEvidenceAssessment(
  text: unknown,
): A64InspectionEvidenceAssessmentV1 {
  return parseContract(() => a64InspectionEvidenceAssessmentSchema.parse(
    parseA64InspectionEvidenceText(text, 'assessment'),
  ));
}
