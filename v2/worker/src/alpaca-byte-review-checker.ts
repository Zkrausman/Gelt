import { createHash } from 'node:crypto';
import {
  alpacaIexAcquisitionSchema,
  alpacaIexRequestEvidenceSchema,
  alpacaSessionCalendarDigest,
  alpacaSessionCalendarSchema,
  type AlpacaIexAcquisition,
  type AlpacaIexDecimal,
  type AlpacaIexRawPage,
} from './alpaca-iex-contract.js';
import { isConnectorIssuedAlpacaAcquisition } from './alpaca-iex-connector.js';
import {
  bindingComparisonDigest,
  checkFailureReasons,
  checkIds,
  connectorPin,
  parseBindingStructure,
  parseInvocationStructure,
  parseJsonValueStructure,
  parseRevisionTupleStructure,
  parseSourceStructure,
  parseVerdictStructure,
  reviewAuthority,
  type CheckId,
  type InvocationV1,
  type OwnedReviewBindingV1,
  type ReviewCheckV1,
  type ReviewChecksV1,
  type ReviewVerdictV1,
  type UnknownReason,
  type VerdictOutcome,
} from './alpaca-byte-review-contract.js';
import { parseResearchJSONNumberTokens } from './research-json.js';
import {
  decimalCompare,
  shadowRuleId,
  shadowRuleInputSchema,
  shadowRuleMaxBytes,
  shadowRuleReceiptSchema,
  type ShadowRuleInput,
} from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';

/**
 * Independent consistency logic plus a CONSTRUCTED-ONLY invocation exercise.
 *
 * No production admission profile exists. The exported fixture lane cannot
 * admit market data, closure, independence, handling rights or runtime use.
 *
 * Trusted construction must exclude hostile proxies/interposition. Ordinary
 * descriptor checks below are not a universal Proxy detector.
 *
 * This module does not capture, normalize or build candidates. It does not
 * establish execution settlement, reference release, zeroization or delivery.
 */

const bad = (): never => { throw new Error('Byte review unavailable'); };
function assert(condition: unknown): asserts condition {
  if (!condition) bad();
}

const sha = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const firstBody =
  '{"bars":{"BRCFIX":[{"t":"2024-01-03T00:00:00Z","o":123.450,"h":124.00,"l":122.00,"c":123.450,"v":10,"n":1,"vw":123.00}]},"next_page_token":"SYNTHETIC_NEXT"}';
const secondBody =
  '{"bars":{"BRCFIX":[{"t":"2024-01-02T00:00:00Z","o":120.00,"h":121.00,"l":119.00,"c":120.00,"v":10,"n":1,"vw":120.00}]},"next_page_token":null}';

const fixtureRevisions = Object.freeze({
  contract: 1,
  consumer: '1.1',
  sourceClosure: 'constructed.byte-review.source.v1',
  request: 'constructed.byte-review.request.v1',
  policy: 'constructed.byte-review.policy.v1',
  calendar: 'constructed.byte-review.calendar.v1',
  availability: 'constructed.byte-review.availability.v1',
  candidate: 'constructed.byte-review.candidate.v1',
  reviewer: 'gelt.fixed-byte-checker.v1',
  verdictPolicy: 'constructed.byte-review.verdict.v1',
} as const);

/**
 * Finite, compiled test declaration, not an actual admission registry.
 * Its strings are synthetic public test material.
 */
export const constructedByteReviewProfile = Object.freeze({
  scope: 'constructed_only',
  productionAdmission: 'unavailable',
  reviewerRevision: 'gelt.fixed-byte-checker.v1',
  authorityId: 'constructed.byte-review.no-market-authority.v1',
  runtimeClosureRevision: 'constructed.byte-review.runtime.v1',
  revisions: fixtureRevisions,
  receivedAt: '2024-01-04T00:00:00.000Z',
  request: Object.freeze({
    symbol: 'BRCFIX',
    feed: 'iex',
    adjustment: 'raw',
    start: '2024-01-02T00:00:00.000Z',
    end: '2024-01-03T00:00:00.000Z',
    asof: '2024-01-03',
    timeframe: '1Day',
    currency: 'USD',
    sort: 'desc',
  }),
  pageBodies: Object.freeze([firstBody, secondBody]),
  maximumLaneAllocations: 256,
} as const);

export function productionByteReviewAvailability(): Readonly<{
  available: false;
  reason: 'admission_unavailable';
}> {
  return Object.freeze({ available: false, reason: 'admission_unavailable' });
}

type DataRecord = Record<string, unknown>;
type Seal = Readonly<{ matches(): boolean }>;

/**
 * Only positively observed unsupported construction uses this category.
 * Scalar/schema defects are classified separately; exhausted inspection bounds
 * establish no mutation or unsupported construction claim.
 */
class ConstructionDefect extends Error {}
class InspectionUnavailable extends Error {}

function construction(condition: unknown): asserts condition {
  if (!condition) throw new ConstructionDefect('Byte review unavailable');
}

function inspectionBound(condition: unknown): asserts condition {
  if (!condition) throw new InspectionUnavailable('Byte review unavailable');
}

function scalarString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function ownRecord(value: unknown, keys: readonly string[]): DataRecord {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  assert(prototype === Object.prototype || prototype === null);
  const actual = Reflect.ownKeys(value);
  assert(actual.length === keys.length
    && actual.every(key => typeof key === 'string' && keys.includes(key)));
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor && descriptor.enumerable && 'value' in descriptor);
  }
  return value as DataRecord;
}

/**
 * Retains identities and data descriptors, never decoded buffers.
 * Aliases and cycles reject rather than being copied into a successful tree.
 *
 * Number/string semantic validity is deliberately not inferred here. Even an
 * invalid initial scalar can be sealed without claiming temporal mutation.
 */
function sealGraph(root: unknown): Seal {
  const seen = new WeakSet<object>();
  const entries: {
    object: object;
    prototype: object | null;
    keys: readonly PropertyKey[];
    descriptors: readonly PropertyDescriptor[];
  }[] = [];
  let nodes = 0;

  const visit = (value: unknown, depth: number): void => {
    inspectionBound(++nodes <= 100000 && depth <= 32);
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
    if (typeof value === 'string') {
      // Field-specific semantic limits are applied by the structural parsers.
      inspectionBound(value.length <= 699052);
      return;
    }
    construction(typeof value === 'object' && !seen.has(value));
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    const isArray = Array.isArray(value);
    construction(isArray
      ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null);
    const keys = Reflect.ownKeys(value);
    construction(keys.every(key => typeof key === 'string'));
    const descriptors: PropertyDescriptor[] = [];

    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      construction(length && 'value' in length
        && Number.isInteger(length.value) && length.value >= 0);
      inspectionBound(length.value <= 253);
      construction(keys.length === length.value + 1);
      for (let i = 0; i < length.value; i++) {
        construction(Object.hasOwn(value, String(i)));
      }
    } else inspectionBound(keys.length <= 64);

    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      construction(descriptor && 'value' in descriptor);
      construction((isArray && key === 'length') || descriptor.enumerable);
      descriptors.push({ ...descriptor });
      if (!(isArray && key === 'length')) visit(descriptor.value, depth + 1);
    }
    entries.push({ object: value, prototype, keys, descriptors });
  };
  visit(root, 0);

  return Object.freeze({
    matches(): boolean {
      try {
        return entries.every(entry => {
          if (Object.getPrototypeOf(entry.object) !== entry.prototype) return false;
          const keys = Reflect.ownKeys(entry.object);
          if (keys.length !== entry.keys.length
            || keys.some((key, i) => key !== entry.keys[i])) return false;
          return keys.every((key, i) => {
            const current = Object.getOwnPropertyDescriptor(entry.object, key);
            const prior = entry.descriptors[i];
            return current !== undefined && 'value' in current
              && Object.is(current.value, prior.value)
              && current.enumerable === prior.enumerable
              && current.configurable === prior.configurable
              && current.writable === prior.writable;
          });
        });
      } catch { return false; }
    },
  });
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return left.length === right.length
    && left.every(key => Object.hasOwn(b, key)
      && same((a as DataRecord)[key], (b as DataRecord)[key]));
}

/**
 * The existing canonical algorithm, emitted in chunks. No replacement numeric
 * format or extra complete candidate canonical string is constructed here.
 */
function* legacyChunks(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i++) {
      if (i) yield ',';
      yield* legacyChunks(value[i]);
    }
    yield ']';
  } else if (value !== null && typeof value === 'object') {
    yield '{';
    const entries = Object.entries(value as DataRecord)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (let i = 0; i < entries.length; i++) {
      if (i) yield ',';
      yield JSON.stringify(entries[i][0]);
      yield ':';
      yield* legacyChunks(entries[i][1]);
    }
    yield '}';
  } else {
    const text = JSON.stringify(value);
    assert(text !== undefined);
    yield text;
  }
}

function legacyDigest(value: unknown): string {
  const hash = createHash('sha256');
  for (const chunk of legacyChunks(value)) hash.update(chunk, 'utf8');
  return hash.digest('hex');
}

function legacyTextMatches(value: unknown, text: string): boolean {
  let offset = 0;
  for (const chunk of legacyChunks(value)) {
    if (!text.startsWith(chunk, offset)) return false;
    offset += chunk.length;
  }
  return offset === text.length;
}

function timestamp(value: unknown): string {
  assert(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value));
  const fraction = value.match(/\.(\d+)Z$/)?.[1];
  const normalized = fraction
    ? value.replace(/\.\d+Z$/, `.${fraction.padEnd(3, '0')}Z`)
    : value.slice(0, -1) + '.000Z';
  assert(Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === normalized);
  return normalized;
}

function decimal(token: string | undefined, positive: boolean): AlpacaIexDecimal {
  assert(token !== undefined && token.length <= 40
    && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(token));
  const precision = token.replace('.', '').length;
  const scale = token.split('.')[1]?.length ?? 0;
  assert(precision >= 1 && precision <= 38 && scale <= 18
    && (!positive || /[1-9]/.test(token)));
  return { value: token, precision, scale };
}

type PageInspection = Readonly<{
  bytes: boolean;
  rows: boolean;
  observations: boolean;
  cursor: boolean;
  count: number;
  next: string | null;
  lastTimestamp: number;
}>;

/**
 * Its single decoded original-page buffer is local to this synchronous call.
 * It returns only bounded cursor/state scalars, never buffers, parsed rows,
 * number-token maps, parser text or a page transcript.
 */
function inspectPage(
  pageInput: unknown,
  symbol: string,
  limit: number,
  supplied: AlpacaIexAcquisition['observations'] | undefined,
  offset: number,
  previousTimestamp: number,
): PageInspection {
  let bytesOK = false;
  let cursorOK = false;
  let next: string | null = null;
  let count = 0;
  let lastTimestamp = previousTimestamp;
  try {
    const page = ownRecord(pageInput, ['page', 'byteLength', 'sha256', 'bodyBase64']);
    assert(Number.isInteger(page.page) && Number(page.page) >= 1 && Number(page.page) <= 3);
    assert(Number.isInteger(page.byteLength)
      && Number(page.byteLength) >= 1 && Number(page.byteLength) <= 524288);
    assert(typeof page.sha256 === 'string' && /^[a-f0-9]{64}$/.test(page.sha256));
    assert(typeof page.bodyBase64 === 'string' && page.bodyBase64.length <= 699052
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(page.bodyBase64));

    const bytes = Buffer.from(page.bodyBase64, 'base64');
    assert(bytes.length === page.byteLength
      && bytes.toString('base64') === page.bodyBase64
      && sha(bytes) === page.sha256);
    bytesOK = true;

    const parsed = parseResearchJSONNumberTokens(bytes);
    const root = ownRecord(parsed.value, ['bars', 'next_page_token']);
    const bySymbol = ownRecord(root.bars, [symbol]);
    const rows = bySymbol[symbol];
    assert(Array.isArray(rows) && rows.length >= 1 && rows.length <= limit
      && rows.length <= 100);
    count = rows.length;
    const token = root.next_page_token;
    assert(token === null || (typeof token === 'string' && token.length >= 1
      && token.length <= 1024 && /^[\x21-\x7e]+$/.test(token)));
    next = token as string | null;
    cursorOK = true;

    let observationsOK = true;
    for (let i = 0; i < rows.length; i++) {
      const row = ownRecord(rows[i], ['t', 'o', 'h', 'l', 'c', 'v', 'n', 'vw']);
      const normalizedTime = timestamp(row.t);
      const epoch = Date.parse(normalizedTime);
      assert(epoch < lastTimestamp);
      lastTimestamp = epoch;
      const values: Record<string, AlpacaIexDecimal> = {};
      for (const field of ['o', 'h', 'l', 'c', 'v', 'n', 'vw']) {
        assert(typeof row[field] === 'number' && Number.isFinite(row[field]));
        values[field] = decimal(
          parsed.numberTokens.get(JSON.stringify(['bars', symbol, i, field])),
          field !== 'v' && field !== 'n',
        );
      }
      assert(values.n.scale === 0
        && decimalCompare(values.h, values.o) >= 0
        && decimalCompare(values.h, values.c) >= 0
        && decimalCompare(values.l, values.o) <= 0
        && decimalCompare(values.l, values.c) <= 0);
      if (supplied) {
        const observation = supplied[offset + i];
        if (!observation || observation.providerTimestamp !== normalizedTime
          || !same(observation.close, values.c)) observationsOK = false;
      }
    }
    return {
      bytes: true, rows: true, observations: observationsOK, cursor: true,
      count, next, lastTimestamp,
    };
  } catch {
    return {
      bytes: bytesOK, rows: false, observations: false, cursor: cursorOK,
      count, next, lastTimestamp,
    };
  }
}

/**
 * Low-level, non-admitting inspection for constructed page tests.
 * This is not an issuance check, full review, completion or handling grant.
 * It returns no raw values, cursors, digests or diagnostics.
 */
export function inspectByteReviewPage(
  page: unknown,
  symbol: string,
  limit: number,
): Readonly<{ bytes: 'pass' | 'fail'; rows: 'pass' | 'fail' }> {
  try {
    assert(typeof symbol === 'string' && /^[A-Z][A-Z0-9.]{0,15}$/.test(symbol));
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 100);
    sealGraph(page);
    const result = inspectPage(page, symbol, limit, undefined, 0, Infinity);
    return Object.freeze({
      bytes: result.bytes ? 'pass' : 'fail',
      rows: result.rows ? 'pass' : 'fail',
    });
  } catch {
    return Object.freeze({ bytes: 'fail', rows: 'fail' });
  }
}

const unresolvedGates = Object.freeze({
  A1_source_rights: 'not_established',
  A2_finite_retention: 'not_established',
  A3_eligible_253_window: 'not_established',
  A4_exact_provenance: 'not_established',
  A5_schedule_freshness: 'not_established',
  A6_cost_stress_passive_cash: 'not_established',
  A7_initial_portfolio_risk_context: 'not_established',
} as const);

type CandidateView = Readonly<{
  status: unknown;
  canonicalInput: unknown;
  input: unknown;
  receipt: unknown;
  manifest: unknown;
  knownMissingGates: unknown;
  blockedGates: unknown;
  missingContextFields: unknown;
  replayMatches: unknown;
  classification: unknown;
  eligibility: unknown;
  effectAuthority: unknown;
  promotionAllowed: unknown;
}>;

function candidateView(input: unknown): CandidateView {
  const r = ownRecord(input, [
    'schema', 'status', 'blockedGates', 'missingContextFields',
    'knownMissingGates', 'input', 'canonicalInput', 'receipt', 'replayMatches',
    'manifest', 'classification', 'eligibility', 'effectAuthority', 'promotionAllowed',
  ]);
  assert(r.schema === 'gelt.alpaca-shadow-candidate-result.v1');
  assert(typeof r.canonicalInput === 'string'
    && Buffer.byteLength(r.canonicalInput, 'utf8') >= 1
    && Buffer.byteLength(r.canonicalInput, 'utf8') <= 262144);
  return Object.freeze({
    status: r.status,
    canonicalInput: r.canonicalInput,
    input: parseJsonValueStructure(r.input),
    receipt: parseJsonValueStructure(r.receipt),
    manifest: parseJsonValueStructure(r.manifest),
    knownMissingGates: parseJsonValueStructure(r.knownMissingGates),
    blockedGates: parseJsonValueStructure(r.blockedGates),
    missingContextFields: parseJsonValueStructure(r.missingContextFields),
    replayMatches: r.replayMatches,
    classification: r.classification,
    eligibility: r.eligibility,
    effectAuthority: r.effectAuthority,
    promotionAllowed: r.promotionAllowed,
  });
}

type Result = 'pass' | 'fail' | 'unknown';
function check(
  id: CheckId,
  result: Result,
  unknownReason: UnknownReason = 'evidence_missing',
): ReviewCheckV1 {
  return Object.freeze({
    id,
    result,
    reason: result === 'pass' ? 'none'
      : result === 'fail' ? checkFailureReasons[id] : unknownReason,
  }) as ReviewCheckV1;
}

function vector(
  states: ReadonlyMap<CheckId, Result>,
  evaluationIncomplete = false,
): ReviewChecksV1 {
  return Object.freeze(checkIds.map(id => check(
    id,
    states.get(id) ?? 'unknown',
    evaluationIncomplete && ![
      'C07_CLOSURE_REVISIONS', 'C13_REVIEWER_ADMISSION', 'C14_HANDLING',
    ].includes(id) ? 'evaluation_incomplete' : 'evidence_missing',
  ))) as unknown as ReviewChecksV1;
}

function outcome(checks: ReviewChecksV1): VerdictOutcome {
  return checks.some(item => item.result === 'fail') ? 'rejected'
    : checks.some(item => item.result === 'unknown') ? 'incomplete'
    : 'consistent_unverified';
}

function fixedRequestMatches(request: AlpacaIexAcquisition['request']): boolean {
  return Object.entries(constructedByteReviewProfile.request)
    .every(([key, value]) => (request as unknown as DataRecord)[key] === value);
}

function availabilityDigest(b: OwnedReviewBindingV1): string {
  // Exact existing normalizer algorithm and insertion order, not comparison JSON.
  return sha(JSON.stringify({
    calendarSha256: b.evidence.calendar.sha256,
    availability: b.evidence.availability.map(
      ({ providerTimestamp, availableAt, evidenceSha256 }) =>
        ({ providerTimestamp, availableAt, evidenceSha256 }),
    ),
    completion: b.evidence.calendar.sessions.map(
      ({ providerTimestamp, completedAt, completionEvidenceSha256 }) =>
        ({ providerTimestamp, completedAt, completionEvidenceSha256 }),
    ),
  }));
}

/**
 * These diagnostics run only after all three graphs have been completely
 * inspected for ordinary data descriptors and aliases. Each fail below has
 * a specific established content predicate. A successful component validation
 * does not mark its complete C-check pass, and an unclassified envelope defect
 * leaves the unevaluated checks unknown.
 */
function classifyBindingContent(
  input: unknown,
  states: Map<CheckId, Result>,
): void {
  const defect = (id: CheckId, validate: () => void): void => {
    try { validate(); } catch { states.set(id, 'fail'); }
  };
  const canonicalTime = (value: unknown): void => {
    assert(typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value);
  };
  const uint = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): void => {
    assert(typeof value === 'number' && Number.isSafeInteger(value)
      && !Object.is(value, -0) && value >= min && value <= max);
  };
  const hash = (value: unknown): void => {
    assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  };

  let r: DataRecord;
  try {
    r = ownRecord(input, [
      'schema', 'attemptId', 'revisions', 'source', 'request', 'receipt',
      'pages', 'evidence', 'limits', 'authority',
    ]);
  } catch { return; }

  defect('C07_CLOSURE_REVISIONS', () => {
    parseRevisionTupleStructure(r.revisions);
    parseSourceStructure(r.source);
  });
  defect('C03_REQUEST_CURSOR', () => {
    assert(alpacaIexRequestEvidenceSchema.safeParse(r.request).success);
  });
  defect('C02_PAGE_BYTES', () => {
    assert(Array.isArray(r.pages) && r.pages.length >= 1 && r.pages.length <= 3);
    r.pages.forEach((item, index) => {
      const page = ownRecord(item, ['page', 'byteLength', 'sha256']);
      assert(page.page === index + 1);
      uint(page.byteLength, 1, 524288);
      hash(page.sha256);
    });
  });
  defect('C06_RECEIPT', () => {
    const receipt = ownRecord(r.receipt, ['receivedAt', 'decisionAt']);
    canonicalTime(receipt.receivedAt);
    canonicalTime(receipt.decisionAt);
    assert(Date.parse(receipt.decisionAt as string) >= Date.parse(receipt.receivedAt as string));
  });
  defect('C12_AUTHORITY_FENCES', () => {
    const authority = ownRecord(r.authority, Object.keys(reviewAuthority));
    assert(same(authority, reviewAuthority));
  });

  let e: DataRecord;
  try {
    e = ownRecord(r.evidence, [
      'calendar', 'availability', 'context', 'candidateCanonicalInput',
      'candidateReceipt', 'candidateManifest',
    ]);
  } catch { return; }

  defect('C08_CALENDAR', () => {
    assert(alpacaSessionCalendarSchema.safeParse(e.calendar).success);
  });
  defect('C09_AVAILABILITY', () => {
    assert(Array.isArray(e.availability)
      && e.availability.length >= 1 && e.availability.length <= 253);
    for (const value of e.availability) {
      const item = ownRecord(value, ['providerTimestamp', 'availableAt', 'evidenceSha256']);
      canonicalTime(item.providerTimestamp);
      canonicalTime(item.availableAt);
      hash(item.evidenceSha256);
    }
  });
  defect('C10_CONTEXT_POLICY', () => {
    const context = ownRecord(e.context, [
      'runId', 'sourceCommit', 'expectedCalendarSha256', 'expectedWindow',
      'rightsEvidenceSha256', 'policy', 'costs', 'controls', 'portfolio',
    ]);
    assert(typeof context.runId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(context.runId));
    assert(typeof context.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(context.sourceCommit));
    hash(context.expectedCalendarSha256);
    hash(context.rightsEvidenceSha256);
    const window = ownRecord(context.expectedWindow, [
      'firstSessionOrdinal', 'lastSessionOrdinal', 'observationCount',
    ]);
    uint(window.firstSessionOrdinal);
    uint(window.lastSessionOrdinal);
    uint(window.observationCount, 1, 253);
    for (const key of ['policy', 'costs', 'controls', 'portfolio'] as const) {
      parseJsonValueStructure(context[key]);
      assert(shadowRuleInputSchema.shape[key].safeParse(context[key]).success);
    }
  });
  defect('C11_CANDIDATE', () => {
    assert(typeof e.candidateCanonicalInput === 'string'
      && scalarString(e.candidateCanonicalInput)
      && Buffer.byteLength(e.candidateCanonicalInput, 'utf8') >= 1
      && Buffer.byteLength(e.candidateCanonicalInput, 'utf8') <= 262144);
    parseJsonValueStructure(e.candidateReceipt);
    parseJsonValueStructure(e.candidateManifest);
    assert(shadowRuleReceiptSchema.safeParse(e.candidateReceipt).success);
  });
}

type LifecycleModel = Readonly<{
  oneReservation: boolean;
  elapsedMs: number;
  clockAvailable: boolean;
  cancelled: boolean;
  priorUncertainty: boolean;
}>;

function inspectFixed(
  originalInput: unknown,
  bindingInput: unknown,
  candidateInput: unknown,
  lifecycle?: LifecycleModel,
): ReviewChecksV1 {
  const states = new Map<CheckId, Result>();
  // The same connector module's WeakMap is consulted before any parse or clone.
  if (!isConnectorIssuedAlpacaAcquisition(originalInput)) {
    states.set('C01_ISSUANCE', 'fail');
    return vector(states);
  }
  states.set('C01_ISSUANCE', 'pass');

  let seals: readonly Seal[];
  try {
    seals = [
      sealGraph(originalInput), sealGraph(bindingInput), sealGraph(candidateInput),
    ];
  } catch (error) {
    if (error instanceof ConstructionDefect) states.set('C16_IMMUTABILITY', 'fail');
    // Bound exhaustion or an otherwise incomplete inspection is not mutation.
    return vector(states, true);
  }

  let original: AlpacaIexAcquisition | undefined;
  let b: OwnedReviewBindingV1 | undefined;
  let c: CandidateView | undefined;
  try {
    const parsed = alpacaIexAcquisitionSchema.safeParse(originalInput);
    if (parsed.success) original = originalInput as AlpacaIexAcquisition;
    else {
      const checksByField: Readonly<Record<string, CheckId>> = {
        pages: 'C02_PAGE_BYTES',
        request: 'C03_REQUEST_CURSOR',
        source: 'C03_REQUEST_CURSOR',
        feed: 'C03_REQUEST_CURSOR',
        symbol: 'C03_REQUEST_CURSOR',
        adjustment: 'C03_REQUEST_CURSOR',
        asof: 'C03_REQUEST_CURSOR',
        observations: 'C05_OBSERVATIONS',
        receivedAt: 'C06_RECEIPT',
        calendarSha256: 'C08_CALENDAR',
      };
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && Object.hasOwn(checksByField, field)) {
          states.set(checksByField[field], 'fail');
        }
      }
    }
  } catch {
    // No precise acquisition defect was established.
  }
  try { b = parseBindingStructure(bindingInput); }
  catch { classifyBindingContent(bindingInput, states); }
  try { c = candidateView(candidateInput); }
  catch { states.set('C11_CANDIDATE', 'fail'); }

  if (!original || !b || !c) {
    states.set('C16_IMMUTABILITY', seals.every(seal => seal.matches())
      && isConnectorIssuedAlpacaAcquisition(originalInput) ? 'pass' : 'fail');
    return vector(states, true);
  }

  const test = (id: CheckId, predicate: () => boolean): void => {
    try { states.set(id, predicate() ? 'pass' : 'fail'); }
    catch { states.set(id, 'fail'); }
  };

  let bytesOK = original.pages.length === b.pages.length;
  let requestOK = same(original.request, b.request)
    && fixedRequestMatches(original.request)
    && original.symbol === original.request.symbol
    && original.feed === original.request.feed
    && original.adjustment === original.request.adjustment
    && original.asof === original.request.asof
    && Date.parse(original.request.start) <= Date.parse(original.request.end)
    && original.pages.length === original.request.pageRequests.length;
  let rowsOK = true;
  let observationsOK = true;
  let expectedCursor: string | null = null;
  let offset = 0;
  let previousTimestamp = Infinity;
  const seenCursors = new Set<string>();

  for (let i = 0; i < original.pages.length; i++) {
    const page = original.pages[i];
    const reference = b.pages[i];
    const request = original.request.pageRequests[i];
    if (!reference || page.page !== i + 1
      || page.byteLength !== reference.byteLength || page.sha256 !== reference.sha256
      || reference.page !== i + 1) bytesOK = false;
    const expectedLimit = Math.min(100, b.evidence.calendar.sessions.length - offset);
    if (!request || request.page !== i + 1 || request.limit !== expectedLimit
      || request.pageTokenSha256 !== (expectedCursor === null ? null : sha(expectedCursor))
      || (expectedCursor !== null && seenCursors.has(expectedCursor))) requestOK = false;
    if (expectedCursor !== null) seenCursors.add(expectedCursor);

    const inspected = inspectPage(
      page, original.symbol, request?.limit ?? 0,
      original.observations, offset, previousTimestamp,
    );
    bytesOK &&= inspected.bytes;
    rowsOK &&= inspected.rows;
    observationsOK &&= inspected.observations;
    requestOK &&= inspected.cursor;
    offset += inspected.count;
    previousTimestamp = inspected.lastTimestamp;
    expectedCursor = inspected.next;
    if (expectedCursor !== null && seenCursors.has(expectedCursor)) requestOK = false;
    if (i + 1 < original.pages.length && expectedCursor === null) requestOK = false;
  }
  if (expectedCursor !== null) requestOK = false;
  observationsOK &&= offset === original.observations.length
    && offset === b.evidence.calendar.sessions.length
    && offset >= 1 && offset <= 253;
  states.set('C02_PAGE_BYTES', bytesOK ? 'pass' : 'fail');
  states.set('C03_REQUEST_CURSOR', requestOK ? 'pass' : 'fail');
  states.set('C04_ROWS_DECIMALS', rowsOK ? 'pass' : 'fail');
  states.set('C05_OBSERVATIONS', observationsOK ? 'pass' : 'fail');

  test('C06_RECEIPT', () => original.receivedAt === b.receipt.receivedAt
    && Date.parse(b.receipt.decisionAt) >= Date.parse(original.receivedAt));

  // Matching compiled fixture labels is not complete admitted runtime closure.
  states.set('C07_CLOSURE_REVISIONS',
    same(b.revisions, fixtureRevisions)
      && b.source.runtimeClosureRevision === constructedByteReviewProfile.runtimeClosureRevision
      ? 'unknown' : 'fail');

  const calendar = b.evidence.calendar;
  const sessions = calendar.sessions;
  test('C08_CALENDAR', () => {
    assert(calendar.sha256 === alpacaSessionCalendarDigest(calendar)
      && original.calendarSha256 === calendar.sha256
      && calendar.symbol === original.symbol
      && original.request.start === sessions[0].providerTimestamp
      && original.request.end === sessions[sessions.length - 1].providerTimestamp
      && sessions.length === original.observations.length && observationsOK);
    return sessions.every((session, i) => {
      const observed = original.observations[sessions.length - 1 - i];
      return observed?.providerTimestamp === session.providerTimestamp
        && Date.parse(session.providerTimestamp) >= Date.parse(original.request.start)
        && Date.parse(session.providerTimestamp) <= Date.parse(original.request.end)
        && Date.parse(session.providerTimestamp) <= Date.parse(session.closedAt)
        && (i === 0 || (
          session.sessionOrdinal === sessions[i - 1].sessionOrdinal + 1
          && Date.parse(session.providerTimestamp) > Date.parse(sessions[i - 1].providerTimestamp)
          && Date.parse(session.closedAt) > Date.parse(sessions[i - 1].closedAt)
        ));
    });
  });

  const availabilityHash = availabilityDigest(b);
  test('C09_AVAILABILITY', () => {
    const availability = b.evidence.availability;
    assert(availability.length === sessions.length);
    const received = Date.parse(original.receivedAt);
    const decision = Date.parse(b.receipt.decisionAt);
    assert(sessions.every((session, i) => {
      const item = availability[i];
      const closed = Date.parse(session.closedAt);
      const completed = Date.parse(session.completedAt);
      const available = Date.parse(item.availableAt);
      return item.providerTimestamp === session.providerTimestamp
        && closed <= decision && completed >= closed && completed <= received
        && available >= received && available >= completed && available <= decision;
    }));
    const manifest = b.evidence.candidateManifest as DataRecord;
    const point = manifest.pointInTimeBody as DataRecord;
    return point.normalizationAvailabilityEvidenceSha256 === availabilityHash;
  });

  test('C10_CONTEXT_POLICY', () => {
    const context = b.evidence.context;
    const window = context.expectedWindow;
    return context.expectedCalendarSha256 === calendar.sha256
      && window.observationCount === sessions.length
      && window.firstSessionOrdinal === sessions[0].sessionOrdinal
      && window.lastSessionOrdinal === sessions[sessions.length - 1].sessionOrdinal
      && window.lastSessionOrdinal - window.firstSessionOrdinal + 1 === sessions.length
      && b.revisions.policy === fixtureRevisions.policy
      && shadowRuleInputSchema.shape.policy.safeParse(context.policy).success
      && shadowRuleInputSchema.shape.costs.safeParse(context.costs).success
      && shadowRuleInputSchema.shape.controls.safeParse(context.controls).success
      && shadowRuleInputSchema.shape.portfolio.safeParse(context.portfolio).success;
  });

  let expectedInput: ShadowRuleInput | undefined;
  let expectedManifest: unknown;
  let expectedReceipt: unknown;
  test('C11_CANDIDATE', () => {
    assert(bytesOK && requestOK && rowsOK && observationsOK
      && states.get('C08_CALENDAR') === 'pass'
      && states.get('C09_AVAILABILITY') === 'pass'
      && states.get('C10_CONTEXT_POLICY') === 'pass');
    const context = b.evidence.context;
    const bars = sessions.map((session, i) => ({
      sessionOrdinal: session.sessionOrdinal,
      closedAt: session.closedAt,
      availableAt: b.evidence.availability[i].availableAt,
      adjustedClose: { ...original.observations[sessions.length - 1 - i].close },
    }));
    const dataBody = {
      schema: 'gelt.alpaca-shadow-candidate-data.v1',
      connectorPin,
      sourceCommit: context.sourceCommit,
      normalizerSchema: 'gelt.alpaca-iex-normalized-bars.v1',
      classification: 'market_shadow_input',
      eligibility: 'unverified',
      source: original.source,
      feed: original.feed,
      symbol: original.symbol,
      currency: 'USD',
      timeframe: '1Day',
      adjustment: original.adjustment,
      asof: original.asof,
      request: {
        ...original.request,
        pageRequests: original.request.pageRequests.map(item => ({ ...item })),
      },
      rawPages: original.pages.map(({ page, byteLength, sha256 }) =>
        ({ page, byteLength, sha256 })),
      receivedAt: original.receivedAt,
      calendarSha256: calendar.sha256,
      normalizedBarsSha256: legacyDigest(bars),
    };
    const datasetSha256 = legacyDigest(dataBody);
    const pointInTimeBody = {
      schema: 'gelt.alpaca-shadow-candidate-point-in-time.v1',
      datasetSha256,
      decisionAt: b.receipt.decisionAt,
      receivedAt: original.receivedAt,
      expectedCalendarSha256: context.expectedCalendarSha256,
      expectedWindow: { ...context.expectedWindow },
      calendar,
      availability: b.evidence.availability,
      normalizationAvailabilityEvidenceSha256: availabilityHash,
    };
    const pointInTimeEvidenceSha256 = legacyDigest(pointInTimeBody);
    expectedInput = shadowRuleInputSchema.parse({
      schema: 'gelt.shadow-rule-input.v1',
      ruleId: shadowRuleId,
      runId: context.runId,
      sourceCommit: context.sourceCommit,
      decisionAt: b.receipt.decisionAt,
      instrument: { id: original.symbol, currency: 'USD', calendarSha256: calendar.sha256 },
      data: {
        classification: 'market_shadow_input',
        eligibility: 'unverified',
        datasetSha256,
        rightsEvidenceSha256: context.rightsEvidenceSha256,
        pointInTimeEvidenceSha256,
      },
      policy: context.policy,
      costs: context.costs,
      controls: context.controls,
      portfolio: context.portfolio,
      bars,
    });
    const text = b.evidence.candidateCanonicalInput;
    const inputByteLength = Buffer.byteLength(text, 'utf8');
    assert(inputByteLength <= shadowRuleMaxBytes
      && legacyTextMatches(expectedInput, text));
    // Page inspection calls have returned; no decoded original-page buffer is
    // retained while the existing G05 evaluator consumes its bounded input.
    expectedReceipt = evaluateShadowRule(Buffer.from(text, 'utf8'));
    expectedManifest = {
      schema: 'gelt.alpaca-shadow-input-candidate.v1',
      source: {
        connectorPin,
        sourceCommit: context.sourceCommit,
        normalizerSchema: 'gelt.alpaca-iex-normalized-bars.v1',
        ruleId: shadowRuleId,
      },
      dataBody,
      datasetSha256,
      pointInTimeBody,
      pointInTimeEvidenceSha256,
      g05InputSha256: sha(text),
      g05InputByteLength: inputByteLength,
      g05ReceiptSha256: legacyDigest(expectedReceipt),
      knownMissingGates: unresolvedGates,
      rawBodies: 'not_included',
      retentionAuthority: 'none',
      classification: 'market_shadow_input',
      eligibility: 'unverified',
      marketEvaluation: 'not_established',
      effectAuthority: 'none',
      promotionAllowed: false,
    };
    return c.status === 'candidate' && c.replayMatches === true
      && same(c.blockedGates, []) && same(c.missingContextFields, [])
      && c.canonicalInput === text && same(c.input, expectedInput)
      && same(c.receipt, expectedReceipt)
      && same(b.evidence.candidateReceipt, expectedReceipt)
      && same(c.manifest, expectedManifest)
      && same(b.evidence.candidateManifest, expectedManifest)
      && same(c.knownMissingGates, unresolvedGates);
  });

  test('C12_AUTHORITY_FENCES', () => {
    const input = c.input as DataRecord;
    const data = input.data as DataRecord;
    const receipt = c.receipt as DataRecord;
    const manifest = c.manifest as DataRecord;
    const boundReceipt = b.evidence.candidateReceipt as DataRecord;
    const boundManifest = b.evidence.candidateManifest as DataRecord;
    const receiptFences = (r: DataRecord): boolean =>
      r.inputValidation === 'valid' && r.classification === 'market_shadow_input'
      && r.decision === 'abstain' && r.reason === 'unverified_data'
      && r.targetExposure === null && r.effectAuthority === 'none'
      && r.promotionAllowed === false && r.marketEvaluation === 'not_established';
    const manifestFences = (m: DataRecord): boolean =>
      m.classification === 'market_shadow_input' && m.eligibility === 'unverified'
      && m.effectAuthority === 'none' && m.promotionAllowed === false
      && m.marketEvaluation === 'not_established'
      && m.rawBodies === 'not_included' && m.retentionAuthority === 'none'
      && same(m.knownMissingGates, unresolvedGates);
    return c.classification === 'market_shadow_input' && c.eligibility === 'unverified'
      && c.effectAuthority === 'none' && c.promotionAllowed === false
      && data.classification === 'market_shadow_input' && data.eligibility === 'unverified'
      && receiptFences(receipt) && receiptFences(boundReceipt)
      && manifestFences(manifest) && manifestFences(boundManifest)
      && same(c.knownMissingGates, unresolvedGates);
  });

  // Fixed producer identity/private linkage is implemented below. Independent
  // authored/reviewed admission evidence and actual handling admission are not.
  states.set('C13_REVIEWER_ADMISSION', 'unknown');
  states.set('C14_HANDLING', 'unknown');

  if (lifecycle) {
    states.set('C15_LIFECYCLE', !lifecycle.clockAvailable ? 'unknown'
      : lifecycle.oneReservation && lifecycle.elapsedMs >= 0
        && lifecycle.elapsedMs < 60000 && !lifecycle.cancelled
        && !lifecycle.priorUncertainty ? 'pass' : 'fail');
  }
  test('C16_IMMUTABILITY', () => seals.every(seal => seal.matches())
    && isConnectorIssuedAlpacaAcquisition(originalInput));
  return vector(states);
}

/**
 * Complete fixed-checker vector, for controlled constructed inputs only.
 * It is not a producer-linked completion or an operational verdict acceptor.
 * C07/C13/C14 cannot become pass from caller labels or hashes.
 */
export function inspectConstructedByteReview(
  original: unknown,
  binding: unknown,
  candidate: unknown,
): ReviewChecksV1 {
  return inspectFixed(original, binding, candidate);
}

export type ConstructedAcceptanceFailure =
  | 'not_completed'
  | 'provenance_mismatch'
  | 'authenticity_failed'
  | 'duplicate_completion'
  | 'acceptance_failed'
  | 'late'
  | 'cancelled'
  | 'timing_unknown'
  | 'prior_uncertainty'
  | 'closed';

export type ConstructedAcceptance = Readonly<{
  scope: 'constructed_only';
  accepted: boolean;
  reason: 'none' | ConstructedAcceptanceFailure;
  uncertainty: 'none' | 'latched';
  verdict: ReviewVerdictV1 | null;
}>;

export type ConstructedByteReviewLane = Readonly<{
  scope: 'constructed_only';
  attemptId: string;
  invocationId: string;
  reserve(original: unknown, binding: unknown, candidate: unknown): InvocationV1;
  produce(): object;
  accept(completion: unknown): ConstructedAcceptance;
  current(): ConstructedAcceptance;
  advanceFixtureElapsedTo(milliseconds: number): void;
  markFixtureClockUnavailable(): void;
  markCancelled(): void;
  markPriorUncertainty(): void;
  discardPayloadReferences(): void;
}>;

// Only weak original identity and finite locally allocated synthetic IDs are
// tracked globally. No payload, buffer, cursor or candidate is globally retained.
const reservedOriginals = new WeakSet<object>();
let allocatedFixtureLanes = 0;

const failurePriority: readonly ConstructedAcceptanceFailure[] = [
  'provenance_mismatch', 'authenticity_failed', 'duplicate_completion',
  'acceptance_failed', 'late', 'cancelled', 'timing_unknown',
  'prior_uncertainty', 'closed', 'not_completed',
];

function matchesFiniteFixture(original: AlpacaIexAcquisition): boolean {
  if (!fixedRequestMatches(original.request)
    || original.receivedAt !== constructedByteReviewProfile.receivedAt
    || original.pages.length !== 2 || original.observations.length !== 2) return false;
  return original.pages.every((page, i) => {
    const body = constructedByteReviewProfile.pageBodies[i];
    // Compile-time synthetic UTF-8 text is ASCII; exact base64 comparison
    // admits only these finite bodies, never a caller-declared data category.
    return page.bodyBase64 === Buffer.from(body, 'utf8').toString('base64');
  });
}

/**
 * No callbacks, caller registry/profile, authority IDs, clock callback or
 * production-enablement input are accepted.
 *
 * The fixture clock is an explicit deterministic model. It is not evidence
 * from an admitted production monotonic clock or event-order producer.
 */
export function createConstructedByteReviewLane(): ConstructedByteReviewLane {
  assert(arguments.length === 0);
  assert(allocatedFixtureLanes < constructedByteReviewProfile.maximumLaneAllocations);
  const suffix = (++allocatedFixtureLanes).toString(16).padStart(12, '0');
  const attemptId = `10000000-0000-4000-8000-${suffix}`;
  const invocationId = `20000000-0000-4000-8000-${suffix}`;
  let elapsed = 0;
  let clockAvailable = true;
  let cancelled = false;
  let priorUncertainty = false;
  let reserved = false;
  let produced = false;
  let consumed = false;
  let uncertainty: 'none' | 'latched' = 'none';
  let failure: ConstructedAcceptanceFailure | undefined;
  let completionTicket: object | undefined;
  let producedVerdict: ReviewVerdictV1 | undefined;
  let acceptedVerdict: ReviewVerdictV1 | undefined;
  let payload: {
    original: AlpacaIexAcquisition;
    bindingInput: unknown;
    candidateInput: unknown;
    binding: OwnedReviewBindingV1;
    seals: readonly Seal[];
  } | undefined;

  const invalidate = (reason: ConstructedAcceptanceFailure): void => {
    uncertainty = 'latched';
    acceptedVerdict = undefined;
    if (!failure || failurePriority.indexOf(reason) < failurePriority.indexOf(failure)) {
      failure = reason;
    }
  };

  const current = (): ConstructedAcceptance => Object.freeze({
    scope: 'constructed_only',
    accepted: acceptedVerdict !== undefined && failure === undefined,
    reason: failure ?? (acceptedVerdict ? 'none' : 'not_completed'),
    uncertainty,
    verdict: failure ? null : acceptedVerdict ?? null,
  });

  const boundary = (): boolean => {
    if (!payload || !isConnectorIssuedAlpacaAcquisition(payload.original)
      || !payload.seals.every(seal => seal.matches())) {
      invalidate('provenance_mismatch');
      return false;
    }
    if (!clockAvailable) invalidate('timing_unknown');
    if (elapsed >= 60000) invalidate('late');
    if (cancelled) invalidate('cancelled');
    if (priorUncertainty) invalidate('prior_uncertainty');
    return failure === undefined;
  };

  return Object.freeze({
    scope: 'constructed_only',
    attemptId,
    invocationId,

    reserve(originalInput: unknown, bindingInput: unknown, candidateInput: unknown): InvocationV1 {
      try {
        assert(!reserved && !failure);
        // No parsing/cloning may precede this same-module issuance check.
        assert(isConnectorIssuedAlpacaAcquisition(originalInput));
        const original = originalInput as AlpacaIexAcquisition;
        const seals = [
          sealGraph(originalInput), sealGraph(bindingInput), sealGraph(candidateInput),
        ];
        assert(alpacaIexAcquisitionSchema.safeParse(originalInput).success);
        assert(!reservedOriginals.has(original) && matchesFiniteFixture(original));
        const binding = parseBindingStructure(bindingInput);
        candidateView(candidateInput);
        assert(binding.attemptId === attemptId && clockAvailable && elapsed < 60000);
        const invocation = parseInvocationStructure({
          schema: 'gelt.byte-review-invocation.v1',
          attemptId,
          invocationId,
          authorityId: constructedByteReviewProfile.authorityId,
          revisions: binding.revisions,
          bindingSha256: bindingComparisonDigest(binding),
          startedAt: new Date(Date.parse(original.receivedAt) + elapsed).toISOString(),
          deadlineAt: new Date(Date.parse(original.receivedAt) + 60000).toISOString(),
        });
        // Reservation is irreversible and precedes any fixed checker invocation.
        reservedOriginals.add(original);
        reserved = true;
        payload = { original, bindingInput, candidateInput, binding, seals };
        return invocation;
      } catch {
        invalidate('acceptance_failed');
        return bad();
      }
    },

    produce(): object {
      if (produced) {
        invalidate('duplicate_completion');
        return Object.freeze(Object.create(null) as object);
      }
      assert(reserved);
      produced = true;
      completionTicket = Object.freeze(Object.create(null) as object);
      if (!boundary() || !payload) return completionTicket;
      const p = payload;
      try {
        const checks = inspectFixed(p.original, p.binding, p.candidateInput, {
          oneReservation: reserved,
          elapsedMs: elapsed,
          clockAvailable,
          cancelled,
          priorUncertainty,
        });
        producedVerdict = parseVerdictStructure({
          schema: 'gelt.review-before-discard-verdict.v1',
          attemptId,
          invocationId,
          revisions: p.binding.revisions,
          reviewerRevision: constructedByteReviewProfile.reviewerRevision,
          authorityId: constructedByteReviewProfile.authorityId,
          bindingSha256: bindingComparisonDigest(p.binding),
          completedAt: new Date(Date.parse(p.original.receivedAt) + elapsed).toISOString(),
          elapsedMs: elapsed,
          outcome: outcome(checks),
          checks,
        });
      } catch {
        invalidate('acceptance_failed');
      }
      return completionTicket;
    },

    accept(completion: unknown): ConstructedAcceptance {
      // Consume even a forged first submission: failure never permits a retry.
      if (consumed) {
        invalidate('duplicate_completion');
        return current();
      }
      consumed = true;
      if (!produced || completion !== completionTicket) {
        invalidate('authenticity_failed');
        return current();
      }
      if (!boundary() || !payload || !producedVerdict) {
        if (!failure) invalidate('acceptance_failed');
        return current();
      }
      try {
        const p = payload;
        const verdict = parseVerdictStructure(producedVerdict);
        assert(verdict.attemptId === attemptId && verdict.invocationId === invocationId
          && verdict.reviewerRevision === constructedByteReviewProfile.reviewerRevision
          && verdict.authorityId === constructedByteReviewProfile.authorityId
          && same(verdict.revisions, p.binding.revisions)
          && verdict.bindingSha256 === bindingComparisonDigest(p.binding)
          && Date.parse(verdict.completedAt) === Date.parse(p.original.receivedAt) + verdict.elapsedMs
          && verdict.elapsedMs <= elapsed && verdict.elapsedMs < 60000);
        // Exact live representation and original identity are rechecked in the
        // same synchronous acceptance turn, without an await or callback.
        assert(p.seals.every(seal => seal.matches())
          && isConnectorIssuedAlpacaAcquisition(p.original));
        if (verdict.checks.some(item => item.result === 'unknown')) uncertainty = 'latched';
        acceptedVerdict = verdict;
      } catch {
        invalidate('acceptance_failed');
      }
      return current();
    },

    current,

    advanceFixtureElapsedTo(milliseconds: number): void {
      assert(Number.isInteger(milliseconds)
        && milliseconds >= elapsed && milliseconds <= 60001);
      elapsed = milliseconds;
      if (elapsed >= 60000) invalidate('late');
    },

    markFixtureClockUnavailable(): void {
      clockAvailable = false;
      invalidate('timing_unknown');
    },

    markCancelled(): void {
      cancelled = true;
      invalidate('cancelled');
    },

    markPriorUncertainty(): void {
      priorUncertainty = true;
      invalidate('prior_uncertainty');
    },

    discardPayloadReferences(): void {
      payload = undefined;
      producedVerdict = undefined;
      completionTicket = undefined;
      invalidate('closed');
      // This drops this closure's references only. It proves no whole-job
      // settlement, complete release accounting or zeroization.
    },
  });
}

/**
 * Private source-inspection primitives. No admission or completion is supplied
 * by these functions. Collection inspection returns no decoded payload/cursor.
 */
function inspectPrivateCollection(
  original: AlpacaIexAcquisition,
  references: readonly Readonly<{ page: number; byteLength: number; sha256: string }>[],
  requiredCount: number,
): readonly ReviewCheckV1[] {
  let bytes = original.pages.length === references.length;
  let request = original.pages.length === original.request.pageRequests.length;
  let rows = true;
  let observations = true;
  let cursor: string | null = null;
  let offset = 0;
  let previous = Infinity;
  const seen = new Set<string>();
  for (let i = 0; i < original.pages.length; i++) {
    const page = original.pages[i];
    const reference = references[i];
    const entry = original.request.pageRequests[i];
    bytes &&= page.page === i + 1 && reference?.page === i + 1
      && page.byteLength === reference.byteLength && page.sha256 === reference.sha256;
    request &&= entry?.page === i + 1
      && entry.limit === Math.min(100, requiredCount - offset)
      && entry.pageTokenSha256 === (cursor === null ? null : sha(cursor));
    if (cursor !== null) {
      if (seen.has(cursor)) request = false;
      seen.add(cursor);
    }
    const inspected = inspectPage(
      page, original.symbol, entry?.limit ?? 0,
      original.observations, offset, previous,
    );
    bytes &&= inspected.bytes;
    rows &&= inspected.rows;
    observations &&= inspected.observations;
    request &&= inspected.cursor;
    offset += inspected.count;
    previous = inspected.lastTimestamp;
    cursor = inspected.next;
    if (cursor !== null && seen.has(cursor)) request = false;
    if (i + 1 < original.pages.length && cursor === null) request = false;
  }
  request &&= cursor === null;
  observations &&= offset === requiredCount && offset === original.observations.length;
  return Object.freeze([
    check('C02_PAGE_BYTES', bytes ? 'pass' : 'fail'),
    check('C03_REQUEST_CURSOR', request ? 'pass' : 'fail'),
    check('C04_ROWS_DECIMALS', rows ? 'pass' : 'fail'),
    check('C05_OBSERVATIONS', observations ? 'pass' : 'fail'),
  ]);
}

export const privateByteReviewInspection = Object.freeze({
  seal: sealGraph, same, vector, outcome, collection: inspectPrivateCollection,
  constructionDefect: (error: unknown): boolean => error instanceof ConstructionDefect,
  allocateInspectionLane(): number {
    assert(allocatedFixtureLanes < constructedByteReviewProfile.maximumLaneAllocations);
    return ++allocatedFixtureLanes;
  },
  reserveOriginal(original: object): boolean {
    if (reservedOriginals.has(original)) return false;
    reservedOriginals.add(original);
    return true;
  },
});
