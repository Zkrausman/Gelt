import { describe, expect, it } from 'vitest';
import { canonical, digest } from './ledger-canonical.js';
import { candidateShadowId, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import { simulationDigest, simulationRunSchema, snapshot, units, type SimulationRun } from './synthetic-simulation-economics.js';
import {
  matchesConstructedSpyG05Projection,
  projectConstructedSpyG05,
  type ProjectedConstructedSpyG05,
} from './constructed-spy-g05-projection.js';

const day = 24 * 60 * 60 * 1_000;
const hour = 60 * 60 * 1_000;
const iso = (time: number) => new Date(time).toISOString();
const plus = (value: string, delta: number) => iso(Date.parse(value) + delta);
const d = (value: string) => ({ value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0 });
const bytes = (value: unknown) => Buffer.from(canonical(value), 'utf8');
const copy = <T>(value: T): T => JSON.parse(canonical(value)) as T;

type DailySnapshotFixture = {
  feed: 'iex' | 'sip'; symbol: 'SPY'; currency: 'USD'; timeframe: '1Day'; adjustment: 'all'; asof: string;
  requestStart: string; requestEnd: string; issuedAt: string; receivedAt: string; availableAt: string;
  calendar: { sessionDate: string; ordinal: number; dayStartsAt: string; dayEndsAt: string }[];
  bars: { providerTimestamp: string; adjustedClose: { value: string; precision: number; scale: number } }[];
};
type DailyRequestFixture = {
  schema: 'gelt.spy-daily-input-consistency-request.v1'; classification: 'constructed_offline_test';
  epochId: string; declaredAt: string; decisionAt: string; current: DailySnapshotFixture;
  predecessor: DailySnapshotFixture | null; revision: 0 | 1;
};

function newYorkMidnight(date: string): string {
  const daylight = date >= '2026-03-09' && date < '2026-11-02';
  return iso(Date.parse(`${date}T00:00:00.000Z`) + (daylight ? 4 : 5) * hour);
}

function dailyRequest(): DailyRequestFixture {
  const calendar = Array.from({ length: 253 }, (_, index) => {
    const sessionDate = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * day).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(`${sessionDate}T00:00:00.000Z`) + day).toISOString().slice(0, 10);
    return { sessionDate, ordinal: 100 + index, dayStartsAt: newYorkMidnight(sessionDate), dayEndsAt: newYorkMidnight(nextDate) };
  });
  const lastEnd = calendar[252].dayEndsAt;
  const requestEnd = plus(lastEnd, -1);
  const issuedAt = lastEnd;
  const receivedAt = plus(issuedAt, 1_000);
  const availableAt = plus(receivedAt, 1_000);
  return {
    schema: 'gelt.spy-daily-input-consistency-request.v1' as const,
    classification: 'constructed_offline_test' as const,
    epochId: '11111111-1111-4111-8111-111111111111',
    declaredAt: '2026-01-01T00:00:00.000Z',
    decisionAt: plus(availableAt, 1_000),
    current: {
      feed: 'iex' as const, symbol: 'SPY' as const, currency: 'USD' as const, timeframe: '1Day' as const,
      adjustment: 'all' as const, asof: '2026-01-01', requestStart: calendar[0].dayStartsAt, requestEnd,
      issuedAt, receivedAt, availableAt, calendar,
      bars: calendar.map((row, index) => ({ providerTimestamp: row.dayStartsAt, adjustedClose: d(index === 252 ? '2.00' : '1.00') })),
    },
    predecessor: null,
    revision: 0 as const,
  };
}

function config(evaluationAt: string): SimulationRun {
  return simulationRunSchema.parse({
    version: 2, runId: '22222222-2222-4222-8222-222222222222', sourceCommit: 'a'.repeat(40),
    instrumentId: 'SYNTH-RH-USD', currency: 'USD', classification: 'constructed_offline_test',
    genesis: { cash: d('20.00'), quantity: d('0.000') },
    costs: { commissionPerOrder: d('0.010'), spreadFraction: d('0.000'), slippageFraction: d('0.000') },
    calibrationEvidenceSha256: 'b'.repeat(64), maxDecisionAgeMs: 960_000, maxObservationAgeMs: 5_000,
    validThrough: plus(evaluationAt, hour), rounding: 'adverse-price-8-cumulative-cash-8.v1',
  });
}

function consumer(daily: DailyRequestFixture = dailyRequest()) {
  const evaluationAt = plus(daily.decisionAt, 1_000);
  const run = config(evaluationAt);
  const portfolio = { snapshot: snapshot(run, units(run.genesis.cash, 8), units(run.genesis.quantity, 18), []), state: 'settled' as const };
  return {
    config: run, portfolio, lifecycleDisposition: 'settled' as const,
    observation: { referencePrice: d('3'), observedAt: plus(daily.decisionAt, 100), availableAt: plus(daily.decisionAt, 200), evidenceSha256: 'c'.repeat(64) },
    evaluationAt, controls: { passiveSha256: 'd'.repeat(64), cashAssumptionSha256: 'e'.repeat(64) },
    markBasis: 'constructed_raw_reference' as const, corporateActionState: 'constructed_none' as const,
  };
}

function requestBytes(daily: DailyRequestFixture = dailyRequest(), supplied = consumer(daily)): Buffer {
  return bytes({ schema: 'gelt.constructed-spy-g05-projection-input.v1', dailyRequestText: canonical(daily), consumer: supplied });
}

function projected(value: unknown): ProjectedConstructedSpyG05 {
  const result = projectConstructedSpyG05(bytes(value));
  if (result.status !== 'projected') throw new Error('constructed projection fixture invalid');
  return result;
}

describe('constructed SPY daily to fixed G05 projection', () => {
  it('maps exactly the 253 current rows, keeps raw mark separate, and declares only constructed limits', () => {
    const daily = dailyRequest(), input = requestBytes(daily), result = projectConstructedSpyG05(input);
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const rule = JSON.parse(result.ruleInputText);
    expect(rule.bars).toHaveLength(253);
    expect(rule.bars[0]).toEqual({ sessionOrdinal: 100, closedAt: daily.current.calendar[0].dayEndsAt,
      availableAt: daily.current.availableAt, adjustedClose: daily.current.bars[0].adjustedClose });
    expect(rule.bars[252].adjustedClose).toEqual({ value: '2.00', precision: 3, scale: 2 });
    expect(result.observation.referencePrice).toEqual({ value: '3', precision: 1, scale: 0 });
    expect(rule.policy).toEqual({ scheduleSha256: rule.policy.scheduleSha256, maxAgeMs: 86_400_000,
      exposureCap: { value: '0.25', precision: 3, scale: 2 } });
    expect(result.ruleReceipt).toMatchObject({ decision: 'target_long', reason: 'positive_return', targetExposure: { value: '0.25' } });
    expect(result.dailyAssessment.status).toBe('consistent');
    expect(result.mappingSha256).toBe(digest(canonical(result.mapping)));
    expect(result).toMatchObject({ sourceRetention: 'hash_link_only_in_legacy_consumer', actualEligibility: 'not_established',
      marketEvaluation: 'not_established', effectAuthority: 'none', promotionAllowed: false });
    expect(canonical(result)).not.toContain(canonical(daily));
    expect(matchesConstructedSpyG05Projection(input, result)).toBe(true);
  });

  it('binds predecessor and current request changes into a new candidate policy identity', () => {
    const daily = dailyRequest(), baseline = projected({ schema: 'gelt.constructed-spy-g05-projection-input.v1',
      dailyRequestText: canonical(daily), consumer: consumer(daily) });
    const changed = copy(daily);
    changed.current.bars[126].adjustedClose = d('1.25');
    const revised = projected({ schema: 'gelt.constructed-spy-g05-projection-input.v1',
      dailyRequestText: canonical(changed), consumer: consumer(changed) });
    expect(revised.dailyAssessment.inputSha256).not.toBe(baseline.dailyAssessment.inputSha256);
    expect(revised.manifestText).not.toBe(baseline.manifestText);
    expect(candidateShadowId(parseCandidateShadowManifest(revised.manifestText)))
      .not.toBe(candidateShadowId(parseCandidateShadowManifest(baseline.manifestText)));
  });

  it('binds predecessor-only revisions without splicing predecessor bars into the G05 window', () => {
    const revision = (predecessorClose: string) => {
      const base = dailyRequest();
      const predecessor = copy(base.current);
      predecessor.receivedAt = plus(predecessor.issuedAt, 500);
      predecessor.availableAt = plus(predecessor.receivedAt, 100);
      predecessor.bars[126].adjustedClose = d(predecessorClose);
      return { ...base, predecessor, revision: 1 as const };
    };
    const firstDaily = revision('1.50'), secondDaily = revision('1.75');
    const first = projected({ schema: 'gelt.constructed-spy-g05-projection-input.v1',
      dailyRequestText: canonical(firstDaily), consumer: consumer(firstDaily) });
    const second = projected({ schema: 'gelt.constructed-spy-g05-projection-input.v1',
      dailyRequestText: canonical(secondDaily), consumer: consumer(secondDaily) });
    expect(first.dailyAssessment.inputSha256).not.toBe(second.dailyAssessment.inputSha256);
    const firstRule = JSON.parse(first.ruleInputText), secondRule = JSON.parse(second.ruleInputText);
    expect(firstRule.bars).toEqual(secondRule.bars);
    expect(firstRule.data.datasetSha256).not.toBe(secondRule.data.datasetSha256);
    expect(firstRule.data.pointInTimeEvidenceSha256).not.toBe(secondRule.data.pointInTimeEvidenceSha256);
    expect(first.ruleInputText).not.toBe(second.ruleInputText);
    expect(first.manifestText).not.toBe(second.manifestText);
    expect(candidateShadowId(parseCandidateShadowManifest(first.manifestText)))
      .not.toBe(candidateShadowId(parseCandidateShadowManifest(second.manifestText)));
    expect(JSON.parse(first.ruleInputText).bars[126].adjustedClose).toEqual(d('1.00'));
    expect(JSON.parse(second.ruleInputText).bars[126].adjustedClose).toEqual(d('1.00'));
  });

  it('keeps candidate identity independent of portfolio, mark, and evaluation while projection identity changes', () => {
    const daily = dailyRequest(), baseInput = { schema: 'gelt.constructed-spy-g05-projection-input.v1',
      dailyRequestText: canonical(daily), consumer: consumer(daily) };
    const base = projected(baseInput);
    const changed = copy(baseInput);
    changed.consumer.observation.referencePrice = d('4');
    changed.consumer.evaluationAt = plus(changed.consumer.evaluationAt, 1);
    const portfolio = changed.consumer.portfolio;
    portfolio.snapshot.cash = d('19.00000000');
    const other = projected(changed);
    expect(other.manifestText).toBe(base.manifestText);
    expect(other.ruleInputText).not.toBe(base.ruleInputText);
    expect(other.projectionId).not.toBe(base.projectionId);

    const markOnly = copy(baseInput);
    markOnly.consumer.observation.referencePrice = d('4');
    const marked = projected(markOnly);
    expect(marked.ruleInputText).toBe(base.ruleInputText);
    expect(marked.manifestText).toBe(base.manifestText);
    expect(marked.projectionId).not.toBe(base.projectionId);
  });

  it('preserves genuine stale-input abstention and accepts inclusive configured age boundaries', () => {
    const daily = dailyRequest();
    const lastEnd = daily.current.calendar[252].dayEndsAt;
    daily.decisionAt = plus(lastEnd, 86_400_001);
    const staleConsumer = consumer(daily);
    const stale = projectConstructedSpyG05(requestBytes(daily, staleConsumer));
    expect(stale.status).toBe('projected');
    if (stale.status === 'projected') expect(stale.ruleReceipt).toMatchObject({ decision: 'abstain', reason: 'stale_input', targetExposure: null });

    const current = dailyRequest();
    const boundary = consumer(current);
    boundary.evaluationAt = plus(current.decisionAt, 960_000);
    boundary.config.validThrough = boundary.evaluationAt;
    boundary.portfolio.snapshot.configSha256 = simulationDigest(boundary.config);
    boundary.observation.observedAt = plus(boundary.evaluationAt, -5_000);
    boundary.observation.availableAt = boundary.evaluationAt;
    expect(projectConstructedSpyG05(requestBytes(current, boundary)).status).toBe('projected');
  });

  it.each([
    ['equal-decision mark', (daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => { c.observation.observedAt = daily.decisionAt; }],
    ['future-unavailable mark', (_daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => { c.observation.availableAt = plus(c.evaluationAt, 1); }],
    ['availability before observation', (_daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => { c.observation.availableAt = plus(c.observation.observedAt, -1); }],
    ['decision age over limit', (daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => {
      c.evaluationAt = plus(daily.decisionAt, 960_001); c.config.validThrough = plus(c.evaluationAt, hour);
      c.portfolio.snapshot.configSha256 = simulationDigest(c.config);
      c.observation.observedAt = plus(c.evaluationAt, -5_000); c.observation.availableAt = c.evaluationAt;
    }],
    ['observation age over limit', (_daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => {
      c.evaluationAt = plus(c.evaluationAt, 10_000); c.config.validThrough = plus(c.evaluationAt, hour);
      c.portfolio.snapshot.configSha256 = simulationDigest(c.config);
      c.observation.observedAt = plus(c.evaluationAt, -5_001); c.observation.availableAt = c.evaluationAt;
    }],
    ['unsettled lifecycle', (_daily: ReturnType<typeof dailyRequest>, c: any) => { c.lifecycleDisposition = 'unknown'; }],
    ['unsettled portfolio', (_daily: ReturnType<typeof dailyRequest>, c: any) => { c.portfolio.state = 'unsettled'; }],
    ['changed simulation fee', (_daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => { c.config.costs.commissionPerOrder = d('0.02'); }],
    ['changed simulation genesis', (_daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => { c.config.genesis.cash = d('21'); }],
    ['changed portfolio binding', (_daily: ReturnType<typeof dailyRequest>, c: ReturnType<typeof consumer>) => { c.portfolio.snapshot.configSha256 = 'f'.repeat(64); }],
    ['non-constructed action assertion', (_daily: ReturnType<typeof dailyRequest>, c: any) => { c.corporateActionState = 'no_action_attested'; }],
  ] as const)('rejects %s without a partial result', (_name, mutate) => {
    const daily = dailyRequest(), supplied = consumer(daily);
    mutate(daily, supplied);
    expect(projectConstructedSpyG05(requestBytes(daily, supplied))).toEqual({
      schema: 'gelt.constructed-spy-g05-projection.v1', status: 'rejected', reason: 'invalid_input',
    });
  });

  it('binds changed declared control hashes to a new projection and candidate identity', () => {
    const daily = dailyRequest(), supplied = consumer(daily);
    const before = projectConstructedSpyG05(requestBytes(daily, supplied));
    expect(before.status).toBe('projected');
    supplied.controls.passiveSha256 = 'f'.repeat(64);
    const after = projectConstructedSpyG05(requestBytes(daily, supplied));
    expect(after.status).toBe('projected');
    if (before.status === 'projected' && after.status === 'projected') {
      expect(after.manifestText).not.toBe(before.manifestText);
      expect(candidateShadowId(parseCandidateShadowManifest(after.manifestText)))
        .not.toBe(candidateShadowId(parseCandidateShadowManifest(before.manifestText)));
    }
  });

  it('rejects contradictory, duplicate-key, malformed, over-limit, extra, and cross-input artifacts generically', () => {
    const daily = dailyRequest(), input = requestBytes(daily), good = projectConstructedSpyG05(input);
    const contradictory = copy(daily);
    contradictory.current.requestEnd = plus(contradictory.current.requestEnd, -1);
    expect(projectConstructedSpyG05(requestBytes(contradictory))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    const text = canonical({ schema: 'gelt.constructed-spy-g05-projection-input.v1', dailyRequestText: canonical(daily), consumer: consumer(daily) })
      .replace('"schema":"gelt.constructed-spy-g05-projection-input.v1"', '"schema":"gelt.constructed-spy-g05-projection-input.v1","schema":"gelt.constructed-spy-g05-projection-input.v1"');
    expect(projectConstructedSpyG05(Buffer.from(text))).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    for (const bad of [Buffer.from([0xff]), Buffer.alloc(1_048_577, 0x20), Buffer.from('{')]) {
      expect(projectConstructedSpyG05(bad)).toEqual({ schema: 'gelt.constructed-spy-g05-projection.v1', status: 'rejected', reason: 'invalid_input' });
    }
    const extra = bytes({ schema: 'gelt.constructed-spy-g05-projection-input.v1', dailyRequestText: canonical(daily),
      consumer: consumer(daily), privateSentinel: 'PRIVATE_SENTINEL' });
    expect(canonical(projectConstructedSpyG05(extra))).not.toContain('PRIVATE_SENTINEL');
    if (good.status === 'projected') {
      expect(matchesConstructedSpyG05Projection(input, { ...good, unrecognized: true })).toBe(false);
      expect(matchesConstructedSpyG05Projection(requestBytes(contradictory), good)).toBe(false);
      expect(matchesConstructedSpyG05Projection(input, { ...good, projectionId: `constructed-spy-g05-${'0'.repeat(64)}` })).toBe(false);
    }
  });

  it('accepts the exact daily-text byte limit, rejects the next byte, and leaves caller bytes untouched', () => {
    const daily = dailyRequest(), supplied = consumer(daily), body = canonical(daily);
    const padded = body + ' '.repeat(262_144 - Buffer.byteLength(body, 'utf8'));
    expect(Buffer.byteLength(padded, 'utf8')).toBe(262_144);
    const input = bytes({ schema: 'gelt.constructed-spy-g05-projection-input.v1', dailyRequestText: padded, consumer: supplied });
    const original = Buffer.from(input);
    expect(projectConstructedSpyG05(input).status).toBe('projected');
    expect(input.equals(original)).toBe(true);
    const over = bytes({ schema: 'gelt.constructed-spy-g05-projection-input.v1', dailyRequestText: `${padded} `, consumer: supplied });
    expect(projectConstructedSpyG05(over)).toEqual({
      schema: 'gelt.constructed-spy-g05-projection.v1', status: 'rejected', reason: 'invalid_input',
    });
  });
});
