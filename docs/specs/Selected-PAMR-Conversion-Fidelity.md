---
type: specification
title: "Selected PAMR mathematical conversion and inert artifact"
status: source-completion-report
implementation_status: constructed-mathematical-conformance-only
timestamp: 2026-10-27T00:00:00Z
---

# Selected PAMR mathematical conversion

The separately approved [finite SPY253 inspection adapter](SPY253-PAMR-Inspection.md)
shares the internal mathematical trace under a distinct inert inspection identity.
It selects 64 intervals from 65 explicitly selected closes, rejects nonterminating
or oversized exact ratios and preserves unknown factual evidence. Its artifact
is rejected by the constructed consumer; the original mathematical increment
and its external-reference limitations below remain intact.

The separately authorized [fixed synthetic consumer](PAMR-Synthetic-Consumer.md)
now connects this inert artifact to constructed sizing, durable single-use
consumption and the existing synthetic lifecycle/protected read path. That
quarter-scale risk/reserve adaptation does not change this mathematical recipe
or close its external reference, rights or operating qualification limits. The
description below retains the boundary of the original mathematical increment.

This source increment implements one fixed, deterministic mathematical recipe and
an inert candidate artifact. It neither interprets arbitrary papers nor executes
the inspected MATLAB reference. It does not connect PAMR weights to G05 sizing,
G06 dispatch, account exposure, quantities, cash or simulated fills. Existing
[baseline integration](Candidate-Shadow-Synthetic-Integration.md) remains separate
and rejects this artifact identity.

## Reference, attribution and fidelity boundary

The selected paper is Bin Li, Peilin Zhao, Steven C. H. Hoi and Vivekanand
Gopalkrishnan, *PAMR: Passive aggressive mean reversion strategy for portfolio
selection*, Machine Learning 87, 221–258 (2012),
[DOI 10.1007/s10994-012-5281-z](https://link.springer.com/article/10.1007/s10994-012-5281-z).
The mathematical profile follows the selected publisher Appendix A observations:
uniform initialization, centered-relative update, zero-norm tau=0 and projection
onto the probability simplex. This citation identifies selected mathematical
content, not a full-paper byte pin, performance reproduction or paper-text license.

The separately inspected author-linked
[OLPS/OLPS reference](https://github.com/OLPS/OLPS/tree/9120783cd59a7966b0f78e2b5668030a4378b8af)
is pinned at commit `9120783cd59a7966b0f78e2b5668030a4378b8af`, tree
`b6d1491d55d827f4dd070112bcab98ab5e6d4643`. Its
[Strategy/pamr_run.m](https://github.com/OLPS/OLPS/blob/9120783cd59a7966b0f78e2b5668030a4378b8af/Strategy/pamr_run.m)
SHA-256 is `ad57382eabfd98677d29f3e765ccb61f94fd5fe9fceaa25f1ece7465ea341de7`.
Static inspection found eta assigned only inside the nonzero-denominator branch,
then used unconditionally. A first centered-zero row reaches an uninitialized eta.
Later retained finite eta need not change weights when the centered vector is zero.
We did not execute that reference or claim current host compatibility. Its
nonzero-transaction-cost numerator also differs from the selected paper equation;
this profile fixes transaction cost to zero.

The repository declares [Apache-2.0](https://github.com/OLPS/OLPS/blob/9120783cd59a7966b0f78e2b5668030a4378b8af/LICENSE)
and [NOTICE attribution](https://github.com/OLPS/OLPS/blob/9120783cd59a7966b0f78e2b5668030a4378b8af/NOTICE.txt).
This implementation derives the threshold projection from its mathematical KKT
conditions; no upstream MATLAB or credited third-party projection source is
vendored. Repository declarations are not certification of every third-party
right, full dependency closure, or rights to reproduce paper text/figures. Source
pins identify inspected bytes, not independent authentication or runtime custody.

## Closed input and computation

`paper-conversion-contract.ts` defines the fixed recipe and a primitive JSON-string
request. Inputs are 2–8 unique synthetic labels (`SYNTH-…`) and 1–64 ordered rows
of finite, strictly positive decimal strings with matching dimension. Numeric
strings have at most 32 characters, no exponent/sign/leading zero ambiguity. No
caller weights, prior-state assertion, callback, source module, path, market data
selector or credential is accepted. Fixed epsilon is 0.5 and algorithmic tc is 0;
PAMR1/PAMR2/mixtures are unsupported. Decimal and label expressions have no
multiline flag; trailing LF/CR/Unicode line separators and whitespace reject
through conversion and reopening, rather than being coerced as numeric data.

Character and UTF-8 byte ceilings precede parsing (32 KiB request; 2 MiB artifact).
The existing strict research parser rejects duplicate keys, depth above 16 and
more than 20,000 nodes before whole-tree decoding. Rejections contain only closed
reason codes, never input fragments or exception details.

`pamr-reference-artifact.ts` derives b1 uniformly and replays the complete input
prefix, deriving every later state internally:

- loss = max(0, b dot x − 0.5);
- d = x − mean(x), tau = 0 when d dot d = 0, otherwise loss / (d dot d);
- next weights = Euclidean projection of b − tau d onto b >= 0, sum(b) = 1.

Exact reduced bigint rationals are used throughout. A sorted-prefix threshold
projection is checked for exact sum one. Temporary integers and reduced numerators/
denominators are limited to 4096 bits. Conservative pre-operation bit estimates
may reject an operation whose reduced result would fit: this is a declared finite
profile restriction, not permission to silently round or repair. No IEEE floating
point approximation, arbitrary tolerances, fitted performance policy or downstream
execution numeric-admission rule is introduced. Rows up to the output step alone
determine that step's weights/state digest; future rows cannot change earlier
steps. These are strategy weights, not marked-to-market holdings.

## Inert artifact and reopening

`convertPAMR(text)` returns computed artifact or sanitized `invalid_input` /
`resource_limit`. The artifact includes the full validated constructed input,
recipe/source/parameter/input/output digests and each step's ordinal, row digest,
parent state, before/after rational weights, loss, tau and state digest. Digest
domains are distinct. Equivalent decimal spellings can deliberately retain distinct
input identities. A reproducible whole request may be repeated: there is no
execution attempt, reservation, store or mutable trading state to consume.

`serializePAMRArtifact` serializes only immutable objects returned by this module.
That in-process identity check is serialization hygiene, not authenticity.
`verifyPAMRArtifact(text)` strictly parses and recomputes the entire trace; forged,
missing, duplicate, reordered or inconsistent steps/outputs/source bindings reject.
Successful reopening returns **verified_data**, not an admitted candidate or
capability. A fully recomputed different valid constructed request is another
inert artifact; digests cannot establish external source authenticity.

All artifacts explicitly state `effectScope: NONE`, dispatch/promotion false,
production CLOSED, operations DEFER, reference execution not performed and
authentication not established. No effect-producing API, public route, store,
provider call, new dependency or G05/G06 dispatch selector is added. Existing
kernel E/R/C/ack and sixteen-check behavior is untouched. Real SPY253 C07/C13/C14,
account/data/handling/settlement qualification and trading authority stay unknown
or held. G06 activation or adaptation/scaling of multi-asset weights needs a
separately scoped consumer decision; this increment grants neither.

## Changed files and verification

The four new worker files are `paper-conversion-contract.ts`, its test,
`pamr-reference-artifact.ts` and its test. `v2/IMPORT-MANIFEST.json` accounts for
these additions; this specification records the completion scope.

Synthetic tests cover exact hand-derived zero-loss/zero-norm/positive-loss and
fractional active-set results; independent exhaustive active-set oracles for 2–8
assets; permutations and causal prefixes; 64-row input; immutable deterministic
round-trip; altered source, parameters, state, ordering, duplicate/missing/future
steps and promotion; malformed/deep/oversized/duplicate JSON and finite resource
rejection. The independent oracle uses floating point only for small constructed
cross-checks, not the implementation or a qualification tolerance.

Delivery requires fresh independent and distinct adversarial reviews of the full
source, tests, inventory and this report, followed by exact-reviewed-head Linux
Go race/vet/build, V2 tests/typecheck/build/offline smoke, import inventory and diff
checks. Hosted scientific and applicable protected-browser checks must pass;
ordinary merge and post-merge checks preserve the reviewed tree. Check/review
receipts are delivery evidence, never executed-reference, performance, general
conversion, live handling or operational acceptance.
