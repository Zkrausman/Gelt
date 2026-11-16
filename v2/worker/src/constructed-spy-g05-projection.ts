// Pure constructed-only bridge from the supplied PR74 daily request to the
// existing fixed G05 rule and candidate-manifest contracts. This is not market
// admission, source authentication, an order path, or an operating evaluator.
import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { decimalSchema } from './ledger-contract.js';
import { parseResearchJSON } from './research-json.js';
import { assessSpyDailyInput, type SpyDailyInputAssessment, type SpyDailyInputRequest } from './spy-daily-input-consistency.js';
import { evaluateShadowRule } from './shadow-rule.js';
import { shadowRuleId, shadowRuleInputSchema, shadowRuleMaxBytes, shadowRuleReceiptSchema, decimalCompare } from './shadow-rule-contract.js';
import { assertCandidateShadowBinding, candidateShadowArtifact, candidateShadowManifestSchema, parseCandidateShadowManifest } from './candidate-shadow-contract.js';
import {
  checkObservation, decimal, simulationDigest, simulationObservationSchema,
  simulationPortfolioReadSchema, simulationRunSchema, simulationTimestamp, simulationInstrument,
  units, type SimulationObservation, type SimulationRun,
} from './synthetic-simulation-economics.js';

const inputLimit = 1_048_576;
const dailyTextLimit = 262_144;
const manifestLimit = 8_192;
const ruleInputLimit = shadowRuleMaxBytes;
const assessmentLimit = 8_192;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
type SimulationPortfolioRead = z.infer<typeof simulationPortfolioReadSchema>;

const mapping = Object.freeze({
  schema: 'gelt.constructed-spy-g05-map.v1',
  underlying: 'SPY',
  internal: simulationInstrument,
  currency: 'USD',
  unitMapping: 'one_constructed_underlying_unit_to_one_internal_unit',
  signalBasis: 'supplied_adjusted_close',
  closedAtBasis: 'constructed_daily_interval_end',
  availabilityBasis: 'whole_current_snapshot',
  classification: 'constructed_offline_test',
  actualMarketMapping: 'not_established',
} as const);

const timestamp = simulationTimestamp.refine(value => {
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && epoch >= 0;
});
const controlsSchema = z.object({ passiveSha256: hash, cashAssumptionSha256: hash }).strict();
const consumerSchema = z.object({
  config: simulationRunSchema,
  portfolio: simulationPortfolioReadSchema,
  lifecycleDisposition: z.literal('settled'),
  observation: simulationObservationSchema,
  evaluationAt: timestamp,
  controls: controlsSchema,
  markBasis: z.literal('constructed_raw_reference'),
  corporateActionState: z.literal('constructed_none'),
}).strict();
const inputSchema = z.object({
  schema: z.literal('gelt.constructed-spy-g05-projection-input.v1'),
  dailyRequestText: z.string(),
  consumer: consumerSchema,
}).strict();

const assessmentSchema = z.object({
  schema: z.literal('gelt.spy-daily-input-consistency.v1'),
  status: z.literal('consistent'),
  reasons: z.array(z.never()).length(0),
  assessmentId: z.string().regex(/^spy-daily-[a-f0-9]{64}$/),
  inputSha256: hash,
  snapshotSha256: hash,
  predecessorSha256: hash.nullable(),
  classification: z.literal('constructed_offline_test'),
  consistency: z.literal('supplied_assertions_only'),
  rights: z.literal('not_established'),
  calendarAuthenticity: z.literal('not_established'),
  completion: z.literal('unknown'),
  vintage: z.literal('unknown'),
  actualAvailability: z.literal('not_established'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
}).strict();

const rejectedSchema = z.object({
  schema: z.literal('gelt.constructed-spy-g05-projection.v1'),
  status: z.literal('rejected'),
  reason: z.literal('invalid_input'),
}).strict();
const projectedSchema = z.object({
  schema: z.literal('gelt.constructed-spy-g05-projection.v1'),
  status: z.literal('projected'),
  projectionId: z.string().regex(/^constructed-spy-g05-[a-f0-9]{64}$/),
  dailyAssessment: assessmentSchema,
  mapping: z.object({
    schema: z.literal('gelt.constructed-spy-g05-map.v1'),
    underlying: z.literal('SPY'), internal: z.literal('SYNTH-RH-USD'), currency: z.literal('USD'),
    unitMapping: z.literal('one_constructed_underlying_unit_to_one_internal_unit'),
    signalBasis: z.literal('supplied_adjusted_close'), closedAtBasis: z.literal('constructed_daily_interval_end'),
    availabilityBasis: z.literal('whole_current_snapshot'), classification: z.literal('constructed_offline_test'),
    actualMarketMapping: z.literal('not_established'),
  }).strict(),
  mappingSha256: hash,
  manifestText: z.string().max(manifestLimit),
  ruleInputText: z.string().max(ruleInputLimit),
  ruleReceipt: shadowRuleReceiptSchema,
  observation: simulationObservationSchema,
  evaluationAt: timestamp,
  sourceRetention: z.literal('hash_link_only_in_legacy_consumer'),
  actualEligibility: z.literal('not_established'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
}).strict();
const boundedProjectedSchema = projectedSchema.refine(result => Buffer.byteLength(result.manifestText, 'utf8') <= manifestLimit
  && Buffer.byteLength(result.ruleInputText, 'utf8') <= ruleInputLimit);
const resultSchema = z.union([rejectedSchema, boundedProjectedSchema]);
export type ConstructedSpyG05Projection = z.infer<typeof resultSchema>;
export type ProjectedConstructedSpyG05 = z.infer<typeof boundedProjectedSchema>;

const rejected = (): ConstructedSpyG05Projection => ({
  schema: 'gelt.constructed-spy-g05-projection.v1', status: 'rejected', reason: 'invalid_input',
});
const d = (value: string) => decimalSchema.parse({
  value, precision: value.replace('.', '').length, scale: value.split('.')[1]?.length ?? 0,
});

function equivalent(actual: z.infer<typeof decimalSchema>, expected: string): boolean {
  return decimalCompare(actual, d(expected)) === 0;
}

function representable(value: z.infer<typeof decimalSchema>, scale: number): boolean {
  try {
    decimal(units(value, scale), scale);
    return true;
  } catch { return false; }
}

function configAndPortfolioMatch(config: SimulationRun, portfolio: SimulationPortfolioRead): boolean {
  const snapshot = portfolio.snapshot;
  return config.classification === 'constructed_offline_test'
    && equivalent(config.genesis.cash, '20')
    && equivalent(config.genesis.quantity, '0')
    && equivalent(config.costs.commissionPerOrder, '0.01')
    && equivalent(config.costs.spreadFraction, '0')
    && equivalent(config.costs.slippageFraction, '0')
    && config.maxDecisionAgeMs === 960_000
    && config.maxObservationAgeMs === 5_000
    && portfolio.state === 'settled'
    && snapshot.runId === config.runId
    && snapshot.classification === config.classification
    && snapshot.instrumentId === config.instrumentId
    && snapshot.currency === config.currency
    && snapshot.configSha256 === simulationDigest(config)
    && snapshot.genesisSha256 === simulationDigest(config.genesis)
    && representable(snapshot.cash, 8)
    && representable(snapshot.quantity, 18);
}

function consistentAssessment(value: SpyDailyInputAssessment): value is SpyDailyInputAssessment & { status: 'consistent' } {
  return assessmentSchema.safeParse(value).success
    && Buffer.byteLength(canonical(value), 'utf8') <= assessmentLimit;
}

function projectOwned(ownedInput: Buffer): ProjectedConstructedSpyG05 {
  const parsedInput = inputSchema.parse(parseResearchJSON(ownedInput));
  const dailyText = parsedInput.dailyRequestText;
  if (dailyText.length > dailyTextLimit) throw new Error();
  const dailyBytes = Buffer.from(dailyText, 'utf8');
  if (dailyBytes.toString('utf8') !== dailyText || dailyBytes.length > dailyTextLimit) throw new Error();

  // PR74 owns request validation and contradiction semantics. Reparse only the
  // same owned bytes after its complete fresh assessment passed.
  const assessment = assessSpyDailyInput(dailyBytes);
  if (!consistentAssessment(assessment)) throw new Error();
  const daily = parseResearchJSON(dailyBytes) as SpyDailyInputRequest;
  const consumer = parsedInput.consumer;
  const config = simulationRunSchema.parse(consumer.config);
  const portfolio = simulationPortfolioReadSchema.parse(consumer.portfolio);
  const observation: SimulationObservation = simulationObservationSchema.parse(consumer.observation);
  if (!configAndPortfolioMatch(config, portfolio)) throw new Error();

  checkObservation(config, daily.decisionAt, observation, Date.parse(consumer.evaluationAt));

  const mappingSha256 = digest(canonical(mapping));
  const calendarSha256 = digest(canonical({
    domain: 'gelt.constructed-spy-g05-calendar.v1', mapping, calendar: daily.current.calendar,
  }));
  const datasetSha256 = digest(canonical({
    domain: 'gelt.constructed-spy-g05-dataset.v1',
    dailyInputSha256: assessment.inputSha256,
    mappingSha256,
  }));
  const rightsEvidenceSha256 = digest(canonical({
    domain: 'gelt.constructed-spy-g05-rights.v1',
    classification: 'constructed_offline_test', actualRights: 'not_established',
  }));
  const pointInTimeEvidenceSha256 = digest(canonical({
    domain: 'gelt.constructed-spy-g05-pit.v1',
    dailyInputSha256: assessment.inputSha256,
    assessmentId: assessment.assessmentId,
    mappingSha256,
  }));
  const scheduleSha256 = digest(canonical({
    domain: 'gelt.constructed-spy-g05-schedule.v1', decisionAt: daily.decisionAt, mappingSha256,
  }));

  const ruleInput = shadowRuleInputSchema.parse({
    schema: 'gelt.shadow-rule-input.v1', ruleId: shadowRuleId,
    runId: config.runId, sourceCommit: config.sourceCommit, decisionAt: daily.decisionAt,
    instrument: { id: simulationInstrument, currency: 'USD', calendarSha256 },
    data: {
      classification: 'constructed_offline_test', eligibility: 'declared', datasetSha256,
      rightsEvidenceSha256, pointInTimeEvidenceSha256,
    },
    policy: { scheduleSha256, maxAgeMs: 86_400_000, exposureCap: d('0.25') },
    costs: {
      status: 'declared', evidenceSha256: config.calibrationEvidenceSha256,
      stressScenarioSha256: digest(canonical({ domain: 'gelt.constructed-spy-g05-costs.v1', configSha256: simulationDigest(config) })),
      commissionPerTrade: config.costs.commissionPerOrder,
      spreadFraction: config.costs.spreadFraction,
      slippageFraction: config.costs.slippageFraction,
    },
    controls: consumer.controls,
    portfolio: { state: 'settled', snapshotSha256: simulationDigest(portfolio.snapshot) },
    bars: daily.current.calendar.map((row, index) => ({
      sessionOrdinal: row.ordinal,
      closedAt: row.dayEndsAt,
      availableAt: daily.current.availableAt,
      adjustedClose: daily.current.bars[index].adjustedClose,
    })),
  });
  const ruleInputText = canonical(ruleInput);
  const ruleInputBytes = Buffer.from(ruleInputText, 'utf8');
  if (ruleInputBytes.length > ruleInputLimit) throw new Error();
  const ruleReceipt = shadowRuleReceiptSchema.parse(evaluateShadowRule(ruleInputBytes));
  if (ruleReceipt.inputValidation !== 'valid') throw new Error();

  const manifest = candidateShadowManifestSchema.parse({
    schema: 'gelt.candidate-shadow-manifest.v1', version: 1,
    classification: 'constructed_offline_test', effectScope: 'SIMULATED_ONLY',
    runId: config.runId, sourceCommit: config.sourceCommit,
    configSha256: simulationDigest(config), artifact: candidateShadowArtifact,
    ruleBinding: {
      instrument: ruleInput.instrument, data: ruleInput.data, policy: ruleInput.policy,
      costs: ruleInput.costs, controls: ruleInput.controls,
    },
  });
  assertCandidateShadowBinding(manifest, ruleInput, config);
  const manifestText = canonical(manifest);
  if (Buffer.byteLength(manifestText, 'utf8') > manifestLimit) throw new Error();
  // Exercise the same fixed manifest decoder used by the consumer boundary.
  parseCandidateShadowManifest(manifestText);

  const body = {
    schema: 'gelt.constructed-spy-g05-projection.v1' as const,
    status: 'projected' as const,
    dailyAssessment: assessment,
    mapping,
    mappingSha256,
    manifestText,
    ruleInputText,
    ruleReceipt,
    observation,
    evaluationAt: consumer.evaluationAt,
    sourceRetention: 'hash_link_only_in_legacy_consumer' as const,
    actualEligibility: 'not_established' as const,
    marketEvaluation: 'not_established' as const,
    effectAuthority: 'none' as const,
    promotionAllowed: false as const,
  };
  const result = boundedProjectedSchema.parse({ ...body, projectionId: `constructed-spy-g05-${digest(canonical(body))}` });
  if (Buffer.byteLength(canonical(result), 'utf8') > inputLimit) throw new Error();
  return result;
}

// One bounded call, one owned outer snapshot, and one generic rejection shape.
// Neither this function nor its matcher reads clocks/env/files or performs effects.
export function projectConstructedSpyG05(bytes: Buffer): ConstructedSpyG05Projection {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > inputLimit) return rejected();
    return projectOwned(Buffer.from(bytes));
  } catch { return rejected(); }
}

export function matchesConstructedSpyG05Projection(bytes: Buffer, value: unknown): boolean {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > inputLimit) return false;
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success || parsed.data.status !== 'projected') return false;
    const expected = projectConstructedSpyG05(bytes);
    return expected.status === 'projected' && canonical(expected) === canonical(parsed.data);
  } catch { return false; }
}
