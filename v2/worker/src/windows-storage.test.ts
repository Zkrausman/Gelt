import Database from 'better-sqlite3';
import { formatStorageDiagnosticForTest, storageDiagnosticForTest } from './storage-diagnostics.js';
import { Ledger } from './ledger.js';
import { createLedgerDirectory, validateSQLiteFile } from './ledger-storage.js';
import { intent, id } from './ledger-fixture.js';
import { it, expect, afterEach } from 'vitest';
import { helperRequest, helperResponse, frameRequest, helperStage, safeStorageStage, completeDiagnostics, verifyHelperSources, windowsHelperEnvironment, windowsStorage, protectKey, unprotectKey } from './windows-storage.js';
import { createPrivateDirectory, privateDirectory, readPrivate, writePrivateNew, separateDirectories, consumePrivate } from './private-files.js';
import { storageFixture } from './storage-fixture.js';
import { EncryptedVault } from './vault.js';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { prerequisiteStage, prerequisiteProbes, nativePrerequisiteProbe, prerequisiteFailure, prerequisiteRequired } from './windows-prerequisite-fixture.js';
import { nativeHelperProbe } from './windows-helper-fixture.js';
import { spawn, spawnSync } from 'node:child_process';
it('fixed helper protocol rejects unknown operations, oversized/malformed requests and responses without diagnostics', () => {
  for (const fn of [() => helperRequest('evil' as any, 'C:\\private'), () => helperRequest('read', 'relative'), () => helperRequest('read', 'C:\\private', Buffer.alloc(150001)), () => helperRequest('read', 'C:\\private', Buffer.alloc(0), -1), () => helperResponse('FAIL SECRET', 'read'), () => helperResponse('OK:Zh==', 'read'), () => helperResponse('OK:YQ==', 'new'), () => helperResponse('MISSING', 'new')]) expect(fn).toThrow('secure storage unavailable');
  expect(JSON.parse(helperRequest('new', 'C:\\private', Buffer.from('synthetic')).subarray(4).toString('utf8')).data).toBe('c3ludGhldGlj');
  expect(helperResponse('OK:YQ==', 'read').toString()).toBe('a');
  expect(() => helperResponse('MISSING', 'read')).toThrow('private file missing');
});
it.skipIf(process.platform === 'win32')('no Windows fallback on Linux', () => { expect(() => windowsStorage('protect', '', randomBytes(32))).toThrow('secure storage unavailable'); });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = storageFixture('gelt-native-'); roots.push(root);
  const keyDir = join(root, 'key'), dataDir = join(root, 'data'); createPrivateDirectory(keyDir); createPrivateDirectory(dataDir);
  const key = join(keyDir, 'key'), data = join(dataDir, 'vault'); writePrivateNew(key, protectKey(randomBytes(32)));
  return { root, keyDir, dataDir, key, data };
}
function attack(op: string, path: string, target = '', cases?: { path: string; expected: string }[]) {
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('worker/native/test-attacks.ps1')], { input: frameRequest(JSON.stringify({ op, path, target, cases })), encoding: 'utf8', timeout: 15000, maxBuffer: 1024, env: windowsHelperEnvironment() });
  // Never reflect native stderr, paths, SID or exception output into assertions.
  expect(result.status).toBe(0);
  if (op === 'try-owner') {
    expect(['OK', 'UNAVAILABLE'].includes(result.stdout)).toBe(true);
    return result.stdout === 'OK';
  }
  expect(result.stdout === 'OK').toBe(true);
  return true;
}
it.skipIf(process.platform !== 'win32')('native owner policy and sqlite-file classifier are closed and remove owned compiler scratch', () => {
  const root = storageFixture('gelt-native-'); roots.push(root);
  const name = (value: string) => join(root, value);
  const cases = [
    ['execution.sqlite', 'main'], ['execution.sqlite-wal', 'wal'], ['execution.sqlite-shm', 'shm'], ['execution.sqlite-journal', 'journal'],
    ['execution-wal', 'reject'], ['execution-shm', 'reject'], ['execution-journal', 'reject'],
    ['execution.SQLITE', 'reject'], ['execution.sqlite-WAL', 'reject'], ['execution.SQLITE-wal', 'reject'],
    ['execution.sqlite-wal.tmp', 'reject'], ['execution.sqlite-shm.', 'reject'], ['execution.sqlite-journal~', 'reject'],
    ['execution.sqlite‐wal', 'reject'], ['execution.sqlite-waⅼ', 'reject'], ['secret.key', 'reject'],
  ].map(([value, expected]) => ({ path: name(value), expected }));
  cases.push({ path: join(root + '.sqlite-wal', 'secret'), expected: 'reject' });
  cases.push({ path: join(root, 'directory.sqlite', 'secret-wal'), expected: 'reject' });
  attack('owner-policy', root, '', cases);
  expect(fs.readdirSync(root)).toEqual([]);
});
it.skipIf(process.platform !== 'win32')('native DPAPI encrypted keys: restart, tamper, raw-key rejection, missing packaged helper', () => {
  const key = randomBytes(32), protectedKey = protectKey(key);
  expect(protectedKey.includes(key)).toBe(false); expect(unprotectKey(protectedKey)).toEqual(key);
  expect(() => unprotectKey(key)).toThrow();
  const envelope = JSON.parse(protectedKey.toString()); const bytes = Buffer.from(envelope.data, 'base64'); bytes[bytes.length - 1] ^= 1; envelope.data = bytes.toString('base64');
  expect(() => unprotectKey(Buffer.from(JSON.stringify(envelope)))).toThrow('secure key unavailable');
  const cwd = process.cwd(); const f = fixture();
  try { process.chdir(f.root); expect(() => protectKey(key)).toThrow('secure storage unavailable'); } finally { process.chdir(cwd); }
});
it.skipIf(process.platform !== 'win32')('native rejects public ACLs, inheritance, wrong owner and unsafe ancestor; never repairs them', () => {
  for (const operation of ['public', 'inherit']) {
    const f = fixture(); attack(operation, f.key); expect(() => readPrivate(f.key)).toThrow('secure storage unavailable');
  }
  const owned = fixture();
  if (attack('try-owner', owned.key, 'trusted')) expect(() => readPrivate(owned.key)).toThrow('secure storage unavailable');
  const childAcl = fixture(); attack('children', childAcl.keyDir); expect(() => privateDirectory(childAcl.keyDir)).toThrow('secure storage unavailable');
  const f = fixture(); attack('public', f.root); expect(() => readPrivate(f.key)).toThrow('secure storage unavailable');
});
it.skipIf(process.platform !== 'win32')('native rejects ambiguous/device/network/ADS paths, hardlinks, reparse directories and overlapping keys', () => {
  const f = fixture();
  for (const p of ['relative', '\\\\server\\share\\key', '\\\\?\\C:\\key', f.key + ':stream', f.key + '.', f.key + ' ', join(f.root, 'NUL'), f.root + '\\..\\key']) expect(() => readPrivate(p)).toThrow();
  expect(separateDirectories(f.keyDir, f.keyDir.toUpperCase())).toBe(false);
  expect(() => new EncryptedVault(join(f.keyDir, 'vault'), f.key)).toThrow();
  fs.linkSync(f.key, join(f.keyDir, 'hardlink')); expect(() => readPrivate(f.key)).toThrow();
  const junction = join(f.root, 'junction'); attack('junction', junction, f.dataDir); expect(() => privateDirectory(junction)).toThrow();
  const symlink = join(f.keyDir, 'symlink'); attack('symlink', symlink, f.key); expect(() => readPrivate(symlink)).toThrow();
  expect(() => createPrivateDirectory(f.root)).toThrow();
  fs.unlinkSync(f.key); expect(() => new EncryptedVault(f.data, f.key)).toThrow();
  writePrivateNew(f.key, 'short'); expect(() => new EncryptedVault(f.data, f.key)).toThrow();
});
it.skipIf(process.platform !== 'win32')('native failed persistence poisons vault and retains writer marker across close/restart; bootstrap consumes durably', () => {
  const f = fixture(), vault = new EncryptedVault(f.data, f.key);
  vault.write({ access: 'synthetic-access', refresh: 'synthetic-refresh', expiresAt: 1000000 });
  const before = fs.readFileSync(f.data); attack('public', f.data);
  expect(() => vault.write(null)).toThrow('vault persistence unavailable'); expect(fs.readFileSync(f.data)).toEqual(before);
  expect(() => vault.read()).toThrow(); vault.close(); expect(() => new EncryptedVault(f.data, f.key)).toThrow();
  const grant = join(f.keyDir, 'grant'); writePrivateNew(grant, 'synthetic'); consumePrivate(grant, Buffer.from('synthetic'));
  expect(readPrivate(grant).toString()).toBe('{"consumed":true}'); expect(() => consumePrivate(grant, Buffer.from('synthetic'))).toThrow();
});

it.skipIf(process.platform !== 'win32')('native independent helper processes exclude concurrent writers and retain crash ownership', async () => {
  const f = fixture(), lock = f.data + '.lock';
  const create = async () => {
    const probe = await nativeHelperProbe(helperRequest('new', lock, Buffer.from('owned')));
    expect(probe.timedOut).toBe(false);
    return probe.status;
  };
  const results = await Promise.all([create(), create()]); expect(results.sort()).toEqual([0, 1]);
  expect(readPrivate(lock).toString()).toBe('owned');
  expect(() => new EncryptedVault(f.data, f.key)).toThrow();
});

it.skipIf(process.platform !== 'win32')('native sharing violation rejects replacement/clear, preserving old bytes and restart barrier', async () => {
  const f = fixture(), vault = new EncryptedVault(f.data, f.key);
  vault.write({ access: 'synthetic-access', refresh: 'synthetic-refresh', expiresAt: 1000000 });
  const before = fs.readFileSync(f.data);
  const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('worker/native/test-attacks.ps1')], {
    env: windowsHelperEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const exited = new Promise<void>(done => child.on('exit', () => done()));
  child.stderr.resume();
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('holder deadline')), 15000);
      child.stdout.once('data', bytes => { clearTimeout(timer); bytes.toString() === 'READY' ? done() : reject(new Error('holder unavailable')); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdin.end(frameRequest(JSON.stringify({ op: 'hold', path: f.data })));
    });
    expect(() => vault.write(null)).toThrow('vault persistence unavailable');
    expect(fs.readFileSync(f.data)).toEqual(before); expect(() => vault.read()).toThrow();
    vault.close(); expect(() => new EncryptedVault(f.data, f.key)).toThrow();
  } finally { child.kill(); await exited; vault.close(); }
});

it('framing bounds use byte length and source hashes are exact on every checkout', () => {
  const frame = frameRequest('{"value":"é"}');
  expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
  expect(frame.subarray(4).toString('utf8')).toBe('{"value":"é"}');
  expect(() => frameRequest('')).toThrow('secure storage unavailable');
  expect(() => frameRequest('é'.repeat(110001))).toThrow('secure storage unavailable');
  expect(verifyHelperSources).not.toThrow();
});
it('diagnostic vocabulary and environment cannot disclose input or arbitrary inherited state', () => {
  expect(helperStage(completeDiagnostics)).toBe('DONE');
  expect(helperStage(completeDiagnostics, 'OK:YQ==')).toBe('DONE');
  expect(helperStage(completeDiagnostics, 'MISSING')).toBe('DONE');
  expect(helperStage(completeDiagnostics, 'secret')).toBe('PROTOCOL');
  expect(helperStage('START\nFRAME\n')).toBe('FRAME');
  expect(helperStage('START\nFRAME\nROOT\nCLEANUP\n', 'FAIL:ROOT')).toBe('PROTOCOL');
  for (const text of ['private path or secret', 'START\nSTART\n', 'ROOT\nFRAME\n', 'BAD\n', 'FRAME']) expect(helperStage(text)).toBe('PROTOCOL');
  expect(helperStage('', 'FAIL:secret')).toBe('PROTOCOL');
  const stages = completeDiagnostics.trim().split('\n');
  for (const [index, stage] of stages.entries()) {
    const prefix = stages.slice(0, index + 1).join('\n') + '\n';
    expect(helperStage(prefix)).toBe(stage);
    expect(safeStorageStage(stage)).toBe(stage);
    if (!['DONE', 'CLEANUP'].includes(stage)) expect(helperStage(prefix + 'CLEANUP\n', 'FAIL:' + stage)).toBe(stage);
  }
  for (const value of ['secret', 'C:\\private', 'FRAME_HEADER\nsecret', undefined, {}]) expect(safeStorageStage(value)).toBe('PROTOCOL');
  const before = { ...process.env };
  try {
    Object.assign(process.env, { TEMP: 'untrusted', TMP: 'untrusted', PATH: 'untrusted', NODE_OPTIONS: 'untrusted', HTTPS_PROXY: 'untrusted', AWS_SECRET_ACCESS_KEY: 'untrusted', PSModulePath: 'untrusted', PSModuleAnalysisCachePath: 'untrusted', GELT_WINDOWS_PRIVATE_PARENT: 'C:\\' });
    expect(windowsHelperEnvironment()).toEqual({ NODE_ENV: 'production', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules', GELT_WINDOWS_PRIVATE_PARENT: 'C:\\' });
  } finally { process.env = before; }
});
it.skipIf(process.platform !== 'win32')('native framed input rejects truncated/oversized/invalid UTF-8 and malformed requests before compilation', async () => {
  const invalidUtf8 = Buffer.from([0, 0, 0, 2, 0xc3, 0x28]);
  const request = helperRequest('protect', '', randomBytes(32));
  const cases: [Buffer, string][] = [
    [Buffer.from([0, 1]), 'FRAME_HEADER'],
    [Buffer.alloc(4), 'FRAME_HEADER_DONE'],
    [Buffer.from([0xff, 0xff, 0xff, 0xff]), 'FRAME_HEADER_DONE'],
    [request.subarray(0, -1), 'FRAME_PAYLOAD'],
    [invalidUtf8, 'FRAME_UTF8'],
    [frameRequest('{'), 'FRAME_JSON'],
    [frameRequest('{}'), 'FRAME_SCHEMA'],
    [frameRequest('{"version":1,"op":42,"path":"","data":"","max":0}'), 'FRAME_SCHEMA'],
  ];
  const stages = completeDiagnostics.trim().split('\n');
  for (const [input, stage] of cases) {
    const probe = await nativeHelperProbe(input);
    expect(probe.timedOut).toBe(false); expect(probe.status).toBe(1);
    expect(probe.stdout).toBe('FAIL:' + stage);
    expect(probe.stderr).toBe(stages.slice(0, stages.indexOf(stage) + 1).join('\n') + '\nCLEANUP\n');
    expect(helperStage(probe.stderr, probe.stdout)).toBe(stage);
    expect(probe.stderr).not.toContain('COMPILE');
  }
  // A deliberately incomplete OPEN frame is bounded by the test deadline and joined.
  const probe = await nativeHelperProbe(request.subarray(0, -1), { open: true, deadline: 1000 });
  expect(probe.timedOut).toBe(true);
});
it.skipIf(process.platform !== 'win32')('native compilation parent is explicit and rejects unsafe ACL/reparse roots without repairing or leaking', () => {
  const f = fixture(); const before = process.env.GELT_WINDOWS_PRIVATE_PARENT;
  const rejectParent = (parent: string | undefined) => {
    if (parent === undefined) delete process.env.GELT_WINDOWS_PRIVATE_PARENT;
    else process.env.GELT_WINDOWS_PRIVATE_PARENT = parent;
    try { windowsStorage('protect', '', randomBytes(32)); throw new Error('unsafe parent accepted'); }
    catch (error) { expect((error as any).storageStage).toBe('ROOT'); expect((error as Error).message).toBe('secure storage unavailable'); }
  };
  try {
    rejectParent(undefined); rejectParent('relative'); rejectParent(f.root + ':stream');
    const junction = join(f.root, 'scratch-junction'); attack('junction', junction, f.dataDir); rejectParent(junction);
    attack('public', f.root); rejectParent(f.root);
    // The negative helper must not create scratch under the rejected root.
    expect(fs.readdirSync(f.root).some(name => name.startsWith('gelt-compile-'))).toBe(false);
  } finally { if (before === undefined) delete process.env.GELT_WINDOWS_PRIVATE_PARENT; else process.env.GELT_WINDOWS_PRIVATE_PARENT = before; }
});

it('independent prerequisite diagnostics reject arbitrary, oversized and reordered output', async () => {
  expect(prerequisiteStage('')).toBe('STARTUP');
  expect(prerequisiteStage('START\nBEFORE\nAFTER\nDONE\n')).toBe('DONE');
  expect(prerequisiteStage('START\nMODULE\nMODULE_DONE\nBEFORE\n')).toBe('BEFORE');
  for (const text of ['secret', 'START\nSTART\n', 'DONE\nBEFORE\n', 'UNKNOWN\n', 'x'.repeat(257)]) expect(prerequisiteStage(text)).toBe('PROTOCOL');
  expect(prerequisiteProbes).toEqual(['path', 'source', 'stdin', 'array', 'join-path', 'new-object', 'json', 'add-type', 'enum-mask']);
  await expect(nativePrerequisiteProbe('arbitrary-script' as any)).rejects.toThrow('native prerequisite unavailable');
});

it('only unused implicit-autoload comparisons are non-gating; production prerequisites cannot be suppressed', () => {
  for (const probe of prerequisiteProbes) {
    const required = !['join-path', 'new-object'].includes(probe);
    expect(prerequisiteRequired(probe)).toBe(required);
    expect(prerequisiteFailure(probe, false)).toBe(required);
    expect(prerequisiteFailure(probe, true)).toBe(false);
  }
});

it.skipIf(process.platform !== 'win32')('native ROOT accepts private and inherit-only ancestor ACLs, rejects applicable public rights', () => {
  const root = storageFixture('gelt-native-'); roots.push(root);
  const before = process.env.GELT_WINDOWS_PRIVATE_PARENT;
  process.env.GELT_WINDOWS_PRIVATE_PARENT = root;
  const key = Buffer.alloc(32, 0x47);
  const roundtrip = () => {
    const encrypted = windowsStorage('protect', '', key);
    expect(encrypted.includes(key)).toBe(false);
    expect(windowsStorage('unprotect', '', encrypted)).toEqual(key);
    expect(fs.readdirSync(root)).toEqual([]); // successful helper cleanup, too
  };
  try {
    roundtrip(); // real owner-private ACL, ROOT -> COMPILE -> OPERATION -> DONE
    attack('children', root); // InheritOnly must not apply to this ancestor
    roundtrip(); // scratch has a protected owner-only DACL, no inherited rights
    attack('public', root); // same FullControl mask now applies to the ancestor
    try { windowsStorage('protect', '', key); throw new Error('unsafe parent accepted'); }
    catch (error) {
      expect((error as any).storageStage).toBe('ROOT');
      expect((error as Error).message).toBe('secure storage unavailable');
    }
    expect(fs.readdirSync(root)).toEqual([]);
  } finally {
    if (before === undefined) delete process.env.GELT_WINDOWS_PRIVATE_PARENT;
    else process.env.GELT_WINDOWS_PRIVATE_PARENT = before;
  }
});

it.skipIf(process.platform !== 'win32')('native SQLite inherited private sidecars are allowed but public ACLs poison and preserve ownership', () => {
  const root=storageFixture('gelt-native-');roots.push(root);const dir=join(root,'ledger');createLedgerDirectory(dir);
  const path=join(dir,'execution.sqlite'), ledger=new Ledger(path,id(1));
  try {
    expect(ledger.recordIntent(intent).ok, formatStorageDiagnosticForTest(ledger)).toBe(true);
    validateSQLiteFile(path);
    for(const suffix of ['-wal', '-shm']) { expect(fs.existsSync(path+suffix)).toBe(true); validateSQLiteFile(path+suffix); }
    windowsStorage('sqlite-set', path); // fixed native suffix mapping supplies sidecar kinds
    attack('public',path+'-wal');
    expect(ledger.recordIntent(intent)).toEqual({version:1,ok:false,error:'unavailable'});
    expect(storageDiagnosticForTest(ledger)).toEqual({stage:'OPERATION',operation:'sqlite-set',check:'DACL',kind:'wal'});
    expect(() => ledger.close()).toThrow();expect(fs.existsSync(path+'.lock')).toBe(true);
  }finally{try{ledger.close();}catch{}}
});
it.skipIf(process.platform !== 'win32')('native metadata checks large SQLite files without relaxing bounded private secret reads', () => {
  const root=storageFixture('gelt-native-');roots.push(root);const dir=join(root,'ledger');createLedgerDirectory(dir);
  const path=join(dir,'large.sqlite');writePrivateNew(path,Buffer.alloc(0));const db=new Database(path);
  try {db.exec('CREATE TABLE test(body BLOB); INSERT INTO test VALUES(zeroblob(200000));');}finally{db.close();}
  validateSQLiteFile(path);expect(() => readPrivate(path)).toThrow();
  if (attack('try-owner',path,'trusted')) expect(() => validateSQLiteFile(path)).toThrow();
});
it.skipIf(process.platform !== 'win32')('native ledger refuses non-inheritable private directory before creating database or lock', () => {
  const root=storageFixture('gelt-native-');roots.push(root);const dir=join(root,'ordinary');createPrivateDirectory(dir);
  try { new Ledger(join(dir,'ledger.sqlite'),id(1)); throw new Error('accepted'); }
  catch (error) {
    expect((error as Error).message).toBe('ledger unavailable');
    expect(storageDiagnosticForTest(error)).toEqual({stage:'OPERATION',operation:'sqlite-set',check:'DACL',kind:'parent'});
  }
  expect(fs.readdirSync(dir)).toEqual([]);
});

it.skipIf(process.platform !== 'win32')('native post-migration first validated intent reports only a closed diagnostic on failure', () => {
  let ledger: Ledger | undefined;
  try {
    const root = storageFixture('gelt-native-'); roots.push(root);
    const dir = join(root, 'ledger'); createLedgerDirectory(dir);
    ledger = new Ledger(join(dir, 'execution.sqlite'), id(1));
  } catch (error) { throw new Error(formatStorageDiagnosticForTest(error)); }
  try {
    const result = ledger.recordIntent(intent);
    expect(result.ok, formatStorageDiagnosticForTest(ledger)).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe('committed');
      expect(result.value.projection.facts).toEqual([]);
    }
  } finally { try { ledger.close(); } catch {} }
});

function expectSQLiteCheck(path: string, check: string, kind: string) {
  try { windowsStorage('sqlite-set', path); throw new Error('unsafe SQLite object accepted'); }
  catch (error) {
    expect((error as Error).message).toBe('secure storage unavailable');
    expect(storageDiagnosticForTest(error)).toEqual({stage:'OPERATION',operation:'sqlite-set',check,kind});
  }
}
function expectSQLiteFileCheck(path: string, check: string, kind?: string) {
  try { validateSQLiteFile(path); throw new Error('unsafe SQLite file accepted'); }
  catch (error) {
    expect((error as Error).message).toBe('secure storage unavailable');
    expect(storageDiagnosticForTest(error)).toEqual({stage:'OPERATION',operation:'sqlite-file',check,...(kind ? {kind} : {})});
  }
}
it.skipIf(process.platform !== 'win32')('native sqlite-file rejects malformed and non-SQLite final filenames before classification', () => {
  const root=storageFixture('gelt-native-');roots.push(root);
  for (const path of [
    join(root,'execution-wal'), join(root,'execution.sqlite-WAL'), join(root,'execution.SQLITE-wal'),
    join(root,'execution.sqlite-wal.tmp'), join(root,'execution.sqlite‐wal'), join(root,'secret.key'),
    join(root+'.sqlite-wal','secret'), root+'\\directory.sqlite\\secret-wal', root+'\\directory.sqlite//execution.sqlite-wal',
  ]) expectSQLiteFileCheck(path,'PATH');
});
it.skipIf(process.platform !== 'win32')('native real SQLite sidecar owners allow only trusted SIDs and keep main current-user-owned', () => {
  // Owner assignment is token-dependent; the mandatory pure production matrix
  // covers every owner/kind even when an OS refuses a test-only owner mutation.
  for (const mode of ['WAL', 'DELETE']) {
    for (const owner of ['trusted', 'untrusted']) {
      const root=storageFixture('gelt-native-');roots.push(root);const dir=join(root,'ledger');createLedgerDirectory(dir);
      const path=join(dir,'execution.sqlite');writePrivateNew(path,Buffer.alloc(0));const db=new Database(path);
      try {
        db.pragma(`journal_mode = ${mode}`);
        db.exec('BEGIN IMMEDIATE; CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES(\'synthetic\');');
        const suffixes = mode === 'WAL' ? ['-wal', '-shm'] : ['-journal'];
        windowsStorage('sqlite-set', path); // natural token default ownership must work
        for (const suffix of suffixes) {
          expect(fs.existsSync(path+suffix)).toBe(true);
          validateSQLiteFile(path+suffix);
          if (attack('try-owner', path+suffix, owner)) {
            if (owner === 'untrusted') {
              expectSQLiteCheck(path,'OWNER',suffix.slice(1));
              expectSQLiteFileCheck(path+suffix,'OWNER',suffix.slice(1));
              break;
            }
            windowsStorage('sqlite-set', path);
            validateSQLiteFile(path+suffix);
          }
        }
      } finally { db.close(); }
    }
  }
  const root=storageFixture('gelt-native-');roots.push(root);const dir=join(root,'ledger');createLedgerDirectory(dir);
  const path=join(dir,'execution.sqlite');writePrivateNew(path,Buffer.alloc(0));const db=new Database(path);
  try { db.exec('CREATE TABLE synthetic(value TEXT)'); } finally { db.close(); }
  if (attack('try-owner',path,'trusted')) {
    expectSQLiteCheck(path,'OWNER','main');
    expectSQLiteFileCheck(path,'OWNER','main');
  }
});
it.skipIf(process.platform !== 'win32')('native SQLite sidecars reject hardlinks and reparse objects with fixed diagnostic kinds', () => {
  const root=storageFixture('gelt-native-');roots.push(root);const dir=join(root,'ledger');createLedgerDirectory(dir);
  const path=join(dir,'execution.sqlite');writePrivateNew(path,Buffer.alloc(0));const db=new Database(path);
  try {
    db.pragma('journal_mode = WAL');db.exec('CREATE TABLE synthetic(value TEXT)');
    windowsStorage('sqlite-set', path);
    fs.linkSync(path+'-wal',join(dir,'alias'));
    expectSQLiteCheck(path,'LINKS','wal');
    fs.unlinkSync(join(dir,'alias'));
    windowsStorage('sqlite-set', path);
  } finally { db.close(); }
  // Last close removes WAL; a substituted junction must fail before type/ACL checks.
  expect(fs.existsSync(path+'-wal')).toBe(false);
  attack('junction',path+'-wal',dir);
  expectSQLiteCheck(path,'REPARSE','wal');
});
