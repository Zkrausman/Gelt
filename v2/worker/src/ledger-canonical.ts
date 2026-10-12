import { createHash } from 'node:crypto';
import type { z } from 'zod';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function decode<T>(schema: z.ZodType<T>, body: string): T {
  if (typeof body !== 'string' || body.length > 4096) throw new Error();
  const value = schema.parse(JSON.parse(body));
  if (canonical(value) !== body) throw new Error();
  return value;
}
