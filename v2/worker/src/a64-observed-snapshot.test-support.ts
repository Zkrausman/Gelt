// Synthetic test support only, never imported by an application entry point.
import { canonical } from './ledger-canonical.js';
import { observedHash, observedCaseEpoch, parseObservedProfile, type ObservedClock } from './alpaca-observed-snapshot-contract.js';
import { acquireObservedSnapshot } from './alpaca-iex-connector.js';
import { observedArtifactForData } from './a64-observed-snapshot-evidence.js';
export const credentials = { keyId: 'SYNTH_ONLY_KEY_123456', secretKey: 'SYNTH_ONLY_SECRET_123456' };
export const copy = (v: unknown): any => JSON.parse(canonical(v));
export function profile() {
    const sessions = Array.from({ length: 253 }, (_, i) => { const day = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), five = new Date(day + 'T05:00:00.000Z'); const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(five)); return { sessionDate: day, providerTimestamp: new Date(five.getTime() - hour * 3600000).toISOString() }; });
    const body = { schema: 'gelt.alpaca-spy253-observed-snapshot-profile.v2', caseId: 'GELT-PAMR-A64-EVIDENCE-001', epochSha256: 'a'.repeat(64), symbol: 'SPY', feed: 'iex', adjustment: 'all', currency: 'USD', timeframe: '1Day', sort: 'desc', asof: '2025-09-10', sessions, start: sessions[0].providerTimestamp, end: sessions[252].providerTimestamp, completion: 'unknown', vintage: 'unknown' };
    return parseObservedProfile({ ...body, profileSha256: observedHash('profile', body) });
}
export const owner = (p = profile()) => ({ schema: 'gelt.a64-observed-evidence-binding.v2' as const, ownerNamespaceSha256: 'b'.repeat(64), caseEpochSha256: observedCaseEpoch(p) });
export function clock(): ObservedClock { let i = 0; return { utcNow: () => new Date(Date.UTC(2026, 0, 1) + i).toISOString(), monotonicNow: () => i++ }; }
export function transport(p = profile(), sizes = [100, 100, 53], close = (i: number) => '100') {
    let offset = 0, page = 0;
    const limits: number[] = [];
    const fetcher = (async (url: any, init: any) => { const u = new URL(String(url)); if (u.origin !== 'https://data.alpaca.markets' || u.pathname !== '/v2/stocks/bars' || init.method !== 'GET' || init.redirect !== 'error')
        throw Error('bad synthetic request'); limits.push(Number(u.searchParams.get('limit'))); const count = sizes[page++]; const bars = Array.from({ length: count }, () => { const i = offset++; return `{"t":${JSON.stringify(p.sessions[252 - i].providerTimestamp)},"o":100,"h":1000,"l":1,"c":${close(i)},"v":0,"n":0,"vw":100}`; }); return new Response(`{"bars":{"SPY":[${bars.join(',')}]},"next_page_token":${offset < 253 ? JSON.stringify('opaque-' + page) : 'null'}}`, { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    return { fetcher, limits };
}
export async function evidence() { const p = profile(), binding = owner(p), c = clock(), t = transport(p), original = await acquireObservedSnapshot(p, credentials, { fetcher: t.fetcher, clock: c }), artifact = observedArtifactForData(original, binding); const stamp = () => ({ utc: c.utcNow(), mono: c.monotonicNow() }); const context = { schema: 'gelt.a64-observed-context.v2', binding, profileSha256: p.profileSha256, originalBundleSha256: observedHash('original-bundle', original), inspectionStart: stamp(), inspectionEnd: stamp(), assessmentAt: stamp(), timingMeaning: 'local_observation_unqualified_clock', serializedMeaning: 'declarations_not_issuance' }; return { p, binding, original, artifact, context, text: canonical({ schema: 'gelt.a64-observed-evidence-input.v2', binding, original, artifact, context }) }; }
export const negative = (p = profile(), binding = owner(p)) => canonical({ schema: 'gelt.a64-observed-rejection.v2', binding, profile: p, reason: 'invalid_source', reported: true });
