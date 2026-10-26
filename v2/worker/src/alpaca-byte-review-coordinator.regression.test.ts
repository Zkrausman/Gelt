import { describe, expect, it } from 'vitest';
import {
  coordinatorReceiptLimits,
  createConstructedByteReviewCoordinator,
  createSimulatedByteReviewCoordinator,
} from './alpaca-byte-review-coordinator.js';

// Conditional evidence-model regressions. No capture, provider, live clock,
// operational admission, whole-job settlement or handling right is established.
type Model = ReturnType<typeof createSimulatedByteReviewCoordinator>;

function settledModel(): Model {
  const model = createSimulatedByteReviewCoordinator();
  expect(model.startReview()).toBe(true);
  expect(model.observe('verdict_all_pass')).toBe(true);
  expect(model.observe('execution_settled')).toBe(true);
  expect(model.observe('release_complete')).toBe(true);
  return model;
}

function acknowledgedModel(): Model {
  const model = settledModel();
  expect(model.commitEmission()).not.toBe(null);
  const ticket = model.recipientComplete();
  expect(ticket).not.toBe(null);
  expect(model.acknowledge(ticket)).not.toBe(null);
  return model;
}

function fillCapacity(model: Model): void {
  const bound = coordinatorReceiptLimits.ordinary + coordinatorReceiptLimits.protected + 4;
  for (let count = 0; count < bound && !model.snapshot().capacityUnavailable; count++) {
    model.observe('execution_settled');
  }
  expect(model.snapshot().capacityUnavailable).toBe(true);
}

describe('coordinator adversarial state regressions, simulated evidence only', () => {
  it('cannot hand off a favorable snapshot invalidated by its own commit bookkeeping', () => {
    const model = settledModel();
    for (let count = 0; count < coordinatorReceiptLimits.ordinary; count++) {
      const snapshot = model.snapshot();
      if (snapshot.receipts.length >= coordinatorReceiptLimits.ordinary - 1
        || snapshot.capacityUnavailable) break;
      model.observe('execution_settled');
    }
    const emitted = model.commitEmission();
    const current = model.snapshot();
    if (emitted) {
      // No later observation or acknowledgement occurred. Commit bookkeeping
      // itself cannot leave E favorable while invalidating the same-boundary C.
      expect(emitted.source).toEqual(current.current);
      if (emitted.status.outcome === 'consistent_unverified') {
        expect(current.favorableCurrent).toBe(true);
      }
    }
    expect(model.commitEmission()).toBe(null);
    expect(model.snapshot().handoffAttempts).toBeLessThanOrEqual(1);
  });

  it('applies a repeated execution contradiction to renewed proofs at capacity', () => {
    const model = acknowledgedModel();
    const emitted = model.snapshot().emitted;
    expect(model.observe('execution_contradiction')).toBe(true);
    expect(model.observe('execution_settled')).toBe(true);
    expect(model.observe('release_complete')).toBe(true);
    fillCapacity(model);
    model.observe('execution_contradiction');
    const after = model.snapshot();
    expect(after.current).toMatchObject({
      execution: 'unknown', disposal: 'not_established',
      summaryDelivery: 'acknowledged', uncertainty: 'latched',
    });
    expect(after.emitted).toBe(emitted);
  });

  it('applies a repeated release contradiction while preserving independent settlement and ack', () => {
    const model = acknowledgedModel();
    const emitted = model.snapshot().emitted;
    expect(model.observe('release_contradiction')).toBe(true);
    expect(model.observe('release_complete')).toBe(true);
    fillCapacity(model);
    model.observe('release_contradiction');
    const after = model.snapshot();
    expect(after.current).toMatchObject({
      execution: 'settled', disposal: 'not_established',
      summaryDelivery: 'acknowledged', uncertainty: 'latched',
    });
    expect(after.emitted).toBe(emitted);
  });

  it('keeps a total current projection for pending evidence after an unresolved summary reservation', () => {
    const model = createSimulatedByteReviewCoordinator();
    expect(model.startReview()).toBe(true);
    expect(model.observe('timed_out')).toBe(true);
    expect(model.observe('execution_unknown')).toBe(true);
    expect(model.reserveEmission()).toBe(true);
    const before = model.snapshot();
    expect(model.observe('execution_pending')).toBe(true);
    expect(() => model.snapshot()).not.toThrow();
    const after = model.snapshot();
    expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
    expect(after.receipts.length).toBeGreaterThan(before.receipts.length);
    expect(after.current).toMatchObject({
      phase: 'summary', outcome: 'timed_out', execution: 'unknown',
      disposal: 'not_established', uncertainty: 'latched',
    });
    expect(after.emissionReservations).toBe(1);
    expect(model.reserveEmission()).toBe(false);
  });

  it('does not label a known pre-dispatch issuance failure as an observed reviewer error', () => {
    const coordinator = createConstructedByteReviewCoordinator();
    const capture = coordinator.beginCapture();
    expect(capture).not.toBe(null);
    expect(coordinator.reserveReview(capture, Object.freeze({}), {}, {})).toBe(false);
    const after = coordinator.snapshot();
    expect(after.current.outcome).toBe('provenance_mismatch');
    expect(after.current.review).not.toBe('incomplete');
    expect(after.current.disposal).toBe('not_established');
    expect(after.historicalVerdicts).toHaveLength(0);
    expect(after.receipts.some(receipt => receipt.kind === 'reviewer_error')).toBe(false);
  });
});
