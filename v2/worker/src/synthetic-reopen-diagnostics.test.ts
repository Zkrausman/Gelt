import { it, expect } from 'vitest';
import { rememberStorageDiagnostic } from './storage-diagnostics.js';
import { rememberReopenFailureForTest, reopenPhaseForTest, reopenFailureReceiptForTest } from './synthetic-reopen-diagnostics.js';
function enabled(work: () => void) {
  const before = [process.env.GELT_SYNTHETIC_ORDER_HARNESS, process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD];
  process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
  process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
  try { work(); } finally {
    for (const [index, name] of ['GELT_SYNTHETIC_ORDER_HARNESS', 'GELT_SYNTHETIC_MOCK_ROBINHOOD'].entries()) {
      if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index];
    }
  }
}
it('captures only closed-vocabulary failure evidence while preserving exact thrown error identity', () => enabled(() => {
  const error = Object.assign(new Error('secret path/token'), { secret: 'private payload' });
  rememberStorageDiagnostic(error, { stage: 'OPERATION', operation: 'read', check: 'DACL', kind: 'marker' });
  let caught: unknown;
  try { reopenPhaseForTest('facts-ledger-construction', () => { throw error; }); } catch (value) { caught = value; }
  expect(caught).toBe(error);
  expect(reopenFailureReceiptForTest(error)).toEqual({ phase: 'facts-ledger-construction', errorReplaced: false,
    replayRejected: false, corruptionRejected: false, stage: 'OPERATION', operation: 'read', check: 'DACL', kind: 'marker' });
  expect(JSON.stringify(reopenFailureReceiptForTest(error))).not.toMatch(/secret|private|payload|token/);
  expect(reopenPhaseForTest('mock-post-validation', () => 7)).toBe(7);
  expect(reopenFailureReceiptForTest('secret')).toEqual({ phase: 'unrecorded', errorReplaced: false,
    replayRejected: false, corruptionRejected: false, stage: 'PROTOCOL', operation: 'unknown', check: 'PROTOCOL' });
}));
it('distinguishes replay failure and corruption rejection superseded by final validation', () => enabled(() => {
  const replay = new Error('synthetic mock storage unavailable'), validation = new Error('ledger unavailable');
  rememberReopenFailureForTest(replay, 'mock-replay', undefined, true);
  try { reopenPhaseForTest('mock-replay', () => { throw replay; }); } catch { /* same rejection remains */ }
  rememberStorageDiagnostic(validation, { stage: 'COMPILE', operation: 'sqlite-set', check: 'STAGE' });
  rememberReopenFailureForTest(validation, 'mock-final-validation', { threw: true, error: replay });
  expect(reopenFailureReceiptForTest(validation)).toEqual({ phase: 'mock-final-validation', errorReplaced: true,
    replayRejected: true, corruptionRejected: true, stage: 'COMPILE', operation: 'sqlite-set', check: 'STAGE' });
  const successWorkFailure = new Error('ledger unavailable');
  rememberReopenFailureForTest(successWorkFailure, 'mock-final-validation', { threw: false, error: undefined });
  expect(reopenFailureReceiptForTest(successWorkFailure)).toMatchObject({ errorReplaced: false, replayRejected: false, corruptionRejected: false });
}));
it('phase capture stays absent without the exact isolated mock test opt-ins', () => enabled(() => {
  delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
  const error = new Error('secret');
  try { reopenPhaseForTest('mock-ledger-construction', () => { throw error; }); } catch (caught) { expect(caught).toBe(error); }
  expect(reopenFailureReceiptForTest(error).phase).toBe('unrecorded');
}));
