import * as fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageFixture } from './storage-fixture.js';
import * as privateFiles from './private-files.js';
import { researchFixture } from './research-fixture.js';
import { MAX_RESEARCH_BYTES, researchEvidenceSchema } from './research-contract.js';
import { parseResearchJSON, parseResearchJSONNumberTokens } from './research-json.js';
import { importResearchFile, listResearch, provisionResearch, readResearch, readResearchInput } from './research-store.js';

const roots: string[] = [];
function dir() { const path = storageFixture('research-'); roots.push(path); return path; }
function setup() {
  const root = dir(), excluded = Array.from({ length: 5 }, dir), source = dir();
  provisionResearch(root, excluded);
  return { root, excluded, source };
}
function input(source: string, value: unknown = researchFixture(), name = 'source.json') {
  const path = join(source, name);
  privateFiles.writePrivateNew(path, JSON.stringify(value)); return path;
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('research schema and bounded strict JSON', () => {
  it('validates an explicitly synthetic fixture and all stage states', () => {
    const evidence = researchFixture();
    expect(researchEvidenceSchema.parse(evidence)).toEqual(evidence);
    for (const status of ['passed', 'failed', 'blocked', 'not_run']) {
      evidence.producerClaims.reference.status = status as typeof evidence.producerClaims.reference.status;
      expect(researchEvidenceSchema.safeParse(evidence).success).toBe(true);
    }
  });
  it('rejects trading claims, unknown nested keys, executable fields, invalid IDs and nonfinite numbers', () => {
    for (const mutate of [
      (x: any) => { x.kind = 'strategy'; }, (x: any) => { x.producerClaims.shadow.status = 'passed'; },
      (x: any) => { x.producerClaims.costs.status = 'passed'; }, (x: any) => { x.producerClaims.historical.status = 'passed'; },
      (x: any) => { x.recommendation.promotionAllowed = true; }, (x: any) => { x.source.code.command = 'bad'; },
      (x: any) => { x.endpoint = 'https://example.invalid'; }, (x: any) => { x.environment = {}; },
      (x: any) => { x.evidenceId = '../escape'; }, (x: any) => { x.evidenceId = 'UPPER'; },
      (x: any) => { x.results[0].actual = Infinity; }, (x: any) => { x.results[0].expected = NaN; },
      (x: any) => { x.results[0].absoluteTolerance = -1; }, (x: any) => { x.inputs[0].values = Array(4097).fill(0); },
      (x: any) => { x.title = 'x'.repeat(2049); }, (x: any) => { x.results = Array(257).fill(x.results[0]); },
      (x: any) => { x.results.push(x.results[0]); }, (x: any) => { x.inputs.push(x.inputs[0]); },
      (x: any) => { x.dependencyLock.packages.push(x.dependencyLock.packages[0]); },
    ]) { const evidence = researchFixture(); mutate(evidence); expect(researchEvidenceSchema.safeParse(evidence).success).toBe(false); }
  });
  it('bounds canonical evidence serialization separately from original file bytes', () => {
    const evidence = researchFixture();
    evidence.inputs = Array.from({ length: 8 }, (_, i) => ({ name: `large-${i}`, units: 'test', values: Array(4096).fill(1e20) }));
    expect(researchEvidenceSchema.safeParse(evidence).success).toBe(false);
  });
  it('rejects duplicate escaped keys, invalid UTF8, excessive depth and invalid JSON', () => {
    for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"b":1,"b":2}}', '[1,]', '{"a":01}', 'true false', '[NaN]', '[Infinity]', '["unescaped\n"]', '['.repeat(18) + '0' + ']'.repeat(18)]) {
      expect(() => parseResearchJSON(Buffer.from(source))).toThrow();
    }
    expect(() => parseResearchJSON(Buffer.from([0x22, 0xff, 0x22]))).toThrow();
    expect(parseResearchJSON(Buffer.from('{"a":[1,true,null,"hi\\\"there"],"b":{}}'))).toEqual({ a: [1, true, null, 'hi"there'], b: {} });
  });
  it('preserves exact original JSON number tokens by structural path', () => {
    const parsed = parseResearchJSONNumberTokens(Buffer.from('{"bars":{"AAPL":[{"c":9007199254740992.0000000000000001,"v":1e+8}]}}'));
    expect(parsed.numberTokens.get(JSON.stringify(['bars', 'AAPL', 0, 'c']))).toBe('9007199254740992.0000000000000001');
    expect(parsed.numberTokens.get(JSON.stringify(['bars', 'AAPL', 0, 'v']))).toBe('1e+8');
    expect(parsed.value).toEqual({ bars: { AAPL: [{ c: 9007199254740992, v: 100000000 }] } });
  });
});

describe('separate, immutable private research storage', () => {
  it('imports original bytes, survives reopening and returns digest-idempotent result', () => {
    const { root, source } = setup(), path = input(source);
    expect(listResearch(root)).toEqual({ state: 'available', items: [] });
    const first = importResearchFile(root, path);
    expect(first.status).toBe('imported');
    expect(first.record.originalSha256).toBe(createHash('sha256').update(fs.readFileSync(path)).digest('hex'));
    expect(first.record.geltChecks.scientificReproduction).toBe('not_run');
    expect(importResearchFile(root, path)).toEqual({ status: 'identical', record: first.record });
    expect(readResearch(root, first.record.evidence.evidenceId)).toEqual({ state: 'available', record: first.record });
    expect(listResearch(root)).toEqual({ state: 'available', items: [{ evidenceId: first.record.evidence.evidenceId, result: { state: 'available', record: first.record } }] });
    expect(fs.readdirSync(root).sort()).toEqual(['evidence-synthetic-reference-test.json', 'research-store.json']);
  });
  it('stores legal IDs without config collision and refuses logical-ID conflicts without overwrite', () => {
    const { root, source } = setup();
    const evidence = researchFixture(); evidence.evidenceId = 'research-store';
    const first = importResearchFile(root, input(source, evidence));
    evidence.title = 'Changed';
    expect(() => importResearchFile(root, input(source, evidence, 'second.json'))).toThrow('ID conflict');
    expect(readResearch(root, evidence.evidenceId)).toEqual({ state: 'available', record: first.record });
  });
  it('treats whitespace-different original bytes as a logical-ID conflict', () => {
    const { root, source } = setup();
    const path = input(source); importResearchFile(root, path);
    const second = join(source, 'formatted.json');
    privateFiles.writePrivateNew(second, JSON.stringify(researchFixture(), null, 2));
    expect(() => importResearchFile(root, second)).toThrow('ID conflict');
    expect(fs.existsSync(join(root, 'research-writer.lock'))).toBe(false);
  });
  it('distinguishes missing, corrupt and unavailable; detects byte tamper and schema changes', () => {
    const { root, source } = setup(), id = researchFixture().evidenceId;
    expect(readResearch(root, id)).toEqual({ state: 'missing' });
    expect(readResearch(root, '../escape')).toEqual({ state: 'unavailable' });
    expect(readResearch(join(root, 'absent'), id)).toEqual({ state: 'unavailable' });
    importResearchFile(root, input(source));
    const path = join(root, `evidence-${id}.json`), stored = JSON.parse(privateFiles.readPrivate(path, 90000).toString());
    stored.originalBase64 = Buffer.from('{}').toString('base64');
    privateFiles.replacePrivate(path, JSON.stringify(stored));
    expect(readResearch(root, id)).toEqual({ state: 'corrupt' });
    expect(listResearch(root)).toEqual({ state: 'available', items: [{ evidenceId: id, result: { state: 'corrupt' } }] });
    expect(() => importResearchFile(root, join(source, 'source.json'))).toThrow();
  });
  it('never treats matching producer numbers as independently reproduced science; fails overflow checks', () => {
    const { root, source } = setup(), evidence = researchFixture();
    evidence.results[0] = { name: 'overflow', actual: -1e308, expected: 1e308, absoluteTolerance: 0, relativeTolerance: 1e308 };
    evidence.producerClaims.reproduction.status = 'passed';
    const result = importResearchFile(root, input(source, evidence));
    expect(result.record.geltChecks.numericComparison.status).toBe('failed');
    expect(result.record.geltChecks.scientificReproduction).toBe('not_run');
    expect(result.record.evidence.producerClaims.reproduction.status).toBe('passed');
  });
  it('requires explicit canonical paths, regular files and <=64KiB source bytes', () => {
    const { root, source } = setup();
    expect(() => readResearchInput('https://example.invalid/evidence.json')).toThrow();
    expect(() => readResearchInput('relative.json')).toThrow();
    expect(() => readResearchInput(source)).toThrow();
    const path = input(source);
    expect(() => readResearchInput(source + '/../' + source.split(/[\\/]/).at(-1) + '/source.json')).toThrow();
    privateFiles.writePrivateNew(join(source, 'large.json'), Buffer.alloc(MAX_RESEARCH_BYTES + 1, 32));
    expect(() => importResearchFile(root, join(source, 'large.json'))).toThrow();
    privateFiles.writePrivateNew(join(source, 'empty.json'), '');
    expect(() => importResearchFile(root, join(source, 'empty.json'))).toThrow();
    expect(readResearchInput(path)).toEqual(fs.readFileSync(path));
  });
  it('supports the exact original byte limit without widening native helper limits', () => {
    const { root, source } = setup(), encoded = JSON.stringify(researchFixture());
    const bytes = Buffer.from(encoded + ' '.repeat(MAX_RESEARCH_BYTES - Buffer.byteLength(encoded)));
    const path = join(source, 'max.json'); privateFiles.writePrivateNew(path, bytes);
    const result = importResearchFile(root, path);
    expect(result.record.originalBytes).toBe(MAX_RESEARCH_BYTES);
    expect(fs.statSync(join(root, `evidence-${result.record.evidence.evidenceId}.json`)).size).toBeLessThan(90000);
  });
  it('refuses missing provisioning, overlaps, nonempty storage and reprovisioning', () => {
    const root = dir(), excluded = Array.from({ length: 5 }, dir);
    expect(() => provisionResearch(root, [root, ...excluded.slice(1)])).toThrow();
    expect(() => provisionResearch(root, excluded.slice(1))).toThrow();
    expect(() => importResearchFile(root, input(excluded[0]))).toThrow();
    privateFiles.writePrivateNew(join(root, 'existing'), 'present');
    expect(() => provisionResearch(root, excluded)).toThrow();
    const fresh = dir(); provisionResearch(fresh, excluded);
    expect(() => provisionResearch(fresh, excluded)).toThrow();
  });
  it('never reprovisions when another caller completes between preflight and ownership', () => {
    const root = dir(), firstExcluded = Array.from({ length: 5 }, dir), secondExcluded = Array.from({ length: 5 }, dir);
    const originalWrite = privateFiles.writePrivateNew;
    const spy = vi.spyOn(privateFiles, 'writePrivateNew').mockImplementationOnce((path, value) => {
      expect(path).toBe(join(root, 'research-provision.lock'));
      spy.mockRestore();
      // First caller wins and completes while the outer caller is paused after
      // its successful empty preflight, before acquiring its own marker.
      provisionResearch(root, firstExcluded);
      originalWrite(path, value);
    });
    expect(() => provisionResearch(root, secondExcluded)).toThrow('already populated');
    expect(JSON.parse(privateFiles.readPrivate(join(root, 'research-store.json')).toString()).excludedDirectories).toEqual(firstExcluded);
    expect(fs.existsSync(join(root, 'research-provision.lock'))).toBe(false);
    expect(listResearch(root)).toEqual({ state: 'available', items: [] });
  });
  it.skipIf(process.platform === 'win32')('bounds capacity without poisoning a known full store', () => {
    const { root, source } = setup();
    for (let i = 0; i < 100; i++) privateFiles.writePrivateNew(join(root, `evidence-capacity-${i}.json`), '{}');
    expect(() => importResearchFile(root, input(source))).toThrow('capacity reached');
    expect(fs.existsSync(join(root, 'research-writer.lock'))).toBe(false);
    privateFiles.writePrivateNew(join(root, 'evidence-over-capacity.json'), '{}');
    expect(listResearch(root)).toEqual({ state: 'unavailable' });
  });
  it.each(['detail', 'list'] as const)('rechecks interrupted writer ownership after %s read', operation => {
    const { root, source } = setup(), evidence = researchFixture();
    const firstInput = input(source, evidence);
    if (operation === 'list') importResearchFile(root, firstInput);
    const writerEvidence = { ...evidence, evidenceId: operation === 'list' ? 'concurrent-import' : evidence.evidenceId };
    const writerInput = input(source, writerEvidence, 'concurrent.json');
    const originalRead = privateFiles.readPrivate;
    const spy = vi.spyOn(privateFiles, 'readPrivate').mockImplementation((path, max) => {
      if (path === join(root, `evidence-${evidence.evidenceId}.json`)) {
        spy.mockRestore();
        const cleanup = vi.spyOn(privateFiles, 'removePrivate').mockImplementationOnce(() => { throw new Error('post-commit interruption'); });
        try { expect(() => importResearchFile(root, writerInput)).toThrow('post-commit interruption'); }
        finally { cleanup.mockRestore(); }
      }
      return originalRead(path, max);
    });
    const result = operation === 'detail' ? readResearch(root, evidence.evidenceId) : listResearch(root);
    expect(fs.existsSync(join(root, 'research-writer.lock'))).toBe(true);
    expect(result).toEqual({ state: 'unavailable' });
  });
  it('retains ownership and fails closed after interruption before commit', () => {
    const { root, source } = setup(), path = input(source);
    vi.spyOn(privateFiles, 'replacePrivate').mockImplementationOnce(() => { throw new Error('simulated pre-rename interruption'); });
    expect(() => importResearchFile(root, path)).toThrow();
    vi.restoreAllMocks();
    expect(fs.existsSync(join(root, 'research-writer.lock'))).toBe(true);
    expect(readResearch(root, researchFixture().evidenceId)).toEqual({ state: 'unavailable' });
    expect(() => importResearchFile(root, path)).toThrow();
    expect(fs.existsSync(join(root, 'evidence-synthetic-reference-test.json'))).toBe(false);
  });
  it('retains ownership after commit but before cleanup and never steals on restart', () => {
    const { root, source } = setup(), path = input(source);
    vi.spyOn(privateFiles, 'removePrivate').mockImplementationOnce(() => { throw new Error('simulated post-commit interruption'); });
    expect(() => importResearchFile(root, path)).toThrow();
    vi.restoreAllMocks();
    expect(fs.existsSync(join(root, 'evidence-synthetic-reference-test.json'))).toBe(true);
    expect(readResearch(root, researchFixture().evidenceId)).toEqual({ state: 'unavailable' });
    expect(listResearch(root)).toEqual({ state: 'unavailable' });
    expect(() => importResearchFile(root, path)).toThrow();
  });
  it.skipIf(process.platform === 'win32')('rejects source/file/root symlinks, hardlinks and unsafe permissions on Linux', () => {
    const { root, source, excluded } = setup(), path = input(source);
    const link = join(source, 'link.json'); fs.symlinkSync(path, link);
    expect(() => readResearchInput(link)).toThrow();
    const alias = join(source, 'alias'); fs.symlinkSync(root, alias);
    expect(readResearch(alias, researchFixture().evidenceId)).toEqual({ state: 'unavailable' });
    expect(() => provisionResearch(dir(), [alias, ...excluded.slice(1)])).toThrow();
    const hard = join(source, 'hard.json'); fs.linkSync(path, hard);
    expect(() => readResearchInput(hard)).toThrow(); fs.unlinkSync(hard);
    importResearchFile(root, path);
    const stored = join(root, 'evidence-synthetic-reference-test.json'); fs.unlinkSync(stored); fs.symlinkSync(path, stored);
    expect(readResearch(root, researchFixture().evidenceId)).toEqual({ state: 'corrupt' });
    fs.chmodSync(root, 0o755);
    expect(listResearch(root)).toEqual({ state: 'unavailable' });
  });
});

it.skipIf(process.platform === 'win32').each(['界', '\u0001'])('rejects oversized serialized provisioning config for %j before mutation', character => {
  const root = dir();
  const excluded = Array.from({ length: 5 }, () => {
    const parent = dir(), path = join(parent, ...Array(9).fill(character.repeat(80)));
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    privateFiles.privateDirectory(path);
    expect(path.length).toBeLessThanOrEqual(1024);
    return path;
  });
  expect(Buffer.byteLength(JSON.stringify({ schema: 'gelt.research-store.v1', excludedDirectories: excluded }))).toBeGreaterThan(8192);
  expect(() => provisionResearch(root, excluded)).toThrow('research configuration too large');
  expect(fs.readdirSync(root)).toEqual([]);
});

it('reserves platform pathname space for maximum evidence IDs and atomic temporary files', () => {
  let root: string;
  if (process.platform === 'win32') {
    root = storageFixture('research-root-' + 'x'.repeat(110)); roots.push(root);
  } else {
    root = dir();
    while (Buffer.byteLength(root) + 201 < 3990) root = join(root, 'x'.repeat(200));
    root = join(root, 'x'.repeat(Math.max(1, 3990 - Buffer.byteLength(root) - 1)));
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  privateFiles.privateDirectory(root);
  const excluded = Array.from({ length: 5 }, dir);
  expect(() => provisionResearch(root, excluded)).toThrow('research root path too long');
  expect(fs.readdirSync(root)).toEqual([]);
});

it.skipIf(process.platform === 'win32')('accepts exactly 8192 serialized config bytes and rejects 8193 before mutation', () => {
  const root = dir(), excluded = Array.from({ length: 5 }, dir);
  const size = () => Buffer.byteLength(JSON.stringify({ schema: 'gelt.research-store.v1', excludedDirectories: excluded }));
  let index = 0, last = 0;
  while (size() + 241 <= 8192) {
    last = index++ % 5; excluded[last] = join(excluded[last], '界'.repeat(80));
  }
  if (8192 - size() === 1) excluded[last] = excluded[last].slice(0, -1) + 'a';
  const remaining = 8192 - size();
  if (remaining) excluded[last] = join(excluded[last], 'x'.repeat(remaining - 1));
  for (const path of excluded) { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); privateFiles.privateDirectory(path); expect(path.length).toBeLessThanOrEqual(1024); }
  expect(size()).toBe(8192); provisionResearch(root, excluded);
  expect(listResearch(root)).toEqual({ state: 'available', items: [] });
  excluded[0] += 'x'; fs.mkdirSync(excluded[0], { recursive: true, mode: 0o700 });
  expect(size()).toBe(8193);
  const rejectedRoot = dir(); expect(() => provisionResearch(rejectedRoot, excluded)).toThrow('research configuration too large');
  expect(fs.readdirSync(rejectedRoot)).toEqual([]);
});
it('supports the longest evidence ID at the exact platform root budget', () => {
  const parent = dir(); let root = parent;
  const maximum = process.platform === 'win32' ? 141 : 3983;
  if (process.platform === 'win32') {
    root = join(parent, 'x'.repeat(maximum - parent.length - 1));
    privateFiles.createPrivateDirectory(root);
  } else {
    while (Buffer.byteLength(root) + 201 < maximum) root = join(root, 'x'.repeat(200));
    root = join(root, 'x'.repeat(maximum - Buffer.byteLength(root) - 1));
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  expect(process.platform === 'win32' ? root.length : Buffer.byteLength(root)).toBe(maximum);
  const excluded = Array.from({ length: 5 }, dir); provisionResearch(root, excluded);
  const source = dir(), evidence = researchFixture(); evidence.evidenceId = 'a'.repeat(64);
  expect(importResearchFile(root, input(source, evidence)).status).toBe('imported');
  expect(readResearch(root, evidence.evidenceId).state).toBe('available');
  const rejectedRoot = root + 'x';
  if (process.platform === 'win32') privateFiles.createPrivateDirectory(rejectedRoot);
  else fs.mkdirSync(rejectedRoot, { recursive: true, mode: 0o700 });
  expect(() => provisionResearch(rejectedRoot, excluded)).toThrow('research root path too long');
  expect(fs.readdirSync(rejectedRoot)).toEqual([]);
});
