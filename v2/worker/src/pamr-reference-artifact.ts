import { canonical, digest } from './ledger-canonical.js';
import { pamrRecipe, pamrArtifactLimit, pamrRequestLimit, pamrRequestSchema,
  parsePAMRJSON, parsePAMRRequest, type PAMRRequest } from './paper-conversion-contract.js';
import { parseSpy253PAMRInspectionRequest, spy253InspectionCloseSchema,
  spy253PAMRInspectionLimit, type Spy253PAMRInspectionRequest } from './paper-conversion-contract.js';

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
type MathInput = { assets: readonly string[]; rows: readonly (readonly string[])[] };
// Private choice only. Neither textual public entry accepts a hash-domain switch.
function trace(input: MathInput, identity: unknown, bind: typeof hash) {
  const sourceSha256 = bind('gelt.pamr.source.v1', pamrRecipe);
  const parametersSha256 = bind('gelt.pamr.parameters.v1', { epsilon: '0.5', transactionCost: '0', assets: input.assets });
  const inputSha256 = bind('gelt.pamr.input.v1', identity);
  let weights = input.assets.map(() => q(1n, BigInt(input.assets.length)));
  let parent = bind('gelt.pamr.genesis.v1', { sourceSha256, parametersSha256, weights: weights.map(render) });
  const steps: PAMRStep[] = [];
  for (let i = 0; i < input.rows.length; i++) {
    const x = input.rows[i].map(decimal), before = weights.map(render);
    const mean = div(total(x), q(BigInt(x.length))), centered = x.map(v => sub(v, mean));
    const dot = total(weights.map((v, j) => mul(v, x[j])));
    const rawLoss = sub(dot, q(1n, 2n)), loss = compare(rawLoss, zero) > 0 ? rawLoss : zero;
    const norm = total(centered.map(v => mul(v, v)));
    const tau = norm.n === 0n ? zero : div(loss, norm);
    weights = project(weights.map((v, j) => sub(v, mul(tau, centered[j]))));
    const rowSha256 = bind('gelt.pamr.row.v1', { ordinal: i + 1, assets: input.assets, row: input.rows[i] });
    const facts = { ordinal: i + 1, rowSha256, parentStateSha256: parent,
      weightsBefore: before, loss: render(loss), tau: render(tau), weightsAfter: weights.map(render) };
    parent = bind('gelt.pamr.state.v1', { sourceSha256, parametersSha256, ...facts });
    steps.push({ ...facts, stateSha256: parent });
  }
  const weightsFinal = weights.map(render);
  const outputSha256 = bind('gelt.pamr.output.v1', { inputSha256, stateSha256: parent, weightsFinal });
  return { sourceSha256, parametersSha256, inputSha256, steps, weightsFinal, outputSha256 };
}
function compute(input: PAMRRequest) {
  const { sourceSha256, parametersSha256, inputSha256, steps, weightsFinal, outputSha256 } = trace(input, input, hash);
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

const inspectionHash = (domain: string, value: unknown) => hash('gelt.spy253-pamr-inspection.v1/' + domain, value);
type InspectionLineage = Spy253PAMRInspectionRequest['lineage'];
// A compact binding to every original field, including every ordered raw-page
// identity and all 253 exact observations. Raw bodies never enter this value.
export function spy253InspectionOriginalSha256(l: Omit<InspectionLineage, 'originalSha256'>): string {
  return inspectionHash('original', {
    schema: 'gelt.alpaca-iex-acquisition.v1', source: 'alpaca-data-v2', feed: 'iex',
    symbol: 'SPY', adjustment: 'all', asof: '2026-10-27', receivedAt: l.receivedAt,
    calendarSha256: l.calendarSha256, request: l.request, pages: l.pages,
    allObservationsSha256: l.allObservationsSha256,
  });
}
// Original connector decimals have <=38 digits and <=18 fractional digits.
// Reduction occurs before decimal expansion. At most 30 decimal places can
// fit a positive ordinary decimal in the existing 32-character token domain.
export function exactSpy253CloseRatio(laterInput: unknown, earlierInput: unknown): string {
  const later = spy253InspectionCloseSchema.parse(laterInput);
  const earlier = spy253InspectionCloseSchema.parse(earlierInput);
  const ratio = div(decimal(later.value), decimal(earlier.value));
  let denominator = ratio.d, twos = 0, fives = 0;
  while (denominator % 2n === 0n) { denominator /= 2n; if (++twos > 30) throw new Error('unrepresentable ratio'); }
  while (denominator % 5n === 0n) { denominator /= 5n; if (++fives > 30) throw new Error('unrepresentable ratio'); }
  if (denominator !== 1n) throw new Error('unrepresentable ratio');
  const scale = Math.max(twos, fives);
  let coefficient = ratio.n;
  for (let i = twos; i < scale; i++) coefficient = product(coefficient, 2n);
  for (let i = fives; i < scale; i++) coefficient = product(coefficient, 5n);
  let digits = coefficient.toString();
  if (scale) {
    digits = digits.padStart(scale + 1, '0');
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
  }
  if (digits.length > 32 || !/[1-9]/.test(digits)) throw new Error('unrepresentable ratio');
  return digits;
}
function inspectionArtifact(input: Spy253PAMRInspectionRequest) {
  const { originalSha256, ...identity } = input.lineage;
  if (originalSha256 !== spy253InspectionOriginalSha256(identity)) throw new Error();
  const pairs = input.rows.map((row, i) => {
    const earlier = input.selected[i], later = input.selected[i + 1];
    const relative = exactSpy253CloseRatio(later.close, earlier.close);
    if (row[0] !== relative) throw new Error();
    return {
      ordinal: i + 1, earlierSourceIndex: earlier.sourceIndex, laterSourceIndex: later.sourceIndex,
      earlierObservationSha256: inspectionHash('selected-observation', earlier),
      laterObservationSha256: inspectionHash('selected-observation', later), relative,
    };
  });
  const math = trace(input, input, inspectionHash);
  const artifact = {
    schema: 'gelt.spy253-pamr-inert-inspection.v1', version: 1,
    classification: 'source_inspection_only', request: input, recipe: pamrRecipe,
    ...math, pairs,
    updates: 64, operationalDecisions: 0, consumptionAttempts: 0,
    fidelity: 'selected_64_intervals_only_not_full_252_history',
    initialization: 'equal_weights_at_selected_history_start',
    reserveConvention: 'declared_mathematical_unit_relative_1_not_cash_return_evidence',
    selectionBasis: 'structural_declaration_compatibility_only',
    actualEligibility: 'not_established', actualCalendarCompletion: 'unknown',
    actualAvailability: 'unknown', historicalDecisionAvailability: 'not_established',
    providerCompletion: 'unknown', providerRevisionCoherence: 'unknown',
    reviewerAdmission: 'not_established', handling: 'not_established',
    causalAvailability: 'unknown', uncertainty: 'latched',
    lineageAuthentication: 'not_established_by_serialized_data',
    fullOriginalReconstruction: 'unavailable_from_digests',
    digestMeaning: 'bindings_not_authenticity',
    rawPages: 'not_included', referenceExecution: 'not_performed',
    authentication: 'not_established', effectScope: 'NONE', dispatchAllowed: false,
    promotionAllowed: false, production: 'CLOSED', operations: 'DEFER',
  } as const;
  const text = canonical(artifact);
  if (Buffer.byteLength(text, 'utf8') > spy253PAMRInspectionLimit) throw new Limit();
  // Generated output must also remain within the existing parser work domain.
  parsePAMRJSON(text, 'artifact');
  return freeze(artifact);
}
export type Spy253PAMRInspectionArtifact = ReturnType<typeof inspectionArtifact>;
// Pure DATA replay only. This entry cannot establish connector issuance,
// reservation, completion lineage, operational eligibility or effect rights.
export function replaySpy253PAMRInspectionRequest(text: unknown) {
  try {
    const input = parseSpy253PAMRInspectionRequest(text);
    return freeze({ status: 'computed_data' as const, artifact: inspectionArtifact(input) });
  } catch (error) {
    return Object.freeze({ status: 'rejected' as const, reason: error instanceof Limit ? 'resource_limit' as const : 'invalid_input' as const });
  }
}
export function verifySpy253PAMRInspectionData(text: unknown) {
  try {
    if (typeof text !== 'string' || text.length > spy253PAMRInspectionLimit || Buffer.byteLength(text, 'utf8') > spy253PAMRInspectionLimit) throw new Error();
    const value = parsePAMRJSON(text, 'artifact');
    if (!value || typeof value !== 'object' || !('request' in value)) throw new Error();
    const result = replaySpy253PAMRInspectionRequest(canonical(value.request));
    if (result.status !== 'computed_data' || canonical(value) !== canonical(result.artifact)) throw new Error();
    return freeze({ status: 'verified_data' as const, artifact: result.artifact });
  } catch {
    return Object.freeze({ status: 'rejected' as const, reason: 'artifact_mismatch' as const });
  }
}
