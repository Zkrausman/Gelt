import { describe, expect, it } from 'vitest';
import {
  createSimulatedByteReviewCoordinator,
  simulatedEvidenceKinds,
  type SimulatedEvidenceKind,
} from './alpaca-byte-review-coordinator.js';
import { parseSettlementStructure } from './alpaca-byte-review-contract.js';

// Bounded contract conformance only. These simulated receipts establish no
// operational admission, real settlement, reference release or handling rights.
const seeds = [
  'preflight', 'pending', 'verdict', 'release', 'released',
  'reserved', 'acknowledged', 'timeout_reserved',
] as const;
type Seed = typeof seeds[number];
type Model = ReturnType<typeof createSimulatedByteReviewCoordinator>;

function seedModel(seed: Seed): Model {
  const model = createSimulatedByteReviewCoordinator();
  if (seed === 'preflight') return model;
  expect(model.startReview()).toBe(true);
  if (seed === 'pending') return model;
  if (seed === 'timeout_reserved') {
    expect(model.observe('timed_out')).toBe(true);
    expect(model.observe('execution_unknown')).toBe(true);
    expect(model.reserveEmission()).toBe(true);
    return model;
  }
  expect(model.observe('verdict_all_pass')).toBe(true);
  if (seed === 'verdict') return model;
  expect(model.observe('execution_settled')).toBe(true);
  if (seed === 'release') return model;
  expect(model.observe('release_complete')).toBe(true);
  if (seed === 'reserved') expect(model.reserveEmission()).toBe(true);
  if (seed === 'acknowledged') {
    expect(model.commitEmission()).not.toBe(null);
    const completion = model.recipientComplete();
    expect(completion).not.toBe(null);
    expect(model.acknowledge(completion)).not.toBe(null);
  }
  return model;
}

function assertTransition(model: Model, event: SimulatedEvidenceKind): void {
  const before = model.snapshot();
  // A known, well-formed model event may be refused, but cannot strand the
  // mandatory current projection or remove previously admitted evidence.
  model.observe(event);
  const after = model.snapshot();
  expect(parseSettlementStructure(after.current)).toEqual(after.current);
  expect(after.receipts.slice(0, before.receipts.length)).toEqual(before.receipts);
  if (before.current.uncertainty === 'latched') {
    expect(after.current.uncertainty).toBe('latched');
  }
  if (before.emitted) {
    expect(after.emitted).toBe(before.emitted);
    expect(after.emitted!.bytes).toBe(before.emitted.bytes);
    expect(after.emitted!.source).toBe(before.emitted.source);
  }
  // None of these event kinds contradicts acknowledgement's own evidence.
  if (before.current.summaryDelivery === 'acknowledged') {
    expect(after.current.summaryDelivery).toBe('acknowledged');
  }
  expect(after.captureReservations).toBeLessThanOrEqual(1);
  expect(after.invocationReservations).toBeLessThanOrEqual(1);
  expect(after.emissionReservations).toBeLessThanOrEqual(1);
  expect(after.handoffAttempts).toBeLessThanOrEqual(1);
}

describe('finite simulated current-projection event matrix', () => {
  it.each(seeds)('retains contract invariants from %s', seed => {
    for (const event of simulatedEvidenceKinds) {
      assertTransition(seedModel(seed), event);
    }
    const critical: readonly SimulatedEvidenceKind[] = [
      'execution_pending', 'execution_unknown', 'execution_settled',
      'execution_contradiction', 'release_failed', 'release_complete',
      'release_contradiction', 'duplicate_completion', 'cancelled', 'timed_out',
    ];
    for (const first of critical) {
      for (const second of critical) {
        const model = seedModel(seed);
        assertTransition(model, first);
        assertTransition(model, second);
      }
    }
  });
});
