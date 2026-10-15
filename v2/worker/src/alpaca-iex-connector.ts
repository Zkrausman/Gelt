import { createHash } from 'node:crypto';
import { parseResearchJSONNumberTokens } from './research-json.js';
import {
  alpacaAdjustmentSchema, alpacaCredentialPairSchema, alpacaIexEndpoint,
  alpacaIexAcquisitionSchema,
  alpacaIexMaxPageBytes, alpacaIexMaxPages, alpacaIexMaxTokenChars,
  alpacaIexPageSize, alpacaIexRequestSchema, alpacaIexRequestTimeoutMs,
  type AlpacaCredentialPair, type AlpacaIexAcquisition, type AlpacaIexDecimal,
  type AlpacaIexRawPage, type AlpacaIexRequest,
} from './alpaca-iex-contract.js';

const unavailable = () => new Error('Alpaca market data unavailable');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pathKey = (path: (string | number)[]) => JSON.stringify(path);
const pageBodyLimit = alpacaIexMaxPageBytes;
const tokenPattern = /^[A-Za-z0-9._~-]+$/;

function providerTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value)) throw unavailable();
  const fraction = value.match(/\.(\d+)Z$/)?.[1];
  const withMillis = fraction ? value.replace(/\.(\d+)Z$/, `.${fraction.padEnd(3, '0')}Z`) : value.replace('Z', '.000Z');
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== withMillis) throw unavailable();
  return new Date(epoch).toISOString();
}

function decimalFromToken(token: string | undefined, positive: boolean): AlpacaIexDecimal {
  if (!token || token.length > 40 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(token)) throw unavailable();
  const scale = token.split('.')[1]?.length ?? 0;
  const precision = token.replace('.', '').length;
  if (precision < 1 || precision > 38 || scale > 18 || (positive && !/[1-9]/.test(token))) throw unavailable();
  return { value: token, precision, scale };
}

function compareDecimals(a: AlpacaIexDecimal, b: AlpacaIexDecimal): number {
  const scale = Math.max(a.scale, b.scale);
  const left = BigInt(a.value.replace('.', '')) * 10n ** BigInt(scale - a.scale);
  const right = BigInt(b.value.replace('.', '')) * 10n ** BigInt(scale - b.scale);
  return left > right ? 1 : left < right ? -1 : 0;
}

function validateCalendarOrder(request: AlpacaIexRequest) {
  const sessions = request.calendar.sessions;
  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i].sessionOrdinal !== sessions[i - 1].sessionOrdinal + 1
      || Date.parse(sessions[i].providerTimestamp) <= Date.parse(sessions[i - 1].providerTimestamp)
      || Date.parse(sessions[i].closedAt) <= Date.parse(sessions[i - 1].closedAt)) throw unavailable();
  }
}

async function boundedBody(response: Response): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > pageBodyLimit)) throw unavailable();
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > pageBodyLimit) { await reader.cancel(); throw unavailable(); }
      chunks.push(Buffer.from(item.value));
    }
  } catch { throw unavailable(); }
  return Buffer.concat(chunks, size);
}

function parsePage(bytes: Buffer, symbol: string, limit: number) {
  let parsed: ReturnType<typeof parseResearchJSONNumberTokens>;
  try { parsed = parseResearchJSONNumberTokens(bytes); } catch { throw unavailable(); }
  const root = parsed.value;
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw unavailable();
  const record = root as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'bars,next_page_token') throw unavailable();
  const barsObject = record.bars;
  if (!barsObject || typeof barsObject !== 'object' || Array.isArray(barsObject)) throw unavailable();
  const bySymbol = barsObject as Record<string, unknown>;
  if (Object.keys(bySymbol).length !== 1 || Object.keys(bySymbol)[0] !== symbol || !Array.isArray(bySymbol[symbol])) throw unavailable();
  const rows = bySymbol[symbol] as unknown[];
  if (rows.length < 1 || rows.length > limit) throw unavailable();
  const token = record.next_page_token;
  if (token !== null && (typeof token !== 'string' || token.length < 1 || token.length > alpacaIexMaxTokenChars || !tokenPattern.test(token))) throw unavailable();
  const observations = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
    const bar = row as Record<string, unknown>;
    if (Object.keys(bar).sort().join(',') !== 'c,h,l,n,o,t,v,vw') throw unavailable();
    const t = providerTimestamp(bar.t);
    const numeric: Record<string, AlpacaIexDecimal> = {};
    for (const field of ['o', 'h', 'l', 'c', 'v', 'n', 'vw']) {
      const tokenValue = parsed.numberTokens.get(pathKey(['bars', symbol, index, field]));
      if (typeof bar[field] !== 'number' || !Number.isFinite(bar[field] as number)) throw unavailable();
      numeric[field] = decimalFromToken(tokenValue, field !== 'v' && field !== 'n');
    }
    if (numeric.n.scale !== 0
      || compareDecimals(numeric.h, numeric.o) < 0 || compareDecimals(numeric.h, numeric.c) < 0
      || compareDecimals(numeric.l, numeric.o) > 0 || compareDecimals(numeric.l, numeric.c) > 0) throw unavailable();
    return { providerTimestamp: t, close: numeric.c };
  });
  return { observations, nextPageToken: token as string | null };
}

function pageUrl(request: AlpacaIexRequest, limit: number, token: string | null): string {
  const url = new URL(alpacaIexEndpoint);
  url.searchParams.set('symbols', request.symbol);
  url.searchParams.set('timeframe', '1Day');
  url.searchParams.set('feed', 'iex');
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('adjustment', alpacaAdjustmentSchema.parse(request.adjustment));
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('start', request.start);
  url.searchParams.set('end', request.end);
  url.searchParams.set('asof', request.asof);
  if (token !== null) url.searchParams.set('page_token', token);
  return url.toString();
}

async function fetchPage(fetcher: typeof fetch, url: string, credentials: AlpacaCredentialPair): Promise<Buffer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, alpacaIexRequestTimeoutMs);
    timer.unref?.();
  });
  const operation = (async () => {
    const response = await fetcher(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'APCA-API-KEY-ID': credentials.keyId,
        'APCA-API-SECRET-KEY': credentials.secretKey,
      },
    });
    if (response.status !== 200 || !response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      try { await response.body?.cancel(); } catch { /* Sanitized failure below. */ }
      throw unavailable();
    }
    if (response.url && response.url !== url) {
      try { await response.body?.cancel(); } catch { /* Sanitized failure below. */ }
      throw unavailable();
    }
    const bytes = await boundedBody(response);
    if (bytes.includes(Buffer.from(credentials.keyId)) || bytes.includes(Buffer.from(credentials.secretKey))) throw unavailable();
    return bytes;
  })();
  try { return await Promise.race([operation, timeout]); }
  catch { controller.abort(); throw unavailable(); }
  finally { if (timer) clearTimeout(timer); }
}

export type AlpacaIexFetchOptions = Readonly<{ fetcher?: typeof fetch }>;

// Standalone historical-data GET only. The provider call is explicit per call,
// fully injectable for offline tests, and has no order/account/stream fallback.
export async function acquireAlpacaIexDailyBars(input: unknown, credentialInput: unknown, options: AlpacaIexFetchOptions = {}): Promise<AlpacaIexAcquisition> {
  let request: AlpacaIexRequest, credentials: AlpacaCredentialPair;
  try {
    request = alpacaIexRequestSchema.parse(input);
    credentials = alpacaCredentialPairSchema.parse(credentialInput);
    validateCalendarOrder(request);
  } catch { throw unavailable(); }
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw unavailable();
  const rawPages: AlpacaIexRawPage[] = [];
  const pageRequests: { page: number; limit: number; pageTokenSha256: string | null }[] = [];
  const observations: { providerTimestamp: string; close: AlpacaIexDecimal }[] = [];
  const seenTokens = new Set<string>();
  let token: string | null = null;
  let previousTimestamp = Number.POSITIVE_INFINITY;
  let page = 0;
  try {
    while (observations.length < request.calendar.sessions.length) {
      if (page >= alpacaIexMaxPages) throw unavailable();
      if (token !== null) {
        if (seenTokens.has(token)) throw unavailable();
        seenTokens.add(token);
      }
      const limit = Math.min(alpacaIexPageSize, request.calendar.sessions.length - observations.length);
      const url = pageUrl(request, limit, token);
      pageRequests.push({ page: page + 1, limit, pageTokenSha256: token === null ? null : sha256(Buffer.from(token)) });
      const bytes = await fetchPage(fetcher, url, credentials);
      const parsed = parsePage(bytes, request.symbol, limit);
      for (const observation of parsed.observations) {
        const time = Date.parse(observation.providerTimestamp);
        if (time >= previousTimestamp) throw unavailable();
        previousTimestamp = time;
        observations.push(observation);
      }
      page++;
      rawPages.push(Object.freeze({ page, byteLength: bytes.length, sha256: sha256(bytes), bodyBase64: bytes.toString('base64') }));
      if (parsed.nextPageToken !== null && seenTokens.has(parsed.nextPageToken)) throw unavailable();
      if (observations.length < request.calendar.sessions.length) {
        if (!parsed.nextPageToken) throw unavailable();
        token = parsed.nextPageToken;
      }
    }
  } catch { throw unavailable(); }
  if (observations.length !== request.calendar.sessions.length) throw unavailable();
  let receivedAt: string;
  try {
    receivedAt = new Date().toISOString();
    if (new Date(receivedAt).toISOString() !== receivedAt) throw new Error();
  } catch { throw unavailable(); }
  return Object.freeze({
    schema: 'gelt.alpaca-iex-acquisition.v1', source: 'alpaca-data-v2', feed: 'iex',
    symbol: request.symbol, adjustment: request.adjustment, asof: request.asof,
    receivedAt, calendarSha256: request.calendar.sha256,
    request: Object.freeze({ symbol: request.symbol, feed: 'iex', adjustment: request.adjustment,
      start: request.start, end: request.end, asof: request.asof, timeframe: '1Day',
      currency: 'USD', sort: 'desc', pageRequests: Object.freeze(pageRequests.map(p => Object.freeze(p))) }),
    pages: Object.freeze(rawPages), observations: Object.freeze(observations.map(o => Object.freeze({
      providerTimestamp: o.providerTimestamp, close: Object.freeze({ ...o.close }),
    }))),
  });
}

// Re-decode the exact retained response bytes and bind every close token,
// page cursor, request bound, and digest to the structured acquisition fields.
// This is an integrity check, not an Alpaca signature, rights, or eligibility proof.
export function verifyAlpacaIexAcquisition(input: unknown): boolean {
  try {
    const acquisition = alpacaIexAcquisitionSchema.parse(input);
    const request = acquisition.request;
    if (request.symbol !== acquisition.symbol || request.feed !== acquisition.feed
      || request.adjustment !== acquisition.adjustment || request.asof !== acquisition.asof
      || Date.parse(request.start) > Date.parse(request.end)
      || acquisition.pages.length !== request.pageRequests.length) return false;
    let expectedToken: string | null = null;
    let offset = 0, previousTimestamp = Number.POSITIVE_INFINITY;
    const seenTokens = new Set<string>();
    for (let i = 0; i < acquisition.pages.length; i++) {
      const page = acquisition.pages[i], pageRequest = request.pageRequests[i];
      const bytes = Buffer.from(page.bodyBase64, 'base64');
      const expectedLimit = Math.min(alpacaIexPageSize, acquisition.observations.length - offset);
      if (page.page !== i + 1 || pageRequest.page !== i + 1 || pageRequest.limit !== expectedLimit
        || pageRequest.pageTokenSha256 !== (expectedToken === null ? null : sha256(Buffer.from(expectedToken)))
        || (expectedToken !== null && seenTokens.has(expectedToken))
        || page.byteLength !== bytes.length || sha256(bytes) !== page.sha256) return false;
      if (expectedToken !== null) seenTokens.add(expectedToken);
      const parsed = parsePage(bytes, acquisition.symbol, pageRequest.limit);
      for (const observation of parsed.observations) {
        const time = Date.parse(observation.providerTimestamp);
        const supplied = acquisition.observations[offset++];
        if (time >= previousTimestamp || !supplied || supplied.providerTimestamp !== observation.providerTimestamp
          || supplied.close.value !== observation.close.value || supplied.close.precision !== observation.close.precision
          || supplied.close.scale !== observation.close.scale) return false;
        previousTimestamp = time;
      }
      if (parsed.nextPageToken !== null && seenTokens.has(parsed.nextPageToken)) return false;
      expectedToken = parsed.nextPageToken;
      if (offset < acquisition.observations.length) {
        if (!expectedToken) return false;
      }
    }
    return offset === acquisition.observations.length;
  } catch { return false; }
}
