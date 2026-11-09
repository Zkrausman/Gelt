import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonical } from '../worker/dist/ledger-canonical.js';
import { storageFixture } from '../worker/dist/storage-fixture.js';
import { A64ObservedSnapshotReceiptStore as Store } from '../worker/dist/a64-observed-snapshot-receipt.js';
import { evidence, negative, owner } from '../worker/dist/a64-observed-snapshot.test-support.js';
import { root, childEnvironment } from './runtime.mjs';

// Owned synthetic offline fixtures only. Never imported by a product entry point.
export async function verifyObservedReceiptCommand() {
  const fixture = storageFixture('gelt-observed-cli-conformance-');
  const negativeFixture = storageFixture('gelt-observed-cli-negative-');
  const entry = join(root, 'worker/dist/a64-observed-receipt-inspection-cli.js');
  const guard = new URL('offline-guard.mjs', import.meta.url).href;
  const text = (binding, storeRoot = fixture) => canonical({ schema: 'gelt.agent.a64-observed-receipt-inspection-input.v1', root: storeRoot, binding });
  const snapshot = (storeRoot = fixture) => Object.fromEntries(readdirSync(storeRoot).map(n => {
    const path = join(storeRoot, n), st = lstatSync(path);
    return [n, { mode: st.mode, ino: st.ino, mtime: st.mtimeMs, bytes: readFileSync(path).toString('base64') }];
  }));
  let cases = 0;
  function run(args, input, exit, status) {
    const result = spawnSync(process.execPath, ['--import', guard, entry, ...args], { cwd: root, env: childEnvironment(), input,
      timeout: 15000, maxBuffer: 8192, windowsHide: true });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, exit);
    assert.equal(result.stderr.length, 0); assert.ok(result.stdout.length > 0 && result.stdout.length <= 8192);
    const output = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout), value = JSON.parse(output);
    assert.equal(output, canonical(value)+'\n'); assert.ok(!output.includes(fixture) && !output.includes(negativeFixture) && !output.includes('PRIVATE_SENTINEL'));
    assert.equal(value.qualification, 'NOT_READY'); assert.equal(value.production, 'CLOSED'); assert.equal(value.operations, 'DEFER');
    assert.equal(value.inspectionWrites, 0); assert.equal(value.operationalDecisions, 0); assert.equal(value.consumptionAttempts, 0);
    if (status) assert.equal(value.status, status); cases++; return value;
  }
  try {
    const capability = run(['--describe'], '', 0);
    assert.equal(capability.inputBytes, 8192); assert.equal(capability.outputBytes, 8192); assert.equal(capability.rootBytes, 4096);
    run(['--repair', 'PRIVATE_SENTINEL'], '', 64, 'rejected');
    run([], '{"secret":"PRIVATE_SENTINEL"}', 2, 'rejected');
    run([], text(owner()), 2, 'unavailable');
    const f = await evidence(), store = Store.create(fixture, f.binding), receipt = store.retain(f.text); store.close();
    const before = snapshot(), positive = run([], text(f.binding), 0, 'assessed_data');
    assert.deepEqual(positive.receipt, receipt); assert.equal(positive.assessment.assessmentSha256, receipt.assessmentSha256);
    assert.equal(positive.assessment.provenance, 'serialized_declarations_not_private_issuance'); assert.equal(positive.input, undefined);
    run([], text(f.binding), 0, 'assessed_data');
    run([], text({ ...f.binding, ownerNamespaceSha256: 'c'.repeat(64) }), 2, 'unavailable');
    assert.deepEqual(snapshot(), before);
    // A separate owned case proves reported negatives without copying a positive claim.
    const rejected = Store.create(negativeFixture, f.binding); rejected.retain(negative(f.p, f.binding)); rejected.close();
    const negativeBefore = snapshot(negativeFixture), value = run([], text(f.binding, negativeFixture), 2, 'rejected');
    assert.equal(value.assessment, null); assert.equal(value.receipt.fullEvidenceRetained, false); assert.equal(value.reason, 'invalid_source');
    assert.deepEqual(snapshot(negativeFixture), negativeBefore); assert.deepEqual(snapshot(), before);
    console.log(`PASS ${cases} actual compiled A64 read-only receipt-command cases; synthetic stores unchanged by inspection`);
  } finally { rmSync(fixture, { recursive: true, force: true }); rmSync(negativeFixture, { recursive: true, force: true }); }
}
