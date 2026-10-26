import { afterEach, describe, expect, it, vi } from 'vitest';
import * as checker from './alpaca-byte-review-checker.js';
import * as connector from './alpaca-iex-connector.js';
import * as contract from './alpaca-byte-review-contract.js';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import { buildAlpacaShadowCandidate } from './alpaca-shadow-candidate.js';
import {
  createConstructedOriginalProcessReviewAdapter,
  productionOriginalProcessReviewPreflight,
} from './alpaca-original-process-review-adapter.js';
import {
  makeConstructedAlpacaByteReviewFixture,
} from '../test-fixtures/alpaca-byte-review.js';

const profile = checker.constructedByteReviewProfile;
const evidenceHash = 'a'.repeat(64);
const credentials = {
  keyId: 'SYNTHETIC_KEY_ID_123456',
  secretKey: 'SYNTHETIC_SECRET_12345678901234567890',
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Adapter = ReturnType<typeof createConstructedOriginalProcessReviewAdapter>;

/**
 * Synthetic transport only. The connector itself supplies the retained
 * original and receipt. No DTO construction substitutes for connector issuance.
 */
async function material(attemptId: string, spy = false) {
  const large = spy ? makeConstructedAlpacaByteReviewFixture() : null;
  const sessions = [
    '2024-01-02T00:00:00.000Z',
    '2024-01-03T00:00:00.000Z',
  ].map((providerTimestamp, sessionOrdinal) => ({
    providerTimestamp,
    sessionOrdinal,
    closedAt: providerTimestamp,
    completedAt: providerTimestamp,
    completed: true as const,
    completionEvidenceSha256: evidenceHash,
  }));
  const calendar = large?.calendar ?? {
    symbol: profile.request.symbol,
    sessions,
    sha256: alpacaSessionCalendarDigest({
      symbol: profile.request.symbol,
      sessions,
    }),
  };
  const request = large?.request ?? {
    enabled: true as const,
    symbol: profile.request.symbol,
    feed: profile.request.feed,
    adjustment: profile.request.adjustment,
    start: profile.request.start,
    end: profile.request.end,
    asof: profile.request.asof,
    calendar,
  };
  const receivedAt = large?.receiptPlan.proposedReceivedAt ?? profile.receivedAt;
  const bodies = large?.responses.map(response => response.bodyText)
    ?? profile.pageBodies;

  vi.useFakeTimers();
  vi.setSystemTime(new Date(receivedAt));
  const urls: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input));
    const body = bodies[urls.length - 1];
    if (body === undefined) throw new Error('Unexpected synthetic request');
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  });
  const original = await connector.acquireAlpacaIexDailyBars(
    request, credentials, { fetcher: fetcher as typeof fetch },
  );
  const availability = calendar.sessions.map(session => ({
    providerTimestamp: session.providerTimestamp,
    availableAt: original.receivedAt,
    evidenceSha256: evidenceHash,
  }));
  const context = {
    runId: attemptId,
    sourceCommit: '9'.repeat(40),
    expectedCalendarSha256: calendar.sha256,
    expectedWindow: {
      firstSessionOrdinal: calendar.sessions[0].sessionOrdinal,
      lastSessionOrdinal: calendar.sessions[calendar.sessions.length - 1].sessionOrdinal,
      observationCount: calendar.sessions.length,
    },
    rightsEvidenceSha256: evidenceHash,
    policy: {
      scheduleSha256: evidenceHash,
      maxAgeMs: 0,
      exposureCap: { value: '1', precision: 1, scale: 0 },
    },
    costs: {
      status: 'unverified',
      evidenceSha256: evidenceHash,
      stressScenarioSha256: evidenceHash,
      commissionPerTrade: { value: '0', precision: 1, scale: 0 },
      spreadFraction: { value: '0', precision: 1, scale: 0 },
      slippageFraction: { value: '0', precision: 1, scale: 0 },
    },
    controls: {
      passiveSha256: evidenceHash,
      cashAssumptionSha256: evidenceHash,
    },
    portfolio: { state: 'unknown', snapshotSha256: evidenceHash },
  };
  const built = buildAlpacaShadowCandidate(original, {
    source: 'alpaca-data-v2',
    feed: 'iex',
    symbol: original.symbol,
    adjustment: original.adjustment,
    asof: original.asof,
    calendar,
    availability,
    receivedAt: original.receivedAt,
    decisionAt: original.receivedAt,
  }, context);
  if (built.status !== 'candidate') throw new Error('Synthetic candidate unavailable');

  const candidate = copy(built);
  const binding = copy({
    schema: 'gelt.review-before-discard-binding.v1',
    attemptId,
    revisions: { ...profile.revisions },
    source: {
      repositoryId: 1415613140,
      snapshotCommit: contract.snapshotCommit,
      connectorPin: { ...contract.connectorPin },
      runtimeClosureRevision: profile.runtimeClosureRevision,
    },
    request: original.request,
    receipt: {
      receivedAt: original.receivedAt,
      decisionAt: original.receivedAt,
    },
    pages: original.pages.map(({ page, byteLength, sha256 }) =>
      ({ page, byteLength, sha256 })),
    evidence: {
      calendar,
      availability,
      context,
      candidateCanonicalInput: built.canonicalInput,
      candidateReceipt: built.receipt,
      candidateManifest: built.manifest,
    },
    limits: { ...contract.reviewLimits },
    authority: { ...contract.reviewAuthority },
  });
  return { original, binding, candidate, fetcher, urls };
}

async function reserved() {
  const adapter = createConstructedOriginalProcessReviewAdapter();
  expect(adapter.beginCapture()).toBe(true);
  const f = await material(adapter.attemptId);
  const reservation = adapter.reserve(f.original, f.binding, f.candidate);
  expect(reservation).not.toBeNull();
  return { adapter, reservation: reservation!, ...f };
}

function complete(f: Awaited<ReturnType<typeof reserved>>) {
  const completion = f.adapter.completeReview(f.reservation);
  expect(completion).not.toBeNull();
  return completion!;
}

function expectClosed(snapshot: ReturnType<Adapter['snapshot']>) {
  expect(snapshot.favorableCurrent).toBe(false);
  expect(snapshot.current.disposal).toBe('not_established');
  expect(snapshot.current.execution).not.toBe('settled');
  expect(snapshot.captureReservations).toBeLessThanOrEqual(1);
  expect(snapshot.invocationReservations).toBeLessThanOrEqual(1);
  expect(snapshot.emissionReservations).toBeLessThanOrEqual(1);
  expect(snapshot.handoffAttempts).toBeLessThanOrEqual(1);
  expect(snapshot.receipts.length).toBeLessThanOrEqual(23);
  expect(contract.parseSettlementStructure(snapshot.current)).toEqual(snapshot.current);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('production boundary and constructed original-object adapter', () => {
  it('stops at the production guard before acquisition or checker allocation', () => {
    const acquire = vi.spyOn(connector, 'acquireAlpacaIexDailyBars');
    const allocate = vi.spyOn(checker, 'createConstructedByteReviewLane');
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const guard = productionOriginalProcessReviewPreflight();

    expect(guard).toMatchObject({
      scope: 'PRODUCTION_CLOSED',
      dispatchAllowed: false,
      settlement: {
        phase: 'preflight',
        outcome: 'unavailable',
        invocationId: null,
        review: 'not_attempted',
        execution: 'not_started',
        disposal: 'not_established',
      },
    });
    expect(Object.keys(guard).sort()).toEqual([
      'dispatchAllowed', 'scope', 'settlement',
    ]);
    expect(acquire).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    const forgedProducer = vi.fn();
    const callGuard = productionOriginalProcessReviewPreflight as
      (...args: unknown[]) => unknown;
    const callConstructed = createConstructedOriginalProcessReviewAdapter as
      (...args: unknown[]) => unknown;
    expect(() => callGuard({ enabled: true, reviewer: forgedProducer }))
      .toThrow('Original-process byte review unavailable');
    expect(() => callConstructed({ profile, reviewer: forgedProducer }))
      .toThrow('Original-process byte review unavailable');
    expect(forgedProducer).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('uses the fixed checker and authentic incomplete completion', async () => {
    const f = await reserved();
    expect(connector.isConnectorIssuedAlpacaAcquisition(f.original)).toBe(true);
    expect(Object.isFrozen(f.original)).toBe(true);
    expect(Reflect.ownKeys(f.reservation)).toEqual([]);

    const ticket = complete(f);
    expect(Reflect.ownKeys(ticket)).toEqual([]);
    const accepted = f.adapter.acceptCompletion(f.reservation, ticket);
    expect(accepted).toMatchObject({
      scope: 'constructed_only',
      accepted: true,
      reason: 'none',
      uncertainty: 'latched',
      verdict: { outcome: 'incomplete' },
    });
    expect(accepted.verdict!.checks.map(check => check.id)).toEqual(contract.checkIds);
    for (const check of accepted.verdict!.checks) {
      if ([
        'C07_CLOSURE_REVISIONS', 'C13_REVIEWER_ADMISSION', 'C14_HANDLING',
      ].includes(check.id)) {
        expect(check).toMatchObject({ result: 'unknown', reason: 'evidence_missing' });
      } else {
        expect(check).toMatchObject({ result: 'pass', reason: 'none' });
      }
    }
    expect(f.adapter.snapshot().current).toMatchObject({
      phase: 'verdict',
      outcome: 'incomplete',
      review: 'incomplete',
      execution: 'unknown',
      uncertainty: 'latched',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.urls.map(url => new URL(url).searchParams.get('limit'))).toEqual(['2', '1']);
    expectClosed(f.adapter.snapshot());
  });

  it('accepts an authentic negative vector without substituting a weaker checker', async () => {
    const adapter = createConstructedOriginalProcessReviewAdapter();
    expect(adapter.beginCapture()).toBe(true);
    const f = await material(adapter.attemptId);
    f.binding.pages[0].sha256 = 'b'.repeat(64);
    const reservation = adapter.reserve(f.original, f.binding, f.candidate)!;
    expect(reservation).not.toBeNull();
    const ticket = adapter.completeReview(reservation)!;
    const accepted = adapter.acceptCompletion(reservation, ticket);
    expect(accepted.accepted).toBe(true);
    expect(accepted.verdict?.outcome).toBe('rejected');
    expect(accepted.verdict?.checks.find(check => check.id === 'C02_PAGE_BYTES'))
      .toMatchObject({ result: 'fail', reason: 'page_mismatch' });
    expect(adapter.snapshot().current).toMatchObject({
      outcome: 'rejected', review: 'rejected', uncertainty: 'latched',
    });
    expectClosed(adapter.snapshot());
  });

  it('checks issuance before reading a clone or supplied getters', async () => {
    const adapter = createConstructedOriginalProcessReviewAdapter();
    expect(adapter.beginCapture()).toBe(true);
    const f = await material(adapter.attemptId);
    const clone = copy(f.original);
    let getters = 0;
    Object.defineProperty(clone, 'request', {
      enumerable: true,
      get() { getters++; throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
    });
    const binding = Object.defineProperty({}, 'attemptId', {
      enumerable: true,
      get() { getters++; throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
    });
    expect(adapter.reserve(clone, binding, {})).toBeNull();
    expect(getters).toBe(0);
    expect(adapter.snapshot().current).toMatchObject({
      invocationId: null,
      outcome: 'provenance_mismatch',
      review: 'not_attempted',
      execution: 'unknown',
    });
    expect(adapter.snapshot().historicalVerdicts).toEqual([]);
    expectClosed(adapter.snapshot());
  });

  it('rejects replay of a previously reserved genuine original', async () => {
    const first = await reserved();
    const other = createConstructedOriginalProcessReviewAdapter();
    expect(other.beginCapture()).toBe(true);
    const rebound = copy(first.binding);
    rebound.attemptId = other.attemptId;
    expect(other.reserve(first.original, rebound, first.candidate)).toBeNull();
    expect(other.snapshot().current).toMatchObject({
      outcome: 'unknown',
      review: 'unknown',
      execution: 'unknown',
    });
    expect(other.snapshot().current.invocationId).not.toBeNull();
    expect(other.snapshot().historicalVerdicts).toEqual([]);
    expect(other.completeReview(first.reservation)).toBeNull();
    expectClosed(other.snapshot());
  });

  it('rejects cross-adapter reservations and completion tickets', async () => {
    const f = await reserved();
    const g = await reserved();
    const firstTicket = complete(f);
    const secondTicket = complete(g);

    expect(f.adapter.acceptCompletion(g.reservation, firstTicket).accepted).toBe(false);
    expect(g.adapter.acceptCompletion(g.reservation, firstTicket).accepted).toBe(false);
    expect(f.adapter.acceptCompletion(f.reservation, firstTicket).accepted).toBe(false);
    expect(g.adapter.acceptCompletion(g.reservation, secondTicket).accepted).toBe(false);
    for (const adapter of [f.adapter, g.adapter]) {
      expect(adapter.snapshot().current).toMatchObject({
        outcome: 'verdict_authenticity_failed',
        review: 'unknown',
        uncertainty: 'latched',
      });
      expect(adapter.snapshot().historicalVerdicts).toEqual([]);
      expectClosed(adapter.snapshot());
    }
  });

  it('rejects forged DTOs and consumes the sole acceptance attempt', async () => {
    const f = await reserved();
    const ticket = complete(f);
    const forged = {
      schema: 'gelt.review-before-discard-verdict.v1',
      attemptId: f.adapter.attemptId,
      outcome: 'consistent_unverified',
      checks: contract.checkIds.map(id => ({ id, result: 'pass', reason: 'none' })),
    };
    expect(f.adapter.acceptCompletion(f.reservation, forged)).toMatchObject({
      accepted: false, reason: 'authenticity_failed', verdict: null,
    });
    expect(f.adapter.acceptCompletion(f.reservation, ticket).accepted).toBe(false);
    expect(f.adapter.snapshot().historicalVerdicts).toEqual([]);
    expectClosed(f.adapter.snapshot());
  });

  it('invalidates duplicate production or acceptance without a second review', async () => {
    const f = await reserved();
    const ticket = complete(f);
    const accepted = f.adapter.acceptCompletion(f.reservation, ticket);
    expect(accepted.accepted).toBe(true);
    const history = f.adapter.snapshot();
    expect(f.adapter.completeReview(f.reservation)).toBeNull();
    expect(f.adapter.acceptCompletion(f.reservation, ticket).accepted).toBe(false);
    const current = f.adapter.snapshot();
    expect(current.current).toMatchObject({
      outcome: 'verdict_acceptance_failed',
      review: 'unknown',
      uncertainty: 'latched',
    });
    expect(current.receipts.slice(0, history.receipts.length)).toEqual(history.receipts);
    expect(current.historicalVerdicts).toEqual(history.historicalVerdicts);
    expect(current.receipts.filter(receipt => receipt.kind === 'review_dispatched'))
      .toHaveLength(1);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expectClosed(current);
  });

  it('detects binding mutation and equal-looking subtree substitution at acceptance', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.binding.evidence.context.rightsEvidenceSha256 = 'b'.repeat(64);
    expect(f.adapter.acceptCompletion(f.reservation, ticket)).toMatchObject({
      accepted: false, reason: 'provenance_mismatch',
    });

    const g = await reserved();
    const otherTicket = complete(g);
    g.candidate.input = copy(g.candidate.input);
    expect(g.adapter.acceptCompletion(g.reservation, otherTicket)).toMatchObject({
      accepted: false, reason: 'provenance_mismatch',
    });
    expectClosed(f.adapter.snapshot());
    expectClosed(g.adapter.snapshot());
  });

  it.each(['cancelled', 'late', 'clock'] as const)(
    'rejects %s before acceptance without settlement or release claims',
    async kind => {
      const f = await reserved();
      const ticket = complete(f);
      if (kind === 'cancelled') f.adapter.queueCancellation();
      if (kind === 'late') f.adapter.advanceFixtureElapsedTo(60000);
      if (kind === 'clock') f.adapter.markFixtureClockUnavailable();
      expect(f.adapter.acceptCompletion(f.reservation, ticket).accepted).toBe(false);
      expect(f.adapter.snapshot().current.outcome).toBe(
        kind === 'cancelled' ? 'cancelled' : kind === 'late' ? 'timed_out' : 'unknown',
      );
      expect(f.adapter.snapshot().current.review).toBe('unknown');
      expectClosed(f.adapter.snapshot());
    },
  );

  it('accepts at 59999ms and invalidates at the exact deadline', async () => {
    const f = await reserved();
    expect(f.adapter.advanceFixtureElapsedTo(59999)).toBe(true);
    const ticket = complete(f);
    expect(f.adapter.acceptCompletion(f.reservation, ticket).accepted).toBe(true);
    expect(f.adapter.advanceFixtureElapsedTo(60000)).toBe(true);
    expect(f.adapter.snapshot().current).toMatchObject({
      outcome: 'timed_out', review: 'unknown', uncertainty: 'latched',
    });
    expectClosed(f.adapter.snapshot());
  });

  it('does not dispatch the reviewer after known cancellation', async () => {
    const f = await reserved();
    f.adapter.queueCancellation();
    expect(f.adapter.completeReview(f.reservation)).toBeNull();
    expect(f.adapter.snapshot().receipts.some(receipt =>
      receipt.kind === 'review_dispatched')).toBe(false);
    expect(f.adapter.snapshot().current.outcome).toBe('cancelled');
    expectClosed(f.adapter.snapshot());
  });

  it('does not admit SPY253 by applying compiled BRCFIX revision labels', async () => {
    const adapter = createConstructedOriginalProcessReviewAdapter();
    expect(adapter.beginCapture()).toBe(true);
    const f = await material(adapter.attemptId, true);
    expect(connector.isConnectorIssuedAlpacaAcquisition(f.original)).toBe(true);
    expect(f.original.symbol).toBe('SPY');
    expect(f.original.observations).toHaveLength(253);

    const diagnostic = checker.inspectConstructedByteReview(
      f.original, f.binding, f.candidate,
    );
    expect(diagnostic.find(check => check.id === 'C03_REQUEST_CURSOR')?.result)
      .toBe('fail');
    expect(adapter.reserve(f.original, f.binding, f.candidate)).toBeNull();
    expect(adapter.snapshot().historicalVerdicts).toEqual([]);
    expect(adapter.snapshot().current).toMatchObject({
      outcome: 'unknown', review: 'unknown', execution: 'unknown',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    expectClosed(adapter.snapshot());
  });
});

describe('immutable sole emission and private acknowledgement', () => {
  it('binds immutable E and ack while later adverse events update only C', async () => {
    const f = await reserved();
    const ticket = complete(f);
    expect(f.adapter.acceptCompletion(f.reservation, ticket).accepted).toBe(true);
    const emitted = f.adapter.emitSummary()!;
    expect(emitted).not.toBeNull();
    expect(contract.parseStatusStructure(emitted.status)).toEqual(emitted.status);
    expect(emitted.bytes).toBe(contract.encodeStatusComparison(emitted.status));
    expect(emitted.status).toMatchObject({
      phase: 'summary',
      outcome: 'incomplete',
      review: 'incomplete',
      execution: 'unknown',
      disposal: 'not_established',
      summaryDelivery: 'not_established',
      decision: 'abstain',
      reason: 'unverified_data',
      eligibility: 'unverified',
      effectAuthority: 'none',
      promotionAllowed: false,
      retryAllowed: false,
    });
    for (const key of [
      'phase', 'outcome', 'review', 'execution', 'disposal', 'summaryDelivery',
    ] as const) expect(emitted.status[key]).toBe(emitted.source[key]);
    expect(Object.isFrozen(emitted)).toBe(true);
    expect(Object.isFrozen(emitted.source)).toBe(true);
    expect(Object.isFrozen(emitted.status)).toBe(true);

    const recipient = f.adapter.recipientComplete()!;
    expect(recipient).not.toBeNull();
    expect(Reflect.ownKeys(recipient)).toEqual([]);
    expect(f.adapter.acknowledge(recipient)).toEqual({
      schema: 'gelt.byte-review-summary-ack.v2',
      attemptId: f.adapter.attemptId,
      delivery: 'acknowledged',
    });
    const history = f.adapter.snapshot();
    f.adapter.queueCancellation();
    const later = f.adapter.snapshot();
    expect(later.current).toMatchObject({
      phase: 'summary',
      outcome: 'cancelled',
      review: 'unknown',
      summaryDelivery: 'acknowledged',
      execution: 'unknown',
      disposal: 'not_established',
    });
    expect(later.emitted).toBe(emitted);
    expect(later.emitted?.status.summaryDelivery).toBe('not_established');
    expect(later.emitted?.status.outcome).toBe('incomplete');
    expect(later.receipts.slice(0, history.receipts.length)).toEqual(history.receipts);
    expect(f.adapter.emitSummary()).toBeNull();
    expect(f.adapter.recipientComplete()).toBeNull();
    expectClosed(later);
  });

  it('rejects JSON/cross-adapter/replayed ack without erasing a valid ack', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.adapter.acceptCompletion(f.reservation, ticket);
    const emitted = f.adapter.emitSummary()!;
    const recipient = f.adapter.recipientComplete()!;

    const g = await reserved();
    const otherTicket = complete(g);
    g.adapter.acceptCompletion(g.reservation, otherTicket);
    g.adapter.emitSummary();
    const otherRecipient = g.adapter.recipientComplete()!;

    expect(f.adapter.acknowledge({
      schema: 'gelt.byte-review-summary-ack.v2',
      attemptId: f.adapter.attemptId,
      delivery: 'acknowledged',
    })).toBeNull();
    expect(f.adapter.acknowledge(otherRecipient)).toBeNull();
    expect(f.adapter.acknowledge(recipient)).not.toBeNull();
    expect(f.adapter.acknowledge(recipient)).toBeNull();
    expect(f.adapter.snapshot().current).toMatchObject({
      outcome: 'summary_failed',
      review: 'incomplete',
      summaryDelivery: 'acknowledged',
    });
    expect(f.adapter.snapshot().emitted).toBe(emitted);
    expect(f.adapter.snapshot().receipts.filter(receipt =>
      receipt.kind === 'acknowledged')).toHaveLength(1);
    expectClosed(f.adapter.snapshot());
  });

  it('consumes failed emission once and retains no exception text', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.adapter.acceptCompletion(f.reservation, ticket);
    vi.spyOn(contract, 'encodeStatusComparison').mockImplementationOnce(() => {
      throw new Error('SYNTHETIC_PRIVATE_FRAGMENT');
    });
    expect(f.adapter.emitSummary()).toBeNull();
    expect(f.adapter.emitSummary()).toBeNull();
    expect(f.adapter.recipientComplete()).toBeNull();
    const snapshot = f.adapter.snapshot();
    expect(snapshot).toMatchObject({
      emitted: null,
      emissionReservations: 1,
      handoffAttempts: 0,
      current: { outcome: 'summary_failed' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('SYNTHETIC_PRIVATE_FRAGMENT');
    expectClosed(snapshot);
  });

  it('preserves higher-priority failure over a reporting failure', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.adapter.acceptCompletion(f.reservation, ticket);
    f.adapter.acceptCompletion(f.reservation, ticket);
    const emitted = f.adapter.emitSummary()!;
    expect(emitted.status.outcome).toBe('verdict_acceptance_failed');
    expect(f.adapter.acknowledge({})).toBeNull();
    expect(f.adapter.snapshot().current.outcome).toBe('verdict_acceptance_failed');
    expect(f.adapter.snapshot().receipts.some(receipt =>
      receipt.kind === 'ack_invalid')).toBe(true);
    expect(f.adapter.snapshot().emitted).toBe(emitted);
    expectClosed(f.adapter.snapshot());
  });

  it('drops only local checker references and keeps immutable verdict history', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.adapter.acceptCompletion(f.reservation, ticket);
    const history = f.adapter.snapshot().historicalVerdicts;
    expect(f.adapter.dropLocalCheckerReferences()).toBe(true);
    expect(f.adapter.dropLocalCheckerReferences()).toBe(false);
    expect(f.adapter.snapshot().historicalVerdicts).toEqual(history);
    expect(f.adapter.snapshot().current).toMatchObject({
      outcome: 'incomplete',
      review: 'incomplete',
      execution: 'unknown',
      disposal: 'not_established',
    });
    expectClosed(f.adapter.snapshot());
  });

  it('keeps the receipt vocabulary bounded under repeated invalid calls', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.adapter.acceptCompletion(f.reservation, ticket);
    f.adapter.emitSummary();
    const recipient = f.adapter.recipientComplete()!;
    f.adapter.acknowledge(recipient);
    for (let i = 0; i < 100; i++) {
      f.adapter.beginCapture();
      f.adapter.reserve({}, {}, {});
      f.adapter.completeReview({});
      f.adapter.acceptCompletion({}, {});
      f.adapter.queueCancellation();
      f.adapter.markFixtureClockUnavailable();
      f.adapter.advanceFixtureElapsedTo(-1);
      f.adapter.acknowledge({});
      f.adapter.emitSummary();
    }
    expect(f.adapter.snapshot().current.summaryDelivery).toBe('acknowledged');
    expectClosed(f.adapter.snapshot());
  });

  it('exposes only the existing sanitized status fields at emission', async () => {
    const f = await reserved();
    const ticket = complete(f);
    f.adapter.acceptCompletion(f.reservation, ticket);
    const emitted = f.adapter.emitSummary()!;
    expect(Object.keys(emitted.status).sort()).toEqual([
      'schema', 'attemptId', 'phase', 'outcome', 'review', 'execution',
      'disposal', 'summaryDelivery', 'decision', 'reason', 'eligibility',
      'effectAuthority', 'promotionAllowed', 'retryAllowed',
    ].sort());
    expect(Buffer.byteLength(emitted.bytes, 'utf8')).toBeLessThanOrEqual(1024);
    for (const forbidden of [
      profile.pageBodies[0],
      f.original.pages[0].bodyBase64,
      f.binding.evidence.candidateCanonicalInput,
      'SYNTHETIC_NEXT',
      credentials.keyId,
      credentials.secretKey,
      'bindingSha256',
      'invocationId',
      'checks',
      'bodyBase64',
      'candidateManifest',
    ]) expect(emitted.bytes).not.toContain(forbidden);
  });
});

describe('synthetic fault observations preserve unknowns', () => {
  it('distinguishes a fixed-producer throw from a reservation failure', async () => {
    const allocate = checker.createConstructedByteReviewLane;
    vi.spyOn(checker, 'createConstructedByteReviewLane').mockImplementationOnce(() => {
      const lane = allocate();
      return Object.freeze({
        ...lane,
        produce(): object { throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); },
      });
    });
    const f = await reserved();
    expect(f.adapter.completeReview(f.reservation)).toBeNull();
    expect(f.adapter.snapshot().current).toMatchObject({
      outcome: 'incomplete',
      review: 'incomplete',
      execution: 'unknown',
      uncertainty: 'latched',
    });
    expect(f.adapter.snapshot().historicalVerdicts).toEqual([]);
    expect(f.adapter.snapshot().receipts.some(receipt =>
      receipt.kind === 'reviewer_error')).toBe(true);
    expect(JSON.stringify(f.adapter.snapshot())).not.toContain('SYNTHETIC_PRIVATE_FRAGMENT');
    expect(f.adapter.dropLocalCheckerReferences()).toBe(true);
    expectClosed(f.adapter.snapshot());
  });

  it('does not classify an unestablished issuance check as a definite mismatch', async () => {
    const adapter = createConstructedOriginalProcessReviewAdapter();
    adapter.beginCapture();
    const f = await material(adapter.attemptId);
    vi.spyOn(connector, 'isConnectorIssuedAlpacaAcquisition')
      .mockImplementationOnce(() => { throw new Error('SYNTHETIC_PRIVATE_FRAGMENT'); });
    expect(adapter.reserve(f.original, f.binding, f.candidate)).toBeNull();
    expect(adapter.snapshot().current).toMatchObject({
      outcome: 'unknown',
      invocationId: null,
      review: 'not_attempted',
      execution: 'unknown',
    });
    expect(adapter.snapshot().receipts.some(receipt =>
      receipt.kind === 'provenance_mismatch' || receipt.kind === 'reviewer_error'))
      .toBe(false);
    expect(JSON.stringify(adapter.snapshot())).not.toContain('SYNTHETIC_PRIVATE_FRAGMENT');
    expectClosed(adapter.snapshot());
  });

  it('does not fabricate a verdict after an unexpected acceptor exception', async () => {
    const allocate = checker.createConstructedByteReviewLane;
    vi.spyOn(checker, 'createConstructedByteReviewLane').mockImplementationOnce(() => {
      const lane = allocate();
      return Object.freeze({
        ...lane,
        accept(): checker.ConstructedAcceptance {
          throw new Error('SYNTHETIC_PRIVATE_FRAGMENT');
        },
      });
    });
    const f = await reserved();
    const ticket = complete(f);
    expect(f.adapter.acceptCompletion(f.reservation, ticket).accepted).toBe(false);
    expect(f.adapter.snapshot().current).toMatchObject({
      outcome: 'unknown', review: 'unknown', execution: 'unknown',
    });
    expect(f.adapter.snapshot().historicalVerdicts).toEqual([]);
    expect(JSON.stringify(f.adapter.snapshot())).not.toContain('SYNTHETIC_PRIVATE_FRAGMENT');
    expectClosed(f.adapter.snapshot());
  });

  // Source-owner integration of independent oracle F01/F06: out-of-order
  // observations must not create a later opportunity to acquire or dispatch.
  it('keeps pre-capture acknowledgement uncertainty closed to a later capture', () => {
    const acquire = vi.spyOn(connector, 'acquireAlpacaIexDailyBars');
    const adapter = createConstructedOriginalProcessReviewAdapter();
    expect(adapter.acknowledge(Object.freeze({}))).toBeNull();
    expect(adapter.beginCapture()).toBe(false);
    const observed = adapter.snapshot();
    expect(observed.captureReservations).toBe(0);
    expect(observed.invocationReservations).toBe(0);
    expect(observed.current).toMatchObject({
      outcome: 'unknown', review: 'not_attempted', execution: 'not_started',
      invocationId: null, uncertainty: 'latched',
    });
    expect(observed.receipts.some(receipt => receipt.kind === 'review_dispatched'))
      .toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expectClosed(observed);
  });

  it('does not dispatch after a completion is submitted before fixed production', async () => {
    const allocate = checker.createConstructedByteReviewLane;
    const produced = vi.fn();
    vi.spyOn(checker, 'createConstructedByteReviewLane').mockImplementationOnce(() => {
      const lane = allocate();
      return Object.freeze({
        ...lane,
        produce() {
          produced();
          return lane.produce();
        },
      });
    });
    const f = await reserved();
    expect(f.adapter.acceptCompletion(f.reservation, Object.freeze({})))
      .toMatchObject({ accepted: false, reason: 'authenticity_failed' });
    expect(f.adapter.completeReview(f.reservation)).toBeNull();
    expect(f.adapter.acceptCompletion(f.reservation, Object.freeze({})).accepted)
      .toBe(false);
    expect(produced).not.toHaveBeenCalled();
    const observed = f.adapter.snapshot();
    expect(observed.current).toMatchObject({
      outcome: 'verdict_authenticity_failed', review: 'unknown',
      execution: 'unknown', uncertainty: 'latched',
    });
    expect(observed.historicalVerdicts).toEqual([]);
    expect(observed.receipts.some(receipt => receipt.kind === 'review_dispatched'))
      .toBe(false);
    expectClosed(observed);
  });
});
