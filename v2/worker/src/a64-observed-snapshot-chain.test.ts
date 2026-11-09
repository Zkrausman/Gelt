import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical } from './ledger-canonical.js';
import { profile, owner, transport, credentials, clock, copy } from './a64-observed-snapshot.test-support.js';
import { createA64ObservedSnapshotChain } from './a64-observed-snapshot-chain.js';
import { A64ObservedSnapshotReceiptStore } from './a64-observed-snapshot-receipt.js';
import { acquireObservedSnapshot, reserveObservedOriginal } from './alpaca-iex-connector.js';
const roots: string[] = [];
const root = () => { const p = fs.mkdtempSync(join(tmpdir(), 'gelt-observed-chain-')); fs.chmodSync(p, 0o700); roots.push(p); return p; };
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const p of roots.splice(0))
        fs.rmSync(p, { recursive: true, force: true });
});
it('runs one real new offline join with adaptive pages and reopens complete evidence read-only', async () => {
    const p = profile(), b = owner(p), t = transport(p, [100, 80, 73]), path = root(), chain = createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher: t.fetcher, clock: clock() }), result = await chain.run();
    expect(result.status).toBe('retained');
    expect(t.limits).toEqual([100, 100, 73]);
    expect(result.receipt).toMatchObject({ status: 'assessed_data', historyUpdates: 64, receiptSequence: 1, fullEvidenceRetained: true, consumptionAttempts: 0 });
    await expect(chain.run()).rejects.toMatchObject({ reason: 'already_attempted' });
    const before = Object.fromEntries(fs.readdirSync(path).map(n => [n, fs.readFileSync(join(path, n)).toString('base64')]));
    const ro = A64ObservedSnapshotReceiptStore.reopen(path, b);
    const data = ro.read();
    expect(data.receipt).toEqual(result.receipt);
    expect(JSON.parse(data.input).original.observations).toHaveLength(253);
    expect(data.assessment?.vintage).toBe('unknown');
    ro.close();
    expect(Object.fromEntries(fs.readdirSync(path).map(n => [n, fs.readFileSync(join(path, n)).toString('base64')]))).toEqual(before);
});
it('records reported known rejection distinctly, without inventing full retained source', async () => {
    const p = profile(), b = owner(p), path = root(), t = transport(p, [100, 80, 50]), r = await createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher: t.fetcher, clock: clock() }).run();
    expect(r.status).toBe('rejected');
    expect(r.receipt).toMatchObject({ fullEvidenceRetained: false, historyUpdates: 0, assessmentSha256: null, rejectionMeaning: 'locally_reported_not_recomputed_source_failure' });
    const ro = A64ObservedSnapshotReceiptStore.reopen(path, b);
    expect(ro.read().assessment).toBeNull();
    ro.close();
    expect(t.limits).toHaveLength(3);
});
it('latches unsettled transport uncertainty; no negative receipt or clean reopen', async () => {
    vi.useFakeTimers();
    const p = profile(), b = owner(p), path = root();
    let resolve!: (r: Response) => void;
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_u: any, i: any) => { signal = i.signal; return new Promise<Response>(r => resolve = r); }) as any;
    const run = createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher, clock: clock() }).run();
    const rejected = expect(run).rejects.toMatchObject({ reason: 'uncertain' });
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;
    expect(signal?.aborted).toBe(true);
    resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() => A64ObservedSnapshotReceiptStore.reopen(path, b)).toThrow();
    expect(fs.existsSync(join(path, 'a64-observed-evidence.pending'))).toBe(true);
});
it('rejects missing/backward clocks without clean negative evidence', async () => {
    const p = profile(), b = owner(p), path = root(), t = transport(p);
    let i = 0;
    const c = { utcNow: () => new Date(Date.UTC(2026, 0, 1)).toISOString(), monotonicNow: () => i++ === 0 ? 10 : 0 };
    await expect(createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher: t.fetcher, clock: c }).run()).rejects.toMatchObject({ reason: 'uncertain' });
    expect(t.limits).toHaveLength(0);
    expect(() => A64ObservedSnapshotReceiptStore.reopen(path, b)).toThrow();
});
it('rejects cloned/changed/reused originals without granting v1 issuance', async () => {
    const p = profile(), t = transport(p), original = await acquireObservedSnapshot(p, credentials, { fetcher: t.fetcher, clock: clock() });
    expect(() => reserveObservedOriginal(copy(original), p)).toThrow();
    const changed = copy(p);
    changed.profileSha256 = 'c'.repeat(64);
    expect(() => reserveObservedOriginal(original, changed)).toThrow();
    expect(() => reserveObservedOriginal(original, p)).toThrow();
});
it('rejects streamed secret echoes and malformed/cyclic pages, without fallback', async () => {
    const p = profile();
    for (const text of ['{"bars":{"SPY":[]},"next_page_token":null}', `{"echo":"${credentials.secretKey}"}`]) {
        const path = root();
        const fetcher = vi.fn(async () => new Response(text, { headers: { 'content-type': 'application/json' } })) as any;
        const r = await createA64ObservedSnapshotChain(path, p, owner(p), credentials, { fetcher, clock: clock() }).run();
        expect(r.status).toBe('rejected');
        expect(canonical(r)).not.toContain(credentials.secretKey);
        expect(fetcher).toHaveBeenCalledTimes(1);
    }
});
for (const mode of ['cycle', 'extra-final-token', 'wrong-symbol', 'duplicate-key', 'invalid-ohlc'])
    it('rejects complete but invalid page: ' + mode, async () => {
        const p = profile(), t = transport(p), path = root();
        let calls = 0;
        const fetcher = (async (u: any, i: any) => {
            const response = await t.fetcher(u, i);
            let text = await response.text();
            calls++;
            if (mode === 'cycle' && calls === 2)
                text = text.replace('opaque-2', 'opaque-1');
            if (mode === 'extra-final-token' && calls === 3)
                text = text.replace('"next_page_token":null', '"next_page_token":"extra"');
            if (mode === 'wrong-symbol')
                text = text.replace('"SPY":', '"OTHER":');
            if (mode === 'duplicate-key')
                text = text.replace('"o":100', '"o":100,"o":100');
            if (mode === 'invalid-ohlc')
                text = text.replace('"h":1000', '"h":1');
            return new Response(text, { headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        const r = await createA64ObservedSnapshotChain(path, p, owner(p), credentials, { fetcher, clock: clock() }).run();
        expect(r.status).toBe('rejected');
        expect(calls).toBeLessThanOrEqual(3);
        expect(r.receipt.fullEvidenceRetained).toBe(false);
    });
it('rejects provider-legal large pages that cannot fit whole retained input', async () => {
    const p = profile(), t = transport(p), path = root();
    const fetcher = (async (u: any, i: any) => new Response((await (await t.fetcher(u, i)).text()) + ' '.repeat(200000), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const r = await createA64ObservedSnapshotChain(path, p, owner(p), credentials, { fetcher, clock: clock() }).run();
    expect(r.status).toBe('rejected');
    expect(r.receipt).toMatchObject({ reason: 'resource_limit', fullEvidenceRetained: false });
    expect(t.limits).toHaveLength(3);
});
it('latches body timeout and never issues/retains a late complete body', async () => {
    vi.useFakeTimers();
    const p = profile(), path = root();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } }), { headers: { 'content-type': 'application/json' } })) as any;
    const chain = createA64ObservedSnapshotChain(path, p, owner(p), credentials, { fetcher, clock: clock() }), run = chain.run();
    const rejection = expect(run).rejects.toMatchObject({ reason: 'uncertain' });
    await vi.advanceTimersByTimeAsync(10001);
    await rejection;
    stream.enqueue(Buffer.from('{}'));
    stream.close();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() => A64ObservedSnapshotReceiptStore.reopen(path, owner(p))).toThrow();
});
it('rejects decoded secret echoes in escaped opaque tokens before another request', async () => {
    const p = profile(), t = transport(p), path = root();
    let calls = 0;
    const escaped = '"' + Array.from(credentials.secretKey).map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"';
    const fetcher = (async (u: any, i: any) => { calls++; const text = (await (await t.fetcher(u, i)).text()).replace('"opaque-1"', escaped); expect(text).not.toContain(credentials.secretKey); return new Response(text, { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    const r = await createA64ObservedSnapshotChain(path, p, owner(p), credentials, { fetcher, clock: clock() }).run();
    expect(r.status).toBe('rejected');
    expect(r.receipt.reason).toBe('invalid_source');
    expect(calls).toBe(1);
});
it('reserves before awaiting transport; concurrent run and competing owner cannot issue another request', async () => {
    const p = profile(), b = owner(p), path = root(), t = transport(p);
    let release!: () => void;
    let calls = 0;
    const gate = new Promise<void>(r => release = r);
    const fetcher = (async (u: any, i: any) => {
        calls++;
        if (calls === 1)
            await gate;
        return t.fetcher(u, i);
    }) as typeof fetch;
    const chain = createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher, clock: clock() }), first = chain.run();
    await expect(chain.run()).rejects.toMatchObject({ reason: 'already_attempted' });
    expect(() => createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher, clock: clock() })).toThrow();
    expect(calls).toBe(1);
    release();
    expect((await first).status).toBe('retained');
    expect(calls).toBe(3);
});
it('does not trust a typed transport rejection as evidence of settled collection', async () => {
    const p = profile(), path = root();
    const { ObservedSnapshotError } = await import('./alpaca-observed-snapshot-contract.js');
    const fetcher = (async () => { throw new ObservedSnapshotError('invalid_source'); }) as typeof fetch;
    await expect(createA64ObservedSnapshotChain(path, p, owner(p), credentials, { fetcher, clock: clock() }).run()).rejects.toMatchObject({ reason: 'uncertain' });
    expect(fs.existsSync(join(path, 'a64-observed-evidence.pending'))).toBe(true);
    expect(() => A64ObservedSnapshotReceiptStore.reopen(path, owner(p))).toThrow();
});
it('rejects changed profile fields retaining the issued digest and consumes that reservation', async () => {
    for (const mutate of [(x: any) => x.asof = '2025-09-11', (x: any) => x.sessions[0].sessionDate = '2025-01-02', (x: any) => x.epochSha256 = 'c'.repeat(64), (x: any) => x.completed = true]) {
        const p = profile(), t = transport(p), o = await acquireObservedSnapshot(p, credentials, { fetcher: t.fetcher, clock: clock() }), changed = copy(p);
        mutate(changed);
        expect(changed.profileSha256).toBe(p.profileSha256);
        expect(() => reserveObservedOriginal(o, changed)).toThrow();
        expect(() => reserveObservedOriginal(o, p)).toThrow();
    }
});
it('accepts exactly10000ms but treats a declared request overrun as uncertainty even before timer scheduling', async () => {
    const p = profile(), b = owner(p), boundary = () => { const values = [0, 1, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009]; let i = 0; return { utcNow: () => new Date(Date.UTC(2026, 0, 1)).toISOString(), monotonicNow: () => values[i++] }; };
    const path = root(), t = transport(p), valid = await createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher: t.fetcher, clock: boundary() }).run();
    expect(valid.status).toBe('retained');
    const c = boundary(), next = c.monotonicNow;
    let i = 0;
    c.monotonicNow = () => { const n = next(); return ++i >= 3 ? n + 0.001 : n; };
    const other = root(), t2 = transport(p);
    await expect(createA64ObservedSnapshotChain(other, p, b, credentials, { fetcher: t2.fetcher, clock: c }).run()).rejects.toMatchObject({ reason: 'uncertain' });
    expect(t2.limits).toHaveLength(1);
    expect(fs.existsSync(join(other, 'a64-observed-evidence.pending'))).toBe(true);
    expect(() => A64ObservedSnapshotReceiptStore.reopen(other, b)).toThrow();
});
for (const mode of ['credential-echo', 'invalid-response-cancel'])
    for (const outcome of ['boundary', 'overrun', 'clock-unavailable'])
        it('measures completion before known negative ' + mode + ' ' + outcome, async () => {
            const p = profile(), b = owner(p), path = root();
            let canceled = 0, reads = 0, calls = 0;
            const c = { utcNow: () => new Date(Date.UTC(2026, 0, 1)).toISOString(), monotonicNow: () => { reads++; if (reads === 3 && outcome === 'clock-unavailable')
                    throw Error('PRIVATE_CLOCK_SENTINEL'); return reads === 1 ? 0 : reads === 2 ? 1 : outcome === 'overrun' ? 10001.001 : 10001; } };
            const fetcher = (async () => { calls++; if (mode === 'credential-echo')
                return new Response(JSON.stringify({ echo: credentials.secretKey }), { headers: { 'content-type': 'application/json' } }); return new Response(new ReadableStream<Uint8Array>({ cancel() { canceled++; } }), { status: 503, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
            const chain = createA64ObservedSnapshotChain(path, p, b, credentials, { fetcher, clock: c }), run = chain.run();
            if (outcome === 'boundary') {
                const result = await run;
                expect(result.status).toBe('rejected');
                expect(result.receipt).toMatchObject({ reason: 'invalid_source', fullEvidenceRetained: false });
                const ro = A64ObservedSnapshotReceiptStore.reopen(path, b);
                expect(ro.read().assessment).toBeNull();
                ro.close();
            }
            else {
                await expect(run).rejects.toMatchObject({ reason: 'uncertain' });
                expect(fs.existsSync(join(path, 'a64-observed-evidence.pending'))).toBe(true);
                expect(() => A64ObservedSnapshotReceiptStore.reopen(path, b)).toThrow();
                expect(() => A64ObservedSnapshotReceiptStore.create(path, b)).toThrow();
            }
            expect(reads).toBe(3);
            expect(calls).toBe(1);
            expect(canceled).toBe(mode === 'invalid-response-cancel' ? 1 : 0);
            await expect(chain.run()).rejects.toMatchObject({ reason: 'already_attempted' });
            expect(calls).toBe(1);
        });
