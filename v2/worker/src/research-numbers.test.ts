import * as fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseResearchEvidenceJSON } from './research-json.js';
import { researchEvidenceSchema } from './research-contract.js';
import { compareResearchNumbers } from './research-numbers.js';
import { researchFixture } from './research-fixture.js';
import { storageFixture } from './storage-fixture.js';
import { readPrivate, writePrivateNew } from './private-files.js';
import { importResearchFile, listResearch, provisionResearch, readResearch } from './research-store.js';

// Strings are inserted AFTER serialization; no fixture-side binary64 rounding.
function raw(id: string, actual: string, expected: string, absolute = '0', relative = '0') {
  return Buffer.from(JSON.stringify({ ...researchFixture(), evidenceId: id, results: '__RAW__' }).replace('"__RAW__"',
    `[{"name":"synthetic-precision","actual":${actual},"expected":${expected},"absoluteTolerance":${absolute},"relativeTolerance":${relative}}]`) + '\n');
}
function compare(bytes: Buffer) {
  const parsed = parseResearchEvidenceJSON(bytes);
  return compareResearchNumbers(researchEvidenceSchema.parse(parsed.value).results, parsed.numbers);
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const cases = [
  ['equal', '3', '3', '0', '0', 'passed'],
  ['safe-mismatch', '3', '4', '0', '0', 'failed'],
  ['large-integer-collision', '9007199254740992', '9007199254740993', '0', '0', 'failed'],
  ['large-integer-distinct', '9007199254740992', '9007199254740994', '0', '0', 'failed'],
  ['decimal-collision', '1', '1.0000000000000001', '0', '0', 'failed'],
  ['decimal-distinct', '1', '1.0000000000000002', '0', '0', 'failed'],
  ['fraction-collision', '0.1', '0.10000000000000001', '0', '0', 'failed'],
  ['exponent-equivalent', '1e3', '1000.0', '0', '0', 'passed'],
  ['exponent-collision', '9.007199254740992e15', '9.007199254740993e15', '0', '0', 'failed'],
  ['underflow', '1e-400', '0', '0', '0', 'failed'],
  ['signed-zero', '-0', '0', '0', '0', 'passed'],
  ['absolute-tight', '9007199254740992', '9007199254740993', '0.5', '0', 'passed'],
  ['absolute-sufficient', '9007199254740992', '9007199254740993', '1', '0', 'passed'],
  ['relative-tight', '9007199254740992', '9007199254740993', '0', '1e-17', 'passed'],
  ['relative-sufficient', '9007199254740992', '9007199254740993', '0', '1e-15', 'passed'],
  ['tolerance-boundary', '0.3', '0.2', '0.09999999999999999', '0', 'passed'],
  ['overflow-intermediate', '-1e308', '1e308', '0', '1e308', 'failed'],
  ['zero-tolerance-spellings', '1', '1.0000000000000001', '-0.000e+000010', '0e-100000', 'failed'],
  ['nonzero-underflow-tolerance', '1', '1.0000000000000001', '1e-400', '0', 'passed'],
  ['nonzero-underflow-relative', '1', '1.0000000000000001', '0', '1e-400', 'passed'],
  ['negative-equivalent', '-1.200e+2', '-120.00', '0', '0', 'passed'],
  ['coefficient-shift', '12300e-2', '1.23e2', '0', '0', 'passed'],
] as const;
const roots: string[] = [];
let root: string, source: string;
beforeAll(() => {
  for (let i = 0; i < 7; i++) roots.push(storageFixture('research-precision-'));
  [root, source] = roots;
  provisionResearch(root, roots.slice(2));
});
afterAll(() => { for (const path of roots) fs.rmSync(path, { recursive: true, force: true }); });

it.each(cases)('compares raw numeric case %s', (id, actual, expected, absolute, relative, status) => {
  const result = compare(raw(id, actual, expected, absolute, relative));
  expect(result.status).toBe(status);
  if (id.startsWith('nonzero-underflow')) expect(result.detail).toContain('formula: 1 compared');
});

it('imports and rereads representative raw numeric evidence without changing its envelope', () => {
  const integrationCases = [
    ['large-integer-collision', '9007199254740992', '9007199254740993', '0', '0', 'failed'],
    ['absolute-sufficient', '9007199254740992', '9007199254740993', '1', '0', 'passed'],
  ] as const;
  for (const [id, actual, expected, absolute, relative, status] of integrationCases) {
    const bytes = raw(id, actual, expected, absolute, relative), path = join(source, `${id}.json`);
    writePrivateNew(path, bytes);
    const imported = importResearchFile(root, path);
    expect(imported.record.geltChecks.numericComparison.status).toBe(status);
    expect(readResearch(root, id)).toEqual({ state: 'available', record: imported.record });
    expect(importResearchFile(root, path).status).toBe('identical');
    expect(imported.record.originalSha256).toBe(hash(bytes));
    expect(imported.record.originalBytes).toBe(bytes.length);
    expect(imported.record.evidence.provenance).toEqual(researchFixture().provenance);
    expect(imported.record.geltChecks.scientificReproduction).toBe('not_run');
    expect(imported.record.evidence.recommendation.promotionAllowed).toBe(false);
    const envelope = JSON.parse(readPrivate(join(root, `evidence-${id}.json`), 90000).toString());
    expect(Buffer.from(envelope.originalBase64, 'base64')).toEqual(bytes);
    if (id === 'absolute-sufficient') expect(imported.record.geltChecks.numericComparison.detail).toContain('Nonzero-tolerance results use the approximate finite-number formula: 1 compared, 0 failed.');
    if (id === 'large-integer-collision') {
      const result = imported.record.evidence.results[0];
      expect(result.actual).toBe(result.expected);
      expect(imported.record.geltChecks.numericComparison.detail).toContain('1 compared, 1 unequal');
      expect(imported.record.geltChecks.numericComparison.detail).toContain('identical displayed numbers can differ');
    }
  }
});

it('revalidates legacy envelopes without changing bytes or promoting results', () => {
  // The old envelope has no persisted comparison: its original bytes are enough.
  const bytes = raw('old-record', '9007199254740992', '9007199254740993');
  const envelope = Buffer.from(JSON.stringify({ schema: 'gelt.research-stored.v1', originalSha256: hash(bytes),
    originalBytes: bytes.length, originalBase64: bytes.toString('base64'), importedAt: '2026-10-07T00:00:00.000Z' }));
  const path = join(root, 'evidence-old-record.json'); writePrivateNew(path, envelope);
  expect(readResearch(root, 'old-record')).toMatchObject({ state: 'available', record: {
    geltChecks: { numericComparison: { status: 'failed' }, scientificReproduction: 'not_run' }, originalSha256: hash(bytes),
  } });
  expect(listResearch(root)).toMatchObject({ state: 'available', items: expect.arrayContaining([
    { evidenceId: 'old-record', result: expect.objectContaining({ state: 'available' }) },
  ]) });
  expect(readPrivate(path, 90000)).toEqual(envelope);
});

it.each([
  ['negative-underflow-tolerance', '1', '-1e-400'],
  ['unsupported-exponent', '1e-100001', '0'],
  ['huge-exponent', '1e-' + '9'.repeat(100), '0'],
  ['oversized-token', '0.' + '0'.repeat(4094) + '1', '0'],
])('rejects %s before ownership and reports legacy envelope corrupt', (id, actual, tolerance) => {
  const bytes = raw(id, actual, '1', tolerance), input = join(source, `${id}.json`);
  writePrivateNew(input, bytes);
  expect(() => importResearchFile(root, input)).toThrow();
  expect(fs.existsSync(join(root, 'research-writer.lock'))).toBe(false);
  const path = join(root, `evidence-${id}.json`);
  expect(fs.existsSync(path)).toBe(false);
  const envelope = Buffer.from(JSON.stringify({ schema: 'gelt.research-stored.v1', originalSha256: hash(bytes),
    originalBytes: bytes.length, originalBase64: bytes.toString('base64'), importedAt: '2026-10-07T00:00:00.000Z' }));
  writePrivateNew(path, envelope);
  expect(readResearch(root, id)).toEqual({ state: 'corrupt' });
  expect(readPrivate(path, 90000)).toEqual(envelope);
});

it('normalizes at lexical bounds without expanding an exponent', () => {
  expect(compare(raw('bound', '1e-99999', '10e-100000')).status).toBe('passed');
  expect(compare(raw('bound', '0.' + '0'.repeat(4093) + '1', '1e-4094')).status).toBe('passed');
  expect(compare(raw('bound', '-0e100000', '0e-100000')).status).toBe('passed');
  expect(compare(raw('bound', '1e-00000000400', '10e-401')).status).toBe('passed');
});

it('binds escaped keys and indices, rejecting missing, malformed and duplicate lexical evidence', () => {
  const bytes = raw('escaped', '1', '1.0000000000000001');
  expect(compare(Buffer.from(bytes.toString().replace('"actual"', '"\\u0061ctual"'))).status).toBe('failed');
  for (const value of ['01', '1.', '+1', 'NaN', '1e', 'null', '"1"']) expect(() => compare(raw('bad', value, '1'))).toThrow();
  expect(() => compare(Buffer.from(bytes.toString().replace('"actual":1,', '"actual":1,"\\u0061ctual":1,')))).toThrow();
  const parsed = parseResearchEvidenceJSON(bytes), results = researchEvidenceSchema.parse(parsed.value).results;
  expect(() => compareResearchNumbers(results, [])).toThrow('missing');
  expect(() => compareResearchNumbers(results, [{}])).toThrow();
  const two = JSON.parse(bytes.toString());
  two.results.push({ name: 'second', actual: 2, expected: 2, absoluteTolerance: 0, relativeTolerance: 0 });
  const mixed = Buffer.from(JSON.stringify(two).replace('"actual":2', '"actual":2.0000000000000001'));
  expect(compare(mixed)).toMatchObject({ status: 'failed', detail: expect.stringContaining('2 compared, 1 unequal') });
});
