import { it, expect } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { Ledger } from './ledger.js';
import { storageFixture } from './storage-fixture.js';
import { createLedgerDirectory } from './ledger-storage.js';
import { intent, event, id, query } from './ledger-fixture.js';
async function child(mode: string, path: string) {
  const child=fork(resolve('worker/src/fixtures/ledger-process.ts'),[mode,path],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc'],env:{ NODE_ENV:'test', SystemRoot:'C:\\Windows', WINDIR:'C:\\Windows', GELT_WINDOWS_PRIVATE_PARENT:process.env.GELT_WINDOWS_PRIVATE_PARENT }});
  const exited=once(child,'exit');
  const ready = await new Promise<unknown>((done,reject) => {
    const timer=setTimeout(() => { child.kill('SIGKILL'); reject(new Error('synthetic child deadline')); },30000);
    child.once('message', m => {clearTimeout(timer);done(m);}); child.once('error', () => {clearTimeout(timer);reject(new Error('child unavailable'));});
    child.once('exit', () => {clearTimeout(timer);done('exited');});
  });
  return { child, ready, exited };
}
async function stop(c: {child: ChildProcess; exited: Promise<unknown>}, crash=false) { if (c.child.exitCode===null && c.child.signalCode===null) { if(crash)c.child.kill('SIGKILL');else c.child.send('close'); } await c.exited; }
function fixture() { const root=storageFixture('ledger-process-'),dir=join(root,'data');createLedgerDirectory(dir);return {root,path:join(dir,'ledger.sqlite')}; }
it('independent process exclusive writer, clean transfer, crash barrier and committed-only restart', async () => {
  const f=fixture(); const children: Awaited<ReturnType<typeof child>>[]=[];
  try {
    const a=await child('hold',f.path); children.push(a); expect(a.ready).toBe('ready');
    const b=await child('hold',f.path); children.push(b); expect(b.ready).toBe('unavailable'); await b.exited;
    await stop(a); expect(fs.existsSync(f.path+'.lock')).toBe(false);
    const c=await child('crash',f.path); children.push(c); expect(c.ready).toBe('ready'); await stop(c,true);
    expect(fs.existsSync(f.path+'.lock')).toBe(true); expect(() => new Ledger(f.path,id(1))).toThrow('ledger unavailable');
    // TEST-OWNED recovery only, AFTER joining every holder. Production never auto-steals.
    fs.unlinkSync(f.path+'.lock');
    const recovered=new Ledger(f.path,id(1));try {
      const r=recovered.getIntent(query); expect(r.ok).toBe(true); if(r.ok) { expect(r.value.intent).toEqual(intent);expect(r.value.facts).toEqual([]);expect(r.value.eventCount).toBe(0); }
      expect(recovered.timeline(query,{after:0,limit:100})).toEqual({version:1,ok:true,value:[]});
    } finally {recovered.close();}
  } finally {for(const c of children) await stop(c,true);fs.rmSync(f.root,{recursive:true,force:true});}
});
it('SQLite cross-process write contention is bounded, rolls back and retains uncertain ownership',async () => {
  const f=fixture();let ledger:Ledger|undefined,c:Awaited<ReturnType<typeof child>>|undefined;
  try {
    ledger=new Ledger(f.path,id(1));expect(ledger.recordIntent(intent).ok).toBe(true);
    c=await child('busy',f.path);expect(c.ready).toBe('ready');const start=Date.now();
    expect(ledger.append(event)).toEqual({version:1,ok:false,error:'unavailable'});
    expect(Date.now()-start).toBeLessThan(process.platform==='win32'?30000:2000);
    await stop(c);expect(() => ledger!.close()).toThrow();expect(fs.existsSync(f.path+'.lock')).toBe(true);
    fs.unlinkSync(f.path+'.lock');const recovered=new Ledger(f.path,id(1));try {expect(recovered.timeline(query,{after:0,limit:100})).toEqual({version:1,ok:true,value:[]});}finally{recovered.close();}
  } finally {if(c)await stop(c,true);try{ledger?.close();}catch{}fs.rmSync(f.root,{recursive:true,force:true});}
});
