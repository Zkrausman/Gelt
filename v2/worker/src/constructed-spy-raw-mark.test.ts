import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonical, digest } from './ledger-canonical.js';
import { projectConstructedSpyG05 } from './constructed-spy-g05-projection.js';
import {
  matchesConstructedSpyRawMark,
  projectConstructedSpyRawMark,
} from './constructed-spy-raw-mark.js';
import { simulationRunSchema, snapshot, units, type SimulationRun } from './synthetic-simulation-economics.js';
import type { SpyDailyInputRequest } from './spy-daily-input-consistency.js';

vi.mock('./constructed-spy-g05-projection.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./constructed-spy-g05-projection.js')>();
  return { ...actual, projectConstructedSpyG05: vi.fn(actual.projectConstructedSpyG05) };
});

const projector = vi.mocked(projectConstructedSpyG05);
const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (value: number) => new Date(value).toISOString();
const plus = (value: string, amount: number) => iso(Date.parse(value) + amount);
const decimal = (value: string) => ({
  value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0,
});
const bytes = (value: unknown) => Buffer.from(canonical(value), 'utf8');

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(date + 'T00:00:00.000Z') + (daylight ? 4 : 5) * hour);
}

function dailyRequest(): SpyDailyInputRequest {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(sessionDate + 'T00:00:00.000Z') + day).toISOString().slice(0, 10);
    return {
      sessionDate, ordinal: 100 + index,
      dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate),
    };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const issuedAt = lastEnd;
  const receivedAt = plus(issuedAt, 1_000);
  const availableAt = plus(receivedAt, 1_000);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1',
    classification: 'constructed_offline_test',
    epochId: '33333333-3333-4333-8333-333333333333',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(availableAt, 1_000),
    current: {
      feed: 'iex', symbol: 'SPY', currency: 'USD', timeframe: '1Day', adjustment: 'all', asof: '2026-01-01',
      requestStart: calendar[0].dayStartsAt, requestEnd: plus(lastEnd, -1),
      issuedAt, receivedAt, availableAt, calendar,
      bars: calendar.map((row, index) => ({
        providerTimestamp: row.dayStartsAt, adjustedClose: decimal(index === 252 ? '2.00' : '1.00'),
      })),
    },
    predecessor: null,
    revision: 0,
  };
}

function config(evaluationAt: string): SimulationRun {
  return simulationRunSchema.parse({
    version: 2, runId: '44444444-4444-4444-8444-444444444444', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: decimal('20'), quantity: decimal('0') },
    costs: { commissionPerOrder: decimal('0.01'), spreadFraction: decimal('0'), slippageFraction: decimal('0') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 960_000, maxObservationAgeMs: 5_000,
    validThrough: plus(evaluationAt, hour), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  });
}

function validInput() {
  const daily = dailyRequest();
  const evaluationAt = plus(daily.decisionAt, 300);
  const run = config(evaluationAt);
  return {
    schema: 'gelt.constructed-spy-mark-g05-input.v1',
    classification: 'constructed_offline_test',
    dailyRequestText: canonical(daily),
    consumer: {
      config: run,
      portfolio: {
        snapshot: snapshot(run, units(run.genesis.cash, 8), units(run.genesis.quantity, 18), []),
        state: 'settled' as const,
      },
      lifecycleDisposition: 'settled',
      evaluationAt,
      controls: { passiveSha256: 'c'.repeat(64), cashAssumptionSha256: 'd'.repeat(64) },
    },
    mark: {
      schema: 'gelt.constructed-spy-raw-trade.v1',
      classification: 'constructed_offline_test',
      source: 'supplied_fixture',
      feed: 'iex',
      symbol: 'SPY',
      currency: 'USD',
      priceBasis: 'unadjusted_trade',
      tradeId: 'trade-1',
      price: decimal('3'),
      providerTimestamp: plus(daily.decisionAt, 100),
      receivedAt: plus(daily.decisionAt, 150),
      availableAt: plus(daily.decisionAt, 200),
    },
  };
}

function retime(input: ReturnType<typeof validInput>, evaluationAt: string, validThrough = evaluationAt) {
  input.consumer.evaluationAt = evaluationAt;
  input.consumer.config.validThrough = validThrough;
  input.consumer.portfolio.snapshot = snapshot(
    input.consumer.config,
    units(input.consumer.config.genesis.cash, 8),
    units(input.consumer.config.genesis.quantity, 18),
    [],
  );
}

function markTimes(input: ReturnType<typeof validInput>, provider: string, received: string, available: string) {
  input.mark.providerTimestamp = provider;
  input.mark.receivedAt = received;
  input.mark.availableAt = available;
}

describe('constructed SPY raw mark binding', () => {
  beforeEach(() => projector.mockClear());

  it('derives raw price 3 instead of signal close 2 and matches the complete legacy projection', () => {
    const input = validInput();
    const raw = bytes(input);
    const result = projectConstructedSpyRawMark(raw);
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;

    const dailyRequestTextSha256 = digest(input.dailyRequestText);
    const markEvidenceSha256 = digest(canonical({
      schema: 'gelt.constructed-spy-mark-evidence.v1',
      classification: 'constructed_offline_test',
      dailyRequestTextSha256,
      consumer: input.consumer,
      mark: input.mark,
    }));
    const observation = {
      referencePrice: decimal('3'),
      observedAt: input.mark.providerTimestamp,
      availableAt: input.mark.availableAt,
      evidenceSha256: markEvidenceSha256,
    };
    const expectedProjectionInput = canonical({
      schema: 'gelt.constructed-spy-g05-projection-input.v1',
      dailyRequestText: input.dailyRequestText,
      consumer: {
        ...input.consumer,
        observation,
        markBasis: 'constructed_raw_reference',
        corporateActionState: 'constructed_none',
      },
    });
    expect(result.projectionInputText).toBe(expectedProjectionInput);
    const oracle = projectConstructedSpyG05(Buffer.from(expectedProjectionInput, 'utf8'));
    expect(result.projection).toEqual(oracle);
    expect(result.projection.observation.referencePrice).toEqual(decimal('3'));
    expect(JSON.parse(result.projection.ruleInputText).bars[252].adjustedClose).toEqual(decimal('2.00'));
    expect(result.projection.observation.evidenceSha256).toBe(result.markEvidenceSha256);
    expect(result.originalMarkPersistence).toBe('not_performed_by_this_api');
    expect(result.sessionEligibility).toBe('not_established');
    expect(projector).toHaveBeenCalledTimes(2); // one wrapper call and this independent oracle call
  });

  it('rejects wrong feed and impossible capture chronology before calling the legacy projector', () => {
    const wrongFeed = validInput();
    wrongFeed.mark.feed = 'sip';
    expect(projectConstructedSpyRawMark(bytes(wrongFeed))).toEqual({
      schema: 'gelt.constructed-spy-mark-g05.v1', status: 'rejected', reason: 'invalid_input',
    });
    expect(projector).not.toHaveBeenCalled();

    const wrongClassification = validInput();
    wrongClassification.consumer.config.classification = 'declared_market_uncalibrated';
    expect(projectConstructedSpyRawMark(bytes(wrongClassification)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();

    const reversed = validInput();
    reversed.mark.receivedAt = plus(reversed.mark.providerTimestamp, -1);
    expect(projectConstructedSpyRawMark(bytes(reversed)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();
  });

  it.each([
    ['price final newline', (input: ReturnType<typeof validInput>) => {
      input.mark.price.value = '3\n'; input.mark.price.precision = 2;
    }],
    ['control hash final newline', (input: ReturnType<typeof validInput>) => { input.consumer.controls.passiveSha256 = 'c'.repeat(64) + '\n'; }],
    ['trade ID final newline', (input: ReturnType<typeof validInput>) => { input.mark.tradeId = 'trade-1\n'; }],
  ])('rejects %s before projector invocation', (_name, mutate) => {
    const input = validInput();
    mutate(input);
    expect(projectConstructedSpyRawMark(bytes(input))).toEqual({
      schema: 'gelt.constructed-spy-mark-g05.v1', status: 'rejected', reason: 'invalid_input',
    });
    expect(projector).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong symbol', (input: ReturnType<typeof validInput>) => { input.mark.symbol = 'QQQ'; }],
    ['wrong currency', (input: ReturnType<typeof validInput>) => { input.mark.currency = 'EUR'; }],
    ['adjusted close basis', (input: ReturnType<typeof validInput>) => { input.mark.priceBasis = 'adjusted_close'; }],
    ['non-fixture source vocabulary', (input: ReturnType<typeof validInput>) => { input.mark.source = 'provider'; }],
    ['actual-market mark classification', (input: ReturnType<typeof validInput>) => { input.mark.classification = 'declared_market_uncalibrated'; }],
    ['actual-market outer classification', (input: ReturnType<typeof validInput>) => { input.classification = 'declared_market_uncalibrated'; }],
  ])('rejects %s locally', (_name, mutate) => {
    const input = validInput();
    mutate(input);
    expect(projectConstructedSpyRawMark(bytes(input)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();
  });

  it('requires a closed mark shape and complete trade IDs of at most 64 ASCII characters', () => {
    const maximumId = validInput();
    maximumId.mark.tradeId = 'a'.repeat(64);
    expect(projectConstructedSpyRawMark(bytes(maximumId)).status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const longId = validInput();
    longId.mark.tradeId = 'a'.repeat(65);
    expect(projectConstructedSpyRawMark(bytes(longId)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();

    const extraKey = validInput();
    const withExtra = { ...extraKey, mark: { ...extraKey.mark, status: 'filled' } };
    expect(projectConstructedSpyRawMark(bytes(withExtra)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();

    const missingTimestamp = validInput();
    const { providerTimestamp: _providerTimestamp, ...missingMark } = missingTimestamp.mark;
    expect(projectConstructedSpyRawMark(bytes({ ...missingTimestamp, mark: missingMark })).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();
  });

  it.each([
    ['provider after receipt', (input: ReturnType<typeof validInput>) =>
      markTimes(input, plus(input.mark.receivedAt, 1), input.mark.receivedAt, input.mark.availableAt)],
    ['receipt after availability', (input: ReturnType<typeof validInput>) =>
      markTimes(input, input.mark.providerTimestamp, plus(input.mark.availableAt, 1), input.mark.availableAt)],
    ['availability after evaluation', (input: ReturnType<typeof validInput>) =>
      markTimes(input, input.mark.providerTimestamp, input.mark.receivedAt, plus(input.consumer.evaluationAt, 1))],
    ['future mark', (input: ReturnType<typeof validInput>) => {
      const future = plus(input.consumer.evaluationAt, 1);
      markTimes(input, future, plus(future, 1), plus(future, 2));
    }],
    ['negative epoch timestamp', (input: ReturnType<typeof validInput>) => {
      input.mark.providerTimestamp = '1969-12-31T23:59:59.999Z';
    }],
    ['noncanonical timestamp', (input: ReturnType<typeof validInput>) => {
      input.mark.providerTimestamp = '2026-01-01T00:00:00.000+00:00';
    }],
  ])('rejects impossible %s chronology locally', (_name, mutate) => {
    const input = validInput();
    mutate(input);
    expect(projectConstructedSpyRawMark(bytes(input)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();
  });

  it('allows equal capture boundaries but delegates strict post-decision timing to the projector', () => {
    const equalCapture = validInput();
    const at = plus(JSON.parse(equalCapture.dailyRequestText).decisionAt as string, 100);
    retime(equalCapture, at);
    markTimes(equalCapture, at, at, at);
    expect(projectConstructedSpyRawMark(bytes(equalCapture)).status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const exactDecision = validInput();
    const decisionAt = JSON.parse(exactDecision.dailyRequestText).decisionAt as string;
    markTimes(exactDecision, decisionAt, plus(decisionAt, 1), plus(decisionAt, 2));
    expect(projectConstructedSpyRawMark(bytes(exactDecision)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const preDecision = validInput();
    const before = plus(JSON.parse(preDecision.dailyRequestText).decisionAt as string, -1);
    markTimes(preDecision, before, plus(before, 1), plus(before, 2));
    expect(projectConstructedSpyRawMark(bytes(preDecision)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);
  });

  it('preserves the legacy observation-age, decision-age, and validThrough boundaries', () => {
    const exactObservationAge = validInput();
    const decision = JSON.parse(exactObservationAge.dailyRequestText).decisionAt as string;
    const evaluation = plus(decision, 900_000);
    retime(exactObservationAge, evaluation);
    const observed = plus(evaluation, -5_000);
    markTimes(exactObservationAge, observed, plus(observed, 1), evaluation);
    expect(projectConstructedSpyRawMark(bytes(exactObservationAge)).status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const tooOldObservation = validInput();
    const decision2 = JSON.parse(tooOldObservation.dailyRequestText).decisionAt as string;
    const evaluation2 = plus(decision2, 900_000);
    retime(tooOldObservation, evaluation2);
    const observed2 = plus(evaluation2, -5_001);
    markTimes(tooOldObservation, observed2, plus(observed2, 1), evaluation2);
    expect(projectConstructedSpyRawMark(bytes(tooOldObservation)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const exactDecisionAge = validInput();
    const decision3 = JSON.parse(exactDecisionAge.dailyRequestText).decisionAt as string;
    const evaluation3 = plus(decision3, 960_000);
    retime(exactDecisionAge, evaluation3, evaluation3);
    const observed3 = plus(evaluation3, -5_000);
    markTimes(exactDecisionAge, observed3, plus(observed3, 1), evaluation3);
    expect(projectConstructedSpyRawMark(bytes(exactDecisionAge)).status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const tooOldDecision = validInput();
    const decision4 = JSON.parse(tooOldDecision.dailyRequestText).decisionAt as string;
    const evaluation4 = plus(decision4, 960_001);
    retime(tooOldDecision, evaluation4, plus(evaluation4, hour));
    const observed4 = plus(evaluation4, -5_000);
    markTimes(tooOldDecision, observed4, plus(observed4, 1), evaluation4);
    expect(projectConstructedSpyRawMark(bytes(tooOldDecision)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const outsideValidity = validInput();
    const decision5 = JSON.parse(outsideValidity.dailyRequestText).decisionAt as string;
    const evaluation5 = plus(decision5, 1_000);
    retime(outsideValidity, evaluation5, plus(evaluation5, -1));
    const observed5 = plus(decision5, 100);
    markTimes(outsideValidity, observed5, plus(observed5, 1), plus(observed5, 2));
    expect(projectConstructedSpyRawMark(bytes(outsideValidity)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);
  });

  it('does not use a fresh receive time to refresh a pre-decision provider mark', () => {
    const input = validInput();
    const decision = JSON.parse(input.dailyRequestText).decisionAt as string;
    const provider = plus(decision, -900_000);
    markTimes(input, provider, plus(decision, 100), plus(decision, 200));
    expect(projectConstructedSpyRawMark(bytes(input)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid delayed SIP daily signal separate from the supplied IEX mark', () => {
    const input = validInput();
    const daily = JSON.parse(input.dailyRequestText) as SpyDailyInputRequest;
    const lastEnd = daily.current.calendar[252].dayEndsAt;
    daily.current.feed = 'sip';
    daily.current.issuedAt = plus(lastEnd, 900_000);
    daily.current.receivedAt = plus(daily.current.issuedAt, 1_000);
    daily.current.availableAt = plus(daily.current.receivedAt, 1_000);
    daily.decisionAt = plus(daily.current.availableAt, 1_000);
    input.dailyRequestText = canonical(daily);
    const evaluation = plus(daily.decisionAt, 300);
    retime(input, evaluation);
    markTimes(input, plus(daily.decisionAt, 100), plus(daily.decisionAt, 150), plus(daily.decisionAt, 200));

    const result = projectConstructedSpyRawMark(bytes(input));
    expect(result.status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);
    if (result.status !== 'projected') return;
    expect(result.markRecord.feed).toBe('iex');
    expect(JSON.parse(result.projectionInputText).dailyRequestText).toBe(input.dailyRequestText);
    expect(result.projection.observation.referencePrice).toEqual(input.mark.price);
    expect(result.rights).toBe('not_established');
    expect(result.tradeEligibility).toBe('not_established');
  });

  it('preserves decimal spellings and rejects invalid positivity, grammar, precision, and scale', () => {
    for (const value of ['3.00', '9'.repeat(38), '0.' + '0'.repeat(17) + '1']) {
      projector.mockClear();
      const input = validInput();
      input.mark.price = decimal(value);
      const result = projectConstructedSpyRawMark(bytes(input));
      expect(result.status).toBe('projected');
      if (result.status === 'projected') expect(result.markRecord.price.value).toBe(value);
      expect(projector).toHaveBeenCalledTimes(1);
    }

    const invalidPrices = [
      decimal('0'),
      { value: '-1', precision: 2, scale: 0 },
      { value: '03', precision: 2, scale: 0 },
      { value: '9'.repeat(39), precision: 39, scale: 0 },
      { value: '0.' + '0'.repeat(18) + '1', precision: 20, scale: 19 },
    ];
    for (const invalid of invalidPrices) {
      projector.mockClear();
      const input = validInput();
      input.mark.price = invalid;
      expect(projectConstructedSpyRawMark(bytes(input)).status).toBe('rejected');
      expect(projector).not.toHaveBeenCalled();
    }
  });

  it('binds exact outer and daily text while preserving canonical-equivalent outer projection', () => {
    const input = validInput();
    const original = projectConstructedSpyRawMark(bytes(input));
    expect(original.status).toBe('projected');
    if (original.status !== 'projected') return;

    const lexicalOuter = Buffer.concat([Buffer.from(' \n', 'utf8'), bytes(input)]);
    const outerVariant = projectConstructedSpyRawMark(lexicalOuter);
    expect(outerVariant.status).toBe('projected');
    if (outerVariant.status === 'projected') {
      expect(outerVariant.projection).toEqual(original.projection);
      expect(outerVariant.originalInputSha256).not.toBe(original.originalInputSha256);
      expect(outerVariant.bindingId).not.toBe(original.bindingId);
    }

    const dailyVariant = validInput();
    dailyVariant.dailyRequestText = '\n' + dailyVariant.dailyRequestText + '\n';
    const dailyResult = projectConstructedSpyRawMark(bytes(dailyVariant));
    expect(dailyResult.status).toBe('projected');
    if (dailyResult.status === 'projected') {
      expect(dailyResult.dailyRequestTextSha256).not.toBe(original.dailyRequestTextSha256);
      expect(dailyResult.markEvidenceSha256).not.toBe(original.markEvidenceSha256);
    }

    const changedMark = validInput();
    changedMark.mark.tradeId = 'trade-2';
    changedMark.mark.price = decimal('3.00');
    changedMark.mark.receivedAt = plus(changedMark.mark.providerTimestamp, 51);
    changedMark.mark.availableAt = plus(changedMark.mark.receivedAt, 50);
    const changedMarkResult = projectConstructedSpyRawMark(bytes(changedMark));
    expect(changedMarkResult.status).toBe('projected');
    if (changedMarkResult.status === 'projected') {
      expect(changedMarkResult.markSha256).not.toBe(original.markSha256);
      expect(changedMarkResult.markEvidenceSha256).not.toBe(original.markEvidenceSha256);
      expect(changedMarkResult.projection.observation.referencePrice).toEqual(decimal('3.00'));
    }
  });

  it('isolates later results from caller mutation of original bytes and returned objects', () => {
    const raw = bytes(validInput());
    const saved = Buffer.from(raw);
    const first = projectConstructedSpyRawMark(raw);
    expect(first.status).toBe('projected');
    if (first.status !== 'projected') return;
    const expected = canonical(first);

    raw.fill(0);
    first.markRecord.tradeId = 'caller-mutated';
    first.projectionInputText = 'caller-mutated';
    const later = projectConstructedSpyRawMark(saved);
    expect(later.status).toBe('projected');
    if (later.status !== 'projected') return;
    expect(canonical(later)).toBe(expected);

    const resultBytes = Buffer.from(canonical(later), 'utf8');
    const savedResultBytes = Buffer.from(resultBytes);
    expect(matchesConstructedSpyRawMark(saved, resultBytes)).toBe(true);
    resultBytes.fill(0);
    expect(matchesConstructedSpyRawMark(saved, savedResultBytes)).toBe(true);
  });

  it('accepts exact outer and daily input limits and rejects one beyond each', () => {
    const baseInput = bytes(validInput());
    const exactOuter = Buffer.concat([baseInput, Buffer.alloc(1_048_576 - baseInput.length, 0x20)]);
    expect(exactOuter.length).toBe(1_048_576);
    expect(projectConstructedSpyRawMark(exactOuter).status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const oversizedOuter = Buffer.concat([exactOuter, Buffer.from(' ')]);
    expect(projectConstructedSpyRawMark(oversizedOuter).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();

    const exactDaily = validInput();
    const dailyPadding = 262_144 - exactDaily.dailyRequestText.length;
    expect(dailyPadding).toBeGreaterThan(0);
    exactDaily.dailyRequestText += ' '.repeat(dailyPadding);
    expect(exactDaily.dailyRequestText.length).toBe(262_144);
    expect(projectConstructedSpyRawMark(bytes(exactDaily)).status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);

    projector.mockClear();
    const oversizedDaily = validInput();
    oversizedDaily.dailyRequestText += ' '.repeat(262_145 - oversizedDaily.dailyRequestText.length);
    expect(projectConstructedSpyRawMark(bytes(oversizedDaily)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();
  });

  it('replays complete results and rejects changed, cross-case, extra-field, malformed, and oversized candidates', () => {
    const input = bytes(validInput());
    const result = projectConstructedSpyRawMark(input);
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;

    expect(matchesConstructedSpyRawMark(input, bytes({ ...result, markEvidenceSha256: 'f'.repeat(64) }))).toBe(false);
    expect(matchesConstructedSpyRawMark(input, bytes({ ...result, unexpected: true }))).toBe(false);
    expect(matchesConstructedSpyRawMark(input, bytes({
      ...result, projection: { ...result.projection, unexpected: true },
    }))).toBe(false);
    expect(matchesConstructedSpyRawMark(input, bytes({
      ...result,
      projection: {
        ...result.projection,
        observation: { ...result.projection.observation, referencePrice: decimal('4') },
      },
    }))).toBe(false);

    const otherInput = validInput();
    otherInput.mark.tradeId = 'trade-2';
    const otherResult = projectConstructedSpyRawMark(bytes(otherInput));
    expect(otherResult.status).toBe('projected');
    if (otherResult.status === 'projected') {
      expect(matchesConstructedSpyRawMark(input, bytes(otherResult))).toBe(false);
    }

    expect(matchesConstructedSpyRawMark(input, bytes({
      schema: 'gelt.constructed-spy-mark-g05.v1', status: 'rejected', reason: 'invalid_input',
    }))).toBe(false);
    expect(matchesConstructedSpyRawMark(input, Buffer.from('{"x":1,"x":2}', 'utf8'))).toBe(false);
    expect(matchesConstructedSpyRawMark(input, Buffer.from([0xff]))).toBe(false);
    expect(matchesConstructedSpyRawMark(input, Buffer.alloc(3_145_729))).toBe(false);
    expect(matchesConstructedSpyRawMark(Buffer.alloc(1_048_577), bytes(result))).toBe(false);
    expect(matchesConstructedSpyRawMark(undefined as unknown as Buffer, bytes(result))).toBe(false);
  });

  it('uses one projector call for a locally valid legacy rejection and none for local rejection', () => {
    const invalidLocal = validInput();
    invalidLocal.mark.feed = 'sip';
    expect(projectConstructedSpyRawMark(bytes(invalidLocal)).status).toBe('rejected');
    expect(projector).not.toHaveBeenCalled();

    const legacyRejected = validInput();
    legacyRejected.dailyRequestText = '{}';
    expect(projectConstructedSpyRawMark(bytes(legacyRejected)).status).toBe('rejected');
    expect(projector).toHaveBeenCalledTimes(1);
  });

  it('calls the legacy projector exactly once for a locally valid input and fully replays byte results', () => {
    const input = validInput();
    const raw = bytes(input);
    const result = projectConstructedSpyRawMark(raw);
    expect(result.status).toBe('projected');
    expect(projector).toHaveBeenCalledTimes(1);
    if (result.status !== 'projected') return;

    projector.mockClear();
    expect(matchesConstructedSpyRawMark(raw, Buffer.from(JSON.stringify(result), 'utf8'))).toBe(true);
    expect(projector).toHaveBeenCalledTimes(1);
    expect(matchesConstructedSpyRawMark(raw, Buffer.from(JSON.stringify(result, null, 2), 'utf8'))).toBe(true);
  });

  it('rejects mark-record edits and a coherently rehashed detached favorable body', () => {
    const originalBytes = bytes(validInput());
    const original = projectConstructedSpyRawMark(originalBytes);
    expect(original.status).toBe('projected');
    if (original.status !== 'projected') return;

    const changedRecords = [
      { ...original.markRecord, tradeId: 'trade-2' },
      { ...original.markRecord, price: decimal('4') },
      { ...original.markRecord, providerTimestamp: plus(original.markRecord.providerTimestamp, 1) },
    ];
    for (const markRecord of changedRecords) {
      expect(matchesConstructedSpyRawMark(originalBytes, bytes({ ...original, markRecord }))).toBe(false);
    }

    const changedInput = validInput();
    changedInput.mark.price = decimal('4');
    const detached = projectConstructedSpyRawMark(bytes(changedInput));
    expect(detached.status).toBe('projected');
    if (detached.status !== 'projected') return;
    const { bindingId: _detachedBindingId, ...detachedBody } = detached;
    const forgedBody = { ...detachedBody, originalInputSha256: original.originalInputSha256 };
    const coherentForgery = {
      ...forgedBody,
      bindingId: 'constructed-spy-mark-g05-' + digest(canonical(forgedBody)),
    };
    expect(matchesConstructedSpyRawMark(originalBytes, bytes(coherentForgery))).toBe(false);
  });

  it('rejects malformed, duplicate-key, invalid-UTF8, and non-Buffer inputs with fixed nonreflective output', () => {
    const sentinel = 'private-secret-control-\u001b[31m';
    const expected = {
      schema: 'gelt.constructed-spy-mark-g05.v1',
      status: 'rejected',
      reason: 'invalid_input',
    };
    const validRaw = bytes(validInput());
    const encoded = validRaw.toString('utf8');
    const duplicate = encoded.replace(
      '"classification":"constructed_offline_test"',
      '"classification":"constructed_offline_test","classification":' + JSON.stringify(sentinel),
    );
    const invalidUtf8 = Buffer.concat([Buffer.from('{"secret":"', 'utf8'), Buffer.from([0xff]), Buffer.from('"}', 'utf8')]);
    const malformed = Buffer.from('{"secret":' + JSON.stringify(sentinel), 'utf8');

    for (const invalid of [Buffer.from(duplicate, 'utf8'), invalidUtf8, malformed]) {
      const result = projectConstructedSpyRawMark(invalid);
      expect(result).toEqual(expected);
      expect(canonical(result)).not.toContain(sentinel);
      expect(canonical(result)).not.toContain('\u001b');
    }
    expect(projectConstructedSpyRawMark(undefined as unknown as Buffer)).toEqual(expected);
    expect(matchesConstructedSpyRawMark(validRaw, undefined as unknown as Buffer)).toBe(false);
  });

  it.each(['1e999', '-1e999'])('rejects nested nonfinite %s before candidate canonicalization', exponent => {
    const result = projectConstructedSpyRawMark(bytes(validInput()));
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const canonicalResult = canonical(result);
    const needle = '\"predecessorSha256\":null';
    expect(canonicalResult).toContain(needle);
    const forged = canonicalResult.replace(needle, '\"predecessorSha256\":' + exponent);
    expect(matchesConstructedSpyRawMark(bytes(validInput()), Buffer.from(forged, 'utf8'))).toBe(false);
  });
});
