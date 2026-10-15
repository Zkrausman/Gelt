import { z } from 'zod';
import {
  alpacaAvailabilitySchema,
  alpacaSessionCalendarSchema,
  type AlpacaAvailability,
  type AlpacaIexAcquisition,
  type AlpacaIexNormalizedBars,
  type AlpacaSessionCalendar,
} from './alpaca-iex-contract.js';
import { normalizeAlpacaIexBars, type AlpacaIexNormalizationInput } from './alpaca-iex-normalization.js';
import { canonical, digest } from './ledger-canonical.js';
import { evaluateShadowRule, matchesShadowRuleReceipt } from './shadow-rule.js';
import {
  shadowRuleId,
  shadowRuleInputSchema,
  shadowRuleMaxBytes,
  shadowRuleReceiptSchema,
  type ShadowRuleInput,
  type ShadowRuleReceipt,
} from './shadow-rule-contract.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/);
const ordinal = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// PR13 is the accepted source pin for the shipped acquisition/normalization
// seam. The caller's G05 sourceCommit remains a separate assertion.
export const alpacaShadowCandidateConnectorPin = Object.freeze({
  repositoryId: 1415613140,
  pullRequest: 13,
  reviewedSource: 'b2a13a02430dc1d650d641648e3ed28d0d45834b',
  mergeCommit: '17a745bf152d7295b6ea44d3348b8160af21e351',
  sourceTree: '4d70dab852fd35db2f4fe406e6c4c0395cec640b',
} as const);

const contextSchema = z.object({
  runId: z.string().uuid(),
  sourceCommit,
  expectedCalendarSha256: hash,
  expectedWindow: z.object({
    firstSessionOrdinal: ordinal,
    lastSessionOrdinal: ordinal,
    observationCount: z.number().int().min(1).max(253),
  }).strict(),
  rightsEvidenceSha256: hash,
  policy: shadowRuleInputSchema.shape.policy,
  costs: shadowRuleInputSchema.shape.costs,
  controls: shadowRuleInputSchema.shape.controls,
  portfolio: shadowRuleInputSchema.shape.portfolio,
}).strict();

export type AlpacaShadowCandidateContext = z.infer<typeof contextSchema>;

export const alpacaShadowCandidateUnresolvedGates = Object.freeze({
  A1_source_rights: 'not_established',
  A2_finite_retention: 'not_established',
  A3_eligible_253_window: 'not_established',
  A4_exact_provenance: 'not_established',
  A5_schedule_freshness: 'not_established',
  A6_cost_stress_passive_cash: 'not_established',
  A7_initial_portfolio_risk_context: 'not_established',
} as const);

type UnresolvedGate = keyof typeof alpacaShadowCandidateUnresolvedGates;
type BlockReason =
  | 'missing_context'
  | 'invalid_context'
  | 'invalid_normalization_input'
  | 'normalization_rejected'
  | 'calendar_mismatch'
  | 'window_mismatch'
  | 'invalid_g05_input'
  | 'input_too_large'
  | 'replay_mismatch';

type BlockedCandidate = Readonly<{
  schema: 'gelt.alpaca-shadow-candidate-result.v1';
  status: 'blocked';
  reason: BlockReason;
  blockedGates: readonly UnresolvedGate[];
  missingContextFields: readonly string[];
  knownMissingGates: typeof alpacaShadowCandidateUnresolvedGates;
  classification: 'market_shadow_input';
  eligibility: 'unverified';
  effectAuthority: 'none';
  promotionAllowed: false;
}>;

type CandidateManifest = Readonly<{
  schema: 'gelt.alpaca-shadow-input-candidate.v1';
  source: Readonly<{
    connectorPin: typeof alpacaShadowCandidateConnectorPin;
    sourceCommit: string;
    normalizerSchema: AlpacaIexNormalizedBars['schema'];
    ruleId: typeof shadowRuleId;
  }>;
  dataBody: Readonly<Record<string, unknown>>;
  datasetSha256: string;
  pointInTimeBody: Readonly<Record<string, unknown>>;
  pointInTimeEvidenceSha256: string;
  g05InputSha256: string;
  g05InputByteLength: number;
  g05ReceiptSha256: string;
  knownMissingGates: typeof alpacaShadowCandidateUnresolvedGates;
  rawBodies: 'not_included';
  retentionAuthority: 'none';
  classification: 'market_shadow_input';
  eligibility: 'unverified';
  marketEvaluation: 'not_established';
  effectAuthority: 'none';
  promotionAllowed: false;
}>;

type CompleteCandidate = Readonly<{
  schema: 'gelt.alpaca-shadow-candidate-result.v1';
  status: 'candidate';
  blockedGates: readonly [];
  missingContextFields: readonly [];
  knownMissingGates: typeof alpacaShadowCandidateUnresolvedGates;
  input: ShadowRuleInput;
  canonicalInput: string;
  receipt: ShadowRuleReceipt;
  replayMatches: true;
  manifest: CandidateManifest;
  classification: 'market_shadow_input';
  eligibility: 'unverified';
  effectAuthority: 'none';
  promotionAllowed: false;
}>;

export type AlpacaShadowCandidate = BlockedCandidate | CompleteCandidate;

const blockedGateForReason: Partial<Record<BlockReason, UnresolvedGate>> = {
  invalid_normalization_input: 'A4_exact_provenance',
  normalization_rejected: 'A4_exact_provenance',
  calendar_mismatch: 'A3_eligible_253_window',
  window_mismatch: 'A3_eligible_253_window',
  invalid_g05_input: 'A4_exact_provenance',
  input_too_large: 'A4_exact_provenance',
  replay_mismatch: 'A4_exact_provenance',
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) return false;
  const stringKeys = (ownKeys as string[]).sort();
  const expected = [...keys].sort();
  if (stringKeys.length !== expected.length || stringKeys.some((key, index) => key !== expected[index])) return false;
  return stringKeys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && descriptor.enumerable && 'value' in descriptor);
  });
}

function missingContextFields(issues: readonly z.ZodIssue[]): string[] {
  return issues
    .filter(issue => issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined')
    .map(issue => issue.path.join('.'))
    .filter(Boolean)
    .sort();
}

function block(reason: BlockReason, missing: readonly string[] = []): BlockedCandidate {
  const gate = blockedGateForReason[reason];
  return deepFreeze({
    schema: 'gelt.alpaca-shadow-candidate-result.v1',
    status: 'blocked',
    reason,
    blockedGates: gate ? [gate] : [],
    missingContextFields: [...missing],
    knownMissingGates: alpacaShadowCandidateUnresolvedGates,
    classification: 'market_shadow_input',
    eligibility: 'unverified',
    effectAuthority: 'none',
    promotionAllowed: false,
  });
}

function safePageReferences(acquisition: AlpacaIexAcquisition) {
  return acquisition.pages.map(({ page, byteLength, sha256 }) => ({ page, byteLength, sha256 }));
}

function buildDataBody(
  acquisition: AlpacaIexAcquisition,
  normalized: AlpacaIexNormalizedBars,
  context: AlpacaShadowCandidateContext,
) {
  return {
    schema: 'gelt.alpaca-shadow-candidate-data.v1',
    connectorPin: alpacaShadowCandidateConnectorPin,
    sourceCommit: context.sourceCommit,
    normalizerSchema: normalized.schema,
    classification: normalized.classification,
    eligibility: normalized.eligibility,
    source: normalized.source,
    feed: normalized.feed,
    symbol: normalized.symbol,
    currency: 'USD',
    timeframe: '1Day',
    adjustment: normalized.adjustment,
    asof: normalized.asof,
    request: {
      ...acquisition.request,
      pageRequests: acquisition.request.pageRequests.map(entry => ({ ...entry })),
    },
    rawPages: safePageReferences(acquisition),
    receivedAt: normalized.receivedAt,
    calendarSha256: normalized.calendarSha256,
    normalizedBarsSha256: digest(canonical(normalized.bars)),
  };
}

function asNormalizationInput(input: AlpacaIexNormalizationInput): boolean {
  return exactKeys(input, [
    'source', 'feed', 'symbol', 'adjustment', 'asof', 'calendar', 'availability', 'receivedAt', 'decisionAt',
  ]);
}

/**
 * Assemble and evaluate an in-memory, permanently unverified Alpaca candidate.
 * This function does not acquire data, read a clock, store evidence, or promote it.
 */
export function buildAlpacaShadowCandidate(
  acquisition: unknown,
  normalizationInput: AlpacaIexNormalizationInput,
  contextInput: unknown,
): AlpacaShadowCandidate {
  if (contextInput === undefined) return block('missing_context', ['context']);
  let context: AlpacaShadowCandidateContext;
  let parsedContext: ReturnType<typeof contextSchema.safeParse>;
  try { parsedContext = contextSchema.safeParse(contextInput); }
  catch { return block('invalid_context'); }
  if (!parsedContext.success) {
    const missing = missingContextFields(parsedContext.error.issues);
    const hasOtherError = parsedContext.error.issues.some(issue =>
      !(issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined'));
    return block(missing.length > 0 && !hasOtherError ? 'missing_context' : 'invalid_context', missing);
  }
  try {
    if (!exactKeys(contextInput, [
      'runId', 'sourceCommit', 'expectedCalendarSha256', 'expectedWindow', 'rightsEvidenceSha256',
      'policy', 'costs', 'controls', 'portfolio',
    ])) return block('invalid_context');
  } catch { return block('invalid_context'); }
  context = parsedContext.data;

  try {
    if (!asNormalizationInput(normalizationInput)) return block('invalid_normalization_input');
  } catch { return block('invalid_normalization_input'); }

  let normalized: AlpacaIexNormalizedBars;
  try {
    // Preserve the existing process-local issuance and raw-response checks.
    normalized = normalizeAlpacaIexBars(acquisition, normalizationInput);
  } catch {
    return block('normalization_rejected');
  }

  let calendar: AlpacaSessionCalendar;
  let availability: AlpacaAvailability[];
  try {
    calendar = alpacaSessionCalendarSchema.parse(normalizationInput.calendar);
    availability = normalizationInput.availability.map(fact => alpacaAvailabilitySchema.parse(fact));
  } catch {
    return block('normalization_rejected');
  }

  if (context.expectedCalendarSha256 !== calendar.sha256
    || context.expectedCalendarSha256 !== normalized.calendarSha256) return block('calendar_mismatch');

  const sessions = calendar.sessions;
  const expectedWindow = context.expectedWindow;
  if (normalized.bars.length !== expectedWindow.observationCount
    || sessions.length !== expectedWindow.observationCount
    || normalized.bars[0]?.sessionOrdinal !== expectedWindow.firstSessionOrdinal
    || normalized.bars[normalized.bars.length - 1]?.sessionOrdinal !== expectedWindow.lastSessionOrdinal
    || expectedWindow.lastSessionOrdinal - expectedWindow.firstSessionOrdinal + 1 !== expectedWindow.observationCount) {
    return block('window_mismatch');
  }

  const dataBody = buildDataBody(acquisition as AlpacaIexAcquisition, normalized, context);
  const datasetSha256 = digest(canonical(dataBody));
  const pointInTimeBody = {
    schema: 'gelt.alpaca-shadow-candidate-point-in-time.v1',
    datasetSha256,
    decisionAt: normalizationInput.decisionAt,
    receivedAt: normalized.receivedAt,
    expectedCalendarSha256: context.expectedCalendarSha256,
    expectedWindow: { ...expectedWindow },
    calendar,
    availability,
    normalizationAvailabilityEvidenceSha256: normalized.availabilityEvidenceSha256,
  };
  const pointInTimeEvidenceSha256 = digest(canonical(pointInTimeBody));

  const candidateInput = {
    schema: 'gelt.shadow-rule-input.v1' as const,
    ruleId: shadowRuleId,
    runId: context.runId,
    sourceCommit: context.sourceCommit,
    decisionAt: normalizationInput.decisionAt,
    instrument: {
      id: normalized.symbol,
      currency: 'USD',
      calendarSha256: normalized.calendarSha256,
    },
    data: {
      classification: 'market_shadow_input' as const,
      eligibility: 'unverified' as const,
      datasetSha256,
      rightsEvidenceSha256: context.rightsEvidenceSha256,
      pointInTimeEvidenceSha256,
    },
    policy: context.policy,
    costs: context.costs,
    controls: context.controls,
    portfolio: context.portfolio,
    bars: normalized.bars,
  };
  const inputParsed = shadowRuleInputSchema.safeParse(candidateInput);
  if (!inputParsed.success) return block('invalid_g05_input');
  const input = inputParsed.data;
  const canonicalInput = canonical(input);
  const inputByteLength = Buffer.byteLength(canonicalInput, 'utf8');
  if (inputByteLength > shadowRuleMaxBytes) return block('input_too_large');

  const inputBytes = Buffer.from(canonicalInput, 'utf8');
  const receiptParsed = shadowRuleReceiptSchema.safeParse(evaluateShadowRule(inputBytes));
  if (!receiptParsed.success) return block('replay_mismatch');
  const receipt = receiptParsed.data;
  if (!matchesShadowRuleReceipt(inputBytes, receipt)
    || receipt.inputValidation !== 'valid'
    || receipt.classification !== 'market_shadow_input'
    || receipt.decision !== 'abstain'
    || receipt.reason !== 'unverified_data'
    || receipt.effectAuthority !== 'none'
    || receipt.promotionAllowed !== false) return block('replay_mismatch');

  const manifest = {
    schema: 'gelt.alpaca-shadow-input-candidate.v1' as const,
    source: {
      connectorPin: alpacaShadowCandidateConnectorPin,
      sourceCommit: context.sourceCommit,
      normalizerSchema: normalized.schema,
      ruleId: shadowRuleId,
    },
    dataBody,
    datasetSha256,
    pointInTimeBody,
    pointInTimeEvidenceSha256,
    g05InputSha256: digest(canonicalInput),
    g05InputByteLength: inputByteLength,
    g05ReceiptSha256: digest(canonical(receipt)),
    knownMissingGates: alpacaShadowCandidateUnresolvedGates,
    rawBodies: 'not_included' as const,
    retentionAuthority: 'none' as const,
    classification: 'market_shadow_input' as const,
    eligibility: 'unverified' as const,
    marketEvaluation: 'not_established' as const,
    effectAuthority: 'none' as const,
    promotionAllowed: false as const,
  };
  return deepFreeze({
    schema: 'gelt.alpaca-shadow-candidate-result.v1' as const,
    status: 'candidate' as const,
    blockedGates: [] as const,
    missingContextFields: [] as const,
    knownMissingGates: alpacaShadowCandidateUnresolvedGates,
    input,
    canonicalInput,
    receipt,
    replayMatches: true as const,
    manifest,
    classification: 'market_shadow_input' as const,
    eligibility: 'unverified' as const,
    effectAuthority: 'none' as const,
    promotionAllowed: false as const,
  });
}
