import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { canonical } from './ledger-canonical.js';
import { A64ObservedSnapshotReceiptStore as Store } from './a64-observed-snapshot-receipt.js';
import { evidence, negative, owner } from './a64-observed-snapshot.test-support.js';
import { observedReceiptInspectionCommand as capability, executeObservedReceiptInspection as execute,
  runObservedReceiptInspectionCLI as run } from './a64-observed-receipt-inspection-cli.js';

const roots: string[] = [];
function root() { const p = fs.mkdtempSync(join(tmpdir(), 'gelt-receipt-cli-')); fs.chmodSync(p, 0o700); roots.push(p); return p; }
function request(p: string, binding = owner()) { return canonical({ schema: capability.inputSchema, root: p, binding }); }
function files(p: string) { return Object.fromEntries(fs.readdirSync(p).map(n => { const f = join(p, n), s = fs.lstatSync(f); return [n,
  { mode: s.mode, ino: s.ino, mtime: s.mtimeMs, bytes: s.isFile() ? fs.readFileSync(f).toString('base64') : null }]; })); }
function sink() { const chunks: Buffer[] = []; return { stream: new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }), text: () => Buffer.concat(chunks).toString() }; }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });

it('describes the actual separate read-only contract without consuming input', async () => {
  const stdin = new PassThrough(), out = sink(); expect(await run(['--describe'], stdin, out.stream)).toBe(0);
  expect(JSON.parse(out.text())).toEqual(capability); expect(stdin.readableFlowing).toBeNull(); stdin.destroy();
  expect(capability).toMatchObject({ inputBytes: 8192, rootBytes: 4096, outputBytes: 8192, networkAccess: false, inspectionWrites: 0,
    persistence: 'not_performed', consumptionAttempts: 0, operationalDecisions: 0, qualification: 'NOT_READY', production: 'CLOSED', operations: 'DEFER' });
});
it.each([['--run'], ['--describe', 'PRIVATE_SENTINEL'], ['PRIVATE_SENTINEL']])('rejects extra arguments without reading/reflection: %j', async (...args) => {
  const stdin = new PassThrough(), out = sink(); expect(await run(args, stdin, out.stream)).toBe(64);
  expect(JSON.parse(out.text()).reason).toBe('usage_error'); expect(out.text()).not.toContain('PRIVATE_SENTINEL'); expect(stdin.readableFlowing).toBeNull(); stdin.destroy();
});
it('recomputes a complete positive store without exposing its raw input or changing any file', async () => {
  const f = await evidence(), p = root(), store = Store.create(p, f.binding), receipt = store.retain(f.text); store.close();
  const before = files(p), fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('PRIVATE_SENTINEL'));
  for (let i = 0; i < 2; i++) {
    const out = sink(); expect(await run([], Readable.from([Buffer.from(request(p, f.binding))]), out.stream)).toBe(0);
    const v = JSON.parse(out.text()); expect(v).toMatchObject({ status: 'assessed_data', receipt, reason: null, inspectionWrites: 0, completion: 'unknown', vintage: 'unknown' });
    expect(v.assessment.assessmentSha256).toBe(receipt.assessmentSha256); expect(v.assessment.provenance).toBe('serialized_declarations_not_private_issuance');
    expect(v.input).toBeUndefined(); expect(out.text()).not.toContain(p); expect(out.text()).not.toContain('observations'); expect(Buffer.byteLength(out.text())).toBeLessThanOrEqual(8192);
    expect(files(p)).toEqual(before);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('reports stored negatives without manufacturing a complete-source assessment', () => {
  const p = root(), s = Store.create(p, owner()); s.retain(negative()); s.close(); const before = files(p);
  const r = execute(request(p)), v = JSON.parse(r.text); expect(r.exitCode).toBe(2);
  expect(v).toMatchObject({ status: 'rejected', reason: 'invalid_source', assessment: null, receipt: { fullEvidenceRetained: false, historyUpdates: 0,
    rejectionMeaning: 'locally_reported_not_recomputed_source_failure' } }); expect(files(p)).toEqual(before);
});
it.each(['', '{}', 'null', '{}\n{}', '{"schema":1,"schema":2}', '{"secret":"PRIVATE_SENTINEL"}'])('rejects malformed and foreign input: %s', text => {
  const r = execute(text); expect(r.exitCode).toBe(2); expect(JSON.parse(r.text)).toMatchObject({ status: 'rejected', reason: 'invalid_input' }); expect(r.text).not.toContain('PRIVATE_SENTINEL');
});
it.each(['relative', '/tmp/../tmp/private', '/tmp/secret\0', '/'+ 'x'.repeat(4096), '/'+ 'π'.repeat(2048)])('bounds and normalizes the explicit locator before I/O', locator => {
  const r = execute(canonical({ schema: capability.inputSchema, root: locator, binding: owner() })); expect(r.exitCode).toBe(2); expect(JSON.parse(r.text).status).toBe('rejected'); expect(r.text).not.toContain(locator);
});
it('rejects extra actions and forged binding shapes without opening stores', () => {
  for (const x of [{ ...JSON.parse(request(root())), action: 'repair' }, { ...JSON.parse(request(root())), binding: { ...owner(), schema: 'old.v1' } }]) {
    expect(JSON.parse(execute(canonical(x)).text)).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  }
});
it('bounds input bytes/chunks, fatal UTF8 and incomplete input without a storage fallback', async () => {
  for (const [stdin, reason] of [[Readable.from([Buffer.alloc(8193)]), 'resource_limit'], [Readable.from(Array.from({ length: 4097 }, () => Buffer.from(' '))), 'resource_limit'],
    [Readable.from([Buffer.from([0xc3, 0x28])]), 'invalid_utf8'], [Readable.from(['PRIVATE_SENTINEL']), 'input_transport_failed']] as const) {
    const out = sink(); expect(await run([], stdin, out.stream)).toBe(2); expect(JSON.parse(out.text()).reason).toBe(reason); expect(out.text()).not.toContain('PRIVATE_SENTINEL');
  }
  const exact = execute(' '.repeat(8192)); expect(JSON.parse(exact.text).reason).toBe('invalid_input');
  vi.useFakeTimers(); const stdin = new PassThrough(), out = sink(), task = run([], stdin, out.stream); stdin.write('{');
  await vi.advanceTimersByTimeAsync(5000); expect(await task).toBe(2); expect(JSON.parse(out.text()).reason).toBe('input_timeout'); expect(stdin.destroyed).toBe(true);
});
it.each(['missing', 'pending', 'wrong-owner', 'unsafe-mode', 'symlink', 'hardlink'])('keeps unavailable stores unavailable without writes: %s', mode => {
  const p = root(), b = owner();
  if (mode !== 'missing') { const s = Store.create(p, b); s.retain(negative()); if (mode !== 'pending') s.close(); else s.markUncertain(); }
  const path = join(p, 'a64-observed-evidence.sqlite');
  if (mode === 'unsafe-mode') fs.chmodSync(p, 0o755);
  if (mode === 'symlink') { fs.renameSync(path, path+'.original'); fs.symlinkSync(path+'.original', path); }
  if (mode === 'hardlink') fs.linkSync(path, join(root(), 'alias'));
  const before = files(p), text = mode === 'wrong-owner' ? request(p, { ...b, ownerNamespaceSha256: 'c'.repeat(64) }) : request(p);
  const v = execute(text); expect(v.exitCode).toBe(2); expect(JSON.parse(v.text)).toMatchObject({ status: 'unavailable', reason: 'evidence_unavailable' }); expect(v.text).not.toContain(p); expect(files(p)).toEqual(before);
});
it.each(['profile', 'artifact', 'context', 'assessment', 'receipt'])('recomputes rather than trusting persisted %s', async mode => {
  const f = await evidence(), p = root(), s = Store.create(p, f.binding); s.retain(f.text); s.close();
  const db = new Database(join(p, 'a64-observed-evidence.sqlite'));
  if (mode === 'receipt') db.prepare('UPDATE receipt SET body=?').run('{}');
  else if (mode === 'assessment') db.prepare('UPDATE receipt SET assessment=?').run('{}');
  else { const x = JSON.parse(f.text); if (mode === 'profile') x.original.profile.symbol = 'QQQ'; if (mode === 'artifact') x.artifact.tamper = true; if (mode === 'context') x.context.assessmentAt.mono = -1; db.prepare('UPDATE receipt SET input=?').run(canonical(x)); }
  db.close(); const before = files(p); expect(JSON.parse(execute(request(p, f.binding)).text).status).toBe('unavailable'); expect(files(p)).toEqual(before);
});
it('suppresses success when read-only close fails, without retry or exception echo', () => {
  const p = root(), s = Store.create(p, owner()); s.retain(negative()); s.close(); const before = files(p), close = Store.prototype.close;
  const mocked = vi.spyOn(Store.prototype, 'close').mockImplementation(function(this: Store) { close.call(this); throw Error('PRIVATE_SENTINEL'); });
  const v = execute(request(p)); expect(JSON.parse(v.text).status).toBe('unavailable'); expect(v.text).not.toContain('PRIVATE_SENTINEL'); expect(mocked).toHaveBeenCalledTimes(1); expect(files(p)).toEqual(before);
});
it('does not turn output loss or a late output error into success', async () => {
  const out = new Writable({ write(_c, _e, cb) { cb(Error('PRIVATE_SENTINEL')); } }); expect(await run(['--describe'], new PassThrough(), out)).toBe(74);
  vi.useFakeTimers(); let writes = 0; const stalled = new Writable({ write() { writes++; } }); const pending = run(['--describe'], new PassThrough(), stalled);
  await vi.advanceTimersByTimeAsync(5000); expect(await pending).toBe(74); expect(writes).toBe(1); expect(stalled.destroyed).toBe(true);
});
it('rejects an actual FIFO substituted after prevalidation with source loader and no file repair', () => {
  const p = root(), s = Store.create(p, owner()); s.retain(negative()); s.close();
  const code = `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';import{execFileSync}from'node:child_process';import assert from'node:assert/strict';
  const x=JSON.parse(fs.readFileSync(0,'utf8'));const {executeObservedReceiptInspection:run}=await import(x.module);const open=fs.openSync;let hit=false;
  fs.openSync=function(path,flags,...a){if(!hit&&String(path)===x.file&&new Error().stack.includes('databaseSnapshot')){hit=true;assert.ok(flags&fs.constants.O_NONBLOCK);fs.renameSync(path,x.backup);execFileSync('/usr/bin/mkfifo',['-m','600',path]);}return open.call(fs,path,flags,...a)};syncBuiltinESMExports();
  const r=run(x.text);assert.ok(hit);assert.equal(r.exitCode,2);assert.equal(JSON.parse(r.text).status,'unavailable');assert.ok(fs.lstatSync(x.file).isFIFO());assert.ok(fs.existsSync(x.backup));console.log('BOUNDED_NO_REPAIR');`;
  expect(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { input: JSON.stringify({ module: new URL('./a64-observed-receipt-inspection-cli.ts', import.meta.url).href,
    file: join(p,'a64-observed-evidence.sqlite'), backup: join(p,'original'), text: request(p) }), encoding: 'utf8', timeout: 3000 })).toBe('BOUNDED_NO_REPAIR\n');
});
