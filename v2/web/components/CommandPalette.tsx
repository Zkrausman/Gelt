"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal } from "../store/terminal";
import { simulationPanels } from '../../worker/src/simulation-view-contract';

type SearchResult = { symbol: string; name: string; exchange: string; type: string };

function MarketCommandPalette() {
  const open = useTerminal((s) => s.commandOpen);
  const setOpen = useTerminal((s) => s.setCommandOpen);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results = [] } = useQuery({
    queryKey: ["search", query],
    queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.trim().length > 0,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setSelected(0), [results.length]);

  if (!open) return null;

  const pick = (r: SearchResult, watch = false) => {
    setActiveSymbol(r.symbol);
    if (watch) addToWatchlist(r.symbol);
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] bg-[var(--panel)] border border-[var(--amber-dim)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, results.length - 1));
            if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
            if (e.key === "Enter" && results[selected]) pick(results[selected], e.shiftKey);
          }}
          placeholder="Ticker, company, ETF, crypto, index…  (Enter = load · Shift+Enter = load + watchlist)"
          className="w-full !border-0 !border-b !border-[var(--border)] px-3 py-2 text-[13px]"
        />
        <div className="max-h-80 overflow-auto">
          {results.map((r, i) => (
            <div
              key={r.symbol + i}
              onClick={() => pick(r)}
              className={`px-3 py-1.5 flex gap-3 cursor-pointer ${
                i === selected ? "bg-[#1f1a10] text-[var(--amber)]" : "hover:bg-[#161616]"
              }`}
            >
              <span className="w-24 font-bold">{r.symbol}</span>
              <span className="flex-1 truncate">{r.name}</span>
              <span className="dim">{r.exchange}</span>
              <span className="dim w-16 text-right">{r.type}</span>
            </div>
          ))}
          {query && results.length === 0 && (
            <div className="px-3 py-3 dim">No results for “{query}”</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SimulationCommandPalette() {
  const open = useTerminal(s => s.commandOpen), setOpen = useTerminal(s => s.setCommandOpen), select = useTerminal(s => s.setSimulationPanel);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const previous = document.activeElement;
    const frame = requestAnimationFrame(() => dialog.current?.querySelector('button')?.focus());
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', close); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open, setOpen]);
  if (!open) return null;
  return <div className="fixed inset-0 bg-black/70 z-50 flex justify-center items-start pt-24" onClick={() => setOpen(false)}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Simulation panel picker" className="bg-[var(--panel)] border border-[var(--border)] p-4" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key !== 'Tab') return; const buttons = dialog.current?.querySelectorAll('button'); if (!buttons?.length) return;
      const target = e.shiftKey ? buttons[buttons.length - 1] : buttons[0];
      if (document.activeElement === (e.shiftKey ? buttons[0] : buttons[buttons.length - 1])) { e.preventDefault(); target.focus(); }
    }}>
      <p>Recorded simulation panels</p>{simulationPanels.map(p => <button key={p} className="block p-3 uppercase" onClick={() => { select(p); setOpen(false); }}>{p}</button>)}
      <button onClick={() => setOpen(false)}>Close</button>
    </div>
  </div>;
}
export default function CommandPalette({ simulation = false }: { simulation?: boolean }) { return simulation ? <SimulationCommandPalette /> : <MarketCommandPalette />; }
