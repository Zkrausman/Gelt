// Pure projection of caller-reported constructed data, never durable/run truth.
import { z } from 'zod';
import {
  simulationDigest, simulationHash, simulationPortfolioReadSchema,
  simulationRunSchema, simulationSource, type Decimal,
} from './synthetic-simulation-economics.js';

const inputSchema = z.object({
  schema: z.literal('gelt.constructed-result-view-input.v1'),
  config: simulationRunSchema,
  portfolio: simulationPortfolioReadSchema,
  lifecycle: z.object({
    runId: z.string().uuid(), configSha256: simulationHash,
    snapshotSha256: simulationHash, disposition: z.enum(['settled', 'unknown']),
  }).strict().nullish(),
}).strict();

export interface ConfiguredSimulationResultView {
  schema: 'gelt.constructed-result-view.v1';
  source: typeof simulationSource;
  classification: 'constructed_offline_test';
  evidence: 'caller_supplied_constructed_snapshot';
  runId: string;
  sourceCommit: string;
  instrumentId: 'SYNTH-RH-USD';
  currency: 'USD';
  configSha256: string;
  genesisSha256: string;
  historySha256: string;
  snapshotSha256: string;
  revision: number;
  reportedPortfolio: { state: 'settled' | 'unsettled'; cash: Decimal; quantity: Decimal };
  reportedLifecycle: 'settled' | 'unknown' | 'unestablished';
  completion: 'unestablished';
  durableReplay: 'not_established';
  provenance: 'not_authenticated';
  marketEvaluation: 'not_established';
}

export type ConfiguredSimulationResult =
  | { status: 'projected'; view: ConfiguredSimulationResultView }
  | { status: 'rejected'; reason: 'invalid_constructed_input' };

const reject = (): ConfiguredSimulationResult => ({ status: 'rejected', reason: 'invalid_constructed_input' });

export function projectConfiguredSimulationResult(input: unknown): ConfiguredSimulationResult {
  try {
    const { config, portfolio, lifecycle } = inputSchema.parse(input);
    const s = portfolio.snapshot;
    if (config.classification !== 'constructed_offline_test' || s.classification !== config.classification
      || s.runId !== config.runId || s.instrumentId !== config.instrumentId || s.currency !== config.currency
      || s.configSha256 !== simulationDigest(config) || s.genesisSha256 !== simulationDigest(config.genesis)) return reject();
    const snapshotSha256 = simulationDigest(s);
    if (lifecycle && (lifecycle.runId !== s.runId || lifecycle.configSha256 !== s.configSha256
      || lifecycle.snapshotSha256 !== snapshotSha256)) return reject();
    return {
      status: 'projected',
      view: {
        schema: 'gelt.constructed-result-view.v1', source: s.source,
        classification: 'constructed_offline_test', evidence: 'caller_supplied_constructed_snapshot',
        runId: s.runId, sourceCommit: config.sourceCommit, instrumentId: s.instrumentId, currency: s.currency,
        configSha256: s.configSha256, genesisSha256: s.genesisSha256,
        historySha256: s.historySha256, snapshotSha256, revision: s.revision,
        reportedPortfolio: { state: portfolio.state, cash: { ...s.cash }, quantity: { ...s.quantity } },
        reportedLifecycle: lifecycle?.disposition ?? 'unestablished',
        completion: 'unestablished', durableReplay: 'not_established',
        provenance: 'not_authenticated', marketEvaluation: 'not_established',
      },
    };
  } catch {
    return reject();
  }
}
