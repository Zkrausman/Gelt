import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { canonical, digest } from './ledger-canonical.js';
import { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';
import { syntheticMockPAMRRunPreviewSchema, syntheticMockRunPreviewSchema, syntheticMockOrderViewSchema, type SyntheticRunExecution } from './synthetic-mock-robinhood-contract.js';
import { simulationDigest, simulationSource, simulationPolicy, snapshot, units, executionPrice, type SimulationRun } from './synthetic-simulation-economics.js';
import { pamrConsumerDisclosure, pamrConsumerPolicyId, type PAMRConsumerInput, type PAMRConsumerProposal } from './pamr-consumer-contract.js';
import { derivePAMRConsumerPrefix, pamrConsumerPolicySha256, proposePAMRConsumer } from './pamr-consumer-adapter.js';
import { pamrConsumptionBounds, pamrConsumptionOwnerPolicySchema, type PAMRConsumptionEvidenceLink } from './pamr-consumer-evidence-contract.js';
import { PAMRConsumptionRejected, SizingEvidenceRejected, type EvidenceStage } from './synthetic-sizing-binding-evidence.js';
import { convertPAMR } from './pamr-reference-artifact.js';
import { pamrRecipe } from './paper-conversion-contract.js';

const roots: string[] = [], stores: SyntheticMockRobinhoodStore[] = [];
const initial = Date.parse('2026-10-28T15:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const hash = (domain: string, value: unknown) => digest(canonical({ domain, value }));
const trace = [['2', '1'], ['0.5', '1'], ['2', '1']];
beforeEach(() => { vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only'); vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only'); });
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* retained ownership is asserted before disposal */ } }
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function config(): SimulationRun {
  return { version: 2, runId: randomUUID(), sourceCommit: 'a'.repeat(40), instrumentId: 'SYNTH-RH-USD', currency: 'USD',
    classification: 'constructed_offline_test', genesis: { cash: d('20'), quantity: d('0') },
    costs: { commissionPerOrder: d('0.01'), spreadFraction: d('0'), slippageFraction: d('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 1000, maxObservationAgeMs: 1000,
    validThrough: iso(initial + 1000000), rounding: 'adverse-price-8-cumulative-cash-8.v1' };
}
function policy(c: SimulationRun) {
  return pamrConsumptionOwnerPolicySchema.parse({ schema: 'gelt.pamr-consumption-owner-policy.v1', version: 1,
    classification: 'constructed_offline_test', runId: c.runId, sourceCommit: c.sourceCommit, configSha256: simulationDigest(c),
    consumerPolicyId: pamrConsumerPolicyId, purePolicyDefinitionSha256: pamrConsumerPolicySha256, adaptation: pamrConsumerDisclosure.adaptation,
    quantityQuantum: d('0.01'), buyLimitPrice: d('1'), sellLimitPrice: d('1'), feeInclusiveOrderCapUSD: '10', bounds: pamrConsumptionBounds });
}
function privateRoot() { const root = mkdtempSync(join(tmpdir(), 'gelt-pamr-store-')); chmodSync(root, 0o700); roots.push(root); return root; }
function fixture(stage?: (s: EvidenceStage) => void) {
  const root = privateRoot(), path = join(root, 'mock.sqlite'), c = config(), p = policy(c); let clock = initial;
  const store = new SyntheticMockRobinhoodStore(path, () => clock, undefined, { simulationRun: c, pamrPolicy: p, evidenceStageForTest: stage });
  stores.push(store);
  return { root, path, evidenceRoot: path + '.sizing-evidence', c, p, store, time: () => clock, advance: (n = 1000) => { clock += n; }, setTime: (n: number) => { clock = n; } };
}
type Fixture = ReturnType<typeof fixture>;
function counts(f: Fixture) {
  const db = new Database(f.path, { readonly: true });
  try { return ['mock_admissions', 'mock_orders', 'mock_events'].map(table => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n); }
  finally { db.close(); }
}
function rebind(v: PAMRConsumerInput) {
  v.binding = { ...derivePAMRConsumerPrefix(v.artifactText), runId: v.config.runId, sourceCommit: v.config.sourceCommit,
    configSha256: simulationDigest(v.config), policySha256: pamrConsumerPolicySha256, portfolioSnapshotSha256: simulationDigest(v.portfolio.snapshot),
    costsSha256: hash('gelt.pamr-consumer.costs.v1', v.config.costs), observationSha256: hash('gelt.pamr-consumer.observation.v1', v.observation),
    clockSha256: hash('gelt.pamr-consumer.clock.v1', { decisionAt: v.decisionAt, prefixAvailableAt: v.prefixAvailableAt, evaluationAt: v.evaluationAt }) };
}
function input(f: Fixture, ordinal: number): PAMRConsumerInput {
  const artifact = convertPAMR(canonical({ schema: 'gelt.pamr-constructed-request.v1', classification: 'constructed_offline_test', recipe: pamrRecipe, assets: ['SYNTH-RISK', 'SYNTH-RESERVE'], rows: trace.slice(0, ordinal) }));
  if (artifact.status !== 'computed') throw new Error('fixture unavailable');
  const v: PAMRConsumerInput = { schema: 'gelt.pamr-consumer-input.v1', policyId: pamrConsumerPolicyId, artifactText: canonical(artifact.artifact),
    config: f.c, portfolio: f.store.portfolio(), lifecycleDisposition: 'settled', inputPortfolioUnknown: false,
    decisionAt: iso(f.time() - 200), prefixAvailableAt: iso(f.time() - 201), evaluationAt: iso(f.time()),
    observation: { referencePrice: d('1'), observedAt: iso(f.time() - 100), availableAt: iso(f.time() - 100), evidenceSha256: 'c'.repeat(64) },
    quantityQuantum: f.p.quantityQuantum, buyLimitPrice: f.p.buyLimitPrice, sellLimitPrice: f.p.sellLimitPrice, binding: {} as PAMRConsumerInput['binding'] };
  rebind(v); return v;
}
function proposal(v: PAMRConsumerInput): PAMRConsumerProposal {
  const result = proposePAMRConsumer(canonical(v));
  if (result.status !== 'computed') throw new Error('fixture unavailable');
  return result.value;
}
function prepare(f: Fixture, ordinal: number) {
  const v = input(f, ordinal), p = proposal(v), link = f.store.preparePAMRConsumption(Buffer.from(canonical(v)), p);
  return { v, p, link };
}
function preview(f: Fixture, v: PAMRConsumerInput, p: PAMRConsumerProposal, link: PAMRConsumptionEvidenceLink) {
  return syntheticMockPAMRRunPreviewSchema.parse({ version: 2, source: simulationSource, previewId: randomUUID(),
    principal: 'gelt-test-principal-v1', account: 'gelt-test-account-v1', policyId: simulationPolicy,
    runId: f.c.runId, configSha256: simulationDigest(f.c), sourceCommit: f.c.sourceCommit, classification: 'constructed_offline_test',
    decisionId: p.decision.decisionId, decisionAt: v.decisionAt, inputSha256: p.decision.inputSha256,
    portfolioSnapshotSha256: v.binding.portfolioSnapshotSha256, pamrConsumption: link,
    quote: { ...v.observation, instrumentId: f.c.instrumentId, source: 'declared-simulated-observation-v2', price: executionPrice(f.c, p.action.side ?? 'buy', v.observation.referencePrice) },
    fee: { amount: f.c.costs.commissionPerOrder, currency: 'USD', source: 'declared-simulated-cost-v2' },
    order: { instrumentId: f.c.instrumentId, route: 'RHS', side: p.action.side ?? 'buy', type: 'limit', timeInForce: 'day', quantity: p.action.quantity ?? d('1'), limitPrice: p.action.hypothetical?.orderLimit ?? d('1'), currency: 'USD' },
    expiresAt: iso(f.time() + 60000) });
}
function entry(f = fixture()) { prepare(f, 1); f.advance(); const ready = prepare(f, 2); return { f, ...ready, preview: preview(f, ready.v, ready.p, ready.link) }; }
function submit(f: Fixture, pv: ReturnType<typeof preview>) {
  const termsHash = '7'.repeat(64), confirmationToken = 'T'.repeat(43), admission = f.store.admit({ preview: pv, termsHash, confirmationToken });
  const payload = { dispatchId: randomUUID(), preview: pv, termsHash, confirmationToken, admissionHandle: admission.handle };
  f.store.submit(payload); return payload;
}
function fill(f: Fixture, pv: ReturnType<typeof preview>): SyntheticRunExecution {
  return { version: 2, executionId: randomUUID(), receiptId: randomUUID(), runId: f.c.runId, configSha256: simulationDigest(f.c),
    decisionId: pv.decisionId, quantity: pv.order.quantity, price: executionPrice(f.c, pv.order.side, d('1')), fee: f.c.costs.commissionPerOrder, currency: 'USD',
    observation: { referencePrice: d('1'), observedAt: iso(f.time()), availableAt: iso(f.time()), evidenceSha256: 'd'.repeat(64) } };
}
function rejected(fn: () => unknown, reason: string) {
  try { fn(); throw new Error('expected rejection'); } catch (error) { expect(error).toBeInstanceOf(PAMRConsumptionRejected); expect((error as PAMRConsumptionRejected).reason).toBe(reason); }
}
it('retains no-action then entry once, observes actual holdings, and permits a cash-exit proposal', () => {
  const f = fixture(), first = prepare(f, 1); expect(first.p.action.outcome).toBe('no_action'); expect(counts(f)).toEqual([0, 0, 0]);
  f.advance(); const second = prepare(f, 2), pv = preview(f, second.v, second.p, second.link), payload = submit(f, pv);
  expect(second.p.action.quantity?.value).toBe('4.990000000000000000'); expect(f.store.read(payload.dispatchId)?.pamrConsumption).toEqual(second.link);
  f.advance(100); f.store.observeExecution(payload.dispatchId, fill(f, pv));
  expect(f.store.portfolio().snapshot.cash.value).toBe('15.00000000'); expect(f.store.portfolio().snapshot.quantity.value).toBe('4.990000000000000000');
  expect(f.store.readPAMRConsumer(payload.dispatchId)).toMatchObject({ input: second.v, proposal: second.p, preview: pv, termsHash: payload.termsHash, order: { status: 'filled' } });
  f.advance(); const third = prepare(f, 3); expect(third.p.action).toMatchObject({ outcome: 'proposal', side: 'sell', quantity: { value: '4.990000000000000000' } });
  expect(f.store.readPAMRConsumption(third.link).manifest.previousManifestSha256).toBe(second.link.evidenceManifestSha256);
  expect(readdirSync(f.evidenceRoot)).toHaveLength(4); expect(counts(f)).toEqual([1, 1, 2]);
  expect(JSON.parse(readFileSync(join(f.evidenceRoot, second.link.evidenceManifestSha256, 'input.json'), 'utf8'))).toEqual(second.v);
});
it.each(['same', 'clock', 'artifact whitespace'] as const)('never reissues a consumed no-action ordinal: %s', kind => {
  const f = fixture(), first = prepare(f, 1), before = readdirSync(f.evidenceRoot).sort(); let v = structuredClone(first.v);
  if (kind === 'clock') { f.advance(1); v = input(f, 1); } if (kind === 'artifact whitespace') { v.artifactText = ` \n${v.artifactText}\n`; rebind(v); }
  rejected(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), proposal(v)), 'already_consumed');
  expect(readdirSync(f.evidenceRoot).sort()).toEqual(before); expect(counts(f)).toEqual([0, 0, 0]); expect(f.store.readPAMRConsumption(first.link).input).toEqual(first.v);
});
it('consumes a current valid abstention but grants no admission for no-action evidence', () => {
  const f = fixture(), v = input(f, 1); v.lifecycleDisposition = 'unknown'; const p = proposal(v);
  const link = f.store.preparePAMRConsumption(Buffer.from(canonical(v)), p); expect(f.store.readPAMRConsumption(link).proposal.action.outcome).toBe('abstain');
  rejected(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), p), 'already_consumed');
  expect(() => submit(f, preview(f, v, p, link))).toThrow(); expect(counts(f)).toEqual([0, 0, 0]);
});
it.each(['exclusive', 'market', 'policy', 'stage', 'flags'] as const)('rejects invalid construction before owner creation: %s', kind => {
  const root = privateRoot(), path = join(root, 'mock.sqlite'), c = config(), p = policy(c);
  const options: ConstructorParameters<typeof SyntheticMockRobinhoodStore>[3] = { simulationRun: c, pamrPolicy: p };
  if (kind === 'exclusive') options.sizingPolicy = {}; if (kind === 'market') options.simulationRun = { ...c, classification: 'declared_market_uncalibrated' };
  if (kind === 'policy') options.pamrPolicy = { ...p, configSha256: '0'.repeat(64) }; if (kind === 'stage') options.evidenceStageForTest = 1 as unknown as (s: EvidenceStage) => void;
  if (kind === 'flags') vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', '');
  expect(() => new SyntheticMockRobinhoodStore(path, () => initial, undefined, options)).toThrow(); expect(readdirSync(root)).toEqual([]);
});
it.each(['missing', 'mixed', 'market', 'shadow identity', 'unbound identity'] as const)('strictly discriminates PAMR previews: %s', kind => {
  const e = entry(), raw = JSON.parse(canonical(e.preview));
  if (kind === 'missing') delete raw.pamrConsumption; if (kind === 'mixed') raw.sizingEvidence = {};
  if (kind === 'market') raw.classification = 'declared_market_uncalibrated'; if (kind === 'shadow identity') raw.decisionId = `shadow-decision-${'a'.repeat(64)}`;
  if (kind === 'unbound identity') raw.decisionId = `pamr-consumer-decision-${'a'.repeat(63)}`;
  expect(syntheticMockRunPreviewSchema.safeParse(raw).success).toBe(false);
  expect(syntheticMockOrderViewSchema.safeParse({ source: simulationSource, dispatchId: randomUUID(), mockOrderId: 'mock-test', previewId: randomUUID(), status: 'accepted', executions: [], cancelAcknowledged: false, sizingEvidence: {}, pamrConsumption: e.link }).success).toBe(false);
});
it.each(['decision', 'input', 'snapshot', 'quantity', 'limit', 'observation', 'time', 'lineage', 'config', 'proposal', 'unowned'] as const)('rejects forged admission joins without admission: %s', kind => {
  const e = entry(), raw = JSON.parse(canonical(e.preview));
  if (kind === 'decision') raw.decisionId = `pamr-consumer-decision-${'f'.repeat(64)}`; if (kind === 'input') raw.inputSha256 = 'f'.repeat(64);
  if (kind === 'snapshot') raw.portfolioSnapshotSha256 = 'f'.repeat(64); if (kind === 'quantity') raw.order.quantity = d('1'); if (kind === 'limit') raw.order.limitPrice = d('1.01');
  if (kind === 'observation') raw.quote.evidenceSha256 = 'f'.repeat(64); if (kind === 'time') raw.decisionAt = iso(e.f.time() - 199);
  if (kind === 'lineage') raw.pamrConsumption.ordinal = 1; if (kind === 'config') raw.pamrConsumption.configuredOwnerPolicySha256 = 'f'.repeat(64);
  if (kind === 'proposal') raw.pamrConsumption.proposalSha256 = 'f'.repeat(64); if (kind === 'unowned') raw.pamrConsumption = entry().link;
  expect(() => e.f.store.admit({ preview: raw, termsHash: '7'.repeat(64), confirmationToken: 'T'.repeat(43) })).toThrow(); expect(counts(e.f)).toEqual([0, 0, 0]);
});
it('rejects a self-consistent pure snapshot that is not the owned actual portfolio', () => {
  const f = fixture(), v = input(f, 1); v.portfolio.snapshot = snapshot(f.c, units(d('19'), 8), 0n, [{ hypothetical: true }]); rebind(v);
  rejected(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), proposal(v)), 'binding_mismatch');
  expect(readdirSync(f.evidenceRoot)).toEqual(['policy.json']); expect(f.store.portfolio().snapshot.cash.value).toBe('20.00000000');
});
it.each(['future', 'stale', 'invalid clock'] as const)('checks actual clock before consumption: %s', kind => {
  const f = fixture(), v = input(f, 1), p = proposal(v);
  f.advance(kind === 'future' ? -1 : kind === 'stale' ? 1001 : Number.NaN);
  rejected(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), p), 'invalid_clock'); expect(readdirSync(f.evidenceRoot)).toEqual(['policy.json']); expect(counts(f)).toEqual([0, 0, 0]);
  f.setTime(initial);
  expect(prepare(f, 1).link.ordinal).toBe(1);
});
it.each([-1, 1001])('rechecks current clock at admission after consuming evidence: delta=%s', delta => {
  const e = entry(); e.f.advance(delta); expect(() => submit(e.f, e.preview)).toThrow(); expect(counts(e.f)).toEqual([0, 0, 0]); expect(readdirSync(e.f.evidenceRoot)).toHaveLength(3);
});
it('keeps malformed and oversized pre-write rejections normal', () => {
  const f = fixture(), v = input(f, 1), p = proposal(v);
  rejected(() => f.store.preparePAMRConsumption(Buffer.from('{"x":1,"x":2}'), p), 'invalid_input');
  rejected(() => f.store.preparePAMRConsumption(Buffer.alloc(262145), p), 'resource_limit');
  expect(readdirSync(f.evidenceRoot)).toEqual(['policy.json']); expect(prepare(f, 1).link.ordinal).toBe(1);
});
it.each(['missing', 'different'] as const)('checks actual writer before creating any consumption: %s', fault => {
  const f = fixture(), v = input(f, 1), p = proposal(v), marker = f.path + '.lock';
  if (fault === 'missing') rmSync(marker); else writeFileSync(marker, 'different-writer');
  expect(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), p)).toThrow(); expect(readdirSync(f.evidenceRoot)).toEqual(['policy.json']);
  expect(() => f.store.portfolio()).toThrow(); expect(() => f.store.close()).toThrow(); expect(existsSync(marker)).toBe(fault === 'different');
});
it.each(['artifact-file-sync', 'artifact-staging-sync', 'artifact-publish', 'artifact-root-sync'] as const)('poisons and retains post-mutation uncertainty at %s', stage => {
  for (const typed of [false, true]) {
    const f = fixture(s => { if (s === stage) throw typed ? new PAMRConsumptionRejected('already_consumed') : new Error('constructed write failure'); });
    const v = input(f, 1); expect(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), proposal(v))).toThrow();
    expect(readdirSync(f.evidenceRoot).length).toBeGreaterThan(1); expect(counts(f)).toEqual([0, 0, 0]); expect(() => f.store.portfolio()).toThrow(); expect(() => f.store.close()).toThrow(); expect(existsSync(f.path + '.lock')).toBe(true);
  }
});
it('detects writer loss after complete publication without discarding the orphan', () => {
  let marker = ''; const f = fixture(s => { if (s === 'artifact-root-sync') writeFileSync(marker, 'different-writer'); }); marker = f.path + '.lock';
  const v = input(f, 1); expect(() => f.store.preparePAMRConsumption(Buffer.from(canonical(v)), proposal(v))).toThrow();
  expect(readdirSync(f.evidenceRoot).filter(n => /^[a-f0-9]{64}$/.test(n))).toHaveLength(1); expect(counts(f)).toEqual([0, 0, 0]);
  expect(() => f.store.portfolio()).toThrow(); expect(() => f.store.close()).toThrow(); expect(readFileSync(marker, 'utf8')).toBe('different-writer');
});
it('replays the full persisted chain, including an unselected ancestor', () => {
  const e = entry(); writeFileSync(join(e.f.evidenceRoot, readdirSync(e.f.evidenceRoot).find(n => n !== 'policy.json' && n !== e.link.evidenceManifestSha256)!, 'input.json'), '{}');
  expect(() => e.f.store.readPAMRConsumption(e.link)).toThrow(); expect(() => e.f.store.portfolio()).toThrow(); expect(() => e.f.store.close()).toThrow(); expect(existsSync(e.f.path + '.lock')).toBe(true);
});
it('reopens read-only, retains exact submit reads, and blocks every mutation family', () => {
  const e = entry(), payload = submit(e.f, e.preview), before = e.f.store.read(payload.dispatchId); e.f.store.close();
  const reopened = new SyntheticMockRobinhoodStore(e.f.path, e.f.time, undefined, { simulationRun: e.f.c, pamrPolicy: e.f.p }); stores.push(reopened);
  expect(reopened.pamrConsumptionReadOnly).toBe(true); expect(reopened.read(payload.dispatchId)).toEqual(before); expect(reopened.submit(payload)).toEqual(before);
  expect(reopened.readPAMRConsumption(e.link).input).toEqual(e.v); expect(reopened.readPAMRConsumer(payload.dispatchId)?.proposal).toEqual(e.p);
  rejected(() => reopened.preparePAMRConsumption(Buffer.from(canonical(e.v)), e.p), 'readonly');
  for (const mutation of [() => reopened.admit({ preview: e.preview, termsHash: payload.termsHash, confirmationToken: payload.confirmationToken }), () => reopened.submit({ ...payload, dispatchId: randomUUID() }), () => reopened.cancel(payload.dispatchId), () => reopened.observeExecution(payload.dispatchId, fill(e.f, e.preview)), () => reopened.settleCanceled(payload.dispatchId)]) expect(mutation).toThrow();
  expect(counts(e.f)).toEqual([1, 1, 1]); reopened.close(); expect(existsSync(e.f.path + '.lock')).toBe(false);
  expect(() => new SyntheticMockRobinhoodStore(e.f.path, e.f.time, undefined, { simulationRun: e.f.c })).toThrow(); expect(existsSync(e.f.path + '.lock')).toBe(true);
});
it('detects tampered stored admission facts on reopen and retains ownership', () => {
  const e = entry(); submit(e.f, e.preview); e.f.store.close(); const db = new Database(e.f.path);
  try { db.prepare('UPDATE mock_admissions SET preview_sha=?').run('0'.repeat(64)); } finally { db.close(); }
  expect(() => new SyntheticMockRobinhoodStore(e.f.path, e.f.time, undefined, { simulationRun: e.f.c, pamrPolicy: e.f.p })).toThrow(); expect(existsSync(e.f.path + '.lock')).toBe(true);
});
