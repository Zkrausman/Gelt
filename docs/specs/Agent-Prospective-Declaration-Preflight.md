---
type: specification
title: Agent prospective declaration preflight
status: source-candidate-pending-independent-review
source_baseline: adfed68756921f6763a5b827c9489ad7ab2652c8
scope: proposed declaration consistency, no profile admission or effects
---

# Prospective declaration preflight

The owner commissioned continued agent-first source implementation. After
[PR36](https://github.com/Zkrausman/Gelt/pull/36) delivered bounded constructed
proposal data, this increment turns the existing prospective-window/revision
preparation into a fixed machine-readable preflight. Agents can detect invalid
declared identity, ordering and revision links before preparing an admission
request. No dated market profile, calendar convention or operating policy is
selected. The [consumer contract](PAMR-A64-Consumer-Contract-Proposal.md) and
[engineering case](PAMR-A64-Proposed-Case-Registration.md) remain unadmitted.

This command evaluates proposed **declarations**, not original market input or
actual evidence. A logically consistent declaration remains NOT_READY. All
sixteen actual checks, C07/C13/C14 and actual supplier/handling/clock/availability
facts remain UNKNOWN; production CLOSED and operations DEFER. No actual input
inspection, history update, decision, consumption, persistence or effect occurs.

## Fixed interface

Use the existing worker build, then:

```sh
node v2/worker/dist/prospective-declaration-cli.js --describe
node v2/worker/dist/prospective-declaration-cli.js < proposed-request.json
```

The only request schema is `gelt.agent.a64-prospective-declaration-input.v1`:

| Field | Complete value required |
| --- | --- |
| `schema` | Exact request schema above. |
| `currentText` | One complete `gelt.a64-prospective-profile-declaration.v1` JSON string. |
| `predecessorText` | `null` for an initial declaration; otherwise one complete initial declaration JSON string. A detached hash, pass flag or summary cannot substitute. |

The command accepts no operation selector, registry, callback, module, filename,
output path, environment policy, authority object or qualified-evidence claim.
`--describe` does not consume stdin. Existing A64 inspection and constructed
consumer objects reject; no outer label or new timestamp revises their identity.
The fixed command is `preflight_a64_prospective_declaration` and capability schema
`gelt.agent.a64-prospective-declaration-capability.v1`.

Each declaration has a distinct proposed domain and evidence-preparation purpose:

| Declaration | Interpretation |
| --- | --- |
| Case / proposed epoch / profile revision | The selected engineering-integrity case and existing `proposal-2` revision, with bounded proposed identifiers. These name supplied data, not an admitted case, owner or accepted profile. |
| Profile declaration time | A normalized UTC **assertion** that the proposed profile was declared before its decision. No actual precommit, authenticated clock or physical issuance is established. |
| History proposal | Existing finite 253/65/64 adaptation vocabulary. No closes or prices are accepted or processed; output says zero actual history updates. No full-252-history fidelity follows. |
| Proposed window | Inclusive start and exclusive end Gregorian session-date labels. A schedule is explicitly unknown or a declared list of exactly 253 normalized labels plus a calendar digest. Check uniqueness, order and membership in those declared date bounds. No market calendar, holiday/DST, daily-bar or provider compatibility is inferred. |
| Proposed UTC mapping | Explicitly unknown or separately declared UTC `firstSessionStartsAt` / `lastSessionCompletesAt`. Never derive these from date labels. Validate their supplied order and causal relations; their compatibility with the session labels remains unqualified. Neither field is a provider query-end boundary; query bounds are not accepted as completion evidence. |
| Causal timing | Distinct nullable declared window completion, whole-input receipt, source completion and asserted complete-input availability, plus proposed decision/evaluation. Missing declarations remain explicit, not fabricated timestamps. Receipt means the asserted complete-window receipt, not request issuance or an early page. It is still an unqualified declaration. |
| Collected input digest | Nullable declaration only. No original body, private completion, authenticity, rights or current validity is reconstructed from it. |
| Revision | Initial declaration, or a revised declaration with the canonical predecessor data digest and nullable asserted change-observation time. The full immediate predecessor must also be supplied. |

All objects are strict. Unknown keys, favorable qualification/check fields and
alternate schemas reject rather than become evidence. IDs and hashes have exact
bounded grammars; UTC timestamps and date labels must round-trip without date
normalization. These syntax rules are not clock or calendar qualification.

## Independent adverse facts and one-link revision boundary

The validator retains all applicable contradictions from both supplied records
and their binding. It does not latch the first error or stop checking a causal
relation because a neighboring declaration is unknown. In particular:

- Profile declaration precedes decision; decision is no later than evaluation.
  Supplied complete-input receipt/completion/availability and window completion
  must precede decision. Strict equality at those causal boundaries rejects.
- Declared first-session start precedes declared last-session completion, which
  precedes decision. Supplied whole-window completion, receipt and availability
  cannot precede that declared last-session completion. Availability cannot
  precede supplied receipt, source completion or window completion. Receipt
  cannot precede supplied window completion or follow source completion.
- Duplicate, reordered or out-of-window date labels reject even when their
  count is correct. Unsupported/missing schedule shape rejects; an explicitly
  unknown schedule remains a missing declaration and never a compatible calendar.
- A revision recomputes the **whole supplied initial predecessor** in its data
  hash domain. Changed prior data with an unchanged reference rejects. Missing
  complete predecessor, unexpected predecessor, cross-epoch binding, reused
  profile revision or a declaration moving backwards rejects.
- Within this one proposed epoch, revisions preserve both date/declared UTC
  boundaries and decision. They cannot silently roll a frozen window. A supplied
  revision observed at or after decision rejects; unknown observation time stays
  explicitly undeclared and unqualified.
- A predecessor that is itself revised rejects as unsupported earlier revision
  history. This two-context interface does not invent, skip or claim to verify
  an opaque ancestor chain. An `initial_declaration` label is not evidence that
  actual earlier history, exposure or ownership is absent.

Every fact above concerns supplied declarations. A new proposed epoch or initial
label cannot clear actual ownership, uncertainty, spent facts or pending
capabilities. No owner/store, recovery mechanism, mutable current-state registry
or private checker is created. Actual revision/completion disposition remains
unaccepted; no permanent vendor immutability or provider-atomic vintage is assumed.

## Results and finite transport

Exit 0 / `preflight_data` means no contradiction was found within this declared
scope. It may still contain missing declarations and always contains unresolved
actual facts and NOT_READY/CLOSED/DEFER. Exit 2 / `rejected_declarations` retains
bounded enum diagnostics for both declarations and their binding. Invalid syntax,
schema or resource/transport input rejects generically with exit 2. Unsupported
arguments return 64; unavailable output/unexpected transport failure returns 74.
Partial stdout must never be accepted.

Responses use `gelt.agent.a64-prospective-declaration-response.v1`. They include
canonical current/predecessor fingerprints, bounded contradictions/undeclared
slots, all unknown actual facts/checks and a domain-separated preflight data
fingerprint. No raw supplied identifiers, dates, paths, exception details or
source text are reflected. Fingerprints bind canonical supplied data, not raw
original bytes, authenticity, issuance, actual lineage or operating authority.
Coordinated changes to a declaration and its matching reference can produce
consistent new data; they do not establish an authentic predecessor or history.
No detached result is accepted as a permission-bearing receipt.

The aggregate request remains at most 262144 UTF-8 bytes, including escaped
strings. Each complete declaration is at most 8192 bytes, reusing the existing
context ceiling; the complete response/envelope/newline is at most 8192 bytes.
There is no artifact input, extra history allowance, pagination or compression.
The existing strict parser keeps depth-16/node-20000 bounds. A valid outer
request contains only the two bounded contexts and schema; no recursive chain
is decoded. UTF-16 is checked before encoding and stdin uses fatal UTF-8 decode.

The delivered shared transport keeps five-second input/output and 4096-chunk
limits, one response and callback → finish → observed-close completion, persistent
terminal error guards and honest output failure. These are source transport
bounds, not financial cadence/freshness or whole-job handling qualification.
The A64 and constructed-PAMR entries, math, inspector, literal historical dates,
lifecycle, dependencies, security controls and workflows are unchanged.

## Verification and remaining delivery gates

New contract/command/CLI and two test files, this specification, import inventory
and the cumulative roadmap are the complete intended change set. The initial
focused implementation passed 72 tests and worker types. Self-review then added
explicit unknown/declared UTC mapping checks, independent causal edges where
neighboring slots are unknown, and honest rejection of unsupported ancestor
history. No external review finding or executed negative control is claimed for
that self-review. The final focused suite passed 75 tests across six files,
including the unchanged A64/PAMR tests. Worker types passed during preparation. A further self-review clarified the
UTC assertion field names to distinguish last-session completion from provider
query-end semantics; no actual mapping is derived or qualified.
After that clarification, all nine full working phases passed: 1821 worker/web,
18 server and 53 script tests; worker types; Go race/vet/build; V2 build/offline
smoke/import accounting and diff checks. Twenty-eight unsupported legacy Windows
cases remain skipped. The two-worker local profile retains all cases, assertions
and deadlines; normal hosted tests remain mandatory. The earlier full working
pass is preserved separately and predates the UTC field clarification. Neither
receipt establishes exact-head post-review acceptance or actual qualification.

Actual compiled Node child pipes passed seven new-entry cases, including whole
initial/revised declarations and changed-predecessor rejection. Four additional
child checks reject the new request/result through both old commands. Six old
entry discovery/rejection/usage cases remain compatible, with A64 responses
matching the retained PR35 golden values. Outputs are bounded and quiet; no
source data, acquisition or operation was exercised.

Acceptance covers complete declaration → finite stdin → deterministic result,
whole immediate-predecessor mutation rejection, simultaneous adverse facts,
unknown evidence, legacy/forged authority rejection, strict time equality,
session identity/order, byte/parser bounds, privacy and transport failures.
Constructed fixture dates deliberately include weekend labels: a data preflight
does not establish actual eligible sessions or future time coverage. Existing
A64/PAMR regression suites remain required.

Fresh independent and distinct adversarial source/privacy review, exact-head
Linux tests/types/Go race/vet/build/V2 build/smoke/inventory, normal hosted
scientific/history/research/G01/G03, ordinary PR/CI/merge and remote/post-merge
verification remain mandatory. Formal GitHub Approve requires its own action-time
authority. No source fixture or delivery admits actual data, runtime/handling,
supplier/consumer, economic policy, campaign, promotion or financial action.

An actual dated profile still needs compatible calendar/provider aggregation,
qualified clock/availability, completion/revision evidence and accepted exact
window, supplier, handling, consumer and finite operating policy. Those are
dependencies, not ready work or permission supplied by this preflight.
