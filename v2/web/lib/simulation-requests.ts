import { simulationListSchema, simulationDetailSchema, simulationViewMaxBytes } from '../../worker/src/simulation-view-contract';

export type SimulationRead = Readonly<{ operation: 'simulation-list' | 'simulation-detail'; runId: string | null; csrf: string; generation: number; signal: AbortSignal }>;
export class SimulationRequests {
  private generation = 0;
  private active: { read: SimulationRead; controller: AbortController } | null = null;
  begin(operation: SimulationRead['operation'], csrf: string, runId: string | null = null): SimulationRead {
    this.invalidate(); const controller = new AbortController();
    const read = Object.freeze({ operation, csrf, runId, generation: this.generation, signal: controller.signal });
    this.active = { read, controller }; return read;
  }
  current(read: SimulationRead) { return this.active?.read === read && read.generation === this.generation && !read.signal.aborted; }
  finish(read: SimulationRead) { if (!this.current(read)) return false; this.active = null; return true; }
  invalidate() { this.generation++; this.active?.controller.abort(); this.active = null; }
}
export class SimulationReadError extends Error {
  constructor(readonly sessionDenied: boolean) { super('Recorded simulation unavailable'); }
}
export async function requestSimulation(read: SimulationRead, transport: typeof fetch = fetch, now = Date.now) {
  const response = await transport(`/api/connection/${read.operation}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([read.signal, AbortSignal.timeout(10000)]),
    headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': read.csrf }, body: JSON.stringify(read.operation === 'simulation-list' ? {} : { runId: read.runId }) });
  const reader = response.body?.getReader(); if (!reader) throw new SimulationReadError(false);
  let size = 0; const parts: Uint8Array[] = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
    if (size > simulationViewMaxBytes) throw new SimulationReadError(false); parts.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!response.ok) throw new SimulationReadError(response.status === 401 && value?.version === 'v1' && value?.error === 'unauthorized');
  const parsed = (read.operation === 'simulation-list' ? simulationListSchema : simulationDetailSchema).parse(value);
  if (parsed.sessionExpiresAt <= now()) throw new SimulationReadError(true);
  if ('run' in parsed && parsed.run.id !== read.runId) throw new SimulationReadError(false);
  if ('items' in parsed && new Set(parsed.items.map(x => x.id)).size !== parsed.items.length) throw new SimulationReadError(false);
  return parsed;
}
