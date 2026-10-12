export type HistoryReadContext = {
  operation: 'history' | 'intent';
  csrf: string;
  accountHandle: string | null;
  intentId: string | null;
  after: number;
  limit: number;
  append: boolean;
};
export type HistoryRead = Readonly<HistoryReadContext & {
  generation: number;
  signal: AbortSignal;
}>;

// Cancellation saves work where supported; generation identity is the authority.
// A transport may still resolve after abort, including after a newer success.
export class HistoryRequests {
  private generation = 0;
  private active: { read: HistoryRead; controller: AbortController } | null = null;

  begin(context: HistoryReadContext): HistoryRead {
    this.invalidate();
    const controller = new AbortController();
    const read = Object.freeze({ ...context, generation: this.generation, signal: controller.signal });
    this.active = { read, controller };
    return read;
  }
  current(read: HistoryRead): boolean {
    return this.active?.read === read && read.generation === this.generation && !read.signal.aborted;
  }
  finish(read: HistoryRead): boolean {
    if (!this.current(read)) return false;
    this.active = null;
    return true;
  }
  invalidate(): void {
    this.generation++;
    this.active?.controller.abort();
    this.active = null;
  }
}

export class HistoryReadError extends Error {
  constructor(readonly sessionDenied: boolean) { super('Protected history unavailable'); }
}

export async function requestHistory<T>(read: HistoryRead, transport: typeof fetch = fetch): Promise<T> {
  const response = await transport(`/api/connection/${read.operation}`, {
    method: 'POST', cache: 'no-store', signal: read.signal,
    headers: { 'Content-Type': 'application/json', 'X-Gelt-CSRF': read.csrf },
    body: JSON.stringify({ after: read.after, limit: read.limit, ...(read.operation === 'intent' ? { intentId: read.intentId } : {}) }),
  });
  const value = await response.json();
  if (!response.ok) {
    // Only the named BFF's explicit owner-session denial means authentication
    // failed. CSRF edits, forbidden/worker errors and network errors do not.
    throw new HistoryReadError(response.status === 401 && value?.version === 'v1' && value?.error === 'unauthorized');
  }
  return value as T;
}
