import { createHash } from 'node:crypto';
import {
  alpacaIexRequestEvidenceSchema,
  alpacaSessionCalendarSchema,
  type AlpacaIexRequestEvidence,
  type AlpacaSessionCalendar,
} from './alpaca-iex-contract.js';
import {
  shadowRuleInputSchema,
  shadowRuleReceiptSchema,
} from './shadow-rule-contract.js';

/**
 * Structural contracts and private comparison only.
 *
 * Callers MUST supply values through controlled trusted construction paths
 * excluding hostile proxies and hostile interposition. Descriptor inspection
 * below rejects ordinary accessors; it cannot establish universal Proxy safety.
 *
 * Successful parsing establishes neither admission nor authentication, handling
 * authority, connector issuance, reviewer independence, invocation linkage,
 * settlement evidence, release accounting, acknowledgement linkage or eligibility.
 *
 * No registry, checker, acceptor, coordinator or operational entrypoint is
 * implemented here.
 */

export const comparisonRevision = 'gelt.byte-review-comparison.v1.1' as const;
export const snapshotCommit = 'c5146ed64d67a016496ec346cdcbeaa61365e579' as const;

export const connectorPin = Object.freeze({
  repositoryId: 1415613140,
  pullRequest: 13,
  reviewedSource: 'b2a13a02430dc1d650d641648e3ed28d0d45834b',
  mergeCommit: '17a745bf152d7295b6ea44d3348b8160af21e351',
  sourceTree: '4d70dab852fd35db2f4fe406e6c4c0395cec640b',
} as const);

export const reviewLimits = Object.freeze({
  captures: 1,
  pages: 3,
  pageBytes: 524288,
  reviewInvocations: 1,
  reviewDeadlineFromReceiptMs: 60000,
} as const);

export const reviewAuthority = Object.freeze({
  eligibility: 'unverified',
  effectAuthority: 'none',
  promotionAllowed: false,
} as const);

export const checkIds = Object.freeze([
  'C01_ISSUANCE',
  'C02_PAGE_BYTES',
  'C03_REQUEST_CURSOR',
  'C04_ROWS_DECIMALS',
  'C05_OBSERVATIONS',
  'C06_RECEIPT',
  'C07_CLOSURE_REVISIONS',
  'C08_CALENDAR',
  'C09_AVAILABILITY',
  'C10_CONTEXT_POLICY',
  'C11_CANDIDATE',
  'C12_AUTHORITY_FENCES',
  'C13_REVIEWER_ADMISSION',
  'C14_HANDLING',
  'C15_LIFECYCLE',
  'C16_IMMUTABILITY',
] as const);

export type CheckId = typeof checkIds[number];

export const checkFailureReasons = Object.freeze({
  C01_ISSUANCE: 'issuance_mismatch',
  C02_PAGE_BYTES: 'page_mismatch',
  C03_REQUEST_CURSOR: 'request_cursor_mismatch',
  C04_ROWS_DECIMALS: 'row_decimal_invalid',
  C05_OBSERVATIONS: 'observation_mismatch',
  C06_RECEIPT: 'receipt_mismatch',
  C07_CLOSURE_REVISIONS: 'revision_mismatch',
  C08_CALENDAR: 'calendar_mismatch',
  C09_AVAILABILITY: 'availability_mismatch',
  C10_CONTEXT_POLICY: 'context_policy_invalid',
  C11_CANDIDATE: 'candidate_mismatch',
  C12_AUTHORITY_FENCES: 'authority_escalation',
  C13_REVIEWER_ADMISSION: 'reviewer_not_admitted',
  C14_HANDLING: 'handling_violation',
  C15_LIFECYCLE: 'lifecycle_invalid',
  C16_IMMUTABILITY: 'mutation_detected',
} as const satisfies Record<CheckId, string>);

export const unknownReasons = Object.freeze([
  'evidence_missing',
  'checker_unavailable',
  'evaluation_incomplete',
] as const);

export type UnknownReason = typeof unknownReasons[number];
export type CheckFor<I extends CheckId> =
  | Readonly<{ id: I; result: 'pass'; reason: 'none' }>
  | Readonly<{
      id: I;
      result: 'fail';
      reason: typeof checkFailureReasons[I];
    }>
  | Readonly<{ id: I; result: 'unknown'; reason: UnknownReason }>;

export type ReviewCheckV1 = {
  [I in CheckId]: CheckFor<I>
}[CheckId];

type CheckTuple<T extends readonly CheckId[]> = {
  readonly [K in keyof T]: CheckFor<T[K]>
};
export type ReviewChecksV1 = CheckTuple<typeof checkIds>;
export type VerdictOutcome = 'consistent_unverified' | 'rejected' | 'incomplete';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type RevisionTupleV1 = Readonly<{
  contract: 1;
  consumer: '1.1';
  sourceClosure: string;
  request: string;
  policy: string;
  calendar: string;
  availability: string;
  candidate: string;
  reviewer: string;
  verdictPolicy: string;
}>;

export type SourceV1 = Readonly<{
  repositoryId: 1415613140;
  snapshotCommit: typeof snapshotCommit;
  connectorPin: typeof connectorPin;
  runtimeClosureRevision: string;
}>;

export type AvailabilityV1 = Readonly<{
  providerTimestamp: string;
  availableAt: string;
  evidenceSha256: string;
}>;

export type ReviewContextV1 = Readonly<{
  runId: string;
  sourceCommit: string;
  expectedCalendarSha256: string;
  expectedWindow: Readonly<{
    firstSessionOrdinal: number;
    lastSessionOrdinal: number;
    observationCount: number;
  }>;
  rightsEvidenceSha256: string;
  policy: JsonValue;
  costs: JsonValue;
  controls: JsonValue;
  portfolio: JsonValue;
}>;

export type EvidenceV1 = Readonly<{
  calendar: AlpacaSessionCalendar;
  availability: readonly AvailabilityV1[];
  context: ReviewContextV1;
  candidateCanonicalInput: string;
  candidateReceipt: JsonValue;
  candidateManifest: JsonValue;
}>;

export type PageReferenceV1 = Readonly<{
  page: number;
  byteLength: number;
  sha256: string;
}>;

export type OwnedReviewBindingV1 = Readonly<{
  schema: 'gelt.review-before-discard-binding.v1';
  attemptId: string;
  revisions: RevisionTupleV1;
  source: SourceV1;
  request: AlpacaIexRequestEvidence;
  receipt: Readonly<{ receivedAt: string; decisionAt: string }>;
  pages: readonly PageReferenceV1[];
  evidence: EvidenceV1;
  limits: typeof reviewLimits;
  authority: typeof reviewAuthority;
}>;

export type InvocationV1 = Readonly<{
  schema: 'gelt.byte-review-invocation.v1';
  attemptId: string;
  invocationId: string;
  authorityId: string;
  revisions: RevisionTupleV1;
  bindingSha256: string;
  startedAt: string;
  deadlineAt: string;
}>;

export type ReviewVerdictV1 = Readonly<{
  schema: 'gelt.review-before-discard-verdict.v1';
  attemptId: string;
  invocationId: string;
  revisions: RevisionTupleV1;
  reviewerRevision: string;
  authorityId: string;
  bindingSha256: string;
  completedAt: string;
  elapsedMs: number;
  outcome: VerdictOutcome;
  checks: ReviewChecksV1;
}>;

export const phases = Object.freeze([
  'preflight', 'acquisition', 'binding', 'candidate',
  'review', 'verdict', 'release', 'summary',
] as const);
export type ReviewPhase = typeof phases[number];

export const settlementOutcomes = Object.freeze([
  'not_attempted', 'pending', 'consistent_unverified', 'rejected',
  'unavailable', 'incomplete', 'timed_out', 'cancelled', 'crashed',
  'provenance_mismatch', 'verdict_authenticity_failed',
  'verdict_acceptance_failed', 'unknown', 'disposal_not_established',
  'summary_failed',
] as const);
export type SettlementOutcome = typeof settlementOutcomes[number];

export const reviewStates = Object.freeze([
  'not_attempted', 'pending', 'rejected', 'incomplete',
  'consistent_unverified', 'unknown',
] as const);
export type ReviewState = typeof reviewStates[number];

export const executionStates = Object.freeze([
  'not_started', 'pending', 'settled', 'unknown',
] as const);
export type ExecutionState = typeof executionStates[number];

export type DisposalState = 'references_released' | 'not_established';
export type DeliveryState = 'not_attempted' | 'acknowledged' | 'not_established';

export type ReviewSettlementV2 = Readonly<{
  schema: 'gelt.byte-review-settlement.v2';
  attemptId: string;
  invocationId: string | null;
  phase: ReviewPhase;
  outcome: SettlementOutcome;
  review: ReviewState;
  execution: ExecutionState;
  disposal: DisposalState;
  summaryDelivery: DeliveryState;
  uncertainty: 'none' | 'latched';
}>;

export type ReviewStatusV2 = Readonly<{
  schema: 'gelt.byte-review-status.v2';
  attemptId: string;
  phase: ReviewPhase;
  outcome: SettlementOutcome;
  review: ReviewState;
  execution: ExecutionState;
  disposal: DisposalState;
  summaryDelivery: DeliveryState;
  decision: 'abstain';
  reason: 'unverified_data';
  eligibility: 'unverified';
  effectAuthority: 'none';
  promotionAllowed: false;
  retryAllowed: false;
}>;

export type ReviewSummaryAckV2 = Readonly<{
  schema: 'gelt.byte-review-summary-ack.v2';
  attemptId: string;
  delivery: 'acknowledged';
}>;

export const outcomePrecedence = Object.freeze([
  'crashed',
  'provenance_mismatch',
  'verdict_authenticity_failed',
  'verdict_acceptance_failed',
  'timed_out',
  'cancelled',
  'summary_failed',
  'disposal_not_established',
  'unknown',
  'unavailable',
  'incomplete',
  'rejected',
  'consistent_unverified',
] as const);

const invalid = (): never => {
  throw new Error('Invalid byte-review structure');
};

function requireCondition(condition: unknown): asserts condition {
  if (!condition) invalid();
}

function scalarCount(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++, count++) {
    const first = value.charCodeAt(i);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(++i);
      requireCondition(second >= 0xdc00 && second <= 0xdfff);
    } else {
      requireCondition(first < 0xdc00 || first > 0xdfff);
    }
  }
  return count;
}

type Tree = null | boolean | number | string | Tree[] | { [key: string]: Tree };
type RecordTree = { [key: string]: Tree };
type CandidatePath = 'none' | 'evidence' | 'binding';

/**
 * Copies own enumerable data properties without evaluating ordinary getters.
 * The seen set is intentionally never unwound: aliases as well as cycles reject.
 *
 * The outer guard exceeds every possible schema path and aggregate schema size.
 * Generic JsonValue limits are checked separately at each designated field.
 */
function ownTree(input: unknown, candidatePath: CandidatePath): Tree {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, path: readonly string[], depth: number): Tree => {
    requireCondition(depth <= 32 && ++nodes <= 100000);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      requireCondition(Number.isFinite(value) && !Object.is(value, -0));
      return value;
    }
    if (typeof value === 'string') {
      const exception =
        (candidatePath === 'evidence'
          && path.length === 1 && path[0] === 'candidateCanonicalInput')
        || (candidatePath === 'binding'
          && path.length === 2 && path[0] === 'evidence'
          && path[1] === 'candidateCanonicalInput');
      if (exception) {
        requireCondition(Buffer.byteLength(value, 'utf8') >= 1
          && Buffer.byteLength(value, 'utf8') <= 262144);
        scalarCount(value);
      } else {
        requireCondition(scalarCount(value) <= 4096);
      }
      return value;
    }
    requireCondition(typeof value === 'object');
    requireCondition(!seen.has(value));
    seen.add(value);

    if (Array.isArray(value)) {
      requireCondition(Object.getPrototypeOf(value) === Array.prototype);
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      requireCondition(length && 'value' in length
        && Number.isInteger(length.value)
        && length.value >= 0 && length.value <= 253);
      const size = length.value as number;
      const keys = Reflect.ownKeys(value);
      requireCondition(keys.length === size + 1
        && keys.every(key => typeof key === 'string'));
      const result: Tree[] = [];
      for (let i = 0; i < size; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        requireCondition(descriptor && descriptor.enumerable && 'value' in descriptor);
        result.push(visit(descriptor.value, [...path, String(i)], depth + 1));
      }
      return Object.freeze(result) as unknown as Tree[];
    }

    const prototype = Object.getPrototypeOf(value);
    requireCondition(prototype === Object.prototype || prototype === null);
    const keys = Reflect.ownKeys(value);
    requireCondition(keys.length <= 64
      && keys.every(key => typeof key === 'string'));
    const result = Object.create(null) as RecordTree;
    for (const key of keys) {
      requireCondition(typeof key === 'string' && scalarCount(key) <= 4096);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireCondition(descriptor && descriptor.enumerable && 'value' in descriptor);
      result[key] = visit(descriptor.value, [...path, key], depth + 1);
    }
    return Object.freeze(result);
  };
  return visit(input, [], 0);
}

function record(value: Tree, keys: readonly string[]): RecordTree {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value));
  const actual = Object.keys(value);
  requireCondition(actual.length === keys.length
    && keys.every(key => Object.hasOwn(value, key)));
  return value as RecordTree;
}

function array(value: Tree, min: number, max: number): Tree[] {
  requireCondition(Array.isArray(value) && value.length >= min && value.length <= max);
  return value;
}

function string(value: Tree, pattern: RegExp): asserts value is string {
  requireCondition(typeof value === 'string' && pattern.test(value));
}

function uint(value: Tree, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  requireCondition(typeof value === 'number'
    && Number.isSafeInteger(value) && value >= min && value <= max);
}

function oneOf<T extends string>(value: Tree, values: readonly T[]): asserts value is T {
  requireCondition(typeof value === 'string' && values.includes(value as T));
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

function time(value: Tree): asserts value is string {
  string(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  requireCondition(Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value);
}

function jsonBounds(value: Tree): void {
  let nodes = 0;
  const visit = (current: Tree, depth: number): void => {
    requireCondition(depth <= 12 && ++nodes <= 5000);
    if (typeof current === 'string') {
      requireCondition(scalarCount(current) <= 4096);
    } else if (Array.isArray(current)) {
      requireCondition(current.length <= 253);
      for (const child of current) visit(child, depth + 1);
    } else if (current !== null && typeof current === 'object') {
      const keys = Object.keys(current);
      requireCondition(keys.length <= 64);
      for (const key of keys) {
        requireCondition(scalarCount(key) <= 4096);
        visit(current[key], depth + 1);
      }
    }
  };
  visit(value, 0);
}

const revisionKeys = [
  'contract', 'consumer', 'sourceClosure', 'request', 'policy', 'calendar',
  'availability', 'candidate', 'reviewer', 'verdictPolicy',
] as const;

function revisions(value: Tree): void {
  const r = record(value, revisionKeys);
  requireCondition(r.contract === 1 && r.consumer === '1.1');
  for (const key of revisionKeys.slice(2)) string(r[key], revisionPattern);
}

function literalRecord(value: Tree, expected: Readonly<Record<string, string | number | boolean>>): void {
  const r = record(value, Object.keys(expected));
  for (const key of Object.keys(expected)) requireCondition(r[key] === expected[key]);
}

function source(value: Tree): void {
  const r = record(value, [
    'repositoryId', 'snapshotCommit', 'connectorPin', 'runtimeClosureRevision',
  ]);
  requireCondition(r.repositoryId === 1415613140 && r.snapshotCommit === snapshotCommit);
  literalRecord(r.connectorPin, connectorPin);
  string(r.runtimeClosureRevision, revisionPattern);
}

function context(value: Tree): void {
  const r = record(value, [
    'runId', 'sourceCommit', 'expectedCalendarSha256', 'expectedWindow',
    'rightsEvidenceSha256', 'policy', 'costs', 'controls', 'portfolio',
  ]);
  string(r.runId, uuidPattern);
  string(r.sourceCommit, commitPattern);
  string(r.expectedCalendarSha256, hashPattern);
  string(r.rightsEvidenceSha256, hashPattern);
  const window = record(r.expectedWindow, [
    'firstSessionOrdinal', 'lastSessionOrdinal', 'observationCount',
  ]);
  uint(window.firstSessionOrdinal);
  uint(window.lastSessionOrdinal);
  uint(window.observationCount, 1, 253);

  for (const key of ['policy', 'costs', 'controls', 'portfolio'] as const) {
    jsonBounds(r[key]);
    requireCondition(shadowRuleInputSchema.shape[key].safeParse(r[key]).success);
  }
}

function evidence(value: Tree): void {
  const r = record(value, [
    'calendar', 'availability', 'context', 'candidateCanonicalInput',
    'candidateReceipt', 'candidateManifest',
  ]);
  // This retains the existing calendar digest algorithm unchanged.
  requireCondition(alpacaSessionCalendarSchema.safeParse(r.calendar).success);
  for (const item of array(r.availability, 1, 253)) {
    const entry = record(item, ['providerTimestamp', 'availableAt', 'evidenceSha256']);
    time(entry.providerTimestamp);
    time(entry.availableAt);
    string(entry.evidenceSha256, hashPattern);
  }
  context(r.context);
  requireCondition(typeof r.candidateCanonicalInput === 'string'
    && Buffer.byteLength(r.candidateCanonicalInput, 'utf8') >= 1
    && Buffer.byteLength(r.candidateCanonicalInput, 'utf8') <= 262144);
  jsonBounds(r.candidateReceipt);
  jsonBounds(r.candidateManifest);
  requireCondition(shadowRuleReceiptSchema.safeParse(r.candidateReceipt).success);
  const withoutCandidate = Object.create(null) as RecordTree;
  for (const key of Object.keys(r)) {
    if (key !== 'candidateCanonicalInput') withoutCandidate[key] = r[key];
  }
  requireCondition(Buffer.byteLength(encodeTree(withoutCandidate), 'utf8') <= 262144);
}

function binding(value: Tree): void {
  const r = record(value, [
    'schema', 'attemptId', 'revisions', 'source', 'request', 'receipt',
    'pages', 'evidence', 'limits', 'authority',
  ]);
  requireCondition(r.schema === 'gelt.review-before-discard-binding.v1');
  string(r.attemptId, uuidPattern);
  revisions(r.revisions);
  source(r.source);
  requireCondition(alpacaIexRequestEvidenceSchema.safeParse(r.request).success);
  const receipt = record(r.receipt, ['receivedAt', 'decisionAt']);
  time(receipt.receivedAt);
  time(receipt.decisionAt);
  requireCondition(Date.parse(receipt.decisionAt) >= Date.parse(receipt.receivedAt));
  const pages = array(r.pages, 1, 3);
  pages.forEach((item, index) => {
    const page = record(item, ['page', 'byteLength', 'sha256']);
    requireCondition(page.page === index + 1);
    uint(page.byteLength, 1, 524288);
    string(page.sha256, hashPattern);
  });
  evidence(r.evidence);
  literalRecord(r.limits, reviewLimits);
  literalRecord(r.authority, reviewAuthority);
  requireCondition(Buffer.byteLength(encodeTree(r), 'utf8') <= 786432);
}

function invocation(value: Tree): void {
  const r = record(value, [
    'schema', 'attemptId', 'invocationId', 'authorityId', 'revisions',
    'bindingSha256', 'startedAt', 'deadlineAt',
  ]);
  requireCondition(r.schema === 'gelt.byte-review-invocation.v1');
  string(r.attemptId, uuidPattern);
  string(r.invocationId, uuidPattern);
  string(r.authorityId, revisionPattern);
  revisions(r.revisions);
  string(r.bindingSha256, hashPattern);
  time(r.startedAt);
  time(r.deadlineAt);
  requireCondition(Date.parse(r.deadlineAt) >= Date.parse(r.startedAt));
  // Receipt-relative deadline and monotonic-clock evidence need private linkage.
}

function checks(value: Tree): VerdictOutcome {
  let fail = false;
  let unknown = false;
  array(value, 16, 16).forEach((item, index) => {
    const r = record(item, ['id', 'result', 'reason']);
    const id = checkIds[index];
    requireCondition(r.id === id);
    if (r.result === 'pass') {
      requireCondition(r.reason === 'none');
    } else if (r.result === 'fail') {
      requireCondition(r.reason === checkFailureReasons[id]);
      fail = true;
    } else {
      requireCondition(r.result === 'unknown');
      oneOf(r.reason, unknownReasons);
      unknown = true;
    }
  });
  return fail ? 'rejected' : unknown ? 'incomplete' : 'consistent_unverified';
}

function verdict(value: Tree): void {
  const r = record(value, [
    'schema', 'attemptId', 'invocationId', 'revisions', 'reviewerRevision',
    'authorityId', 'bindingSha256', 'completedAt', 'elapsedMs', 'outcome', 'checks',
  ]);
  requireCondition(r.schema === 'gelt.review-before-discard-verdict.v1');
  string(r.attemptId, uuidPattern);
  string(r.invocationId, uuidPattern);
  revisions(r.revisions);
  string(r.reviewerRevision, revisionPattern);
  string(r.authorityId, revisionPattern);
  string(r.bindingSha256, hashPattern);
  time(r.completedAt);
  uint(r.elapsedMs, 0, 60000);
  requireCondition(r.outcome === checks(r.checks));
}

const settlementKeys = [
  'schema', 'attemptId', 'invocationId', 'phase', 'outcome', 'review',
  'execution', 'disposal', 'summaryDelivery', 'uncertainty',
] as const;

const failureOrigins: Readonly<Record<string, readonly ReviewPhase[]>> = Object.freeze({
  rejected: ['preflight', 'binding', 'candidate', 'verdict'],
  unavailable: ['preflight', 'acquisition', 'binding', 'candidate', 'review'],
  incomplete: ['acquisition', 'binding', 'candidate', 'review', 'verdict'],
  timed_out: ['acquisition', 'binding', 'candidate', 'review', 'verdict'],
  cancelled: ['preflight', 'acquisition', 'binding', 'candidate', 'review', 'verdict'],
  crashed: phases,
  provenance_mismatch: ['binding', 'candidate', 'review', 'verdict'],
  verdict_authenticity_failed: ['verdict'],
  verdict_acceptance_failed: ['verdict'],
  unknown: phases,
  disposal_not_established: ['release'],
  summary_failed: ['summary'],
});

function settlementFields(r: RecordTree): void {
  string(r.attemptId, uuidPattern);
  oneOf(r.phase, phases);
  oneOf(r.outcome, settlementOutcomes);
  oneOf(r.review, reviewStates);
  oneOf(r.execution, executionStates);
  oneOf(r.disposal, ['references_released', 'not_established']);
  oneOf(r.summaryDelivery, ['not_attempted', 'acknowledged', 'not_established']);
  if (r.outcome === 'disposal_not_established') {
    requireCondition(r.execution === 'settled'
      && r.disposal === 'not_established');
  }
}

/**
 * Only necessary, locally decidable tuple constraints are checked here.
 * Evidence-backed lifecycle projection and admission remain coordinator work.
 */
function settlement(value: Tree): void {
  const r = record(value, settlementKeys);
  requireCondition(r.schema === 'gelt.byte-review-settlement.v2');
  settlementFields(r);
  if (r.invocationId !== null) string(r.invocationId, uuidPattern);
  oneOf(r.uncertainty, ['none', 'latched']);
  requireCondition((r.invocationId === null) === (r.review === 'not_attempted'));

  if (['preflight', 'acquisition', 'binding', 'candidate'].includes(r.phase as string)) {
    requireCondition(r.invocationId === null);
  }
  if (r.phase === 'review' || r.phase === 'verdict') {
    requireCondition(r.invocationId !== null);
  }
  if (r.disposal === 'references_released') requireCondition(r.execution === 'settled');
  if (r.review === 'unknown' || r.review === 'incomplete' || r.execution === 'unknown') {
    requireCondition(r.uncertainty === 'latched');
  }
  if (r.review === 'pending') {
    requireCondition(r.execution === 'pending' && r.phase === 'review');
  }
  if (r.phase === 'summary') {
    requireCondition(r.summaryDelivery !== 'not_attempted'
      && r.execution !== 'pending' && r.review !== 'pending');
  } else {
    requireCondition(r.summaryDelivery === 'not_attempted');
  }

  if (r.outcome === 'not_attempted') {
    requireCondition(r.phase === 'preflight' && r.invocationId === null
      && r.review === 'not_attempted' && r.execution === 'not_started'
      && r.disposal === 'not_established'
      && r.summaryDelivery === 'not_attempted' && r.uncertainty === 'none');
  } else if (r.outcome === 'pending') {
    requireCondition(['acquisition', 'binding', 'candidate', 'review'].includes(r.phase as string)
      && r.execution === 'pending' && r.disposal === 'not_established'
      && r.review === (r.phase === 'review' ? 'pending' : 'not_attempted'));
  } else if (r.outcome === 'consistent_unverified') {
    requireCondition(r.review === 'consistent_unverified' && r.uncertainty === 'none');
    if (r.phase === 'verdict') {
      requireCondition(r.execution === 'pending' && r.disposal === 'not_established');
    } else {
      requireCondition((r.phase === 'release' || r.phase === 'summary')
        && r.execution === 'settled');
      if (r.phase === 'summary') requireCondition(r.disposal === 'references_released');
    }
  } else {
    requireCondition(Object.hasOwn(failureOrigins, r.outcome as string));
    if (r.phase !== 'release' && r.phase !== 'summary') {
      requireCondition(failureOrigins[r.outcome as string].includes(r.phase as ReviewPhase));
    }
    if (!['rejected', 'unavailable'].includes(r.outcome as string)) {
      requireCondition(r.uncertainty === 'latched');
    }
    if (r.phase === 'release') {
      requireCondition(r.execution === 'settled' && r.review !== 'pending');
    } else if (r.phase !== 'summary') {
      requireCondition(r.disposal === 'not_established');
      if (r.execution === 'not_started') requireCondition(r.phase === 'preflight');
      else requireCondition(r.execution === 'pending' || r.execution === 'unknown');
    }
    if (r.phase === 'verdict' && r.outcome === 'rejected') {
      requireCondition(r.review === 'rejected');
    }
    if (r.outcome === 'incomplete' && (r.phase === 'review' || r.phase === 'verdict')) {
      requireCondition(r.review === 'incomplete');
    }
    if (r.outcome === 'unavailable' && r.phase === 'review') {
      requireCondition(r.review === 'incomplete' || r.review === 'unknown');
    }
    if ([
      'provenance_mismatch', 'verdict_authenticity_failed', 'verdict_acceptance_failed',
    ].includes(r.outcome as string) && r.invocationId !== null) {
      requireCondition(r.review === 'unknown');
    }
    if (r.outcome === 'unknown') {
      requireCondition(r.review === (r.invocationId === null ? 'not_attempted' : 'unknown'));
    }
  }
  requireCondition(Buffer.byteLength(encodeTree(r), 'utf8') <= 1024);
}

const statusKeys = [
  'schema', 'attemptId', 'phase', 'outcome', 'review', 'execution',
  'disposal', 'summaryDelivery', 'decision', 'reason', 'eligibility',
  'effectAuthority', 'promotionAllowed', 'retryAllowed',
] as const;

function status(value: Tree): void {
  const r = record(value, statusKeys);
  requireCondition(r.schema === 'gelt.byte-review-status.v2');
  settlementFields(r);
  requireCondition(r.phase === 'summary'
    && r.outcome !== 'not_attempted' && r.outcome !== 'pending'
    && r.review !== 'pending' && r.execution !== 'pending'
    && r.summaryDelivery === 'not_established');
  requireCondition(r.decision === 'abstain' && r.reason === 'unverified_data'
    && r.eligibility === 'unverified' && r.effectAuthority === 'none'
    && r.promotionAllowed === false && r.retryAllowed === false);
  if (r.execution !== 'settled') requireCondition(r.disposal === 'not_established');
  if (r.outcome === 'consistent_unverified') {
    requireCondition(r.review === 'consistent_unverified'
      && r.execution === 'settled' && r.disposal === 'references_released');
  }
  if (r.outcome === 'unknown') {
    requireCondition(r.review === 'unknown' || r.review === 'not_attempted');
  }
  if (r.outcome === 'verdict_authenticity_failed'
    || r.outcome === 'verdict_acceptance_failed') {
    requireCondition(r.review === 'unknown');
  }
  if (r.outcome === 'provenance_mismatch') {
    requireCondition(r.review === 'unknown' || r.review === 'not_attempted');
  }
  requireCondition(Buffer.byteLength(encodeTree(r), 'utf8') <= 1024);
}

function ack(value: Tree): void {
  const r = record(value, ['schema', 'attemptId', 'delivery']);
  requireCondition(r.schema === 'gelt.byte-review-summary-ack.v2'
    && r.delivery === 'acknowledged');
  string(r.attemptId, uuidPattern);
  requireCondition(Buffer.byteLength(encodeTree(r), 'utf8') <= 256);
}

function parseStructure<T>(
  input: unknown,
  validate: (value: Tree) => void,
  candidatePath: CandidatePath = 'none',
): T {
  const owned = ownTree(input, candidatePath);
  validate(owned);
  return owned as unknown as T;
}

export function parseJsonValueStructure(input: unknown): JsonValue {
  return parseStructure(input, jsonBounds);
}

export function parseRevisionTupleStructure(input: unknown): RevisionTupleV1 {
  return parseStructure(input, revisions);
}

export function parseSourceStructure(input: unknown): SourceV1 {
  return parseStructure(input, source);
}

export function parseEvidenceStructure(input: unknown): EvidenceV1 {
  return parseStructure(input, evidence, 'evidence');
}

export function parseBindingStructure(input: unknown): OwnedReviewBindingV1 {
  return parseStructure(input, binding, 'binding');
}

export function parseInvocationStructure(input: unknown): InvocationV1 {
  return parseStructure(input, invocation);
}

export function parseVerdictStructure(input: unknown): ReviewVerdictV1 {
  return parseStructure(input, verdict);
}

export function parseSettlementStructure(input: unknown): ReviewSettlementV2 {
  return parseStructure(input, settlement);
}

export function parseStatusStructure(input: unknown): ReviewStatusV2 {
  return parseStructure(input, status);
}

export function parseSummaryAckStructure(input: unknown): ReviewSummaryAckV2 {
  return parseStructure(input, ack);
}

/* Exact binary64 interval search. No money/provider-token interpretation. */

type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;
type NumberSpelling = Readonly<{ text: string; fixed: boolean }>;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function positiveBits(value: number): bigint {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false);
}

/** Exact binary64 value in units of 2^-1075, including zero. */
function binaryUnits(bits: bigint): bigint {
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  return exponent === 0
    ? fraction << 1n
    : ((1n << 52n) + fraction) << BigInt(exponent);
}

function compareRationalToPower10(value: Rational, exponent: number): number {
  const left = exponent < 0
    ? value.numerator * pow10(-exponent)
    : value.numerator;
  const right = exponent < 0
    ? value.denominator
    : value.denominator * pow10(exponent);
  return left < right ? -1 : left > right ? 1 : 0;
}

function floorLog10(value: Rational): number {
  let low = -1076;
  let high = 310;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (compareRationalToPower10(value, middle) >= 0) low = middle;
    else high = middle;
  }
  return low;
}

function renderCoefficient(digits: string, exponent: number, fixed: boolean): string {
  const width = digits.length;
  if (!fixed) {
    return digits[0] + (width > 1 ? `.${digits.slice(1)}` : '')
      + 'e' + String(exponent + width - 1);
  }
  const point = width + exponent;
  if (point >= width) return digits + '0'.repeat(point - width);
  if (point > 0) return digits.slice(0, point) + '.' + digits.slice(point);
  return '0.' + '0'.repeat(-point) + digits;
}

function spellingBefore(a: NumberSpelling, b: NumberSpelling): boolean {
  if (a.text.length !== b.text.length) return a.text.length < b.text.length;
  if (a.fixed !== b.fixed) return a.fixed;
  return a.text < b.text;
}

/**
 * A known roundtrip spelling bounds output length ONLY.
 * It never supplies the selected output or restricts coefficient precision.
 */
function roundtripLengthBound(value: number): number {
  const parts = value.toString().split('e');
  const mantissa = parts[0];
  let exponent = parts.length === 2 ? Number(parts[1]) : 0;
  const dot = mantissa.indexOf('.');
  if (dot >= 0) exponent -= mantissa.length - dot - 1;
  let digits = mantissa.replace('.', '').replace(/^0+/, '');
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return Math.min(
    renderCoefficient(digits, exponent, true).length,
    renderCoefficient(digits, exponent, false).length,
  );
}

export function formatComparisonNumber(value: number): string {
  requireCondition(typeof value === 'number'
    && Number.isFinite(value) && !Object.is(value, -0));
  if (value === 0) return '0';

  const negative = value < 0;
  const magnitude = Math.abs(value);
  const bits = positiveBits(magnitude);
  const units = binaryUnits(bits);
  const lower = (units + binaryUnits(bits - 1n)) / 2n;
  const next = bits === 0x7fefffffffffffffn
    ? 1n << 2099n // 2^1024, expressed in units of 2^-1075.
    : binaryUnits(bits + 1n);
  const upper = (units + next) / 2n;
  const inclusive = (bits & 1n) === 0n;
  const scale = 1n << 1075n;
  const minimumOrder = floorLog10({ numerator: lower, denominator: scale });
  const maximumOrder = floorLog10({ numerator: upper, denominator: scale });
  const bound = roundtripLengthBound(magnitude);
  let best: NumberSpelling | undefined;

  for (let width = 1; width <= Math.min(1075, bound); width++) {
    const widthLow = pow10(width - 1);
    const widthHigh = pow10(width) - 1n;
    // A width-d coefficient has decimal order d-1+k.
    const firstExponent = Math.max(-1074, minimumOrder - width + 1);
    const lastExponent = Math.min(309, maximumOrder - width + 1);
    for (let exponent = firstExponent; exponent <= lastExponent; exponent++) {
      const numerator = exponent >= 0 ? scale * pow10(exponent) : scale;
      const denominator = exponent < 0 ? pow10(-exponent) : 1n;
      const lowProduct = lower * denominator;
      const highProduct = upper * denominator;
      let low = inclusive
        ? (lowProduct + numerator - 1n) / numerator
        : lowProduct / numerator + 1n;
      let high = inclusive
        ? highProduct / numerator
        : (highProduct - 1n) / numerator;
      if (low < widthLow) low = widthLow;
      if (high > widthHigh) high = widthHigh;
      if (low % 10n === 0n) low++;
      if (low > high) continue;

      // Within this width/exponent, all spellings of a given form have
      // identical length and digit positions; the least coefficient is
      // therefore lexicographically first.
      const digits = low.toString();
      for (const fixed of [true, false]) {
        const candidate = {
          text: renderCoefficient(digits, exponent, fixed),
          fixed,
        };
        if (candidate.text.length <= bound
          && (!best || spellingBefore(candidate, best))) best = candidate;
      }
    }
  }
  requireCondition(best !== undefined);
  return (negative ? '-' : '') + best.text;
}

function scalarCompare(a: string, b: string): number {
  const left = Array.from(a, char => char.codePointAt(0)!);
  const right = Array.from(b, char => char.codePointAt(0)!);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return left.length - right.length;
}

function quote(value: string): string {
  let result = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"') result += '\\"';
    else if (char === '\\') result += '\\\\';
    else if (code <= 0x1f) result += '\\u00' + code.toString(16).padStart(2, '0');
    else result += char;
  }
  return result + '"';
}

/** Internal only: its argument must already be an owned validated tree. */
function encodeTree(value: Tree): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return formatComparisonNumber(value);
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return '[' + value.map(encodeTree).join(',') + ']';
  return '{' + Object.keys(value).sort(scalarCompare)
    .map(key => quote(key) + ':' + encodeTree(value[key])).join(',') + '}';
}

export function encodePrivateComparison(input: unknown): string {
  const owned = ownTree(input, 'none');
  jsonBounds(owned);
  return encodeTree(owned);
}

export function encodeEvidenceComparison(input: unknown): string {
  return encodeTree(parseEvidenceStructure(input) as unknown as Tree);
}

export function encodeBindingComparison(input: unknown): string {
  return encodeTree(parseBindingStructure(input) as unknown as Tree);
}

export function encodeVerdictComparison(input: unknown): string {
  return encodeTree(parseVerdictStructure(input) as unknown as Tree);
}

export function encodeSettlementComparison(input: unknown): string {
  return encodeTree(parseSettlementStructure(input) as unknown as Tree);
}

export function encodeStatusComparison(input: unknown): string {
  return encodeTree(parseStatusStructure(input) as unknown as Tree);
}

export function encodeSummaryAckComparison(input: unknown): string {
  return encodeTree(parseSummaryAckStructure(input) as unknown as Tree);
}

/**
 * Generic comparison domain only; no binding/evidence envelope restriction.
 *
 * A canonical string/key token needs at most 6*4096+2 UTF-8 bytes.
 * A canonical number is shorter: the formatter considers width <=1075 and
 * exponent in [-1074,309], whose fixed/scientific renderings, including sign,
 * are below this token bound. Null and booleans are also shorter.
 *
 * With N<=5000 values there are at most N-1 object member keys. Allowing
 * 2N maximum-size tokens and 4N punctuation bytes therefore overbounds every
 * accepted generic tree. This ceiling does not add a narrower valid domain.
 */
const comparisonTokenLimit = 6 * 4096 + 2;
export const comparisonDecodeByteLimit = 5000 * (2 * comparisonTokenLimit + 4);

/**
 * Scans syntax and generic bounds before whole-tree JSON.parse.
 * Only bounded individual string tokens are parsed during this scan.
 * No object/array value graph is materialized here.
 *
 * Whitespace is rejected immediately because canonical comparison has none
 * outside strings. Other alternate spellings remain subject to exact re-encode.
 */
function scanComparisonText(text: string): void {
  let position = 0;
  let nodes = 0;

  const stringToken = (): string => {
    requireCondition(text[position] === '"');
    const start = position++;
    while (position < text.length) {
      requireCondition(position - start < comparisonTokenLimit);
      const code = text.charCodeAt(position++);
      if (code === 0x22) {
        requireCondition(position - start <= comparisonTokenLimit);
        const value: unknown = JSON.parse(text.slice(start, position));
        requireCondition(typeof value === 'string' && scalarCount(value) <= 4096);
        return value;
      }
      requireCondition(code >= 0x20);
      if (code === 0x5c) {
        requireCondition(position < text.length);
        const escape = text[position++];
        if (escape === 'u') {
          requireCondition(position + 4 <= text.length
            && /^[0-9a-fA-F]{4}$/.test(text.slice(position, position + 4)));
          position += 4;
        } else {
          requireCondition('"\\/bfnrt'.includes(escape));
        }
      }
    }
    return invalid();
  };

  const visit = (depth: number): void => {
    requireCondition(depth <= 12 && ++nodes <= 5000);
    const first = text[position];
    if (first === '"') {
      stringToken();
      return;
    }
    if (first === '[') {
      position++;
      if (text[position] === ']') { position++; return; }
      let length = 0;
      while (true) {
        requireCondition(++length <= 253);
        visit(depth + 1);
        const delimiter = text[position++];
        if (delimiter === ']') return;
        requireCondition(delimiter === ',');
      }
    }
    if (first === '{') {
      position++;
      if (text[position] === '}') { position++; return; }
      const keys = new Set<string>();
      while (true) {
        requireCondition(keys.size < 64);
        const key = stringToken();
        requireCondition(!keys.has(key));
        keys.add(key);
        requireCondition(text[position++] === ':');
        visit(depth + 1);
        const delimiter = text[position++];
        if (delimiter === '}') return;
        requireCondition(delimiter === ',');
      }
    }
    for (const literal of ['null', 'true', 'false']) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return;
      }
    }
    const start = position;
    while (position < text.length && /[0-9eE+.\-]/.test(text[position])) {
      requireCondition(position - start < comparisonTokenLimit);
      position++;
    }
    const token = text.slice(start, position);
    requireCondition(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(token));
    const number = Number(token);
    requireCondition(Number.isFinite(number) && !Object.is(number, -0));
  };

  visit(0);
  requireCondition(position === text.length);
}

/**
 * Canonical equality rejects duplicate JSON members, alternate escapes, BOM,
 * whitespace, alternate number spellings and lossy/nonfinite numeric tokens.
 * This decoder admits generic JsonValue only, not bindings or evidence.
 *
 * The intrinsic view length is checked before any copy/decode. Trusted
 * construction excludes hostile interposition, as for the other parsers.
 * All syntax/UTF-8 errors are replaced with the fixed structural error.
 */
export function decodePrivateComparison(bytes: Uint8Array): JsonValue {
  try {
    requireCondition(bytes instanceof Uint8Array);
    const prototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const lengthGetter = Object.getOwnPropertyDescriptor(prototype, 'byteLength')?.get;
    const offsetGetter = Object.getOwnPropertyDescriptor(prototype, 'byteOffset')?.get;
    const bufferGetter = Object.getOwnPropertyDescriptor(prototype, 'buffer')?.get;
    requireCondition(lengthGetter !== undefined
      && offsetGetter !== undefined && bufferGetter !== undefined);
    const byteLength: unknown = lengthGetter.call(bytes);
    requireCondition(typeof byteLength === 'number'
      && Number.isSafeInteger(byteLength)
      && byteLength >= 1 && byteLength <= comparisonDecodeByteLimit);
    // Buffer.from(view) consults caller-owned length metadata. Reconstruct a
    // fresh base view from intrinsic backing-store metadata before copying;
    // caller constructors/species and shadowing properties are never consulted.
    const byteOffset: unknown = offsetGetter.call(bytes);
    requireCondition(typeof byteOffset === 'number'
      && Number.isSafeInteger(byteOffset) && byteOffset >= 0);
    const buffer = bufferGetter.call(bytes) as ArrayBufferLike;
    const view = new Uint8Array(buffer, byteOffset, byteLength);
    const ownedBytes = Buffer.copyBytesFrom(view);
    requireCondition(ownedBytes.byteLength === byteLength);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(ownedBytes);
    scanComparisonText(text);
    const value = parseJsonValueStructure(JSON.parse(text) as unknown);
    requireCondition(encodeTree(value as unknown as Tree) === text);
    return value;
  } catch {
    return invalid();
  }
}

export const comparisonDigestDomains = Object.freeze({
  binding: 'gelt.byte-review.binding.v1',
  verdict: 'gelt.byte-review.verdict.v1',
  evidence: 'gelt.byte-review.evidence.v1',
} as const);

function domainDigest(domain: string, canonical: string): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(Uint8Array.of(0))
    .update(canonical, 'utf8')
    .digest('hex');
}

export function bindingComparisonDigest(input: unknown): string {
  return domainDigest(comparisonDigestDomains.binding, encodeBindingComparison(input));
}

export function verdictComparisonDigest(input: unknown): string {
  return domainDigest(comparisonDigestDomains.verdict, encodeVerdictComparison(input));
}

export function evidenceComparisonDigest(input: unknown): string {
  return domainDigest(comparisonDigestDomains.evidence, encodeEvidenceComparison(input));
}
