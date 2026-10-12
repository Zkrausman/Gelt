import { describe, expect, it, vi } from 'vitest';
import { HistoryReadError, HistoryRequests, requestHistory, type HistoryReadContext } from './history-requests';

const context: HistoryReadContext = { operation: 'history', csrf: 'draft-a', accountHandle: 'account-a', intentId: null, after: 0, limit: 50, append: false };
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('history request generation', () => {
  it.each(['success', 'failure'] as const)('old %s cannot replace newer success or clear its busy state', async outcome => {
    const requests = new HistoryRequests();
    const old = deferred<string>(), fresh = deferred<string>();
    let displayed = '', busy = true;
    const run = async (pending: ReturnType<typeof deferred<string>>) => {
      const read = requests.begin(context);
      try { const value = await pending.promise; if (requests.current(read)) displayed = value; }
      catch { if (requests.current(read)) displayed = 'unavailable'; }
      finally { if (requests.finish(read)) busy = false; }
    };
    const first = run(old), second = run(fresh);
    fresh.resolve('newest'); await second;
    if (outcome === 'success') old.resolve('stale'); else old.reject(Error('stale failure'));
    await first;
    expect(displayed).toBe('newest'); expect(busy).toBe(false);
  });
  it('an old completion cannot clear a newer pending request', () => {
    const requests = new HistoryRequests(), old = requests.begin(context), fresh = requests.begin(context);
    expect(requests.finish(old)).toBe(false); expect(requests.current(fresh)).toBe(true);
  });
  it('captures operation, account, intent, draft token and cursor instead of consulting changed state', () => {
    const requests = new HistoryRequests();
    const draft = { ...context, operation: 'intent' as const, intentId: 'intent-a', after: 50, append: true };
    const read = requests.begin(draft); draft.csrf = 'draft-b'; draft.after = 100; draft.intentId = 'intent-b';
    expect(read).toMatchObject({ operation: 'intent', accountHandle: 'account-a', intentId: 'intent-a', csrf: 'draft-a', after: 50, append: true });
    expect(Object.isFrozen(read)).toBe(true);
  });
  it.each(['new initial read', 'detail selection', 'draft edit', 'saved draft restore', 'unmount'])('invalidates a pending read on %s even if transport ignores abort', () => {
    const requests = new HistoryRequests(), read = requests.begin(context);
    requests.invalidate();
    expect(read.signal.aborted).toBe(true); expect(requests.current(read)).toBe(false); expect(requests.finish(read)).toBe(false);
    const replacement = requests.begin(context);
    expect(replacement.generation).toBeGreaterThan(read.generation); expect(requests.current(read)).toBe(false);
  });
});

describe('protected history transport errors', () => {
  it('only identifies an explicit BFF session denial; forbidden and generic failures stay generic', async () => {
    const read = new HistoryRequests().begin(context);
    for (const [status, value, denied] of [
      [401, { version: 'v1', error: 'unauthorized' }, true],
      [401, { error: 'worker_unavailable' }, false],
      [403, { version: 'v1', error: 'forbidden' }, false],
      [409, { version: 'v1', error: 'connection_unavailable' }, false],
      [503, { version: 'v1', error: 'setup_required' }, false],
    ] as const) {
      await expect(requestHistory(read, vi.fn(async () => Response.json(value, { status })))).rejects.toEqual(new HistoryReadError(denied));
    }
  });
  it('uses the captured token, cursor and signal in the named read-only request', async () => {
    const read = new HistoryRequests().begin({ ...context, operation: 'intent', intentId: 'intent-a', after: 50 });
    const transport = vi.fn(async () => Response.json({ unchanged: '0.010000000000000001', fee: null }));
    expect(await requestHistory(read, transport)).toEqual({ unchanged: '0.010000000000000001', fee: null });
    expect(transport).toHaveBeenCalledWith('/api/connection/intent', expect.objectContaining({ signal: read.signal, headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': 'draft-a' }, body: JSON.stringify({ after: 50, limit: 50, intentId: 'intent-a' }) }));
  });
  it('does not convert malformed JSON or a network failure into a session denial', async () => {
    const read = new HistoryRequests().begin(context);
    await expect(requestHistory(read, vi.fn(async () => new Response('not JSON', { status: 401 })))).rejects.not.toBeInstanceOf(HistoryReadError);
    await expect(requestHistory(read, vi.fn(async () => { throw Error('network'); }))).rejects.not.toBeInstanceOf(HistoryReadError);
  });
});
