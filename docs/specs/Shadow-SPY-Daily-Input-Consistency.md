---
type: specification
title: Prospective SPY daily input consistency
status: working-verified-pending-final-review-and-verification
source_baseline: 82b2588458a42f3c1d918881a4560969e9bc427c
scope: pure constructed-input consistency only; no admission or effects
---

# Prospective SPY daily input consistency

## Purpose and boundary

`assessSpyDailyInput(bytes)` checks whether one supplied synthetic request and
its optional complete immediate predecessor are internally consistent with a
small set of daily-window assertions. `matchesSpyDailyInputAssessment(bytes,
value)` recomputes the assessment and checks the complete closed result. The
module is pure: it has no connector, evaluator, sizing call, command dispatch,
file or network access, clock, environment lookup, persistent state, or effect.

An accepted assessment means only that the supplied assertions passed these
checks. It does not establish an exchange calendar, symbol or entity identity,
supplier, account entitlement, lawful use or retention, source authenticity,
complete delivery, finality, adjustment vintage, actual availability, market
evaluation, strategy eligibility, or any authority. A matching result is
deterministic linkage to caller-supplied bytes, not an authenticated receipt.
The component is not wired into the existing IEX, G06, A64, admission,
consumer, evaluator, or dispatcher paths. Their schemas and behavior stay
unchanged.

## Request

The only accepted request is the strict
`gelt.spy-daily-input-consistency-request.v1` object. It contains the literal
`constructed_offline_test` classification, UUID epoch, normalized UTC
millisecond `declaredAt` and `decisionAt`, a complete current snapshot, a null
or complete predecessor, and revision 0 or 1. Declaration time must precede
decision time. Revision 0 requires no predecessor; revision 1 requires the
complete immediate predecessor. Other revision histories are unsupported.

Each snapshot fixes feed to `iex` or `sip`, symbol SPY, currency USD, timeframe
1Day, adjustment all, and a round-trip Gregorian `asof` date. It supplies
normalized UTC millisecond `requestStart`, `requestEnd`, `issuedAt`,
`receivedAt`, and `availableAt`; exactly 253 calendar rows; and exactly 253
bar rows. All objects reject unknown keys. The request buffer is at most
262,144 bytes, uses fatal UTF-8 decoding, and is parsed with duplicate-key and
structural bounds. Invalid syntax, schema, decimal, date, timestamp, or
resource input returns only the fixed `rejected / invalid_input` result.

Calendar rows have a Gregorian `sessionDate`, a nonnegative safe-integer
ordinal, and `dayStartsAt` / `dayEndsAt`. The UTC instants must have millisecond
zero and format in `America/New_York` as local `00:00:00.000` at the session
date and next Gregorian date. The next date is derived by Gregorian UTC
arithmetic, not by adding 24 hours to the boundary. The production formatter
explicitly selects Gregorian calendar, Latin digits, and hour cycle h23. This
accepts 23-hour and 25-hour civil days across daylight-saving changes; it does
not authenticate a trading calendar or infer holidays, closures, or exchange
eligibility.

Bar rows pair a normalized UTC provider timestamp with a positive decimal from
the existing bounded decimal schema. Decimal prices remain strings and are
never converted to floating point or recalculated. The request contains no
URL, credential, path, callback, completion/finality flag, or caller-supplied
pass or authority object.

## Consistency categories

For both the current snapshot and predecessor, applicable contradictions are
collected in this fixed order; the result does not stop at the first mismatch:

1. `daily_mapping`: every bar timestamp equals its row's daily start; each
   interval ends after it starts; each UTC boundary has millisecond zero and
   maps to the specified New York civil midnight.
2. `calendar_order`: dates strictly increase; ordinals increase by exactly one
   without safe-integer overflow; UTC starts and ends increase; and a next
   start is no earlier than the previous end. Gaps between supplied dates are
   permitted and do not prove a holiday.
3. `request_window`: request start equals the first daily start; inclusive
   request end equals the last daily end minus one millisecond; issue is no
   earlier than the final interval end; receipt is no earlier than issue;
   availability is no earlier than receipt and strictly before decision; and
   each supplied bar maps to the corresponding row in the exact 253-row
   request calendar.
4. `sip_delay`: SIP issue time is at least 900,000 milliseconds after the
   inclusive request end. IEX has no such artificial access-delay requirement.
   For both feeds, passing this check does not prove the bar is complete or
   final.
5. `declaration_timing`: declaration is no later than issue for each supplied
   snapshot. This remains a caller assertion and does not establish precommit
   or a trusted clock.
6. `revision_binding`: revision 1 preserves feed, symbol, currency, timeframe,
   adjustment, `asof`, request window, and the entire calendar. Current receipt
   is later than predecessor receipt, both availabilities precede decision,
   and at least one corresponding close differs in exact numeric value using
   the shipped bounded `decimalCompare`. A representation-only change such as
   `1` to `1.0` is not a price revision. The predecessor is complete and bound
   into the assessment digest. No earlier history or authentic lineage is
   inferred.

Changing feed, identity, window, calendar, or `asof` requires a new epoch; it is
not an in-epoch correction. A correction available at or after decision cannot
rewrite the prospective snapshot. A consistent revision remains an assertion
about the two supplied snapshots only.

## Result and matcher

The closed output schema is `gelt.spy-daily-input-consistency.v1`. Invalid
input returns only `status: rejected` and `reason: invalid_input`. A valid
request returns `consistent` with an empty reason list or `contradictory` with
the fixed-order categories. The bounded result contains an assessment ID
derived from the canonical result body excluding that ID, canonical SHA-256
digests of the validated request, current snapshot, and complete predecessor
or null, and fixed trust fields:

- classification `constructed_offline_test`;
- consistency `supplied_assertions_only`;
- rights and calendar authenticity `not_established`;
- completion and vintage `unknown`;
- actual availability and market evaluation `not_established`;
- effect authority `none`; and promotion `false`.

No bar, timestamp, source text, raw input, error detail, or host path is
reflected. Output is limited to 8,192 UTF-8 bytes. The matcher validates the
whole closed result, rejects invalid assessments and exceptions, recomputes
from the supplied request, and compares the canonical complete results. It
may match a truthful contradictory assessment; it cannot establish source
truth or receipt issuer.

## Synthetic acceptance coverage

The owned tests use sequential synthetic civil-date rows as caller assertions,
including weekends; they do not represent exchange sessions or truth. Their
New York civil-midnight generator uses a fixed 2026 transition table separate
from production formatting and asserts the independent UTC literals
`2026-03-08T05:00:00.000Z` to `2026-03-09T04:00:00.000Z` and
`2026-11-01T04:00:00.000Z` to `2026-11-02T05:00:00.000Z`.

The test cases cover exact IEX/SIP timing boundaries, 23/25-hour DST days,
off-by-one query bounds, malformed/mismatched day mappings, duplicate
ordinals, the contiguous safe-integer ordinal range ending exactly at
`MAX_SAFE_INTEGER`, and rejection of unsafe or fractional ordinals. They also
cover independent fixed-order contradictions, causal order, positive and
malformed decimals, complete predecessor binding, formatting-only versus
numeric revision changes, unsupported revision shapes, old-schema rejection,
duplicate JSON keys in an otherwise valid request, invalid UTF-8, 253-row
count bounds, exact 262,144-byte acceptance and one-byte-over rejection,
privacy-safe generic rejection, assessment tampering/cross-input mismatch, and
input-buffer immutability. DST negatives include a nonzero millisecond field,
24-hour boundary assumption, UTC midnight substitution, and a 16:00 bar end.
Focused working validation passed 236 tests (28 new and 208 compatibility
tests across five files), worker TypeScript checks, and the import-inventory
check. All reported exit statuses were zero, and the namespace-sync EOF check
completed. Initial independent and adversarial source/privacy reviews reported
no actionable findings. Full fresh final reviews, exact-head repository
verification, and publication remain NOT RUN/PENDING.

## Changed files

- `v2/worker/src/spy-daily-input-consistency.ts`
- `v2/worker/src/spy-daily-input-consistency.test.ts`
- `docs/specs/Shadow-SPY-Daily-Input-Consistency.md`
- Added-file entries in `v2/IMPORT-MANIFEST.json` for the two worker files above.

No supplier/account choice, market-data acquisition, source-sharing, observation
campaign, operating qualification, live trading, or financial action is part of
this component.
