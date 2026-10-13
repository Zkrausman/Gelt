// Bounded test-owned evidence; no callback, route, error text, body or credential capture.
import { storageDiagnosticForTest } from './storage-diagnostics.js';
const phases = ['lifecycle-preview', 'harness-admission', 'mock-admission', 'mock-client', 'demo-forward', 'demo-validation'] as const;
const outcomes = ['started', 'succeeded', 'rejected', 'deadline', 'socket-timeout', 'transport-error', 'non-200', 'invalid-response', 'oversized-response', 'premature-close'] as const;
export type PreviewPhase = typeof phases[number];
export type PreviewOutcome = typeof outcomes[number];
type Entry = Readonly<{ phase: PreviewPhase; outcome: PreviewOutcome; httpStatus?: number; storage?: ReturnType<typeof storageDiagnosticForTest> }>;
function enabled() { return process.env.NODE_ENV === 'test' && process.env.GELT_SYNTHETIC_ORDER_HARNESS === 'offline-test-only' && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only'; }
export class SyntheticPreviewDiagnostics {
  private entries: Entry[] = [];
  private truncated = false;
  reset(): void { if (enabled()) { this.entries = []; this.truncated = false; } }
  record(phase: PreviewPhase, outcome: PreviewOutcome, httpStatus?: number, error?: unknown): void {
    // Evidence must never replace the operation's error or change its outcome.
    try {
      if (!enabled() || !phases.includes(phase) || !outcomes.includes(outcome)) return;
      if (this.entries.length >= 24) { this.truncated = true; return; }
      this.entries.push(Object.freeze({ phase, outcome,
        ...(Number.isSafeInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? { httpStatus } : {}),
        ...(error === undefined ? {} : { storage: storageDiagnosticForTest(error) }) }));
    } catch { /* diagnostic capture is non-authoritative */ }
  }
  receipt() { return Object.freeze({ events: Object.freeze(enabled() ? [...this.entries] : []), truncated: enabled() && this.truncated }); }
}
