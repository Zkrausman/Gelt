'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ResearchRequests, ResearchReadError, requestResearch } from '../../lib/research-requests';
import type { ResearchListResponse, ResearchDetailResponse } from '../../lib/research-response';
import { EvidenceDetail } from './evidence-detail';
import styles from './research.module.css';

export default function ResearchPage() {
  const [csrf, setCsrf] = useState('');
  const [list, setList] = useState<ResearchListResponse | null>(null);
  const [detail, setDetail] = useState<ResearchDetailResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Restore this tab’s CSRF token, then load the protected research library.');
  const requests = useRef(new ResearchRequests());
  function clearEvidence() { setList(null); setDetail(null); setExpiresAt(null); }
  function invalidate(message: string) { requests.current.invalidate(); setBusy(false); clearEvidence(); setMessage(message); }
  function savedCsrf() { try { return sessionStorage.getItem('gelt-csrf') ?? ''; } catch { return ''; } }
  useEffect(() => {
    setCsrf(savedCsrf());
    const reads = requests.current;
    const hide = () => { reads.invalidate(); setBusy(false); setList(null); setDetail(null); setExpiresAt(null); setMessage('Page navigation cleared evidence. Load research again for a fresh protected read.'); };
    window.addEventListener('pagehide', hide);
    // A restored back-forward-cache document must never show its old evidence.
    window.addEventListener('pageshow', hide);
    return () => { reads.invalidate(); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', hide); };
  }, []);
  useEffect(() => {
    if (expiresAt === null) return;
    const expire = () => { requests.current.invalidate(); setList(null); setDetail(null); setExpiresAt(null); setBusy(false); setMessage('Owner session expired. Evidence cleared. Restore the owner session in Connect, then reload.'); };
    const timer = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    const visible = () => { if (Date.now() >= expiresAt) expire(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [expiresAt]);
  function changeCsrf(value: string) { invalidate('CSRF changed or restored. Evidence cleared; load research again.'); setCsrf(value); }
  async function load(evidenceId: string | null = null) {
    if (!csrf) return;
    const read = requests.current.begin(evidenceId === null ? 'research-list' : 'research-detail', csrf, evidenceId);
    setBusy(true); setDetail(null); if (evidenceId === null) setList(null);
    setMessage(evidenceId === null ? 'Reading protected research store.' : 'Reading selected evidence from the protected store.');
    try {
      const value = await requestResearch(read);
      if (!requests.current.current(read)) return;
      setExpiresAt(value.sessionExpiresAt);
      if (evidenceId === null) setList(value as ResearchListResponse); else setDetail(value as ResearchDetailResponse);
      setMessage(value.state === 'available' ? (evidenceId === null ? 'Research library read complete.' : 'Evidence read complete.') : `Research ${value.state}. No valid evidence is shown for this read.`);
      if (value.state === 'unavailable') { setList(null); setDetail(null); }
    } catch (error) {
      if (!requests.current.current(read)) return;
      clearEvidence();
      setMessage(error instanceof ResearchReadError && error.sessionDenied
        ? 'Owner session unavailable. Evidence cleared. Restore the owner session in Connect, then reload.'
        : 'Protected research read failed. Evidence cleared; retry after checking the local setup.');
    } finally { if (requests.current.finish(read)) setBusy(false); }
  }
  return <main className={styles.page} tabIndex={0} aria-label="Research evidence workspace">
    <nav aria-label="Gelt views"><Link href="/">Workspace</Link><Link href="/history">Order history</Link><Link href="/connect">Owner session</Link></nav>
    <header><p className={styles.eyebrow}>PRIVATE RESEARCH / READ ONLY</p><h1>Research evidence</h1><p>Inspect imported Paper2Agent reference-computation evidence. This page contains no market-performance evidence or execution authority.</p></header>
    <section aria-label="Protected research access"><p>An authenticated owner session is required. No broker account or broker connection is required for research reads.</p>
      <div className={styles.controls}><label>Tab CSRF token<input aria-label="CSRF token" type="password" autoComplete="off" value={csrf} onChange={e => changeCsrf(e.target.value)} /></label>
      <button onClick={() => changeCsrf(savedCsrf())}>Restore saved CSRF</button><button disabled={!csrf} onClick={() => void load()}>Load research library</button>
      <button disabled={!list && !detail && !busy} onClick={() => invalidate('Evidence cleared. No research request remains active.')}>Clear evidence</button></div>
      <p role="status" aria-live="polite">{message}</p>
    </section>
    {list?.state === 'available' && <section aria-labelledby="library"><h2 id="library">Imported evidence</h2>
      {list.items.length === 0 ? <p>The provisioned research store is empty. No evidence has been imported.</p> : <ul>{list.items.map(item => <li key={item.evidenceId}><span>{item.evidenceId} — {item.state}</span> <button disabled={busy || !csrf || item.state !== 'available'} onClick={() => void load(item.evidenceId)}>Inspect evidence {item.evidenceId}</button></li>)}</ul>}
      <p>Each selection is read and checked again. Missing or corrupt artifacts cannot be used as evidence.</p>
    </section>}
    {detail?.state === 'available' && <EvidenceDetail record={detail.record} />}
    {detail && detail.state !== 'available' && <section aria-label="Evidence unavailable"><h2>Evidence {detail.state}</h2><p>The selected artifact could not be displayed. Reload the library after local owner review.</p></section>}
  </main>;
}
