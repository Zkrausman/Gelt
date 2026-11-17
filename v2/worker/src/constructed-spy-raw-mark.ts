// Pure binding from one supplied constructed raw trade to the unchanged
// constructed SPY/G05 projector. This does not authenticate a market source or
// admit an observation, campaign, or effect.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical, digest } from './ledger-canonical.js';
import { decimalSchema } from './ledger-contract.js';
import { parseResearchJSON } from './research-json.js';
import {
  projectConstructedSpyG05,
  type ProjectedConstructedSpyG05,
} from './constructed-spy-g05-projection.js';
import {
  simulationPortfolioReadSchema,
  simulationRunSchema,
} from './synthetic-simulation-economics.js';

const inputLimit = 1_048_576;
const dailyTextLimit = 262_144;
const contextLimit = 8_192;
const resultLimit = 3_145_728;
const hashPattern = /^[a-f0-9]{64}/;

function fullMatch(value: string, pattern: RegExp): boolean {
  return pattern.exec(value)?.[0] === value;
}

const timestamp = z.string().datetime({ precision: 3 }).refine(value => {
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && epoch >= 0 && new Date(epoch).toISOString() === value;
});
const hash = z.string().refine(value => fullMatch(value, hashPattern));
const price = decimalSchema
  .refine(value => /[1-9]/.test(value.value))
  .refine(value => fullMatch(value.value, /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/));
const tradeId = z.string().refine(value =>
  fullMatch(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/));

const controlsSchema = z.object({
  passiveSha256: hash,
  cashAssumptionSha256: hash,
}).strict();
const consumerSchema = z.object({
  config: simulationRunSchema.refine(config => config.classification === 'constructed_offline_test'),
  portfolio: simulationPortfolioReadSchema,
  lifecycleDisposition: z.literal('settled'),
  evaluationAt: timestamp,
  controls: controlsSchema,
}).strict();
const markSchema = z.object({
  schema: z.literal('gelt.constructed-spy-raw-trade.v1'),
  classification: z.literal('constructed_offline_test'),
  source: z.literal('supplied_fixture'),
  feed: z.literal('iex'),
  symbol: z.literal('SPY'),
  currency: z.literal('USD'),
  priceBasis: z.literal('unadjusted_trade'),
  tradeId,
  price,
  providerTimestamp: timestamp,
  receivedAt: timestamp,
  availableAt: timestamp,
}).strict();
const inputSchema = z.object({
  schema: z.literal('gelt.constructed-spy-mark-g05-input.v1'),
  classification: z.literal('constructed_offline_test'),
  dailyRequestText: z.string(),
  consumer: consumerSchema,
  mark: markSchema,
}).strict();

const rejectionSchema = z.object({
  schema: z.literal('gelt.constructed-spy-mark-g05.v1'),
  status: z.literal('rejected'),
  reason: z.literal('invalid_input'),
}).strict();
const projectedSchema = z.object({
  schema: z.literal('gelt.constructed-spy-mark-g05.v1'),
  status: z.literal('projected'),
  bindingId: z.string().refine(value => value.startsWith('constructed-spy-mark-g05-')
    && fullMatch(value.slice('constructed-spy-mark-g05-'.length), hashPattern)),
  originalInputSha256: hash,
  dailyRequestTextSha256: hash,
  markSha256: hash,
  markEvidenceSha256: hash,
  markRecord: markSchema,
  projectionInputText: z.string().max(inputLimit),
  projection: z.unknown(),
  classification: z.literal('constructed_offline_test'),
  consistency: z.literal('supplied_assertions_only'),
  sourceAuthenticity: z.literal('not_established'),
  rights: z.literal('not_established'),
  actualAvailability: z.literal('not_established'),
  clockAccuracy: z.literal('not_established'),
  sessionEligibility: z.literal('not_established'),
  tradeEligibility: z.literal('not_established'),
  globalFirstMark: z.literal('not_established'),
  originalMarkPersistence: z.literal('not_performed_by_this_api'),
  marketEvaluation: z.literal('not_established'),
  effectAuthority: z.literal('none'),
  promotionAllowed: z.literal(false),
}).strict().refine(value => Buffer.byteLength(value.projectionInputText, 'utf8') <= inputLimit);
const resultSchema = z.union([rejectionSchema, projectedSchema]);
type ProjectedResult = z.infer<typeof projectedSchema> & {
  projection: ProjectedConstructedSpyG05;
};
export type ConstructedSpyRawMarkResult = z.infer<typeof rejectionSchema> | ProjectedResult;

const rejected = (): ConstructedSpyRawMarkResult => ({
  schema: 'gelt.constructed-spy-mark-g05.v1',
  status: 'rejected',
  reason: 'invalid_input',
});

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function finiteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value !== null && typeof value === 'object') return Object.values(value).every(finiteNumbers);
  return true;
}

function projectOwned(ownedInput: Buffer): ProjectedResult {
  const input = inputSchema.parse(parseResearchJSON(ownedInput));
  if (input.dailyRequestText.length > dailyTextLimit) throw new Error();
  const dailyBytes = Buffer.from(input.dailyRequestText, 'utf8');
  if (dailyBytes.length > dailyTextLimit
    || dailyBytes.toString('utf8') !== input.dailyRequestText) throw new Error();
  if (Buffer.byteLength(canonical(input.consumer), 'utf8') > contextLimit
    || Buffer.byteLength(canonical(input.mark), 'utf8') > contextLimit) throw new Error();

  const providerTime = Date.parse(input.mark.providerTimestamp);
  const receivedTime = Date.parse(input.mark.receivedAt);
  const availableTime = Date.parse(input.mark.availableAt);
  const evaluationTime = Date.parse(input.consumer.evaluationAt);
  if (!(providerTime <= receivedTime && receivedTime <= availableTime && availableTime <= evaluationTime)) {
    throw new Error();
  }

  const dailyRequestTextSha256 = sha256(dailyBytes);
  const markSha256 = digest(canonical(input.mark));
  const evidenceBody = {
    schema: 'gelt.constructed-spy-mark-evidence.v1' as const,
    classification: 'constructed_offline_test' as const,
    dailyRequestTextSha256,
    consumer: input.consumer,
    mark: input.mark,
  };
  const markEvidenceSha256 = digest(canonical(evidenceBody));
  const observation = {
    referencePrice: input.mark.price,
    observedAt: input.mark.providerTimestamp,
    availableAt: input.mark.availableAt,
    evidenceSha256: markEvidenceSha256,
  };
  const projectionInputText = canonical({
    schema: 'gelt.constructed-spy-g05-projection-input.v1',
    dailyRequestText: input.dailyRequestText,
    consumer: {
      ...input.consumer,
      observation,
      markBasis: 'constructed_raw_reference',
      corporateActionState: 'constructed_none',
    },
  });
  const projectionInputBytes = Buffer.from(projectionInputText, 'utf8');
  if (projectionInputBytes.length > inputLimit) throw new Error();

  // The legacy projector owns daily-request validity, configured age checks,
  // evaluation, and the complete existing G05 projection exactly once.
  const projection = projectConstructedSpyG05(projectionInputBytes);
  if (projection.status !== 'projected'
    || canonical(projection.observation) !== canonical(observation)) throw new Error();

  const body = {
    schema: 'gelt.constructed-spy-mark-g05.v1' as const,
    status: 'projected' as const,
    originalInputSha256: sha256(ownedInput),
    dailyRequestTextSha256,
    markSha256,
    markEvidenceSha256,
    markRecord: input.mark,
    projectionInputText,
    projection,
    classification: 'constructed_offline_test' as const,
    consistency: 'supplied_assertions_only' as const,
    sourceAuthenticity: 'not_established' as const,
    rights: 'not_established' as const,
    actualAvailability: 'not_established' as const,
    clockAccuracy: 'not_established' as const,
    sessionEligibility: 'not_established' as const,
    tradeEligibility: 'not_established' as const,
    globalFirstMark: 'not_established' as const,
    originalMarkPersistence: 'not_performed_by_this_api' as const,
    marketEvaluation: 'not_established' as const,
    effectAuthority: 'none' as const,
    promotionAllowed: false as const,
  };
  const result: ProjectedResult = {
    ...body,
    bindingId: 'constructed-spy-mark-g05-' + digest(canonical(body)),
  };
  projectedSchema.parse(result);
  if (Buffer.byteLength(canonical(result), 'utf8') > resultLimit) throw new Error();
  return result;
}

export function projectConstructedSpyRawMark(input: Buffer): ConstructedSpyRawMarkResult {
  try {
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > inputLimit) return rejected();
    return projectOwned(Buffer.from(input));
  } catch {
    return rejected();
  }
}

export function matchesConstructedSpyRawMark(input: Buffer, resultBytes: Buffer): boolean {
  try {
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > inputLimit
      || !Buffer.isBuffer(resultBytes) || resultBytes.length < 1 || resultBytes.length > resultLimit) return false;
    const parsedResult = parseResearchJSON(Buffer.from(resultBytes));
    if (!finiteNumbers(parsedResult)) return false;
    const candidate = resultSchema.parse(parsedResult);
    if (candidate.status !== 'projected') return false;
    const expected = projectConstructedSpyRawMark(input);
    return expected.status === 'projected' && canonical(candidate) === canonical(expected);
  } catch {
    return false;
  }
}
