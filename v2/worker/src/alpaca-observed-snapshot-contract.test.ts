import { expect, it } from 'vitest';
import { canonical } from './ledger-canonical.js';
import { observedHash, observedProfileSchema, observedLimits, parseObservedText, observedDigestSchema } from './alpaca-observed-snapshot-contract.js';
import { profile, copy } from './a64-observed-snapshot.test-support.js';
it('validates NY-midnight/DST mapping without claiming sessions or completion', () => {
    const p = profile();
    expect(p.sessions[0].providerTimestamp.endsWith('05:00:00.000Z')).toBe(true);
    expect(p.sessions[252].providerTimestamp.endsWith('04:00:00.000Z')).toBe(true);
    expect(Buffer.byteLength(canonical(p))).toBeLessThan(observedLimits.request);
    for (const alter of [(p: any) => p.completion = 'complete', (p: any) => p.completed = true, (p: any) => p.sessions[0].providerTimestamp = 'bad', (p: any) => p.sessions.reverse(), (p: any) => p.sessions[2] = p.sessions[1], (p: any) => p.sessions[0].sessionDate = '2025-02-30', (p: any) => p.sessions[252].providerTimestamp = p.sessions[252].providerTimestamp.replace('04:', '05:'), (p: any) => p.epochSha256 += '\n', (p: any) => p.asof = '2025-02-30']) {
        const bad = copy(p);
        alter(bad);
        const { profileSha256, ...body } = bad;
        bad.profileSha256 = observedHash('profile', body);
        expect(observedProfileSchema.safeParse(bad).success).toBe(false);
    }
});
it('enforces exact digest, bytes, duplicate keys and strict JSON work limits', () => { expect(observedDigestSchema.safeParse('a'.repeat(64) + '\n').success).toBe(false); expect(() => parseObservedText('"' + 'x'.repeat(8) + '"', 10)).not.toThrow(); expect(() => parseObservedText('"' + 'x'.repeat(9) + '"', 10)).toThrow(); expect(() => parseObservedText('{"x":1,"x":2}', 100)).toThrow(); expect(() => parseObservedText('['.repeat(18) + '0' + ']'.repeat(18), 100)).toThrow(); expect(() => parseObservedText('[' + '0,'.repeat(20000) + '0]', 100000)).toThrow(); });
it('retains each declared resource ceiling including UTF8 byte width', () => {
    for (const cap of [observedLimits.request, observedLimits.artifact, observedLimits.context, observedLimits.assessment, observedLimits.receipt]) {
        const at = 'null' + ' '.repeat(cap - 4);
        expect(() => parseObservedText(at, cap)).not.toThrow();
        expect(() => parseObservedText(at + ' ', cap)).toThrow();
        const wide = '"' + 'é'.repeat(Math.floor(cap / 2)) + '"';
        expect(() => parseObservedText(wide, cap)).toThrow();
    }
});
