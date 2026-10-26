import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodeSettlementComparison,
  encodeStatusComparison,
  parseSettlementStructure,
  parseStatusStructure,
  connectorPin,
  reviewAuthority,
  reviewLimits,
  snapshotCommit,
  type ReviewSettlementV2,
} from './alpaca-byte-review-contract.js';
import {
  constructedByteReviewProfile as profile,
} from './alpaca-byte-review-checker.js';
import {
  coordinatorReceiptLimits,
  createConstructedByteReviewCoordinator,
  createSimulatedByteReviewCoordinator,
  productionByteReviewPreflight,
  simulatedEvidenceKinds,
  type CoordinatorSnapshot,
  type SimulatedEvidenceKind,
} from './alpaca-byte-review-coordinator.js';
import { acquireAlpacaIexDailyBars } from './alpaca-iex-connector.js';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import { buildAlpacaShadowCandidate } from './alpaca-shadow-candidate.js';

type Model = ReturnType<typeof createSimulatedByteReviewCoordinator>;

function tuple(snapshot: CoordinatorSnapshot): readonly unknown[] {
  const c = snapshot.current;
  return [
    c.phase, c.outcome, c.review, c.execution, c.disposal,
    c.summaryDelivery, c.uncertainty,
  ];
}

function started(): Model {
  const model = createSimulatedByteReviewCoordinator();
  expect(model.scope).toBe('SIMULATED_ONLY');
  expect(model.startReview()).toBe(true);
  return model;
}

function favorableReleased(): Model {
  const model = started();
  expect(model.observe('verdict_all_pass')).toBe(true);
  expect(model.observe('execution_settled')).toBe(true);
  expect(model.observe('release_complete')).toBe(true);
  return model;
}

function ack(model: Model): object {
  const completion = model.recipientComplete();
  expect(completion).not.toBe(null);
  const receipt = model.acknowledge(completion);
  expect(receipt).not.toBe(null);
  return receipt!;
}

const eventNames: Readonly<Record<string, SimulatedEvidenceKind>> = {
  V: 'verdict_all_pass',
  X: 'execution_settled',
  D: 'release_complete',
  J: 'duplicate_completion',
  F: 'summary_failed',
  K: 'crashed',
  P: 'provenance_mismatch',
  T: 'timed_out',
  Z: 'cancelled',
  QX: 'execution_contradiction',
  QD: 'release_contradiction',
  H: 'horizon_unavailable',
  O: 'order_unavailable',
  U: 'execution_unknown',
  L: 'late_completion',
};

type CatalogCase = Readonly<{
  id: string;
  events: readonly string[];
  expected: readonly unknown[];
  emitted: boolean;
}>;

const catalog: readonly CatalogCase[] = [
  {
    id: 'favorable-control',
    events: ['V', 'X', 'D', 'E', 'A'],
    expected: ['summary', 'consistent_unverified', 'consistent_unverified', 'settled',
      'references_released', 'acknowledged', 'none'],
    emitted: true,
  },
  {
    id: 'late-duplicate-after-ack',
    events: ['V', 'X', 'D', 'E', 'A', 'J'],
    expected: ['summary', 'verdict_acceptance_failed', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'duplicate-before-ack',
    events: ['V', 'X', 'D', 'E', 'J', 'A'],
    expected: ['summary', 'verdict_acceptance_failed', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'queued-duplicate-before-commit',
    events: ['V', 'X', 'D', 'QUEUE_J', 'E'],
    expected: ['summary', 'verdict_acceptance_failed', 'unknown', 'settled',
      'references_released', 'not_established', 'latched'],
    emitted: true,
  },
  {
    id: 'standalone-report-failure-valid-ack',
    events: ['V', 'X', 'D', 'E', 'A', 'F'],
    expected: ['summary', 'summary_failed', 'consistent_unverified', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'standalone-report-failure-no-ack',
    events: ['V', 'X', 'D', 'E', 'F'],
    expected: ['summary', 'summary_failed', 'consistent_unverified', 'settled',
      'references_released', 'not_established', 'latched'],
    emitted: true,
  },
  {
    id: 'invalid-ack-no-valid-ack',
    events: ['V', 'X', 'D', 'E', 'IA'],
    expected: ['summary', 'summary_failed', 'consistent_unverified', 'settled',
      'references_released', 'not_established', 'latched'],
    emitted: true,
  },
  {
    id: 'ack-own-evidence-contradiction',
    events: ['V', 'X', 'D', 'E', 'A', 'QA'],
    expected: ['summary', 'summary_failed', 'consistent_unverified', 'settled',
      'references_released', 'not_established', 'latched'],
    emitted: true,
  },
  {
    id: 'valid-ack-after-report-failure',
    events: ['V', 'X', 'D', 'E', 'F', 'A'],
    expected: ['summary', 'summary_failed', 'consistent_unverified', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'invalid-ack-alongside-valid-ack',
    events: ['V', 'X', 'D', 'E', 'A', 'IA'],
    expected: ['summary', 'summary_failed', 'consistent_unverified', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'report-failure-plus-crash',
    events: ['V', 'X', 'D', 'E', 'A', 'F', 'K'],
    expected: ['summary', 'crashed', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'report-failure-plus-provenance',
    events: ['V', 'X', 'D', 'E', 'A', 'F', 'P'],
    expected: ['summary', 'provenance_mismatch', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'report-failure-plus-acceptance-failure',
    events: ['V', 'X', 'D', 'E', 'A', 'F', 'J'],
    expected: ['summary', 'verdict_acceptance_failed', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'unknown-cancel-completion-order',
    events: ['O', 'Z', 'BLOCKED_V', 'U', 'E'],
    expected: ['summary', 'cancelled', 'unknown', 'unknown',
      'not_established', 'not_established', 'latched'],
    emitted: true,
  },
  {
    id: 'timeout-then-late-completion',
    events: ['T', 'U', 'E', 'L', 'X', 'D', 'A'],
    expected: ['summary', 'timed_out', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'execution-own-evidence-contradiction',
    events: ['V', 'X', 'D', 'E', 'A', 'QX'],
    expected: ['summary', 'unknown', 'unknown', 'unknown',
      'not_established', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'release-own-evidence-contradiction',
    events: ['V', 'X', 'D', 'E', 'A', 'QD'],
    expected: ['summary', 'disposal_not_established', 'consistent_unverified', 'settled',
      'not_established', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'horizon-unavailable',
    events: ['V', 'X', 'D', 'E', 'A', 'H'],
    expected: ['summary', 'unknown', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'invalid-tuple-does-not-drop-duplicate',
    events: ['V', 'X', 'D', 'E', 'A', 'J', 'BAD_C'],
    expected: ['summary', 'verdict_acceptance_failed', 'unknown', 'settled',
      'references_released', 'acknowledged', 'latched'],
    emitted: true,
  },
  {
    id: 'pending-execution-cannot-emit',
    events: ['Z', 'PENDING', 'NO_E'],
    expected: ['review', 'cancelled', 'pending', 'pending',
      'not_established', 'not_attempted', 'latched'],
    emitted: false,
  },
  {
    id: 'preflight-handling-missing',
    events: ['PREFLIGHT'],
    expected: ['preflight', 'unavailable', 'not_attempted', 'not_started',
      'not_established', 'not_attempted', 'latched'],
    emitted: false,
  },
];

describe('SIMULATED ONLY: all 21 conditional lifecycle catalog cases', () => {
  it.each(catalog)('$id', example => {
    const model = example.id === 'preflight-handling-missing'
      ? createSimulatedByteReviewCoordinator() : started();
    let emittedBytes: string | undefined;
    let emittedSource: string | undefined;
    let emittedObject: object | undefined;
    let acknowledgement: object | undefined;

    for (const event of example.events) {
      const before = model.snapshot();
      switch (event) {
        case 'E': {
          const emitted = model.commitEmission();
          expect(emitted).not.toBe(null);
          emittedBytes = emitted!.bytes;
          emittedSource = encodeSettlementComparison(emitted!.source);
          emittedObject = emitted!;
          break;
        }
        case 'A':
          acknowledgement = ack(model);
          break;
        case 'QA':
          expect(model.contradictAcknowledgement(acknowledgement)).toBe(true);
          break;
        case 'IA':
          expect(model.acknowledge({
            schema: 'gelt.byte-review-summary-ack.v2',
            attemptId: model.attemptId,
            delivery: 'acknowledged',
          })).toBe(null);
          break;
        case 'QUEUE_J':
          expect(model.queue('duplicate_completion')).toBe(true);
          break;
        case 'BLOCKED_V':
          expect(model.observe('verdict_all_pass')).toBe(false);
          break;
        case 'BAD_C':
          expect(model.acceptsSettlementCandidate({
            ...model.snapshot().current,
            invocationId: null,
            outcome: 'consistent_unverified',
            review: 'unknown',
          })).toBe(false);
          break;
        case 'PENDING':
          expect(model.observe('execution_pending')).toBe(true);
          break;
        case 'NO_E':
          expect(model.reserveEmission()).toBe(false);
          expect(model.commitEmission()).toBe(null);
          break;
        case 'PREFLIGHT':
          expect(model.observe('preflight_unavailable')).toBe(true);
          break;
        default:
          expect(model.observe(eventNames[event])).toBe(true);
      }
      const after = model.snapshot();
      expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
      expect(parseSettlementStructure(after.current)).toEqual(after.current);
      if (emittedBytes !== undefined) {
        expect(after.emitted).toBe(emittedObject);
        expect(after.emitted!.bytes).toBe(emittedBytes);
        expect(encodeSettlementComparison(after.emitted!.source)).toBe(emittedSource);
        expect(after.emitted!.status.summaryDelivery).toBe('not_established');
        expect(Object.isFrozen(after.emitted)).toBe(true);
      }
    }
    const final = model.snapshot();
    expect(tuple(final)).toEqual(example.expected);
    expect(final.emitted !== null).toBe(example.emitted);
    expect(final.captureReservations).toBeLessThanOrEqual(1);
    expect(final.invocationReservations).toBeLessThanOrEqual(1);
    expect(final.emissionReservations).toBeLessThanOrEqual(1);
    expect(final.handoffAttempts).toBeLessThanOrEqual(1);
    expect(model.startReview()).toBe(false);
    if (final.emissionReservations === 1 || final.current.execution === 'pending') {
      expect(model.commitEmission()).toBe(null);
    }
    if (final.emitted) {
      expect(parseStatusStructure(final.emitted.status)).toEqual(final.emitted.status);
      expect(final.emitted.bytes).toBe(encodeStatusComparison(final.emitted.status));
      expect(Buffer.byteLength(final.emitted.bytes, 'utf8')).toBeLessThanOrEqual(1024);
      expect(final.emitted.status).toMatchObject({
        decision: 'abstain',
        reason: 'unverified_data',
        eligibility: 'unverified',
        effectAuthority: 'none',
        promotionAllowed: false,
        retryAllowed: false,
      });
    }
  });
});

describe('finite predicate, independent evidence and irreversible boundaries', () => {
  it('permits one B0 failure summary without capture or review dispatch', () => {
    const model = createSimulatedByteReviewCoordinator();
    expect(model.observe('preflight_unavailable')).toBe(true);
    expect(model.snapshot().emitted).toBe(null);
    const emitted = model.commitEmission();
    expect(emitted?.status).toMatchObject({
      outcome: 'unavailable', review: 'not_attempted', execution: 'not_started',
      decision: 'abstain', effectAuthority: 'none', promotionAllowed: false,
    });
    expect(model.snapshot()).toMatchObject({
      captureReservations: 0, invocationReservations: 0,
      emissionReservations: 1, handoffAttempts: 1,
    });
    expect(model.commitEmission()).toBe(null);
  });

  it('does not confuse verdict completion, cancellation or local return with settlement', () => {
    const model = started();
    model.observe('verdict_all_pass');
    expect(model.snapshot().current.execution).toBe('pending');
    expect(model.commitEmission()).toBe(null);
    model.observe('execution_settled');
    expect(model.snapshot().current.phase).toBe('release');
    expect(model.snapshot().current.disposal).toBe('not_established');
    expect(model.reserveEmission()).toBe(false); // C0, not a reportable source.
    model.observe('release_failed');
    expect(model.reserveEmission()).toBe(true); // C1.
    expect(model.commitEmission()?.status.outcome).toBe('disposal_not_established');
  });

  it('does not restore favorable treatment after timeout and later own-fact receipts', () => {
    const model = started();
    model.observe('timed_out');
    model.observe('execution_unknown');
    model.commitEmission();
    const bytes = model.snapshot().emitted!.bytes;
    model.observe('late_completion');
    model.observe('execution_settled');
    model.observe('release_complete');
    ack(model);
    expect(model.snapshot()).toMatchObject({
      favorableCurrent: false,
      current: {
        outcome: 'timed_out',
        review: 'unknown',
        execution: 'settled',
        disposal: 'references_released',
        summaryDelivery: 'acknowledged',
        uncertainty: 'latched',
      },
    });
    expect(model.snapshot().emitted!.bytes).toBe(bytes);
  });

  it('drains reentrant known adverse evidence before the immutable commit', () => {
    const model = favorableReleased();
    model.simulateReentrantBoundary('duplicate_completion');
    const emitted = model.commitEmission();
    expect(emitted?.status.outcome).toBe('verdict_acceptance_failed');
    expect(emitted?.status.review).toBe('unknown');
    expect(model.snapshot().receipts.some(receipt =>
      receipt.kind === 'duplicate_completion' && receipt.knownQueued)).toBe(true);
    expect(model.snapshot().emissionReservations).toBe(1);
    expect(model.snapshot().handoffAttempts).toBe(1);
    expect(model.commitEmission()).toBe(null);
  });

  it('consumes the slot when updated evidence makes commit nonreportable', () => {
    const model = started();
    model.observe('timed_out');
    model.observe('execution_unknown');
    expect(model.reserveEmission()).toBe(true);
    model.observe('execution_settled'); // C0: release accounting is still pending.
    expect(model.commitEmission()).toBe(null);
    model.observe('release_complete');
    expect(model.commitEmission()).toBe(null);
    expect(model.snapshot()).toMatchObject({
      emitted: null,
      emissionReservations: 1,
      handoffAttempts: 0,
      current: { phase: 'summary', outcome: 'timed_out', uncertainty: 'latched' },
    });
  });

  it('does not invent E or retry an uncertain handoff', () => {
    const model = favorableReleased();
    model.simulateUncertainHandoff();
    expect(model.commitEmission()).toBe(null);
    expect(model.commitEmission()).toBe(null);
    expect(model.recipientComplete()).toBe(null);
    expect(model.snapshot()).toMatchObject({
      emitted: null,
      emissionReservations: 1,
      handoffAttempts: 1,
      current: { outcome: 'summary_failed', uncertainty: 'latched' },
    });
  });

  it('preserves a separate valid acknowledgement when another proof is contradicted', () => {
    const model = favorableReleased();
    model.commitEmission();
    const first = ack(model);
    ack(model);
    expect(model.contradictAcknowledgement(first)).toBe(true);
    expect(model.snapshot().current).toMatchObject({
      outcome: 'summary_failed',
      summaryDelivery: 'acknowledged',
      execution: 'settled',
      disposal: 'references_released',
      uncertainty: 'latched',
    });
    expect(model.snapshot().receipts.filter(receipt => receipt.kind === 'acknowledged'))
      .toHaveLength(2);
  });

  it('rejects cross-attempt recipient completion and fabricated contradiction handles', () => {
    const first = favorableReleased();
    const second = favorableReleased();
    first.commitEmission();
    second.commitEmission();
    const completion = first.recipientComplete();
    expect(second.acknowledge(completion)).toBe(null);
    expect(second.snapshot().current.summaryDelivery).toBe('not_established');
    expect(second.snapshot().current.outcome).toBe('summary_failed');
    expect(first.acknowledge(completion)).not.toBe(null);
    expect(first.contradictAcknowledgement({ sequence: 1 })).toBe(false);
  });

  it('retains rejection/incomplete vector algebra without making all uncertainty an authentic rejection', () => {
    for (const kind of [
      'verdict_incomplete', 'verdict_rejected', 'verdict_rejected_unknown',
    ] as const) {
      const model = started();
      model.observe(kind);
      const verdict = model.snapshot().historicalVerdicts[0];
      expect(verdict.checks).toHaveLength(16);
      expect(verdict.outcome).toBe(kind === 'verdict_incomplete' ? 'incomplete' : 'rejected');
      expect(model.snapshot().current.uncertainty)
        .toBe(kind === 'verdict_rejected' ? 'none' : 'latched');
    }
    const invalid = started();
    invalid.observe('verdict_invalid');
    expect(invalid.snapshot().historicalVerdicts).toHaveLength(0);
    expect(invalid.snapshot().current).toMatchObject({
      outcome: 'verdict_acceptance_failed', review: 'unknown', uncertainty: 'latched',
    });
  });

  it('preserves repaired release evidence on corroborating settlement observations', () => {
    const model = favorableReleased();
    const emitted = model.commitEmission()!;
    ack(model);
    model.observe('release_failed');
    const before = model.snapshot().receipts;
    model.observe('release_complete');
    model.observe('execution_settled');
    expect(model.snapshot().current).toMatchObject({
      outcome: 'unknown', review: 'unknown', execution: 'settled',
      disposal: 'references_released', summaryDelivery: 'acknowledged',
      uncertainty: 'latched',
    });
    expect(model.snapshot().receipts.slice(0, before.length)).toEqual(before);
    expect(model.snapshot().receipts.some(r => r.kind === 'release_failed')).toBe(true);
    expect(model.snapshot().emitted).toBe(emitted);
    expect(model.snapshot().emitted!.bytes).toBe(emitted.bytes);
    expect(model.snapshot().favorableCurrent).toBe(false);
    expect(model.commitEmission()).toBe(null);
  });

  it('keeps higher failures and independent dimension facts in either reporting-failure order', () => {
    for (const adverse of [
      'crashed', 'provenance_mismatch', 'authenticity_failed', 'duplicate_completion',
    ] as const) {
      for (const reportingFirst of [true, false]) {
        const model = favorableReleased();
        model.commitEmission();
        ack(model);
        const pair: SimulatedEvidenceKind[] = reportingFirst
          ? ['summary_failed', adverse] : [adverse, 'summary_failed'];
        pair.forEach(event => model.observe(event));
        expect(model.snapshot().current.execution).toBe('settled');
        expect(model.snapshot().current.disposal).toBe('references_released');
        expect(model.snapshot().current.summaryDelivery).toBe('acknowledged');
        expect(model.snapshot().current.outcome).not.toBe('summary_failed');
        expect(model.snapshot().receipts.some(r => r.kind === 'summary_failed')).toBe(true);
        expect(model.snapshot().receipts.some(r => r.kind === adverse)).toBe(true);
      }
    }
  });

  it('treats newly pending work after full settlement as conflicting evidence, not a restart', () => {
    const model = favorableReleased();
    model.commitEmission();
    ack(model);
    model.observe('execution_pending');
    expect(model.snapshot().current).toMatchObject({
      outcome: 'unknown', review: 'unknown', execution: 'unknown',
      disposal: 'not_established', summaryDelivery: 'acknowledged',
      uncertainty: 'latched',
    });
    expect(model.snapshot().captureReservations).toBe(1);
    expect(model.snapshot().invocationReservations).toBe(1);
  });

  it('keeps admitted history and protected adverse effects at finite capacity', () => {
    const model = favorableReleased();
    model.commitEmission();
    ack(model);
    while (model.snapshot().receipts.length < coordinatorReceiptLimits.ordinary) {
      expect(model.observe('summary_failed')).toBe(true);
    }
    const prefix = model.snapshot().receipts;
    expect(model.observe('summary_failed')).toBe(false);
    expect(model.snapshot().capacityUnavailable).toBe(true);
    expect(model.snapshot().receipts.slice(0, prefix.length)).toEqual(prefix);
    expect(model.snapshot().receipts.some(r => r.kind === 'overflow')).toBe(true);
    expect(model.observe('crashed')).toBe(true);
    expect(model.snapshot().current.outcome).toBe('crashed');
    expect(model.snapshot().current.summaryDelivery).toBe('acknowledged');
    expect(model.observe('crashed')).toBe(false); // Explicitly not another admitted receipt.
    expect(model.observe('release_complete')).toBe(false);
    expect(model.snapshot().receipts.length).toBeLessThanOrEqual(
      coordinatorReceiptLimits.ordinary + coordinatorReceiptLimits.protected,
    );
    expect(model.snapshot().favorableCurrent).toBe(false);
  });

  it('rejects malformed or stale settlement candidates without overwriting R or C', () => {
    const model = favorableReleased();
    model.commitEmission();
    const stale = model.snapshot().current;
    model.observe('duplicate_completion');
    const before = model.snapshot();
    expect(model.acceptsSettlementCandidate(stale)).toBe(false);
    expect(model.acceptsSettlementCandidate({ ...before.current, debug: true })).toBe(false);
    expect(model.acceptsSettlementCandidate(before.current)).toBe(true);
    expect(model.snapshot().receipts).toEqual(before.receipts);
    expect(model.snapshot().current).toEqual(before.current);
  });
});

describe('SIMULATED ONLY: capacity reservation and current-proof contradictions', () => {
  function fillTo(model: Model, count: number): void {
    for (let i = 0; i < coordinatorReceiptLimits.ordinary; i++) {
      if (model.snapshot().receipts.length >= count) break;
      expect(model.observe('execution_settled')).toBe(true);
    }
    expect(model.snapshot().receipts).toHaveLength(count);
  }

  function overflow(model: Model): void {
    for (let i = 0; i <= coordinatorReceiptLimits.ordinary; i++) {
      if (model.snapshot().capacityUnavailable) break;
      model.observe('execution_settled');
    }
    expect(model.snapshot().capacityUnavailable).toBe(true);
  }

  it.each([62, 63, 64])('projects all bookkeeping capacity effects before commit at %s receipts', count => {
    const model = favorableReleased();
    fillTo(model, count);
    const before = model.snapshot().receipts;
    const emitted = model.commitEmission();
    expect(emitted).not.toBe(null);
    const after = model.snapshot();
    expect(emitted!.source).toEqual(after.current);
    expect(encodeSettlementComparison(emitted!.source))
      .toBe(encodeSettlementComparison(after.current));
    expect(after.receipts.slice(0, before.length)).toEqual(before);
    expect(after.receipts.filter(r => r.kind === 'summary_committed')).toHaveLength(1);
    expect(after.receipts.filter(r => r.kind === 'summary_reserved')).toHaveLength(1);
    expect(after.handoffAttempts).toBe(1);
    if (count === 62) {
      expect(after.capacityUnavailable).toBe(false);
      expect(emitted!.status.outcome).toBe('consistent_unverified');
      expect(after.favorableCurrent).toBe(true);
    } else {
      expect(after.capacityUnavailable).toBe(true);
      expect(emitted!.status.outcome).toBe('unknown');
      expect(after.favorableCurrent).toBe(false);
      const overflowIndex = after.receipts.findIndex(r => r.kind === 'overflow');
      const commitIndex = after.receipts.findIndex(r => r.kind === 'summary_committed');
      expect(overflowIndex).toBeLessThan(commitIndex);
    }
    expect(model.commitEmission()).toBe(null);
    expect(model.reserveEmission()).toBe(false);
  });

  it('folds queued invalidation and overflow together before handoff', () => {
    const model = favorableReleased();
    fillTo(model, 63);
    model.simulateReentrantBoundary('duplicate_completion');
    const emitted = model.commitEmission()!;
    const after = model.snapshot();
    expect(emitted.source).toEqual(after.current);
    expect(emitted.status.outcome).toBe('verdict_acceptance_failed');
    expect(after.receipts.some(r =>
      r.kind === 'duplicate_completion' && r.knownQueued)).toBe(true);
    expect(after.receipts.some(r => r.kind === 'overflow')).toBe(true);
    expect(after.emissionReservations).toBe(1);
    expect(after.handoffAttempts).toBe(1);
  });

  it('does not publish a prepared commit record on uncertain handoff at capacity', () => {
    const model = favorableReleased();
    fillTo(model, 63);
    model.simulateUncertainHandoff();
    expect(model.commitEmission()).toBe(null);
    const after = model.snapshot();
    expect(after.emitted).toBe(null);
    expect(after.receipts.some(r => r.kind === 'summary_committed')).toBe(false);
    expect(after.receipts.some(r => r.kind === 'summary_failed')).toBe(true);
    expect(after.current.outcome).toBe('summary_failed');
    expect(after.handoffAttempts).toBe(1);
    expect(model.recipientComplete()).toBe(null);
    expect(model.commitEmission()).toBe(null);
  });

  it.each(['execution_contradiction', 'release_contradiction'] as const)(
    'retains %s against a renewed proof after ordinary capacity is exhausted',
    kind => {
      const model = favorableReleased();
      const emitted = model.commitEmission()!;
      ack(model);
      expect(model.observe(kind)).toBe(true);
      if (kind === 'execution_contradiction') {
        expect(model.observe('execution_settled')).toBe(true);
      }
      expect(model.observe('release_complete')).toBe(true);
      const first = model.snapshot().receipts.find(r => r.kind === kind)!;
      overflow(model);
      const prefix = model.snapshot().receipts;
      expect(model.observe(kind)).toBe(true);
      const after = model.snapshot();
      const contradictions = after.receipts.filter(r => r.kind === kind);
      expect(contradictions).toHaveLength(2);
      expect(contradictions[1].target).not.toBe(contradictions[0].target);
      expect(contradictions[1].target).not.toBe(first.target);
      expect(after.receipts.slice(0, prefix.length)).toEqual(prefix);
      expect(after.current).toMatchObject({
        execution: kind === 'execution_contradiction' ? 'unknown' : 'settled',
        disposal: 'not_established',
        summaryDelivery: 'acknowledged',
        uncertainty: 'latched',
      });
      expect(after.emitted).toBe(emitted);
      expect(after.emitted!.bytes).toBe(emitted.bytes);
      expect(model.observe('execution_settled')).toBe(false);
      expect(model.observe('release_complete')).toBe(false);
      expect(model.observe(kind)).toBe(false);
      expect(model.snapshot().current.disposal).toBe('not_established');
      expect(model.snapshot().receipts.length).toBeLessThanOrEqual(104);
    },
  );

  it.each(['execution_unknown', 'execution_pending', 'release_failed'] as const)(
    'does not lose the current own-fact effect of %s at capacity',
    kind => {
      const model = favorableReleased();
      const emitted = model.commitEmission()!;
      ack(model);
      expect(model.observe(kind)).toBe(true);
      if (kind !== 'release_failed') model.observe('execution_settled');
      model.observe('release_complete');
      overflow(model);
      expect(model.observe(kind)).toBe(true);
      const after = model.snapshot();
      expect(after.current).toMatchObject({
        execution: kind === 'release_failed' ? 'settled' : 'unknown',
        disposal: 'not_established',
        summaryDelivery: 'acknowledged',
        uncertainty: 'latched',
      });
      expect(after.emitted).toBe(emitted);
    },
  );

  it.each([0, 50])('requires fresh accounting for a renewed proof after %s release fillers', fillers => {
    const model = favorableReleased();
    for (let i = 0; i < fillers; i++) expect(model.observe('release_complete')).toBe(true);
    expect(model.observe('release_failed')).toBe(true);
    const oldFailure = model.snapshot().receipts.at(-1)!;
    expect(model.observe('execution_contradiction')).toBe(true);
    expect(model.observe('release_contradiction')).toBe(true);
    expect(model.observe('execution_settled')).toBe(true);
    const before = model.snapshot();
    expect(before.current).toMatchObject({
      execution: 'settled', disposal: 'not_established', uncertainty: 'latched',
    });
    expect(model.reserveEmission()).toBe(false);
    expect(model.commitEmission()).toBe(null);
    expect(model.snapshot().emissionReservations).toBe(0);
    if (fillers === 0) {
      expect(model.observe('release_complete')).toBe(true);
    } else {
      expect(model.observe('release_complete')).toBe(false);
      expect(model.observe('release_failed')).toBe(true);
      const latest = model.snapshot().receipts.at(-1)!;
      expect(latest.kind).toBe('release_failed');
      expect(latest.target).not.toBe(oldFailure.target);
      expect(model.snapshot().capacityUnavailable).toBe(true);
    }
    expect(model.reserveEmission()).toBe(true);
    const emitted = model.commitEmission()!;
    const after = model.snapshot();
    expect(emitted.source).toEqual(after.current);
    expect(after.current).toMatchObject({
      outcome: fillers === 0 ? 'unknown' : 'disposal_not_established',
      execution: 'settled',
      disposal: fillers === 0 ? 'references_released' : 'not_established',
      uncertainty: 'latched',
    });
    expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
    expect(after.receipts).toContain(oldFailure);
    expect(after.receipts.length).toBeLessThanOrEqual(104);
    expect(after.handoffAttempts).toBe(1);
    expect(model.commitEmission()).toBe(null);
  });

  it('keeps both out-of-order recipient completions distinct at capacity', () => {
    const model = favorableReleased();
    model.commitEmission();
    const first = model.recipientComplete();
    const second = model.recipientComplete();
    expect(first).not.toBe(null);
    expect(second).not.toBe(null);
    overflow(model);
    const secondAck = model.acknowledge(second);
    const firstAck = model.acknowledge(first);
    expect(firstAck).not.toBe(null);
    expect(secondAck).not.toBe(null);
    const acknowledgements = model.snapshot().receipts.filter(r => r.kind === 'acknowledged');
    expect(acknowledgements).toHaveLength(2);
    expect(new Set(acknowledgements.map(r => r.target)).size).toBe(2);
    expect(model.contradictAcknowledgement(secondAck)).toBe(true);
    expect(model.snapshot().current.summaryDelivery).toBe('acknowledged');
    expect(model.contradictAcknowledgement(firstAck)).toBe(true);
    expect(model.snapshot().current.summaryDelivery).toBe('not_established');
    expect(model.recipientComplete()).toBe(null);
  });

  it('bounds protected adverse admission without suppressing new dimension effects', () => {
    const model = favorableReleased();
    model.commitEmission();
    const first = ack(model);
    const second = ack(model);
    overflow(model);
    const before = model.snapshot().receipts;
    for (let repetition = 0; repetition < 3; repetition++) {
      for (const kind of [
        'summary_failed', 'duplicate_completion', 'authenticity_failed',
        'verdict_invalid', 'provenance_mismatch', 'timed_out', 'cancelled',
        'crashed', 'order_unavailable', 'horizon_unavailable',
        'execution_contradiction', 'execution_unknown', 'execution_pending',
        'release_contradiction', 'late_completion',
      ] as const) {
        model.observe(kind);
        expect(() => model.snapshot()).not.toThrow();
      }
      model.contradictAcknowledgement(first);
      model.contradictAcknowledgement(second);
    }
    const after = model.snapshot();
    expect(after.receipts.slice(0, before.length)).toEqual(before);
    expect(after.receipts.filter(r => r.kind === 'overflow')).toHaveLength(1);
    expect(after.receipts.length).toBeLessThanOrEqual(
      coordinatorReceiptLimits.ordinary + coordinatorReceiptLimits.protected,
    );
    expect(after.current).toMatchObject({
      outcome: 'crashed', review: 'unknown', execution: 'unknown',
      disposal: 'not_established', summaryDelivery: 'not_established',
      uncertainty: 'latched',
    });
    expect(after.favorableCurrent).toBe(false);
    expect(after.handoffAttempts).toBe(1);
  });
});

describe('SIMULATED ONLY: total evidence projection around summary reservation', () => {
  it('retains pending conflict after timeout and unresolved reservation without throwing', () => {
    const model = started();
    model.observe('timed_out');
    model.observe('execution_unknown');
    expect(model.reserveEmission()).toBe(true);
    const before = model.snapshot();
    expect(model.observe('execution_pending')).toBe(true);
    const after = model.snapshot();
    expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
    expect(after.receipts.at(-1)?.kind).toBe('execution_pending');
    expect(after.current).toMatchObject({
      phase: 'summary', outcome: 'timed_out', review: 'unknown',
      execution: 'unknown', disposal: 'not_established', uncertainty: 'latched',
    });
    expect(parseSettlementStructure(after.current)).toEqual(after.current);
    expect(model.acceptsSettlementCandidate({
      ...after.current, execution: 'pending',
    })).toBe(false);
    expect(model.reserveEmission()).toBe(false);
    expect(model.commitEmission()).toBe(null);
    model.observe('execution_settled');
    model.observe('release_complete');
    expect(model.commitEmission()).toBe(null);
    expect(model.snapshot()).toMatchObject({
      emitted: null, emissionReservations: 1, handoffAttempts: 0,
    });
  });

  it('does not carry an old release assessment across lost execution proof', () => {
    const model = favorableReleased();
    model.observe('release_failed');
    const releaseFailure = model.snapshot().receipts.at(-1)!;
    model.observe('execution_contradiction');
    const unresolved = model.snapshot();
    expect(unresolved.current).toMatchObject({
      phase: 'verdict', outcome: 'unknown', review: 'unknown',
      execution: 'unknown', disposal: 'not_established', uncertainty: 'latched',
    });
    expect(unresolved.receipts).toContain(releaseFailure);
    model.observe('execution_settled');
    expect(model.snapshot().current).toMatchObject({
      phase: 'release', execution: 'settled', disposal: 'not_established',
      uncertainty: 'latched',
    });
    expect(model.reserveEmission()).toBe(false);
    model.observe('release_complete');
    expect(model.reserveEmission()).toBe(true);
    expect(model.snapshot().current.uncertainty).toBe('latched');
  });

  it('does not assess a renewed execution proof by contradicting an older release proof', () => {
    const model = favorableReleased();
    model.observe('execution_contradiction');
    model.observe('execution_settled');
    expect(model.observe('release_contradiction')).toBe(true);
    const before = model.snapshot();
    expect(model.reserveEmission()).toBe(false);
    expect(model.snapshot().receipts).toEqual(before.receipts);
    expect(model.observe('release_failed')).toBe(true);
    expect(model.reserveEmission()).toBe(true);
    expect(model.commitEmission()?.status.outcome).toBe('disposal_not_established');
    expect(model.snapshot().current.execution).toBe('settled');
    expect(model.snapshot().receipts.filter(r => r.kind === 'release_contradiction')).toHaveLength(1);
    expect(model.snapshot().receipts.some(r => r.kind === 'provenance_mismatch')).toBe(false);
  });

  it.each(['verdict_incomplete', 'verdict_rejected', 'reviewer_error'] as const)(
    'projects late completion after %s without an invalid review tuple',
    kind => {
      const model = started();
      model.observe(kind);
      const history = model.snapshot().historicalVerdicts;
      model.observe('late_completion');
      model.observe('execution_unknown');
      expect(model.snapshot().current).toMatchObject({
        outcome: 'unknown', review: 'unknown', execution: 'unknown',
        disposal: 'not_established', uncertainty: 'latched',
      });
      expect(model.snapshot().historicalVerdicts).toEqual(history);
      expect(parseSettlementStructure(model.snapshot().current))
        .toEqual(model.snapshot().current);
    },
  );

  it.each(['released', 'unresolved', 'preflight'] as const)(
    'has a defined post-reservation projection for every finite evidence kind from %s',
    seed => {
      for (const kind of simulatedEvidenceKinds) {
        const model = seed === 'released' ? favorableReleased()
          : seed === 'unresolved' ? started() : createSimulatedByteReviewCoordinator();
        if (seed === 'released') {
          model.commitEmission();
          ack(model);
        } else if (seed === 'unresolved') {
          model.observe('timed_out');
          model.observe('execution_unknown');
          model.reserveEmission();
        } else {
          model.observe('preflight_unavailable');
          model.reserveEmission();
        }
        const before = model.snapshot();
        expect(() => model.observe(kind)).not.toThrow();
        const after = model.snapshot();
        expect(parseSettlementStructure(after.current)).toEqual(after.current);
        expect(after.current.phase).toBe('summary');
        expect(after.current.execution).not.toBe('pending');
        expect(after.current.review).not.toBe('pending');
        expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
        expect(after.emissionReservations).toBe(1);
        if (before.emitted) {
          expect(after.emitted).toBe(before.emitted);
          expect(after.emitted!.bytes).toBe(before.emitted.bytes);
        }
        expect(model.reserveEmission()).toBe(false);
      }
    },
  );
});

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function constructedFixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(profile.receivedAt));
  const coordinator = createConstructedByteReviewCoordinator();
  const capture = coordinator.beginCapture();
  expect(capture).not.toBe(null);
  const hash = 'a'.repeat(64);
  const sessions = [profile.request.start, profile.request.end].map(
    (providerTimestamp, sessionOrdinal) => ({
      providerTimestamp,
      sessionOrdinal,
      closedAt: providerTimestamp,
      completedAt: providerTimestamp,
      completed: true as const,
      completionEvidenceSha256: hash,
    }),
  );
  const calendar = {
    symbol: profile.request.symbol,
    sessions,
    sha256: alpacaSessionCalendarDigest({ symbol: profile.request.symbol, sessions }),
  };
  const fetcher: typeof fetch = vi.fn(async input => {
    const url = new URL(String(input));
    expect(url.searchParams.get('symbols')).toBe(profile.request.symbol);
    return new Response(
      url.searchParams.has('page_token') ? profile.pageBodies[1] : profile.pageBodies[0],
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const original = await acquireAlpacaIexDailyBars({
    enabled: true,
    symbol: profile.request.symbol,
    feed: 'iex',
    adjustment: 'raw',
    start: profile.request.start,
    end: profile.request.end,
    asof: profile.request.asof,
    calendar,
  }, {
    keyId: 'SYNTHETIC_KEY_ID_123456',
    secretKey: 'SYNTHETIC_SECRET_12345678901234567890',
  }, { fetcher });
  const availability = sessions.map(session => ({
    providerTimestamp: session.providerTimestamp,
    availableAt: original.receivedAt,
    evidenceSha256: hash,
  }));
  const context = {
    runId: coordinator.attemptId,
    sourceCommit: '9'.repeat(40),
    expectedCalendarSha256: calendar.sha256,
    expectedWindow: { firstSessionOrdinal: 0, lastSessionOrdinal: 1, observationCount: 2 },
    rightsEvidenceSha256: hash,
    policy: {
      scheduleSha256: hash,
      maxAgeMs: 0,
      exposureCap: { value: '1', precision: 1, scale: 0 },
    },
    costs: {
      status: 'unverified',
      evidenceSha256: hash,
      stressScenarioSha256: hash,
      commissionPerTrade: { value: '0', precision: 1, scale: 0 },
      spreadFraction: { value: '0', precision: 1, scale: 0 },
      slippageFraction: { value: '0', precision: 1, scale: 0 },
    },
    controls: { passiveSha256: hash, cashAssumptionSha256: hash },
    portfolio: { state: 'unknown', snapshotSha256: hash },
  };
  const built = buildAlpacaShadowCandidate(original, {
    source: 'alpaca-data-v2',
    feed: 'iex',
    symbol: profile.request.symbol,
    adjustment: 'raw',
    asof: profile.request.asof,
    calendar,
    availability,
    receivedAt: original.receivedAt,
    decisionAt: original.receivedAt,
  }, context);
  if (built.status !== 'candidate') throw new Error('Constructed fixture unavailable');
  const binding = copy({
    schema: 'gelt.review-before-discard-binding.v1',
    attemptId: coordinator.attemptId,
    revisions: { ...profile.revisions },
    source: {
      repositoryId: 1415613140,
      snapshotCommit,
      connectorPin: { ...connectorPin },
      runtimeClosureRevision: profile.runtimeClosureRevision,
    },
    request: original.request,
    receipt: { receivedAt: original.receivedAt, decisionAt: original.receivedAt },
    pages: original.pages.map(({ page, byteLength, sha256 }) => ({ page, byteLength, sha256 })),
    evidence: {
      calendar,
      availability,
      context,
      candidateCanonicalInput: built.canonicalInput,
      candidateReceipt: built.receipt,
      candidateManifest: built.manifest,
    },
    limits: { ...reviewLimits },
    authority: { ...reviewAuthority },
  });
  return { coordinator, capture: capture!, original, binding, candidate: copy(built), fetcher };
}

afterEach(() => vi.useRealTimers());

describe('private constructed checker integration, never simulated all-pass admission', () => {
  it('reserves before work, retains authentic incomplete metadata and leaves settlement unproved', async () => {
    const f = await constructedFixture();
    expect(f.coordinator.reserveReview(f.capture, f.original, f.binding, f.candidate)).toBe(true);
    expect(f.coordinator.completeReview()).toBe(true);
    const snapshot = f.coordinator.snapshot();
    expect(snapshot.scope).toBe('CONSTRUCTED_ONLY');
    expect(snapshot.historicalVerdicts).toHaveLength(1);
    expect(snapshot.historicalVerdicts[0].outcome).toBe('incomplete');
    for (const id of ['C07_CLOSURE_REVISIONS', 'C13_REVIEWER_ADMISSION', 'C14_HANDLING']) {
      expect(snapshot.historicalVerdicts[0].checks.find(check => check.id === id)?.result)
        .toBe('unknown');
    }
    expect(snapshot.current).toMatchObject({
      invocationId: f.coordinator.invocationId,
      outcome: 'incomplete',
      review: 'incomplete',
      execution: 'unknown',
      disposal: 'not_established',
      uncertainty: 'latched',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(snapshot.captureReservations).toBe(1);
    expect(snapshot.invocationReservations).toBe(1);
  });

  it('rejects a cloned original before invocation reservation or reviewer dispatch', async () => {
    const f = await constructedFixture();
    expect(f.coordinator.reserveReview(
      f.capture, copy(f.original), f.binding, f.candidate,
    )).toBe(false);
    const after = f.coordinator.snapshot();
    expect(after.current).toMatchObject({
      invocationId: null, outcome: 'provenance_mismatch',
      review: 'not_attempted', execution: 'unknown', uncertainty: 'latched',
    });
    expect(after.invocationReservations).toBe(0);
    expect(after.historicalVerdicts).toHaveLength(0);
    expect(after.receipts.some(r => r.kind === 'reviewer_error')).toBe(false);
    expect(after.receipts.some(r => r.kind === 'review_dispatched')).toBe(false);
    expect(f.coordinator.completeReview()).toBe(false);
    expect(f.coordinator.beginCapture()).toBe(null);
  });

  it('preserves authenticated verdict metadata when local checker references are dropped', async () => {
    const f = await constructedFixture();
    f.coordinator.reserveReview(f.capture, f.original, f.binding, f.candidate);
    f.coordinator.completeReview();
    const historical = f.coordinator.snapshot().historicalVerdicts[0];
    expect(f.coordinator.dropLocalCheckerReferences()).toBe(true);
    const after = f.coordinator.snapshot();
    expect(after.historicalVerdicts[0]).toBe(historical);
    expect(after.current.execution).toBe('unknown');
    expect(after.current.disposal).toBe('not_established');
    expect(f.coordinator.dropLocalCheckerReferences()).toBe(false);
    const emitted = f.coordinator.commitEmission();
    expect(emitted?.status.outcome).toBe('incomplete');
    expect(emitted?.status.disposal).toBe('not_established');
  });

  it('incorporates queued cancellation before private completion acceptance', async () => {
    const f = await constructedFixture();
    f.coordinator.reserveReview(f.capture, f.original, f.binding, f.candidate);
    f.coordinator.queueCancellation();
    expect(f.coordinator.completeReview()).toBe(false);
    expect(f.coordinator.snapshot().current).toMatchObject({
      invocationId: f.coordinator.invocationId,
      outcome: 'cancelled',
      review: 'unknown',
      execution: 'unknown',
      uncertainty: 'latched',
    });
    expect(f.coordinator.snapshot().historicalVerdicts).toHaveLength(0);
  });

  it('binds a fixed local recipient acknowledgement to its sole unresolved emission', async () => {
    const f = await constructedFixture();
    f.coordinator.reserveReview(f.capture, f.original, f.binding, f.candidate);
    f.coordinator.completeReview();
    const emitted = f.coordinator.commitEmission()!;
    expect(emitted).not.toBe(null);
    expect(f.coordinator.acknowledge({
      schema: 'gelt.byte-review-summary-ack.v2',
      attemptId: f.coordinator.attemptId,
      delivery: 'acknowledged',
    })).toBe(null);
    const completion = f.coordinator.recipientComplete();
    expect(f.coordinator.acknowledge(completion)).not.toBe(null);
    expect(f.coordinator.snapshot().current.summaryDelivery).toBe('acknowledged');
    expect(f.coordinator.snapshot().current.outcome).toBe('summary_failed');
    expect(f.coordinator.snapshot().emitted).toBe(emitted);
    expect(emitted.status.summaryDelivery).toBe('not_established');
    expect(f.coordinator.commitEmission()).toBe(null);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not export payloads through settlement/status/history metadata', async () => {
    const f = await constructedFixture();
    f.coordinator.reserveReview(f.capture, f.original, f.binding, f.candidate);
    f.coordinator.completeReview();
    f.coordinator.commitEmission();
    const text = JSON.stringify(f.coordinator.snapshot());
    for (const value of [
      profile.pageBodies[0], f.original.pages[0].bodyBase64,
      f.binding.evidence.candidateCanonicalInput,
      'SYNTHETIC_NEXT', 'SYNTHETIC_KEY_ID_123456',
      'SYNTHETIC_SECRET_12345678901234567890', 'bodyBase64',
    ]) expect(text).not.toContain(value);
  });

  it('checks unissued identity before supplied ordinary getters', () => {
    const coordinator = createConstructedByteReviewCoordinator();
    const capture = coordinator.beginCapture();
    let calls = 0;
    const unissued = Object.defineProperty({}, 'receivedAt', {
      enumerable: true,
      get() { calls++; throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
    });
    const other = Object.defineProperty({}, 'attemptId', {
      enumerable: true,
      get() { calls++; throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
    });
    expect(coordinator.reserveReview(capture, unissued, other, other)).toBe(false);
    const after = coordinator.snapshot();
    expect(after.current).toMatchObject({
      outcome: 'provenance_mismatch', invocationId: null,
      review: 'not_attempted', execution: 'unknown',
    });
    expect(after.receipts.some(r => r.kind === 'reviewer_error')).toBe(false);
    expect(after.receipts.some(r => r.kind === 'review_dispatched')).toBe(false);
    expect(calls).toBe(0);
    const prefix = after.receipts;
    expect(coordinator.completeReview()).toBe(false);
    expect(coordinator.reserveReview(capture, {}, {}, {})).toBe(false);
    expect(coordinator.snapshot().receipts).toEqual(prefix);
    expect(JSON.stringify(after)).not.toContain('SYNTHETIC_PRIVATE_FRAGMENT');
  });

  it('keeps a reserved invocation UUID after an unclassified lane reservation failure', async () => {
    const f = await constructedFixture();
    const candidate = copy(f.candidate) as unknown as { input: unknown };
    candidate.input = null;
    // A missing required candidate key establishes reservation rejection, not
    // original identity substitution or an observed reviewer/checker throw.
    const malformed = { ...candidate } as Record<string, unknown>;
    delete malformed.canonicalInput;
    expect(f.coordinator.reserveReview(
      f.capture, f.original, f.binding, malformed,
    )).toBe(false);
    const after = f.coordinator.snapshot();
    expect(after.current).toMatchObject({
      invocationId: f.coordinator.invocationId,
      outcome: 'unknown', review: 'unknown', execution: 'unknown',
      disposal: 'not_established', uncertainty: 'latched',
    });
    expect(after.invocationReservations).toBe(1);
    expect(after.historicalVerdicts).toHaveLength(0);
    expect(after.receipts.some(r => r.kind === 'reviewer_error')).toBe(false);
    expect(after.receipts.some(r => r.kind === 'review_dispatched')).toBe(false);
    expect(after.receipts.some(r => r.kind === 'provenance_mismatch')).toBe(false);
    expect(f.coordinator.completeReview()).toBe(false);
    expect(f.coordinator.completeReview()).toBe(false);
    expect(f.coordinator.snapshot().receipts).toEqual(after.receipts);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not execute a binding accessor or dispatch after its reservation rejection', async () => {
    const f = await constructedFixture();
    let calls = 0;
    Object.defineProperty(f.binding, 'attemptId', {
      enumerable: true,
      get() { calls++; throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
    });
    expect(f.coordinator.reserveReview(
      f.capture, f.original, f.binding, f.candidate,
    )).toBe(false);
    expect(f.coordinator.snapshot().current).toMatchObject({
      invocationId: f.coordinator.invocationId,
      outcome: 'unknown', review: 'unknown', uncertainty: 'latched',
    });
    expect(f.coordinator.completeReview()).toBe(false);
    expect(calls).toBe(0);
    expect(f.coordinator.snapshot().receipts.some(r => r.kind === 'reviewer_error')).toBe(false);
  });

  it('retains a positively established cross-attempt binding failure without claiming reviewer entry', async () => {
    const f = await constructedFixture();
    f.binding.attemptId = '33333333-3333-4333-8333-333333333333';
    expect(f.coordinator.reserveReview(
      f.capture, f.original, f.binding, f.candidate,
    )).toBe(false);
    const after = f.coordinator.snapshot();
    expect(after.current).toMatchObject({
      invocationId: f.coordinator.invocationId,
      outcome: 'provenance_mismatch', review: 'unknown',
      execution: 'unknown', uncertainty: 'latched',
    });
    expect(after.historicalVerdicts).toHaveLength(0);
    expect(after.receipts.some(r => r.kind === 'reviewer_error')).toBe(false);
    expect(after.receipts.some(r => r.kind === 'review_dispatched')).toBe(false);
    expect(f.coordinator.completeReview()).toBe(false);
  });
});

describe('production preflight is closed before dispatch', () => {
  it('returns exact unavailable closure with no capture/reviewer API', () => {
    const result = productionByteReviewPreflight();
    expect(result).toMatchObject({
      scope: 'PRODUCTION_CLOSED',
      dispatchAllowed: false,
      settlement: {
        phase: 'preflight',
        outcome: 'unavailable',
        invocationId: null,
        review: 'not_attempted',
        execution: 'not_started',
        disposal: 'not_established',
        summaryDelivery: 'not_attempted',
        uncertainty: 'latched',
      },
    });
    expect(Object.keys(result).sort()).toEqual(['scope', 'dispatchAllowed', 'settlement'].sort());
    expect(parseSettlementStructure(result.settlement)).toEqual(result.settlement);
  });

  it('does not accept callback/profile/ledger JSON as an admission route', () => {
    const dispatch = vi.fn();
    const call = productionByteReviewPreflight as unknown as (input: unknown) => unknown;
    expect(() => call({
      attemptId: '33333333-3333-4333-8333-333333333333',
      reviewer: dispatch,
      capture: dispatch,
      handlingSha256: 'a'.repeat(64),
      ledger: { admitted: true },
    })).toThrow('Byte-review coordination unavailable');
    expect(dispatch).not.toHaveBeenCalled();
    const first = productionByteReviewPreflight();
    const second = productionByteReviewPreflight();
    expect(first.settlement.attemptId).not.toBe(second.settlement.attemptId);
  });
});
