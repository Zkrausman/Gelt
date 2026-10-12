import { z } from 'zod';
export const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const empty = z.object({}).strict();
export const callbackInput = z.union([
  z.object({ state: opaque, code: z.string().min(1).max(2048).regex(/^[\x21-\x7e]+$/) }).strict(),
  z.object({ state: opaque, error: z.string().regex(/^[A-Za-z_]{1,64}$/) }).strict(),
]);
export const selectionInput = z.object({ account: opaque }).strict();
export const statusSchema = z.object({
  version: z.literal('v1'), state: z.enum(['disconnected', 'authorizing', 'connected', 'unavailable']),
  reason: z.enum(['offline', 'setup_required', 'authorization_pending', 'not_connected', 'provider_failure', 'ready']),
  expiresAt: z.number().int().positive().nullable(),
  accounts: z.array(z.object({ handle: opaque, label: z.string().regex(/^Account ••••[A-Za-z0-9]{1,4}$/) }).strict()).max(100),
  selected: opaque.nullable(), execution: z.literal(false),
}).strict().superRefine((value, ctx) => {
  const connected = value.state === 'connected';
  if (connected ? (value.expiresAt === null || value.accounts.length === 0 || value.reason !== 'ready' || (value.selected !== null && !value.accounts.some(a => a.handle === value.selected))) : (value.expiresAt !== null || value.accounts.length !== 0 || value.selected !== null || value.reason === 'ready')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'inconsistent state' });
  if (new Set(value.accounts.map(a => a.handle)).size !== value.accounts.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate handle' });
});
export type Status = z.infer<typeof statusSchema>;
export const initiatedSchema = z.object({ version: z.literal('v1'), authorizationUrl: z.string().max(4096).url().refine(value => {
  const u = new URL(value), p = u.searchParams;
  const keys = ['response_type', 'client_id', 'redirect_uri', 'scope', 'resource', 'state', 'code_challenge', 'code_challenge_method'];
  return u.origin === 'https://robinhood.com' && u.pathname === '/oauth' && !u.hash && !u.username && !u.password && [...p.keys()].length === keys.length && keys.every(k => p.getAll(k).length === 1) && p.get('response_type') === 'code' && /^[A-Za-z0-9._-]{1,256}$/.test(p.get('client_id') ?? '') && p.get('redirect_uri') === 'http://127.0.0.1:3000/api/connection/callback' && p.get('scope') === 'internal' && p.get('resource') === 'https://agent.robinhood.com/mcp/trading' && opaque.safeParse(p.get('state')).success && opaque.safeParse(p.get('code_challenge')).success && p.get('code_challenge_method') === 'S256';
}) }).strict();
export const credentialsSchema = z.object({ access: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/), refresh: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/), expiresAt: z.number().int().positive() }).strict();
export type Credentials = z.infer<typeof credentialsSchema>;
// Internal normalized model only. Raw provider fields are mapped by account-adapter.
export const accountIdentity = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
export const accountSchema = z.object({
  account_number: accountIdentity,
  rhs_account_number: accountIdentity,
  rhc_account_number: accountIdentity,
  eligible: z.literal(true), agent_accessible: z.literal(true),
  status: z.literal('active'), account_type: z.literal('cash'), ownership: z.literal('individual'),
}).strict();
export const accountsSchema = z.object({ accounts: z.array(accountSchema).min(1).max(100) }).strict().superRefine((value, ctx) => {
  for (const key of ['account_number', 'rhs_account_number', 'rhc_account_number'] as const) {
    if (new Set(value.accounts.map(a => a[key])).size !== value.accounts.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate account identity' });
  }
});
export type Account = z.infer<typeof accountSchema>;
export const registrationSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9._-]{1,256}$/),
  redirectUri: z.literal('http://127.0.0.1:3000/api/connection/callback'),
  issuer: z.literal('https://agent.robinhood.com/mcp/trading'),
  authorizationEndpoint: z.literal('https://robinhood.com/oauth'),
  tokenEndpoint: z.literal('https://api.robinhood.com/oauth2/token/'),
  scope: z.literal('internal'), tokenEndpointAuthMethod: z.literal('none'), pkce: z.literal('S256'),
}).strict();
export type Registration = z.infer<typeof registrationSchema>;
