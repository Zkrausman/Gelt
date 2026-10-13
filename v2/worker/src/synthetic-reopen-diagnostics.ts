// Internal fixture evidence only: no paths, payloads, exception text or public error fields.
import { storageDiagnosticForTest } from './storage-diagnostics.js';
const phases = ['facts-ledger-construction', 'mock-ledger-construction', 'mock-initial-validation', 'mock-transaction-validation', 'mock-replay', 'mock-final-validation', 'mock-post-validation'] as const;
type Phase = typeof phases[number];
type Evidence = Readonly<{ phase: Phase | 'unrecorded'; errorReplaced: boolean; replayRejected: boolean; corruptionRejected: boolean }>;
const evidence = new WeakMap<object, Evidence>();
const empty: Evidence = Object.freeze({ phase: 'unrecorded', errorReplaced: false, replayRejected: false, corruptionRejected: false });
function enabled() {
  return process.env.NODE_ENV === 'test' && process.env.GELT_SYNTHETIC_ORDER_HARNESS === 'offline-test-only'
    && process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD === 'offline-test-only';
}
function object(value: unknown): value is object { return value !== null && (typeof value === 'object' || typeof value === 'function'); }
export function rememberReopenFailureForTest(error: unknown, phase: Phase, prior?: { threw: boolean; error: unknown }, corruptionRejected = false): void {
  if (!enabled() || !object(error) || !phases.includes(phase)) return;
  const previous = prior?.threw && object(prior.error) ? evidence.get(prior.error) : undefined;
  const current = evidence.get(error);
  evidence.set(error, Object.freeze({ phase, errorReplaced: prior?.threw === true && prior.error !== error,
    replayRejected: phase === 'mock-replay' || previous?.replayRejected === true,
    corruptionRejected: corruptionRejected || current?.corruptionRejected === true || previous?.corruptionRejected === true }));
}
export function reopenPhaseForTest<T>(phase: Phase, work: () => T): T {
  try { return work(); } catch (error) { rememberReopenFailureForTest(error, phase); throw error; }
}
export function reopenFailureReceiptForTest(error: unknown) {
  const captured = enabled() && object(error) ? evidence.get(error) : undefined;
  return Object.freeze({ ...(captured ?? empty), ...storageDiagnosticForTest(error) });
}
