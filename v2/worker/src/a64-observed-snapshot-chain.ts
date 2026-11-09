// Explicit offline library only: no application/CLI/default transport or clock.
import { alpacaCredentialPairSchema } from './alpaca-iex-contract.js';
import { acquireObservedSnapshot, observedClockReader, reserveObservedOriginal } from './alpaca-iex-connector.js';
import { canonical } from './ledger-canonical.js';
import { observedArtifactForData, assessObservedEvidence } from './a64-observed-snapshot-evidence.js';
import { A64ObservedSnapshotReceiptStore } from './a64-observed-snapshot-receipt.js';
import { observedBindingSchema, observedCaseEpoch, observedFreeze, observedHash, parseObservedProfile, ObservedSnapshotError, type ObservedClock, type ObservedReason } from './alpaca-observed-snapshot-contract.js';
export function createA64ObservedSnapshotChain(root: string, profileInput: unknown, bindingInput: unknown, credentialInput: unknown, options: Readonly<{
    fetcher: typeof fetch;
    clock: ObservedClock;
}>) {
    const profile = observedFreeze(parseObservedProfile(profileInput));
    let binding: ReturnType<typeof observedBindingSchema.parse>, credentials: ReturnType<typeof alpacaCredentialPairSchema.parse>;
    try {
        binding = observedBindingSchema.parse(bindingInput);
        credentials = alpacaCredentialPairSchema.parse(credentialInput);
    }
    catch {
        throw new ObservedSnapshotError('invalid_input');
    }
    if (binding.caseEpochSha256 !== observedCaseEpoch(profile) || typeof options.fetcher !== 'function'
        || typeof options.clock?.utcNow !== 'function' || typeof options.clock?.monotonicNow !== 'function')
        throw new ObservedSnapshotError('invalid_input');
    // Snapshot callback identities once, without pretending to sandbox their internals.
    const fetcher = options.fetcher, clock = Object.freeze({ utcNow: options.clock.utcNow.bind(options.clock),
        monotonicNow: options.clock.monotonicNow.bind(options.clock) });
    const store = A64ObservedSnapshotReceiptStore.create(root, binding);
    let attempted = false;
    return Object.freeze({
        async run() {
            if (attempted)
                throw new ObservedSnapshotError('already_attempted');
            attempted = true;
            let input: string;
            try {
                const original = await acquireObservedSnapshot(profile, credentials, { fetcher, clock });
                reserveObservedOriginal(original, profile);
                const stamp = observedClockReader(clock, original.timing.collectionEnd), inspectionStart = stamp();
                const artifact = observedArtifactForData(original, binding), inspectionEnd = stamp(), assessmentAt = stamp();
                input = canonical({ schema: 'gelt.a64-observed-evidence-input.v2', binding, original, artifact,
                    context: { schema: 'gelt.a64-observed-context.v2', binding, profileSha256: profile.profileSha256,
                        originalBundleSha256: observedHash('original-bundle', original), inspectionStart, inspectionEnd, assessmentAt,
                        timingMeaning: 'local_observation_unqualified_clock', serializedMeaning: 'declarations_not_issuance' } });
                const assessment = assessObservedEvidence(input);
                if (assessment.status !== 'assessed_data')
                    throw new ObservedSnapshotError(assessment.reason);
            }
            catch (e) {
                if (!(e instanceof ObservedSnapshotError) || !['invalid_source', 'invalid_input', 'resource_limit', 'unrepresentable_math'].includes(e.reason)) {
                    store.markUncertain();
                    throw new ObservedSnapshotError('uncertain');
                }
                // Known complete validation failure only. This is a reported negative,
                // not a complete source assessment and never a settlement declaration.
                const reason = e.reason as ObservedReason;
                const negative = canonical({ schema: 'gelt.a64-observed-rejection.v2', binding, profile, reason, reported: true });
                const receipt = store.retain(negative);
                store.close();
                return Object.freeze({ status: 'rejected' as const, receipt });
            }
            // Storage exceptions must never be relabeled as clean validation rejection.
            const receipt = store.retain(input);
            store.close();
            return Object.freeze({ status: 'retained' as const, receipt });
        },
    });
}
