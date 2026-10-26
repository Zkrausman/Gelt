import {
  encodeStatusComparison,
  outcomePrecedence,
  parseSettlementStructure,
  parseStatusStructure,
  parseSummaryAckStructure,
  parseVerdictStructure,
  type ReviewPhase,
  type ReviewSettlementV2,
  type ReviewVerdictV1,
  type SettlementOutcome,
} from './alpaca-byte-review-contract.js';
import {
  createConstructedByteReviewLane,
  type ConstructedAcceptance,
  type ConstructedAcceptanceFailure,
  type ConstructedByteReviewLane,
} from './alpaca-byte-review-checker.js';
import {
  productionByteReviewPreflight,
  type CoordinatorSnapshot,
  type EvidenceReceipt,
  type ImmutableReviewEmission,
} from './alpaca-byte-review-coordinator.js';
import { isConnectorIssuedAlpacaAcquisition } from './alpaca-iex-connector.js';
import { createSpy253ByteReviewLane } from './alpaca-spy253-review-profile.js';

type AdapterScope = 'CONSTRUCTED_ONLY' | 'SPY253_INSPECTION_ONLY';
type AdapterReceipt = Omit<EvidenceReceipt, 'scope'> & Readonly<{ scope: AdapterScope }>;
type AdapterSnapshot = Omit<CoordinatorSnapshot, 'scope' | 'receipts'>
  & Readonly<{ scope: AdapterScope; receipts: readonly AdapterReceipt[] }>;
type ReviewLane = ConstructedByteReviewLane | ReturnType<typeof createSpy253ByteReviewLane>;
type AdapterAcceptance = ReturnType<ReviewLane['accept']>;

/**
 * Source-only integration.
 *
 * Production has no acquisition or reviewer-dispatch surface. Constructed
 * conformance uses the existing fixed BRCFIX lane, including its original-object
 * reservation, graph seals, finite profile matcher and private completion.
 *
 * No callback, profile, registry, authority, clock, recipient or enable argument
 * is accepted. Trusted construction must exclude hostile proxies/interposition.
 * This module establishes no handling entitlement or malicious-code isolation.
 */

const unavailable = (): never => {
  throw new Error('Original-process byte review unavailable');
};

/** PRODUCTION_CLOSED: the first guard exposes no acquisition/dispatch API. */
export function productionOriginalProcessReviewPreflight() {
  if (arguments.length !== 0) unavailable();
  return productionByteReviewPreflight();
}

type Kind =
  | 'initialized'
  | 'capture_reserved'
  | 'capture_pending'
  | 'binding_pending'
  | 'candidate_pending'
  | 'invocation_reserved'
  | 'review_dispatched'
  | 'verdict'
  | 'reviewer_error'
  | 'execution_unknown'
  | 'duplicate_completion'
  | 'authenticity_failed'
  | 'verdict_invalid'
  | 'provenance_mismatch'
  | 'timed_out'
  | 'cancelled'
  | 'order_unavailable'
  | 'summary_reserved'
  | 'summary_committed'
  | 'acknowledged'
  | 'ack_invalid'
  | 'summary_failed'
  | 'local_checker_references_dropped';

type AdverseKind =
  | 'reviewer_error'
  | 'duplicate_completion'
  | 'authenticity_failed'
  | 'verdict_invalid'
  | 'provenance_mismatch'
  | 'timed_out'
  | 'cancelled'
  | 'order_unavailable'
  | 'ack_invalid'
  | 'summary_failed';

const invalidatingKinds: ReadonlySet<EvidenceReceipt['kind']> = new Set([
  'duplicate_completion',
  'authenticity_failed',
  'verdict_invalid',
  'provenance_mismatch',
  'timed_out',
  'cancelled',
  'order_unavailable',
]);

function receiptOutcome(receipt: AdapterReceipt): SettlementOutcome | null {
  switch (receipt.kind) {
    case 'verdict': return receipt.verdict!.outcome;
    case 'reviewer_error': return 'incomplete';
    case 'duplicate_completion':
    case 'verdict_invalid': return 'verdict_acceptance_failed';
    case 'authenticity_failed': return 'verdict_authenticity_failed';
    case 'provenance_mismatch': return 'provenance_mismatch';
    case 'timed_out': return 'timed_out';
    case 'cancelled': return 'cancelled';
    case 'order_unavailable': return 'unknown';
    case 'ack_invalid':
    case 'summary_failed': return 'summary_failed';
    default: return null;
  }
}

/**
 * CONSTRUCTED_ONLY, with external synthetic acquisition owned by the harness.
 *
 * beginCapture reserves the sole modeled capture allowance before that harness
 * obtains its connector original. It does not acquire anything or supervise
 * external work. The fixed checker independently prevents reuse of its original.
 *
 * The ledger supports only the existing incomplete/negative constructed path.
 * It has no execution-settled or complete-release producer and accepts no
 * simulated positive evidence. Consequently it cannot emit favorable status.
 *
 * Each of the 23 internal receipt kinds can be admitted once. There is at most
 * one verdict and one recipient completion. This finite subset stays below the
 * existing coordinator's ordinary receipt bound without a growing event queue.
 */
export function createConstructedOriginalProcessReviewAdapter() {
  if (arguments.length !== 0) unavailable();
  const adapter = createOriginalProcessAdapter(createConstructedByteReviewLane(), 'CONSTRUCTED_ONLY');
  // The shared implementation has a union scope, but this zero-argument
  // facade can only construct the legacy lane. Preserve its public TS API
  // as well as its runtime values instead of widening existing consumers.
  return adapter as Readonly<Omit<typeof adapter, 'scope' | 'snapshot' | 'acceptCompletion'> & {
    scope: 'CONSTRUCTED_ONLY';
    snapshot: () => CoordinatorSnapshot;
    acceptCompletion: (handle: unknown, ticket: unknown) => ConstructedAcceptance;
  }>;
}

function createOriginalProcessAdapter(
  lane: ReviewLane,
  scope: AdapterScope,
) {
  const receipts: AdapterReceipt[] = [];
  const seen = new Set<Kind>();
  let reserveAttempted = false;
  let reviewAttempted = false;
  let acceptanceAttempted = false;
  let emissionAttempted = false;
  let recipientAttempted = false;
  let acknowledgementUsed = false;
  let referencesDropped = false;
  let reservation: object | null = null;
  let completion: object | null = null;
  let recipientCompletion: object | null = null;
  let emitted: ImmutableReviewEmission | null = null;
  let handoffAttempts = 0;

  const has = (kind: Kind): boolean => seen.has(kind);

  function append(
    kind: Kind,
    origin: ReviewPhase,
    verdict: ReviewVerdictV1 | null = null,
    knownQueued = false,
  ): void {
    if (seen.has(kind)) return;
    seen.add(kind);
    receipts.push(Object.freeze({
      scope,
      sequence: receipts.length + 1,
      kind,
      origin,
      target: kind === 'acknowledged' ? 1 : null,
      knownQueued,
      verdict,
    }));
  }

  append('initialized', 'preflight');

  function workOrigin(): ReviewPhase {
    if (has('invocation_reserved')) return reviewAttempted ? 'verdict' : 'review';
    if (has('binding_pending')) return 'binding';
    return has('capture_pending') ? 'acquisition' : 'preflight';
  }

  function stop(kind: AdverseKind, knownQueued = false): void {
    // Authenticity/acceptance outcomes require a reserved invocation.
    if (!has('invocation_reserved') && (
      kind === 'duplicate_completion'
      || kind === 'authenticity_failed'
      || kind === 'verdict_invalid'
      || kind === 'reviewer_error'
    )) {
      kind = 'order_unavailable';
    }

    const origin: ReviewPhase =
      kind === 'ack_invalid' || kind === 'summary_failed' ? 'summary'
        : kind === 'authenticity_failed'
          || kind === 'duplicate_completion'
          || kind === 'verdict_invalid' ? 'verdict'
        : kind === 'reviewer_error' ? 'review'
        : kind === 'provenance_mismatch' && !has('invocation_reserved')
          ? 'binding'
        : workOrigin();

    append(kind, origin, null, knownQueued);
    if (has('capture_pending')) {
      // Missing whole-job settlement evidence, never a positive settlement.
      append('execution_unknown', workOrigin());
    }
  }

  function blocked(): boolean {
    return receipts.some(receipt => receiptOutcome(receipt) !== null)
      || has('execution_unknown');
  }

  function current(): ReviewSettlementV2 {
    if (scope === 'SPY253_INSPECTION_ONLY' && has('verdict') && !referencesDropped) {
      const checked = lane.current();
      if (!checked.accepted) {
        stop(checked.reason === 'provenance_mismatch' ? 'provenance_mismatch'
          : checked.reason === 'late' ? 'timed_out'
          : checked.reason === 'cancelled' ? 'cancelled'
          : checked.reason === 'authenticity_failed' ? 'authenticity_failed'
          : checked.reason === 'duplicate_completion' ? 'duplicate_completion'
          : checked.reason === 'acceptance_failed' ? 'verdict_invalid'
          : 'order_unavailable');
      }
    }
    const invoked = has('invocation_reserved');
    const verdict = receipts.find(receipt => receipt.kind === 'verdict')?.verdict;
    const invalidated = receipts.some(receipt => invalidatingKinds.has(receipt.kind));
    const execution = has('execution_unknown') ? 'unknown'
      : has('capture_pending') ? 'pending' : 'not_started';

    let selected: {
      outcome: SettlementOutcome;
      origin: ReviewPhase;
    } | null = null;

    for (const receipt of receipts) {
      const outcome = receiptOutcome(receipt);
      if (outcome === null) continue;
      if (selected === null
        || outcomePrecedence.indexOf(outcome as typeof outcomePrecedence[number])
          < outcomePrecedence.indexOf(
            selected.outcome as typeof outcomePrecedence[number],
          )) {
        selected = { outcome, origin: receipt.origin };
      }
    }

    if (selected === null && execution === 'unknown') {
      selected = { outcome: 'unknown', origin: workOrigin() };
    }

    let review: ReviewSettlementV2['review'] = !invoked ? 'not_attempted'
      : invalidated ? 'unknown'
      : verdict ? verdict.outcome
      : has('reviewer_error') ? 'incomplete'
      : execution === 'pending' ? 'pending' : 'unknown';

    if (selected?.outcome === 'unknown' && invoked) review = 'unknown';

    const outcome = selected?.outcome
      ?? (has('capture_pending') ? 'pending' : 'not_attempted');
    const phase: ReviewPhase = has('summary_reserved') ? 'summary'
      : selected?.origin
        ?? (invoked ? 'review' : has('capture_pending') ? 'acquisition' : 'preflight');

    const uncertainty = execution === 'unknown'
      || review === 'unknown' || review === 'incomplete'
      || invalidated || has('reviewer_error')
      || has('ack_invalid') || has('summary_failed')
      || Boolean(verdict?.checks.some(check => check.result === 'unknown'));

    return parseSettlementStructure({
      schema: 'gelt.byte-review-settlement.v2',
      attemptId: lane.attemptId,
      invocationId: invoked ? lane.invocationId : null,
      phase,
      outcome,
      review,
      execution,
      disposal: 'not_established',
      summaryDelivery: has('summary_reserved')
        ? has('acknowledged') ? 'acknowledged' : 'not_established'
        : 'not_attempted',
      uncertainty: uncertainty ? 'latched' : 'none',
    });
  }

  function failed(reason: ConstructedAcceptanceFailure): AdapterAcceptance {
    return Object.freeze({
      scope: lane.scope,
      accepted: false,
      reason,
      uncertainty: 'latched',
      verdict: null,
    });
  }

  function snapshot(): AdapterSnapshot {
    const settlement = current();
    return Object.freeze({
      scope,
      current: settlement,
      emitted,
      receipts: Object.freeze([...receipts]),
      historicalVerdicts: Object.freeze(receipts.flatMap(receipt =>
        receipt.verdict ? [receipt.verdict] : [])),
      captureReservations: has('capture_reserved') ? 1 : 0,
      invocationReservations: has('invocation_reserved') ? 1 : 0,
      emissionReservations: has('summary_reserved') ? 1 : 0,
      handoffAttempts,
      capacityUnavailable: false,
      favorableCurrent: false,
    });
  }

  return Object.freeze({
    scope,
    attemptId: lane.attemptId,

    beginCapture(): boolean {
      if (has('capture_reserved')) {
        stop('order_unavailable');
        return false;
      }
      if (blocked()) return false;
      append('capture_reserved', 'acquisition');
      append('capture_pending', 'acquisition');
      return true;
    },

    reserve(original: unknown, binding: unknown, candidate: unknown): object | null {
      if (reserveAttempted) {
        stop('duplicate_completion');
        return null;
      }
      reserveAttempted = true;
      if (!has('capture_pending') || blocked()) {
        stop('order_unavailable');
        return null;
      }
      append('binding_pending', 'binding');

      // Issuance precedes every supplied-graph inspection or clone.
      try {
        if (!isConnectorIssuedAlpacaAcquisition(original)) {
          stop('provenance_mismatch');
          return null;
        }
      } catch {
        stop('order_unavailable');
        return null;
      }

      append('candidate_pending', 'candidate');
      // Irreversible even if the fixed lane's reservation subsequently fails.
      append('invocation_reserved', 'review');
      try {
        const invocation = lane.reserve(original, binding, candidate);
        if (invocation.attemptId !== lane.attemptId
          || invocation.invocationId !== lane.invocationId) {
          stop('provenance_mismatch');
          return null;
        }
        reservation = Object.freeze(Object.create(null) as object);
        return reservation;
      } catch {
        // The fixed API sanitizes its cause. Unsupported profile, malformed
        // input and other reservation errors cannot be guessed apart here.
        stop('order_unavailable');
        return null;
      }
    },

    completeReview(handle: unknown): object | null {
      if (reservation === null || handle !== reservation) {
        stop('authenticity_failed');
        return null;
      }
      if (reviewAttempted) {
        stop('duplicate_completion');
        return null;
      }
      if (blocked() || referencesDropped) return null;

      reviewAttempted = true;
      append('review_dispatched', 'review');
      try {
        const produced = lane.produce();
        if (produced === null || typeof produced !== 'object') throw new Error();
        completion = produced;
        return produced;
      } catch {
        // Only observed entry into the privately held fixed producer gets the
        // reviewer-error classification. No exception text is retained.
        stop('reviewer_error');
        return null;
      }
    },

    acceptCompletion(handle: unknown, ticket: unknown): AdapterAcceptance {
      if (reservation === null || handle !== reservation) {
        stop('authenticity_failed');
        return failed('authenticity_failed');
      }
      if (acceptanceAttempted) {
        stop('duplicate_completion');
        return failed('duplicate_completion');
      }
      acceptanceAttempted = true;

      if (!reviewAttempted || completion === null || ticket !== completion) {
        stop('authenticity_failed');
        return failed('authenticity_failed');
      }
      if (blocked() || referencesDropped) {
        stop('order_unavailable');
        return failed('prior_uncertainty');
      }

      try {
        // The fixed acceptor performs its live original/seal/timing checks
        // synchronously. Matching DTOs never enter this path.
        const accepted = lane.accept(ticket);
        if (!accepted.accepted || accepted.verdict === null) {
          const kind: AdverseKind =
            accepted.reason === 'provenance_mismatch' ? 'provenance_mismatch'
              : accepted.reason === 'authenticity_failed' ? 'authenticity_failed'
              : accepted.reason === 'duplicate_completion' ? 'duplicate_completion'
              : accepted.reason === 'late' ? 'timed_out'
              : accepted.reason === 'cancelled' ? 'cancelled'
              : accepted.reason === 'timing_unknown'
                || accepted.reason === 'prior_uncertainty'
                || accepted.reason === 'closed' ? 'order_unavailable'
              : 'verdict_invalid';
          stop(kind);
          return failed(accepted.reason === 'none' ? 'acceptance_failed' : accepted.reason);
        }

        const verdict = parseVerdictStructure(accepted.verdict);
        if (verdict.attemptId !== lane.attemptId
          || verdict.invocationId !== lane.invocationId
          || verdict.outcome === 'consistent_unverified'
          || !verdict.checks.some(check =>
            check.id === 'C14_HANDLING' && check.result === 'unknown')
          || verdict.checks.some(check =>
            (check.id === 'C07_CLOSURE_REVISIONS'
              || check.id === 'C13_REVIEWER_ADMISSION')
            && check.result === 'pass')) {
          stop('verdict_invalid');
          return failed('acceptance_failed');
        }

        append('verdict', 'verdict', verdict);
        append('execution_unknown', 'verdict');
        return Object.freeze({
          scope: lane.scope,
          accepted: true,
          reason: 'none',
          uncertainty: 'latched',
          verdict,
        });
      } catch {
        // An unexpected acceptance failure supplies neither a verdict nor
        // positive execution evidence.
        stop('order_unavailable');
        return failed('acceptance_failed');
      }
    },

    queueCancellation(): boolean {
      try { lane.markCancelled(); }
      catch { stop('order_unavailable'); }
      stop('cancelled', true);
      return true;
    },

    advanceFixtureElapsedTo(milliseconds: number): boolean {
      if (!has('invocation_reserved')) return false;
      try {
        lane.advanceFixtureElapsedTo(milliseconds);
        if (milliseconds >= 60000) stop('timed_out');
        return true;
      } catch {
        stop('order_unavailable');
        return false;
      }
    },

    markFixtureClockUnavailable(): void {
      try { lane.markFixtureClockUnavailable(); }
      catch { /* Only unavailable clock/order evidence is established. */ }
      stop('order_unavailable');
    },

    dropLocalCheckerReferences(): boolean {
      if (!reviewAttempted || referencesDropped) return false;
      referencesDropped = true;
      try {
        lane.discardPayloadReferences();
        completion = null;
        append('local_checker_references_dropped', workOrigin());
        if (!has('verdict')) stop('order_unavailable');
        return true;
      } catch {
        stop('order_unavailable');
        return false;
      }
      // No execution-settled, complete-release or zeroization claim.
    },

    emitSummary(): ImmutableReviewEmission | null {
      if (emissionAttempted) return null;
      const before = current();
      if (before.outcome === 'not_attempted' || before.outcome === 'pending'
        || before.execution === 'pending' || before.review === 'pending') return null;

      emissionAttempted = true;
      append('summary_reserved', 'summary');

      try {
        // No caller callback, await or queued event processor intervenes
        // between this complete-prefix projection and the fixed local handoff.
        const source = current();
        const status = parseStatusStructure({
          schema: 'gelt.byte-review-status.v2',
          attemptId: source.attemptId,
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
        const committed = Object.freeze({ status, bytes, source });

        handoffAttempts++;
        emitted = committed;
        append('summary_committed', 'summary');
        return committed;
      } catch {
        stop('summary_failed');
        return null;
      }
    },

    recipientComplete(): object | null {
      if (emitted === null || recipientAttempted) return null;
      recipientAttempted = true;
      recipientCompletion = Object.freeze(Object.create(null) as object);
      return recipientCompletion;
    },

    acknowledge(ticket: unknown) {
      if (emitted === null) {
        stop('order_unavailable');
        return null;
      }
      if (recipientCompletion === null || ticket !== recipientCompletion
        || acknowledgementUsed) {
        stop('ack_invalid');
        return null;
      }

      acknowledgementUsed = true;
      try {
        const acknowledgement = parseSummaryAckStructure({
          schema: 'gelt.byte-review-summary-ack.v2',
          attemptId: lane.attemptId,
          delivery: 'acknowledged',
        });
        append('acknowledged', 'summary');
        return acknowledgement;
      } catch {
        stop('ack_invalid');
        return null;
      }
    },

    snapshot,
  });
}

/**
 * Inspect an already supplied original. This entry exposes no acquisition,
 * operating dispatch, enable switch, producer callback or simulated clock.
 */
export function createSpy253OriginalProcessReviewAdapter() {
  if (arguments.length !== 0) unavailable();
  const adapter = createOriginalProcessAdapter(
    createSpy253ByteReviewLane(), 'SPY253_INSPECTION_ONLY',
  );
  const {
    beginCapture, reserve, advanceFixtureElapsedTo,
    markFixtureClockUnavailable, ...inspection
  } = adapter;
  void advanceFixtureElapsedTo;
  return Object.freeze({
    ...inspection,
    reserve(original: unknown, binding: unknown): object | null {
      if (!beginCapture()) return null;
      return reserve(original, binding, null);
    },
    markClockUnavailable: markFixtureClockUnavailable,
  });
}
