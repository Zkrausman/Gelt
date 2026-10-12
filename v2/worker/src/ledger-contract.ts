import { z } from 'zod';
// No text/metadata/error/payload escape hatch. IDs are facts, never credentials.
export const ledgerId = z.string().uuid();
const providerId = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).refine(s => !/token|secret|bearer|password|oauth|pkce/i.test(s));
export const decimalSchema = z.object({ value: z.string().max(40).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/), precision: z.number().int().min(1).max(38), scale: z.number().int().min(0).max(18) }).strict().refine(d => d.value.replace('.', '').length === d.precision && (d.value.split('.')[1]?.length ?? 0) === d.scale);
const positive = decimalSchema.refine(d => /[1-9]/.test(d.value));
const timestamp = z.string().datetime({ precision: 3 }).refine(s => { try { return new Date(s).toISOString() === s; } catch { return false; } });
export const scopeSchema = z.object({ ownerId: ledgerId, accountId: ledgerId }).strict();
export const routingSchema = z.object({ provider: z.literal('robinhood-official-mcp'), ACCOUNT: providerId, RHS: providerId, RHC: providerId.optional() }).strict();
export const orderSchema = z.object({ route: z.enum(['RHS', 'RHC']), instrumentId: providerId, side: z.enum(['buy', 'sell']), requestedQuantity: positive, requestedLimitPrice: positive, currency: z.literal('USD') }).strict();
export const intentSchema = scopeSchema.extend({ version: z.literal(1), intentId: ledgerId, idempotencyKey: ledgerId, recordedAt: timestamp, routing: routingSchema, order: orderSchema }).strict().refine(i => i.order.route !== 'RHC' || i.routing.RHC !== undefined);
const base = scopeSchema.extend({ version: z.literal(1), intentId: ledgerId, eventId: ledgerId, idempotencyKey: ledgerId, occurredAt: timestamp });
export const executionSchema = z.object({ executionId: providerId, brokerOrderId: providerId, observedQuantity: positive, observedPrice: positive, observedFee: decimalSchema.optional(), currency: z.literal('USD') }).strict();
export const eventSchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('dispatch-attempted'), attemptId: ledgerId }).strict(),
  base.extend({ type: z.literal('order-requested'), requestId: ledgerId }).strict(),
  base.extend({ type: z.literal('broker-acknowledged'), brokerOrderId: providerId }).strict(),
  base.extend({ type: z.literal('reconciliation-observed'), reconciliationId: ledgerId, observation: z.enum(['unknown', 'not-found', 'present']) }).strict(),
  base.extend({ type: z.literal('execution-observed'), execution: executionSchema }).strict(),
  // M5 facts are worker-internal, append-only observations/claims. They add no
  // provider schema or public dispatch authority.
  base.extend({ type: z.literal('preview-confirmed'), previewId: ledgerId, confirmationId: ledgerId, fee: decimalSchema, feeCurrency: z.literal('USD'), expiresAt: timestamp, termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  base.extend({ type: z.literal('dispatch-claimed'), dispatchId: ledgerId, previewId: ledgerId, confirmationId: ledgerId, termsHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  base.extend({ type: z.literal('dispatch-outcome-unknown'), outcomeId: ledgerId, dispatchId: ledgerId }).strict(),
  base.extend({ type: z.literal('reconciliation-unavailable'), reconciliationId: ledgerId, dispatchId: ledgerId }).strict(),
  base.extend({ type: z.literal('broker-status-observed'), observationId: ledgerId, status: z.enum(['accepted', 'open', 'partially-filled', 'pending-cancel', 'rejected', 'filled', 'canceled', 'unknown', 'not-found']), brokerOrderId: providerId.optional() }).strict(),
  base.extend({ type: z.literal('cancel-requested'), cancelId: ledgerId, brokerOrderId: providerId }).strict(),
  base.extend({ type: z.literal('cancel-acknowledged'), cancelId: ledgerId, brokerOrderId: providerId }).strict(),
]);
export type Intent = z.infer<typeof intentSchema>;
export type LedgerEvent = z.infer<typeof eventSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export const querySchema = scopeSchema.extend({ intentId: ledgerId }).strict();
export const routedHistorySchema = z.object({ ownerId: ledgerId, routing: routingSchema }).strict();
export const routedIntentSchema = z.object({ ownerId: ledgerId, intentId: ledgerId, routing: routingSchema }).strict();
export const historyInputSchema = z.union([scopeSchema, routedHistorySchema]);
export const getIntentInputSchema = z.union([querySchema, routedIntentSchema]);
export const pageSchema = z.object({ after: z.number().int().min(0).max(1000), limit: z.number().int().min(1).max(100) }).strict();
export const projectionSchema = z.object({ version: z.literal(1), intent: intentSchema, eventCount: z.number().int().min(0).max(1000), facts: z.array(eventSchema).max(1000) }).strict().refine(p => p.eventCount === p.facts.length && p.facts.every(e => e.ownerId === p.intent.ownerId && e.accountId === p.intent.accountId && e.intentId === p.intent.intentId));
export type Projection = z.infer<typeof projectionSchema>;
export const writeReceiptSchema = z.object({ disposition: z.enum(['committed', 'duplicate']), projection: projectionSchema }).strict();
export const errorSchema = z.object({ version: z.literal(1), ok: z.literal(false), error: z.enum(['invalid', 'conflict', 'not_found', 'capacity', 'unavailable']) }).strict();
export function resultSchema<T extends z.ZodTypeAny>(value: T) { return z.union([z.object({version: z.literal(1), ok: z.literal(true), value}).strict(), errorSchema]); }
export const getIntentResultSchema = resultSchema(projectionSchema);
export const writeResultSchema = resultSchema(writeReceiptSchema);
export const timelineResultSchema = resultSchema(z.array(eventSchema).max(100));
export const historyResultSchema = resultSchema(z.array(projectionSchema).max(100));
export type Result<T> = { version: 1; ok: true; value: T } | { version: 1; ok: false; error: 'invalid' | 'conflict' | 'not_found' | 'capacity' | 'unavailable' };
export type WriteReceipt = { disposition: 'committed' | 'duplicate'; projection: Projection };
// Projection is a facts-only query model: no implied lifecycle transitions or fills.
export function replay(intent: Intent, facts: LedgerEvent[]): Projection { return { version: 1, intent, eventCount: facts.length, facts }; }
