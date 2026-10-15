// Pure hypothetical proposal/replay, never an order or independently verified fact.
import { createHash } from 'node:crypto';
import { decimalSchema } from './ledger-contract.js';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { matchesShadowRuleReceipt } from './shadow-rule.js';
import { units, decimal, rounded, notional, executionPrice, feeCap, checkObservation,
  simulationDigest, simulationInstrument, paperSizingFeeInclusiveCapUnits, paperSizingPolicyId, type Decimal } from './synthetic-simulation-economics.js';
import { shadowSizingInputSchema, shadowSizingProposalSchema, shadowSizingPolicyId,
  paperSizingInputSchema, paperSizingProposalSchema,
  type ShadowSizingInput, type ShadowSizingProposal,
  type PaperSizingInput, type PaperSizingProposal } from './shadow-sizing-contract.js';

type Action = Pick<ShadowSizingProposal, 'outcome' | 'reason' | 'attainment' | 'side' | 'quantity' | 'hypothetical'>;
const abstain = (reason: Action['reason']): Action => ({ outcome: 'abstain', reason, attainment: 'not_applicable', side: null, quantity: null, hypothetical: null });
const hold = (reason: Action['reason']): Action => ({ ...abstain(reason), outcome: 'no_action', attainment: 'no_action' });
const integerCompare = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;
const maxQuantityUnits = 10n ** 38n - 1n;

function bound(v: ShadowSizingInput): boolean {
  const r = v.ruleReceipt, i = v.ruleInput, c = v.config, s = v.portfolio.snapshot;
  return i.runId === c.runId && r.runId === c.runId && s.runId === c.runId
    && i.sourceCommit === c.sourceCommit && r.sourceCommit === c.sourceCommit
    && i.instrument.id === c.instrumentId && i.instrument.currency === c.currency
    && s.instrumentId === c.instrumentId && s.currency === c.currency
    && s.classification === c.classification
    && r.classification === (c.classification === 'constructed_offline_test' ? 'constructed_offline_test' : 'market_shadow_input')
    && s.configSha256 === simulationDigest(c) && s.genesisSha256 === simulationDigest(c.genesis)
    && i.portfolio.snapshotSha256 === simulationDigest(s)
    && units(i.costs.commissionPerTrade, 8) === units(c.costs.commissionPerOrder, 8)
    && units(i.costs.spreadFraction, 18) === units(c.costs.spreadFraction, 18)
    && units(i.costs.slippageFraction, 18) === units(c.costs.slippageFraction, 18)
    && i.costs.evidenceSha256 === c.calibrationEvidenceSha256;
}

function size(v: ShadowSizingInput): Action {
  if (v.lifecycleDisposition === 'unknown' || v.ruleInput.portfolio.state === 'unknown') return abstain('lifecycle_unknown');
  if (v.portfolio.state === 'unsettled') return abstain('unsettled_portfolio');
  if (v.ruleReceipt.decision === 'abstain') return abstain('rule_abstain');
  try {
    const times = [v.evaluationAt, v.ruleReceipt.decisionAt!, v.observation.observedAt, v.observation.availableAt];
    if (times.some(t => !Number.isSafeInteger(Date.parse(t)) || Date.parse(t) < 0)) return abstain('invalid_observation');
    checkObservation(v.config, v.ruleReceipt.decisionAt!, v.observation, Date.parse(v.evaluationAt));
  } catch { return abstain('invalid_observation'); }
  const cash = units(v.portfolio.snapshot.cash, 8), q = units(v.portfolio.snapshot.quantity, 18);
  const mark = v.observation.referencePrice, quantum = units(v.quantityQuantum, 18), x = units(v.ruleReceipt.targetExposure!, 18);
  const fee = units(v.config.costs.commissionPerOrder, 8);
  // H and cash are represented at scale36; x at scale18. No ratio rounding.
  const ceiling = (cash8: bigint, qty18: bigint) => {
    const h = qty18 * units(mark, 18), equity = cash8 * 10n ** 28n + h;
    return integerCompare(h * 10n ** 18n, x * equity);
  };
  if (cash === 0n && q === 0n) return hold('zero_equity');
  if (v.ruleReceipt.decision === 'target_cash' && q === 0n) return hold('already_cash');
  const current = ceiling(cash, q);
  if (current === 0) return hold('already_at_ceiling');
  if (v.ruleReceipt.decision === 'target_long' && current > 0) return abstain('positive_target_overweight_unsupported');
  const side = v.ruleReceipt.decision === 'target_cash' ? 'sell' : 'buy';
  const limit = side === 'buy' ? v.buyLimitPrice : v.sellLimitPrice;
  let model: Decimal;
  try { model = executionPrice(v.config, side, mark); } catch { return abstain('unrepresentable_economics'); }
  const prices = integerCompare(units(model, 18), units(limit, 18));
  if (side === 'buy' ? prices > 0 : prices < 0) return abstain('limit_incompatible');

  function assessment(d: bigint) {
    const quantity = decimal(d, 18), postQ = side === 'buy' ? q + d : q - d;
    const post = (price: Decimal) => {
      const gross = rounded(notional(quantity, price), 36, 8, side === 'buy');
      const postCash = cash + (side === 'buy' ? -gross - fee : gross - fee);
      return { cash: decimal(postCash, 8), quantity: decimal(postQ, 18), relation: ceiling(postCash, postQ) };
    };
    return { quantity, modeled: post(model), bounded: post(limit) };
  }
  function feasible(d: bigint): boolean {
    try {
      if (d <= 0n || (side === 'sell' && (d > q || cash < fee))) return false;
      const qty = decimal(d, 18);
      if (!feeCap(qty, limit, v.config.costs.commissionPerOrder) || !feeCap(qty, model, v.config.costs.commissionPerOrder)) return false;
      const a = assessment(d);
      return a.modeled.relation <= 0 && a.bounded.relation <= 0;
    } catch { return false; }
  }
  let selected: bigint;
  if (side === 'sell') {
    if (q % quantum !== 0n) return abstain('cash_exit_not_on_grid');
    if (cash < fee) return abstain('cash_exit_fee_cash_unavailable');
    const qty = decimal(q, 18);
    if (!feeCap(qty, limit, v.config.costs.commissionPerOrder) || !feeCap(qty, model, v.config.costs.commissionPerOrder)) return abstain('cash_exit_exceeds_cap');
    if (!feasible(q)) return abstain('unrepresentable_economics');
    selected = q;
  } else {
    let low = 0n, high = (maxQuantityUnits - q) / quantum, iterations = 0;
    // Positive prices, nonnegative fees, Mbuy<=Lbuy and exact rounding give a
    // monotone feasible prefix. Zero is only a search sentinel, not an order.
    while (low < high) {
      if (++iterations > 128) return abstain('unrepresentable_economics');
      const middle = (low + high + 1n) / 2n;
      if (feasible(middle * quantum)) low = middle; else high = middle - 1n;
    }
    if (low === 0n) return abstain('no_buy_lot_fits');
    selected = low * quantum;
  }
  const a = assessment(selected);
  let attainment: ShadowSizingProposal['attainment'] = 'cash_exit';
  if (side === 'buy') {
    if (a.modeled.relation === 0) attainment = 'modeled_exact_ceiling';
    else {
      // Classify why the next lot is unavailable, independent of cash/cap when
      // possible. Exact signed cash preserves the mathematical ceiling check.
      const next = selected + quantum;
      if (next > maxQuantityUnits || q + next > maxQuantityUnits) attainment = 'constraint_limited_underallocation';
      else {
        const qty = decimal(next, 18), postQ = q + next;
        const nextRisk = (price: Decimal) => ceiling(cash - rounded(notional(qty, price), 36, 8, true) - fee, postQ);
        attainment = nextRisk(model) > 0 || nextRisk(limit) > 0 ? 'limit_quantized_underallocation' : 'constraint_limited_underallocation';
      }
    }
  }
  return {
    outcome: 'proposal', reason: side === 'buy' ? 'buy_proposal' : 'cash_exit_proposal', attainment, side, quantity: a.quantity,
    hypothetical: { bindingBasis: 'hypothetical_full_fill_same_supplied_mark_per_order_fee', referenceMark: mark,
      modeledFillPrice: model, orderLimit: limit, commissionPerOrder: v.config.costs.commissionPerOrder,
      modeledPostCash: a.modeled.cash, modeledPostQuantity: a.modeled.quantity,
      modeledCeilingRelation: a.modeled.relation === 0 ? 'equal' : 'below', limitPostCash: a.bounded.cash,
      limitPostQuantity: a.bounded.quantity, limitWithinCeiling: true },
  };
}

export function proposeShadowSizing(bytes: Buffer): ShadowSizingProposal {
  let input: ShadowSizingInput | null = null;
  let inputSha256: string | null = null, inputDigestKind: ShadowSizingProposal['inputDigestKind'] = 'unbound';
  let invalidReason: Action['reason'] = 'invalid_input';
  if (Buffer.isBuffer(bytes) && bytes.length <= shadowRuleMaxBytes) {
    inputSha256 = createHash('sha256').update(bytes).digest('hex'); inputDigestKind = 'rejected_bytes';
    try {
      const parsed = shadowSizingInputSchema.parse(parseResearchJSON(bytes));
      if (!matchesShadowRuleReceipt(Buffer.from(canonical(parsed.ruleInput)), parsed.ruleReceipt)) invalidReason = 'receipt_mismatch';
      else if (!bound(parsed)) invalidReason = 'binding_mismatch';
      else { input = parsed; inputSha256 = digest(canonical(input)); inputDigestKind = 'canonical_validated_input'; }
    } catch { /* Fail closed without raw input or exception text. */ }
  } else if (Buffer.isBuffer(bytes)) invalidReason = 'input_too_large';
  let action = input ? abstain('unrepresentable_economics') : abstain(invalidReason);
  if (input) { try { action = size(input); } catch { /* No partial proposal. */ } }
  const body = {
    schema: 'gelt.shadow-sizing-proposal.v1' as const, sizingPolicyId: shadowSizingPolicyId,
    inputValidation: input ? 'valid' as const : 'invalid' as const, inputSha256, inputDigestKind,
    runId: input?.config.runId ?? null, sourceCommit: input?.config.sourceCommit ?? null,
    ruleDecisionId: input?.ruleReceipt.decisionId ?? null, configSha256: input ? simulationDigest(input.config) : null,
    portfolioSnapshotSha256: input ? simulationDigest(input.portfolio.snapshot) : null,
    evaluationAt: input?.evaluationAt ?? null, classification: input?.config.classification ?? null,
    targetExposure: input?.ruleReceipt.targetExposure ?? null, ...action,
    effectAuthority: 'none' as const, marketEvaluation: 'not_established' as const, promotionAllowed: false as const,
    sourceAndProvenance: 'caller_assertions_not_independently_verified' as const,
  };
  return shadowSizingProposalSchema.parse({ ...body, proposalId: `shadow-sizing-${digest(canonical(body))}` });
}
export function matchesShadowSizingProposal(bytes: Buffer, raw: unknown): boolean {
  try {
    const proposal = shadowSizingProposalSchema.parse(raw);
    if (proposal.inputValidation !== 'valid') return false;
    const expected = proposeShadowSizing(bytes);
    return expected.inputValidation === 'valid' && canonical(expected) === canonical(proposal);
  } catch { return false; }
}

type PaperAction = Pick<PaperSizingProposal, 'outcome' | 'reason' | 'attainment' | 'side' | 'quantity' | 'hypothetical' | 'liquidationDisposition'>;
const paperAbstain = (reason: PaperAction['reason'], liquidationDisposition: PaperAction['liquidationDisposition'] = null): PaperAction => ({
  outcome: 'abstain', reason, attainment: 'not_applicable', side: null, quantity: null, hypothetical: null, liquidationDisposition,
});
const paperHold = (reason: PaperAction['reason']): PaperAction => ({
  ...paperAbstain(reason, 'not_applicable'), outcome: 'no_action', attainment: 'no_action',
});
const paperMaxQuantityUnits = 10n ** 38n - 1n;
const paperPolicySha256 = simulationDigest({
  schema: 'gelt.spy-long-cash-paper-policy.v1', policyId: paperSizingPolicyId,
  feeInclusiveOrderCap: '10000.00000000', targetExposureCeiling: '0.950000000000000000',
  quantityQuantum: '1.000000000000000000', genesisCash: '10000.00000000', genesisQuantity: '0.000000000000000000',
  base: { commissionPerOrder: '1.00000000', spreadFraction: '0.0002', slippageFraction: '0.0003' },
  stress: { commissionPerOrder: '1.00000000', spreadFraction: '0.001', slippageFraction: '0.0015' },
  overweight: 'abstain_without_trim', cashTarget: 'full_whole_exit_or_incomplete',
});

function paperPrice(v: PaperSizingInput, side: 'buy' | 'sell', reference: Decimal): Decimal {
  const r = decimalSchema.parse(reference), costs = v.config.costs;
  const adjustment = units(costs.spreadFraction, 18) + units(costs.slippageFraction, 18);
  const factor = side === 'buy' ? 10n ** 18n + adjustment : 10n ** 18n - adjustment;
  if (factor <= 0n || !/[1-9]/.test(r.value)) throw new Error('paper sizing unavailable');
  const value = rounded(BigInt(r.value.replace('.', '')) * factor, r.scale + 18, 8, side === 'buy');
  if (value <= 0n) throw new Error('paper sizing unavailable');
  return decimal(value, 8);
}

function paperFeeCap(quantity: Decimal, price: Decimal, fee: Decimal): boolean {
  return rounded(notional(quantity, price), 36, 8, true) + units(fee, 8) <= paperSizingFeeInclusiveCapUnits;
}

function paperBinding(v: PaperSizingInput): boolean {
  const c = v.config, m = v.mapping, s = v.portfolio.snapshot, i = v.ruleInput, r = v.ruleReceipt;
  const configSha256 = simulationDigest(c), mappingSha256 = simulationDigest(m);
  const genesisSha256 = simulationDigest(c.genesis), snapshotSha256 = simulationDigest(s);
  const evaluationAt = Date.parse(v.evaluationAt);
  const historyTimes = s.history.map(item => Date.parse(item.occurredAt));
  const fixedGenesis = s.revision !== 0 || s.cash.value === c.genesis.cash.value
    && s.quantity.value === c.genesis.quantity.value;
  const orderedHistory = historyTimes.every((time, index) => Number.isSafeInteger(time)
    && time <= evaluationAt && (index === 0 || time >= historyTimes[index - 1]));
  return c.policyId === paperSizingPolicyId && c.classification === 'constructed_offline_test'
    && c.runId === i.runId && c.runId === r.runId && c.runId === s.runId
    && c.sourceCommit === i.sourceCommit && c.sourceCommit === r.sourceCommit && c.sourceCommit === s.sourceCommit
    && c.scenarioId === c.costs.scenarioId && s.scenarioId === c.scenarioId
    && s.policyId === c.policyId && s.classification === c.classification
    && s.underlyingSymbol === m.underlying.symbol && s.internalInstrumentId === c.internalInstrumentId
    && s.currency === c.currency && m.internal.instrumentId === c.internalInstrumentId && m.internal.currency === c.currency
    && c.mappingSha256 === mappingSha256 && s.configSha256 === configSha256 && s.mappingSha256 === c.mappingSha256
    && s.genesisSha256 === genesisSha256 && fixedGenesis && orderedHistory
    && i.portfolio.snapshotSha256 === snapshotSha256
    && i.instrument.id === m.underlying.symbol && i.instrument.currency === m.underlying.currency
    && i.instrument.calendarSha256 === m.signal.calendarSha256
    && i.data.classification === c.classification && i.data.eligibility === 'declared'
    && i.policy.scheduleSha256 === c.scheduleSha256 && i.policy.maxAgeMs === c.signalMaxAgeMs
    && i.policy.exposureCap.value === '0.95' && i.policy.exposureCap.scale === 2
    && r.classification === c.classification && r.inputValidation === 'valid'
    && i.costs.status === 'declared'
    && units(i.costs.commissionPerTrade, 8) === units(c.costs.commissionPerOrder, 8)
    && units(i.costs.spreadFraction, 18) === units(c.costs.spreadFraction, 18)
    && units(i.costs.slippageFraction, 18) === units(c.costs.slippageFraction, 18)
    && i.costs.evidenceSha256 === c.costs.evidenceSha256
    && i.costs.stressScenarioSha256 === c.costs.stressScenarioSha256
    && v.observation.mappingSha256 === mappingSha256
    && v.observation.instrumentId === m.underlying.symbol;
}

function sizePaper(v: PaperSizingInput): PaperAction {
  if (v.lifecycleDisposition === 'unknown' || v.ruleInput.portfolio.state === 'unknown') return paperAbstain('lifecycle_unknown');
  if (v.portfolio.state !== 'settled') return paperAbstain('unsettled_portfolio');
  if (v.ruleReceipt.decision === 'abstain') return paperAbstain('rule_abstain');
  try {
    const decision = Date.parse(v.ruleReceipt.decisionAt!);
    const observed = Date.parse(v.observation.observedAt), available = Date.parse(v.observation.availableAt);
    const now = Date.parse(v.evaluationAt), validThrough = Date.parse(v.config.validThrough);
    if (![decision, observed, available, now, validThrough].every(Number.isSafeInteger)
      || [decision, observed, available, now, validThrough].some(t => t < 0)
      || decision > now || now > validThrough || now - decision > v.config.maxDecisionAgeMs
      || now - observed > v.config.maxObservationAgeMs || observed <= decision || available < observed || available > now) {
      return paperAbstain('invalid_observation');
    }
  } catch { return paperAbstain('invalid_observation'); }

  const cash = units(v.portfolio.snapshot.cash, 8), q = units(v.portfolio.snapshot.quantity, 18);
  const mark = v.observation.referencePrice, quantum = units(v.config.quantityQuantum, 18);
  const targetExposure = units(v.ruleReceipt.targetExposure!, 18), fee = units(v.config.costs.commissionPerOrder, 8);
  const ceiling = (cash8: bigint, qty18: bigint) => {
    const holding = qty18 * units(mark, 18), equity = cash8 * 10n ** 28n + holding;
    return integerCompare(holding * 10n ** 18n, targetExposure * equity);
  };
  if (cash === 0n && q === 0n) return paperHold('zero_equity');
  if (v.ruleReceipt.decision === 'target_cash' && q === 0n) return paperHold('already_cash');
  const current = ceiling(cash, q);
  if (v.ruleReceipt.decision === 'target_long' && current === 0) return paperHold('already_at_ceiling');
  if (v.ruleReceipt.decision === 'target_long' && current > 0) return paperAbstain('positive_target_overweight_unsupported');

  const side = v.ruleReceipt.decision === 'target_cash' ? 'sell' : 'buy';
  if (q % quantum !== 0n) return side === 'sell'
    ? paperAbstain('cash_exit_not_on_grid', 'holdings_retained_incomplete')
    : paperAbstain('current_position_not_on_grid');
  const limit = side === 'buy' ? v.buyLimitPrice : v.sellLimitPrice;
  let model: Decimal;
  const retained = side === 'sell' ? 'holdings_retained_incomplete' : null;
  try { model = paperPrice(v, side, mark); } catch { return paperAbstain('unrepresentable_economics', retained); }
  const priceOrder = integerCompare(units(model, 18), units(limit, 18));
  if (side === 'buy' ? priceOrder > 0 : priceOrder < 0) return paperAbstain('limit_incompatible', retained);

  function assessment(d: bigint) {
    const quantity = decimal(d, 18), postQuantity = side === 'buy' ? q + d : q - d;
    const post = (price: Decimal) => {
      const gross = rounded(notional(quantity, price), 36, 8, side === 'buy');
      const postCash = cash + (side === 'buy' ? -gross - fee : gross - fee);
      return { cash: decimal(postCash, 8), quantity: decimal(postQuantity, 18), relation: ceiling(postCash, postQuantity) };
    };
    return { quantity, modeled: post(model), limit: post(limit) };
  }
  function feasible(d: bigint): boolean {
    try {
      if (d <= 0n || (side === 'sell' && (d > q || cash < fee))) return false;
      const quantity = decimal(d, 18), costs = v.config.costs;
      if (!paperFeeCap(quantity, limit, costs.commissionPerOrder) || !paperFeeCap(quantity, model, costs.commissionPerOrder)) return false;
      const result = assessment(d);
      return result.modeled.relation <= 0 && result.limit.relation <= 0;
    } catch { return false; }
  }

  let selected: bigint;
  if (side === 'sell') {
    if (cash < fee) return paperAbstain('cash_exit_fee_cash_unavailable', 'holdings_retained_incomplete');
    const quantity = decimal(q, 18), costs = v.config.costs;
    if (!paperFeeCap(quantity, limit, costs.commissionPerOrder) || !paperFeeCap(quantity, model, costs.commissionPerOrder)) {
      return paperAbstain('cash_exit_exceeds_cap', 'holdings_retained_incomplete');
    }
    if (!feasible(q)) return paperAbstain('unrepresentable_economics', 'holdings_retained_incomplete');
    selected = q;
  } else {
    let low = 0n, high = (paperMaxQuantityUnits - q) / quantum, iterations = 0;
    while (low < high) {
      if (++iterations > 128) return paperAbstain('unrepresentable_economics');
      const middle = (low + high + 1n) / 2n;
      if (feasible(middle * quantum)) low = middle; else high = middle - 1n;
    }
    if (low === 0n) return paperAbstain('no_buy_lot_fits');
    selected = low * quantum;
  }

  let result: ReturnType<typeof assessment>;
  try { result = assessment(selected); } catch { return paperAbstain('unrepresentable_economics', retained); }
  let attainment: PaperSizingProposal['attainment'] = 'cash_exit';
  if (side === 'buy') {
    if (result.modeled.relation === 0) attainment = 'modeled_exact_ceiling';
    else {
      const next = selected + quantum;
      if (next > paperMaxQuantityUnits || q + next > paperMaxQuantityUnits) attainment = 'constraint_limited_underallocation';
      else {
        const nextQuantity = decimal(next, 18);
        const nextRisk = (price: Decimal) => ceiling(cash - rounded(notional(nextQuantity, price), 36, 8, true) - fee, q + next);
        attainment = nextRisk(model) > 0 || nextRisk(limit) > 0 ? 'limit_quantized_underallocation' : 'constraint_limited_underallocation';
      }
    }
  }
  return {
    outcome: 'proposal', reason: side === 'buy' ? 'buy_proposal' : 'cash_exit_proposal', attainment, side,
    quantity: result.quantity,
    hypothetical: { bindingBasis: 'hypothetical_full_fill_same_supplied_mark_per_order_fee', referenceMark: mark,
      modeledFillPrice: model, orderLimit: limit, commissionPerOrder: v.config.costs.commissionPerOrder,
      modeledPostCash: result.modeled.cash, modeledPostQuantity: result.modeled.quantity,
      modeledCeilingRelation: result.modeled.relation === 0 ? 'equal' : 'below',
      limitPostCash: result.limit.cash, limitPostQuantity: result.limit.quantity, limitWithinCeiling: true },
    liquidationDisposition: side === 'sell' ? 'hypothetical_full_exit_proposal' : 'not_applicable',
  };
}

export function proposePaperSizing(bytes: Buffer): PaperSizingProposal {
  let input: PaperSizingInput | null = null;
  let inputSha256: string | null = null, inputDigestKind: PaperSizingProposal['inputDigestKind'] = 'unbound';
  let invalidReason: PaperAction['reason'] = 'invalid_input';
  if (Buffer.isBuffer(bytes) && bytes.length <= shadowRuleMaxBytes) {
    inputSha256 = createHash('sha256').update(bytes).digest('hex'); inputDigestKind = 'rejected_bytes';
    try {
      const parsed = paperSizingInputSchema.parse(parseResearchJSON(bytes));
      if (!matchesShadowRuleReceipt(Buffer.from(canonical(parsed.ruleInput)), parsed.ruleReceipt)) invalidReason = 'receipt_mismatch';
      else if (!paperBinding(parsed)) invalidReason = 'binding_mismatch';
      else {
        input = parsed; inputSha256 = digest(canonical(input)); inputDigestKind = 'canonical_validated_input';
      }
    } catch { /* Rejected bytes and exception details stay inside this boundary. */ }
  } else if (Buffer.isBuffer(bytes)) invalidReason = 'input_too_large';
  let action = input ? paperAbstain('unrepresentable_economics') : paperAbstain(invalidReason);
  if (input) { try { action = sizePaper(input); } catch { /* No partial proposal escapes. */ } }
  const config = input?.config, mapping = input?.mapping, snapshotValue = input?.portfolio.snapshot;
  const body = {
    schema: 'gelt.paper-sizing-proposal.v1' as const, policyId: paperSizingPolicyId,
    inputValidation: input ? 'valid' as const : 'invalid' as const, inputSha256, inputDigestKind,
    runId: config?.runId ?? null, sourceCommit: config?.sourceCommit ?? null,
    classification: config?.classification ?? null, scenarioId: config?.scenarioId ?? null,
    policySha256: input ? paperPolicySha256 : null,
    scenarioSha256: config ? simulationDigest({ scenarioId: config.costs.scenarioId,
      commissionPerOrder: config.costs.commissionPerOrder, spreadFraction: config.costs.spreadFraction,
      slippageFraction: config.costs.slippageFraction }) : null,
    genesisSha256: config ? simulationDigest(config.genesis) : null,
    configSha256: config ? simulationDigest(config) : null,
    mappingSha256: mapping ? simulationDigest(mapping) : null,
    portfolioSnapshotSha256: snapshotValue ? simulationDigest(snapshotValue) : null,
    historySha256: snapshotValue ? simulationDigest(snapshotValue.history) : null,
    historyRevision: snapshotValue?.revision ?? null,
    ruleInputSha256: input ? digest(canonical(input.ruleInput)) : null,
    ruleReceiptSha256: input ? digest(canonical(input.ruleReceipt)) : null,
    evaluationAt: input?.evaluationAt ?? null, underlyingSymbol: input ? 'SPY' as const : null,
    internalInstrumentId: input ? simulationInstrument : null,
    targetExposure: input?.ruleReceipt.targetExposure ?? null, ...action,
    effectAuthority: 'none' as const, marketEvaluation: 'not_established' as const, promotionAllowed: false as const,
    sourceAndProvenance: 'caller_assertions_not_independently_verified' as const,
  };
  return paperSizingProposalSchema.parse({ ...body, proposalId: `paper-sizing-${digest(canonical(body))}` });
}

export function matchesPaperSizingProposal(bytes: Buffer, raw: unknown): boolean {
  try {
    const proposal = paperSizingProposalSchema.parse(raw);
    if (proposal.inputValidation !== 'valid') return false;
    const expected = proposePaperSizing(bytes);
    return expected.inputValidation === 'valid' && canonical(expected) === canonical(proposal);
  } catch { return false; }
}
