import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import fsMutable from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { canonical } from './ledger-canonical.js';
import { evidence, negative, owner, profile } from './a64-observed-snapshot.test-support.js';
import { A64ObservedSnapshotReceiptStore as Store } from './a64-observed-snapshot-receipt.js';
import { A64EvidenceReceiptStore as OldStore } from './a64-evidence-receipt.js';
import { observedLimits } from './alpaca-observed-snapshot-contract.js';
const roots: string[] = [];
function root() { const p = fs.mkdtempSync(join(tmpdir(), 'gelt-observed-receipt-')); fs.chmodSync(p, 0o700); roots.push(p); return p; }
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const p of roots.splice(0))
    fs.rmSync(p, { recursive: true, force: true }); });
const files = (p: string) => Object.fromEntries(fs.readdirSync(p).map(n => [n, { bytes: fs.readFileSync(join(p, n)).toString('base64'), mode: fs.statSync(join(p, n)).mode, mtime: fs.statSync(join(p, n)).mtimeMs }]));
it('retains one complete assessed input, rejects competing ownership/duplicates, and reopens without writes', async () => {
    const f = await evidence(), p = root(), s = Store.create(p, f.binding), r = s.retain(f.text);
    expect(r).toMatchObject({ status: 'assessed_data', historyUpdates: 64, receiptSequence: 1, fullEvidenceRetained: true });
    expect(() => s.retain(f.text)).toThrow();
    expect(() => Store.create(p, f.binding)).toThrow();
    expect(() => Store.reopen(p, f.binding)).toThrow();
    s.close();
    const before = files(p), ro = Store.reopen(p, f.binding);
    expect(ro.read().input).toBe(f.text);
    expect(ro.read().receipt).toEqual(r);
    expect(() => ro.retain(f.text)).toThrow();
    ro.close();
    expect(files(p)).toEqual(before);
    expect(() => Store.create(p, f.binding)).toThrow();
    expect(() => OldStore.reopen(p, { schema: 'gelt.a64-evidence-retention-binding.v1', ownerNamespaceSha256: f.binding.ownerNamespaceSha256, caseEpochSha256: f.binding.caseEpochSha256 })).toThrow();
    expect(() => Store.reopen(p, { ...f.binding, ownerNamespaceSha256: 'c'.repeat(64) })).toThrow();
});
it('keeps reported negative distinct and rejects corruption rather than repairing it', () => {
    const p = root(), b = owner(), s = Store.create(p, b), r = s.retain(negative());
    expect(r).toMatchObject({ status: 'rejected', fullEvidenceRetained: false, assessmentSha256: null });
    s.close();
    const ro = Store.reopen(p, b), path = join(p, 'a64-observed-evidence.sqlite'), data = fs.readFileSync(path);
    data[100] ^= 1;
    fs.writeFileSync(path, data);
    expect(() => ro.read()).toThrow();
    expect(() => ro.close()).toThrow();
    expect(() => Store.reopen(p, b)).toThrow();
});
it('retains uncertainty fences on empty/partial/close failures, including directory-sync after lock removal', () => {
    for (const mode of ['empty', 'partial', 'close-sync']) {
        const p = root(), b = owner(), s = Store.create(p, b), db = (s as any).storage.db;
        if (mode === 'partial') {
            const prepare = db.prepare.bind(db);
            vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => { const st = prepare(sql); if (sql.startsWith('INSERT INTO receipt'))
                return { run: () => { throw Error('PRIVATE_SENTINEL'); } }; return st; }) as any);
            expect(() => s.retain(negative())).toThrow();
            vi.restoreAllMocks();
        }
        if (mode === 'close-sync') {
            s.retain(negative());
            const original = fs.fsyncSync;
            vi.spyOn(fsMutable, 'fsyncSync').mockImplementation((fd: any) => { if (fs.fstatSync(fd).isDirectory())
                throw Error('PRIVATE_SENTINEL'); return original(fd); });
            syncBuiltinESMExports();
        }
        expect(() => s.close()).toThrow('Observed evidence unavailable');
        vi.restoreAllMocks();
        syncBuiltinESMExports();
        expect(fs.existsSync(join(p, 'a64-observed-evidence.pending'))).toBe(true);
        expect(() => Store.reopen(p, b)).toThrow();
        expect(() => Store.create(p, b)).toThrow();
    }
});
it('rejects malformed/resource/namespace inputs without echoing raw data', () => {
    const p = root(), b = owner(), s = Store.create(p, b);
    for (const text of ['{"PRIVATE_SECRET_SENTINEL":true}', 'x'.repeat(observedLimits.input + 1)]) {
        try {
            s.retain(text);
            throw Error('accepted');
        }
        catch (e) {
            expect(String(e)).not.toContain('PRIVATE_SECRET_SENTINEL');
        }
    }
    s.retain(negative());
    s.close();
    const db = join(p, 'a64-observed-evidence.sqlite');
    fs.linkSync(db, join(root(), 'hardlink'));
    expect(() => Store.reopen(p, b)).toThrow();
});
// These are real OS FIFO substitutions, not mocked read errors. The child signals
// precisely after prevalidation and before the real open; the parent watchdog
// makes a blocking regression fail without hanging the test runner.
const fifoChild = String.raw `
import fs from 'node:fs';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{syncBuiltinESMExports}from'node:module';
const q=JSON.parse(fs.readFileSync(0,'utf8'));const{A64ObservedSnapshotReceiptStore:Store}=await import(q.module);const root=q.root,db=root+'/a64-observed-evidence.sqlite',pending=root+'/a64-observed-evidence.pending';
fs.mkdirSync(root,{mode:0o700});let store,hit=false,flagsSeen,markerCalls=0,mainCalls=0,dirCalls=0;const original=fs.openSync;
function install(){fs.openSync=function(path,flags,...rest){const name=String(path),stack=new Error().stack||'';let target=false;
 if(q.mode.startsWith('validate-'))target=stack.includes('validateSQLiteFile')&&name===db+({'validate-main':'','validate-wal':'-wal','validate-shm':'-shm','validate-journal':'-journal'}[q.mode]??'NOT');
 if(q.mode==='validate-marker')target=stack.includes('readPrivate')&&stack.includes('LedgerStorage.validate')&&name===db+'.lock';
 if(q.mode.startsWith('create-main')&&stack.includes('validateSQLiteFile')&&name===db)target=++mainCalls===Number(q.mode.slice(-1));
 if(q.mode.startsWith('create-sync')&&stack.includes('syncDirectory')&&name===root)target=++dirCalls===Number(q.mode.slice(-1));
 if(q.mode.startsWith('close-marker')&&stack.includes('readPrivate')&&stack.includes('LedgerStorage.validate')&&name===db+'.lock')target=++markerCalls===Number(q.mode.slice(-1));
 if(q.mode==='close-final')target=stack.includes('readPrivate')&&stack.includes('LedgerStorage.close')&&!stack.includes('LedgerStorage.validate')&&!stack.includes('removePrivate')&&name===db+'.lock';
 if(q.mode==='close-remove')target=stack.includes('readPrivate')&&stack.includes('removePrivate')&&name===db+'.lock';
 if(q.mode==='close-sync')target=stack.includes('syncDirectory')&&name===root;
 if(target&&!hit){hit=true;flagsSeen=flags;fs.renameSync(name,q.backup);execFileSync('mkfifo',['-m','600',name]);process.stdout.write('BOUNDARY\n');}
 return original.call(fs,path,flags,...rest);
 };syncBuiltinESMExports();}
try{
 if(q.mode.startsWith('create-')){install();assert.throws(()=>Store.create(root,q.binding));}
 else{store=Store.create(root,q.binding);store.retain(q.text);if(q.mode==='validate-journal')fs.writeFileSync(db+'-journal','',{mode:0o600});install();if(q.mode.startsWith('close-'))assert.throws(()=>store.close());else assert.throws(()=>store.read());}
 assert.equal(hit,true,'target open not reached');assert.ok((flagsSeen&fs.constants.O_NONBLOCK)!==0);assert.ok((flagsSeen&fs.constants.O_NOFOLLOW)!==0);
 fs.openSync=original;syncBuiltinESMExports();try{store?.close();}catch{}
 const fenceRoot=fs.lstatSync(root).isDirectory()?root:q.backup;
 assert.ok(fs.existsSync(fenceRoot+'/a64-observed-evidence.pending')||fs.existsSync(fenceRoot+'/a64-observed-evidence.sqlite.lock'));
 assert.throws(()=>Store.reopen(root,q.binding));console.log('BOUNDED_REJECTION');
}catch(e){console.error('FIFO_ORACLE_FAILED',e.message);process.exitCode=1;}
`;
for (const mode of ['create-main1', 'create-main2', 'create-sync1', 'create-sync2', 'create-sync3', 'validate-main', 'validate-wal', 'validate-shm', 'validate-journal', 'validate-marker', 'close-marker1', 'close-marker2', 'close-final', 'close-remove', 'close-sync'])
    it('rejects post-prevalidation FIFO at ' + mode, async () => {
        const parent = root(), b = owner(), input = { mode, binding: b, text: negative(), root: join(parent, 'store'), backup: join(parent, 'backup'), module: new URL('../dist/a64-observed-snapshot-receipt.js', import.meta.url).href };
        await new Promise<void>((resolve, reject) => { const c = spawn(process.execPath, ['--input-type=module', '-e', fifoChild], { stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', errors = '', timer: ReturnType<typeof setTimeout> | undefined; const startup = setTimeout(() => { c.kill('SIGKILL'); reject(Error('FIFO oracle startup deadline')); }, 4000); c.stdout.on('data', b => { output += String(b); if (output.includes('BOUNDARY') && !timer) {
            clearTimeout(startup);
            timer = setTimeout(() => { c.kill('SIGKILL'); reject(Error('blocking FIFO regression')); }, 1000);
        } }); c.stderr.on('data', b => errors += String(b)); c.on('error', reject); c.on('exit', code => { clearTimeout(startup); if (timer)
            clearTimeout(timer); code === 0 && output.includes('BOUNDED_REJECTION') ? resolve() : reject(Error('FIFO case failed ' + mode + ': ' + errors)); }); c.stdin.end(JSON.stringify(input)); });
    });
