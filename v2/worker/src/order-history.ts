import type { Account } from './connection-contract.js';
import type { Ledger } from './ledger.js';
import type { Intent, LedgerEvent, Projection } from './ledger-contract.js';
import { historyDetailInputSchema, historyListResponseSchema, historyPageInputSchema, historyDetailResponseSchema } from './history-contract.js';

const routing = (account: Account): Intent['routing'] => ({
  provider: 'robinhood-official-mcp', ACCOUNT: account.account_number,
  RHS: account.rhs_account_number, RHC: account.rhc_account_number,
});
const mask = (value: string) => `••••${value.slice(-4)}`;
function summary(projection: Projection) {
  const { intent, eventCount, facts } = projection;
  return {
    intentId: intent.intentId, recordedAt: intent.recordedAt, source: intent.routing.provider,
    account: { ACCOUNT: mask(intent.routing.ACCOUNT), RHS: mask(intent.routing.RHS), ...(intent.routing.RHC ? { RHC: mask(intent.routing.RHC) } : {}) },
    route: intent.order.route, instrumentId: intent.order.instrumentId, side: intent.order.side,
    currency: intent.order.currency, requestedQuantity: intent.order.requestedQuantity.value,
    requestedLimitPrice: intent.order.requestedLimitPrice.value, eventCount,
    executionCount: facts.filter(event => event.type === 'execution-observed').length,
  };
}
function safeFact(event: LedgerEvent) {
  switch (event.type) {
    case 'dispatch-attempted': return { type: event.type, occurredAt: event.occurredAt };
    case 'order-requested': return { type: event.type, occurredAt: event.occurredAt };
    case 'broker-acknowledged': return { type: event.type, occurredAt: event.occurredAt };
    case 'reconciliation-observed': return { type: event.type, occurredAt: event.occurredAt, observation: event.observation };
    case 'execution-observed': return { type: event.type, occurredAt: event.occurredAt, execution: { observedQuantity: event.execution.observedQuantity, observedPrice: event.execution.observedPrice, ...(event.execution.observedFee ? { observedFee: event.execution.observedFee } : {}), currency: event.execution.currency } };
    case 'preview-confirmed': return { type: event.type, occurredAt: event.occurredAt };
    case 'dispatch-claimed': return { type: event.type, occurredAt: event.occurredAt };
    case 'dispatch-outcome-unknown': return { type: event.type, occurredAt: event.occurredAt };
    case 'reconciliation-unavailable': return { type: event.type, occurredAt: event.occurredAt };
    case 'broker-status-observed': return { type: event.type, occurredAt: event.occurredAt, status: event.status };
    case 'cancel-requested': return { type: event.type, occurredAt: event.occurredAt };
    case 'cancel-acknowledged': return { type: event.type, occurredAt: event.occurredAt };
  }
}
function requireValue<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error('history unavailable');
  return result.value;
}

export function readHistory(ledger: Ledger, ownerId: string, account: Account, accountHandle: string, input: unknown) {
  const page = historyPageInputSchema.parse(input);
  const projections = requireValue(ledger.history({ ownerId, routing: routing(account) }, { after: page.after, limit: page.limit + 1 }));
  return historyListResponseSchema.parse({
    version: 'v1', accountHandle, account: { ACCOUNT: mask(account.account_number), RHS: mask(account.rhs_account_number), RHC: mask(account.rhc_account_number) },
    items: projections.slice(0, page.limit).map(summary), after: page.after,
    limit: page.limit, hasMore: projections.length > page.limit,
  });
}

export function readIntentHistory(ledger: Ledger, ownerId: string, account: Account, accountHandle: string, input: unknown) {
  const query = historyDetailInputSchema.parse(input);
  const selectedRouting = routing(account);
  const projection = requireValue(ledger.getIntent({ ownerId, intentId: query.intentId, routing: selectedRouting }));
  const timeline = requireValue(ledger.timeline({ ownerId, accountId: projection.intent.accountId, intentId: query.intentId }, { after: query.after, limit: query.limit + 1 }));
  return historyDetailResponseSchema.parse({
    version: 'v1', accountHandle, intent: summary(projection), eventCount: projection.eventCount,
    after: query.after, limit: query.limit, hasMore: timeline.length > query.limit,
    timeline: timeline.slice(0, query.limit).map((event, index) => ({ sequence: query.after + index + 1, event: safeFact(event) })),
  });
}
