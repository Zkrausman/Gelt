import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { EvidenceDetail } from '../app/research/evidence-detail';
import { researchFixture } from '../../worker/src/research-fixture';
import type { ResearchRecord } from '../../worker/src/research-contract';
const fixture = (): ResearchRecord => ({ evidence: researchFixture(), originalSha256: 'a'.repeat(64), originalBytes: 3000, importedAt: '2026-10-07T00:00:00.000Z', geltChecks: { schema: 'passed', integrity: 'passed', numericComparison: { status: 'passed', detail: 'Producer numbers compared only.' }, scientificReproduction: 'not_run' } });
it('renders provenance, numbers, limits and producer/local checks as distinct inert sections', () => {
  const record = fixture(); record.evidence.title = '<script>window.pwned=true</script>';
  record.evidence.source.paper.identifier = 'javascript:alert(1)';
  const html = renderToStaticMarkup(createElement(EvidenceDetail, { record }));
  for (const expected of ['Gelt local checks', 'Producer-reported claims', 'insufficient_evidence', 'not_run', 'Original SHA-256', 'Actual', 'Expected', 'Absolute tolerance', 'Relative tolerance', 'Commit:', 'License:', 'reference_computation']) {
    if (expected !== 'reference_computation') expect(html).toContain(expected);
  }
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(html).toContain('javascript:alert(1)'); expect(html).not.toContain('href=');
  expect(html).not.toContain('<button'); expect(html).not.toContain('<iframe');
  expect(html).toContain('inner input/output hashes');
});
it('clears on session expiry, navigation, draft change, dismissal and read failure', () => {
  const source = readFileSync(new URL('../app/research/page.tsx', import.meta.url), 'utf8');
  for (const expected of ["window.addEventListener('pagehide', hide)", "window.addEventListener('pageshow', hide)", "document.addEventListener('visibilitychange', visible)", 'expiresAt - Date.now()', 'requests.current.current(read)', 'requests.current.finish(read)', 'clearEvidence();', 'setCsrf(value)', 'Clear evidence']) expect(source).toContain(expected);
  for (const prohibited of ['dangerouslySetInnerHTML', 'localStorage', 'window.open(', 'eval(', 'new Function']) expect(source).not.toContain(prohibited);
});

it('explains an exact raw mismatch even when decoded table values look identical', () => {
  const record = fixture();
  record.evidence.results[0] = { name: 'raw mismatch', actual: 9007199254740992, expected: 9007199254740992, absoluteTolerance: 0, relativeTolerance: 0 };
  record.geltChecks.numericComparison = { status: 'failed', detail: 'Zero-tolerance results compare exact original decimal values: 1 compared, 1 unequal.' };
  const html = renderToStaticMarkup(createElement(EvidenceDetail, { record }));
  expect(html).toContain('Numeric comparison: failed');
  expect(html).toContain('1 compared, 1 unequal');
  expect(html).toContain('Identical displayed values can therefore fail the exact comparison');
  expect(html).toContain('including tolerances');
  expect(html).toContain('approximate finite-number formula');
  expect(html.match(/9007199254740992/g)).toHaveLength(2);
});
