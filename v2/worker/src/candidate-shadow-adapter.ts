import { canonical, digest } from './ledger-canonical.js';
import { projectionSchema, type Projection } from './ledger-contract.js';
import { shadowRuleInputSchema, shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { simulationObservationSchema } from './synthetic-simulation-economics.js';
import { joinSyntheticLifecycle, SyntheticLifecycleJoinCorruption } from './synthetic-lifecycle-join.js';
import { assertCandidateShadowBinding, candidateShadowId, candidateShadowOperatingAdmission,
  parseCandidateShadowJSON, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import type { SyntheticMockRobinhoodStore } from './synthetic-mock-robinhood-storage.js';

// Preserve the public constructor identity used by existing harnesses/tests.
export { SyntheticLifecycleJoinCorruption as CandidateShadowJoinCorruption };

// Primitive JSON strings are bounded before decoding. No artifact code, caller
// receipt, callback or candidate hash selects the evaluator.
export function evaluateCandidateShadowDecision(manifestText: unknown, inputText: unknown, observationText: unknown) {
  try {
    const manifest = parseCandidateShadowManifest(manifestText);
    const input = shadowRuleInputSchema.parse(parseCandidateShadowJSON(inputText, 'input'));
    const observation = simulationObservationSchema.parse(parseCandidateShadowJSON(observationText, 'observation'));
    assertCandidateShadowBinding(manifest, input);
    const inputBytes = Buffer.from(canonical(input));
    if (inputBytes.length > shadowRuleMaxBytes) throw new Error();
    const receipt = evaluateShadowRule(inputBytes);
    if (receipt.inputValidation !== 'valid') throw new Error();
    return { status: 'evaluated' as const, candidateId: candidateShadowId(manifest),
      context: { inputBytes, receipt, observation } };
  } catch {
    return { status: 'rejected' as const, reason: 'invalid_candidate_input' as const };
  }
}

// Called synchronously by the existing protected fixture history operation.
// Each owner replays its own evidence. This is not a cross-database transaction
// or an authenticator for market provenance, hostile same-process code or runtime.
export function readCandidateShadowResult(store: SyntheticMockRobinhoodStore, rawProjection: Projection,
  ownerUnresolved: boolean, ownerUnknown: boolean) {
  try {
    const projection = projectionSchema.parse(rawProjection);
    const x = store.readCandidateShadow(projection.intent.intentId);
    if (!x) return { state: 'unavailable' as const };
    const { preview, order, input, proposal, portfolio } = x;
    const { fills, observed, dispatchUnknown, disposition } =
      joinSyntheticLifecycle(projection, preview, order, x.termsHash, portfolio, ownerUnresolved, ownerUnknown);
    const candidateId = candidateShadowId(x.candidate);
    if (preview.sizingEvidence?.candidateId !== candidateId) throw new Error();
    const view = {
      schema: 'gelt.candidate-shadow-result.v1' as const,
      classification: 'constructed_offline_test' as const, effectScope: 'SIMULATED_ONLY' as const,
      candidateId, artifact: { ruleId: x.candidate.artifact.ruleId,
        descriptorSha256: digest(canonical(x.candidate.artifact)), fidelity: x.candidate.artifact.fidelity },
      runId: preview.runId, sourceCommit: preview.sourceCommit, configSha256: preview.configSha256,
      decision: { decisionId: input.ruleReceipt.decisionId, decisionAt: input.ruleReceipt.decisionAt,
        inputSha256: input.ruleReceipt.inputSha256, receiptSha256: digest(canonical(input.ruleReceipt)),
        decision: input.ruleReceipt.decision, reason: input.ruleReceipt.reason },
      sizing: { ...preview.sizingEvidence, outcome: proposal.outcome, attainment: proposal.attainment },
      requested: { side: preview.order.side, quantity: preview.order.quantity, limitPrice: preview.order.limitPrice },
      simulatedOrder: { dispatchId: order.dispatchId, previewId: order.previewId, status: order.status,
        cancelAcknowledged: order.cancelAcknowledged,
        executions: fills.map(e => ({ receiptId: e.receiptId, quantity: e.quantity, price: e.price,
          fee: e.fee, currency: e.currency, observedAt: e.observation.observedAt,
          availableAt: e.observation.availableAt, observationSha256: e.observation.evidenceSha256 })) },
      portfolio,
      lifecycle: { disposition, dispatchUnknown, observedExecutionCount: observed.length,
        factCount: projection.eventCount, factsSha256: digest(canonical(projection)) },
      evidence: 'existing_owner_transaction_replay' as const,
      consistency: 'matched_owner_reads_not_cross_store_transaction' as const,
      completion: 'unestablished' as const, provenance: 'not_authenticated' as const,
      marketEvaluation: 'not_established' as const, effectAuthority: 'none' as const,
      promotionAllowed: false as const, operatingAdmission: candidateShadowOperatingAdmission(),
    };
    if (Buffer.byteLength(JSON.stringify(view), 'utf8') > 32768) throw new Error();
    return { state: 'available' as const, view };
  } catch {
    throw new SyntheticLifecycleJoinCorruption();
  }
}
export type CandidateShadowResult = ReturnType<typeof readCandidateShadowResult>;
