'use client';

import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import { handoffResponseSchema, handoffStatusSchema, type HandoffDraft } from '../../../worker/src/pi-handoff-contract';
import type { z } from 'zod';
import type { HistoryDetailResponse, HistoryListResponse, TimelineFact } from '../../../worker/src/history-contract';
import { isStatusFresh, parseM3Status, selectedAccountLabel, type M3Status } from '../../lib/m6-ui';

type ProtectedRequest = Readonly<{ generation: number; csrf: string; signal: AbortSignal }>;

type OrderSurface = {
  version: 'v1'; mode: 'disabled'; execution: false; preview: false; confirmation: false;
  dispatch: false; cancellation: false; reconciliation: false;
  reason: 'production_adapter_unsupported';
};
const panel: CSSProperties = { background: '#0a0a0a', border: '1px solid #303030', padding: 16, minWidth: 0 };
const label: CSSProperties = { display: 'grid', gap: 6, color: '#aaa' };
const inputStyle: CSSProperties = { background: '#111', color: '#eee', border: '1px solid #444', padding: '9px 10px', font: 'inherit', minWidth: 0 };
const buttonStyle: CSSProperties = { background: '#171717', color: '#eee', border: '1px solid #555', padding: '9px 12px', font: 'inherit', cursor: 'pointer' };
const amber = { color: '#ffb547' };
const dim = { color: '#999' };

function parseExact(value: string): { coefficient: bigint; scale: number } | null {
  if (value.length > 40 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const digits = whole + fraction;
  if (digits.length < 1 || digits.length > 38 || fraction.length > 18 || !/[1-9]/.test(digits)) return null;
  return { coefficient: BigInt(digits), scale: fraction.length };
}
function formatScaled(value: bigint, scale: number): string {
  const text = value.toString().padStart(scale + 1, '0');
  if (!scale) return text;
  const split = text.length - scale;
  return `${text.slice(0, split)}.${text.slice(split)}`;
}
function draftNotional(quantity: string, price: string): string | null {
  const q = parseExact(quantity), p = parseExact(price);
  return q && p ? formatScaled(q.coefficient * p.coefficient, q.scale + p.scale) : null;
}
function parseOrderSurface(value: unknown): OrderSurface | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = ['version', 'mode', 'execution', 'preview', 'confirmation', 'dispatch', 'cancellation', 'reconciliation', 'reason'];
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(v, key))) return null;
  if (v.version !== 'v1' || v.mode !== 'disabled' || v.execution !== false || v.preview !== false || v.confirmation !== false || v.dispatch !== false || v.cancellation !== false || v.reconciliation !== false) return null;
  if (v.reason !== 'production_adapter_unsupported') return null;
  return v as OrderSurface;
}
function describeEvent(event: TimelineFact): string {
  if (event.type === 'execution-observed') return `Observed fill fact: ${event.execution.observedQuantity.value} at ${event.execution.observedPrice.value} USD; fee ${event.execution.observedFee?.value ?? 'not supplied'} USD.`;
  if (event.type === 'broker-status-observed') return `Observed status: ${event.status}.`;
  if (event.type === 'dispatch-outcome-unknown') return 'Outcome unknown — stop and require human-reviewed reconciliation.';
  if (event.type === 'cancel-requested') return 'Cancellation requested; this is not proof of cancellation.';
  if (event.type === 'cancel-acknowledged') return 'Cancellation acknowledgement; final status still requires reconciliation.';
  if (event.type === 'broker-acknowledged') return 'Broker acknowledgement observed; not a fill.';
  if (event.type === 'reconciliation-unavailable') return 'Reconciliation unavailable; no outcome inferred.';
  if (event.type === 'reconciliation-observed') return `Reconciliation observed: ${event.observation}.`;
  if (event.type === 'preview-confirmed') return 'Internal preview confirmation recorded; not a submission.';
  if (event.type === 'dispatch-claimed') return 'Durable dispatch claim recorded; not proof of dispatch.';
  if (event.type === 'dispatch-attempted') return 'Dispatch attempt reported; no acceptance or fill inferred.';
  if (event.type === 'order-requested') return 'Order request reported; no acknowledgement or fill inferred.';
  return 'Lifecycle fact recorded; it does not establish a fill.';
}

export default function Orders() {
  const [csrf, setCsrf] = useState('');
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<M3Status | null>(null);
  const [connectionAt, setConnectionAt] = useState<number | null>(null);
  const [orderSurface, setOrderSurface] = useState<OrderSurface | null>(null);
  const [surfaceMessage, setSurfaceMessage] = useState('Unknown — read protected worker state.');
  const [message, setMessage] = useState('No protected API response has been requested in this tab.');
  const [instrument, setInstrument] = useState('BTC-USD');
  const [route, setRoute] = useState<'RHS' | 'RHC'>('RHS');
  const [quantity, setQuantity] = useState('0.0001');
  const [limitPrice, setLimitPrice] = useState('50000.00');
  const [history, setHistory] = useState<HistoryListResponse | null>(null);
  const [detail, setDetail] = useState<HistoryDetailResponse | null>(null);
  const [piStatus, setPiStatus] = useState<z.infer<typeof handoffStatusSchema> | null>(null);
  const [fixtureAccount, setFixtureAccount] = useState('synthetic-pi-account-a');
  const [handoff, setHandoff] = useState<z.infer<typeof handoffResponseSchema> | null>(null);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0), requestRef = useRef(false);
  const csrfRef = useRef(''), generationRef = useRef(0);
  const activeRef = useRef<{ read: ProtectedRequest; controller: AbortController } | null>(null);
  function invalidateProtectedRequests() {
    generationRef.current++; activeRef.current?.controller.abort();
    activeRef.current = null; requestRef.current = false;
  }
  function clearProtectedState() {
    setConnection(null); setConnectionAt(null); setOrderSurface(null);
    setPiStatus(null); setHandoff(null); setHistory(null); setDetail(null);
  }
  function changeCsrf(value: string) {
    invalidateProtectedRequests(); csrfRef.current = value; setCsrf(value);
    clearProtectedState(); setBusy(false);
    setSurfaceMessage('Unknown — credential context changed. Read fresh protected status.');
    setMessage('Credential context changed. Protected results cleared; refresh before use.');
  }
  function beginProtectedRequest(): ProtectedRequest | null {
    if (!csrfRef.current || requestRef.current) return null;
    const controller = new AbortController();
    const read = Object.freeze({ generation: ++generationRef.current, csrf: csrfRef.current, signal: controller.signal });
    activeRef.current = { read, controller }; requestRef.current = true; setBusy(true);
    return read;
  }
  function current(read: ProtectedRequest): boolean {
    return activeRef.current?.read === read && read.generation === generationRef.current
      && read.csrf === csrfRef.current && !read.signal.aborted;
  }
  function finish(read: ProtectedRequest) {
    if (!current(read)) return;
    activeRef.current = null; requestRef.current = false; setBusy(false);
  }
  function invalidateDraft() {
    revisionRef.current++;
    setRevision(revisionRef.current); setHandoff(null);
    if (csrfRef.current) void protectedPost('pi-invalidate', { revision: revisionRef.current }).catch(() => {});
  }

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const restore = () => {
      try { changeCsrf(sessionStorage.getItem('gelt-csrf') ?? ''); }
      catch { changeCsrf(''); setMessage('Tab storage unavailable. Protected state remains unknown.'); }
    };
    const hide = () => {
      invalidateProtectedRequests(); clearProtectedState(); setBusy(false);
      setSurfaceMessage('Unknown — page left. Read fresh protected status.');
      setMessage('Page navigation cleared protected results. Refresh after returning.');
    };
    tick(); restore(); const timer = window.setInterval(tick, 1000);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', restore);
    window.addEventListener('focus', restore); window.addEventListener('storage', restore);
    return () => {
      invalidateProtectedRequests(); window.clearInterval(timer);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore);
      window.removeEventListener('focus', restore); window.removeEventListener('storage', restore);
    };
  }, []);

  async function protectedPost(operation: string, body: unknown = {}, read?: ProtectedRequest): Promise<unknown> {
    const token = read?.csrf ?? csrfRef.current;
    if (!token || (read && !current(read))) throw new Error('stale credential context');
    const response = await fetch(`/api/connection/${operation}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: read?.signal,
      headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': token },
      body: JSON.stringify(body),
    });
    if (read && !current(read)) throw new Error('stale response');
    const value: unknown = await response.json();
    if (read && !current(read)) throw new Error('stale response');
    if (!response.ok) throw new Error('protected operation unavailable');
    return value;
  }
  async function readProtectedState() {
    const read = beginProtectedRequest(); if (!read) return;
    clearProtectedState(); setMessage('Reading protected connection and worker status…');
    try {
      const [connectionResult, surfaceResult, piResult] = await Promise.all([
        protectedPost('status', {}, read), protectedPost('order-status', {}, read), protectedPost('pi-status', {}, read),
      ]);
      if (!current(read)) return;
      const parsedPi = handoffStatusSchema.safeParse(piResult);
      setPiStatus(parsedPi.success ? parsedPi.data : null);
      const parsedConnection = parseM3Status(connectionResult);
      const parsedSurface = parseOrderSurface(surfaceResult);
      const observedAt = Date.now(); setNow(observedAt);
      setConnection(parsedConnection); setConnectionAt(parsedConnection ? observedAt : null);
      setOrderSurface(parsedSurface);
      setSurfaceMessage(parsedSurface
        ? 'Worker confirms the production order adapter is unsupported. All order authorities remain disabled.'
        : 'Worker order status was missing or invalid; fail closed.');
      setMessage(parsedConnection
        ? 'Protected M3 status loaded. Connected means only the M3 connection state; it does not prove trading support or funds.'
        : 'Connection state unavailable or invalid.');
    } catch {
      if (!current(read)) return;
      clearProtectedState();
      setSurfaceMessage('Worker/BFF status unavailable. Preview, confirmation, dispatch, cancellation and reconciliation remain unavailable.');
      setMessage('Protected status read failed or the session expired. No account or order outcome is assumed.');
    } finally { finish(read); }
  }
  function currentDraft(): HandoffDraft {
    return { account: fixtureAccount as HandoffDraft['account'], route, instrument, side: 'BUY', type: 'LIMIT', quantity, limitPrice, revision: revisionRef.current };
  }
  async function prepareHandoff() {
    if (!piStatus?.enabled || !validDraft) return;
    const read = beginProtectedRequest(); if (!read) return;
    setHandoff(null); const draft = currentDraft();
    try {
      const result = handoffResponseSchema.parse(await protectedPost('pi-prepare', draft, read));
      if (!current(read)) return;
      if (draft.revision !== revisionRef.current || JSON.stringify(currentDraft()) !== JSON.stringify(result.draft) || result.expiresAt <= Date.now()) throw new Error('stale draft');
      setHandoff(result); setMessage('Synthetic offline Pi handoff prepared for review only. No broker preview or authority exists.');
    } catch { if (current(read)) { setHandoff(null); setMessage('Fixture handoff unavailable or draft changed. Nothing submitted.'); } }
    finally { finish(read); }
  }
  async function reviewHandoff() {
    if (!handoff || handoff.expiresAt <= Date.now() || JSON.stringify(currentDraft()) !== JSON.stringify(handoff.draft)) return;
    const read = beginProtectedRequest(); if (!read) return;
    try {
      const result = handoffResponseSchema.parse(await protectedPost('pi-review', { id: handoff.id, digest: handoff.digest, draft: currentDraft() }, read));
      if (!current(read)) return;
      if (revisionRef.current !== result.draft.revision || JSON.stringify(currentDraft()) !== JSON.stringify(result.draft) || result.expiresAt <= Date.now()) throw new Error('stale review');
      setMessage('Reviewed synthetic fixture terms only. No Pi session, broker approval or order submission.');
    } catch { if (current(read)) { setHandoff(null); setMessage('Fixture review expired or unavailable. Nothing submitted.'); } }
    finally { finish(read); }
  }
  async function loadHistory() {
    const selectedHandle = isStatusFresh(connectionAt, Date.now()) ? connection?.selected : null;
    if (!selectedHandle) {
      setHistory(null); setDetail(null);
      setMessage('Refresh protected status and select an account before reading history.');
      return;
    }
    const read = beginProtectedRequest(); if (!read) return;
    setDetail(null); setHistory(null); setMessage('Loading selected-account durable ledger history…');
    try {
      const result = await protectedPost('history', { after: 0, limit: 50 }, read) as HistoryListResponse;
      if (!current(read)) return;
      if (result.version !== 'v1' || !Array.isArray(result.items) || result.accountHandle !== selectedHandle) throw new Error('account changed');
      setHistory(result); setMessage(result.items.length ? 'Protected history loaded. Records are ledger facts, not proof of live provider interoperability.' : 'No ledger intents are recorded for the currently selected account.');
    } catch { if (current(read)) { clearProtectedState(); setMessage('History unavailable or account selection changed. Refresh protected status before reading again.'); } }
    finally { finish(read); }
  }
  async function openTimeline(intentId: string) {
    const selectedHandle = isStatusFresh(connectionAt, Date.now()) ? connection?.selected : null;
    if (!selectedHandle || history?.accountHandle !== selectedHandle || !history.items.some(item => item.intentId === intentId)) {
      setHistory(null); setDetail(null);
      setMessage('Account selection is stale or changed. Refresh status and history before opening a timeline.');
      return;
    }
    const read = beginProtectedRequest(); if (!read) return;
    setDetail(null);
    try {
      const result = await protectedPost('intent', { intentId, after: 0, limit: 50 }, read) as HistoryDetailResponse;
      if (!current(read)) return;
      if (result.version !== 'v1' || !Array.isArray(result.timeline) || result.accountHandle !== selectedHandle || result.intent.intentId !== intentId) throw new Error('account changed');
      setDetail(result); setMessage('Stored timeline page loaded in ledger sequence order.');
    } catch { if (current(read)) { clearProtectedState(); setMessage('Timeline unavailable or account selection changed. Refresh protected status and history.'); } }
    finally { finish(read); }
  }

  const statusFresh = isStatusFresh(connectionAt, now);
  const displayedHistory = statusFresh && connection?.selected && history?.accountHandle === connection.selected ? history : null;
  const displayedDetail = displayedHistory && detail?.accountHandle === displayedHistory.accountHandle
    && displayedHistory.items.some(item => item.intentId === detail.intent.intentId) ? detail : null;
  const selected = selectedAccountLabel(connection, statusFresh, now);
  const notional = draftNotional(quantity, limitPrice);
  const validDraft = Boolean(instrument.length > 0 && instrument.length <= 64 && /^[A-Za-z0-9-]+$/.test(instrument) && parseExact(quantity) && parseExact(limitPrice));
  const capText = notional === null ? 'Unknown — enter valid exact decimals.' : BigInt(notional.replace('.', '')) > 10n * 10n ** BigInt(notional.split('.')[1]?.length ?? 0) ? 'Above $10 before fees; blocked.' : 'Unknown — a fresh worker fee is unavailable.';
  const statusLabel = !connection ? 'Unknown / unavailable' : connection.state === 'connected' && (connection.expiresAt === null || connection.expiresAt <= now) ? 'Expired / unavailable' : !statusFresh ? 'Stale — refresh required' : connection.state === 'connected' ? 'Connected (M3-reported)' : connection.state;
  const previewReason = orderSurface
    ? 'No supported production preview provider/adapter is integrated.'
    : 'Read fresh protected worker status; never infer availability.';

  return <main style={{ minHeight: '100vh', padding: '20px clamp(14px, 3vw, 36px)', boxSizing: 'border-box', color: '#e5e5e5', fontFamily: 'Consolas, Menlo, monospace', background: '#050505' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start', borderBottom: '1px solid #333', paddingBottom: 14, marginBottom: 16 }}>
      <div><p style={{ ...amber, margin: '0 0 6px', letterSpacing: '.12em' }}>GELT / LOCAL TRADING DESK</p><h1 style={{ fontSize: 'clamp(22px, 3vw, 34px)', margin: 0 }}>Order &amp; execution workspace</h1><p style={{ ...dim, marginBottom: 0 }}>Offline-first • protected read-only connection • order execution disabled</p></div>
      <div style={{ textAlign: 'right', ...dim }}><div>V2 WORKER: EXECUTION FALSE</div><div>LOCAL STATUS: {connection ? 'OBSERVED' : 'UNKNOWN'}</div></div>
    </header>

    <section aria-label="Safety status" style={{ ...panel, borderColor: '#8d5b16', marginBottom: 14 }}>
      <strong style={amber}>SAFETY GATE — LIVE ORDERING IS NOT AVAILABLE</strong>
      <p style={{ marginBottom: 8 }}>{surfaceMessage}</p>
      <p style={{ ...dim, margin: '0 0 12px' }}>No MCP order adapter, preview/place/cancel interoperability, or unknown-ID correlation is proven. No fixture data is shown as a broker quote, account, order, execution, or fill. Unknown outcomes must stop further orders until human-reviewed reconciliation.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label style={{ ...label, width: 'min(360px, 100%)' }}>Restore this tab’s CSRF token<input aria-label="Restore CSRF" type="password" autoComplete="off" value={csrf} onChange={event => changeCsrf(event.target.value)} style={inputStyle} /></label>
        <button type="button" style={buttonStyle} disabled={busy || !csrf} onClick={() => void readProtectedState()}>Read protected status</button>
        <button type="button" style={buttonStyle} disabled={busy || !csrf} onClick={() => void loadHistory()}>Load durable history</button>
        <a href="/connect" style={{ ...amber, padding: 10 }}>Connection setup &amp; account selection →</a>
      </div>
      <p role="status" style={{ marginBottom: 0 }}>{message}</p>
    </section>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 14, alignItems: 'start' }}>
      <section style={panel} aria-labelledby="account-title">
        <h2 id="account-title" style={{ ...amber, marginTop: 0 }}>01 / Protected connection</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, .75fr) 1.25fr', gap: '8px 12px', marginBottom: 8 }}>
          <dt>Status</dt><dd style={{ margin: 0 }}>{statusLabel}</dd>
          <dt>M3 reason</dt><dd style={{ margin: 0 }}>{connection?.reason ?? 'Unknown'}</dd>
          <dt>Selected masked account</dt><dd style={{ margin: 0 }}>{selected}</dd>
          <dt>Token expiry</dt><dd style={{ margin: 0 }}>{connection?.expiresAt ? new Date(connection.expiresAt).toLocaleString() : 'Not available'}</dd>
          <dt>Freshness</dt><dd style={{ margin: 0 }}>{statusFresh && connection ? `Read at ${new Date(connectionAt!).toLocaleTimeString()}; status expires locally in 30s` : 'Unknown or stale; refresh required'}</dd>
          <dt>Execution flag</dt><dd style={{ margin: 0 }}>false (M3 contract)</dd>
        </dl>
        <p style={dim}>M3 connected is not trading readiness, balance, instrument support, or proof of a live quote. Select an account only through the protected Connect workflow.</p>
        <p><a href="/connect" style={amber}>Open protected connection controls</a></p>
      </section>

      <section style={panel} aria-labelledby="ticket-title">
        <h2 id="ticket-title" style={{ ...amber, marginTop: 0 }}>02 / BUY LIMIT draft</h2>
        <p style={dim}>Exact text only. Internal lifecycle shape is BUY LIMIT / USD; production pair and route support are unverified. Editing this draft does not request a quote or create an order.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
          <label style={label}>Instrument ID<input aria-label="Instrument identifier" value={instrument} maxLength={64} onChange={event => { invalidateDraft(); setInstrument(event.target.value); }} style={inputStyle} /></label>
          <label style={label}>Worker route<select aria-label="Order route" value={route} onChange={event => { invalidateDraft(); setRoute(event.target.value as 'RHS' | 'RHC'); }} style={inputStyle}><option value="RHS">RHS</option><option value="RHC">RHC</option></select></label>
          <label style={label}>Side / type<input aria-label="Order side and type" value="BUY / LIMIT" readOnly style={inputStyle} /></label>
          <label style={label}>Exact quantity<input aria-label="Exact quantity" inputMode="decimal" value={quantity} onChange={event => { invalidateDraft(); setQuantity(event.target.value); }} style={inputStyle} /></label>
          <label style={label}>Exact limit price (USD)<input aria-label="Exact USD limit price" inputMode="decimal" value={limitPrice} onChange={event => { invalidateDraft(); setLimitPrice(event.target.value); }} style={inputStyle} /></label>
        </div>
        <div style={{ borderTop: '1px solid #333', marginTop: 14, paddingTop: 12 }}>
          <div>Draft notional (exact multiplication): <strong>{notional === null ? 'Invalid / unknown' : `${notional} USD`}</strong></div>
          <div>Draft validation: {validDraft ? 'decimal syntax valid; not broker-validated' : 'invalid instrument or decimal input'}</div>
          <div>Fee-inclusive $10 ceiling: {capText}</div>
          <div>Fresh preview expiry / fees: <strong>Unavailable — no broker preview has been returned.</strong></div>
          <div>Confirmation state: <strong>Not created.</strong></div>
        </div>
        <p role="note" style={{ color: '#ffcc80' }}>Preview blocked: {previewReason} No local estimate is substituted for broker terms.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" style={buttonStyle} disabled title={previewReason}>Request fresh exact preview — unavailable</button>
          <button type="button" style={buttonStyle} disabled title="No preview/confirmation adapter is enabled">Confirm exact terms — unavailable</button>
          <button type="button" style={buttonStyle} disabled title="No cancel operation is enabled">Request cancel — unavailable</button>
        </div>
        <section aria-label="Offline Pi handoff" style={{ borderTop: '1px solid #444', marginTop: 14 }}>
          <h3>Offline Pi handoff — fixture review, not authorization</h3>
          <p>Separate synthetic fixture accounts; never M3 OAuth or a Pi MCP account. No quote, fee, balance, broker preview, confirmation or execution is asserted.</p>
          <p>Fixture state: {piStatus?.enabled ? 'explicit test-only injection enabled' : 'disabled / unavailable'}. All execution capabilities remain false.</p>
          {piStatus?.enabled && <><label style={label}>Synthetic fixture account<select aria-label="Synthetic fixture account" value={fixtureAccount} onChange={event => { invalidateDraft(); setFixtureAccount(event.target.value); }} style={inputStyle}>{piStatus.accounts.map(account => <option key={account} value={account}>{account}</option>)}</select></label>
            <p><button type="button" style={buttonStyle} disabled={busy || !validDraft || !csrf} onClick={() => void prepareHandoff()}>Prepare synthetic handoff</button></p>
            {handoff && handoff.expiresAt > now && handoff.draft.revision === revision && <div role="region" aria-label="Synthetic handoff review"><p>SYNTHETIC OFFLINE FIXTURE / NOT BROKER DATA. ID {handoff.id}; canonical digest {handoff.digest}; expires {new Date(handoff.expiresAt).toLocaleTimeString()}.</p><p>{handoff.draft.account} / {handoff.draft.route} / {handoff.draft.instrument} / BUY LIMIT {handoff.draft.quantity} at {handoff.draft.limitPrice} USD / revision {handoff.draft.revision}. Authority: false.</p><button type="button" style={buttonStyle} disabled={busy} onClick={() => void reviewHandoff()}>Review fixture terms (no submission)</button></div>}
          </>}
        </section>
        <p style={{ ...dim, marginBottom: 0 }}>Current worker status: {orderSurface ? `disabled (${orderSurface.reason})` : 'unknown'}. Halt and human-reviewed reconciliation are not exposed until a safe lifecycle adapter is integrated.</p>
      </section>

      <section style={{ ...panel, gridColumn: '1 / -1' }} aria-labelledby="history-title">
        <h2 id="history-title" style={{ ...amber, marginTop: 0 }}>03 / Durable order history &amp; timeline</h2>
        <p style={dim}>Protected worker reads are account-scoped server-side. Requested order terms, acknowledgements, statuses, and each actual observed execution remain distinct; requested amounts never become fills or fees.</p>
        {!displayedHistory && <p>No current-account history loaded. Refresh protected status, select an account in Connect, then load history.</p>}
        {displayedHistory && <>
          <p>Ledger source label: {displayedHistory.items[0]?.source ?? 'no records'}; selected masked route: ACCOUNT {displayedHistory.account.ACCOUNT}, RHS {displayedHistory.account.RHS}, RHC {displayedHistory.account.RHC}. Storage order is retained.</p>
          {displayedHistory.items.length === 0 ? <p>Empty ledger history for the currently selected account. This is not evidence of no external broker activity.</p> : <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}><thead><tr>{['Recorded', 'Source', 'Instrument', 'Side', 'Requested qty', 'Requested limit', 'Currency', 'Observed executions', 'Timeline'].map(x => <th key={x} style={{ textAlign: 'left', borderBottom: '1px solid #555', padding: 7 }}>{x}</th>)}</tr></thead><tbody>{displayedHistory.items.map(row => <tr key={row.intentId}><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.recordedAt}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.source}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.instrumentId}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.side.toUpperCase()}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.requestedQuantity}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.requestedLimitPrice}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.currency}</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}>{row.executionCount} observed event(s)</td><td style={{ padding: 7, borderBottom: '1px solid #222' }}><button style={buttonStyle} disabled={busy} onClick={() => void openTimeline(row.intentId)}>Open</button></td></tr>)}</tbody></table></div>}
          {displayedHistory.hasMore && <p>More records exist. Use the full <a href="/history" style={amber}>history view</a> for bounded paging.</p>}
        </>}
        {displayedDetail && <section aria-label="Persistent timeline" style={{ borderTop: '1px solid #444', marginTop: 14, paddingTop: 12 }}>
          <h3>Intent {displayedDetail.intent.intentId} — timeline, storage sequence</h3>
          <p>Requested {displayedDetail.intent.side.toUpperCase()} {displayedDetail.intent.requestedQuantity} {displayedDetail.intent.instrumentId} at {displayedDetail.intent.requestedLimitPrice} USD. Requested values are not execution facts.</p>
          <ol>{displayedDetail.timeline.map(item => <li key={item.sequence}><strong>#{item.sequence}</strong> {item.event.occurredAt} — {describeEvent(item.event)}</li>)}</ol>
          {displayedDetail.hasMore && <p style={amber}>This is only the first page of the timeline; later facts may change the outcome. Open the <a href="/history" style={amber}>paged history view</a> for remaining facts.</p>}
          <p style={{ color: '#ffcc80' }}>Chart fallback: no independently verified candle source, compatible instrument/currency, or event-time mapping. No chart marker is drawn; timeline remains the record. USD and USDT are not interchangeable.</p>
        </section>}
      </section>
    </div>
    <footer style={{ ...dim, borderTop: '1px solid #333', marginTop: 18, padding: '12px 0' }}>This local screen proves no real order, broker fill, fee, provider capability, or account balance. Open the <a href="/simulation" style={amber}>recorded results</a>, <a href="/research" style={amber}>research evidence</a>, <a href="/history" style={amber}>history</a> or <a href="/connect" style={amber}>connection operations</a>.</footer>
  </main>;
}
