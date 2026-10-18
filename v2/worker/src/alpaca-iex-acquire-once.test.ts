import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runAlpacaIexAcquireOnce, fixedRequest, proposedSessions, requestSha256 } from '../../scripts/alpaca-iex-acquire-once.mjs';
import { alpacaSessionCalendarDigest, alpacaSessionCalendarSchema } from './alpaca-iex-contract.js';
import { acquireAlpacaIexDailyBars, verifyAlpacaIexAcquisition } from './alpaca-iex-connector.js';
import { parseResearchJSON } from './research-json.js';

const pair = { keyId: 'SYNTHETIC_KEY_ID_123456', secretKey: 'SYNTHETIC_SECRET_12345678901234567890' };
const digest = 'a'.repeat(64);
class Output extends EventEmitter {
  text = '';
  write(value: string, callback: (error?: Error) => void) { this.text += value; callback(); return true; }
}
function fixture() {
  const sessions = proposedSessions.map((s: any, i: number) => ({ ...s, sessionOrdinal: i, completed: true, completionEvidenceSha256: digest }));
  const calendar = { symbol: 'SPY', sessions, sha256: alpacaSessionCalendarDigest({ symbol: 'SPY', sessions }) };
  const record = { schema: 'gelt.alpaca-iex-acquire-once-approval.v1', repositoryId: 1415613140, commandSha256: digest, requestSha256, calendar, calendarEvidenceSha256: digest, rightsEvidenceSha256: digest, retentionEvidenceSha256: digest, actionEvidenceSha256: digest, retention: 'process_memory_only', dataDirectory: '/synthetic/private/data' };
  const output = new Output(), errorOutput = new Output();
  const readCredentials = vi.fn(() => pair), calls: { url: URL; init?: RequestInit }[] = [];
  const ordered = [...sessions].reverse();
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    const token = url.searchParams.get('page_token');
    const offset = token === 'PRIVATE_CURSOR_2' ? 200 : token === 'PRIVATE_CURSOR_1' ? 100 : 0;
    const count = Number(url.searchParams.get('limit'));
    const bars = ordered.slice(offset, offset + count).map(s => ({ t: s.providerTimestamp, o: 123.45, h: 123.45, l: 123.45, c: 123.45, v: 12, n: 1, vw: 123.45 }));
    return new Response(JSON.stringify({ bars: { SPY: bars }, next_page_token: offset + count === 253 ? null : `PRIVATE_CURSOR_${calls.length}` }), { headers: { 'content-type': 'application/json' } });
  });
  const acquire = vi.fn((request: any, credentials: any) => acquireAlpacaIexDailyBars(request, credentials, { fetcher }));
  const modules = { parseResearchJSON, alpacaSessionCalendarSchema, readAlpacaKeyPair: readCredentials, acquireAlpacaIexDailyBars: acquire, verifyAlpacaIexAcquisition };
  const options = { argv: ['--acquire-once', '--data-dir', record.dataDirectory, '--approval-record', '/synthetic/private/approval.json'], env: {}, platform: 'linux', nodeVersion: '22.23.3', execArgv: [], output, errorOutput, uid: 1000, now: () => Date.parse('2026-10-18T00:00:00.000Z'), readRecord: vi.fn(() => JSON.stringify(record)), checkDataDirectory: vi.fn(), commandSha256: digest, loadModules: vi.fn(async () => modules) };
  return { options, record, modules, output, errorOutput, readCredentials, calls, acquire, fetcher };
}
function assertRedacted(f: ReturnType<typeof fixture>) {
  const text = f.output.text + f.errorOutput.text;
  for (const value of [pair.keyId, pair.secretKey, 'PRIVATE_CURSOR', '123.45', 'APCA-API', 'RAW_SECRET_DIAGNOSTIC']) expect(text).not.toContain(value);
}

describe('one explicit SPY/IEX acquisition command, synthetic transport only', () => {
  it('freezes 253 dated sessions, DST and early closes without claiming calendar acceptance', async () => {
    expect(proposedSessions).toHaveLength(253);
    expect(proposedSessions[0].providerTimestamp).toBe(fixedRequest.start);
    expect(proposedSessions.at(-1).providerTimestamp).toBe(fixedRequest.end);
    expect(proposedSessions.find((s: any) => s.providerTimestamp.startsWith('2025-11-28')).closedAt).toBe('2025-11-28T18:00:00.000Z');
    expect(proposedSessions.find((s: any) => s.providerTimestamp.startsWith('2025-12-24')).closedAt).toBe('2025-12-24T18:00:00.000Z');
    expect(proposedSessions.some((s: any) => s.providerTimestamp.startsWith('2026-07-03'))).toBe(false);
    const f = fixture(); f.options.argv = ['--describe'];
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(0);
    expect(JSON.parse(f.output.text)).toMatchObject({ calendarAccepted: false, status: 'proposal_only_no_credentials_or_requests' });
    expect(f.options.loadModules).not.toHaveBeenCalled(); expect(f.readCredentials).not.toHaveBeenCalled();
  });
  it('uses exactly the existing three-page GET budget and only sanitized summary output', async () => {
    const f = fixture(); expect(await runAlpacaIexAcquireOnce(f.options)).toBe(0);
    expect(f.readCredentials).toHaveBeenCalledTimes(1); expect(f.acquire).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(3);
    expect(f.calls.map(c => c.url.searchParams.get('limit'))).toEqual(['100', '100', '53']);
    for (const c of f.calls) {
      expect(c.url.origin).toBe('https://data.alpaca.markets'); expect(c.url.pathname).toBe('/v2/stocks/bars');
      expect(c.init).toMatchObject({ method: 'GET', redirect: 'error', headers: { 'APCA-API-KEY-ID': pair.keyId, 'APCA-API-SECRET-KEY': pair.secretKey } });
      expect(Object.fromEntries(c.url.searchParams)).toMatchObject({ symbols: 'SPY', feed: 'iex', adjustment: 'raw', timeframe: '1Day', currency: 'USD', start: fixedRequest.start, end: fixedRequest.end, asof: '2026-10-16' });
    }
    const result = JSON.parse(f.output.text.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ status: 'captured_unverified_memory_only', observations: 253, pages: 3, effectAuthority: 'none', promotionAllowed: false });
    expect(Object.keys(result).sort()).toEqual(['status', 'symbol', 'feed', 'timeframe', 'adjustment', 'requestSha256', 'calendarSha256', 'observations', 'pages', 'receivedAt', 'effectAuthority', 'promotionAllowed'].sort());
    assertRedacted(f);
  });
  it.each(['rightsEvidenceSha256', 'retentionEvidenceSha256', 'actionEvidenceSha256', 'calendarEvidenceSha256', 'commandSha256', 'requestSha256', 'calendar', 'retention', 'dataDirectory'])('missing %s stops before secret read or GET', async key => {
    const f = fixture(); delete (f.record as any)[key];
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled(); assertRedacted(f);
  });
  it.each(['command', 'request', 'symbol', 'count', 'date', 'completion', 'ordinal', 'extra', 'repository', 'retention', 'path', 'digest', 'duplicate-json'])('rejects %s tampering before secret read', async kind => {
    const f = fixture();
    if (kind === 'command') f.record.commandSha256 = 'b'.repeat(64);
    if (kind === 'request') f.record.requestSha256 = 'b'.repeat(64);
    if (kind === 'symbol') f.record.calendar.symbol = 'AAPL';
    if (kind === 'count') f.record.calendar.sessions.pop();
    if (kind === 'date') f.record.calendar.sessions[0].providerTimestamp = '2025-10-14T04:00:00.000Z';
    if (kind === 'completion') f.record.calendar.sessions[0].completed = false;
    if (kind === 'ordinal') f.record.calendar.sessions[0].sessionOrdinal = 77;
    if (kind === 'extra') (f.record as any).enabled = true;
    if (kind === 'repository') f.record.repositoryId = 1311525917;
    if (kind === 'retention') f.record.retention = 'persist';
    if (kind === 'path') f.record.dataDirectory = '/synthetic/other';
    if (kind === 'digest') f.record.rightsEvidenceSha256 = 'placeholder';
    if (['count', 'date', 'completion', 'ordinal'].includes(kind)) f.record.calendar.sha256 = alpacaSessionCalendarDigest(f.record.calendar);
    if (kind === 'duplicate-json') f.options.readRecord.mockImplementation(() => JSON.stringify(f.record).replace('"repositoryId":1415613140', '"repositoryId":1415613140,"repositoryId":1415613140'));
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it.each(['platform', 'node', 'flags', 'env', 'future', 'metadata', 'record-read', 'loader'])('fails %s preflight without secret read', async kind => {
    const f = fixture();
    if (kind === 'platform') f.options.platform = 'win32';
    if (kind === 'node') f.options.nodeVersion = '24.0.0';
    if (kind === 'flags') (f.options.execArgv as string[]).push('--inspect');
    if (kind === 'env') (f.options.env as any).NODE_OPTIONS = '';
    if (kind === 'future') f.options.now = () => Date.parse('2026-10-16T21:00:00.000Z');
    if (kind === 'metadata') f.options.checkDataDirectory.mockImplementation(() => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    if (kind === 'record-read') f.options.readRecord.mockImplementation(() => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    if (kind === 'loader') f.options.loadModules.mockImplementation(async () => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0); assertRedacted(f);
  });
  it.each(['NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF', 'NODE_USE_ENV_PROXY', 'NODE_USE_SYSTEM_CA', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_OPTIONS', 'NODE_DEBUG', 'NODE_V8_COVERAGE', 'APCA_API_SECRET_KEY', 'FUTURE_UNREVIEWED_SETTING'])('rejects inherited %s before module or credential access', async key => {
    const f = fixture(); (f.options.env as any)[key] = key === 'NODE_TLS_REJECT_UNAUTHORIZED' ? '0' : '';
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1);
    expect(f.options.loadModules).not.toHaveBeenCalled(); expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled(); assertRedacted(f);
  });
  it('supports an explicit clean environment without changing fixed network policy', async () => {
    const f = fixture(); f.options.env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(0); expect(f.calls).toHaveLength(3); assertRedacted(f);
  });
  it.each([[], ['--acquire-once'], ['--data-dir', 'relative'], ['--acquire-once', '--data-dir', '/a', '--approval-record', '/a/../record'], ['--acquire-once', '--data-dir', '/a', '--approval-record', '/b', '--symbol', 'AAPL']])('invalid argv is inert: %j', async argv => {
    const f = fixture(); f.options.argv = argv;
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.options.loadModules).not.toHaveBeenCalled(); expect(f.readCredentials).not.toHaveBeenCalled();
  });
  it.each(['denial', 'exception', 'redirect', 'extra-pages', 'wrong-date'])('stops %s with no retry or raw diagnostics', async kind => {
    const f = fixture();
    (f.fetcher as any).mockImplementation(async () => {
      if (kind === 'exception') throw Error(`RAW_SECRET_DIAGNOSTIC ${pair.secretKey}`);
      if (kind === 'denial') return new Response(pair.secretKey, { status: 403 });
      if (kind === 'redirect') return new Response(pair.secretKey, { status: 302 });
      const count = kind === 'extra-pages' ? 1 : 100;
      const bars = Array.from({ length: count }, (_, i) => ({ t: new Date(Date.parse('2026-10-16T04:00:00.000Z') - i * 86400000).toISOString(), o: 1, h: 1, l: 1, c: 1, v: 1, n: 1, vw: 1 }));
      return new Response(JSON.stringify({ bars: { SPY: bars }, next_page_token: kind === 'extra-pages' ? 'same-cursor' : null }), { headers: { 'content-type': 'application/json' } });
    });
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.acquire).toHaveBeenCalledTimes(1); expect((f.fetcher as any).mock.calls.length).toBeLessThanOrEqual(3); assertRedacted(f);
  });
  it('cannot begin reading credentials after a queued output error', async () => {
    const f = fixture();
    f.output.write = (_value, callback) => { callback(); setImmediate(() => f.output.emit('error', new Error('RAW_SECRET_DIAGNOSTIC'))); return true; };
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0); assertRedacted(f);
  });
  it('does not read credentials if the approval record is absent at the real reader', async () => {
    const f = fixture(); delete (f.options as any).readRecord;
    expect(await runAlpacaIexAcquireOnce(f.options)).toBe(1); expect(f.readCredentials).not.toHaveBeenCalled();
  });
});
