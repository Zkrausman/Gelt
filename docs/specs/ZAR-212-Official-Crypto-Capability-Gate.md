---
type: specification
title: "ZAR-212: Official Crypto Capability Gate"
status: evidence-ready-for-review
implementation_status: documentation-only
historical_technical_recommendation: HOLD
historical_owner_decision: PENDING
current_owner_decision: "GO — owner addendum 2026-09-18"
historical_issue_status: In Progress
historical_next_gate: "ZAR-213 blocked"
current_next_gate: "ZAR-213 bounded M2 foundation authorized"
issue: "https://linear.app/geltagentictrading/issue/ZAR-212"
original_baseline: "3e35dcd4799b92aa419e8adf3c782ed91d335778"
evidence_source: "Parent-supplied sanitized host receipts E1-E7; reconciled intake 2026-09-18"
changed_files:
  - docs/specs/ZAR-212-Official-Crypto-Capability-Gate.md
  - docs/reports/zar-212/README.md
  - .llm-wiki/wiki/concepts/official-crypto-capability-gate.md
---

# ZAR-212: Official crypto capability gate

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
[M2 specification](ZAR-213-V2-Baseline.md) for preservation, local-only architecture and pending parent
publication/review gates. All following original M1 restrictions and decision
records describe their historical assessment context, not a new current blocker.

## Historical M1 assessment (preserved)

## Scope, authority and disposition

This is a documentation/evidence-only M1 assessment using supplied receipts, **not** a broker probe or runtime implementation. The unchanged [ZAR-211 specification](ZAR-211-Scope-Runtime-Release-Gates.md) governs scope, Node/TypeScript worker, sole-writer SQLite ledger, exact decimals, fee-inclusive $10 ceiling and release sequence. Intake reports ZAR-211 Done and owner-approved PR455 merged at this ticket's original baseline `3e35dcd4799b92aa419e8adf3c782ed91d335778`.

**Technical recommendation: HOLD. Owner GO/NO-GO: PENDING. ZAR-212: In Progress. ZAR-213: blocked.** Routing, read-only quotes, catalog constraints and small previews have parent-observed evidence, but real detail/fill identity, replay/retention and safe unknown-submission recovery remain materially unverified. HOLD does not assert unsupported broker behavior; it prevents feasibility being assumed from preview success. Missing evidence must not be manufactured through live actions.

The owner authorized normal Squire delivery to an evidence PR even while owner review is pending. Reviewed documentation is not capability acceptance. Do not mark Done, declare GO, merge, preserve/reset/import, execute downstream work or trade/cancel/fund. No credentials, host access, unofficial APIs, production/test/CI/dependency/AGENTS/policy changes are included. Existing Go guardrails and CI remain unchanged.

## Delivered assessment

The [consolidated report](../reports/zar-212/README.md) contains:

- E1–E7 provenance and classifications: parent-observed, documented, unverified. It is normalized transcription, not raw captures or sandbox broker telemetry.
- Full inventory of supplied input and relevant response fields for accounts, previews, place, order reads, cancel, quotes and pair catalog; types/requiredness/conditional rules and absent exact-schema details explicitly marked unknown.
- Account redactions and RHS routing; historical quote/preview/constraint snapshots; non-executing preview identity limits and catalog cursor behavior.
- Dollar-amount LIMIT BUY as the only proposed bounded-spend candidate, not an owner-selected order. Market collar exposure and stop substitution are excluded. Both base and quote decimal constraints and fresh fee-inclusive checks are required later.
- Prospective durable intent/ref_id, conservative restart/retry boundaries, bounded cursor/time reconciliation and manual escalation. Unknown stays blocked/reconciling; documented replay guidance is not tested recovery or retry authority.
- Cancellation/partial-fill races and actual detail/execution evidence needs. Empty BTC-USD history does not establish no fills across all assets/accounts.
- Actionable HOLD gaps, safe next evidence sources and an explicit pending owner decision record.

This report does not change the approved runtime or build it. No broker fixtures, fabricated fills, operational captures or transient identifiers are committed. Durable knowledge is recorded only in the target worktree's [wiki concept](../../.llm-wiki/wiki/concepts/official-crypto-capability-gate.md); no host/personal wiki was consulted or imported.

## Acceptance boundaries and next evidence

Documentation is ready for fresh delivery review; the **capability gate is not accepted**. Before reconsidering HOLD, supply official full schemas and redacted pre-existing detail/execution evidence, establish stable fill/intent identity and fee accounting, and obtain official replay/retention and safe bounded unknown-outcome recovery semantics. See the report's gap matrix. Existing history from another asset/account cannot be ruled out by the empty BTC-USD query, but no new broker access is authorized here. Do not place or cancel an order to obtain evidence.

After sufficient evidence, owner review must explicitly record GO/NO-GO and its provenance. Absent GO, ZAR-213 stays blocked; unsupported contracts require stop or explicit re-scope. Even a future capability GO does not bypass ZAR-219 offline safety, ZAR-220 fresh exact-order approval, ZAR-221 supervised execution/reconciliation or ZAR-222 owner acceptance. Failed/unknown/unfilled outcomes are not successful filled-trade acceptance.

## Changed files

The YAML `changed_files` list is the complete intended original-baseline scope:

- `docs/specs/ZAR-212-Official-Crypto-Capability-Gate.md` — scope, decision boundary, verification and closeout.
- `docs/reports/zar-212/README.md` — normalized evidence, field matrices, constraints, risks and pending owner decision.
- `.llm-wiki/wiki/concepts/official-crypto-capability-gate.md` — durable evidence/reconciliation/authority constraints.

No optional roadmap change is needed. ZAR-211 remains unchanged. This cumulative scope is measured against `3e35dcd4799b92aa419e8adf3c782ed91d335778`, not a latest-pass delta; no previous failed candidate was imported.

## Verification and delivery closeout

### Precommit receipts

Checks ran from Linux `/ticket/workspace` with HEAD at the original baseline and the three documentation additions in the working tree. These results verify the existing Go checkout and documentation hygiene, **not broker feasibility**, and are not receipts for the subsequent commit. Terminal output and exit statuses were inspected.

| Command / inspection | Actual result |
| --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | PASS, exit 0; uncached initial run, all tested packages passed, pkg/ai has no tests; no detected races (pkg/shadow 8.826s). |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | PASS, exit 0, no diagnostics. |
| `GOTOOLCHAIN=go1.26.1 go build -v ./...` | PASS, exit 0. |
| Specification YAML | PASS using existing `gopkg.in/yaml.v3` via a temporary sandbox validator outside the repository; required metadata, HOLD/PENDING and complete changed-file list checked. No dependency changes. |
| Relative Markdown links | PASS for all three intended files using Python standard library; local targets resolve. External provenance URLs were not probed. |
| `git diff --check` and `git diff --cached --check` | PASS, exit 0; staged check includes the new files. |
| Original-baseline cumulative diff self-review | Exactly the three paths listed above; E1–E7 values/classification, redactions, unknown schema details and authority boundaries cross-checked against intake. No production/test/CI/dependency/policy or ZAR-211 changes. This is Implement self-review, not independent Review. |
| `git status --short --untracked-files=all` / untracked inventory | Three intended additions staged; no other nonignored untracked files. Ignored-file inventory found test-generated `pkg/server/gelt_journal.db`, removed before commit and to be removed again if exact-head tests recreate it. The new wiki path is covered by the existing wiki ignore rule and was explicitly staged without changing that rule. Temporary validator is outside the repository; no operational artifact committed. |

Required commands will be rerun after commit with a clean final `git status --short`; those exact-head receipts are reported through phase output.

Post-commit exact-head checks belong in Implement phase output and subsequent fresh verification, not recursive evidence commits. Fresh independent Squire **Review** must assess correctness; a distinct fresh adversarial **Test** must verify final exact head and both must explicitly clear blocker/high findings through normal remediation. Neither has passed merely because Implement checks succeed. Publication, actual PR base/head/App identity, terminal exact-head CI and lock release remain parent/controller-owned; no such receipt is claimed here. Stop at verified PR delivery, not merge, owner GO or issue Done.
