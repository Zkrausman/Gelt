import { z } from 'zod';
import { ledgerId, decimalSchema, routingSchema } from './ledger-contract.js';
import { opaque } from './connection-contract.js';

export const historyPageInputSchema = z.object({
  after: z.number().int().min(0).max(1000),
  limit: z.number().int().min(1).max(50),
}).strict();
export const historyDetailInputSchema = historyPageInputSchema.extend({ intentId: ledgerId }).strict();
export const selectedRoutingSchema = routingSchema.extend({}).strict();
const decimalText = z.string().max(40).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const maskedRoute = z.string().regex(/^••••[A-Za-z0-9-]{1,4}$/);
export const historySummarySchema = z.object({
  intentId: ledgerId,
  recordedAt: z.string().datetime({ precision: 3 }),
  source: z.literal('robinhood-official-mcp'),
  account: z.object({ ACCOUNT: maskedRoute, RHS: maskedRoute, RHC: maskedRoute.optional() }).strict(),
  route: z.enum(['RHS', 'RHC']), instrumentId: z.string().min(1).max(64),
  side: z.enum(['buy', 'sell']), currency: z.literal('USD'),
  requestedQuantity: decimalText, requestedLimitPrice: decimalText,
  eventCount: z.number().int().min(0).max(1000), executionCount: z.number().int().min(0).max(1000),
}).strict();
export const historyListResponseSchema = z.object({
  version: z.literal('v1'), accountHandle: opaque,
  account: z.object({ ACCOUNT: maskedRoute, RHS: maskedRoute, RHC: maskedRoute }).strict(),
  items: z.array(historySummarySchema).max(50),
  after: z.number().int().min(0).max(1000), limit: z.number().int().min(1).max(50), hasMore: z.boolean(),
}).strict();
const timelineFactSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dispatch-attempted'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('order-requested'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('broker-acknowledged'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('reconciliation-observed'), occurredAt: z.string().datetime({ precision: 3 }), observation: z.enum(['unknown', 'not-found', 'present']) }).strict(),
  z.object({ type: z.literal('execution-observed'), occurredAt: z.string().datetime({ precision: 3 }), execution: z.object({ observedQuantity: decimalSchema, observedPrice: decimalSchema, observedFee: decimalSchema.optional(), currency: z.literal('USD') }).strict() }).strict(),
  z.object({ type: z.literal('preview-confirmed'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('dispatch-claimed'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('dispatch-outcome-unknown'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('reconciliation-unavailable'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('broker-status-observed'), occurredAt: z.string().datetime({ precision: 3 }), status: z.enum(['accepted', 'open', 'partially-filled', 'pending-cancel', 'rejected', 'filled', 'canceled', 'unknown', 'not-found']) }).strict(),
  z.object({ type: z.literal('cancel-requested'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
  z.object({ type: z.literal('cancel-acknowledged'), occurredAt: z.string().datetime({ precision: 3 }) }).strict(),
]);
export type TimelineFact = z.infer<typeof timelineFactSchema>;
export const historyTimelineItemSchema = z.object({
  sequence: z.number().int().positive().max(1000), event: timelineFactSchema,
}).strict();
export const historyDetailResponseSchema = z.object({
  version: z.literal('v1'), accountHandle: opaque, intent: historySummarySchema,
  eventCount: z.number().int().min(0).max(1000),
  after: z.number().int().min(0).max(1000), limit: z.number().int().min(1).max(50),
  hasMore: z.boolean(), timeline: z.array(historyTimelineItemSchema).max(50),
}).strict();
export type HistoryListResponse = z.infer<typeof historyListResponseSchema>;
export type HistoryDetailResponse = z.infer<typeof historyDetailResponseSchema>;
