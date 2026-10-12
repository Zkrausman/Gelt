import { it, expect, vi } from 'vitest';
import { OfficialProvider, boundedBody } from './provider.js';
import { Registration } from './connection-contract.js';
const registration: Registration = { clientId: 'fixture', redirectUri: 'http://127.0.0.1:3000/api/connection/callback', issuer: 'https://agent.robinhood.com/mcp/trading', authorizationEndpoint: 'https://robinhood.com/oauth', tokenEndpoint: 'https://api.robinhood.com/oauth2/token/', scope: 'internal', tokenEndpointAuthMethod: 'none', pkce: 'S256' };
const account = { account_number: 'A1', rhs_account_number: 'S1', rhc_account_number: 'C1', eligible: true, agent_accessible: true, status: 'active', account_type: 'cash', ownership: 'individual' };
function fixture(sse = false) {
  const calls: { url: string; options: RequestInit; body: any }[] = [];
  const transport = vi.fn(async (url: any, options: any) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    if (!body.id) return new Response(null, { status: 202 });
    const result = body.id === 1 ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'offline', version: '1' } } : body.id === 2 ? { tools: [{ name: 'get_accounts', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }, { name: 'place_order', inputSchema: {} }] } : { structuredContent: { data: { accounts: [{ account_number: 'A1', rhs_account_number: 'S1', rhc_account_number: 'C1', type: 'cash', brokerage_account_type: 'individual', agentic_allowed: true, state: 'active', deactivated: false, permanently_deactivated: false }] } } };
    const value = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
    return new Response(sse ? `event: message\ndata: ${value}\n\n` : value, { headers: { 'Content-Type': sse ? 'text/event-stream' : 'application/json', 'Mcp-Session-Id': 'PRIVATE-mcp-session' } });
  });
  return { provider: new OfficialProvider(registration, transport), transport, calls };
}
it.each([false, true])('MCP initialize/session/notification/metadata/named discovery, SSE=%s', async sse => {
  const f = fixture(sse); expect(await f.provider.accounts('SECRET-access')).toEqual({ accounts: [account] });
  expect(f.calls.map(c => c.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  expect(f.calls[3].body.params).toEqual({ name: 'get_accounts', arguments: {} });
  for (const c of f.calls) { expect(c.url).toBe(registration.issuer); expect(c.options.redirect).toBe('error'); expect(c.options.signal).toBeInstanceOf(AbortSignal); }
  expect((f.calls[3].options.headers as any)['Mcp-Session-Id']).toBe('PRIVATE-mcp-session');
  expect('callTool' in f.provider).toBe(false);
});
it.each([
  { jsonrpc: '2.0', id: 99, result: {} }, { jsonrpc: '2.0', id: 1, error: { message: 'SECRET' } },
  { jsonrpc: '2.0', id: 1, result: { protocolVersion: 'unknown', capabilities: {}, serverInfo: {} } },
])('rejects protocol/errors/id mismatch without continuing', async value => {
  const f = fixture(); f.transport.mockResolvedValueOnce(Response.json(value)); await expect(f.provider.accounts('SECRET')).rejects.toThrow(); expect(f.transport).toHaveBeenCalledTimes(1);
});
it('rejects unproven argument schema, pagination, unsupported tool and missing structured output', async () => {
  for (const tools of [{ tools: [{ name: 'get_accounts', inputSchema: { type: 'object', properties: { account: { type: 'string' } }, required: ['account'] } }] }, { tools: [], nextCursor: 'next' }, { tools: [{ name: 'place_order', inputSchema: {} }] }]) {
    const f = fixture(), original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (url, options) => JSON.parse(options.body).method === 'tools/list' ? Response.json({ jsonrpc: '2.0', id: 2, result: tools }) : original(url, options));
    await expect(f.provider.accounts('SECRET')).rejects.toThrow(); expect(f.calls.some(c => c.body.method === 'tools/call')).toBe(false);
  }
});
it('token exchange/refresh validates expiry, fixed redirect, public client, strict scope and redirect policy', async () => {
  const transport = vi.fn(async () => Response.json({ access_token: 'SECRET', refresh_token: 'REFRESH', token_type: 'Bearer', expires_in: 60 }));
  const provider = new OfficialProvider(registration, transport, () => 1000);
  const token = await provider.exchange('code', 'verifier'); expect(token.expiresAt).toBe(61000);
  const [url, options] = (transport.mock.calls as any)[0]; expect(url).toBe(registration.tokenEndpoint); expect(options.redirect).toBe('error'); expect(options.body.get('redirect_uri')).toBe(registration.redirectUri); expect(options.body.has('client_secret')).toBe(false);
  transport.mockResolvedValueOnce(Response.json({ access_token: 'NEW', token_type: 'Bearer', expires_in: 60 })); expect((await provider.refresh(token)).refresh).toBe('REFRESH');
  for (const bad of [{ access_token: 'SECRET', refresh_token: 'REFRESH', token_type: 'Bearer', expires_in: 0 }, { error: 'SECRET' }, { access_token: 'SECRET', refresh_token: 'REFRESH', token_type: 'Bearer', expires_in: 60, scope: 'different' }]) { transport.mockResolvedValueOnce(Response.json(bad)); await expect(provider.exchange('c', 'v')).rejects.toThrow(); }
});
it('bounds response bodies and fails network/redirect errors without retry', async () => {
  await expect(boundedBody(new Response('x'.repeat(100)), 32)).rejects.toThrow();
  const transport = vi.fn(async () => { throw new Error('redirect refused'); });
  await expect(new OfficialProvider(registration, transport).exchange('c', 'v')).rejects.toThrow(); expect(transport).toHaveBeenCalledTimes(1);
});
it('rejects session changes, conflicting RPC and ambiguous/unsupported SSE', async () => {
  for (const replacement of [
    new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: {}, error: { message: 'SYNTHETIC' } }), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{"jsonrpc":"2.0","id":3,"result":{},"result":{}}', { headers: { 'Content-Type': 'application/json' } }),
    new Response('data: {}\n\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    new Response('id: unsupported\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    new Response('x'.repeat(131073), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'CHANGED-session' } }),
  ]) {
    const f = fixture(), original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (url, options) => JSON.parse(options.body).method === 'tools/call' ? replacement : original(url, options));
    await expect(f.provider.accounts('SYNTHETIC')).rejects.toThrow();
    expect(f.transport).toHaveBeenCalledTimes(4);
  }
});
