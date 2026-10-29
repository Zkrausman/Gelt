import { canonical, digest } from './ledger-canonical.js';
import type { AlpacaIexAcquisition } from './alpaca-iex-contract.js';
import { createSpy253ByteReviewLane, parseSpy253ReviewBinding } from './alpaca-spy253-review-profile.js';
import { pamrRecipe, spy253PAMRInspectionLimit, spy253InspectionSourceRequestSchema, type Spy253PAMRInspectionRequest } from './paper-conversion-contract.js';
import { exactSpy253CloseRatio, replaySpy253PAMRInspectionRequest, spy253InspectionOriginalSha256,
  type Spy253PAMRInspectionArtifact } from './pamr-reference-artifact.js';

type Rejection = 'invalid_source' | 'invalid_input' | 'resource_limit' | 'already_attempted' | 'unavailable';
export type Spy253PAMRInspectionResult = Readonly<{ status: 'computed'; artifact: Spy253PAMRInspectionArtifact }>
  | Readonly<{ status: 'rejected'; reason: Rejection }>;
const rejected = (reason: Rejection): Spy253PAMRInspectionResult => Object.freeze({ status: 'rejected', reason });
const hash = (domain: string, value: unknown) => digest(canonical({ domain: 'gelt.spy253-pamr-inspection.v1/' + domain, value }));
function requireCondition(value: unknown): asserts value { if (!value) throw new Error('SPY253 PAMR inspection unavailable'); }

/**
 * One synchronous inspection of an already supplied original. The private lane
 * owns the retained original, seals, reservation, producer and completion ticket.
 * No caller receipt, verifier, profile, clock, acquisition or dispatch is exposed.
 * Trusted construction excludes hostile proxies and runtime interposition.
 */
export function createSpy253PAMRInspection() {
  requireCondition(arguments.length === 0);
  const lane = createSpy253ByteReviewLane();
  let attempted = false;
  let retained: Spy253PAMRInspectionResult | undefined;
  const valid = (): boolean => {
    const current = lane.current();
    return current.accepted && current.reason === 'none' && current.verdict?.outcome === 'incomplete';
  };
  const stop = (reason: Rejection): Spy253PAMRInspectionResult => {
    retained = undefined;
    lane.markPriorUncertainty();
    return rejected(reason);
  };
  return Object.freeze({
    scope: 'source_inspection_only' as const, attemptId: lane.attemptId,
    inspect(originalInput: unknown, bindingInput: unknown): Spy253PAMRInspectionResult {
      if (attempted) return stop('already_attempted');
      attempted = true;
      try {
        // Issuance and irreversible original reservation precede all local reads.
        lane.reserve(originalInput, bindingInput, null);
        const acceptance = lane.accept(lane.produce());
        requireCondition(acceptance.accepted && acceptance.reason === 'none' && acceptance.verdict !== null);
        const verdict = acceptance.verdict;
        requireCondition(verdict.outcome === 'incomplete' && !verdict.checks.some(c => c.result === 'fail'));
        requireCondition(verdict.checks.every((c, i) => c.result === (i < 6 || i === 15 ? 'pass' : 'unknown')));
        requireCondition(valid());
        const original = originalInput as AlpacaIexAcquisition;
        const binding = parseSpy253ReviewBinding(bindingInput);
        const calendar = binding.evidence.calendar;
        // Missing factual evidence stays UNKNOWN, but missing structural mapping
        // cannot choose a history. C08 UNKNOWN alone is insufficient to select.
        requireCondition(calendar !== null && calendar.symbol === 'SPY' && calendar.sessions.length === 253);
        requireCondition(original.observations.length === 253 && calendar.sha256 === original.calendarSha256);
        requireCondition(original.request.start === calendar.sessions[0].providerTimestamp);
        requireCondition(original.request.end === calendar.sessions[252].providerTimestamp);
        requireCondition(calendar.sessions.every((s, i) => s.sessionOrdinal === i + 1
          && s.providerTimestamp === original.observations[252 - i].providerTimestamp
          && (i === 0 || s.providerTimestamp > calendar.sessions[i - 1].providerTimestamp)));
        const selected = original.observations.slice(0, 65).map((o, sourceIndex) => ({
          sourceIndex, sessionOrdinal: 253 - sourceIndex, providerTimestamp: o.providerTimestamp,
          close: { ...o.close },
          declaredAvailableAt: binding.evidence.availability?.[252 - sourceIndex].availableAt ?? null,
        })).reverse();
        const declared = selected.map(s => s.declaredAvailableAt);
        const declaredPrefixAvailableAt = declared.every((s): s is string => s !== null)
          ? declared.reduce((a, b) => a > b ? a : b) : null;
        const lineage = {
          allObservationsSha256: hash('all-observations', original.observations),
          request: spy253InspectionSourceRequestSchema.parse(binding.request),
          pages: binding.pages, calendarSha256: original.calendarSha256,
          declarationsSha256: hash('source-declarations', binding.evidence),
          availabilitySha256: binding.evidence.availability === null ? null : hash('availability-declarations', binding.evidence.availability),
          providerRevisionsSha256: hash('provider-revision-declarations', binding.evidence.providerRevisions),
          receivedAt: original.receivedAt, decisionAt: binding.receipt.decisionAt as '2026-10-28T13:00:00.000Z',
          declaredPrefixAvailableAt, review: verdict,
        };
        const request: Spy253PAMRInspectionRequest = {
          schema: 'gelt.spy253-pamr-inspection-request.v1', classification: 'source_inspection_only',
          recipe: { ...pamrRecipe }, assets: ['SPY-CLOSE-RELATIVE', 'DECLARED-UNIT-RESERVE'],
          selection: 'newest65_declared_calendar_compatible_reversed_to_chronological',
          initialization: 'equal_weights_at_selected_history_start', discardedCount: 188, selected,
          lineage: { ...lineage, originalSha256: spy253InspectionOriginalSha256(lineage) },
          rows: selected.slice(1).map((later, i) => [exactSpy253CloseRatio(later.close, selected[i].close), '1']),
        };
        requireCondition(valid());
        const result = replaySpy253PAMRInspectionRequest(canonical(request));
        if (result.status !== 'computed_data') return stop(result.reason);
        requireCondition(valid());
        const text = canonical(result.artifact);
        if (Buffer.byteLength(text, 'utf8') > spy253PAMRInspectionLimit) return stop('resource_limit');
        const output = Object.freeze({ status: 'computed' as const, artifact: result.artifact });
        // The final check is after computation, freezing and serialization.
        requireCondition(valid());
        retained = output;
        return output;
      } catch { return stop('invalid_source'); }
    },
    current(): Spy253PAMRInspectionResult {
      if (!valid()) { retained = undefined; return rejected('unavailable'); }
      return retained ?? rejected('unavailable');
    },
    markCancelled(): void { retained = undefined; lane.markCancelled(); },
    markPriorUncertainty(): void { retained = undefined; lane.markPriorUncertainty(); },
    markClockUnavailable(): void { retained = undefined; lane.markFixtureClockUnavailable(); },
  });
}

