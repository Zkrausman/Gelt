import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import * as privateFiles from './private-files.js';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { LedgerStorage } from './ledger-storage.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, digest } from './ledger-canonical.js';
import { checkIds } from './alpaca-byte-review-contract.js';
import { pamrRecipe, spy253PAMRInspectionRequestSchema } from './paper-conversion-contract.js';
import { replaySpy253PAMRInspectionRequest, spy253InspectionOriginalSha256, type Spy253PAMRInspectionArtifact } from './pamr-reference-artifact.js';
import { a64InspectionEvidenceContextSchema, a64InspectionHistory, a64InspectionUnknownFacts, a64InspectionEvidenceHolds } from './pamr-a64-inspection-evidence-contract.js';
import { assessA64InspectionEvidence } from './pamr-a64-inspection-evidence.js';
import { derivePAMRConsumerPrefix } from './pamr-consumer-adapter.js';
import { A64EvidenceReceiptStore } from './a64-evidence-receipt.js';
import { A64EvidenceReceiptError, a64ReceiptLimits } from './a64-evidence-receipt-contract.js';

// Complete synthetic DATA fixture reused verbatim from assessor tests. This is
// not a new actual input, runtime qualification, calendar or operating result.
const h = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const receivedAt = '2026-10-28T12:59:30.000Z';
const sourceDecisionAt = '2026-10-28T13:00:00.000Z';
const completedAt = '2026-10-28T12:59:31.000Z';
const proposedCase = {
  id: 'GELT-PAMR-A64-EVIDENCE-001',
  revision: 'proposal-2',
} as const;
const epoch = 'SYNTHETIC-PRIVATE-CONTEXT-SENTINEL';

const hash = (domain: string, value: unknown) => digest(canonical({
  domain: 'gelt.pamr-a64-inspection-evidence.v1/' + domain,
  value,
}));
const copy = (value: unknown): any => JSON.parse(canonical(value));
const decimal = (value: string) => ({
  value,
  precision: value.replace('.', '').length,
  scale: value.split('.')[1]?.length ?? 0,
});
const pack = (artifact: unknown, context: unknown): string => canonical({
  schema: 'gelt.pamr-a64-inspection-evidence-input.v1',
  artifactText: canonical(artifact),
  contextText: canonical(context),
});

function replay(request: unknown): Spy253PAMRInspectionArtifact {
  const result = replaySpy253PAMRInspectionRequest(canonical(request));
  expect(result.status).toBe('computed_data');
  if (result.status !== 'computed_data') throw new Error('synthetic replay rejected');
  return result.artifact;
}

function sourceProfile(artifact: Spy253PAMRInspectionArtifact) {
  return {
    inspectorRevision: 'gelt.spy253-source-inspector.v1',
    requestSchema: 'gelt.spy253-pamr-inspection-request.v1',
    artifactSchema: 'gelt.spy253-pamr-inert-inspection.v1',
    classification: 'source_inspection_only',
    sourceRequest: artifact.request.lineage.request,
    mathematicalProfile: pamrRecipe.profile,
    selection: a64InspectionHistory.selection,
    initialization: a64InspectionHistory.initialization,
  };
}

// Test-side assembly from complete replay output, not a production builder.
// Synthetic declared hashes, calendar ordinals and check vectors do NOT establish
// a real 253-close acquisition, calendar, issuance, private completion or rights.
function contextFor(artifact: Spy253PAMRInspectionArtifact) {
  const request = artifact.request;
  const lineage = request.lineage;
  const schema = 'gelt.pamr-a64-inspection-evidence-context.v1';
  const purpose = 'evidence_only_no_operational_admission';
  return a64InspectionEvidenceContextSchema.parse({
    schema,
    version: 1,
    classification: 'source_inspection_only',
    purpose,
    case: proposedCase,
    proposedEpochId: epoch,
    sourceProfile: sourceProfile(artifact),
    history: a64InspectionHistory,
    bindings: {
      caseEpochSha256: hash('case-epoch', {
        schema, case: proposedCase, proposedEpochId: epoch, purpose,
      }),
      sourceProfileSha256: hash('source-profile', sourceProfile(artifact)),
      historySha256: hash('history', {
        history: a64InspectionHistory,
        selected: request.selected,
        pairs: artifact.pairs,
      }),
      sourceRequestSha256: hash('source-request', lineage.request),
      inspectionRequestSha256: hash('inspection-request', request),
      calendarSha256: hash('calendar-reference', {
        sourceCalendarSha256: lineage.calendarSha256,
      }),
      declarationsSha256: hash('declarations', {
        declarationsSha256: lineage.declarationsSha256,
        availabilitySha256: lineage.availabilitySha256,
        providerRevisionsSha256: lineage.providerRevisionsSha256,
        declaredPrefixAvailableAt: lineage.declaredPrefixAvailableAt,
        selected: request.selected.map(selected => ({
          sourceIndex: selected.sourceIndex,
          sessionOrdinal: selected.sessionOrdinal,
          providerTimestamp: selected.providerTimestamp,
          declaredAvailableAt: selected.declaredAvailableAt,
        })),
      }),
      originalSha256: hash('original-lineage-data', lineage),
      selectedPairsSha256: hash('selected-pairs', {
        selected: request.selected,
        pairs: artifact.pairs,
      }),
      recipeSha256: hash('recipe-adaptation', {
        recipe: artifact.recipe,
        assets: request.assets,
        selection: request.selection,
        initialization: artifact.initialization,
        reserveConvention: artifact.reserveConvention,
        fidelity: artifact.fidelity,
      }),
      artifactSha256: hash('artifact', artifact),
    },
    timing: {
      schema: 'gelt.pamr-a64-prospective-timing-proposal.v1',
      sourceReceivedAt: lineage.receivedAt,
      sourceDecisionAt: lineage.decisionAt,
      sourceReviewCompletedAt: lineage.review.completedAt,
      sourceDeclaredPrefixAvailableAt: lineage.declaredPrefixAvailableAt,
      proposedAssessmentAt: '2026-10-29T14:00:00.000Z',
      proposedDecisionAt: '2026-10-29T14:01:00.000Z',
      proposedEvaluationAt: '2026-10-29T14:02:00.000Z',
      assertedCompleteInputAvailableAt: null,
    },
    facts: a64InspectionUnknownFacts,
  });
}

function fixture(declaredAvailability: string | null = null) {
  const lineageWithoutOriginal = {
    allObservationsSha256: h,
    request: {
      symbol: 'SPY', feed: 'iex', adjustment: 'all',
      start: '2025-10-24T04:00:00.000Z',
      end: '2026-10-27T04:00:00.000Z',
      asof: '2026-10-27',
      timeframe: '1Day', currency: 'USD', sort: 'desc',
      pageRequests: [
        { page: 1, limit: 100, pageTokenSha256: null },
        { page: 2, limit: 100, pageTokenSha256: h },
        { page: 3, limit: 53, pageTokenSha256: h },
      ],
    },
    pages: [1, 2, 3].map(page => ({ page, byteLength: 1, sha256: h })),
    calendarSha256: h,
    declarationsSha256: h,
    availabilitySha256: declaredAvailability === null ? null : h,
    providerRevisionsSha256: h,
    receivedAt,
    decisionAt: sourceDecisionAt,
    declaredPrefixAvailableAt: declaredAvailability,
    review: {
      schema: 'gelt.review-before-discard-verdict.v1',
      attemptId: '00000000-0000-4000-8000-000000000001',
      invocationId: '00000000-0000-4000-8000-000000000002',
      revisions: {
        contract: 1, consumer: '1.1',
        sourceClosure: 'synthetic.unadmitted.v1',
        request: 'synthetic.unadmitted.v1',
        policy: 'synthetic.unadmitted.v1',
        calendar: 'synthetic.unadmitted.v1',
        availability: 'synthetic.unadmitted.v1',
        candidate: 'synthetic.unadmitted.v1',
        reviewer: 'synthetic.unadmitted.v1',
        verdictPolicy: 'synthetic.unadmitted.v1',
      },
      reviewerRevision: 'gelt.spy253-source-inspector.v1',
      authorityId: 'spy253.inspection.no-market-authority.v1',
      bindingSha256: h,
      completedAt,
      elapsedMs: 1000,
      outcome: 'incomplete',
      checks: checkIds.map((id, i) => ({
        id,
        result: i < 6 || i === 15 ? 'pass' : 'unknown',
        reason: i < 6 || i === 15 ? 'none' : 'evidence_missing',
      })),
    },
  };

  // Only the supplied pure schema and mathematical DATA replay are invoked.
  const request = spy253PAMRInspectionRequestSchema.parse({
    schema: 'gelt.spy253-pamr-inspection-request.v1',
    classification: 'source_inspection_only',
    recipe: pamrRecipe,
    assets: ['SPY-CLOSE-RELATIVE', 'DECLARED-UNIT-RESERVE'],
    rows: Array.from({ length: 64 }, () => ['1', '1']),
    selection: a64InspectionHistory.selection,
    initialization: a64InspectionHistory.initialization,
    discardedCount: 188,
    selected: Array.from({ length: 65 }, (_, i) => ({
      sourceIndex: 64 - i,
      sessionOrdinal: 189 + i,
      providerTimestamp: new Date(
        Date.parse('2026-08-01T04:00:00.000Z') + i * 86400000,
      ).toISOString(),
      declaredAvailableAt: declaredAvailability,
      close: decimal('2'),
    })),
    lineage: {
      ...lineageWithoutOriginal,
      originalSha256: spy253InspectionOriginalSha256(
        lineageWithoutOriginal as Parameters<typeof spy253InspectionOriginalSha256>[0],
      ),
    },
  });
  const artifact = replay(request);
  const context = contextFor(artifact);
  return { artifact, context, text: pack(artifact, context) };
}


const roots: string[] = [];
function root() { const p = fs.mkdtempSync(join(tmpdir(), 'gelt-a64-receipt-')); fs.chmodSync(p, 0o700); roots.push(p); return p; }
function owner(f = fixture()) { return { schema: 'gelt.a64-evidence-retention-binding.v1', ownerNamespaceSha256: h, caseEpochSha256: f.context.bindings.caseEpochSha256 }; }
function files(p: string) { return fs.readdirSync(p).sort().map(n => ({ name: n, sha: createHash('sha256').update(fs.readFileSync(join(p, n))).digest('hex'), stat: fs.statSync(join(p,n)).mtimeMs })); }
function fail(fn: () => unknown, reason?: string) {
  try { fn(); throw new Error('expected rejection'); }
  catch (e) { expect(e).toBeInstanceOf(A64EvidenceReceiptError); expect((e as Error).message).toBe('A64 evidence retention unavailable'); if (reason) expect((e as A64EvidenceReceiptError).reason).toBe(reason); }
}
afterEach(() => { vi.restoreAllMocks(); for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });

it('retains whole input with a separate sequence and reopens without filesystem changes', () => {
  const f = fixture(), p = root(), b = owner(f), store = A64EvidenceReceiptStore.create(p,b);
  const receipt = store.retain(f.text);
  expect(receipt).toMatchObject({ binding: b, receiptSequence: 1, historyUpdates: 64, operationalDecisions: 0, consumptionAttempts: 0, effectAuthority: 'none' });
  expect(Buffer.byteLength(canonical(receipt))).toBeLessThanOrEqual(8192);
  const pure = assessA64InspectionEvidence(f.text); expect(pure.status).toBe('assessed_data');
  expect(store.read().assessment).toEqual(pure.status === 'assessed_data' ? pure.value : null);
  expect(store.read().assessment).toMatchObject(a64InspectionEvidenceHolds);
  expect(store.read().assessment.facts).toEqual(a64InspectionUnknownFacts);
  fail(() => A64EvidenceReceiptStore.reopen(p,b)); // active writer, not a safe checkpoint
  fail(() => A64EvidenceReceiptStore.create(p,b)); // concurrent owner cannot enter
  expect(store.read().receipt).toEqual(receipt);
  store.close();
  const before = files(p), ro = A64EvidenceReceiptStore.reopen(p,b);
  expect(ro.read().receipt).toEqual(receipt);
  fail(() => ro.retain(f.text), 'readonly'); ro.close();
  expect(files(p)).toEqual(before);
  fail(() => A64EvidenceReceiptStore.create(p,b)); // no new writer after clean close
  expect(files(p)).toEqual(before);
  expect(() => derivePAMRConsumerPrefix(canonical(f.artifact))).toThrow('PAMR consumer prefix unavailable');
});

it('rejects repeated and changed valid input in the bound epoch without replacing evidence', () => {
  const f = fixture(), p = root(), store = A64EvidenceReceiptStore.create(p,owner(f));
  const receipt = store.retain(f.text);
  fail(() => store.retain(f.text),'already_retained');
  const changed = fixture(); changed.context.timing.proposedAssessmentAt = '2026-10-29T13:59:00.000Z';
  fail(() => store.retain(pack(changed.artifact,changed.context)),'already_retained');
  expect(store.read().receipt).toEqual(receipt); store.close();
});

it('rejects forged, incomplete and cross-case input before mutation, then accepts complete input', () => {
  const f=fixture(),p=root(),store=A64EvidenceReceiptStore.create(p,owner(f));
  const bad=copy(f.artifact); bad.rows = [['9','1']];
  for (const text of ['{}', f.text.slice(0,-1), pack(bad,f.context), f.text+'\n{}', 'x'.repeat(a64ReceiptLimits.input+1)]) fail(()=>store.retain(text),'invalid_input');
  const other=owner(f); other.caseEpochSha256=otherHash;
  const q=root(),different=A64EvidenceReceiptStore.create(q,other);
  fail(()=>different.retain(f.text),'invalid_input'); fail(()=>different.close(),'uncertain');
  store.retain(f.text); store.close();
});

it('rejects owner namespace changes and malformed favorable authority fields on reopen', () => {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);store.close();
  for (const altered of [{...b,ownerNamespaceSha256:otherHash},{...b,caseEpochSha256:otherHash},{...b,authority:'pass'}]) fail(()=>A64EvidenceReceiptStore.reopen(p,altered));
  const ro=A64EvidenceReceiptStore.reopen(p,b);ro.close();
});

it('retains the marker after an empty writer closes; no retry or read-only repair', () => {
  const p=root(),b=owner(),store=A64EvidenceReceiptStore.create(p,b);
  fail(()=>store.close(),'uncertain');expect(fs.existsSync(join(p,'a64-evidence-receipt.sqlite.lock'))).toBe(true);
  const before=files(p);fail(()=>A64EvidenceReceiptStore.create(p,b));fail(()=>A64EvidenceReceiptStore.reopen(p,b));expect(files(p)).toEqual(before);
});

it('poisons a partial mutation and preserves uncertainty through close and reopen', () => {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);
  const db=(store as any).storage.db;
  const prepare=db.prepare.bind(db);
  vi.spyOn(db,'prepare').mockImplementation(((sql: string)=> {
    const statement=prepare(sql);
    if(sql.startsWith('INSERT INTO receipt')) return {...statement,run:()=> { statement.run(f.text,'partial','partial'); throw new Error('PRIVATE_FAILURE_SENTINEL'); }};
    return statement;
  }) as any);
  fail(()=>store.retain(f.text),'uncertain');vi.restoreAllMocks();
  fail(()=>store.close(),'uncertain');expect(fs.existsSync(join(p,'a64-evidence-receipt.sqlite.lock'))).toBe(true);
  fail(()=>A64EvidenceReceiptStore.reopen(p,b));fail(()=>A64EvidenceReceiptStore.create(p,b));
});

it('detects coordinated persisted assessment/receipt forgery through full-input recomputation',()=> {
  const f=fixture(),p=root(),store=A64EvidenceReceiptStore.create(p,owner(f));store.retain(f.text);
  const db=(store as any).storage.db;
  db.prepare('UPDATE receipt SET assessment=? WHERE id=1').run(canonical({status:'pass'}));
  fail(()=>store.read(),'uncertain');fail(()=>store.close(),'uncertain');
  fail(()=>A64EvidenceReceiptStore.reopen(p,owner(f)));
});

it('detects disk corruption after opening a clean in-memory read-only checkpoint',()=> {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);store.close();
  const ro=A64EvidenceReceiptStore.reopen(p,b),path=join(p,'a64-evidence-receipt.sqlite');
  const bytes=fs.readFileSync(path);bytes[100]^=1;fs.writeFileSync(path,bytes);
  fail(()=>ro.read(),'uncertain');fail(()=>ro.close(),'uncertain');
});

it('rejects unsafe roots and sidecars without touching source or foreign data',()=> {
  const f=fixture(),p=root(),b=owner(f);fs.chmodSync(p,0o755);fail(()=>A64EvidenceReceiptStore.create(p,b));fs.chmodSync(p,0o700);
  fs.writeFileSync(join(p,'foreign'),'PRIVATE',{mode:0o600});fail(()=>A64EvidenceReceiptStore.create(p,b));expect(fs.readFileSync(join(p,'foreign'),'utf8')).toBe('PRIVATE');
  const q=root();fs.symlinkSync(p,join(q,'link'));fail(()=>A64EvidenceReceiptStore.create(join(q,'link'),b));
  const r=root(),s=A64EvidenceReceiptStore.create(r,b);s.retain(f.text);s.close();
  fs.writeFileSync(join(r,'a64-evidence-receipt.sqlite-wal'),'x',{mode:0o600});fail(()=>A64EvidenceReceiptStore.reopen(r,b));
});

it('checks aggregate disk limits before a retained result is read',()=> {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);
  fs.writeFileSync(join(p,'a64-evidence-receipt.sqlite-journal'),Buffer.alloc(a64ReceiptLimits.store),{mode:0o600});
  fail(()=>store.read(),'uncertain');fail(()=>store.close(),'uncertain');
});

it('retains failed schema initialization ownership instead of reopening an empty namespace',()=> {
  const p=root(),b=owner();
  const original=LedgerStorage.prototype.validate;
  let calls=0;
  vi.spyOn(LedgerStorage.prototype,'validate').mockImplementation(function() {
    if(++calls===2)throw new Error('PRIVATE_INIT_FAILURE');return original.call(this);
  });
  fail(()=>A64EvidenceReceiptStore.create(p,b));vi.restoreAllMocks();
  expect(fs.existsSync(join(p,'a64-evidence-receipt.sqlite.lock'))).toBe(true);
  fail(()=>A64EvidenceReceiptStore.create(p,b));fail(()=>A64EvidenceReceiptStore.reopen(p,b));
});

it('retains ownership when checkpoint completion fails',()=> {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);
  const db=(store as any).storage.db,pragma=db.pragma.bind(db);
  vi.spyOn(db,'pragma').mockImplementation(((sql:string,...args:any[])=>{
    if(sql==='wal_checkpoint(TRUNCATE)')throw new Error('PRIVATE_CHECKPOINT_FAILURE');
    return pragma(sql,...args);
  }) as any);
  fail(()=>store.close(),'uncertain');vi.restoreAllMocks();
  expect(fs.existsSync(join(p,'a64-evidence-receipt.sqlite.lock'))).toBe(true);
  fail(()=>A64EvidenceReceiptStore.reopen(p,b));
});

it('rejects hardlinked persisted data on clean reopen',()=> {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);store.close();
  const q=root(),file=join(p,'a64-evidence-receipt.sqlite');fs.linkSync(file,join(q,'alias'));
  fail(()=>A64EvidenceReceiptStore.reopen(p,b));
});

it('rejects extra schema objects and changed database identity',()=> {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);store.close();
  const file=join(p,'a64-evidence-receipt.sqlite'),db=new Database(file);
  db.exec('CREATE VIEW unexpected AS SELECT 1');db.close();
  fail(()=>A64EvidenceReceiptStore.reopen(p,b));
  const q=root(),s=A64EvidenceReceiptStore.create(q,b);s.retain(f.text);s.close();
  const ro=A64EvidenceReceiptStore.reopen(q,b),path=join(q,'a64-evidence-receipt.sqlite'),outside=root();
  fs.renameSync(path,join(outside,'original'));fs.copyFileSync(join(outside,'original'),path);fs.chmodSync(path,0o600);
  fail(()=>ro.read(),'uncertain');fail(()=>ro.close(),'uncertain');
});

it('fences uncertain close after the inherited marker unlink, including directory-sync failure',()=> {
  const f=fixture(),p=root(),b=owner(f),store=A64EvidenceReceiptStore.create(p,b);store.retain(f.text);
  const original=privateFiles.removePrivate;
  vi.spyOn(privateFiles,'removePrivate').mockImplementation(path=>{
    if(path.endsWith('.sqlite.lock')) { fs.unlinkSync(path); throw new Error('SYNTHETIC_DIRECTORY_SYNC_FAILURE_AFTER_UNLINK'); }
    original(path);
  });
  fail(()=>store.close(),'uncertain');vi.restoreAllMocks();
  expect(fs.existsSync(join(p,'a64-evidence-receipt.sqlite.lock'))).toBe(false);
  expect(fs.existsSync(join(p,'a64-evidence-receipt.pending'))).toBe(true);
  const before=files(p);fail(()=>A64EvidenceReceiptStore.reopen(p,b));expect(files(p)).toEqual(before);
});

it('rejects FIFO candidates within a bounded child instead of blocking filesystem inspection',()=> {
  const p=root(),b=owner();
  execFileSync('/usr/bin/mkfifo',['-m','600',join(p,'a64-evidence-receipt.sqlite')]);
  const moduleURL=pathToFileURL(resolve('worker/src/a64-evidence-receipt.ts')).href;
  const source=`import { A64EvidenceReceiptStore } from ${JSON.stringify(moduleURL)}; let s='';for await(const c of process.stdin)s+=c;const {root,binding}=JSON.parse(s);for(const method of ['create','reopen']){let rejected=false;try{A64EvidenceReceiptStore[method](root,binding)}catch(e){rejected=e.message==='A64 evidence retention unavailable';}if(!rejected)process.exit(1);}process.stdout.write('rejected\\n');`;
  const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{input:JSON.stringify({root:p,binding:b}),encoding:'utf8',timeout:2000});
  expect(output).toBe('rejected\n');
});

it('rejects FIFO replacement between metadata check and open without blocking',()=> {
  const p=root(),b=owner(),file=join(p,'a64-evidence-receipt.sqlite');fs.writeFileSync(file,'not a database',{mode:0o600});
  const moduleURL=pathToFileURL(resolve('worker/src/a64-evidence-receipt.ts')).href;
  const source=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {execFileSync} from 'node:child_process';import {A64EvidenceReceiptStore} from ${JSON.stringify(moduleURL)};let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);let swapped=false;const stat=fs.lstatSync;fs.lstatSync=function(path,...args){const result=stat(path,...args);if(!swapped&&String(path)===x.file){swapped=true;fs.unlinkSync(path);execFileSync('/usr/bin/mkfifo',['-m','600',path]);}return result;};syncBuiltinESMExports();try{A64EvidenceReceiptStore.reopen(x.root,x.binding);process.exit(1);}catch(e){if(!swapped||e.message!=='A64 evidence retention unavailable')process.exit(1);}process.stdout.write('rejected\\n');`;
  expect(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{input:JSON.stringify({root:p,binding:b,file}),encoding:'utf8',timeout:2000})).toBe('rejected\n');
});

it('keeps the independent pending fence when its final unlink fails before effect',()=> {
  const f=fixture(),p=root(),b=owner(f);
  const moduleURL=pathToFileURL(resolve('worker/src/a64-evidence-receipt.ts')).href;
  const source=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';import {A64EvidenceReceiptStore} from ${JSON.stringify(moduleURL)};let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);const store=A64EvidenceReceiptStore.create(x.root,x.binding);store.retain(x.input);const pending=join(x.root,'a64-evidence-receipt.pending');const original=fs.unlinkSync;fs.unlinkSync=function(path){if(path===pending)throw new Error('SYNTHETIC_FINAL_UNLINK_FAILURE');return original(path);};syncBuiltinESMExports();let failed=false;try{store.close();}catch(e){failed=e.reason==='uncertain';}fs.unlinkSync=original;syncBuiltinESMExports();if(!failed||!fs.existsSync(pending)||fs.existsSync(join(x.root,'a64-evidence-receipt.sqlite.lock')))process.exit(1);let blocked=false;try{A64EvidenceReceiptStore.reopen(x.root,x.binding);}catch(e){blocked=e.message==='A64 evidence retention unavailable';}if(!blocked)process.exit(1);process.stdout.write('fenced\\n');`;
  expect(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{input:JSON.stringify({root:p,binding:b,input:f.text}),encoding:'utf8',timeout:2000})).toBe('fenced\n');
});
