import { canonical, digest } from './ledger-canonical.js';
import { checkIds } from './alpaca-byte-review-contract.js';
import { a64InspectionUnknownFacts, A64InspectionEvidenceBoundaryError } from './pamr-a64-inspection-evidence-contract.js';
import { boundedDataTransportLimits, type DataCommandOutput, type DataTransportFailure } from './bounded-data-stdio.js';
import {
  parseProspectiveDeclarationInput, prospectiveDeclarationInputSchemaId,
  prospectiveDeclarationLimits, prospectiveDeclarationSha256, type ProspectiveDeclaration,
} from './prospective-declaration-contract.js';

const holds = Object.freeze({
  classification: 'unadmitted_prospective_declaration_only',
  meaning: 'supplied_declaration_consistency_not_actual_evidence_or_profile_admission',
  effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false,
  historyUpdates: 0, operationalDecisions: 0, consumptionAttempts: 0,
  persistence: 'not_performed', authentication: 'not_established',
  networkAccess: false, filesystemInput: false,
  profileAdmission: 'not_established', calendarCompatibility: 'unknown',
  qualification: 'NOT_READY', caseReadiness: 'NOT_READY',
  production: 'CLOSED', operations: 'DEFER', C07: 'UNKNOWN', C13: 'UNKNOWN', C14: 'UNKNOWN',
});
export const prospectiveDeclarationCommand = Object.freeze({
  schema: 'gelt.agent.a64-prospective-declaration-capability.v1',
  command: 'preflight_a64_prospective_declaration',
  inputSchema: prospectiveDeclarationInputSchemaId,
  inputBytes: prospectiveDeclarationLimits.input,
  declarationBytes: prospectiveDeclarationLimits.declaration,
  outputBytes: prospectiveDeclarationLimits.output,
  transport: boundedDataTransportLimits,
  predecessorScope: 'one_complete_initial_declaration_only_not_actual_history',
  sessionMeaning: 'proposed_date_labels_not_qualified_market_sessions',
  ...holds,
});
const common = Object.freeze({
  schema: 'gelt.agent.a64-prospective-declaration-response.v1',
  command: prospectiveDeclarationCommand.command, ...holds,
});
const actualChecks = Object.freeze(checkIds.map(id => Object.freeze({ id, result: 'unknown' })));

export const declarationContradictions = Object.freeze([
  'profile_not_declared_before_decision', 'window_not_increasing',
  'declared_session_utc_bounds_not_increasing', 'declared_last_session_not_before_decision',
  'completion_before_declared_last_session_completion', 'source_completion_before_declared_last_session_completion',
  'receipt_before_declared_last_session_completion',
  'availability_before_declared_last_session_completion',
  'session_outside_declared_window', 'duplicate_session_label', 'session_labels_not_ordered',
  'decision_after_evaluation', 'window_completion_not_before_decision',
  'receipt_before_window_completion', 'receipt_after_source_completion',
  'receipt_not_before_decision', 'completion_before_window_completion', 'completion_not_before_decision',
  'availability_before_window_completion', 'availability_before_receipt', 'availability_before_completion', 'availability_not_before_decision',
  'revision_observed_not_before_decision',
] as const);
type Contradiction = typeof declarationContradictions[number];
export const undeclaredEvidence = Object.freeze([
  'session_schedule_undeclared', 'window_utc_mapping_undeclared', 'window_completion_undeclared', 'source_receipt_undeclared',
  'source_completion_undeclared', 'complete_input_availability_undeclared',
  'collected_input_digest_undeclared', 'revision_observation_undeclared',
] as const);
type Missing = typeof undeclaredEvidence[number];

function inspect(value: ProspectiveDeclaration) {
  const found = new Set<Contradiction>(), missing = new Set<Missing>();
  const mark = (condition: boolean, reason: Contradiction) => { if (condition) found.add(reason); };
  const t = value.timing, schedule = value.window.schedule;
  mark(value.profileDeclaredAt >= t.proposedDecisionAt, 'profile_not_declared_before_decision');
  mark(value.window.startSessionDate >= value.window.endSessionDateExclusive, 'window_not_increasing');
  const mapping = value.window.utcBoundaryMapping;
  if (mapping.knowledge === 'unknown') missing.add('window_utc_mapping_undeclared');
  else {
    mark(mapping.firstSessionStartsAt >= mapping.lastSessionCompletesAt, 'declared_session_utc_bounds_not_increasing');
    mark(mapping.lastSessionCompletesAt >= t.proposedDecisionAt, 'declared_last_session_not_before_decision');
    mark(t.declaredWindowCompletedAt !== null && t.declaredWindowCompletedAt < mapping.lastSessionCompletesAt,
      'completion_before_declared_last_session_completion');
    mark(t.sourceCompletedAt !== null && t.sourceCompletedAt < mapping.lastSessionCompletesAt,
      'source_completion_before_declared_last_session_completion');
    mark(t.sourceReceivedAt !== null && t.sourceReceivedAt < mapping.lastSessionCompletesAt, 'receipt_before_declared_last_session_completion');
    mark(t.assertedCompleteInputAvailableAt !== null && t.assertedCompleteInputAvailableAt < mapping.lastSessionCompletesAt,
      'availability_before_declared_last_session_completion');
  }
  if (schedule.knowledge === 'unknown') missing.add('session_schedule_undeclared');
  else {
    const seen = new Set<string>();
    schedule.sessions.forEach((day, i) => {
      mark(day < value.window.startSessionDate || day >= value.window.endSessionDateExclusive, 'session_outside_declared_window');
      mark(seen.has(day), 'duplicate_session_label');
      mark(i > 0 && day <= schedule.sessions[i - 1], 'session_labels_not_ordered');
      seen.add(day);
    });
  }
  mark(t.proposedDecisionAt > t.proposedEvaluationAt, 'decision_after_evaluation');
  if (t.declaredWindowCompletedAt === null) missing.add('window_completion_undeclared');
  else mark(t.declaredWindowCompletedAt >= t.proposedDecisionAt, 'window_completion_not_before_decision');
  if (t.sourceReceivedAt === null) missing.add('source_receipt_undeclared');
  else {
    mark(t.sourceReceivedAt >= t.proposedDecisionAt, 'receipt_not_before_decision');
    mark(t.declaredWindowCompletedAt !== null && t.sourceReceivedAt < t.declaredWindowCompletedAt, 'receipt_before_window_completion');
    mark(t.sourceCompletedAt !== null && t.sourceReceivedAt > t.sourceCompletedAt, 'receipt_after_source_completion');
  }
  if (t.sourceCompletedAt === null) missing.add('source_completion_undeclared');
  else {
    mark(t.sourceCompletedAt >= t.proposedDecisionAt, 'completion_not_before_decision');
    mark(t.declaredWindowCompletedAt !== null && t.sourceCompletedAt < t.declaredWindowCompletedAt, 'completion_before_window_completion');
  }
  if (t.assertedCompleteInputAvailableAt === null) missing.add('complete_input_availability_undeclared');
  else {
    mark(t.assertedCompleteInputAvailableAt >= t.proposedDecisionAt, 'availability_not_before_decision');
    mark(t.declaredWindowCompletedAt !== null && t.assertedCompleteInputAvailableAt < t.declaredWindowCompletedAt,
      'availability_before_window_completion');
    mark(t.sourceReceivedAt !== null && t.assertedCompleteInputAvailableAt < t.sourceReceivedAt, 'availability_before_receipt');
    mark(t.sourceCompletedAt !== null && t.assertedCompleteInputAvailableAt < t.sourceCompletedAt, 'availability_before_completion');
  }
  if (value.collectedInputSha256 === null) missing.add('collected_input_digest_undeclared');
  if (value.revision.kind === 'revised_declaration') {
    if (value.revision.changeObservedAt === null) missing.add('revision_observation_undeclared');
    else mark(value.revision.changeObservedAt >= t.proposedDecisionAt, 'revision_observed_not_before_decision');
  }
  // All applicable adverse declarations are retained, including the predecessor.
  return { contradictions: declarationContradictions.filter(reason => found.has(reason)),
    undeclared: undeclaredEvidence.filter(reason => missing.has(reason)) };
}

type Rejection = DataTransportFailure | 'invalid_input';
export function rejectProspectiveDeclarationCommand(reason: Rejection): DataCommandOutput {
  return Object.freeze({ exitCode: reason === 'usage_error' ? 64 : 2,
    text: canonical({ ...common, status: 'rejected_input', reason,
      actualFacts: a64InspectionUnknownFacts, actualChecks }) + '\n' });
}

export function executeProspectiveDeclarationCommand(raw: unknown): DataCommandOutput {
  try {
    const { current, predecessor } = parseProspectiveDeclarationInput(raw);
    const currentSha256 = prospectiveDeclarationSha256(current);
    const predecessorSha256 = predecessor === null ? null : prospectiveDeclarationSha256(predecessor);
    const currentData = inspect(current), previousData = predecessor === null ? null : inspect(predecessor);
    const bindingContradictions: string[] = [];
    if (current.revision.kind === 'initial_declaration') {
      if (predecessor !== null) bindingContradictions.push('unexpected_predecessor');
    } else if (predecessor === null) bindingContradictions.push('missing_complete_predecessor');
    else {
      // This two-context interface does not accept an opaque earlier chain.
      // "Initial" is a declaration label, never proof of absent actual history.
      if (predecessor.revision.kind !== 'initial_declaration') bindingContradictions.push('unsupported_predecessor_revision_history');
      if (current.revision.predecessorSha256 !== predecessorSha256) bindingContradictions.push('predecessor_data_mismatch');
      if (current.proposedEpochId !== predecessor.proposedEpochId) bindingContradictions.push('revision_crosses_proposed_epoch');
      if (current.profileRevision === predecessor.profileRevision) bindingContradictions.push('profile_revision_reused');
      if (current.profileDeclaredAt < predecessor.profileDeclaredAt) bindingContradictions.push('revision_declaration_moves_backwards');
      if (current.window.startSessionDate !== predecessor.window.startSessionDate
        || current.window.endSessionDateExclusive !== predecessor.window.endSessionDateExclusive
        || canonical(current.window.utcBoundaryMapping) !== canonical(predecessor.window.utcBoundaryMapping)
        || current.timing.proposedDecisionAt !== predecessor.timing.proposedDecisionAt) {
        bindingContradictions.push('revision_changes_frozen_window_or_decision');
      }
    }
    const rejected = currentData.contradictions.length > 0 || (previousData?.contradictions.length ?? 0) > 0
      || bindingContradictions.length > 0;
    const body = { ...common, status: rejected ? 'rejected_declarations' : 'preflight_data',
      currentSha256, predecessorSha256, current: currentData, predecessor: previousData,
      bindingContradictions, predecessorScope: 'immediate_supplied_initial_declaration_only_actual_history_unverified',
      actualFacts: a64InspectionUnknownFacts, actualChecks };
    const preflightSha256 = digest(canonical({ domain: 'gelt.agent.a64-prospective-declaration.v1/preflight', value: body }));
    const text = canonical({ ...body, preflightSha256 }) + '\n';
    if (Buffer.byteLength(text, 'utf8') > prospectiveDeclarationLimits.output) return rejectProspectiveDeclarationCommand('resource_limit');
    return Object.freeze({ exitCode: rejected ? 2 : 0, text });
  } catch (error) {
    return rejectProspectiveDeclarationCommand(error instanceof A64InspectionEvidenceBoundaryError
      && error.reason === 'resource_limit' ? 'resource_limit' : 'invalid_input');
  }
}
