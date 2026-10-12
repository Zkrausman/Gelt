// Explicit synthetic contract fixture for tests, never production evidence.
import type { ResearchEvidence } from './research-contract.js';
export function researchFixture(): ResearchEvidence {
  const citation = { title: 'Synthetic test citation', identifier: 'synthetic-test-only', license: 'CC0-1.0' };
  return {
    schema: 'gelt.research-evidence.v1', kind: 'reference_computation', evidenceId: 'synthetic-reference-test',
    title: 'Synthetic contract test, not scientific evidence', createdAt: '2026-10-07T00:00:00.000Z',
    source: { paper: citation, code: { ...citation, commit: 'a'.repeat(40) }, paper2agent: { ...citation, commit: 'b'.repeat(40) } },
    inputs: [{ name: 'x', values: [1, 2], units: 'unitless' }],
    dependencyLock: { sha256: 'c'.repeat(64), packages: [{ name: 'synthetic', version: '1' }] },
    results: [{ name: 'sum', actual: 3, expected: 3, absoluteTolerance: 0, relativeTolerance: 0 }],
    provenance: { adapterVersion: 'test', runtime: 'test', seed: 0, inputSha256: 'd'.repeat(64), outputSha256: 'e'.repeat(64), data: [citation], assumptions: ['Synthetic input for contract tests.'] },
    producerClaims: { reference: { status: 'passed', detail: 'Fixture only' }, mcp: { status: 'not_run', detail: 'Fixture only' }, reproduction: { status: 'not_run', detail: 'Fixture only' }, historical: { status: 'not_run', detail: 'Not financial evidence' }, shadow: { status: 'not_run', detail: 'Not financial evidence' }, costs: { status: 'not_run', detail: 'Not financial evidence' } },
    limitations: ['Synthetic fixture does not demonstrate a scientific computation.'],
    recommendation: { decision: 'insufficient_evidence', promotionAllowed: false, reasons: ['No trading evaluation.'] },
  };
}
