'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { HistoryDetailResponse, HistoryListResponse } from '../../../worker/src/history-contract';
import type { TimelineFact } from '../../../worker/src/history-contract';
import { candleOverlayDecision } from '../../lib/history-chart';
import { mergeHistoryPage, mergeTimelinePage } from '../../lib/history-pagination';
import { HistoryReadError, HistoryRequests, requestHistory } from '../../lib/history-requests';

function eventDescription(event: TimelineFact) {
  switch (event.type) {
    case 'dispatch-attempted': return 'Dispatch attempt reported; this does not prove a request or fill.';
    case 'order-requested': return 'Order request reported; this does not prove acknowledgement or execution.';
    case 'broker-acknowledged': return 'Provider acknowledgement observed; this is not evidence of a fill.';
    case 'reconciliation-observed': return `Reconciliation observation: ${event.observation}; this is not execution evidence.`;
    case 'execution-observed': return 'Execution observed (individual provider fact; no total is inferred).';
    case 'preview-confirmed': return 'Preview terms were confirmed internally; this does not prove a request or fill.';
    case 'dispatch-claimed': return 'A durable intent claim was recorded before the injected adapter call; this does not prove dispatch or acceptance.';
    case 'dispatch-outcome-unknown': return 'Dispatch outcome is unknown; do not retry before explicit reconciliation.';
    case 'reconciliation-unavailable': return 'Reconciliation was unavailable; no provider status is inferred.';
    case 'broker-status-observed': return `Observed broker status: ${event.status}; this is not an inferred execution.`;
    case 'cancel-requested': return 'Cancellation request recorded; final canceled status is not established.';
    case 'cancel-acknowledged': return 'Cancellation acknowledgement observed; this is not final canceled status.';
  }
}
export default function HistoryPage() {
  const [csrf, setCsrf] = useState('');
  const [message, setMessage] = useState('Read-only ledger history. Restore this tab’s CSRF token, then load history for the worker-selected account.');
  const [history, setHistory] = useState<HistoryListResponse | null>(null);
  const [detail, setDetail] = useState<HistoryDetailResponse | null>(null);
  const historyRef = useRef<HistoryListResponse | null>(null);
  const detailRef = useRef<HistoryDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const freshRef = useRef(false);
  const busyRef = useRef(false);
  const requests = useRef(new HistoryRequests());
  useEffect(() => {
    setCsrf(sessionStorage.getItem('gelt-csrf') ?? '');
    const reads = requests.current;
    return () => reads.invalidate();
  }, []);
  function markStale() { freshRef.current = false; setFresh(false); }
  function clearHistory() {
    historyRef.current = null; detailRef.current = null;
    setHistory(null); setDetail(null); markStale();
  }
  function changeDraftCsrf(value: string) {
    requests.current.invalidate(); busyRef.current = false; setBusy(false);
    setCsrf(value); markStale();
    setMessage('Draft CSRF changed or restored. Displayed records are a previous partial snapshot; reload selected account history.');
  }
  function unavailable(error: unknown) {
    if (error instanceof HistoryReadError && error.sessionDenied) {
      clearHistory();
      setMessage('Owner session unavailable. Displayed history cleared. Restore an authenticated session in Connect, then reload history.');
    } else {
      markStale();
      setMessage('History unavailable. Displayed records, if any, are a previous partial snapshot. Reload selected account history. No order outcome is inferred.');
    }
  }
  function conflict(accountChanged: boolean) {
    if (accountChanged) {
      clearHistory();
      setMessage('Selected account changed. Displayed history cleared; reload selected account history.');
    } else {
      markStale();
      setMessage('History changed while paging. Displayed records are a previous partial snapshot; reload selected account history.');
    }
  }
  async function loadHistory(after = 0, append = false) {
    if (!csrf || (append && (busyRef.current || !freshRef.current || !historyRef.current))) return;
    const read = requests.current.begin({ operation: 'history', csrf, accountHandle: append ? historyRef.current!.accountHandle : null, intentId: null, after, limit: 50, append });
    busyRef.current = true; setBusy(true); setMessage('Loading selected account history.');
    detailRef.current = null; setDetail(null);
    if (!append) clearHistory();
    try {
      const result = await requestHistory<HistoryListResponse>(read);
      if (!requests.current.current(read)) return;
      const merged = mergeHistoryPage(historyRef.current, result, read);
      if (!merged) { conflict(read.accountHandle !== null && read.accountHandle !== result.accountHandle); return; }
      historyRef.current = merged; setHistory(merged); freshRef.current = true; setFresh(true);
      setMessage(result.items.length === 0 && after === 0 ? 'No ledger records for the currently selected account.' : 'Ledger history loaded.');
    } catch (error) { if (requests.current.current(read)) unavailable(error); }
    finally { if (requests.current.finish(read)) { busyRef.current = false; setBusy(false); } }
  }
  async function loadDetail(intentId: string, after = 0, append = false) {
    if (!csrf || !freshRef.current || !historyRef.current || (append && busyRef.current)) return;
    const read = requests.current.begin({ operation: 'intent', csrf, accountHandle: historyRef.current.accountHandle, intentId, after, limit: 50, append });
    busyRef.current = true; setBusy(true); setMessage('Loading persistent ledger detail.');
    if (!append) { detailRef.current = null; setDetail(null); }
    try {
      const result = await requestHistory<HistoryDetailResponse>(read);
      if (!requests.current.current(read)) return;
      const merged = mergeTimelinePage(detailRef.current, result, read);
      if (!merged) { conflict(read.accountHandle !== result.accountHandle); return; }
      detailRef.current = merged; setDetail(merged);
      setMessage('Persistent ledger detail loaded.');
    } catch (error) { if (requests.current.current(read)) unavailable(error); }
    finally { if (requests.current.finish(read)) { busyRef.current = false; setBusy(false); } }
  }
  const overlay = detail ? candleOverlayDecision({ source: detail.intent.source, instrumentId: detail.intent.instrumentId, currency: detail.intent.currency, occurredAt: detail.intent.recordedAt }) : { supported: false as const, reason: 'unsupported' as const };
  return <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: 'auto' }}>
    <h1>Read-only order history</h1>
    <p>Ledger facts only. Requested values are not executions; acknowledgement is not a fill, and cancellation would not prove no later fill.</p>
    <label>Restore tab CSRF <input aria-label="CSRF token" type="password" autoComplete="off" value={csrf} onChange={e => changeDraftCsrf(e.target.value)} /></label>
    <button onClick={() => changeDraftCsrf(sessionStorage.getItem('gelt-csrf') ?? '')}>Restore saved CSRF</button>
    <button disabled={!csrf} onClick={() => loadHistory()}>Load selected account history</button>
    {message && <p role="status">{message}</p>}
    {!fresh && (history || detail) && <p role="note">Previous partial snapshot. Reload selected account history before opening details or appending pages.</p>}
    <p>Offset pages are partial, non-snapshot reads; newer records may shift pages. Reload for a fresh read.</p>
    {history && <>
      <p>Source: Robinhood official MCP ledger. Safe account route: ACCOUNT {history.account.ACCOUNT}; RHS {history.account.RHS}; RHC {history.account.RHC}.</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Recorded</th><th>Source</th><th>Instrument</th><th>Side</th><th>Requested quantity</th><th>Requested limit price</th><th>Currency</th><th>Observed executions</th><th>Detail</th></tr></thead>
        <tbody>{history.items.map(row => <tr key={row.intentId}><td>{row.recordedAt}</td><td>{row.source}</td><td>{row.instrumentId}</td><td>{row.side}</td><td>{row.requestedQuantity}</td><td>{row.requestedLimitPrice}</td><td>{row.currency}</td><td>{row.executionCount} observed execution event(s)</td><td><button disabled={!fresh || !csrf} onClick={() => loadDetail(row.intentId)}>Open timeline</button></td></tr>)}</tbody></table></div>
      {history.hasMore && <button disabled={busy || !fresh || !csrf} onClick={() => loadHistory(history.items.length, true)}>Load more history</button>}
    </>}
    {detail && <section aria-label="Order details">
      <h2>Intent {detail.intent.intentId}</h2>
      <p>Source: {detail.intent.source}. Instrument: {detail.intent.instrumentId}. Safe routing: ACCOUNT {detail.intent.account.ACCOUNT}; RHS {detail.intent.account.RHS}{detail.intent.account.RHC ? `; RHC ${detail.intent.account.RHC}` : ''}.</p>
      <p>Requested: {detail.intent.side} {detail.intent.requestedQuantity} {detail.intent.instrumentId} at limit {detail.intent.requestedLimitPrice} {detail.intent.currency}. These are requested values, not observed execution values.</p>
      <h3>Persistent execution timeline — storage sequence order</h3>
      {detail.timeline.length === 0 && <p>No timeline events recorded. This does not establish that no later execution occurred.</p>}
      <ol>{detail.timeline.map(item => <li key={item.sequence}>
        <strong>Sequence {item.sequence}</strong> — {item.event.occurredAt} — {eventDescription(item.event)}
        {item.event.type === 'execution-observed' && <p>Observed quantity {item.event.execution.observedQuantity.value}; price {item.event.execution.observedPrice.value} {item.event.execution.currency}; fee {item.event.execution.observedFee ? `${item.event.execution.observedFee.value} ${item.event.execution.currency}` : 'not supplied'}.</p>}
      </li>)}</ol>
      {detail.hasMore && <button disabled={busy || !fresh || !csrf} onClick={() => loadDetail(detail.intent.intentId, (detail.timeline.at(-1)?.sequence ?? 0), true)}>Load more timeline</button>}
      <p role="note">Candle overlay unsupported: no independent candle source, matching instrument, exact quote currency, and compatible event-time evidence are available. Timeline remains authoritative. USDT and USD are never treated as equivalent.</p>
      {!overlay.supported && <p>Chart fallback: candles are not shown ({overlay.reason}); execution timeline is retained.</p>}
    </section>}
    <p><Link href="/connect">Connection and account selection</Link></p>
  </main>;
}
