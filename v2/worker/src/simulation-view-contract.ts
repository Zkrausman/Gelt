import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';

// G03 is a recorded-fixture reader. These IDs are view selections, not G06 run authority.
export const simulationPanels = ['run', 'paper', 'data', 'decision', 'orders', 'results'] as const;
export type SimulationPanel = typeof simulationPanels[number];
export const simulationViewSource = 'gelt-recorded-mock-view-v1' as const;
export const simulationViewMaxBytes = 65536;
const id = z.string().regex(/^recorded-[a-z0-9-]{1,48}$/);
const positiveDecimal = decimalSchema.refine(d => /[1-9]/.test(d.value));
const factBase = z.object({ source: z.literal('synthetic-offline-v1'), occurredAt: z.string().datetime() });
const fact = z.discriminatedUnion('syntheticType', [
  factBase.extend({ syntheticType: z.enum(['dispatch-attempted', 'order-requested', 'broker-acknowledged', 'reconciliation-observed', 'preview-confirmed', 'dispatch-claimed', 'dispatch-outcome-unknown', 'reconciliation-unavailable', 'broker-status-observed', 'cancel-requested', 'cancel-acknowledged']) }).strict(),
  factBase.extend({ syntheticType: z.literal('execution-observed'), syntheticExecutionId: z.string().min(1).max(64), observedQuantity: decimalSchema, observedPrice: decimalSchema, observedFee: decimalSchema.optional(), currency: z.literal('USD') }).strict(),
]);
const execution = z.object({ executionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/), quantity: positiveDecimal, price: positiveDecimal, fee: decimalSchema.optional(), currency: z.literal('USD') }).strict();
export const recordedSimulationSchema = z.object({
  id, label: z.string().min(1).max(80), recordedAt: z.string().datetime(),
  decision: z.literal('scripted_fixture_not_agent'), paper: z.literal('not_linked'),
  requested: z.object({ instrument: z.literal('SYNTH-RH-USD'), quantity: positiveDecimal, limitPrice: positiveDecimal, currency: z.literal('USD') }).strict(),
  history: z.object({ source: z.literal('synthetic-offline-v1'), syntheticIntentId: z.string().uuid(), eventCount: z.number().int().min(0).max(100), facts: z.array(fact).max(100) }).strict(),
  mock: z.object({ source: z.literal('gelt-synthetic-robinhood-mock-v1'), dispatchId: z.string().uuid(), mockOrderId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/), previewId: z.string().uuid(), status: z.enum(['accepted', 'open', 'partially-filled', 'pending-cancel', 'filled', 'canceled']), executions: z.array(execution).max(16), cancelAcknowledged: z.boolean() }).strict(),
}).strict().superRefine((v, ctx) => {
  const observed = v.history.facts.flatMap(f => f.syntheticType === 'execution-observed' ? [f] : []);
  const decimalEqual = (a: z.infer<typeof decimalSchema> | undefined, b: z.infer<typeof decimalSchema> | undefined) => a?.value === b?.value && a?.precision === b?.precision && a?.scale === b?.scale;
  if (v.history.syntheticIntentId !== v.mock.dispatchId || v.history.eventCount !== v.history.facts.length
    || new Set(v.mock.executions.map(e => e.executionId)).size !== v.mock.executions.length
    || new Set(observed.map(f => f.syntheticExecutionId)).size !== observed.length
    || observed.length !== v.mock.executions.length || observed.some(f => {
      const execution = v.mock.executions.find(e => e.executionId === f.syntheticExecutionId);
      return !execution || execution.currency !== f.currency || !decimalEqual(execution.quantity, f.observedQuantity)
        || !decimalEqual(execution.price, f.observedPrice) || !decimalEqual(execution.fee, f.observedFee);
    })) ctx.addIssue({ code: 'custom', message: 'Inconsistent recorded fixture' });
});
export const simulationSnapshotSchema = z.object({ version: z.literal(1), source: z.literal(simulationViewSource), runs: z.array(recordedSimulationSchema).min(1).max(8) }).strict().superRefine((v, ctx) => {
  if (new Set(v.runs.map(r => r.id)).size !== v.runs.length) ctx.addIssue({ code: 'custom', message: 'Duplicate fixture selection' });
});
export const simulationSelectionSchema = z.object({ runId: id }).strict();
export const simulationListSchema = z.object({ version: z.literal('v1'), sessionExpiresAt: z.number().int().positive(), state: z.enum(['available', 'unavailable', 'corrupt']), items: z.array(z.object({ id, label: z.string().min(1).max(80) }).strict()).max(8) }).strict();
export const simulationDetailSchema = z.discriminatedUnion('state', [
  z.object({ version: z.literal('v1'), sessionExpiresAt: z.number().int().positive(), state: z.literal('available'), run: recordedSimulationSchema }).strict(),
  z.object({ version: z.literal('v1'), sessionExpiresAt: z.number().int().positive(), state: z.enum(['missing', 'unavailable', 'corrupt']) }).strict(),
]);
export type RecordedSimulation = z.infer<typeof recordedSimulationSchema>;
