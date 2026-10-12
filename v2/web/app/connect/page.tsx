'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DISABLED_SUBMISSION_LABEL,
  EMPTY_ACKNOWLEDGEMENT,
  SIMULATED_TICKET_HEADING,
  SIMULATED_TRUTH_NOTICE,
  acknowledgeOnce,
  buildPreview,
  canAcknowledge,
  createOfflineFixture,
  displaySimulatedAmount,
  isStatusFresh,
  parseM3Status,
  selectedAccountLabel,
  type LocalAcknowledgement,
  type M3Status,
  type Pair,
} from '../../lib/m6-ui';

type Operation = 'bootstrap' | 'status' | 'initiate' | 'discover' | 'select' | 'disconnect';
const money = (value: string | null) => value === null ? 'Unknown' : `$${value} USD`;

function authorizationHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === 'https://robinhood.com' && url.pathname === '/oauth' && !url.username && !url.password && !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default function Connect() {
  const [bootstrap, setBootstrap] = useState('');
  const [csrf, setCsrf] = useState('');
  const [status, setStatus] = useState<M3Status | null>(null);
  const [statusReadAt, setStatusReadAt] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('Unknown: read protected status to display the M3 result.');
  const [message, setMessage] = useState('No connection result has been requested in this tab.');
  const [authorization, setAuthorization] = useState('');
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const [accountBeingSelected, setAccountBeingSelected] = useState<string | null>(null);
  const [acknowledgement, setAcknowledgement] = useState<LocalAcknowledgement>(EMPTY_ACKNOWLEDGEMENT);
  const [pair, setPair] = useState<Pair>('BTC-USD');
  const [amountUsd, setAmountUsd] = useState('5.00');
  const [fixture, setFixture] = useState(() => createOfflineFixture('BTC-USD', 0));
  const [now, setNow] = useState(0);

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (now > 0 && fixture.sampledAtMs === 0) setFixture(createOfflineFixture(pair, now));
  }, [now, fixture.sampledAtMs, pair]);

  const preview = buildPreview(amountUsd, fixture, now);
  const statusFresh = isStatusFresh(statusReadAt, now);
  const mayAcknowledge = canAcknowledge(status, preview, now, statusReadAt);

  useEffect(() => {
    if (acknowledgement.acknowledged && !mayAcknowledge) setAcknowledgement(EMPTY_ACKNOWLEDGEMENT);
  }, [acknowledgement.acknowledged, mayAcknowledge]);

  async function call(operation: Operation, account?: string) {
    const requestNow = Date.now();
    if (requestInFlight.current) return;
    if (operation === 'select' && (!account || status?.state !== 'connected' || status.expiresAt === null || status.expiresAt <= requestNow || !status.accounts.some(item => item.handle === account) || !isStatusFresh(statusReadAt, requestNow))) return;
    if (operation === 'initiate' && (!isStatusFresh(statusReadAt, requestNow) || status?.state !== 'disconnected' || status?.reason !== 'not_connected')) return;
    if (operation === 'discover' && (!isStatusFresh(statusReadAt, requestNow) || (status?.state !== 'connected' && status?.state !== 'authorizing') || (status?.state === 'connected' && (status.expiresAt === null || status.expiresAt <= requestNow)))) return;
    requestInFlight.current = true;
    setBusy(true);
    setAuthorization('');
    setAcknowledgement(EMPTY_ACKNOWLEDGEMENT);
    if (operation === 'bootstrap' || operation === 'initiate') {
      setStatus(null);
      setStatusReadAt(null);
      setStatusMessage('Unknown: read protected status after session or authorization changes.');
    }
    if (operation === 'select') setAccountBeingSelected(account ?? null);
    try {
      const body = operation === 'bootstrap' ? { bootstrap } : operation === 'select' ? { account } : {};
      const response = await fetch(`/api/connection/${operation}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': csrf },
        body: JSON.stringify(body),
      });
      let value: unknown = null;
      try { value = await response.json(); } catch { /* Keep the HTTP response so bootstrap failures retain their status. */ }
      const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

      if (operation === 'bootstrap') {
        setBootstrap('');
        if (response.ok && typeof record.csrf === 'string' && /^[A-Za-z0-9_-]{43}$/.test(record.csrf)) {
          setCsrf(record.csrf);
          try { sessionStorage.setItem('gelt-csrf', record.csrf); } catch { /* This tab can restore manually only if storage permits. */ }
          setMessage('Owner session opened. Read status; this does not enable an order.');
        } else {
          setCsrf('');
          // A denied or malformed bootstrap does not invalidate a session that
          // may already be live. Keep its saved CSRF so the owner can restore it.
          const stage = response.headers.get('x-gelt-bootstrap-stage');
          const outcome = response.headers.get('x-gelt-bootstrap-outcome');
          const safeStage = stage && /^(request|host-validated|ingress-validated|origin-validated|path-validated|method-validated|configuration-validated|body-validated|grant-read|grant-validated|grant-consumed|session-created)$/.test(stage) ? `; stage ${stage}` : '';
          const safeOutcome = outcome && /^(unavailable|grant-expired|grant-mismatch|grant-expired-after-consumption|session-created)$/.test(outcome) ? `; outcome ${outcome}` : '';
          const responseShape = value === null || (typeof value !== 'object' || Array.isArray(value)) ? '; response body invalid' : response.ok ? '; response shape invalid' : '';
          setMessage(`Owner session unavailable (HTTP ${response.status}${safeStage}${safeOutcome}${responseShape}). No connection or order outcome is assumed.`);
        }
        return;
      }

      if (operation === 'initiate') {
        const href = response.ok ? authorizationHref(record.authorizationUrl) : null;
        if (href) {
          setAuthorization(href);
          setMessage('M3 returned its fixed official authorization URL. Authorization is not trading readiness.');
        } else {
          setMessage('Authorization unavailable. No provider or order outcome is assumed.');
        }
        return;
      }

      const parsed = response.ok ? parseM3Status(value) : null;
      if (parsed) {
        const readAt = Date.now();
        setNow(readAt);
        setStatus(parsed);
        setStatusReadAt(readAt);
        setStatusMessage(`Protected M3 status read at local time ${new Date(readAt).toLocaleTimeString()}.`);
        setMessage(operation === 'disconnect'
          ? 'M3 reports local disconnect state; remote revocation is not promised.'
          : 'Displayed state is only the protected M3 response; no balance or trading readiness is implied.');
        if (operation === 'disconnect') {
          setCsrf('');
          try { sessionStorage.removeItem('gelt-csrf'); } catch { /* Session is already closed server-side. */ }
        }
      } else {
        setStatus(null);
        setStatusReadAt(null);
        setStatusMessage('Unknown / unavailable: protected status was absent, invalid, expired, or not authorized.');
        setMessage('Unavailable. No broker or order outcome is assumed.');
        if (operation === 'disconnect') setCsrf('');
      }
    } catch {
      setStatus(null);
      setStatusReadAt(null);
      setStatusMessage('Unknown / unavailable: protected connection status could not be read.');
      if (operation === 'bootstrap') {
        setBootstrap('');
        setCsrf('');
        setMessage('Owner session unavailable (no HTTP response). No connection or order outcome is assumed.');
      } else setMessage('Unavailable. No broker or order outcome is assumed.');
    } finally {
      requestInFlight.current = false;
      setBusy(false);
      setAccountBeingSelected(null);
    }
  }

  function restoreCsrf() {
    setStatus(null);
    setStatusReadAt(null);
    setAcknowledgement(EMPTY_ACKNOWLEDGEMENT);
    try {
      setCsrf(sessionStorage.getItem('gelt-csrf') ?? '');
      setMessage('Tab CSRF restored if present. Read protected status to establish current M3 state.');
    } catch {
      setCsrf('');
      setMessage('Tab storage unavailable. Connection state remains unknown.');
    }
  }

  function choosePair(next: Pair) {
    setPair(next);
    setFixture(createOfflineFixture(next, now));
    setAcknowledgement(EMPTY_ACKNOWLEDGEMENT);
  }

  function editAmount(value: string) {
    setAmountUsd(value);
    setAcknowledgement(EMPTY_ACKNOWLEDGEMENT);
  }

  function acknowledgeTerms() {
    const clickTime = Date.now();
    setNow(clickTime);
    const currentPreview = buildPreview(amountUsd, fixture, clickTime);
    const permitted = canAcknowledge(status, currentPreview, clickTime, statusReadAt);
    setAcknowledgement(current => acknowledgeOnce(current, permitted));
  }

  const connectedButExpired = status?.state === 'connected' && (status.expiresAt === null || status.expiresAt <= now);
  const stateLabel = status === null ? 'Unknown / unavailable'
    : connectedButExpired ? 'Expired / unavailable'
      : !statusFresh ? 'Stale M3 status / refresh required'
        : status.state === 'connected' ? 'Connected (M3-reported)'
        : status.state === 'authorizing' ? 'Authorizing'
          : status.state === 'disconnected' ? 'Disconnected'
            : 'Unavailable';
  const selectedLabel = selectedAccountLabel(status, statusFresh, now);

  return <main style={{ padding: 32, maxWidth: 900, margin: '0 auto', maxHeight: '100vh', overflow: 'auto' }}>
    <h1>Connection status &amp; simulated BUY ticket</h1>
    <p>M6 read-only/truthful UI. A connected M3 status is not trading readiness, a balance, or proof of a live provider response. No order, cancel, or execution route exists here.</p>

    <section aria-labelledby="connection-heading" style={{ border: '1px solid #555', padding: 16, margin: '20px 0' }}>
      <h2 id="connection-heading">Protected M3 connection</h2>
      <p><strong>Status: {stateLabel}</strong></p>
      <p role="status">{statusMessage}</p>
      <p>Selected masked account: {selectedLabel}</p>
      <p>Execution enabled: no. Account selection does not establish funds, instrument support, price, or permission to trade.</p>
      {status?.state === 'connected' && status.expiresAt !== null && <p>Reported connection expiry: {new Date(status.expiresAt).toLocaleString()}</p>}
      <label>One-use owner bootstrap grant<br />
        <input aria-label="One-use owner bootstrap" type="password" autoComplete="off" value={bootstrap} onChange={event => setBootstrap(event.target.value)} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <button type="button" disabled={busy || bootstrap.length === 0} onClick={() => void call('bootstrap')}>Open owner session</button>
        <button type="button" disabled={busy} onClick={restoreCsrf}>Restore tab CSRF</button>
        <button type="button" disabled={busy} onClick={() => void call('status')}>Read status</button>
        <button type="button" disabled={busy || !statusFresh || status?.state !== 'disconnected' || status?.reason !== 'not_connected'} onClick={() => void call('initiate')}>Initiate official authorization</button>
        <button type="button" disabled={busy || !statusFresh || connectedButExpired || (status?.state !== 'connected' && status?.state !== 'authorizing')} onClick={() => void call('discover')}>Discover accounts</button>
        <button type="button" disabled={busy} onClick={() => void call('disconnect')}>Disconnect locally</button>
      </div>
      {authorization && <p><a href={authorization} rel="noopener noreferrer">Continue to official authorization</a></p>}
      {status?.state === 'connected' && statusFresh && !connectedButExpired && status.accounts.map(account => <button
        type="button"
        key={account.handle}
        disabled={busy || connectedButExpired || status.selected === account.handle}
        aria-pressed={status.selected === account.handle}
        onClick={() => void call('select', account.handle)}
        style={{ margin: '0 8px 8px 0' }}
      >{accountBeingSelected === account.handle ? 'Selecting… ' : status.selected === account.handle ? 'Selected: ' : 'Select '} {account.label}</button>)}
      <p>{message}</p>
      <p>Disconnect clears local credentials only; it does not promise remote revocation. Unknown, expired, unavailable, and disconnected states remain closed.</p>
    </section>

    <section aria-labelledby="ticket-heading" style={{ border: '2px solid #b36b00', padding: 16, margin: '20px 0' }}>
      <h2 id="ticket-heading">{SIMULATED_TICKET_HEADING}</h2>
      <p><strong>{SIMULATED_TRUTH_NOTICE}</strong> Pair, reference value, fee and quote-age clock below are local development fixtures. No provider is queried.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'end' }}>
        <label>Pair<br />
          <select value={pair} onChange={event => choosePair(event.target.value as Pair)}>
            <option value="BTC-USD">BTC-USD</option>
            <option value="ETH-USD">ETH-USD</option>
          </select>
        </label>
        <label>Exact amount (USD)<br />
          <input aria-label="Exact simulated USD amount" inputMode="decimal" value={amountUsd} onChange={event => editAmount(event.target.value)} />
        </label>
      </div>
      <dl>
        <dt>Displayed terms (all simulated)</dt>
        <dd>Side: BUY</dd>
        <dd>Pair: {preview.pair}</dd>
        <dd>Selected masked account: {selectedLabel}</dd>
        <dd>Exact USD amount: {displaySimulatedAmount(preview.amountUsd)}</dd>
        <dd>Illustrative reference price: {money(preview.indicativePriceUsd)} per pair unit</dd>
        <dd>Estimated quantity at fixture price: {preview.estimatedQuantity ?? 'Unknown'} {preview.pair.split('-')[0]} (rounded down to 8 decimal places)</dd>
        <dd>Fixture fee: {money(preview.feeUsd)}; actual fee: unknown</dd>
        <dd>Simulated amount plus fee: {money(preview.totalUsd)}</dd>
        <dd>Fee-inclusive $10.00 design ceiling: {preview.capState === 'within-cap' ? 'within cap (fixture only)' : preview.capState === 'over-cap' ? 'over cap' : 'cannot determine'}</dd>
        <dd>Fixture age on local clock: {preview.quoteAgeSeconds} seconds; {preview.quoteStale ? 'expired / stale' : 'not expired'} (not market quote age)</dd>
      </dl>
      <ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      <p>Connection gate: {mayAcknowledge ? 'M3 currently reports an unexpired connected state and selected account; this still does not authorize trading.' : 'Blocked: a known, selected, unexpired M3 connection and valid unexpired simulated terms are required even to acknowledge locally.'}</p>
      <label>
        <input type="checkbox" checked={acknowledgement.acknowledged} disabled aria-label="Local simulated terms acknowledgement" />
        I reviewed these exact simulated terms (local UI acknowledgement only; no confirmation grant or order authority).
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={!mayAcknowledge || busy || acknowledgement.acknowledged} onClick={acknowledgeTerms}>
          {acknowledgement.acknowledged ? 'Simulated terms acknowledged locally' : 'Acknowledge exact simulated terms'}
        </button>
        <button type="button" disabled title="M6 has no order submission endpoint">{DISABLED_SUBMISSION_LABEL}</button>
      </div>
      <p>No confirmation token/grant, preview API, submit, or cancel action is created. Changing pair, amount, selected account, M3 expiry, or fixture expiry clears or blocks the local acknowledgement. Repeated clicks are idempotent and confer no authority.</p>
    </section>

    <p><a href="/history">Read-only order history</a></p>
  </main>;
}
