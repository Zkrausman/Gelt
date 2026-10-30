import { describe, expect, it } from 'vitest';
import { a64InspectionHistory } from './pamr-a64-inspection-evidence-contract.js';
import { parseProspectiveDeclarationInput, prospectiveDeclarationInputSchemaId, prospectiveDeclarationLimits } from './prospective-declaration-contract.js';

function unknownDeclaration() {
  return {
    schema: 'gelt.a64-prospective-profile-declaration.v1',
    purpose: 'engineering_evidence_chain_integrity_preparation_only',
    case: { id: 'GELT-PAMR-A64-EVIDENCE-001', revision: 'proposal-2' },
    proposedEpochId: 'SYNTHETIC-NOT-AN-ADMISSION', profileRevision: 'declaration-1',
    profileDeclaredAt: '2020-01-01T00:00:00.000Z', historyProposal: a64InspectionHistory,
    window: { startSessionDate: '2020-01-01', endSessionDateExclusive: '2020-12-01',
      schedule: { knowledge: 'unknown' }, utcBoundaryMapping: { knowledge: 'unknown' } },
    timing: { declaredWindowCompletedAt: null, sourceReceivedAt: null, sourceCompletedAt: null,
      assertedCompleteInputAvailableAt: null, proposedDecisionAt: '2020-12-02T00:00:00.000Z',
      proposedEvaluationAt: '2020-12-03T00:00:00.000Z' },
    collectedInputSha256: null, revision: { kind: 'initial_declaration' },
  };
}
const wrap = (currentText: string, predecessorText: string | null = null) => JSON.stringify({
  schema: prospectiveDeclarationInputSchemaId, currentText, predecessorText,
});

describe('finite complete prospective declaration contexts', () => {
  it('accepts explicit unknown slots as declarations, not evidence or a source profile', () => {
    const declaration = unknownDeclaration();
    expect(parseProspectiveDeclarationInput(wrap(JSON.stringify(declaration))))
      .toEqual({ current: declaration, predecessor: null });
  });

  it('rejects legacy identities, favorable claims, unknown fields and executable configuration', () => {
    const source = unknownDeclaration();
    const invalid = [
      { ...source, schema: 'gelt.spy253-pamr-inert-inspection.v1' },
      { ...source, schema: 'gelt.pamr-consumer-input.v1' },
      { ...source, purpose: 'prospective_admission' },
      { ...source, case: { ...source.case, revision: 'accepted' } },
      { ...source, qualification: 'READY' }, { ...source, facts: { handling: 'pass' } },
      { ...source, window: { ...source.window, schedule: { knowledge: 'qualified', sessions: [] } } },
      { ...source, window: { ...source.window, utcBoundaryMapping: {
        knowledge: 'declared_only', startAt: '2020-01-01T00:00:00.000Z', endAtExclusive: '2020-12-01T00:00:00.000Z',
      } } },
      { ...source, handler: 'private-module' }, { ...source, file: '/SYNTHETIC-private' },
      { ...source, historyProposal: { ...source.historyProposal, historyUpdates: 252 } },
    ];
    for (const value of invalid) expect(() => parseProspectiveDeclarationInput(wrap(JSON.stringify(value)))).toThrow();
    expect(() => parseProspectiveDeclarationInput(JSON.stringify({ schema: prospectiveDeclarationInputSchemaId,
      currentText: JSON.stringify(source), predecessorText: null, action: 'execute' }))).toThrow();
    expect(() => parseProspectiveDeclarationInput({ currentText: source })).toThrow();
  });

  it('retains strict normalized dates, timestamps, hash/id ends and duplicate-key checks', () => {
    const source = unknownDeclaration();
    for (const day of ['2020-02-30', '2020-01-01\n', '2020-1-01', '1969-12-31']) {
      expect(() => parseProspectiveDeclarationInput(wrap(JSON.stringify({ ...source,
        window: { ...source.window, startSessionDate: day } })))).toThrow();
    }
    for (const profileDeclaredAt of ['2020-02-30T00:00:00.000Z', '2020-01-01T00:00:00.000+00:00',
      '2020-01-01T00:00:00.000Z\n']) {
      expect(() => parseProspectiveDeclarationInput(wrap(JSON.stringify({ ...source, profileDeclaredAt })))).toThrow();
    }
    expect(() => parseProspectiveDeclarationInput(wrap(JSON.stringify({ ...source, profileRevision: 'revision\n' })))).toThrow();
    expect(() => parseProspectiveDeclarationInput(wrap(JSON.stringify({ ...source, collectedInputSha256: 'a'.repeat(64) + '\n' })))).toThrow();
    const text = JSON.stringify(source);
    expect(() => parseProspectiveDeclarationInput(wrap('{"schema":"ignored",' + text.slice(1)))).toThrow();
    expect(() => parseProspectiveDeclarationInput('{"schema":"ignored",' + wrap(text).slice(1))).toThrow();
  });

  it('checks actual UTF-8 bytes of both contexts and aggregate, with no lossy UTF-16 conversion', () => {
    const text = JSON.stringify(unknownDeclaration());
    const padded = text + ' '.repeat(prospectiveDeclarationLimits.declaration - Buffer.byteLength(text));
    expect(parseProspectiveDeclarationInput(wrap(padded)).current).toEqual(unknownDeclaration());
    expect(() => parseProspectiveDeclarationInput(wrap(padded + ' '))).toThrow();
    expect(() => parseProspectiveDeclarationInput(wrap(text, padded + ' '))).toThrow();
    const outer = wrap(padded, padded);
    expect(parseProspectiveDeclarationInput(outer + ' '.repeat(prospectiveDeclarationLimits.input - Buffer.byteLength(outer))).predecessor)
      .toEqual(unknownDeclaration());
    expect(() => parseProspectiveDeclarationInput(outer + ' '.repeat(prospectiveDeclarationLimits.input + 1 - Buffer.byteLength(outer)))).toThrow();
    expect(() => parseProspectiveDeclarationInput(wrap(text + String.fromCharCode(0xd800)))).toThrow();
    expect(() => parseProspectiveDeclarationInput(wrap(text) + String.fromCharCode(0xdc00))).toThrow();
    expect(() => parseProspectiveDeclarationInput(wrap('['.repeat(18) + '0' + ']'.repeat(18)))).toThrow();
  });
});
