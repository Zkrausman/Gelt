// Rehash only local candidates. Original upstream inventory/hashes are immutable.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './runtime.mjs';
const path = resolve(root, 'IMPORT-MANIFEST.json');
const manifest = JSON.parse(readFileSync(path));
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (['node_modules', '.next', 'dist'].includes(e.name) || e.name.endsWith('.tsbuildinfo')) return [];
  if (e.isSymbolicLink()) throw new Error('symlink in candidate inventory');
  const p = resolve(dir, e.name); return e.isDirectory() ? files(p) : [relative(root, p).split('\\').join('/')];
}); }
for (const p of files(root)) {
  if (p === 'IMPORT-MANIFEST.json') continue;
  const hash = createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex');
  let entry = manifest.entries.find(e => e.path === p);
  if (!entry) { entry = { upstreamPath: null, upstreamSha256: null, status: 'added', path: p, sha256: hash, reason: 'Gelt M4 worker-owned durable ledger source, test or documentation' }; manifest.entries.push(entry); }
  else if (entry.sha256 !== hash) {
    if (entry.status === 'retained') throw new Error(`Explicit provenance review required before modifying retained import: ${p}`);
    // A hash refresh must not rewrite historical provenance to an unrelated milestone.
    entry.sha256 = hash;
  }
}
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
