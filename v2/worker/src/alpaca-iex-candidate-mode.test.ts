import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runAlpacaIexCandidateOnce, fixedRequest, proposedSessions, requestSha256, verifyCandidateBuild, requiredCandidateBuildDigests } from '../../scripts/alpaca-iex-candidate-once.mjs';
import { alpacaSessionCalendarDigest, alpacaSessionCalendarSchema } from './alpaca-iex-contract.js';
import { acquireAlpacaIexDailyBars, verifyAlpacaIexAcquisition } from './alpaca-iex-connector.js';
import { prepareAlpacaCandidateModePlan, completeAlpacaCandidateMode, alpacaCandidateModeRequest } from './alpaca-iex-candidate-mode.js';
import { readFileSync } from 'node:fs';
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
  const candidateContext = {
    runId: '00000000-0000-4000-8000-000000000001', sourceCommit: '9'.repeat(40),
    expectedCalendarSha256: calendar.sha256, expectedWindow: { firstSessionOrdinal: 0, lastSessionOrdinal: 252, observationCount: 253 },
    rightsEvidenceSha256: digest, policy: { scheduleSha256: digest, maxAgeMs: 0, exposureCap: { value: '0.95', precision: 3, scale: 2 } },
    costs: { status: 'unverified', evidenceSha256: digest, stressScenarioSha256: digest, commissionPerTrade: { value: '1', precision: 1, scale: 0 }, spreadFraction: { value: '0.001', precision: 4, scale: 3 }, slippageFraction: { value: '0.001', precision: 4, scale: 3 } },
    controls: { passiveSha256: digest, cashAssumptionSha256: digest }, portfolio: { state: 'unknown', snapshotSha256: digest },
  };
  const record = { schema: 'gelt.alpaca-iex-candidate-once-approval.v1', candidateContext, availabilityBasis: 'final_connector_receipt', availabilityEvidenceSha256: digest, repositoryId: 1415613140, commandSha256: digest, requestSha256, calendar, calendarEvidenceSha256: digest, rightsEvidenceSha256: digest, retentionEvidenceSha256: digest, actionEvidenceSha256: digest, retention: 'process_memory_only', dataDirectory: '/synthetic/private/data' };
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
  const complete = vi.fn(completeAlpacaCandidateMode);
  const modules = { prepareAlpacaCandidateModePlan, completeAlpacaCandidateMode: complete, parseResearchJSON, alpacaSessionCalendarSchema, readAlpacaKeyPair: readCredentials, acquireAlpacaIexDailyBars: acquire, verifyAlpacaIexAcquisition };
  const options = { argv: ['--candidate-once', '--data-dir', record.dataDirectory, '--approval-record', '/synthetic/private/approval.json'], env: {}, platform: 'linux', nodeVersion: '22.23.3', execArgv: [], output, errorOutput, uid: 1000, now: () => Date.now() + 1000, readRecord: vi.fn(() => JSON.stringify(record)), checkDataDirectory: vi.fn(), commandSha256: digest, verifyBuild: vi.fn(), loadModules: vi.fn(async () => modules) };
  return { options, record, modules, output, errorOutput, readCredentials, calls, acquire, fetcher, complete };
}
function assertRedacted(f: ReturnType<typeof fixture>) {
  const text = f.output.text + f.errorOutput.text;
  for (const value of [pair.keyId, pair.secretKey, 'PRIVATE_CURSOR', '123.45', 'APCA-API', 'RAW_SECRET_DIAGNOSTIC']) expect(text).not.toContain(value);
}

function planBytes(f: ReturnType<typeof fixture>) {
  return Buffer.from(JSON.stringify({ schema: 'gelt.alpaca-iex-candidate-plan.v1',
    calendar: f.record.calendar, context: f.record.candidateContext,
    availabilityBasis: f.record.availabilityBasis, availabilityEvidenceSha256: f.record.availabilityEvidenceSha256 }));
}

describe('separate original-process candidate mode, synthetic transport only', () => {
  it('binds the handoff helper to the complete unchanged request identity', () => {
    expect(alpacaCandidateModeRequest).toEqual(fixedRequest);
    expect(Object.isFrozen(alpacaCandidateModeRequest)).toBe(true);
  });
  it('routes the original connector object through the real bridge and emits metadata only', async () => {
    const f = fixture();
    expect(await runAlpacaIexCandidateOnce(f.options)).toBe(0);
    expect(f.readCredentials).toHaveBeenCalledTimes(1); expect(f.acquire).toHaveBeenCalledTimes(1);
    expect(f.complete).toHaveBeenCalledTimes(1);
    const acquisition = await f.acquire.mock.results[0].value;
    expect(f.complete.mock.calls[0][0]).toBe(acquisition);
    const plan = f.complete.mock.calls[0][1];
    expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.context.policy)).toBe(true);
    expect(f.calls.map(c => c.url.searchParams.get('limit'))).toEqual(['100', '100', '53']);
    for (const c of f.calls) {
      expect(c.url.origin + c.url.pathname).toBe('https://data.alpaca.markets/v2/stocks/bars');
      expect(Object.fromEntries(c.url.searchParams)).toMatchObject({ symbols: 'SPY', feed: 'iex', adjustment: 'raw',
        timeframe: '1Day', currency: 'USD', start: fixedRequest.start, end: fixedRequest.end, asof: fixedRequest.asof });
      expect(c.init).toMatchObject({ method: 'GET', redirect: 'error' });
    }
    const result = JSON.parse(f.output.text.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ schema: 'gelt.alpaca-iex-candidate-summary.v1', status: 'candidate_unverified_memory_only',
      adjustment: 'raw', observations: 253, pages: 3, requestSha256, calendarSha256: f.record.calendar.sha256,
      decision: 'abstain', reason: 'unverified_data', freshness: 'not_established', signalCompatibility: 'raw_not_adjusted',
      g06Compatibility: 'constructed_only_consumer', classification: 'market_shadow_input', eligibility: 'unverified',
      effectAuthority: 'none', promotionAllowed: false });
    expect(Date.parse(result.decisionAt)).toBeGreaterThanOrEqual(Date.parse(acquisition.receivedAt));
    expect(Object.keys(result).sort()).toEqual(['schema','status','symbol','feed','timeframe','adjustment','requestSha256',
      'calendarSha256','observations','pages','receivedAt','decisionAt','decision','reason','freshness',
      'signalCompatibility','g06Compatibility','classification','eligibility','effectAuthority','promotionAllowed'].sort());
    for (const page of acquisition.pages) expect(f.output.text).not.toContain(page.sha256);
    assertRedacted(f);
  });
  it('keeps the frozen old command unchanged and gives describe no activation authority', async () => {
    const entry = readFileSync(new URL('../../scripts/alpaca-iex-candidate-once.mjs', import.meta.url), 'utf8');
    expect(entry).not.toMatch(/from ['"]\.\/alpaca-iex-acquire-once/);
    expect(createHash('sha256').update(readFileSync(new URL('../../scripts/alpaca-iex-acquire-once.mjs', import.meta.url))).digest('hex'))
      .toBe('e6077219f639118593e6e7950ad98357385db45c55ecb33e3743fd6a7f152cb9');
    expect(requiredCandidateBuildDigests['scripts/alpaca-iex-acquire-once.mjs'])
      .toBe('e6077219f639118593e6e7950ad98357385db45c55ecb33e3743fd6a7f152cb9');
    expect(Object.keys(requiredCandidateBuildDigests).length).toBeGreaterThan(19);
    const f = fixture(); f.options.argv = ['--describe'];
    expect(await runAlpacaIexCandidateOnce(f.options)).toBe(0);
    expect(JSON.parse(f.output.text)).toMatchObject({ request: fixedRequest, status: 'proposal_only_no_credentials_or_requests' });
    expect(f.options.loadModules).not.toHaveBeenCalled(); expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
  });
  it.each(['old-schema','missing-context','missing-availability','missing-costs','wrong-rights','wrong-window','wrong-calendar',
    'extra-authority','declared-eligibility','missing-portfolio','unknown-basis','wrong-request','wrong-completion','duplicate-json'])
    ('rejects %s before credential or connector calls', async kind => {
      const f = fixture(), record = f.record as any;
      if (kind === 'old-schema') record.schema = 'gelt.alpaca-iex-acquire-once-approval.v1';
      if (kind === 'missing-context') delete record.candidateContext;
      if (kind === 'missing-availability') delete record.availabilityEvidenceSha256;
      if (kind === 'missing-costs') delete record.candidateContext.costs;
      if (kind === 'wrong-rights') record.candidateContext.rightsEvidenceSha256 = 'b'.repeat(64);
      if (kind === 'wrong-window') record.candidateContext.expectedWindow.observationCount = 252;
      if (kind === 'wrong-calendar') record.candidateContext.expectedCalendarSha256 = 'b'.repeat(64);
      if (kind === 'extra-authority') record.callback = 'RAW_SECRET_DIAGNOSTIC';
      if (kind === 'declared-eligibility') record.candidateContext.eligibility = 'declared';
      if (kind === 'missing-portfolio') delete record.candidateContext.portfolio;
      if (kind === 'unknown-basis') record.availabilityBasis = 'historical_close';
      if (kind === 'wrong-request') record.requestSha256 = 'b'.repeat(64);
      if (kind === 'wrong-completion') record.calendar.sessions[0].completedAt = '2025-10-15T00:00:00.000Z';
      if (kind === 'duplicate-json') f.options.readRecord.mockImplementation(() => JSON.stringify(record).replace('"repositoryId":1415613140', '"repositoryId":1415613140,"repositoryId":1415613140'));
      expect(await runAlpacaIexCandidateOnce(f.options)).toBe(1);
      expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled(); assertRedacted(f);
    });
  it.each(['NODE_OPTIONS','HTTPS_PROXY','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','FUTURE_SETTING'])
    ('blocks inherited %s before worker imports', async key => {
      const f = fixture(); (f.options.env as any)[key] = '';
      expect(await runAlpacaIexCandidateOnce(f.options)).toBe(1);
      expect(f.options.loadModules).not.toHaveBeenCalled(); expect(f.readCredentials).not.toHaveBeenCalled(); assertRedacted(f);
    });
  it.each(['build','paths','output','platform','flags','argv','clock'])('fails %s safely without acquisition', async kind => {
    const f = fixture();
    if (kind === 'build') f.options.verifyBuild.mockImplementation(() => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    if (kind === 'paths') f.options.checkDataDirectory.mockImplementation(() => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    if (kind === 'output') f.output.write = (_value, callback) => { callback(); setImmediate(() => f.output.emit('error', Error('RAW_SECRET_DIAGNOSTIC'))); return true; };
    if (kind === 'platform') f.options.platform = 'win32';
    if (kind === 'flags') (f.options.execArgv as string[]).push('--inspect');
    if (kind === 'argv') f.options.argv[0] = '--acquire-once';
    if (kind === 'clock') f.options.now = () => 0;
    expect(await runAlpacaIexCandidateOnce(f.options)).toBe(1);
    expect(f.readCredentials).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled(); assertRedacted(f);
  });
  it('freezes plan bytes before an asynchronous producer boundary', async () => {
    const f = fixture();
    const write = f.output.write.bind(f.output);
    f.output.write = (value, callback) => {
      f.record.candidateContext.policy.maxAgeMs = 12345;
      f.record.candidateContext.expectedWindow.observationCount = 1;
      return write(value, callback);
    };
    expect(await runAlpacaIexCandidateOnce(f.options)).toBe(0);
    expect(f.complete.mock.calls[0][1].context.policy.maxAgeMs).toBe(0);
    expect(f.complete.mock.calls[0][1].context.expectedWindow.observationCount).toBe(253);
  });
  it.each(['clone','summary','all','asof','start','end','past-decision','new-plan','reuse'])('rejects %s without a candidate payload', async kind => {
    const f = fixture();
    const request = { enabled: true, symbol: 'SPY', feed: 'iex', adjustment: kind === 'all' ? 'all' : 'raw',
      start: kind === 'start' ? '2025-10-14T04:00:00.000Z' : fixedRequest.start,
      end: kind === 'end' ? '2026-10-17T04:00:00.000Z' : fixedRequest.end,
      asof: kind === 'asof' ? '2026-10-15' : fixedRequest.asof, calendar: f.record.calendar };
    if (kind === 'start' || kind === 'end') {
      const index = kind === 'start' ? 0 : 252;
      const session = f.record.calendar.sessions[index];
      session.providerTimestamp = kind === 'start' ? request.start : request.end;
      const shift = kind === 'start' ? -86400000 : 86400000;
      session.closedAt = new Date(Date.parse(session.closedAt) + shift).toISOString();
      session.completedAt = new Date(Date.parse(session.completedAt) + shift).toISOString();
      f.record.calendar.sha256 = alpacaSessionCalendarDigest(f.record.calendar);
      f.record.candidateContext.expectedCalendarSha256 = f.record.calendar.sha256;
    }
    const acquisition = await f.acquire(request, pair);
    const plan = prepareAlpacaCandidateModePlan(planBytes(f));
    const at = new Date(Date.parse(acquisition.receivedAt) + 1000).toISOString();
    if (kind === 'reuse') expect(completeAlpacaCandidateMode(acquisition, plan, at).decision).toBe('abstain');
    const input = kind === 'clone' ? JSON.parse(JSON.stringify(acquisition)) : kind === 'summary' ? { status: 'captured_unverified_memory_only', observations: 253 } : acquisition;
    expect(() => completeAlpacaCandidateMode(input, kind === 'new-plan' ? JSON.parse(JSON.stringify(plan)) : plan,
      kind === 'past-decision' ? '2026-10-18T00:00:00.000Z' : at)).toThrow('Candidate handoff unavailable');
    if (kind === 'asof') {
      const correctFixture = fixture();
      const correct = await correctFixture.acquire({ ...request, asof: fixedRequest.asof }, pair);
      expect(completeAlpacaCandidateMode(correct, plan, new Date(Date.parse(correct.receivedAt) + 1000).toISOString()).status)
        .toBe('candidate_unverified_memory_only');
    }
  });
  it.each(['provider','bridge','clock-after'])('stops %s after one synthetic capture with no retry or data output', async kind => {
    const f = fixture();
    if (kind === 'provider') f.acquire.mockImplementation(async () => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    if (kind === 'bridge') f.complete.mockImplementation(() => { throw Error('RAW_SECRET_DIAGNOSTIC'); });
    if (kind === 'clock-after') f.options.now = vi.fn().mockReturnValueOnce(Date.now() + 1000).mockReturnValue(0);
    expect(await runAlpacaIexCandidateOnce(f.options)).toBe(1);
    expect(f.acquire).toHaveBeenCalledTimes(1); expect(f.readCredentials).toHaveBeenCalledTimes(1);
    expect(f.calls.length).toBeLessThanOrEqual(3); expect(f.output.text).not.toContain('candidate_unverified_memory_only'); assertRedacted(f);
  });
  it.each(['valid', 'altered', 'missing', 'symlink-file', 'symlink-directory', 'shadow-package', 'shadow-dependency', 'oversize'])('byte binding rejects %s fixture defects before any import', kind => {
    const bytes = Buffer.from('SYNTHETIC_COMPILED_MODULE');
    // The filesystem and expected bytes are injected only into this import-only
    // pure integrity test. Production always uses the fixed 27-entry table.
    const expected = { 'worker/dist/test.js': createHash('sha256').update(bytes).digest('hex') };
    const io = {
      lstatSync(path: string) {
        if (!path.endsWith('/worker') && !path.endsWith('/worker/dist') && !path.endsWith('/test.js')) {
          if ((kind === 'shadow-package' && path.endsWith('/worker/dist/package.json')) || (kind === 'shadow-dependency' && path.endsWith('/worker/node_modules'))) return { isFile: () => true };
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        if (kind === 'missing' && path.endsWith('/test.js')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { isDirectory: () => !path.endsWith('/test.js'), isFile: () => path.endsWith('/test.js'), isSymbolicLink: () => kind === 'symlink-file' && path.endsWith('/test.js') || kind === 'symlink-directory' && path.endsWith('/worker'), size: kind === 'oversize' ? 1048577 : bytes.length };
      },
      readFileSync() { return kind === 'altered' ? Buffer.from('ALTERED') : bytes; },
    };
    if (kind === 'valid') expect(() => verifyCandidateBuild('/synthetic', { io, expected })).not.toThrow();
    else expect(() => verifyCandidateBuild('/synthetic', { io, expected })).toThrow();
  });
  it('rejects nonbytes, oversized bytes and duplicate plan keys before handoff', () => {
    const f = fixture();
    expect(() => prepareAlpacaCandidateModePlan({} as Buffer)).toThrow('Candidate plan unavailable');
    expect(() => prepareAlpacaCandidateModePlan(Buffer.alloc(256 * 1024 + 1))).toThrow('Candidate plan unavailable');
    expect(() => prepareAlpacaCandidateModePlan(Buffer.from(planBytes(f).toString().replace('"schema":', '"schema":"duplicate","schema":')))).toThrow('Candidate plan unavailable');
  });
});

