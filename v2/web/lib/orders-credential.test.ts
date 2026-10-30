import { beforeEach, afterEach, expect, it, vi } from 'vitest';

// Real component callbacks with deterministic state/ref cells. Effects and DOM
// scheduling are not emulated; the hosted browser gates remain mandatory.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[] }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => { const key = hooks.cursor++; if (!(key in hooks.cells)) hooks.cells[key] = typeof initial === 'function' ? initial() : initial;
      return [hooks.cells[key], (value: unknown) => { hooks.cells[key] = typeof value === 'function' ? value(hooks.cells[key]) : value; }]; },
    useRef: (initial: unknown) => { const key = hooks.cursor++; if (!(key in hooks.cells)) hooks.cells[key] = { current: initial }; return hooks.cells[key]; },
    useEffect: () => { hooks.cursor++; },
  };
});
import Orders from '../app/orders/page';
type Node = { type: unknown; props: { children?: unknown; [key: string]: any } };
const nodes = (x: unknown): Node[] => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === 'object' && 'props' in x ? [x as Node, ...nodes((x as Node).props.children)] : [];
const text = (x: unknown): string => Array.isArray(x) ? x.map(text).join(' ') : x && typeof x === 'object' && 'props' in x ? text((x as Node).props.children) : typeof x === 'string' || typeof x === 'number' ? String(x) : '';
const render = () => { hooks.cursor = 0; return Orders(); };
const change = (value: string) => nodes(render()).find(x => x.props['aria-label'] === 'Restore CSRF')!.props.onChange({ target: { value } });
const click = (label: string) => { const button = nodes(render()).find(x => x.type === 'button' && text(x) === label); expect(button, label).toBeDefined(); expect(button!.props.disabled, label).toBeFalsy(); button!.props.onClick(); };
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const pending = () => { let resolve!: (v: Response) => void, reject!: (v: Error) => void; const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const handle = 'a'.repeat(43);
const status = (label = 'Account ••••1234') => ({ version: 'v1', state: 'connected', reason: 'ready', expiresAt: Date.now() + 30000, accounts: [{ handle, label }], selected: handle, execution: false });
const surface = { version: 'v1', mode: 'disabled', execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, reconciliation: false, reason: 'production_adapter_unsupported' };
const pi = { version: 'v1', source: 'synthetic-offline-pi-handoff', enabled: true, execution: false, preview: false, confirmation: false, dispatch: false, cancellation: false, accounts: ['synthetic-pi-account-a', 'synthetic-pi-account-b'] };
const history = { version: 'v1', accountHandle: handle, account: { ACCOUNT: 'MASKED', RHS: true, RHC: false }, items: [{ intentId: 'intent-a', recordedAt: '2026-10-29T00:00:00Z', source: 'synthetic-offline', instrumentId: 'PRIVATE-HISTORY', side: 'buy', requestedQuantity: '1', requestedLimitPrice: '1', currency: 'USD', executionCount: 0 }], hasMore: false };
const defaults = (op: string) => op === 'status' ? status() : op === 'order-status' ? surface : op === 'pi-status' ? pi : op === 'history' ? history : { version: 'v1', accountHandle: handle, intent: { ...history.items[0] }, timeline: [], hasMore: false };
beforeEach(() => { hooks.cursor = 0; hooks.cells = []; vi.spyOn(Date, 'now').mockReturnValue(1800000000000); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('clears settled connection, fixture and ledger data immediately on credential change', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(defaults(url.split('/').at(-1)!))));
  change('credential-a'); click('Read protected status'); await flush(); click('Load durable history'); await flush();
  expect(text(render())).toContain('PRIVATE-HISTORY'); expect(text(render())).toContain('Account ••••1234');
  change('credential-b');
  expect(text(render())).not.toContain('PRIVATE-HISTORY'); expect(text(render())).not.toContain('Account ••••1234');
  expect(text(render())).not.toContain('explicit test-only injection enabled');
});
it.each(['success', 'failure'] as const)('old delayed status %s cannot overwrite a fresh same-token ABA read or its state', async outcome => {
  const old = pending(); let requests = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { const op = url.split('/').at(-1)!; if (op === 'status') { requests++; if (requests === 1) return old.promise; return Response.json(status('Account ••••5678')); } return Response.json(defaults(op)); }));
  change('credential-a'); click('Read protected status'); await flush();
  change('credential-b'); change('credential-a'); click('Read protected status'); await flush();
  expect(text(render())).toContain('Account ••••5678');
  if (outcome === 'success') old.resolve(Response.json(status())); else old.reject(Error('stale failure'));
  await flush(); expect(text(render())).toContain('Account ••••5678'); expect(text(render())).not.toContain('Account ••••1234');
});
it.each(['history', 'intent'] as const)('ignores delayed protected %s data after credential change even if transport ignores abort', async operation => {
  const old = pending(); let hold = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { const op = url.split('/').at(-1)!; return hold && op === operation ? old.promise : Response.json(defaults(op)); }));
  change('credential-a'); click('Read protected status'); await flush();
  if (operation === 'intent') { click('Load durable history'); await flush(); }
  hold = true; click(operation === 'history' ? 'Load durable history' : 'Open'); await flush();
  change('credential-b'); old.resolve(Response.json(defaults(operation))); await flush();
  expect(text(render())).not.toContain('PRIVATE-HISTORY'); expect(text(render())).not.toContain('Intent intent-a'); expect(text(render())).not.toContain('Account ••••1234');
});

it.each(['pi-prepare', 'pi-review'] as const)('late %s cannot restore a previous credential fixture or its review message', async operation => {
  const old = pending(); let hold = false;
  const handoff = { version: 'v1', source: 'synthetic-offline-pi-handoff', id: '1'.repeat(32), digest: '2'.repeat(64), expiresAt: Date.now() + 30000, draft: { account: 'synthetic-pi-account-a', route: 'RHS', instrument: 'BTC-USD', side: 'BUY', type: 'LIMIT', quantity: '0.0001', limitPrice: '50000.00', revision: 0 }, authority: false, brokerFacts: false };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { const op = url.split('/').at(-1)!; return hold && op === operation ? old.promise : Response.json(op === 'pi-prepare' ? handoff : defaults(op)); }));
  change('credential-a'); click('Read protected status'); await flush();
  if (operation === 'pi-review') { click('Prepare synthetic handoff'); await flush(); }
  hold = true; click(operation === 'pi-prepare' ? 'Prepare synthetic handoff' : 'Review fixture terms (no submission)'); await flush();
  change('credential-b'); click('Read protected status'); await flush();
  old.resolve(Response.json(handoff)); await flush();
  expect(text(render())).not.toContain(handoff.id);
  expect(text(render())).not.toContain('Reviewed synthetic fixture terms only.');
});

it.each(['success', 'failure'] as const)('old %s cannot clear busy while the new credential read is still pending', async outcome => {
  const old = pending(), fresh = pending(); let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { const op = url.split('/').at(-1)!; if (op === 'status') return ++reads === 1 ? old.promise : fresh.promise; return Response.json(defaults(op)); }));
  change('credential-a'); click('Read protected status'); await flush();
  change('credential-b'); click('Read protected status'); await flush();
  if (outcome === 'success') old.resolve(Response.json(status())); else old.reject(Error('old failure'));
  await flush();
  expect(nodes(render()).find(x => x.type === 'button' && text(x) === 'Read protected status')!.props.disabled).toBe(true);
  fresh.resolve(Response.json(status('Account ••••5678'))); await flush();
  expect(text(render())).toContain('Account ••••5678');
  expect(nodes(render()).find(x => x.type === 'button' && text(x) === 'Read protected status')!.props.disabled).toBe(false);
});
