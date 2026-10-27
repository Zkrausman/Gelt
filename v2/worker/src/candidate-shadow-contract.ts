import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { shadowRuleId, shadowRuleInputSchema, type ShadowRuleInput } from './shadow-rule-contract.js';
import { simulationDigest, type SimulationRun } from './synthetic-simulation-economics.js';

export const candidateShadowArtifact = Object.freeze({
  schema: 'gelt.candidate-shadow-artifact.v1',
  ruleId: shadowRuleId, evaluator: 'evaluateShadowRule',
  ruleSource: 'v2/worker/src/shadow-rule.ts@e26e6338f4d7a28a77efd485b0c00f81a268ff99f7c47cf9cedbc779b73f721c',
  contractSource: 'v2/worker/src/shadow-rule-contract.ts@ca6d8cfc2659b1d9fa56e689d804df0d5e0c393070549730225930d74f517e70',
  referenceSource: 'docs/specs/G05-Shadow-First-Rules-Core.md@1b418763795873abdb0a3f09807aace5a2f6280341261638c9756727cf84271a',
  fidelity: 'inspected_g05_sign_return_only', conversion: 'not_established',
});
const artifactSchema = z.object({
  schema: z.literal(candidateShadowArtifact.schema), ruleId: z.literal(shadowRuleId),
  evaluator: z.literal(candidateShadowArtifact.evaluator),
  ruleSource: z.literal(candidateShadowArtifact.ruleSource),
  contractSource: z.literal(candidateShadowArtifact.contractSource),
  referenceSource: z.literal(candidateShadowArtifact.referenceSource),
  fidelity: z.literal(candidateShadowArtifact.fidelity), conversion: z.literal(candidateShadowArtifact.conversion),
}).strict();
const ruleBindingSchema = shadowRuleInputSchema.pick({
  instrument: true, data: true, policy: true, costs: true, controls: true,
}).strict();
export const candidateShadowManifestSchema = z.object({
  schema: z.literal('gelt.candidate-shadow-manifest.v1'), version: z.literal(1),
  classification: z.literal('constructed_offline_test'), effectScope: z.literal('SIMULATED_ONLY'),
  runId: z.string().uuid(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  configSha256: z.string().regex(/^[a-f0-9]{64}$/),
  artifact: artifactSchema, ruleBinding: ruleBindingSchema,
}).strict().refine(m => m.ruleBinding.data.classification === 'constructed_offline_test'
  && m.ruleBinding.instrument.id === 'SYNTH-RH-USD' && m.ruleBinding.instrument.currency === 'USD');
export type CandidateShadowManifest = z.infer<typeof candidateShadowManifestSchema>;
export const candidateShadowIdSchema = z.string().regex(/^candidate-shadow-[a-f0-9]{64}$/);

export function parseCandidateShadowJSON(text: unknown, kind: 'manifest' | 'input' | 'observation'): unknown {
  const limit = kind === 'manifest' ? 8192 : kind === 'observation' ? 2048 : 262144;
  if (typeof text !== 'string' || text.length > limit) throw new Error('candidate shadow unavailable');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > limit) throw new Error('candidate shadow unavailable');
  return parseResearchJSON(bytes);
}
export function parseCandidateShadowManifest(text: unknown): CandidateShadowManifest {
  return candidateShadowManifestSchema.parse(parseCandidateShadowJSON(text, 'manifest'));
}
export function candidateShadowId(manifest: CandidateShadowManifest): string {
  return `candidate-shadow-${digest(canonical({ domain: 'gelt.candidate-shadow-identity.v1', manifest: candidateShadowManifestSchema.parse(manifest) }))}`;
}
export function assertCandidateShadowBinding(raw: CandidateShadowManifest, input: ShadowRuleInput,
  config?: SimulationRun): void {
  const m = candidateShadowManifestSchema.parse(raw), i = shadowRuleInputSchema.parse(input);
  if (i.runId !== m.runId || i.sourceCommit !== m.sourceCommit
    || canonical(ruleBindingSchema.strip().parse(i)) !== canonical(m.ruleBinding)
    || config && (config.classification !== 'constructed_offline_test' || config.runId !== m.runId
      || config.sourceCommit !== m.sourceCommit || simulationDigest(config) !== m.configSha256)) throw new Error('candidate shadow unavailable');
}

export function candidateShadowOperatingAdmission() {
  if (arguments.length !== 0) throw new Error('candidate shadow unavailable');
  return Object.freeze({
    schema: 'gelt.candidate-shadow-operating-admission.v1',
    production: 'CLOSED', operations: 'DEFER',
    acquisitionAllowed: false, dispatchAllowed: false,
    operationalCandidate: 'unavailable',
    acceptedPlan: Object.freeze({
      symbol: 'SPY', feed: 'IEX', currency: 'USD', adjustment: 'all', timeframe: '1Day',
      start: '2025-10-24T04:00:00.000Z', end: '2026-10-27T04:00:00.000Z',
      asof: '2026-10-27', checkpoint: '2026-10-28T13:00:00.000Z',
      scheduleSha256: '05974c8aa8ffbf448b746ee04ae1d24c83505b8b9bcf476b691577a8abba512d',
      evidence: 'declared_plan_not_actual_input',
    }),
    unknown: Object.freeze([
      'actual_input_and_window', 'provider_completion', 'closure_and_revisions',
      'atomic_pagination_and_adjustment_vintage', 'calendar_and_close_compatibility',
      'availability_and_account_rights', 'runtime_qualification', 'reviewer_admission',
      'handling_and_copies', 'cancellation_and_whole_job_settlement',
      'cost_calibration', 'risk_and_effect_admission', 'research_conversion_and_qualification',
    ]),
    C07_CLOSURE_REVISIONS: 'UNKNOWN', C13_REVIEWER_ADMISSION: 'UNKNOWN', C14_HANDLING: 'UNKNOWN',
    execution: 'unknown', disposal: 'not_established', effectAuthority: 'none', promotionAllowed: false, retryAllowed: false,
  });
}
