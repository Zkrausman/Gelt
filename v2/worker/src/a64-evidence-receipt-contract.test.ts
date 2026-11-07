import { expect, it } from 'vitest';
import { canonical } from './ledger-canonical.js';
import {
  a64ReceiptBindingSchema, a64ReceiptDisclosure, a64ReceiptHash, a64ReceiptLimits,
  a64ReceiptSchema, parseA64Receipt,
} from './a64-evidence-receipt-contract.js';

const h = 'a'.repeat(64);
function value() {
  const body = {
    schema: 'gelt.a64-evidence-retention-receipt.v1',
    binding: { schema: 'gelt.a64-evidence-retention-binding.v1', ownerNamespaceSha256: h, caseEpochSha256: h },
    inputBytes: a64ReceiptLimits.input, rawInputSha256: h,
    assessmentSha256: h, artifactSha256: h, contextSha256: h,
    ...a64ReceiptDisclosure,
  };
  return { ...body, receiptSha256: a64ReceiptHash(body) };
}
it('keeps history, receipt sequence and no-effect disclosures distinct', () => {
  const receipt = value();
  expect(parseA64Receipt(canonical(receipt))).toEqual(receipt);
  expect(receipt).toMatchObject({ historyUpdates: 64, receiptSequence: 1, consumptionAttempts: 0, operationalDecisions: 0 });
  expect(a64ReceiptLimits).toMatchObject({ input: 262144, artifact: 180000, context: 8192, receipt: 8192, store: 8388608, records: 1 });
});
it('rejects classification, sequence, lineage and authority substitutions even with a recomputed hash', () => {
  for (const change of [{receiptSequence:64}, {operationalDecisions:1}, {consumptionAttempts:1}, {dispatchAllowed:true},
    {qualification:'READY'}, {previousReceiptSha256:h}, {classification:'constructed_offline_test'}, {authority:'pass'}, {inputBytes:262145}]) {
    const {receiptSha256, ...body} = {...value(), ...change};
    expect(a64ReceiptSchema.safeParse({...body,receiptSha256:a64ReceiptHash(body)}).success).toBe(false);
  }
});
it('rejects detached digest changes, malformed JSON, duplicate fields and oversized receipt text', () => {
  const v=value();
  for (const text of [canonical({...v,contextSha256:'b'.repeat(64)}), '{}', canonical(v).slice(0,-1),
    canonical(v).replace('"receiptSequence":1','"receiptSequence":1,"receiptSequence":1'), ' '.repeat(8193)]) {
    expect(()=>parseA64Receipt(text)).toThrow('A64 evidence retention unavailable');
  }
});
it('accepts only the bounded binding domain, never an authority object or raw owner identifier', () => {
  const b=value().binding;
  for (const change of [{ownerNamespaceSha256:'private-owner-id'}, {caseEpochSha256:h+'x'}, {schema:'gelt.pamr-consumption-owner-policy.v1'}, {admitted:true}]) {
    expect(a64ReceiptBindingSchema.safeParse({...b,...change}).success).toBe(false);
  }
});
