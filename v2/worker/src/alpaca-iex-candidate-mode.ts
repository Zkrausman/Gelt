import { z } from 'zod';
import { alpacaSessionCalendarSchema, alpacaSessionCalendarDigest, type AlpacaIexAcquisition } from './alpaca-iex-contract.js';
import { isConnectorIssuedAlpacaAcquisition, verifyAlpacaIexAcquisition } from './alpaca-iex-connector.js';
import { alpacaShadowCandidateContextSchema, buildAlpacaShadowCandidate } from './alpaca-shadow-candidate.js';
import { parseResearchJSON } from './research-json.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const alpacaCandidateModeRequest = Object.freeze({ symbol: 'SPY', feed: 'iex', timeframe: '1Day',
  currency: 'USD', adjustment: 'raw', sort: 'desc', start: '2025-10-15T04:00:00.000Z',
  end: '2026-10-16T04:00:00.000Z', asof: '2026-10-16' } as const);
const planSchema = z.object({
  schema: z.literal('gelt.alpaca-iex-candidate-plan.v1'),
  calendar: alpacaSessionCalendarSchema,
  context: alpacaShadowCandidateContextSchema,
  availabilityBasis: z.literal('final_connector_receipt'),
  availabilityEvidenceSha256: hash,
}).strict().refine(p => p.calendar.symbol === 'SPY' && p.calendar.sessions.length === 253
  && p.calendar.sha256 === alpacaSessionCalendarDigest(p.calendar)
  && p.context.expectedCalendarSha256 === p.calendar.sha256
  && p.context.expectedWindow.firstSessionOrdinal === 0
  && p.context.expectedWindow.lastSessionOrdinal === 252
  && p.context.expectedWindow.observationCount === 253);
type Plan = z.infer<typeof planSchema>;
const prepared = new WeakSet<object>();
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Parse owned bytes before acquisition; no defaults, hooks or effects. */
export function prepareAlpacaCandidateModePlan(bytes: Buffer): Plan {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 256 * 1024) throw new Error();
    const plan = freeze(planSchema.parse(parseResearchJSON(Buffer.from(bytes))));
    prepared.add(plan);
    return plan;
  } catch { throw new Error('Candidate plan unavailable'); }
}

/** Same-process terminal handoff: return metadata only, never the market payload. */
export function completeAlpacaCandidateMode(acquisitionInput: unknown, plan: Plan, decisionAt: string) {
  let candidate: ReturnType<typeof buildAlpacaShadowCandidate> | undefined;
  try {
    if (!prepared.has(plan) || !isConnectorIssuedAlpacaAcquisition(acquisitionInput)
      || !verifyAlpacaIexAcquisition(acquisitionInput)) throw new Error();
    const acquisition = acquisitionInput as AlpacaIexAcquisition;
    if (acquisition.symbol !== 'SPY' || acquisition.feed !== 'iex' || acquisition.adjustment !== 'raw'
      || acquisition.asof !== alpacaCandidateModeRequest.asof
      || Object.entries(alpacaCandidateModeRequest).some(([key, value]) => acquisition.request[key as keyof typeof alpacaCandidateModeRequest] !== value)
      || acquisition.calendarSha256 !== plan.calendar.sha256 || acquisition.observations.length !== 253
      || acquisition.observations.some((o, i) => o.providerTimestamp !== plan.calendar.sessions[252 - i].providerTimestamp)) throw new Error();
    prepared.delete(plan);
    candidate = buildAlpacaShadowCandidate(acquisition, {
      source: acquisition.source, feed: acquisition.feed, symbol: acquisition.symbol,
      adjustment: acquisition.adjustment, asof: acquisition.asof, calendar: plan.calendar,
      receivedAt: acquisition.receivedAt, decisionAt,
      availability: plan.calendar.sessions.map(s => ({ providerTimestamp: s.providerTimestamp,
        availableAt: acquisition.receivedAt, evidenceSha256: plan.availabilityEvidenceSha256 })),
    }, plan.context);
    if (candidate.status !== 'candidate' || candidate.replayMatches !== true
      || candidate.classification !== 'market_shadow_input' || candidate.eligibility !== 'unverified'
      || candidate.receipt.inputValidation !== 'valid' || candidate.receipt.decision !== 'abstain'
      || candidate.receipt.reason !== 'unverified_data' || candidate.receipt.effectAuthority !== 'none'
      || candidate.receipt.promotionAllowed !== false) throw new Error();
    return Object.freeze({
      schema: 'gelt.alpaca-iex-candidate-summary.v1' as const,
      status: 'candidate_unverified_memory_only' as const,
      decision: 'abstain' as const, reason: 'unverified_data' as const,
      decisionAt, freshness: 'not_established' as const,
      signalCompatibility: 'raw_not_adjusted' as const,
      g06Compatibility: 'constructed_only_consumer' as const,
      classification: 'market_shadow_input' as const, eligibility: 'unverified' as const,
      effectAuthority: 'none' as const, promotionAllowed: false as const,
    });
  } catch { throw new Error('Candidate handoff unavailable'); }
  finally { candidate = undefined; }
}
