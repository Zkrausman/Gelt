import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Ledger } from './ledger.js';
import { canonical, digest } from './ledger-canonical.js';
import { decimalSchema, intentSchema, eventSchema, writeResultSchema, getIntentResultSchema, timelineResultSchema, historyResultSchema, type Result } from './ledger-contract.js';
import { storageFixture } from './storage-fixture.js';
import { createLedgerDirectory, validateSQLiteFile } from './ledger-storage.js';
import { intent, event, query, id } from './ledger-fixture.js';
import { migrate, migration } from './ledger-migrations.js';
const page = { after: 0, limit: 100 };
function value<T>(r: Result<T>): T { expect(r.ok).toBe(true); if (!r.ok) throw new Error(r.error); return r.value; }
function fixture() {
  const root = storageFixture('ledger-'), dir = join(root, 'data'); createLedgerDirectory(dir);
  const path = join(dir, 'ledger.sqlite'); const ledger = new Ledger(path, id(1)); const raw = new Database(path);
  return { path, ledger, raw, cleanup() { raw.close(); try { ledger.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}
function snapshot(db: Database.Database) { return ['accounts', 'intents', 'events', 'facts', 'ledger_owner', 'migrations'].map(t => db.prepare(`SELECT * FROM ${t}`).all()); }
it('bounded canonical exact decimals and strict narrow schemas exclude credentials and raw metadata', () => {
  for (const d of [{value:'12345678901234567890.123456789012345678',precision:38,scale:18}, {value:'0.00',precision:3,scale:2}]) expect(decimalSchema.parse(JSON.parse(JSON.stringify(d)))).toEqual(d);
  for (const value of ['1e3','-1','+1','01','NaN','1.','1.1234567890123456789']) expect(decimalSchema.safeParse({value, precision:value.replace('.','').length,scale:value.split('.')[1]?.length ?? 0}).success).toBe(false);
  expect(decimalSchema.safeParse({ value: 0.1, precision: 1, scale: 1 }).success).toBe(false);
  expect(decimalSchema.safeParse({ value: '1.00', precision: 2, scale: 2 }).success).toBe(false);
  for (const v of [{...intent, version: 2}, {...intent, token: 'secret'}, {...intent, metadata: {}}, {...intent, recordedAt:'2026-02-30T00:00:00.000Z'}, {...intent, routing:{...intent.routing, RHS:'Bearer-token'}}, {...intent, intentId:'secret'}]) expect(intentSchema.safeParse(v).success).toBe(false);
  expect(eventSchema.safeParse({...event, rawMcp:{}}).success).toBe(false);
  expect(eventSchema.safeParse({...event, execution:undefined}).success).toBe(false);
  const f=fixture();try {
    const exact={...intent,order:{...intent.order,requestedLimitPrice:{value:'12345678901234567890.123456789012345678',precision:38,scale:18}}};
    value(f.ledger.recordIntent(exact));f.raw.close();f.ledger.close();const reopened=new Ledger(f.path,id(1));
    try{expect(value(reopened.getIntent(query)).intent).toEqual(exact);}finally{reopened.close();}
  }finally{f.cleanup();}
});
it('real SQLite commits, deduplicates, separates requested/observed values and replays after clean reopen', () => {
  const f=fixture(); try {
    const receipt=writeResultSchema.parse(f.ledger.recordIntent(intent)); expect(value(receipt).disposition).toBe('committed');
    expect(value(f.ledger.recordIntent(intent)).disposition).toBe('duplicate');
    expect(f.ledger.recordIntent({...intent, recordedAt:'2026-01-02T00:00:00.000Z'})).toMatchObject({error:'conflict'});
    expect(value(f.ledger.getIntent(query)).facts).toEqual([]);
    expect(value(f.ledger.append(event)).disposition).toBe('committed');
    expect(value(f.ledger.append(event)).disposition).toBe('duplicate');
    expect(f.ledger.append({...event, occurredAt:'2026-01-02T00:00:00.000Z'})).toMatchObject({error:'conflict'});
    expect(f.ledger.append({...event, eventId:id(50), idempotencyKey:id(51)})).toMatchObject({error:'conflict'});
    expect(value(timelineResultSchema.parse(f.ledger.timeline(query,page)))).toEqual([event]);
    const projection=value(getIntentResultSchema.parse(f.ledger.getIntent(query))); expect(projection.intent.order.requestedLimitPrice.value).toBe('1.00');
    expect(f.ledger.timeline(query,{after:0,limit:101})).toMatchObject({error:'invalid'});
    validateSQLiteFile(f.path); validateSQLiteFile(f.path+'-wal'); validateSQLiteFile(f.path+'-shm');
    f.raw.close(); f.ledger.close(); expect(fs.existsSync(f.path+'.lock')).toBe(false);
    const reopened=new Ledger(f.path,id(1)); try { expect(value(reopened.getIntent(query))).toEqual(projection); } finally { reopened.close(); }
  } finally { f.cleanup(); }
});
it('owner/account isolation, scoped idempotency and separate ACCOUNT/RHS/RHC uniqueness', () => {
  const f=fixture(); try {
    value(f.ledger.recordIntent(intent));
    expect(f.ledger.getIntent({...query,ownerId:id(99)})).toMatchObject({error:'invalid'});
    expect(f.ledger.getIntent({...query,accountId:id(99)})).toMatchObject({error:'not_found'});
    for (const route of ['ACCOUNT','RHS','RHC']) expect(f.ledger.recordIntent({...intent,accountId:id(20),routing:{provider:'robinhood-official-mcp',ACCOUNT:'account-2',RHS:'rhs-2',RHC:'rhc-2',[route]:intent.routing[route as keyof typeof intent.routing]}})).toMatchObject({error:'conflict'});
    const other={...intent, accountId:id(20), routing:{...intent.routing,ACCOUNT:'rhs-1',RHS:'rhc-1',RHC:'account-1'}};
    value(f.ledger.recordIntent(other)); value(f.ledger.append({...event,accountId:id(20)}));
    expect(value(f.ledger.timeline(query,page))).toEqual([]);
    expect(value(historyResultSchema.parse(f.ledger.history({ownerId:id(1),accountId:id(20)},page)))).toHaveLength(1);
  } finally { f.cleanup(); }
});
it('direct append reconstructs inside transaction: canonical live-tampered projection cannot commit', () => {
  const f=fixture(); try {
    value(f.ledger.recordIntent(intent)); value(f.ledger.append(event));
    const projection=value(f.ledger.getIntent(query)); projection.intent.order.route='RHC';
    f.raw.prepare('UPDATE intents SET projection=?').run(canonical(projection)); const before=snapshot(f.raw);
    expect(f.ledger.append({...event,eventId:id(77),idempotencyKey:id(78),execution:{...event.execution,executionId:'new-fill'}})).toMatchObject({error:'unavailable'});
    expect(snapshot(f.raw)).toEqual(before); expect(f.ledger.getIntent(query)).toMatchObject({error:'unavailable'});
  } finally { f.cleanup(); }
});
for (const field of ['eventId','idempotencyKey','intentId','ownerId','accountId','encoding']) it(`timeline validates stored canonical relational ${field}, even after open`, () => {
  const f=fixture(); try {
    value(f.ledger.recordIntent(intent)); value(f.ledger.append(event));
    const body=field==='encoding' ? JSON.stringify(event,null,1) : canonical({...event,[field]:id(99)});
    const previous=(f.raw.prepare('SELECT previous FROM events').get() as {previous:string}).previous;
    f.raw.prepare('UPDATE events SET body=?,hash=?').run(body,digest(previous+body));
    expect(f.ledger.timeline(query,page)).toMatchObject({error:'unavailable'});
    expect(f.ledger.append(event)).toMatchObject({error:'unavailable'});
  } finally { f.cleanup(); }
});
for (const method of ['getIntent','history','recordIntent','append'] as const) it(`${method} also validates live corrupt events without prior read`, () => {
  const f=fixture(); try {
    value(f.ledger.recordIntent(intent)); value(f.ledger.append(event));
    f.raw.prepare('UPDATE events SET body=?').run(canonical({...event,accountId:id(99)}));
    const r=method==='history' ? f.ledger.history({ownerId:id(1),accountId:id(2)},page) : f.ledger[method](method==='recordIntent'?intent:method==='append'?event:query);
    expect(r).toMatchObject({error:'unavailable'});
  } finally { f.cleanup(); }
});
for (const sql of ["CREATE TRIGGER fail BEFORE INSERT ON facts BEGIN SELECT RAISE(ABORT,'private error must not escape'); END", "CREATE TRIGGER fail BEFORE UPDATE ON intents BEGIN SELECT RAISE(ABORT,'private error must not escape'); END"]) it('real trigger failure rolls back event/index/projection atomically and poisons', () => {
  const f=fixture(); try {
    value(f.ledger.recordIntent(intent)); f.raw.exec(sql); const before=snapshot(f.raw);
    expect(f.ledger.append(event)).toEqual({version:1,ok:false,error:'unavailable'}); expect(snapshot(f.raw)).toEqual(before);
    expect(f.ledger.recordIntent(intent)).toMatchObject({error:'unavailable'});
    expect(() => f.ledger.close()).toThrow('ledger unavailable'); expect(fs.existsSync(f.path+'.lock')).toBe(true);
  } finally { f.cleanup(); }
});
it('migrations are idempotent and failed DDL rolls back; newer/invalid schema never resets', () => {
  const root=storageFixture('migration-'); const path=join(root,'test.sqlite');
  try {
    const db=new Database(path);
    expect(() => db.transaction(() => { db.exec(migration); db.exec('invalid SQL'); }).immediate()).toThrow();
    expect(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([]);
    migrate(db,id(1)); migrate(db,id(1)); const before=snapshot(db);
    db.pragma('user_version=2'); expect(() => migrate(db,id(1))).toThrow(); expect(snapshot(db)).toEqual(before);
    db.pragma('user_version=1'); db.prepare('UPDATE migrations SET checksum=?').run('wrong'); expect(() => migrate(db,id(1))).toThrow();
    db.close();
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
for (const mutate of ["PRAGMA application_id=42", "PRAGMA user_version=0", "DELETE FROM migrations", "DROP TABLE facts", "UPDATE ledger_owner SET owner='wrong'"]) it(`reopen rejects invalid stored schema/owner: ${mutate}`, () => {
  const f=fixture(); try {
    value(f.ledger.recordIntent(intent)); f.raw.close(); f.ledger.close();
    const raw=new Database(f.path); raw.exec(mutate); raw.close();
    expect(() => new Ledger(f.path,id(1))).toThrow('ledger unavailable'); expect(fs.existsSync(f.path+'.lock')).toBe(true);
  } finally { f.cleanup(); }
});
it('metadata rejects hard links and Linux public modes; live removal fails closed', () => {
  const f=fixture(); try {
    const link=f.path+'.link'; fs.linkSync(f.path,link); expect(() => validateSQLiteFile(f.path)).toThrow(); fs.unlinkSync(link);
    if (process.platform==='linux') { fs.chmodSync(f.path,0o644); expect(() => validateSQLiteFile(f.path)).toThrow(); fs.chmodSync(f.path,0o600); }
    fs.unlinkSync(f.path+'.lock'); expect(f.ledger.recordIntent(intent)).toMatchObject({error:'unavailable'});
  } finally { f.cleanup(); }
});
it('actual migration disk-capacity failure rolls back schema/history/application ID', () => {
  const root=storageFixture('migration-full-');const path=join(root,'file.sqlite');const db=new Database(path);
  try {
    db.pragma('max_page_count=1');expect(() => migrate(db,id(1))).toThrow();
    expect(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([]);
    expect(db.pragma('user_version',{simple:true})).toBe(0);expect(db.pragma('application_id',{simple:true})).toBe(0);
    db.pragma('max_page_count=100');migrate(db,id(1));migrate(db,id(1));
  } finally {db.close();fs.rmSync(root,{recursive:true,force:true});}
});
it('attempt/request/acknowledgement/reconciliation facts do not synthesize executions or transitions', () => {
  const f=fixture();try {
    value(f.ledger.recordIntent(intent));
    const base={version:1,ownerId:id(1),accountId:id(2),intentId:id(3),occurredAt:'2026-01-01T00:00:01.000Z'};
    const facts=[{...base,eventId:id(80),idempotencyKey:id(81),type:'dispatch-attempted',attemptId:id(90)}, {...base,eventId:id(82),idempotencyKey:id(83),type:'order-requested',requestId:id(91)}, {...base,eventId:id(84),idempotencyKey:id(85),type:'broker-acknowledged',brokerOrderId:'observed-order-1'}, {...base,eventId:id(86),idempotencyKey:id(87),type:'reconciliation-observed',reconciliationId:id(92),observation:'unknown'}];
    for(const fact of facts)value(f.ledger.append(fact));
    expect(value(f.ledger.getIntent(query)).facts).toEqual(facts);
    expect(value(f.ledger.timeline(query,{after:1,limit:2}))).toEqual(facts.slice(1,3));
    const before=snapshot(f.raw);expect(f.ledger.append({...event,token:'synthetic-secret'})).toMatchObject({error:'invalid'});expect(snapshot(f.raw)).toEqual(before);
    expect(canonical(snapshot(f.raw))).not.toContain('synthetic-secret');
  } finally {f.cleanup();}
});
it('foreign database and corrupt bytes fail closed without reset', () => {
  const f=fixture();try {
    f.raw.close();f.ledger.close();fs.writeFileSync(f.path,Buffer.from('not a SQLite database'));
    expect(() => new Ledger(f.path,id(1))).toThrow('ledger unavailable');expect(fs.readFileSync(f.path).toString()).toBe('not a SQLite database');
  }finally{f.cleanup();}
  const root=storageFixture('foreign-');const path=join(root,'foreign.sqlite');const db=new Database(path);
  try {db.exec('CREATE TABLE foreign_data(value TEXT)');expect(() => migrate(db,id(1))).toThrow();expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{name:'foreign_data'}]);}finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});
for (const field of ['seq','type','previous','facts','account-route','intent-encoding','projection']) it(`all reads reject live ${field} divergence and close retains barrier`, () => {
  const f=fixture();try {
    value(f.ledger.recordIntent(intent));value(f.ledger.append(event));
    if(field==='seq')f.raw.exec('UPDATE events SET seq=2');
    else if(field==='type')f.raw.exec("UPDATE events SET type='broker-acknowledged'");
    else if(field==='previous')f.raw.exec("UPDATE events SET previous='wrong'");
    else if(field==='facts')f.raw.exec("UPDATE facts SET namespace='RHC:execution-observed'");
    else if(field==='account-route')f.raw.exec("UPDATE accounts SET rhs='different-route'");
    else if(field==='intent-encoding')f.raw.prepare('UPDATE intents SET body=?').run(JSON.stringify(intent,null,1));
    else { const p=value(f.ledger.getIntent(query));p.facts=[];p.eventCount=0;f.raw.prepare('UPDATE intents SET projection=?').run(canonical(p)); }
    expect(f.ledger.history({ownerId:id(1),accountId:id(2)},page)).toMatchObject({error:'unavailable'});
    expect(() => f.ledger.close()).toThrow();expect(fs.existsSync(f.path+'.lock')).toBe(true);
  }finally{f.cleanup();}
});
it('close itself validates live tampering; duplicate writes cannot bypass projection replay', () => {
  for(const method of ['close','recordIntent','append']) {
    const f=fixture();try {
      value(f.ledger.recordIntent(intent));value(f.ledger.append(event));f.raw.exec("UPDATE intents SET projection='{}'");
      const before=snapshot(f.raw);
      if(method==='close')expect(() => f.ledger.close()).toThrow();
      else expect(method==='append'?f.ledger.append(event):f.ledger.recordIntent(intent)).toMatchObject({error:'unavailable'});
      expect(snapshot(f.raw)).toEqual(before);
    }finally{f.cleanup();}
  }
});
