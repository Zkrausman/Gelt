import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireAlpacaIexDailyBars,
  isConnectorIssuedAlpacaAcquisition,
} from './alpaca-iex-connector.js';
import { normalizeAlpacaIexBars } from './alpaca-iex-normalization.js';
import { buildAlpacaShadowCandidate } from './alpaca-shadow-candidate.js';
import { formatComparisonNumber } from './alpaca-byte-review-contract.js';
import {
  makeConstructedAlpacaByteReviewFixture,
  PROPOSED_NUMERIC_EDGE_CANDIDATES,
} from '../test-fixtures/alpaca-byte-review.js';

afterEach(() => vi.useRealTimers());

describe('independently prepared constructed byte-review fixtures', () => {
  it('uses the actual connector issuance seam with synthetic responses only', async () => {
    const fixture = makeConstructedAlpacaByteReviewFixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixture.receiptPlan.proposedReceivedAt));
    const requested: URL[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const response = fixture.responses[requested.length];
      expect(response).toBeDefined();
      expect(url.searchParams.get('limit')).toBe(String(response.requestedLimit));
      expect(url.searchParams.get('page_token')).toBe(response.inputCursor);
      requested.push(url);
      return new Response(response.bodyText, {
        headers: { 'content-type': 'application/json' },
      });
    });
    const original = await acquireAlpacaIexDailyBars(fixture.request, {
      keyId: 'CONSTRUCTED_KEY_NO_ACCOUNT',
      secretKey: 'CONSTRUCTED_SECRET_NO_ACCOUNT',
    }, { fetcher: fetcher as typeof fetch });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(original.pages).toEqual(fixture.responses.map(r => r.rawPage));
    expect(original.request).toEqual(fixture.proposedRequestEvidence);
    expect(original.observations).toEqual(fixture.observationsDescending);
    expect(original.receivedAt).toBe(fixture.receiptPlan.proposedReceivedAt);
    expect(isConnectorIssuedAlpacaAcquisition(original)).toBe(true);
    expect(isConnectorIssuedAlpacaAcquisition(structuredClone(original))).toBe(false);
    expect(Object.isFrozen(original)).toBe(true);

    const normalization = {
      source: 'alpaca-data-v2' as const,
      feed: 'iex' as const,
      symbol: fixture.symbol,
      adjustment: fixture.request.adjustment,
      asof: fixture.request.asof,
      calendar: fixture.calendar,
      availability: fixture.availability,
      receivedAt: original.receivedAt,
      decisionAt: fixture.receiptPlan.decisionAt,
    };
    // The independent base intentionally does not establish admissible
    // availability. Every availability observation must follow final receipt.
    expect(() => normalizeAlpacaIexBars(original, normalization)).toThrow();
    const receiptBound = {
      ...normalization,
      availability: fixture.availability.map(fact => ({
        ...fact, availableAt: original.receivedAt,
      })),
    };
    const input = fixture.proposedShadowInput;
    const context = {
      runId: input.runId,
      sourceCommit: input.sourceCommit,
      expectedCalendarSha256: fixture.calendar.sha256,
      expectedWindow: {
        firstSessionOrdinal: 0,
        lastSessionOrdinal: 252,
        observationCount: 253,
      },
      rightsEvidenceSha256: input.data.rightsEvidenceSha256,
      policy: input.policy,
      costs: input.costs,
      controls: input.controls,
      portfolio: input.portfolio,
    };
    const candidate = buildAlpacaShadowCandidate(original, receiptBound, context);
    expect(candidate.status).toBe('candidate');
    if (candidate.status !== 'candidate') throw new Error('Constructed adapter rejected');
    expect(candidate.input.bars).toHaveLength(253);
    expect(candidate.receipt).toMatchObject({
      inputValidation: 'valid', decision: 'abstain', reason: 'unverified_data',
      effectAuthority: 'none', promotionAllowed: false,
    });
    expect(candidate.eligibility).toBe('unverified');
    expect(Object.keys(candidate.knownMissingGates)).toHaveLength(7);
    expect(Object.values(candidate.knownMissingGates))
      .toEqual(Array(7).fill('not_established'));
    expect(fixture.admission.productionRightsEstablished).toBe(false);
  });

  it.each(PROPOSED_NUMERIC_EDGE_CANDIDATES)(
    'checks independent proposed binary64 edge $exactBinary64', example => {
      const value = example.exactBinary64 === '2^-1074'
        ? Number.MIN_VALUE : Number(example.exactBinary64);
      expect(Number(example.proposedRepresentation)).toBe(value);
      expect(formatComparisonNumber(value)).toBe(example.proposedRepresentation);
    },
  );
});
