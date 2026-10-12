import { expect, it, vi } from 'vitest';
import { SimulationRequests, SimulationReadError, requestSimulation } from './simulation-requests';
import { simulationViewTestFixture } from '../../worker/src/fixtures/simulation-view';
import { simulationViewMaxBytes } from '../../worker/src/simulation-view-contract';
const list = { version: 'v1', state: 'available', items: [{ id: 'recorded-unit', label: 'Unit fixture' }], sessionExpiresAt: Date.now() + 3600000 };
it('late success, error and finally lose authority after run/session change or unmount', async () => {
  const reads = new SimulationRequests(), first = reads.begin('simulation-list', 'old');
  let complete!: (v: Response) => void;
  const pending = requestSimulation(first, vi.fn(() => new Promise<Response>(r => { complete = r; })));
  const second = reads.begin('simulation-detail', 'new', 'recorded-unit');
  expect(first.signal.aborted).toBe(true); complete(Response.json(list)); await pending;
  expect(reads.current(first)).toBe(false); expect(reads.finish(first)).toBe(false); expect(reads.current(second)).toBe(true);
  reads.invalidate(); expect(reads.finish(second)).toBe(false);
});
it('rejects mismatched IDs, expired sessions, oversized responses and malformed data', async () => {
  const read = new SimulationRequests().begin('simulation-detail', 'csrf', 'recorded-other');
  await expect(requestSimulation(read, async () => Response.json({ version: 'v1', state: 'available', sessionExpiresAt: list.sessionExpiresAt, run: simulationViewTestFixture().runs[0] }))).rejects.toEqual(new SimulationReadError(false));
  const l = new SimulationRequests().begin('simulation-list', 'csrf');
  await expect(requestSimulation(l, async () => Response.json({ ...list, sessionExpiresAt: 1 }))).rejects.toEqual(new SimulationReadError(true));
  await expect(requestSimulation(l, async () => new Response('x'.repeat(simulationViewMaxBytes + 1)))).rejects.toEqual(new SimulationReadError(false));
  await expect(requestSimulation(l, async () => Response.json({ ...list, items: [...list.items, ...list.items] }))).rejects.toThrow();
});
it('only authoritative owner denial clears the viewer session, not a generic 401 or 403', async () => {
  const read = new SimulationRequests().begin('simulation-list', 'csrf');
  await expect(requestSimulation(read, async () => Response.json({ version: 'v1', error: 'unauthorized' }, { status: 401 }))).rejects.toEqual(new SimulationReadError(true));
  await expect(requestSimulation(read, async () => Response.json({ error: 'other' }, { status: 401 }))).rejects.toEqual(new SimulationReadError(false));
  await expect(requestSimulation(read, async () => Response.json({ version: 'v1', error: 'forbidden' }, { status: 403 }))).rejects.toEqual(new SimulationReadError(false));
});
