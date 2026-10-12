import type { HistoryDetailResponse, HistoryListResponse } from '../../worker/src/history-contract';
import type { HistoryRead } from './history-requests';

type PageRead = Pick<HistoryRead, 'operation' | 'accountHandle' | 'intentId' | 'after' | 'limit' | 'append'>;
const bounded = (after: number, limit: number) => Number.isSafeInteger(after) && after >= 0 && after <= 1000 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50;
const unique = (items: HistoryListResponse['items']) => new Set(items.map(item => item.intentId)).size === items.length;
function matches(page: HistoryListResponse | HistoryDetailResponse, read: PageRead) {
  return bounded(read.after, read.limit) && page.after === read.after && page.limit === read.limit &&
    (read.accountHandle === null || page.accountHandle === read.accountHandle);
}

// Account handles are opaque worker-issued selection identities. Offset pages
// are not snapshots: overlap is a reload conflict, never silently deduplicated.
export function mergeHistoryPage(previous: HistoryListResponse | null, incoming: HistoryListResponse, read: PageRead): HistoryListResponse | null {
  if (read.operation !== 'history' || !matches(incoming, read) || !unique(incoming.items) || incoming.items.length > read.limit || (incoming.hasMore && incoming.items.length !== read.limit)) return null;
  if (!read.append) return read.after === 0 ? incoming : null;
  if (!previous || !previous.hasMore || read.accountHandle !== previous.accountHandle || previous.accountHandle !== incoming.accountHandle || read.after !== previous.items.length || !unique(previous.items)) return null;
  const items = [...previous.items, ...incoming.items];
  if (!unique(items) || items.length > 1000) return null;
  return { ...incoming, items };
}

function contiguous(timeline: HistoryDetailResponse['timeline'], after: number) {
  return timeline.every((item, index) => item.sequence === after + index + 1);
}
export function mergeTimelinePage(previous: HistoryDetailResponse | null, incoming: HistoryDetailResponse, read: PageRead): HistoryDetailResponse | null {
  const end = incoming.timeline.at(-1)?.sequence ?? read.after;
  if (read.operation !== 'intent' || !matches(incoming, read) || incoming.intent.intentId !== read.intentId || !contiguous(incoming.timeline, read.after) || incoming.timeline.length > read.limit || incoming.eventCount < end || incoming.hasMore !== (incoming.eventCount > end) || (incoming.hasMore && incoming.timeline.length !== read.limit)) return null;
  if (!read.append) return read.after === 0 ? incoming : null;
  if (!previous || !previous.hasMore || read.accountHandle !== previous.accountHandle || previous.accountHandle !== incoming.accountHandle || previous.intent.intentId !== incoming.intent.intentId || read.after !== (previous.timeline.at(-1)?.sequence ?? 0) || !contiguous(previous.timeline, 0) || incoming.eventCount < previous.eventCount) return null;
  const timeline = [...previous.timeline, ...incoming.timeline];
  if (timeline.length > 1000) return null;
  return { ...incoming, timeline };
}
