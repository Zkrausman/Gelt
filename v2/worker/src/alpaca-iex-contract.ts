import { createHash } from 'node:crypto';
import { z } from 'zod';

export const alpacaIexEndpoint = 'https://data.alpaca.markets/v2/stocks/bars' as const;
export const alpacaIexSource = 'alpaca-data-v2' as const;
export const alpacaIexFeed = 'iex' as const;
export const alpacaIexMaxObservations = 253;
export const alpacaIexPageSize = 100;
export const alpacaIexMaxPages = 3;
export const alpacaIexMaxPageBytes = 512 * 1024;
export const alpacaIexMaxTokenChars = 1024;
export const alpacaIexRequestTimeoutMs = 10_000;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ precision: 3 }).refine(s => {
  try { return new Date(s).toISOString() === s; } catch { return false; }
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  try { return new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s; } catch { return false; }
});
export const alpacaAsOfSchema = date;
export const alpacaSymbolSchema = z.string().min(1).max(16).regex(/^[A-Z][A-Z0-9.]{0,15}$/);
export const alpacaAdjustmentSchema = z.enum(['raw', 'split', 'dividend', 'spin-off', 'all']);

const alpacaSessionSchema = z.object({
  // Exact provider bar timestamp mapping is supplied by the named calendar;
  // the connector does not infer an exchange timezone or session date.
  providerTimestamp: timestamp,
  sessionOrdinal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  closedAt: timestamp,
  completedAt: timestamp,
  completed: z.literal(true),
  completionEvidenceSha256: hash,
}).strict();

export function alpacaSessionCalendarDigest(calendar: {
  symbol: string;
  sessions: readonly z.infer<typeof alpacaSessionSchema>[];
}): string {
  const stable = {
    symbol: calendar.symbol,
    sessions: calendar.sessions.map(session => ({
      providerTimestamp: session.providerTimestamp,
      sessionOrdinal: session.sessionOrdinal,
      closedAt: session.closedAt,
      completedAt: session.completedAt,
      completed: session.completed,
      completionEvidenceSha256: session.completionEvidenceSha256,
    })),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export const alpacaCredentialPairSchema = z.object({
  keyId: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  secretKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict().refine(pair => pair.keyId !== pair.secretKey);
export type AlpacaCredentialPair = z.infer<typeof alpacaCredentialPairSchema>;

export const alpacaSessionCalendarSchema = z.object({
  symbol: alpacaSymbolSchema,
  sha256: hash,
  sessions: z.array(alpacaSessionSchema).min(1).max(alpacaIexMaxObservations),
}).strict().refine(calendar => calendar.sha256 === alpacaSessionCalendarDigest(calendar));
export type AlpacaSessionCalendar = z.infer<typeof alpacaSessionCalendarSchema>;

export const alpacaAvailabilitySchema = z.object({
  providerTimestamp: timestamp,
  availableAt: timestamp,
  evidenceSha256: hash,
}).strict();
export type AlpacaAvailability = z.infer<typeof alpacaAvailabilitySchema>;

// Calling the connector requires an explicit one-call enable bit. There is no
// stored/default enabled configuration or application route for this module.
export const alpacaIexRequestSchema = z.object({
  enabled: z.literal(true),
  symbol: alpacaSymbolSchema,
  feed: z.literal('iex'),
  adjustment: alpacaAdjustmentSchema,
  start: timestamp,
  end: timestamp,
  calendar: alpacaSessionCalendarSchema,
  asof: alpacaAsOfSchema,
}).strict()
  .refine(r => r.calendar.symbol === r.symbol)
  .refine(r => Date.parse(r.start) <= Date.parse(r.end))
  .refine(r => r.start === r.calendar.sessions[0].providerTimestamp
    && r.end === r.calendar.sessions[r.calendar.sessions.length - 1].providerTimestamp);
export type AlpacaIexRequest = z.infer<typeof alpacaIexRequestSchema>;

export const alpacaIexDecimalSchema = z.object({
  value: z.string().max(40).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
  precision: z.number().int().min(1).max(38),
  scale: z.number().int().min(0).max(18),
}).strict().refine(d => d.value.replace('.', '').length === d.precision
  && (d.value.split('.')[1]?.length ?? 0) === d.scale);
export type AlpacaIexDecimal = z.infer<typeof alpacaIexDecimalSchema>;

export type AlpacaIexRawPage = Readonly<{
  page: number;
  byteLength: number;
  sha256: string;
  bodyBase64: string;
}>;

export type AlpacaIexRequestEvidence = Readonly<{
  symbol: string;
  feed: typeof alpacaIexFeed;
  adjustment: z.infer<typeof alpacaAdjustmentSchema>;
  start: string;
  end: string;
  asof: string;
  timeframe: '1Day';
  currency: 'USD';
  sort: 'desc';
  pageRequests: readonly Readonly<{ page: number; limit: number; pageTokenSha256: string | null }>[];
}>;

export type AlpacaIexAcquisition = Readonly<{
  schema: 'gelt.alpaca-iex-acquisition.v1';
  source: typeof alpacaIexSource;
  feed: typeof alpacaIexFeed;
  symbol: string;
  adjustment: z.infer<typeof alpacaAdjustmentSchema>;
  asof: string;
  receivedAt: string;
  calendarSha256: string;
  request: AlpacaIexRequestEvidence;
  pages: readonly AlpacaIexRawPage[];
  observations: readonly Readonly<{ providerTimestamp: string; close: AlpacaIexDecimal }>[];
}>;

export type AlpacaIexNormalizedBars = Readonly<{
  schema: 'gelt.alpaca-iex-normalized-bars.v1';
  classification: 'market_shadow_input';
  eligibility: 'unverified';
  source: typeof alpacaIexSource;
  feed: typeof alpacaIexFeed;
  symbol: string;
  adjustment: z.infer<typeof alpacaAdjustmentSchema>;
  asof: string;
  decisionAt: string;
  receivedAt: string;
  calendarSha256: string;
  availabilityEvidenceSha256: string;
  rawPages: readonly AlpacaIexRawPage[];
  effectAuthority: 'none';
  promotionAllowed: false;
  bars: readonly Readonly<{
    sessionOrdinal: number;
    closedAt: string;
    availableAt: string;
    adjustedClose: AlpacaIexDecimal;
  }>[];
}>;

export const alpacaIexRawPageSchema = z.object({
  page: z.number().int().min(1).max(alpacaIexMaxPages),
  byteLength: z.number().int().min(1).max(alpacaIexMaxPageBytes),
  sha256: hash,
  bodyBase64: z.string().max(Math.ceil(alpacaIexMaxPageBytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export const alpacaIexRequestEvidenceSchema = z.object({
  symbol: alpacaSymbolSchema, feed: z.literal(alpacaIexFeed), adjustment: alpacaAdjustmentSchema,
  start: timestamp, end: timestamp, asof: alpacaAsOfSchema, timeframe: z.literal('1Day'),
  currency: z.literal('USD'), sort: z.literal('desc'),
  pageRequests: z.array(z.object({
    page: z.number().int().min(1).max(alpacaIexMaxPages),
    limit: z.number().int().min(1).max(alpacaIexPageSize),
    pageTokenSha256: hash.nullable(),
  }).strict()).min(1).max(alpacaIexMaxPages),
}).strict();
export const alpacaIexAcquisitionSchema = z.object({
  schema: z.literal('gelt.alpaca-iex-acquisition.v1'),
  source: z.literal(alpacaIexSource), feed: z.literal(alpacaIexFeed),
  symbol: alpacaSymbolSchema, adjustment: alpacaAdjustmentSchema,
  asof: alpacaAsOfSchema, receivedAt: timestamp, calendarSha256: hash,
  request: alpacaIexRequestEvidenceSchema,
  pages: z.array(alpacaIexRawPageSchema).min(1).max(alpacaIexMaxPages),
  observations: z.array(z.object({ providerTimestamp: timestamp, close: alpacaIexDecimalSchema }).strict())
    .min(1).max(alpacaIexMaxObservations),
}).strict();
