import { intentSchema, decimalSchema, ledgerId } from './ledger-contract.js';
import { shadowSizingInputSchema, type ShadowSizingProposal } from './shadow-sizing-contract.js';
import { proposeShadowSizing, matchesShadowSizingProposal } from './shadow-sizing.js';
import { assertConfiguredSubmitPermit, consumeConfiguredSubmitPermit, type ConfiguredBindingLease } from './order-lifecycle.js';
import { sizingBindingPolicySchema, sizingBindingRejectionSchema, type SizingBindingPolicy, type SizingEvidence } from './synthetic-mock-robinhood-contract.js';
import { randomUUID, createHash } from 'node:crypto';
import { confirmationInputSchema } from './order-lifecycle.js';
import type { OrderAdapter, OrderPreview } from './order-lifecycle.js';
import { canonical } from './ledger-canonical.js';
import {
  syntheticMockFee, syntheticMockInstrument, syntheticMockPreviewSchema, syntheticMockQuote,
  syntheticMockSource, type SyntheticMockPreview,
} from './synthetic-mock-robinhood-contract.js';
import { SyntheticMockRobinhoodClient } from './synthetic-mock-robinhood-transport.js';
import { matchesShadowRuleReceipt } from './shadow-rule.js';
import { shadowRuleReceiptSchema, shadowRuleInputSchema } from './shadow-rule-contract.js';
import { parseResearchJSON } from './research-json.js';
import { simulationRunSchema, simulationObservationSchema, simulationDigest, simulationSource, simulationPolicy, executionPrice, checkObservation, units, type SimulationRun, type SimulationObservation, type SimulationSnapshot } from './synthetic-simulation-economics.js';
import { SyntheticPreviewDiagnostics } from './synthetic-preview-diagnostics.js';
import { z } from 'zod';
import { pamrConsumerInputSchema, pamrConsumerLimits, pamrConsumerPolicyId, type PAMRConsumerProposal } from './pamr-consumer-contract.js';
import { derivePAMRConsumerPrefix, matchesPAMRConsumerProposal, pamrConsumerPolicySha256, proposePAMRConsumer } from './pamr-consumer-adapter.js';
import { configuredPAMROwnerPolicySha256, pamrConsumptionEvidenceLinkSchema, pamrConsumptionLink, pamrConsumptionOwnerPolicySchema, type PAMRConsumptionEvidenceLink, type PAMRConsumptionOwnerPolicy } from './pamr-consumer-evidence-contract.js';
import { PAMRConsumptionRejected, type PAMRConsumptionReplay } from './synthetic-sizing-binding-evidence.js';
import { syntheticMockPAMRRunPreviewSchema } from './synthetic-mock-robinhood-contract.js';

function enabled(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only';
}
function tokenDigest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

export type SimulationDecisionContext = { inputBytes: Buffer; receipt: unknown; observation: SimulationObservation };
export type PAMRProducerContext = { artifactText: string; prefixAvailableAt: string; decisionAt: string; observation: SimulationObservation };
type ProducerPortfolio = { snapshot: SimulationSnapshot; state: 'settled' | 'unsettled' };
export type SimulationAdapterOptions = { config: SimulationRun; decision?: () => SimulationDecisionContext;
  sizingBinding?: { policy: SizingBindingPolicy; producer: (context: { config: SimulationRun; portfolio: ProducerPortfolio }) => SimulationDecisionContext };
  pamrBinding?: { policy: PAMRConsumptionOwnerPolicy; producer: (context: { config: SimulationRun; portfolio: ProducerPortfolio }) => PAMRProducerContext } };
type G05BoundContext = { kind: 'g05'; bytes: Buffer; proposal: ShadowSizingProposal; identity: string; lease: ConfiguredBindingLease };
type PAMRBoundContext = { kind: 'pamr'; bytes: Buffer; proposal: PAMRConsumerProposal; identity: string; lease: ConfiguredBindingLease; link: PAMRConsumptionEvidenceLink };
type BoundContext = G05BoundContext | PAMRBoundContext;
export type BindingEvidenceWriter = (bytes: Buffer, proposal: ShadowSizingProposal) => SizingEvidence;
export type PAMRBindingEvidence = {
  prepare(bytes: Buffer, proposal: PAMRConsumerProposal): PAMRConsumptionEvidenceLink;
  read(link: PAMRConsumptionEvidenceLink): PAMRConsumptionReplay;
  fence(): void;
};
const pamrProducerSchema = z.object({
  artifactText: z.string().max(pamrConsumerLimits.artifact).refine(s => Buffer.byteLength(s, 'utf8') <= pamrConsumerLimits.artifact),
  prefixAvailableAt: z.string(), decisionAt: z.string(), observation: simulationObservationSchema,
}).strict();

// Also called by the harness before it creates either private storage owner.
export function validateSimulationAdapterOptions(raw: SimulationAdapterOptions): SimulationAdapterOptions {
  const config = simulationRunSchema.parse(raw.config);
  if ([raw.decision, raw.sizingBinding, raw.pamrBinding].filter(v => v !== undefined).length !== 1
    || (raw.decision !== undefined && typeof raw.decision !== 'function')
    || (raw.sizingBinding !== undefined && typeof raw.sizingBinding.producer !== 'function')
    || (raw.pamrBinding !== undefined && typeof raw.pamrBinding.producer !== 'function')) throw new Error('synthetic binding unavailable');
  if (raw.decision) return { config, decision: raw.decision };
  if (raw.sizingBinding) {
    const policy = sizingBindingPolicySchema.parse(raw.sizingBinding.policy);
    if (config.classification !== 'constructed_offline_test' || policy.runId !== config.runId
      || policy.sourceCommit !== config.sourceCommit || policy.configSha256 !== simulationDigest(config)) throw new Error('synthetic binding unavailable');
    return { config, sizingBinding: { policy, producer: raw.sizingBinding.producer } };
  }
  const policy = pamrConsumptionOwnerPolicySchema.parse(raw.pamrBinding!.policy);
  if (config.classification !== 'constructed_offline_test' || policy.runId !== config.runId
    || policy.sourceCommit !== config.sourceCommit || policy.configSha256 !== simulationDigest(config)) throw new Error('synthetic binding unavailable');
  return { config, pamrBinding: { policy, producer: raw.pamrBinding!.producer } };
}

export class SyntheticMockRobinhoodAdapter implements OrderAdapter {
  private prepared?: SyntheticMockPreview;
  private pending?: { preview: SyntheticMockPreview; confirmationToken: string; termsHash: string; handle: string; bound?: BoundContext };
  private admitting = false;
  private bound?: BoundContext;

  constructor(private readonly client: SyntheticMockRobinhoodClient, private readonly now: () => number = Date.now,
    private readonly previewDiagnostics?: SyntheticPreviewDiagnostics, private readonly simulation?: SimulationAdapterOptions,
    private readonly writeBindingEvidence?: BindingEvidenceWriter, private readonly pamrEvidence?: PAMRBindingEvidence) {
    if (!enabled()) throw new Error('synthetic mock disabled');
    if (simulation) this.simulation = validateSimulationAdapterOptions(simulation);
    if (this.simulation?.pamrBinding && (!pamrEvidence || writeBindingEvidence)
      || pamrEvidence && !this.simulation?.pamrBinding) throw new Error('synthetic binding unavailable');
  }

  private pamrPolicy(): PAMRConsumptionOwnerPolicy {
    if (!this.simulation?.pamrBinding || !this.pamrEvidence) throw new Error('synthetic binding unavailable');
    return pamrConsumptionOwnerPolicySchema.parse(this.simulation.pamrBinding.policy);
  }
  private checkPAMRBound(context: PAMRBoundContext, now: number): void {
    const input = pamrConsumerInputSchema.parse(parseResearchJSON(context.bytes)), policy = this.pamrPolicy();
    if (!matchesPAMRConsumerProposal(context.bytes.toString('utf8'), canonical(context.proposal))
      || !Number.isSafeInteger(now) || now < 0 || Date.parse(input.evaluationAt) > now
      || input.lifecycleDisposition !== 'settled' || input.inputPortfolioUnknown || input.portfolio.state !== 'settled'
      || canonical(input.config) !== canonical(this.simulation!.config)
      || canonical(input.quantityQuantum) !== canonical(policy.quantityQuantum)
      || canonical(input.buyLimitPrice) !== canonical(policy.buyLimitPrice)
      || canonical(input.sellLimitPrice) !== canonical(policy.sellLimitPrice)
      || context.link.configuredOwnerPolicySha256 !== configuredPAMROwnerPolicySha256(policy)
      || context.link.purePolicyDefinitionSha256 !== pamrConsumerPolicySha256) throw new Error('synthetic binding unavailable');
    checkObservation(input.config, input.decisionAt, input.observation, now);
    try {
      const replay = this.pamrEvidence!.read(pamrConsumptionEvidenceLinkSchema.parse(context.link));
      if (canonical(replay.input) !== context.bytes.toString('utf8')
        || canonical(replay.proposal) !== canonical(context.proposal)
        || canonical(pamrConsumptionLink(replay.manifest)) !== canonical(context.link)) throw new Error();
    } catch { this.pamrEvidence!.fence(); throw new Error('synthetic binding unavailable'); }
  }
  async preparePAMR(lease: ConfiguredBindingLease): Promise<{ order: unknown; sizingBinding: string } | { noOrder: unknown }> {
    if (!enabled() || this.prepared || this.pending || this.admitting || this.bound) throw new Error('synthetic binding unavailable');
    const reject = (reason: string) => ({ noOrder: {
      schema: 'gelt.pamr-consumer-binding-rejection.v1', classification: 'constructed_offline_test',
      outcome: 'no_order', reason, effectAuthority: 'none', promotionAllowed: false,
    } });
    lease.assertActive(); const portfolio = await this.client.portfolio(); lease.assertActive();
    const policy = this.pamrPolicy(), config = this.simulation!.config;
    if (portfolio.state !== 'settled') throw new Error('synthetic binding unavailable');
    let bytes: Buffer;
    try {
      const supplied = this.simulation!.pamrBinding!.producer(JSON.parse(canonical({ config, portfolio })));
      // Parse and copy the restricted DTO before the next await.
      const data = pamrProducerSchema.parse(supplied), evaluationAt = new Date(this.now()).toISOString();
      const hash = (domain: string, value: unknown) => tokenDigest(canonical({ domain, value }));
      bytes = Buffer.from(canonical(pamrConsumerInputSchema.parse({
        schema: 'gelt.pamr-consumer-input.v1', policyId: pamrConsumerPolicyId,
        artifactText: data.artifactText, config, portfolio, lifecycleDisposition: 'settled', inputPortfolioUnknown: false,
        decisionAt: data.decisionAt, prefixAvailableAt: data.prefixAvailableAt, evaluationAt, observation: data.observation,
        quantityQuantum: policy.quantityQuantum, buyLimitPrice: policy.buyLimitPrice, sellLimitPrice: policy.sellLimitPrice,
        binding: { ...derivePAMRConsumerPrefix(data.artifactText), runId: config.runId, sourceCommit: config.sourceCommit,
          configSha256: simulationDigest(config), policySha256: pamrConsumerPolicySha256,
          portfolioSnapshotSha256: simulationDigest(portfolio.snapshot),
          costsSha256: hash('gelt.pamr-consumer.costs.v1', config.costs),
          observationSha256: hash('gelt.pamr-consumer.observation.v1', data.observation),
          clockSha256: hash('gelt.pamr-consumer.clock.v1', {
            decisionAt: data.decisionAt, prefixAvailableAt: data.prefixAvailableAt, evaluationAt,
          }) },
      })));
    } catch { return reject('invalid_input'); }
    lease.assertActive();
    const computed = proposePAMRConsumer(bytes.toString('utf8'));
    if (computed.status !== 'computed') return reject(computed.reason);
    const proposal = computed.value;
    lease.assertActive(); const current = await this.client.portfolio(); lease.assertActive();
    if (canonical(current) !== canonical(portfolio)) throw new Error('synthetic binding unavailable');
    let link: PAMRConsumptionEvidenceLink;
    try {
      // Exactly one publication, including no_action and valid abstention.
      link = pamrConsumptionEvidenceLinkSchema.parse(this.pamrEvidence!.prepare(Buffer.from(bytes), proposal));
    } catch (error) {
      if (error instanceof PAMRConsumptionRejected) return reject(error.reason);
      this.pamrEvidence!.fence(); throw new Error('synthetic binding unavailable');
    }
    lease.assertActive();
    const identity = canonical({ mode: 'pamr', link });
    const context: PAMRBoundContext = { kind: 'pamr', bytes: Buffer.from(bytes),
      proposal: JSON.parse(canonical(proposal)), identity, lease, link };
    this.checkBound(context, this.now()); lease.assertActive();
    if (proposal.action.outcome !== 'proposal') return { noOrder: {
      schema: 'gelt.pamr-consumer-consumed-no-order.v1', classification: 'constructed_offline_test',
      proposal: JSON.parse(canonical(proposal)), pamrConsumption: pamrConsumptionEvidenceLinkSchema.parse(link),
    } };
    this.bound = context;
    return { order: { instrumentId: config.instrumentId, currency: 'USD', route: 'RHS', side: proposal.action.side,
      requestedQuantity: proposal.action.quantity, requestedLimitPrice: proposal.action.hypothetical!.orderLimit }, sizingBinding: identity };
  }

  private policy(): SizingBindingPolicy {
    if (!this.simulation?.sizingBinding || !this.writeBindingEvidence) throw new Error('synthetic binding unavailable');
    return sizingBindingPolicySchema.parse(this.simulation.sizingBinding.policy);
  }
  private checkBound(context: BoundContext, now: number): void {
    if (context.kind === 'pamr') { this.checkPAMRBound(context, now); return; }
    const input = shadowSizingInputSchema.parse(parseResearchJSON(context.bytes));
    if (!matchesShadowSizingProposal(context.bytes, context.proposal) || !Number.isSafeInteger(now) || now < 0
      || Date.parse(input.evaluationAt) > now || canonical(input.config) !== canonical(this.simulation!.config)
      || canonical(input.quantityQuantum) !== canonical(this.policy().quantityQuantum)
      || canonical(input.buyLimitPrice) !== canonical(this.policy().buyLimitPrice)
      || canonical(input.sellLimitPrice) !== canonical(this.policy().sellLimitPrice)) throw new Error('synthetic binding unavailable');
    checkObservation(input.config, input.ruleReceipt.decisionAt!, input.observation, now);
  }
  async prepareSizing(lease: ConfiguredBindingLease): Promise<{ order: unknown; sizingBinding: string } | { noOrder: unknown }> {
    if (!enabled() || this.prepared || this.pending || this.admitting || this.bound) throw new Error('synthetic binding unavailable');
    const reject = (reason: 'invalid_input' | 'input_too_large' | 'receipt_mismatch' | 'binding_mismatch') => ({ noOrder: sizingBindingRejectionSchema.parse({
      schema: 'gelt.synthetic-sizing-binding-rejection.v1', version: 1, classification: 'constructed_offline_test', outcome: 'no_order', reason }) });
    lease.assertActive(); const portfolio = await this.client.portfolio(); lease.assertActive();
    const policy = this.policy(); let bytes: Buffer;
    try {
      const context = this.simulation!.sizingBinding!.producer(JSON.parse(canonical({ config: this.simulation!.config, portfolio })));
      if (!context || !Buffer.isBuffer(context.inputBytes)) return reject('invalid_input');
      if (context.inputBytes.length > 262144) return reject('input_too_large');
      const now = this.now(); if (!Number.isSafeInteger(now) || now < 0) throw new Error();
      bytes = Buffer.from(canonical({ schema: 'gelt.shadow-sizing-input.v1', sizingPolicyId: policy.sizingPolicyId,
        ruleInput: parseResearchJSON(context.inputBytes), ruleReceipt: context.receipt, config: this.simulation!.config,
        portfolio, lifecycleDisposition: 'settled', observation: context.observation,
        quantityQuantum: policy.quantityQuantum, buyLimitPrice: policy.buyLimitPrice, sellLimitPrice: policy.sellLimitPrice,
        evaluationAt: new Date(now).toISOString() }));
    } catch { return reject('invalid_input'); }
    lease.assertActive(); const proposal = proposeShadowSizing(bytes);
    if (proposal.inputValidation !== 'valid') return reject(['input_too_large', 'receipt_mismatch', 'binding_mismatch'].includes(proposal.reason)
      ? proposal.reason as 'input_too_large' | 'receipt_mismatch' | 'binding_mismatch' : 'invalid_input');
    if (proposal.outcome !== 'proposal') { this.writeBindingEvidence!(bytes, proposal); return { noOrder: proposal }; }
    const identity = canonical({ proposalId: proposal.proposalId, inputSha256: proposal.inputSha256,
      policySha256: simulationDigest(policy), configSha256: proposal.configSha256, snapshotSha256: proposal.portfolioSnapshotSha256 });
    this.bound = { kind: 'g05', bytes: Buffer.from(bytes), proposal: JSON.parse(canonical(proposal)), identity, lease };
    this.checkBound(this.bound, this.now()); lease.assertActive();
    return { order: { instrumentId: this.simulation!.config.instrumentId, currency: 'USD', route: 'RHS', side: proposal.side,
      requestedQuantity: proposal.quantity, requestedLimitPrice: proposal.hypothetical!.orderLimit }, sizingBinding: identity };
  }
  async beforeBoundClaim(identity: string): Promise<void> {
    const context = this.pending?.bound;
    if (!context || context.identity !== identity) throw new Error('synthetic binding unavailable');
    context.lease.assertActive(); await this.currentBoundPortfolio(context); context.lease.assertActive();
  }
  private async currentBoundPortfolio(context: BoundContext,
    dispatchAdmission?: { preview: SyntheticMockPreview; bound?: BoundContext }): Promise<void> {
    const portfolio = await this.client.portfolio(); this.checkBound(context, this.now());
    const expected = context.kind === 'pamr' ? context.proposal.decision.binding.portfolioSnapshotSha256 : context.proposal.portfolioSnapshotSha256;
    if (simulationDigest(portfolio.snapshot) !== expected) throw new Error('synthetic binding unavailable');
    if (context.kind === 'pamr') {
      // Dispatch consumes this.pending before its first await. Only that exact
      // captured admission may carry the own-reservation exception forward;
      // the one-use submit permit and store still validate its actual terms.
      const dispatchOwnsReservation = dispatchAdmission?.bound === context
        && dispatchAdmission.preview.version === 2
        && canonical(dispatchAdmission.preview.pamrConsumption) === canonical(context.link);
      if (this.bound !== context || portfolio.state !== 'settled'
        && !this.admitting && this.pending?.bound !== context && !dispatchOwnsReservation) {
        throw new Error('synthetic binding unavailable');
      }
    }
  }
  invalidateBound(): void { this.bound = undefined; this.prepared = undefined; this.pending = undefined; }

  async preview(input: Parameters<OrderAdapter['preview']>[0]): Promise<unknown> {
    if (!enabled()) throw new Error('synthetic mock unavailable');
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 60000) throw new Error('synthetic mock unavailable');
    if (!this.admitting && this.prepared && Date.parse(this.prepared.expiresAt) <= now) this.prepared = undefined;
    if (!this.admitting && this.pending && Date.parse(this.pending.preview.expiresAt) <= now) this.pending = undefined;
    if (this.admitting || this.prepared || this.pending || input.account.accountId !== '00000000-0000-4000-8000-000000000002'
      || input.order.route !== 'RHS' || (!this.simulation && input.order.side !== 'buy') || input.order.currency !== 'USD'
      || input.order.instrumentId !== syntheticMockInstrument) throw new Error('synthetic mock unavailable');
    const preview = this.simulation ? await this.runPreview(input, now) : syntheticMockPreviewSchema.parse({
      version: 1, source: syntheticMockSource, previewId: randomUUID(), principal: 'gelt-test-principal-v1', account: 'gelt-test-account-v1',
      policyId: 'synthetic-limit-fee-cap-10.v1',
      quote: { instrumentId: syntheticMockInstrument, price: syntheticMockQuote, source: 'gelt-synthetic-robinhood-quote-v1' },
      fee: { amount: syntheticMockFee, currency: 'USD', source: 'gelt-synthetic-robinhood-fee-v1' },
      order: { instrumentId: syntheticMockInstrument, route: 'RHS', side: 'buy', type: 'limit', timeInForce: 'day',
        quantity: input.order.requestedQuantity, limitPrice: input.order.requestedLimitPrice, currency: 'USD' },
      expiresAt: new Date(now + 60000).toISOString(),
    });
    this.prepared = preview;
    return { previewId: preview.previewId, order: input.order, fee: preview.fee.amount, feeCurrency: 'USD', expiresAt: preview.expiresAt };
  }

  private async runPAMRPreview(input: Parameters<OrderAdapter['preview']>[0], now: number, context: PAMRBoundContext): Promise<SyntheticMockPreview> {
    context.lease.assertActive(); this.checkBound(context, now);
    const value = pamrConsumerInputSchema.parse(parseResearchJSON(context.bytes)), action = context.proposal.action;
    const requested = canonical(input.order);
    if (action.outcome !== 'proposal' || !action.hypothetical || requested !== canonical({
      instrumentId: value.config.instrumentId, currency: 'USD', route: 'RHS', side: action.side,
      requestedQuantity: action.quantity, requestedLimitPrice: action.hypothetical.orderLimit,
    })) throw new Error('synthetic binding unavailable');
    await this.currentBoundPortfolio(context); context.lease.assertActive();
    return syntheticMockPAMRRunPreviewSchema.parse({
      version: 2, source: simulationSource, previewId: randomUUID(), principal: 'gelt-test-principal-v1', account: 'gelt-test-account-v1',
      policyId: simulationPolicy, runId: value.config.runId, configSha256: simulationDigest(value.config),
      sourceCommit: value.config.sourceCommit, classification: 'constructed_offline_test',
      decisionId: context.proposal.decision.decisionId, decisionAt: value.decisionAt,
      inputSha256: context.proposal.decision.inputSha256, portfolioSnapshotSha256: value.binding.portfolioSnapshotSha256,
      pamrConsumption: context.link,
      quote: { ...value.observation, instrumentId: value.config.instrumentId,
        price: action.hypothetical.modeledFillPrice, source: 'declared-simulated-observation-v2' },
      fee: { amount: value.config.costs.commissionPerOrder, currency: 'USD', source: 'declared-simulated-cost-v2' },
      order: { instrumentId: value.config.instrumentId, route: 'RHS', side: action.side, type: 'limit', timeInForce: 'day',
        quantity: action.quantity, limitPrice: action.hypothetical.orderLimit, currency: 'USD' },
      expiresAt: new Date(Math.min(now + 60000, Date.parse(value.config.validThrough))).toISOString(),
    });
  }

  private async runPreview(input: Parameters<OrderAdapter['preview']>[0], now: number): Promise<SyntheticMockPreview> {
    const simulation = this.simulation!;
    const config = simulationRunSchema.parse(simulation.config);
    const bound = this.bound;
    if ((simulation.sizingBinding || simulation.pamrBinding) && !bound) throw new Error('synthetic binding unavailable');
    if (bound?.kind === 'pamr') return this.runPAMRPreview(input, now, bound);
    const bindingInput = bound ? shadowSizingInputSchema.parse(parseResearchJSON(bound.bytes)) : undefined;
    const context = bindingInput ? { inputBytes: Buffer.from(canonical(bindingInput.ruleInput)), receipt: bindingInput.ruleReceipt, observation: bindingInput.observation } : simulation.decision!();
    const observation = simulationObservationSchema.parse(context.observation);
    if (!matchesShadowRuleReceipt(context.inputBytes, context.receipt)) throw new Error('synthetic decision unavailable');
    const receipt = shadowRuleReceiptSchema.parse(context.receipt), decisionInput = shadowRuleInputSchema.parse(parseResearchJSON(context.inputBytes));
    const portfolio = await this.client.portfolio();
    if (bound) {
      bound.lease.assertActive(); this.checkBound(bound, this.now());
      if (canonical(input.order.requestedQuantity) !== canonical(bound.proposal.quantity)
        || input.order.side !== bound.proposal.side || canonical(input.order.requestedLimitPrice) !== canonical(bound.proposal.hypothetical!.orderLimit)) throw new Error('synthetic binding unavailable');
    }
    if (portfolio.state !== 'settled' || receipt.inputValidation !== 'valid' || receipt.decision === 'abstain'
      || receipt.runId !== config.runId || receipt.sourceCommit !== config.sourceCommit || !receipt.decisionAt
      || receipt.classification !== (config.classification === 'constructed_offline_test' ? 'constructed_offline_test' : 'market_shadow_input')
      || decisionInput.instrument.id !== config.instrumentId || decisionInput.instrument.currency !== 'USD'
      || decisionInput.portfolio.snapshotSha256 !== simulationDigest(portfolio.snapshot)
      || simulationDigest(config) !== portfolio.snapshot.configSha256
      || units(decisionInput.costs.commissionPerTrade, 8) !== units(config.costs.commissionPerOrder, 8)
      || units(decisionInput.costs.spreadFraction, 18) !== units(config.costs.spreadFraction, 18)
      || units(decisionInput.costs.slippageFraction, 18) !== units(config.costs.slippageFraction, 18)
      || decisionInput.costs.evidenceSha256 !== config.calibrationEvidenceSha256
      || (receipt.decision === 'target_long' ? input.order.side !== 'buy' : input.order.side !== 'sell')) throw new Error('synthetic decision unavailable');
    checkObservation(config, receipt.decisionAt, observation, now);
    return syntheticMockPreviewSchema.parse({
      version: 2, source: simulationSource, previewId: randomUUID(), principal: 'gelt-test-principal-v1', account: 'gelt-test-account-v1',
      policyId: simulationPolicy, runId: config.runId, configSha256: simulationDigest(config), sourceCommit: config.sourceCommit,
      decisionId: receipt.decisionId, decisionAt: receipt.decisionAt, inputSha256: receipt.inputSha256,
      portfolioSnapshotSha256: simulationDigest(portfolio.snapshot), classification: config.classification,
      quote: { ...observation, instrumentId: config.instrumentId, price: executionPrice(config, input.order.side, observation.referencePrice), source: 'declared-simulated-observation-v2' },
      fee: { amount: config.costs.commissionPerOrder, currency: 'USD', source: 'declared-simulated-cost-v2' },
      order: { instrumentId: config.instrumentId, route: 'RHS', side: input.order.side, type: 'limit', timeInForce: 'day',
        quantity: input.order.requestedQuantity, limitPrice: input.order.requestedLimitPrice, currency: 'USD' },
      expiresAt: new Date(Math.min(now + 60000, Date.parse(config.validThrough))).toISOString(),
    });
  }

  // Called only by the test-owned harness before the exact preview is returned to its caller.
  async admitPreview(preview: OrderPreview): Promise<void> {
    preview = JSON.parse(canonical(preview));
    if (this.simulation?.pamrBinding) {
      if (this.bound?.kind !== 'pamr' || !this.prepared) throw new Error('synthetic binding unavailable');
      this.bound.lease.assertActive(); this.checkBound(this.bound, this.now());
      await this.currentBoundPortfolio(this.bound); this.bound.lease.assertActive();
      const prepared = syntheticMockPAMRRunPreviewSchema.parse(this.prepared);
      if (canonical(prepared.pamrConsumption) !== canonical(this.bound.link)) throw new Error('synthetic binding unavailable');
    }
    if (this.simulation?.sizingBinding) {
      if (this.bound?.kind !== 'g05' || !this.prepared) throw new Error('synthetic binding unavailable');
      this.bound.lease.assertActive(); this.checkBound(this.bound, this.now());
      this.prepared = syntheticMockPreviewSchema.parse({ ...this.prepared, sizingEvidence: this.writeBindingEvidence!(this.bound.bytes, this.bound.proposal) });
    }
    const prepared = this.prepared;
    const terms = preview.terms;
    const termsHash = preview.termsHash;
    const confirmationToken = preview.confirmationToken;
    if (!enabled() || !prepared || this.admitting || this.pending || terms.previewId !== prepared.previewId
      || termsHash !== tokenDigest(canonical({ ownerId: terms.ownerId, accountId: terms.accountId,
        routing: terms.routing, order: terms.order, previewId: terms.previewId,
        fee: terms.fee, feeCurrency: terms.feeCurrency, expiresAt: terms.expiresAt }))
      || terms.order.instrumentId !== syntheticMockInstrument) throw new Error('synthetic mock unavailable');
    this.admitting = true;
    try {
      const admission = await this.client.admit({ preview: prepared, termsHash, confirmationToken });
      if (this.prepared !== prepared || this.pending) throw new Error('synthetic mock unavailable');
      if (this.bound) { await this.currentBoundPortfolio(this.bound); this.bound.lease.assertActive(); }
      this.pending = { preview: prepared, confirmationToken, termsHash, handle: admission.handle, ...(this.bound ? { bound: this.bound } : {}) };
      this.prepared = undefined;
    } finally {
      this.admitting = false;
      // An admission without a returned handle can never dispatch. The durable
      // unused admission is retired by storage only after expiry.
      if (this.prepared === prepared) this.prepared = undefined;
    }
  }

  discardUnadmittedPreview(): void {
    if (this.admitting) return;
    if (this.simulation?.sizingBinding || this.simulation?.pamrBinding) { this.invalidateBound(); return; }
    this.prepared = undefined;
  }

  discardRejectedConfirmation(input: unknown): void {
    const pending = this.pending;
    const confirmation = confirmationInputSchema.safeParse(input);
    if (!enabled() || !pending || !confirmation.success) return;
    // OrderLifecycle consumes a token before checking its bound terms hash.
    // Retire the matching mock admission only for that exact, schema-valid,
    // conclusive pre-dispatch mismatch; dispatch clears pending synchronously
    // before any network await.
    if (confirmation.data.confirmationToken === pending.confirmationToken
      && confirmation.data.termsHash !== pending.termsHash) this.pending = undefined;
  }

  async dispatch(input: Parameters<OrderAdapter['dispatch']>[0]): Promise<unknown> {
    this.previewDiagnostics?.record('mock-dispatch', 'started');
    try {
      const pending = this.pending;
      this.pending = undefined; // the fixture never retries an uncertain submission
      if (!enabled() || !pending || input.feeCurrency !== 'USD' || canonical(input.fee) !== canonical(pending.preview.fee.amount)
        || input.intent.order.instrumentId !== syntheticMockInstrument || input.intent.order.side !== pending.preview.order.side
        || input.intent.order.route !== 'RHS' || input.intent.order.currency !== 'USD'
        || input.intent.order.requestedQuantity.value !== pending.preview.order.quantity.value
        || input.intent.order.requestedQuantity.precision !== pending.preview.order.quantity.precision
        || input.intent.order.requestedQuantity.scale !== pending.preview.order.quantity.scale
        || input.intent.order.requestedLimitPrice.value !== pending.preview.order.limitPrice.value
        || input.intent.order.requestedLimitPrice.precision !== pending.preview.order.limitPrice.precision
        || input.intent.order.requestedLimitPrice.scale !== pending.preview.order.limitPrice.scale) throw new Error('synthetic mock unavailable');
      if (pending.bound) {
        // Snapshot actual call data before awaits; only the opaque permit keeps identity.
        input = { dispatchId: ledgerId.parse(input.dispatchId), intent: intentSchema.parse(input.intent),
          fee: decimalSchema.parse(input.fee), feeCurrency: input.feeCurrency, configuredSubmitPermit: input.configuredSubmitPermit };
        const actualArguments = { dispatchId: input.dispatchId, intent: input.intent, fee: input.fee, feeCurrency: input.feeCurrency,
          previewTerms: { version: 1, ownerId: input.intent.ownerId, accountId: input.intent.accountId, routing: input.intent.routing,
            order: input.intent.order, previewId: pending.preview.previewId, fee: pending.preview.fee.amount,
            feeCurrency: 'USD', expiresAt: pending.preview.expiresAt }, termsHash: pending.termsHash };
        assertConfiguredSubmitPermit(input.configuredSubmitPermit, pending.bound.identity, actualArguments);
        await this.currentBoundPortfolio(pending.bound, pending);
        assertConfiguredSubmitPermit(input.configuredSubmitPermit, pending.bound.identity, actualArguments);
        this.checkBound(pending.bound, this.now());
        const payload = { dispatchId: input.dispatchId, preview: pending.preview, termsHash: pending.termsHash,
          confirmationToken: pending.confirmationToken, admissionHandle: pending.handle };
        if (Buffer.byteLength(JSON.stringify(payload)) > 8192) throw new Error('synthetic binding unavailable');
        consumeConfiguredSubmitPermit(input.configuredSubmitPermit, pending.bound.identity, actualArguments);
      } else if (this.simulation?.sizingBinding || this.simulation?.pamrBinding || input.configuredSubmitPermit) throw new Error('synthetic binding unavailable');
      this.bound = undefined;
      const order = await this.client.submit({ dispatchId: input.dispatchId, preview: pending.preview, termsHash: pending.termsHash,
        confirmationToken: pending.confirmationToken, admissionHandle: pending.handle });
      this.previewDiagnostics?.record('mock-dispatch', 'succeeded');
      return { outcome: 'accepted', brokerOrderId: order.mockOrderId };
    } catch (error) { this.previewDiagnostics?.record('mock-dispatch', 'rejected', undefined, error); throw error; }
  }

  async reconcile(input: Parameters<OrderAdapter['reconcile']>[0]): Promise<unknown> {
    if (!enabled() || !input.brokerOrderId) return { status: 'unknown', executions: [] };
    const order = await this.client.read(input.dispatchId);
    if (order.mockOrderId !== input.brokerOrderId) return { status: 'unknown', executions: [] };
    const status = order.status === 'accepted' ? 'open' : order.status;
    return { status, brokerOrderId: order.mockOrderId, executions: order.executions.map(execution => ({
      executionId: execution.executionId, brokerOrderId: order.mockOrderId, observedQuantity: execution.quantity,
      observedPrice: execution.price, ...(execution.fee ? { observedFee: execution.fee } : {}), currency: execution.currency,
    })) };
  }

  async cancel(input: Parameters<OrderAdapter['cancel']>[0]): Promise<unknown> {
    if (!enabled()) throw new Error('synthetic mock disabled');
    const order = await this.client.cancel(input.intent.intentId);
    if (order.mockOrderId !== input.brokerOrderId) throw new Error('synthetic mock unavailable');
    return { acknowledged: order.cancelAcknowledged };
  }

  readMockOrder(dispatchId: string) { return this.client.read(dispatchId); }
}
