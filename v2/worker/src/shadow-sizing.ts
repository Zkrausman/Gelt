// Pure hypothetical proposal/replay, never an order or independently verified fact.
import { createHash } from 'node:crypto';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { shadowRuleMaxBytes } from './shadow-rule-contract.js';
import { matchesShadowRuleReceipt } from './shadow-rule.js';
import { units, decimal, rounded, notional, executionPrice, feeCap, checkObservation,
  simulationDigest, type Decimal } from './synthetic-simulation-economics.js';
import { shadowSizingInputSchema, shadowSizingProposalSchema, shadowSizingPolicyId,
  type ShadowSizingInput, type ShadowSizingProposal } from './shadow-sizing-contract.js';

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
