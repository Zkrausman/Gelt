import { canonical, digest } from './ledger-canonical.js';
import {
  verifySpy253PAMRInspectionData,
  type Spy253PAMRInspectionArtifact,
} from './pamr-reference-artifact.js';
import {
  A64InspectionEvidenceBoundaryError,
  a64InspectionEvidenceAssessmentSchema,
  a64InspectionEvidenceHolds,
  a64InspectionEvidenceReasons,
  a64InspectionHistory,
  a64InspectionInheritedDisclosures,
  a64InspectionUnknownFacts,
  boundedA64InspectionEvidenceText,
  parseA64InspectionEvidenceAssessment,
  parseA64InspectionEvidenceContext,
  parseA64InspectionEvidenceInput,
  type A64InspectionEvidenceContextV1,
  type A64InspectionEvidenceResult,
} from './pamr-a64-inspection-evidence-contract.js';

const hash = (domain: string, value: unknown): string => digest(canonical({
  domain: 'gelt.pamr-a64-inspection-evidence.v1/' + domain,
  value,
}));

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function mismatch(): never {
  throw new A64InspectionEvidenceBoundaryError('binding_mismatch');
}

function expectedProfile(artifact: Spy253PAMRInspectionArtifact) {
  const request = artifact.request;
  return {
    inspectorRevision: request.lineage.review.reviewerRevision,
    requestSchema: request.schema,
    artifactSchema: artifact.schema,
    classification: artifact.classification,
    sourceRequest: request.lineage.request,
    mathematicalProfile: artifact.recipe.profile,
    selection: request.selection,
    initialization: request.initialization,
  };
}

// These hashes bind the supplied verified DATA, including complete selected
// observations/pairs and the entire artifact. Calendar/original digests remain
// references: neither their preimages nor actual issuance can be recovered.
function expectedBindings(
  artifact: Spy253PAMRInspectionArtifact,
  context: A64InspectionEvidenceContextV1,
) {
  const request = artifact.request;
  const lineage = request.lineage;
  return {
    caseEpochSha256: hash('case-epoch', {
      schema: context.schema,
      case: context.case,
      proposedEpochId: context.proposedEpochId,
      purpose: context.purpose,
    }),
    sourceProfileSha256: hash('source-profile', expectedProfile(artifact)),
    historySha256: hash('history', {
      history: a64InspectionHistory,
      selected: request.selected,
      pairs: artifact.pairs,
    }),
    sourceRequestSha256: hash('source-request', lineage.request),
    inspectionRequestSha256: hash('inspection-request', request),
    calendarSha256: hash('calendar-reference', {
      sourceCalendarSha256: lineage.calendarSha256,
    }),
    declarationsSha256: hash('declarations', {
      declarationsSha256: lineage.declarationsSha256,
      availabilitySha256: lineage.availabilitySha256,
      providerRevisionsSha256: lineage.providerRevisionsSha256,
      declaredPrefixAvailableAt: lineage.declaredPrefixAvailableAt,
      selected: request.selected.map(selected => ({
        sourceIndex: selected.sourceIndex,
        sessionOrdinal: selected.sessionOrdinal,
        providerTimestamp: selected.providerTimestamp,
        declaredAvailableAt: selected.declaredAvailableAt,
      })),
    }),
    originalSha256: hash('original-lineage-data', lineage),
    selectedPairsSha256: hash('selected-pairs', {
      selected: request.selected,
      pairs: artifact.pairs,
    }),
    recipeSha256: hash('recipe-adaptation', {
      recipe: artifact.recipe,
      assets: request.assets,
      selection: request.selection,
      initialization: artifact.initialization,
      reserveConvention: artifact.reserveConvention,
      fidelity: artifact.fidelity,
    }),
    artifactSha256: hash('artifact', artifact),
  };
}

function compute(text: unknown): A64InspectionEvidenceResult {
  const input = parseA64InspectionEvidenceInput(text);
  const context = parseA64InspectionEvidenceContext(input.contextText);

  // No caller verifier, supplied pass vector or matching summary can substitute.
  const verified = verifySpy253PAMRInspectionData(input.artifactText);
  if (verified.status !== 'verified_data') {
    throw new A64InspectionEvidenceBoundaryError('artifact_mismatch');
  }
  const artifact = verified.artifact;
  const lineage = artifact.request.lineage;
  const timing = context.timing;
  const bindings = expectedBindings(artifact, context);

  if (canonical(context.sourceProfile) !== canonical(expectedProfile(artifact))
    || canonical(context.history) !== canonical(a64InspectionHistory)
    || canonical(context.bindings) !== canonical(bindings)
    || timing.sourceReceivedAt !== lineage.receivedAt
    || timing.sourceDecisionAt !== lineage.decisionAt
    || timing.sourceReviewCompletedAt !== lineage.review.completedAt
    || timing.sourceDeclaredPrefixAvailableAt !== lineage.declaredPrefixAvailableAt) {
    mismatch();
  }

  // The complete replay already requires this exact inherited disclosure set.
  // Keep an explicit comparison here so an accidental future relaxation fails.
  for (const [key, expected] of Object.entries(a64InspectionInheritedDisclosures)) {
    if (artifact[key as keyof typeof artifact] !== expected) mismatch();
  }

  const body = {
    schema: 'gelt.pamr-a64-inspection-evidence-assessment.v1' as const,
    version: 1 as const,
    classification: 'source_inspection_only' as const,
    dataStatus: 'consistent_data_only' as const,
    inputSha256: hash('input', input),
    contextSha256: hash('context', context),
    timingSha256: hash('timing-proposal', timing),
    bindings,
    history: a64InspectionHistory,
    sourceDeclaredAvailability: lineage.declaredPrefixAvailableAt === null
      ? 'unknown' as const : 'declared_only_not_authenticated' as const,
    proposedAvailability: timing.assertedCompleteInputAvailableAt === null
      ? 'unknown' as const : 'declared_only_not_authenticated' as const,
    facts: a64InspectionUnknownFacts,
    inheritedChecks: lineage.review.checks.map(check => ({
      id: check.id,
      result: check.result,
      reason: check.reason,
    })),
    checkInterpretation: 'serialized_structure_not_current_private_validation' as const,
    inheritedDisclosures: a64InspectionInheritedDisclosures,
    unresolvedReasons: [...a64InspectionEvidenceReasons],
    ...a64InspectionEvidenceHolds,
  };
  const value = a64InspectionEvidenceAssessmentSchema.parse({
    ...body,
    assessmentSha256: hash('assessment', body),
  });
  boundedA64InspectionEvidenceText(canonical(value), 'assessment');
  return freeze({ status: 'assessed_data' as const, value });
}

// One text-only aggregate input. No original, owner, clock, reservation, store,
// provider, lifecycle, private-completion object or effect is accepted/created.
export function assessA64InspectionEvidence(
  text: unknown,
): A64InspectionEvidenceResult {
  try {
    return compute(text);
  } catch (error) {
    return Object.freeze({
      status: 'rejected',
      reason: error instanceof A64InspectionEvidenceBoundaryError
        ? error.reason : 'invalid_input',
    });
  }
}

// Whole-input recomputation, not detached hash agreement or authority recovery.
export function matchesA64InspectionEvidenceAssessment(
  inputText: unknown,
  assessmentText: unknown,
): boolean {
  try {
    const actual = parseA64InspectionEvidenceAssessment(assessmentText);
    const expected = assessA64InspectionEvidence(inputText);
    return expected.status === 'assessed_data'
      && canonical(actual) === canonical(expected.value);
  } catch {
    return false;
  }
}
