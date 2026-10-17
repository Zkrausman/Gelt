import { z } from 'zod';
import { alpacaSessionCalendarSchema } from './alpaca-iex-contract.js';
import { canonical } from './ledger-canonical.js';
import { parseResearchJSON } from './research-json.js';
import { shadowRuleInputSchema, shadowRuleMaxBytes, shadowRuleReceiptSchema } from './shadow-rule-contract.js';
import { matchesShadowRuleReceipt } from './shadow-rule.js';
import { paperInstrumentMappingSchema, paperSizingConfigSchema } from './shadow-sizing-contract.js';
import { paperSizingPolicyId, simulationDigest, simulationHash, simulationTimestamp } from './synthetic-simulation-economics.js';

const timestamp = simulationTimestamp.refine(s => Number.isSafeInteger(Date.parse(s)) && Date.parse(s) >= 0);
const inputSchema = z.object({
  schema: z.literal('gelt.paper-calendar-binding-input.v1'), policyId: z.literal(paperSizingPolicyId),
  config: paperSizingConfigSchema, mapping: paperInstrumentMappingSchema,
  ruleInput: shadowRuleInputSchema, ruleReceipt: shadowRuleReceiptSchema, calendar: alpacaSessionCalendarSchema,
}).strict();
export type PaperCalendarBindingInput = z.infer<typeof inputSchema>;
const rejectedSchema = z.object({
  schema: z.literal('gelt.paper-calendar-binding.v1'), status: z.literal('rejected'), reason: z.literal('invalid_input'),
}).strict();
const ordinal = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resultSchema = z.discriminatedUnion('status', [rejectedSchema, z.object({
  schema: z.literal('gelt.paper-calendar-binding.v1'), status: z.literal('bound'), reason: z.literal('exact_supplied_calendar_window'),
  bindingId: z.string().regex(/^paper-calendar-[a-f0-9]{64}$/),
  inputSha256: simulationHash, inputDigestKind: z.literal('canonical_validated_input'),
  configSha256: simulationHash, mappingSha256: simulationHash, ruleInputSha256: simulationHash, ruleReceiptSha256: simulationHash,
  calendarSha256: simulationHash, calendarInputSha256: simulationHash, barsSha256: simulationHash,
  runId: z.string().uuid(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  decisionId: z.string().regex(/^shadow-decision-[a-f0-9]{64}$/), decisionAt: timestamp,
  barCount: z.number().int().min(1).max(253), firstSessionOrdinal: ordinal, lastSessionOrdinal: ordinal, lastClosedAt: timestamp,
  classification: z.literal('constructed_offline_test'), bindingBasis: z.literal('exact_window_in_supplied_calendar'),
  calendarAuthenticity: z.literal('not_established'), marketEvaluation: z.literal('not_established'),
  sourceAndProvenance: z.literal('caller_assertions_not_independently_verified'),
  effectAuthority: z.literal('none'), promotionAllowed: z.literal(false),
}).strict()]);
export type PaperCalendarBinding = z.infer<typeof resultSchema>;
const rejected = (): PaperCalendarBinding => ({ schema: 'gelt.paper-calendar-binding.v1', status: 'rejected', reason: 'invalid_input' });

// Declared-calendar equality only. Does not call normalization/connector,
// authenticate calendar truth, alter the rule decision or admit an effect.
export function bindPaperCalendar(bytes: Buffer): PaperCalendarBinding {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > shadowRuleMaxBytes) return rejected();
    const input = inputSchema.parse(parseResearchJSON(bytes));
    const { config: c, mapping: m, ruleInput: i, ruleReceipt: r, calendar } = input;
    const mappingSha256 = simulationDigest(m);
    if (!matchesShadowRuleReceipt(Buffer.from(canonical(i)), r) || r.inputValidation !== 'valid'
      || i.runId !== c.runId || r.runId !== c.runId || i.sourceCommit !== c.sourceCommit || r.sourceCommit !== c.sourceCommit
      || i.data.classification !== c.classification || r.classification !== c.classification || i.data.eligibility !== 'declared'
      || i.instrument.id !== m.underlying.symbol || i.instrument.currency !== m.underlying.currency
      || calendar.symbol !== m.underlying.symbol || i.instrument.calendarSha256 !== calendar.sha256
      || m.signal.calendarSha256 !== calendar.sha256 || c.mappingSha256 !== mappingSha256
      || c.internalInstrumentId !== m.internal.instrumentId || c.currency !== m.internal.currency
      || i.policy.scheduleSha256 !== c.scheduleSha256 || i.policy.maxAgeMs !== c.signalMaxAgeMs
      || i.policy.exposureCap.value !== '0.95' || i.policy.exposureCap.scale !== 2
      || !timestamp.safeParse(i.decisionAt).success || i.bars.length < 1 || i.bars.length !== calendar.sessions.length) return rejected();
    const decision = Date.parse(i.decisionAt);
    for (let index = 0; index < i.bars.length; index++) {
      const bar = i.bars[index], session = calendar.sessions[index];
      const times = [session.providerTimestamp, session.closedAt, session.completedAt, bar.availableAt];
      if (times.some(t => !timestamp.safeParse(t).success)) return rejected();
      const [provider, closed, completed, available] = times.map(t => Date.parse(t));
      if (bar.sessionOrdinal !== session.sessionOrdinal || bar.closedAt !== session.closedAt
        || provider > closed || closed > completed || completed > available || available > decision) return rejected();
      if (index > 0) {
        const previous = calendar.sessions[index - 1];
        if (session.sessionOrdinal !== previous.sessionOrdinal + 1
          || provider <= Date.parse(previous.providerTimestamp) || closed <= Date.parse(previous.closedAt)) return rejected();
      }
    }
    const last = i.bars[i.bars.length - 1];
    const body = {
      schema: 'gelt.paper-calendar-binding.v1' as const, status: 'bound' as const, reason: 'exact_supplied_calendar_window' as const,
      inputSha256: simulationDigest(input), inputDigestKind: 'canonical_validated_input' as const,
      configSha256: simulationDigest(c), mappingSha256, ruleInputSha256: simulationDigest(i), ruleReceiptSha256: simulationDigest(r),
      calendarSha256: calendar.sha256, calendarInputSha256: simulationDigest(calendar), barsSha256: simulationDigest(i.bars),
      runId: c.runId, sourceCommit: c.sourceCommit, decisionId: r.decisionId, decisionAt: i.decisionAt,
      barCount: i.bars.length, firstSessionOrdinal: i.bars[0].sessionOrdinal, lastSessionOrdinal: last.sessionOrdinal, lastClosedAt: last.closedAt,
      classification: 'constructed_offline_test' as const, bindingBasis: 'exact_window_in_supplied_calendar' as const,
      calendarAuthenticity: 'not_established' as const, marketEvaluation: 'not_established' as const,
      sourceAndProvenance: 'caller_assertions_not_independently_verified' as const, effectAuthority: 'none' as const, promotionAllowed: false as const,
    };
    return resultSchema.parse({ ...body, bindingId: `paper-calendar-${simulationDigest(body)}` });
  } catch { return rejected(); }
}

export function matchesPaperCalendarBinding(bytes: Buffer, value: unknown): boolean {
  try {
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success || parsed.data.status === 'rejected') return false;
    const expected = bindPaperCalendar(bytes);
    return expected.status === 'bound' && canonical(parsed.data) === canonical(expected);
  } catch { return false; }
}
