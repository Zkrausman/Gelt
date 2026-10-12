import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { privateDirectory, readPrivate, writePrivateNew, replacePrivate, removePrivate, separateDirectories } from './private-files.js';
import { MAX_RESEARCH_BYTES, researchEvidenceSchema, researchIdSchema, sha256Schema, type ResearchRecord, type ResearchRead } from './research-contract.js';
import { parseResearchJSON, parseResearchEvidenceJSON } from './research-json.js';
import { compareResearchNumbers } from './research-numbers.js';

const MAX_RECORDS = 100;
const MAX_PROVISIONING_BYTES = 8192;
// A 64-character ID gives a 78-character ASCII filename plus one separator.
// Existing Windows helper targets cap at 220 UTF-16 units (root <= 141).
// Linux reserves NUL and the existing 33-byte atomic-temp suffix within PATH_MAX.
const MAX_WINDOWS_ROOT_UNITS = 220 - 79;
const MAX_LINUX_ROOT_BYTES = 4096 - 1 - 79 - 33;
const MAX_STORED_BYTES = 90_000; // Includes base64 and metadata; below existing native helper limit.
const markerName = 'research-store.json';
const lockName = 'research-writer.lock';
const provisionLockName = 'research-provision.lock';
const provisioningSchema = z.object({ schema: z.literal('gelt.research-store.v1'),
  excludedDirectories: z.array(z.string().min(1).max(1024)).length(5) }).strict();
const storedSchema = z.object({ schema: z.literal('gelt.research-stored.v1'),
  originalSha256: sha256Schema, originalBytes: z.number().int().min(1).max(MAX_RESEARCH_BYTES),
  originalBase64: z.string().min(1).max(87_384), importedAt: z.string().datetime({ precision: 3 }),
}).strict();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => new Error('research storage unavailable');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
function canonicalDirectory(path: string): string {
  if (path !== resolve(path)) throw unavailable();
  privateDirectory(path);
  return fs.realpathSync.native(path);
}
function researchDirectory(root: string): string {
  if (process.platform === 'win32' ? root.length > MAX_WINDOWS_ROOT_UNITS : Buffer.byteLength(root, 'utf8') > MAX_LINUX_ROOT_BYTES) {
    throw new Error('research root path too long');
  }
  return canonicalDirectory(root);
}
function separation(root: string, excluded: string[]) {
  const actualRoot = researchDirectory(root);
  const actualExcluded = excluded.map(canonicalDirectory);
  if (!actualExcluded.every(path => separateDirectories(actualRoot, path)) ||
      actualExcluded.some((a, i) => actualExcluded.some((b, j) => i !== j && !separateDirectories(a, b)))) throw unavailable();
}
function exists(path: string) {
  try { fs.lstatSync(path); return true; } catch (error) { if (missing(error)) return false; throw error; }
}
function validateRoot(root: string, allowWriter = false) {
  researchDirectory(root);
  const config = provisioningSchema.parse(parseResearchJSON(readPrivate(join(root, markerName), MAX_PROVISIONING_BYTES)));
  separation(root, config.excludedDirectories);
  if (exists(join(root, provisionLockName)) || (!allowWriter && exists(join(root, lockName)))) throw unavailable();
}
function filenames(root: string): string[] {
  const entries: string[] = [];
  // Bound iteration rather than loading an unbounded directory listing.
  const directory = fs.opendirSync(root);
  try {
    let entry: fs.Dirent | null;
    while ((entry = directory.readSync())) {
      if (entries.length >= MAX_RECORDS + 4) throw unavailable();
      entries.push(entry.name);
    }
  } finally { directory.closeSync(); }
  for (const name of entries) {
    if (name === markerName || name === lockName || name === provisionLockName) continue;
    if (!/^evidence-[a-z0-9][a-z0-9-]{0,63}\.json$/.test(name)) throw unavailable();
  }
  const records = entries.filter(name => name.startsWith('evidence-') && name.endsWith('.json'));
  if (records.length > MAX_RECORDS) throw unavailable();
  return records.sort();
}

/** Owner-only, explicit, one-time provisioning into an already private EMPTY
 * directory, separate from key, worker, BFF, bootstrap and execution directories.
 * No chmod/ACL repair, credentials, ledger setup, network or startup side effect. */
export function provisionResearch(root: string, excludedDirectories: string[]): void {
  const config = provisioningSchema.parse({ schema: 'gelt.research-store.v1', excludedDirectories });
  const configBytes = Buffer.from(JSON.stringify(config), 'utf8');
  if (configBytes.length > MAX_PROVISIONING_BYTES) throw new Error('research configuration too large');
  separation(root, config.excludedDirectories);
  const directory = fs.opendirSync(root);
  try { if (directory.readSync() !== null) throw unavailable(); } finally { directory.closeSync(); }
  writePrivateNew(join(root, provisionLockName), 'research provisioning in progress');
  // The empty preflight is not ownership. Another provisioner can complete and
  // release its marker before we acquire ours. Never overwrite its config.
  const ownedDirectory = fs.opendirSync(root);
  let emptyUnderOwnership: boolean;
  try {
    const first = ownedDirectory.readSync();
    emptyUnderOwnership = first?.name === provisionLockName && ownedDirectory.readSync() === null;
  } finally { ownedDirectory.closeSync(); }
  if (!emptyUnderOwnership) {
    // No configuration write has been attempted: only our marker is removed.
    removePrivate(join(root, provisionLockName));
    throw new Error('research directory already populated');
  }
  // Retain marker after any uncertain write; no automatic lock stealing.
  replacePrivate(join(root, markerName), configBytes);
  removePrivate(join(root, provisionLockName));
}

function decodeEvidence(original: Buffer) {
  const parsed = parseResearchEvidenceJSON(original);
  const evidence = researchEvidenceSchema.parse(parsed.value);
  return { evidence, numericComparison: compareResearchNumbers(evidence.results, parsed.numbers) };
}

function decodeStored(bytes: Buffer, id: string): ResearchRecord {
  const stored = storedSchema.parse(parseResearchJSON(bytes));
  const original = Buffer.from(stored.originalBase64, 'base64');
  if (original.toString('base64') !== stored.originalBase64 || original.length !== stored.originalBytes ||
      hash(original) !== stored.originalSha256) throw unavailable();
  const { evidence, numericComparison } = decodeEvidence(original);
  if (evidence.evidenceId !== id) throw unavailable();
  // Numeric agreement is NOT an independent reproduction or paper review.
  return { evidence, originalSha256: stored.originalSha256, originalBytes: original.length, importedAt: stored.importedAt,
    geltChecks: { schema: 'passed', integrity: 'passed', numericComparison,
    scientificReproduction: 'not_run' } };
}
function readRecord(root: string, id: string): ResearchRead {
  try { return { state: 'available', record: decodeStored(readPrivate(join(root, `evidence-${id}.json`), MAX_STORED_BYTES), id) }; }
  catch (error) { return { state: missing(error) ? 'missing' : 'corrupt' }; }
}
export function readResearch(root: string, evidenceId: string): ResearchRead {
  const id = researchIdSchema.safeParse(evidenceId);
  if (!id.success) return { state: 'unavailable' };
  try {
    validateRoot(root); filenames(root);
    const result = readRecord(root, id.data);
    // A different process may commit and retain ownership during our read.
    // Publish only after a fresh check of the complete private store boundary.
    validateRoot(root);
    return result;
  } catch { return { state: 'unavailable' }; }
}
export type ResearchList = { state: 'available'; items: { evidenceId: string; result: ResearchRead }[] } | { state: 'unavailable' };
export function listResearch(root: string): ResearchList {
  try {
    validateRoot(root);
    const items = filenames(root).map(name => {
      const evidenceId = name.slice('evidence-'.length, -5);
      return { evidenceId, result: readRecord(root, evidenceId) };
    });
    validateRoot(root);
    return { state: 'available', items };
  } catch { return { state: 'unavailable' }; }
}

/** Explicit local source only. Bounded read, regular single-link file, no symlink
 * components, no URL fetch, archive extraction, dynamic imports or execution. */
export function readResearchInput(path: string): Buffer {
  if (path !== resolve(path)) throw new Error('explicit canonical evidence file required');
  // Windows requires a pre-staged private NTFS source: the existing native
  // helper rejects remote volumes, reparse points, ADS and unsafe ancestors.
  if (process.platform === 'win32') {
    const bytes = readPrivate(path, MAX_RESEARCH_BYTES);
    if (bytes.length < 1 || bytes.length > MAX_RESEARCH_BYTES) throw new Error('bounded evidence required');
    return bytes;
  }
  if (process.platform !== 'linux') throw new Error('supported local filesystem required');
  // Reject ancestor symlinks too. Windows reparse points also change realpath.
  if (fs.realpathSync.native(path) !== path) throw new Error('canonical evidence file required');
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > MAX_RESEARCH_BYTES) throw new Error('bounded regular evidence file required');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('evidence file changed');
    const bytes = Buffer.alloc(MAX_RESEARCH_BYTES + 1);
    let count = 0, n: number;
    while (count < bytes.length && (n = fs.readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += n;
    const after = fs.fstatSync(fd);
    if (count !== opened.size || count > MAX_RESEARCH_BYTES || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('evidence file changed');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
export function importResearchFile(root: string, inputPath: string): { status: 'imported' | 'identical'; record: ResearchRecord } {
  const original = readResearchInput(inputPath);
  // Lexical support is checked before taking ownership or writing an envelope.
  const { evidence } = decodeEvidence(original);
  const originalSha256 = hash(original);
  validateRoot(root);
  const previous = readResearch(root, evidence.evidenceId);
  if (previous.state === 'available') {
    if (previous.record.originalSha256 === originalSha256) return { status: 'identical', record: previous.record };
    throw new Error('research evidence ID conflict');
  }
  if (previous.state !== 'missing') throw unavailable();
  if (filenames(root).length >= MAX_RECORDS) throw new Error('research storage capacity reached');
  writePrivateNew(join(root, lockName), 'research import in progress; do not steal');
  // Errors beyond this point deliberately retain the writer marker. Existing
  // evidence is never replaced. Recovery requires owner review, not timeout.
  validateRoot(root, true);
  const names = filenames(root);
  // Another successful importer may have committed after our initial read.
  const current = readRecord(root, evidence.evidenceId);
  if (current.state === 'available') {
    removePrivate(join(root, lockName));
    if (current.record.originalSha256 === originalSha256) return { status: 'identical', record: current.record };
    throw new Error('research evidence ID conflict');
  }
  if (current.state !== 'missing') throw unavailable();
  if (names.length >= MAX_RECORDS) {
    removePrivate(join(root, lockName));
    throw new Error('research storage capacity reached');
  }
  const serialized = Buffer.from(JSON.stringify({ schema: 'gelt.research-stored.v1', originalSha256,
    originalBytes: original.length, originalBase64: original.toString('base64'), importedAt: new Date().toISOString() }));
  if (serialized.length > MAX_STORED_BYTES) throw unavailable();
  replacePrivate(join(root, `evidence-${evidence.evidenceId}.json`), serialized);
  const committed = readRecord(root, evidence.evidenceId);
  if (committed.state !== 'available' || committed.record.originalSha256 !== originalSha256) throw unavailable();
  removePrivate(join(root, lockName));
  return { status: 'imported', record: committed.record };
}
