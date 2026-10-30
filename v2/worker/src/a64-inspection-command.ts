import { canonical } from './ledger-canonical.js';
import { assessA64InspectionEvidence } from './pamr-a64-inspection-evidence.js';
import { a64InspectionEvidenceLimits, a64InspectionEvidenceHolds } from './pamr-a64-inspection-evidence-contract.js';

import { boundedDataTransportLimits as a64InspectionTransportLimits } from './bounded-data-stdio.js';
export { a64InspectionTransportLimits };

// Agent-readable discovery for this one data-only command, not an action registry.
export const a64InspectionCommand = Object.freeze({
  schema: 'gelt.agent.a64-inspection-capability.v1',
  command: 'assess_a64_inspection_evidence',
  inputSchema: 'gelt.pamr-a64-inspection-evidence-input.v1',
  inputEncoding: 'one_complete_utf8_json_document',
  inputBytes: a64InspectionEvidenceLimits.input,
  artifactBytes: a64InspectionEvidenceLimits.artifact,
  contextBytes: a64InspectionEvidenceLimits.context,
  outputBytes: a64InspectionEvidenceLimits.assessment,
  transport: a64InspectionTransportLimits,
  outputMeaning: 'data_consistency_only_not_authenticity_or_admission',
  filesystemAccess: false,
  networkAccess: false,
  persistenceEffects: false,
  ...a64InspectionEvidenceHolds,
});

export type A64CommandFailure = 'usage_error' | 'input_transport_failed'
  | 'input_timeout' | 'resource_limit' | 'invalid_utf8';
export type A64CommandOutput = Readonly<{ exitCode: 0 | 2 | 64; text: string }>;

const common = Object.freeze({
  schema: 'gelt.agent.a64-inspection-response.v1',
  command: a64InspectionCommand.command,
  effectAuthority: 'none',
  dispatchAllowed: false,
  promotionAllowed: false,
  qualification: 'NOT_READY',
  production: 'CLOSED',
  operations: 'DEFER',
  C07: 'UNKNOWN',
  C13: 'UNKNOWN',
  C14: 'UNKNOWN',
});

export function rejectA64Command(reason: A64CommandFailure): A64CommandOutput {
  return Object.freeze({
    exitCode: reason === 'usage_error' ? 64 : 2,
    text: canonical({ ...common, status: 'rejected', reason }) + '\n',
  });
}

// Recompute the complete supplied input with the existing assessor. There is no
// caller verifier, detached assessment acceptance, clock or operational object.
export function executeA64InspectionCommand(text: unknown): A64CommandOutput {
  const result = assessA64InspectionEvidence(text);
  const output = canonical({ ...common, ...result }) + '\n';
  // The transport envelope and newline count toward the same 8192-byte budget.
  if (Buffer.byteLength(output, 'utf8') > a64InspectionCommand.outputBytes) {
    return rejectA64Command('resource_limit');
  }
  return Object.freeze({ exitCode: result.status === 'assessed_data' ? 0 : 2, text: output });
}
