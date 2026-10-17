---
type: specification
title: G06 constructed paper calendar binding
status: local-source-review
date: 2026-10-17
---

# Proposed constructed paper calendar binding — exact contract v1

Canonical repository ID1415613140; accepted remote base
09b7d2281acd22a2df44be6a24fb4a5b2fe5b493. This is the second existing roadmap
extension item, independently useful at the paper-input boundary. It is a
**proposed source contract**, not implementation, accepted check ownership,
market admission, G07 runner API or permission to acquire data. Root retains
sole Gelt source/check ownership. No concurrent inventory change until the
first-observation candidate is frozen and its receipt retained.

## Outcome and exact reserved paths

Bind an original constructed G05 input/receipt and existing paper policy to a
caller-supplied frozen calendar. Existing normalization performs this join while
normalizing a connector-issued acquisition; existing paper sizing accepts only
a calendar hash and does not consume the supplied calendar. This pure guard
reuses the existing calendar schema/digest; it does not repeat normalization,
invoke its connector path, or authenticate the calendar. No new dependency.

Proposed paths only:

- v2/worker/src/paper-calendar-binding.ts
- v2/worker/src/paper-calendar-binding.test.ts
- docs/specs/G06-Paper-Calendar-Binding.md
- v2/IMPORT-MANIFEST.json (two new entries only)

## Input and failure

`bindPaperCalendar(bytes: Buffer)` accepts at most existing shadowRuleMaxBytes
(256 KiB), through existing parseResearchJSON (strict UTF8, duplicate keys,
depth and node bounds). Root and all nested objects are strict using existing
paper config/mapping, G05 input/receipt and Alpaca session-calendar schemas:

```ts
{
  schema: 'gelt.paper-calendar-binding-input.v1';
  policyId: 'gelt.spy-long-cash-paper-policy.v1';
  config: PaperSizingConfig;
  mapping: PaperInstrumentMapping;
  ruleInput: ShadowRuleInput;
  ruleReceipt: ShadowRuleReceipt;
  calendar: AlpacaSessionCalendar;
}
```

Any malformed input, oversized/non-Buffer bytes, replay/context/hash/calendar
mismatch or structural inconsistency returns exactly:

```ts
{ schema: 'gelt.paper-calendar-binding.v1', status: 'rejected', reason: 'invalid_input' }
```

No raw value, error, partial identity or digest escapes rejected input. No
callback, provider, portfolio snapshot, clock, effect/admission bit or economics
branch input is added.

## Original receipt and paper identity

Replay original ruleInput/receipt with existing matchesShadowRuleReceipt; require
valid inputValidation. Require rule input/receipt/config runId, sourceCommit and
constructed classification agreement; data eligibility declared; SPY/USD agrees
with mapping underlying identity. Config mappingSha256 is simulationDigest of
the supplied mapping; internal instrument/currency agrees. Original rule
calendar hash and mapping.signal.calendarSha256 both equal calendar.sha256.
Calendar symbol is SPY. Existing alpacaSessionCalendarSchema verifies its digest
with **alpacaSessionCalendarDigest**, whose existing stable JSON recipe is not
replaced by canonical simulationDigest. Rule schedule/maxAge and exact exposure
value0.95/scale2 agree with existing fixed paper config. Do not rewrite original
SPY input or receipt to the internal instrument.

A valid rule abstention, including UNKNOWN, unverified costs or insufficient
warmup, may produce a bound receipt. Binding never changes that decision or
supplies its missing prerequisites. Cost calibration, actual provenance, full
sizing validity and effect admission are not certified.

## Calendar join and chronology

Require 1..253 bars and the **same number of calendar sessions**, in the supplied
order. Empty input has no last bar to bind and rejects. Each bar must match the
same-index session on **both sessionOrdinal and exact closedAt timestamp**;
matching an ordinal alone is insufficient. Do not compare prices with an
official Arca closing price, infer dates/timezones, sort, deduplicate, truncate,
accept a subset or repair a window. Retain all original adjustedClose metadata.

Every session must retain existing completed:true and completion evidence hash.
For every bar/session, require providerTimestamp <= closedAt <= completedAt <=
bar.availableAt <= ruleInput.decisionAt. Compare parsed canonical timestamps;
all timestamp values including decisionAt must be nonnegative safe milliseconds.
For each successive session, ordinals must increment by exactly1 and provider
timestamps and closedAt must strictly increase. All calendar records are checked,
including records earlier than the last bar. No trusted receipt/receivedAt or
availability-evidence bundle is invented; chronology remains a caller assertion.
Mismatch rejects the entire input, including a middle-window mismatch.

These checks are a declared-calendar join, not proof that the supplied calendar
is correct, complete beyond the supplied window, officially sourced, licensed,
point-in-time or the last available session in the outside world.

## Exact bound result and replay

```ts
{
  schema: 'gelt.paper-calendar-binding.v1'; status: 'bound';
  reason: 'exact_supplied_calendar_window';
  bindingId: `paper-calendar-${string}`; // digest of full body without ID
  inputSha256: string; inputDigestKind: 'canonical_validated_input';
  configSha256: string; mappingSha256: string;
  ruleInputSha256: string; ruleReceiptSha256: string;
  calendarSha256: string; // existing calendar digest recipe
  calendarInputSha256: string; // simulationDigest(entire validated calendar)
  barsSha256: string;
  runId: string; sourceCommit: string; decisionId: string; decisionAt: string;
  barCount: number; // 1..253
  firstSessionOrdinal: number; lastSessionOrdinal: number; lastClosedAt: string;
  classification: 'constructed_offline_test';
  bindingBasis: 'exact_window_in_supplied_calendar';
  calendarAuthenticity: 'not_established'; marketEvaluation: 'not_established';
  sourceAndProvenance: 'caller_assertions_not_independently_verified';
  effectAuthority: 'none'; promotionAllowed: false;
}
```

All ordinary hashes use existing simulationDigest/canonical helpers. Bound
receipt commits the entire exact input and original rule receipt, not a
rewritten/truncated window. No bars, raw bytes or prices are returned.
`matchesPaperCalendarBinding(bytes, result)` strictly validates the flat result,
replays the original bounded input and canonical-compares the full receipt.
Rejected inputs/results never match. Different calendar content, bar, context,
price precision or receipt invalidates old replay even if a date/ordinal matches.
Matching authenticates no external source and creates no durable admission.

## Proposed acceptance and review gates

Pure tests: exact253-window and shorter warmup/abstention joins; hash distinction;
same ordinal/wrong close, same close/wrong ordinal, middle-record mismatch;
duplicate/gapped/reversed sessions; malformed digest/completion/provider-time;
completion-after-availability and availability-after-decision; identity/replay
tampering; strict namespaces/extra fields/byte/UTF8/duplicate/depth bounds;
exact price precision; complete-result tampering; UNKNOWN and cost abstention
remain nonpromoting. No acquisition, normalization invocation or runtime test.

Separate read-only accuracy/adversarial contract review must decide this exact
scope first. Source implementation, if admitted, then requires complete actual
four-path diff review, closeout draft, both fresh final reviews and scoped pure
verification with retained dependencies. Existing broader release checks and
publication remain held stages; source completion cannot mean full G05/G06/G07.
No original schemas/rules/sizing/normalizer/caps/lifecycle/UI/workflow/dependency
changes, no providers/credentials/native/DB/store/listener/ownership/cleanup or
denied retries. Credits Off. Noncanonical repositories untouched.

## Local implementation status

The exact contract passed separate read-only accuracy and adversarial reviews,
with no blocker/high findings and all12 hashes matching. The sole Gelt source
owner implemented the pure boundary and constructed tests after those reviews.
The retained contract remains the immutable authority for scope; implementation
and its own exact-diff acceptance are distinct stages. No production consumer,
normalizer invocation, provider access, runtime or publication is introduced.

## Local source closeout draft and verification

Changed files are the new pure calendar-binding helper, its constructed tests,
this specification and exactly two added import inventory entries. No original
rule, sizing, simulator, normalizer, UI, lifecycle, dependency or workflow changed.
Existing calendar digest uses its established stable JSON recipe separately from
canonical validated-input/calendar hashes. Every supplied bar joins on ordinal
and exact close timestamp, with complete-window chronology; rejected output is
fixed and sanitized. Original rule abstentions are unchanged and effect-free.

Private-mirror initial checks using retained Node22.23.3/locked dependencies:
**71 new calendar cases +70 selector regression cases passed (141 total)**;
worker TypeScript noEmit exit0; import inventory exit0 (82upstream/489candidate,
MIT and lock unchanged). Parent whitespace checks pass including explicit
new-file checks. Frozen selector candidate retains its earlier inventory; current
shared inventory is that accepted baseline plus only the two calendar entries.

Both contract reviews were clean on contractSHA256
`afa1ae61be14bfdda046b50384637d688d50632282c666e29b74ea0863d38096`.
Complete source accuracy/adversarial and fresh final reviews remain required;
this draft does not claim their results. Their immutable receipt and subsequent
scoped verification identify the final exact candidate; no source edit may follow
final review without another review cycle.

Broader Go/race/vet, Linux build/smoke, scientific, protected-browser and remote
CI were not run for this local-only pure slice. Normal release gates/publication
remain held, and this is not full G05/G06/G07 acceptance, installation or actual
use. Calendar/source authenticity, eligible market inputs, trusted acquisition,
calibration, persistent first-observation freeze and prospective runner admission
remain unestablished. Credits Off and all runtime/access/privacy/no-rerun holds
remain unchanged. No noncanonical repository action occurred.
