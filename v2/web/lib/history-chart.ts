export interface ChartCompatibilityOrder {
  source: string;
  instrumentId: string;
  currency: string;
  occurredAt: string;
}
export interface CandleEvidence {
  source: string;
  independentOf: string;
  instrumentId: string;
  quoteCurrency: string;
  bucketStart: string;
  bucketEnd: string;
  observedAt: string;
}
export type ChartDecision =
  | { supported: true }
  | { supported: false; reason: 'unsupported' | 'source-mismatch' | 'instrument-mismatch' | 'currency-mismatch' | 'stale-or-incompatible-time' };

// No candles are overlaid unless every independent provenance/identity/time check is explicit.
export function candleOverlayDecision(order: ChartCompatibilityOrder, candle?: CandleEvidence): ChartDecision {
  if (!candle) return { supported: false, reason: 'unsupported' };
  if (!candle.source || candle.source === order.source || candle.independentOf !== order.source) return { supported: false, reason: 'source-mismatch' };
  if (!candle.instrumentId || candle.instrumentId !== order.instrumentId) return { supported: false, reason: 'instrument-mismatch' };
  if (!candle.quoteCurrency || candle.quoteCurrency !== order.currency) return { supported: false, reason: 'currency-mismatch' };
  const event = Date.parse(order.occurredAt), start = Date.parse(candle.bucketStart), end = Date.parse(candle.bucketEnd), observed = Date.parse(candle.observedAt);
  if (![event, start, end, observed].every(Number.isFinite) || start > event || event > end || start > observed || observed > end || Math.abs(observed - event) > 60_000) {
    return { supported: false, reason: 'stale-or-incompatible-time' };
  }
  return { supported: true };
}
