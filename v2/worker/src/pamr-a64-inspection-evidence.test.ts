import { afterEach, expect, it, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { executeA64InspectionCommand } from './a64-inspection-command.js';
import { runA64InspectionCLI } from './a64-inspection-cli.js';
import { executePAMRProposalCommand, pamrProposalCommand } from './pamr-proposal-command.js';
import { canonical, digest } from './ledger-canonical.js';
import { checkIds } from './alpaca-byte-review-contract.js';
import {
  pamrRecipe,
  parsePAMRRequest,
  spy253PAMRInspectionRequestSchema,
} from './paper-conversion-contract.js';
import {
  replaySpy253PAMRInspectionRequest,
  spy253InspectionOriginalSha256,
  verifyPAMRArtifact,
  verifySpy253PAMRInspectionData,
  type Spy253PAMRInspectionArtifact,
} from './pamr-reference-artifact.js';
import { derivePAMRConsumerPrefix } from './pamr-consumer-adapter.js';
import {
  a64InspectionEvidenceContextSchema,
  a64InspectionEvidenceHolds,
  a64InspectionEvidenceLimits,
  a64InspectionEvidenceReasons,
  a64InspectionHistory,
  a64InspectionInheritedDisclosures,
  a64InspectionUnknownFacts,
  parseA64InspectionEvidenceAssessment,
  type A64InspectionEvidenceAssessmentV1,
} from './pamr-a64-inspection-evidence-contract.js';
import {
  assessA64InspectionEvidence,
  matchesA64InspectionEvidenceAssessment,
} from './pamr-a64-inspection-evidence.js';

const h = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const receivedAt = '2026-10-28T12:59:30.000Z';
const sourceDecisionAt = '2026-10-28T13:00:00.000Z';
const completedAt = '2026-10-28T12:59:31.000Z';
const proposedCase = {
  id: 'GELT-PAMR-A64-EVIDENCE-001',
  revision: 'proposal-2',
} as const;
const epoch = 'SYNTHETIC-PRIVATE-CONTEXT-SENTINEL';

const hash = (domain: string, value: unknown) => digest(canonical({
  domain: 'gelt.pamr-a64-inspection-evidence.v1/' + domain,
  value,
}));
const copy = (value: unknown): any => JSON.parse(canonical(value));
const decimal = (value: string) => ({
  value,
  precision: value.replace('.', '').length,
  scale: value.split('.')[1]?.length ?? 0,
});
const pack = (artifact: unknown, context: unknown): string => canonical({
  schema: 'gelt.pamr-a64-inspection-evidence-input.v1',
  artifactText: canonical(artifact),
  contextText: canonical(context),
});

function replay(request: unknown): Spy253PAMRInspectionArtifact {
  const result = replaySpy253PAMRInspectionRequest(canonical(request));
  expect(result.status).toBe('computed_data');
  if (result.status !== 'computed_data') throw new Error('synthetic replay rejected');
  return result.artifact;
}

function sourceProfile(artifact: Spy253PAMRInspectionArtifact) {
  return {
    inspectorRevision: 'gelt.spy253-source-inspector.v1',
    requestSchema: 'gelt.spy253-pamr-inspection-request.v1',
    artifactSchema: 'gelt.spy253-pamr-inert-inspection.v1',
    classification: 'source_inspection_only',
    sourceRequest: artifact.request.lineage.request,
    mathematicalProfile: pamrRecipe.profile,
    selection: a64InspectionHistory.selection,
    initialization: a64InspectionHistory.initialization,
  };
}

// Test-side assembly from complete replay output, not a production builder.
// Synthetic declared hashes, calendar ordinals and check vectors do NOT establish
// a real 253-close acquisition, calendar, issuance, private completion or rights.
function contextFor(artifact: Spy253PAMRInspectionArtifact) {
  const request = artifact.request;
  const lineage = request.lineage;
  const schema = 'gelt.pamr-a64-inspection-evidence-context.v1';
  const purpose = 'evidence_only_no_operational_admission';
  return a64InspectionEvidenceContextSchema.parse({
    schema,
    version: 1,
    classification: 'source_inspection_only',
    purpose,
    case: proposedCase,
    proposedEpochId: epoch,
    sourceProfile: sourceProfile(artifact),
    history: a64InspectionHistory,
    bindings: {
      caseEpochSha256: hash('case-epoch', {
        schema, case: proposedCase, proposedEpochId: epoch, purpose,
      }),
      sourceProfileSha256: hash('source-profile', sourceProfile(artifact)),
      historySha256: hash('history', {
        history: a64InspectionHistory,
        selected: request.selected,
        pairs: artifact.pairs,
      }),
      sourceRequestSha256: hash('source-request', lineage.request),
      inspectionRequestSha256: hash('inspection-request', request),
      calendarSha256: hash('calendar-reference', {
        sourceCalendarSha256: lineage.calendarSha256,
      }),
      declarationsSha256: hash('declarations', {
        declarationsSha256: lineage.declarationsSha256,
        availabilitySha256: lineage.availabilitySha256,
        providerRevisionsSha256: lineage.providerRevisionsSha256,
        declaredPrefixAvailableAt: lineage.declaredPrefixAvailableAt,
        selected: request.selected.map(selected => ({
          sourceIndex: selected.sourceIndex,
          sessionOrdinal: selected.sessionOrdinal,
          providerTimestamp: selected.providerTimestamp,
          declaredAvailableAt: selected.declaredAvailableAt,
        })),
      }),
      originalSha256: hash('original-lineage-data', lineage),
      selectedPairsSha256: hash('selected-pairs', {
        selected: request.selected,
        pairs: artifact.pairs,
      }),
      recipeSha256: hash('recipe-adaptation', {
        recipe: artifact.recipe,
        assets: request.assets,
        selection: request.selection,
        initialization: artifact.initialization,
        reserveConvention: artifact.reserveConvention,
        fidelity: artifact.fidelity,
      }),
      artifactSha256: hash('artifact', artifact),
    },
    timing: {
      schema: 'gelt.pamr-a64-prospective-timing-proposal.v1',
      sourceReceivedAt: lineage.receivedAt,
      sourceDecisionAt: lineage.decisionAt,
      sourceReviewCompletedAt: lineage.review.completedAt,
      sourceDeclaredPrefixAvailableAt: lineage.declaredPrefixAvailableAt,
      proposedAssessmentAt: '2026-10-29T14:00:00.000Z',
      proposedDecisionAt: '2026-10-29T14:01:00.000Z',
      proposedEvaluationAt: '2026-10-29T14:02:00.000Z',
      assertedCompleteInputAvailableAt: null,
    },
    facts: a64InspectionUnknownFacts,
  });
}

function fixture(declaredAvailability: string | null = null) {
  const lineageWithoutOriginal = {
    allObservationsSha256: h,
    request: {
      symbol: 'SPY', feed: 'iex', adjustment: 'all',
      start: '2025-10-24T04:00:00.000Z',
      end: '2026-10-27T04:00:00.000Z',
      asof: '2026-10-27',
      timeframe: '1Day', currency: 'USD', sort: 'desc',
      pageRequests: [
        { page: 1, limit: 100, pageTokenSha256: null },
        { page: 2, limit: 100, pageTokenSha256: h },
        { page: 3, limit: 53, pageTokenSha256: h },
      ],
    },
    pages: [1, 2, 3].map(page => ({ page, byteLength: 1, sha256: h })),
    calendarSha256: h,
    declarationsSha256: h,
    availabilitySha256: declaredAvailability === null ? null : h,
    providerRevisionsSha256: h,
    receivedAt,
    decisionAt: sourceDecisionAt,
    declaredPrefixAvailableAt: declaredAvailability,
    review: {
      schema: 'gelt.review-before-discard-verdict.v1',
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationId: '00000000-0000-4000-8000-000000000002',
      revisions: {
        contract: 1, consumer: '1.1',
        sourceClosure: 'synthetic.unadmitted.v1',
        request: 'synthetic.unadmitted.v1',
        policy: 'synthetic.unadmitted.v1',
        calendar: 'synthetic.unadmitted.v1',
        availability: 'synthetic.unadmitted.v1',
        candidate: 'synthetic.unadmitted.v1',
        reviewer: 'synthetic.unadmitted.v1',
        verdictPolicy: 'synthetic.unadmitted.v1',
      },
      reviewerRevision: 'gelt.spy253-source-inspector.v1',
      authorityId: 'spy253.inspection.no-market-authority.v1',
      bindingSha256: h,
      completedAt,
      elapsedMs: 1000,
      outcome: 'incomplete',
      checks: checkIds.map((id, i) => ({
        id,
        result: i < 6 || i === 15 ? 'pass' : 'unknown',
        reason: i < 6 || i === 15 ? 'none' : 'evidence_missing',
      })),
    },
  };

  // Only the supplied pure schema and mathematical DATA replay are invoked.
  const request = spy253PAMRInspectionRequestSchema.parse({
    schema: 'gelt.spy253-pamr-inspection-request.v1',
    classification: 'source_inspection_only',
    recipe: pamrRecipe,
    assets: ['SPY-CLOSE-RELATIVE', 'DECLARED-UNIT-RESERVE'],
    rows: Array.from({ length: 64 }, () => ['1', '1']),
    selection: a64InspectionHistory.selection,
    initialization: a64InspectionHistory.initialization,
    discardedCount: 188,
    selected: Array.from({ length: 65 }, (_, i) => ({
      sourceIndex: 64 - i,
      sessionOrdinal: 189 + i,
      providerTimestamp: new Date(
        Date.parse('2026-08-01T04:00:00.000Z') + i * 86400000,
      ).toISOString(),
      declaredAvailableAt: declaredAvailability,
      close: decimal('2'),
    })),
    lineage: {
      ...lineageWithoutOriginal,
      originalSha256: spy253InspectionOriginalSha256(
        lineageWithoutOriginal as Parameters<typeof spy253InspectionOriginalSha256>[0],
      ),
    },
  });
  const artifact = replay(request);
  const context = contextFor(artifact);
  return { artifact, context, text: pack(artifact, context) };
}

function assessed(text: unknown): A64InspectionEvidenceAssessmentV1 {
  const result = assessA64InspectionEvidence(text);
  expect(result.status).toBe('assessed_data');
  if (result.status !== 'assessed_data') throw new Error('expected data assessment');
  return result.value;
}

function rejected(text: unknown, reason?: string) {
  const result = assessA64InspectionEvidence(text);
  expect(result.status).toBe('rejected');
  if (result.status === 'rejected') {
    if (reason) expect(result.reason).toBe(reason);
    expect(Object.keys(result).sort()).toEqual(['reason', 'status']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Buffer.byteLength(canonical(result))).toBeLessThan(128);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('assesses complete historical DATA and preserves all holds, checks and disclosures', () => {
  const f = fixture();
  expect(verifySpy253PAMRInspectionData(canonical(f.artifact)).status)
    .toBe('verified_data');
  const result = assessed(f.text);
  expect(result).toMatchObject(a64InspectionEvidenceHolds);
  expect(result.history).toEqual(a64InspectionHistory);
  expect(result.facts).toEqual(a64InspectionUnknownFacts);
  expect(result.inheritedDisclosures).toEqual(a64InspectionInheritedDisclosures);
  expect(result.inheritedChecks).toEqual(f.artifact.request.lineage.review.checks);
  expect(result.inheritedChecks.map(check => check.id)).toEqual(checkIds);
  expect(result.inheritedChecks.map(check => check.result)).toEqual([
    ...Array(6).fill('pass'), ...Array(9).fill('unknown'), 'pass',
  ]);
  expect(result.checkInterpretation)
    .toBe('serialized_structure_not_current_private_validation');
  expect(result.unresolvedReasons).toEqual(a64InspectionEvidenceReasons);
  expect(result.sourceDeclaredAvailability).toBe('unknown');
  expect(result.proposedAvailability).toBe('unknown');
  expect(Buffer.byteLength(canonical(result))).toBeLessThanOrEqual(8192);
  expect(result.bindings.artifactSha256).toBe(hash('artifact', f.artifact));
  expect(result.bindings.selectedPairsSha256).toBe(hash('selected-pairs', {
    selected: f.artifact.request.selected, pairs: f.artifact.pairs,
  }));
});

it('keeps declared historical equality and proposed assertions non-authentic and NOT_READY', () => {
  const f = fixture(sourceDecisionAt);
  const unknown = assessed(f.text);
  expect(unknown.sourceDeclaredAvailability).toBe('declared_only_not_authenticated');
  const c = copy(f.context);
  c.timing.assertedCompleteInputAvailableAt = c.timing.proposedAssessmentAt;
  const declared = assessed(pack(f.artifact, c));
  expect(declared.proposedAvailability).toBe('declared_only_not_authenticated');
  expect(declared.facts.causalAvailability).toBe('unknown');
  expect(declared.prospectiveReadiness).toBe('NOT_READY');
  expect(declared.C07).toBe('UNKNOWN');
  expect(declared.C13).toBe('UNKNOWN');
  expect(declared.C14).toBe('UNKNOWN');
});

it('allows equal proposed decision/evaluation but rejects availability equality/later and inversions', () => {
  const f = fixture();
  const equal = copy(f.context);
  equal.timing.proposedEvaluationAt = equal.timing.proposedDecisionAt;
  expect(assessed(pack(f.artifact, equal)).prospectiveReadiness).toBe('NOT_READY');

  const mutations: ((c: any) => void)[] = [
    c => {
      c.timing.proposedAssessmentAt = c.timing.proposedDecisionAt;
      c.timing.assertedCompleteInputAvailableAt = c.timing.proposedDecisionAt;
    },
    c => {
      c.timing.assertedCompleteInputAvailableAt = '2026-10-29T14:03:00.000Z';
    },
    c => {
      c.timing.proposedAssessmentAt = '2026-10-29T14:02:00.000Z';
    },
    c => {
      c.timing.proposedEvaluationAt = '2026-10-29T14:00:00.000Z';
    },
    c => {
      c.timing.proposedAssessmentAt = '2026-10-28T12:00:00.000Z';
    },
    c => {
      c.timing.assertedCompleteInputAvailableAt = '2026-10-28T12:00:00.000Z';
    },
  ];
  for (const mutate of mutations) {
    const context = copy(f.context);
    mutate(context);
    rejected(pack(f.artifact, context));
  }
});

it('rejects outer source-date substitution and arbitrary future profiles', () => {
  const f = fixture();
  const mutations: ((c: any) => void)[] = [
    c => { c.timing.sourceDecisionAt = '2026-10-28T13:00:00.001Z'; },
    c => { c.timing.sourceReceivedAt = '2026-10-28T12:59:29.000Z'; },
    c => { c.timing.sourceReviewCompletedAt = '2026-10-28T12:59:32.000Z'; },
    c => { c.timing.sourceDeclaredPrefixAvailableAt = sourceDecisionAt; },
    c => { c.sourceProfile.sourceRequest.end = '2027-10-27T04:00:00.000Z'; },
    c => { c.sourceProfile.inspectorRevision = 'future.profile.v2'; },
    c => { c.case.id = 'OTHER-CASE'; },
    c => { c.case.revision = 'accepted'; },
  ];
  for (const mutate of mutations) {
    const context = copy(f.context);
    mutate(context);
    rejected(pack(f.artifact, context));
  }
  const later = copy(f.context);
  later.timing.proposedAssessmentAt = '2027-10-29T14:00:00.000Z';
  later.timing.proposedDecisionAt = '2027-10-29T14:01:00.000Z';
  later.timing.proposedEvaluationAt = '2027-10-29T14:02:00.000Z';
  expect(assessed(pack(f.artifact, later)).prospectiveReadiness).toBe('NOT_READY');
});

it('recomputes every claimed binding and binds the proposed epoch separately', () => {
  const f = fixture();
  for (const key of Object.keys(f.context.bindings)) {
    const context = copy(f.context);
    context.bindings[key] = otherHash;
    rejected(pack(f.artifact, context), 'binding_mismatch');
  }
  const changedEpoch = copy(f.context);
  changedEpoch.proposedEpochId = 'SYNTHETIC-OTHER-EPOCH';
  rejected(pack(f.artifact, changedEpoch), 'binding_mismatch');

  changedEpoch.bindings.caseEpochSha256 = hash('case-epoch', {
    schema: changedEpoch.schema,
    case: changedEpoch.case,
    proposedEpochId: changedEpoch.proposedEpochId,
    purpose: changedEpoch.purpose,
  });
  const result = assessed(pack(f.artifact, changedEpoch));
  expect(result.operationalDecisions).toBe(0);
  expect(result.consumptionAttempts).toBe(0);
  expect(result.prospectiveReadiness).toBe('NOT_READY');
});

it('requires the complete pair set and whole artifact despite rebound summary hashes', () => {
  const f = fixture();
  const mutations: [string, (a: any) => void][] = [
    ['duplicate pair', a => { a.pairs[1] = a.pairs[0]; }],
    ['missing pair', a => { a.pairs.pop(); }],
    ['reordered pair set', a => { a.pairs.reverse(); }],
    ['same-count wrong index', a => { a.pairs[0].laterSourceIndex = 0; }],
    ['pair relative', a => { a.pairs[0].relative = '2'; }],
    ['selected observation', a => { a.request.selected[0].close = decimal('4'); }],
    ['selected ordinal', a => { a.request.selected[0].sessionOrdinal = 190; }],
    ['row', a => { a.request.rows[0][0] = '2'; }],
    ['recipe', a => { a.recipe.epsilon = '0.6'; }],
    ['request recipe', a => { a.request.recipe.epsilon = '0.6'; }],
    ['final weight', a => { a.weightsFinal[0] = '0/1'; }],
    ['trace state', a => { a.steps[0].tau = '1/1'; }],
    ['original identity', a => { a.request.lineage.originalSha256 = otherHash; }],
    ['source request', a => { a.request.lineage.request.adjustment = 'raw'; }],
    ['classification', a => { a.classification = 'constructed_offline_test'; }],
    ['dispatch', a => { a.dispatchAllowed = true; }],
    ['nested legacy', a => { a.legacyArtifact = { schema: 'gelt.pamr-inert-candidate.v1' }; }],
  ];
  for (const [label, mutate] of mutations) {
    const artifact = copy(f.artifact);
    mutate(artifact);
    const context = copy(f.context);
    context.bindings.artifactSha256 = hash('artifact', artifact);
    context.bindings.selectedPairsSha256 = hash('selected-pairs', {
      selected: artifact.request.selected, pairs: artifact.pairs,
    });
    expect(
      assessA64InspectionEvidence(pack(artifact, context)),
      label,
    ).toEqual({ status: 'rejected', reason: 'artifact_mismatch' });
  }
});

it('rejects forged favorable, reordered, missing or contradictory inherited checks', () => {
  const f = fixture();
  const mutations: ((a: any) => void)[] = [
    a => {
      a.request.lineage.review.checks[6] = {
        id: checkIds[6], result: 'pass', reason: 'none',
      };
    },
    a => { a.request.lineage.review.checks.reverse(); },
    a => { a.request.lineage.review.checks.pop(); },
    a => { a.request.lineage.review.outcome = 'consistent_unverified'; },
    a => { a.request.lineage.review.authorityId = 'claimed.market.authority.v1'; },
    a => { a.providerCompletion = 'complete'; },
    a => { a.authentication = 'established'; },
    a => { a.uncertainty = 'clear'; },
  ];
  for (const mutate of mutations) {
    const artifact = copy(f.artifact);
    mutate(artifact);
    rejected(pack(artifact, f.context), 'artifact_mismatch');
  }
  for (const key of Object.keys(a64InspectionUnknownFacts)) {
    const context = copy(f.context);
    context.facts[key] = 'pass';
    rejected(pack(f.artifact, context));
  }
});

it('uses existing whole verification to reject nonterminating and oversized exact ratios', () => {
  const f = fixture();
  for (const [earlier, later] of [
    ['3', '1'],
    ['1', '100000000000000000000000000000000'],
    ['1', '0'],
  ]) {
    const artifact = copy(f.artifact);
    artifact.request.selected[0].close = decimal(earlier);
    artifact.request.selected[1].close = decimal(later);
    // No new ratio implementation, rounding, skipped row or fallback history.
    expect(verifySpy253PAMRInspectionData(canonical(artifact)).status).toBe('rejected');
    rejected(pack(artifact, f.context), 'artifact_mismatch');
  }
});

it('treats self-consistent synthetic identity changes as DATA, never authentic issuance', () => {
  const f = fixture();
  const request = copy(f.artifact.request);
  request.lineage.pages[0].sha256 = otherHash;
  request.lineage.allObservationsSha256 = otherHash;
  const { originalSha256: ignored, ...lineage } = request.lineage;
  void ignored;
  request.lineage.originalSha256 = spy253InspectionOriginalSha256(lineage);
  const artifact = replay(request);
  rejected(pack(artifact, f.context), 'binding_mismatch');

  const result = assessed(pack(artifact, contextFor(artifact)));
  expect(result.facts.actualOriginalIssuance).toBe('unknown');
  expect(result.facts.privateCompletion).toBe('unknown');
  expect(result.facts.currentOriginalValidity).toBe('unknown');
  expect(result.inheritedDisclosures.digestMeaning).toBe('bindings_not_authenticity');
  expect(result).toMatchObject(a64InspectionEvidenceHolds);
});

it('explicitly preserves rejection by all existing constructed extraction routes', () => {
  const f = fixture();
  for (const value of [
    f.artifact,
    f.artifact.request,
    { ...f.artifact, classification: 'constructed_offline_test' },
  ]) {
    const text = canonical(value);
    expect(verifyPAMRArtifact(text).status).toBe('rejected');
    expect(() => parsePAMRRequest(text)).toThrow();
    expect(() => derivePAMRConsumerPrefix(text)).toThrow();
    const proposal = executePAMRProposalCommand(canonical({ schema: pamrProposalCommand.requestSchema, operation: 'propose', inputText: text }));
    expect(proposal.exitCode).toBe(2);
    expect(JSON.parse(proposal.text)).toMatchObject({ effectAuthority: 'none', dispatchAllowed: false, qualification: 'NOT_READY' });
  }
  expect(canonical(f.artifact)).not.toContain('gelt.pamr-inert-candidate.v1');

  for (const extra of [
    { ordinal: 64 },
    { consumptionSequence: 64 },
    { previousManifestSha256: h },
    { predecessors: Array(63).fill(h) },
    { resetStore: true },
    { futureWindowTicket: 'synthetic' },
  ]) {
    rejected(pack(f.artifact, { ...f.context, ...extra }));
  }
});

it('rejects duplicate keys in the aggregate, context and embedded artifact', () => {
  const f = fixture();
  const envelope = {
    schema: 'gelt.pamr-a64-inspection-evidence-input.v1',
    artifactText: canonical(f.artifact),
    contextText: canonical(f.context),
  };
  rejected(canonical(envelope).replace(
    '"schema":', '"schema":"duplicate","schema":',
  ));
  rejected(canonical({
    ...envelope,
    contextText: envelope.contextText.replace(
      '"version":1', '"version":1,"\\u0076ersion":1',
    ),
  }));
  rejected(canonical({
    ...envelope,
    artifactText: envelope.artifactText.replace(
      '"updates":64', '"updates":64,"updates":64',
    ),
  }), 'artifact_mismatch');
});

it('enforces aggregate, artifact, context, depth and node rejection without partial success', () => {
  const f = fixture();
  const envelope = {
    schema: 'gelt.pamr-a64-inspection-evidence-input.v1',
    artifactText: canonical(f.artifact),
    contextText: canonical(f.context),
  };
  const exactAggregate = f.text + ' '.repeat(
    a64InspectionEvidenceLimits.input - Buffer.byteLength(f.text),
  );
  expect(assessed(exactAggregate).prospectiveReadiness).toBe('NOT_READY');
  rejected(exactAggregate + ' ', 'resource_limit');

  const exactArtifact = envelope.artifactText + ' '.repeat(
    a64InspectionEvidenceLimits.artifact - Buffer.byteLength(envelope.artifactText),
  );
  const padded = canonical({ ...envelope, artifactText: exactArtifact });
  expect(Buffer.byteLength(padded)).toBeLessThan(a64InspectionEvidenceLimits.input);
  expect(assessed(padded).dataStatus).toBe('consistent_data_only');
  rejected(canonical({
    ...envelope, artifactText: exactArtifact + ' ',
  }));
  rejected(canonical({
    ...envelope,
    artifactText: '"' + 'é'.repeat(90000) + '"',
  }), 'resource_limit');
  rejected(canonical({
    ...envelope,
    contextText: '"' + 'é'.repeat(4096) + '"',
  }), 'resource_limit');

  rejected('['.repeat(17) + '0' + ']'.repeat(17));
  rejected('[' + Array(20000).fill('0').join(',') + ']');
  rejected(canonical({
    ...envelope,
    artifactText: '['.repeat(17) + '0' + ']'.repeat(17),
  }), 'artifact_mismatch');
  rejected(canonical({
    ...envelope,
    artifactText: '[' + Array(20000).fill('0').join(',') + ']',
  }), 'artifact_mismatch');
  rejected(canonical({
    ...envelope, contextText: '['.repeat(17) + '0' + ']'.repeat(17),
  }));
});

it('bounds assessment round trips and recomputes matches from the entire input', () => {
  const f = fixture();
  const result = assessed(f.text);
  const text = canonical(result);
  expect(parseA64InspectionEvidenceAssessment(text)).toEqual(result);
  expect(matchesA64InspectionEvidenceAssessment(f.text, text)).toBe(true);

  const exact = text + ' '.repeat(8192 - Buffer.byteLength(text));
  expect(parseA64InspectionEvidenceAssessment(exact)).toEqual(result);
  expect(matchesA64InspectionEvidenceAssessment(f.text, exact)).toBe(true);
  expect(() => parseA64InspectionEvidenceAssessment(exact + ' ')).toThrow();
  expect(matchesA64InspectionEvidenceAssessment(f.text, exact + ' ')).toBe(false);

  const changed = copy(result);
  changed.prospectiveReadiness = 'READY';
  expect(matchesA64InspectionEvidenceAssessment(f.text, canonical(changed))).toBe(false);

  const c = copy(f.context);
  c.timing.proposedEvaluationAt = '2026-10-29T14:03:00.000Z';
  const another = assessed(pack(f.artifact, c));
  expect(another.contextSha256).not.toBe(result.contextSha256);
  expect(matchesA64InspectionEvidenceAssessment(
    pack(f.artifact, c), text,
  )).toBe(false);

  const detached = copy(result);
  detached.inputSha256 = otherHash;
  const { assessmentSha256: ignored, ...body } = detached;
  void ignored;
  detached.assessmentSha256 = hash('assessment', body);
  // A self-consistent detached hash still cannot match the actual full input.
  expect(parseA64InspectionEvidenceAssessment(canonical(detached))).toBeDefined();
  expect(matchesA64InspectionEvidenceAssessment(
    f.text, canonical(detached),
  )).toBe(false);
});

it('is repeatable, deeply frozen and independent of current time or provider effects', () => {
  const f = fixture();
  const fetcher = vi.fn(() => { throw new Error('unexpected provider effect'); });
  vi.stubGlobal('fetch', fetcher);
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('unexpected current clock read');
  });
  const first = assessed(f.text);
  for (let i = 0; i < 3; i++) {
    expect(assessed(f.text)).toEqual(first);
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(clock).not.toHaveBeenCalled();
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.bindings)).toBe(true);
  expect(Object.isFrozen(first.inheritedChecks)).toBe(true);
  expect(Object.isFrozen(first.inheritedChecks[0])).toBe(true);
  expect(() => { (first.facts as any).ownerAdmission = 'pass'; }).toThrow();
  expect(first).toMatchObject(a64InspectionEvidenceHolds);
  expect('ordinal' in first).toBe(false);
  expect('previousManifestSha256' in first).toBe(false);
  expect('decisionId' in first).toBe(false);
  expect('proposalId' in first).toBe(false);
});

it('omits raw artifacts, contexts, private identifiers and rejection details', () => {
  const f = fixture();
  const output = canonical(assessed(f.text));
  expect(output).not.toContain(epoch);
  expect(output).not.toContain('00000000-0000-4000-8000-000000000001');
  expect(output).not.toContain('00000000-0000-4000-8000-000000000002');
  expect(output).not.toContain('"artifactText"');
  expect(output).not.toContain('"contextText"');
  expect(output).not.toContain('"selected"');
  expect(output).not.toContain('"steps"');

  const sentinel = '/private/credential/SYNTHETIC_SECRET_SENTINEL';
  for (const input of [
    sentinel,
    canonical({ ...JSON.parse(f.text), credential: sentinel }),
    pack(f.artifact, { ...f.context, privatePath: sentinel }),
    canonical({ ...JSON.parse(f.text), artifactText: sentinel }),
  ]) {
    const result = assessA64InspectionEvidence(input);
    expect(result.status).toBe('rejected');
    expect(canonical(result)).not.toContain(sentinel);
    expect(Buffer.byteLength(canonical(result))).toBeLessThan(128);
  }
});

it('rejects an availability assertion preceding the rebound artifact review completion', () => {
  const f = fixture();
  const request = copy(f.artifact.request);
  request.lineage.review.completedAt = '2026-10-28T13:00:30.000Z';
  const { originalSha256: ignored, ...lineage } = request.lineage;
  void ignored;
  request.lineage.originalSha256 = spy253InspectionOriginalSha256(lineage);
  const artifact = replay(request);
  const context = copy(contextFor(artifact));
  context.timing.assertedCompleteInputAvailableAt = sourceDecisionAt;
  rejected(pack(artifact, context));
  context.timing.assertedCompleteInputAvailableAt = artifact.request.lineage.review.completedAt;
  expect(assessed(pack(artifact, context)).facts.causalAvailability).toBe('unknown');
});

it('exposes the real whole-input assessment through the agent command and stdin transport without authority or raw input', async () => {
  const f = fixture();
  const command = executeA64InspectionCommand(f.text);
  expect(command.exitCode).toBe(0);
  const value = JSON.parse(command.text);
  expect(value.value).toEqual(assessed(f.text));
  expect(value).toMatchObject({ status: 'assessed_data', effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false, qualification: 'NOT_READY', production: 'CLOSED', operations: 'DEFER' });
  expect(value.value).toMatchObject(a64InspectionEvidenceHolds);
  expect(Buffer.byteLength(command.text)).toBeLessThanOrEqual(8192);
  expect(command.text).not.toContain(epoch);
  expect(command.text).not.toContain('artifactText');
  expect(command.text).not.toContain('contextText');
  const chunks: Buffer[] = [], output = new Writable({ write(b, _e, done) { chunks.push(Buffer.from(b)); done(); } });
  const bytes = Buffer.from(f.text);
  expect(await runA64InspectionCLI([], Readable.from([bytes.subarray(0, 17), bytes.subarray(17)]), output)).toBe(0);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(command.text);
  const forged = pack(f.artifact, { ...f.context, bindings: { ...f.context.bindings, artifactSha256: otherHash } });
  expect(executeA64InspectionCommand(forged).exitCode).toBe(2);
  expect(JSON.parse(executeA64InspectionCommand(forged).text)).toMatchObject({ status: 'rejected', reason: 'binding_mismatch', dispatchAllowed: false });
});
