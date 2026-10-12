import { timingSafeEqual } from 'node:crypto';
export function equalSecret(a: string | undefined | null, b: string) {
  if (!a || a.length !== b.length) return false;
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
export function hasForwarded(headers: Iterable<[string, string]>) {
  return [...headers].some(([key]) => key.toLowerCase() === 'forwarded' || key.toLowerCase().startsWith('x-forwarded-'));
}
