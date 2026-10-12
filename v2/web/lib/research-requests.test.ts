import { MAX_RESEARCH_RESPONSE_BYTES } from '../../worker/src/research-contract';
import { expect, it, vi } from 'vitest';
import { ResearchRequests, ResearchReadError, requestResearch } from './research-requests';
const list = { version: 'v1', state: 'available', items: [], sessionExpiresAt: Date.now() + 3600000 };
it('only latest read can publish; old success/failure/finally cannot resurrect dismissed evidence', async () => {
  const requests = new ResearchRequests();
  const first = requests.begin('research-list', 'old');
  let resolve!: (value: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
  const pending = requestResearch(first, transport);
  const second = requests.begin('research-detail', 'new', 'selected');
  expect(first.signal.aborted).toBe(true); expect(requests.current(first)).toBe(false);
  resolve(Response.json(list)); await pending;
  expect(requests.finish(first)).toBe(false); expect(requests.current(second)).toBe(true);
  requests.invalidate(); expect(requests.current(second)).toBe(false); expect(requests.finish(second)).toBe(false);
});
it('sends only named bounded reads with no-store and abort signal', async () => {
  const requests = new ResearchRequests(), read = requests.begin('research-list', 'csrf');
  const transport = vi.fn(async () => Response.json(list));
  await requestResearch(read, transport);
  expect(transport).toHaveBeenCalledWith('/api/connection/research-list', expect.objectContaining({ cache: 'no-store', signal: read.signal, body: '{}', headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': 'csrf' } }));
});
it('distinguishes authoritative session denial and rejects expired or malformed reads', async () => {
  const read = new ResearchRequests().begin('research-list', 'csrf');
  await expect(requestResearch(read, async () => Response.json({ version: 'v1', error: 'unauthorized' }, { status: 401 }))).rejects.toEqual(new ResearchReadError(true));
  await expect(requestResearch(read, async () => Response.json({ error: 'private worker' }, { status: 401 }))).rejects.toEqual(new ResearchReadError(false));
  await expect(requestResearch(read, async () => Response.json({ ...list, sessionExpiresAt: 1 }))).rejects.toEqual(new ResearchReadError(true));
  await expect(requestResearch(read, async () => Response.json({ ...list, extra: 'untrusted' }))).rejects.toThrow();
  await expect(requestResearch(read, async () => Response.json({ ...list, items: [{ evidenceId: 'x', state: 'available' }, { evidenceId: 'x', state: 'available' }] }))).rejects.toThrow();
  await expect(requestResearch(read, async () => new Response('not JSON'))).rejects.toThrow();
});

it('rejects detail identity mismatches rather than showing a different selected artifact', async () => {
  const { researchFixture } = await import('../../worker/src/research-fixture');
  const read = new ResearchRequests().begin('research-detail', 'csrf', 'different-id');
  const record = { evidence: researchFixture(), originalSha256: 'a'.repeat(64), originalBytes: 3000, importedAt: '2026-10-07T00:00:00.000Z', geltChecks: { schema: 'passed', integrity: 'passed', numericComparison: { status: 'passed', detail: 'Numbers only' }, scientificReproduction: 'not_run' } };
  await expect(requestResearch(read, async () => Response.json({ version: 'v1', state: 'available', sessionExpiresAt: list.sessionExpiresAt, record }))).rejects.toEqual(new ResearchReadError(false));
});

it('enforces the shared serialized response limit at its exact byte boundary', async () => {
  const read = new ResearchRequests().begin('research-list', 'csrf');
  const body = JSON.stringify(list).padEnd(MAX_RESEARCH_RESPONSE_BYTES, ' ');
  await expect(requestResearch(read, async () => new Response(body))).resolves.toEqual(list);
  await expect(requestResearch(read, async () => new Response(body + ' '))).rejects.toEqual(new ResearchReadError(false));
});
