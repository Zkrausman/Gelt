import { createHash } from 'node:crypto';
import {
  alpacaAsOfSchema,
  alpacaAvailabilitySchema, alpacaIexAcquisitionSchema, alpacaIexMaxPageBytes,
  alpacaIexMaxPages, alpacaIexMaxObservations, alpacaSessionCalendarSchema,
  alpacaSymbolSchema, alpacaAdjustmentSchema, alpacaIexFeed, alpacaIexSource,
  type AlpacaAvailability, type AlpacaIexAcquisition, type AlpacaIexNormalizedBars,
  type AlpacaSessionCalendar,
} from './alpaca-iex-contract.js';
import { verifyAlpacaIexAcquisition } from './alpaca-iex-connector.js';

const rejected = () => new Error('Alpaca bars cannot be normalized');
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const iso = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
};

export type AlpacaIexNormalizationInput = Readonly<{
  source: typeof alpacaIexSource;
  feed: typeof alpacaIexFeed;
  symbol: string;
  adjustment: 'raw' | 'split' | 'dividend' | 'spin-off' | 'all';
  asof: string;
  calendar: AlpacaSessionCalendar;
  availability: readonly AlpacaAvailability[];
  receivedAt: string;
  decisionAt: string;
}>;

// Emits only the existing G05 bar projection. Calendar completion, point-in-
// time availability, and exchange rights stay caller declarations; the result
// remains unverified market input and cannot establish admission or promotion.
export function normalizeAlpacaIexBars(acquisitionInput: unknown, input: AlpacaIexNormalizationInput): AlpacaIexNormalizedBars {
  try {
    const acquisition = alpacaIexAcquisitionSchema.parse(acquisitionInput) as AlpacaIexAcquisition;
    const symbol = alpacaSymbolSchema.parse(input.symbol);
    const adjustment = alpacaAdjustmentSchema.parse(input.adjustment);
    const calendar = alpacaSessionCalendarSchema.parse(input.calendar);
    if (input.source !== alpacaIexSource || input.feed !== alpacaIexFeed || !iso(input.receivedAt) || !iso(input.decisionAt)) throw rejected();
    if (acquisition.source !== input.source || acquisition.feed !== input.feed || acquisition.symbol !== symbol
      || acquisition.adjustment !== adjustment || acquisition.asof !== input.asof
      || acquisition.receivedAt !== input.receivedAt || acquisition.calendarSha256 !== calendar.sha256
      || calendar.symbol !== symbol || !verifyAlpacaIexAcquisition(acquisition)) throw rejected();
    if (alpacaAsOfSchema.parse(input.asof) !== input.asof) throw rejected();
    const receivedAt = Date.parse(input.receivedAt), decisionAt = Date.parse(input.decisionAt);
    if (decisionAt < receivedAt) throw rejected();
    const availability = input.availability.map(e => alpacaAvailabilitySchema.parse(e));
    const sessions = calendar.sessions;
    if (availability.length !== sessions.length || acquisition.observations.length !== sessions.length
      || acquisition.pages.length > alpacaIexMaxPages || sessions.length > alpacaIexMaxObservations) throw rejected();
    let totalPageBytes = 0;
    for (let i = 0; i < acquisition.pages.length; i++) {
      const page = acquisition.pages[i];
      const pageBytes = Buffer.from(page.bodyBase64, 'base64');
      if (page.page !== i + 1 || pageBytes.byteLength !== page.byteLength || page.byteLength > alpacaIexMaxPageBytes
        || hash(pageBytes) !== page.sha256) throw rejected();
      totalPageBytes += page.byteLength;
      if (totalPageBytes > alpacaIexMaxPages * alpacaIexMaxPageBytes) throw rejected();
    }
    const bars = [];
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i], availabilityFact = availability[i];
      if (i > 0 && (session.sessionOrdinal !== sessions[i - 1].sessionOrdinal + 1
        || Date.parse(session.providerTimestamp) <= Date.parse(sessions[i - 1].providerTimestamp)
        || Date.parse(session.closedAt) <= Date.parse(sessions[i - 1].closedAt))) throw rejected();
      const requestStart = Date.parse(acquisition.request.start), requestEnd = Date.parse(acquisition.request.end);
      if (availabilityFact.providerTimestamp !== session.providerTimestamp) throw rejected();
      const observation = acquisition.observations[sessions.length - 1 - i];
      if (!observation || observation.providerTimestamp !== session.providerTimestamp) throw rejected();
      const providerAt = Date.parse(session.providerTimestamp), closedAt = Date.parse(session.closedAt);
      const completedAt = Date.parse(session.completedAt), availableAt = Date.parse(availabilityFact.availableAt);
      if (providerAt < requestStart || providerAt > requestEnd || providerAt > closedAt || closedAt > decisionAt
        || completedAt < closedAt || completedAt > receivedAt
        || availableAt < receivedAt || availableAt < completedAt || availableAt > decisionAt) throw rejected();
      bars.push(Object.freeze({
        sessionOrdinal: session.sessionOrdinal,
        closedAt: session.closedAt,
        availableAt: availabilityFact.availableAt,
        adjustedClose: Object.freeze({ ...observation.close }),
      }));
    }
    const availabilityEvidenceSha256 = hash(JSON.stringify({
      calendarSha256: calendar.sha256,
      availability: availability.map(({ providerTimestamp, availableAt, evidenceSha256 }) => ({ providerTimestamp, availableAt, evidenceSha256 })),
      completion: sessions.map(({ providerTimestamp, completedAt, completionEvidenceSha256 }) => ({ providerTimestamp, completedAt, completionEvidenceSha256 })),
    }));
    return Object.freeze({
      schema: 'gelt.alpaca-iex-normalized-bars.v1',
      classification: 'market_shadow_input', eligibility: 'unverified',
      source: alpacaIexSource, feed: alpacaIexFeed, symbol, adjustment, asof: input.asof,
      decisionAt: input.decisionAt, receivedAt: input.receivedAt,
      calendarSha256: calendar.sha256, availabilityEvidenceSha256,
      rawPages: Object.freeze(acquisition.pages.map(p => Object.freeze({ ...p }))),
      effectAuthority: 'none', promotionAllowed: false,
      bars: Object.freeze(bars),
    });
  } catch { throw rejected(); }
}
