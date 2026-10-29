import { expect, it } from 'vitest';
import { canonical } from './ledger-canonical.js';
import { pamrRecipe } from './paper-conversion-contract.js';
import {
  A64InspectionEvidenceBoundaryError,
  a64InspectionEvidenceContextSchema,
  a64InspectionEvidenceLimits,
  a64InspectionHistory,
  a64InspectionUnknownFacts,
  boundedA64InspectionEvidenceText,
  parseA64InspectionEvidenceContext,
  parseA64InspectionEvidenceInput,
  parseA64InspectionEvidenceText,
} from './pamr-a64-inspection-evidence-contract.js';

const h = 'a'.repeat(64);
const sourceAt = '2026-10-28T13:00:00.000Z';

function context() {
  // Structural contract fixture only; these hashes prove no original exists.
  return {
    schema: 'gelt.pamr-a64-inspection-evidence-context.v1',
    version: 1,
    classification: 'source_inspection_only',
    purpose: 'evidence_only_no_operational_admission',
    case: { id: 'GELT-PAMR-A64-EVIDENCE-001', revision: 'proposal-2' },
    proposedEpochId: 'SYNTHETIC-CONTRACT-ONLY',
    sourceProfile: {
      inspectorRevision: 'gelt.spy253-source-inspector.v1',
      requestSchema: 'gelt.spy253-pamr-inspection-request.v1',
      artifactSchema: 'gelt.spy253-pamr-inert-inspection.v1',
      classification: 'source_inspection_only',
      sourceRequest: {
        symbol: 'SPY', feed: 'iex', adjustment: 'all',
        start: '2025-10-24T04:00:00.000Z',
        end: '2026-10-27T04:00:00.000Z', asof: '2026-10-27',
        timeframe: '1Day', currency: 'USD', sort: 'desc',
        pageRequests: [{ page: 1, limit: 100, pageTokenSha256: null }],
      },
      mathematicalProfile: pamrRecipe.profile,
      selection: a64InspectionHistory.selection,
      initialization: a64InspectionHistory.initialization,
    },
    history: a64InspectionHistory,
    bindings: {
      caseEpochSha256: h, sourceProfileSha256: h, historySha256: h,
      sourceRequestSha256: h, inspectionRequestSha256: h,
      calendarSha256: h, declarationsSha256: h, originalSha256: h,
      selectedPairsSha256: h, recipeSha256: h, artifactSha256: h,
    },
    timing: {
      schema: 'gelt.pamr-a64-prospective-timing-proposal.v1',
      sourceReceivedAt: '2026-10-28T12:59:30.000Z',
      sourceDecisionAt: sourceAt,
      sourceReviewCompletedAt: '2026-10-28T12:59:31.000Z',
      sourceDeclaredPrefixAvailableAt: null,
      proposedAssessmentAt: '2026-10-29T14:00:00.000Z',
      proposedDecisionAt: '2026-10-29T14:01:00.000Z',
      proposedEvaluationAt: '2026-10-29T14:02:00.000Z',
      assertedCompleteInputAvailableAt: null,
    },
    facts: a64InspectionUnknownFacts,
  };
}

function rejection(read: () => unknown, reason?: string) {
  try {
    read();
    throw new Error('expected boundary rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(A64InspectionEvidenceBoundaryError);
    if (error instanceof A64InspectionEvidenceBoundaryError) {
      if (reason) expect(error.reason).toBe(reason);
      expect(error.message).toBe('A64 inspection evidence unavailable');
    }
  }
}

it('parses bounded strict context as structure only, with every unknown explicit', () => {
  const text = canonical(context());
  const parsed = parseA64InspectionEvidenceContext(text);
  expect(parsed.facts).toEqual(a64InspectionUnknownFacts);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.facts)).toBe(true);
  expect(() => {
    (parsed.facts as any).privateCompletion = 'pass';
  }).toThrow();
  expect(Buffer.byteLength(text)).toBeLessThan(a64InspectionEvidenceLimits.context);
});

it.each(Object.keys(a64InspectionUnknownFacts))(
  'rejects missing or favorable factual slot %s',
  key => {
    const missing = JSON.parse(canonical(context()));
    delete missing.facts[key];
    rejection(() => parseA64InspectionEvidenceContext(canonical(missing)));
    const favorable = JSON.parse(canonical(context()));
    favorable.facts[key] = 'pass';
    rejection(() => parseA64InspectionEvidenceContext(canonical(favorable)));
  },
);

it('rejects unsupported identities, unknown fields and invalid timestamp forms', () => {
  const mutations: ((v: any) => void)[] = [
    v => { v.schema = 'gelt.pamr-consumer-input.v1'; },
    v => { v.case.revision = 'accepted'; },
    v => { v.sourceProfile.inspectorRevision = 'future.v2'; },
    v => { v.sourceProfile.sourceRequest.end = '2027-10-27T04:00:00.000Z'; },
    v => { v.sourceProfile.sourceRequest.asof = '2027-10-27'; },
    v => { v.history.historyUpdates = 63; },
    v => { v.ordinal = 64; },
    v => { v.previousManifestSha256 = h; },
    v => { v.authority = 'pass'; },
    v => { v.timing.proposedDecisionAt = '2026-10-29T14:01:00Z'; },
    v => { v.timing.proposedDecisionAt = '2026-02-30T14:01:00.000Z'; },
    v => { v.bindings.artifactSha256 = h + '\n'; },
    v => { v.proposedEpochId = '/private/path'; },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(canonical(context()));
    mutate(value);
    rejection(() => parseA64InspectionEvidenceContext(canonical(value)));
  }
});

it('enforces local proposed timing order without reading a clock', () => {
  const value = JSON.parse(canonical(context()));
  value.timing.proposedEvaluationAt = value.timing.proposedDecisionAt;
  expect(a64InspectionEvidenceContextSchema.safeParse(value).success).toBe(true);
  value.timing.assertedCompleteInputAvailableAt = value.timing.proposedDecisionAt;
  rejection(() => parseA64InspectionEvidenceContext(canonical(value)));
  value.timing.assertedCompleteInputAvailableAt = null;
  value.timing.proposedEvaluationAt = value.timing.proposedAssessmentAt;
  rejection(() => parseA64InspectionEvidenceContext(canonical(value)));
});

it('rejects object coercion and nontext primitives before touching caller properties', () => {
  let touched = false;
  const object = {
    toString() { touched = true; throw new Error('PRIVATE_SENTINEL'); },
  };
  for (const value of [object, new String('{}'), null, false, 1, undefined]) {
    rejection(() => parseA64InspectionEvidenceInput(value), 'invalid_input');
  }
  expect(touched).toBe(false);
});

it.each(['input', 'artifact', 'context', 'assessment'] as const)(
  'enforces exact character and UTF-8 byte ceilings for %s before Buffer allocation',
  kind => {
    const limit = a64InspectionEvidenceLimits[kind];
    const ascii = '"' + 'x'.repeat(limit - 2) + '"';
    expect(boundedA64InspectionEvidenceText(ascii, kind)).toBe(ascii);
    expect(parseA64InspectionEvidenceText(ascii, kind)).toBe('x'.repeat(limit - 2));
    rejection(() => boundedA64InspectionEvidenceText(ascii + ' ', kind), 'resource_limit');

    const utf8 = '"' + 'é'.repeat((limit - 2) / 2) + '"';
    expect(Buffer.byteLength(utf8)).toBe(limit);
    expect(utf8.length).toBeLessThan(limit);
    expect(boundedA64InspectionEvidenceText(utf8, kind)).toBe(utf8);
    rejection(() => boundedA64InspectionEvidenceText(
      '"' + 'é'.repeat(limit / 2) + '"', kind,
    ), 'resource_limit');
  },
);

it('rejects lossy UTF-16 and duplicate keys, including escaped duplicate names', () => {
  for (const text of ['"\ud800"', '"\udc00"', '"\ud800x"']) {
    rejection(() => parseA64InspectionEvidenceText(text, 'input'), 'invalid_input');
  }
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":1}}']) {
    rejection(() => parseA64InspectionEvidenceText(text, 'input'), 'invalid_input');
  }
});

it('retains the existing strict depth and node boundaries', () => {
  expect(parseA64InspectionEvidenceText(
    '['.repeat(16) + '0' + ']'.repeat(16), 'input',
  )).toBeDefined();
  rejection(() => parseA64InspectionEvidenceText(
    '['.repeat(17) + '0' + ']'.repeat(17), 'input',
  ));
  const nodes = '[' + Array(19999).fill('0').join(',') + ']';
  expect((parseA64InspectionEvidenceText(nodes, 'input') as unknown[]).length).toBe(19999);
  rejection(() => parseA64InspectionEvidenceText(
    '[' + Array(20000).fill('0').join(',') + ']', 'input',
  ));
});

it('bounds embedded texts as well as the total aggregate, without a second allowance', () => {
  const input = (artifactText: unknown, contextText: unknown) => canonical({
    schema: 'gelt.pamr-a64-inspection-evidence-input.v1',
    artifactText,
    contextText,
  });
  rejection(() => parseA64InspectionEvidenceInput(input(
    'x'.repeat(a64InspectionEvidenceLimits.artifact + 1), '{}',
  )));
  rejection(() => parseA64InspectionEvidenceInput(input(
    '{}', 'é'.repeat(a64InspectionEvidenceLimits.context / 2 + 1),
  )), 'resource_limit');
  rejection(() => parseA64InspectionEvidenceInput(
    input('{}', '{}') + ' '.repeat(a64InspectionEvidenceLimits.input),
  ), 'resource_limit');

  const validContext = canonical(context());
  const paddedContext = validContext + ' '.repeat(
    a64InspectionEvidenceLimits.context - Buffer.byteLength(validContext),
  );
  expect(parseA64InspectionEvidenceContext(paddedContext).facts)
    .toEqual(a64InspectionUnknownFacts);
  rejection(() => parseA64InspectionEvidenceContext(paddedContext + ' '), 'resource_limit');
});

it('rejects completed review before receipt and complete-input assertions before review', () => {
  const early = JSON.parse(canonical(context()));
  early.timing.sourceReviewCompletedAt = '2026-10-28T12:59:29.000Z';
  rejection(() => parseA64InspectionEvidenceContext(canonical(early)));
  const late = JSON.parse(canonical(context()));
  late.timing.sourceReviewCompletedAt = '2026-10-28T13:00:30.000Z';
  late.timing.assertedCompleteInputAvailableAt = sourceAt;
  rejection(() => parseA64InspectionEvidenceContext(canonical(late)));
  late.timing.assertedCompleteInputAvailableAt = late.timing.sourceReviewCompletedAt;
  expect(parseA64InspectionEvidenceContext(canonical(late)).facts.causalAvailability).toBe('unknown');
});

it('rejects a non-string limit kind without invoking caller coercion', () => {
  let touched = false;
  const kind = { [Symbol.toPrimitive]() { touched = true; return 'input'; } };
  rejection(() => boundedA64InspectionEvidenceText('{}', kind as any), 'invalid_input');
  expect(touched).toBe(false);
});
