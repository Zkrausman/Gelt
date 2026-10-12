import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Account, accountsSchema, accountIdentity } from './connection-contract.js';

// This boundary consumes provider data, never instructions. Bounds apply even to
// discarded metadata; unknown policy strings exclude a record, not grant access.
function boundedJson(value: unknown, depth = 0, budget = { nodes: 8192 }): void {
  if (--budget.nodes < 0 || depth > 12) throw new Error('unsupported account payload');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string' && value.length <= 16384) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) throw new Error('unsupported account payload');
  for (const [key, child] of Object.entries(value)) {
    if (key.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('unsafe metadata');
    boundedJson(child, depth + 1, budget);
  }
}
const optionalIdentity = z.union([accountIdentity, z.literal('')]).optional();
const policy = z.string().min(1).max(64).optional();
const rawAccount = z.object({
  account_number: accountIdentity,
  rhs_account_number: optionalIdentity, rhc_account_number: optionalIdentity,
  type: policy, brokerage_account_type: policy, state: policy,
  agentic_allowed: z.boolean().optional(), deactivated: z.boolean().optional(),
  permanently_deactivated: z.boolean().optional(),
}).strip();
const payloadSchema = z.object({ data: z.object({ accounts: z.array(rawAccount).max(100) }).strict(), guide: z.string().max(16384).optional() }).strict();
const toolResult = z.object({
  structuredContent: z.unknown().optional(),
  content: z.array(z.object({ type: z.literal('text'), text: z.string().max(131072) }).strict()).max(1).optional(),
  isError: z.literal(false).optional(),
}).strict();

// JSON.parse alone silently accepts duplicate object keys. Tokenize the already
// syntax-validated JSON to reject that ambiguity (including escaped key aliases).
export function parseProviderJson(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > 131072) throw new Error('response too large');
  const value: unknown = JSON.parse(text);
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)!;
  let i = 0;
  function visit(depth: number) {
    if (depth > 16) throw new Error('response too deep');
    const token = tokens[i++];
    if (token === '{') {
      const keys = new Set<string>();
      while (tokens[i] !== '}') {
        const key = JSON.parse(tokens[i++]) as string;
        if (keys.has(key)) throw new Error('duplicate JSON key');
        keys.add(key); i++; visit(depth + 1);
        if (tokens[i] !== ',') break;
        i++;
      }
      i++;
    } else if (token === '[') {
      while (tokens[i] !== ']') { visit(depth + 1); if (tokens[i] !== ',') break; i++; }
      i++;
    }
  }
  visit(0);
  return value;
}
function normalize(value: unknown) {
  boundedJson(value);
  const raw = payloadSchema.parse(value);
  const seen = { account_number: new Set<string>(), rhs_account_number: new Set<string>(), rhc_account_number: new Set<string>() };
  const accounts: Account[] = [];
  for (const record of raw.data.accounts) {
    // Check supplied identities BEFORE filtering so inaccessible records cannot
    // conceal conflicting routes. Identifier namespaces remain distinct.
    for (const key of ['account_number', 'rhs_account_number', 'rhc_account_number'] as const) {
      const id = record[key];
      if (!id) continue;
      if (seen[key].has(id)) throw new Error('duplicate account identity');
      seen[key].add(id);
    }
    if (record.type !== 'cash' || record.brokerage_account_type !== 'individual' || record.state !== 'active' || record.agentic_allowed !== true || record.deactivated !== false || record.permanently_deactivated !== false) continue;
    // A well-formed non-crypto record may coexist; never guess missing routes.
    if (!record.rhs_account_number || !record.rhc_account_number) continue;
    accounts.push({ account_number: record.account_number, rhs_account_number: record.rhs_account_number, rhc_account_number: record.rhc_account_number,
      eligible: true, agent_accessible: true, status: 'active', account_type: 'cash', ownership: 'individual' });
  }
  return accountsSchema.parse({ accounts });
}
export function normalizeAccountResult(value: unknown) {
  const result = toolResult.parse(value);
  const structured = result.structuredContent;
  const text = result.content?.[0]?.text;
  if (structured === undefined && text === undefined) throw new Error('missing account payload');
  const decoded = text === undefined ? undefined : parseProviderJson(text);
  const normalized = normalize(structured === undefined ? decoded : structured);
  if (structured !== undefined && decoded !== undefined) {
    normalize(decoded);
    if (!isDeepStrictEqual(structured, decoded)) throw new Error('conflicting account payloads');
  }
  return normalized;
}
