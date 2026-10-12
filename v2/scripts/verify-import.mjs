import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { root } from './runtime.mjs';
const manifest = JSON.parse(readFileSync(resolve(root, 'IMPORT-MANIFEST.json')));
assert.equal(manifest.commit, '6feb4869489c8ac9537b1405547983591e1d3263');
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const expected = new Set(); const upstream = new Set();
for (const e of manifest.entries) {
  assert.ok(['retained', 'modified', 'omitted', 'added'].includes(e.status));
  if (e.upstreamPath) { assert.ok(!upstream.has(e.upstreamPath)); upstream.add(e.upstreamPath); }
  if (e.status === 'omitted') { assert.equal(e.path, null); continue; }
  assert.ok(e.path && !e.path.startsWith('/') && !e.path.split('/').includes('..'));
  assert.ok(!expected.has(e.path)); expected.add(e.path);
  if (e.path === 'IMPORT-MANIFEST.json') { assert.equal(e.sha256, null); continue; }
  assert.equal(hash(e.path), e.sha256, e.path);
  if (e.status === 'retained') assert.equal(e.sha256, e.upstreamSha256, e.path);
}
function inventory(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.next', 'dist'].includes(e.name) || e.name.endsWith('.tsbuildinfo')) return [];
    const path = resolve(dir, e.name);
    assert.ok(!e.isSymbolicLink(), `unaccounted symlink ${path}`);
    return e.isDirectory() ? inventory(path) : [relative(root, path).split('\\').join('/')];
  });
}
assert.deepEqual(new Set(inventory(root)), expected, 'complete candidate path accounting');
assert.equal(manifest.entries.find(e => e.path === 'LICENSE').status, 'retained');
// The ONLY permitted lockfile change is worker workspace metadata. Reconstruct
// upstream bytes and verify their original pinned hash: no dependency upgrades.
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json')));
assert.deepEqual(lock.packages[''].workspaces, ['server', 'web', 'worker']);
assert.deepEqual(lock.packages.worker, { name: 'gelt-disabled-worker', dependencies: { 'better-sqlite3': '^13.0.3', zod: '^3.24.1' }, devDependencies: { '@types/better-sqlite3': '^7.6.12' } });
assert.deepEqual(lock.packages['node_modules/gelt-disabled-worker'], { resolved: 'worker', link: true });
lock.packages[''].workspaces.pop(); delete lock.packages.worker; delete lock.packages['node_modules/gelt-disabled-worker'];
assert.equal(createHash('sha256').update(JSON.stringify(lock, null, 2) + '\n').digest('hex'), manifest.entries.find(e => e.path === 'package-lock.json').upstreamSha256);

for (const entry of JSON.parse(readFileSync(resolve(root, 'DEPENDENCY-NOTICES.json'))).packages) {
  for (const notice of entry.notices) assert.equal(hash(notice.text), notice.sha256);
}
console.log(`PASS import inventory: ${upstream.size} upstream paths, ${expected.size} candidate files; MIT verbatim; lockfile resolved inventory unchanged`);
