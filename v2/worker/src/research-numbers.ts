import type { ResearchEvidence } from './research-contract.js';
import type { ResearchResultNumbers } from './research-json.js';

// No expansion of powers of ten or arbitrary-precision arithmetic. These lexical
// bounds also apply to zero coefficients; unsupported evidence fails closed.
const MAX_TOKEN_LENGTH = 4096;
const MAX_EXPONENT = 100_000;
type Decimal = { negative: boolean; coefficient: string; exponent: number };
function decimal(token: string | undefined): Decimal {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw new Error('unsupported research numeric token');
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?)([0-9]+))?$/.exec(token);
  if (!match) throw new Error('invalid research numeric token');
  const exponentDigits = (match[5] ?? '0').replace(/^0+/, '') || '0';
  if (exponentDigits.length > 6 || Number(exponentDigits) > MAX_EXPONENT) throw new Error('unsupported research numeric exponent');
  const fraction = match[3] ?? '';
  const digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return { negative: false, coefficient: '0', exponent: 0 };
  const coefficient = digits.replace(/0+$/, '');
  const exponent = (match[4] === '-' ? -1 : 1) * Number(exponentDigits) - fraction.length + digits.length - coefficient.length;
  return { negative: match[1] === '-', coefficient, exponent };
}
function equal(a: Decimal, b: Decimal): boolean {
  return a.negative === b.negative && a.coefficient === b.coefficient && a.exponent === b.exponent;
}

export function compareResearchNumbers(results: ResearchEvidence['results'], numbers: ResearchResultNumbers[]) {
  if (numbers.length !== results.length) throw new Error('missing research numeric tokens');
  let exact = 0, unequal = 0, approximate = 0, approximateFailed = 0;
  for (let index = 0; index < results.length; index++) {
    const raw = numbers[index];
    const actual = decimal(raw?.actual), expected = decimal(raw?.expected);
    const absolute = decimal(raw?.absoluteTolerance), relative = decimal(raw?.relativeTolerance);
    if (absolute.negative || relative.negative) throw new Error('negative research tolerance');
    // A tiny NONZERO tolerance may decode to zero. Its raw coefficient still
    // selects the approximate contract; never infer the mode from JS numbers.
    if (absolute.coefficient === '0' && relative.coefficient === '0') {
      exact++;
      if (!equal(actual, expected)) unequal++;
    } else {
      approximate++;
      const result = results[index];
      const delta = Math.abs(result.actual - result.expected);
      const bound = result.absoluteTolerance + result.relativeTolerance * Math.abs(result.expected);
      if (!Number.isFinite(delta) || !Number.isFinite(bound) || delta > bound) approximateFailed++;
    }
  }
  return {
    status: unequal || approximateFailed ? 'failed' as const : 'passed' as const,
    detail: `Zero-tolerance results compare exact original decimal values: ${exact} compared, ${unequal} unequal. Nonzero-tolerance results use the approximate finite-number formula: ${approximate} compared, ${approximateFailed} failed. Displayed values and tolerances may round or underflow; identical displayed numbers can differ in the original. No scientific execution.`,
  };
}
