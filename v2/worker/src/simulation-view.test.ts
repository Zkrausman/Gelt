import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { simulationViewTestFixture } from './fixtures/simulation-view.js';
import { simulationSnapshotSchema, simulationViewMaxBytes } from './simulation-view-contract.js';
import { readSimulationSnapshot } from './simulation-view-reader.js';
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
it('requires explicit configured bytes and digest; modified, oversized and ambiguous input fails closed', () => {
  const bytes = Buffer.from(JSON.stringify(simulationViewTestFixture())), read = vi.fn(() => bytes);
  expect(readSimulationSnapshot(undefined, undefined, read)).toEqual({ state: 'unavailable' }); expect(read).not.toHaveBeenCalled();
  expect(readSimulationSnapshot('/configured', digest(bytes), () => { throw Error('Unreadable'); })).toEqual({ state: 'unavailable' });
  expect(readSimulationSnapshot('/configured', digest(bytes), read).state).toBe('available');
  expect(readSimulationSnapshot('/configured', 'a'.repeat(64), read)).toEqual({ state: 'corrupt' });
  const large = Buffer.from(bytes.toString().padEnd(simulationViewMaxBytes - 1023, ' '));
  expect(readSimulationSnapshot('/configured', digest(large), () => large)).toEqual({ state: 'corrupt' });
  const duplicate = Buffer.from(bytes.toString().replace('"version":1', '"version":1,"version":1'));
  expect(readSimulationSnapshot('/configured', digest(duplicate), () => duplicate)).toEqual({ state: 'corrupt' });
});
it('rejects cross-intent views, secret fields, duplicated selections and false agent claims', () => {
  const a = simulationViewTestFixture(); a.runs[0].mock.dispatchId = '00000000-0000-4000-8000-000000000003'; expect(simulationSnapshotSchema.safeParse(a).success).toBe(false);
  const b = simulationViewTestFixture(); b.runs[0].history.eventCount = 2; expect(simulationSnapshotSchema.safeParse(b).success).toBe(false);
  const c = simulationViewTestFixture(); c.runs.push(c.runs[0]); expect(simulationSnapshotSchema.safeParse(c).success).toBe(false);
  const d = simulationViewTestFixture(); expect(simulationSnapshotSchema.safeParse({ ...d, bearer: 'forbidden' }).success).toBe(false);
  expect(simulationSnapshotSchema.safeParse({ ...d, runs: [{ ...d.runs[0], decision: 'real_agent' }] }).success).toBe(false);
});
it('requires exact cross-source execution IDs, decimal representation and fee presence', () => {
  const make = () => {
    const fixture = simulationViewTestFixture(), run = fixture.runs[0];
    const observed = { source: 'synthetic-offline-v1', syntheticType: 'execution-observed', occurredAt: run.recordedAt, syntheticExecutionId: 'fill-unit',
      observedQuantity: { value: '0.004', precision: 4, scale: 3 }, observedPrice: { value: '0.90', precision: 3, scale: 2 }, observedFee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' };
    return { ...fixture, runs: [{ ...run, history: { ...run.history, eventCount: 2, facts: [...run.history.facts, observed] }, mock: { ...run.mock, status: 'partially-filled', executions: [{ executionId: observed.syntheticExecutionId, quantity: observed.observedQuantity, price: observed.observedPrice, fee: observed.observedFee, currency: 'USD' }] } }] };
  };
  expect(simulationSnapshotSchema.safeParse(make()).success).toBe(true);
  const mismatchedId = make(); mismatchedId.runs[0].mock.executions[0].executionId = 'other'; expect(simulationSnapshotSchema.safeParse(mismatchedId).success).toBe(false);
  const quantity = make(); quantity.runs[0].mock.executions[0].quantity = { value: '0.005', precision: 4, scale: 3 }; expect(simulationSnapshotSchema.safeParse(quantity).success).toBe(false);
  const representation = make(); representation.runs[0].mock.executions[0].price = { value: '0.9', precision: 2, scale: 1 }; expect(simulationSnapshotSchema.safeParse(representation).success).toBe(false);
  const fee = make(); fee.runs[0].mock.executions[0].fee = { value: '0.004', precision: 4, scale: 3 }; expect(simulationSnapshotSchema.safeParse(fee).success).toBe(false);
  const missing = make(); expect(simulationSnapshotSchema.safeParse({ ...missing, runs: [{ ...missing.runs[0], mock: { ...missing.runs[0].mock, executions: missing.runs[0].mock.executions.map(({ fee: omitted, ...e }) => e) } }] }).success).toBe(false);
  const duplicate = make(); duplicate.runs[0].history.facts.push(duplicate.runs[0].history.facts[1]); duplicate.runs[0].history.eventCount++; expect(simulationSnapshotSchema.safeParse(duplicate).success).toBe(false);
});
