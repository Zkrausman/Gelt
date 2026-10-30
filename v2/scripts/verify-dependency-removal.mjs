import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Build-time provenance validation only. Never imported by an application service.
export function reconstructPreStripdownLock(lock, removal) {
  assert.equal(removal.schema, 'gelt.terminal-dependency-removal.v1');
  assert.equal(removal.priorLockSha256, 'b2330e24bd86f36757c260541d1cbd9d585da46f6de92312a3ead82ac1ba4945');
  assert.equal(lock.name, 'gelt');
  assert.equal(new Set(removal.priorPackageOrder).size, removal.priorPackageOrder.length);
  const removed = removal.removedPackages;
  for (const key of Object.keys(removed)) assert.ok(!Object.hasOwn(lock.packages, key), `removed package returned: ${key}`);
  assert.deepEqual(new Set(Object.keys(lock.packages)), new Set(removal.priorPackageOrder.filter(key => !Object.hasOwn(removed, key))));
  const expectedRoot = structuredClone(removal.metadataBefore['']);
  expectedRoot.name = 'gelt';
  delete expectedRoot.devDependencies.concurrently;
  assert.deepEqual(expectedRoot.devDependencies, {});
  delete expectedRoot.devDependencies;
  const expectedWeb = structuredClone(removal.metadataBefore.web);
  for (const name of ['@tanstack/react-query', 'd3', 'hls.js', 'lightweight-charts', 'react-grid-layout', 'recharts', 'zustand']) delete expectedWeb.dependencies[name];
  for (const name of ['@types/d3', '@types/react-grid-layout']) delete expectedWeb.devDependencies[name];
  assert.deepEqual(lock.packages[''], expectedRoot, 'only declared root removal/rebrand');
  assert.deepEqual(lock.packages.web, expectedWeb, 'only terminal-exclusive web declarations removed');
  for (const key of ['', 'web']) assert.deepEqual(lock.packages[key], removal.metadataAfter[key]);
  const restored = { ...lock, name: removal.priorName, packages: Object.fromEntries(removal.priorPackageOrder.map(key => [key, removal.metadataBefore[key] ?? removed[key] ?? lock.packages[key]])) };
  assert.equal(createHash('sha256').update(JSON.stringify(restored, null, 2) + '\n').digest('hex'), removal.priorLockSha256, 'exact pre-stripdown dependency inventory');
  return restored;
}
