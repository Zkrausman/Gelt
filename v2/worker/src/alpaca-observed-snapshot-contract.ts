import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { alpacaIexDecimalSchema, alpacaIexRawPageSchema, alpacaIexRequestEvidenceSchema } from './alpaca-iex-contract.js';
export const observedLimits = Object.freeze({ input: 262144, request: 32768, artifact: 180000, context: 8192, assessment: 8192, receipt: 8192, store: 8388608 });
export const observedHash = (domain: string, value: unknown) => digest(canonical({ domain: 'gelt.a64-observed.v2/' + domain, value }));
export const observedDigestSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
export const observedTimeSchema = z.string().datetime({ precision: 3 }).refine(v => { try {
    return new Date(v).toISOString() === v;
}
catch {
    return false;
} });
const date = z.string().length(10).regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { try {
    return new Date(v + 'T00:00:00.000Z').toISOString().slice(0, 10) === v;
}
catch {
    return false;
} });
const session = z.object({ sessionDate: date, providerTimestamp: observedTimeSchema }).strict();
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function mapped(s: z.infer<typeof session>): boolean {
    try {
        const p = Object.fromEntries(ny.formatToParts(new Date(s.providerTimestamp)).map(p => [p.type, p.value]));
        return s.sessionDate === `${p.year}-${p.month}-${p.day}` && p.hour === '00' && p.minute === '00' && p.second === '00' && s.providerTimestamp.endsWith('.000Z');
    } catch { return false; }
}

export const observedProfileSchema = z.object({ schema: z.literal('gelt.alpaca-spy253-observed-snapshot-profile.v2'), caseId: z.literal('GELT-PAMR-A64-EVIDENCE-001'), epochSha256: observedDigestSchema,
    symbol: z.literal('SPY'), feed: z.literal('iex'), adjustment: z.literal('all'), currency: z.literal('USD'), timeframe: z.literal('1Day'), sort: z.literal('desc'), asof: date,
    sessions: z.array(session).length(253), start: observedTimeSchema, end: observedTimeSchema, completion: z.literal('unknown'), vintage: z.literal('unknown'), profileSha256: observedDigestSchema
}).strict().superRefine((p, ctx) => {
    const { profileSha256, ...body } = p;
    if (profileSha256 !== observedHash('profile', body) || p.start !== p.sessions[0].providerTimestamp || p.end !== p.sessions[252].providerTimestamp || p.sessions.some((s, i) => !mapped(s) || (i > 0 && (s.sessionDate <= p.sessions[i - 1].sessionDate || s.providerTimestamp <= p.sessions[i - 1].providerTimestamp))))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid observed mapping' });
});
export type ObservedProfile = z.infer<typeof observedProfileSchema>;
export const observedBindingSchema = z.object({ schema: z.literal('gelt.a64-observed-evidence-binding.v2'), ownerNamespaceSha256: observedDigestSchema, caseEpochSha256: observedDigestSchema }).strict();
export type ObservedBinding = z.infer<typeof observedBindingSchema>;
export const observedCaseEpoch = (p: ObservedProfile) => observedHash('case-epoch', { caseId: p.caseId, epochSha256: p.epochSha256, profileSha256: p.profileSha256 });
export const observedStampSchema = z.object({ utc: observedTimeSchema, mono: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export type ObservedStamp = z.infer<typeof observedStampSchema>;
export type ObservedClock = Readonly<{
    utcNow(): string;
    monotonicNow(): number;
}>;
export function observedOrdered(...s: ObservedStamp[]): boolean { return s.every((v, i) => observedStampSchema.safeParse(v).success && (i === 0 || (v.utc >= s[i - 1].utc && v.mono >= s[i - 1].mono))); }
export const observedAcquisitionSchema = z.object({ schema: z.literal('gelt.alpaca-iex-observed-acquisition.v2'), profile: observedProfileSchema,
    request: alpacaIexRequestEvidenceSchema.extend({ symbol: z.literal('SPY'), adjustment: z.literal('all') }).strict(),
    pages: z.array(alpacaIexRawPageSchema.extend({ sha256: observedDigestSchema }).strict()).min(1).max(3),
    observations: z.array(z.object({ providerTimestamp: observedTimeSchema, close: alpacaIexDecimalSchema.refine(d => !/\s/.test(d.value) && /[1-9]/.test(d.value)) }).strict()).length(253),
    timing: z.object({ collectionStart: observedStampSchema, pages: z.array(z.object({ start: observedStampSchema, bodyComplete: observedStampSchema }).strict()).min(1).max(3), collectionEnd: observedStampSchema }).strict(),
    completion: z.literal('unknown'), vintage: z.literal('unknown'), collectionAtomicity: z.literal('not_established'), asofMeaning: z.literal('symbol_identity_only'), clockTrust: z.literal('not_established') }).strict();
export type ObservedAcquisition = z.infer<typeof observedAcquisitionSchema>;
const positive = z.string().min(1).max(32).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/).refine(s => !/\s/.test(s) && /[1-9]/.test(s));
export const observedMathRequestSchema = z.object({ schema: z.literal('gelt.spy253-observed-math-request.v2'), classification: z.literal('source_inspection_only'), originalBundleSha256: observedDigestSchema, caseEpochSha256: observedDigestSchema, selectedSha256: observedDigestSchema,
    assets: z.tuple([z.literal('SPY-CLOSE-RELATIVE'), z.literal('DECLARED-UNIT-RESERVE')]), rows: z.array(z.tuple([positive, z.literal('1')])).length(64) }).strict();
export const observedContextSchema = z.object({ schema: z.literal('gelt.a64-observed-context.v2'), binding: observedBindingSchema, profileSha256: observedDigestSchema, originalBundleSha256: observedDigestSchema,
    inspectionStart: observedStampSchema, inspectionEnd: observedStampSchema, assessmentAt: observedStampSchema, timingMeaning: z.literal('local_observation_unqualified_clock'), serializedMeaning: z.literal('declarations_not_issuance') }).strict();
export type ObservedContext = z.infer<typeof observedContextSchema>;
export const observedClaims = Object.freeze({ classification: 'source_inspection_only', completion: 'unknown', vintage: 'unknown', providerRevisionCoherence: 'unknown', historicalAvailability: 'unknown', authenticity: 'not_established', runtimeQualification: 'not_established', actualChecks: 'all16_unknown', C07: 'UNKNOWN', C13: 'UNKNOWN', C14: 'UNKNOWN', operationalDecisions: 0, consumptionAttempts: 0, persistence: 'not_performed', effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false, qualification: 'NOT_READY', production: 'CLOSED', operations: 'DEFER' } as const);
export const observedRejectionReasonSchema = z.enum(['invalid_source', 'invalid_input', 'resource_limit', 'unrepresentable_math']);
export type ObservedReason = z.infer<typeof observedRejectionReasonSchema>;
export const observedNegativeSchema = z.object({ schema: z.literal('gelt.a64-observed-rejection.v2'), binding: observedBindingSchema, profile: observedProfileSchema, reason: observedRejectionReasonSchema, reported: z.literal(true) }).strict();
export class ObservedSnapshotError extends Error {
    constructor(readonly reason: ObservedReason | 'uncertain' | 'unavailable' | 'already_attempted' | 'already_retained' | 'readonly') { super('Observed evidence unavailable'); }
}
export function parseObservedText(text: unknown, limit: number): unknown {
    if (typeof text !== 'string' || text.length > limit || Buffer.byteLength(text) > limit)
        throw new ObservedSnapshotError('resource_limit');
    try {
        return parseResearchJSON(Buffer.from(text));
    }
    catch {
        throw new ObservedSnapshotError('invalid_input');
    }
}
export function parseObservedProfile(raw: unknown): ObservedProfile { try {
    const p = observedProfileSchema.parse(raw);
    parseObservedText(canonical(p), observedLimits.request);
    return p;
}
catch (e) {
    if (e instanceof ObservedSnapshotError)
        throw e;
    throw new ObservedSnapshotError('invalid_input');
} }
export function observedFreeze<T>(v: T): T { if (v && typeof v === 'object') {
    for (const x of Object.values(v))
        observedFreeze(x);
    Object.freeze(v);
} return v; }
