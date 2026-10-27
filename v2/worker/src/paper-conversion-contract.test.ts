import { expect, it } from 'vitest';
import { convertPAMR, verifyPAMRArtifact } from './pamr-reference-artifact.js';
import { pamrRecipe, parsePAMRRequest } from './paper-conversion-contract.js';
const input = () => ({ schema: 'gelt.pamr-constructed-request.v1', classification: 'constructed_offline_test',
  recipe: { ...pamrRecipe }, assets: ['SYNTH-A', 'SYNTH-B'], rows: [['1', '2']] });
const invalid: [string, (v: any) => void][] = [
  ['unknown keys', v => { v.callback = 'secret-path'; }], ['external identity', v => { v.assets[0] = 'SPY'; }],
  ['duplicate assets', v => { v.assets[1] = v.assets[0]; }], ['dimension', v => { v.rows[0].pop(); }],
  ['one asset', v => { v.assets.pop(); }], ['too many assets', v => { v.assets = Array(9).fill('SYNTH-A'); }],
  ['no rows', v => { v.rows = []; }], ['too many rows', v => { v.rows = Array(65).fill(['1', '2']); }],
  ['no zero relative', v => { v.rows[0][0] = '0.000'; }], ['negative', v => { v.rows[0][0] = '-1'; }],
  ['nonfinite', v => { v.rows[0][0] = 'NaN'; }], ['exponent', v => { v.rows[0][0] = '1e2'; }],
  ['number not decimal string', v => { v.rows[0][0] = 1; }], ['decimal length', v => { v.rows[0][0] = '1'.repeat(33); }],
  ['leading zero', v => { v.rows[0][0] = '01'; }], ['changed source pin', v => { v.recipe.referenceRunSha256 = 'a'.repeat(64); }],
  ['changed recipe', v => { v.recipe.algorithm = 'PAMR1'; }], ['nonzero costs', v => { v.recipe.transactionCost = '0.01'; }],
  ['caller weights', v => { v.weights = ['1/2', '1/2']; }], ['caller parent', v => { v.parentStateSha256 = '0'.repeat(64); }],
];
for (const [label, mutate] of invalid) it(`fails closed on ${label}`, () => {
  const v = input(); mutate(v);
  expect(convertPAMR(JSON.stringify(v))).toEqual({ status: 'rejected', reason: 'invalid_input' });
});
it('bounds text before parsing and rejects duplicate keys, structure and caller objects without coercion', () => {
  const dangerous = { toString() { throw new Error('secret'); } };
  for (const v of [dangerous, null, 12, ' '.repeat(32769), '{"a":1,"a":2}', '['.repeat(17) + '0' + ']'.repeat(17),
    JSON.stringify(input()).replace('"rows":', '"rows":[],"rows":')]) {
    expect(convertPAMR(v)).toEqual({ status: 'rejected', reason: 'invalid_input' });
  }
  expect(verifyPAMRArtifact(' '.repeat(2097153))).toEqual({ status: 'rejected', reason: 'artifact_mismatch' });
});
it('accepts explicit decimal scales and exactly32character tokens without coercing identity', () => {
  const v = input(); v.rows = [['0.' + '0'.repeat(29) + '1', '1']];
  expect(parsePAMRRequest(JSON.stringify(v)).rows).toEqual(v.rows);
  expect(convertPAMR(JSON.stringify(v)).status).toBe('computed');
});
