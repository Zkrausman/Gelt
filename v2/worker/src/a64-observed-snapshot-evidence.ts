import { z } from 'zod';
import { canonical } from './ledger-canonical.js';
import { verifyObservedAcquisitionData } from './alpaca-iex-connector.js';
import { exactSpy253CloseRatio, replayObservedSnapshotMath } from './pamr-reference-artifact.js';
import { observedAcquisitionSchema, observedBindingSchema, observedCaseEpoch, observedClaims, observedContextSchema, observedFreeze, observedHash, observedLimits, observedOrdered, parseObservedText, ObservedSnapshotError, type ObservedAcquisition, type ObservedBinding } from './alpaca-observed-snapshot-contract.js';
export function observedArtifactForData(original: ObservedAcquisition, owner: ObservedBinding) {
    // This is pure reconstruction, not original-object issuance or reservation.
    if (!verifyObservedAcquisitionData(original) || owner.caseEpochSha256 !== observedCaseEpoch(original.profile)) {
        throw new ObservedSnapshotError('invalid_source');
    }
    parseObservedText(canonical(original), observedLimits.input);
    const selected = original.observations.slice(0, 65).map((o, sourceIndex) => ({ sourceIndex,
        sessionOrdinal: 253 - sourceIndex, ...o })).reverse();
    let rows: [
        string,
        '1'
    ][];
    try {
        rows = selected.slice(1).map((later, i) => [exactSpy253CloseRatio(later.close, selected[i].close), '1']);
    }
    catch {
        throw new ObservedSnapshotError('unrepresentable_math');
    }
    return replayObservedSnapshotMath(canonical({ schema: 'gelt.spy253-observed-math-request.v2',
        classification: 'source_inspection_only', originalBundleSha256: observedHash('original-bundle', original),
        caseEpochSha256: owner.caseEpochSha256, selectedSha256: observedHash('selected65', selected),
        assets: ['SPY-CLOSE-RELATIVE', 'DECLARED-UNIT-RESERVE'], rows }));
}
const envelope = z.object({ schema: z.literal('gelt.a64-observed-evidence-input.v2'), binding: observedBindingSchema,
    original: observedAcquisitionSchema, artifact: z.unknown(), context: observedContextSchema }).strict();
function assess(text: unknown) {
    const input = envelope.parse(parseObservedText(text, observedLimits.input));
    const { binding, original, context } = input;
    const artifact = observedArtifactForData(original, binding);
    parseObservedText(canonical(input.artifact), observedLimits.artifact);
    parseObservedText(canonical(context), observedLimits.context);
    if (canonical(artifact) !== canonical(input.artifact) || canonical(binding) !== canonical(context.binding)
        || context.profileSha256 !== original.profile.profileSha256
        || context.originalBundleSha256 !== observedHash('original-bundle', original)
        || !observedOrdered(original.timing.collectionEnd, context.inspectionStart, context.inspectionEnd, context.assessmentAt)) {
        throw new ObservedSnapshotError('invalid_input');
    }
    const body = { schema: 'gelt.pamr-a64-observed-evidence-assessment.v2', binding,
        inputSha256: observedHash('complete-input', input), profileSha256: original.profile.profileSha256,
        originalBundleSha256: context.originalBundleSha256, artifactSha256: artifact.artifactSha256,
        contextSha256: observedHash('context', context), historyUpdates: 64,
        sourceReconstruction: 'complete_retained_bundle', provenance: 'serialized_declarations_not_private_issuance',
        ...observedClaims } as const;
    const value = { ...body, assessmentSha256: observedHash('assessment', body) };
    parseObservedText(canonical(value), observedLimits.assessment);
    return observedFreeze(value);
}
export type ObservedAssessment = ReturnType<typeof assess>;
export function assessObservedEvidence(text: unknown) {
    try {
        return observedFreeze({ status: 'assessed_data' as const, value: assess(text) });
    }
    catch (e) {
        return Object.freeze({ status: 'rejected' as const,
            reason: e instanceof ObservedSnapshotError ? e.reason : 'invalid_input' as const });
    }
}
