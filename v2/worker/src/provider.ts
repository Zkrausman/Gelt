import { z } from 'zod';
import { Credentials, Registration } from './connection-contract.js';
import { normalizeAccountResult, parseProviderJson } from './account-adapter.js';
const RESOURCE = 'https://agent.robinhood.com/mcp/trading';
const TOKEN = 'https://api.robinhood.com/oauth2/token/';
export interface Provider {
  exchange(code: string, verifier: string): Promise<Credentials>;
  refresh(credentials: Credentials): Promise<Credentials>;
  accounts(access: string): Promise<unknown>;
}
export async function boundedBody(response: Response, max = 131072): Promise<string> {
  if (!response.body) throw new Error('empty response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > max) throw new Error('response too large'); chunks.push(value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); }
}
const tokenSchema = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(8192).optional(), token_type: z.literal('Bearer'), expires_in: z.number().int().min(1).max(86400), scope: z.literal('internal').optional() }).strict();
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.number().int(), result: z.unknown() }).strict();
const toolList = z.object({ tools: z.array(z.object({ name: z.string(), description: z.string().optional(), inputSchema: z.unknown(), outputSchema: z.unknown().optional(), annotations: z.unknown().optional() }).strict()).max(100) }).strict();
const emptyArguments = z.object({ type: z.literal('object'), properties: z.object({}).strict(), required: z.array(z.never()).optional(), additionalProperties: z.literal(false).optional() }).strict();
export class OfficialProvider implements Provider {
  constructor(private registration: Registration, private transport: typeof fetch = fetch, private now = Date.now) {}
  private async request(url: typeof RESOURCE | typeof TOKEN, init: RequestInit) {
    const response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('provider unavailable'); }
    return response;
  }
  private async token(params: Record<string, string>, previous?: Credentials) {
    const response = await this.request(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ ...params, client_id: this.registration.clientId, resource: RESOURCE }) });
    if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('unsupported token response');
    const token = tokenSchema.parse(parseProviderJson(await boundedBody(response, 32768)));
    if (!token.refresh_token && !previous) throw new Error('refresh token required');
    return { access: token.access_token, refresh: token.refresh_token ?? previous!.refresh, expiresAt: this.now() + token.expires_in * 1000 };
  }
  exchange(code: string, verifier: string) { return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.registration.redirectUri }); }
  refresh(previous: Credentials) { return this.token({ grant_type: 'refresh_token', refresh_token: previous.refresh }, previous); }
  async accounts(access: string) {
    let session: string | null = null;
    const call = async (id: number | null, method: string, params?: unknown) => {
      const response = await this.request(RESOURCE, { method: 'POST', headers: {
        Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session } : {}), ...(method !== 'initialize' ? { 'MCP-Protocol-Version': '2025-03-26' } : {}),
      }, body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) }) });
      const nextSession = response.headers.get('mcp-session-id');
      if (nextSession) { if (!/^[\x21-\x7e]{1,256}$/.test(nextSession) || (session && nextSession !== session)) throw new Error('invalid MCP session'); session = nextSession; }
      if (id === null) { if (response.status !== 202) throw new Error('invalid notification response'); await response.body?.cancel(); return; }
      const text = await boundedBody(response);
      let value: unknown;
      const type = response.headers.get('content-type') ?? '';
      if (type.startsWith('application/json')) value = parseProviderJson(text);
      else if (type.startsWith('text/event-stream')) {
        // Bounded finite SSE only. Long-lived/resumption/server-request streams unsupported.
        const events = text.replace(/\r\n/g, '\n').trim().split('\n\n').filter(e => !e.startsWith(':'));
        if (events.length !== 1) throw new Error('unsupported MCP stream');
        const lines = events[0].split('\n');
        if (lines.some(l => !l.startsWith('data:') && l !== 'event: message')) throw new Error('unsupported MCP event');
        value = parseProviderJson(lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'));
      } else throw new Error('unsupported MCP encoding');
      const rpc = rpcSchema.parse(value); if (rpc.id !== id || rpc.result === undefined) throw new Error('invalid MCP result'); return rpc.result;
    };
    const init = z.object({ protocolVersion: z.literal('2025-03-26'), capabilities: z.object({ tools: z.object({ listChanged: z.boolean().optional() }).strict() }).passthrough(), serverInfo: z.object({ name: z.string(), version: z.string() }).passthrough(), instructions: z.string().optional() }).strict().parse(await call(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gelt-m3', version: '1' } }));
    if (!init.capabilities.tools) throw new Error('tools unavailable');
    await call(null, 'notifications/initialized');
    const tools = toolList.parse(await call(2, 'tools/list'));
    const matches = tools.tools.filter(t => t.name === 'get_accounts');
    if (matches.length !== 1) throw new Error('unsupported discovery');
    emptyArguments.parse(matches[0].inputSchema);
    return normalizeAccountResult(await call(3, 'tools/call', { name: 'get_accounts', arguments: {} }));
  }
}
