import {
  checkIds,
  encodeSettlementComparison,
  encodeStatusComparison,
  outcomePrecedence,
  parseSettlementStructure,
  parseStatusStructure,
  parseSummaryAckStructure,
  parseVerdictStructure,
  type ReviewPhase,
  type ReviewSettlementV2,
  type ReviewState,
  type ReviewStatusV2,
  type ReviewVerdictV1,
  type SettlementOutcome,
} from './alpaca-byte-review-contract.js';
import {
  constructedByteReviewProfile,
  createConstructedByteReviewLane,
} from './alpaca-byte-review-checker.js';
import { isConnectorIssuedAlpacaAcquisition } from './alpaca-iex-connector.js';

/**
 * Conditional lifecycle machinery; no operational admission profile.
 *
 * The production API stops before capture/reviewer dispatch.
 * The constructed adapter privately invokes only the fixed fixture checker.
 * The simulation API models evidence; its favorable evidence is NOT an
 * authenticated checker completion, runtime qualification or handling grant.
 *
 * No callback, clock, registry, authority, recipient or reviewer is supplied by
 * a caller. No serialized record establishes private linkage.
 *
 * Trusted construction excludes hostile proxies/interposition. Imported
 * structural parsers reject ordinary accessors, not every possible Proxy.
 */

const unavailable = (): never => {
  throw new Error('Byte-review coordination unavailable');
};

function requireCondition(condition: unknown): asserts condition {
  if (!condition) unavailable();
}

export const coordinatorReceiptLimits = Object.freeze({
  ordinary: 64,
  protected: 40,
  recipientCompletions: 2,
} as const);

type Scope = 'SIMULATED_ONLY' | 'CONSTRUCTED_ONLY' | 'PRODUCTION_CLOSED';
type FailureOutcome = Exclude<
  SettlementOutcome,
  'not_attempted' | 'pending' | 'consistent_unverified'
>;

export const simulatedEvidenceKinds = Object.freeze([
  'preflight_unavailable',
  'verdict_all_pass',
  'verdict_incomplete',
  'verdict_rejected',
  'verdict_rejected_unknown',
  'reviewer_error',
  'execution_pending',
  'execution_unknown',
  'execution_settled',
  'release_complete',
  'release_failed',
  'duplicate_completion',
  'authenticity_failed',
  'verdict_invalid',
  'provenance_mismatch',
  'timed_out',
  'cancelled',
  'crashed',
  'order_unavailable',
  'horizon_unavailable',
  'execution_contradiction',
  'release_contradiction',
  'summary_failed',
  'late_completion',
] as const);

export type SimulatedEvidenceKind = typeof simulatedEvidenceKinds[number];

type Kind =
  | Exclude<
      SimulatedEvidenceKind,
      'verdict_all_pass' | 'verdict_incomplete'
      | 'verdict_rejected' | 'verdict_rejected_unknown'
    >
  | 'initialized'
  | 'capture_reserved'
  | 'capture_pending'
  | 'binding_pending'
  | 'candidate_pending'
  | 'invocation_reserved'
  | 'review_dispatched'
  | 'verdict'
  | 'summary_reserved'
  | 'summary_committed'
  | 'acknowledged'
  | 'ack_invalid'
  | 'ack_contradiction'
  | 'overflow'
  | 'local_checker_references_dropped';

export type EvidenceReceipt = Readonly<{
  scope: Scope;
  sequence: number;
  kind: Kind;
  origin: ReviewPhase;
  target: number | null;
  knownQueued: boolean;
  verdict: ReviewVerdictV1 | null;
}>;

export type ImmutableReviewEmission = Readonly<{
  status: ReviewStatusV2;
  bytes: string;
  source: ReviewSettlementV2;
}>;

export type CoordinatorSnapshot = Readonly<{
  scope: Scope;
  current: ReviewSettlementV2;
  emitted: ImmutableReviewEmission | null;
  receipts: readonly EvidenceReceipt[];
  historicalVerdicts: readonly ReviewVerdictV1[];
  captureReservations: number;
  invocationReservations: number;
  emissionReservations: number;
  handoffAttempts: number;
  capacityUnavailable: boolean;
  favorableCurrent: boolean;
}>;

type Failure = Readonly<{
  outcome: FailureOutcome;
  origin: ReviewPhase;
  sequence: number;
  executionProof: number | null;
}>;

type Facts = {
  workPhase: ReviewPhase;
  captureReserved: boolean;
  dispatched: boolean;
  invocationReserved: boolean;
  reviewDispatched: boolean;
  invocationId: string | null;
  review: ReviewState;
  verdict: ReviewVerdictV1 | null;
  completionBlocked: boolean;
  execution: ReviewSettlementV2['execution'];
  everSettled: boolean;
  executionProof: number | null;
  releaseProof: number | null;
  pendingConflict: boolean;
  releaseValid: boolean;
  releaseAssessmentExecutionProof: number | null;
  releaseProofExecutionProof: number | null;
  summaryReserved: boolean;
  committed: boolean;
  uncertainty: boolean;
  horizon: boolean;
  order: boolean;
  acknowledgements: Set<number>;
  contradictedAcknowledgements: Set<number>;
  failures: Failure[];
};

function initialFacts(): Facts {
  return {
    workPhase: 'preflight',
    captureReserved: false,
    dispatched: false,
    invocationReserved: false,
    reviewDispatched: false,
    invocationId: null,
    review: 'not_attempted',
    verdict: null,
    completionBlocked: false,
    execution: 'not_started',
    everSettled: false,
    executionProof: null,
    releaseProof: null,
    pendingConflict: false,
    releaseValid: false,
    releaseAssessmentExecutionProof: null,
    releaseProofExecutionProof: null,
    summaryReserved: false,
    committed: false,
    uncertainty: false,
    horizon: true,
    order: true,
    acknowledgements: new Set(),
    contradictedAcknowledgements: new Set(),
    failures: [],
  };
}

function currentReleaseAssessment(facts: Facts): boolean {
  return facts.execution === 'settled' && facts.executionProof !== null
    && facts.releaseAssessmentExecutionProof === facts.executionProof;
}

function currentReleaseValid(facts: Facts): boolean {
  return currentReleaseAssessment(facts) && facts.releaseValid
    && facts.releaseProofExecutionProof === facts.executionProof;
}

function selectedFailure(facts: Facts): Failure | undefined {
  return facts.failures.reduce<Failure | undefined>((best, item) => {
    // Historical failed accounting is applicable only to its execution
    // generation while current accounting supports X1/D0. History is retained.
    if (item.outcome === 'disposal_not_established'
      && (!currentReleaseAssessment(facts) || currentReleaseValid(facts)
        || item.executionProof !== facts.executionProof)) return best;
    if (!best) return item;
    const left = outcomePrecedence.indexOf(item.outcome);
    const right = outcomePrecedence.indexOf(best.outcome);
    return left < right || (left === right && item.sequence < best.sequence)
      ? item : best;
  }, undefined);
}

function failure(
  facts: Facts,
  receipt: EvidenceReceipt,
  value: FailureOutcome,
  invalidateReview: boolean,
  latch = true,
  forceUnknown = false,
): void {
  facts.failures.push({
    outcome: value,
    origin: receipt.origin,
    sequence: receipt.sequence,
    executionProof: value === 'disposal_not_established'
      ? facts.executionProof : null,
  });
  facts.uncertainty ||= latch;
  if (invalidateReview) {
    facts.completionBlocked = true;
    if (facts.invocationReserved
      && (forceUnknown || facts.verdict !== null || facts.review === 'incomplete')) {
      facts.review = 'unknown';
    }
  }
}

function projectReceipts(
  receipts: readonly EvidenceReceipt[],
  invocationId: string,
): Facts {
  const facts = initialFacts();
  for (const receipt of receipts) {
    switch (receipt.kind) {
      case 'initialized':
      case 'local_checker_references_dropped':
        break;
      case 'capture_reserved':
        facts.captureReserved = true;
        break;
      case 'capture_pending':
        facts.dispatched = true;
        facts.workPhase = 'acquisition';
        facts.execution = 'pending';
        break;
      case 'binding_pending':
        facts.workPhase = 'binding';
        facts.execution = 'pending';
        break;
      case 'candidate_pending':
        facts.workPhase = 'candidate';
        facts.execution = 'pending';
        break;
      case 'invocation_reserved':
        facts.invocationReserved = true;
        facts.invocationId = invocationId;
        facts.workPhase = 'review';
        facts.review = facts.execution === 'pending' ? 'pending' : 'unknown';
        if (facts.review === 'unknown') facts.uncertainty = true;
        break;
      case 'review_dispatched':
        facts.reviewDispatched = true;
        break;
      case 'verdict': {
        const verdict = receipt.verdict!;
        facts.verdict = verdict;
        facts.workPhase = 'verdict';
        facts.review = verdict.outcome;
        if (verdict.checks.some(check => check.result === 'unknown')) {
          facts.uncertainty = true;
        }
        if (verdict.outcome !== 'consistent_unverified') {
          failure(
            facts, receipt, verdict.outcome, false,
            verdict.outcome === 'incomplete'
              || verdict.checks.some(check => check.result === 'unknown'),
          );
        }
        break;
      }
      case 'preflight_unavailable':
        failure(facts, receipt, 'unavailable', false);
        break;
      case 'reviewer_error':
        facts.workPhase = 'review';
        facts.review = 'incomplete';
        facts.completionBlocked = true;
        failure(facts, receipt, 'incomplete', false);
        break;
      case 'execution_pending':
        if (facts.everSettled || facts.summaryReserved) {
          // S0/S1 cannot become active-work rows. This observation is retained
          // as conflicting evidence, not an authorization to restart anything.
          facts.execution = 'unknown';
          facts.pendingConflict = true;
          facts.releaseValid = false;
          facts.releaseAssessmentExecutionProof = null;
          failure(facts, receipt, 'unknown', true, true, true);
        } else {
          facts.execution = 'pending';
        }
        break;
      case 'execution_unknown':
        facts.execution = 'unknown';
        facts.releaseValid = false;
        facts.releaseAssessmentExecutionProof = null;
        facts.uncertainty = true;
        if (facts.review === 'pending') facts.review = 'unknown';
        // A specific supported negative/incomplete closure need not be
        // relabelled merely because its execution dimension is unresolved.
        if (!selectedFailure(facts)) {
          failure(facts, receipt, 'unknown', true, true, true);
        }
        break;
      case 'execution_settled':
        if (facts.execution !== 'settled') {
          facts.executionProof = receipt.sequence;
          facts.releaseValid = false;
          facts.releaseAssessmentExecutionProof = null;
        }
        facts.execution = 'settled';
        facts.everSettled = true;
        facts.pendingConflict = false;
        facts.workPhase = 'release';
        if (facts.review === 'pending') {
          facts.review = 'unknown';
          failure(facts, receipt, 'unknown', true, true, true);
        }
        break;
      case 'release_complete':
        facts.releaseAssessmentExecutionProof = facts.executionProof;
        facts.releaseProofExecutionProof = facts.executionProof;
        facts.releaseValid = true;
        facts.releaseProof = receipt.sequence;
        break;
      case 'release_failed':
        facts.releaseAssessmentExecutionProof = facts.executionProof;
        facts.releaseValid = false;
        failure(facts, receipt, 'disposal_not_established', false);
        break;
      case 'release_contradiction': {
        const applicable = facts.execution === 'settled'
          && facts.executionProof !== null
          && facts.releaseProofExecutionProof === facts.executionProof;
        if (applicable) {
          facts.releaseAssessmentExecutionProof = facts.executionProof;
          facts.releaseValid = false;
        }
        failure(
          facts, receipt,
          applicable ? 'disposal_not_established' : 'unknown',
          !applicable, true, !applicable,
        );
        break;
      }
      case 'execution_contradiction':
        facts.execution = 'unknown';
        facts.releaseValid = false;
        facts.releaseAssessmentExecutionProof = null;
        failure(facts, receipt, 'unknown', true, true, true);
        break;
      case 'duplicate_completion':
      case 'verdict_invalid':
        facts.workPhase = facts.execution === 'settled' ? 'release' : 'verdict';
        failure(facts, receipt, 'verdict_acceptance_failed', true, true, true);
        break;
      case 'authenticity_failed':
        facts.workPhase = facts.execution === 'settled' ? 'release' : 'verdict';
        failure(facts, receipt, 'verdict_authenticity_failed', true, true, true);
        break;
      case 'provenance_mismatch':
        failure(facts, receipt, 'provenance_mismatch', true, true, true);
        break;
      case 'timed_out':
        failure(facts, receipt, 'timed_out', true);
        break;
      case 'cancelled':
        failure(facts, receipt, 'cancelled', true);
        break;
      case 'crashed':
        failure(facts, receipt, 'crashed', true);
        break;
      case 'order_unavailable':
        facts.order = false;
        failure(facts, receipt, 'unknown', true, true, true);
        break;
      case 'horizon_unavailable':
        facts.horizon = false;
        failure(facts, receipt, 'unknown', true, true, true);
        break;
      case 'overflow':
        facts.horizon = false;
        facts.order = false;
        failure(facts, receipt, 'unknown', true, true, true);
        break;
      case 'late_completion':
        facts.completionBlocked = true;
        facts.uncertainty = true;
        if (facts.invocationReserved) facts.review = 'unknown';
        // Always retain this uncertainty contribution. A prior incomplete or
        // rejected result cannot force an invalid I/R tuple after invalidation.
        failure(facts, receipt, 'unknown', true, true, true);
        break;
      case 'summary_reserved':
        facts.summaryReserved = true;
        break;
      case 'summary_committed':
        facts.committed = true;
        break;
      case 'acknowledged':
        facts.acknowledgements.add(receipt.sequence);
        break;
      case 'ack_contradiction':
        facts.contradictedAcknowledgements.add(receipt.target!);
        failure(facts, receipt, 'summary_failed', false);
        break;
      case 'ack_invalid':
      case 'summary_failed':
        failure(facts, receipt, 'summary_failed', false);
        break;
    }
  }
  return facts;
}

function settlementFromFacts(attemptId: string, facts: Facts): ReviewSettlementV2 {
  const selected = selectedFailure(facts);
  let phase: ReviewPhase = facts.summaryReserved ? 'summary'
    : facts.execution === 'settled' ? 'release'
    : selected?.origin ?? facts.workPhase;

  // Release is an execution-settled lifecycle position. Retain the original
  // receipt origin privately while projecting a later unresolved closure into
  // B2, rather than manufacturing a release tuple with unknown execution.
  if (!facts.summaryReserved && facts.execution !== 'settled' && phase === 'release') {
    phase = facts.invocationReserved ? 'verdict' : 'acquisition';
  }

  let review = facts.invocationReserved ? facts.review : 'not_attempted';
  let outcome: SettlementOutcome = selected?.outcome
    ?? (facts.verdict?.outcome === 'consistent_unverified'
      ? 'consistent_unverified'
      : facts.dispatched ? 'pending' : 'not_attempted');

  if (review === 'pending' && (facts.execution !== 'pending' || phase !== 'review')) {
    review = 'unknown';
  }
  if ([
    'unknown', 'provenance_mismatch',
    'verdict_authenticity_failed', 'verdict_acceptance_failed',
  ].includes(outcome)) {
    review = facts.invocationReserved ? 'unknown' : 'not_attempted';
  }
  if (outcome === 'consistent_unverified'
    && (facts.uncertainty || !facts.horizon || !facts.order || facts.completionBlocked)) {
    outcome = 'unknown';
    review = facts.invocationReserved ? 'unknown' : 'not_attempted';
  }
  const acknowledged = [...facts.acknowledgements]
    .some(sequence => !facts.contradictedAcknowledgements.has(sequence));
  return parseSettlementStructure({
    schema: 'gelt.byte-review-settlement.v2',
    attemptId,
    invocationId: facts.invocationId,
    phase,
    outcome,
    review,
    execution: facts.execution,
    disposal: currentReleaseValid(facts)
      ? 'references_released' : 'not_established',
    summaryDelivery: facts.summaryReserved
      ? acknowledged ? 'acknowledged' : 'not_established'
      : 'not_attempted',
    uncertainty: facts.uncertainty || review === 'unknown' || review === 'incomplete'
      || facts.execution === 'unknown' || outcome === 'unknown' ? 'latched' : 'none',
  });
}

function reportable(facts: Facts): boolean {
  if (facts.execution === 'pending' || facts.review === 'pending'
    || facts.pendingConflict) return false;
  const selected = selectedFailure(facts);
  if (facts.execution === 'not_started') {
    return !facts.dispatched && !facts.invocationReserved
      && selected?.origin === 'preflight';
  }
  if (facts.execution === 'unknown') return selected !== undefined;
  return currentReleaseAssessment(facts);
}

const protectedKinds = new Set<Kind>([
  'capture_reserved', 'invocation_reserved',
  'summary_reserved', 'summary_committed',
  'acknowledged', 'ack_contradiction', 'ack_invalid',
  'preflight_unavailable', 'duplicate_completion', 'authenticity_failed',
  'verdict_invalid', 'provenance_mismatch', 'timed_out', 'cancelled', 'crashed',
  'order_unavailable', 'horizon_unavailable', 'execution_contradiction',
  'release_contradiction', 'release_failed', 'summary_failed', 'late_completion',
  'execution_pending', 'execution_unknown', 'reviewer_error',
  'overflow',
]);

type Core = ReturnType<typeof createCore>;

function createCore(scope: Scope, attemptId: string, invocationId: string) {
  const receipts: EvidenceReceipt[] = [];
  const protectedKeys = new Set<string>();
  const acknowledgementHandles = new WeakMap<object, number>();
  const recipientTickets = new WeakMap<object, {
    emission: ImmutableReviewEmission;
    acknowledgement: ReturnType<typeof parseSummaryAckStructure>;
    ordinal: number;
    used: boolean;
  }>();
  let ordinaryCount = 0;
  let protectedCount = 0;
  let capacityUnavailable = false;
  let emitted: ImmutableReviewEmission | null = null;
  let recipientInbox: ImmutableReviewEmission | null = null;
  let recipientCompletions = 0;
  let commitAttempted = false;
  let handoffAttempts = 0;
  let locked = false;
  let reentrantProbe: SimulatedEvidenceKind | null = null;
  let uncertainHandoff = false;

  const facts = (): Facts => projectReceipts(receipts, invocationId);
  const current = (): ReviewSettlementV2 => settlementFromFacts(attemptId, facts());

  function origin(kind: Kind, f: Facts): ReviewPhase {
    if (kind === 'preflight_unavailable') return 'preflight';
    if (kind === 'verdict' || kind === 'duplicate_completion'
      || kind === 'authenticity_failed' || kind === 'verdict_invalid') return 'verdict';
    if (kind === 'reviewer_error') return 'review';
    if (kind === 'provenance_mismatch') {
      return f.invocationReserved
        ? f.reviewDispatched || f.verdict !== null ? 'verdict' : 'review'
        : 'binding';
    }
    if (kind === 'release_failed' || kind === 'release_contradiction') return 'release';
    if (kind === 'summary_reserved' || kind === 'summary_committed'
      || kind === 'summary_failed' || kind === 'ack_invalid'
      || kind === 'acknowledged' || kind === 'ack_contradiction') return 'summary';
    const workOrigin: ReviewPhase = f.workPhase === 'release'
      ? f.invocationReserved ? f.verdict ? 'verdict' : 'review' : 'acquisition'
      : f.workPhase;
    if (kind === 'timed_out' || kind === 'cancelled') {
      if (f.invocationReserved) return f.verdict ? 'verdict' : 'review';
      return f.dispatched ? workOrigin : 'preflight';
    }
    return f.summaryReserved ? 'summary' : workOrigin;
  }

  function permitted(kind: Kind, f: Facts, target: number | null): boolean {
    switch (kind) {
      case 'initialized': return receipts.length === 0;
      case 'preflight_unavailable': return !f.dispatched && !f.invocationReserved;
      case 'capture_reserved': return !f.captureReserved && !f.dispatched && !selectedFailure(f);
      case 'capture_pending': return f.captureReserved && !f.dispatched && !selectedFailure(f);
      case 'binding_pending':
      case 'candidate_pending':
        return f.dispatched && !f.invocationReserved
          && f.execution === 'pending' && !selectedFailure(f);
      case 'invocation_reserved':
        return f.dispatched && !f.invocationReserved
          && f.workPhase === 'candidate' && !selectedFailure(f);
      case 'review_dispatched':
        return f.invocationReserved && !f.reviewDispatched && !f.completionBlocked;
      case 'verdict':
        return f.invocationReserved && f.reviewDispatched && !f.verdict
          && !f.completionBlocked && f.order && f.horizon;
      case 'reviewer_error': return f.invocationReserved && f.reviewDispatched && !f.verdict;
      case 'execution_pending': return f.dispatched;
      case 'execution_unknown': return f.dispatched;
      case 'execution_settled': return f.dispatched;
      case 'release_complete':
      case 'release_failed':
        return f.execution === 'settled';
      case 'execution_contradiction': return f.everSettled;
      case 'release_contradiction':
        return f.releaseProof !== null || f.releaseAssessmentExecutionProof !== null;
      case 'duplicate_completion':
      case 'authenticity_failed':
      case 'verdict_invalid':
      case 'late_completion':
        return f.invocationReserved;
      case 'provenance_mismatch': return f.dispatched && f.workPhase !== 'acquisition';
      case 'timed_out': return f.dispatched;
      case 'cancelled':
      case 'crashed':
      case 'order_unavailable':
      case 'horizon_unavailable':
      case 'overflow':
        return true;
      case 'summary_reserved': return !f.summaryReserved && reportable(f);
      case 'summary_committed': return f.summaryReserved && !f.committed;
      case 'summary_failed': return f.summaryReserved;
      case 'acknowledged': return emitted !== null && recipientInbox === emitted;
      case 'ack_invalid': return f.summaryReserved;
      case 'ack_contradiction':
        return target !== null && f.acknowledgements.has(target);
      case 'local_checker_references_dropped': return f.invocationReserved;
    }
  }

  function receipt(
    kind: Kind,
    knownQueued: boolean,
    verdict: ReviewVerdictV1 | null,
    target: number | null,
  ): EvidenceReceipt {
    return Object.freeze({
      scope,
      sequence: receipts.length + 1,
      kind,
      origin: origin(kind, facts()),
      target,
      knownQueued,
      verdict,
    });
  }

  function push(
    kind: Kind,
    knownQueued: boolean,
    verdict: ReviewVerdictV1 | null,
    target: number | null,
    reserved: boolean,
  ): EvidenceReceipt {
    const admitted = receipt(kind, knownQueued, verdict, target);
    receipts.push(admitted);
    if (reserved) protectedCount++;
    else ordinaryCount++;
    return admitted;
  }

  function enterOverflow(): void {
    if (capacityUnavailable) return;
    capacityUnavailable = true;
    protectedKeys.add('overflow:');
    push('overflow', false, null, null, true);
  }

  function linkedTarget(kind: Kind, f: Facts, target: number | null): number | null {
    if (kind === 'execution_contradiction' || kind === 'execution_unknown'
      || kind === 'execution_pending') return f.executionProof;
    if (kind === 'release_contradiction') return f.releaseProof;
    if (kind === 'release_failed') {
      // Distinguish fresh C0 accounting from a failure of an older release.
      return f.releaseProofExecutionProof === f.executionProof
        ? f.releaseProof : f.executionProof;
    }
    return target;
  }

  function keyFor(kind: Kind, target: number | null): string {
    return kind + ':' + (target ?? '');
  }

  function append(
    kind: Kind,
    knownQueued = false,
    verdict: ReviewVerdictV1 | null = null,
    target: number | null = null,
  ): EvidenceReceipt | null {
    const f = facts();
    if (!permitted(kind, f, target)) return null;
    const linked = linkedTarget(kind, f, target);
    const key = keyFor(kind, linked);
    if (!capacityUnavailable && ordinaryCount < coordinatorReceiptLimits.ordinary) {
      protectedKeys.add(key);
      return push(kind, knownQueued, verdict, linked, false);
    }
    enterOverflow();
    // No execution/release proof or new verdict is admitted after overflow.
    // Consequently proof generations cannot grow in the protected reserve.
    // Distinct current-proof contradictions remain distinct from older ones.
    if (!protectedKinds.has(kind) || protectedKeys.has(key)
      || protectedCount >= coordinatorReceiptLimits.protected) return null;
    protectedKeys.add(key);
    return push(kind, knownQueued, verdict, linked, true);
  }

  append('initialized');

  function snapshot(): CoordinatorSnapshot {
    const f = facts();
    const c = settlementFromFacts(attemptId, f);
    return Object.freeze({
      scope,
      current: c,
      emitted,
      receipts: Object.freeze([...receipts]),
      historicalVerdicts: Object.freeze(receipts.flatMap(receipt =>
        receipt.verdict ? [receipt.verdict] : [])),
      captureReservations: receipts.filter(r => r.kind === 'capture_reserved').length,
      invocationReservations: receipts.filter(r => r.kind === 'invocation_reserved').length,
      emissionReservations: receipts.filter(r => r.kind === 'summary_reserved').length,
      handoffAttempts,
      capacityUnavailable,
      favorableCurrent: c.outcome === 'consistent_unverified'
        && c.uncertainty === 'none' && f.horizon && f.order && !f.completionBlocked,
    });
  }

  function reserveEmission(): boolean {
    if (locked || commitAttempted) return false;
    return append('summary_reserved') !== null;
  }

  type CommitBudget = Readonly<{
    committed: EvidenceReceipt;
    failed: EvidenceReceipt;
  }>;

  function reserveCommitBudget(): CommitBudget | null {
    // Reserve one bookkeeping receipt before the final projection. The two
    // prepared alternatives below are not admitted facts and are never exposed.
    if (!capacityUnavailable && ordinaryCount < coordinatorReceiptLimits.ordinary) {
      ordinaryCount++;
    } else {
      enterOverflow();
      if (protectedCount >= coordinatorReceiptLimits.protected) return null;
      protectedCount++;
    }
    return Object.freeze({
      committed: receipt('summary_committed', false, null, null),
      failed: receipt('summary_failed', false, null, null),
    });
  }

  function consumeCommitBudget(record: EvidenceReceipt): void {
    // The slot and its sequence were reserved in this same synchronous turn.
    // No capacity check, overflow admission or other outcome change occurs here.
    receipts.push(record);
    protectedKeys.add(keyFor(record.kind, record.target));
  }

  function commitEmission(): ImmutableReviewEmission | null {
    if (locked || commitAttempted) return null;
    locked = true;
    try {
      // All queued receipts are already retained. Projection always folds the
      // complete retained prefix, including knownQueued entries.
      if (!facts().summaryReserved && !append('summary_reserved')) return null;
      commitAttempted = true;

      if (reentrantProbe !== null) {
        const queued = reentrantProbe;
        reentrantProbe = null;
        observe(queued, true);
        // Exercise the same real lock path, without a caller callback.
        requireCondition(commitEmission() === null);
      }

      const budget = reserveCommitBudget();
      if (!budget) {
        // Coverage is already unavailable. No E or handoff is fabricated.
        append('summary_failed');
        return null;
      }
      if (!reportable(facts())) {
        consumeCommitBudget(budget.failed);
        return null;
      }
      if (uncertainHandoff) {
        // Explicit SIMULATED_ONLY uncertain handoff evidence. It supplies no
        // committed E, recipient completion or permission for a second attempt.
        handoffAttempts++;
        consumeCommitBudget(budget.failed);
        return null;
      }

      let committed: ImmutableReviewEmission;
      try {
        // All capacity effects and known queued events precede this projection.
        const source = settlementFromFacts(attemptId, facts());
        requireCondition(source.phase === 'summary'
          && source.summaryDelivery === 'not_established'
          && source.execution !== 'pending' && source.review !== 'pending');
        const status = parseStatusStructure({
          schema: 'gelt.byte-review-status.v2',
          attemptId,
          phase: source.phase,
          outcome: source.outcome,
          review: source.review,
          execution: source.execution,
          disposal: source.disposal,
          summaryDelivery: source.summaryDelivery,
          decision: 'abstain',
          reason: 'unverified_data',
          eligibility: 'unverified',
          effectAuthority: 'none',
          promotionAllowed: false,
          retryAllowed: false,
        });
        const bytes = encodeStatusComparison(status);
        committed = Object.freeze({ status, bytes, source });
      } catch {
        consumeCommitBudget(budget.failed);
        return null;
      }

      // Fixed local handoff and evidence admission form one synchronous
      // boundary. There is no callback, await, fallible capacity admission or
      // outcome-changing append after the final projection.
      handoffAttempts++;
      emitted = committed;
      recipientInbox = committed;
      consumeCommitBudget(budget.committed);
      return committed;
    } finally {
      locked = false;
    }
  }

  function recipientComplete(): object | null {
    if (!emitted || recipientInbox !== emitted
      || recipientCompletions >= coordinatorReceiptLimits.recipientCompletions) return null;
    recipientCompletions++;
    const ticket = Object.freeze(Object.create(null) as object);
    recipientTickets.set(ticket, {
      emission: emitted,
      acknowledgement: parseSummaryAckStructure({
        schema: 'gelt.byte-review-summary-ack.v2',
        attemptId,
        delivery: 'acknowledged',
      }),
      ordinal: recipientCompletions,
      used: false,
    });
    return ticket;
  }

  function acknowledge(ticket: unknown): object | null {
    const linked = ticket !== null && typeof ticket === 'object'
      ? recipientTickets.get(ticket) : undefined;
    if (!linked || linked.used || !emitted || linked.emission !== emitted
      || recipientInbox !== emitted) {
      if (facts().summaryReserved) append('ack_invalid');
      else append('horizon_unavailable');
      return null;
    }
    linked.used = true;
    const ack = parseSummaryAckStructure(linked.acknowledgement);
    if (ack.attemptId !== attemptId || linked.emission.source.attemptId !== attemptId) {
      append('ack_invalid');
      return null;
    }
    const admitted = append('acknowledged', false, null, linked.ordinal);
    if (!admitted) return null;
    const handle = Object.freeze(Object.create(null) as object);
    acknowledgementHandles.set(handle, admitted.sequence);
    return handle;
  }

  function contradictAcknowledgement(handle: unknown): boolean {
    const sequence = handle !== null && typeof handle === 'object'
      ? acknowledgementHandles.get(handle) : undefined;
    if (sequence === undefined) return false;
    return append('ack_contradiction', false, null, sequence) !== null;
  }

  function acceptLinkedVerdict(input: ReviewVerdictV1): boolean {
    const f = facts();
    if (f.verdict) return append('duplicate_completion') !== null;
    if (f.completionBlocked || !f.order || !f.horizon) {
      append('late_completion');
      return false;
    }
    try {
      const verdict = parseVerdictStructure(input);
      requireCondition(verdict.attemptId === attemptId
        && verdict.invocationId === invocationId && verdict.elapsedMs < 60000);
      return append('verdict', false, verdict) !== null;
    } catch {
      append('verdict_invalid');
      return false;
    }
  }

  function observe(kind: SimulatedEvidenceKind, queued = false): boolean {
    requireCondition(simulatedEvidenceKinds.includes(kind));
    if (kind.startsWith('verdict_')
      && kind !== 'verdict_invalid') {
      requireCondition(scope === 'SIMULATED_ONLY');
      const checks = checkIds.map((id, index) => ({
        id,
        result: kind === 'verdict_incomplete' && index === 13 ? 'unknown'
          : (kind === 'verdict_rejected' || kind === 'verdict_rejected_unknown')
            && index === 1 ? 'fail'
            : kind === 'verdict_rejected_unknown' && index === 13 ? 'unknown' : 'pass',
        reason: kind === 'verdict_incomplete' && index === 13 ? 'evidence_missing'
          : (kind === 'verdict_rejected' || kind === 'verdict_rejected_unknown')
            && index === 1 ? 'page_mismatch'
            : kind === 'verdict_rejected_unknown' && index === 13 ? 'evidence_missing' : 'none',
      }));
      const modelVerdict = parseVerdictStructure({
        schema: 'gelt.review-before-discard-verdict.v1',
        attemptId,
        invocationId,
        revisions: {
          contract: 1,
          consumer: '1.1',
          sourceClosure: 'SIMULATED.source',
          request: 'SIMULATED.request',
          policy: 'SIMULATED.policy',
          calendar: 'SIMULATED.calendar',
          availability: 'SIMULATED.availability',
          candidate: 'SIMULATED.candidate',
          reviewer: 'SIMULATED.reviewer',
          verdictPolicy: 'SIMULATED.verdict',
        },
        reviewerRevision: 'SIMULATED.reviewer',
        authorityId: 'SIMULATED.no-operational-authority',
        bindingSha256: '0'.repeat(64),
        completedAt: '2024-01-04T00:00:00.000Z',
        elapsedMs: 0,
        outcome: kind === 'verdict_all_pass' ? 'consistent_unverified'
          : kind === 'verdict_incomplete' ? 'incomplete' : 'rejected',
        checks,
      });
      return acceptLinkedVerdict(modelVerdict);
    }
    return append(kind as Kind, queued) !== null;
  }

  return Object.freeze({
    scope,
    attemptId,
    invocationId,
    append,
    facts,
    current,
    snapshot,
    observe,
    acceptLinkedVerdict,
    reserveEmission,
    commitEmission,
    recipientComplete,
    acknowledge,
    contradictAcknowledgement,
    acceptsSettlementCandidate(input: unknown): boolean {
      try {
        return encodeSettlementComparison(parseSettlementStructure(input))
          === encodeSettlementComparison(current());
      } catch { return false; }
    },
    armReentrantProbe(kind: SimulatedEvidenceKind): void {
      requireCondition(scope === 'SIMULATED_ONLY'
        && simulatedEvidenceKinds.includes(kind) && !commitAttempted);
      reentrantProbe = kind;
    },
    armUncertainHandoff(): void {
      requireCondition(scope === 'SIMULATED_ONLY' && !commitAttempted);
      uncertainHandoff = true;
    },
  });
}

let allocatedCoordinators = 0;
function localIds(prefix: '3' | '4'): readonly [string, string] {
  requireCondition(allocatedCoordinators < 4096);
  const suffix = (++allocatedCoordinators).toString(16).padStart(12, '0');
  return [
    `${prefix}0000000-0000-4000-8000-${suffix}`,
    `${prefix}0000001-0000-4000-8000-${suffix}`,
  ];
}

/**
 * Fresh private local state proves this module dispatched nothing.
 * Required operational admission is absent, so no dispatch API is returned.
 */
export function productionByteReviewPreflight(): Readonly<{
  scope: 'PRODUCTION_CLOSED';
  dispatchAllowed: false;
  settlement: ReviewSettlementV2;
}> {
  requireCondition(arguments.length === 0);
  const [attemptId, invocationId] = localIds('4');
  const core = createCore('PRODUCTION_CLOSED', attemptId, invocationId);
  requireCondition(core.append('preflight_unavailable') !== null);
  return Object.freeze({
    scope: 'PRODUCTION_CLOSED',
    dispatchAllowed: false,
    settlement: core.current(),
  });
}

/**
 * Pure conditional model. Every evidence-producing operation below is
 * SIMULATED_ONLY, including all-pass verdict, settlement and release evidence.
 */
export function createSimulatedByteReviewCoordinator() {
  requireCondition(arguments.length === 0);
  const [attemptId, invocationId] = localIds('3');
  const core = createCore('SIMULATED_ONLY', attemptId, invocationId);
  return Object.freeze({
    scope: 'SIMULATED_ONLY' as const,
    attemptId,
    invocationId,
    startReview(): boolean {
      if (core.facts().dispatched || core.facts().captureReserved) return false;
      return [
        'capture_reserved', 'capture_pending', 'binding_pending',
        'candidate_pending', 'invocation_reserved', 'review_dispatched',
      ].every(kind => core.append(kind as Kind) !== null);
    },
    observe: (kind: SimulatedEvidenceKind) => core.observe(kind),
    queue: (kind: SimulatedEvidenceKind) => core.observe(kind, true),
    snapshot: core.snapshot,
    reserveEmission: core.reserveEmission,
    commitEmission: core.commitEmission,
    recipientComplete: core.recipientComplete,
    acknowledge: core.acknowledge,
    contradictAcknowledgement: core.contradictAcknowledgement,
    acceptsSettlementCandidate: core.acceptsSettlementCandidate,
    simulateReentrantBoundary: core.armReentrantProbe,
    simulateUncertainHandoff: core.armUncertainHandoff,
  });
}

export type ConstructedCoordinator = Readonly<{
  scope: 'CONSTRUCTED_ONLY';
  attemptId: string;
  invocationId: string;
  beginCapture(): object | null;
  reserveReview(capture: unknown, original: unknown, binding: unknown, candidate: unknown): boolean;
  completeReview(): boolean;
  queueCancellation(): boolean;
  advanceFixtureElapsedTo(milliseconds: number): void;
  dropLocalCheckerReferences(): boolean;
  snapshot(): CoordinatorSnapshot;
  reserveEmission(): boolean;
  commitEmission(): ImmutableReviewEmission | null;
  recipientComplete(): object | null;
  acknowledge(completion: unknown): object | null;
  acceptsSettlementCandidate(input: unknown): boolean;
}>;

/**
 * Fixed fixture integration. Acquisition is performed by the external synthetic
 * test harness, never by this module. No positive whole-job settlement/release
 * evidence producer is exposed.
 */
export function createConstructedByteReviewCoordinator(): ConstructedCoordinator {
  requireCondition(arguments.length === 0);
  const lane = createConstructedByteReviewLane();
  const core: Core = createCore('CONSTRUCTED_ONLY', lane.attemptId, lane.invocationId);
  let captureTicket: object | null = null;
  let captureConsumed = false;
  let reservationLinked = false;
  let reviewAttempted = false;
  let localReferencesDropped = false;

  type ReservationFailure = 'provenance_mismatch' | 'unknown';
  const reservationFailed = (kind: ReservationFailure): false => {
    if (kind === 'provenance_mismatch') core.append('provenance_mismatch');
    // A reservation error supplies no whole-job settlement evidence and is
    // not an observed reviewer/checker error or a completed check vector.
    core.append('execution_unknown');
    return false;
  };

  return Object.freeze({
    scope: 'CONSTRUCTED_ONLY',
    attemptId: lane.attemptId,
    invocationId: lane.invocationId,

    beginCapture(): object | null {
      if (captureTicket || !core.append('capture_reserved')) return null;
      requireCondition(core.append('capture_pending') !== null);
      captureTicket = Object.freeze(Object.create(null) as object);
      return captureTicket;
    },

    reserveReview(capture, original, binding, candidate): boolean {
      if (captureConsumed || capture !== captureTicket || captureTicket === null) return false;
      captureConsumed = true;
      if (!core.append('binding_pending')) return false;

      // Consult the original connector WeakMap before parsing, cloning or
      // inspecting any supplied graph. A false result is definite provenance
      // failure before invocation reservation or producer dispatch.
      let issued: boolean;
      try { issued = isConnectorIssuedAlpacaAcquisition(original); }
      catch { return reservationFailed('unknown'); }
      if (!issued) return reservationFailed('provenance_mismatch');

      if (!core.append('candidate_pending')) return false;
      // This coordinator reservation becomes irreversible before entering the
      // fixed lane's reservation code, including any synchronous failure there.
      if (!core.append('invocation_reserved')) return false;

      try {
        // Establish only a narrow positive cross-attempt mismatch here.
        // Missing/accessor/malformed fields are left to the fixed lane and
        // cannot be converted into a provenance or temporal-mutation claim.
        if (binding !== null && typeof binding === 'object') {
          const descriptor = Object.getOwnPropertyDescriptor(binding, 'attemptId');
          if (descriptor && 'value' in descriptor
            && typeof descriptor.value === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(descriptor.value)
            && descriptor.value !== lane.attemptId) {
            return reservationFailed('provenance_mismatch');
          }
        }
        const invocation = lane.reserve(original, binding, candidate);
        if (invocation.attemptId !== lane.attemptId
          || invocation.invocationId !== lane.invocationId) {
          return reservationFailed('provenance_mismatch');
        }
        reservationLinked = true;
        return true;
      } catch {
        // The fixed reserve API exposes a sanitized generic failure. Without
        // narrower evidence, its cause is unknown; reviewer entry is unproved.
        return reservationFailed('unknown');
      }
    },

    completeReview(): boolean {
      // A coordinator UUID reservation alone is not a successful lane linkage.
      // Never enter the producer after a known failed reservation.
      if (!reservationLinked) return false;
      if (reviewAttempted) {
        core.append('duplicate_completion');
        return false;
      }
      reviewAttempted = true;
      const before = core.facts();
      if (before.completionBlocked) {
        if (before.failures.some(item => item.outcome === 'cancelled')) lane.markCancelled();
        else lane.markPriorUncertainty();
        core.append('execution_unknown');
        return false;
      }
      if (!core.append('review_dispatched')) {
        core.append('execution_unknown');
        return false;
      }

      let accepted: ReturnType<typeof lane.accept>;
      try {
        const completion = lane.produce();
        accepted = lane.accept(completion);
      } catch {
        // This is an observed error from the privately linked fixed producer,
        // unlike a reservation-input or linkage-validation failure.
        core.append('reviewer_error');
        core.append('execution_unknown');
        return false;
      }

      let admitted = false;
      if (accepted.accepted && accepted.verdict) {
        try {
          // This exact record comes directly from the private fixed producer,
          // never from a caller-supplied verdict-shaped object.
          requireCondition(accepted.verdict.outcome !== 'consistent_unverified'
            && accepted.verdict.checks.some(check =>
              check.id === 'C14_HANDLING' && check.result === 'unknown'));
          admitted = core.acceptLinkedVerdict(accepted.verdict);
        } catch {
          core.append('verdict_invalid');
        }
      } else {
        const kind: Kind = accepted.reason === 'provenance_mismatch' ? 'provenance_mismatch'
          : accepted.reason === 'authenticity_failed' ? 'authenticity_failed'
          : accepted.reason === 'duplicate_completion' ? 'duplicate_completion'
          : accepted.reason === 'late' ? 'timed_out'
          : accepted.reason === 'cancelled' ? 'cancelled'
          : accepted.reason === 'timing_unknown' || accepted.reason === 'prior_uncertainty'
            ? 'order_unavailable' : 'verdict_invalid';
        core.append(kind);
      }
      // Foreground synchronous review completion supplies no independent
      // whole-job acquisition/descendant settlement evidence.
      core.append('execution_unknown');
      return admitted;
    },

    queueCancellation(): boolean {
      return core.append('cancelled', true) !== null;
    },

    advanceFixtureElapsedTo(milliseconds: number): void {
      lane.advanceFixtureElapsedTo(milliseconds);
      if (milliseconds >= 60000) core.append('timed_out');
    },

    dropLocalCheckerReferences(): boolean {
      if (!reviewAttempted || localReferencesDropped) return false;
      localReferencesDropped = true;
      lane.discardPayloadReferences();
      core.append('local_checker_references_dropped');
      // Authenticated verdict metadata remains in R. This is deliberately
      // neither an execution_settled nor a release_complete receipt.
      return true;
    },

    snapshot: core.snapshot,
    reserveEmission: core.reserveEmission,
    commitEmission: core.commitEmission,
    recipientComplete: core.recipientComplete,
    acknowledge: core.acknowledge,
    acceptsSettlementCandidate: core.acceptsSettlementCandidate,
  });
}

// Referencing the fixed profile does not enable another fixture or admission.
export const constructedCoordinatorLimits = Object.freeze({
  scope: 'CONSTRUCTED_ONLY',
  maximumCheckerLanes: constructedByteReviewProfile.maximumLaneAllocations,
  positiveWholeJobSettlementProducer: 'unavailable',
  positiveCompleteReleaseProducer: 'unavailable',
} as const);
