import * as fs from 'node:fs';
import fsMutable from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { rmSync, readdirSync } from 'node:fs';
import { canonical, digest } from './ledger-canonical.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { projectConstructedSpyG05 } from './constructed-spy-g05-projection.js';
import type { SpyDailyInputRequest } from './spy-daily-input-consistency.js';
import {
  ConstructedSpySourceError, ConstructedSpySourceStore,
  type ConstructedSpySourceOwner,
} from './constructed-spy-source-retention.js';
import {
  simulationDigest, simulationRunSchema, snapshot as simulationSnapshot, units,
  type SimulationRun,
} from './synthetic-simulation-economics.js';
import { storageFixture } from './storage-fixture.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (time: number) => new Date(time).toISOString();
const plus = (value: string, delta: number) => iso(Date.parse(value) + delta);
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const roots: string[] = [];
let cleanupBlocked = false;

type DailyFixture = SpyDailyInputRequest;
type ConsumerFixture = ReturnType<typeof consumer>;

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(date + 'T00:00:00.000Z') + (daylight ? 4 : 5) * hour);
}

function dailyRequest(): DailyFixture {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(sessionDate + 'T00:00:00.000Z') + day).toISOString().slice(0, 10);
    return { sessionDate, ordinal: 100 + index, dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate) };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const issuedAt = lastEnd;
  const receivedAt = plus(issuedAt, 1_000);
  const availableAt = plus(receivedAt, 1_000);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1' as const,
    classification: 'constructed_offline_test' as const,
    epochId: '11111111-1111-4111-8111-111111111111',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(availableAt, 1_000),
    current: {
      feed: 'iex' as const, symbol: 'SPY' as const, currency: 'USD' as const, timeframe: '1Day' as const,
      adjustment: 'all' as const, asof: '2026-01-01', requestStart: calendar[0].dayStartsAt,
      requestEnd: plus(lastEnd, -1), issuedAt, receivedAt, availableAt, calendar,
      bars: calendar.map((row, index) => ({ providerTimestamp: row.dayStartsAt, adjustedClose: d(index === 252 ? '2.00' : '1.00') })),
    },
    predecessor: null,
    revision: 0 as const,
  };
}

function config(evaluationAt: string): SimulationRun {
  return simulationRunSchema.parse({
    version: 2, runId: '22222222-2222-4222-8222-222222222222', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: d('20.00'), quantity: d('0.000') },
    costs: { commissionPerOrder: d('0.010'), spreadFraction: d('0.000'), slippageFraction: d('0.000') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 960_000, maxObservationAgeMs: 5_000,
    validThrough: plus(evaluationAt, hour), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  });
}

function consumer(daily: DailyFixture, run = config(plus(daily.decisionAt, 1_000))) {
  const evaluationAt = plus(daily.decisionAt, 1_000);
  const portfolio = {
    snapshot: simulationSnapshot(run, units(run.genesis.cash, 8), units(run.genesis.quantity, 18), []),
    state: 'settled' as const,
  };
  return {
    config: run, portfolio, lifecycleDisposition: 'settled' as const,
    observation: { referencePrice: d('3'), observedAt: plus(daily.decisionAt, 100),
      availableAt: plus(daily.decisionAt, 200), evidenceSha256: 'c'.repeat(64) },
    evaluationAt, controls: { passiveSha256: 'd'.repeat(64), cashAssumptionSha256: 'e'.repeat(64) },
    markBasis: 'constructed_raw_reference' as const, corporateActionState: 'constructed_none' as const,
  };
}

function inputBytes(daily: DailyFixture = dailyRequest(), supplied: ConsumerFixture = consumer(daily), lexical = false): Buffer {
  const dailyText = lexical
    ? ' \n' + JSON.stringify({ revision: daily.revision, predecessor: daily.predecessor, current: daily.current,
      decisionAt: daily.decisionAt, declaredAt: daily.declaredAt, epochId: daily.epochId,
      classification: daily.classification, schema: daily.schema }, null, 1) + ' \t'
    : canonical(daily);
  const outer = { schema: 'gelt.constructed-spy-g05-projection-input.v1', dailyRequestText: dailyText, consumer: supplied };
  return lexical
    ? Buffer.from(' \n' + JSON.stringify({ consumer: supplied, dailyRequestText: dailyText, schema: outer.schema }, null, 1) + ' \n', 'utf8')
    : Buffer.from(canonical(outer), 'utf8');
}

function ownerFor(input: Buffer, projectionOverride?: ReturnType<typeof projectConstructedSpyG05>): ConstructedSpySourceOwner {
  const projection = projectionOverride ?? projectConstructedSpyG05(input);
  if (projection.status !== 'projected') throw new Error('fixture projector rejected');
  const outer = JSON.parse(input.toString('utf8')) as { dailyRequestText: string; consumer: { config: SimulationRun } };
  const daily = JSON.parse(outer.dailyRequestText) as DailyFixture;
  const run = simulationRunSchema.parse(outer.consumer.config);
  return {
    schema: 'gelt.constructed-spy-source-owner.v1',
    caseEpochId: daily.epochId,
    runId: run.runId,
    sourceCommit: run.sourceCommit,
    configSha256: simulationDigest(run),
    candidateId: candidateShadowId(parseCandidateShadowManifest(projection.manifestText)),
    projectionId: projection.projectionId,
    originalInputSha256: sha(input),
  };
}

function fixtureRoot(): string {
  const value = storageFixture('constructed-spy-source-test-');
  roots.push(value);
  return value;
}

function captureError(fn: () => unknown, reason: ConstructedSpySourceError['reason']) {
  try { fn(); } catch (caught) {
    expect(caught).toBeInstanceOf(ConstructedSpySourceError);
    expect((caught as ConstructedSpySourceError).reason).toBe(reason);
    expect((caught as Error).message).toBe('constructed SPY source unavailable');
    return;
  }
  throw new Error('expected fixed source-store error');
}

function descriptorPath(fd: number): string {
  try { return fsMutable.readlinkSync('/proc/self/fd/' + fd); } catch { return ''; }
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GELT_SYNTHETIC_ORDER_HARNESS', 'offline-test-only');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
});
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  if (cleanupBlocked) return;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('retains exact lexical outer bytes, replays the complete projection, and isolates returned mutations', () => {
  const daily = dailyRequest(), supplied = consumer(daily);
  const exactA = inputBytes(daily, supplied, false), exactB = inputBytes(daily, supplied, true);
  const projectionA = projectConstructedSpyG05(exactA), projectionB = projectConstructedSpyG05(exactB);
  expect(projectionA.status).toBe('projected');
  expect(projectionB.status).toBe('projected');
  expect(projectionA).toEqual(projectionB);
  expect(sha(exactA)).not.toBe(sha(exactB));
  if (projectionA.status !== 'projected') throw new Error('fixture projector rejected');
  const rootA = fixtureRoot(), rootB = fixtureRoot();
  const ownerA = ownerFor(exactA, projectionA), ownerB = ownerFor(exactB, projectionB);
  const storeA = ConstructedSpySourceStore.create(rootA, ownerA, exactA);
  const storeB = ConstructedSpySourceStore.create(rootB, ownerB, exactB);
  const resultA = storeA.read(), resultB = storeB.read();
  expect(resultA.originalInput).toEqual(exactA);
  expect(resultB.originalInput).toEqual(exactB);
  expect(canonical(resultA.projection)).toBe(canonical(resultB.projection));
  expect(resultA.receipt.projectionSha256).toBe(resultB.receipt.projectionSha256);
  expect(resultA.receipt.originalInputSha256).not.toBe(resultB.receipt.originalInputSha256);
  expect(resultA.receipt.receiptSha256).not.toBe(resultB.receipt.receiptSha256);
  const retainedReceipt = canonical(resultA.receipt);
  resultA.originalInput.fill(0);
  (resultA.projection as unknown as { projectionId: string }).projectionId = 'constructed-spy-g05-' + '0'.repeat(64);
  (resultA.receipt as unknown as { dailyInputSha256: string }).dailyInputSha256 = 'f'.repeat(64);
  expect(storeA.read().originalInput).toEqual(exactA);
  expect(storeA.read().projection.projectionId).toBe(ownerA.projectionId);
  expect(canonical(storeA.read().receipt)).toBe(retainedReceipt);
  captureError(() => ConstructedSpySourceStore.reopen(rootA, ownerA), 'unavailable');
  captureError(() => ConstructedSpySourceStore.create(rootA, ownerA, exactA), 'unavailable');
  storeA.close();
  storeB.close();
  expect(readdirSync(rootA).sort()).toEqual(['source.json']);
  expect(readdirSync(rootB).sort()).toEqual(['source.json']);

  const path = join(rootA, 'source.json');
  const before = { bytes: fs.readFileSync(path), file: fs.statSync(path), directory: fs.statSync(rootA), names: readdirSync(rootA).sort() };
  const mutationCalls: string[] = [];
  const relevant = (candidate: unknown) => typeof candidate === 'string'
    && (candidate === rootA || candidate.startsWith(rootA + '/'));
  const originalWriteFile = fsMutable.writeFileSync, originalFsync = fsMutable.fsyncSync;
  const originalUnlink = fsMutable.unlinkSync, originalRename = fsMutable.renameSync,
    originalMkdir = fsMutable.mkdirSync, originalOpen = fsMutable.openSync;
  const writeSpy = vi.spyOn(fsMutable, 'writeFileSync').mockImplementation(((...args: any[]) => {
    const path = typeof args[0] === 'string' ? args[0] : (() => {
      try { return fsMutable.readlinkSync('/proc/self/fd/' + args[0]); } catch { return ''; }
    })();
    if (relevant(path)) mutationCalls.push('write');
    return (originalWriteFile as (...values: any[]) => void)(...args);
  }) as typeof fsMutable.writeFileSync);
  const syncSpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    try { if (relevant(fsMutable.readlinkSync('/proc/self/fd/' + fd))) mutationCalls.push('fsync'); } catch { /* unrelated descriptor */ }
    return originalFsync(fd);
  });
  const unlinkSpy = vi.spyOn(fsMutable, 'unlinkSync').mockImplementation((path: fs.PathLike) => {
    if (relevant(path)) mutationCalls.push('unlink');
    return originalUnlink(path);
  });
  const renameSpy = vi.spyOn(fsMutable, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
    if (relevant(from) || relevant(to)) mutationCalls.push('rename');
    return originalRename(from, to);
  });
  const mkdirSpy = vi.spyOn(fsMutable, 'mkdirSync').mockImplementation(((path: fs.PathLike, options?: any) => {
    if (relevant(path)) mutationCalls.push('mkdir');
    return (originalMkdir as (...values: any[]) => any)(path, options);
  }) as typeof fsMutable.mkdirSync);
  const openSpy = vi.spyOn(fsMutable, 'openSync').mockImplementation(((path: fs.PathLike, flags: any, mode?: any) => {
    const writing = typeof flags === 'string' ? flags !== 'r'
      : Boolean(flags & (fsMutable.constants.O_WRONLY | fsMutable.constants.O_RDWR | fsMutable.constants.O_CREAT | fsMutable.constants.O_TRUNC | fsMutable.constants.O_APPEND));
    if (writing && relevant(path)) mutationCalls.push('open-for-write');
    return (originalOpen as any)(path, flags, mode);
  }) as typeof fsMutable.openSync);
  syncBuiltinESMExports();
  const readonly = ConstructedSpySourceStore.reopen(rootA, ownerA);
  expect(readonly.read().originalInput).toEqual(exactA);
  expect(canonical(readonly.read().receipt)).toBe(retainedReceipt);
  readonly.close();
  expect(mutationCalls).toEqual([]);
  writeSpy.mockRestore(); syncSpy.mockRestore(); unlinkSpy.mockRestore(); renameSpy.mockRestore(); mkdirSpy.mockRestore(); openSpy.mockRestore();
  syncBuiltinESMExports();
  const after = { bytes: fs.readFileSync(path), file: fs.statSync(path), directory: fs.statSync(rootA), names: readdirSync(rootA).sort() };
  expect(after.bytes).toEqual(before.bytes);
  expect(after.file.ino).toBe(before.file.ino);
  expect(after.file.mtimeMs).toBe(before.file.mtimeMs);
  expect(after.directory.ino).toBe(before.directory.ino);
  expect(after.directory.mtimeMs).toBe(before.directory.mtimeMs);
  expect(after.names).toEqual(before.names);
  captureError(() => ConstructedSpySourceStore.create(rootA, ownerA, exactA), 'unavailable');
});

it('accepts the exact PR75 one-MiB input and rejects one byte over before persistence', () => {
  const base = inputBytes();
  const exactly = Buffer.concat([base, Buffer.alloc(1_048_576 - base.length, 0x20)]);
  expect(exactly.length).toBe(1_048_576);
  const projected = projectConstructedSpyG05(exactly);
  expect(projected.status).toBe('projected');
  if (projected.status !== 'projected') throw new Error('fixture projector rejected');
  const root = fixtureRoot();
  const store = ConstructedSpySourceStore.create(root, ownerFor(exactly, projected), exactly);
  expect(store.read().originalInput).toEqual(exactly);
  store.close();
  expect(fs.statSync(join(root, 'source.json')).size).toBeLessThanOrEqual(3_145_728);

  const oversized = Buffer.concat([exactly, Buffer.from(' ')]);
  const oversizedOwner = { ...ownerFor(base), originalInputSha256: sha(oversized) };
  const empty = fixtureRoot();
  captureError(() => ConstructedSpySourceStore.create(empty, oversizedOwner, oversized), 'invalid_input');
  expect(readdirSync(empty)).toEqual([]);
});

it('replays a valid predecessor revision without splicing predecessor rows into the current 253-row window', () => {
  const daily = dailyRequest();
  const predecessor = JSON.parse(canonical(daily.current)) as typeof daily.current;
  predecessor.receivedAt = plus(predecessor.issuedAt, 500);
  predecessor.availableAt = plus(predecessor.receivedAt, 100);
  predecessor.bars[126].adjustedClose = d('1.50');
  const revisedDaily = { ...daily, predecessor, revision: 1 as const };
  const input = inputBytes(revisedDaily), projected = projectConstructedSpyG05(input);
  expect(projected.status).toBe('projected');
  if (projected.status !== 'projected') throw new Error('fixture projector rejected');
  const root = fixtureRoot(), owner = ownerFor(input, projected);
  const writer = ConstructedSpySourceStore.create(root, owner, input);
  const retained = writer.read();
  expect(retained.originalInput).toEqual(input);
  expect(retained.projection.dailyAssessment.predecessorSha256).not.toBeNull();
  expect(JSON.parse(retained.projection.ruleInputText).bars).toHaveLength(253);
  expect(JSON.parse(retained.projection.ruleInputText).bars[126].adjustedClose).toEqual(d('1.00'));
  writer.close();
  const reopened = ConstructedSpySourceStore.reopen(root, owner);
  expect(canonical(reopened.read().projection)).toBe(canonical(projected));
  reopened.close();
});

it('rejects malformed, extra-key, fatal-UTF8, and invalid-owner inputs without touching an empty root', () => {
  const good = inputBytes(), owner = ownerFor(good), outer = JSON.parse(good.toString('utf8'));
  const duplicate = good.toString('utf8').replace(
    '"schema":"gelt.constructed-spy-g05-projection-input.v1"',
    '"schema":"gelt.constructed-spy-g05-projection-input.v1","schema":"gelt.constructed-spy-g05-projection-input.v1"',
  );
  const contradictoryDaily = dailyRequest();
  contradictoryDaily.current.requestEnd = plus(contradictoryDaily.current.requestEnd, -1);
  const contradictory = inputBytes(contradictoryDaily);
  const malformed = [
    Buffer.from('{'),
    Buffer.from([0xff]),
    Buffer.from(canonical({ ...outer, extra: 'synthetic-private-sentinel' })),
    Buffer.from(duplicate),
    contradictory,
  ];
  for (const input of malformed) {
    const root = fixtureRoot();
    const shapedOwner = { ...owner, originalInputSha256: sha(input) };
    captureError(() => ConstructedSpySourceStore.create(root, shapedOwner, input), 'invalid_input');
    expect(readdirSync(root)).toEqual([]);
  }
  const root = fixtureRoot();
  captureError(() => ConstructedSpySourceStore.create(root, { ...owner, unexpected: 'private' }, good), 'invalid_input');
  expect(readdirSync(root)).toEqual([]);
});

it('binds each supplied identity on create and reopen, including case epoch to the retained daily epoch', () => {
  const input = inputBytes(), owner = ownerFor(input), healthyRoot = fixtureRoot();
  const writer = ConstructedSpySourceStore.create(healthyRoot, owner, input);
  writer.close();
  const wrongOwners: ConstructedSpySourceOwner[] = [
    { ...owner, caseEpochId: '33333333-3333-4333-8333-333333333333' },
    { ...owner, runId: '33333333-3333-4333-8333-333333333333' },
    { ...owner, sourceCommit: 'f'.repeat(40) },
    { ...owner, configSha256: 'f'.repeat(64) },
    { ...owner, candidateId: 'candidate-shadow-' + 'f'.repeat(64) },
    { ...owner, projectionId: 'constructed-spy-g05-' + 'f'.repeat(64) },
    { ...owner, originalInputSha256: 'f'.repeat(64) },
  ];
  for (const wrong of wrongOwners) {
    captureError(() => ConstructedSpySourceStore.reopen(healthyRoot, wrong), 'unavailable');
    const empty = fixtureRoot();
    captureError(() => ConstructedSpySourceStore.create(empty, wrong, input), 'invalid_input');
    expect(readdirSync(empty)).toEqual([]);
  }
});

it('rejects coherent receipt/projection rewrites and noncanonical base64 on a fresh reopen', () => {
  const input = inputBytes(), owner = ownerFor(input);
  const mutateSource = (mutate: (record: any) => void) => {
    const root = fixtureRoot();
    const writer = ConstructedSpySourceStore.create(root, owner, input);
    writer.close();
    const path = join(root, 'source.json');
    const record = JSON.parse(fs.readFileSync(path, 'utf8'));
    mutate(record);
    fs.writeFileSync(path, canonical(record), { mode: 0o600 });
    captureError(() => ConstructedSpySourceStore.reopen(root, owner), 'unavailable');
  };
  mutateSource(record => {
    const { receiptSha256: _prior, ...body } = record.receipt;
    const changed = { ...body, dailyInputSha256: 'f'.repeat(64) };
    record.receipt = { ...changed, receiptSha256: digest(canonical(changed)) };
  });
  mutateSource(record => {
    const { projectionId: _priorProjectionId, ...projectionBody } = record.projection;
    projectionBody.evaluationAt = plus(projectionBody.evaluationAt, 1);
    const changedProjection = {
      ...projectionBody,
      projectionId: 'constructed-spy-g05-' + digest(canonical(projectionBody)),
    };
    record.projection = changedProjection;
    const { receiptSha256: _priorReceiptSha256, ...receiptBody } = record.receipt;
    const changedReceipt = {
      ...receiptBody,
      projectionId: changedProjection.projectionId,
      projectionSha256: digest(canonical(changedProjection)),
    };
    record.receipt = { ...changedReceipt, receiptSha256: digest(canonical(changedReceipt)) };
  });
  mutateSource(record => { record.originalInputBase64 += '!'; });
});

it('rejects unsafe roots, named entries, links, permissions, lengths, and FIFO replacement without repair', () => {
  const input = inputBytes(), owner = ownerFor(input);
  const archivedRoot = () => {
    const root = fixtureRoot();
    const writer = ConstructedSpySourceStore.create(root, owner, input);
    writer.close();
    return root;
  };
  const extraRoot = archivedRoot();
  fs.writeFileSync(join(extraRoot, 'extra'), 'synthetic');
  captureError(() => ConstructedSpySourceStore.reopen(extraRoot, owner), 'unavailable');

  const hardlinkRoot = archivedRoot(), hardlinkParent = fixtureRoot();
  fs.linkSync(join(hardlinkRoot, 'source.json'), join(hardlinkParent, 'linked-source'));
  captureError(() => ConstructedSpySourceStore.reopen(hardlinkRoot, owner), 'unavailable');

  const symlinkRoot = archivedRoot(), symlinkTarget = join(fixtureRoot(), 'moved-source.json');
  fs.renameSync(join(symlinkRoot, 'source.json'), symlinkTarget);
  fs.symlinkSync(symlinkTarget, join(symlinkRoot, 'source.json'));
  captureError(() => ConstructedSpySourceStore.reopen(symlinkRoot, owner), 'unavailable');

  const directoryRoot = archivedRoot(), directoryFile = join(directoryRoot, 'source.json');
  fs.unlinkSync(directoryFile);
  fs.mkdirSync(directoryFile, { mode: 0o700 });
  captureError(() => ConstructedSpySourceStore.reopen(directoryRoot, owner), 'unavailable');

  const permissiveRoot = archivedRoot();
  fs.chmodSync(join(permissiveRoot, 'source.json'), 0o644);
  captureError(() => ConstructedSpySourceStore.reopen(permissiveRoot, owner), 'unavailable');

  const oversizedRoot = archivedRoot();
  fs.writeFileSync(join(oversizedRoot, 'source.json'), Buffer.alloc(3_145_729, 0x20));
  captureError(() => ConstructedSpySourceStore.reopen(oversizedRoot, owner), 'unavailable');

  const emptyRoot = archivedRoot();
  fs.writeFileSync(join(emptyRoot, 'source.json'), Buffer.alloc(0));
  captureError(() => ConstructedSpySourceStore.reopen(emptyRoot, owner), 'unavailable');

  const unsafeRoot = archivedRoot();
  fs.chmodSync(unsafeRoot, 0o755);
  captureError(() => ConstructedSpySourceStore.reopen(unsafeRoot, owner), 'unavailable');

  const activeRoot = fixtureRoot(), active = ConstructedSpySourceStore.create(activeRoot, owner, input);
  const pending = join(activeRoot, '.source.pending');
  fs.unlinkSync(pending);
  execFileSync('mkfifo', ['-m', '600', pending], { stdio: 'ignore' });
  captureError(() => active.read(), 'unavailable');
  expect(readdirSync(activeRoot).sort()).toEqual(['.source.pending', 'source.json']);

  const fifoRoot = fixtureRoot(), fifo = join(fifoRoot, 'source-fifo');
  execFileSync('mkfifo', ['-m', '600', fifo], { stdio: 'ignore' });
  const childSource = 'import { readPrivate } from ' + JSON.stringify(new URL('./private-files.ts', import.meta.url).href)
    + '; try { readPrivate(process.argv[1], 8192, true); process.exitCode = 1; } catch { process.exitCode = 0; }';
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource, fifo], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 10_000,
  });
  // This child probes the imported nonblocking helper directly. The archive
  // call above is separately rejected by its pre-open lstat type check.
  if (child.error) cleanupBlocked = true;
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
}, 20_000);

it('retains stage-specific fence evidence after pending write and file-sync failures', () => {
  const input = inputBytes(), owner = ownerFor(input);
  const target = fixtureRoot(), pendingPath = join(target, '.source.pending');
  const originalWrite = fsMutable.writeFileSync;
  const writeSpy = vi.spyOn(fsMutable, 'writeFileSync').mockImplementation(((...args: any[]) => {
    const fd = args[0];
    if (typeof fd === 'number') {
      try { if (fsMutable.readlinkSync('/proc/self/fd/' + fd) === pendingPath) throw Object.assign(new Error(), { code: 'EIO' }); }
      catch (caught) { if ((caught as NodeJS.ErrnoException).code === 'EIO') throw caught; }
    }
    return (originalWrite as (...values: any[]) => void)(...args);
  }) as typeof fsMutable.writeFileSync);
  syncBuiltinESMExports();
  captureError(() => ConstructedSpySourceStore.create(target, owner, input), 'uncertain');
  writeSpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(target)).toEqual(['.source.pending']);

  const syncRoot = fixtureRoot(), syncTarget = join(syncRoot, '.source.pending');
  const originalFsync = fsMutable.fsyncSync;
  const syncSpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    try { if (fsMutable.readlinkSync('/proc/self/fd/' + fd) === syncTarget) throw Object.assign(new Error(), { code: 'EIO' }); }
    catch (caught) { if ((caught as NodeJS.ErrnoException).code === 'EIO') throw caught; }
    return originalFsync(fd);
  });
  syncBuiltinESMExports();
  captureError(() => ConstructedSpySourceStore.create(syncRoot, owner, input), 'uncertain');
  syncSpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(syncRoot)).toEqual(['.source.pending']);

  const sourceWriteRoot = fixtureRoot(), sourcePath = join(sourceWriteRoot, 'source.json');
  const originalSourceWrite = fsMutable.writeFileSync;
  const sourceWriteSpy = vi.spyOn(fsMutable, 'writeFileSync').mockImplementation(((...args: any[]) => {
    if (typeof args[0] === 'number' && descriptorPath(args[0]) === sourcePath) {
      originalSourceWrite(args[0], Buffer.from('partial-source-record'));
      throw Object.assign(new Error(), { code: 'EIO' });
    }
    return (originalSourceWrite as (...values: any[]) => void)(...args);
  }) as typeof fsMutable.writeFileSync);
  syncBuiltinESMExports();
  captureError(() => ConstructedSpySourceStore.create(sourceWriteRoot, owner, input), 'uncertain');
  sourceWriteSpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(sourceWriteRoot).sort()).toEqual(['.source.pending', 'source.json']);

  const sourceSyncRoot = fixtureRoot(), sourceSyncPath = join(sourceSyncRoot, 'source.json');
  const originalSourceFsync = fsMutable.fsyncSync;
  const sourceSyncSpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    if (descriptorPath(fd) === sourceSyncPath) throw Object.assign(new Error(), { code: 'EIO' });
    return originalSourceFsync(fd);
  });
  syncBuiltinESMExports();
  captureError(() => ConstructedSpySourceStore.create(sourceSyncRoot, owner, input), 'uncertain');
  sourceSyncSpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(sourceSyncRoot).sort()).toEqual(['.source.pending', 'source.json']);

  const pendingDirectoryRoot = fixtureRoot();
  const originalPendingDirectoryFsync = fsMutable.fsyncSync;
  const pendingDirectorySpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    if (descriptorPath(fd) === pendingDirectoryRoot) throw Object.assign(new Error(), { code: 'EIO' });
    return originalPendingDirectoryFsync(fd);
  });
  syncBuiltinESMExports();
  captureError(() => ConstructedSpySourceStore.create(pendingDirectoryRoot, owner, input), 'uncertain');
  pendingDirectorySpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(pendingDirectoryRoot)).toEqual(['.source.pending']);

  const sourceDirectoryRoot = fixtureRoot();
  let directorySyncs = 0;
  const originalSourceDirectoryFsync = fsMutable.fsyncSync;
  const sourceDirectorySpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    if (descriptorPath(fd) === sourceDirectoryRoot && ++directorySyncs === 2) {
      throw Object.assign(new Error(), { code: 'EIO' });
    }
    return originalSourceDirectoryFsync(fd);
  });
  syncBuiltinESMExports();
  captureError(() => ConstructedSpySourceStore.create(sourceDirectoryRoot, owner, input), 'uncertain');
  sourceDirectorySpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(sourceDirectoryRoot).sort()).toEqual(['.source.pending', 'source.json']);
  for (const root of [target, syncRoot, sourceWriteRoot, sourceSyncRoot, pendingDirectoryRoot, sourceDirectoryRoot]) {
    captureError(() => ConstructedSpySourceStore.reopen(root, owner), 'unavailable');
  }
});

it('keeps the pending fence when final pre-unlink sync or unlink fails', () => {
  const input = inputBytes(), owner = ownerFor(input), root = fixtureRoot();
  const store = ConstructedSpySourceStore.create(root, owner, input);
  const originalFsync = fsMutable.fsyncSync;
  const syncSpy = vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: number) => {
    try { if (fsMutable.readlinkSync('/proc/self/fd/' + fd) === root) throw Object.assign(new Error(), { code: 'EIO' }); }
    catch (caught) { if ((caught as NodeJS.ErrnoException).code === 'EIO') throw caught; }
    return originalFsync(fd);
  });
  syncBuiltinESMExports();
  captureError(() => store.close(), 'uncertain');
  syncSpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(root).sort()).toEqual(['.source.pending', 'source.json']);

  const secondRoot = fixtureRoot(), second = ConstructedSpySourceStore.create(secondRoot, owner, input);
  const originalUnlink = fsMutable.unlinkSync;
  const pendingPath = join(secondRoot, '.source.pending');
  const unlinkSpy = vi.spyOn(fsMutable, 'unlinkSync').mockImplementation((path: fs.PathLike) => {
    if (path === pendingPath) throw Object.assign(new Error(), { code: 'EIO' });
    return originalUnlink(path);
  });
  syncBuiltinESMExports();
  captureError(() => second.close(), 'uncertain');
  unlinkSpy.mockRestore();
  syncBuiltinESMExports();
  expect(readdirSync(secondRoot).sort()).toEqual(['.source.pending', 'source.json']);
  captureError(() => ConstructedSpySourceStore.reopen(root, owner), 'unavailable');
  captureError(() => ConstructedSpySourceStore.reopen(secondRoot, owner), 'unavailable');
});

it('requires explicit fixture enables and permanently poisons reads after a gate failure', () => {
  const input = inputBytes(), owner = ownerFor(input), root = fixtureRoot();
  const writer = ConstructedSpySourceStore.create(root, owner, input);
  writer.close();
  const readonly = ConstructedSpySourceStore.reopen(root, owner);
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'disabled');
  captureError(() => readonly.read(), 'unavailable');
  vi.stubEnv('GELT_SYNTHETIC_MOCK_ROBINHOOD', 'offline-test-only');
  captureError(() => readonly.read(), 'unavailable');
  readonly.close();
});
