# Official crypto capability evidence and gate boundaries

## Superseding owner decision — 2026-09-18 (M2 intake)

**Current capability disposition: owner-reviewed GO for bounded ZAR-213 M2.**
The reconciled owner intake reports PR456 merged at
`357f0dbbd853848484a6afe2773f6a7ac3c9fe2d` and the dated
[ZAR-212 owner decision](https://linear.app/geltagentictrading/issue/ZAR-212).
OpenTerminal supplies market/analysis; the separate worker owns future application
safeguards; official Robinhood MCP supplies broker execution/status primitives.
The owner reports having tested trading: this is **owner attestation**, not
independently captured fills or additional E1–E7 evidence. Historical observations,
unknowns and the original technical HOLD remain unchanged below. This addendum
supersedes only the earlier HOLD/PENDING/blocked **disposition**, not its evidence.

Only additive, non-executing foundation work is authorized here. No live actions,
credentials, order/ledger implementation or merge is authorized. See the
[M2 specification](../../../docs/specs/ZAR-213-V2-Baseline.md) for preservation, local-only architecture and pending parent
publication/review gates. All following original M1 restrictions and decision
records describe their historical assessment context, not a new current blocker.

## Historical M1 assessment (preserved)

Authority: unchanged [ZAR-211 scope/runtime/release gates](../../../docs/specs/ZAR-211-Scope-Runtime-Release-Gates.md). Capability assessment: [ZAR-212 specification](../../../docs/specs/ZAR-212-Official-Crypto-Capability-Gate.md) and [normalized evidence report](../../../docs/reports/zar-212/README.md).

- Distinguish parent-observed authenticated receipts, documented contracts and unverified guarantees. Sanitized transcriptions are not sandbox observations or raw captures. Keep account/preview identifiers redacted; public pair metadata is different from account identity. Missing exact schema details remain unknown, not inferred wire contracts.
- Account visibility is not agent trading eligibility. Supplied official crypto contracts route via `rhs_account_number`, not linked `rhc_account_number`.
- Preview is non-executing despite order-shaped fields and new/open states. Its transient ref_id is never a durable client identity, order or fill. Historical quote/fee/constraint snapshots are not fresh execution inputs.
- Only the documented dollar-amount LIMIT BUY debit bound supports a candidate under the fee-inclusive $10 ceiling; market collar exposure and stop substitution are not acceptable substitutes. Exact decimal base/quote constraints and fresh fees/eligibility still apply. No automatic funding, cap increase or fill guarantee.
- Future sole-writer worker must persist logical intent and its own stable UUID before dispatch, preserving identity across restart. Documented same-ref transient retry guidance does not prove replay/retention or authorize resubmission of an unknown outcome. Unknown remains blocked/reconciling; no exposed ref_id lookup filter or proven list echo exists in the supplied evidence.
- Reconciliation needs bounded, recorded time/cursor searches and manual escalation without guessing identity. Empty pages with continuation are not exhaustion; empty symbol history is not proof of no history across assets/accounts or no submission. Cancel races and detail-only executions require actual broker evidence, never preview-based fill accounting.
- Delivery approval and capability acceptance are separate. ZAR-212's technical HOLD identifies feasibility evidence gaps; only an explicit owner-reviewed capability GO can unblock ZAR-213. An evidence PR, local tests or independent delivery review do not grant GO, downstream implementation or live-action authority. Exact-order authorization and supervised execution remain later gates.

Keep transient market snapshots and the actionable evidence-gap matrix in the report, not duplicated here. No runtime, broker calls or fallback APIs are introduced by this documentation.
