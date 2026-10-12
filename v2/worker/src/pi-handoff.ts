// Non-authorizing offline fixture only. This module has no provider, ledger or lifecycle dependency.
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { fixtureAccounts, handoffDraftSchema, handoffReviewInputSchema, handoffInvalidateInputSchema, handoffStatusSchema, handoffResponseSchema } from './pi-handoff-contract.js';

export const MAX_REVISION_FLOORS = 64;

export function offlinePiHandoff(now: () => number = Date.now) {
  if (process.env.NODE_ENV !== 'test' || process.env.GELT_OFFLINE_PI_HANDOFF !== 'fixture-only') throw new Error('fixture disabled');
  let pending: { session: string; value: z.infer<typeof handoffResponseSchema> } | null = null;
  const revisionFloors = new Map<string, number>();
  let invalidationOverflow = false;
  const enabled = () => process.env.NODE_ENV === 'test' && process.env.GELT_OFFLINE_PI_HANDOFF === 'fixture-only';
  const status = () => {
    const active = enabled() && !invalidationOverflow;
    return handoffStatusSchema.parse({ version: 'v1', source: 'synthetic-offline-pi-handoff', enabled: active, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: active ? [...fixtureAccounts] : [] });
  };
  const invalidate = (session: string, input: unknown) => {
    if (!enabled() || invalidationOverflow) throw new Error('fixture unavailable');
    const { revision } = handoffInvalidateInputSchema.parse(input);
    const previous = revisionFloors.get(session);
    if (previous === undefined && revisionFloors.size >= MAX_REVISION_FLOORS) {
      // Never evict an owner's floor. Once the bounded table is exhausted, fail closed
      // for this fixture instance rather than forgetting invalidation history.
      invalidationOverflow = true;
      pending = null;
      throw new Error('invalidation capacity exhausted');
    }
    if (pending?.session === session) pending = null;
    revisionFloors.set(session, Math.max(revision, previous ?? 0));
    return status();
  };
  const prepare = (session: string, input: unknown) => {
    if (!enabled() || invalidationOverflow) throw new Error('fixture unavailable');
    pending = null;
    const draft = handoffDraftSchema.parse(input);
    const revisionFloor = revisionFloors.get(session);
    if (revisionFloor !== undefined && draft.revision < revisionFloor) throw new Error('stale revision');
    const issued = now();
    if (!Number.isSafeInteger(issued) || issued < 1 || issued > Number.MAX_SAFE_INTEGER - 30000) throw new Error('clock unavailable');
    const id = randomBytes(16).toString('hex'), expiresAt = issued + 30000;
    const hash = digest(canonical({ version: 'v1', source: 'synthetic-offline-pi-handoff', id, session, expiresAt, draft }));
    const value = handoffResponseSchema.parse({ version: 'v1', source: 'synthetic-offline-pi-handoff', id, digest: hash, expiresAt, draft, authority: false, brokerFacts: false });
    pending = { session, value };
    return value;
  };
  const review = (session: string, input: unknown) => {
    if (!enabled() || invalidationOverflow) throw new Error('fixture unavailable');
    const data = handoffReviewInputSchema.parse(input), saved = pending;
    if (!saved || saved.session !== session || saved.value.expiresAt <= now() || data.id !== saved.value.id || data.digest !== saved.value.digest || canonical(data.draft) !== canonical(saved.value.draft)) throw new Error('handoff unavailable');
    // Review is read-only and never consumes into dispatch. No confirmation token exists.
    return saved.value;
  };
  return { status, invalidate, prepare, review };
}
export type OfflinePiHandoff = ReturnType<typeof offlinePiHandoff>;
