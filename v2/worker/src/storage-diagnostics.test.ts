import { it, expect } from 'vitest';
import { helperTransport, completeDiagnostics, type WindowsOperation } from './windows-storage.js';
import { helperStages, nativeChecks, storageOperations, sanitizeStorageDiagnostic, rememberStorageDiagnostic, storageDiagnosticForTest, formatStorageDiagnosticForTest, ledgerStorageError, storageBoundary } from './storage-diagnostics.js';
const trace = (stage: string) => helperStages.slice(0, helperStages.indexOf(stage as any) + 1).join('\n') + '\nCLEANUP\n';
const failed = (stdout: string, stderr = trace('OPERATION'), status: number | null = 1) => ({ stdout, stderr, status });
function diagnostic(response: Parameters<typeof helperTransport>[0], op: WindowsOperation = 'sqlite-set') {
  try { helperTransport(response, op); throw new Error('unexpected success'); }
  catch (error) {
    expect((error as Error).message).toBe('secure storage unavailable');
    expect(JSON.stringify(error)).not.toMatch(/secret|S-1-5|private|token|password/);
    return storageDiagnosticForTest(error);
  }
}
it('transport accepts exact success, missing read and each closed stage failure', () => {
  for (const op of storageOperations) expect(helperTransport({ status: 0, stdout: 'OK:', stderr: completeDiagnostics }, op)).toEqual(Buffer.alloc(0));
  for (const op of ['read', 'protect', 'unprotect'] as const) expect(helperTransport({ status: 0, stdout: 'OK:YQ==', stderr: completeDiagnostics }, op).toString()).toBe('a');
  expect(() => helperTransport({ status: 0, stdout: 'MISSING', stderr: completeDiagnostics }, 'read')).toThrow('private file missing');
  for (const stage of helperStages.slice(0, -2)) {
    expect(diagnostic(failed('FAIL:' + stage, trace(stage))).stage).toBe(stage);
    expect(diagnostic(failed('FAIL:CLEANUP', trace(stage))).stage).toBe('CLEANUP');
  }
});
it('every native check survives only with an operation-compatible kind and complete failure trace', () => {
  for (const check of nativeChecks) {
    const op: WindowsOperation = check === 'DPAPI' ? 'protect' : check === 'DELETE' ? 'remove' : ['CREATE', 'READ', 'WRITE', 'FLUSH', 'MOVE'].includes(check) ? 'replace' : 'sqlite-set';
    const kind = op === 'sqlite-set' ? 'wal' : undefined;
    const d = diagnostic(failed('FAIL:OPERATION:' + check + (kind ? ':' + kind : '')), op);
    expect(d).toEqual({ stage: 'OPERATION', operation: op, check, ...(kind ? { kind } : {}) });
    expect(Object.isFrozen(d)).toBe(true);
  }
  expect(diagnostic(failed('FAIL:OPERATION:FILESYSTEM')).check).toBe('FILESYSTEM');
  for (const kind of ['parent', 'main', 'wal', 'shm', 'journal']) expect(diagnostic(failed('FAIL:OPERATION:OWNER:' + kind)).kind).toBe(kind);
  for (const kind of ['main', 'wal', 'shm', 'journal']) expect(diagnostic(failed('FAIL:OPERATION:OWNER:' + kind), 'sqlite-file')).toEqual({stage:'OPERATION',operation:'sqlite-file',check:'OWNER',kind});
  for (const op of storageOperations.filter(op => !['protect', 'unprotect'].includes(op))) expect(diagnostic(failed('FAIL:OPERATION:OPEN:parent'), op).kind).toBe('parent');
});
it('malformed, mismatched, reordered, absent, oversized or injected transport collapses to PROTOCOL', () => {
  const valid = failed('FAIL:OPERATION:DACL:wal');
  const cases = [
    ...['FAIL:OPERATION:UNKNOWN:wal', 'FAIL:OPERATION:DACL:unknown', 'FAIL:OPERATION:DACL:marker', 'FAIL:OPERATION:DACL:identity', 'FAIL:OPERATION:DACL:', 'FAIL:OPERATION:DACL:wal:extra', 'FAIL:OPERATION', 'FAIL:DONE', 'FAIL:OPERATION:READ:wal', 'FAIL:OPERATION:DPAPI:wal', 'FAIL:OPERATION:OPEN', 'FAIL:OPERATION:DELETE:wal', 'FAIL:OPERATION:MOVE:wal', 'FAIL:OPERATION:CREATE:wal', 'FAIL:OPERATION:WRITE:wal', 'FAIL:OPERATION:FLUSH:wal', 'MISSING', 'OK:', 'secret', 'FAIL:OPERATION:C:\\private', 'FAIL:OPERATION:S-1-5-18', 'FAIL:OPERATION:token=password', 'FAIL:OPERATION:DACL:wal\nsecret', 'x'.repeat(200005)].map(stdout => ({ ...valid, stdout })),
    ...['', 'START\nOPERATION\nCLEANUP\n', trace('OPERATION') + 'secret', completeDiagnostics, trace('OPERATION').replace('FRAME\n', ''), trace('OPERATION').replace('START\nFRAME\n', 'FRAME\nSTART\n'), 'x'.repeat(1025)].map(stderr => ({ ...valid, stderr })),
    ...[0, 2, null].map(status => ({ ...valid, status })),
    { ...valid, error: new Error('secret') }, { ...valid, signal: 'SIGTERM' },
    { status: 0, stdout: 'OK:Zh==', stderr: completeDiagnostics },
    { status: 0, stdout: 'OK:YQ==', stderr: completeDiagnostics },
    { status: 0, stdout: 'OK:', stderr: '' },
  ];
  // A generic OPERATION exception (e.g. type initialization) is valid, not a detailed code.
  for (const response of cases.filter(c => c.stdout !== 'FAIL:OPERATION')) expect(diagnostic(response).stage).toBe('PROTOCOL');
  for (const op of ['read', 'protect', 'unprotect'] as const) expect(diagnostic(valid, op).stage).toBe('PROTOCOL');
  expect(diagnostic(valid, 'sqlite-file')).toEqual({stage:'OPERATION',operation:'sqlite-file',check:'DACL',kind:'wal'});
  expect(diagnostic(failed('FAIL:OPERATION:DACL:parent'), 'protect').stage).toBe('PROTOCOL');
  expect(diagnostic(failed('FAIL:ROOT', trace('COMPILE'))).stage).toBe('PROTOCOL');
  for (const check of ['CREATE', 'READ', 'WRITE', 'FLUSH', 'MOVE']) expect(diagnostic(failed('FAIL:OPERATION:' + check + ':parent'), 'replace').stage).toBe('PROTOCOL');
  expect(diagnostic(failed('FAIL:OPERATION:DELETE:parent'), 'remove').stage).toBe('PROTOCOL');
});
it('diagnostic relay rejects arbitrary fields and accessors; errors/results stay generic', () => {
  const good = { stage: 'OPERATION', operation: 'read', check: 'DACL', kind: 'marker' };
  let called = false;
  for (const value of [null, 'secret', {}, { ...good, secret: 'token' }, { ...good, kind: 'C:\\private' }, { ...good, stage: 'secret' }, { ...good, operation: 'secret' }, { ...good, check: 'S-1-5-18' }, { ...good, kind: undefined }, { ...good, get check() { called = true; return 'secret'; } }, { ...good, [Symbol('secret')]: 'secret' }]) {
    expect(sanitizeStorageDiagnostic(value)).toEqual({ stage: 'PROTOCOL', operation: 'unknown', check: 'PROTOCOL' });
  }
  expect(called).toBe(false);
  const raw = Object.assign(new Error('secret'), { storageDiagnostic: good });
  expect(formatStorageDiagnosticForTest(raw)).toBe('PROTOCOL:unknown:PROTOCOL');
  rememberStorageDiagnostic(raw, good);
  const error = ledgerStorageError(raw);
  expect(error.message).toBe('ledger unavailable'); expect(JSON.stringify(error)).toBe('{}');
  expect(formatStorageDiagnosticForTest(error)).toBe('OPERATION:read:DACL:marker');
  good.kind = 'identity'; // retained tuple is an immutable copy
  expect(storageDiagnosticForTest(error).kind).toBe('marker');
  try { storageBoundary('marker', () => { throw new Error('secret'); }); }
  catch (e) { expect(formatStorageDiagnosticForTest(e)).toBe('LEDGER:validate:INTERNAL:marker'); }
  rememberStorageDiagnostic(raw, { stage: 'OPERATION', operation: 'read', check: 'OWNER', kind: 'parent' });
  try { storageBoundary('marker', () => { throw raw; }); }
  catch (e) { expect(formatStorageDiagnosticForTest(e)).toBe('OPERATION:read:OWNER:parent'); }
});

it('real-file post-migration marker mismatch retains ownership and generic results with internal evidence', async () => {
  const fs = await import('node:fs');
  const { join } = await import('node:path');
  const { storageFixture } = await import('./storage-fixture.js');
  const { createLedgerDirectory } = await import('./ledger-storage.js');
  const { Ledger } = await import('./ledger.js');
  const { intent, id } = await import('./ledger-fixture.js');
  const root = storageFixture('gelt-diagnostic-'), dir = join(root, 'ledger'), path = join(dir, 'execution.sqlite');
  let ledger: InstanceType<typeof Ledger> | undefined;
  try {
    try { createLedgerDirectory(dir); ledger = new Ledger(path, id(1)); }
    catch (error) { throw new Error(formatStorageDiagnosticForTest(error)); }
    expect(ledger.recordIntent(intent).ok, formatStorageDiagnosticForTest(ledger)).toBe(true);
    fs.writeFileSync(path + '.lock', 'synthetic-wrong-marker');
    expect(ledger.recordIntent(intent)).toEqual({ version: 1, ok: false, error: 'unavailable' });
    expect(formatStorageDiagnosticForTest(ledger)).toBe('LEDGER:validate:MARKER:marker');
    expect(ledger.recordIntent(intent)).toEqual({ version: 1, ok: false, error: 'unavailable' });
    expect(formatStorageDiagnosticForTest(ledger)).toBe('LEDGER:validate:MARKER:marker');
    expect(() => ledger!.close()).toThrow('ledger unavailable');
    expect(fs.existsSync(path + '.lock')).toBe(true);
  } finally { try { ledger?.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); }
});
