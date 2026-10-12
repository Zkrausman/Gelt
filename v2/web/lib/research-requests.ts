import { MAX_RESEARCH_RESPONSE_BYTES } from '../../worker/src/research-contract';
import { researchDetailResponse, researchListResponse, type ResearchDetailResponse, type ResearchListResponse } from './research-response';
export type ResearchRead = Readonly<{ operation: 'research-list' | 'research-detail'; evidenceId: string | null; csrf: string; generation: number; signal: AbortSignal }>;
// Like HistoryRequests, generation identity is authoritative even if abort is ignored.
export class ResearchRequests {
  private generation = 0;
  private active: { read: ResearchRead; controller: AbortController } | null = null;
  begin(operation: ResearchRead['operation'], csrf: string, evidenceId: string | null = null): ResearchRead {
    this.invalidate();
    const controller = new AbortController();
    const read = Object.freeze({ operation, csrf, evidenceId, generation: this.generation, signal: controller.signal });
    this.active = { read, controller }; return read;
  }
  current(read: ResearchRead): boolean { return this.active?.read === read && read.generation === this.generation && !read.signal.aborted; }
  finish(read: ResearchRead): boolean { if (!this.current(read)) return false; this.active = null; return true; }
  invalidate(): void { this.generation++; this.active?.controller.abort(); this.active = null; }
}
export class ResearchReadError extends Error {
  constructor(readonly sessionDenied: boolean) { super('Protected research unavailable'); }
}
export async function requestResearch(read: ResearchRead, transport: typeof fetch = fetch, now = Date.now): Promise<ResearchListResponse | ResearchDetailResponse> {
  const response = await transport(`/api/connection/${read.operation}`, {
    method: 'POST', cache: 'no-store', signal: read.signal,
    headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': read.csrf },
    body: JSON.stringify(read.operation === 'research-list' ? {} : { evidenceId: read.evidenceId }),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new ResearchReadError(false);
  const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
    if (size > MAX_RESEARCH_RESPONSE_BYTES) throw new ResearchReadError(false); parts.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!response.ok) throw new ResearchReadError(response.status === 401 && value?.version === 'v1' && value?.error === 'unauthorized');
  const parsed = (read.operation === 'research-list' ? researchListResponse : researchDetailResponse).parse(value);
  if (parsed.sessionExpiresAt <= now()) throw new ResearchReadError(true);
  if (read.operation === 'research-detail' && parsed.state === 'available' && 'record' in parsed && parsed.record.evidence.evidenceId !== read.evidenceId) throw new ResearchReadError(false);
  if (read.operation === 'research-list' && parsed.state === 'available' && 'items' in parsed && new Set(parsed.items.map(x => x.evidenceId)).size !== parsed.items.length) throw new ResearchReadError(false);
  return parsed;
}
