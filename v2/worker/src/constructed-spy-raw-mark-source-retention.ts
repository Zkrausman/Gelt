// Retain one complete constructed raw-mark request and its freshly replayed
// PR77 result in a separate, fixed synthetic archive. This is not source
// authentication, provider admission, or order authority.
import fsMutable from 'node:fs';
import type { Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { ledgerId } from './ledger-contract.js';
import { parseResearchJSON } from './research-json.js';
import { privateDirectory, readPrivate, syncDirectory, writePrivateNew } from './private-files.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { simulationDigest, simulationRunSchema } from './synthetic-simulation-economics.js';
import {
  projectConstructedSpyRawMark,
  type ConstructedSpyRawMarkResult,
} from './constructed-spy-raw-mark.js';

const inputLimit = 1_048_576;
const base64Limit = 1_398_104;
const resultLimit = 3_145_728;
const ownerLimit = 8_192;
const receiptLimit = 8_192;
const recordLimit = 5_242_880;
const namespaceLimit = 5_251_072;
const rootPathLimit = 3_000;
const sourceName = 'raw-mark-source.json';
const pendingName = '.raw-mark-source.pending';
const localFilesystemTypes = [0xef53, 0x58465342, 0x9123683e, 0x794c7630];
function fullMatch(value: string, pattern: RegExp): boolean {
  return pattern.exec(value)?.[0] === value;
}
const sha256 = z.string().refine(value => fullMatch(value, /^[a-f0-9]{64}/));
const sourceCommit = z.string().refine(value => fullMatch(value, /^[a-f0-9]{40}/));
const bindingId = z.string().refine(value => fullMatch(value, /^constructed-spy-mark-g05-[a-f0-9]{64}/));
const projectionId = z.string().refine(value => fullMatch(value, /^constructed-spy-g05-[a-f0-9]{64}/));
const candidateId = z.string().refine(value => fullMatch(value, /^candidate-shadow-[a-f0-9]{64}/));
const decisionId = z.string().refine(value => fullMatch(value, /^shadow-decision-[a-f0-9]{64}/));

const ownerSchema = z.object({
  schema: z.literal('gelt.constructed-spy-raw-mark-source-owner.v1'),
  caseEpochId: ledgerId.length(36),
  runId: ledgerId.length(36),
  sourceCommit,
  configSha256: sha256,
  bindingId,
  projectionId,
  candidateId,
  originalInputSha256: sha256,
}).strict();
export type ConstructedSpyRawMarkSourceOwner = z.infer<typeof ownerSchema>;

const receiptSchema = z.object({
  schema: z.literal('gelt.constructed-spy-raw-mark-source-receipt.v1'),
  caseEpochId: ledgerId.length(36),
  runId: ledgerId.length(36),
  sourceCommit,
  configSha256: sha256,
  originalInputBytes: z.number().int().safe().min(1).max(inputLimit),
  originalInputSha256: sha256,
  bindingId,
  resultSha256: sha256,
  projectionId,
  projectionSha256: sha256,
  dailyRequestTextSha256: sha256,
  dailyAssessmentSha256: sha256,
  markSha256: sha256,
  markEvidenceSha256: sha256,
  candidateId,
  manifestSha256: sha256,
  ruleInputSha256: sha256,
  decisionId,
  classification: z.literal('constructed_offline_test'),
  sourceRetention: z.literal('outer_raw_mark_input_exact_bytes_in_separate_archive'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
  receiptSha256: sha256,
}).strict();
export type ConstructedSpyRawMarkSourceReceipt = z.infer<typeof receiptSchema>;

const recordSchema = z.object({
  schema: z.literal('gelt.constructed-spy-raw-mark-source-record.v1'),
  owner: ownerSchema,
  originalInputBytes: z.number().int().safe().min(1).max(inputLimit),
  originalInputSha256: sha256,
  originalInputBase64: z.string().min(1).max(base64Limit),
  result: z.unknown(),
  receipt: receiptSchema,
}).strict();

type Identity = { dev: number; ino: number; uid: number; mode: number };
type FileSnapshot = {
  identity: Identity;
  bytes: Buffer;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};
type NamespaceSnapshot = { rootIdentity: Identity; source?: FileSnapshot; pending?: FileSnapshot };
type ProjectedRawMark = Extract<ConstructedSpyRawMarkResult, { status: 'projected' }>;
export type ConstructedSpyRawMarkSourceReadResult = {
  originalInput: Buffer;
  result: ProjectedRawMark;
  receipt: ConstructedSpyRawMarkSourceReceipt;
};
type Prepared = ConstructedSpyRawMarkSourceReadResult & {
  owner: ConstructedSpyRawMarkSourceOwner;
  ownerText: string;
  originalInputSha256: string;
  recordBytes: Buffer;
};

export class ConstructedSpyRawMarkSourceError extends Error {
  constructor(readonly reason: 'invalid_input' | 'unavailable' | 'uncertain') {
    super('constructed SPY raw-mark source unavailable');
    this.name = 'ConstructedSpyRawMarkSourceError';
  }
}

const error = (reason: ConstructedSpyRawMarkSourceError['reason']) => new ConstructedSpyRawMarkSourceError(reason);
const sha256Bytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sameIdentity = (left: Identity, right: Identity) =>
  left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.mode === right.mode;

function finiteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value !== null && typeof value === 'object') return Object.values(value).every(finiteNumbers);
  return true;
}

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.GELT_SYNTHETIC_ORDER_HARNESS === 'offline-test-only'
    && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only';
}

function copyOwner(raw: unknown): { value: ConstructedSpyRawMarkSourceOwner; text: string } {
  try {
    if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > ownerLimit) throw new Error();
    const owned = Buffer.from(raw);
    const parsed = parseResearchJSON(owned);
    if (!finiteNumbers(parsed)) throw new Error();
    const value = ownerSchema.parse(parsed);
    const text = canonical(value);
    if (Buffer.byteLength(text, 'utf8') > ownerLimit) throw new Error();
    const copy = ownerSchema.parse(parseResearchJSON(Buffer.from(text, 'utf8')));
    return { value: copy, text: canonical(copy) };
  } catch { throw error('invalid_input'); }
}

function identity(stat: Stats): Identity {
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o777 };
}

function rootIdentity(root: string): Identity {
  if (process.platform !== 'linux' || !process.getuid || root !== resolve(root)
    || Buffer.byteLength(root, 'utf8') > rootPathLimit || fsMutable.realpathSync.native(root) !== root) throw new Error();
  privateDirectory(root);
  if (!localFilesystemTypes.includes(fsMutable.statfsSync(root).type)) throw new Error();
  const stat = fsMutable.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error();
  return identity(stat);
}

function sameFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.uid === after.uid
    && (before.mode & 0o777) === (after.mode & 0o777) && before.nlink === after.nlink
    && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

function readFile(root: string, name: string, max: number): FileSnapshot {
  const path = join(root, name);
  const before = fsMutable.lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid!()
    || (before.mode & 0o777) !== 0o600 || before.size < 1 || before.size > max) throw new Error();
  const bytes = readPrivate(path, max, true);
  const after = fsMutable.lstatSync(path);
  if (!sameFile(before, after) || bytes.length !== before.size) throw new Error();
  return {
    identity: identity(before), bytes, size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs,
  };
}

function snapshot(root: string, state: 'empty' | 'pending' | 'writer' | 'readonly'): NamespaceSnapshot {
  const rootBefore = rootIdentity(root);
  const expected = state === 'empty' ? [] : state === 'pending' ? [pendingName]
    : state === 'writer' ? [sourceName, pendingName] : [sourceName];
  const names = new Set(expected);
  let count = 0, logicalBytes = 0;
  const directory = fsMutable.opendirSync(root);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > 2 || !names.has(entry.name)) throw new Error();
      const info = fsMutable.lstatSync(join(root, entry.name));
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
  logicalBytes = (source?.size ?? 0) + (pending?.size ?? 0);
  if (logicalBytes > namespaceLimit) throw new Error();
  const rootAfter = rootIdentity(root);
  if (!sameIdentity(rootBefore, rootAfter)) throw new Error();
  return { rootIdentity: rootAfter, source, pending };
}

function prepare(owner: ConstructedSpyRawMarkSourceOwner, ownerText: string, rawInput: Buffer): Prepared {
  try {
    if (!Buffer.isBuffer(rawInput) || rawInput.length < 1 || rawInput.length > inputLimit) throw new Error();
    const originalInput = Buffer.from(rawInput);
    const originalInputSha256 = sha256Bytes(originalInput);
    if (owner.originalInputSha256 !== originalInputSha256) throw new Error();
    const projected = projectConstructedSpyRawMark(originalInput);
    if (projected.status !== 'projected') throw new Error();
    const resultText = canonical(projected);
    if (Buffer.byteLength(resultText, 'utf8') > resultLimit) throw new Error();
    const projection = projected.projection;
    const outer = parseResearchJSON(originalInput);
    if (!isObject(outer) || typeof outer.dailyRequestText !== 'string' || !isObject(outer.consumer)) throw new Error();
    const daily = parseResearchJSON(Buffer.from(outer.dailyRequestText, 'utf8'));
    if (!isObject(daily)) throw new Error();
    const epochId = ledgerId.parse(daily.epochId);
    const config = simulationRunSchema.parse(outer.consumer.config);
    const configSha256 = simulationDigest(config);
    const manifest = parseCandidateShadowManifest(projection.manifestText);
    const selectedCandidateId = candidateShadowId(manifest);
    if (owner.caseEpochId !== epochId || owner.runId !== config.runId || owner.sourceCommit !== config.sourceCommit
      || owner.configSha256 !== configSha256 || owner.bindingId !== projected.bindingId
      || owner.projectionId !== projection.projectionId || owner.candidateId !== selectedCandidateId) throw new Error();

    const receiptBody = {
      schema: 'gelt.constructed-spy-raw-mark-source-receipt.v1' as const,
      caseEpochId: owner.caseEpochId,
      runId: owner.runId,
      sourceCommit: owner.sourceCommit,
      configSha256: owner.configSha256,
      originalInputBytes: originalInput.length,
      originalInputSha256,
      bindingId: projected.bindingId,
      resultSha256: digest(resultText),
      projectionId: projection.projectionId,
      projectionSha256: digest(canonical(projection)),
      dailyRequestTextSha256: projected.dailyRequestTextSha256,
      dailyAssessmentSha256: digest(canonical(projection.dailyAssessment)),
      markSha256: projected.markSha256,
      markEvidenceSha256: projected.markEvidenceSha256,
      candidateId: selectedCandidateId,
      manifestSha256: digest(projection.manifestText),
      ruleInputSha256: digest(projection.ruleInputText),
      decisionId: projection.ruleReceipt.decisionId,
      classification: 'constructed_offline_test' as const,
      sourceRetention: 'outer_raw_mark_input_exact_bytes_in_separate_archive' as const,
      marketEvaluation: 'not_established' as const,
      effectAuthority: 'none' as const,
      promotionAllowed: false as const,
    };
    const receipt = receiptSchema.parse({ ...receiptBody, receiptSha256: digest(canonical(receiptBody)) });
    if (Buffer.byteLength(canonical(receipt), 'utf8') > receiptLimit) throw new Error();
    const record = {
      schema: 'gelt.constructed-spy-raw-mark-source-record.v1' as const,
      owner,
      originalInputBytes: originalInput.length,
      originalInputSha256,
      originalInputBase64: originalInput.toString('base64'),
      result: projected,
      receipt,
    };
    if (record.originalInputBase64.length > base64Limit) throw new Error();
    const recordBytes = Buffer.from(canonical(record), 'utf8');
    if (recordBytes.length > recordLimit) throw new Error();
    return { owner, ownerText, originalInput, originalInputSha256, result: projected, receipt, recordBytes };
  } catch { throw error('invalid_input'); }
}

function replayRecord(sourceBytes: Buffer, ownerText: string, owner: ConstructedSpyRawMarkSourceOwner): ConstructedSpyRawMarkSourceReadResult {
  try {
    if (sourceBytes.length < 1 || sourceBytes.length > recordLimit) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
    const parsed = parseResearchJSON(sourceBytes);
    if (!finiteNumbers(parsed) || !isObject(parsed) || canonical(parsed) !== text) throw new Error();
    const record = recordSchema.parse(parsed);
    if (canonical(record.owner) !== ownerText || record.originalInputBytes < 1
      || record.originalInputBytes > inputLimit
      || record.originalInputBase64.length !== 4 * Math.ceil(record.originalInputBytes / 3)) throw new Error();
    const originalInput = Buffer.from(record.originalInputBase64, 'base64');
    if (originalInput.toString('base64') !== record.originalInputBase64 || originalInput.length !== record.originalInputBytes
      || sha256Bytes(originalInput) !== record.originalInputSha256 || record.originalInputSha256 !== owner.originalInputSha256) throw new Error();
    const prepared = prepare(owner, ownerText, originalInput);
    if (!prepared.recordBytes.equals(sourceBytes)) throw new Error();
    return {
      originalInput: Buffer.from(prepared.originalInput),
      result: prepared.result,
      receipt: receiptSchema.parse(parseResearchJSON(Buffer.from(canonical(prepared.receipt), 'utf8'))),
    };
  } catch { throw error('unavailable'); }
}

/** One externally selected constructed case in one already-private Linux directory. */
export class ConstructedSpyRawMarkSourceStore {
  private closed = false;
  private completedClose = false;
  private poisoned = false;
  private sourceIdentity?: FileSnapshot;
  private pendingIdentity?: FileSnapshot;
  private artifactSha256?: string;

  private constructor(private readonly root: string, private readonly owner: ConstructedSpyRawMarkSourceOwner,
    private readonly ownerText: string, private readonly writer: boolean, private readonly pinnedRoot: Identity) {}

  static create(root: string, ownerBytes: Buffer, input: Buffer): ConstructedSpyRawMarkSourceStore {
    if (!fixtureEnabled()) throw error('unavailable');
    const copiedOwner = copyOwner(ownerBytes);
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > inputLimit) throw error('invalid_input');
    const ownedInput = Buffer.from(input);
    const prepared = prepare(copiedOwner.value, copiedOwner.text, ownedInput);
    let rootId: Identity;
    try {
      rootId = rootIdentity(root);
      const initial = snapshot(root, 'empty');
      if (!sameIdentity(rootId, initial.rootIdentity)) throw new Error();
    } catch { throw error('unavailable'); }

    let attemptedFence = false, fenceCreated = false;
    try {
      attemptedFence = true;
      writePrivateNew(join(root, pendingName), Buffer.from(copiedOwner.text, 'utf8'), true);
      fenceCreated = true;
      const fenced = snapshot(root, 'pending');
      if (!sameIdentity(rootId, fenced.rootIdentity) || !fenced.pending?.bytes.equals(Buffer.from(copiedOwner.text, 'utf8'))) throw new Error();
      writePrivateNew(join(root, sourceName), prepared.recordBytes, true);
      const store = new ConstructedSpyRawMarkSourceStore(root, copiedOwner.value, copiedOwner.text, true, rootId);
      const checked = store.loadFresh();
      store.pin(checked);
      return store;
    } catch (cause) {
      if (fenceCreated) throw error('uncertain');
      if (attemptedFence && (cause as NodeJS.ErrnoException).code !== 'EEXIST') throw error('uncertain');
      throw error('unavailable');
    }
  }

  static reopen(root: string, ownerBytes: Buffer): ConstructedSpyRawMarkSourceStore {
    if (!fixtureEnabled()) throw error('unavailable');
    const copiedOwner = copyOwner(ownerBytes);
    try {
      const rootId = rootIdentity(root);
      const store = new ConstructedSpyRawMarkSourceStore(root, copiedOwner.value, copiedOwner.text, false, rootId);
      const checked = store.loadFresh();
      store.pin(checked);
      return store;
    } catch { throw error('unavailable'); }
  }

  private pin(checked: { result: ConstructedSpyRawMarkSourceReadResult; before: NamespaceSnapshot; after: NamespaceSnapshot }): void {
    const selected = checked.after;
    if (!selected.source || !sameIdentity(this.pinnedRoot, selected.rootIdentity)
      || this.writer && !selected.pending) throw error(this.writer ? 'uncertain' : 'unavailable');
    this.sourceIdentity = selected.source;
    this.pendingIdentity = selected.pending;
    this.artifactSha256 = sha256Bytes(selected.source.bytes);
  }

  private loadFresh(): { result: ConstructedSpyRawMarkSourceReadResult; before: NamespaceSnapshot; after: NamespaceSnapshot } {
    if (this.closed || this.poisoned) throw error('unavailable');
    try {
      if (!fixtureEnabled()) throw error('unavailable');
      const state = this.writer ? 'writer' : 'readonly';
      const before = snapshot(this.root, state);
      if (!sameIdentity(before.rootIdentity, this.pinnedRoot) || !before.source
        || this.writer && !before.pending) throw new Error();
      if (this.sourceIdentity && (!before.source || !sameIdentity(this.sourceIdentity.identity, before.source.identity)
        || this.sourceIdentity.mtimeMs !== before.source.mtimeMs || this.sourceIdentity.ctimeMs !== before.source.ctimeMs
        || this.sourceIdentity.size !== before.source.size)) throw new Error();
      if (this.pendingIdentity && (!before.pending || !sameIdentity(this.pendingIdentity.identity, before.pending.identity)
        || this.pendingIdentity.mtimeMs !== before.pending.mtimeMs || this.pendingIdentity.ctimeMs !== before.pending.ctimeMs
        || this.pendingIdentity.size !== before.pending.size)) throw new Error();
      if (this.artifactSha256 && sha256Bytes(before.source.bytes) !== this.artifactSha256) throw new Error();
      if (this.writer && (!before.pending || !before.pending.bytes.equals(Buffer.from(this.ownerText, 'utf8')))) throw new Error();
      const result = replayRecord(before.source.bytes, this.ownerText, this.owner);
      const after = snapshot(this.root, state);
      if (!sameIdentity(before.rootIdentity, after.rootIdentity) || !before.source || !after.source
        || !sameIdentity(before.source.identity, after.source.identity) || before.source.size !== after.source.size
        || before.source.mtimeMs !== after.source.mtimeMs || before.source.ctimeMs !== after.source.ctimeMs
        || !before.source.bytes.equals(after.source.bytes)
        || this.writer && (!before.pending || !after.pending || !sameIdentity(before.pending.identity, after.pending.identity)
          || before.pending.size !== after.pending.size || before.pending.mtimeMs !== after.pending.mtimeMs
          || before.pending.ctimeMs !== after.pending.ctimeMs || !before.pending.bytes.equals(after.pending.bytes))) throw new Error();
      if (this.artifactSha256 && sha256Bytes(after.source.bytes) !== this.artifactSha256) throw new Error();
      return { result, before, after };
    } catch {
      this.poisoned = true;
      throw error('unavailable');
    }
  }

  read(): ConstructedSpyRawMarkSourceReadResult {
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
      syncDirectory(this.root, true);
      fsMutable.unlinkSync(join(this.root, pendingName));
      this.closed = true;
      this.completedClose = true;
    } catch {
      this.poisoned = true;
      this.closed = true;
      throw error('uncertain');
    }
  }
}
