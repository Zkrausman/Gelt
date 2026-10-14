// Constructed replay files owned solely by the existing mock LedgerStorage writer.
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, writeFileSync,
  fsyncSync, mkdirSync, renameSync, existsSync, opendirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { shadowSizingInputSchema, shadowSizingProposalSchema, type ShadowSizingInput, type ShadowSizingProposal } from './shadow-sizing-contract.js';
import { matchesShadowSizingProposal } from './shadow-sizing.js';
import { simulationDigest, units, decimal, type SimulationRun } from './synthetic-simulation-economics.js';
import { sizingBindingPolicySchema, sizingEvidenceSchema, sizingReplayManifestSchema,
  type SizingBindingPolicy, type SizingEvidence, type SyntheticRunPreview } from './synthetic-mock-robinhood-contract.js';

export class SizingEvidenceRejected extends Error { constructor() { super('sizing evidence unavailable'); } }
export type EvidenceStage = 'root-parent-sync' | 'policy-file-sync' | 'policy-staging-sync' | 'policy-publish' | 'policy-root-sync'
  | 'artifact-file-sync' | 'artifact-staging-sync' | 'artifact-publish' | 'artifact-root-sync';
const inputLimit = 262144, smallLimit = 8192, totalLimit = 8388608, countLimit = 1000;
const hex = /^[a-f0-9]{64}$/;
function disabled(): void {
  if (process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_ORDER_HARNESS !== 'offline-test-only'
    || process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only') throw new Error('sizing evidence unavailable');
}
function directory(path: string): void {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700 || s.uid !== process.getuid!()) throw new Error('sizing evidence unavailable');
}
function syncDirectory(path: string): void {
  directory(path); const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function boundedFile(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid!() || s.size > limit) throw new Error('sizing evidence unavailable');
    const buffer = Buffer.alloc(s.size + 1); let length = 0;
    while (length < buffer.length) { const n = readSync(fd, buffer, length, buffer.length - length, length); if (!n) break; length += n; }
    const after = fstatSync(fd);
    if (length !== s.size || after.size !== s.size || after.nlink !== 1 || after.mode !== s.mode || after.uid !== s.uid) throw new Error('sizing evidence unavailable');
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}
function names(path: string, max: number): string[] {
  directory(path); const d = opendirSync(path), result: string[] = [];
  try { for (let e = d.readSync(); e; e = d.readSync()) { if (result.length >= max) throw new Error('sizing evidence unavailable'); result.push(e.name); } }
  finally { d.closeSync(); }
  return result;
}
export class SyntheticSizingEvidence {
  readonly policy: SizingBindingPolicy;
  readonly policySha256: string;
  readonly reopened: boolean;
  constructor(readonly root: string, config: SimulationRun, rawPolicy: unknown, fresh: boolean,
    private readonly stageForTest?: (stage: EvidenceStage) => void) {
    disabled(); this.policy = sizingBindingPolicySchema.parse(rawPolicy);
    if (config.classification !== 'constructed_offline_test' || this.policy.configSha256 !== simulationDigest(config)
      || this.policy.runId !== config.runId || this.policy.sourceCommit !== config.sourceCommit) throw new SizingEvidenceRejected();
    decimal(units(this.policy.quantityQuantum, 18), 18);
    this.policySha256 = digest(canonical(this.policy)); this.reopened = !fresh;
    if (!fresh && !existsSync(root)) throw new Error('sizing evidence unavailable');
    if (!existsSync(root)) { mkdirSync(root, { mode: 0o700 }); syncDirectory(dirname(root)); this.stage('root-parent-sync'); }
    this.inventory();
    const path = join(root, 'policy.json'), body = canonical(this.policy);
    if (Buffer.byteLength(body) > smallLimit) throw new SizingEvidenceRejected();
    if (existsSync(path)) {
      if (boundedFile(path, smallLimit).toString('utf8') !== body) throw new Error('sizing evidence unavailable');
    } else {
      if (!fresh || names(root, countLimit + 2).length) throw new Error('sizing evidence unavailable');
      const temp = join(root, `.policy-${randomUUID()}`);
      this.write(temp, body, 'policy-file-sync'); syncDirectory(root); this.stage('policy-staging-sync');
      renameSync(temp, path); this.stage('policy-publish'); syncDirectory(root); this.stage('policy-root-sync');
    }
    this.validatePolicy();
  }
  private stage(stage: EvidenceStage) { this.stageForTest?.(stage); }
  private write(path: string, body: string, stage: EvidenceStage): void {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, body, 'utf8'); fsyncSync(fd); this.stage(stage); } finally { closeSync(fd); }
  }
  private inventory(): { bytes: number; count: number } {
    let bytes = 0, count = 0;
    for (const name of names(this.root, countLimit + 2)) {
      const path = join(this.root, name), s = lstatSync(path);
      if (s.isSymbolicLink()) throw new Error('sizing evidence unavailable');
      if (name === 'policy.json' || /^\.policy-[a-f0-9-]{36}$/.test(name)) {
        if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid!() || s.size > smallLimit) throw new Error('sizing evidence unavailable');
        bytes += s.size;
      } else {
        if (!hex.test(name) && !/^\.staging-[a-f0-9-]{36}$/.test(name)) throw new Error('sizing evidence unavailable');
        if (++count > countLimit) throw new Error('sizing evidence unavailable');
        directory(path);
        for (const child of names(path, 3)) {
          const t = lstatSync(join(path, child)), limit = child === 'input.json' ? inputLimit : smallLimit;
          if (!['input.json', 'proposal.json', 'manifest.json'].includes(child) || !t.isFile() || t.isSymbolicLink()
            || t.nlink !== 1 || (t.mode & 0o777) !== 0o600 || t.uid !== process.getuid!() || t.size > limit) throw new Error('sizing evidence unavailable');
          bytes += t.size;
        }
      }
      if (bytes > totalLimit) throw new Error('sizing evidence unavailable');
    }
    return { bytes, count };
  }
  validatePolicy(): void {
    disabled(); this.inventory();
    if (boundedFile(join(this.root, 'policy.json'), smallLimit).toString('utf8') !== canonical(this.policy)) throw new Error('sizing evidence unavailable');
  }
  private validated(bytes: Buffer, raw: unknown): { input: ShadowSizingInput; proposal: ShadowSizingProposal; text: string } {
    if (!Buffer.isBuffer(bytes) || bytes.length > inputLimit) throw new SizingEvidenceRejected();
    const input = shadowSizingInputSchema.parse(parseResearchJSON(bytes)), proposal = shadowSizingProposalSchema.parse(raw);
    const text = canonical(input);
    if (!matchesShadowSizingProposal(Buffer.from(text), proposal) || proposal.inputValidation !== 'valid'
      || input.config.classification !== 'constructed_offline_test' || proposal.configSha256 !== this.policy.configSha256
      || proposal.runId !== this.policy.runId || proposal.sourceCommit !== this.policy.sourceCommit
      || canonical(input.quantityQuantum) !== canonical(this.policy.quantityQuantum)
      || canonical(input.buyLimitPrice) !== canonical(this.policy.buyLimitPrice)
      || canonical(input.sellLimitPrice) !== canonical(this.policy.sellLimitPrice)
      || Buffer.byteLength(text) > inputLimit || Buffer.byteLength(canonical(proposal)) > smallLimit) throw new SizingEvidenceRejected();
    return { input, proposal, text };
  }
  prepare(bytes: Buffer, raw: unknown): SizingEvidence {
    this.validatePolicy(); if (this.reopened) throw new SizingEvidenceRejected();
    const { input, proposal, text } = this.validated(bytes, raw), proposalText = canonical(proposal);
    const manifest = sizingReplayManifestSchema.parse({ schema: 'gelt.synthetic-sizing-replay-evidence.v1', version: 1,
      classification: 'constructed_offline_test', runId: input.config.runId, sourceCommit: input.config.sourceCommit,
      configSha256: proposal.configSha256, portfolioSnapshotSha256: proposal.portfolioSnapshotSha256,
      decisionId: proposal.ruleDecisionId, policyId: this.policy.sizingPolicyId, policySha256: this.policySha256,
      proposalId: proposal.proposalId, inputSha256: digest(text), proposalSha256: digest(proposalText),
      inputBytes: Buffer.byteLength(text), proposalBytes: Buffer.byteLength(proposalText) });
    const manifestText = canonical(manifest), key = digest(manifestText);
    const link = sizingEvidenceSchema.parse({ version: 1, policyId: manifest.policyId, policySha256: manifest.policySha256,
      proposalId: manifest.proposalId, sizingInputSha256: manifest.inputSha256, proposalSha256: manifest.proposalSha256, evidenceManifestSha256: key });
    const target = join(this.root, key);
    if (existsSync(target)) { this.read(link); return link; }
    const inventory = this.inventory();
    if (inventory.count >= countLimit || inventory.bytes + Buffer.byteLength(text + proposalText + manifestText) > totalLimit
      || Buffer.byteLength(manifestText) > smallLimit) throw new SizingEvidenceRejected();
    const staging = join(this.root, `.staging-${randomUUID()}`); mkdirSync(staging, { mode: 0o700 });
    this.write(join(staging, 'input.json'), text, 'artifact-file-sync');
    this.write(join(staging, 'proposal.json'), proposalText, 'artifact-file-sync');
    this.write(join(staging, 'manifest.json'), manifestText, 'artifact-file-sync');
    syncDirectory(staging); this.stage('artifact-staging-sync'); renameSync(staging, target); this.stage('artifact-publish');
    syncDirectory(this.root); this.stage('artifact-root-sync'); this.read(link); return link;
  }
  read(rawLink: unknown): { input: ShadowSizingInput; proposal: ShadowSizingProposal } {
    this.validatePolicy(); const link = sizingEvidenceSchema.parse(rawLink), path = join(this.root, link.evidenceManifestSha256);
    if (names(path, 3).sort().join(',') !== 'input.json,manifest.json,proposal.json') throw new Error('sizing evidence unavailable');
    const manifestBytes = boundedFile(join(path, 'manifest.json'), smallLimit);
    const manifest = sizingReplayManifestSchema.parse(parseResearchJSON(manifestBytes));
    if (canonical(manifest) !== manifestBytes.toString('utf8') || digest(canonical(manifest)) !== link.evidenceManifestSha256) throw new Error('sizing evidence unavailable');
    const bytes = boundedFile(join(path, 'input.json'), inputLimit), proposalBytes = boundedFile(join(path, 'proposal.json'), smallLimit);
    if (bytes.length !== manifest.inputBytes || proposalBytes.length !== manifest.proposalBytes || digest(bytes.toString('utf8')) !== manifest.inputSha256
      || digest(proposalBytes.toString('utf8')) !== manifest.proposalSha256) throw new Error('sizing evidence unavailable');
    const { input, proposal, text } = this.validated(bytes, parseResearchJSON(proposalBytes));
    if (text !== bytes.toString('utf8') || canonical(proposal) !== proposalBytes.toString('utf8')
      || manifest.runId !== input.config.runId || manifest.sourceCommit !== input.config.sourceCommit
      || manifest.configSha256 !== proposal.configSha256 || manifest.portfolioSnapshotSha256 !== proposal.portfolioSnapshotSha256
      || manifest.decisionId !== proposal.ruleDecisionId || manifest.policyId !== link.policyId || manifest.policySha256 !== this.policySha256
      || link.policySha256 !== this.policySha256 || manifest.proposalId !== proposal.proposalId || link.proposalId !== proposal.proposalId
      || link.sizingInputSha256 !== manifest.inputSha256 || link.proposalSha256 !== manifest.proposalSha256) throw new Error('sizing evidence unavailable');
    return { input, proposal };
  }
  verifyPreview(preview: SyntheticRunPreview): void {
    if (!preview.sizingEvidence) throw new Error('sizing evidence unavailable');
    const { input, proposal } = this.read(preview.sizingEvidence);
    if (proposal.outcome !== 'proposal' || proposal.side !== preview.order.side || canonical(proposal.quantity) !== canonical(preview.order.quantity)
      || canonical(proposal.hypothetical?.orderLimit) !== canonical(preview.order.limitPrice)
      || proposal.runId !== preview.runId || proposal.configSha256 !== preview.configSha256 || proposal.sourceCommit !== preview.sourceCommit
      || proposal.portfolioSnapshotSha256 !== preview.portfolioSnapshotSha256 || proposal.ruleDecisionId !== preview.decisionId
      || input.ruleReceipt.inputSha256 !== preview.inputSha256 || input.ruleReceipt.decisionAt !== preview.decisionAt
      || canonical(input.observation) !== canonical({ referencePrice: preview.quote.referencePrice, observedAt: preview.quote.observedAt,
        availableAt: preview.quote.availableAt, evidenceSha256: preview.quote.evidenceSha256 })
      || canonical(proposal.hypothetical?.modeledFillPrice) !== canonical(preview.quote.price)) throw new Error('sizing evidence unavailable');
  }
}
