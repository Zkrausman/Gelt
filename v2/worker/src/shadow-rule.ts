import { createHash } from 'node:crypto';
import { canonical, digest } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import {
  decimalCompare, shadowRuleId, shadowRuleInputSchema, shadowRuleMaxBytes,
  shadowRuleReceiptSchema, type ShadowRuleInput, type ShadowRuleReceipt,
} from './shadow-rule-contract.js';

type Result = Pick<ShadowRuleReceipt, 'decision' | 'reason' | 'targetExposure'>;
const abstain = (reason: Result['reason']): Result => ({ decision: 'abstain', reason, targetExposure: null });

function signal(input: ShadowRuleInput): Result {
  if (input.data.eligibility !== 'declared') return abstain('unverified_data');
  if (input.costs.status !== 'declared') return abstain('unverified_costs');
  if (input.portfolio.state === 'unknown') return abstain('execution_unknown');
  const decisionAt = Date.parse(input.decisionAt);
  for (let i = 0; i < input.bars.length; i++) {
    const bar = input.bars[i], closed = Date.parse(bar.closedAt), available = Date.parse(bar.availableAt);
    if (available < closed || available > decisionAt || closed > decisionAt) return abstain('ineligible_timestamp');
    if (i > 0 && (bar.sessionOrdinal !== input.bars[i - 1].sessionOrdinal + 1
      || closed <= Date.parse(input.bars[i - 1].closedAt))) return abstain('noncontiguous_observations');
  }
  if (input.bars.length < 253) return abstain('insufficient_warmup');
  const first = input.bars[0], last = input.bars[252];
  if (decisionAt - Date.parse(last.closedAt) > input.policy.maxAgeMs) return abstain('stale_input');
  // Price positivity is schema-checked: sign(Pt/Pt-252 - 1) == sign(Pt - Pt-252).
  if (decimalCompare(last.adjustedClose, first.adjustedClose) > 0) {
    return { decision: 'target_long', reason: 'positive_return', targetExposure: input.policy.exposureCap };
  }
  return { decision: 'target_cash', reason: 'nonpositive_return', targetExposure: { value: '0', precision: 1, scale: 0 } };
}

// Pure synchronous evaluation, not a scheduler, sizing/order adapter or artifact
// verifier. No filesystem, subprocess, network, credentials or clock dependency.
export function evaluateShadowRule(bytes: Buffer): ShadowRuleReceipt {
  let input: ShadowRuleInput | null = null;
  let inputSha256: string | null = null;
  let inputDigestKind: ShadowRuleReceipt['inputDigestKind'] = 'unbound';
  if (Buffer.isBuffer(bytes) && bytes.length <= shadowRuleMaxBytes) {
    inputSha256 = createHash('sha256').update(bytes).digest('hex'); inputDigestKind = 'rejected_bytes';
    try {
      input = shadowRuleInputSchema.parse(parseResearchJSON(bytes));
      inputSha256 = digest(canonical(input)); inputDigestKind = 'canonical_validated_input';
    } catch { /* No raw values or validation exception text leave this boundary. */ }
  }
  const result = input ? signal(input) : abstain('invalid_input');
  const body = {
    schema: 'gelt.shadow-rule-receipt.v1' as const, ruleId: shadowRuleId,
    runId: input?.runId ?? null, sourceCommit: input?.sourceCommit ?? null,
    decisionAt: input?.decisionAt ?? null, inputSha256, inputDigestKind,
    inputValidation: input ? 'valid' as const : 'invalid' as const,
    classification: input?.data.classification ?? null, ...result,
    evidence: input ? {
      datasetSha256: digest(canonical({ instrument: input.instrument, data: input.data, bars: input.bars })),
      costsSha256: digest(canonical(input.costs)), controlsSha256: digest(canonical(input.controls)),
      portfolioSha256: digest(canonical(input.portfolio)),
    } : null,
    scope: 'paper-derived-rule-adaptation' as const,
    sourceAndProvenance: 'caller_assertions_not_independently_verified' as const,
    marketEvaluation: 'not_established' as const, effectAuthority: 'none' as const,
    promotionAllowed: false as const,
  };
  return shadowRuleReceiptSchema.parse({ ...body, decisionId: `shadow-decision-${digest(canonical(body))}` });
}

// Exact input/result replay comparison, not provenance authentication or effect
// admission. Rejected/unbound inputs never become a correlatable valid decision.
export function matchesShadowRuleReceipt(bytes: Buffer, value: unknown): boolean {
  const parsed = shadowRuleReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.inputValidation !== 'valid') return false;
  const expected = evaluateShadowRule(bytes);
  return expected.inputValidation === 'valid' && canonical(expected) === canonical(parsed.data);
}
