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
// The provider documents page tokens as opaque strings. Keep a printable
// bounded alphabet without assuming URL-safe/base64 encoding details.
const tokenPattern = /^[\x21-\x7e]+$/;
const issuedAcquisitions = new WeakMap<object, string>();

export function isConnectorIssuedAlpacaAcquisition(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const issuedAt = issuedAcquisitions.get(input);
  return typeof issuedAt === 'string' && (input as { receivedAt?: unknown }).receivedAt === issuedAt;
}

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

function pageUrl(request: Pick<AlpacaIexRequest, 'symbol' | 'adjustment' | 'start' | 'end' | 'asof'>, limit: number, token: string | null): string {
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
      if (observations.length === request.calendar.sessions.length && parsed.nextPageToken !== null) throw unavailable();
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
  const acquisition: AlpacaIexAcquisition = Object.freeze({
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
  issuedAcquisitions.set(acquisition, receivedAt);
  return acquisition;
}

// Re-decode the exact retained response bytes and bind every close token,
// page cursor, request bound, and digest to the structured acquisition fields.
// This is an integrity check, not an Alpaca signature, rights, or eligibility proof.
export function verifyAlpacaIexAcquisition(input: unknown): boolean {
  try {
    const acquisition = alpacaIexAcquisitionSchema.parse(input);
    return verifyDecodedAcquisition(acquisition);
  } catch { return false; }
}
function verifyDecodedAcquisition(acquisition: Pick<AlpacaIexAcquisition,
  'request' | 'pages' | 'observations' | 'symbol' | 'feed' | 'adjustment' | 'asof'>): boolean {
  try {
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
      } else if (expectedToken !== null) return false;
    }
    return offset === acquisition.observations.length;
  } catch { return false; }
}

// Closed v2 lane. Mandatory injection; no global-fetch or v1 issuance fallback.
import { observedAcquisitionSchema, observedOrdered, observedStampSchema, observedFreeze,
  parseObservedProfile, ObservedSnapshotError, type ObservedAcquisition, type ObservedProfile,
  type ObservedClock, type ObservedStamp } from './alpaca-observed-snapshot-contract.js';
const observedIssued = new WeakMap<object, { profile: string; reserved: boolean }>();
export function reserveObservedOriginal(input: unknown, profile: unknown): void {
  if (!input || typeof input !== 'object') throw new ObservedSnapshotError('invalid_source');
  const state = observedIssued.get(input);
  if (!state || state.reserved) throw new ObservedSnapshotError('invalid_source');
  state.reserved = true;
  let bound: ObservedProfile;
  try { bound = parseObservedProfile(profile); } catch { throw new ObservedSnapshotError('invalid_source'); }
  if (state.profile !== bound.profileSha256) throw new ObservedSnapshotError('invalid_source');
}
export function verifyObservedAcquisitionData(input: unknown): boolean {
  try {
    const a = observedAcquisitionSchema.parse(input), p = parseObservedProfile(a.profile), request = a.request;
    if (request.symbol !== p.symbol || request.feed !== p.feed || request.adjustment !== p.adjustment
      || request.asof !== p.asof || request.start !== p.start || request.end !== p.end
      || a.pages.length !== a.timing.pages.length
      || a.timing.pages.some(page => page.bodyComplete.mono - page.start.mono > alpacaIexRequestTimeoutMs) || a.pages.some(page => {
        const b = Buffer.from(page.bodyBase64, 'base64'); return b.toString('base64') !== page.bodyBase64;
      }) || !a.observations.every((o, i) => o.providerTimestamp === p.sessions[252 - i].providerTimestamp)) return false;
    return observedOrdered(a.timing.collectionStart, ...a.timing.pages.flatMap(t => [t.start, t.bodyComplete]), a.timing.collectionEnd)
      && verifyDecodedAcquisition({ ...a, symbol: p.symbol, feed: p.feed, adjustment: p.adjustment, asof: p.asof });
  } catch { return false; }
}
export function observedClockReader(clock: ObservedClock, previous?: ObservedStamp) {
  let last = previous;
  return (): ObservedStamp => {
    try {
      const now = observedStampSchema.parse({ utc: clock.utcNow(), mono: clock.monotonicNow() });
      if (last && !observedOrdered(last, now)) throw new Error();
      last = now; return Object.freeze(now);
    } catch { throw new ObservedSnapshotError('uncertain'); }
  };
}
async function fetchObservedPage(fetcher: typeof fetch, url: string, credentials: AlpacaCredentialPair,
  complete: () => ObservedStamp): Promise<Readonly<{ bytes: Buffer; bodyComplete: ObservedStamp }>> {
  const controller = new AbortController(); let active = true, knownComplete = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { active = false; controller.abort(); reject(new ObservedSnapshotError('uncertain')); }, alpacaIexRequestTimeoutMs);
    timer.unref?.();
  });
  const operation = (async () => {
    try {
      const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'APCA-API-KEY-ID': credentials.keyId, 'APCA-API-SECRET-KEY': credentials.secretKey } });
      if (!active) { try { await response.body?.cancel(); } catch {} throw new ObservedSnapshotError('uncertain'); }
      if (response.status !== 200 || !response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
        || (response.url && response.url !== url)) {
        await response.body?.cancel();
        if (!active) throw new ObservedSnapshotError('uncertain');
        complete(); // Settled cancellation still needs a valid, in-budget completion observation.
        knownComplete = true;
        throw new ObservedSnapshotError('invalid_source');
      }
      const bytes = await boundedBody(response);
      if (!active) throw new ObservedSnapshotError('uncertain');
      const bodyComplete = complete(); // Gate even credential-echo rejections after a complete body.
      knownComplete = true;
      if (bytes.includes(Buffer.from(credentials.keyId)) || bytes.includes(Buffer.from(credentials.secretKey))) throw new ObservedSnapshotError('invalid_source');
      return { bytes, bodyComplete };
    } catch (e) { if (active && knownComplete && e instanceof ObservedSnapshotError) throw e; throw new ObservedSnapshotError('uncertain'); }
  })();
  try { return await Promise.race([operation, timeout]); }
  catch (e) { active = false; controller.abort(); throw e; }
  finally { if (timer) clearTimeout(timer); }
}
export async function acquireObservedSnapshot(input: unknown, credentialInput: unknown,
  options: Readonly<{ fetcher: typeof fetch; clock: ObservedClock }>): Promise<ObservedAcquisition> {
  const profile = parseObservedProfile(input);
  let credentials: AlpacaCredentialPair;
  try {
    credentials = alpacaCredentialPairSchema.parse(credentialInput);
    if (typeof options.fetcher !== 'function' || typeof options.clock.utcNow !== 'function'
      || typeof options.clock.monotonicNow !== 'function') throw new Error();
  } catch { throw new ObservedSnapshotError('invalid_input'); }
  const stamp = observedClockReader(options.clock), collectionStart = stamp();
  const pages: AlpacaIexRawPage[] = [], pageRequests: {page:number;limit:number;pageTokenSha256:string|null}[] = [];
  const observations: {providerTimestamp:string;close:AlpacaIexDecimal}[] = [];
  const timing: {start:ObservedStamp;bodyComplete:ObservedStamp}[] = [];
  let token: string | null = null; const seen = new Set<string>();
  for (let page = 1; observations.length < 253; page++) {
    if (page > 3 || (token !== null && seen.has(token))) throw new ObservedSnapshotError('invalid_source');
    if (token !== null) seen.add(token);
    const limit = Math.min(100, 253 - observations.length), start = stamp();
    const { bytes, bodyComplete } = await fetchObservedPage(options.fetcher, pageUrl(profile, limit, token), credentials, () => {
      const end = stamp();
      // Injected monotonic observations are milliseconds. Timer callbacks may lag.
      if (end.mono - start.mono > alpacaIexRequestTimeoutMs) throw new ObservedSnapshotError('uncertain');
      return end;
    });
    let decoded: ReturnType<typeof parsePage>;
    try { decoded = parsePage(bytes, 'SPY', limit); } catch { throw new ObservedSnapshotError('invalid_source'); }
    if (decoded.nextPageToken?.includes(credentials.keyId) || decoded.nextPageToken?.includes(credentials.secretKey)) throw new ObservedSnapshotError('invalid_source');
    for (const o of decoded.observations) {
      if (o.providerTimestamp !== profile.sessions[252 - observations.length].providerTimestamp) throw new ObservedSnapshotError('invalid_source');
      observations.push(o);
    }
    pages.push({ page, byteLength: bytes.length, sha256: sha256(bytes), bodyBase64: bytes.toString('base64') });
    pageRequests.push({ page, limit, pageTokenSha256: token === null ? null : sha256(Buffer.from(token)) });
    timing.push({ start, bodyComplete }); token = decoded.nextPageToken;
    if ((token !== null && seen.has(token)) || (observations.length === 253 && token !== null)
      || (observations.length < 253 && token === null)) throw new ObservedSnapshotError('invalid_source');
  }
  const result = observedAcquisitionSchema.parse({ schema: 'gelt.alpaca-iex-observed-acquisition.v2', profile,
    request: { symbol: profile.symbol, feed: profile.feed, adjustment: profile.adjustment, asof: profile.asof,
      start: profile.start, end: profile.end, timeframe: profile.timeframe, currency: profile.currency, sort: profile.sort, pageRequests },
    pages, observations, timing: { collectionStart, pages: timing, collectionEnd: stamp() },
    completion: 'unknown', vintage: 'unknown', collectionAtomicity: 'not_established', asofMeaning: 'symbol_identity_only', clockTrust: 'not_established' });
  if (!verifyObservedAcquisitionData(result)) throw new ObservedSnapshotError('invalid_source');
  observedFreeze(result); observedIssued.set(result, { profile: profile.profileSha256, reserved: false });
  return result;
}
