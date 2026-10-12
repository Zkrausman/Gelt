import { z } from "zod";

// Closed v1 schemas: adding any authority requires a separately reviewed contract.
export const healthSchema = z.object({
  version: z.literal("v1"), service: z.literal("execution-worker"),
  status: z.literal("disabled"), configuration: z.enum(["unconfigured", "protected"]),
}).strict();
export const capabilitiesSchema = z.object({
  version: z.literal("v1"), service: z.literal("execution-worker"),
  execution: z.literal(false), credentials: z.boolean(), ledger: z.boolean(),
  operations: z.array(z.enum(['connection.status', 'connection.initiate', 'connection.callback', 'connection.discover', 'connection.select', 'connection.disconnect', 'history.list', 'history.intent', 'orders.status'])).max(9),
}).strict();
export const orderSurfaceSchema = z.object({
  version: z.literal('v1'), mode: z.literal('disabled'), execution: z.literal(false),
  preview: z.literal(false), confirmation: z.literal(false), dispatch: z.literal(false),
  cancellation: z.literal(false), reconciliation: z.literal(false),
  reason: z.literal('production_adapter_unsupported'),
}).strict();
export const health = healthSchema.parse({
  version: "v1", service: "execution-worker", status: "disabled", configuration: "unconfigured",
});
export const capabilities = capabilitiesSchema.parse({
  version: "v1", service: "execution-worker", execution: false, credentials: false,
  ledger: false, operations: [],
});
