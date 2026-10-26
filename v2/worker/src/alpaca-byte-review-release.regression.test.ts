import { describe, expect, it } from 'vitest';
import {
  createSimulatedByteReviewCoordinator,
} from './alpaca-byte-review-coordinator.js';
import {
  parseSettlementStructure,
  parseStatusStructure,
} from './alpaca-byte-review-contract.js';

// Constructed evidence only; no real input, settlement, handling or admission.
function reviewed() {
  const model = createSimulatedByteReviewCoordinator();
  expect(model.startReview()).toBe(true);
  expect(model.observe('verdict_all_pass')).toBe(true);
  expect(model.observe('execution_settled')).toBe(true);
  return model;
}

describe('current release evidence and immutable summary consistency', () => {
  it.each([0, 51])('requires current release accounting after renewed execution proof with %s fillers', fillers => {
    const model = reviewed();
    expect(model.observe('release_complete')).toBe(true);
    for (let i = 0; i < fillers; i++) {
      expect(model.observe('release_complete')).toBe(true);
    }
    expect(model.observe('execution_contradiction')).toBe(true);
    expect(model.observe('release_contradiction')).toBe(true);
    expect(model.observe('execution_settled')).toBe(true);
    expect(model.snapshot().current).toMatchObject({
      execution: 'settled', disposal: 'not_established', uncertainty: 'latched',
    });
    // Historical release assessment for the lost proof cannot bypass C0.
    expect(model.reserveEmission()).toBe(false);
    expect(model.commitEmission()).toBe(null);
    expect(model.snapshot().emitted).toBe(null);
    if (fillers === 0) {
      expect(model.observe('release_complete')).toBe(true);
    } else {
      // Positive proofs stop at overflow. A fresh protected failed assessment
      // may establish C1 for this current proof, without fabricating D1.
      expect(model.observe('release_complete')).toBe(false);
      expect(model.observe('release_failed')).toBe(true);
    }
    expect(model.reserveEmission()).toBe(true);
    expect(model.commitEmission()).not.toBe(null);
    expect(model.snapshot().receipts.map(r => r.kind)).toContain('release_contradiction');
  });

  it('retains a failed-release receipt without projecting an incompatible current outcome', () => {
    const model = reviewed();
    expect(model.observe('release_failed')).toBe(true);
    expect(model.snapshot().current).toMatchObject({
      outcome: 'disposal_not_established', disposal: 'not_established',
    });
    expect(model.observe('release_complete')).toBe(true);
    expect(model.snapshot().current).toMatchObject({
      outcome: 'unknown', review: 'unknown', execution: 'settled',
      disposal: 'references_released', uncertainty: 'latched',
    });
    expect(model.snapshot().receipts.map(r => r.kind)).toContain('release_failed');
    const emission = model.commitEmission();
    expect(emission?.status).toMatchObject({
      outcome: 'unknown', disposal: 'references_released',
    });
  });

  it('retains immutable emission and independent acknowledgement across renewed release evidence', () => {
    const model = reviewed();
    expect(model.observe('release_complete')).toBe(true);
    const emission = model.commitEmission();
    expect(emission).not.toBe(null);
    const completion = model.recipientComplete();
    expect(model.acknowledge(completion)).not.toBe(null);
    expect(model.observe('release_contradiction')).toBe(true);
    expect(model.snapshot().current.outcome).toBe('disposal_not_established');
    expect(model.observe('release_complete')).toBe(true);
    expect(model.snapshot().current).toMatchObject({
      outcome: 'unknown', review: 'unknown', execution: 'settled',
      disposal: 'references_released', summaryDelivery: 'acknowledged',
      uncertainty: 'latched',
    });
    expect(model.snapshot().emitted).toBe(emission);
    expect(model.snapshot().emitted?.bytes).toBe(emission?.bytes);
    expect(model.commitEmission()).toBe(null);
  });

  it('selects a remaining supported failure while release-failure history stays retained', () => {
    const model = reviewed();
    expect(model.observe('release_failed')).toBe(true);
    expect(model.observe('cancelled')).toBe(true);
    expect(model.observe('release_complete')).toBe(true);
    expect(model.snapshot().current).toMatchObject({
      outcome: 'cancelled', execution: 'settled', disposal: 'references_released',
      uncertainty: 'latched',
    });
    expect(model.snapshot().receipts.map(r => r.kind)).toContain('release_failed');
  });

  it.each(['release', 'summary'] as const)('rejects disposal-failure settlement with released references in %s', phase => {
    const model = reviewed();
    expect(model.observe('release_failed')).toBe(true);
    const valid = model.snapshot().current;
    const bad = {
      ...valid, phase, disposal: 'references_released',
      summaryDelivery: phase === 'summary' ? 'not_established' : 'not_attempted',
    };
    expect(() => parseSettlementStructure(bad)).toThrow();
  });

  it('rejects a disposal-failure summary with unknown execution', () => {
    const model = reviewed();
    expect(model.observe('release_failed')).toBe(true);
    expect(() => parseSettlementStructure({
      ...model.snapshot().current,
      phase: 'summary', execution: 'unknown', review: 'unknown',
      summaryDelivery: 'not_established',
    })).toThrow();
  });

  it('rejects disposal-failure emitted statuses without their own required X1/D0 tuple', () => {
    const model = reviewed();
    expect(model.observe('release_failed')).toBe(true);
    const emission = model.commitEmission();
    expect(emission?.status.outcome).toBe('disposal_not_established');
    expect(() => parseStatusStructure({
      ...emission!.status, disposal: 'references_released',
    })).toThrow();
    expect(() => parseStatusStructure({
      ...emission!.status, execution: 'unknown', review: 'unknown',
    })).toThrow();
  });
});
