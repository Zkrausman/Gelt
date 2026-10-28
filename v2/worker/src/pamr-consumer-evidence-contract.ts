// Constructed consumption-attempt data only. No execution or owner capability.
import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { decimalSchema } from './ledger-contract.js';
import {
  simulationHash, simulationTimestamp, decimal, units,
} from './synthetic-simulation-economics.js';
import {
  pamrConsumerPolicyId, pamrConsumerDisclosure, pamrConsumerBindingSchema,
} from './pamr-consumer-contract.js';
import { pamrConsumerPolicySha256 } from './pamr-consumer-adapter.js';

export const pamrConsumptionBounds = Object.freeze({
  inputBytes: 262144,
  proposalBytes: 8192,
  manifestBytes: 8192,
  policyBytes: 8192,
  totalBytes: 8388608,
  records: 64,
});
export const pamrConsumptionDisclosure = Object.freeze({
  recordState: 'constructed_attempt_only',
  effectAuthority: 'none',
  authenticity: 'not_established',
  ownerIdentity: 'not_established',
  fills: 'not_performed',
} as const);

export const pamrConfiguredOwnerPolicySha256Schema =
  simulationHash.brand<'PAMRConfiguredOwnerPolicySha256'>();
export type PAMRConfiguredOwnerPolicySha256 =
  z.infer<typeof pamrConfiguredOwnerPolicySha256Schema>;

export const pamrPurePolicyDefinitionSha256Schema =
  z.literal(pamrConsumerPolicySha256).brand<'PAMRPurePolicyDefinitionSha256'>();
export type PAMRPurePolicyDefinitionSha256 =
  z.infer<typeof pamrPurePolicyDefinitionSha256Schema>;

const positiveQuantity = decimalSchema.refine(d => {
  try {
    return units(d, 18) > 0n && !!decimal(units(d, 18), 18);
  } catch { return false; }
});
const timestamp = simulationTimestamp.refine(s =>
  Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);

const boundsSchema = z.object({
  inputBytes: z.literal(pamrConsumptionBounds.inputBytes),
  proposalBytes: z.literal(pamrConsumptionBounds.proposalBytes),
  manifestBytes: z.literal(pamrConsumptionBounds.manifestBytes),
  policyBytes: z.literal(pamrConsumptionBounds.policyBytes),
  totalBytes: z.literal(pamrConsumptionBounds.totalBytes),
  records: z.literal(pamrConsumptionBounds.records),
}).strict();

export const pamrConsumptionOwnerPolicySchema = z.object({
  schema: z.literal('gelt.pamr-consumption-owner-policy.v1'),
  version: z.literal(1),
  classification: z.literal('constructed_offline_test'),
  runId: z.string().uuid(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  configSha256: simulationHash,
  consumerPolicyId: z.literal(pamrConsumerPolicyId),
  purePolicyDefinitionSha256: pamrPurePolicyDefinitionSha256Schema,
  adaptation: z.literal(pamrConsumerDisclosure.adaptation),
  quantityQuantum: positiveQuantity,
  buyLimitPrice: positiveQuantity,
  sellLimitPrice: positiveQuantity,
  feeInclusiveOrderCapUSD: z.literal('10'),
  bounds: boundsSchema,
}).strict();
export type PAMRConsumptionOwnerPolicy =
  z.infer<typeof pamrConsumptionOwnerPolicySchema>;

const disclosureShape = {
  recordState: z.literal(pamrConsumptionDisclosure.recordState),
  effectAuthority: z.literal(pamrConsumptionDisclosure.effectAuthority),
  authenticity: z.literal(pamrConsumptionDisclosure.authenticity),
  ownerIdentity: z.literal(pamrConsumptionDisclosure.ownerIdentity),
  fills: z.literal(pamrConsumptionDisclosure.fills),
};

export const pamrConsumptionManifestSchema = z.object({
  schema: z.literal('gelt.pamr-consumption-manifest.v1'),
  version: z.literal(1),
  classification: z.literal('constructed_offline_test'),
  consumerPolicyId: z.literal(pamrConsumerPolicyId),
  configuredOwnerPolicySha256: pamrConfiguredOwnerPolicySha256Schema,
  purePolicyDefinitionSha256: pamrPurePolicyDefinitionSha256Schema,
  binding: pamrConsumerBindingSchema,
  previousManifestSha256: simulationHash.nullable(),
  decisionId: z.string().regex(/^pamr-consumer-decision-[a-f0-9]{64}$/),
  proposalId: z.string().regex(/^pamr-consumer-proposal-[a-f0-9]{64}$/),
  decisionAt: timestamp,
  prefixAvailableAt: timestamp,
  evaluationAt: timestamp,
  inputSha256: simulationHash,
  proposalSha256: simulationHash,
  inputBytes: z.number().int().positive().max(pamrConsumptionBounds.inputBytes),
  proposalBytes: z.number().int().positive().max(pamrConsumptionBounds.proposalBytes),
  ...disclosureShape,
}).strict();
export type PAMRConsumptionManifest =
  z.infer<typeof pamrConsumptionManifestSchema>;

export const pamrConsumptionEvidenceLinkSchema = z.object({
  schema: z.literal('gelt.pamr-consumption-evidence-link.v1'),
  version: z.literal(1),
  classification: z.literal('constructed_offline_test'),
  consumerPolicyId: z.literal(pamrConsumerPolicyId),
  configuredOwnerPolicySha256: pamrConfiguredOwnerPolicySha256Schema,
  purePolicyDefinitionSha256: pamrPurePolicyDefinitionSha256Schema,
  ordinal: z.number().int().min(1).max(pamrConsumptionBounds.records),
  prefixSha256: simulationHash,
  proposalId: z.string().regex(/^pamr-consumer-proposal-[a-f0-9]{64}$/),
  inputSha256: simulationHash,
  proposalSha256: simulationHash,
  evidenceManifestSha256: simulationHash,
  ...disclosureShape,
}).strict();
export type PAMRConsumptionEvidenceLink =
  z.infer<typeof pamrConsumptionEvidenceLinkSchema>;

export type PAMRConsumptionRejection =
  | 'invalid_input'
  | 'binding_mismatch'
  | 'invalid_clock'
  | 'lineage_mismatch'
  | 'already_consumed'
  | 'resource_limit'
  | 'readonly';

export function configuredPAMROwnerPolicySha256(
  policy: PAMRConsumptionOwnerPolicy,
): PAMRConfiguredOwnerPolicySha256 {
  const value = pamrConsumptionOwnerPolicySchema.parse(policy);
  return pamrConfiguredOwnerPolicySha256Schema.parse(digest(canonical({
    domain: 'gelt.pamr-consumer.configured-owner-policy.v1',
    value,
  })));
}

export function pamrConsumptionManifestSha256(
  manifest: PAMRConsumptionManifest,
): string {
  return digest(canonical({
    domain: 'gelt.pamr-consumer.consumption-manifest.v1',
    value: pamrConsumptionManifestSchema.parse(manifest),
  }));
}

export function pamrConsumptionLink(
  manifest: PAMRConsumptionManifest,
): PAMRConsumptionEvidenceLink {
  return pamrConsumptionEvidenceLinkSchema.parse({
    schema: 'gelt.pamr-consumption-evidence-link.v1',
    version: 1,
    classification: 'constructed_offline_test',
    consumerPolicyId: manifest.consumerPolicyId,
    configuredOwnerPolicySha256: manifest.configuredOwnerPolicySha256,
    purePolicyDefinitionSha256: manifest.purePolicyDefinitionSha256,
    ordinal: manifest.binding.ordinal,
    prefixSha256: manifest.binding.prefixSha256,
    proposalId: manifest.proposalId,
    inputSha256: manifest.inputSha256,
    proposalSha256: manifest.proposalSha256,
    evidenceManifestSha256: pamrConsumptionManifestSha256(manifest),
    ...pamrConsumptionDisclosure,
  });
}
