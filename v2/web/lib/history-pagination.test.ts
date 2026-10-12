import { describe, expect, it } from 'vitest';
import type { HistoryDetailResponse, HistoryListResponse } from '../../worker/src/history-contract';
import { mergeHistoryPage, mergeTimelinePage } from './history-pagination';

const handleA = 'a'.repeat(43), handleB = 'b'.repeat(43);
const row = (intentId: string) => ({ intentId, requestedQuantity: '0.010000000000000001', requestedLimitPrice: '1.00' } as HistoryListResponse['items'][number]);
const list = (accountHandle: string, ids: string[], after = 0, hasMore = true) => ({ accountHandle, items: ids.map(row), after, limit: 2, hasMore } as HistoryListResponse);
const detail = (accountHandle: string, intentId: string, sequences: number[], after = 0, eventCount = 4) => ({ accountHandle, intent: { intentId }, timeline: sequences.map(sequence => ({ sequence, event: { type: 'execution-observed', execution: { observedQuantity: { value: '0.010000000000000001' }, observedPrice: { value: '1.00' }, currency: 'USD' } } })), after, limit: 2, eventCount, hasMore: eventCount > (sequences.at(-1) ?? after) } as HistoryDetailResponse);
const read = (operation: 'history' | 'intent', after = 0, accountHandle: string | null = handleA, intentId: string | null = null) => ({ operation, after, limit: 2, accountHandle, intentId, append: after > 0 });

describe('history pagination request boundaries', () => {
  const first = list(handleA, ['A', 'B']);
  it('appends only the expected offset under the captured opaque selected-account handle', () => {
    expect(mergeHistoryPage(first, list(handleA, ['C'], 2, false), read('history', 2))?.items.map(item => item.intentId)).toEqual(['A', 'B', 'C']);
    expect(mergeHistoryPage(first, list(handleB, ['C'], 2, false), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(first, list(handleB, [], 2, false), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(null, list(handleA, ['C'], 2, false), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(first, list(handleB, ['C'], 0, false), read('history', 0, null))?.items.map(item => item.intentId)).toEqual(['C']);
  });
  it('rejects duplicate IDs, overlapping offset pages and stale or skipped cursors rather than silently deduplicating', () => {
    expect(mergeHistoryPage(first, list(handleA, ['B', 'C'], 2), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C', 'C'], 2), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(null, list(handleA, ['A', 'A']), read('history'))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C', 'D'], 0), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C', 'D'], 4), read('history', 4))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C', 'D'], 2), read('history', 2, handleB))).toBeNull();
  });
  it('rejects malformed pagination and preserves exact decimal strings without arithmetic', () => {
    expect(mergeHistoryPage(first, list(handleA, [], 2, true), read('history', 2))).toBeNull();
    expect(mergeHistoryPage(first, { ...list(handleA, ['C'], 2, false), limit: 1 }, read('history', 2))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C'], 2, false), read('history', Number.NaN))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C'], 2, false), read('intent', 2))).toBeNull();
    expect(mergeHistoryPage(first, list(handleA, ['C'], 2, false), read('history', 2))?.items[2].requestedQuantity).toBe('0.010000000000000001');
  });
});

describe('timeline pagination request boundaries', () => {
  const first = detail(handleA, 'A', [1, 2]);
  it('requires current account, intent and exact cursor; preserves missing fee', () => {
    const merged = mergeTimelinePage(first, detail(handleA, 'A', [3, 4], 2), read('intent', 2, handleA, 'A'));
    expect(merged?.timeline.map(item => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(merged?.timeline[2].event).toMatchObject({ execution: { observedQuantity: { value: '0.010000000000000001' } } });
    expect(JSON.stringify(merged)).not.toContain('observedFee');
    expect(mergeTimelinePage(first, detail(handleB, 'A', [3, 4], 2), read('intent', 2, handleA, 'A'))).toBeNull();
    expect(mergeTimelinePage(first, detail(handleA, 'B', [3, 4], 2), read('intent', 2, handleA, 'A'))).toBeNull();
    expect(mergeTimelinePage(first, detail(handleA, 'A', [3, 4], 2), read('intent', 2, handleA, 'B'))).toBeNull();
  });
  it.each([[2, 3], [3, 3], [4, 3], [3, 5], [4, 5]])('rejects duplicate, overlapping, reversed or gapped sequence page %j', (...sequences: number[]) => {
    expect(mergeTimelinePage(first, detail(handleA, 'A', sequences, 2, 5), read('intent', 2, handleA, 'A'))).toBeNull();
  });
  it('rejects invalid initial sequence, mismatched response cursor, truncated more-page and count regression', () => {
    expect(mergeTimelinePage(null, detail(handleA, 'A', [2, 3]), read('intent', 0, handleA, 'A'))).toBeNull();
    expect(mergeTimelinePage(first, detail(handleA, 'A', [3, 4], 1), read('intent', 2, handleA, 'A'))).toBeNull();
    expect(mergeTimelinePage(first, detail(handleA, 'A', [3], 2, 4), read('intent', 2, handleA, 'A'))).toBeNull();
    expect(mergeTimelinePage(first, detail(handleA, 'A', [3], 2, 3), read('intent', 2, handleA, 'A'))).toBeNull();
    expect(mergeTimelinePage(first, detail(handleA, 'A', [3, 4], 2), read('history', 2))).toBeNull();
  });
});
