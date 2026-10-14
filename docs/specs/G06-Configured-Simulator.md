---
type: specification-closeout
title: G06 direction-linked configured simulator capability
status: candidate-awaiting-final-source-reviews-and-hosted-checks
date: 2026-10-14
---

# Configured simulated execution

The owner authorized upgrading the existing isolated simulator with real
simulated SELL exits, configurable declared execution economics and cash/position
reconciliation. Both original reviewers accepted contract revision3 before code:
SHA256 `3f4a808c8f4f7956213f5902cb3065e3620c4b747a344508f23509af6cbb2990`,
independent turn `01a13b40-8af0-77fa-966e-d5deb9122ad6`, adversarial
`01a13b44-92ad-7729-928f-3c25dd9841a2`. Prior freshness, rounding/reservations,
decision-consumption and fill-bound findings are part of that accepted contract.

This delivery adds an explicit version2 mode to the existing application mock
store, adapter, closed loopback transport and test harness. Default version1
fixtures/rows remain supported unchanged. Configured databases bind the immutable
canonical run config/hash, keep the same private LedgerStorage connection and
ownership/WAL/FULL/poison rules, and refuse incompatible mode/config reopen with
no migration/reset. No second store/engine, provider, model, dependency upgrade,
production service or live account path is introduced.

The config freezes synthetic run/instrument/source identity, labelled genesis
cash/quantity, per-order commission, full per-side spread/slippage fractions,
calibration digest, caller-supplied freshness/validity bounds and exact rounding.
Declared economics/provenance are not independently calibrated market evidence.
Prices use exact rational P*(1+spread+slippage) for BUY, ceil to8 digits;
SELL uses P*(1-spread-slippage), floor to8 digits, rejecting nonpositive results.
Cash rounds cumulative observed notional per order, not each fill separately.
Commission is charged once at the first observed fill, never merely requested.
BUY reserves limit notional plus commission; SELL reserves quantity and commission
cash. All terms and actual cumulative notional remain fee-inclusive <=USD10.
Every observed/replayed fill enforces BUYprice<=limit, SELLprice>=limit and
cumulative filled quantity<=requested. Invalid observations add no event or
portfolio change. Partial fills, cancellation acknowledgement and later fills
remain distinct; cancellation never liquidates holdings or credits cash.

Actual portfolio snapshots replay genesis and global ordered execution facts,
then compare the stored projection on every transaction/read/reopen. Revision and
history digest distinguish equal balances with different histories. Actual cash
and quantities use bounded exact decimal strings; no requested amount/status
becomes a fill or P&L. Reservations are disposition state separate from the
persisted actual-fact snapshot. One unsettled order/admission is allowed.
Decision IDs are consumed durably at admission; unused configured admissions
remain bounded tombstones even after expiry/cancellation/restart. Exact dispatch
and fill duplicates add no effect; changed payloads or reused identities reject.
Persistence uncertainty poisons and keeps ownership. Response-loss lifecycle
UNKNOWN remains fenced across restart and cannot resume/redispatch automatically.

A local producer callback supplies G05 bytes/receipt and a separately timestamped
execution-price observation. The adapter replays the actual G05 rule, validates
run/source/instrument/cost/direction and current portfolio snapshot bindings,
then uses existing preview/confirmation/claim/exclusive-generation machinery.
Only the configured offline test harness can opt into synthetic SELL terms;
public/default preview schema and lifecycle remain buy-only. This is explicitly
DIRECTION-LINKED simulator capability: caller quantities are bounded but this
slice does not implement G05 target-allocation sizing or G07 scheduling/pause.

Changed source: synthetic-simulation-economics.ts and synthetic-simulation.test.ts;
existing synthetic-mock-robinhood contract/storage/transport/adapter,
synthetic-order-harness.ts and order-lifecycle.ts; import inventory and this report.
Existing tests remain unchanged. New constructed offline cases cover actual
G05-generated entry/exit through lifecycle/transport, two cost policies, partial
cancel/late fills, cumulative rounding, directional limits/quantity/cash/caps,
duplicate/consumption/restart/corruption and UNKNOWN fences. They are simulator
unit/integration evidence, never prospective market or profitability acceptance.
Local dependencies are absent; no local installation, runtime tests, held
listener/ownership/cleanup/native/MCP/model probes or unchanged failed CI reruns
are performed. Complete final source reviews and normal exact-source hosted
Go/Linux/scientific/protected-browser checks, ordinary merge and separate
integrated proof remain required. Candidate/integrated results will be recorded
in the delivery PR/receipt without relabeling this source-stage report.

Eligible dataset/instrument, justified market cost/control calibration and
allocation sizing remain prerequisites for genuine G06 shadow acceptance.
Original selected MCP/recovery/native/inference/source-access holds remain on
those routes. No held-route workaround, live money or automatic-promotion
implementation is authorized by this simulated capability.
