---
type: specification-closeout
title: G06 standalone pure position-sizing proposals
status: candidate-awaiting-complete-source-reviews-and-exact-source-checks
date: 2026-10-14
---

# Pure sizing proposal

The owner explicitly approved the helper-only implementation after both original
reviewers passed contract revision2 SHA256
`559e7a1f91031b12d9223cd77dc4af57e8d3024be726e2adc2983ae78fda2f42`
(independent `01a13ba5-0307-72e8-bb56-43292ad7e9ea`, adversarial
`01a13ba5-1449-723f-8ef0-a8107dd61677`). This approval supersedes that immutable
planning artifact's earlier implementation-authority stop; it covers this helper,
constructed offline tests, inventory and closeout only.

`proposeShadowSizing` consumes one strict bounded JSON input with actual G05
input/receipt, existing configured simulation/portfolio schemas, declared
lifecycle disposition, independent reference observation, positive limits and
quantum, and an explicit evaluation timestamp. It replays G05, binds run/source,
full snapshot including revision/history, config/genesis/classification/units,
costs and calibration identity, then preserves UNKNOWN/unsettled/abstaining and
freshness/availability/expiry gates. Dirty or malformed decimals cannot initiate
arithmetic. Source/rights/portfolio declarations are not authenticated by a hash
or the pure helper; market evaluation remains not established.

Money/quantity arithmetic uses bounded exact decimal integers. Reference mark,
modeled fill price and order limit remain separate. Both modeled and limit-based
fee-inclusive caps and marked exposure ceilings apply; BUY cash reservation uses
the limit. Post-fill cash uses existing cumulative rounding8 and one fee per
hypothetical order, with quantity18. Hypotheticals are labelled full-fill at the
supplied mark; they are not actual fills, current live observations or a promise
of future-market exposure.

Underweight positive targets select the maximum feasible quantized BUY by bounded
integer binary search (at most128 iterations plus one next-lot assessment).
Modeled exact ceiling, quantum/limit underallocation and cash/cap underallocation
are distinct. Zero equity, already cash and equality produce no action/fee.
Overweight positive targets explicitly abstain, preserving the current adapter's
direction rule. Cash target proposes ALL settled quantity or abstains on quantum,
fee/cap/representability; it never clamps a partial exit, chunks orders, cancels
instead of sells, or schedules/retries effects.

The closed sizing receipt hashes its complete output and canonical whole-input
identity, covering rule bytes/receipt, config, full snapshot, observation, quantum,
limits, time and policy version. The replay comparator re-evaluates everything;
invalid/unbound correlations and malformed or tampered results fail closed.
No failed calculation exposes a partial side/quantity/hypothetical. All receipts
have no effect authority, no promotion and no market-evaluation claim.

Changed files: new `shadow-sizing-contract.ts`, `shadow-sizing.ts`,
`shadow-sizing.test.ts` under `v2/worker/src/`, their inventory entries in
`v2/IMPORT-MANIFEST.json`, and this closeout. No dependency changes. Existing
adapter/lifecycle/storage/transport/provider/runtime files are untouched and do
not import or consume the helper; no order/admission guard or execution route is
changed. A future consumer binding needs its own authorized review.

Constructed offline tests cover fee-aware quantity choices, distinct modeled and
limit prices, a small independent integer oracle, fractional rounding/quantum,
whole cash exits and no-action behavior, caps/UNKNOWN/receipt/snapshot/cost/time
fences, dirty/oversized/duplicate-key/malformed input, complete output identity,
replay/tampering and caller-declaration limits. They establish no licensed market
dataset, calibrated costs, prospective run, G07 controls or profitability.
Local dependencies are absent. No installation, local runtime tests, held
listener/ownership/cleanup/MCP/native/model probes, data retrieval or terms
acceptance is performed. Static inventory/whitespace and complete fresh original
independent/adversarial source reviews precede candidate hosted Go/Linux/science/
protected-browser checks, ordinary PR/merge and separate integrated verification.
Exact runtime results will be recorded in delivery PR/receipt; none is claimed
by this source-stage closeout. Existing simulator and route-specific holds remain.
