import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acquireAlpacaIexDailyBars, verifyAlpacaIexAcquisition } from './alpaca-iex-connector.js';
import { normalizeAlpacaIexBars } from './alpaca-iex-normalization.js';
import { alpacaIexMaxPageBytes, alpacaIexRequestTimeoutMs, alpacaSessionCalendarDigest, type AlpacaIexRequest } from './alpaca-iex-contract.js';

const keyPair = { keyId: 'SYNTHETIC_KEY_ID_123456', secretKey: 'SYNTHETIC_SECRET_12345678901234567890' };
const hash = (n: string) => n.repeat(64);
const after = (timestamp: string, milliseconds: number) => new Date(Date.parse(timestamp) + milliseconds).toISOString();

function fixture(count = 2): AlpacaIexRequest {
  const sessions = Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return {
      providerTimestamp: `${day}T14:30:00.000Z`, sessionOrdinal: 700 + i,
      closedAt: `${day}T21:00:00.000Z`, completedAt: `${day}T21:01:00.000Z`,
      completed: true as const, completionEvidenceSha256: hash('a'),
    };
  });
  return {
    enabled: true, symbol: 'AAPL', feed: 'iex', adjustment: 'raw',
    start: sessions[0].providerTimestamp, end: sessions[sessions.length - 1].providerTimestamp,
    asof: '2026-10-14', calendar: { symbol: 'AAPL', sha256: alpacaSessionCalendarDigest({ symbol: 'AAPL', sessions }), sessions },
  };
}

function bar(timestamp: string, close: string) {
  // Numeric values are inserted as raw JSON lexemes; no fixture-side Number conversion.
  return `{"t":${JSON.stringify(timestamp)},"o":${close},"h":${close},"l":${close},"c":${close},"v":12.5,"n":7,"vw":${close}}`;
}
function body(symbol: string, bars: string[], nextPageToken: string | null) {
  return Buffer.from(`{"bars":{"${symbol}":[${bars.join(',')}]},"next_page_token":${JSON.stringify(nextPageToken)}}`);
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function response(bytes: Buffer, status = 200): Response {
  return new Response(bytes, { status, headers: { 'content-type': 'application/json' } });
}
function availability(request: AlpacaIexRequest, receivedAt: string) {
  return request.calendar.sessions.map(s => ({ providerTimestamp: s.providerTimestamp, availableAt: receivedAt, evidenceSha256: hash('c') }));
}
function normalize(request: AlpacaIexRequest, acquisition: Awaited<ReturnType<typeof acquireAlpacaIexDailyBars>>, facts = availability(request, acquisition.receivedAt)) {
  return normalizeAlpacaIexBars(acquisition, {
    source: 'alpaca-data-v2', feed: 'iex', symbol: request.symbol, adjustment: request.adjustment,
    asof: request.asof, calendar: request.calendar, availability: facts,
    receivedAt: acquisition.receivedAt, decisionAt: after(acquisition.receivedAt, 60_000),
  });
}

describe('standalone Alpaca IEX daily data boundary (synthetic transport only)', () => {
  it('uses one fixed-origin IEX daily GET and preserves exact close tokens in raw evidence and G05 bars', async () => {
    const request = fixture(2), urls: URL[] = [], initValues: RequestInit[] = [];
    const newestClose = '9007199254740992.01';
    const rows = [...request.calendar.sessions].reverse().map((s, i) => bar(s.providerTimestamp, i ? '100.00' : newestClose));
    const acquisition = await acquireAlpacaIexDailyBars(request, keyPair, {
      fetcher: async (input, init) => { urls.push(new URL(String(input))); initValues.push(init ?? {}); return response(body('AAPL', rows, null)); },
    });
    expect(urls).toHaveLength(1);
    expect(urls[0].origin).toBe('https://data.alpaca.markets');
    expect(urls[0].pathname).toBe('/v2/stocks/bars');
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({
      symbols: 'AAPL', timeframe: '1Day', feed: 'iex', currency: 'USD', adjustment: 'raw',
      sort: 'desc', limit: '2', start: request.start, end: request.end, asof: request.asof!,
    });
    expect(initValues[0]).toMatchObject({ method: 'GET', redirect: 'error', headers: {
      'APCA-API-KEY-ID': keyPair.keyId, 'APCA-API-SECRET-KEY': keyPair.secretKey,
    } });
    expect(acquisition.pages[0].bodyBase64).toBe(body('AAPL', rows, null).toString('base64'));
    expect(verifyAlpacaIexAcquisition(acquisition)).toBe(true);
    const normalized = normalize(request, acquisition);
    expect(normalized.bars.map(b => b.sessionOrdinal)).toEqual([700, 701]);
    expect(normalized.bars[1].adjustedClose).toEqual({ value: newestClose, precision: 18, scale: 2 });
    expect(normalized).toMatchObject({ classification: 'market_shadow_input', eligibility: 'unverified', effectAuthority: 'none', promotionAllowed: false });
  });

  it('paginates within exact observation, page, token, and body caps', async () => {
    const request = fixture(101), ordered = [...request.calendar.sessions].reverse();
    const urls: URL[] = [];
    const opaqueToken = 'next+/=';
    const acquisition = await acquireAlpacaIexDailyBars(request, keyPair, {
      fetcher: async input => {
        const url = new URL(String(input)); urls.push(url);
        const offset = url.searchParams.get('page_token') === opaqueToken ? 100 : 0;
        const limit = Number(url.searchParams.get('limit'));
        return response(body('AAPL', ordered.slice(offset, offset + limit).map(s => bar(s.providerTimestamp, '100.25')), offset ? null : opaqueToken));
      },
    });
    expect(urls.map(u => u.searchParams.get('limit'))).toEqual(['100', '1']);
    expect(urls[1].searchParams.get('page_token')).toBe(opaqueToken);
    expect(acquisition.pages).toHaveLength(2);
    expect(acquisition.observations).toHaveLength(101);
    expect(verifyAlpacaIexAcquisition(acquisition)).toBe(true);
    expect(normalize(request, acquisition).bars).toHaveLength(101);
  });

  it.each(['redirect', 'bad-json', 'duplicate-key', 'extra-symbol', 'numeric-exponent', 'reused-token', 'dangling-token', 'provider-error'] as const)(
    'fails closed on %s without retry or secret leakage', async kind => {
      const request = fixture(kind === 'reused-token' ? 201 : 2);
      let calls = 0;
      const secretText = `response-echo-${keyPair.secretKey}`;
      const fetcher: typeof fetch = async input => {
        const url = new URL(String(input)); calls++;
        if (url.origin !== 'https://data.alpaca.markets' || url.pathname !== '/v2/stocks/bars') throw new Error(secretText);
        if (kind === 'redirect') return response(Buffer.from(secretText), 302);
        if (kind === 'provider-error') throw new Error(secretText);
        if (kind === 'bad-json') return response(Buffer.from('{'));
        if (kind === 'duplicate-key') return response(Buffer.from('{"bars":{},"bars":{},"next_page_token":null}'));
        if (kind === 'extra-symbol') return response(Buffer.from('{"bars":{"AAPL":[],"MSFT":[]},"next_page_token":null}'));
        if (kind === 'numeric-exponent') return response(body('AAPL', [bar(request.calendar.sessions[1].providerTimestamp, '1e3'), bar(request.calendar.sessions[0].providerTimestamp, '1')], null));
        const rows = [...request.calendar.sessions].reverse();
        const offset = url.searchParams.get('page_token') === 'same-token' ? 100 : 0;
        const limit = Number(url.searchParams.get('limit'));
        if (kind === 'dangling-token') return response(body('AAPL', rows.map(s => bar(s.providerTimestamp, '1')), 'dangling+/='));
        return response(body('AAPL', rows.slice(offset, offset + limit).map(s => bar(s.providerTimestamp, '1')), 'same-token'));
      };
      let thrown: unknown;
      try { await acquireAlpacaIexDailyBars(request, keyPair, { fetcher }); }
      catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe('Alpaca market data unavailable');
      expect((thrown as Error).message).not.toContain(keyPair.keyId);
      expect((thrown as Error).message).not.toContain(keyPair.secretKey);
      expect(calls).toBe(kind === 'reused-token' ? 2 : 1);
    },
  );

  it('keeps raw verification integrity-only while normalization requires the issued capture object', async () => {
    const request = fixture(2), rows = [...request.calendar.sessions].reverse().map(s => bar(s.providerTimestamp, '12.50'));
    const acquisition = await acquireAlpacaIexDailyBars(request, keyPair, {
      fetcher: async () => response(body('AAPL', rows, null)),
    });
    const copied = structuredClone(acquisition) as any;
    expect(verifyAlpacaIexAcquisition(copied)).toBe(true);
    expect(() => normalizeAlpacaIexBars(copied, {
      source: 'alpaca-data-v2', feed: 'iex', symbol: request.symbol, adjustment: request.adjustment,
      asof: request.asof, calendar: request.calendar,
      availability: availability(request, copied.receivedAt), receivedAt: copied.receivedAt,
      decisionAt: after(copied.receivedAt, 60_000),
    })).toThrow('Alpaca bars cannot be normalized');

    const backdated = structuredClone(acquisition) as any;
    backdated.receivedAt = '2026-01-03T00:00:00.000Z';
    expect(verifyAlpacaIexAcquisition(backdated)).toBe(true);
    expect(() => normalizeAlpacaIexBars(backdated, {
      source: 'alpaca-data-v2', feed: 'iex', symbol: request.symbol, adjustment: request.adjustment,
      asof: request.asof, calendar: request.calendar,
      availability: availability(request, backdated.receivedAt), receivedAt: backdated.receivedAt,
      decisionAt: after(backdated.receivedAt, 60_000),
    })).toThrow('Alpaca bars cannot be normalized');
    expect(normalize(request, acquisition).eligibility).toBe('unverified');
  });

  it('rejects a dangling terminal continuation token in the raw evidence verifier', async () => {
    const request = fixture(2), rows = [...request.calendar.sessions].reverse().map(s => bar(s.providerTimestamp, '12.50'));
    const acquisition = await acquireAlpacaIexDailyBars(request, keyPair, {
      fetcher: async () => response(body('AAPL', rows, null)),
    });
    const tampered = structuredClone(acquisition) as any;
    const bytes = body('AAPL', rows, 'dangling+/=');
    tampered.pages[0] = { ...tampered.pages[0], bodyBase64: bytes.toString('base64'), byteLength: bytes.length, sha256: sha256(bytes) };
    expect(verifyAlpacaIexAcquisition(tampered)).toBe(false);
  });

  it.each(['lateCapture', 'beforeReceipt', 'missing', 'reordered', 'wrongAdjustment', 'wrongSymbol', 'wrongFeed', 'decisionBeforeReceipt', 'calendarTampered'] as const)(
    'rejects conflicting %s normalization evidence', async fault => {
      const request = fixture(2), rows = [...request.calendar.sessions].reverse().map(s => bar(s.providerTimestamp, '10.000'));
      const acquisition = await acquireAlpacaIexDailyBars(request, keyPair, {
        fetcher: async () => response(body('AAPL', rows, null)),
      });
      const facts = availability(request, acquisition.receivedAt);
      const decisionAt = after(acquisition.receivedAt, 60_000);
      const input = {
        source: 'alpaca-data-v2' as const, feed: 'iex' as const, symbol: request.symbol,
        adjustment: request.adjustment, asof: request.asof, calendar: request.calendar,
        availability: facts, receivedAt: acquisition.receivedAt, decisionAt,
      };
      if (fault === 'lateCapture') facts[0].availableAt = after(decisionAt, 1_000);
      if (fault === 'beforeReceipt') facts[0].availableAt = after(acquisition.receivedAt, -1);
      if (fault === 'missing') facts.pop();
      if (fault === 'reordered') [facts[0], facts[1]] = [facts[1], facts[0]];
      if (fault === 'wrongAdjustment') input.adjustment = 'split';
      if (fault === 'wrongSymbol') input.symbol = 'MSFT';
      if (fault === 'wrongFeed') input.feed = 'sip' as never;
      if (fault === 'decisionBeforeReceipt') input.decisionAt = after(acquisition.receivedAt, -1);
      if (fault === 'calendarTampered') {
        input.calendar = structuredClone(request.calendar);
        input.calendar.sessions[0].closedAt = after(input.calendar.sessions[0].closedAt, 1_000);
      }
      expect(() => normalizeAlpacaIexBars(acquisition, input)).toThrow('Alpaca bars cannot be normalized');
    },
  );

  it('rejects structured acquisitions whose observations contradict their exact raw response bytes', async () => {
    const request = fixture(2), rows = [...request.calendar.sessions].reverse().map(s => bar(s.providerTimestamp, '11.00'));
    const acquisition = await acquireAlpacaIexDailyBars(request, keyPair, {
      fetcher: async () => response(body('AAPL', rows, null)),
    });
    const tampered = structuredClone(acquisition) as any;
    tampered.observations[0].close.value = '12.00';
    expect(verifyAlpacaIexAcquisition(tampered)).toBe(false);
    expect(() => normalizeAlpacaIexBars(tampered, {
      source: 'alpaca-data-v2', feed: 'iex', symbol: request.symbol, adjustment: request.adjustment,
      asof: request.asof, calendar: request.calendar, availability: availability(request, acquisition.receivedAt),
      receivedAt: acquisition.receivedAt, decisionAt: after(acquisition.receivedAt, 60_000),
    })).toThrow('Alpaca bars cannot be normalized');
  });

  it('rejects oversized declared and streamed response bodies before JSON parsing', async () => {
    const request = fixture(1), oversized = Buffer.alloc(alpacaIexMaxPageBytes + 1);
    for (const makeResponse of [
      () => new Response(Buffer.from('x'), { headers: { 'content-type': 'application/json', 'content-length': String(alpacaIexMaxPageBytes + 1) } }),
      () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(oversized.subarray(0, alpacaIexMaxPageBytes)); controller.enqueue(Uint8Array.of(1)); controller.close(); },
      }), { headers: { 'content-type': 'application/json' } }),
    ]) {
      await expect(acquireAlpacaIexDailyBars(request, keyPair, { fetcher: async () => makeResponse() }))
        .rejects.toThrow('Alpaca market data unavailable');
    }
  });

  it('aborts a stalled synthetic fetch at the fixed request timeout', async () => {
    vi.useFakeTimers();
    try {
      const request = fixture(1);
      let signal: AbortSignal | undefined;
      const result = acquireAlpacaIexDailyBars(request, keyPair, {
        fetcher: async (_input, init) => {
          signal = init?.signal as AbortSignal;
          return await new Promise<Response>(() => {});
        },
      });
      const rejected = expect(result).rejects.toThrow('Alpaca market data unavailable');
      await vi.advanceTimersByTimeAsync(alpacaIexRequestTimeoutMs);
      await rejected;
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('does not exceed the three-page acquisition cap', async () => {
    const request = fixture(253), ordered = [...request.calendar.sessions].reverse();
    let calls = 0;
    await expect(acquireAlpacaIexDailyBars(request, keyPair, {
      fetcher: async () => {
        const session = ordered[calls++];
        return response(body('AAPL', [bar(session.providerTimestamp, '1')], `page-${calls}`));
      },
    })).rejects.toThrow('Alpaca market data unavailable');
    expect(calls).toBe(3);
  });
});
