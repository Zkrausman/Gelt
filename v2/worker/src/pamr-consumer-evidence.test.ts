// Private constructed fixtures. No producer, preview, admission, fill, or provider.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, chmodSync, symlinkSync, linkSync, cpSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest } from './ledger-canonical.js';
import { convertPAMR } from './pamr-reference-artifact.js';
import { pamrRecipe } from './paper-conversion-contract.js';
import {
  snapshot, units, simulationDigest, type SimulationRun,
} from './synthetic-simulation-economics.js';
import {
  pamrConsumerPolicyId, pamrConsumerDisclosure, type PAMRConsumerInput,
} from './pamr-consumer-contract.js';
import {
  derivePAMRConsumerPrefix, pamrConsumerPolicySha256, proposePAMRConsumer,
} from './pamr-consumer-adapter.js';
import {
  pamrConsumptionBounds, pamrConsumptionOwnerPolicySchema,
  configuredPAMROwnerPolicySha256,
} from './pamr-consumer-evidence-contract.js';
import {
  PAMRConsumptionEvidence, PAMRConsumptionRejected, SizingEvidenceRejected,
  type EvidenceStage,
} from './synthetic-sizing-binding-evidence.js';

const roots: string[] = [];
const now = Date.parse('2026-10-28T15:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();
const d = (value: string) => ({
  value, precision: value.replace('.', '').length,
  scale: value.split('.')[1]?.length ?? 0,
});
const hash = (domain: string, value: unknown) => digest(canonical({ domain, value }));
const trace = [['2', '1'], ['0.5', '1'], ['2', '1']];

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function privateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gelt-pamr-evidence-'));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}
function config(): SimulationRun {
  return {
    version: 2,
    runId: '11111111-1111-4111-8111-111111111111',
    sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD',
    classification: 'constructed_offline_test',
    genesis: { cash: d('20'), quantity: d('0') },
    costs: {
      commissionPerOrder: d('0.01'),
      spreadFraction: d('0'), slippageFraction: d('0'),
    },
    calibrationEvidenceSha256: 'b'.repeat(64),
    maxDecisionAgeMs: 1000, maxObservationAgeMs: 1000,
    validThrough: iso(now + 1000000),
    rounding: 'adverse-price-8-cumulative-cash-8.v1',
  };
}
function policy(c: SimulationRun) {
  return pamrConsumptionOwnerPolicySchema.parse({
    schema: 'gelt.pamr-consumption-owner-policy.v1',
    version: 1, classification: 'constructed_offline_test',
    runId: c.runId, sourceCommit: c.sourceCommit,
    configSha256: simulationDigest(c),
    consumerPolicyId: pamrConsumerPolicyId,
    purePolicyDefinitionSha256: pamrConsumerPolicySha256,
    adaptation: pamrConsumerDisclosure.adaptation,
    quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'),
    feeInclusiveOrderCapUSD: '10', bounds: pamrConsumptionBounds,
  });
}
function fixture(stage?: (stage: EvidenceStage) => void) {
  const base = privateRoot(), root = join(base, 'evidence');
  const c = config(), p = policy(c);
  const evidence = new PAMRConsumptionEvidence(root, c, p, true, stage);
  return { base, root, c, p, evidence };
}
function input(c: SimulationRun, rows: string[][], cash = '20', quantity = '0'): PAMRConsumerInput {
  const artifact = convertPAMR(canonical({
    schema: 'gelt.pamr-constructed-request.v1',
    classification: 'constructed_offline_test',
    recipe: pamrRecipe, assets: ['SYNTH-RISK', 'SYNTH-RESERVE'], rows,
  }));
  if (artifact.status !== 'computed') throw new Error('constructed fixture unavailable');
  const artifactText = canonical(artifact.artifact);
  const t = now + (rows.length - 1) * 1000;
  // Non-genesis values below are supplied hypothetical snapshots, not fills.
  const portfolio = {
    snapshot: snapshot(c, units(d(cash), 8), units(d(quantity), 18),
      cash === '20' && quantity === '0' ? [] : [{ hypothetical: true }]),
    state: 'settled' as const,
  };
  const observation = {
    referencePrice: d('1'), observedAt: iso(t - 100),
    availableAt: iso(t - 100), evidenceSha256: 'c'.repeat(64),
  };
  const value: PAMRConsumerInput = {
    schema: 'gelt.pamr-consumer-input.v1', policyId: pamrConsumerPolicyId,
    artifactText, config: c, portfolio,
    lifecycleDisposition: 'settled', inputPortfolioUnknown: false,
    decisionAt: iso(t - 200), prefixAvailableAt: iso(t - 201),
    evaluationAt: iso(t), observation,
    quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'),
    binding: {
      ...derivePAMRConsumerPrefix(artifactText),
      runId: c.runId, sourceCommit: c.sourceCommit,
      configSha256: simulationDigest(c), policySha256: pamrConsumerPolicySha256,
      portfolioSnapshotSha256: simulationDigest(portfolio.snapshot),
      costsSha256: hash('gelt.pamr-consumer.costs.v1', c.costs),
      observationSha256: hash('gelt.pamr-consumer.observation.v1', observation),
      clockSha256: hash('gelt.pamr-consumer.clock.v1', {
        decisionAt: iso(t - 200), prefixAvailableAt: iso(t - 201), evaluationAt: iso(t),
      }),
    },
  };
  return value;
}
function rebind(v: PAMRConsumerInput): void {
  v.binding = {
    ...derivePAMRConsumerPrefix(v.artifactText),
    runId: v.config.runId, sourceCommit: v.config.sourceCommit,
    configSha256: simulationDigest(v.config), policySha256: pamrConsumerPolicySha256,
    portfolioSnapshotSha256: simulationDigest(v.portfolio.snapshot),
    costsSha256: hash('gelt.pamr-consumer.costs.v1', v.config.costs),
    observationSha256: hash('gelt.pamr-consumer.observation.v1', v.observation),
    clockSha256: hash('gelt.pamr-consumer.clock.v1', {
      decisionAt: v.decisionAt, prefixAvailableAt: v.prefixAvailableAt,
      evaluationAt: v.evaluationAt,
    }),
  };
}
function proposal(v: PAMRConsumerInput) {
  const result = proposePAMRConsumer(canonical(v));
  expect(result.status).toBe('computed');
  if (result.status !== 'computed') throw new Error('constructed fixture unavailable');
  return result.value;
}
function prepare(e: PAMRConsumptionEvidence, v: PAMRConsumerInput) {
  return e.prepare(Buffer.from(canonical(v)), proposal(v));
}
function expectRejected(fn: () => unknown, reason: string): void {
  try { fn(); throw new Error('expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(PAMRConsumptionRejected);
    expect((error as PAMRConsumptionRejected).reason).toBe(reason);
  }
}
function expectUnavailable(fn: () => unknown): void {
  try { fn(); throw new Error('expected unavailability'); }
  catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SizingEvidenceRejected);
    expect((error as Error).message).toBe('PAMR consumption evidence unavailable');
  }
}

it('records the independent 0, quarter, 0 oracle without executing hypothetical fills', () => {
  const f = fixture();
  expect(f.evidence.lastConsumption).toBeNull();
  const inputs = [
    input(f.c, trace.slice(0, 1)),
    input(f.c, trace.slice(0, 2)),
    input(f.c, trace, '15', '4.99'),
  ];
  const links = inputs.map(v => prepare(f.evidence, v));
  const records = links.map(l => f.evidence.read(l));
  expect(records.map(r => r.proposal.decision.riskyWeight)).toEqual(['0/1', '1/1', '0/1']);
  expect(records.map(r => r.proposal.decision.targetExposure?.value))
    .toEqual(['0.000000000000000000', '0.250000000000000000', '0.000000000000000000']);
  expect(records[0].proposal.action).toMatchObject({ outcome: 'no_action', reason: 'already_cash' });
  expect(records[1].proposal.action).toMatchObject({
    outcome: 'proposal', side: 'buy', quantity: { value: '4.990000000000000000' },
    hypothetical: { modeledPostCash: { value: '15.00000000' } },
  });
  expect(records[2].proposal.action).toMatchObject({
    outcome: 'proposal', side: 'sell', quantity: { value: '4.990000000000000000' },
    hypothetical: { modeledPostCash: { value: '19.98000000' } },
  });
  expect(links.map(l => l.ordinal)).toEqual([1, 2, 3]);
  expect(records.map(r => r.manifest.previousManifestSha256))
    .toEqual([null, links[0].evidenceManifestSha256, links[1].evidenceManifestSha256]);
  expect(f.evidence.lastConsumption).toEqual(links[2]);
  for (const r of records) {
    expect(r.proposal.consumption).toBe('not_performed');
    expect(r.manifest).toMatchObject({
      recordState: 'constructed_attempt_only', fills: 'not_performed',
      effectAuthority: 'none', authenticity: 'not_established', ownerIdentity: 'not_established',
    });
  }
  expect(readdirSync(f.root)).toHaveLength(4);
});

it('separates configured owner-policy identity from the fixed pure policy definition', () => {
  const f = fixture();
  expect(f.evidence.policySha256).toBe(configuredPAMROwnerPolicySha256(f.p));
  expect(f.evidence.policySha256).not.toBe(pamrConsumerPolicySha256);
  const link = prepare(f.evidence, input(f.c, trace.slice(0, 1)));
  expect(link.configuredOwnerPolicySha256).toBe(f.evidence.policySha256);
  expect(link.purePolicyDefinitionSha256).toBe(pamrConsumerPolicySha256);
  f.p.quantityQuantum = d('10');
  f.c.genesis.cash = d('999');
  const copy = f.evidence.policy; copy.buyLimitPrice = d('999');
  expect(f.evidence.policy.quantityQuantum).toEqual(d('0.01'));
  expect(f.evidence.policy.buyLimitPrice).toEqual(d('1'));
  expect(f.evidence.read(link).input.config.genesis.cash).toEqual(d('20'));
});

it.each(['exact', 'clock', 'portfolio', 'artifact whitespace'] as const)
('rejects a consumed no-action ordinal with %s input and never reissues its link', variant => {
  const f = fixture(), first = input(f.c, trace.slice(0, 1));
  const link = prepare(f.evidence, first), changed = structuredClone(first);
  if (variant === 'clock') {
    changed.decisionAt = iso(now + 800); changed.prefixAvailableAt = iso(now + 799);
    changed.evaluationAt = iso(now + 1000);
    changed.observation.observedAt = iso(now + 900);
    changed.observation.availableAt = iso(now + 900);
  }
  if (variant === 'portfolio') {
    changed.portfolio.snapshot = snapshot(f.c, units(d('19'), 8), 0n, [{ hypothetical: true }]);
  }
  if (variant === 'artifact whitespace') changed.artifactText = ` \n${changed.artifactText}\n `;
  rebind(changed);
  const before = readdirSync(f.root).sort();
  expectRejected(() => prepare(f.evidence, changed), 'already_consumed');
  expect(readdirSync(f.root).sort()).toEqual(before);
  expect(f.evidence.read(link).input).toEqual(first);
  expect(prepare(f.evidence, input(f.c, trace.slice(0, 2))).ordinal).toBe(2);
});

it('also consumes a valid abstention exactly once', () => {
  const f = fixture(), v = input(f.c, trace.slice(0, 1));
  v.lifecycleDisposition = 'unknown';
  expect(proposal(v).action.outcome).toBe('abstain');
  const link = prepare(f.evidence, v);
  expectRejected(() => prepare(f.evidence, v), 'already_consumed');
  expect(f.evidence.read(link).proposal.action.outcome).toBe('abstain');
});

it('rejects skips, reordered prefixes, and valid but drifted parents before mutation', () => {
  const f = fixture();
  const before = readdirSync(f.root);
  expectRejected(() => prepare(f.evidence, input(f.c, trace.slice(0, 2))), 'lineage_mismatch');
  expect(readdirSync(f.root)).toEqual(before);
  prepare(f.evidence, input(f.c, trace.slice(0, 1)));
  const afterFirst = readdirSync(f.root).sort();
  for (const rows of [trace, [['3', '1'], ['0.5', '1']], [['0.5', '1'], ['2', '1']]]) {
    expectRejected(() => prepare(f.evidence, input(f.c, rows)), 'lineage_mismatch');
    expect(readdirSync(f.root).sort()).toEqual(afterFirst);
  }
  expect(prepare(f.evidence, input(f.c, trace.slice(0, 2))).ordinal).toBe(2);
});

it.each(['backdated', 'prefix future', 'invalid observation'] as const)
('rejects %s recorded clocks before mutation even for an abstaining hypothesis', kind => {
  const f = fixture();
  prepare(f.evidence, input(f.c, trace.slice(0, 1)));
  const v = input(f.c, trace.slice(0, 2));
  v.lifecycleDisposition = 'unknown';
  if (kind === 'backdated') {
    v.prefixAvailableAt = iso(now - 201); v.decisionAt = iso(now - 200);
    v.evaluationAt = iso(now); v.observation.observedAt = iso(now - 100);
    v.observation.availableAt = iso(now - 100);
  } else if (kind === 'prefix future') v.prefixAvailableAt = v.evaluationAt;
  else v.observation.availableAt = iso(now + 2000);
  rebind(v);
  const before = readdirSync(f.root).sort();
  expectRejected(() => prepare(f.evidence, v), 'invalid_clock');
  expect(readdirSync(f.root).sort()).toEqual(before);
  expect(prepare(f.evidence, input(f.c, trace.slice(0, 2))).ordinal).toBe(2);
});

it('rejects invalid, oversized, noncanonical and foreign request data without latching', () => {
  const f = fixture(), v = input(f.c, trace.slice(0, 1)), p = proposal(v);
  const before = readdirSync(f.root);
  expectRejected(() => f.evidence.prepare(Buffer.from('{"private":"SENTINEL","private":1}'), p), 'invalid_input');
  expectRejected(() => f.evidence.prepare(Buffer.alloc(262145), p), 'resource_limit');
  expectRejected(() => f.evidence.prepare(Buffer.from(` ${canonical(v)}`), p), 'invalid_input');
  const foreign = structuredClone(v);
  foreign.quantityQuantum = d('0.02');
  expectRejected(() => prepare(f.evidence, foreign), 'binding_mismatch');
  const changed = structuredClone(p);
  changed.decision.binding.prefixSha256 = '0'.repeat(64);
  expectRejected(() => f.evidence.prepare(Buffer.from(canonical(v)), changed), 'binding_mismatch');
  expect(readdirSync(f.root)).toEqual(before);
  expect(prepare(f.evidence, v).ordinal).toBe(1);
});

it('validates fixture flags, owner config, fixed bounds and private parent before publication', () => {
  const base = privateRoot(), c = config(), p = policy(c);
  const root = join(base, 'evidence');
  const wrong = { ...p, configSha256: '0'.repeat(64) };
  expectRejected(() => new PAMRConsumptionEvidence(root, c, wrong, true), 'invalid_input');
  expect(existsSync(root)).toBe(false);
  expectRejected(() => new PAMRConsumptionEvidence(root, c,
    { ...p, bounds: { ...pamrConsumptionBounds, records: 65 } }, true), 'invalid_input');
  expect(existsSync(root)).toBe(false);
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', '');
  expect(() => new PAMRConsumptionEvidence(root, c, p, true)).toThrow();
  expect(existsSync(root)).toBe(false);
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  chmodSync(base, 0o755);
  expectUnavailable(() => new PAMRConsumptionEvidence(root, c, p, true));
  expect(existsSync(root)).toBe(false);
});

it('reopens read-only, replays exact records, and cannot restore a fresh writer', () => {
  const f = fixture(), v = input(f.c, trace.slice(0, 1));
  const link = prepare(f.evidence, v);
  const before = readdirSync(f.root).sort();
  const reopened = new PAMRConsumptionEvidence(f.root, f.c, f.p, false);
  expect(reopened.reopened).toBe(true);
  expect(reopened.read(link)).toEqual(f.evidence.read(link));
  expect(reopened.lastConsumption).toEqual(link);
  expectRejected(() => prepare(reopened, input(f.c, trace.slice(0, 2))), 'readonly');
  expectUnavailable(() => new PAMRConsumptionEvidence(f.root, f.c, f.p, true));
  expect(readdirSync(f.root).sort()).toEqual(before);
  const missing = join(f.base, 'missing');
  expectUnavailable(() => new PAMRConsumptionEvidence(missing, f.c, f.p, false));
  expect(existsSync(missing)).toBe(false);
  const retainedEmpty = join(f.base, 'retained-empty');
  mkdirSync(retainedEmpty, { mode: 0o700 });
  expectUnavailable(() => new PAMRConsumptionEvidence(retainedEmpty, f.c, f.p, true));
  expect(readdirSync(retainedEmpty)).toEqual([]);
});

it.each([
  'input', 'proposal', 'manifest', 'canonical bytes', 'extra child',
  'missing file', 'symlink', 'hardlink', 'file mode', 'directory mode',
  'foreign entry', 'staging', 'policy', 'oversized file',
] as const)('latches on retained %s corruption and preserves it', kind => {
  const f = fixture(), link = prepare(f.evidence, input(f.c, trace.slice(0, 1)));
  const dir = join(f.root, link.evidenceManifestSha256), file = join(dir, 'input.json');
  if (kind === 'input') writeFileSync(file, '{}');
  if (kind === 'proposal') writeFileSync(join(dir, 'proposal.json'), '{}');
  if (kind === 'manifest') writeFileSync(join(dir, 'manifest.json'), '{}');
  if (kind === 'canonical bytes') writeFileSync(file, ` ${readFileSync(file, 'utf8')}`);
  if (kind === 'extra child') writeFileSync(join(dir, 'extra'), 'x', { mode: 0o600 });
  if (kind === 'missing file') rmSync(file);
  if (kind === 'symlink') { rmSync(file); symlinkSync(join(f.root, 'policy.json'), file); }
  if (kind === 'hardlink') linkSync(file, join(f.base, 'linked-input'));
  if (kind === 'file mode') chmodSync(file, 0o644);
  if (kind === 'directory mode') chmodSync(dir, 0o755);
  if (kind === 'foreign entry') mkdirSync(join(f.root, 'foreign'), { mode: 0o700 });
  if (kind === 'staging') mkdirSync(join(f.root, '.staging-11111111-1111-4111-8111-111111111111'), { mode: 0o700 });
  if (kind === 'policy') writeFileSync(join(f.root, 'policy.json'), '{}');
  if (kind === 'oversized file') writeFileSync(file, Buffer.alloc(262145));
  const retained = readdirSync(f.root).sort();
  expectUnavailable(() => f.evidence.read(link));
  expectUnavailable(() => prepare(f.evidence, input(f.c, trace.slice(0, 2))));
  expect(readdirSync(f.root).sort()).toEqual(retained);
});

it('replays unrequested records, detects missing ancestors, and never serves a cached valid link', () => {
  const f = fixture();
  const links = [1, 2, 3].map(n => prepare(f.evidence, input(f.c, trace.slice(0, n))));
  rmSync(join(f.root, links[0].evidenceManifestSha256), { recursive: true });
  expectUnavailable(() => f.evidence.read(links[2]));
  expectUnavailable(() => f.evidence.lastConsumption);
});

it('detects a coherent second ordinal record from another private fixture', () => {
  const f = fixture(), other = fixture();
  const v1 = input(f.c, trace.slice(0, 1));
  prepare(f.evidence, v1); prepare(other.evidence, v1);
  const v2 = input(f.c, trace.slice(0, 2));
  const original = prepare(f.evidence, v2);
  const alternate = structuredClone(v2);
  alternate.decisionAt = iso(now + 1800); alternate.prefixAvailableAt = iso(now + 1799);
  alternate.evaluationAt = iso(now + 2000);
  alternate.observation.observedAt = iso(now + 1900);
  alternate.observation.availableAt = iso(now + 1900);
  rebind(alternate);
  const fork = prepare(other.evidence, alternate);
  expect(fork.evidenceManifestSha256).not.toBe(original.evidenceManifestSha256);
  cpSync(join(other.root, fork.evidenceManifestSha256),
    join(f.root, fork.evidenceManifestSha256), { recursive: true });
  expectUnavailable(() => f.evidence.read(original));
});

it('rejects an altered link and latches rather than accepting a foreign binding', () => {
  const f = fixture(), link = prepare(f.evidence, input(f.c, trace.slice(0, 1)));
  expectUnavailable(() => f.evidence.read({ ...link, configuredOwnerPolicySha256: '0'.repeat(64) }));
  expectUnavailable(() => f.evidence.read(link));
});

it('publishes file and directory durability stages before returning any attempt link', () => {
  const stages: EvidenceStage[] = [], f = fixture(s => stages.push(s));
  expect(stages).toEqual([
    'root-parent-sync', 'policy-file-sync', 'policy-staging-sync', 'policy-publish', 'policy-root-sync',
  ]);
  prepare(f.evidence, input(f.c, trace.slice(0, 1)));
  expect(stages.slice(5)).toEqual([
    'artifact-file-sync', 'artifact-file-sync', 'artifact-file-sync',
    'artifact-staging-sync', 'artifact-publish', 'artifact-root-sync',
  ]);
});

for (const typed of [false, true]) {
  it.each([
    'root-parent-sync', 'policy-file-sync', 'policy-staging-sync', 'policy-publish', 'policy-root-sync',
  ] as const)(`retains policy uncertainty after %s with typed=${typed}`, stage => {
    const base = privateRoot(), root = join(base, 'evidence'), c = config();
    expectUnavailable(() => new PAMRConsumptionEvidence(root, c, policy(c), true, s => {
      if (s === stage) throw typed ? new SizingEvidenceRejected() : new Error('PRIVATE-PATH-SENTINEL');
    }));
    expect(existsSync(root)).toBe(true);
    const retained = readdirSync(root).sort();
    expectUnavailable(() => new PAMRConsumptionEvidence(root, c, policy(c), true));
    expect(readdirSync(root).sort()).toEqual(retained);
  });

  it.each([
    'artifact-file-sync', 'artifact-staging-sync', 'artifact-publish', 'artifact-root-sync',
  ] as const)(`latches every post-mutation %s failure with typed=${typed}`, stage => {
    const f = fixture(s => {
      if (s === stage) throw typed ? new SizingEvidenceRejected() : new Error('PRIVATE-INPUT-SENTINEL');
    });
    const v = input(f.c, trace.slice(0, 1));
    expectUnavailable(() => prepare(f.evidence, v));
    const retained = readdirSync(f.root).sort();
    expect(retained.length).toBeGreaterThan(1);
    expectUnavailable(() => prepare(f.evidence, v));
    expectUnavailable(() => f.evidence.lastConsumption);
    expectUnavailable(() => f.evidence.validatePolicy());
    expect(readdirSync(f.root).sort()).toEqual(retained);
    expectUnavailable(() => new PAMRConsumptionEvidence(f.root, f.c, f.p, true));
  });
}

it('latches an unexpected typed read error after publication instead of treating it as benign', () => {
  let root = '';
  const f = fixture(stage => {
    if (stage === 'artifact-root-sync') {
      writeFileSync(join(root, 'policy.json'), '{}');
      throw new PAMRConsumptionRejected('already_consumed');
    }
  });
  root = f.root;
  expectUnavailable(() => prepare(f.evidence, input(f.c, trace.slice(0, 1))));
  expectUnavailable(() => f.evidence.lastConsumption);
  expect(readdirSync(f.root).filter(n => /^[a-f0-9]{64}$/.test(n))).toHaveLength(1);
});

it('bounds metadata inventory before materializing aggregate oversized bodies', () => {
  const f = fixture();
  for (let n = 0; n < 33; n++) {
    const dir = join(f.root, n.toString(16).padStart(64, '0'));
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, 'input.json'), Buffer.alloc(262144, 32), { mode: 0o600 });
    writeFileSync(join(dir, 'proposal.json'), '{}', { mode: 0o600 });
    writeFileSync(join(dir, 'manifest.json'), '{}', { mode: 0o600 });
  }
  const before = readdirSync(f.root).sort();
  expectUnavailable(() => f.evidence.lastConsumption);
  expect(readdirSync(f.root).sort()).toEqual(before);
});

it('rejects valid growth beyond the shared 8 MiB root budget before creating staging', () => {
  const f = fixture();
  let rejectedOrdinal = 0;
  for (let n = 1; n <= 64; n++) {
    const rows = Array.from({ length: n }, () => ['1', '1']);
    const v = input(f.c, rows);
    v.artifactText += ' '.repeat(Math.max(0, 160000 - Buffer.byteLength(v.artifactText)));
    rebind(v);
    const before = readdirSync(f.root).sort();
    try { prepare(f.evidence, v); }
    catch (error) {
      expect(error).toBeInstanceOf(PAMRConsumptionRejected);
      expect((error as PAMRConsumptionRejected).reason).toBe('resource_limit');
      expect(readdirSync(f.root).sort()).toEqual(before);
      rejectedOrdinal = n;
      break;
    }
  }
  expect(rejectedOrdinal).toBeGreaterThan(1);
  expect(rejectedOrdinal).toBeLessThanOrEqual(64);
  // Resource rejection was pre-mutation: a smaller valid next record is legal.
  const rows = Array.from({ length: rejectedOrdinal }, () => ['1', '1']);
  expect(prepare(f.evidence, input(f.c, rows)).ordinal).toBe(rejectedOrdinal);
}, 120000);

it('retains at most 64 contiguous records and never reissues ordinal 64', () => {
  const f = fixture();
  let last: ReturnType<typeof prepare> | undefined;
  for (let n = 1; n <= 64; n++) {
    last = prepare(f.evidence, input(f.c, Array.from({ length: n }, () => ['1', '1'])));
  }
  expect(f.evidence.lastConsumption).toEqual(last);
  expect(readdirSync(f.root)).toHaveLength(65);
  expectRejected(() => prepare(f.evidence,
    input(f.c, Array.from({ length: 64 }, () => ['1', '1']))), 'already_consumed');
  const tooMany = input(f.c, Array.from({ length: 64 }, () => ['1', '1']));
  tooMany.binding.ordinal = 65;
  expectRejected(() => f.evidence.prepare(Buffer.from(canonical(tooMany)), {}), 'invalid_input');
  expect(f.evidence.lastConsumption).toEqual(last);
}, 120000);
