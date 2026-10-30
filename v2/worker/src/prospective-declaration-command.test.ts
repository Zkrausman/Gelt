import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonical } from './ledger-canonical.js';
import { a64InspectionHistory } from './pamr-a64-inspection-evidence-contract.js';
import { executeProspectiveDeclarationCommand, prospectiveDeclarationCommand } from './prospective-declaration-command.js';
import { prospectiveDeclarationInputSchemaId } from './prospective-declaration-contract.js';
import { runProspectiveDeclarationCLI } from './prospective-declaration-cli.js';

// Explicitly constructed day labels, including weekends: no actual market
// calendar, provider data, future dates or admissible profile is represented.
function declared() {
  return {
    schema: 'gelt.a64-prospective-profile-declaration.v1',
    purpose: 'engineering_evidence_chain_integrity_preparation_only',
    case: { id: 'GELT-PAMR-A64-EVIDENCE-001', revision: 'proposal-2' },
    proposedEpochId: 'SYNTHETIC-DECLARATION', profileRevision: 'declaration-1',
    profileDeclaredAt: '2019-12-01T00:00:00.000Z', historyProposal: a64InspectionHistory,
    window: { startSessionDate: '2020-01-01', endSessionDateExclusive: '2020-10-01',
      utcBoundaryMapping: { knowledge: 'declared_only', firstSessionStartsAt: '2020-01-01T00:00:00.000Z', lastSessionCompletesAt: '2020-10-01T00:00:00.000Z' },
      schedule: { knowledge: 'declared_only', calendarSha256: 'a'.repeat(64),
        sessions: Array.from({ length: 253 }, (_, i) => new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10)) } },
    timing: { declaredWindowCompletedAt: '2020-10-01T00:00:00.000Z',
      sourceReceivedAt: '2020-10-01T01:00:00.000Z', sourceCompletedAt: '2020-10-01T02:00:00.000Z',
      assertedCompleteInputAvailableAt: '2020-10-01T03:00:00.000Z',
      proposedDecisionAt: '2020-10-02T00:00:00.000Z', proposedEvaluationAt: '2020-10-03T00:00:00.000Z' },
    collectedInputSha256: 'b'.repeat(64), revision: { kind: 'initial_declaration' },
  };
}
const wrap = (current: unknown, previous: unknown = null) => JSON.stringify({
  schema: prospectiveDeclarationInputSchemaId, currentText: JSON.stringify(current),
  predecessorText: previous === null ? null : JSON.stringify(previous),
});
const read = (current: unknown, previous: unknown = null) => {
  const result = executeProspectiveDeclarationCommand(wrap(current, previous));
  return { ...result, data: JSON.parse(result.text) };
};
function sink() {
  const chunks: Buffer[] = [];
  return { output: new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }),
    text: () => Buffer.concat(chunks).toString('utf8') };
}
afterEach(() => { vi.useRealTimers(); });

describe('agent-facing declared identity/window/revision preflight', () => {
  it('runs a complete declaration through actual finite stdin and preserves every unqualified boundary', async () => {
    const value = declared(), result = read(value), output = sink();
    expect(result.exitCode).toBe(0);
    expect(result.data.status).toBe('preflight_data');
    expect(result.data.current).toEqual({ contradictions: [], undeclared: [] });
    expect(result.data.predecessor).toBeNull();
    expect(result.data.actualChecks).toHaveLength(16);
    expect(result.data.actualChecks.every((v: { result: string }) => v.result === 'unknown')).toBe(true);
    expect(Object.values(result.data.actualFacts).every(v => v === 'unknown')).toBe(true);
    expect(result.data).toMatchObject({ effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false,
      qualification: 'NOT_READY', caseReadiness: 'NOT_READY', production: 'CLOSED', operations: 'DEFER',
      historyUpdates: 0, operationalDecisions: 0, consumptionAttempts: 0,
      C07: 'UNKNOWN', C13: 'UNKNOWN', C14: 'UNKNOWN' });
    expect(result.data.currentSha256).toBe(createHash('sha256').update(canonical({
      domain: 'gelt.a64-prospective-profile-declaration.v1/data', value,
    })).digest('hex'));
    const raw = wrap(value);
    expect(await runProspectiveDeclarationCLI([], Readable.from([Buffer.from(raw.slice(0, 19)), Buffer.from(raw.slice(19))]), output.output)).toBe(0);
    expect(output.text()).toBe(result.text);
    expect(read(value).text).toBe(result.text);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(8192);
    expect(result.text).not.toContain('SYNTHETIC-DECLARATION');
  });

  it('makes incomplete declarations explicit without upgrading asserted hashes or old dates into actual evidence', () => {
    const value = declared();
    const result = read({ ...value, collectedInputSha256: null,
      window: { ...value.window, schedule: { knowledge: 'unknown' }, utcBoundaryMapping: { knowledge: 'unknown' } },
      timing: { ...value.timing, declaredWindowCompletedAt: null, sourceReceivedAt: null,
        sourceCompletedAt: null, assertedCompleteInputAvailableAt: null } });
    expect(result.exitCode).toBe(0);
    expect(result.data.current.undeclared).toEqual(['session_schedule_undeclared', 'window_utc_mapping_undeclared', 'window_completion_undeclared',
      'source_receipt_undeclared', 'source_completion_undeclared', 'complete_input_availability_undeclared', 'collected_input_digest_undeclared']);
    expect(result.data.qualification).toBe('NOT_READY');
    expect(result.data.actualFacts.calendarCompletion).toBe('unknown');
    expect(result.data.actualFacts.prospectiveProfileAdmission).toBe('unknown');
  });

  it('retains independent simultaneous timing and session contradictions instead of first-failure suppression', () => {
    const value = declared();
    value.profileDeclaredAt = value.timing.proposedDecisionAt;
    value.window.schedule.sessions[1] = value.window.schedule.sessions[0];
    value.window.schedule.sessions[3] = '2019-12-31';
    value.timing.assertedCompleteInputAvailableAt = value.timing.proposedDecisionAt;
    value.timing.proposedEvaluationAt = '2020-10-01T00:00:00.000Z';
    const result = read(value);
    expect(result.exitCode).toBe(2);
    expect(result.data.status).toBe('rejected_declarations');
    expect(result.data.current.contradictions).toEqual(expect.arrayContaining(['profile_not_declared_before_decision',
      'session_outside_declared_window', 'duplicate_session_label', 'session_labels_not_ordered',
      'decision_after_evaluation', 'availability_not_before_decision']));
    expect(result.data.actualFacts.handling).toBe('unknown');
  });

  it.each(['sourceReceivedAt', 'sourceCompletedAt', 'assertedCompleteInputAvailableAt', 'declaredWindowCompletedAt'] as const)(
    'rejects the strict decision equality for %s even when other declarations are unknown', key => {
      const value = declared();
      const timing = { ...value.timing, sourceReceivedAt: null, sourceCompletedAt: null,
        assertedCompleteInputAvailableAt: null, declaredWindowCompletedAt: null,
        [key]: value.timing.proposedDecisionAt };
      expect(read({ ...value, timing }).exitCode).toBe(2);
    });

  it('accepts decision/evaluation equality only as declared consistency and detects earlier availability contradictions', () => {
    const value = declared();
    value.timing.proposedEvaluationAt = value.timing.proposedDecisionAt;
    expect(read(value).exitCode).toBe(0);
    value.timing.assertedCompleteInputAvailableAt = '2020-10-01T00:00:00.000Z';
    expect(read(value).data.current.contradictions).toEqual(expect.arrayContaining(['availability_before_receipt', 'availability_before_completion']));
  });

  it('does not derive UTC bounds from date labels and checks all supplied UTC assertions independently', () => {
    const value = declared();
    value.window.utcBoundaryMapping.firstSessionStartsAt = '2020-10-03T00:00:00.000Z';
    value.window.utcBoundaryMapping.lastSessionCompletesAt = value.timing.proposedDecisionAt;
    const result = read(value);
    expect(result.exitCode).toBe(2);
    expect(result.data.current.contradictions).toEqual(expect.arrayContaining(['declared_session_utc_bounds_not_increasing',
      'declared_last_session_not_before_decision', 'completion_before_declared_last_session_completion',
      'source_completion_before_declared_last_session_completion', 'receipt_before_declared_last_session_completion', 'availability_before_declared_last_session_completion']));
    const missing = read({ ...declared(), window: { ...declared().window, utcBoundaryMapping: { knowledge: 'unknown' } } });
    expect(missing.exitCode).toBe(0);
    expect(missing.data.current.undeclared).toContain('window_utc_mapping_undeclared');
    expect(missing.data.calendarCompatibility).toBe('unknown');
  });

  it('does not hide a declared causal contradiction when neighboring receipt/completion slots are unknown', () => {
    const value = declared();
    const earlyAvailability = read({ ...value, window: { ...value.window, utcBoundaryMapping: { knowledge: 'unknown' } },
      timing: { ...value.timing, sourceReceivedAt: null, sourceCompletedAt: null,
        assertedCompleteInputAvailableAt: '2020-09-30T23:00:00.000Z' } });
    expect(earlyAvailability.exitCode).toBe(2);
    expect(earlyAvailability.data.current.contradictions).toContain('availability_before_window_completion');
    const earlyCompletion = read({ ...value, timing: { ...value.timing, declaredWindowCompletedAt: null,
      sourceReceivedAt: null, assertedCompleteInputAvailableAt: null,
      sourceCompletedAt: '2020-09-30T23:00:00.000Z' } });
    expect(earlyCompletion.exitCode).toBe(2);
    expect(earlyCompletion.data.current.contradictions).toContain('source_completion_before_declared_last_session_completion');
  });

  it('recomputes the entire immediate predecessor and rejects detached, cross-epoch, reused or moving bindings', () => {
    const previous = declared(), priorHash = read(previous).data.currentSha256;
    const value = { ...declared(), profileRevision: 'declaration-2',
      revision: { kind: 'revised_declaration', predecessorSha256: priorHash,
        changeObservedAt: '2020-10-01T05:00:00.000Z' } };
    const correct = read(value, previous);
    expect(correct.exitCode).toBe(0);
    expect(correct.data.predecessorSha256).toBe(priorHash);
    expect(correct.data.predecessorScope).toBe('immediate_supplied_initial_declaration_only_actual_history_unverified');
    expect(correct.data.currentSha256).not.toBe(priorHash);
    expect(read(value).data.bindingContradictions).toContain('missing_complete_predecessor');
    expect(read(previous, previous).data.bindingContradictions).toContain('unexpected_predecessor');
    expect(read(value, { ...previous, collectedInputSha256: 'd'.repeat(64) }).data.bindingContradictions).toContain('predecessor_data_mismatch');
    expect(read({ ...value, proposedEpochId: 'another-proposed-epoch' }, previous).data.bindingContradictions).toContain('revision_crosses_proposed_epoch');
    expect(read({ ...value, profileRevision: previous.profileRevision }, previous).data.bindingContradictions).toContain('profile_revision_reused');
    expect(read({ ...value, profileDeclaredAt: '2019-11-01T00:00:00.000Z' }, previous).data.bindingContradictions).toContain('revision_declaration_moves_backwards');
    expect(read({ ...value, window: { ...value.window, endSessionDateExclusive: '2020-10-02' } }, previous).data.bindingContradictions).toContain('revision_changes_frozen_window_or_decision');
    expect(read({ ...value, timing: { ...value.timing, proposedDecisionAt: '2020-10-02T01:00:00.000Z' } }, previous).data.bindingContradictions).toContain('revision_changes_frozen_window_or_decision');
  });

  it('retains adverse predecessor and late revision declarations as well as link mismatch', () => {
    const previous = declared(); previous.timing.assertedCompleteInputAvailableAt = previous.timing.proposedDecisionAt;
    const value = { ...declared(), profileRevision: 'declaration-2', revision: {
      kind: 'revised_declaration', predecessorSha256: 'e'.repeat(64), changeObservedAt: previous.timing.proposedDecisionAt } };
    const result = read(value, previous);
    expect(result.exitCode).toBe(2);
    expect(result.data.current.contradictions).toContain('revision_observed_not_before_decision');
    expect(result.data.predecessor.contradictions).toContain('availability_not_before_decision');
    expect(result.data.bindingContradictions).toContain('predecessor_data_mismatch');
    const unknownRevision = read({ ...value, revision: { ...value.revision,
      predecessorSha256: read(declared()).data.currentSha256, changeObservedAt: null } }, declared());
    expect(unknownRevision.exitCode).toBe(0);
    expect(unknownRevision.data.current.undeclared).toContain('revision_observation_undeclared');
    expect(unknownRevision.data.qualification).toBe('NOT_READY');
  });

  it('honestly rejects a third declaration instead of trusting an opaque earlier chain or resetting history', () => {
    const initial = declared();
    const middle = { ...declared(), profileRevision: 'declaration-2', revision: {
      kind: 'revised_declaration', predecessorSha256: read(initial).data.currentSha256,
      changeObservedAt: '2020-10-01T05:00:00.000Z' } };
    expect(read(middle, initial).exitCode).toBe(0);
    const latest = { ...middle, profileRevision: 'declaration-3', revision: {
      ...middle.revision, predecessorSha256: read(middle, initial).data.currentSha256 } };
    const result = read(latest, middle);
    expect(result.exitCode).toBe(2);
    expect(result.data.bindingContradictions).toContain('unsupported_predecessor_revision_history');
    expect(result.data.actualFacts.lifecycleState).toBe('unknown');
    expect(result.data.consumptionAttempts).toBe(0);
  });

  it('bounds strict parsing, capability/usage and invalid-byte failures without reflecting private text', async () => {
    const sentinel = 'SYNTHETIC_PRIVATE_SENTINEL', result = read({ ...declared(), secret: sentinel });
    expect(result.exitCode).toBe(2); expect(result.text).not.toContain(sentinel);
    const discovery = sink(), unused = new Readable({ read() { throw new Error('must not read'); } });
    expect(await runProspectiveDeclarationCLI(['--describe'], unused, discovery.output)).toBe(0);
    expect(JSON.parse(discovery.text())).toEqual(prospectiveDeclarationCommand);
    unused.destroy();
    const usage = sink();
    expect(await runProspectiveDeclarationCLI(['--output', sentinel], Readable.from([]), usage.output)).toBe(64);
    expect(usage.text()).not.toContain(sentinel);
    const invalid = sink();
    expect(await runProspectiveDeclarationCLI([], Readable.from([Buffer.from([0xc3, 0x28])]), invalid.output)).toBe(2);
    expect(JSON.parse(invalid.text()).reason).toBe('invalid_utf8');
    const large = sink();
    expect(await runProspectiveDeclarationCLI([], Readable.from([Buffer.alloc(262145)]), large.output)).toBe(2);
    expect(JSON.parse(large.text()).reason).toBe('resource_limit');
  });

  it('uses finite timeout and output failure handling rather than partial-success or exception reflection', async () => {
    vi.useFakeTimers();
    const output = sink(), input = new Readable({ read() {} });
    const waiting = runProspectiveDeclarationCLI([], input, output.output);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await waiting).toBe(2);
    expect(JSON.parse(output.text()).reason).toBe('input_timeout'); expect(input.destroyed).toBe(true);
    vi.useRealTimers();
    const broken = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('SYNTHETIC_PRIVATE_EXCEPTION')); } });
    expect(await runProspectiveDeclarationCLI([], Readable.from([Buffer.from(wrap(declared()))]), broken)).toBe(74);
  });
});
