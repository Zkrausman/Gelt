// Offline-only companion preview kernel. This module is deliberately not wired to
// the BFF, the Pi fixture, OrderLifecycle, a provider, or an order route.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './ledger-canonical.js';
import { opaque } from './connection-contract.js';
import { equalSecret } from './security.js';

export const COMPANION_IDENTITY_TTL_MS = 5 * 60_000;
export const COMPANION_REQUEST_TTL_MS = 30_000;
export const COMPANION_SOURCE_MAX_AGE_MS = 5_000;
export const MAX_COMPANION_IDENTITIES = 32;
export const MAX_COMPANION_NONCES = 256;

const accountRoutes = {
  'synthetic-companion-account-a': ['RHS'],
  'synthetic-companion-account-b': ['RHC'],
} as const;
const decimal = z.string().max(40).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/);
const resultDecimal = z.string().max(80).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,36})?$/);
const positiveDecimal = decimal.refine(value => /[1-9]/.test(value));
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const companionTermsSchema = z.object({
  account: z.enum(['synthetic-companion-account-a', 'synthetic-companion-account-b']),
  route: z.enum(['RHS', 'RHC']),
  instrument: z.literal('SYNTH-USD'),
  side: z.literal('BUY'),
  type: z.literal('LIMIT'),
  timeInForce: z.literal('DAY'),
  quantity: positiveDecimal,
  limitPrice: positiveDecimal,
  revision: z.number().int().min(0).max(1_000_000),
}).strict();
export type CompanionTerms = z.infer<typeof companionTermsSchema>;

export const companionRequestSchema = z.object({
  version: z.literal('v1'),
  operation: z.literal('synthetic-preview'),
  identityId: z.string().regex(/^[a-f0-9]{32}$/),
  nonce: opaque,
  issuedAt: epoch,
  expiresAt: epoch,
  terms: companionTermsSchema,
}).strict();
export type CompanionRequest = z.infer<typeof companionRequestSchema>;

export const companionIdentitySchema = z.object({
  version: z.literal('v1'),
  identityId: z.string().regex(/^[a-f0-9]{32}$/),
  credential: opaque,
  expiresAt: epoch,
}).strict();
export type CompanionIdentity = z.infer<typeof companionIdentitySchema>;

const quoteSchema = z.object({
  source: z.literal('synthetic-companion-quote-v1'),
  instrument: z.literal('SYNTH-USD'),
  currency: z.literal('USD'),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  price: positiveDecimal,
  observedAt: epoch,
  expiresAt: epoch,
}).strict();
const feeSchema = z.object({
  source: z.literal('synthetic-companion-fee-v1'),
  currency: z.literal('USD'),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  amount: decimal,
  observedAt: epoch,
  expiresAt: epoch,
}).strict();
export const companionPreviewSchema = z.object({
  version: z.literal('v1'),
  source: z.literal('synthetic-companion-preview-v1'),
  identityId: z.string().regex(/^[a-f0-9]{32}$/),
  nonce: opaque,
  expiresAt: epoch,
  terms: companionTermsSchema,
  quote: quoteSchema,
  fee: feeSchema,
  notional: resultDecimal,
  total: resultDecimal,
  currency: z.literal('USD'),
  synthetic: z.literal(true),
  authorizing: z.literal(false),
  brokerFacts: z.literal(false),
  execution: z.literal(false),
}).strict();
export type CompanionPreview = z.infer<typeof companionPreviewSchema>;

export const companionStatusSchema = z.object({
  version: z.literal('v1'),
  source: z.literal('synthetic-companion-channel-v1'),
  enabled: z.boolean(),
  activeIdentities: z.number().int().min(0).max(MAX_COMPANION_IDENTITIES),
  execution: z.literal(false),
  brokerPreview: z.literal(false),
  orderAuthority: z.literal(false),
}).strict();

export interface CompanionCaller {
  remoteAddress: string;
  session: string;
  identityId: string;
  credential: string;
}
export interface CompanionSources {
  // Binding covers the owner session and the complete simulated order terms.
  // A source must independently associate its fact with this value; simply
  // copying it from caller input does not establish external provenance.
  quote: (terms: CompanionTerms, now: number, binding: string) => unknown;
  fee: (terms: CompanionTerms, now: number, binding: string) => unknown;
}
export interface SyntheticCompanionOptions {
  enabled?: boolean;
  now?: () => number;
  sources?: CompanionSources;
}

interface IdentityState {
  session: string;
  credential: string;
  expiresAt: number;
  revisionFloor: number;
  // Ephemeral identity-local replay guards only; not a durable session-wide intent.
  nonces: Map<string, number>;
  requests: Map<string, number>;
}

function clockValue(now: number): number {
  if (!Number.isSafeInteger(now) || now < 1 || now > Number.MAX_SAFE_INTEGER - 3_600_000) throw new Error('clock unavailable');
  return now;
}
function parseDecimal(value: string): { coefficient: bigint; scale: number } {
  const [whole, fraction = ''] = value.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}
function formatDecimal(coefficient: bigint, scale: number): string {
  const value = coefficient.toString().padStart(scale + 1, '0');
  if (scale === 0) return value;
  const split = value.length - scale;
  return `${value.slice(0, split)}.${value.slice(split)}`;
}
function compareDecimals(left: string, right: string): number {
  const a = parseDecimal(left), b = parseDecimal(right), scale = Math.max(a.scale, b.scale);
  const x = a.coefficient * 10n ** BigInt(scale - a.scale);
  const y = b.coefficient * 10n ** BigInt(scale - b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}
function exactNotionalAndTotal(quantity: string, price: string, fee: string) {
  const q = parseDecimal(quantity), p = parseDecimal(price), f = parseDecimal(fee);
  const notionalCoefficient = q.coefficient * p.coefficient;
  const notionalScale = q.scale + p.scale;
  const scale = Math.max(notionalScale, f.scale);
  const total = notionalCoefficient * 10n ** BigInt(scale - notionalScale)
    + f.coefficient * 10n ** BigInt(scale - f.scale);
  if (total > 10n * 10n ** BigInt(scale)) throw new Error('synthetic preview exceeds fee-inclusive cap');
  return { notional: formatDecimal(notionalCoefficient, notionalScale), total: formatDecimal(total, scale) };
}
function loopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}
function sourceFresh(observedAt: number, expiresAt: number, now: number): boolean {
  return observedAt <= now && now - observedAt <= COMPANION_SOURCE_MAX_AGE_MS
    && expiresAt > now && expiresAt <= observedAt + COMPANION_REQUEST_TTL_MS;
}
/**
 * An ephemeral, separate synthetic channel primitive. It is inert unless the
 * caller explicitly enables it. No caller in the production worker currently
 * constructs or exposes it.
 */
export function createSyntheticCompanion(options: SyntheticCompanionOptions = {}) {
  const enabled = options.enabled === true;
  const now = options.now ?? Date.now;
  const sources = options.sources;
  const identities = new Map<string, IdentityState>();
  const revisionFloors = new Map<string, number>();
  const sessionExpiries = new Map<string, number>();
  const pruneExpired = (at: number) => {
    for (const [id, state] of identities) if (state.expiresAt <= at) identities.delete(id);
    for (const [session, expiresAt] of sessionExpiries) {
      if (expiresAt <= at) {
        sessionExpiries.delete(session);
        revisionFloors.delete(session);
        for (const [id, state] of identities) if (state.session === session) identities.delete(id);
      }
    }
  };

  const status = () => {
    if (enabled) pruneExpired(clockValue(now()));
    return companionStatusSchema.parse({
      version: 'v1', source: 'synthetic-companion-channel-v1', enabled,
      activeIdentities: identities.size, execution: false, brokerPreview: false, orderAuthority: false,
    });
  };

  // Internal provisioning returns the credential once. It is not a browser or
  // public HTTP operation; deployments must provide their own reviewed private
  // provisioning path before this primitive can be exposed.
  const provision = (session: string, sessionExpiresAt: number): CompanionIdentity => {
    if (!enabled) throw new Error('companion disabled');
    opaque.parse(session);
    const issuedAt = clockValue(now());
    pruneExpired(issuedAt);
    if (!Number.isSafeInteger(sessionExpiresAt) || sessionExpiresAt <= issuedAt || sessionExpiresAt > issuedAt + 3_600_000) throw new Error('session unavailable');
    if (identities.size >= MAX_COMPANION_IDENTITIES || (!sessionExpiries.has(session) && sessionExpiries.size >= MAX_COMPANION_IDENTITIES)) throw new Error('identity capacity exhausted');
    let identityId = '', credential = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidateId = randomBytes(16).toString('hex');
      const candidateCredential = randomBytes(32).toString('base64url');
      if (!identities.has(candidateId) && ![...identities.values()].some(value => equalSecret(candidateCredential, value.credential))) {
        identityId = candidateId; credential = candidateCredential; break;
      }
    }
    if (!identityId || !credential) throw new Error('identity unavailable');
    const expiresAt = Math.min(issuedAt + COMPANION_IDENTITY_TTL_MS, sessionExpiresAt);
    const floor = revisionFloors.get(session) ?? 0;
    identities.set(identityId, { session, credential, expiresAt, revisionFloor: floor, nonces: new Map(), requests: new Map() });
    revisionFloors.set(session, floor);
    sessionExpiries.set(session, Math.max(sessionExpiries.get(session) ?? 0, sessionExpiresAt));
    return companionIdentitySchema.parse({ version: 'v1', identityId, credential, expiresAt });
  };

  const invalidate = (session: string, revision: number) => {
    if (!enabled) throw new Error('companion disabled');
    opaque.parse(session);
    const at = clockValue(now());
    pruneExpired(at);
    if ((sessionExpiries.get(session) ?? 0) <= at) throw new Error('session unavailable');
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > 1_000_000) throw new Error('invalid revision');
    if (!revisionFloors.has(session) && revisionFloors.size >= MAX_COMPANION_IDENTITIES) throw new Error('session capacity exhausted');
    revisionFloors.set(session, Math.max(revisionFloors.get(session) ?? 0, revision));
    for (const state of identities.values()) {
      if (state.session === session) {
        state.revisionFloor = revisionFloors.get(session)!;
        // Keep identity-local duplicate history until identity expiry; an
        // invalidation never makes the same complete terms usable again.
      }
    }
    return status();
  };

  const revokeSession = (session: string) => {
    opaque.parse(session);
    for (const [id, state] of identities) if (state.session === session) identities.delete(id);
    revisionFloors.delete(session);
    sessionExpiries.delete(session);
    return status();
  };

  const preview = (input: unknown, caller: CompanionCaller): CompanionPreview => {
    if (!enabled) throw new Error('companion disabled');
    if (!caller || !loopback(caller.remoteAddress)) throw new Error('private loopback required');
    opaque.parse(caller.session);
    opaque.parse(caller.credential);
    const identityId = z.string().regex(/^[a-f0-9]{32}$/).parse(caller.identityId);
    const request = companionRequestSchema.parse(input);
    const at = clockValue(now());
    pruneExpired(at);
    const identity = identities.get(identityId);
    if (!identity || identity.expiresAt <= at || request.identityId !== identityId
      || identity.session !== caller.session || !equalSecret(caller.credential, identity.credential)) throw new Error('identity unavailable');
    if (request.issuedAt > at || request.expiresAt <= at || request.expiresAt <= request.issuedAt
      || request.expiresAt - request.issuedAt > COMPANION_REQUEST_TTL_MS
      || at - request.issuedAt > COMPANION_REQUEST_TTL_MS || request.expiresAt > identity.expiresAt) throw new Error('request expired');

    for (const [nonce, expiresAt] of identity.nonces) if (expiresAt <= at) identity.nonces.delete(nonce);
    for (const [key, expiresAt] of identity.requests) if (expiresAt <= at) identity.requests.delete(key);
    if (identity.nonces.has(request.nonce)) throw new Error('nonce replay');
    if (identity.nonces.size >= MAX_COMPANION_NONCES) throw new Error('nonce capacity exhausted');
    identity.nonces.set(request.nonce, identity.expiresAt);

    const terms = request.terms;
    const allowedRoutes: readonly string[] = accountRoutes[terms.account];
    if (!allowedRoutes.includes(terms.route) || terms.revision < identity.revisionFloor) throw new Error('terms unavailable');
    const requestKey = createHash('sha256').update(canonical({ session: caller.session, terms })).digest('hex');
    if (identity.requests.has(requestKey)) throw new Error('duplicate preview request');
    if (identity.requests.size >= MAX_COMPANION_NONCES) throw new Error('request capacity exhausted');
    identity.requests.set(requestKey, identity.expiresAt);

    if (!sources) throw new Error('synthetic source unavailable');
    const quote = quoteSchema.parse(sources.quote(terms, at, requestKey));
    const fee = feeSchema.parse(sources.fee(terms, at, requestKey));
    if (quote.instrument !== terms.instrument || quote.binding !== requestKey || fee.binding !== requestKey)
      throw new Error('synthetic source association unavailable');
    if (!sourceFresh(quote.observedAt, quote.expiresAt, at)
      || !sourceFresh(fee.observedAt, fee.expiresAt, at) || compareDecimals(quote.price, terms.limitPrice) > 0) throw new Error('synthetic source unavailable');
    const amounts = exactNotionalAndTotal(terms.quantity, terms.limitPrice, fee.amount);
    return companionPreviewSchema.parse({
      version: 'v1', source: 'synthetic-companion-preview-v1', identityId,
      nonce: request.nonce, expiresAt: Math.min(request.expiresAt, quote.expiresAt, fee.expiresAt),
      terms, quote, fee, ...amounts, currency: 'USD', synthetic: true,
      authorizing: false, brokerFacts: false, execution: false,
    });
  };

  return { status, provision, invalidate, revokeSession, preview };
}
export type SyntheticCompanion = ReturnType<typeof createSyntheticCompanion>;
