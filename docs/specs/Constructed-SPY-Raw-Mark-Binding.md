---
id: constructed-spy-raw-mark-binding
status: implementation-prepared
classification: constructed_offline_test
authority: none
market_evaluation: not_established
promotion_allowed: false
verification: working_checks_passed_final_gates_pending
---

# Constructed SPY raw-mark/G05 binding

## Purpose and limits

This additive synthetic-only input seam binds one caller-supplied constructed
unadjusted IEX/SPY/USD trade to the existing PR75 daily request and the
unchanged G05 projector. It derives the projector's existing observation from
the raw trade price and capture times, then supplies the complete canonical
projection input to the existing projector exactly once.

This is representation, assertion-consistency, and supplied-time binding. It
does not authenticate a trade or source, prove capture completeness, establish
clock accuracy, or decide market eligibility. The feed labels remain separate:
an IEX raw-mark fixture may be paired with a constructed IEX or delayed-SIP
daily signal, without claiming feed equivalence or actual admission. The
signal's adjusted close remains distinct from the raw reference price.

The API has no provider, filesystem, environment, clock, network, order,
selection-campaign, direct evaluator, direct sizing, or persistence operation.
It delegates exactly one G05 evaluation to the unchanged existing projector;
it does not call the evaluator or sizing function directly. The complete
raw-mark input remains caller-owned. originalMarkPersistence is always
not_performed_by_this_api; downstream consumer evidence contains derived
projection facts and an observation evidence hash, not a recoverable complete
raw-mark record. The existing consumer's later modeled execution observation
continues to be checked by its existing mock-storage contract. This change
does not authenticate or calibrate that later execution observation, replace
its schema, or link it to a real fill.

## Input and projection

projectConstructedSpyRawMark accepts only a nonempty Buffer of at most
1 MiB. It copies the bytes once, parses strict JSON with duplicate-key,
invalid-UTF-8, depth, and node checks, and requires closed outer, consumer, and
mark objects. The daily request text is limited to 262,144 characters and
UTF-8 bytes and is preserved exactly. Canonical consumer and mark records are
each limited to 8 KiB.

The consumer must use the existing constructed simulation-run and portfolio
read shapes, a settled lifecycle declaration, normalized millisecond UTC
evaluation time, and complete lowercase SHA256 controls. The unchanged
projector rejects an unsettled portfolio. The mark is
limited to the fixed constructed vocabulary and has a complete ASCII trade ID
of at most 64 characters, an existing positive decimal representation with a
full-string unsigned base-10 check, and normalized millisecond UTC provider,
receipt, and availability times. The only local chronology admitted is
providerTimestamp <= receivedAt <= availableAt <= evaluationAt. The
unchanged projector remains responsible for daily-request validity,
decision-relative timing, configured age windows, and G05 assessment.

The API hashes the exact daily request bytes and owned outer input bytes,
canonical mark bytes, and complete mark-evidence body. It derives the
observation from the supplied raw price, provider timestamp, availability,
and evidence hash. It adds only the existing fixed constructed mark-basis and
corporate-action fixture labels to the old projector input. A projected return
must reproduce the exact derived observation. Every local failure and legacy
projection rejection returns the same fixed invalid_input result.

The success result includes the complete parsed mark, exact generated
projection-input text, and complete typed G05 projection. A binding digest
covers the entire success body except the binding ID itself. The canonical
success result is limited to 3 MiB. Rejections use one fixed generic shape
and do not reflect caller input, paths, parser errors, or operating-system
details. A successful result intentionally includes the supplied synthetic
mark and generated projection-input text.

## Result matcher

matchesConstructedSpyRawMark accepts bounded input and result Buffers,
strictly parses the candidate result, and recursively rejects every non-finite
number before candidate canonicalization. This prevents JSON exponent values
that decode to infinity from collapsing to null in the existing canonical
helper. It rejects rejected results and replays the new API, comparing the
entire canonical candidate with the fresh expected result. It does not trust
claimed detached hashes or a subset of nested projection fields.

## Synthetic acceptance coverage

The owned tests specify and exercise:

- A 253-row daily signal whose last adjusted close is 2 and a supplied raw
  trade at 3; the derived observation uses 3 and matches an independently
  assembled complete legacy-projector input.
- Actual consumer callback context rather than a setup-only 19-cash decoy:
  the durable consumer input and returned mark evidence bind to the callback's
  20-cash portfolio. A modeled 1.66-unit fill at 3 with a 0.01 fee leaves
  15.01 cash. Stop and protected read-only reopen preserve the committed fill
  and spent authority without another producer call.
- Closed vocabulary and shape, trade-ID length, full-string price/control
  checks, timestamp chronology, inclusive capture equalities, and the
  unchanged post-decision, 5,000 ms observation-age, 960,000 ms decision-age,
  and validThrough checks.
- Separate constructed IEX marks with a valid delayed-SIP signal, exact
  decimal spelling and bounds, exact raw-byte and daily-text identities,
  caller mutation isolation, and exact 1 MiB / 262,144-byte limits.
- Whole-result replay negatives for changed and cross-case results, nested
  extra fields, coherent detached favorable rewrites, and nested 1e999 and
  -1e999 values. Pretty-printed complete results remain matchable.
- One legacy projector call for a locally valid input, including legacy
  rejection, and zero calls for local validation failures.

These are synthetic assertions. The modeled fill is not evidence of a real
trade or execution source. No actual supplier rights, data-use or retention
rights, session eligibility, conditions, corrections, trade eligibility,
capture completeness, actual availability, market evaluation, campaign
authority, or live-trading authority is established. There is no claim of a
first actual mark, source authenticity, durable raw-mark storage,
cross-store atomicity, operating qualification, or December 31 readiness.

## Verification status

The isolated core subset passed 8 of 8 unit cases. The expanded phase-two
subset passed 31 of 31, including those original eight. The current focused
working sweep then passed 80 of 80 cases: 33 raw-mark unit tests, 19 unchanged
G05 projection tests, and 28 unchanged daily-input tests. These counts describe
overlapping stages and are not additive. A separate actual-consumer integration
run passed 1 of 1 case using the unchanged module and consumer test from that
stage; it was not rerun in the focused sweep. Worker typechecking, the import
check over 557 candidate files, Go race across all packages, and Go vet also
passed in the working validation lane. All five commands exited successfully
and their scoped jobs joined; the owner/export source-guard comparison reported
all 1,168 guards unchanged.

These are working-stage results, not reviewed exact-head or final acceptance.
The latest working checks preceded this specification-only evidence update.
Fresh initial independent source/privacy and adversarial reviews, required
review closeout, fresh final review and re-verification, final exact-head gates,
CI, and delivery remain pending. No final acceptance or publication is claimed.

## Changed files

- v2/worker/src/constructed-spy-raw-mark.ts
- v2/worker/src/constructed-spy-raw-mark.test.ts
- v2/worker/src/constructed-spy-raw-mark-consumer.test.ts
- v2/IMPORT-MANIFEST.json
- docs/specs/Constructed-SPY-Raw-Mark-Binding.md
