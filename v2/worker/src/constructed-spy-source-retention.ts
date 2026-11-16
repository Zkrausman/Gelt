// One explicit, offline synthetic case may retain its complete constructed
// PR75 input beside (never inside) the existing G05 consumer evidence. This is
// not source authentication, market-data admission, or an order capability.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { ledgerId } from './ledger-contract.js';
import { parseResearchJSON } from './research-json.js';
import { privateDirectory, readPrivate, syncDirectory, writePrivateNew } from './private-files.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { projectConstructedSpyG05, type ProjectedConstructedSpyG05 } from './constructed-spy-g05-projection.js';
import { simulationDigest, simulationRunSchema } from './synthetic-simulation-economics.js';

const inputLimit = 1_048_576;
const projectionLimit = 1_048_576;
const base64Limit = 1_398_104;
const recordLimit = 3_145_728;
const ownerLimit = 8_192;
const namespaceLimit = 3_153_920;
const rootPathLimit = 3_000;
const sourceName = 'source.json';
const pendingName = '.source.pending';
const localFilesystemTypes = [0xef53, 0x58465342, 0x9123683e, 0x794c7630];
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/);

const ownerSchema = z.object({
  schema: z.literal('gelt.constructed-spy-source-owner.v1'),
  caseEpochId: ledgerId,
  runId: ledgerId,
  sourceCommit,
  configSha256: sha256,
  candidateId: z.string().regex(/^candidate-shadow-[a-f0-9]{64}$/),
  projectionId: z.string().regex(/^constructed-spy-g05-[a-f0-9]{64}$/),
  originalInputSha256: sha256,
}).strict();
export type ConstructedSpySourceOwner = z.infer<typeof ownerSchema>;

const receiptSchema = z.object({
  schema: z.literal('gelt.constructed-spy-source-receipt.v1'),
  caseEpochId: ledgerId,
  runId: ledgerId,
  sourceCommit,
  configSha256: sha256,
  originalInputBytes: z.number().int().min(1).max(inputLimit),
  originalInputSha256: sha256,
  projectionId: z.string().regex(/^constructed-spy-g05-[a-f0-9]{64}$/),
  projectionSha256: sha256,
  dailyInputSha256: sha256,
  dailyAssessmentSha256: sha256,
  candidateId: z.string().regex(/^candidate-shadow-[a-f0-9]{64}$/),
  manifestSha256: sha256,
  ruleInputSha256: sha256,
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/),
  classification: z.literal('constructed_offline_test'),
  sourceRetention: z.literal('outer_input_exact_bytes_in_separate_archive'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
  receiptSha256: sha256,
}).strict();
export type ConstructedSpySourceReceipt = z.infer<typeof receiptSchema>;

const recordSchema = z.object({
  schema: z.literal('gelt.constructed-spy-source-record.v1'),
  owner: ownerSchema,
  originalInputBytes: z.number().int().min(1).max(inputLimit),
  originalInputSha256: sha256,
  originalInputBase64: z.string().min(1).max(base64Limit),
  projection: z.unknown(),
  receipt: receiptSchema,
}).strict();

type Identity = { dev: number; ino: number };
type FileSnapshot = { identity: Identity; bytes: Buffer };
type NamespaceSnapshot = { rootIdentity: Identity; source?: FileSnapshot; pending?: FileSnapshot };
type Prepared = {
  owner: ConstructedSpySourceOwner;
  ownerText: string;
  originalInput: Buffer;
  originalInputSha256: string;
  projection: ProjectedConstructedSpyG05;
  receipt: ConstructedSpySourceReceipt;
  recordBytes: Buffer;
};
type ReadResult = {
  originalInput: Buffer;
  projection: ProjectedConstructedSpyG05;
  receipt: ConstructedSpySourceReceipt;
};

export class ConstructedSpySourceError extends Error {
  constructor(readonly reason: 'invalid_input' | 'unavailable' | 'uncertain') {
    super('constructed SPY source unavailable');
    this.name = 'ConstructedSpySourceError';
  }
}

const error = (reason: ConstructedSpySourceError['reason']) => new ConstructedSpySourceError(reason);
const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
const hashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.GELT_SYNTHETIC_ORDER_HARNESS === 'offline-test-only'
    && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only';
}

function copyOwner(raw: unknown): { value: ConstructedSpySourceOwner; text: string } {
  try {
    const value = ownerSchema.parse(raw);
    const text = canonical(value);
    if (Buffer.byteLength(text, 'utf8') > ownerLimit) throw new Error();
    // Round-trip to sever references to caller-owned mutable objects.
    const copy = ownerSchema.parse(parseResearchJSON(Buffer.from(text, 'utf8')));
    return { value: copy, text: canonical(copy) };
  } catch { throw error('invalid_input'); }
}

function rootIdentity(root: string): Identity {
  if (process.platform !== 'linux' || !process.getuid || root !== resolve(root)
    || Buffer.byteLength(root, 'utf8') > rootPathLimit || fs.realpathSync.native(root) !== root) throw new Error();
  privateDirectory(root);
  if (!localFilesystemTypes.includes(fs.statfsSync(root).type)) throw new Error();
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error();
  return stat;
}

function readFile(root: string, name: string, max: number): FileSnapshot {
  const path = join(root, name);
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid!()
    || (before.mode & 0o777) !== 0o600 || before.size < 1 || before.size > max) throw new Error();
  const bytes = readPrivate(path, max, true);
  const after = fs.lstatSync(path);
  if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
    || !sameIdentity(before, after)) throw new Error();
  return { identity: before, bytes };
}

function snapshot(root: string, state: 'empty' | 'pending' | 'writer' | 'readonly'): NamespaceSnapshot {
  const rootBefore = rootIdentity(root);
  const expected = state === 'empty' ? [] : state === 'pending' ? [pendingName]
    : state === 'writer' ? [sourceName, pendingName] : [sourceName];
  const names = new Set(expected);
  let count = 0, logicalBytes = 0;
  const directory = fs.opendirSync(root);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > 2 || !names.has(entry.name)) throw new Error();
      const info = fs.lstatSync(join(root, entry.name));
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid!()
        || (info.mode & 0o777) !== 0o600 || info.size < 1) throw new Error();
      logicalBytes += info.size;
      if (logicalBytes > namespaceLimit) throw new Error();
      names.delete(entry.name);
    }
  } finally { directory.closeSync(); }
  if (names.size !== 0) throw new Error();
  const source = state === 'writer' || state === 'readonly' ? readFile(root, sourceName, recordLimit) : undefined;
  const pending = state === 'writer' || state === 'pending' ? readFile(root, pendingName, ownerLimit) : undefined;
  logicalBytes = (source?.bytes.length ?? 0) + (pending?.bytes.length ?? 0);
  if (logicalBytes > namespaceLimit) throw new Error();
  const rootAfter = rootIdentity(root);
  if (!sameIdentity(rootBefore, rootAfter)) throw new Error();
  return { rootIdentity: rootAfter, source, pending };
}

function prepare(owner: ConstructedSpySourceOwner, ownerText: string, rawInput: Buffer): Prepared {
  try {
    if (!Buffer.isBuffer(rawInput) || rawInput.length < 1 || rawInput.length > inputLimit) throw new Error();
    const originalInput = Buffer.from(rawInput);
    const originalInputSha256 = hashBytes(originalInput);
    if (owner.originalInputSha256 !== originalInputSha256) throw new Error();
    const projection = projectConstructedSpyG05(originalInput);
    if (projection.status !== 'projected') throw new Error();
    const projectionText = canonical(projection);
    if (Buffer.byteLength(projectionText, 'utf8') > projectionLimit) throw new Error();

    // The projector has successfully validated the exact copied outer bytes.
    // Reparse only those same owned bytes to bind caller-supplied declarations.
    const outer = parseResearchJSON(originalInput);
    if (!isObject(outer) || typeof outer.dailyRequestText !== 'string' || !isObject(outer.consumer)) throw new Error();
    const config = simulationRunSchema.parse(outer.consumer.config);
    const dailyBytes = Buffer.from(outer.dailyRequestText, 'utf8');
    if (dailyBytes.toString('utf8') !== outer.dailyRequestText) throw new Error();
    const daily = parseResearchJSON(dailyBytes);
    if (!isObject(daily)) throw new Error();
    const epochId = ledgerId.parse(daily.epochId);
    const configSha256 = simulationDigest(config);
    const manifest = parseCandidateShadowManifest(projection.manifestText);
    const candidateId = candidateShadowId(manifest);
    if (owner.caseEpochId !== epochId || owner.runId !== config.runId || owner.sourceCommit !== config.sourceCommit
      || owner.configSha256 !== configSha256 || owner.candidateId !== candidateId
      || owner.projectionId !== projection.projectionId) throw new Error();

    const receiptBody = {
      schema: 'gelt.constructed-spy-source-receipt.v1' as const,
      caseEpochId: owner.caseEpochId,
      runId: owner.runId,
      sourceCommit: owner.sourceCommit,
      configSha256: owner.configSha256,
      originalInputBytes: originalInput.length,
      originalInputSha256,
      projectionId: projection.projectionId,
      projectionSha256: digest(projectionText),
      dailyInputSha256: projection.dailyAssessment.inputSha256,
      dailyAssessmentSha256: digest(canonical(projection.dailyAssessment)),
      candidateId,
      manifestSha256: digest(projection.manifestText),
      ruleInputSha256: digest(projection.ruleInputText),
      decisionId: projection.ruleReceipt.decisionId,
      classification: 'constructed_offline_test' as const,
      sourceRetention: 'outer_input_exact_bytes_in_separate_archive' as const,
      marketEvaluation: 'not_established' as const,
      effectAuthority: 'none' as const,
      promotionAllowed: false as const,
    };
    const receipt = receiptSchema.parse({ ...receiptBody, receiptSha256: digest(canonical(receiptBody)) });
    if (Buffer.byteLength(canonical(receipt), 'utf8') > ownerLimit) throw new Error();
    const record = {
      schema: 'gelt.constructed-spy-source-record.v1' as const,
      owner,
      originalInputBytes: originalInput.length,
      originalInputSha256,
      originalInputBase64: originalInput.toString('base64'),
      projection,
      receipt,
    };
    if (record.originalInputBase64.length > base64Limit) throw new Error();
    const recordBytes = Buffer.from(canonical(record), 'utf8');
    if (recordBytes.length > recordLimit) throw new Error();
    return { owner, ownerText, originalInput, originalInputSha256, projection, receipt, recordBytes };
  } catch { throw error('invalid_input'); }
}

function replayRecord(sourceBytes: Buffer, ownerText: string, owner: ConstructedSpySourceOwner): ReadResult {
  try {
    if (sourceBytes.length < 1 || sourceBytes.length > recordLimit) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
    const parsed = parseResearchJSON(sourceBytes);
    if (!isObject(parsed) || canonical(parsed) !== text) throw new Error();
    const record = recordSchema.parse(parsed);
    const recordOwnerText = canonical(record.owner);
    if (recordOwnerText !== ownerText || record.originalInputBytes < 1
      || record.originalInputBytes > inputLimit
      || record.originalInputBase64.length !== 4 * Math.ceil(record.originalInputBytes / 3)) throw new Error();
    const originalInput = Buffer.from(record.originalInputBase64, 'base64');
    if (originalInput.toString('base64') !== record.originalInputBase64 || originalInput.length !== record.originalInputBytes
      || hashBytes(originalInput) !== record.originalInputSha256 || record.originalInputSha256 !== owner.originalInputSha256) throw new Error();
    if (!isObject(record.projection)) throw new Error();
    const prepared = prepare(owner, ownerText, originalInput);
    if (!prepared.recordBytes.equals(sourceBytes)) throw new Error();
    return { originalInput: Buffer.from(originalInput), projection: prepared.projection, receipt: prepared.receipt };
  } catch { throw error('unavailable'); }
}

/** One externally selected case in one already private Linux directory. The
 * archive never reads a path supplied as source input and never changes the
 * existing consumer schema, SQLite store, evaluator or operating defaults. */
export class ConstructedSpySourceStore {
  private closed = false;
  private completedClose = false;
  private poisoned = false;
  private sourceIdentity?: Identity;
  private pendingIdentity?: Identity;
  private artifactSha256?: string;

  private constructor(private readonly root: string, private readonly owner: ConstructedSpySourceOwner,
    private readonly ownerText: string, private readonly writer: boolean, private readonly pinnedRoot: Identity) {}

  static create(root: string, rawOwner: unknown, input: Buffer): ConstructedSpySourceStore {
    if (!fixtureEnabled()) throw error('unavailable');
    const ownerCopy = copyOwner(rawOwner);
    const prepared = prepare(ownerCopy.value, ownerCopy.text, input);
    let rootId: Identity;
    try {
      rootId = rootIdentity(root);
      const initial = snapshot(root, 'empty');
      if (!sameIdentity(rootId, initial.rootIdentity)) throw new Error();
    } catch { throw error('unavailable'); }

    let attemptedFence = false, fenceCreated = false;
    try {
      attemptedFence = true;
      writePrivateNew(join(root, pendingName), Buffer.from(ownerCopy.text, 'utf8'), true);
      fenceCreated = true;
      const fenced = snapshot(root, 'pending');
      if (!sameIdentity(rootId, fenced.rootIdentity) || !fenced.pending?.bytes.equals(Buffer.from(ownerCopy.text, 'utf8'))) throw new Error();
      writePrivateNew(join(root, sourceName), prepared.recordBytes, true);
      const store = new ConstructedSpySourceStore(root, ownerCopy.value, ownerCopy.text, true, rootId);
      const checked = store.loadFresh();
      store.pin(checked);
      return store;
    } catch (cause) {
      if (fenceCreated) throw error('uncertain');
      if (attemptedFence && (cause as NodeJS.ErrnoException).code !== 'EEXIST') throw error('uncertain');
      throw error('unavailable');
    }
  }

  static reopen(root: string, rawOwner: unknown): ConstructedSpySourceStore {
    if (!fixtureEnabled()) throw error('unavailable');
    const ownerCopy = copyOwner(rawOwner);
    try {
      const rootId = rootIdentity(root);
      const store = new ConstructedSpySourceStore(root, ownerCopy.value, ownerCopy.text, false, rootId);
      const checked = store.loadFresh();
      store.pin(checked);
      return store;
    } catch { throw error('unavailable'); }
  }

  private pin(snapshotResult: { result: ReadResult; before: NamespaceSnapshot; after: NamespaceSnapshot }): void {
    const selected = snapshotResult.after;
    if (!selected.source || !sameIdentity(this.pinnedRoot, selected.rootIdentity)
      || this.writer && !selected.pending) throw error(this.writer ? 'uncertain' : 'unavailable');
    this.sourceIdentity = selected.source.identity;
    this.pendingIdentity = selected.pending?.identity;
    this.artifactSha256 = hashBytes(selected.source.bytes);
  }

  private loadFresh(): { result: ReadResult; before: NamespaceSnapshot; after: NamespaceSnapshot } {
    if (this.closed || this.poisoned) throw error('unavailable');
    try {
      if (!fixtureEnabled()) throw error('unavailable');
      const state = this.writer ? 'writer' : 'readonly';
      const before = snapshot(this.root, state);
      if (!sameIdentity(before.rootIdentity, this.pinnedRoot) || !before.source
        || this.writer && !before.pending) throw new Error();
      if (this.sourceIdentity && !sameIdentity(this.sourceIdentity, before.source.identity)) throw new Error();
      if (this.pendingIdentity && (!before.pending || !sameIdentity(this.pendingIdentity, before.pending.identity))) throw new Error();
      if (this.artifactSha256 && hashBytes(before.source.bytes) !== this.artifactSha256) throw new Error();
      if (this.writer && (!before.pending || !before.pending.bytes.equals(Buffer.from(this.ownerText, 'utf8')))) throw new Error();
      const result = replayRecord(before.source.bytes, this.ownerText, this.owner);
      const after = snapshot(this.root, state);
      if (!sameIdentity(before.rootIdentity, after.rootIdentity) || !before.source || !after.source
        || !sameIdentity(before.source.identity, after.source.identity) || !before.source.bytes.equals(after.source.bytes)
        || this.writer && (!before.pending || !after.pending || !sameIdentity(before.pending.identity, after.pending.identity)
          || !before.pending.bytes.equals(after.pending.bytes))) throw new Error();
      if (this.artifactSha256 && hashBytes(after.source.bytes) !== this.artifactSha256) throw new Error();
      return { result, before, after };
    } catch (cause) {
      this.poisoned = true;
      if (cause instanceof ConstructedSpySourceError) throw cause;
      throw error('unavailable');
    }
  }

  read(): ReadResult {
    if (this.closed || this.poisoned || !this.sourceIdentity || !this.artifactSha256) throw error('unavailable');
    return this.loadFresh().result;
  }

  close(): void {
    if (!fixtureEnabled()) {
      this.poisoned = true;
      if (this.writer) this.closed = true;
      throw error(this.writer ? 'uncertain' : 'unavailable');
    }
    if (this.completedClose) return;
    if (!this.writer) { this.closed = true; this.completedClose = true; return; }
    if (this.closed || this.poisoned) throw error('uncertain');
    try {
      this.read();
      // Do not use removePrivate: its directory fsync follows unlink, creating
      // a fallible operation after the close fence is gone.
      syncDirectory(this.root, true);
      fs.unlinkSync(join(this.root, pendingName));
      // No fallible filesystem work follows successful final unlink.
      this.closed = true;
      this.completedClose = true;
    } catch { this.poisoned = true; this.closed = true; throw error('uncertain'); }
  }
}
