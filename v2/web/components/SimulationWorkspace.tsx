'use client';
import React, { useEffect, useRef, useState } from 'react';
import { simulationPanels, type SimulationPanel, type RecordedSimulation } from '../../worker/src/simulation-view-contract';
import { SimulationRequests, SimulationReadError, requestSimulation } from '../lib/simulation-requests';

const factLabels: Record<string, string> = {
  'preview-confirmed': 'Exact synthetic terms validated', 'dispatch-claimed': 'Single-use mock dispatch reserved',
  'dispatch-attempted': 'Mock submit attempted', 'order-requested': 'Synthetic order requested; not a fill',
  'broker-acknowledged': 'Mock acknowledgement; not a fill', 'broker-status-observed': 'Mock status observed',
  'dispatch-outcome-unknown': 'UNKNOWN — fenced; no automatic redispatch', 'execution-observed': 'Mock fill observed',
  'reconciliation-observed': 'Mock observation recorded', 'reconciliation-unavailable': 'Mock observation unavailable; no result inferred',
  'cancel-requested': 'Mock cancellation requested', 'cancel-acknowledged': 'Mock cancellation acknowledged; terminal status separate',
};

export default function SimulationWorkspace() {
  const [panel, setPanel] = useState<SimulationPanel>('run');
  const requests = useRef(new SimulationRequests());
  const csrfRef = useRef('');
  const expiryRef = useRef<{ at: number; csrf: string } | null>(null);
  const [signedIn, setSignedIn] = useState(false), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; label: string }>>([]), [selected, setSelected] = useState('');
  const [run, setRun] = useState<RecordedSimulation | null>(null), [expires, setExpires] = useState<number | null>(null);
  const [message, setMessage] = useState('Open a viewer session to inspect recorded simulation.');
  function clear() { requests.current.invalidate(); expiryRef.current = null; setRun(null); setItems([]); setSelected(''); setBusy(false); setExpires(null); }
  function forgetCurrentSession(expected: string) { try { if (sessionStorage.getItem('gelt-csrf') === expected) sessionStorage.removeItem('gelt-csrf'); } catch { /* still clear the in-memory view */ } csrfRef.current = ''; setSignedIn(false); }
  useEffect(() => {
    const refresh = () => { let value = ''; try { value = sessionStorage.getItem('gelt-csrf') ?? ''; } catch { /* unavailable remains closed */ }
      if (value !== csrfRef.current) { csrfRef.current = value; clear(); setSignedIn(!!value); setMessage(value ? 'Load recorded runs. Viewing does not authorize trading.' : 'Open a viewer session to inspect recorded simulation.'); }
    };
    refresh(); const timer = window.setInterval(refresh, 500); window.addEventListener('focus', refresh); window.addEventListener('storage', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); requests.current.invalidate(); };
  }, []);
  useEffect(() => {
    if (!expires) return;
    const tick = () => { if (expiryRef.current?.at === expires && expiryRef.current.csrf === csrfRef.current && Date.now() >= expires) { const csrf = csrfRef.current; clear(); forgetCurrentSession(csrf); setMessage('Viewer session expired. Recorded data cleared.'); } };
    const timer = window.setInterval(tick, 500); tick(); return () => window.clearInterval(timer);
  }, [expires]);
  async function load(operation: 'simulation-list' | 'simulation-detail', id: string | null = null) {
    const csrf = csrfRef.current; if (!csrf) return;
    const read = requests.current.begin(operation, csrf, id); setRun(null); setBusy(true);
    if (operation === 'simulation-list') { setItems([]); setSelected(''); }
    else setSelected(id ?? '');
    setMessage('Reading protected recorded fixture…');
    try {
      const value = await requestSimulation(read);
      if (!requests.current.current(read) || csrfRef.current !== read.csrf) return;
      setExpires(value.sessionExpiresAt);
      expiryRef.current = { at: value.sessionExpiresAt, csrf: read.csrf };
      if ('items' in value) { setItems(value.items); setMessage(value.state === 'available' ? 'Choose a recorded fixture. No live run or agent decision is implied.' : `Recorded fixtures ${value.state}.`); }
      else if (value.state === 'available' && 'run' in value) { setRun(value.run); setMessage('Recorded mock facts loaded. This is a scripted fixture, not an autonomous agent run.'); }
      else setMessage(`Recorded fixture ${value.state}. No result inferred.`);
    } catch (error) {
      if (!requests.current.current(read) || csrfRef.current !== read.csrf) return;
      setRun(null); setMessage('Recorded fixture unavailable. No result inferred.');
      if (error instanceof SimulationReadError && error.sessionDenied) { setItems([]); setSelected(''); setExpires(null); expiryRef.current = null; forgetCurrentSession(read.csrf); setMessage('Viewer session expired or unavailable. Recorded data cleared.'); }
    } finally { if (requests.current.finish(read)) setBusy(false); }
  }
  return <main className="gelt-recorded p-4 space-y-4" aria-label="Recorded simulation workspace">
    <h1 className="text-xl amber">Recorded simulation results</h1>
    <p>Recorded synthetic application-mock fixtures · no real brokerage, market feed, agent session or trading controls.</p>
    <div className="flex flex-wrap gap-3 items-center">
      <button className="term-btn" disabled={!signedIn || busy} onClick={() => void load('simulation-list')}>Load recorded runs</button>
      <label>Recorded run <select aria-label="Recorded run" value={selected} disabled={!signedIn || !items.length} onChange={e => { if (e.target.value) void load('simulation-detail', e.target.value); else { requests.current.invalidate(); setSelected(''); setRun(null); setBusy(false); } }}>
        <option value="">Select a fixture</option>{items.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select></label>
      <a href="/connect" className="amber">Open viewer session</a>
    </div>
    <p role="status">{message}</p>
    <nav aria-label="Simulation panels" className="gelt-panels">{simulationPanels.map(item => <button key={item} type="button" aria-pressed={panel === item} onClick={() => setPanel(item)}>{item}</button>)}</nav>
    <div className="gelt-result-panel min-h-64" aria-busy={busy}>
      <div className="gelt-result-title"><strong>{panel.toUpperCase()}</strong><span>RECORDED / SYNTHETIC</span></div>
      <div className="p-4 space-y-3 overflow-auto">
        {!run ? <p>No recorded run selected. Protected data is cleared while loading or unavailable.</p> : <>
          <p className="dim">{run.label} · recorded {run.recordedAt} · view ID {run.id}</p>
          {panel === 'run' && <><p>Scripted fixture scenario. No autonomous agent decision is attached.</p><p>Independent mock status: <strong>{run.mock.status}</strong>. Cancellation acknowledgement: {run.mock.cancelAcknowledged ? 'observed; separate from terminal status' : 'not observed'}.</p>
            <ol>{run.history.facts.map((f, i) => <li key={i}>{f.occurredAt} · {factLabels[f.syntheticType]}</li>)}</ol></>}
          {panel === 'paper' && <><p>No paper operation is linked to this recorded fixture.</p><a className="amber" href="/research">Inspect the separately retained reference evidence</a></>}
          {panel === 'data' && <><p>Fixed synthetic test instrument {run.requested.instrument}; configured fixture units {run.requested.currency}. No timestamped market or portfolio inputs.</p><p>Requested quantity {run.requested.quantity.value}; limit {run.requested.limitPrice.value} {run.requested.currency}. Requested terms are not observed fills.</p></>}
          {panel === 'decision' && <><p>Decision source: scripted fixture, not an agent.</p><p>No agent recommendation is available for this fixture.</p></>}
          {panel === 'orders' && <><p>Independent mock order {run.mock.mockOrderId} · dispatch {run.mock.dispatchId}</p><p>Status {run.mock.status}; cancel acknowledgement {String(run.mock.cancelAcknowledged)}. An acknowledgement does not establish a fill or terminal cancellation.</p></>}
          {(panel === 'orders' || panel === 'results') && <><h2>Independently observed mock executions</h2><table className="w-full table-fixed text-left [&_th]:p-1 [&_td]:p-1 [&_td]:align-top [&_td]:break-words"><thead><tr><th>Fill ID</th><th>Qty</th><th>Price<span className="block dim">{run.requested.currency}</span></th><th>Fee<span className="block dim">{run.requested.currency}</span></th></tr></thead><tbody>{run.mock.executions.map(e => <tr key={e.executionId}><td>{e.executionId}</td><td>{e.quantity.value}</td><td>{e.price.value}</td><td>{e.fee?.value ?? 'not reported'}</td></tr>)}</tbody></table>{!run.mock.executions.length && <p>No observed mock fills.</p>}<p>Cash, positions, P&amp;L and strategy results are unavailable in this fixture view; no value is invented.</p></>}
        </>}
      </div>
    </div>
  </main>;
}
