import { describe, expect, it } from 'vitest';
import {
  DISABLED_SUBMISSION_LABEL,
  EMPTY_ACKNOWLEDGEMENT,
  SIMULATED_TICKET_HEADING,
  SIMULATED_TRUTH_NOTICE,
  acknowledgeOnce,
  buildPreview,
  canAcknowledge,
  createOfflineFixture,
  displayedTerms,
  displaySimulatedAmount,
  isStatusFresh,
  parseM3Status,
  sameDisplayedTerms,
  selectedAccountLabel,
  type M3Status,
  type OfflineFixture,
} from './m6-ui';

const now = 1_800_000_000_000;
const handleA = 'a'.repeat(43);
const handleB = 'b'.repeat(43);
const connectedStatus = (selected: string | null = handleA, expiresAt = now + 30_000): M3Status => ({
  version: 'v1', state: 'connected', reason: 'ready', expiresAt,
  accounts: [{ handle: handleA, label: 'Account ••••1234' }, { handle: handleB, label: 'Account ••••5678' }],
  selected, execution: false,
});

function readyPreview(fixture: OfflineFixture = createOfflineFixture('BTC-USD', now), amount = '5.00') {
  return buildPreview(amount, fixture, now);
}

describe('M6 connection card and non-authoritative simulated ticket', () => {
  it('accepts only coherent returned M3 status and masks selection to the returned label', () => {
    const parsed = parseM3Status(connectedStatus());
    expect(parsed?.state).toBe('connected');
    expect(parsed?.accounts[0].label).toBe('Account ••••1234');
    expect(parseM3Status({ ...connectedStatus(), execution: true })).toBeNull();
    expect(parseM3Status({ ...connectedStatus(), extra: 'unknown' })).toBeNull();
    expect(parseM3Status({ ...connectedStatus(), selected: 'unknown-handle' })).toBeNull();
    expect(parseM3Status({ ...connectedStatus(), state: 'disconnected', selected: null })).toBeNull();
    expect(parseM3Status({ version: 'v1', state: 'unavailable', reason: 'provider_failure', expiresAt: null, accounts: [], selected: null, execution: false })).not.toBeNull();
  });

  it('renders unavailable M3 selection as unknown, not a known absent account', () => {
    expect(selectedAccountLabel(null, false, now)).toContain('Unknown');
    expect(selectedAccountLabel(connectedStatus(null), true, now)).toBe('None');
    expect(selectedAccountLabel(connectedStatus(), true, now)).toBe('Account ••••1234');
    expect(selectedAccountLabel(connectedStatus(), false, now)).toContain('stale');
    expect(selectedAccountLabel(connectedStatus(handleA, now), true, now)).toContain('expired');
  });

  it('fails closed until connected, selected, and unexpired; selection changes alter displayed terms', () => {
    const preview = readyPreview();
    expect(canAcknowledge(null, preview, now)).toBe(false);
    expect(canAcknowledge(connectedStatus(handleA, now + 100_000), preview, now + 30_001, now)).toBe(false);
    expect(isStatusFresh(now, now + 29_999)).toBe(true);
    expect(isStatusFresh(now, now + 30_000)).toBe(false);
    expect(canAcknowledge({ ...connectedStatus(), state: 'disconnected' } as M3Status, preview, now)).toBe(false);
    expect(canAcknowledge(connectedStatus(null), preview, now)).toBe(false);
    expect(canAcknowledge(connectedStatus(handleA, now), preview, now)).toBe(false);
    const before = displayedTerms(preview, handleA, now + 30_000);
    const afterSelection = displayedTerms(preview, handleB, now + 30_000);
    expect(sameDisplayedTerms(before, afterSelection)).toBe(false);
    expect(canAcknowledge(connectedStatus(handleB), preview, now)).toBe(true);
  });

  it('expires simulated terms and M3 status without treating either as live', () => {
    const fixture = createOfflineFixture('BTC-USD', now);
    const expiredQuote = buildPreview('5.00', fixture, now + 60_000);
    expect(expiredQuote.quoteStale).toBe(true);
    expect(expiredQuote.warnings.some(warning => warning.includes('fixture has expired'))).toBe(true);
    expect(canAcknowledge(connectedStatus(), expiredQuote, now + 60_000)).toBe(false);
    expect(canAcknowledge(connectedStatus(handleA, now + 1), readyPreview(), now + 1)).toBe(false);
  });

  it('invalidates acknowledgement when any displayed order term or expiry changes', () => {
    const originalPreview = readyPreview();
    const original = displayedTerms(originalPreview, handleA, now + 30_000);
    const changedAmount = displayedTerms(readyPreview(createOfflineFixture('BTC-USD', now), '5.01'), handleA, now + 30_000);
    const changedPair = displayedTerms(readyPreview(createOfflineFixture('ETH-USD', now)), handleA, now + 30_000);
    const changedExpiry = displayedTerms(originalPreview, handleA, now + 31_000);
    expect(sameDisplayedTerms(original, displayedTerms(originalPreview, handleA, now + 30_000))).toBe(true);
    expect(sameDisplayedTerms(original, changedAmount)).toBe(false);
    expect(sameDisplayedTerms(original, changedPair)).toBe(false);
    expect(sameDisplayedTerms(original, changedExpiry)).toBe(false);
  });

  it('repeated acknowledgement clicks remain one idempotent local boolean and never mint authority', () => {
    const first = acknowledgeOnce(EMPTY_ACKNOWLEDGEMENT, true);
    const second = acknowledgeOnce(first, true);
    expect(first).toEqual({ acknowledged: true });
    expect(second).toBe(first);
    expect(acknowledgeOnce(EMPTY_ACKNOWLEDGEMENT, false)).toBe(EMPTY_ACKNOWLEDGEMENT);
    expect(Object.keys(first)).toEqual(['acknowledged']);
  });

  it('keeps unknown fees, over-cap totals, invalid decimal text, and stale fixtures closed', () => {
    const unknownFee = buildPreview('5.00', { ...createOfflineFixture('BTC-USD', now), feeUsd: null }, now);
    expect(unknownFee.feeUsd).toBeNull();
    expect(unknownFee.totalUsd).toBeNull();
    expect(unknownFee.capState).toBe('unknown');
    expect(canAcknowledge(connectedStatus(), unknownFee, now)).toBe(false);
    const overCap = readyPreview(createOfflineFixture('BTC-USD', now), '9.96');
    expect(overCap.totalUsd).toBe('10.01');
    expect(overCap.capState).toBe('over-cap');
    expect(canAcknowledge(connectedStatus(), overCap, now)).toBe(false);
    expect(readyPreview(createOfflineFixture('BTC-USD', now), '1e2').capState).toBe('unknown');
    expect(displaySimulatedAmount('1e2')).toBe('Invalid / unknown USD amount');
    expect(displaySimulatedAmount('0')).toBe('Invalid / unknown USD amount');
    expect(displaySimulatedAmount('5')).toBe('$5.00 USD');
    expect(displaySimulatedAmount('5.01')).toBe('$5.01 USD');
    expect(readyPreview({ ...createOfflineFixture('BTC-USD', now), sampledAtMs: now - 60_000 }, '5.00').quoteStale).toBe(true);
  });

  it('labels fixture age, pair, price, and fee as simulated rather than quote truth', () => {
    const preview = buildPreview('5.00', createOfflineFixture('BTC-USD', now - 12_000), now);
    expect(preview.pair).toBe('BTC-USD');
    expect(preview.indicativePriceUsd).toBe('65000.00');
    expect(preview.feeUsd).toBe('0.05');
    expect(preview.totalUsd).toBe('5.05');
    expect(preview.estimatedQuantity).toBe('0.00007692');
    expect(preview.quoteAgeSeconds).toBe(12);
    expect(preview.warnings.join(' ')).toContain('Offline development fixture only');
    expect(preview.warnings.join(' ')).toContain('actual broker fees are unknown');
    expect(SIMULATED_TICKET_HEADING).toContain('OFFLINE DEVELOPMENT FIXTURE');
    expect(SIMULATED_TRUTH_NOTICE).toContain('Not live');
    expect(DISABLED_SUBMISSION_LABEL).toContain('unavailable in M6');
  });
});
