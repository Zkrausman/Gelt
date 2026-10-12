// ZAR-240 partial contract plus separately provisioned SQLite adapter.
// Neither the adapter nor this interface has a production caller or startup wiring.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './ledger-canonical.js';
import { opaque } from './connection-contract.js';
import { companionTermsSchema, type CompanionTerms } from './synthetic-companion.js';

export const MAX_DURABLE_COMPANION_SESSIONS = 64;
export const COMPANION_QUOTE_SOURCE = 'synthetic-companion-quote-v1' as const;
export const COMPANION_FEE_SOURCE = 'synthetic-companion-fee-v1' as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const sourceAssociationSchema = z.object({
  quote: z.literal(COMPANION_QUOTE_SOURCE),
  fee: z.literal(COMPANION_FEE_SOURCE),
}).strict();
export const syntheticCompanionIntentSchema = z.object({
  version: z.literal('v1'),
  sessionDigest: digestSchema,
  identityDigest: digestSchema,
  termsDigest: digestSchema,
  sourceAssociation: sourceAssociationSchema,
  sourceDigest: digestSchema,
  binding: digestSchema,
  sessionExpiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, ctx) => {
  const sourceDigest = sha256(canonical(value.sourceAssociation));
  const binding = sha256(canonical({
    version: value.version, sessionDigest: value.sessionDigest, identityDigest: value.identityDigest,
    termsDigest: value.termsDigest, sourceDigest: value.sourceDigest, sessionExpiresAt: value.sessionExpiresAt,
  }));
  if (sourceDigest !== value.sourceDigest) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'source association mismatch' });
  if (binding !== value.binding) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'intent binding mismatch' });
});
export type SyntheticCompanionIntent = z.infer<typeof syntheticCompanionIntentSchema>;

export interface SyntheticCompanionIntentInput {
  ownerSession: string;
  identityId: string;
  terms: CompanionTerms;
  sessionExpiresAt: number;
}

export type IntentWriteOutcome = 'committed' | 'duplicate' | 'capacity' | 'unknown';

/**
 * Contract implemented by the separate private SQLite adapter, not an
 * in-memory fallback. The adapter remains unwired from preview/startup.
 * reserve must atomically enforce one record/tombstone per sessionDigest and
 * the 64-unexpired-session capacity, persist before returning committed, and
 * return unknown (without retry) for uncertain commits. Commit consumes the
 * one-use opportunity before any source evaluation; a later source failure
 * cannot make that session eligible again. Revoke only an existing committed
 * row, derive its expiry from that persisted row (never caller input), and
 * retain its tombstone through that original expiry. Missing/uncertain rows
 * return unknown without inventing a short-lived tombstone; the future caller
 * must fail closed on owner-session loss until a trusted provisioning boundary
 * can establish the original expiry. Never evict an unexpired row for capacity.
 */
export interface SyntheticCompanionIntentJournal {
  reserve(intent: SyntheticCompanionIntent): IntentWriteOutcome;
  revoke(sessionDigest: string): IntentWriteOutcome;
}

export function companionSessionDigest(ownerSession: string): string {
  const session = opaque.parse(ownerSession);
  return sha256(canonical(['synthetic-companion-owner-session-v1', session]));
}

/**
 * Builds a commitment to supplied identity/terms and expected synthetic source
 * labels, NOT an attestation of issued credentials or actual quote/fee facts.
 * A future caller must authenticate the live owner session, issued identity,
 * bounded expiry and returned source facts before wiring this into preview.
 * The owner session and identity are stored only as digests; exact decimal
 * terms are canonicalized, never converted to floating point.
 */
export function describeSyntheticCompanionIntent(input: SyntheticCompanionIntentInput): SyntheticCompanionIntent {
  const sessionDigest = companionSessionDigest(input.ownerSession);
  const identityId = z.string().regex(/^[a-f0-9]{32}$/).parse(input.identityId);
  const terms = companionTermsSchema.parse(input.terms);
  const sessionExpiresAt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(input.sessionExpiresAt);
  const identityDigest = sha256(canonical(['synthetic-companion-identity-v1', identityId]));
  const termsDigest = sha256(canonical(terms));
  const sourceAssociation = sourceAssociationSchema.parse({ quote: COMPANION_QUOTE_SOURCE, fee: COMPANION_FEE_SOURCE });
  const sourceDigest = sha256(canonical(sourceAssociation));
  const binding = sha256(canonical({
    version: 'v1', sessionDigest, identityDigest, termsDigest, sourceDigest, sessionExpiresAt,
  }));
  return syntheticCompanionIntentSchema.parse({
    version: 'v1', sessionDigest, identityDigest, termsDigest,
    sourceAssociation, sourceDigest, binding, sessionExpiresAt,
  });
}

/**
 * Calls the injected journal exactly once. Only an acknowledged commit can be
 * treated as reserved; missing, duplicate, capacity and ambiguous outcomes all
 * fail closed. In particular, unknown is never retried here.
 */
export function reserveSyntheticCompanionIntent(
  journal: SyntheticCompanionIntentJournal | undefined,
  input: SyntheticCompanionIntentInput,
): SyntheticCompanionIntent {
  if (!journal) throw new Error('synthetic intent storage unavailable');
  const intent = describeSyntheticCompanionIntent(input);
  let outcome: IntentWriteOutcome;
  try { outcome = journal.reserve(intent); } catch { throw new Error('synthetic intent outcome unknown'); }
  if (outcome !== 'committed') throw new Error('synthetic intent unavailable');
  return intent;
}

/** Revocation is a durable tombstone operation; it never deletes a reservation. */
export function revokeSyntheticCompanionIntent(
  journal: SyntheticCompanionIntentJournal | undefined,
  ownerSession: string,
): void {
  if (!journal) throw new Error('synthetic intent storage unavailable');
  const sessionDigest = companionSessionDigest(ownerSession);
  let outcome: IntentWriteOutcome;
  try { outcome = journal.revoke(sessionDigest); } catch { throw new Error('synthetic intent outcome unknown'); }
  if (outcome !== 'committed') throw new Error('synthetic intent unavailable');
}
