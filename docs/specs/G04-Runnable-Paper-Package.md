---
type: Specification and Completion Report
title: G04 hash-bound runnable numerical paper package
description: Selected Linux source ZIP, exclusive fresh extraction and real stdio case parity without agent/trade authority.
timestamp: 2026-10-13T00:00:00Z
status: candidate-awaiting-complete-review-and-exact-source-linux-ci
---

## Approved selected boundary

This delivers the existing covariance-only `min_variance` reference derived from
PyPortfolioOpt 1.6.0 commit `0186e707a0d2ec03406608d3400539d0f140c625` and the
bounded Paper2Agent workflow adaptation at
`8c2d059165ef8cdcb70dbea76655b9c2b55b38e6`. It selects no new paper, strategy,
dataset, model campaign or effect authority. The modern release remains distinct
from the paper's historical v1.4.1 archive. Original adapter/server/oracle/verify,
frozen lock and immutable published evidence byte hashes remain unchanged.
NOTICE and all four existing license texts are preserved verbatim; separately
resolved dependencies are not bundled. No new license grant is inferred for
Gelt-authored code or upstream paper text/figures.

The package is a deterministic ZIP containing exactly nineteen selected source,
test, project/lock, fixed-reference artifact and license files plus a generated
manifest. It excludes repository metadata, virtual environments, caches, caller
configuration, arbitrary source files and secrets. Normalized ZIP metadata and
source-byte hashes bind the declared checked-out source commit, immutable
canonical repository ID1415613140, upstream/workflow pins and supported lane.
These are integrity/provenance receipts from the reviewed producer, not signature
authentication or independent proof of every producer assertion.

## Fresh location and usability

`delivery.py` validates supported Linux CPython 3.12, source inventory/pins,
archive size, exact member set, regular-file type, unencrypted/stored encoding,
unique manifest keys and per-file hashes before fresh extraction. It never uses
generic extract-all, follows member traversal or symlinks, overwrites an existing
destination or repairs metadata. The destination must be a new absolute child of
an existing resolved parent. Writes are exclusive; uncertain partial output is
retained rather than deleted or relabeled successful. The external expected
archive SHA-256 must match before any destination is created.

The scientific CI gate builds the ZIP in a fresh runner-owned directory, extracts
into a separate new location, independently resolves that location's frozen lock,
runs its tests and trusted reference verifier, and records real stdio parity.
Its fresh receipt binds archive/source/lock/license/extraction/runtime identities,
the actual discovered tool/schema, negotiated protocol and each selected input/
result. Supported runtime is explicitly Linux CPython 3.12; CI pins 3.12.14 and
official uv0.12.19. The existing scrubbed trusted numerical launcher is reused;
it is not a general untrusted-code/model sandbox or Codex isolation GO proof.

## Actual tool/source case contract

The new receipt inventories nine successful finite-JSON calls: pinned fixture,
four scales, zero/singular/boundary matrices and permuted fixture. MCP results
are compared to independent direct pinned PyPortfolioOpt calls and active-set
oracle objectives, with feasibility/KKT certificates enforced. Unique optima
also compare weights; nonunique/boundary weights are not equated arbitrarily.

The maintained parity verifier checks the returned long-only, fully invested
vector at the adapter's existing `1e-8` feasibility limits, without changing
any weight. It independently evaluates the quadratic objective from that vector
and the request covariance divided by its maximum absolute entry. An exactly
zero matrix contributes zero. The verifier checks the reported variance and
both reference objectives with the existing `1e-8` normalized tolerance.
This applies to nonunique and boundary cases as well as unique cases. Reported
KKT checks remain in place. The verifier does not independently reproduce the
full dual or KKT certificate.

The parity verifier requires five reported magnitudes to be finite and within
their existing inclusive bounds. Budget, bound and normalized complementarity
magnitudes use `[0, 1e-8]`; normalized stationarity and dual-violation
magnitudes use `[0, 1e-7]`. Zero and negative zero are accepted and retained
as reported. This checks reported magnitudes without recomputing the full
certificate or changing the returned-weight and objective checks.

The correction touches `research/paper2agent/parity.py`, its in-memory
regressions in `research/paper2agent/test_delivery.py`, and this specification.
The cases isolate budget, bounds and variance failures, and accept unequal
feasible vectors at the same nonunique optimum. All six frozen pins and all
three committed evidence files retain their original bytes. Exact-source
verification and reviews of this correction are tracked in the delivery packet.

Eighteen finite-JSON error calls compare direct adapter rejection with actual
MCP error results. They cover the twelve JSON-representable invalid-input
mutations, positive-diagonal indefinite PSD matrix `[[1,2],[2,1]]`, and five
negative-diagonal/tiny-scale/subnormal/normalization-loss cases. Inputs and
semantic MCP output hashes are retained; error content is hashed, without raw
exception text. The actual tool schema is recorded, with numerical constraints
still enforced by Request validation rather than inferred from a raw dict schema.

Python-only NaN/Infinity rejection is reported separately. Those values are not
standard JSON numbers; no on-wire tool parity or SDK encoding equivalence is
claimed. The selected delivered MCP contract is finite JSON, not an unqualified
claim that fourteen Python mutations were all identical transported requests.
The positive-diagonal indefinite rejection has an explicit direct/real-MCP test.

## Returned-weight parity correction closeout

The correction touches `research/paper2agent/parity.py`,
`research/paper2agent/test_delivery.py`, and this specification. Parity verifies
the returned vector's feasibility and recomputes its normalized objective.
The verifier retains the existing reported KKT and unique-weight checks.
This does not independently validate the full dual or KKT certificate.

Separate independent functional and adversarial reviews accepted the complete
implementation diff at `6eadc69b072340b5b177c66d7a9de491a6d36ae2` with no blocker
or high-severity findings. Both noted that the self-consistent suboptimal-vector
test could also fail the older reported-variance comparison. A test-only
follow-up at `6bb6e4185a9a24a2f8ed3471c85fb09aa4b9b6a7` isolates the new check:
the reported-to-reference and recomputed-to-reported differences are each
within `1e-8`, while the recomputed-to-reference difference exceeds `1e-8`.
The focused test passed, and fresh independent functional and adversarial
reviews accepted the test-only delta with no blocker or high-severity findings.

Local verification of the initial reviewed implementation passed 24 focused
tests, 51 source tests, and 51 tests from a fresh candidate-bound extraction.
The fresh package verified 19 files and passed 18 reference comparisons and
27 finite-JSON stdio parity cases. Go race, vet, and build passed. Linux V2
server, worker/web, script, build, offline smoke and protected HTTP checks
passed, with 28 Windows-only skips in worker/web. All four protected synthetic
browser flows passed on nonroot vendor Chrome with its native sandbox and
Playwright 1.56.1. The captured narrow research view showed a partly clipped
table column within its scroll region. All six frozen package pins and three
committed archived artifacts matched the base.

The results above are evidence for their named predecessor commits. Fresh
final reviews, exact-source local reruns and hosted CI remain delivery gates.
The evidence is scoped to the offline numerical reference and synthetic
fixtures, with no claim of strategy, promotion, shadow or execution readiness.

## Reported certificate magnitudes closeout

This follow-up changes `research/paper2agent/parity.py`,
`research/paper2agent/test_delivery.py`, and this specification. It checks the
five reported certificate magnitudes against zero and their existing upper
limits before constructing a receipt. It preserves signed zero, upper-limit
acceptance, returned-weight feasibility, objective comparisons and the
existing unique-weight rules. The change does not independently recalculate
the full certificate.

At pinned master `e295741abcb73d2012af544c0c8ffe324e532d75`, an in-memory
test overlay observed that a negative finite value in any of the five fields
passed the old check. Five negative cases failed the rejection assertion and
the other 40 cases passed. This does not establish that the pinned adapter
ever reported a negative magnitude.

At `256efc5f104336903cbe964743e68f755510d109`, all 45 new cases passed, along
with 25 existing focused parity cases. The Go race, vet and build checks,
Linux V2 tests/build/offline smoke/protected HTTP checks, and four protected
synthetic browser flows passed. The offline scientific source and fresh
extraction each passed 97 tests, with 18 reference comparisons and 27 stdio
parity cases. All six frozen pins and three archives matched the base.
Separate independent functional and adversarial reviews reported no blocker
or high-severity issues at that implementation commit.

These results are evidence for the named predecessor. The specification
closeout requires fresh final reviews and exact-head checks before delivery.
The evidence covers the offline numerical tool and synthetic fixtures.

## Historical verification and acceptance limits

Changed files: delivery/parity helpers, focused archive safety tests, adapter's
additional direct/stdio PSD test, README, scientific workflow and this spec.
Independent review found and corrected a mistyped immutable server digest in
`delivery.py`; the original server bytes were unchanged. The earlier all-pin
verification claim was inaccurate. A fresh static comparison of the literal
manifest pins against all six actual source/lock/evidence files now passes.
AST syntax and whitespace checks
passed; no local dependency installation, source execution, listener/ownership/
cleanup probe or held original runtime action ran. Archive safety tests verify
deterministic bytes, independent fresh extraction, retained existing content,
and traversal/symlink/member/digest rejection before destination materialization.

The Linux-only support change was separately reviewed and merged as
`d24963795bb4fa28c8d8a2b563478762eb914319`, with candidate and integrated Go/Linux/
scientific gates passing. Windows code/tests and unresolved failures remain
unsupported historical material; no Windows run or pass is required/claimed.
Complete fresh independent/adversarial reviews of this entire final diff and
named actual extraction/stdio/validation callers precede new exact-source Go,
Linux V2/browser and scientific package gates. Accepted findings trigger a full
new loop. Candidate and integrated receipts remain separate; old source replay
is not transferred as new-location package acceptance.

Owner session/store consumption, supported isolated headless Codex decisions,
live market data, simulated autonomous executions and shadow observations remain
downstream. G05 still requires affirmative subscription/isolation GO and exact
input/package/tool/producer-consumer bindings; this package supplies no such GO
or order authority. No real money or per-trade human confirmation requirement is
introduced. Auth, ledger, UNKNOWN fences and market/production code are unchanged.
