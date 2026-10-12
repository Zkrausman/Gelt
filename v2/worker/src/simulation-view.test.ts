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
