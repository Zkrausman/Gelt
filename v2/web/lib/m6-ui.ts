export type ConnectionState = 'disconnected' | 'authorizing' | 'connected' | 'unavailable';
export type AccountChoice = { handle: string; label: string };
export type M3Status = {
  version: 'v1';
  state: ConnectionState;
  reason: 'offline' | 'setup_required' | 'authorization_pending' | 'not_connected' | 'provider_failure' | 'ready';
  expiresAt: number | null;
  accounts: AccountChoice[];
  selected: string | null;
  execution: false;
};

export type Pair = 'BTC-USD' | 'ETH-USD';
export const SIMULATED_TICKET_HEADING = 'OFFLINE DEVELOPMENT FIXTURE — SIMULATED BUY ONLY';
export const SIMULATED_TRUTH_NOTICE = 'Not live. Not a broker preview. Not production telemetry.';
export const DISABLED_SUBMISSION_LABEL = 'Submit BUY — unavailable in M6';
export type OfflineFixture = {
  provenance: 'offline-development-fixture';
  pair: Pair;
  indicativePriceUsd: string;
  feeUsd: string | null;
  sampledAtMs: number;
  expiresAtMs: number;
};

export type Preview = {
  pair: Pair;
  amountUsd: string;
  indicativePriceUsd: string;
  feeUsd: string | null;
  totalUsd: string | null;
  estimatedQuantity: string | null;
  quoteAgeSeconds: number;
  quoteStale: boolean;
  capState: 'within-cap' | 'over-cap' | 'unknown';
  warnings: string[];
};

export type DisplayedTerms = {
  pair: Pair;
  amountUsd: string;
  indicativePriceUsd: string;
  feeUsd: string | null;
  totalUsd: string | null;
  selectedAccount: string | null;
  expiresAtMs: number;
};

export type LocalAcknowledgement = { acknowledged: boolean };
export const EMPTY_ACKNOWLEDGEMENT: LocalAcknowledgement = Object.freeze({ acknowledged: false });

const MAX_MONEY_CENTS = 99_999n;
const MAX_INDICATIVE_PRICE_CENTS = 10_000_000_000n;
const FEE_INCLUSIVE_CAP_CENTS = 1_000n;
const QUOTE_LIFETIME_MS = 60_000;
const STATUS_FRESHNESS_MS = 30_000;
const QUANTITY_SCALE = 100_000_000n;

// Parse bounded USD text as integer cents. No Number conversion or floating-point money.
export function parseUsdCents(value: string, maximumCents = MAX_MONEY_CENTS): bigint | null {
  if (value.length > 12 || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return cents > 0n && cents <= maximumCents ? cents : null;
}

function formatUsdCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function displaySimulatedAmount(value: string): string {
  const cents = parseUsdCents(value);
  return cents === null ? 'Invalid / unknown USD amount' : `$${formatUsdCents(cents)} USD`;
}

function formatQuantity(units: bigint): string {
  const whole = (units / QUANTITY_SCALE).toString();
  const fraction = (units % QUANTITY_SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function createOfflineFixture(pair: Pair, now: number): OfflineFixture {
  const indicativePriceUsd = pair === 'BTC-USD' ? '65000.00' : '3000.00';
  return {
    provenance: 'offline-development-fixture',
    pair,
    indicativePriceUsd,
    feeUsd: '0.05',
    sampledAtMs: now,
    expiresAtMs: now + QUOTE_LIFETIME_MS,
  };
}

export function buildPreview(amountUsd: string, fixture: OfflineFixture, now: number): Preview {
  const amountCents = parseUsdCents(amountUsd);
  const priceCents = parseUsdCents(fixture.indicativePriceUsd, MAX_INDICATIVE_PRICE_CENTS);
  const feeCents = fixture.feeUsd === null ? null : parseUsdCents(fixture.feeUsd);
  const quoteAgeSeconds = Math.max(0, Math.floor((now - fixture.sampledAtMs) / 1000));
  const quoteStale = now < fixture.sampledAtMs || now >= fixture.expiresAtMs || quoteAgeSeconds >= QUOTE_LIFETIME_MS / 1000;
  const totalCents = amountCents !== null && feeCents !== null ? amountCents + feeCents : null;
  const capState: Preview['capState'] = totalCents === null
    ? 'unknown'
    : totalCents <= FEE_INCLUSIVE_CAP_CENTS ? 'within-cap' : 'over-cap';
  const estimatedQuantity = amountCents !== null && priceCents !== null
    ? formatQuantity(amountCents * QUANTITY_SCALE / priceCents)
    : null;
  const warnings = [
    'Offline development fixture only: this indicative value is not a market quote or production telemetry.',
    'Fixture fee is simulated; actual broker fees are unknown and must not be inferred from this example.',
    'M3 has no preview, confirmation, submission, or cancel endpoint. No order action is available here.',
  ];
  if (amountCents === null) warnings.push('Enter a positive USD amount with at most two decimal places.');
  if (capState === 'over-cap') warnings.push('Simulated amount plus fee exceeds the fee-inclusive $10.00 design ceiling.');
  if (capState === 'unknown') warnings.push('Fee-inclusive cap cannot be evaluated because the amount or fee is unknown/invalid.');
  if (quoteStale) warnings.push('This offline fixture has expired; its terms cannot be acknowledged.');

  return {
    pair: fixture.pair,
    amountUsd,
    indicativePriceUsd: fixture.indicativePriceUsd,
    feeUsd: feeCents === null ? null : formatUsdCents(feeCents),
    totalUsd: totalCents === null ? null : formatUsdCents(totalCents),
    estimatedQuantity,
    quoteAgeSeconds,
    quoteStale,
    capState,
    warnings,
  };
}

export function parseM3Status(value: unknown): M3Status | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expectedKeys = ['accounts', 'execution', 'expiresAt', 'reason', 'selected', 'state', 'version'];
  if (Object.keys(record).length !== expectedKeys.length || expectedKeys.some(key => !Object.prototype.hasOwnProperty.call(record, key))) return null;
  const states: ConnectionState[] = ['disconnected', 'authorizing', 'connected', 'unavailable'];
  const reasons: M3Status['reason'][] = ['offline', 'setup_required', 'authorization_pending', 'not_connected', 'provider_failure', 'ready'];
  if (record.version !== 'v1' || !states.includes(record.state as ConnectionState) || !reasons.includes(record.reason as M3Status['reason']) || record.execution !== false) return null;
  if (!(record.expiresAt === null || (Number.isSafeInteger(record.expiresAt) && (record.expiresAt as number) > 0))) return null;
  if (!Array.isArray(record.accounts) || record.accounts.length > 100 || !(record.selected === null || typeof record.selected === 'string')) return null;
  const accounts: AccountChoice[] = [];
  for (const candidate of record.accounts) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null;
    const account = candidate as Record<string, unknown>;
    if (Object.keys(account).length !== 2 || !Object.prototype.hasOwnProperty.call(account, 'handle') || !Object.prototype.hasOwnProperty.call(account, 'label')) return null;
    if (typeof account.handle !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(account.handle) || typeof account.label !== 'string' || !/^Account ••••[A-Za-z0-9]{1,4}$/.test(account.label)) return null;
    accounts.push({ handle: account.handle, label: account.label });
  }
  if (new Set(accounts.map(account => account.handle)).size !== accounts.length) return null;
  const connected = record.state === 'connected';
  if (connected) {
    if (record.expiresAt === null || accounts.length === 0 || record.reason !== 'ready' || (record.selected !== null && !accounts.some(account => account.handle === record.selected))) return null;
  } else if (record.expiresAt !== null || accounts.length !== 0 || record.selected !== null || record.reason === 'ready') return null;
  return {
    version: 'v1',
    state: record.state as ConnectionState,
    reason: record.reason as M3Status['reason'],
    expiresAt: record.expiresAt as number | null,
    accounts,
    selected: record.selected as string | null,
    execution: false,
  };
}

export function isStatusFresh(observedAtMs: number | null, now: number): boolean {
  return observedAtMs !== null && Number.isSafeInteger(observedAtMs) && observedAtMs <= now && now - observedAtMs < STATUS_FRESHNESS_MS;
}

export function selectedAccountLabel(status: M3Status | null, fresh: boolean, now: number): string {
  if (!status) return 'Unknown (M3 status unavailable)';
  if (status.state === 'connected' && (status.expiresAt === null || status.expiresAt <= now)) return 'Unavailable (M3 status expired)';
  if (!fresh) return 'Unavailable (M3 status stale)';
  if (!status.selected) return 'None';
  return status.accounts.find(account => account.handle === status.selected)?.label ?? 'Unknown selection';
}

export function canAcknowledge(status: M3Status | null, preview: Preview, now: number, statusObservedAtMs: number | null = now): boolean {
  return status !== null
    && isStatusFresh(statusObservedAtMs, now)
    && status.state === 'connected'
    && status.selected !== null
    && status.expiresAt !== null
    && status.expiresAt > now
    && !preview.quoteStale
    && parseUsdCents(preview.amountUsd) !== null
    && preview.feeUsd !== null
    && preview.capState === 'within-cap';
}

export function displayedTerms(preview: Preview, selectedAccount: string | null, expiresAtMs: number): DisplayedTerms {
  return {
    pair: preview.pair,
    amountUsd: preview.amountUsd,
    indicativePriceUsd: preview.indicativePriceUsd,
    feeUsd: preview.feeUsd,
    totalUsd: preview.totalUsd,
    selectedAccount,
    expiresAtMs,
  };
}

export function sameDisplayedTerms(left: DisplayedTerms, right: DisplayedTerms): boolean {
  return left.pair === right.pair
    && left.amountUsd === right.amountUsd
    && left.indicativePriceUsd === right.indicativePriceUsd
    && left.feeUsd === right.feeUsd
    && left.totalUsd === right.totalUsd
    && left.selectedAccount === right.selectedAccount
    && left.expiresAtMs === right.expiresAtMs;
}

// This is only a local UI checkbox state; it creates no grant, token, or authority.
export function acknowledgeOnce(current: LocalAcknowledgement, permitted: boolean): LocalAcknowledgement {
  if (current.acknowledged || !permitted) return current;
  return { acknowledged: true };
}
