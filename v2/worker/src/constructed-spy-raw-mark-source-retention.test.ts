import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fsMutable from 'node:fs';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { PathLike } from 'node:fs';
import { canonical, digest } from './ledger-canonical.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { parseResearchJSON } from './research-json.js';
import {
  ConstructedSpyRawMarkSourceError, ConstructedSpyRawMarkSourceStore,
  type ConstructedSpyRawMarkSourceOwner,
} from './constructed-spy-raw-mark-source-retention.js';
import { matchesConstructedSpyRawMark, projectConstructedSpyRawMark } from './constructed-spy-raw-mark.js';
import { simulationDigest, simulationRunSchema, snapshot, units, type SimulationRun } from './synthetic-simulation-economics.js';
import { storageFixture } from './storage-fixture.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (value: number) => new Date(value).toISOString();
const plus = (value: string, amount: number) => iso(Date.parse(value) + amount);
const decimal = (value: string) => ({
  value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0,
});
const roots: string[] = [];
const stores: ConstructedSpyRawMarkSourceStore[] = [];
let cleanupBlocked = false;

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(date + 'T00:00:00.000Z') + (daylight ? 4 : 5) * hour);
}

function dailyRequest() {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(sessionDate + 'T00:00:00.000Z') + day).toISOString().slice(0, 10);
    return { sessionDate, ordinal: 100 + index, dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate) };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const issuedAt = lastEnd, receivedAt = plus(issuedAt, 1_000), availableAt = plus(receivedAt, 1_000);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1' as const,
    classification: 'constructed_offline_test' as const,
    epochId: '33333333-3333-4333-8333-333333333333',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(availableAt, 1_000),
    current: {
      feed: 'iex' as const, symbol: 'SPY' as const, currency: 'USD' as const, timeframe: '1Day' as const,
      adjustment: 'all' as const, asof: '2026-01-01', requestStart: calendar[0].dayStartsAt,
      requestEnd: plus(lastEnd, -1), issuedAt, receivedAt, availableAt, calendar,
      bars: calendar.map((row, index) => ({ providerTimestamp: row.dayStartsAt, adjustedClose: decimal(index === 252 ? '2.00' : '1.00') })),
    },
    predecessor: null,
    revision: 0 as const,
  };
}

function config(evaluationAt: string): SimulationRun {
  return simulationRunSchema.parse({
    version: 2, runId: '44444444-4444-4444-8444-444444444444', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: decimal('20'), quantity: decimal('0') },
    costs: { commissionPerOrder: decimal('0.01'), spreadFraction: decimal('0'), slippageFraction: decimal('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 960_000, maxObservationAgeMs: 5_000,
    validThrough: plus(evaluationAt, hour), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  });
}

function validInput() {
  const daily = dailyRequest();
  const evaluationAt = plus(daily.decisionAt, 300);
  const run = config(evaluationAt);
  return {
    schema: 'gelt.constructed-spy-mark-g05-input.v1',
    classification: 'constructed_offline_test',
    dailyRequestText: canonical(daily),
    consumer: {
      config: run,
      portfolio: {
        snapshot: snapshot(run, units(run.genesis.cash, 8), units(run.genesis.quantity, 18), []),
        state: 'settled' as const,
      },
      lifecycleDisposition: 'settled',
      evaluationAt,
      controls: { passiveSha256: 'c'.repeat(64), cashAssumptionSha256: 'd'.repeat(64) },
    },
    mark: {
      schema: 'gelt.constructed-spy-raw-trade.v1',
      classification: 'constructed_offline_test',
      source: 'supplied_fixture',
      feed: 'iex',
      symbol: 'SPY',
      currency: 'USD',
      priceBasis: 'unadjusted_trade',
      tradeId: 'trade-1',
      price: decimal('3'),
      providerTimestamp: plus(daily.decisionAt, 100),
      receivedAt: plus(daily.decisionAt, 150),
      availableAt: plus(daily.decisionAt, 200),
    },
  };
}

function bytes(value: unknown): Buffer { return Buffer.from(canonical(value), 'utf8'); }
function sha(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }

function ownerFor(input: Buffer): ConstructedSpyRawMarkSourceOwner {
  const result = projectConstructedSpyRawMark(input);
  if (result.status !== 'projected') throw new Error('synthetic raw-mark fixture rejected');
  const outer = JSON.parse(input.toString('utf8')) as ReturnType<typeof validInput>;
  const daily = JSON.parse(outer.dailyRequestText) as ReturnType<typeof dailyRequest>;
  const manifest = parseCandidateShadowManifest(result.projection.manifestText);
  return {
    schema: 'gelt.constructed-spy-raw-mark-source-owner.v1',
    caseEpochId: daily.epochId,
    runId: outer.consumer.config.runId,
    sourceCommit: outer.consumer.config.sourceCommit,
    configSha256: simulationDigest(outer.consumer.config),
    bindingId: result.bindingId,
    projectionId: result.projection.projectionId,
    candidateId: candidateShadowId(manifest),
    originalInputSha256: sha(input),
  };
}

function fixtureRoot(): string {
  const path = storageFixture('constructed-raw-mark-source-');
  roots.push(path);
  return path;
}

function create(root: string, input = bytes(validInput()), ownerBytes = bytes(ownerFor(input))): ConstructedSpyRawMarkSourceStore {
  const store = ConstructedSpyRawMarkSourceStore.create(root, ownerBytes, input);
  stores.push(store);
  return store;
}

function closeStore(store: ConstructedSpyRawMarkSourceStore): void {
  store.close();
  const index = stores.indexOf(store);
  if (index >= 0) stores.splice(index, 1);
}

function forgetStore(store: ConstructedSpyRawMarkSourceStore): void {
  const index = stores.indexOf(store);
  if (index >= 0) stores.splice(index, 1);
}

function captureError(fn: () => unknown, reason: 'invalid_input' | 'unavailable' | 'uncertain'): void {
  try { fn(); } catch (caught) {
    expect(caught).toBeInstanceOf(ConstructedSpyRawMarkSourceError);
    expect((caught as ConstructedSpyRawMarkSourceError).reason).toBe(reason);
    expect((caught as Error).message).toBe('constructed SPY raw-mark source unavailable');
    return;
  }
  throw new Error('expected fixed raw-mark source-store error');
}

function descriptorPath(fd: number): string {
  try { return fsMutable.readlinkSync('/proc/self/fd/' + fd); } catch { return ''; }
}

function receiptBody(receipt: Record<string, unknown>): Record<string, unknown> {
  const { receiptSha256: _prior, ...body } = receipt;
  return body;
}

function rewriteReceipt(receipt: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const body = { ...receiptBody(receipt), ...changes };
  return { ...body, receiptSha256: digest(canonical(body)) };
}

function replaceNullableObjectLeaf(text: string, numberToken: string): string {
  const marker = '"predecessorSha256":null';
  let offset = -1;
  for (let index = text.indexOf(marker); index >= 0; index = text.indexOf(marker, index + marker.length)) {
    if (index === 0 || text[index - 1] !== '\\') { offset = index; break; }
  }
  if (offset < 0) throw new Error('expected nullable object leaf not found');
  return text.slice(0, offset) + marker.replace(':null', ':' + numberToken) + text.slice(offset + marker.length);
}

function archiveFor(input: Buffer): { root: string; owner: ConstructedSpyRawMarkSourceOwner; path: string } {
  const root = fixtureRoot(), owner = ownerFor(input), writer = create(root, input, bytes(owner));
  closeStore(writer);
  return { root, owner, path: join(root, 'raw-mark-source.json') };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
});

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  if (!cleanupBlocked) {
    for (const store of stores.splice(0)) {
      try { store.close(); } catch {
        cleanupBlocked = true;
        throw new Error('raw-mark source-store cleanup unsettled; disposable roots retained');
      }
    }
  }
  vi.unstubAllEnvs();
  if (cleanupBlocked) return;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('retains exact outer and nested daily bytes, complete result/receipt, and isolates returned mutations', () => {
  const value = validInput(), compact = bytes(value);
  const prettyOuter = Buffer.from(JSON.stringify(JSON.parse(compact.toString('utf8')), null, 2), 'utf8');
  const nestedValue = validInput();
  nestedValue.dailyRequestText = JSON.stringify(JSON.parse(nestedValue.dailyRequestText), null, 2);
  const prettyDaily = bytes(nestedValue);
  const rootA = fixtureRoot(), rootB = fixtureRoot(), rootC = fixtureRoot();
  const storeA = create(rootA, compact, bytes(ownerFor(compact)));
  const storeB = create(rootB, prettyOuter, bytes(ownerFor(prettyOuter)));
  const storeC = create(rootC, prettyDaily, bytes(ownerFor(prettyDaily)));
  const a = storeA.read(), b = storeB.read(), c = storeC.read();
  expect(a.originalInput).toEqual(compact);
  expect(b.originalInput).toEqual(prettyOuter);
  expect(c.originalInput).toEqual(prettyDaily);
  expect(a.result.originalMarkPersistence).toBe('not_performed_by_this_api');
  expect(JSON.parse(c.result.projectionInputText).dailyRequestText).toBe(nestedValue.dailyRequestText);
  expect(a.result.projection.dailyAssessment).toEqual(b.result.projection.dailyAssessment);
  expect(a.receipt.originalInputSha256).not.toBe(b.receipt.originalInputSha256);
  expect(a.receipt.resultSha256).not.toBe(b.receipt.resultSha256);
  expect(a.receipt.projectionSha256).toBe(b.receipt.projectionSha256);
  expect(c.receipt.originalInputSha256).not.toBe(a.receipt.originalInputSha256);
  expect(matchesConstructedSpyRawMark(compact, Buffer.from(canonical(a.result), 'utf8'))).toBe(true);
  const receiptText = canonical(a.receipt), resultInputHash = a.result.originalInputSha256;
  a.originalInput.fill(0);
  (a.result as unknown as { bindingId: string }).bindingId = 'changed';
  (a.result.projection as unknown as { projectionId: string }).projectionId = 'changed';
  (a.receipt as unknown as { markSha256: string }).markSha256 = 'f'.repeat(64);
  const fresh = storeA.read();
  expect(fresh.originalInput).toEqual(compact);
  expect(fresh.result.originalInputSha256).toBe(resultInputHash);
  expect(canonical(fresh.receipt)).toBe(receiptText);
  closeStore(storeA); storeA.close();
  closeStore(storeB); closeStore(storeC);
  expect(fsMutable.readdirSync(rootA).sort()).toEqual(['raw-mark-source.json']);
});

it('binds every closed owner identity and rejects malformed or non-reflective owner bytes before mutation', () => {
  const input = bytes(validInput()), owner = ownerFor(input), healthyRoot = fixtureRoot();
  const writer = create(healthyRoot, input, bytes(owner));
  closeStore(writer);
  const wrong: ConstructedSpyRawMarkSourceOwner[] = [
    { ...owner, caseEpochId: '33333333-3333-4333-8333-333333333334' },
    { ...owner, runId: '33333333-3333-4333-8333-333333333334' },
    { ...owner, sourceCommit: 'f'.repeat(40) },
    { ...owner, configSha256: 'f'.repeat(64) },
    { ...owner, bindingId: 'constructed-spy-mark-g05-' + 'f'.repeat(64) },
    { ...owner, projectionId: 'constructed-spy-g05-' + 'f'.repeat(64) },
    { ...owner, candidateId: 'candidate-shadow-' + 'f'.repeat(64) },
    { ...owner, originalInputSha256: 'f'.repeat(64) },
  ];
  for (const changed of wrong) {
    captureError(() => ConstructedSpyRawMarkSourceStore.reopen(healthyRoot, bytes(changed)), 'unavailable');
    const empty = fixtureRoot();
    captureError(() => ConstructedSpyRawMarkSourceStore.create(empty, bytes(changed), input), 'invalid_input');
    expect(fsMutable.readdirSync(empty)).toEqual([]);
  }
  const newlineOwner = { ...owner, bindingId: owner.bindingId + '\n' };
  const empty = fixtureRoot();
  captureError(() => ConstructedSpyRawMarkSourceStore.create(empty, bytes(newlineOwner), input), 'invalid_input');
  expect(fsMutable.readdirSync(empty)).toEqual([]);
  for (const changed of [
    { ...owner, caseEpochId: owner.caseEpochId + '\n' },
    { ...owner, runId: owner.runId + '\n' },
  ]) {
    const target = fixtureRoot();
    captureError(() => ConstructedSpyRawMarkSourceStore.create(target, bytes(changed), input), 'invalid_input');
    expect(fsMutable.readdirSync(target)).toEqual([]);
  }
  const ownerText = canonical(owner);
  const exactly8192 = Buffer.concat([Buffer.from(ownerText), Buffer.alloc(8_192 - Buffer.byteLength(ownerText), 0x20)]);
  const boundedRoot = fixtureRoot();
  const bounded = create(boundedRoot, input, exactly8192);
  expect(bounded.read().receipt.caseEpochId).toBe(owner.caseEpochId);
  closeStore(bounded);
  const tooLong = Buffer.concat([exactly8192, Buffer.from(' ')]);
  const rejectedRoot = fixtureRoot();
  captureError(() => ConstructedSpyRawMarkSourceStore.create(rejectedRoot, tooLong, input), 'invalid_input');
  expect(fsMutable.readdirSync(rejectedRoot)).toEqual([]);
  for (const bad of [Buffer.from('{'), Buffer.from([0xff]), bytes({ ...owner, extra: 'synthetic-private-sentinel' }),
    Buffer.from(ownerText.replace('"schema":"gelt.constructed-spy-raw-mark-source-owner.v1"',
      '"schema":"gelt.constructed-spy-raw-mark-source-owner.v1","schema":"gelt.constructed-spy-raw-mark-source-owner.v1"'))]) {
    const target = fixtureRoot();
    captureError(() => ConstructedSpyRawMarkSourceStore.create(target, bad, input), 'invalid_input');
    expect(fsMutable.readdirSync(target)).toEqual([]);
  }
});

it('accepts the reachable exact one-MiB input and rejects one byte over before writing', () => {
  const base = bytes(validInput());
  const exact = Buffer.concat([base, Buffer.alloc(1_048_576 - base.length, 0x20)]);
  expect(exact.length).toBe(1_048_576);
  expect(projectConstructedSpyRawMark(exact).status).toBe('projected');
  const root = fixtureRoot(), writer = create(root, exact, bytes(ownerFor(exact)));
  expect(writer.read().originalInput).toEqual(exact);
  closeStore(writer);
  const oversized = Buffer.concat([exact, Buffer.from(' ')]);
  const overRoot = fixtureRoot();
  const overOwner = { ...ownerFor(exact), originalInputSha256: sha(oversized) };
  captureError(() => ConstructedSpyRawMarkSourceStore.create(overRoot, bytes(overOwner), oversized), 'invalid_input');
  expect(fsMutable.readdirSync(overRoot)).toEqual([]);
  const disk = archiveFor(base);
  fsMutable.writeFileSync(disk.path, Buffer.alloc(5_242_881, 0x20), { mode: 0o600 });
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(disk.root, bytes(disk.owner)), 'unavailable');
});

it('retains a combined large but schema-valid declared context and raw mark below all field guards', () => {
  const large = validInput();
  const run = large.consumer.config;
  const largestDecimalUnits = 10n ** 38n - 1n;
  large.consumer.portfolio.snapshot = snapshot(run, largestDecimalUnits, largestDecimalUnits, []);
  large.mark.tradeId = 'T'.repeat(64);
  large.mark.price = decimal('9'.repeat(38));
  const input = bytes(large);
  const projected = projectConstructedSpyRawMark(input);
  expect(projected.status).toBe('projected');
  if (projected.status !== 'projected') return;
  expect(Buffer.byteLength(canonical(large.consumer), 'utf8')).toBeLessThan(8_192);
  expect(Buffer.byteLength(canonical(large.mark), 'utf8')).toBeLessThan(8_192);
  const root = fixtureRoot(), owner = ownerFor(input), writer = create(root, input, bytes(owner));
  const retained = writer.read();
  expect(retained.originalInput).toEqual(input);
  expect(retained.result.markRecord.tradeId).toBe('T'.repeat(64));
  expect(retained.result.markRecord.price).toEqual(decimal('9'.repeat(38)));
  expect(retained.result.projection.projectionId).toBe(owner.projectionId);
  expect(fsMutable.statSync(join(root, 'raw-mark-source.json')).size).toBeLessThan(5_242_880);
  closeStore(writer);
});

it('replays exact full source and rejects detached/coherently rehashed results, receipt tampering, and nonfinite leaves', () => {
  const input = bytes(validInput()), archive = archiveFor(input);
  const rewrite = (mutate: (record: any) => void) => {
    const root = fixtureRoot(), owner = archive.owner;
    const writer = create(root, input, bytes(owner)); closeStore(writer);
    const path = join(root, 'raw-mark-source.json');
    const record = JSON.parse(fsMutable.readFileSync(path, 'utf8'));
    mutate(record);
    fsMutable.writeFileSync(path, canonical(record), { mode: 0o600 });
    captureError(() => ConstructedSpyRawMarkSourceStore.reopen(root, bytes(owner)), 'unavailable');
  };
  rewrite(record => {
    record.receipt = rewriteReceipt(record.receipt, { resultSha256: 'f'.repeat(64) });
  });
  rewrite(record => { record.originalInputBytes += 1; });
  rewrite(record => { record.originalInputSha256 = 'f'.repeat(64); });
  rewrite(record => { record.owner = { ...record.owner, runId: '33333333-3333-4333-8333-333333333334' }; });
  rewrite(record => {
    record.result.projection.projectionId = 'constructed-spy-g05-' + 'f'.repeat(64);
    record.receipt = rewriteReceipt(record.receipt, {
      projectionId: record.result.projection.projectionId,
      projectionSha256: digest(canonical(record.result.projection)),
    });
  });
  rewrite(record => {
    record.result.markRecord.price = decimal('4');
    record.receipt = rewriteReceipt(record.receipt, {
      markSha256: digest(canonical(record.result.markRecord)),
      resultSha256: digest(canonical(record.result)),
    });
  });
  rewrite(record => {
    const altered = JSON.parse(input.toString('utf8'));
    altered.mark.price = decimal('4');
    const alternate = projectConstructedSpyRawMark(bytes(altered));
    expect(alternate.status).toBe('projected');
    if (alternate.status !== 'projected') return;
    const { bindingId: _oldBinding, ...body } = alternate;
    body.originalInputSha256 = sha(input);
    record.result = { ...body, bindingId: 'constructed-spy-mark-g05-' + digest(canonical(body)) };
    record.receipt = rewriteReceipt(record.receipt, {
      bindingId: record.result.bindingId,
      resultSha256: digest(canonical(record.result)),
      projectionId: record.result.projection.projectionId,
      projectionSha256: digest(canonical(record.result.projection)),
      markSha256: record.result.markSha256,
      markEvidenceSha256: record.result.markEvidenceSha256,
    });
  });
  for (const exponent of ['1e999', '-1e999']) {
    const root = fixtureRoot(), writer = create(root, input, bytes(archive.owner));
    closeStore(writer);
    const path = join(root, 'raw-mark-source.json');
    const saved = fsMutable.readFileSync(path, 'utf8');
    fsMutable.writeFileSync(path, replaceNullableObjectLeaf(saved, exponent), { mode: 0o600 });
    captureError(() => ConstructedSpyRawMarkSourceStore.reopen(root, bytes(archive.owner)), 'unavailable');
  }
  rewrite(record => { record.unexpected = 'synthetic'; });
  rewrite(record => { record.originalInputBase64 += '!'; });
});

it('requires exact private namespace, inode, regular files, and refuses pending or unsafe roots without repair', () => {
  const input = bytes(validInput()), owner = ownerFor(input);
  const archived = () => archiveFor(input);
  const extra = archived();
  fsMutable.writeFileSync(join(extra.root, 'extra'), 'synthetic');
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(extra.root, bytes(owner)), 'unavailable');
  const hard = archived(), parent = fixtureRoot();
  fsMutable.linkSync(hard.path, join(parent, 'linked-source'));
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(hard.root, bytes(owner)), 'unavailable');
  const symbolic = archived(), moved = join(fixtureRoot(), 'moved-source');
  fsMutable.renameSync(symbolic.path, moved); fsMutable.symlinkSync(moved, symbolic.path);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(symbolic.root, bytes(owner)), 'unavailable');
  const rootAlias = archived(), alias = join(fixtureRoot(), 'root-alias');
  fsMutable.symlinkSync(rootAlias.root, alias);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(alias, bytes(owner)), 'unavailable');
  const directory = archived();
  fsMutable.unlinkSync(directory.path); fsMutable.mkdirSync(directory.path, { mode: 0o700 });
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(directory.root, bytes(owner)), 'unavailable');
  const permissions = archived();
  fsMutable.chmodSync(permissions.path, 0o644);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(permissions.root, bytes(owner)), 'unavailable');
  const unsafeRoot = archived();
  fsMutable.chmodSync(unsafeRoot.root, 0o755);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(unsafeRoot.root, bytes(owner)), 'unavailable');
  const activeRoot = fixtureRoot(), active = create(activeRoot, input, bytes(owner));
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(activeRoot, bytes(owner)), 'unavailable');
  captureError(() => ConstructedSpyRawMarkSourceStore.create(activeRoot, bytes(owner), input), 'unavailable');
  expect(fsMutable.readdirSync(activeRoot).sort()).toEqual(['.raw-mark-source.pending', 'raw-mark-source.json']);
  closeStore(active);

  const replacedRoot = fixtureRoot(), pinned = create(replacedRoot, input, bytes(owner));
  const displacedRoot = replacedRoot + '-displaced';
  roots.push(displacedRoot);
  fsMutable.renameSync(replacedRoot, displacedRoot);
  fsMutable.mkdirSync(replacedRoot, { mode: 0o700 });
  captureError(() => pinned.read(), 'unavailable');
  captureError(() => pinned.close(), 'uncertain');
  forgetStore(pinned);

  const replacedSourceRoot = fixtureRoot(), sourcePinned = create(replacedSourceRoot, input, bytes(owner));
  const movedParent = fixtureRoot(), movedSource = join(movedParent, 'original-source.json');
  const sourcePath = join(replacedSourceRoot, 'raw-mark-source.json');
  fsMutable.renameSync(sourcePath, movedSource);
  fsMutable.writeFileSync(sourcePath, 'synthetic replacement', { mode: 0o600 });
  captureError(() => sourcePinned.read(), 'unavailable');
  captureError(() => sourcePinned.close(), 'uncertain');
  forgetStore(sourcePinned);

  const childSource = [
    "import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';",
    "const q=JSON.parse(fs.readFileSync(0,'utf8')); const {ConstructedSpyRawMarkSourceStore:Store}=await import(q.module); const s=Store.reopen(q.root,Buffer.from(q.owner,'base64')); let count=0,hit=false; const original=fs.lstatSync;",
    "fs.lstatSync=function(p,...args){const stat=original.call(this,p,...args);if(String(p)===q.source&&++count===2){fs.unlinkSync(q.source);execFileSync('mkfifo',['-m','600',q.source]);hit=true;}return stat;}; syncBuiltinESMExports();",
    "try{s.read();process.exitCode=3;}catch(e){if(e.reason!=='unavailable'||e.message!=='constructed SPY raw-mark source unavailable')process.exitCode=4;}",
    "if(!hit)process.exitCode=5; console.log('bounded-rejection');",
  ].join('\n');
  const fifoArchive = archived();
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test',
      GELT_SYNTHETIC_ORDER_HARNESS: 'offline-test-only', GELT_SYNTHETIC_MOCK_ROBINHOOD: 'offline-test-only' },
    input: JSON.stringify({ root: fifoArchive.root, owner: bytes(owner).toString('base64'), source: fifoArchive.path,
      module: new URL('./constructed-spy-raw-mark-source-retention.ts', import.meta.url).href }),
    encoding: 'utf8', timeout: 20_000,
  });
  if (child.error) cleanupBlocked = true;
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).toContain('bounded-rejection');
  expect(fsMutable.statSync(fifoArchive.path).isFIFO()).toBe(true);
}, 30_000);

it('retains stage-specific pending evidence on file and directory sync failures and orders close safely', () => {
  const input = bytes(validInput()), ownerBytes = bytes(ownerFor(input));
  const failFsync = (target: string, occurrence = 1) => {
    let hit = 0;
    const original = fsMutable.fsyncSync;
    const spy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
      if (descriptorPath(fd) === target && ++hit === occurrence) throw Object.assign(new Error('private synthetic fault'), { code: 'EIO' });
      return original(fd);
    });
    syncBuiltinESMExports();
    return { spy, restore: () => { spy.mockRestore(); syncBuiltinESMExports(); } };
  };
  const pendingRoot = fixtureRoot(), pendingPath = join(pendingRoot, '.raw-mark-source.pending');
  const pendingFault = failFsync(pendingPath);
  captureError(() => ConstructedSpyRawMarkSourceStore.create(pendingRoot, ownerBytes, input), 'uncertain');
  pendingFault.restore();
  expect(fsMutable.readdirSync(pendingRoot)).toEqual(['.raw-mark-source.pending']);

  const partialRoot = fixtureRoot(), partialPath = join(partialRoot, 'raw-mark-source.json');
  const originalWrite = fsMutable.writeFileSync;
  const partialSpy = vi.spyOn(fsMutable, 'writeFileSync').mockImplementation(((...args: any[]) => {
    if (descriptorPath(args[0]) === partialPath) {
      (originalWrite as (...values: any[]) => void)(args[0], Buffer.from(args[1]).subarray(0, 16));
      throw Object.assign(new Error('private synthetic fault'), { code: 'EIO' });
    }
    return (originalWrite as (...values: any[]) => void)(...args);
  }) as typeof fsMutable.writeFileSync);
  syncBuiltinESMExports();
  captureError(() => ConstructedSpyRawMarkSourceStore.create(partialRoot, ownerBytes, input), 'uncertain');
  partialSpy.mockRestore(); syncBuiltinESMExports();
  expect(fsMutable.readdirSync(partialRoot).sort()).toEqual(['.raw-mark-source.pending', 'raw-mark-source.json']);
  expect(fsMutable.statSync(partialPath).size).toBe(16);

  const sourceRoot = fixtureRoot(), sourcePath = join(sourceRoot, 'raw-mark-source.json');
  const sourceFault = failFsync(sourcePath);
  captureError(() => ConstructedSpyRawMarkSourceStore.create(sourceRoot, ownerBytes, input), 'uncertain');
  sourceFault.restore();
  expect(fsMutable.readdirSync(sourceRoot).sort()).toEqual(['.raw-mark-source.pending', 'raw-mark-source.json']);

  const directoryRoot = fixtureRoot();
  const fenceDirectoryRoot = fixtureRoot();
  const fenceDirectoryFault = failFsync(fenceDirectoryRoot, 1);
  captureError(() => ConstructedSpyRawMarkSourceStore.create(fenceDirectoryRoot, ownerBytes, input), 'uncertain');
  fenceDirectoryFault.restore();
  expect(fsMutable.readdirSync(fenceDirectoryRoot)).toEqual(['.raw-mark-source.pending']);
  const directoryFault = failFsync(directoryRoot, 2);
  captureError(() => ConstructedSpyRawMarkSourceStore.create(directoryRoot, ownerBytes, input), 'uncertain');
  directoryFault.restore();
  expect(fsMutable.readdirSync(directoryRoot).sort()).toEqual(['.raw-mark-source.pending', 'raw-mark-source.json']);

  const closeRoot = fixtureRoot(), writer = create(closeRoot, input, ownerBytes);
  const closeFault = failFsync(closeRoot);
  captureError(() => writer.close(), 'uncertain');
  forgetStore(writer); closeFault.restore();
  expect(fsMutable.readdirSync(closeRoot).sort()).toEqual(['.raw-mark-source.pending', 'raw-mark-source.json']);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(closeRoot, ownerBytes), 'unavailable');

  const unlinkRoot = fixtureRoot(), unlinkWriter = create(unlinkRoot, input, ownerBytes);
  const pending = join(unlinkRoot, '.raw-mark-source.pending');
  const originalUnlink = fsMutable.unlinkSync;
  const originalCloseFsync = fsMutable.fsyncSync;
  const closeOrder: string[] = [];
  const closeFsyncSpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    if (descriptorPath(fd) === unlinkRoot) closeOrder.push('directory-sync');
    return originalCloseFsync(fd);
  });
  const unlinkSpy = vi.spyOn(fsMutable, 'unlinkSync').mockImplementation((path: PathLike) => {
    if (String(path) === pending) {
      closeOrder.push('fence-unlink');
      throw Object.assign(new Error('private synthetic fault'), { code: 'EIO' });
    }
    return originalUnlink(path);
  });
  syncBuiltinESMExports();
  captureError(() => unlinkWriter.close(), 'uncertain');
  forgetStore(unlinkWriter);
  expect(closeOrder).toEqual(['directory-sync', 'fence-unlink']);
  unlinkSpy.mockRestore(); closeFsyncSpy.mockRestore(); syncBuiltinESMExports();
  expect(fsMutable.existsSync(pending)).toBe(true);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(unlinkRoot, ownerBytes), 'unavailable');
});

it('poisons a writer after read failure and keeps readonly reopen and close free of writes', () => {
  const input = bytes(validInput()), ownerBytes = bytes(ownerFor(input)), root = fixtureRoot();
  const writer = create(root, input, ownerBytes), path = join(root, 'raw-mark-source.json');
  const original = fsMutable.readFileSync(path);
  const pending = join(root, '.raw-mark-source.pending');
  fsMutable.writeFileSync(path, Buffer.from(original.toString('utf8').replace('raw-mark-source-record.v1', 'forged-record.v1')), { mode: 0o600 });
  captureError(() => writer.read(), 'unavailable');
  fsMutable.writeFileSync(path, original, { mode: 0o600 });
  captureError(() => writer.read(), 'unavailable');
  captureError(() => writer.close(), 'uncertain');
  forgetStore(writer);
  expect(fsMutable.existsSync(pending)).toBe(true);

  const saved = archiveFor(input);
  const before = { bytes: fsMutable.readFileSync(saved.path), file: fsMutable.statSync(saved.path),
    directory: fsMutable.statSync(saved.root), names: fsMutable.readdirSync(saved.root).sort() };
  const mutations: string[] = [];
  const originalWrite = fsMutable.writeFileSync, originalFsync = fsMutable.fsyncSync;
  const originalUnlink = fsMutable.unlinkSync, originalRename = fsMutable.renameSync;
  const originalMkdir = fsMutable.mkdirSync, originalOpen = fsMutable.openSync;
  const relevant = (value: unknown) => typeof value === 'string'
    && (value === saved.root || value.startsWith(saved.root + '/'));
  const writeSpy = vi.spyOn(fsMutable, 'writeFileSync').mockImplementation(((...args: any[]) => {
    const pathValue = typeof args[0] === 'string' ? args[0] : descriptorPath(args[0]);
    if (relevant(pathValue)) mutations.push('write');
    return (originalWrite as (...values: any[]) => void)(...args);
  }) as typeof fsMutable.writeFileSync);
  const syncSpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    if (relevant(descriptorPath(fd))) mutations.push('fsync');
    return originalFsync(fd);
  });
  const unlinkSpy = vi.spyOn(fsMutable, 'unlinkSync').mockImplementation((pathValue: PathLike) => {
    if (relevant(String(pathValue))) mutations.push('unlink');
    return originalUnlink(pathValue);
  });
  const renameSpy = vi.spyOn(fsMutable, 'renameSync').mockImplementation((from: PathLike, to: PathLike) => {
    if (relevant(String(from)) || relevant(String(to))) mutations.push('rename');
    return originalRename(from, to);
  });
  const mkdirSpy = vi.spyOn(fsMutable, 'mkdirSync').mockImplementation(((pathValue: PathLike, options?: any) => {
    if (relevant(String(pathValue))) mutations.push('mkdir');
    return (originalMkdir as (...values: any[]) => any)(pathValue, options);
  }) as typeof fsMutable.mkdirSync);
  const openSpy = vi.spyOn(fsMutable, 'openSync').mockImplementation(((pathValue: PathLike, flags: any, mode?: any) => {
    const writing = typeof flags === 'string' ? flags !== 'r'
      : Boolean(flags & (fsMutable.constants.O_WRONLY | fsMutable.constants.O_RDWR | fsMutable.constants.O_CREAT
        | fsMutable.constants.O_TRUNC | fsMutable.constants.O_APPEND));
    if (writing && relevant(String(pathValue))) mutations.push('open-for-write');
    return (originalOpen as any)(pathValue, flags, mode);
  }) as typeof fsMutable.openSync);
  syncBuiltinESMExports();
  const readonly = ConstructedSpyRawMarkSourceStore.reopen(saved.root, ownerBytes);
  stores.push(readonly);
  const receiptText = canonical(readonly.read().receipt);
  expect(readonly.read().originalInput).toEqual(input);
  expect(canonical(readonly.read().receipt)).toBe(receiptText);
  closeStore(readonly);
  expect(mutations).toEqual([]);
  writeSpy.mockRestore(); syncSpy.mockRestore(); unlinkSpy.mockRestore(); renameSpy.mockRestore(); mkdirSpy.mockRestore(); openSpy.mockRestore();
  syncBuiltinESMExports();
  const after = { bytes: fsMutable.readFileSync(saved.path), file: fsMutable.statSync(saved.path),
    directory: fsMutable.statSync(saved.root), names: fsMutable.readdirSync(saved.root).sort() };
  expect(after.bytes).toEqual(before.bytes);
  expect(after.file.ino).toBe(before.file.ino);
  expect(after.file.mtimeMs).toBe(before.file.mtimeMs);
  expect(after.directory.ino).toBe(before.directory.ino);
  expect(after.directory.mtimeMs).toBe(before.directory.mtimeMs);
  expect(after.names).toEqual(before.names);
});

it('requires all synthetic fixture gates on read and close and refuses malformed/nonfinite disk JSON', () => {
  const input = bytes(validInput()), ownerBytes = bytes(ownerFor(input)), root = fixtureRoot();
  const writer = create(root, input, ownerBytes);
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', '');
  captureError(() => writer.read(), 'unavailable');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
  captureError(() => writer.read(), 'unavailable');
  captureError(() => writer.close(), 'uncertain');
  forgetStore(writer);

  const readonlySource = archiveFor(input);
  const empty = fixtureRoot();
  vi.stubEnv('NODE_ENV', 'development');
  captureError(() => ConstructedSpyRawMarkSourceStore.create(empty, ownerBytes, input), 'unavailable');
  expect(fsMutable.readdirSync(empty)).toEqual([]);
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(readonlySource.root, ownerBytes), 'unavailable');
  vi.stubEnv('NODE_ENV', 'test');
  const readonly = ConstructedSpyRawMarkSourceStore.reopen(readonlySource.root, ownerBytes);
  stores.push(readonly);
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', '');
  captureError(() => readonly.close(), 'unavailable');
  forgetStore(readonly);
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  captureError(() => readonly.read(), 'unavailable');

  const malformed = archiveFor(input);
  fsMutable.writeFileSync(malformed.path, Buffer.from('{'), { mode: 0o600 });
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(malformed.root, ownerBytes), 'unavailable');
  const nonfinite = archiveFor(input);
  const disk = fsMutable.readFileSync(nonfinite.path, 'utf8');
  fsMutable.writeFileSync(nonfinite.path, replaceNullableObjectLeaf(disk, '1e999'), { mode: 0o600 });
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(nonfinite.root, ownerBytes), 'unavailable');
  const secondNonfinite = archiveFor(input), disk2 = fsMutable.readFileSync(secondNonfinite.path, 'utf8');
  fsMutable.writeFileSync(secondNonfinite.path, replaceNullableObjectLeaf(disk2, '-1e999'), { mode: 0o600 });
  captureError(() => ConstructedSpyRawMarkSourceStore.reopen(secondNonfinite.root, ownerBytes), 'unavailable');
});

it('preserves exact duplicate-free input and owner boundaries without reflecting private parser text', () => {
  const input = bytes(validInput()), owner = ownerFor(input), root = fixtureRoot();
  const withWhitespace = Buffer.concat([Buffer.from('{\"schema\":\"unrecognized\"}'), Buffer.from(' synthetic-private-control\\u001b')]);
  captureError(() => ConstructedSpyRawMarkSourceStore.create(root, withWhitespace, input), 'invalid_input');
  expect(fsMutable.readdirSync(root)).toEqual([]);
  const invalidInput = Buffer.from('{\"schema\":\"gelt.constructed-spy-mark-g05-input.v1\",\"schema\":\"synthetic-secret\"}');
  const invalidOwner = { ...owner, originalInputSha256: sha(invalidInput) };
  captureError(() => ConstructedSpyRawMarkSourceStore.create(root, bytes(invalidOwner), invalidInput), 'invalid_input');
  expect(fsMutable.readdirSync(root)).toEqual([]);
  expect(parseResearchJSON(Buffer.from('{\"a\":1}'))).toEqual({ a: 1 });
});
