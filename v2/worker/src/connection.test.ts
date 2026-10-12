import { describe, it, expect, vi } from 'vitest';
import { Connection } from './connection.js';
import { registrationSchema, Credentials } from './connection-contract.js';
import type { Provider } from './provider.js';
export const registration = registrationSchema.parse({ clientId: 'fixture-client', redirectUri: 'http://127.0.0.1:3000/api/connection/callback', issuer: 'https://agent.robinhood.com/mcp/trading', authorizationEndpoint: 'https://robinhood.com/oauth', tokenEndpoint: 'https://api.robinhood.com/oauth2/token/', scope: 'internal', tokenEndpointAuthMethod: 'none', pkce: 'S256' });
const session = 's'.repeat(43);
const account = { account_number: 'ACCOUNT1', rhs_account_number: 'RHS2', rhc_account_number: 'RHC3', eligible: true, agent_accessible: true, status: 'active', account_type: 'cash', ownership: 'individual' };
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() {
  let now = 100000, persisted: Credentials | null = null;
  const token = () => ({ access: 'SECRET-access', refresh: 'SECRET-refresh', expiresAt: now + 60000 });
  const provider = { exchange: vi.fn(async () => token()), refresh: vi.fn(async () => token()), accounts: vi.fn(async (): Promise<unknown> => ({ accounts: [account] })) } satisfies Provider;
  const vault = { read: () => persisted, write: vi.fn((value: Credentials | null) => { persisted = value; }) };
  const connection = new Connection(provider, vault, registration, () => now);
  const start = () => new URL(connection.initiate(session).authorizationUrl);
  const connect = async () => connection.callback(session, { state: start().searchParams.get('state'), code: 'SECRET-code' });
  return { connection, provider, vault, token, start, connect, persisted: () => persisted, time: (n: number) => { now += n; }, restart: () => new Connection(provider, vault, registration, () => now) };
}
describe('worker connection state machine (offline fixture adapter)', () => {
  it('S256, bound one-use callback, masked eligible selection, local disconnect', async () => {
    const f = fixture(), url = f.start(), state = url.searchParams.get('state');
    expect(url.origin).toBe('https://robinhood.com'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('code_verifier')).toBe(false);
    await expect(f.connection.callback('x'.repeat(43), { state, code: 'code' })).rejects.toThrow();
    const status = await f.connection.callback(session, { state, code: 'code' });
    expect(status.state).toBe('connected'); expect(status.accounts[0].label).toBe('Account ••••RHC3');
    expect(JSON.stringify(status)).not.toMatch(/SECRET|ACCOUNT1|RHS2/);
    expect(f.connection.select({ account: status.accounts[0].handle }).selected).toBe(status.accounts[0].handle);
    await expect(f.connection.callback(session, { state, code: 'code' })).rejects.toThrow();
    expect(f.connection.disconnect().state).toBe('disconnected'); expect(f.persisted()).toBeNull();
    expect(() => f.connection.select({ account: status.accounts[0].handle })).toThrow();
  });
  it('rejects malformed/expired state, bounded pending and incompatible registration', async () => {
    const f = fixture(), state = f.start().searchParams.get('state');
    expect(() => f.start()).toThrow();
    f.time(300001); await expect(f.connection.callback(session, { state, code: 'code' })).rejects.toThrow();
    expect(f.provider.exchange).not.toHaveBeenCalled();
    for (const override of [{ redirectUri: 'https://evil.test' }, { authorizationEndpoint: 'https://evil.test' }, { clientId: '' }, { pkce: 'plain' }, { secret: 'forbidden' }]) expect(registrationSchema.safeParse({ ...registration, ...override }).success).toBe(false);
  });
  it('exchange failure is redacted; expired state is not connected; restart needs discovery', async () => {
    const f = fixture(); f.provider.exchange.mockRejectedValueOnce(new Error('SECRET-provider'));
    await expect(f.connect()).rejects.toThrow('connection unavailable'); expect(f.connection.status().state).toBe('unavailable');
    f.connection.disconnect(); await f.connect();
    expect(f.restart().status().state).toBe('unavailable');
    f.time(61000); expect(f.connection.status().state).toBe('unavailable'); expect(f.connection.status().accounts).toEqual([]);
    f.provider.refresh.mockRejectedValueOnce(new Error('SECRET-refresh'));
    await expect(f.connection.discover()).rejects.toThrow('connection unavailable'); expect(f.persisted()).toBeNull();
  });
  it('refresh is single-flight, rotates atomically and stale selection expires', async () => {
    const f = fixture(); const status = await f.connect(); f.time(40000);
    const pending = deferred<Credentials>(); f.provider.refresh.mockReturnValueOnce(pending.promise);
    const a = f.connection.discover(), b = f.connection.discover(); expect(f.provider.refresh).toHaveBeenCalledTimes(1);
    pending.resolve(f.token()); await Promise.all([a, b]);
    expect(() => f.connection.select({ account: status.accounts[0].handle })).toThrow();
  });
  it.each(['callback', 'refresh', 'discovery'])('disconnect defeats in-flight %s and a new connection generation', async kind => {
    const f = fixture(); const pending = deferred<any>(); let flight: Promise<unknown>;
    if (kind === 'callback') { f.provider.exchange.mockReturnValueOnce(pending.promise); flight = f.connect(); }
    else { await f.connect(); if (kind === 'refresh') { f.time(40000); f.provider.refresh.mockReturnValueOnce(pending.promise); } else f.provider.accounts.mockReturnValueOnce(pending.promise); flight = f.connection.discover(); await Promise.resolve(); }
    f.connection.disconnect();
    pending.resolve(kind === 'discovery' ? { accounts: [account] } : f.token());
    await expect(flight).rejects.toThrow(); expect(f.persisted()).toBeNull(); expect(f.connection.status().state).toBe('disconnected');
    await f.connect(); expect(f.connection.status().state).toBe('connected');
  });
  it.each([{ ...account, eligible: false }, { ...account, agent_accessible: false }, { ...account, eligible: undefined }, { nickname: 'eligible' }, { ...account, rhc_account_number: undefined }])('rejects malformed/false eligibility %j', async bad => {
    const f = fixture(); f.provider.accounts.mockResolvedValueOnce({ accounts: [bad] });
    await expect(f.connect()).rejects.toThrow(); expect(f.connection.status().state).toBe('unavailable');
  });
  it('vault read/write/clear failure stays unavailable, never acknowledges durable disconnect', async () => {
    const f = fixture(); f.vault.write.mockImplementation(() => { throw new Error('disk'); });
    await expect(f.connect()).rejects.toThrow(); expect(f.connection.status().state).toBe('unavailable');
    expect(() => f.connection.disconnect()).toThrow(); expect(f.connection.status().state).toBe('unavailable');
    const c = new Connection(f.provider, { read() { throw new Error('corrupt'); }, write() {} }, registration);
    expect(c.status().state).toBe('unavailable'); expect(() => c.initiate(session)).toThrow();
  });
});
it('denied callback consumes bound state and expiry during exchange cannot persist credentials', async () => {
  const denied = fixture(), state = denied.start().searchParams.get('state');
  await expect(denied.connection.callback(session, { state, error: 'access_denied' })).rejects.toThrow();
  expect(denied.provider.exchange).not.toHaveBeenCalled(); expect(denied.connection.status().state).toBe('unavailable');
  await expect(denied.connection.callback(session, { state, code: 'c' })).rejects.toThrow();
  const f = fixture(), pending = deferred<Credentials>(); f.provider.exchange.mockReturnValueOnce(pending.promise);
  const started = new URL(f.connection.initiate(session, 100001).authorizationUrl);
  const flight = f.connection.callback(session, { state: started.searchParams.get('state'), code: 'c' });
  f.time(2); pending.resolve(f.token()); await expect(flight).rejects.toThrow(); expect(f.persisted()).toBeNull();
});
it.each([{ status: 'inactive' }, { account_type: 'margin' }, { ownership: 'joint' }, { status: undefined }])('requires active cash individual eligibility %j', async override => {
  const f = fixture(); f.provider.accounts.mockResolvedValueOnce({ accounts: [{ ...account, ...override }] }); await expect(f.connect()).rejects.toThrow();
});
it('old callback cannot replace or clear a newer connection after disconnect', async () => {
  const f = fixture(), pending = deferred<Credentials>(); f.provider.exchange.mockReturnValueOnce(pending.promise);
  const old = f.connect(); f.connection.disconnect(); await f.connect(); const current = f.persisted();
  pending.resolve({ ...f.token(), access: 'STALE' }); await expect(old).rejects.toThrow(); expect(f.persisted()).toEqual(current); expect(f.connection.status().state).toBe('connected');
});
it('shutdown invalidates in-flight work before the vault key/lock is released', async () => {
  const f = fixture(), pending = deferred<Credentials>(); f.provider.exchange.mockReturnValueOnce(pending.promise);
  const old = f.connect(); f.connection.shutdown(); const writes = f.vault.write.mock.calls.length;
  pending.resolve(f.token()); await expect(old).rejects.toThrow(); expect(f.vault.write).toHaveBeenCalledTimes(writes);
  expect(() => f.connection.disconnect()).toThrow(); expect(() => f.start()).toThrow();
  await expect(f.connection.discover()).rejects.toThrow(); expect(f.vault.write).toHaveBeenCalledTimes(writes);
});
it('session expiry during discovery clears credentials instead of returning connected', async () => {
  const f = fixture(); await f.connect(); const pending = deferred<unknown>(); f.provider.accounts.mockReturnValueOnce(pending.promise);
  const flight = f.connection.discover(100001); await Promise.resolve(); f.time(2); pending.resolve({ accounts: [account] });
  await expect(flight).rejects.toThrow(); expect(f.persisted()).toBeNull(); expect(f.connection.status().state).toBe('unavailable');
});
it.each(['account_number', 'rhs_account_number', 'rhc_account_number'])('independently rejects duplicate normalized %s', async key => {
  const f = fixture(); const other = { ...account, account_number: 'A2', rhs_account_number: 'S2', rhc_account_number: 'C2', [key]: account[key as keyof typeof account] };
  f.provider.accounts.mockResolvedValueOnce({ accounts: [account, other] });
  await expect(f.connect()).rejects.toThrow(); expect(f.connection.status().accounts).toEqual([]);
});
it('rejects handle collision within a discovery and reuse across discoveries atomically', async () => {
  for (const duplicate of [true, false]) {
    const f = fixture();
    if (duplicate) f.provider.accounts.mockResolvedValueOnce({ accounts: [account, { ...account, account_number: 'A2', rhs_account_number: 'S2', rhc_account_number: 'C2' }] });
    const c = new Connection(f.provider, f.vault, registration, () => 100000, () => 'h'.repeat(43));
    const state = new URL(c.initiate(session).authorizationUrl).searchParams.get('state');
    const initial = c.callback(session, { state, code: 'fixture' });
    if (duplicate) await expect(initial).rejects.toThrow();
    else { await initial; await expect(c.discover()).rejects.toThrow(); }
    expect(c.status().accounts).toEqual([]); expect(f.persisted()).toBeNull();
  }
});
it.each(['rediscovery', 'disconnect/reconnect', 'failure/reconnect'])('never reissues an older handle after %s', async transition => {
  const f = fixture(), oldHandle = 'a'.repeat(43);
  const handles = [oldHandle, 'b'.repeat(43), 'c'.repeat(43), oldHandle];
  const c = new Connection(f.provider, f.vault, registration, () => 100000, () => handles.shift()!);
  const connect = () => {
    const state = new URL(c.initiate(session).authorizationUrl).searchParams.get('state');
    return c.callback(session, { state, code: 'fixture' });
  };
  await connect(); c.select({ account: oldHandle });
  await c.discover(); await c.discover();
  expect(() => c.select({ account: oldHandle })).toThrow('invalid account');
  if (transition === 'failure/reconnect') {
    f.provider.accounts.mockRejectedValueOnce(new Error('fixture failure'));
    await expect(c.discover()).rejects.toThrow('connection unavailable');
  }
  if (transition !== 'rediscovery') c.disconnect();
  // Recycled handle must not silently authorize a different account.
  f.provider.accounts.mockResolvedValueOnce({ accounts: [{ ...account, account_number: 'OTHER1', rhs_account_number: 'OTHER2', rhc_account_number: 'OTHER3' }] });
  await expect(transition === 'rediscovery' ? c.discover() : connect()).rejects.toThrow('connection unavailable');
  expect(c.status().state).toBe('unavailable'); expect(c.status().accounts).toEqual([]);
  expect(c.status().selected).toBeNull(); expect(f.persisted()).toBeNull();
  expect(() => c.select({ account: oldHandle })).toThrow('invalid account');
});
it('bounds lifetime handle reservations without eviction or disconnect reset', async () => {
  const f = fixture(); let serial = 0;
  f.provider.accounts.mockResolvedValue({ accounts: Array.from({ length: 100 }, (_, i) => ({ ...account, account_number: `A${i}`, rhs_account_number: `S${i}`, rhc_account_number: `C${i}` })) });
  const c = new Connection(f.provider, f.vault, registration, () => 100000, () => String(++serial).padStart(43, '0'));
  const connect = () => {
    const state = new URL(c.initiate(session).authorizationUrl).searchParams.get('state');
    return c.callback(session, { state, code: 'fixture' });
  };
  const first = await connect();
  for (let i = 1; i < 100; i++) await c.discover();
  expect(serial).toBe(10000); expect(c.status().state).toBe('connected');
  expect(() => c.select({ account: first.accounts[0].handle })).toThrow();
  await expect(c.discover()).rejects.toThrow('connection unavailable');
  expect(serial).toBe(10000); expect(c.status().accounts).toEqual([]); expect(f.persisted()).toBeNull();
  c.disconnect(); await expect(connect()).rejects.toThrow('connection unavailable');
  expect(serial).toBe(10000); expect(c.status().state).toBe('unavailable'); expect(f.persisted()).toBeNull();
});
