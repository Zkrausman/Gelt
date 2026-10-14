---
type: guide
title: Gelt Strategic Roadmap 🪙
---
# Gelt Strategic Roadmap 🪙

## Current V2 status (2026-10-06; partial, execution disabled)

Source was checked at [master `d78c39f`](https://github.com/Zkrausman/Gelt/tree/d78c39f146a18a567b3cf6a836eb51bd5ab27ae9).
V1 Go code, history and guardrails remain preserved. V2 includes the offline
foundation, protected M3 account-connection boundary, worker-owned M4 SQLite
ledger, internal M5 order lifecycle, M6 connection/simulation UI, M7 read-only
ledger history and a partial M8 home workspace. The M5 lifecycle and synthetic
companion components are not wired into a production order path. Production
execution, preview, confirmation, dispatch, cancellation and reconciliation
capabilities remain false.

Hosted Go, Ubuntu Node 22 and native Windows Node 22 checks passed for that
source head; [exact jobs and retained failures](../v2/README.md#current-source-and-hosted-disposition-2026-10-06)
are recorded in the V2 README. These automated offline checks do not establish
live OAuth/browser/provider compatibility, owner-machine portability or release
acceptance. **M8 remains open.** Exact-order authorization, supervised
reconciliation and explicit owner acceptance remain separate gates; see
[ZAR-219](specs/ZAR-219-Integrated-Offline-Trading-Screen.md).

## Historical M2 foundation snapshot — ZAR-213 (2026-09-18)

The following snapshot describes the M2 checkpoint only; the dated current status
above supersedes its module-absence and pending-gate statements.

Owner capability GO authorizes the non-executing OpenTerminal-derived foundation
under `v2/`; V1 Go code/history/guardrails remain intact. The web landing page,
market backend and disabled worker run offline on loopback, without brokers or
the legacy daemon. See the [M2 specification](specs/ZAR-213-V2-Baseline.md) for startup commands,
exact upstream pin/license/import accounting, security boundaries and actual
local checks. M3 account protection, M4 ledger and M5+ orders are **not** present.
Parent-owned archival publication, PR/CI and review gates are not claimed here;
stop before merge. Earlier V1/cloud roadmap material below is historical context,
not authority to deploy or trade.

## Gelt v2: execution-first MVP (partial implementation; M8 open)

### Original planning decision and authority boundary

[ZAR-210: Execution-first MVP epic](https://linear.app/geltagentictrading/issue/ZAR-210)
precedes research. [ZAR-211: approved scope, runtime and release gates](specs/ZAR-211-Scope-Runtime-Release-Gates.md)
records one local owner/account/crypto pair, manually confirmed bounded BUY plus
cancel/halt/reconciliation/history/restart recovery, the Next.js/React workspace
and separate Node/TypeScript worker with sole-writer SQLite ledger. The timeline
is required; compatible candle markers are conditional. The proposed at-most-$10
fee-inclusive ceiling is not order authorization.

Owner-reviewed capability GO (212) precedes preservation/baseline work (213).
The live DAG is 211→212→213; 213→214,215; 214+215→216; 214→217;
215→218; 216+217+218→219→220→221→222→210→209, followed by post-MVP
entry work 223/224. Parent epics do not block their own children. Offline safety,
separate exact-order approval, supervised reconciliation and explicit owner
acceptance remain separate gates. No product implementation, broker/account
access, reset/import, preservation publication, merge or deployment is authorized
by this planning record. V1 history and current Go guardrails remain preserved.

## Gelt v2: first post-MVP milestone (planned)

[ZAR-209: Research-to-Shadow Pipeline — Paper2Agent Fork](specs/ZAR-209-Research-to-Shadow.md)
adds one selected paper, an isolated versioned candidate, reproducible evaluation,
shadow observation, and an owner-reviewed recommendation. It depends on acceptance
of the execution-first MVP; it does **not** authorize automatic live promotion.
See the linked specification for the editable tldraw roadmap and authority boundaries.

## Future product goal: automatic strategy lifecycle (implementation unplanned)

The intended product automatically evaluates strategy eligibility, promotes
qualifying strategies into live trading, and demotes or stops strategies under
an explicit policy. Routine strategy management must not require manual
per-strategy owner decisions.

Implementation is unplanned; this goal adds no tasks, thresholds or performance
claims. Evidence requirements, exposure and loss limits, safe rollback and
shutdown remain requirements for any later implementation. The historical
auto-promotion backlog below provides context, not a selected implementation plan.

This goal does not expand the current simulation/research delivery or release
G05/G06 holds. Real-money activation and financial transactions require user
handoff; this roadmap update authorizes neither.

The phases below retain historical roadmap context. In particular, the legacy
Phase 13 auto-promotion proposal and Phase 10 cloud plan are not part of the
execution-first MVP; auto-promotion is also not part of ZAR-209. This documentation change
does not retire existing backlog items or declare the execution-first MVP accepted.

## Phase 1: Architecture Scaffolding & Risk Governance (Completed)
- [x] **Project Scaffolding**: Initialize the repository with project-local issue tracking and documentation links.
- [x] **Risk Governance Engine (`pkg/risk`)**: Implement position percentage caps, trade size limits, and stop-loss rules.
- [x] **Robinhood MCP Configurator (`pkg/robinhood`)**: Manage Robinhood MCP server connection details.
- [x] **Squire Integration Manifest (`.squire.json`)**: Connect Gelt with Squire release auditing.

## Phase 2: Robinhood MCP Live Integration & Test Execution (Completed)
- [x] **Robinhood MCP Server Binding**: Wire official Robinhood Agentic Trading MCP URL (`https://agent.robinhood.com/mcp/trading`) into local config.
- [x] **Portfolio State Sync**: Pull live equity positions, cash balances, and buying power for dedicated Agentic accounts.
- [x] **Live Order Execution**: Validate pre-trade risk and execute live market buy & sell orders (verified with $1 SPY trade fill).

## Phase 3: Technical Indicators & Screener Engine (`pkg/signals`) (Completed)
- [x] **Technical Indicator Pipeline**: Compute 20/50/200 EMA, MACD, RSI-14, VWAP, and Bollinger Bands on target equities (`pkg/signals`).
- [x] **Dynamic Screener CLI (`gelt scan`)**: Universe screening and ranking by Confluence Score (`gelt scan`).

## Phase 4: Market Data Suite & Macro Engine (`pkg/data`) (Planned)
- [x] **FRED Macro Ingester**: Free API adapter tracking 10Y/2Y Treasury yield spreads, CPI/PPI inflation, and interest rate trends.
- [ ] **SEC EDGAR Filing Monitor**: Ingest 8-K/10-K filings and earnings surprise events in real-time.
- [x] **Zero-Cost Sentiment Ingestion**: Local text sentiment scoring for financial headlines and market news.

## Phase 5: Strategy Backtesting & Portfolio Risk Governance (`pkg/backtest` / `pkg/portfolio` / `pkg/thesis`)
- [ ] **Event-Driven Backtest Simulator**: Historical trade replay engine calculating Win Rate, Sharpe Ratio, Profit Factor, and Max Drawdown.
- [x] **Portfolio Correlation Matrix**: Multi-ticker correlation guardrails preventing over-concentration in correlated sectors (`pkg/portfolio`).
- [x] **ATR Trailing Stop Engine**: Dynamic trailing stops and mandatory >2:1 Risk-to-Reward ratio enforcement (`gelt monitor`).
- [x] **Beads Brain Thesis Logger (`pkg/thesis`)**: Automatically log execution rationales directly to `GELT_BEADS_BRAIN_PATH` and local journal (`gelt thesis`).

## Phase 6: Strategy Catalog & Regime Selector (`pkg/strategies`) (Completed)
- [x] **Strategy Interface & Registry (`pkg/strategies`)**: Modular Go `Strategy` interface and registry (`gelt strategies`).
- [x] **Trend Confluence Strategy**: 20/50 EMA + MACD + RSI momentum engine (`TrendConfluence`).
- [x] **Mean Reversion Strategy**: Bollinger Band bounce + RSI oversold/overbought engine (`MeanReversion`).
- [x] **Breakout & Volatility Strategy**: ATR expansion + volume surge breakout engine (`BreakoutVol`).
- [x] **VWAP Rebound Strategy**: Intraday VWAP institutional support/resistance pullback engine (`VWAPRebound`).

## Phase 7: Trading Plan Engine & Multi-Strategy Ensemble (`pkg/plans`) (Completed)
- [x] **Trading Plan Abstraction (`pkg/plans`)**: `TradingPlan` interface orchestrating multiple weighted strategies from the catalog.
- [x] **Built-In Trading Plans**: `IntradayAlphaPlan`, `RangeBoundDefensivePlan`, `BreakoutExpansionPlan`.
- [x] **Active Plan Switching (`gelt plan set`)**: Single-command active trading plan switcher (`gelt plan active` / `gelt plan list`).

## Phase 8: Shadow Trading & Forward-Test Engine (`pkg/shadow`)
- [ ] **Parallel Shadow Evaluator (`pkg/shadow`)**: Run non-active plans side-by-side with live trading on every 15-min cycle.
- [ ] **Shadow Journal Persistence**: Log paper fills, trailing stops, and virtual PnL to `~/.gemini/gelt_shadow_journal.json`.
- [ ] **Performance Leaderboard CLI (`gelt shadow`)**: Real-time comparative leaderboard comparing live account PnL vs shadow plan performance.

## Phase 9: AI Agentic Orchestration & Antigravity Agent API (`cmd/orchestrator` / `pkg/agent`)
- [x] **Antigravity Agent Client Bridge (`pkg/agent`)**: Multi-turn agent client bridge with path traversal safety and `~/.gelt/regime_matrix.json` write-locking (`ZAR-73`).
- [ ] **Antigravity Agent API Integration Proposal (`techPlan-gelt-agent-api-001`)**: Upgrade `AIChoice` / `AI_Choice_Crypto` from single-turn REST calls to multi-step agentic research loops.

## Phase 10: GCP e2-micro 24/7 Cloud Deployment (`docs/specs/EPIC_GCP_Cloud_Deployment.md`)
- [x] **Cross-Compilation PowerShell & Bash Pipeline (`ZAR-76`)**: Scaffolding `scripts/build-cloud.ps1` and `scripts/build-cloud.sh` for Linux CGO target binaries.
- [ ] **Terraform Always-Free Infrastructure (`ZAR-77`)**: Deploying GCP e2-micro compute instance, static IP, and $0 budget cap alerts.
- [ ] **Cloud-Run Killswitch & GCP Guardrails (`ZAR-78`)**: Auto-trigger cloud killswitch when monthly budget limit is approached.
- [ ] **Systemd Daemon & Health Service (`ZAR-79`)**: Running `gelt daemon` 24/7 with automatic restart and systemd health monitoring.

## Phase 11: Macro-Regime Signal Filtering & Volatility Circuit Breakers (`docs/specs/EPIC_Regime_Aware_Filtering.md`)
- [x] **Macro Trend Alignment Gate (`ZAR-80`)**: Configurable EMA 20/50 filter rejecting long buy signals during bear regimes at strategy and plan levels.
- [ ] **Volatility Circuit Breakers (`ZAR-81`)**: ATR chop filter pausing mean-reversion entries during low-volatility compression.

## Phase 12: LLM Meta-Evaluator Risk Officer (`docs/specs/EPIC_LLM_Meta_Evaluator.md`)
- [x] **Signal Interception Layer (`ZAR-82`)**: Intercepting strategy Buy/Sell signals and packaging order book, price action, and indicator context into `SignalContextPayload`.
- [ ] **LLM Pattern Verification Gate (`ZAR-83`)**: Dispatching intercepted signal context payloads to LLM Meta-Evaluator for final authorization before execution.

## Phase 13: Shadow-to-Live Auto-Promotion Engine (`docs/specs/EPIC_Shadow_Promotion_Engine.md`)
- [ ] **Shadow Performance Evaluator (`ZAR-84`)**: Tracking Win Rate, Profit Factor, and Drawdown of shadow strategies against quantitative promotion thresholds.
- [ ] **Hot-Swap Engine & Demotion Circuit Breaker (`ZAR-85`)**: Autonomously promoting high-performing shadow strategies to live capital and demoting decaying plans back to shadow.
