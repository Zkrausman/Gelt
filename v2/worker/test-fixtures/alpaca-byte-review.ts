import { createHash } from 'node:crypto';
import type {
  AlpacaAvailability,
  AlpacaIexDecimal,
  AlpacaIexRawPage,
  AlpacaIexRequest,
  AlpacaIexRequestEvidence,
  AlpacaSessionCalendar,
} from '../src/alpaca-iex-contract.js';

/**
 * CONSTRUCTED test data only.
 *
 * No connector import, acquisition, network, credential, clock read, file access,
 * environment access, invocation capability, registry admission or issuance.
 *
 * The parent test must use the existing connector with a synthetic fetch,
 * retain its actual returned object and bind its actual receipt.
 *
 * This generator was prepared independently from field shapes. The companion
 * integration test checks the raw envelope/pagination against the connector
 * and explicitly adapts context and receipt-bound availability.
 */
export const CONSTRUCTED_NOTICE =
  'CONSTRUCTED: artificial calendar, prices, economics, rights and metadata; ' +
  'no market calibration, entitlement, admission or operational authority.' as const;

export const FIXTURE_IDS = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  invocationId: '22222222-2222-4222-8222-222222222222',
  otherAttemptId: '33333333-3333-4333-8333-333333333333',
  runId: '44444444-4444-4444-8444-444444444444',
} as const;

export const SOURCE_PINS = {
  repositoryId: 1415613140,
  snapshotCommit: 'c5146ed64d67a016496ec346cdcbeaa61365e579',
  connectorPin: {
    repositoryId: 1415613140,
    pullRequest: 13,
    reviewedSource: 'b2a13a02430dc1d650d641648e3ed28d0d45834b',
    mergeCommit: '17a745bf152d7295b6ea44d3348b8160af21e351',
    sourceTree: '4d70dab852fd35db2f4fe406e6c4c0395cec640b',
  },
  runtimeClosureRevision: 'constructed.runtime-closure.v1',
} as const;

export const CONSTRUCTED_REVISIONS = {
  contract: 1,
  consumer: '1.1',
  sourceClosure: 'constructed.source-closure.v1',
  request: 'constructed.request.v1',
  policy: 'constructed.policy.v1',
  calendar: 'constructed.calendar.v1',
  availability: 'constructed.availability.v1',
  candidate: 'constructed.candidate.v1',
  reviewer: 'constructed.reviewer.v1',
  verdictPolicy: 'constructed.verdict-policy.v1',
} as const;

export const FIXTURE_TIMES = {
  firstProviderTimestamp: '2025-01-01T00:00:00.000Z',
  lastProviderTimestamp: '2025-09-10T00:00:00.000Z',
  proposedReceivedAt: '2025-09-11T00:00:00.000Z',
  decisionAt: '2025-09-11T00:00:01.000Z',
  proposedStartedAt: '2025-09-11T00:00:02.000Z',
  proposedCompletedAt: '2025-09-11T00:00:03.000Z',
  proposedDeadlineAt: '2025-09-11T00:01:00.000Z',
} as const;

export const FIXTURE_LIMITS = {
  captures: 1,
  pages: 3,
  pageBytes: 524288,
  reviewInvocations: 1,
  reviewDeadlineFromReceiptMs: 60000,
} as const;

export const FIXTURE_FENCES = {
  decision: 'abstain',
  reason: 'unverified_data',
  eligibility: 'unverified',
  effectAuthority: 'none',
  promotionAllowed: false,
  retryAllowed: false,
} as const;

export const CHECK_FAILURES = [
  ['C01_ISSUANCE', 'issuance_mismatch'],
  ['C02_PAGE_BYTES', 'page_mismatch'],
  ['C03_REQUEST_CURSOR', 'request_cursor_mismatch'],
  ['C04_ROWS_DECIMALS', 'row_decimal_invalid'],
  ['C05_OBSERVATIONS', 'observation_mismatch'],
  ['C06_RECEIPT', 'receipt_mismatch'],
  ['C07_CLOSURE_REVISIONS', 'revision_mismatch'],
  ['C08_CALENDAR', 'calendar_mismatch'],
  ['C09_AVAILABILITY', 'availability_mismatch'],
  ['C10_CONTEXT_POLICY', 'context_policy_invalid'],
  ['C11_CANDIDATE', 'candidate_mismatch'],
  ['C12_AUTHORITY_FENCES', 'authority_escalation'],
  ['C13_REVIEWER_ADMISSION', 'reviewer_not_admitted'],
  ['C14_HANDLING', 'handling_violation'],
  ['C15_LIFECYCLE', 'lifecycle_invalid'],
  ['C16_IMMUTABILITY', 'mutation_detected'],
] as const;

export type FixtureCheckId = (typeof CHECK_FAILURES)[number][0];

export interface ConstructedObservation {
  providerTimestamp: string;
  close: AlpacaIexDecimal;
}

export interface ConstructedRow {
  providerTimestamp: string;
  sessionOrdinal: number;
  closedAt: string;
  completedAt: string;
  availableAt: string;
  close: AlpacaIexDecimal;
}

/** Constructed wire values; the companion test verifies parser compatibility. */
export interface ProposedWireBar {
  t: string;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: string;
  vw: string;
}

export interface ConstructedResponse {
  page: number;
  requestedLimit: number;
  inputCursor: string | null;
  outputCursor: string | null;
  rowCount: number;
  rows: ProposedWireBar[];
  bodyText: string;
  rawPage: AlpacaIexRawPage;
}

/**
 * Mirrors the supplied shadow-input field shapes as plain test data.
 * The companion test projects this into the existing candidate-context type.
 */
export interface ProposedShadowInput {
  schema: 'gelt.shadow-rule-input.v1';
  ruleId: 'gelt-long-cash-sign-return-252.v1';
  runId: string;
  sourceCommit: string;
  decisionAt: string;
  instrument: {
    id: string;
    currency: string;
    calendarSha256: string;
  };
  data: {
    classification: 'market_shadow_input';
    eligibility: 'unverified';
    datasetSha256: string;
    rightsEvidenceSha256: string;
    pointInTimeEvidenceSha256: string;
  };
  policy: {
    scheduleSha256: string;
    maxAgeMs: number;
    exposureCap: AlpacaIexDecimal;
  };
  costs: {
    status: 'unverified';
    evidenceSha256: string;
    stressScenarioSha256: string;
    commissionPerTrade: AlpacaIexDecimal;
    spreadFraction: AlpacaIexDecimal;
    slippageFraction: AlpacaIexDecimal;
  };
  controls: {
    passiveSha256: string;
    cashAssumptionSha256: string;
  };
  portfolio: {
    state: 'settled';
    snapshotSha256: string;
  };
  bars: Array<{
    sessionOrdinal: number;
    closedAt: string;
    availableAt: string;
    adjustedClose: AlpacaIexDecimal;
  }>;
}

export interface ConstructedAlpacaByteReviewFixture {
  notice: typeof CONSTRUCTED_NOTICE;
  symbol: 'SPY';
  rowCount: 253;
  rowsAscending: ConstructedRow[];
  observationsAscending: ConstructedObservation[];
  observationsDescending: ConstructedObservation[];
  calendar: AlpacaSessionCalendar;
  availability: AlpacaAvailability[];
  request: AlpacaIexRequest;
  proposedRequestEvidence: AlpacaIexRequestEvidence;
  responses: ConstructedResponse[];
  receiptPlan: {
    proposedReceivedAt: string;
    decisionAt: string;
    proposedStartedAt: string;
    proposedCompletedAt: string;
    proposedDeadlineAt: string;
    actualReceiptMustComeFromConnector: true;
    actualElapsedEvidenceMustComeFromHarness: true;
  };
  positiveDecimals: {
    one: AlpacaIexDecimal;
    exposureCap: AlpacaIexDecimal;
    commissionPerTrade: AlpacaIexDecimal;
    spreadFraction: AlpacaIexDecimal;
    slippageFraction: AlpacaIexDecimal;
  };
  proposedShadowInput: ProposedShadowInput;
  candidateContextProjection: {
    status: 'not_supplied';
    source: 'proposedShadowInput';
    exactOuterAdapterShapeRequiredBeforeIntegration: true;
  };
  admission: {
    operationalAdoption: 'DEFER';
    productionRightsEstablished: false;
    producerEstablished: false;
    reviewerAdmitted: false;
    closureEstablished: false;
    connectorIssuedObjectIncluded: false;
    candidateCanonicalInputIncluded: false;
    candidateReceiptIncluded: false;
    candidateManifestIncluded: false;
  };
}

/** Ordinary SHA256 of constructed UTF-8 data, not private comparison encoding. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function evidenceHash(label: string): string {
  return sha256(`CONSTRUCTED-ONLY:${label}`);
}

function decimal(value: string): AlpacaIexDecimal {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new Error('invalid constructed decimal');
  }
  const precision = value.replace('.', '').length;
  const dot = value.indexOf('.');
  const scale = dot < 0 ? 0 : value.length - dot - 1;
  if (value.length > 40 || precision > 38 || scale > 18) {
    throw new Error('constructed decimal exceeds source bounds');
  }
  return { value, precision, scale };
}

function priceForOrdinal(ordinal: number): AlpacaIexDecimal {
  const cents = String(10000 + ordinal);
  return decimal(`${cents.slice(0, -2)}.${cents.slice(-2)}`);
}

/** Fixed epoch arithmetic only: no current-time observation. */
function timestampAt(ordinal: number, offsetMs: number): string {
  const fixedEpoch = Date.UTC(2025, 0, 1);
  return new Date(fixedEpoch + ordinal * 86400000 + offsetMs).toISOString();
}

/**
 * Source-defined calendar digest, copied field-for-field from the supplied
 * current Alpaca contract. Not the byte-review numeric formatter.
 */
function calendarDigest(
  symbol: string,
  sessions: AlpacaSessionCalendar['sessions'],
): string {
  return sha256(JSON.stringify({
    symbol,
    sessions: sessions.map(session => ({
      providerTimestamp: session.providerTimestamp,
      sessionOrdinal: session.sessionOrdinal,
      closedAt: session.closedAt,
      completedAt: session.completedAt,
      completed: session.completed,
      completionEvidenceSha256: session.completionEvidenceSha256,
    })),
  }));
}

function wireBar(row: ConstructedRow): ProposedWireBar {
  return {
    t: row.providerTimestamp,
    o: row.close.value,
    h: row.close.value,
    l: row.close.value,
    c: row.close.value,
    v: '1000',
    n: '10',
    vw: row.close.value,
  };
}

/**
 * Emit literal positive decimal tokens without converting prices to Number.
 * The companion integration test verifies the exact raw parser keys.
 */
export function renderProposedBar(bar: ProposedWireBar): string {
  for (const value of [
    bar.o, bar.h, bar.l, bar.c, bar.v, bar.n, bar.vw,
  ]) {
    decimal(value);
  }
  return (
    `{"t":${JSON.stringify(bar.t)},` +
    `"o":${bar.o},"h":${bar.h},"l":${bar.l},"c":${bar.c},` +
    `"v":${bar.v},"n":${bar.n},"vw":${bar.vw}}`
  );
}

export function renderProposedBody(
  rows: readonly ProposedWireBar[],
  outputCursor: string | null,
): string {
  return (
    `{"bars":{"SPY":[${rows.map(renderProposedBar).join(',')}]},"next_page_token":` +
    `${JSON.stringify(outputCursor)}}`
  );
}

/**
 * Fresh, deterministic, intentionally mutable fixture graphs on every call.
 * Never substitute any returned object for a connector-issued original.
 */
export function makeConstructedAlpacaByteReviewFixture():
ConstructedAlpacaByteReviewFixture {
  const rowsAscending: ConstructedRow[] = Array.from(
    { length: 253 },
    (_, ordinal) => ({
      providerTimestamp: timestampAt(ordinal, 0),
      sessionOrdinal: ordinal,
      closedAt: timestampAt(ordinal, 21 * 3600000),
      completedAt: timestampAt(ordinal, 21 * 3600000 + 60000),
      availableAt: timestampAt(ordinal, 21 * 3600000 + 120000),
      close: priceForOrdinal(ordinal),
    }),
  );

  const sessions: AlpacaSessionCalendar['sessions'] = rowsAscending.map(row => ({
    providerTimestamp: row.providerTimestamp,
    sessionOrdinal: row.sessionOrdinal,
    closedAt: row.closedAt,
    completedAt: row.completedAt,
    completed: true,
    completionEvidenceSha256: evidenceHash(`completion:${row.sessionOrdinal}`),
  }));

  const calendar: AlpacaSessionCalendar = {
    symbol: 'SPY',
    sha256: calendarDigest('SPY', sessions),
    sessions,
  };

  const availability: AlpacaAvailability[] = rowsAscending.map(row => ({
    providerTimestamp: row.providerTimestamp,
    availableAt: row.availableAt,
    evidenceSha256: evidenceHash(`availability:${row.sessionOrdinal}`),
  }));

  const request: AlpacaIexRequest = {
    enabled: true,
    symbol: 'SPY',
    feed: 'iex',
    adjustment: 'raw',
    start: FIXTURE_TIMES.firstProviderTimestamp,
    end: FIXTURE_TIMES.lastProviderTimestamp,
    calendar,
    asof: '2025-09-11',
  };

  const observationsAscending = rowsAscending.map(row => ({
    providerTimestamp: row.providerTimestamp,
    close: { ...row.close },
  }));
  const observationsDescending = [...observationsAscending].reverse().map(row => ({
    providerTimestamp: row.providerTimestamp,
    close: { ...row.close },
  }));
  const descending = [...rowsAscending].reverse();

  const plans = [
    {
      page: 1,
      from: 0,
      to: 100,
      limit: 100,
      inputCursor: null,
      outputCursor: 'constructed-page-cursor-A',
    },
    {
      page: 2,
      from: 100,
      to: 200,
      limit: 100,
      inputCursor: 'constructed-page-cursor-A',
      outputCursor: 'constructed-page-cursor-B',
    },
    {
      page: 3,
      from: 200,
      to: 253,
      limit: 53,
      inputCursor: 'constructed-page-cursor-B',
      outputCursor: null,
    },
  ];

  const responses: ConstructedResponse[] = plans.map(plan => {
    const rows = descending.slice(plan.from, plan.to).map(wireBar);
    const bodyText = renderProposedBody(rows, plan.outputCursor);
    const byteLength = Buffer.byteLength(bodyText, 'utf8');
    if (byteLength < 1 || byteLength > FIXTURE_LIMITS.pageBytes) {
      throw new Error('constructed page exceeds source bounds');
    }
    return {
      page: plan.page,
      requestedLimit: plan.limit,
      inputCursor: plan.inputCursor,
      outputCursor: plan.outputCursor,
      rowCount: rows.length,
      rows,
      bodyText,
      rawPage: {
        page: plan.page,
        byteLength,
        sha256: sha256(bodyText),
        bodyBase64: Buffer.from(bodyText, 'utf8').toString('base64'),
      },
    };
  });

  const proposedRequestEvidence: AlpacaIexRequestEvidence = {
    symbol: 'SPY',
    feed: 'iex',
    adjustment: 'raw',
    start: request.start,
    end: request.end,
    asof: request.asof,
    timeframe: '1Day',
    currency: 'USD',
    sort: 'desc',
    pageRequests: plans.map(plan => ({
      page: plan.page,
      limit: plan.limit,
      pageTokenSha256:
        plan.inputCursor === null ? null : sha256(plan.inputCursor),
    })),
  };

  const positiveDecimals = {
    one: decimal('1'),
    exposureCap: decimal('0.50'),
    commissionPerTrade: decimal('0.01'),
    spreadFraction: decimal('0.001'),
    slippageFraction: decimal('0.001'),
  };

  const proposedShadowInput: ProposedShadowInput = {
    schema: 'gelt.shadow-rule-input.v1',
    ruleId: 'gelt-long-cash-sign-return-252.v1',
    runId: FIXTURE_IDS.runId,
    sourceCommit: SOURCE_PINS.snapshotCommit,
    decisionAt: FIXTURE_TIMES.decisionAt,
    instrument: {
      id: 'SPY',
      currency: 'USD',
      calendarSha256: calendar.sha256,
    },
    data: {
      classification: 'market_shadow_input',
      eligibility: 'unverified',
      datasetSha256: evidenceHash('dataset'),
      rightsEvidenceSha256: evidenceHash('rights-declaration'),
      pointInTimeEvidenceSha256: evidenceHash('point-in-time-declaration'),
    },
    policy: {
      scheduleSha256: evidenceHash('schedule'),
      maxAgeMs: 86400000,
      exposureCap: { ...positiveDecimals.exposureCap },
    },
    costs: {
      status: 'unverified',
      evidenceSha256: evidenceHash('costs-declaration'),
      stressScenarioSha256: evidenceHash('stress-declaration'),
      commissionPerTrade: { ...positiveDecimals.commissionPerTrade },
      spreadFraction: { ...positiveDecimals.spreadFraction },
      slippageFraction: { ...positiveDecimals.slippageFraction },
    },
    controls: {
      passiveSha256: evidenceHash('passive-declaration'),
      cashAssumptionSha256: evidenceHash('cash-declaration'),
    },
    portfolio: {
      state: 'settled',
      snapshotSha256: evidenceHash('portfolio-declaration'),
    },
    bars: rowsAscending.map(row => ({
      sessionOrdinal: row.sessionOrdinal,
      closedAt: row.closedAt,
      availableAt: row.availableAt,
      adjustedClose: { ...row.close },
    })),
  };

  return {
    notice: CONSTRUCTED_NOTICE,
    symbol: 'SPY',
    rowCount: 253,
    rowsAscending,
    observationsAscending,
    observationsDescending,
    calendar,
    availability,
    request,
    proposedRequestEvidence,
    responses,
    receiptPlan: {
      proposedReceivedAt: FIXTURE_TIMES.proposedReceivedAt,
      decisionAt: FIXTURE_TIMES.decisionAt,
      proposedStartedAt: FIXTURE_TIMES.proposedStartedAt,
      proposedCompletedAt: FIXTURE_TIMES.proposedCompletedAt,
      proposedDeadlineAt: FIXTURE_TIMES.proposedDeadlineAt,
      actualReceiptMustComeFromConnector: true,
      actualElapsedEvidenceMustComeFromHarness: true,
    },
    positiveDecimals,
    proposedShadowInput,
    candidateContextProjection: {
      status: 'not_supplied',
      source: 'proposedShadowInput',
      exactOuterAdapterShapeRequiredBeforeIntegration: true,
    },
    admission: {
      operationalAdoption: 'DEFER',
      productionRightsEstablished: false,
      producerEstablished: false,
      reviewerAdmitted: false,
      closureEstablished: false,
      connectorIssuedObjectIncluded: false,
      candidateCanonicalInputIncluded: false,
      candidateReceiptIncluded: false,
      candidateManifestIncluded: false,
    },
  };
}

/**
 * Accepted normative examples only. Negative zero is encoded as a descriptor
 * because ordinary JSON cannot preserve its sign.
 */
export const NORMATIVE_NUMERIC_GOLDENS = [
  { input: 'positive-zero', expected: '0', disposition: 'accept' },
  { input: 'negative-zero', expected: null, disposition: 'reject' },
  { input: '100', expected: '100', disposition: 'accept' },
  { input: '1000', expected: '1e3', disposition: 'accept' },
  { input: '0.01', expected: '0.01', disposition: 'accept' },
  { input: '0.001', expected: '1e-3', disposition: 'accept' },
  { input: '-100', expected: '-100', disposition: 'accept' },
] as const;

/**
 * Independently reasoned candidates; not accepted goldens.
 * No number formatter or conversion algorithm is implemented here.
 */
export const PROPOSED_NUMERIC_EDGE_CANDIDATES = [
  {
    exactBinary64: '2^-1074',
    proposedRepresentation: '3e-324',
    status: 'PROPOSED',
    reasoning:
      '3 through 7 times 10^-324 lie in the minimum-subnormal rounding ' +
      'interval; their equal-length spellings favor lexical 3.',
  },
  {
    exactBinary64: '9007199254740994',
    proposedRepresentation: '9007199254740994',
    status: 'PROPOSED',
    reasoning:
      'The odd significand excludes midpoint integers 9007199254740993 ' +
      'and 9007199254740995; the intervening integer is the candidate.',
  },
  {
    exactBinary64: '9007199254740996',
    proposedRepresentation: '9007199254740995',
    status: 'PROPOSED',
    reasoning:
      'The even significand includes both midpoint integers 9007199254740995 ' +
      'and 9007199254740997; equal-length fixed candidates favor the former.',
  },
] as const;
