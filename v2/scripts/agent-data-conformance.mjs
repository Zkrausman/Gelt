import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, childEnvironment } from './runtime.mjs';
import { canonical } from '../worker/dist/ledger-canonical.js';
import { a64InspectionHistory } from '../worker/dist/pamr-a64-inspection-evidence-contract.js';

const entries = Object.freeze(['a64-inspection-cli.js', 'pamr-proposal-cli.js', 'prospective-declaration-cli.js']);
const modes = Object.freeze(['capability', 'invalid_input', 'usage']);
const exits = Object.freeze({ capability: 0, invalid_input: 2, usage: 64 });
const sentinel = 'SYNTHETIC_AGENT_DATA_NO_REFLECTION';
const guard = new URL('offline-guard.mjs', import.meta.url).href;
const preflightResponseFields = Object.freeze([
  "C07",
  "C13",
  "C14",
  "actualChecks",
  "actualFacts",
  "authentication",
  "bindingContradictions",
  "calendarCompatibility",
  "caseReadiness",
  "classification",
  "command",
  "consumptionAttempts",
  "current",
  "currentSha256",
  "dispatchAllowed",
  "effectAuthority",
  "filesystemInput",
  "historyUpdates",
  "meaning",
  "networkAccess",
  "operationalDecisions",
  "operations",
  "persistence",
  "predecessor",
  "predecessorScope",
  "predecessorSha256",
  "preflightSha256",
  "production",
  "profileAdmission",
  "promotionAllowed",
  "qualification",
  "schema",
  "status"
]);

// Fixed post-build OFFLINE test inputs only. No data, caller, fixture metadata
// or environment value can select a program, preload, resource bound or exit.
export function verifyAgentDataCommands() {
  const fixture = JSON.parse(readFileSync(new URL('agent-data-response-fixtures.json', import.meta.url), 'utf8'));
  assert.equal(fixture.schema, 'gelt.test.agent-data-command-responses.v1');
  assert.equal(fixture.sourceReviewedHead, 'fd283ffd003a214e438e3f13bd276d1f12b234a5');
  assert.equal(fixture.sourceMergedCommit, '99119c5bca7e6756ed9d50095d23259b526b2b18');
  assert.equal(fixture.cases.length, 9);
  const seen = new Set();
  for (const row of fixture.cases) {
    assert.deepEqual(Object.keys(row).sort(), ['entry', 'mode', 'response']);
    assert.ok(entries.includes(row.entry) && modes.includes(row.mode));
    const key = row.entry + '/' + row.mode;
    assert.ok(!seen.has(key)); seen.add(key);
  }
  const baseline = (entry, mode) => {
    const rows = fixture.cases.filter(row => row.entry === entry && row.mode === mode);
    assert.equal(rows.length, 1); return rows[0].response;
  };
  const results = [];
  function run(entry, label, args, input, expectedExit) {
    assert.ok(entries.includes(entry));
    const result = spawnSync(process.execPath, ['--import', guard, join(root, 'worker', 'dist', entry), ...args], {
      cwd: root, env: childEnvironment(), input, timeout: 15000, maxBuffer: 8192, windowsHide: true,
    });
    assert.equal(result.error, undefined, label + ': child transport failed');
    assert.equal(result.signal, null, label + ': child interrupted');
    assert.equal(result.status, expectedExit, label + ': wrong actual exit');
    assert.equal(result.stderr.length, 0, label + ': stderr must be quiet');
    assert.ok(result.stdout.length > 0 && result.stdout.length <= 8192, label + ': output bound');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout);
    assert.ok(!text.includes(sentinel), label + ': input reflection');
    const value = JSON.parse(text);
    assert.equal(text, canonical(value) + '\n', label + ': one complete canonical response');
    assert.equal(value.effectAuthority, 'none');
    assert.equal(value.dispatchAllowed, false); assert.equal(value.promotionAllowed, false);
    assert.equal(value.qualification, 'NOT_READY'); assert.equal(value.production, 'CLOSED');
    assert.equal(value.operations, 'DEFER');
    for (const id of ['C07', 'C13', 'C14']) assert.equal(value[id], 'UNKNOWN');
    if (entry === 'prospective-declaration-cli.js' && label !== 'capability') {
      assert.equal(value.schema, 'gelt.agent.a64-prospective-declaration-response.v1');
      assert.equal(value.command, 'preflight_a64_prospective_declaration');
      assert.equal(value.classification, 'unadmitted_prospective_declaration_only');
      assert.equal(value.authentication, 'not_established'); assert.equal(value.profileAdmission, 'not_established');
      assert.equal(value.calendarCompatibility, 'unknown'); assert.equal(value.caseReadiness, 'NOT_READY');
      assert.equal(value.networkAccess, false); assert.equal(value.filesystemInput, false);
      assert.ok(['preflight_data', 'rejected_declarations', 'rejected_input'].includes(value.status));
      if (value.status === 'rejected_input') {
        assert.deepEqual(Object.keys(value).sort(), Object.keys(baseline(entry, 'invalid_input')).sort());
      } else {
        assert.deepEqual(Object.keys(value).sort(), preflightResponseFields);
        const { preflightSha256, ...body } = value;
        assert.equal(preflightSha256, createHash('sha256').update(canonical({
          domain: 'gelt.agent.a64-prospective-declaration.v1/preflight', value: body,
        })).digest('hex'));
      }
      assert.equal(value.actualChecks.length, 16);
      assert.deepEqual(value.actualChecks, baseline(entry, 'invalid_input').actualChecks);
      assert.ok(value.actualChecks.every(check => check.result === 'unknown'));
      assert.deepEqual(Object.keys(value.actualFacts).sort(), Object.keys(baseline(entry, 'invalid_input').actualFacts).sort());
      assert.ok(Object.values(value.actualFacts).every(v => v === 'unknown'));
      assert.equal(value.historyUpdates, 0); assert.equal(value.operationalDecisions, 0);
      assert.equal(value.consumptionAttempts, 0); assert.equal(value.persistence, 'not_performed');
    }
    results.push({ entry, label, exit: result.status, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length });
    return value;
  }
  for (const entry of entries) {
    for (const mode of modes) {
      const args = mode === 'capability' ? ['--describe'] : mode === 'usage' ? ['--unsupported', sentinel] : [];
      const input = mode === 'invalid_input' ? Buffer.from(JSON.stringify({ secret: sentinel })) : Buffer.alloc(0);
      assert.deepEqual(run(entry, mode, args, input, exits[mode]), baseline(entry, mode));
    }
  }

  const initial = {
    schema: 'gelt.a64-prospective-profile-declaration.v1',
    purpose: 'engineering_evidence_chain_integrity_preparation_only',
    case: { id: 'GELT-PAMR-A64-EVIDENCE-001', revision: 'proposal-2' },
    proposedEpochId: sentinel, profileRevision: 'decl-1', profileDeclaredAt: '2019-12-01T00:00:00.000Z',
    historyProposal: a64InspectionHistory,
    window: { startSessionDate: '2020-01-01', endSessionDateExclusive: '2020-10-01',
      schedule: { knowledge: 'unknown' }, utcBoundaryMapping: { knowledge: 'unknown' } },
    timing: { declaredWindowCompletedAt: null, sourceReceivedAt: null, sourceCompletedAt: null,
      assertedCompleteInputAvailableAt: null, proposedDecisionAt: '2020-10-02T00:00:00.000Z',
      proposedEvaluationAt: '2020-10-03T00:00:00.000Z' },
    collectedInputSha256: null, revision: { kind: 'initial_declaration' },
  };
  const dataHash = value => createHash('sha256').update(canonical({
    domain: 'gelt.a64-prospective-profile-declaration.v1/data', value,
  })).digest('hex');
  const wrap = (current, previous = null) => Buffer.from(JSON.stringify({
    schema: 'gelt.agent.a64-prospective-declaration-input.v1', currentText: JSON.stringify(current),
    predecessorText: previous === null ? null : JSON.stringify(previous),
  }));
  const entry = 'prospective-declaration-cli.js';
  const positive = run(entry, 'complete-initial-declaration', [], wrap(initial), 0);
  assert.equal(positive.status, 'preflight_data'); assert.equal(positive.currentSha256, dataHash(initial));
  assert.deepEqual(positive.current.contradictions, []); assert.equal(positive.current.undeclared.length, 7);
  const revised = { ...initial, profileRevision: 'decl-2', revision: {
    kind: 'revised_declaration', predecessorSha256: dataHash(initial), changeObservedAt: null,
  } };
  const revision = run(entry, 'complete-immediate-revision', [], wrap(revised, initial), 0);
  assert.equal(revision.status, 'preflight_data'); assert.equal(revision.currentSha256, dataHash(revised));
  assert.equal(revision.predecessorSha256, dataHash(initial)); assert.deepEqual(revision.bindingContradictions, []);
  const forged = run(entry, 'changed-predecessor', [], wrap(revised, { ...initial, collectedInputSha256: 'f'.repeat(64) }), 2);
  assert.equal(forged.status, 'rejected_declarations'); assert.ok(forged.bindingContradictions.includes('predecessor_data_mismatch'));
  assert.equal(run(entry, 'invalid-UTF8', [], Buffer.from([0xc3, 0x28]), 2).reason, 'invalid_utf8');
  for (const old of entries.slice(0, 2)) {
    for (const [kind, input] of [['request', wrap(initial)], ['result', Buffer.from(canonical(positive))]]) {
      assert.deepEqual(run(old, 'new-identity-' + kind, [], input, 2), baseline(old, 'invalid_input'));
    }
  }
  assert.equal(results.length, 17);
  console.log('PASS compiled agent data conformance: 17 constructed-only child cases; operating holds retained');
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--offline-test-only']);
  verifyAgentDataCommands();
}
