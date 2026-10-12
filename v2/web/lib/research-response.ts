import { z } from 'zod';
import { researchIdSchema, researchRecordSchema } from '../../worker/src/research-contract';
export const researchDetailInput = z.object({ evidenceId: researchIdSchema }).strict();
const session = { version: z.literal('v1'), sessionExpiresAt: z.number().int().positive() };
const state = z.enum(['available', 'missing', 'corrupt', 'unavailable']);
export const researchListResponse = z.discriminatedUnion('state', [
  z.object({ ...session, state: z.literal('available'), items: z.array(z.object({ evidenceId: researchIdSchema, state }).strict()).max(100) }).strict(),
  z.object({ ...session, state: z.literal('unavailable') }).strict(),
]);
export const researchDetailResponse = z.discriminatedUnion('state', [
  z.object({ ...session, state: z.literal('available'), record: researchRecordSchema }).strict(),
  z.object({ ...session, state: z.enum(['missing', 'corrupt', 'unavailable']) }).strict(),
]);
export type ResearchListResponse = z.infer<typeof researchListResponse>;
export type ResearchDetailResponse = z.infer<typeof researchDetailResponse>;
