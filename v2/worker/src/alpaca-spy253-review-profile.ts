import { createHash } from 'node:crypto';
import { z } from 'zod';
import { privateByteReviewInspection as h, type ConstructedAcceptance, type ConstructedAcceptanceFailure } from './alpaca-byte-review-checker.js';
import { encodePrivateComparison, parseJsonValueStructure, parseSourceStructure, parseRevisionTupleStructure, parseInvocationStructure, parseVerdictStructure, reviewAuthority, reviewLimits } from './alpaca-byte-review-contract.js';
import type { CheckId, ReviewChecksV1, ReviewVerdictV1, SourceV1, RevisionTupleV1 } from './alpaca-byte-review-contract.js';
import { alpacaIexAcquisitionSchema, alpacaIexRequestEvidenceSchema, alpacaSessionCalendarSchema, alpacaAvailabilitySchema, type AlpacaIexAcquisition } from './alpaca-iex-contract.js';
import { isConnectorIssuedAlpacaAcquisition } from './alpaca-iex-connector.js';
import { alpacaShadowCandidateContextSchema } from './alpaca-shadow-candidate.js';
/** Inspection of an already supplied original only; every factual supplier remains unadmitted. */
export const spy253ReviewProfile = Object.freeze({ revision: 'SPY253-DOCS-V4', scheduleRevision: 'SPY253-SCHEDULE-PROPOSAL-V3', scheduleSha256: '05974c8aa8ffbf448b746ee04ae1d24c83505b8b9bcf476b691577a8abba512d', decisionAt: '2026-10-28T13:00:00.000Z', maxAgeMs: 61200000, maximumLanes: 256 } as const);
const requestPolicy = Object.freeze({ symbol: 'SPY', feed: 'iex', adjustment: 'all', start: '2025-10-24T04:00:00.000Z', end: '2026-10-27T04:00:00.000Z', asof: '2026-10-27', timeframe: '1Day', currency: 'USD', sort: 'desc' });
export const spy253ReviewRevisions = Object.freeze({ contract: 1, consumer: '1.1', sourceClosure: 'spy253.source.unadmitted.v1', request: 'spy253.request.v3', policy: 'spy253.policy.v4', calendar: 'spy253.schedule.v3', availability: 'spy253.availability.unknown.v1', candidate: 'spy253.candidate.unavailable.v1', reviewer: 'gelt.spy253-source-inspector.v1', verdictPolicy: 'spy253.verdict.v1' } as const);
const unavailable = (): never => { throw new Error('SPY253 review unavailable'); };
function requireCondition(value: unknown): asserts value { if (!value)
    unavailable(); }
const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const equal = h.same;
const revision = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
const time = z.string().datetime({ precision: 3 }).refine(value => { try {
    return new Date(value).toISOString() === value;
}
catch {
    return false;
} });
const structure = <T>(parse: (input: unknown) => T) => z.custom<T>(value => { try {
    parse(value);
    return true;
}
catch {
    return false;
} });
const evidenceSchema = z.object({
    revision: z.literal('SPY253-DOCS-V4'),
    calendar: alpacaSessionCalendarSchema.nullable(), availability: z.array(alpacaAvailabilitySchema).min(1).max(253).nullable(),
    context: alpacaShadowCandidateContextSchema.refine(value => !Object.is(value.policy.maxAgeMs, -0)).nullable(),
    completion: z.enum(['unknown', 'contradicted']), closeCompatibility: z.enum(['unknown', 'contradicted']), adjustedPagination: z.enum(['unknown', 'contradicted']),
    providerRevisions: z.array(revision.nullable()).min(1).max(3).nullable(),
    candidate: z.null(),
}).strict();
const bindingSchema = z.object({
    schema: z.literal('gelt.spy253-review-binding.v1'), attemptId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    source: structure<SourceV1>(parseSourceStructure), revisions: structure<RevisionTupleV1>(parseRevisionTupleStructure), request: alpacaIexRequestEvidenceSchema,
    receipt: z.object({ receivedAt: time, decisionAt: time }).strict().refine(value => Date.parse(value.decisionAt) >= Date.parse(value.receivedAt)),
    pages: z.array(z.object({ page: z.number().int().min(1).max(3), byteLength: z.number().int().min(1).max(524288), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(3).refine(values => values.every((value, i) => value.page === i + 1)),
    evidence: evidenceSchema, limits: z.custom<typeof reviewLimits>(value => equal(value, reviewLimits)), authority: z.custom<typeof reviewAuthority>(value => equal(value, reviewAuthority)),
}).strict();
export type Spy253ReviewBindingV1 = z.infer<typeof bindingSchema>;
export function parseSpy253ReviewBinding(input: unknown): Spy253ReviewBindingV1 { try {
    h.seal(input);
    bindingSchema.parse(input);
    const owned = parseJsonValueStructure(input);
    requireCondition(Buffer.byteLength(encodePrivateComparison(owned), 'utf8') <= 262144);
    return owned as unknown as Spy253ReviewBindingV1;
}
catch {
    return unavailable();
} }
export function encodeSpy253ReviewBinding(input: unknown): string { return encodePrivateComparison(parseSpy253ReviewBinding(input)); }
const bindingDigest = (input: unknown): string => sha('gelt.spy253-review.binding.v1\u0000' + encodeSpy253ReviewBinding(input));
type State = 'pass' | 'fail' | 'unknown';
const put = (states: Map<CheckId, State>, id: CheckId, valid: boolean): void => { states.set(id, valid ? 'pass' : 'fail'); };
const missing = (states: Map<CheckId, State>, id: CheckId, contradicted: boolean): void => { states.set(id, contradicted ? 'fail' : 'unknown'); };
function scheduledSession(value: {
    providerTimestamp: string;
    closedAt: string;
}): boolean {
    const holidays = ['2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07'];
    const date = value.providerTimestamp.slice(0, 10), day = new Date(date + 'T00:00:00.000Z').getUTCDay();
    const daylight = date < '2025-11-02' || date >= '2026-03-08', early = date === '2025-11-28' || date === '2025-12-24';
    return date >= '2025-10-24' && date <= '2026-10-27' && day !== 0 && day !== 6 && !holidays.includes(date) && value.providerTimestamp === date + (daylight ? 'T04:00:00.000Z' : 'T05:00:00.000Z') && value.closedAt === date + (early ? 'T18:00:00.000Z' : daylight ? 'T20:00:00.000Z' : 'T21:00:00.000Z');
}
function inspect(originalInput: unknown, bindingInput: unknown): ReviewChecksV1 {
    const states = new Map<CheckId, State>();
    try {
        put(states, 'C01_ISSUANCE', isConnectorIssuedAlpacaAcquisition(originalInput));
        if (states.get('C01_ISSUANCE') !== 'pass')
            return h.vector(states);
    }
    catch {
        return h.vector(states, true);
    }
    let seals: readonly ReturnType<typeof h.seal>[];
    try {
        seals = [h.seal(originalInput), h.seal(bindingInput)];
    }
    catch (error) {
        if (h.constructionDefect(error))
            states.set('C16_IMMUTABILITY', 'fail');
        return h.vector(states, true);
    }
    const original = alpacaIexAcquisitionSchema.safeParse(originalInput);
    const parsed = bindingSchema.safeParse(bindingInput);
    if (!original.success || !parsed.success) {
        if (!parsed.success)
            for (const issue of parsed.error.issues) {
                const field = issue.path[0], evidence = issue.path[1];
                const id: CheckId | undefined = field === 'source' || field === 'revisions' || (field === 'evidence' && evidence === 'revision') ? 'C07_CLOSURE_REVISIONS' : field === 'pages' ? 'C02_PAGE_BYTES' : field === 'request' ? 'C03_REQUEST_CURSOR' : field === 'receipt' ? 'C06_RECEIPT' : field === 'authority' ? 'C12_AUTHORITY_FENCES' : field === 'evidence' ? evidence === 'calendar' ? 'C08_CALENDAR' : evidence === 'context' ? 'C10_CONTEXT_POLICY' : evidence === 'candidate' ? 'C11_CANDIDATE' : issue.path.length > 1 ? 'C09_AVAILABILITY' : undefined : undefined;
                if (id)
                    states.set(id, 'fail');
            }
        put(states, 'C16_IMMUTABILITY', seals.every(seal => seal.matches()));
        return h.vector(states, true);
    }
    let b: Spy253ReviewBindingV1;
    try {
        b = parseSpy253ReviewBinding(bindingInput);
    }
    catch {
        put(states, 'C16_IMMUTABILITY', seals.every(seal => seal.matches()));
        return h.vector(states, true);
    }
    const o = originalInput as AlpacaIexAcquisition;
    for (const check of h.collection(o, b.pages, 253))
        states.set(check.id, check.result);
    if (!equal(o.request, b.request) || !Object.entries(requestPolicy).every(([key, value]) => (o.request as unknown as Record<string, unknown>)[key] === value) || o.source !== 'alpaca-data-v2' || o.symbol !== 'SPY' || o.feed !== 'iex' || o.adjustment !== 'all' || o.asof !== requestPolicy.asof)
        states.set('C03_REQUEST_CURSOR', 'fail');
    put(states, 'C06_RECEIPT', o.receivedAt === b.receipt.receivedAt && Date.parse(b.receipt.decisionAt) >= Date.parse(o.receivedAt));
    missing(states, 'C07_CLOSURE_REVISIONS', !equal(b.revisions, spy253ReviewRevisions));
    const e = b.evidence, calendar = e.calendar;
    if (calendar !== null) {
        const sessions = calendar.sessions;
        const valid = calendar.symbol === 'SPY' && calendar.sha256 === o.calendarSha256 && sessions.length === 253 && sessions.every((session, i) => session.sessionOrdinal === i + 1 && scheduledSession(session) && session.providerTimestamp === o.observations[252 - i]?.providerTimestamp && (i === 0 || session.providerTimestamp > sessions[i - 1].providerTimestamp));
        missing(states, 'C08_CALENDAR', !valid || e.closeCompatibility === 'contradicted');
    }
    else
        missing(states, 'C08_CALENDAR', e.closeCompatibility === 'contradicted');
    let availabilityContradicted = e.completion === 'contradicted' || e.adjustedPagination === 'contradicted';
    if (e.availability !== null) {
        const values = e.availability;
        availabilityContradicted ||= values.length !== 253 || values.some((value, i) => value.providerTimestamp !== o.observations[252 - i]?.providerTimestamp || Date.parse(value.availableAt) < Date.parse(o.receivedAt) || Date.parse(value.availableAt) > Date.parse(b.receipt.decisionAt));
    }
    if (e.providerRevisions !== null) {
        const known = e.providerRevisions.filter((value): value is string => value !== null);
        availabilityContradicted ||= e.providerRevisions.length !== o.pages.length || new Set(known).size > 1;
    }
    if (calendar !== null)
        availabilityContradicted ||= calendar.sessions.some(session => Date.parse(session.completedAt) < Date.parse(session.closedAt) || Date.parse(session.completedAt) > Date.parse(o.receivedAt));
    missing(states, 'C09_AVAILABILITY', availabilityContradicted);
    const context = e.context;
    // A missing context cannot conceal a known contradiction of the frozen
    // checkpoint. Unknown factual dependencies still do not become passing.
    const contextContradicted = b.receipt.decisionAt !== spy253ReviewProfile.decisionAt
        || (context !== null && (context.expectedCalendarSha256 !== o.calendarSha256
            || context.expectedWindow.firstSessionOrdinal !== 1
            || context.expectedWindow.lastSessionOrdinal !== 253
            || context.expectedWindow.observationCount !== 253
            || context.policy.maxAgeMs !== spy253ReviewProfile.maxAgeMs
            || context.policy.scheduleSha256 !== spy253ReviewProfile.scheduleSha256));
    missing(states, 'C10_CONTEXT_POLICY', contextContradicted);
    // C11/C12 need an actual supported candidate; C15 needs admitted clock/order evidence.
    // Calendar completion fields above are declarations, never factual completion suppliers.
    put(states, 'C16_IMMUTABILITY', seals.every(seal => seal.matches()) && isConnectorIssuedAlpacaAcquisition(o));
    return h.vector(states);
}
export function inspectSpy253Review(original: unknown, binding: unknown): ReviewChecksV1 { return inspect(original, binding); }
export type Spy253ReviewAcceptance = Omit<ConstructedAcceptance, 'scope'> & Readonly<{
    scope: 'source_inspection_only';
}>;
export function createSpy253ByteReviewLane() {
    requireCondition(arguments.length === 0);
    // Share the existing source-inspection allocation ceiling with BRCFIX;
    // adding a profile must not silently double that process-local budget.
    const suffix = h.allocateInspectionLane().toString(16).padStart(12, '0'), attemptId = `70000000-0000-4000-8000-${suffix}`, invocationId = `80000000-0000-4000-8000-${suffix}`;
    let payload: {
        original: AlpacaIexAcquisition;
        input: unknown;
        binding: Spy253ReviewBindingV1;
        seals: readonly ReturnType<typeof h.seal>[];
    } | undefined;
    let ticket: object | undefined, producedVerdict: ReviewVerdictV1 | undefined, acceptedVerdict: ReviewVerdictV1 | undefined;
    let reserved = false, produced = false, consumed = false, failure: ConstructedAcceptanceFailure | undefined, lastClock = -Infinity;
    // Each closed failure kind is retained once. Priority chooses a projection,
    // never erases a previously observed independent adverse fact.
    const failures = new Set<ConstructedAcceptanceFailure>();
    const invalidate = (reason: ConstructedAcceptanceFailure): void => {
        failures.add(reason);
        if (!failure || h.failureRank(reason) < h.failureRank(failure)) failure = reason;
        acceptedVerdict = undefined;
    };
    const boundary = (): boolean => { try {
        if (!payload || !payload.seals.every(seal => seal.matches()) || !isConnectorIssuedAlpacaAcquisition(payload.original))
            invalidate('provenance_mismatch');
        const now = Date.now();
        if (!Number.isSafeInteger(now) || now < lastClock || (payload && now < Date.parse(payload.original.receivedAt)))
            invalidate('timing_unknown');
        lastClock = now;
        if (payload && now - Date.parse(payload.original.receivedAt) >= 60000)
            invalidate('late');
    }
    catch {
        invalidate('timing_unknown');
    } return failure === undefined; };
    const current = (): Spy253ReviewAcceptance => { if (payload)
        boundary(); return Object.freeze({ scope: 'source_inspection_only', accepted: acceptedVerdict !== undefined && failure === undefined, reason: failure ?? (acceptedVerdict ? 'none' : 'not_completed'), uncertainty: failure || acceptedVerdict ? 'latched' : 'none', verdict: failure ? null : acceptedVerdict ?? null }); };
    return Object.freeze({
        scope: 'source_inspection_only' as const, attemptId, invocationId,
        reserve(originalInput: unknown, bindingInput: unknown, candidate: unknown) { try {
            requireCondition(!reserved && !failure);
            reserved = true;
            requireCondition(isConnectorIssuedAlpacaAcquisition(originalInput));
            const original = originalInput as AlpacaIexAcquisition;
            requireCondition(h.reserveOriginal(original));
            const seals = [h.seal(originalInput), h.seal(bindingInput)];
            requireCondition(candidate === null && alpacaIexAcquisitionSchema.safeParse(originalInput).success);
            const binding = parseSpy253ReviewBinding(bindingInput);
            requireCondition(binding.attemptId === attemptId);
            payload = { original, input: bindingInput, binding, seals };
            requireCondition(boundary());
            return parseInvocationStructure({ schema: 'gelt.byte-review-invocation.v1', attemptId, invocationId, authorityId: 'spy253.inspection.no-market-authority.v1', revisions: binding.revisions, bindingSha256: bindingDigest(binding), startedAt: new Date(lastClock).toISOString(), deadlineAt: new Date(Date.parse(original.receivedAt) + 60000).toISOString() });
        }
        catch {
            invalidate('acceptance_failed');
            return unavailable();
        } },
        produce(): object { if (produced) {
            invalidate('duplicate_completion');
            return Object.freeze(Object.create(null) as object);
        } requireCondition(reserved); produced = true; ticket = Object.freeze(Object.create(null) as object); if (!boundary() || !payload)
            return ticket; try {
            const checks = inspect(payload.original, payload.input);
            requireCondition(boundary());
            producedVerdict = parseVerdictStructure({ schema: 'gelt.review-before-discard-verdict.v1', attemptId, invocationId, revisions: payload.binding.revisions, reviewerRevision: spy253ReviewRevisions.reviewer, authorityId: 'spy253.inspection.no-market-authority.v1', bindingSha256: bindingDigest(payload.binding), completedAt: new Date(lastClock).toISOString(), elapsedMs: lastClock - Date.parse(payload.original.receivedAt), outcome: h.outcome(checks), checks });
        }
        catch {
            invalidate('acceptance_failed');
        } return ticket; },
        accept(completion: unknown): Spy253ReviewAcceptance { if (consumed) {
            invalidate('duplicate_completion');
            return current();
        } consumed = true; if (!produced || completion !== ticket)
            invalidate('authenticity_failed'); if (!boundary() || !payload || !producedVerdict) {
            if (!failure)
                invalidate('acceptance_failed');
            return current();
        } try {
            const verdict = parseVerdictStructure(producedVerdict);
            requireCondition(verdict.attemptId === attemptId && verdict.invocationId === invocationId && verdict.bindingSha256 === bindingDigest(payload.binding) && equal(verdict.revisions, payload.binding.revisions) && verdict.reviewerRevision === spy253ReviewRevisions.reviewer && verdict.authorityId === 'spy253.inspection.no-market-authority.v1' && Date.parse(verdict.completedAt) === Date.parse(payload.original.receivedAt) + verdict.elapsedMs && Date.parse(verdict.completedAt) <= lastClock && verdict.elapsedMs < 60000 && verdict.outcome !== 'consistent_unverified');
            requireCondition(boundary());
            acceptedVerdict = verdict;
        }
        catch {
            invalidate('acceptance_failed');
        } return current(); },
        current,
        observedFailures(): readonly ConstructedAcceptanceFailure[] { return Object.freeze([...failures]); },
        markCancelled(): void { invalidate('cancelled'); }, markPriorUncertainty(): void { invalidate('prior_uncertainty'); },
        advanceFixtureElapsedTo(_milliseconds: number): void { unavailable(); }, markFixtureClockUnavailable(): void { invalidate('timing_unknown'); },
        discardPayloadReferences(): void {
            // Last applicable seal/time observation happens before discarding
            // the only retained evidence. Facts remain available to the adapter.
            if (payload) boundary();
            payload = undefined; producedVerdict = undefined; ticket = undefined; invalidate('closed');
        },
    });
}
