---
type: specification
title: "ZAR-211: MVP Scope, Runtime and Release Gates"
status: planning-approved
implementation_status: product-not-started
issue: "https://linear.app/geltagentictrading/issue/ZAR-211/mvp-0-approve-mvp-scope-execution-runtime-and-release-gates"
approval_source: "Explicit owner chat approval relayed in the ticket intake, 2026-09-17; delivery authority renewed 2026-09-18"
timestamp: 2026-09-18T00:00:00Z
---

# ZAR-211: MVP scope, runtime and release gates

## Decision and approval provenance

This is the approved M0 decision record for the [execution-first MVP epic (ZAR-210)](https://linear.app/geltagentictrading/issue/ZAR-210), not a competing proposal or product implementation. The owner explicitly approved all six choices below in chat, as relayed by the reconciled ticket intake on 2026-09-17, and delegated bounded decisions through a merge-ready PR using mandatory Squire delivery (renewed 2026-09-18). This attribution is the approval record; it is **not a cryptographic signature** or evidence of release acceptance.

The deliverable is specification/roadmap/wiki documentation, minimal Go CI correction and test-only offline daemon fixture repair. No broker/account access, capability probe, trade/cancel/funding, V2 implementation, reset/import, preservation publication, deployment, merge or backlog retirement is performed or authorized. This ticket has no prerequisite gate. Do not mark it Done or declare merge-ready before the parent verifies delivery evidence.

## Six approved decisions

1. **Scope:** one local owner, one account, one crypto pair and one broker-supported order type; manually confirmed bounded **BUY** only. Cancellation, halt-new-orders, unknown-outcome reconciliation, durable execution history/timeline and restart recovery are required. Strategies, automatic trading, SELL, research/Paper2Agent, cloud/multiuser and Squire in the **product** are excluded. Squire is mandatory **development delivery orchestration**, not a product component or a fee-bearing execution assumption.
2. **Runtime:** OpenTerminal-derived Next.js/React workspace with a separate Node/TypeScript execution worker. The worker has independent execution authority and is the sole writer of the SQLite execution ledger. Authenticated same-origin BFF routes enforce session, Origin, Host and CSRF controls. The worker exposes only a narrow, versioned, runtime-validated API. Broker credentials stay in a worker-side credential vault. No generic tool passthrough and no legacy order fallback. Use exact decimal money and actual broker evidence only.
3. **Chart criterion:** execution timeline is mandatory. Candle-chart markers are conditional on verified instrument and quote-currency compatibility; incompatible or unverified chart data must not be presented as corresponding broker execution evidence. A missing compatible candle chart does not waive the timeline requirement.
4. **Preservation:** retain V1 history in this repository. Candidate preservation baseline is master `ce1c4a48e6e76e4ce1284707da9c6b4d8a8c7f7c`, subject to revalidation and approval at ZAR-213. No preservation tag/branch publication or reset now. The planning decision is not permission to discard legacy history or guardrails.
5. **Capital:** propose **at most $10 total including fees**, subject to verified broker minimums/fees and later fresh exact-order authorization. If a supported order cannot fit, stop and return for an explicit decision. No automatic cap increase, funding, guaranteed fill or automatic SELL.
6. **Release gates:** owner-reviewed ZAR-212 capability GO before ZAR-213 baseline work; ZAR-219 integrated offline safety gate; ZAR-220 separate exact-order approval; ZAR-221 supervised execution/reconciliation; ZAR-222 explicit owner acceptance. Failed, unknown or no-fill outcomes are not silently successful filled-trade acceptance. ZAR-209 remains post-MVP.

## Runtime and typed service contract

These are requirements for later implementation, not claims that routes, schemas, vault or ledger exist in this Go checkout.

| Boundary | Required contract and authority |
| --- | --- |
| React workspace → Next.js BFF | Explicit application routes for preview, confirmation/submission, cancellation, halt-new-orders, reconciliation and history/status, not an arbitrary broker/MCP proxy. Authenticate the local owner's session; validate allowed same-origin Origin and Host and CSRF protection for mutations. Browser state or a confirmation click alone does not confer worker authority. |
| BFF → Node/TypeScript worker | Private authenticated service boundary, independently authorized by the worker. Narrow versioned request/response schemas with runtime validation on ingress and egress, not TypeScript types alone. Reject unsupported versions/operations and invalid account, pair, order type, amounts or authority. No generic tool-name/payload passthrough. Concrete route names and schema definitions belong to later contract work. |
| Execution commands | Explicit operation/request identity, owner/account/instrument identity, exact decimal amounts and currency, selected supported order type, bounded fee-inclusive intent, and confirmation/authorization association. Preview does not submit; submission requires the later exact-order authority. Preserve deduplication identity through retries/restarts; ambiguous submission outcomes require reconciliation, not a blind repeat order. |
| Worker → broker | Worker-side credential vault only; no secrets in browser/BFF payloads, execution history or logs. Verified official broker capabilities/evidence govern support. No fallback to legacy Go order paths or assumed synthetic broker success. Cancellation is a request requiring reconciliation, not proof that a fill cannot have occurred. Halt-new-orders is distinct from liquidation or guaranteed cancellation. |
| Worker → SQLite | Sole execution-ledger writer; UI/BFF cannot author execution truth. Durably record intent, authorization association, broker request/response identifiers, outcome/unknown state and reconciliation history sufficient for restart recovery and the required timeline. Derive status from recorded evidence; do not turn missing evidence into a fill. |
| Numeric and presentation boundary | Exact decimal representation with explicit currency/units for money/quantities; no binary floating-point money calculations. Preserve actual broker fees, quantities and outcomes with provenance. Distinguish pending/unknown/rejected/canceled/unfilled from broker-confirmed fills. Conditional candle annotations must match verified instrument/quote currency. |

Runtime selection does not migrate today's repository charter: current Go guardrails, offline backtesting, fail-closed trading and zero-fake-telemetry constraints remain active until an explicitly approved later V2 charter migration. No AGENTS.md or delivery-policy rewrite is included.

## Authority and evidence gates

| Ticket / gate | Evidence required and boundary |
| --- | --- |
| [ZAR-211 / M0](https://linear.app/geltagentictrading/issue/ZAR-211) | This approved planning record plus reviewed delivery evidence. Planning approval only; no account access or live action. |
| [ZAR-212 / M1](https://linear.app/geltagentictrading/issue/ZAR-212) | Separately scoped official Robinhood MCP crypto read-only capability verification and owner-reviewed GO. This ticket does not execute that probe. Missing support is a stop, not fallback authority. |
| [ZAR-213 / M2](https://linear.app/geltagentictrading/issue/ZAR-213) | After capability GO, revalidate/approve V1 preservation baseline and reviewed OpenTerminal-derived V2 foundation, including MIT and dependency notices. No reset/import or preservation publication under M0. |
| [ZAR-214](https://linear.app/geltagentictrading/issue/ZAR-214)–[ZAR-218](https://linear.app/geltagentictrading/issue/ZAR-218) | Separately reviewed implementation/contract work under the DAG below; runtime selection is not permission to implement it in M0. |
| [ZAR-219 / M8](https://linear.app/geltagentictrading/issue/ZAR-219) | Integrated offline safety, recovery and UI acceptance gate. Passing isolated fixtures here does not satisfy M8. |
| [ZAR-220 / M9](https://linear.app/geltagentictrading/issue/ZAR-220) | Separate fresh owner authorization of the exact bounded order after prior gates. The proposed $10 ceiling is not this authorization. |
| [ZAR-221 / M10](https://linear.app/geltagentictrading/issue/ZAR-221) | Separately authorized supervised trade and durable broker reconciliation. Unknown, failed or unfilled outcomes stay explicit and cannot be labeled successful filled-trade acceptance. |
| [ZAR-222 / M11](https://linear.app/geltagentictrading/issue/ZAR-222) | Explicit owner acceptance of the release and stable research handoff. Not implied by a CI pass or an order attempt. |
| [ZAR-210](https://linear.app/geltagentictrading/issue/ZAR-210) → [ZAR-209](https://linear.app/geltagentictrading/issue/ZAR-209) | Execution-first MVP acceptance precedes the post-MVP research-to-shadow milestone and its entry work [ZAR-223](https://linear.app/geltagentictrading/issue/ZAR-223)/[ZAR-224](https://linear.app/geltagentictrading/issue/ZAR-224). No research auto-promotion authority. |

Live blocked-by DAG (IDs shortened only for readability):

```text
211 → 212 → 213
213 → 214,215
214 + 215 → 216
214 → 217
215 → 218
216 + 217 + 218 → 219 → 220 → 221 → 222 → 210 → 209
post-MVP entry tickets: 223/224
```

Dependencies are real Linear blocked-by links. Parent epics are organizational, not blockers on their own children. Simplified serial draft diagrams do not override this DAG. Do not close a gate to bypass missing evidence.

## Source reconciliation and preservation provenance

- Actionable source: reconciled owner-approved ticket intake. External proposal files and native diagrams remain outside this repository and are not required sandbox inputs.
- Public upstream audited pin supplied by intake: `ErTasselli/OpenTerminal` at `6feb4869489c8ac9537b1405547983591e1d3263`. No clone/import now; MIT plus dependency-notice review remains ZAR-213 work.
- PR430 merge `ce1c4a48e6e76e4ce1284707da9c6b4d8a8c7f7c` only adds ZAR-209 documentation to earlier proposal baseline `ffbe75f0eb4fa6c2ff64f321e022877218de1141`. Preserve the existing [ZAR-209 specification](ZAR-209-Research-to-Shadow.md) as post-MVP context; its strategy-runtime decision remains separate from this execution-runtime choice.
- [Roadmap](../ROADMAP.md) now places execution-first MVP before research, retaining legacy history. Historical automatic-promotion, cloud and live-action descriptions do not grant current MVP authority.

## Implemented verification enablement

CI now covers actual default `master` for push and PR, pins Go `1.26.1` (compatible with `go.mod`'s `1.25.0`), retains dependency/build/race tests and adds vet. No secrets, deployment, auto-merge or npm workflow is added.

Test-only changes in `pkg/shadow/daemon_test.go` cover GracefulShutdown, SignalHandling, AutoSpawnOrchestratorLifecycle and JSONLogging:

- Isolate HOME, USERPROFILE and GELT_BEADS_BRAIN_PATH **before** DefaultEnsembleConfig, use a fresh empty journal and nil watch symbols. Use non-session duration mode (`1h`) so wall-clock market close cannot end the lifecycle before cancellation/signal testing.
- Register failure-safe cleanup before each launch, after environment/output/resource cleanup registration. Cleanup cancels and boundedly joins before those resources restore. Store the result before closing a done notification, permitting repeated body/cleanup waits with synchronized error reads.
- Poll durable RUNNING/current PID (after signal registration) at 1ms intervals, with 5s readiness/completion bounds and early-exit detection. No fixed startup/cancel sleeps. Verify STOPPED/PID 0 and propagate RunBackground errors. Retain actual Linux os.Interrupt delivery and the no-orchestrator assertion.
- JSONLogging captures stdout to a temporary file before NewDaemon; read only after completion and restore/close output only after lifecycle cleanup. Assert valid structured JSON, startup message, daemon component and INFO level; no pipe deadlock or ignored run error.
- Helper regressions cover repeated waits, readiness/completion timeouts followed by cleanup cancel/join, early return and resource cleanup ordering. Bounded subprocesses exercise intentional Fatal with a real offline daemon and environment/output ordering, early-error propagation to both body and cleanup, and an unjoinable worker. Cleanup timeout hard-fails the test process instead of restoring shared resources around a live worker. Parent child-process waits are bounded at 20s.

Production `daemon.go` and trading code are unchanged. These are scoped fixtures, not a claim to redesign or verify every daemon/internal goroutine. Existing production fail-closed behavior and Linux signal coverage remain intact. Deployment scripts are unchanged: the intake's CRLF archive transport issue was not a faithful-checkout defect.

## Changed files

- `docs/specs/ZAR-211-Scope-Runtime-Release-Gates.md` — approved decisions, contract, authority and verification closeout.
- `docs/ROADMAP.md` — execution-first precedence with retained history.
- `.github/workflows/ci.yml` — master, Go 1.26.1, vet; retain build/race checks.
- `pkg/shadow/daemon_test.go` — scoped offline lifecycle fixtures and cleanup regressions only.
- `.llm-wiki/wiki/concepts/zar-211-scope-runtime-release-gates.md` — durable planning/authority knowledge.
- `.llm-wiki/wiki/concepts/shadow-daemon-offline-test-lifecycle.md` — durable test isolation/lifecycle constraints.

## Verification evidence and closeout boundary

Evidence is from Linux `/ticket/workspace`, not prior PR430 Windows results. Original ticket baseline is `ce1c4a48e6e76e4ce1284707da9c6b4d8a8c7f7c`; prior failed candidates were not imported.

The intake reports a native baseline failure in SignalHandling (`market data unavailable: missing or unauthenticated MCP config`). This phase's inspection confirmed default watch symbols and pre-isolation configuration in that fixture; it did not rerun the unsafe baseline fixture. The repaired fixtures remove that unintended market-data dependency without weakening production checks.

The first focused race run of this implementation failed in the intentional-Fatal child: the daemon exited successfully before readiness, so the child never reached the expected Fatal. Investigation found default `DurationMode="session"` can finish at equity market close. Setting the test fixture to non-session `1h` removed wall-clock dependence. Subsequent focused race and 20-repeat lifecycle/signal checks passed. This is actual failure/remediation evidence, not a suppressed failure.

### Pre-evidence-commit results (2026-09-18, Linux)

These checks tested the working-tree candidate, not the later evidence commit. Terminal outputs and exit statuses were inspected; all commands below passed after the fixture remediation above.

| Command / inspection | Actual result |
| --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./pkg/shadow -run 'TestDaemon_(GracefulShutdown\|SignalHandling\|AutoSpawnOrchestratorLifecycle\|JSONLogging)$\|TestDaemonTestRun_' -count=1` | PASS, including expected-failure subprocess assertions (latest run 6.113s). |
| `GOTOOLCHAIN=go1.26.1 go test -race ./pkg/shadow -run 'TestDaemon_(GracefulShutdown\|SignalHandling\|AutoSpawnOrchestratorLifecycle\|JSONLogging)$' -count=20` | PASS, including 20 real Linux interrupt deliveries (latest run 1.720s). |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | PASS across all tested packages; pkg/ai has no tests. First full run uncached; latest rerun rebuilt shadow after stronger cleanup-order assertions (9.155s), other packages cached. No detected races. |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | PASS, no diagnostics. |
| `GOTOOLCHAIN=go1.26.1 go build ./...` | PASS, no diagnostics. |
| Specification frontmatter and CI YAML parsing | PASS using the existing Go `gopkg.in/yaml.v3` dependency via a temporary sandbox-only validator. Initial optional Python validator could not run because PyYAML is absent; no dependency or repository change was made for it. |
| `git diff --check` | PASS. |
| Cumulative original-baseline diff inspection | Only the six listed documentation/wiki/CI/test paths are intended. No production daemon/trading, deployment, go.mod, AGENTS.md or delivery-policy changes. This is Implement inspection, not independent Review. |

The worktree contains these intended changes before commit; a clean status is required after committing. Post-commit exact-head receipts belong to phase output and subsequent fresh verification, not a retroactive claim about these earlier commands. Final-head checks will be rerun after the evidence commit, with cache-disabled tests as well as the configured commands.

Independent correctness is the subsequent fresh Squire **Review** phase. A distinct fresh Squire **Test** adds adversarial review and exact-head verification; both must explicitly report no blocker/high findings, with normal Squire remediation for any such finding even if commands pass. Implement's own diff inspection is not independent review. No substitute agents or second Squire run are used. This ticket-specific mapping does not change repository delivery policy.

Final Review/Test, App-authored PR publication, terminal exact-head CI and reservation/operation release evidence are controller/parent-owned **after this commit**. They are not certified here. The parent remains final acceptance authority; stop at a verified merge-ready PR, not merge, deployment, live actions or premature issue acceptance.
