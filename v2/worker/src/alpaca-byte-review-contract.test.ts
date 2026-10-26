import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { alpacaSessionCalendarDigest } from './alpaca-iex-contract.js';
import {
  bindingComparisonDigest,
  checkFailureReasons,
  checkIds,
  comparisonDecodeByteLimit,
  comparisonDigestDomains,
  connectorPin,
  decodePrivateComparison,
  encodeBindingComparison,
  encodeEvidenceComparison,
  encodePrivateComparison,
  encodeSettlementComparison,
  encodeStatusComparison,
  encodeSummaryAckComparison,
  encodeVerdictComparison,
  evidenceComparisonDigest,
  formatComparisonNumber,
  outcomePrecedence,
  parseBindingStructure,
  parseEvidenceStructure,
  parseInvocationStructure,
  parseJsonValueStructure,
  parseRevisionTupleStructure,
  parseSettlementStructure,
  parseSourceStructure,
  parseStatusStructure,
  parseSummaryAckStructure,
  parseVerdictStructure,
  reviewAuthority,
  reviewLimits,
  snapshotCommit,
  unknownReasons,
  verdictComparisonDigest,
} from './alpaca-byte-review-contract.js';

const attemptId = '00000000-0000-4000-8000-000000000001';
const invocationId = '00000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const at = '2026-01-02T00:00:00.000Z';

function revisions() {
  return {
    contract: 1,
    consumer: '1.1',
    sourceClosure: 'fixture.source',
    request: 'fixture.request',
    policy: 'fixture.policy',
    calendar: 'fixture.calendar',
    availability: 'fixture.availability',
    candidate: 'fixture.candidate',
    reviewer: 'fixture.reviewer',
    verdictPolicy: 'fixture.verdict',
  };
}

function receipt() {
  return {
    schema: 'gelt.shadow-rule-receipt.v1',
    ruleId: 'gelt-long-cash-sign-return-252.v1',
    decisionId: 'shadow-decision-' + hash,
    runId: attemptId,
    sourceCommit: 'b'.repeat(40),
    decisionAt: at,
    inputSha256: hash,
    inputDigestKind: 'canonical_validated_input',
    inputValidation: 'valid',
    classification: 'market_shadow_input',
    decision: 'abstain',
    reason: 'unverified_data',
    targetExposure: null,
    evidence: {
      datasetSha256: hash,
      costsSha256: hash,
      controlsSha256: hash,
      portfolioSha256: hash,
    },
    scope: 'paper-derived-rule-adaptation',
    sourceAndProvenance: 'caller_assertions_not_independently_verified',
    marketEvaluation: 'not_established',
    effectAuthority: 'none',
    promotionAllowed: false,
  };
}

function evidence() {
  const sessions = [{
    providerTimestamp: at,
    sessionOrdinal: 0,
    closedAt: at,
    completedAt: at,
    completed: true as const,
    completionEvidenceSha256: hash,
  }];
  const calendar = {
    symbol: 'TEST',
    sessions,
    sha256: alpacaSessionCalendarDigest({ symbol: 'TEST', sessions }),
  };
  return {
    calendar,
    availability: [{
      providerTimestamp: at,
      availableAt: at,
      evidenceSha256: hash,
    }],
    context: {
      runId: attemptId,
      sourceCommit: 'b'.repeat(40),
      expectedCalendarSha256: calendar.sha256,
      expectedWindow: {
        firstSessionOrdinal: 0,
        lastSessionOrdinal: 0,
        observationCount: 1,
      },
      rightsEvidenceSha256: hash,
      policy: {
        scheduleSha256: hash,
        maxAgeMs: 0,
        exposureCap: { value: '1', precision: 1, scale: 0 },
      },
      costs: {
        status: 'unverified',
        evidenceSha256: hash,
        stressScenarioSha256: hash,
        commissionPerTrade: { value: '0', precision: 1, scale: 0 },
        spreadFraction: { value: '0', precision: 1, scale: 0 },
        slippageFraction: { value: '0', precision: 1, scale: 0 },
      },
      controls: { passiveSha256: hash, cashAssumptionSha256: hash },
      portfolio: { state: 'unknown', snapshotSha256: hash },
    },
    candidateCanonicalInput: '{}',
    candidateReceipt: receipt(),
    candidateManifest: { fixture: true } as unknown,
  };
}

function binding() {
  return {
    schema: 'gelt.review-before-discard-binding.v1',
    attemptId,
    revisions: revisions(),
    source: {
      repositoryId: 1415613140,
      snapshotCommit,
      connectorPin: { ...connectorPin },
      runtimeClosureRevision: 'fixture.runtime',
    },
    request: {
      symbol: 'TEST',
      feed: 'iex',
      adjustment: 'raw',
      start: at,
      end: at,
      asof: '2026-01-02',
      timeframe: '1Day',
      currency: 'USD',
      sort: 'desc',
      pageRequests: [{ page: 1, limit: 1, pageTokenSha256: null }],
    },
    receipt: { receivedAt: at, decisionAt: at },
    pages: [{ page: 1, byteLength: 1, sha256: hash }],
    evidence: evidence(),
    limits: { ...reviewLimits },
    authority: { ...reviewAuthority },
  };
}

function verdict() {
  return {
    schema: 'gelt.review-before-discard-verdict.v1',
    attemptId,
    invocationId,
    revisions: revisions(),
    reviewerRevision: 'fixture.reviewer',
    authorityId: 'fixture.authority',
    bindingSha256: hash,
    completedAt: at,
    elapsedMs: 0,
    outcome: 'consistent_unverified',
    checks: checkIds.map(id => ({ id, result: 'pass', reason: 'none' })),
  };
}

function settlement() {
  return {
    schema: 'gelt.byte-review-settlement.v2',
    attemptId,
    invocationId: null as string | null,
    phase: 'preflight',
    outcome: 'not_attempted',
    review: 'not_attempted',
    execution: 'not_started',
    disposal: 'not_established',
    summaryDelivery: 'not_attempted',
    uncertainty: 'none',
  };
}

function favorableSettlement() {
  return {
    ...settlement(),
    invocationId,
    phase: 'summary',
    outcome: 'consistent_unverified',
    review: 'consistent_unverified',
    execution: 'settled',
    disposal: 'references_released',
    summaryDelivery: 'not_established',
  };
}

function status() {
  return {
    schema: 'gelt.byte-review-status.v2',
    attemptId,
    phase: 'summary',
    outcome: 'consistent_unverified',
    review: 'consistent_unverified',
    execution: 'settled',
    disposal: 'references_released',
    summaryDelivery: 'not_established',
    decision: 'abstain',
    reason: 'unverified_data',
    eligibility: 'unverified',
    effectAuthority: 'none',
    promotionAllowed: false,
    retryAllowed: false,
  };
}

function fromBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

/**
 * Independent bounded exhaustive oracle for the small-value cases below.
 * Candidate rounding uses the host decimal parser, not production intervals.
 * A winning unsigned length <=4 permits at most four coefficient digits.
 * For these magnitudes, all feasible exponents lie inside [-8, 8].
 */
function boundedOracle(value: number): string {
  const candidates: { text: string; form: number }[] = [];
  const magnitude = Math.abs(value);
  for (let coefficient = 1; coefficient <= 9999; coefficient++) {
    if (coefficient % 10 === 0) continue;
    const digits = String(coefficient);
    for (let exponent = -8; exponent <= 8; exponent++) {
      if (Number(`${coefficient}e${exponent}`) !== magnitude) continue;
      const point = digits.length + exponent;
      let fixed: string;
      if (point <= 0) fixed = '0.' + '0'.repeat(-point) + digits;
      else if (point >= digits.length) fixed = digits.padEnd(point, '0');
      else fixed = digits.slice(0, point) + '.' + digits.slice(point);
      const scientific = digits[0]
        + (digits.length > 1 ? '.' + digits.slice(1) : '')
        + 'e' + String(exponent + digits.length - 1);
      candidates.push({ text: fixed, form: 0 }, { text: scientific, form: 1 });
    }
  }
  candidates.sort((a, b) => a.text.length - b.text.length
    || a.form - b.form || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates[0].text.length).toBeLessThanOrEqual(4);
  return (value < 0 ? '-' : '') + candidates[0].text;
}

/** Independent exact terminating-decimal construction for dyadic test inputs. */
function dyadicDecimal(numerator: bigint, denominatorPower: number): string {
  const digits = (numerator * 5n ** BigInt(denominatorPower)).toString();
  if (denominatorPower === 0) return digits;
  if (digits.length <= denominatorPower) {
    return '0.' + '0'.repeat(denominatorPower - digits.length) + digits;
  }
  return digits.slice(0, -denominatorPower) + '.' + digits.slice(-denominatorPower);
}

describe('exact comparison number selection', () => {
  it.each([
    [0, '0'],
    [100, '100'],
    [1000, '1e3'],
    [0.01, '0.01'],
    [0.001, '1e-3'],
    [-100, '-100'],
    [1, '1'],
    [-1, '-1'],
    [10, '10'],
    [1.25, '1.25'],
    [Number.MIN_VALUE, '3e-324'],
    [-Number.MIN_VALUE, '-3e-324'],
    [Number.MAX_VALUE, '1.7976931348623157e308'],
  ] as const)('formats %s as %s', (value, expected) => {
    expect(formatComparisonNumber(value)).toBe(expected);
    expect(Number(expected)).toBe(value);
  });

  it.each([-0, NaN, Infinity, -Infinity])('rejects %s', value => {
    expect(() => formatComparisonNumber(value)).toThrow();
  });

  it('selects a wider fixed coefficient from the exact odd-significand interval', () => {
    const value = 1e18 + 128;
    expect(BigInt(value)).toBe(1000000000000000128n);
    // Its spacing is 128 and its significand is odd, so endpoints exclude.
    expect(Number('1000000000000000064')).toBe(1e18);
    expect(Number('1000000000000000065')).toBe(value);
    expect(Number('1000000000000000191')).toBe(value);
    expect(Number('1000000000000000192')).toBe(1e18 + 256);
    expect(formatComparisonNumber(value)).toBe('1000000000000000065');
    expect(formatComparisonNumber(-value)).toBe('-1000000000000000065');
  });

  it.each([100, 1000, 0.01, 0.001, 1.25, -100, -0.01])(
    'agrees with the independent bounded global-order oracle for %s',
    value => {
      expect(formatComparisonNumber(value)).toBe(boundedOracle(value));
    },
  );

  it('handles subnormal ties to even and the normal/subnormal boundary', () => {
    const halfMinimum = dyadicDecimal(1n, 1075);
    const threeHalvesMinimum = dyadicDecimal(3n, 1075);
    expect(Number(halfMinimum)).toBe(0);
    expect(Number(threeHalvesMinimum)).toBe(fromBits(2n));

    const lastSubnormal = fromBits(0x000fffffffffffffn);
    const firstNormal = fromBits(0x0010000000000000n);
    const boundaryMidpoint = dyadicDecimal((1n << 53n) - 1n, 1075);
    expect(Number(boundaryMidpoint)).toBe(firstNormal);
    for (const value of [lastSubnormal, firstNormal, fromBits(0x0010000000000001n)]) {
      expect(bitsOf(Number(formatComparisonNumber(value)))).toBe(bitsOf(value));
    }
  });

  it('handles adjacent midpoint ownership around one', () => {
    const one = 0x3ff0000000000000n;
    // Midpoint of 1 and its successor is 1 + 2^-53; one is even.
    const midpoint = dyadicDecimal((1n << 53n) + 1n, 53);
    expect(bitsOf(Number(midpoint))).toBe(one);
    // The next midpoint belongs to the even second successor.
    const nextMidpoint = dyadicDecimal((1n << 53n) + 3n, 53);
    expect(bitsOf(Number(nextMidpoint))).toBe(one + 2n);
    for (let offset = -2n; offset <= 3n; offset++) {
      const value = fromBits(one + offset);
      expect(bitsOf(Number(formatComparisonNumber(value)))).toBe(one + offset);
    }
  });

  it('excludes the exact overflow threshold', () => {
    const threshold = (1n << 1024n) - (1n << 970n);
    expect(Number(threshold.toString())).toBe(Infinity);
    expect(Number((threshold - 1n).toString())).toBe(Number.MAX_VALUE);
    expect(Number(formatComparisonNumber(Number.MAX_VALUE))).toBe(Number.MAX_VALUE);
  });

  it('roundtrips powers of ten, adjacent values and both signs', () => {
    for (const exponent of [-323, -308, -100, -6, -3, -2, 0, 2, 3, 18, 100, 308]) {
      const power = Number(`1e${exponent}`);
      const bits = bitsOf(power);
      for (const offset of [-1n, 0n, 1n]) {
        const value = fromBits(bits + offset);
        if (value === 0 || !Number.isFinite(value)) continue;
        for (const sign of [1, -1]) {
          const signed = value * sign;
          const text = formatComparisonNumber(signed);
          expect(bitsOf(Number(text))).toBe(bitsOf(signed));
          expect(text).not.toMatch(/E|e\+|e-?0\d/);
        }
      }
    }
  });

  it('roundtrips deterministic binary64 bit patterns without a precision assumption', () => {
    let state = 0x243f6a8885a308d3n;
    const mask = (1n << 64n) - 1n;
    for (let i = 0; i < 128; i++) {
      state = (state * 6364136223846793005n + 1442695040888963407n) & mask;
      const value = fromBits(state);
      if (!Number.isFinite(value) || Object.is(value, -0)) continue;
      const encoded = formatComparisonNumber(value);
      expect(bitsOf(Number(encoded))).toBe(bitsOf(value));
      expect(formatComparisonNumber(Number(encoded))).toBe(encoded);
    }
  });
});

describe('strict ordinary data trees and comparison bytes', () => {
  it('orders keys by Unicode scalar sequence, including proper prefixes', () => {
    const input = Object.create(null) as Record<string, unknown>;
    input['\u{10000}'] = 1;
    input['\ue000'] = 2;
    input.aa = 3;
    input.a = 4;
    expect(encodePrivateComparison(input))
      .toBe('{"a":4,"aa":3,"\ue000":2,"\u{10000}":1}');
  });

  it('uses only the required escapes', () => {
    expect(encodePrivateComparison('\0\n\t"\\/\u007f\u2028\u{1f600}'))
      .toBe('"\\u0000\\u000a\\u0009\\"\\\\/\u007f\u2028\u{1f600}"');
  });

  it('owns and freezes snapshots including null-prototype objects', () => {
    const source = { a: [{ b: 1 }] };
    const owned = parseJsonValueStructure(source) as { a: readonly { b: number }[] };
    source.a[0].b = 2;
    expect(owned.a[0].b).toBe(1);
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.a)).toBe(true);
    expect(Object.isFrozen(owned.a[0])).toBe(true);
    expect(Object.getPrototypeOf(owned)).toBe(null);
  });

  it('rejects unsupported values without evaluating ordinary getters', () => {
    let calls = 0;
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() { calls++; return 1; },
    });
    const hidden = Object.defineProperty({}, 'value', {
      enumerable: false,
      value: 1,
    });
    const inherited = Object.create({ inherited: 1 });
    const symbol = { [Symbol('key')]: 1 };
    const sparse = new Array(2);
    const extended = [1] as number[] & { extra?: number };
    extended.extra = 2;
    const alias = {};
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const input of [
      undefined, () => 1, 1n, Symbol('value'), NaN, Infinity, -0,
      accessor, hidden, inherited, symbol, sparse, extended,
      new Date(0), new Uint8Array(1), { a: alias, b: alias }, cycle,
      '\ud800', '\udfff', { ['\ud800']: 1 },
    ]) {
      expect(() => parseJsonValueStructure(input)).toThrow();
    }
    expect(calls).toBe(0);
  });

  it('uses Unicode scalar counts and enforces generic string/key bounds', () => {
    expect(() => parseJsonValueStructure('\u{1f600}'.repeat(4096))).not.toThrow();
    expect(() => parseJsonValueStructure('\u{1f600}'.repeat(4097))).toThrow();
    expect(() => parseJsonValueStructure({ ['x'.repeat(4097)]: 1 })).toThrow();
    expect(() => parseJsonValueStructure(Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [String(i), i]),
    ))).not.toThrow();
    expect(() => parseJsonValueStructure(Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [String(i), i]),
    ))).toThrow();
    expect(() => parseJsonValueStructure(Array(253).fill(null))).not.toThrow();
    expect(() => parseJsonValueStructure(Array(254).fill(null))).toThrow();
  });

  it('enforces depth and visited-value bounds at their boundaries', () => {
    let depth12: unknown = null;
    for (let i = 0; i < 12; i++) depth12 = [depth12];
    expect(() => parseJsonValueStructure(depth12)).not.toThrow();
    expect(() => parseJsonValueStructure([depth12])).toThrow();

    // Root + 20 arrays + 4979 scalar leaves = 5000 visited values.
    const exact = Array.from({ length: 20 }, (_, i) =>
      Array(i === 0 ? 248 : 249).fill(null));
    expect(() => parseJsonValueStructure(exact)).not.toThrow();
    exact[0].push(null);
    expect(() => parseJsonValueStructure(exact)).toThrow();
  });

  it('accepts canonical bytes and rejects alternate numeric/string/member spellings', () => {
    const canonical = '{"a":[100,1e3,0.01,1e-3],"b":"\\u000a"}';
    expect(encodePrivateComparison(decodePrivateComparison(Buffer.from(canonical))))
      .toBe(canonical);
    for (const text of [
      '1e2', '100.0', '-0', '5e-324', '1e+3', '1E3',
      ' 100', '100\n', '{"a":1,"a":1}', '{"b":1,"a":2}',
      '"\\n"', '"\\u0061"', '"\\ud800"', '\ufeff100', '1e9999',
    ]) {
      expect(() => decodePrivateComparison(Buffer.from(text))).toThrow();
    }
    expect(() => decodePrivateComparison(Uint8Array.of(0xc0, 0xaf))).toThrow();
  });
});

describe('bounded private comparison decoding', () => {
  const decode = (text: string) => decodePrivateComparison(Buffer.from(text, 'utf8'));

  it('derives its ceiling from the entire generic domain', () => {
    expect(comparisonDecodeByteLimit).toBe(5000 * (2 * (6 * 4096 + 2) + 4));
    expect(comparisonDecodeByteLimit).toBe(245800000);
    // The decoder is not restricted to the smaller evidence/binding envelopes.
    const input = Array.from({ length: 65 }, () => 'x'.repeat(4096));
    const text = encodePrivateComparison(input);
    expect(Buffer.byteLength(text)).toBeGreaterThan(262144);
    expect(encodePrivateComparison(decode(text))).toBe(text);
  });

  it('rejects an over-ceiling intrinsic length before copying or decoding', () => {
    // Controlled length instrumentation exercises the actual gate without
    // allocating a 245 MB stress fixture. This is not a Proxy safety test.
    const input = Uint8Array.of(0x30);
    const prototype = Object.getPrototypeOf(Uint8Array.prototype) as {
      readonly byteLength: number;
    };
    const length = vi.spyOn(prototype, 'byteLength', 'get')
      .mockReturnValue(comparisonDecodeByteLimit + 1);
    const copy = vi.spyOn(Buffer, 'copyBytesFrom');
    const decoder = vi.spyOn(TextDecoder.prototype, 'decode');
    try {
      expect(() => decodePrivateComparison(input))
        .toThrow('Invalid byte-review structure');
      expect(copy).not.toHaveBeenCalled();
      expect(decoder).not.toHaveBeenCalled();
    } finally {
      decoder.mockRestore();
      copy.mockRestore();
      length.mockRestore();
    }
  });

  it('uses intrinsic view length rather than a shadowing property', () => {
    const input = Uint8Array.of(0x30);
    let calls = 0;
    Object.defineProperty(input, 'byteLength', {
      get() { calls++; return comparisonDecodeByteLimit + 1; },
    });
    expect(decodePrivateComparison(input)).toBe(0);
    expect(calls).toBe(0);
  });

  it('copies the actual view extent rather than a shadowing length value', () => {
    const input = Uint8Array.of(0x30);
    Object.defineProperty(input, 'length', { value: 16 });
    expect(decodePrivateComparison(input)).toBe(0);
  });

  it('copies only the selected subview, excluding surrounding bytes', () => {
    const backing = Uint8Array.of(0x21, 0x30, 0x21);
    expect(decodePrivateComparison(backing.subarray(1, 2))).toBe(0);
  });

  it.each([
    'length', 'byteLength', 'byteOffset', 'buffer', 'constructor',
    Symbol.iterator, 'valueOf',
  ])('does not consult caller metadata %s during the bounded copy', key => {
    const input = Uint8Array.of(0x30);
    let calls = 0;
    Object.defineProperty(input, key, {
      get() { calls++; throw new Error('CONSTRUCTED_METADATA'); },
    });
    expect(decodePrivateComparison(input)).toBe(0);
    expect(calls).toBe(0);
  });

  it('accepts all generic structural boundaries through the decoder', () => {
    let depth: unknown = null;
    for (let i = 0; i < 12; i++) depth = [depth];
    const values = [
      depth,
      Array(253).fill(null),
      Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, null])),
      '\0'.repeat(4096),
      '\u{1f600}'.repeat(4096),
      { ['\u{1f600}'.repeat(4096)]: null },
      Array.from({ length: 20 }, (_, i) => Array(i === 0 ? 248 : 249).fill(null)),
    ];
    for (const value of values) {
      const text = encodePrivateComparison(value);
      expect(encodePrivateComparison(decode(text))).toBe(text);
    }
  });

  it('rejects excessive depth, nodes, members, elements and string scalars', () => {
    const nodes = Array.from({ length: 20 }, () => Array(249).fill(null));
    const texts = [
      '['.repeat(13) + 'null' + ']'.repeat(13),
      JSON.stringify(nodes),
      JSON.stringify(Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`k${i}`, null]),
      )),
      JSON.stringify(Array(254).fill(null)),
      JSON.stringify('x'.repeat(4097)),
      JSON.stringify('\u{1f600}'.repeat(4097)),
      JSON.stringify({ ['x'.repeat(4097)]: null }),
      '"' + '\\u0000'.repeat(4097) + '"',
    ];
    for (const text of texts) {
      expect(() => decode(text)).toThrow('Invalid byte-review structure');
    }
  });

  it('rejects excessive structure before whole-tree materialization', () => {
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(() => decode('['.repeat(13) + 'null' + ']'.repeat(13))).toThrow();
      expect(parse).not.toHaveBeenCalled();
      expect(() => decode(JSON.stringify(Array(254).fill(null)))).toThrow();
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('rejects duplicate decoded keys before parsing their enclosing object', () => {
    const text = '{"a":null,"\\u0061":null}';
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(() => decode(text)).toThrow('Invalid byte-review structure');
      expect(parse.mock.calls.every(([input]) => String(input).startsWith('"'))).toBe(true);
    } finally {
      parse.mockRestore();
    }
  });

  it('sanitizes malformed syntax and Unicode errors', () => {
    for (const text of [
      '', '[', '[null,]', '{"a":}', '{"a":null,}', '"unterminated',
      '"\\qSYNTHETIC_PAYLOAD"', '"\\uZZZZ"', '"\\ud800"', '"\\udfff"',
      'nullSYNTHETIC_PAYLOAD', '01', '+1', '.', '1e', '1e9999',
      '"\u0001"', '\ufeffnull',
    ]) {
      expect(() => decode(text)).toThrow(/^Invalid byte-review structure$/);
    }
    for (const bytes of [
      Uint8Array.of(0xed, 0xa0, 0x80),
      Uint8Array.of(0xf4, 0x90, 0x80, 0x80),
      Uint8Array.of(0xc0, 0xaf),
      Uint8Array.of(0xe2, 0x82),
    ]) {
      expect(() => decodePrivateComparison(bytes))
        .toThrow(/^Invalid byte-review structure$/);
    }
  });

  it('preserves numeric canonical uniqueness and special object keys', () => {
    for (const value of [
      0, Number.MIN_VALUE, Number.MAX_VALUE, 1e18 + 128, -(1e18 + 128),
      100, 1000, 0.01, 0.001,
    ]) {
      const text = formatComparisonNumber(value);
      expect(Object.is(decode(text), value)).toBe(true);
    }
    const text = '{"__proto__":null,"constructor":true}';
    expect(encodePrivateComparison(decode(text))).toBe(text);
    for (const alternate of ['1000000000000000100', '5e-324', '1e2', '1.0']) {
      expect(() => decode(alternate)).toThrow();
    }
  });
});

describe('closed structural binding and evidence contracts', () => {
  it('accepts the source constants without treating them as admission', () => {
    const b = binding();
    expect(parseSourceStructure(b.source)).toEqual(b.source);
    expect(parseRevisionTupleStructure(b.revisions)).toEqual(b.revisions);
    const owned = parseBindingStructure(b);
    expect(owned.attemptId).toBe(attemptId);
    expect(Object.isFrozen(owned.evidence.context)).toBe(true);
    expect(encodeBindingComparison(b)).toBe(encodeBindingComparison(owned));
  });

  it('rejects unknown, missing, symbol and accessor keys on closed records', () => {
    const b = binding();
    const missing = { ...b } as Partial<ReturnType<typeof binding>>;
    delete missing.authority;
    const symbolic = { ...b, [Symbol('extra')]: 1 };
    let calls = 0;
    const getter = { ...b };
    Object.defineProperty(getter, 'attemptId', {
      enumerable: true,
      get() { calls++; return attemptId; },
    });
    for (const input of [{ ...b, extra: 1 }, missing, symbolic, getter]) {
      expect(() => parseBindingStructure(input)).toThrow();
    }
    expect(calls).toBe(0);
  });

  it('rejects wrong source pins, revisions, UUIDs and noncanonical times', () => {
    const badCases = [
      () => { const b = binding(); b.revisions.consumer = '1.0'; return b; },
      () => { const b = binding(); b.revisions.request = ''; return b; },
      () => { const b = binding(); b.revisions.policy = 'x'.repeat(97); return b; },
      () => { const b = binding(); b.attemptId = attemptId.toUpperCase().replace('4000', '5000'); return b; },
      () => { const b = binding(); b.source.snapshotCommit = '0'.repeat(40) as typeof snapshotCommit; return b; },
      () => { const b = binding(); b.receipt.decisionAt = '2026-02-30T00:00:00.000Z'; return b; },
      () => { const b = binding(); b.receipt.decisionAt = '2026-01-01T00:00:00.000Z'; return b; },
      () => { const b = binding(); b.request.asof = '2026-02-30'; return b; },
      () => { const b = binding(); b.pages[0].page = 2; return b; },
      () => { const b = binding(); b.pages[0].byteLength = 524289; return b; },
      () => { const b = binding(); b.pages[0].sha256 = 'A'.repeat(64); return b; },
    ];
    for (const make of badCases) expect(() => parseBindingStructure(make())).toThrow();
  });

  it('retains the exact candidate-input byte exception', () => {
    const e = evidence();
    e.candidateCanonicalInput = 'x'.repeat(262144);
    expect(() => parseEvidenceStructure(e)).not.toThrow();
    expect(() => parseBindingStructure({ ...binding(), evidence: e })).not.toThrow();
    e.candidateCanonicalInput += 'x';
    expect(() => parseEvidenceStructure(e)).toThrow();
    e.candidateCanonicalInput = '\u{1f600}'.repeat(65536);
    expect(() => parseEvidenceStructure(e)).not.toThrow();
    e.candidateCanonicalInput += 'a';
    expect(() => parseEvidenceStructure(e)).toThrow();
    e.candidateCanonicalInput = '';
    expect(() => parseEvidenceStructure(e)).toThrow();
    e.candidateCanonicalInput = '\ud800';
    expect(() => parseEvidenceStructure(e)).toThrow();
  });

  it('does not extend the candidate exception to generic fields', () => {
    const e = evidence();
    e.candidateManifest = { value: 'x'.repeat(4097) };
    expect(() => parseEvidenceStructure(e)).toThrow();
    expect(() => encodePrivateComparison({ candidateCanonicalInput: 'x'.repeat(4097) }))
      .toThrow();
  });

  it('applies generic depth relative to each designated JsonValue field', () => {
    const e = evidence();
    let value: unknown = null;
    for (let i = 0; i < 12; i++) value = [value];
    e.candidateManifest = value;
    expect(() => parseEvidenceStructure(e)).not.toThrow();
    e.candidateManifest = [value];
    expect(() => parseEvidenceStructure(e)).toThrow();
  });

  it('rejects aliases across otherwise separately bounded fields', () => {
    const e = evidence();
    e.candidateManifest = e.context.controls;
    expect(() => parseEvidenceStructure(e)).toThrow();
    const b = binding();
    b.evidence.candidateManifest = b.pages[0];
    expect(() => parseBindingStructure(b)).toThrow();
  });

  it('enforces the evidence encoding cap independently of candidate input', () => {
    const e = evidence();
    e.candidateCanonicalInput = 'x'.repeat(262144);
    e.candidateManifest = Array.from({ length: 64 }, () => 'x'.repeat(4096));
    expect(() => parseEvidenceStructure(e)).toThrow();

    // Escaping can make an otherwise scalar-bounded candidate exceed binding cap.
    const b = binding();
    b.evidence.candidateCanonicalInput = '\0'.repeat(262144);
    expect(() => parseEvidenceStructure(b.evidence)).not.toThrow();
    expect(() => parseBindingStructure(b)).toThrow();
  });

  it('checks supplied imported shapes without turning declarations into rights', () => {
    const e = evidence();
    e.context.policy.maxAgeMs = -1;
    expect(() => parseEvidenceStructure(e)).toThrow();
    const other = evidence();
    other.candidateReceipt.promotionAllowed = true;
    expect(() => parseEvidenceStructure(other)).toThrow();
    const calendar = evidence();
    calendar.calendar.sha256 = '0'.repeat(64);
    expect(() => parseEvidenceStructure(calendar)).toThrow();
  });

  it('keeps binary64 JSON values separate from exact decimal-token fields', () => {
    const e = evidence();
    e.context.costs.commissionPerTrade = {
      value: '12345678901234567890.01',
      precision: 22,
      scale: 2,
    };
    const encoded = encodeEvidenceComparison(e);
    expect(encoded).toContain('"value":"12345678901234567890.01"');
    expect(encoded).toContain('"precision":22');
  });
});

describe('invocation and exact sixteen-check vector structures', () => {
  it('validates invocation fields without authenticating invocation', () => {
    const input = {
      schema: 'gelt.byte-review-invocation.v1',
      attemptId,
      invocationId,
      authorityId: 'fixture.authority',
      revisions: revisions(),
      bindingSha256: hash,
      startedAt: at,
      deadlineAt: '2026-01-02T00:01:00.000Z',
    };
    expect(parseInvocationStructure(input).invocationId).toBe(invocationId);
    expect(() => parseInvocationStructure({ ...input, extra: true })).toThrow();
    expect(() => parseInvocationStructure({ ...input, deadlineAt: '2026-01-01T00:00:00.000Z' }))
      .toThrow();
  });

  it('pins every ID, reason and order literally', () => {
    expect(checkIds).toEqual([
      'C01_ISSUANCE', 'C02_PAGE_BYTES', 'C03_REQUEST_CURSOR', 'C04_ROWS_DECIMALS',
      'C05_OBSERVATIONS', 'C06_RECEIPT', 'C07_CLOSURE_REVISIONS', 'C08_CALENDAR',
      'C09_AVAILABILITY', 'C10_CONTEXT_POLICY', 'C11_CANDIDATE',
      'C12_AUTHORITY_FENCES', 'C13_REVIEWER_ADMISSION', 'C14_HANDLING',
      'C15_LIFECYCLE', 'C16_IMMUTABILITY',
    ]);
    expect(Object.values(checkFailureReasons)).toEqual([
      'issuance_mismatch', 'page_mismatch', 'request_cursor_mismatch',
      'row_decimal_invalid', 'observation_mismatch', 'receipt_mismatch',
      'revision_mismatch', 'calendar_mismatch', 'availability_mismatch',
      'context_policy_invalid', 'candidate_mismatch', 'authority_escalation',
      'reviewer_not_admitted', 'handling_violation', 'lifecycle_invalid',
      'mutation_detected',
    ]);
  });

  it('requires all-pass consistency and failure-dominant outcome derivation', () => {
    expect(parseVerdictStructure(verdict()).outcome).toBe('consistent_unverified');
    for (let i = 0; i < checkIds.length; i++) {
      const v = verdict();
      v.checks[i] = {
        id: checkIds[i],
        result: 'fail',
        reason: checkFailureReasons[checkIds[i]],
      };
      v.outcome = 'rejected';
      expect(parseVerdictStructure(v).outcome).toBe('rejected');
      v.outcome = 'consistent_unverified';
      expect(() => parseVerdictStructure(v)).toThrow();
    }
    for (const reason of unknownReasons) {
      const v = verdict();
      v.checks[0] = { id: checkIds[0], result: 'unknown', reason };
      v.outcome = 'incomplete';
      expect(parseVerdictStructure(v).outcome).toBe('incomplete');
      v.checks[1] = {
        id: checkIds[1], result: 'fail', reason: checkFailureReasons[checkIds[1]],
      };
      v.outcome = 'rejected';
      expect(parseVerdictStructure(v).outcome).toBe('rejected');
    }
  });

  it('rejects incomplete, reordered, duplicate, NA and extended vectors', () => {
    const bad = [
      () => { const v = verdict(); v.checks.pop(); return v; },
      () => { const v = verdict(); v.checks.push({ ...v.checks[0] }); return v; },
      () => { const v = verdict(); [v.checks[0], v.checks[1]] = [v.checks[1], v.checks[0]]; return v; },
      () => { const v = verdict(); v.checks[1] = { ...v.checks[0] }; return v; },
      () => { const v = verdict(); v.checks[0].result = 'NA'; return v; },
      () => { const v = verdict(); v.checks[0].reason = 'checker_unavailable'; return v; },
      () => { const v = verdict(); return { ...v, checks: v.checks.map(c => ({ ...c, detail: 1 })) }; },
      () => { const v = verdict(); v.elapsedMs = 60001; return v; },
      () => { const v = verdict(); v.elapsedMs = 0.5; return v; },
      () => { const v = verdict(); v.revisions.consumer = '1.0'; return v; },
    ];
    for (const make of bad) expect(() => parseVerdictStructure(make())).toThrow();
  });
});

describe('settlement/status/ack structure is distinct from private evidence admission', () => {
  it('accepts initialization and the exact favorable representations', () => {
    expect(parseSettlementStructure(settlement()).outcome).toBe('not_attempted');
    expect(parseSettlementStructure(favorableSettlement()).outcome)
      .toBe('consistent_unverified');
    expect(parseStatusStructure(status())).toEqual(status());
    expect(Buffer.byteLength(encodeSettlementComparison(favorableSettlement()))).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(encodeStatusComparison(status()))).toBeLessThanOrEqual(1024);
    expect(Object.keys(parseStatusStructure(status())).sort()).toEqual([
      'schema', 'attemptId', 'phase', 'outcome', 'review', 'execution',
      'disposal', 'summaryDelivery', 'decision', 'reason', 'eligibility',
      'effectAuthority', 'promotionAllowed', 'retryAllowed',
    ].sort());
  });

  it('permits the structural projections used by the accepted adverse matrix', () => {
    const base = {
      ...favorableSettlement(),
      outcome: 'verdict_acceptance_failed',
      review: 'unknown',
      uncertainty: 'latched',
      summaryDelivery: 'acknowledged',
    };
    const cases = [
      base,
      { ...base, summaryDelivery: 'not_established' },
      { ...base, outcome: 'crashed' },
      { ...base, outcome: 'provenance_mismatch' },
      { ...base, outcome: 'unknown' },
      { ...base, outcome: 'unknown', execution: 'unknown', disposal: 'not_established' },
      { ...base, outcome: 'disposal_not_established', review: 'consistent_unverified', disposal: 'not_established' },
      { ...base, outcome: 'summary_failed', review: 'consistent_unverified' },
      { ...base, outcome: 'summary_failed', review: 'consistent_unverified', summaryDelivery: 'not_established' },
      { ...base, invocationId: null, review: 'not_attempted', outcome: 'unknown' },
    ];
    for (const input of cases) expect(() => parseSettlementStructure(input)).not.toThrow();
    // These assertions validate shape only; no receipt history or E/R/C ledger
    // exists here, and this test does not establish matrix transition behavior.
  });

  it('requires X1/D0 for disposal-failure settlements and emitted statuses', () => {
    const failure = {
      ...favorableSettlement(), outcome: 'disposal_not_established',
      disposal: 'not_established', uncertainty: 'latched',
    };
    for (const phase of ['release', 'summary']) {
      const current = {
        ...failure, phase,
        summaryDelivery: phase === 'summary' ? 'not_established' : 'not_attempted',
      };
      expect(() => parseSettlementStructure(current)).not.toThrow();
      expect(() => parseSettlementStructure({ ...current, disposal: 'references_released' })).toThrow();
      expect(() => parseSettlementStructure({
        ...current, execution: 'unknown', review: 'unknown',
      })).toThrow();
    }
    const emitted = { ...status(), outcome: 'disposal_not_established', disposal: 'not_established' };
    expect(() => parseStatusStructure(emitted)).not.toThrow();
    expect(() => parseStatusStructure({ ...emitted, disposal: 'references_released' })).toThrow();
    expect(() => parseStatusStructure({ ...emitted, execution: 'unknown', review: 'unknown' })).toThrow();
  });

  it('allows acknowledged current delivery after reporting failure, but never an acknowledged emitted status', () => {
    const current = {
      ...favorableSettlement(),
      outcome: 'summary_failed',
      summaryDelivery: 'acknowledged',
      uncertainty: 'latched',
    };
    expect(() => parseSettlementStructure(current)).not.toThrow();
    expect(() => parseStatusStructure({ ...status(), summaryDelivery: 'acknowledged' }))
      .toThrow();
  });

  it('rejects locally contradictory tuples and public extensions', () => {
    const cases = [
      { ...favorableSettlement(), invocationId: null },
      { ...favorableSettlement(), review: 'unknown' },
      { ...favorableSettlement(), uncertainty: 'latched' },
      { ...favorableSettlement(), execution: 'unknown' },
      { ...favorableSettlement(), summaryDelivery: 'not_attempted' },
      { ...settlement(), invocationId },
      { ...settlement(), outcome: 'unknown' },
      { ...settlement(), execution: 'settled' },
      { ...settlement(), disposal: 'references_released' },
      { ...favorableSettlement(), extra: 'forbidden' },
    ];
    for (const input of cases) expect(() => parseSettlementStructure(input)).toThrow();
    for (const input of [
      { ...status(), invocationId },
      { ...status(), uncertainty: 'none' },
      { ...status(), details: hash },
      { ...status(), retryAllowed: true },
      { ...status(), promotionAllowed: true },
      { ...status(), outcome: 'pending' },
      { ...status(), review: 'pending' },
      { ...status(), disposal: 'not_established' },
    ]) expect(() => parseStatusStructure(input)).toThrow();
  });

  it('pins precedence without claiming receipt admission or event projection', () => {
    expect(outcomePrecedence).toEqual([
      'crashed', 'provenance_mismatch', 'verdict_authenticity_failed',
      'verdict_acceptance_failed', 'timed_out', 'cancelled', 'summary_failed',
      'disposal_not_established', 'unknown', 'unavailable', 'incomplete',
      'rejected', 'consistent_unverified',
    ]);
  });

  it('requires the exact bounded acknowledgement shape without admitting linkage', () => {
    const input = {
      schema: 'gelt.byte-review-summary-ack.v2',
      attemptId,
      delivery: 'acknowledged',
    };
    expect(parseSummaryAckStructure(input)).toEqual(input);
    expect(Buffer.byteLength(encodeSummaryAckComparison(input))).toBeLessThanOrEqual(256);
    expect(() => parseSummaryAckStructure({ ...input, invocationId })).toThrow();
    expect(() => parseSummaryAckStructure({ ...input, delivery: 'not_established' })).toThrow();
    expect(() => parseSummaryAckStructure({ ...input, schema: 'gelt.byte-review-summary-ack.v1' }))
      .toThrow();
  });
});

describe('private comparison digest domains', () => {
  function expected(domain: string, text: string): string {
    return createHash('sha256')
      .update(Buffer.from(domain, 'utf8'))
      .update(Buffer.from([0]))
      .update(Buffer.from(text, 'utf8'))
      .digest('hex');
  }

  it('pins all domains and exact delimiter placement', () => {
    expect(comparisonDigestDomains).toEqual({
      binding: 'gelt.byte-review.binding.v1',
      verdict: 'gelt.byte-review.verdict.v1',
      evidence: 'gelt.byte-review.evidence.v1',
    });
    const b = binding();
    const v = verdict();
    const e = evidence();
    expect(bindingComparisonDigest(b))
      .toBe(expected(comparisonDigestDomains.binding, encodeBindingComparison(b)));
    expect(verdictComparisonDigest(v))
      .toBe(expected(comparisonDigestDomains.verdict, encodeVerdictComparison(v)));
    expect(evidenceComparisonDigest(e))
      .toBe(expected(comparisonDigestDomains.evidence, encodeEvidenceComparison(e)));
    const canonical = encodeEvidenceComparison(e);
    expect(evidenceComparisonDigest(e)).not.toBe(
      createHash('sha256').update(canonical).digest('hex'),
    );
    expect(evidenceComparisonDigest(e)).not.toBe(
      expected(comparisonDigestDomains.binding, canonical),
    );
    expect(evidenceComparisonDigest(e)).not.toBe(
      createHash('sha256')
        .update(comparisonDigestDomains.evidence + canonical)
        .digest('hex'),
    );
  });

  it('is independent of input member order and sensitive to bound changes', () => {
    const b = binding();
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    expect(bindingComparisonDigest(reordered)).toBe(bindingComparisonDigest(b));
    const changed = binding();
    changed.pages[0].byteLength = 2;
    expect(bindingComparisonDigest(changed)).not.toBe(bindingComparisonDigest(b));
    const e = evidence();
    const first = evidenceComparisonDigest(e);
    e.candidateCanonicalInput = '{"different":true}';
    expect(evidenceComparisonDigest(e)).not.toBe(first);
  });
});
