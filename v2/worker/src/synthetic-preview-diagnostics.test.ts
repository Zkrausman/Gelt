import { it, expect } from 'vitest';
import { SyntheticPreviewDiagnostics } from './synthetic-preview-diagnostics.js';
import { rememberStorageDiagnostic } from './storage-diagnostics.js';
function optedIn(work: () => void) {
  const names = ['GELT_SYNTHETIC_ORDER_HARNESS', 'GELT_SYNTHETIC_MOCK_ROBINHOOD'];
  const before = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = 'offline-test-only';
  try { work(); } finally { for (const [index, name] of names.entries()) {
    if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index];
  } }
}
it('captures only fixed preview phase/outcome/status and sanitized storage evidence', () => optedIn(() => {
  const trace = new SyntheticPreviewDiagnostics(), error = Object.assign(new Error('secret path/body'), { token: 'secret' });
  rememberStorageDiagnostic(error, { stage: 'OPERATION', operation: 'sqlite-set', check: 'DACL', kind: 'wal' });
  trace.record('mock-admission', 'rejected', 409, error);
  trace.record('mock-client', 'deadline');
  expect(trace.receipt()).toEqual({ events: [
    { phase: 'mock-admission', outcome: 'rejected', httpStatus: 409, storage: { stage: 'OPERATION', operation: 'sqlite-set', check: 'DACL', kind: 'wal' } },
    { phase: 'mock-client', outcome: 'deadline' },
  ], truncated: false });
  expect(JSON.stringify(trace.receipt())).not.toMatch(/secret|path|body|token/);
  trace.record('lifecycle-storage', 'rejected', undefined, error);
  expect(trace.receipt().events[2].storage).toEqual({ stage: 'OPERATION', operation: 'sqlite-set', check: 'DACL', kind: 'wal' });
  trace.record('secret' as any, 'rejected'); trace.record('mock-client', 'secret' as any);
  trace.record('demo-forward', 'non-200', NaN);
  expect(trace.receipt().events).toHaveLength(4);
  expect(trace.receipt().events[3]).not.toHaveProperty('httpStatus');
  trace.record('mock-submit-client', 'deadline');
  trace.record('mock-submit-preview-validity', 'expired');
  trace.record('harness-confirm', 'unknown');
  expect(trace.receipt().events.slice(4)).toEqual([{ phase: 'mock-submit-client', outcome: 'deadline' },
    { phase: 'mock-submit-preview-validity', outcome: 'expired' }, { phase: 'harness-confirm', outcome: 'unknown' }]);
}));
it('bounds and freezes snapshots, reports truncation, and resets only its owned trace', () => optedIn(() => {
  const trace = new SyntheticPreviewDiagnostics();
  for (let index = 0; index < 30; index++) trace.record('demo-forward', 'started');
  const receipt = trace.receipt();
  expect(receipt.events).toHaveLength(24); expect(receipt.truncated).toBe(true);
  expect(Object.isFrozen(receipt) && Object.isFrozen(receipt.events) && Object.isFrozen(receipt.events[0])).toBe(true);
  trace.reset(); expect(trace.receipt()).toEqual({ events: [], truncated: false });
  expect(receipt.events).toHaveLength(24);
}));
it('records no preview trace outside the exact isolated mock opt-ins', () => optedIn(() => {
  delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  const trace = new SyntheticPreviewDiagnostics(); trace.record('mock-client', 'deadline');
  expect(trace.receipt()).toEqual({ events: [], truncated: false });
}));
