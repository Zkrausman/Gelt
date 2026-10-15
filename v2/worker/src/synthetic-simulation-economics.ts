// Pure exact economics for the opt-in simulated application mock. No I/O/provider.
import { z } from 'zod';
import { decimalSchema } from './ledger-contract.js';
import { canonical, digest } from './ledger-canonical.js';
export const simulationSource = 'gelt-synthetic-robinhood-mock-v2' as const;
export const simulationPolicy = 'synthetic-limit-fee-cap-10.v2' as const;
export const simulationInstrument = 'SYNTH-RH-USD' as const;
// This identity and fixed cap are used only by the separate pure G06 paper API.
// The legacy feeCap below intentionally remains fixed at USD10.
export const paperSizingPolicyId = 'gelt.spy-long-cash-paper-policy.v1' as const;
export const simulationTimestamp = z.string().datetime({ precision: 3 }).refine(s => {
  try { return new Date(s).toISOString() === s; } catch { return false; }
});
export const simulationHash = z.string().regex(/^[a-f0-9]{64}$/);
export const simulationClassification = z.enum(['constructed_offline_test', 'declared_market_uncalibrated']);
export type Decimal = z.infer<typeof decimalSchema>;
const money = decimalSchema.refine(d => d.scale <= 8);
const fraction = decimalSchema.refine(d => {
  const result = decimalSchema.safeParse(d);
  return result.success && units(result.data, 18) <= 10n ** 18n;
});
export const simulationRunSchema = z.object({
  version: z.literal(2), runId: z.string().uuid(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  instrumentId: z.literal(simulationInstrument), currency: z.literal('USD'), classification: simulationClassification,
  genesis: z.object({ cash: money, quantity: decimalSchema }).strict(),
  costs: z.object({ commissionPerOrder: money, spreadFraction: fraction, slippageFraction: fraction }).strict(),
  calibrationEvidenceSha256: simulationHash,
  maxDecisionAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxObservationAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), validThrough: simulationTimestamp,
  rounding: z.literal('adverse-price-8-cumulative-cash-8.v1'),
}).strict().refine(c => {
  try {
    decimal(units(c.genesis.cash, 8), 8); decimal(units(c.genesis.quantity, 18), 18);
    return true;
  } catch { return false; }
});
export type SimulationRun = z.infer<typeof simulationRunSchema>;
export const simulationObservationSchema = z.object({
  referencePrice: decimalSchema.refine(d => /[1-9]/.test(d.value)),
  observedAt: simulationTimestamp, availableAt: simulationTimestamp, evidenceSha256: simulationHash,
}).strict();
export type SimulationObservation = z.infer<typeof simulationObservationSchema>;
export const simulationSnapshotSchema = z.object({
  version: z.literal(2), source: z.literal(simulationSource), runId: z.string().uuid(), configSha256: simulationHash,
  classification: simulationClassification, instrumentId: z.literal(simulationInstrument), currency: z.literal('USD'),
  genesisSha256: simulationHash, revision: z.number().int().nonnegative().max(1000), historySha256: simulationHash,
  cash: decimalSchema, quantity: decimalSchema, marketEvaluation: z.literal('not_established'),
}).strict();
export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;
export function simulationDigest(value: unknown): string { return digest(canonical(value)); }
const pow = (s: number) => 10n ** BigInt(s);
export function units(raw: Decimal, scale: number): bigint {
  const d = decimalSchema.parse(raw);
  if (!Number.isInteger(scale) || scale < d.scale || scale > 36) throw new Error('simulation units unavailable');
  return BigInt(d.value.replace('.', '')) * pow(scale - d.scale);
}
export function decimal(value: bigint, scale: number): Decimal {
  if (value < 0n || scale < 0 || scale > 18) throw new Error('simulation economics unavailable');
  const text = value.toString().padStart(scale + 1, '0');
  const body = scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text;
  return decimalSchema.parse({ value: body, scale, precision: text.length });
}
export function rounded(value: bigint, from: number, to: number, up: boolean): bigint {
  if (value < 0n) throw new Error('simulation economics unavailable');
  if (from <= to) return value * pow(to - from);
  const divisor = pow(from - to);
  return value / divisor + (up && value % divisor !== 0n ? 1n : 0n);
}
export function executionPrice(config: SimulationRun, side: 'buy' | 'sell', reference: Decimal): Decimal {
  const c = simulationRunSchema.parse(config), r = decimalSchema.parse(reference);
  const adjustment = units(c.costs.spreadFraction, 18) + units(c.costs.slippageFraction, 18);
  const factor = side === 'buy' ? pow(18) + adjustment : pow(18) - adjustment;
  if (factor <= 0n || !/[1-9]/.test(r.value)) throw new Error('simulation economics unavailable');
  const p = rounded(BigInt(r.value.replace('.', '')) * factor, r.scale + 18, 8, side === 'buy');
  if (p <= 0n) throw new Error('simulation economics unavailable');
  return decimal(p, 8);
}
export function notional(quantity: Decimal, price: Decimal): bigint {
  // Scale36 exact product, rounded cumulatively only after summing all fills.
  return units(quantity, 18) * units(price, 18);
}
export function feeCap(quantity: Decimal, price: Decimal, fee: Decimal): boolean {
  return rounded(notional(quantity, price), 36, 8, true) + units(fee, 8) <= 10n * pow(8);
}
export const paperSizingFeeInclusiveCapUnits = 10_000n * pow(8);
export function checkObservation(config: SimulationRun, decisionAt: string, observation: SimulationObservation, now: number): void {
  const decision = Date.parse(simulationTimestamp.parse(decisionAt)), o = simulationObservationSchema.parse(observation);
  const observed = Date.parse(o.observedAt), available = Date.parse(o.availableAt);
  if (!Number.isSafeInteger(now) || decision > now || now > Date.parse(config.validThrough)
    || now - decision > config.maxDecisionAgeMs || now - observed > config.maxObservationAgeMs
    || observed <= decision || available < observed || available > now) throw new Error('simulation observation unavailable');
}
export function snapshot(config: SimulationRun, cash: bigint, quantity: bigint, history: unknown[]): SimulationSnapshot {
  return simulationSnapshotSchema.parse({ version: 2, source: simulationSource, runId: config.runId,
    configSha256: simulationDigest(config), classification: config.classification,
    instrumentId: config.instrumentId, currency: config.currency, genesisSha256: simulationDigest(config.genesis),
    revision: history.length, historySha256: simulationDigest(history), cash: decimal(cash, 8), quantity: decimal(quantity, 18),
    marketEvaluation: 'not_established' });
}

export const simulationPortfolioReadSchema = z.object({ snapshot: simulationSnapshotSchema, state: z.enum(['settled', 'unsettled']) }).strict();
