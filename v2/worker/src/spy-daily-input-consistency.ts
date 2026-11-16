import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { decimalCompare } from './shadow-rule-contract.js';

const spyDailyInputMaxBytes = 262_144;
const spyDailyAssessmentMaxBytes = 8_192;
const snapshotRowCount = 253;
const millisecond = 1;
const utcDay = 24 * 60 * 60 * 1_000;

const timestamp = z.string().datetime({ precision: 3 }).refine(value => {
  try {
    const epoch = Date.parse(value);
    return Number.isSafeInteger(epoch) && epoch >= 0 && new Date(epoch).toISOString() === value;
  } catch {
    return false;
  }
});
const gregorianDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try {
    const epoch = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isSafeInteger(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
});
const positiveDecimal = decimalSchema.refine(value => /[1-9]/.test(value.value));
const ordinal = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const calendarRowSchema = z.object({
  sessionDate: gregorianDate,
  ordinal,
  dayStartsAt: timestamp,
  dayEndsAt: timestamp,
}).strict();

const barRowSchema = z.object({
  providerTimestamp: timestamp,
  adjustedClose: positiveDecimal,
}).strict();

const snapshotSchema = z.object({
  feed: z.enum(['iex', 'sip']),
  symbol: z.literal('SPY'),
  currency: z.literal('USD'),
  timeframe: z.literal('1Day'),
  adjustment: z.literal('all'),
  asof: gregorianDate,
  requestStart: timestamp,
  requestEnd: timestamp,
  issuedAt: timestamp,
  receivedAt: timestamp,
  availableAt: timestamp,
  calendar: z.array(calendarRowSchema).length(snapshotRowCount),
  bars: z.array(barRowSchema).length(snapshotRowCount),
}).strict();
type Snapshot = z.infer<typeof snapshotSchema>;

const requestSchema = z.object({
  schema: z.literal('gelt.spy-daily-input-consistency-request.v1'),
  classification: z.literal('constructed_offline_test'),
  epochId: z.string().uuid(),
  declaredAt: timestamp,
  decisionAt: timestamp,
  current: snapshotSchema,
  predecessor: snapshotSchema.nullable(),
  revision: z.union([z.literal(0), z.literal(1)]),
}).strict().superRefine((request, context) => {
  if (Date.parse(request.declaredAt) >= Date.parse(request.decisionAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['declaredAt'], message: 'invalid input' });
  }
  if ((request.revision === 0 && request.predecessor !== null)
    || (request.revision === 1 && request.predecessor === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['predecessor'], message: 'invalid input' });
  }
});
type Request = z.infer<typeof requestSchema>;

const spyDailyInputReasons = [
  'daily_mapping',
  'calendar_order',
  'request_window',
  'sip_delay',
  'declaration_timing',
  'revision_binding',
] as const;
const reasonSchema = z.enum(spyDailyInputReasons);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const rejectedSchema = z.object({
  schema: z.literal('gelt.spy-daily-input-consistency.v1'),
  status: z.literal('rejected'),
  reason: z.literal('invalid_input'),
}).strict();
const commonAssessment = {
  schema: z.literal('gelt.spy-daily-input-consistency.v1'),
  assessmentId: z.string().regex(/^spy-daily-[a-f0-9]{64}$/),
  inputSha256: digestSchema,
  snapshotSha256: digestSchema,
  predecessorSha256: digestSchema.nullable(),
  classification: z.literal('constructed_offline_test'),
  consistency: z.literal('supplied_assertions_only'),
  rights: z.literal('not_established'),
  calendarAuthenticity: z.literal('not_established'),
  completion: z.literal('unknown'),
  vintage: z.literal('unknown'),
  actualAvailability: z.literal('not_established'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
};
const orderedReasons = (values: string[]): boolean => {
  const positions = values.map(value => spyDailyInputReasons.indexOf(value as typeof spyDailyInputReasons[number]));
  return positions.every((position, index) => position >= 0 && (index === 0 || positions[index - 1] < position));
};
const resultSchema = z.discriminatedUnion('status', [
  rejectedSchema,
  z.object({
    ...commonAssessment,
    status: z.literal('consistent'),
    reasons: z.array(reasonSchema).length(0),
  }).strict(),
  z.object({
    ...commonAssessment,
    status: z.literal('contradictory'),
    reasons: z.array(reasonSchema).min(1).max(spyDailyInputReasons.length).refine(orderedReasons),
  }).strict(),
]);
export type SpyDailyInputAssessment = z.infer<typeof resultSchema>;

const rejected = (): SpyDailyInputAssessment => ({
  schema: 'gelt.spy-daily-input-consistency.v1',
  status: 'rejected',
  reason: 'invalid_input',
});

const newYorkMidnight = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  calendar: 'gregory',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
});

function nextGregorianDate(value: string): string | null {
  try {
    const epoch = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isSafeInteger(epoch)) return null;
    const next = new Date(epoch + utcDay).toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null;
  } catch {
    return null;
  }
}

function localMidnightMatches(epoch: number, date: string): boolean {
  try {
    const parts = newYorkMidnight.formatToParts(new Date(epoch));
    const fields = new Map<string, string>();
    for (const part of parts) fields.set(part.type, part.value);
    return fields.get('year') === date.slice(0, 4)
      && fields.get('month') === date.slice(5, 7)
      && fields.get('day') === date.slice(8, 10)
      && fields.get('hour') === '00'
      && fields.get('minute') === '00'
      && fields.get('second') === '00'
      && fields.get('fractionalSecond') === '000';
  } catch {
    return false;
  }
}

function hasDailyMapping(snapshot: Snapshot): boolean {
  return snapshot.calendar.every((row, index) => {
    const nextDate = nextGregorianDate(row.sessionDate);
    const start = Date.parse(row.dayStartsAt);
    const end = Date.parse(row.dayEndsAt);
    return nextDate !== null
      && end > start
      && start % 1_000 === 0
      && end % 1_000 === 0
      && localMidnightMatches(start, row.sessionDate)
      && localMidnightMatches(end, nextDate)
      && snapshot.bars[index].providerTimestamp === row.dayStartsAt;
  });
}

function hasCalendarOrder(snapshot: Snapshot): boolean {
  for (let index = 1; index < snapshot.calendar.length; index++) {
    const previous = snapshot.calendar[index - 1];
    const current = snapshot.calendar[index];
    const previousStart = Date.parse(previous.dayStartsAt);
    const previousEnd = Date.parse(previous.dayEndsAt);
    const currentStart = Date.parse(current.dayStartsAt);
    const currentEnd = Date.parse(current.dayEndsAt);
    if (current.sessionDate <= previous.sessionDate
      || !Number.isSafeInteger(previous.ordinal + 1)
      || current.ordinal !== previous.ordinal + 1
      || currentStart <= previousStart
      || currentEnd <= previousEnd
      || currentStart < previousEnd) return false;
  }
  return true;
}

function hasRequestWindow(snapshot: Snapshot, decisionAt: string): boolean {
  const first = snapshot.calendar[0];
  const last = snapshot.calendar[snapshot.calendar.length - 1];
  const lastEnd = Date.parse(last.dayEndsAt);
  const expectedEnd = new Date(lastEnd - millisecond).toISOString();
  return snapshot.requestStart === first.dayStartsAt
    && snapshot.requestEnd === expectedEnd
    && Date.parse(snapshot.issuedAt) >= lastEnd
    && Date.parse(snapshot.receivedAt) >= Date.parse(snapshot.issuedAt)
    && Date.parse(snapshot.availableAt) >= Date.parse(snapshot.receivedAt)
    && Date.parse(snapshot.availableAt) < Date.parse(decisionAt)
    && snapshot.bars.length === snapshot.calendar.length
    && snapshot.bars.every((bar, index) => bar.providerTimestamp === snapshot.calendar[index].dayStartsAt);
}

function hasSipDelay(snapshot: Snapshot): boolean {
  return snapshot.feed !== 'sip'
    || Date.parse(snapshot.issuedAt) - Date.parse(snapshot.requestEnd) >= 900_000;
}

function hasDeclarationTiming(request: Request): boolean {
  const declared = Date.parse(request.declaredAt);
  return [request.current, ...(request.predecessor ? [request.predecessor] : [])]
    .every(snapshot => declared <= Date.parse(snapshot.issuedAt));
}

function hasRevisionBinding(request: Request): boolean {
  if (request.revision === 0) return request.predecessor === null;
  const current = request.current;
  const predecessor = request.predecessor;
  if (predecessor === null) return false;
  const sameIdentity = current.feed === predecessor.feed
    && current.symbol === predecessor.symbol
    && current.currency === predecessor.currency
    && current.timeframe === predecessor.timeframe
    && current.adjustment === predecessor.adjustment
    && current.asof === predecessor.asof
    && current.requestStart === predecessor.requestStart
    && current.requestEnd === predecessor.requestEnd
    && canonical(current.calendar) === canonical(predecessor.calendar);
  if (!sameIdentity
    || Date.parse(current.receivedAt) <= Date.parse(predecessor.receivedAt)
    || Date.parse(current.availableAt) >= Date.parse(request.decisionAt)
    || Date.parse(predecessor.availableAt) >= Date.parse(request.decisionAt)) return false;
  return current.bars.some((bar, index) => decimalCompare(bar.adjustedClose, predecessor.bars[index].adjustedClose) !== 0);
}

function contradictions(request: Request): typeof spyDailyInputReasons[number][] {
  const snapshots = [request.current, ...(request.predecessor ? [request.predecessor] : [])];
  const found = new Set<typeof spyDailyInputReasons[number]>();
  if (!snapshots.every(hasDailyMapping)) found.add('daily_mapping');
  if (!snapshots.every(hasCalendarOrder)) found.add('calendar_order');
  if (!snapshots.every(snapshot => hasRequestWindow(snapshot, request.decisionAt))) found.add('request_window');
  if (!snapshots.every(hasSipDelay)) found.add('sip_delay');
  if (!hasDeclarationTiming(request)) found.add('declaration_timing');
  if (!hasRevisionBinding(request)) found.add('revision_binding');
  return spyDailyInputReasons.filter(reason => found.has(reason));
}

// This pure assessment checks supplied synthetic assertions only. It does not
// establish supplier truth, data rights, completion, finality, eligibility or authority.
export function assessSpyDailyInput(bytes: Buffer): SpyDailyInputAssessment {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > spyDailyInputMaxBytes) return rejected();
    const request = requestSchema.parse(parseResearchJSON(bytes));
    const reasons = contradictions(request);
    const body = {
      schema: 'gelt.spy-daily-input-consistency.v1' as const,
      status: reasons.length === 0 ? 'consistent' as const : 'contradictory' as const,
      reasons,
      inputSha256: digest(canonical(request)),
      snapshotSha256: digest(canonical(request.current)),
      predecessorSha256: request.predecessor === null ? null : digest(canonical(request.predecessor)),
      classification: 'constructed_offline_test' as const,
      consistency: 'supplied_assertions_only' as const,
      rights: 'not_established' as const,
      calendarAuthenticity: 'not_established' as const,
      completion: 'unknown' as const,
      vintage: 'unknown' as const,
      actualAvailability: 'not_established' as const,
      marketEvaluation: 'not_established' as const,
      effectAuthority: 'none' as const,
      promotionAllowed: false as const,
    };
    const assessment = resultSchema.parse({
      ...body,
      assessmentId: `spy-daily-${digest(canonical(body))}`,
    });
    return Buffer.byteLength(canonical(assessment), 'utf8') <= spyDailyAssessmentMaxBytes ? assessment : rejected();
  } catch {
    return rejected();
  }
}

// Matching proves only deterministic linkage to these supplied bytes. It does
// not authenticate a source, receipt issuer, calendar or market observation.
export function matchesSpyDailyInputAssessment(bytes: Buffer, value: unknown): boolean {
  try {
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success || parsed.data.status === 'rejected') return false;
    const serialized = canonical(parsed.data);
    if (Buffer.byteLength(serialized, 'utf8') > spyDailyAssessmentMaxBytes) return false;
    const expected = assessSpyDailyInput(bytes);
    return expected.status !== 'rejected' && serialized === canonical(expected);
  } catch {
    return false;
  }
}
