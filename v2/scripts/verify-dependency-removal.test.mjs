import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { reconstructPreStripdownLock } from './verify-dependency-removal.mjs';
const lock = () => JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
const proof = () => JSON.parse(readFileSync(new URL('../provenance/terminal-dependency-removal.json', import.meta.url)));

test('pruned lock reconstructs every preceding resolution and original package order', () => {
  const restored = reconstructPreStripdownLock(lock(), proof());
  assert.equal(restored.name, 'openterminal');
  assert.equal(Object.keys(restored.packages).length - Object.keys(lock().packages).length, 122);
});
test('retained version, integrity and optional platform metadata changes reject', () => {
  for (const key of ['version', 'integrity', 'os']) {
    const changed = lock(); changed.packages['node_modules/next'][key] = 'altered';
    assert.throws(() => reconstructPreStripdownLock(changed, proof()));
  }
});
test('new declarations and reintroduced terminal packages reject even with a matching claimed after metadata', () => {
  const changed = lock(), evidence = proof();
  changed.packages.web.dependencies.zustand = '^5.0.3'; evidence.metadataAfter.web = structuredClone(changed.packages.web);
  assert.throws(() => reconstructPreStripdownLock(changed, evidence));
  const reintroduced = lock(), old = proof();
  const key = Object.keys(old.removedPackages)[0]; reintroduced.packages[key] = old.removedPackages[key];
  assert.throws(() => reconstructPreStripdownLock(reintroduced, old));
});
test('dropping a shared retained dependency or altering removal provenance cannot pass', () => {
  const changed = lock(); delete changed.packages['node_modules/zod'];
  assert.throws(() => reconstructPreStripdownLock(changed, proof()));
  const evidence = proof(); evidence.removedPackages[Object.keys(evidence.removedPackages)[0]].version = 'altered';
  assert.throws(() => reconstructPreStripdownLock(lock(), evidence));
});
