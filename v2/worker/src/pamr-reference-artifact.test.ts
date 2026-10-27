import { expect, it } from 'vitest';
import { convertPAMR, serializePAMRArtifact, verifyPAMRArtifact, type PAMRArtifact } from './pamr-reference-artifact.js';
import { pamrRecipe } from './paper-conversion-contract.js';
import { candidateShadowManifestSchema } from './candidate-shadow-contract.js';
import { canonical, digest } from './ledger-canonical.js';
const request = (rows: string[][], assets = rows[0].map((_, i) => `SYNTH-${String.fromCharCode(65 + i)}`)) => ({
  schema: 'gelt.pamr-constructed-request.v1', classification: 'constructed_offline_test', recipe: pamrRecipe, assets, rows,
});
function artifact(rows: string[][]): PAMRArtifact {
  const result = convertPAMR(JSON.stringify(request(rows)));
  if (result.status !== 'computed') throw new Error(result.reason);
  return result.artifact;
}
const number = (s: string) => { const [n, d] = s.split('/').map(Number); return n / d; };
// Independent exhaustive active-set KKT oracle (small constructed cases only),
// deliberately unlike production's sorted-prefix algorithm. Floating arithmetic
// here is a cross-check, not the production representation or tolerance policy.
function oracle(weights: number[], x: number[]): number[] {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const centered = x.map(v => v - mean), norm = centered.reduce((a, b) => a + b * b, 0);
  const loss = Math.max(0, weights.reduce((a, b, i) => a + b * x[i], 0) - 0.5);
  const v = weights.map((b, i) => b - (norm === 0 ? 0 : loss / norm) * centered[i]);
  for (let mask = 1; mask < 1 << v.length; mask++) {
    const indices = v.map((_, i) => i).filter(i => (mask & (1 << i)) !== 0);
    const t = (indices.reduce((a, i) => a + v[i], 0) - 1) / indices.length;
    if (v.every((a, i) => (mask & (1 << i)) ? a - t > -1e-12 : a - t <= 1e-12)) {
      return v.map(a => Math.max(0, a - t));
    }
  }
  throw new Error('no active set');
}
it('uses tau0 on first/later equal rows without an uninitialized or retained multiplier', () => {
  const a = artifact([['1', '1'], ['2', '1'], ['3', '3']]);
  expect(a.steps[0].tau).toBe('0/1'); expect(a.steps[0].weightsAfter).toEqual(['1/2', '1/2']);
  expect(a.steps[1].tau).toBe('2/1'); expect(a.steps[1].weightsAfter).toEqual(['0/1', '1/1']);
  expect(a.steps[2].tau).toBe('0/1'); expect(a.steps[2].weightsAfter).toEqual(['0/1', '1/1']);
});
it('has exact hand-derived zero loss, positive loss, boundary and fractional active-set answers', () => {
  expect(artifact([['0.1', '0.2']]).steps[0]).toMatchObject({ loss: '0/1', tau: '0/1', weightsAfter: ['1/2', '1/2'] });
  expect(artifact([['1', '3']]).weightsFinal).toEqual(['1/1', '0/1']);
  expect(artifact([['1', '2', '3']]).steps[0]).toMatchObject({ loss: '3/2', tau: '3/4', weightsAfter: ['7/8', '1/8', '0/1'] });
  expect(artifact([['0.5', '0.5']]).weightsFinal).toEqual(['1/2', '1/2']);
});
for (let dimension = 2; dimension <= 8; dimension++) {
  it(`matches independent active-set oracles, permutation and causal prefixes for ${dimension} assets`, () => {
    const rows = Array.from({ length: 12 }, (_, t) => Array.from({ length: dimension }, (_, j) => String((j * 3 + t * 5) % 7 + 1)));
    const a = artifact(rows);
    let weights = Array(dimension).fill(1 / dimension) as number[];
    for (const [i, row] of rows.entries()) {
      weights = oracle(weights, row.map(Number));
      a.steps[i].weightsAfter.forEach((s, j) => expect(number(s)).toBeCloseTo(weights[j], 10));
      expect(a.steps[i].weightsBefore).toEqual(i ? a.steps[i - 1].weightsAfter : Array(dimension).fill(`1/${dimension}`));
    }
    expect(artifact(rows.slice(0, 4)).steps).toEqual(a.steps.slice(0, 4));
    expect(artifact(rows.map(r => [...r].reverse())).weightsFinal).toEqual([...a.weightsFinal].reverse());
  });
}
it('accepts the finite row/asset domain and is deterministic, immutable, inert and isolated from G05', () => {
  const rows = Array.from({ length: 64 }, () => Array(8).fill('1'));
  const a = artifact(rows), b = artifact(rows);
  expect(a).toEqual(b); expect(Object.isFrozen(a.input.rows[0])).toBe(true);
  expect(() => { (a.weightsFinal as string[])[0] = '0/1'; }).toThrow();
  const text = serializePAMRArtifact(a), verified = verifyPAMRArtifact(text);
  expect(verified.status).toBe('verified_data');
  if (verified.status === 'verified_data') expect(serializePAMRArtifact(verified.artifact)).toBe(text);
  expect(a).toMatchObject({ authentication: 'not_established', effectScope: 'NONE', dispatchAllowed: false,
    promotionAllowed: false, production: 'CLOSED', operations: 'DEFER', referenceExecution: 'not_performed' });
  expect(candidateShadowManifestSchema.safeParse(a).success).toBe(false);
  expect(() => serializePAMRArtifact(JSON.parse(text))).toThrow('unrecognized');
});
const tamper: [string, (v: any) => void][] = [
  ['source', v => { v.recipe.reference = 'forged'; }],
  ['parameter', v => { v.input.recipe.epsilon = '0.6'; }],
  ['input', v => { v.input.rows[0][0] = '4'; }],
  ['state reset', v => { v.steps[1].parentStateSha256 = '0'.repeat(64); }],
  ['duplicate step', v => { v.steps[1] = v.steps[0]; }],
  ['step order', v => { v.steps.reverse(); }],
  ['missing step', v => { v.steps.pop(); }],
  ['future weights', v => { v.steps[0].weightsAfter = v.steps[1].weightsAfter; }],
  ['output', v => { v.weightsFinal = ['1/2', '1/2']; }],
  ['promotion', v => { v.dispatchAllowed = true; }],
  ['unknown property', v => { v.admitted = true; }],
  ['state hash', v => { v.steps[0].stateSha256 = digest(canonical(v.input)); }],
];
for (const [label, change] of tamper) it(`rejects ${label} tampering on reopen without granting authority`, () => {
  const a = JSON.parse(serializePAMRArtifact(artifact([['2', '1'], ['1', '3']])));
  change(a); expect(verifyPAMRArtifact(JSON.stringify(a))).toEqual({ status: 'rejected', reason: 'artifact_mismatch' });
});
it('rejects actual intermediate growth at finite resource bounds without exposing input', () => {
  const base = ['0.1', '0.2', '0.3', '0.4', '0.6', '0.7', '0.8', '0.90000000000000000000000000001'];
  const rows = Array.from({ length: 64 }, (_, i) => base.map((_, j) => base[(j + i) % 8]));
  const result = convertPAMR(JSON.stringify(request(rows)));
  expect(result.status).toBe('rejected');
  if (result.status === 'rejected') expect(result.reason).toBe('resource_limit');
});
