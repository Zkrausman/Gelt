import { z } from 'zod';
import { canonical } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { proposePAMRConsumer, matchesPAMRConsumerProposal } from './pamr-consumer-adapter.js';
import { pamrConsumerLimits, pamrConsumerPolicyId } from './pamr-consumer-contract.js';
import { boundedDataTransportLimits, type DataCommandOutput, type DataTransportFailure } from './bounded-data-stdio.js';

export const pamrProposalCommand = Object.freeze({
  schema: 'gelt.agent.constructed-pamr-capability.v1',
  command: 'constructed_pamr_proposal_data',
  requestSchema: 'gelt.agent.constructed-pamr-request.v1',
  dataOperations: Object.freeze(['propose', 'verify'] as const),
  consumerSchema: 'gelt.pamr-consumer-input.v1',
  policyId: pamrConsumerPolicyId,
  inputBytes: pamrConsumerLimits.input,
  artifactBytes: pamrConsumerLimits.artifact,
  proposalBytes: pamrConsumerLimits.proposal,
  outputBytes: pamrConsumerLimits.proposal,
  transport: boundedDataTransportLimits,
  classification: 'constructed_offline_test',
  meaning: 'hypothetical_data_consistency_not_account_risk_or_execution_approval',
  effectAuthority: 'none',
  dispatchAllowed: false,
  promotionAllowed: false,
  consumption: 'not_performed',
  authenticity: 'not_established',
  qualification: 'NOT_READY',
  production: 'CLOSED',
  operations: 'DEFER',
  C07: 'UNKNOWN', C13: 'UNKNOWN', C14: 'UNKNOWN',
});

const request = z.discriminatedUnion('operation', [
  z.object({ schema: z.literal(pamrProposalCommand.requestSchema), operation: z.literal('propose'), inputText: z.string() }).strict(),
  z.object({ schema: z.literal(pamrProposalCommand.requestSchema), operation: z.literal('verify'), inputText: z.string(), proposalText: z.string() }).strict(),
]);
const common = Object.freeze({
  schema: 'gelt.agent.constructed-pamr-response.v1',
  command: pamrProposalCommand.command,
  classification: 'constructed_offline_test',
  effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false,
  consumption: 'not_performed', authenticity: 'not_established',
  qualification: 'NOT_READY', production: 'CLOSED', operations: 'DEFER',
  C07: 'UNKNOWN', C13: 'UNKNOWN', C14: 'UNKNOWN',
});
type Reason = DataTransportFailure | 'invalid_input' | 'unsupported_profile' | 'artifact_mismatch'
  | 'binding_mismatch' | 'proposal_mismatch';
class BoundaryError extends Error { constructor(readonly reason: Reason) { super('PAMR proposal data unavailable'); } }

function text(raw: unknown, limit: number): string {
  if (typeof raw !== 'string') throw new BoundaryError('invalid_input');
  if (raw.length > limit) throw new BoundaryError('resource_limit');
  for (const char of raw) {
    const n = char.codePointAt(0)!;
    if (n >= 0xd800 && n <= 0xdfff) throw new BoundaryError('invalid_input');
  }
  if (Buffer.byteLength(raw, 'utf8') > limit) throw new BoundaryError('resource_limit');
  return raw;
}

export function rejectPAMRProposalCommand(reason: Reason): DataCommandOutput {
  return Object.freeze({ exitCode: reason === 'usage_error' ? 64 : 2, text: canonical({ ...common, status: 'rejected', reason }) + '\n' });
}

// Fixed, pure data operations only. No callback, authority object, clock, store,
// dependency loader, filename or effect is accepted from the request.
export function executePAMRProposalCommand(raw: unknown): DataCommandOutput {
  try {
    const input = request.parse(parseResearchJSON(Buffer.from(text(raw, pamrProposalCommand.inputBytes), 'utf8')));
    const inputText = text(input.inputText, pamrConsumerLimits.input);
    if (input.operation === 'verify') text(input.proposalText, pamrConsumerLimits.proposal);
    const computed = proposePAMRConsumer(inputText);
    if (computed.status === 'rejected') return rejectPAMRProposalCommand(computed.reason);
    if (input.operation === 'verify' && !matchesPAMRConsumerProposal(inputText, input.proposalText)) {
      return rejectPAMRProposalCommand('proposal_mismatch');
    }
    const body = input.operation === 'propose'
      ? { ...common, status: 'proposal_data', value: computed.value }
      : { ...common, status: 'verified_proposal_data', proposalId: computed.value.proposalId, inputSha256: computed.value.decision.inputSha256, outcome: computed.value.action.outcome };
    const output = canonical(body) + '\n';
    if (Buffer.byteLength(output, 'utf8') > pamrProposalCommand.outputBytes) return rejectPAMRProposalCommand('resource_limit');
    return Object.freeze({ exitCode: 0, text: output });
  } catch (error) {
    return rejectPAMRProposalCommand(error instanceof BoundaryError ? error.reason : 'invalid_input');
  }
}
