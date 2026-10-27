import { canonical, digest } from './ledger-canonical.js';
import { pamrRecipe, pamrArtifactLimit, pamrRequestLimit, pamrRequestSchema,
  parsePAMRJSON, parsePAMRRequest, type PAMRRequest } from './paper-conversion-contract.js';

type Q = Readonly<{ n: bigint; d: bigint }>;
const bits = (n: bigint) => (n < 0n ? -n : n).toString(2).length;
class Limit extends Error {}
const bound = (n: bigint) => { if (bits(n) > 4096) throw new Limit(); return n; };
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
// Every temporary integer is bounded too. Reject a possible oversized operation
// BEFORE doing it; conservative rejection is part of this finite profile.
function product(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  if (bits(a) + bits(b) > 4096) throw new Limit();
  return bound(a * b);
}
function sum(a: bigint, b: bigint): bigint {
  if (a !== 0n && b !== 0n && (a > 0n) === (b > 0n) && Math.max(bits(a), bits(b)) >= 4096) throw new Limit();
  return bound(a + b);
}
function q(n: bigint, d = 1n): Q {
  bound(n); bound(d);
  if (d === 0n) throw new Error('invalid rational');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); return { n: n / g, d: d / g };
}
const zero = q(0n), one = q(1n);
function add(a: Q, b: Q): Q {
  const g = gcd(a.d, b.d), ad = a.d / g, bd = b.d / g;
  return q(sum(product(a.n, bd), product(b.n, ad)), product(ad, b.d));
}
const neg = (a: Q) => q(-a.n, a.d);
const sub = (a: Q, b: Q) => add(a, neg(b));
function mul(a: Q, b: Q): Q {
  const g = gcd(a.n, b.d), h = gcd(b.n, a.d);
  return q(product(a.n / g, b.n / h), product(a.d / h, b.d / g));
}
function div(a: Q, b: Q): Q { return mul(a, q(b.d, b.n)); }
const compare = (a: Q, b: Q) => { const v = sub(a, b).n; return v < 0n ? -1 : v > 0n ? 1 : 0; };
const total = (a: Q[]) => a.reduce(add, zero);
const render = (a: Q) => `${a.n}/${a.d}`;
function decimal(s: string): Q {
  const [i, f = ''] = s.split('.'); return q(BigInt(i + f), 10n ** BigInt(f.length));
}
// Euclidean projection onto {b>=0, sum(b)=1}. Derived from the threshold/KKT
// conditions; no third-party projection implementation is included.
function project(v: Q[]): Q[] {
  const sorted = [...v].sort((a, b) => compare(b, a));
  let prefix = zero, theta: Q | undefined;
  for (let i = 0; i < sorted.length; i++) {
    prefix = add(prefix, sorted[i]);
    const t = div(sub(prefix, one), q(BigInt(i + 1)));
    if (compare(sorted[i], t) > 0) theta = t;
  }
  if (!theta) throw new Error('invalid simplex');
  const result = v.map(x => compare(x, theta!) > 0 ? sub(x, theta!) : zero);
  if (compare(total(result), one) !== 0) throw new Error('invalid simplex');
  return result;
}
const hash = (domain: string, value: unknown) => digest(canonical({ domain, value }));
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const value of Object.values(v)) freeze(value);
    Object.freeze(v);
  }
  return v;
}
export type PAMRStep = {
  ordinal: number; rowSha256: string; parentStateSha256: string;
  weightsBefore: string[]; loss: string; tau: string; weightsAfter: string[]; stateSha256: string;
};
function compute(input: PAMRRequest) {
  const sourceSha256 = hash('gelt.pamr.source.v1', pamrRecipe);
  const parametersSha256 = hash('gelt.pamr.parameters.v1', { epsilon: '0.5', transactionCost: '0', assets: input.assets });
  const inputSha256 = hash('gelt.pamr.input.v1', input);
  let weights = input.assets.map(() => q(1n, BigInt(input.assets.length)));
  let parent = hash('gelt.pamr.genesis.v1', { sourceSha256, parametersSha256, weights: weights.map(render) });
  const steps: PAMRStep[] = [];
  for (let i = 0; i < input.rows.length; i++) {
    const x = input.rows[i].map(decimal), before = weights.map(render);
    const mean = div(total(x), q(BigInt(x.length))), centered = x.map(v => sub(v, mean));
    const dot = total(weights.map((v, j) => mul(v, x[j])));
    const rawLoss = sub(dot, q(1n, 2n)), loss = compare(rawLoss, zero) > 0 ? rawLoss : zero;
    const norm = total(centered.map(v => mul(v, v)));
    const tau = norm.n === 0n ? zero : div(loss, norm);
    weights = project(weights.map((v, j) => sub(v, mul(tau, centered[j]))));
    const rowSha256 = hash('gelt.pamr.row.v1', { ordinal: i + 1, assets: input.assets, row: input.rows[i] });
    const facts = { ordinal: i + 1, rowSha256, parentStateSha256: parent,
      weightsBefore: before, loss: render(loss), tau: render(tau), weightsAfter: weights.map(render) };
    parent = hash('gelt.pamr.state.v1', { sourceSha256, parametersSha256, ...facts });
    steps.push({ ...facts, stateSha256: parent });
  }
  const weightsFinal = weights.map(render);
  const outputSha256 = hash('gelt.pamr.output.v1', { inputSha256, stateSha256: parent, weightsFinal });
  const artifact = { schema: 'gelt.pamr-inert-candidate.v1', version: 1,
    classification: 'constructed_offline_test', recipe: pamrRecipe, input,
    sourceSha256, parametersSha256, inputSha256, steps, weightsFinal, outputSha256,
    fidelity: 'selected_paper_equations_only', referenceExecution: 'not_performed',
    authentication: 'not_established', effectScope: 'NONE', dispatchAllowed: false,
    promotionAllowed: false, production: 'CLOSED', operations: 'DEFER' } as const;
  const text = canonical(artifact);
  if (Buffer.byteLength(text, 'utf8') > pamrArtifactLimit) throw new Limit();
  freeze(artifact);
  computedArtifacts.add(artifact);
  return artifact;
}
export type PAMRArtifact = ReturnType<typeof compute>;
export type PAMRConversion = Readonly<{ status: 'computed'; artifact: PAMRArtifact }>
  | Readonly<{ status: 'rejected'; reason: 'invalid_input' | 'resource_limit' }>;

// Stateless whole-prefix replay: there is no caller state/receipt acceptance,
// effect, counter or capability. Repeating a request deterministically returns
// the same inert data; it does not consume a trading/simulation reservation.
export function convertPAMR(text: unknown): PAMRConversion {
  try { return freeze({ status: 'computed' as const, artifact: compute(parsePAMRRequest(text)) }); }
  catch (error) { return Object.freeze({ status: 'rejected', reason: error instanceof Limit ? 'resource_limit' : 'invalid_input' }); }
}
export function serializePAMRArtifact(artifact: PAMRArtifact): string {
  // Caller objects are never trusted or traversed here: serialize only output of
  // the strict textual verification API, or use canonical on a computed result.
  if (!computedArtifacts.has(artifact)) throw new Error('unrecognized PAMR artifact');
  return canonical(artifact);
}
const computedArtifacts = new WeakSet<object>();
// Reopen as DATA only, verifying the entire causal trace against a fresh replay.
export function verifyPAMRArtifact(text: unknown): Readonly<{ status: 'verified_data'; artifact: PAMRArtifact }>
  | Readonly<{ status: 'rejected'; reason: 'artifact_mismatch' }> {
  try {
    const value = parsePAMRJSON(text, 'artifact');
    if (!value || typeof value !== 'object' || !('input' in value)) throw new Error();
    const inputText = canonical(value.input);
    if (Buffer.byteLength(inputText, 'utf8') > pamrRequestLimit) throw new Error();
    const input = pamrRequestSchema.parse(value.input), artifact = compute(input);
    if (canonical(value) !== canonical(artifact)) throw new Error();
    computedArtifacts.add(artifact);
    return freeze({ status: 'verified_data' as const, artifact });
  } catch { return Object.freeze({ status: 'rejected', reason: 'artifact_mismatch' }); }
}
