import { z } from 'zod';

export const fixtureAccounts = ['synthetic-pi-account-a', 'synthetic-pi-account-b'] as const;
const decimal = z.string().max(40).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/).refine(v => /[1-9]/.test(v));
export const handoffDraftSchema = z.object({ account: z.enum(fixtureAccounts), route: z.enum(['RHS', 'RHC']), instrument: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/), side: z.literal('BUY'), type: z.literal('LIMIT'), quantity: decimal, limitPrice: decimal, revision: z.number().int().min(0).max(1000000) }).strict();
export const handoffInvalidateInputSchema = z.object({ revision: z.number().int().min(0).max(1000000) }).strict();
export const handoffReviewInputSchema = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), digest: z.string().regex(/^[a-f0-9]{64}$/), draft: handoffDraftSchema }).strict();
export const handoffStatusSchema = z.object({ version: z.literal('v1'), source: z.literal('synthetic-offline-pi-handoff'), enabled: z.boolean(), execution: z.literal(false), preview: z.literal(false), confirmation: z.literal(false), dispatch: z.literal(false), cancellation: z.literal(false), accounts: z.array(z.enum(fixtureAccounts)).max(2) }).strict().superRefine((value, ctx) => {
  if (value.enabled !== (value.accounts.length === 2)) ctx.addIssue({ code: 'custom', message: 'inconsistent fixture' });
});
export const handoffResponseSchema = z.object({ version: z.literal('v1'), source: z.literal('synthetic-offline-pi-handoff'), id: z.string().regex(/^[a-f0-9]{32}$/), digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive(), draft: handoffDraftSchema, authority: z.literal(false), brokerFacts: z.literal(false) }).strict();
export type HandoffDraft = z.infer<typeof handoffDraftSchema>;
