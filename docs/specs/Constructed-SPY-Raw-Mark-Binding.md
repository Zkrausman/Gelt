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

### A10 size and reachability accounting

The unchanged closed schemas make the tighter valid-success guards defensive
rather than reachable exact-size boundaries. The following conservative byte
calculations use a canonical closed-object framing skeleton plus maximum valid
field payloads. They are static bounds, not measured allocation, RSS, or timing.

| Value checked | Conservative bound | Guard | Evidence |
| --- | ---: | ---: | --- |
| Canonical consumer object | 5,686 bytes | 8,192 bytes | Schema-derived static bound; combined large/max-representable declared-field fixture passed in the current raw-mark unit run. |
| Canonical mark object | 1,889 bytes | 8,192 bytes | Schema-derived static bound; same passed combined fixture. |
| Generated old projection-input text | 534,528 bytes | 1,048,576 bytes | Successful daily JSON text is limited to 262,144 UTF-8 bytes and expands at most 2x when embedded as JSON text; add the consumer, derived observation, and fixed framing budgets. |
| Produced canonical successful binding result | 2,129,922 bytes | 3,145,728 bytes | At most 2x the generated input as a JSON string, the old projector's 1 MiB result, the 8 KiB mark, and fixed result framing. |
| Matcher candidate result Buffer (raw wire) | Exactly 3,145,728 bytes is reachable | 3,145,728 bytes | Valid canonical result plus trailing JSON whitespace fills the limit; the exact/+1 case passed in the current raw-mark unit run. |

For the consumer bound, the closed shape has 29 string leaves, 19 numeric
leaves, and seven decimal strings. Starting from a 905-byte empty/zero
canonical skeleton, reserve up to 240 encoded bytes for each decimal string,
128 bytes for each of the other 22 strings, and 15 additional digits for each
of the 19 numbers: 905 + 7×240 + 22×128 + 19×15 = 5,686 bytes. The mark has
12 string leaves, two numbers, and one decimal string; its 211-byte skeleton
gives 211 + 240 + 11×128 + 2×15 = 1,889 bytes. The 240-byte decimal allowance
conservatively covers the inherited 40 UTF-16-unit value bound at six JSON
bytes per unit. Other strings are fixed literals, bounded ASCII identifiers,
hashes, UUIDs, or normalized timestamps; 128 encoded bytes is a conservative
allowance for each. Numeric fields are bounded safe integers or smaller; the
15-digit addition is conservative from the zero skeleton.

The 8 KiB canonical consumer and mark guards, generated canonical-input 1 MiB
guard, and produced canonical-success 3 MiB guard cannot be reached by a fully
valid value under those closed-schema bounds. They remain checked as defense in
depth; no exact-size oracle is claimed for those unreachable boundaries. The
matcher instead caps raw result Buffer bytes before parsing, so valid trailing
JSON whitespace can reach that same 3 MiB wire limit without changing the
canonical candidate. A unit case pads a real valid result to exactly 3,145,728
bytes and checks that it matches; the same bytes plus one whitespace byte must
reject. Both assertions passed in the current raw-mark unit run.

A separate combined large/max-representable declared-field case passed. It uses a
64-character trade ID, 38-digit positive mark price, fixed 20/0 genesis and
0.01 commission with zero spread/slippage, and schema-valid 38-digit declared
portfolio cash/quantity. It asserts that the consumer and mark serializations
remain below 8 KiB, the projected policy is unchanged, and authority remains
absent. The declared portfolio snapshot exercises serialization only; it is
not an assertion that the balance or position can be reached through trading.

Working tests dynamically cover exact 1 MiB outer input and
262,144-byte daily text acceptance, the next-byte rejection for each, and
rejection of a 3 MiB + 1 matcher candidate. The exact 3 MiB padded valid-result
positive case and its +1 rejection now pass. The 64/65 trade-ID and 38-digit
price boundaries also passed in the earlier focused unit set.
These dynamic results do not imply that the tighter canonical valid-success
guards can be reached.

## Initial review and remediation

The completed initial independent source/privacy review reported no product finding,
blocker, high, or medium finding, privacy finding, or indispensable evidence
gap. The distinct initial adversarial review found no blocker, high, actionable
medium, privacy finding, or evidence gap. It raised one actionable Low A10
acceptance-coverage finding: document the tighter-bound reachability analysis
and add a meaningful large/max-representable-field synthetic case without inventing an
impossible boundary oracle. Owner adjudication accepted it as a coverage and
documentation gap, not a demonstrated product bypass. The initial pair is
complete; the source/privacy verdict retains its disclosed protocol
qualification. The combined large-field fixture, exact 3 MiB matcher positive
and +1 rejection, and static accounting now pass as working remediation
evidence. This remediation has not received a fresh final review and is not
final acceptance.

These are synthetic assertions. The modeled fill is not evidence of a real
trade or execution source. No actual supplier rights, data-use or retention
rights, session eligibility, conditions, corrections, trade eligibility,
capture completeness, actual availability, market evaluation, campaign
authority, or live-trading authority is established. There is no claim of a
first actual mark, source authenticity, durable raw-mark storage,
cross-store atomicity, operating qualification, or December 31 readiness.

## Verification status

The isolated core subset passed 8 of 8 unit cases. The expanded phase-two
subset passed 31 of 31, including those original eight. The phase-three focused
working sweep passed 80 of 80 cases: 33 raw-mark unit tests, 19 unchanged G05
projection tests, and 28 unchanged daily-input tests. After A10 remediation,
the raw-mark unit run passed 35 of 35, including the combined large-field and
exact 3 MiB padded-result cases. The import check over 557 candidate files also
passed after its inventory hash was updated.

Across working stages, 83 distinct cases are covered: 35 raw-mark unit cases,
19 projection cases, 28 daily-input cases, and one separate actual-consumer
integration case. The earlier 8, 31, 33, and 80 counts are overlapping subsets,
not additional cases. The consumer integration passed 1 of 1 using the
unchanged module and consumer test; it was not rerun in the A10 remediation
run. Worker typechecking, Go race across all packages, and Go vet passed in the
earlier working lane. The owner/export source-guard comparison reported all
1,168 guards unchanged. These are working-stage results, not reviewed
exact-head or final acceptance.

The latest raw-mark unit and import checks completed before this
specification-only update. The completed initial source/privacy and adversarial
pair is not the fresh final pair. A10 remediation closeout, fresh final
independent source/privacy and adversarial reviews, fresh final verification
and required gates, CI, and delivery remain pending. No final acceptance or
publication is claimed.

## Changed files

- v2/worker/src/constructed-spy-raw-mark.ts
- v2/worker/src/constructed-spy-raw-mark.test.ts
- v2/worker/src/constructed-spy-raw-mark-consumer.test.ts
- v2/IMPORT-MANIFEST.json
- docs/specs/Constructed-SPY-Raw-Mark-Binding.md
