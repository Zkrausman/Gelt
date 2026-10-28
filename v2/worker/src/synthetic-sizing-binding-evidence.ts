// Constructed replay files owned solely by the existing mock LedgerStorage writer.
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, writeFileSync,
  fsyncSync, mkdirSync, renameSync, existsSync, opendirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from './ledger-canonical.js';
import { assertCandidateShadowBinding, candidateShadowId } from './candidate-shadow-contract.js';
import { parseResearchJSON } from './research-json.js';
import { shadowSizingInputSchema, shadowSizingProposalSchema, type ShadowSizingInput, type ShadowSizingProposal } from './shadow-sizing-contract.js';
import { matchesShadowSizingProposal } from './shadow-sizing.js';
import { simulationDigest, units, decimal, type SimulationRun } from './synthetic-simulation-economics.js';
import { sizingBindingPolicySchema, sizingEvidenceSchema, sizingReplayManifestSchema,
  type SizingBindingPolicy, type SizingEvidence, type SyntheticRunPreview } from './synthetic-mock-robinhood-contract.js';
import { resolve } from 'node:path';
import { privateDirectory } from './private-files.js';
import { simulationRunSchema, checkObservation } from './synthetic-simulation-economics.js';
import {
  pamrConsumerInputSchema, pamrConsumerProposalSchema,
  type PAMRConsumerInput, type PAMRConsumerProposal,
} from './pamr-consumer-contract.js';
import { matchesPAMRConsumerProposal } from './pamr-consumer-adapter.js';
import {
  pamrConsumptionBounds, pamrConsumptionDisclosure,
  pamrConsumptionOwnerPolicySchema, pamrConsumptionManifestSchema,
  pamrConsumptionEvidenceLinkSchema, configuredPAMROwnerPolicySha256,
  pamrConsumptionManifestSha256, pamrConsumptionLink,
  type PAMRConsumptionOwnerPolicy, type PAMRConfiguredOwnerPolicySha256,
  type PAMRConsumptionManifest, type PAMRConsumptionEvidenceLink,
  type PAMRConsumptionRejection,
} from './pamr-consumer-evidence-contract.js';

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
    if (this.policy.candidate) {
      try { assertCandidateShadowBinding(this.policy.candidate, input.ruleInput, input.config); }
      catch { throw new SizingEvidenceRejected(); }
    }
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
      inputBytes: Buffer.byteLength(text), proposalBytes: Buffer.byteLength(proposalText),
      ...(this.policy.candidate ? { candidateId: candidateShadowId(this.policy.candidate) } : {}) });
    const manifestText = canonical(manifest), key = digest(manifestText);
    const link = sizingEvidenceSchema.parse({ version: 1, policyId: manifest.policyId, policySha256: manifest.policySha256,
      proposalId: manifest.proposalId, sizingInputSha256: manifest.inputSha256, proposalSha256: manifest.proposalSha256, evidenceManifestSha256: key,
      ...(manifest.candidateId ? { candidateId: manifest.candidateId } : {}) });
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
    const expectedCandidateId = this.policy.candidate ? candidateShadowId(this.policy.candidate) : undefined;
    if (manifest.candidateId !== expectedCandidateId || link.candidateId !== expectedCandidateId) throw new Error('sizing evidence unavailable');
    // Candidate identity is separate from every pre-existing digest role.
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

// A normal rejection is distinguishable only before any persistence mutation.
export class PAMRConsumptionRejected extends SizingEvidenceRejected {
  constructor(readonly reason: PAMRConsumptionRejection) { super(); }
}

export type PAMRConsumptionReplay = {
  input: PAMRConsumerInput;
  proposal: PAMRConsumerProposal;
  manifest: PAMRConsumptionManifest;
};
type PAMRValidated = {
  input: PAMRConsumerInput;
  proposal: PAMRConsumerProposal;
  text: string;
  proposalText: string;
};
type PAMRStored = PAMRConsumptionReplay & { link: PAMRConsumptionEvidenceLink };

// Internal helper in the existing owner's evidence family. The caller must
// later supply the active MockStore ownership/lifecycle fences around every
// operation. Neither a path nor a hash establishes that ownership.
export class PAMRConsumptionEvidence {
  private readonly rootPath: string;
  private readonly policyBody: string;
  private readonly configBody: string;
  private readonly ownerPolicyDigest: PAMRConfiguredOwnerPolicySha256;
  private readonly readonlyReopen: boolean;
  private failed = false;
  private writing = false;

  get root(): string { return this.rootPath; }
  get policy(): PAMRConsumptionOwnerPolicy {
    return pamrConsumptionOwnerPolicySchema.parse(parseResearchJSON(Buffer.from(this.policyBody)));
  }
  get policySha256(): PAMRConfiguredOwnerPolicySha256 { return this.ownerPolicyDigest; }
  get reopened(): boolean { return this.readonlyReopen; }
  get lastConsumption(): PAMRConsumptionEvidenceLink | null {
    const records = this.replayed().records;
    return records.at(-1)?.link ?? null;
  }

  constructor(root: string, config: SimulationRun, rawPolicy: unknown, fresh: boolean,
    private readonly stageForTest?: (stage: EvidenceStage) => void) {
    disabled();
    let policy: PAMRConsumptionOwnerPolicy, checkedConfig: SimulationRun;
    try {
      if (process.platform !== 'linux' || typeof root !== 'string'
        || root !== resolve(root) || typeof fresh !== 'boolean'
        || (stageForTest !== undefined && typeof stageForTest !== 'function')) {
        throw new Error();
      }
      checkedConfig = simulationRunSchema.parse(config);
      policy = pamrConsumptionOwnerPolicySchema.parse(rawPolicy);
      if (checkedConfig.classification !== 'constructed_offline_test'
        || policy.runId !== checkedConfig.runId
        || policy.sourceCommit !== checkedConfig.sourceCommit
        || policy.configSha256 !== simulationDigest(checkedConfig)) throw new Error();
      this.policyBody = canonical(policy);
      this.configBody = canonical(checkedConfig);
      if (Buffer.byteLength(this.policyBody) > smallLimit) throw new Error();
      this.ownerPolicyDigest = configuredPAMROwnerPolicySha256(policy);
    } catch { throw new PAMRConsumptionRejected('invalid_input'); }
    this.rootPath = root;
    this.readonlyReopen = !fresh;
    try {
      // Check the private parent and all ancestors before creating anything.
      privateDirectory(dirname(root));
      if (existsSync(root)) {
        privateDirectory(root);
        // Even an empty directory may be the retained result of an uncertain
        // initial publication. A fresh owner must never reuse that path.
        if (fresh) throw new Error();
      } else {
        if (!fresh) throw new Error();
        mkdirSync(root, { mode: 0o700 });
        syncDirectory(dirname(root)); this.stage('root-parent-sync');
      }
      const path = join(root, 'policy.json');
      if (fresh) {
        if (existsSync(path)) throw new Error();
        const temp = join(root, `.policy-${randomUUID()}`);
        this.writeNew(temp, this.policyBody, 'policy-file-sync');
        syncDirectory(root); this.stage('policy-staging-sync');
        if (existsSync(path)) throw new Error();
        renameSync(temp, path); this.stage('policy-publish');
        syncDirectory(root); this.stage('policy-root-sync');
      }
      this.replay();
    } catch { this.unavailable(); }
  }

  private unavailable(): never {
    this.failed = true;
    throw new Error('PAMR consumption evidence unavailable');
  }
  private ready(): void {
    if (this.failed || this.writing) this.unavailable();
    try { disabled(); } catch { this.unavailable(); }
  }
  private stage(stage: EvidenceStage): void { this.stageForTest?.(stage); }
  private writeNew(path: string, body: string, stage: EvidenceStage): void {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, body, 'utf8');
      fsyncSync(fd);
      this.stage(stage);
    } finally { closeSync(fd); }
  }

  private inventory(): { keys: string[]; bytes: number } {
    privateDirectory(this.rootPath);
    const entries = names(this.rootPath, pamrConsumptionBounds.records + 2);
    if (!entries.includes('policy.json')) throw new Error();
    const keys: string[] = [];
    let bytes = 0;
    const fileSize = (path: string, limit: number): number => {
      const s = lstatSync(path);
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1
        || s.uid !== process.getuid!() || (s.mode & 0o777) !== 0o600
        || !Number.isSafeInteger(s.size) || s.size <= 0 || s.size > limit) throw new Error();
      return s.size;
    };
    for (const name of entries) {
      const path = join(this.rootPath, name);
      if (name === 'policy.json') {
        bytes += fileSize(path, smallLimit);
      } else {
        // Staging files/directories are retained as uncertainty, never recovered
        // or silently excluded from replay. Unknown entries also fail closed.
        if (!hex.test(name) || keys.length >= pamrConsumptionBounds.records) throw new Error();
        directory(path);
        if (names(path, 3).sort().join(',') !== 'input.json,manifest.json,proposal.json') throw new Error();
        bytes += fileSize(join(path, 'input.json'), inputLimit);
        bytes += fileSize(join(path, 'proposal.json'), smallLimit);
        bytes += fileSize(join(path, 'manifest.json'), smallLimit);
        keys.push(name);
      }
      if (bytes > totalLimit) throw new Error();
    }
    return { keys, bytes };
  }

  private validated(bytes: Buffer, rawProposal: unknown): PAMRValidated {
    try {
      if (!Buffer.isBuffer(bytes)) throw new PAMRConsumptionRejected('invalid_input');
      if (bytes.length > inputLimit) throw new PAMRConsumptionRejected('resource_limit');
      const input = pamrConsumerInputSchema.parse(parseResearchJSON(bytes));
      const text = canonical(input);
      // Canonical outer input is mandatory. Embedded artifact text is verified
      // by the pure consumer; lexical artifact variants cannot change ordinal use.
      if (text !== bytes.toString('utf8')) throw new PAMRConsumptionRejected('invalid_input');
      const proposal = pamrConsumerProposalSchema.parse(rawProposal);
      const proposalText = canonical(proposal);
      if (Buffer.byteLength(text) > inputLimit || Buffer.byteLength(proposalText) > smallLimit) {
        throw new PAMRConsumptionRejected('resource_limit');
      }
      if (!matchesPAMRConsumerProposal(text, proposalText)) throw new PAMRConsumptionRejected('binding_mismatch');
      const policy = this.policy;
      if (canonical(input.config) !== this.configBody
        || input.binding.runId !== policy.runId
        || input.binding.sourceCommit !== policy.sourceCommit
        || input.binding.configSha256 !== policy.configSha256
        || input.binding.policySha256 !== policy.purePolicyDefinitionSha256
        || canonical(input.quantityQuantum) !== canonical(policy.quantityQuantum)
        || canonical(input.buyLimitPrice) !== canonical(policy.buyLimitPrice)
        || canonical(input.sellLimitPrice) !== canonical(policy.sellLimitPrice)) {
        throw new PAMRConsumptionRejected('binding_mismatch');
      }
      try {
        const prefix = Date.parse(input.prefixAvailableAt);
        const decision = Date.parse(input.decisionAt);
        const evaluation = Date.parse(input.evaluationAt);
        if (![prefix, decision, evaluation].every(t => Number.isSafeInteger(t) && t >= 0)
          || prefix >= decision || decision > evaluation) throw new Error();
        // Check clocks even when lifecycle/portfolio hypotheses made the pure
        // decision abstain before its own clock branch.
        checkObservation(input.config, input.decisionAt, input.observation, evaluation);
      } catch { throw new PAMRConsumptionRejected('invalid_clock'); }
      return { input, proposal, text, proposalText };
    } catch (error) {
      if (error instanceof PAMRConsumptionRejected) throw error;
      throw new PAMRConsumptionRejected('invalid_input');
    }
  }

  private manifest(value: PAMRValidated, previousManifestSha256: string | null): PAMRConsumptionManifest {
    const { input, proposal, text, proposalText } = value;
    return pamrConsumptionManifestSchema.parse({
      schema: 'gelt.pamr-consumption-manifest.v1',
      version: 1,
      classification: 'constructed_offline_test',
      consumerPolicyId: this.policy.consumerPolicyId,
      configuredOwnerPolicySha256: this.ownerPolicyDigest,
      purePolicyDefinitionSha256: this.policy.purePolicyDefinitionSha256,
      binding: input.binding,
      previousManifestSha256,
      decisionId: proposal.decision.decisionId,
      proposalId: proposal.proposalId,
      decisionAt: input.decisionAt,
      prefixAvailableAt: input.prefixAvailableAt,
      evaluationAt: input.evaluationAt,
      inputSha256: digest(text),
      proposalSha256: digest(proposalText),
      inputBytes: Buffer.byteLength(text),
      proposalBytes: Buffer.byteLength(proposalText),
      ...pamrConsumptionDisclosure,
    });
  }

  private assertNext(value: PAMRValidated, previous: PAMRStored | undefined): void {
    const binding = value.input.binding;
    if (binding.ordinal !== (previous ? previous.manifest.binding.ordinal + 1 : 1)
      || binding.expectedPreviousPrefixSha256 !== (previous?.manifest.binding.prefixSha256 ?? null)) {
      throw new PAMRConsumptionRejected('lineage_mismatch');
    }
    if (previous) {
      const priorEvaluation = Date.parse(previous.manifest.evaluationAt);
      if (Date.parse(value.input.evaluationAt) < priorEvaluation
        || Date.parse(value.input.decisionAt) <= priorEvaluation
        || Date.parse(value.input.prefixAvailableAt) < priorEvaluation) {
        throw new PAMRConsumptionRejected('invalid_clock');
      }
    }
  }

  private readOne(key: string): PAMRStored {
    const path = join(this.rootPath, key);
    const manifestBytes = boundedFile(join(path, 'manifest.json'), smallLimit);
    const manifest = pamrConsumptionManifestSchema.parse(parseResearchJSON(manifestBytes));
    if (canonical(manifest) !== manifestBytes.toString('utf8')
      || pamrConsumptionManifestSha256(manifest) !== key) throw new Error();
    const inputBytes = boundedFile(join(path, 'input.json'), inputLimit);
    const proposalBytes = boundedFile(join(path, 'proposal.json'), smallLimit);
    if (inputBytes.length !== manifest.inputBytes || proposalBytes.length !== manifest.proposalBytes
      || digest(inputBytes.toString('utf8')) !== manifest.inputSha256
      || digest(proposalBytes.toString('utf8')) !== manifest.proposalSha256) throw new Error();
    const value = this.validated(inputBytes, parseResearchJSON(proposalBytes));
    if (value.proposalText !== proposalBytes.toString('utf8')
      || canonical(this.manifest(value, manifest.previousManifestSha256)) !== canonical(manifest)) throw new Error();
    return { input: value.input, proposal: value.proposal, manifest, link: pamrConsumptionLink(manifest) };
  }

  private replay(): { records: PAMRStored[]; bytes: number } {
    if (this.failed) throw new Error();
    disabled();
    const inventory = this.inventory();
    if (boundedFile(join(this.rootPath, 'policy.json'), smallLimit).toString('utf8') !== this.policyBody) throw new Error();
    const records = inventory.keys.map(key => this.readOne(key))
      .sort((a, b) => a.manifest.binding.ordinal - b.manifest.binding.ordinal);
    let previous: PAMRStored | undefined;
    for (const record of records) {
      const value: PAMRValidated = {
        input: record.input, proposal: record.proposal,
        text: canonical(record.input), proposalText: canonical(record.proposal),
      };
      this.assertNext(value, previous);
      if (record.manifest.previousManifestSha256 !== (previous?.link.evidenceManifestSha256 ?? null)) throw new Error();
      previous = record;
    }
    return { records, bytes: inventory.bytes };
  }

  private replayed(): { records: PAMRStored[]; bytes: number } {
    this.ready();
    try { return this.replay(); } catch { this.unavailable(); }
  }

  validatePolicy(): void { this.replayed(); }

  prepare(bytes: Buffer, rawProposal: unknown): PAMRConsumptionEvidenceLink {
    const before = this.replayed();
    if (this.readonlyReopen) throw new PAMRConsumptionRejected('readonly');
    const value = this.validated(bytes, rawProposal);
    // Ordinal, not decision/proposal ID, owns single consumption. Never return
    // an existing link from prepare, including for no_action or abstain.
    if (value.input.binding.ordinal <= before.records.length) {
      throw new PAMRConsumptionRejected('already_consumed');
    }
    this.assertNext(value, before.records.at(-1));
    if (before.records.length >= pamrConsumptionBounds.records) {
      throw new PAMRConsumptionRejected('resource_limit');
    }
    const manifest = this.manifest(value, before.records.at(-1)?.link.evidenceManifestSha256 ?? null);
    const manifestText = canonical(manifest), link = pamrConsumptionLink(manifest);
    const growth = Buffer.byteLength(value.text) + Buffer.byteLength(value.proposalText) + Buffer.byteLength(manifestText);
    if (Buffer.byteLength(manifestText) > smallLimit || before.bytes + growth > totalLimit) {
      throw new PAMRConsumptionRejected('resource_limit');
    }
    const target = join(this.rootPath, link.evidenceManifestSha256);
    // From this point onward every exception, including typed test exceptions,
    // is persistence uncertainty. No cleanup, overwrite, retry, or link reissue.
    this.writing = true;
    try {
      const staging = join(this.rootPath, `.staging-${randomUUID()}`);
      mkdirSync(staging, { mode: 0o700 });
      this.writeNew(join(staging, 'input.json'), value.text, 'artifact-file-sync');
      this.writeNew(join(staging, 'proposal.json'), value.proposalText, 'artifact-file-sync');
      this.writeNew(join(staging, 'manifest.json'), manifestText, 'artifact-file-sync');
      syncDirectory(staging); this.stage('artifact-staging-sync');
      if (existsSync(target)) throw new Error();
      renameSync(staging, target); this.stage('artifact-publish');
      syncDirectory(this.rootPath); this.stage('artifact-root-sync');
      const after = this.replay();
      if (after.records.length !== before.records.length + 1
        || canonical(after.records.at(-1)?.link) !== canonical(link)) throw new Error();
      return link;
    } catch { this.unavailable(); }
    finally { this.writing = false; }
  }

  read(rawLink: unknown): PAMRConsumptionReplay {
    const all = this.replayed();
    let link: PAMRConsumptionEvidenceLink;
    try { link = pamrConsumptionEvidenceLinkSchema.parse(rawLink); }
    catch { throw new PAMRConsumptionRejected('invalid_input'); }
    const record = all.records.find(r => r.link.evidenceManifestSha256 === link.evidenceManifestSha256);
    if (!record || canonical(record.link) !== canonical(link)) this.unavailable();
    return { input: record.input, proposal: record.proposal, manifest: record.manifest };
  }
}
