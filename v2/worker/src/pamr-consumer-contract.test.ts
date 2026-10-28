import { expect, it } from 'vitest';
import { parsePAMRConsumerText, pamrConsumerLimits, pamrConsumerActionSchema } from './pamr-consumer-contract.js';
import { quarterFloorPAMRWeight } from './pamr-consumer-adapter.js';
it('requires primitive source text without traversing caller objects', () => {
  for (const raw of [null, {}, [], Buffer.from('{}'), () => '{}']) expect(() => parsePAMRConsumerText(raw, 'input')).toThrow();
});
it('rejects duplicate decoded keys and malformed JSON before schema decoding', () => {
  const malformed = ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[1,]', '1 true', '{"x":NaN}'];
  for (const text of malformed) expect(() => parsePAMRConsumerText(text, 'input')).toThrow();
});
it('enforces structural, character and UTF-8 byte limits', () => {
  expect(() => parsePAMRConsumerText('['.repeat(18) + '0' + ']'.repeat(18), 'input')).toThrow();
  expect(() => parsePAMRConsumerText(JSON.stringify(Array(20001).fill(0)), 'input')).toThrow();
  expect(() => parsePAMRConsumerText(JSON.stringify('é'.repeat(pamrConsumerLimits.input / 2)), 'input')).toThrow();
  expect(() => parsePAMRConsumerText(' '.repeat(pamrConsumerLimits.input + 1), 'input')).toThrow();
});
it('has exact independent quarter-floor hand answers', () => {
  expect(quarterFloorPAMRWeight('0/1').value).toBe('0.000000000000000000');
  expect(quarterFloorPAMRWeight('1/1').value).toBe('0.250000000000000000');
  expect(quarterFloorPAMRWeight('1/2').value).toBe('0.125000000000000000');
  expect(quarterFloorPAMRWeight('1/3').value).toBe('0.083333333333333333');
  expect(quarterFloorPAMRWeight('2/3').value).toBe('0.166666666666666666');
});
it('rejects malformed, out-of-simplex and excessive rationals', () => {
  for (const weight of ['-1/2', '1/0', '01/2', '1/2\n', '2/1', {}, '1e3/2']) expect(() => quarterFloorPAMRWeight(weight)).toThrow();
  expect(() => quarterFloorPAMRWeight(`${'9'.repeat(1235)}/1`)).toThrow();
});
it('rejects contradictory action payloads', () => {
  expect(pamrConsumerActionSchema.safeParse({ outcome: 'proposal', reason: 'buy_proposal', attainment: 'cash_exit', side: 'buy', quantity: null, hypothetical: null }).success).toBe(false);
  expect(pamrConsumerActionSchema.safeParse({ outcome: 'no_action', reason: 'buy_proposal', attainment: 'no_action', side: null, quantity: null, hypothetical: null }).success).toBe(false);
  expect(pamrConsumerActionSchema.safeParse({ outcome: 'abstain', reason: 'decision_abstain', attainment: 'not_applicable', side: null, quantity: null, hypothetical: null }).success).toBe(true);
});
it('rejects invalid limit selectors instead of bypassing the public resource bound', () => {
  for (const kind of ['unknown', '__proto__', 'toString', undefined]) {
    expect(() => parsePAMRConsumerText('{}', kind as never)).toThrow();
  }
  let coerced = false;
  const kind = { toString() { coerced = true; return 'input'; } };
  expect(() => parsePAMRConsumerText('{}', kind as never)).toThrow();
  expect(coerced).toBe(false);
});
