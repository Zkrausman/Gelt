import { canonical, digest } from './ledger-canonical.js';
import { convertPAMR, verifyPAMRArtifact } from './pamr-reference-artifact.js';
import { pamrRecipe, pamrRequestSchema } from './paper-conversion-contract.js';
import { checkObservation, decimal, simulationDigest, units, type Decimal } from './synthetic-simulation-economics.js';
import { calculateLongCashSizing } from './long-cash-sizing-kernel.js';
import { pamrConsumerPolicyId, pamrConsumerLimits, pamrConsumerDisclosure, pamrConsumerInputSchema, pamrConsumerDecisionSchema, pamrConsumerProposalSchema, pamrConsumerActionSchema, parsePAMRConsumerText, PAMRConsumerBoundaryError, type PAMRConsumerInput, type PAMRConsumerDecision, type PAMRConsumerProposal, type PAMRConsumerRejection, type PAMRConsumerResult } from './pamr-consumer-contract.js';
const hash = (domain: string, value: unknown) => digest(canonical({ domain, value }));
export const pamrConsumerPolicySha256 = hash('gelt.pamr-consumer.policy.v1', { policyId: pamrConsumerPolicyId, assets: ['SYNTH-RISK', 'SYNTH-RESERVE'], reserveRelative: '1', exposure: 'floor18(first_weight/4)', feeInclusiveOrderCapUSD: '10', overweight: 'abstain_without_trim', consumption: 'deferred_to_owner' });
function fail(reason: PAMRConsumerRejection): never { throw new PAMRConsumerBoundaryError(reason); }
function rejected(error: unknown): { status: 'rejected'; reason: PAMRConsumerRejection } { return { status: 'rejected', reason: error instanceof PAMRConsumerBoundaryError ? error.reason : 'invalid_input' }; }
function artifactData(text: unknown) {
  const raw = parsePAMRConsumerText(text, 'artifact');
  if (!raw || typeof raw !== 'object' || !('input' in raw)) fail('artifact_mismatch');
  const input = pamrRequestSchema.parse(raw.input);
  if (input.assets.length !== 2 || input.assets[0] !== 'SYNTH-RISK' || input.assets[1] !== 'SYNTH-RESERVE') fail('unsupported_profile');
  if (input.rows.some(row => row[1] !== '1')) fail('unsupported_profile');
  const verified = verifyPAMRArtifact(text);
  if (verified.status !== 'verified_data') fail('artifact_mismatch');
  const a = verified.artifact;
  if (Buffer.byteLength(canonical(a), 'utf8') > pamrConsumerLimits.artifact) fail('resource_limit');
  let previous: string | null = null;
  if (input.rows.length > 1) {
    const prior = convertPAMR(canonical({ ...input, rows: input.rows.slice(0, -1) }));
    if (prior.status !== 'computed') fail('resource_limit');
    previous = hash('gelt.pamr-consumer.prefix.v1', prior.artifact);
  }
  return { artifact: a, prefix: {
    artifactSha256: hash('gelt.pamr-consumer.artifact.v1', a), recipeSha256: hash('gelt.pamr-consumer.recipe.v1', pamrRecipe),
    prefixSha256: hash('gelt.pamr-consumer.prefix.v1', a), ordinal: input.rows.length,
    expectedPreviousPrefixSha256: previous,
  } };
}
export function derivePAMRConsumerPrefix(text: unknown) {
  try { return Object.freeze(artifactData(text).prefix); } catch { throw new Error('PAMR consumer prefix unavailable'); }
}
export function quarterFloorPAMRWeight(weight: unknown): Decimal {
  if (typeof weight !== 'string') fail('invalid_input');
  if (weight.length > 2469) fail('resource_limit');
  if (!/^(0|[1-9][0-9]*)\/[1-9][0-9]*$/.test(weight)) fail('invalid_input');
  const [numerator, denominator] = weight.split('/');
  if (numerator.length > 1234 || denominator.length > 1234) fail('resource_limit');
  const n = BigInt(numerator), d = BigInt(denominator);
  const bits = (v: bigint) => v.toString(2).length;
  if (bits(n) > 4096 || bits(d) > 4096) fail('resource_limit');
  if (n > d) fail('invalid_input');
  const scale = 10n ** 18n;
  if (n !== 0n && bits(n) + bits(scale) > 4096) fail('resource_limit');
  return decimal(n * scale / d / 4n, 18);
}
function bound(v: PAMRConsumerInput, prefix: ReturnType<typeof derivePAMRConsumerPrefix>): void {
  const c = v.config, s = v.portfolio.snapshot;
  const expected = {
    ...prefix, runId: c.runId, sourceCommit: c.sourceCommit,
    configSha256: simulationDigest(c), policySha256: pamrConsumerPolicySha256, portfolioSnapshotSha256: simulationDigest(s),
    costsSha256: hash('gelt.pamr-consumer.costs.v1', c.costs), observationSha256: hash('gelt.pamr-consumer.observation.v1', v.observation),
    clockSha256: hash('gelt.pamr-consumer.clock.v1', { decisionAt: v.decisionAt, prefixAvailableAt: v.prefixAvailableAt, evaluationAt: v.evaluationAt }),
  };
  if (canonical(v.binding) !== canonical(expected)) fail('binding_mismatch');
  if (c.classification !== 'constructed_offline_test' || s.classification !== c.classification || s.runId !== c.runId
    || s.instrumentId !== c.instrumentId || s.currency !== c.currency
    || s.configSha256 !== simulationDigest(c) || s.genesisSha256 !== simulationDigest(c.genesis)) fail('binding_mismatch');
  if (s.revision === 0 && (units(s.cash, 8) !== units(c.genesis.cash, 8) || units(s.quantity, 18) !== units(c.genesis.quantity, 18)
    || s.historySha256 !== simulationDigest([]))) fail('binding_mismatch');
}
function compute(text: unknown) {
  const input = pamrConsumerInputSchema.parse(parsePAMRConsumerText(text, 'input'));
  const { artifact, prefix } = artifactData(input.artifactText);
  bound(input, prefix);
  const target = quarterFloorPAMRWeight(artifact.weightsFinal[0]);
  let decision: PAMRConsumerDecision['decision'] = units(target, 18) === 0n ? 'target_cash' : 'target_long';
  let reason: PAMRConsumerDecision['reason'] = 'mapped_target';
  if (input.lifecycleDisposition === 'unknown' || input.inputPortfolioUnknown) { decision = 'abstain'; reason = 'lifecycle_unknown'; }
  else if (input.portfolio.state !== 'settled') { decision = 'abstain'; reason = 'unsettled_portfolio'; }
  else {
    try {
      const times = [input.decisionAt, input.prefixAvailableAt, input.evaluationAt, input.observation.observedAt, input.observation.availableAt, input.config.validThrough].map(Date.parse);
      if (times.some(t => !Number.isSafeInteger(t) || t < 0)
        || Date.parse(input.prefixAvailableAt) >= Date.parse(input.decisionAt)) throw new Error();
      checkObservation(input.config, input.decisionAt, input.observation, Date.parse(input.evaluationAt));
    } catch { decision = 'abstain'; reason = 'invalid_clock'; }
  }
  const body = {
    schema: 'gelt.pamr-consumer-decision.v1' as const, policyId: pamrConsumerPolicyId,
    inputSha256: hash('gelt.pamr-consumer.input.v1', input), binding: input.binding,
    decisionAt: input.decisionAt, prefixAvailableAt: input.prefixAvailableAt, evaluationAt: input.evaluationAt,
    riskyWeight: artifact.weightsFinal[0], targetExposure: decision === 'abstain' ? null : target,
    decision, reason, ...pamrConsumerDisclosure,
  };
  const result = pamrConsumerDecisionSchema.parse({ ...body, decisionId: `pamr-consumer-decision-${hash('gelt.pamr-consumer.decision.v1', body)}` });
  if (Buffer.byteLength(canonical(result), 'utf8') > pamrConsumerLimits.decision) fail('resource_limit');
  return { input, decision: result };
}
export function evaluatePAMRConsumer(text: unknown): PAMRConsumerResult<PAMRConsumerDecision> {
  try { return { status: 'computed', value: compute(text).decision }; } catch (error) { return rejected(error); }
}
export function proposePAMRConsumer(text: unknown): PAMRConsumerResult<PAMRConsumerProposal> {
  try {
    const { input, decision } = compute(text);
    const action = decision.decision === 'abstain'
      ? { outcome: 'abstain', reason: 'decision_abstain', attainment: 'not_applicable', side: null, quantity: null, hypothetical: null }
      : calculateLongCashSizing({
        config: input.config, portfolio: input.portfolio, lifecycleDisposition: input.lifecycleDisposition,
        inputPortfolioUnknown: input.inputPortfolioUnknown, decision: decision.decision, decisionAt: decision.decisionAt,
        targetExposure: decision.targetExposure, observation: input.observation,
        quantityQuantum: input.quantityQuantum, buyLimitPrice: input.buyLimitPrice, sellLimitPrice: input.sellLimitPrice,
        evaluationAt: input.evaluationAt,
      });
    const body = {
      schema: 'gelt.pamr-consumer-proposal.v1' as const, policyId: pamrConsumerPolicyId,
      decision, action: pamrConsumerActionSchema.parse(action), ...pamrConsumerDisclosure,
    };
    const proposal = pamrConsumerProposalSchema.parse({ ...body, proposalId: `pamr-consumer-proposal-${hash('gelt.pamr-consumer.proposal.v1', body)}` });
    if (Buffer.byteLength(canonical(proposal), 'utf8') > pamrConsumerLimits.proposal) fail('resource_limit');
    return { status: 'computed', value: proposal };
  } catch (error) { return rejected(error); }
}
export function matchesPAMRConsumerDecision(inputText: unknown, decisionText: unknown): boolean {
  try {
    const actual = pamrConsumerDecisionSchema.parse(parsePAMRConsumerText(decisionText, 'decision'));
    const expected = evaluatePAMRConsumer(inputText);
    return expected.status === 'computed' && canonical(expected.value) === canonical(actual);
  } catch { return false; }
}
export function matchesPAMRConsumerProposal(inputText: unknown, proposalText: unknown): boolean {
  try {
    const actual = pamrConsumerProposalSchema.parse(parsePAMRConsumerText(proposalText, 'proposal'));
    const expected = proposePAMRConsumer(inputText);
    return expected.status === 'computed' && canonical(expected.value) === canonical(actual);
  } catch { return false; }
}
