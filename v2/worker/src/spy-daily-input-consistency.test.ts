import { describe, expect, it } from 'vitest';
import { canonical } from './ledger-canonical.js';
import {
  assessSpyDailyInput,
  matchesSpyDailyInputAssessment,
} from './spy-daily-input-consistency.js';

const maxInputBytes = 262_144;
const dayMilliseconds = 24 * 60 * 60 * 1_000;
const hourMilliseconds = 60 * 60 * 1_000;
const plus = (value: string, milliseconds: number): string => new Date(Date.parse(value) + milliseconds).toISOString();
const nextDate = (value: string): string => new Date(Date.parse(`${value}T00:00:00.000Z`) + dayMilliseconds).toISOString().slice(0, 10);

// This fixed 2026 transition table is independent of the production Intl
// formatter. The fixtures are sequential civil-date assertions, including
// weekends; they are not exchange-session or holiday evidence.
function suppliedNewYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  const utcOffsetHours = daylight ? 4 : 5;
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + utcOffsetHours * hourMilliseconds).toISOString();
}

function snapshot(feed: 'iex' | 'sip' = 'iex', firstDate = '2026-01-01', issueOffset = 0) {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse(`${firstDate}T00:00:00.000Z`) + index * dayMilliseconds).toISOString().slice(0, 10);
    const next = nextDate(sessionDate);
    return {
      sessionDate,
      ordinal: 100 + index,
      dayStartsAt: suppliedNewYorkMidnight(sessionDate),
      dayEndsAt: suppliedNewYorkMidnight(next),
    };
  });
  const lastEnd = calendar[calendar.length - 1].dayEndsAt;
  const requestEnd = plus(lastEnd, -1);
  const issuedAt = plus(feed === 'sip' ? requestEnd : lastEnd, (feed === 'sip' ? 900_000 : 0) + issueOffset);
  const receivedAt = plus(issuedAt, 1_000);
  const availableAt = plus(receivedAt, 1_000);
  return {
    feed,
    symbol: 'SPY' as const,
    currency: 'USD' as const,
    timeframe: '1Day' as const,
    adjustment: 'all' as const,
    asof: '2026-01-01',
    requestStart: calendar[0].dayStartsAt,
    requestEnd,
    issuedAt,
    receivedAt,
    availableAt,
    calendar,
    bars: calendar.map(row => ({
      providerTimestamp: row.dayStartsAt,
      adjustedClose: { value: '1', precision: 1, scale: 0 },
    })),
  };
}

function request(feed: 'iex' | 'sip' = 'iex', firstDate = '2026-01-01') {
  const current = snapshot(feed, firstDate);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1' as const,
    classification: 'constructed_offline_test' as const,
    epochId: '11111111-1111-4111-8111-111111111111',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(current.availableAt, 1_000),
    current,
    predecessor: null,
    revision: 0 as const,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(canonical(value), 'utf8');
}

function copy<T>(value: T): T {
  return JSON.parse(canonical(value)) as T;
}

function revisionRequest(feed: 'iex' | 'sip' = 'iex') {
  const predecessor = snapshot(feed, '2026-01-01', 0);
  const current = snapshot(feed, '2026-01-01', 5_000);
  current.bars[126].adjustedClose = { value: '2', precision: 1, scale: 0 };
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1' as const,
    classification: 'constructed_offline_test' as const,
    epochId: '22222222-2222-4222-8222-222222222222',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(current.availableAt, 1_000),
    current,
    predecessor,
    revision: 1 as const,
  };
}

describe('prospective SPY daily input consistency', () => {
  it('assesses a complete constructed IEX window without asserting eligibility or authority', () => {
    const result = assessSpyDailyInput(bytes(request()));
    expect(result.status).toBe('consistent');
    if (result.status !== 'consistent') return;
    expect(result.reasons).toEqual([]);
    expect(result.classification).toBe('constructed_offline_test');
    expect(result.consistency).toBe('supplied_assertions_only');
    expect(result.rights).toBe('not_established');
    expect(result.calendarAuthenticity).toBe('not_established');
    expect(result.completion).toBe('unknown');
    expect(result.vintage).toBe('unknown');
    expect(result.actualAvailability).toBe('not_established');
    expect(result.marketEvaluation).toBe('not_established');
    expect(result.effectAuthority).toBe('none');
    expect(result.promotionAllowed).toBe(false);
    expect(Object.keys(result).sort()).toEqual([
      'actualAvailability', 'assessmentId', 'calendarAuthenticity', 'classification', 'completion',
      'consistency', 'effectAuthority', 'inputSha256', 'marketEvaluation', 'predecessorSha256',
      'promotionAllowed', 'reasons', 'rights', 'schema', 'snapshotSha256', 'status', 'vintage',
    ].sort());
    expect(Buffer.byteLength(canonical(result), 'utf8')).toBeLessThanOrEqual(8_192);
  });

  it('accepts the exact SIP delay boundary, leaves IEX free of that delay, and separates feed identity', () => {
    const iex = assessSpyDailyInput(bytes(request('iex')));
    const sipRequest = request('sip');
    const sip = assessSpyDailyInput(bytes(sipRequest));
    expect(iex.status).toBe('consistent');
    expect(sip.status).toBe('consistent');
    if (iex.status === 'rejected' || sip.status === 'rejected') return;
    expect(iex.inputSha256).not.toBe(sip.inputSha256);
    expect(iex.assessmentId).not.toBe(sip.assessmentId);

    const oneMillisecondEarly = copy(sipRequest);
    oneMillisecondEarly.current.issuedAt = plus(oneMillisecondEarly.current.issuedAt, -1);
    const early = assessSpyDailyInput(bytes(oneMillisecondEarly));
    expect(early.status).toBe('contradictory');
    if (early.status === 'contradictory') expect(early.reasons).toEqual(['sip_delay']);
  });

  it('uses independently pinned 2026 New York spring and fall DST boundary literals', () => {
    const spring = snapshot('iex', '2026-01-01').calendar;
    const springBefore = spring.find(row => row.sessionDate === '2026-03-08');
    const springAfter = spring.find(row => row.sessionDate === '2026-03-09');
    expect(springBefore?.dayStartsAt).toBe('2026-03-08T05:00:00.000Z');
    expect(springAfter?.dayStartsAt).toBe('2026-03-09T04:00:00.000Z');
    expect(Date.parse(springAfter!.dayStartsAt) - Date.parse(springBefore!.dayStartsAt)).toBe(23 * hourMilliseconds);

    const fall = snapshot('iex', '2026-06-01').calendar;
    const fallBefore = fall.find(row => row.sessionDate === '2026-11-01');
    const fallAfter = fall.find(row => row.sessionDate === '2026-11-02');
    expect(fallBefore?.dayStartsAt).toBe('2026-11-01T04:00:00.000Z');
    expect(fallAfter?.dayStartsAt).toBe('2026-11-02T05:00:00.000Z');
    expect(Date.parse(fallAfter!.dayStartsAt) - Date.parse(fallBefore!.dayStartsAt)).toBe(25 * hourMilliseconds);
    expect(assessSpyDailyInput(bytes(request('iex', '2026-01-01'))).status).toBe('consistent');
    expect(assessSpyDailyInput(bytes(request('iex', '2026-06-01'))).status).toBe('consistent');
  });

  it('collects independent contradiction categories in the fixed contract order', () => {
    const value = revisionRequest('sip');
    value.current.calendar[100].dayStartsAt = plus(value.current.calendar[100].dayStartsAt, 60_000);
    value.current.calendar[101].ordinal = value.current.calendar[100].ordinal;
    value.current.requestEnd = plus(value.current.calendar[252].dayEndsAt, -2);
    value.current.issuedAt = plus(value.current.requestEnd, 899_999);
    value.declaredAt = plus(value.current.issuedAt, 1);
    const result = assessSpyDailyInput(bytes(value));
    expect(result.status).toBe('contradictory');
    if (result.status === 'contradictory') expect(result.reasons).toEqual([
      'daily_mapping', 'calendar_order', 'request_window', 'sip_delay', 'declaration_timing', 'revision_binding',
    ]);
  });

  it.each([
    ['provider timestamp mismatch', (value: ReturnType<typeof request>) => { value.current.bars[80].providerTimestamp = plus(value.current.bars[80].providerTimestamp, 1); }, 'daily_mapping'],
    ['midnight with a millisecond', (value: ReturnType<typeof request>) => { value.current.calendar[80].dayStartsAt = plus(value.current.calendar[80].dayStartsAt, 1); }, 'daily_mapping'],
    ['day end with a half-second millisecond field', (value: ReturnType<typeof request>) => { value.current.calendar[80].dayEndsAt = plus(value.current.calendar[80].dayEndsAt, 500); }, 'daily_mapping'],
    ['UTC midnight substitution', (value: ReturnType<typeof request>) => { value.current.calendar[80].dayStartsAt = '2026-03-22T00:00:00.000Z'; }, 'daily_mapping'],
    ['24-hour DST boundary', (value: ReturnType<typeof request>) => { value.current.calendar[66].dayEndsAt = plus(value.current.calendar[66].dayStartsAt, dayMilliseconds); }, 'daily_mapping'],
    ['16:00 daily end', (value: ReturnType<typeof request>) => {
      const row = value.current.calendar.find(item => item.sessionDate === '2026-03-23')!;
      row.dayEndsAt = '2026-03-23T20:00:00.000Z';
    }, 'daily_mapping'],
    ['duplicate ordinal', (value: ReturnType<typeof request>) => { value.current.calendar[81].ordinal = value.current.calendar[80].ordinal; }, 'calendar_order'],
    ['off-by-one request end', (value: ReturnType<typeof request>) => { value.current.requestEnd = plus(value.current.requestEnd, -1); }, 'request_window'],
    ['issue before daily interval end', (value: ReturnType<typeof request>) => { value.current.issuedAt = plus(value.current.issuedAt, -1); }, 'request_window'],
    ['receipt before issue', (value: ReturnType<typeof request>) => { value.current.receivedAt = plus(value.current.issuedAt, -1); }, 'request_window'],
    ['availability at decision', (value: ReturnType<typeof request>) => { value.current.availableAt = value.decisionAt; }, 'request_window'],
    ['declaration after issue', (value: ReturnType<typeof request>) => { value.declaredAt = plus(value.current.issuedAt, 1); }, 'declaration_timing'],
  ] as const)('reports %s as %s', (_name, mutate, expectedReason) => {
    const value = copy(request());
    mutate(value);
    const result = assessSpyDailyInput(bytes(value));
    expect(result.status).toBe('contradictory');
    if (result.status === 'contradictory') expect(result.reasons).toContain(expectedReason);
  });

  it('binds a full immediate predecessor and requires a numeric adjusted-close change', () => {
    const value = revisionRequest();
    const before = assessSpyDailyInput(bytes(value));
    expect(before.status).toBe('consistent');
    if (before.status !== 'consistent') return;
    expect(before.predecessorSha256).not.toBeNull();

    const scaleOnly = copy(value);
    scaleOnly.current.bars[126].adjustedClose = { value: '1.0', precision: 2, scale: 1 };
    const unchanged = assessSpyDailyInput(bytes(scaleOnly));
    expect(unchanged.status).toBe('contradictory');
    if (unchanged.status === 'contradictory') expect(unchanged.reasons).toContain('revision_binding');

    const noPriceChange = copy(value);
    noPriceChange.current.bars[126].adjustedClose = { value: '1', precision: 1, scale: 0 };
    const samePrices = assessSpyDailyInput(bytes(noPriceChange));
    expect(samePrices.status).toBe('contradictory');
    if (samePrices.status === 'contradictory') expect(samePrices.reasons).toContain('revision_binding');
  });

  it.each([
    ['feed', (value: ReturnType<typeof revisionRequest>) => { value.current.feed = 'sip'; }],
    ['window', (value: ReturnType<typeof revisionRequest>) => { value.current.requestStart = plus(value.current.requestStart, 1_000); }],
    ['calendar', (value: ReturnType<typeof revisionRequest>) => { value.current.calendar[20].sessionDate = '2026-01-22'; }],
    ['asof', (value: ReturnType<typeof revisionRequest>) => { value.current.asof = '2026-01-02'; }],
    ['capture time', (value: ReturnType<typeof revisionRequest>) => { value.current.receivedAt = value.predecessor!.receivedAt; }],
    ['post-decision availability', (value: ReturnType<typeof revisionRequest>) => { value.current.availableAt = value.decisionAt; }],
  ] as const)('rejects an in-epoch %s change', (_name, mutate) => {
    const value = revisionRequest();
    mutate(value);
    const result = assessSpyDailyInput(bytes(value));
    expect(result.status).toBe('contradictory');
    if (result.status === 'contradictory') expect(result.reasons).toContain('revision_binding');
  });

  it('rejects unsupported revision shapes and legacy schemas as generic invalid input', () => {
    const wrongRevision = copy(request()) as unknown as { revision: number };
    wrongRevision.revision = 2;
    const missingPredecessor = copy(request()) as unknown as { revision: number };
    missingPredecessor.revision = 1;
    const unexpectedPredecessor = copy(request()) as unknown as { predecessor: unknown };
    unexpectedPredecessor.predecessor = snapshot();

    expect(assessSpyDailyInput(bytes(wrongRevision))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(assessSpyDailyInput(bytes(missingPredecessor))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(assessSpyDailyInput(bytes(unexpectedPredecessor))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(assessSpyDailyInput(bytes({ ...request(), schema: 'gelt.shadow-rule-input.v1' })))
      .toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });

  it('rejects malformed, duplicate-key, invalid UTF-8, unknown-key and oversized input without reflecting it', () => {
    const value = request();
    const extra = copy(value) as ReturnType<typeof request> & { privateSentinel?: string };
    extra.privateSentinel = 'PRIVATE_SENTINEL';
    const zeroPrice = copy(value);
    zeroPrice.current.bars[0].adjustedClose = { value: '0.00', precision: 3, scale: 2 };
    const malformedDecimal = copy(value);
    malformedDecimal.current.bars[0].adjustedClose = { value: '1.0', precision: 3, scale: 1 };
    const shortCalendar = copy(value);
    shortCalendar.current.calendar.pop();
    const extraCalendarRow = copy(value);
    extraCalendarRow.current.calendar.push(copy(extraCalendarRow.current.calendar[252]));
    const duplicateText = canonical(value).replace(
      '"classification":"constructed_offline_test"',
      '"classification":"constructed_offline_test","classification":"constructed_offline_test"',
    );
    expect(JSON.parse(duplicateText)).toEqual(value);
    const duplicateKeys = Buffer.from(duplicateText, 'utf8');
    const values = [
      Buffer.from([0xff]),
      Buffer.alloc(maxInputBytes + 1, 0x20),
      duplicateKeys,
      bytes(extra),
      bytes(zeroPrice),
      bytes(malformedDecimal),
      bytes(shortCalendar),
      bytes(extraCalendarRow),
      Buffer.from('{"schema":'),
    ];
    for (const input of values) {
      const result = assessSpyDailyInput(input);
      expect(result).toEqual({ schema: 'gelt.spy-daily-input-consistency.v1', status: 'rejected', reason: 'invalid_input' });
      expect(canonical(result)).not.toContain('PRIVATE_SENTINEL');
    }
    expect(assessSpyDailyInput('not a Buffer' as unknown as Buffer)).toEqual({
      schema: 'gelt.spy-daily-input-consistency.v1', status: 'rejected', reason: 'invalid_input',
    });
  });

  it('supports a contiguous ordinal window ending at MAX_SAFE_INTEGER and rejects unsafe ordinals', () => {
    const lastSafe = copy(request());
    lastSafe.current.calendar.forEach((row, index) => {
      row.ordinal = Number.MAX_SAFE_INTEGER - (lastSafe.current.calendar.length - 1 - index);
    });
    expect(assessSpyDailyInput(bytes(lastSafe)).status).toBe('consistent');

    const unsafe = copy(request());
    unsafe.current.calendar[0].ordinal = Number.MAX_SAFE_INTEGER + 1;
    expect(assessSpyDailyInput(bytes(unsafe))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    const fractional = copy(request());
    fractional.current.calendar[0].ordinal = 100.5;
    expect(assessSpyDailyInput(bytes(fractional))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });

  it('accepts exactly 262144 bytes and rejects the next byte', () => {
    const valid = bytes(request());
    const padded = Buffer.concat([valid, Buffer.alloc(maxInputBytes - valid.length, 0x20)]);
    expect(padded.length).toBe(maxInputBytes);
    expect(assessSpyDailyInput(padded).status).toBe('consistent');
    expect(assessSpyDailyInput(Buffer.concat([padded, Buffer.from(' ')]))).toEqual({
      schema: 'gelt.spy-daily-input-consistency.v1', status: 'rejected', reason: 'invalid_input',
    });
  });

  it('does not mutate caller bytes and binds assessments to the complete input and predecessor', () => {
    const value = revisionRequest();
    const input = bytes(value);
    const before = Buffer.from(input);
    const assessment = assessSpyDailyInput(input);
    expect(input.equals(before)).toBe(true);
    expect(matchesSpyDailyInputAssessment(input, assessment)).toBe(true);

    const changed = copy(value);
    changed.predecessor!.bars[0].adjustedClose = { value: '3', precision: 1, scale: 0 };
    expect(matchesSpyDailyInputAssessment(bytes(changed), assessment)).toBe(false);
    const tampered = copy(assessment) as Record<string, unknown>;
    tampered.inputSha256 = '0'.repeat(64);
    expect(matchesSpyDailyInputAssessment(input, tampered)).toBe(false);
    expect(matchesSpyDailyInputAssessment(input, { ...assessment, unrecognized: true })).toBe(false);
    expect(matchesSpyDailyInputAssessment(input, { schema: 'gelt.spy-daily-input-consistency.v1', status: 'rejected', reason: 'invalid_input' })).toBe(false);

    const contradictory = copy(value);
    contradictory.current.requestEnd = plus(contradictory.current.requestEnd, -1);
    const adverse = assessSpyDailyInput(bytes(contradictory));
    expect(adverse.status).toBe('contradictory');
    expect(matchesSpyDailyInputAssessment(bytes(contradictory), adverse)).toBe(true);
    expect(matchesSpyDailyInputAssessment(bytes(value), adverse)).toBe(false);
  });
});
