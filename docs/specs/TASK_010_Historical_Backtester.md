---
type: specification
title: "TASK_010: Interactive Strategy Backtester & Historical Replay Suite"
ticket: ZAR-235
status: implemented
baseline: "3b8b82e1514c341fce092b49e4bbfc8e29599c61"
scope: "Offline V1 historical validation, opt-in A/B1 and separate B2a declared-fee replay"
---

# TASK_010: Interactive Strategy Backtester & Historical Replay Suite

## Overview & Context
We need to add an offline backtesting and historical replay suite to the Gelt trading engine (`gelt/pkg/backtest`). This tool will allow us to replay historical market price bars against any registered Trading Plan or Strategy to evaluate performance metrics (Win Rate, Profit Factor, Net PnL, Max Drawdown) without needing live market hours or websocket connections.

---

## Technical Specifications & Requirements

1. **New Package (`gelt/pkg/backtest`):**
   - Create `engine.go` implementing a replay engine harness.
   - The engine must accept historical price bar series (`OHLCV` + timestamp data).
   - Implement sequential bar-by-bar iteration, feeding price ticks to target `BasePlan` or `Strategy` implementations.
   - Simulate paper trade execution:
     - Track virtual entry/exit prices.
     - Apply position sizing under `RiskProfile` rules.
     - Enforce dynamic ATR trailing stop-losses and profit targets.

2. **CLI Integration (`main.go` / `cmd/`):**
   - Add a new CLI subcommand: `gelt backtest <PlanOrStrategy> <Symbol> [Days]`
   - Formatted Output: Render a terminal summary table displaying:
     - Total Historical Bars Evaluated
     - Total Simulated Trades
     - Win Rate (%)
     - Net PnL ($)
     - Profit Factor (with divide-by-zero safeguard returning `INF` or `N/A`)
     - Max Drawdown (%)

3. **Documentation & Specification Artifact:**
   - Create the file `docs/specs/TASK_010_Historical_Backtester.md` containing these specifications for repository record-keeping.

4. **Strict Isolation & Constraints:**
   - **CRITICAL:** Backtest executions must be 100% offline and deterministic.
   - Under no circumstances should the backtest module initiate network calls to the `Robinhood MCP` or attempt live broker execution.

---

## Verification & Testing Requirements

1. **Unit & Integration Tests (`gelt/pkg/backtest/engine_test.go`):**
   - Write comprehensive unit tests using synthetic price arrays (e.g., 100-bar simulated bull trend and bear trend arrays).
   - Verify trade calculation accuracy, stop-loss triggers, and metric computations.

2. **Repository Validation:**
   - Ensure the entire test suite passes cleanly by running:
     `go test ./...`

---

## ZAR-235 Implementation Report

### Implemented behavior

`Engine.Run` now validates the complete historical series before any strategy or plan evaluation or trade calculation. It rejects an empty series, nonpositive Unix-second timestamps, duplicate or non-increasing timestamps, non-finite OHLCV values, nonpositive OHLC prices, negative volume, and candles that violate `low <= open, close <= high` or `low <= high`. Errors identify the invalid bar (or the empty series), and invalid input returns a zero `Result`. A valid single bar remains accepted and produces zero trades.

Evaluation timestamps are now derived exclusively from each bar's Unix-seconds timestamp; there is no `time.Now()` fallback. Valid-series trade behavior, constructors, `Run` signature, and metrics remain unchanged. The module remains offline and non-executing; no provider, broker, or V2 worker/ledger paths were added.

### Changed files

- `pkg/backtest/engine.go` — full-series validation and removal of wall-clock fallback.
- `pkg/backtest/engine_test.go` — invalid-input coverage for strategy and plan engines, single-bar acceptance, deterministic repeated replay and input-derived evaluation times; existing bull/bear fixtures retained with fixed timestamps.
- `pkg/backtest/README.md` — documented preflight validation and timestamp behavior.
- `cmd/gelt/main.go` — keep the existing offline CLI synthetic fallback's high/low bounds consistent with its generated close, so default backtests pass the stricter preflight.
- `cmd/gelt/backtest_synthetic_test.go` — seeded generator coverage for the default 100-bar replay across CLI base prices.
- `docs/specs/TASK_010_Historical_Backtester.md` — this implementation report.

### Verification evidence

The following checks passed in the original Squire candidate checkout, before independent review:

- `go test ./pkg/backtest`
- `go test ./...`
- `go test -race ./...`
- `go vet ./...`
- `git diff --check`

The candidate-local checks did not exercise the default CLI synthetic-data path. A subsequent independent review found that the old generator could create closes outside its high/low bounds; both unchanged A/B benchmark candidates failed an offline 100-bar CLI run. The CLI generator correction and regression test above were added **after** grading in a separate delivery branch, not credited to the candidate. On this branch, `GOPROXY=off go build ./...`, `GOPROXY=off go test -race ./...`, `GOPROXY=off go vet ./...`, `git diff --check`, and `GOPROXY=off go run ./cmd/gelt backtest IntradayAlphaPlan SPY 100` passed locally. Independent final review and hosted exact-head PR checks remain required before merge. No broker or MCP operation was invoked. Host worktrees, prompts and disabled extensions are not credential or network isolation.


## Execution/accounting audit follow-up (2026-10-31; documentation only)

The [bounded legacy execution/accounting audit](Legacy-Backtest-Execution-Accounting-Audit.md)
records inherited same-close fills, intrabar trailing/gap assumptions, unmodeled
costs and realized-exit drawdown. It recommends a versioned causal bar model and
truthful accounting/metric semantics, with unexecuted synthetic counterexamples
and proposed TASK_010-A/B correction slices. The input-validation/determinism
delivery above remains complete; no engine behavior, tests or current V2/PAMR
qualification path changes. Correction implementation is not released by this
audit approval. Cost-aware rebalancing and all operating holds remain.


## TASK_010-A opt-in causal source candidate (2026-11-01)

The owner separately approved A on October 31. The preceding implementation and
audit reports remain historical evidence. This additive candidate implements a
new model, not a migration or correction of `Run`/`Result` or the existing
`backtest` CLI. Final source review and delivery verification are tracked below;
source implementation is distinct from merge, installation, use and operation.

### API, identity and event ordering

`(*Engine).RunCausal(ctx, symbol, bars) (CausalResult, error)` uses fixed model
`gelt.legacy-go.close-next-open.v1`, cost label `frictionless_diagnostic` and
`unqualified_offline` data/authority labels. It validates the whole input before
evaluation, snapshots bars and supplies fresh close/volume prefixes per callback.
Evaluators must be fresh, exclusively owned trusted in-process objects. No
sandbox, callback authenticity, global alias isolation, reset, concurrent-use,
preemption or settlement guarantee is made.

Evaluation starts at the twentieth close (index19); its earliest action is the
next open (index20). For an existing position, opening stop gap precedes opening
target gap, then queued market exit, then intrabar protection. On an ambiguous
same-bar stop/target touch, stop wins and the fill is flagged ambiguous. A new
entry may hit its frozen protection on the entry bar. Any exit prevents reentry
on that bar. Close-known percentages/high may update protection for the next
bar only; stops ratchet upward. Initially zero protection is disabled and may be
activated later; changing enabled protection to zero rejects the whole run.
No terminal liquidation is invented. The final position is marked at the final
close; a final directional signal lacking a successor is flagged, including when
its next-open action would have been a no-op.

Standalone, plan and component results require canonical evaluator name,
requested symbol, exact supplied evaluation instant (`Time.Equal`) and EQUITY.
Equivalent timezone representations are allowed; nanosecond differences are not.
Plan membership must be a complete unique stable set of 1..16 declared children
with finite weights in[0,1] and positive total weight. Returned consensus is not
recomputed. Missing/duplicate/foreign children, changed membership, hidden child
AGENT_REVIEW and any nonempty AgentPrompt reject. These are consistency checks,
not proof that a trusted callback told the truth. Unsupported warmup/domain
conditions reject; no catalog-wide success is promised.

### Fixed numeric and resource envelope

- 1..10,000 bars; positive strictly increasing Unix-second timestamps through
  253402300799; finite consistent OHLC in[0.01,1,000,000], volume in[0,1e12].
- BUY/SELL/HOLD only; score in[0,100]; stop zero or[0.01,99.99] percent, target
  zero or[0.01,1000] percent. Bounded UTF-8 names <=128 bytes without controls;
  symbol matches `[A-Z][A-Z0-9.-]{0,15}`. Unused threshold metadata is not policy.
- Fixed nominal entry budgetUSD10 divided by actual next-open price; quantities
  in[0.00001,1000]. No invented tick/lot rounding, shorting or leverage.
- Enabled levels positive and <=11,000,000, ordered stop<target and on entry
  stop<entry<target where enabled. Per-fill notional <=1,000,000; each and
  accumulated gross/unrealized PnL/profit/loss remain within absolute1,000,000.
- Float64 calculations with direct touch predicates; no epsilon fills or hidden
  money rounding. Percentage levels use price plus/minus price*percentage/100.
  Oracle tolerances are absolute+relative: prices/levels/PnL1e-8+1e-12*abs(expected),
  quantity1e-12+1e-12*abs(expected), profit factor1e-10+1e-12*abs(expected).
  These tolerances do not change fill or validation predicates.
- At most10,000 evaluations/20,000 fills, one position and pending signal. Profit
  factor is null with a fixed reason for no closed trades or no losing closed
  trades, never infinity. Any failure returns zero result plus sanitized typed
  code/bar index, not a successful partial result. Context is checked before
  each bar and after callback; an uncooperative callback cannot be preempted.

### Separate CSV command and compatibility

`gelt backtest-causal <Target> <Symbol> <DataFile.csv>` requires exactly three
arguments. Exact `BreakoutVol` alone is supported in this CLI via fresh direct
construction and checked initialization with no providers/config/catalog suite.
Other targets, including plan routes, reject `unsupported_target`; the independent
Go API plan support is unaffected. Fixed20-close warmup is not extended to rescue
50-close confluence strategies. Existing `backtest` parsing, synthetic fallback,
output and `Run`/`Result`/constructors remain unchanged.

CSV is read through a max+1 bound of1,048,576 bytes with <=10,000 rows, exact
`Timestamp,Open,High,Low,Close,Volume` header and six unquoted ASCII fields.
LF/CRLF and one final newline are accepted. BOM, embedded blank rows, quotes,
field whitespace, signs, exponents, leading zero integers, malformed numbers,
extra/missing columns and tokens longer than32 bytes reject. Timestamp uses
unsigned integer syntax; other values use ordinary unsigned decimals with a
nonempty fractional part when a dot is present. Parse failures reject rather
than skip; ParseFloat rounding is explicit and domain checks use parsed floats.

Summary is <=4096 bytes with fixed labels, gross metrics, nullable profit factor,
open model position and final directional signal. Scientific display notation
bounds finite figures and rounds display only. Paths, arbitrary names, source
bars, events, rationale, prompts and raw callback/parse errors are not printed.
CLI errors are fixed codes with nonzero exit; no persistence/export is added.

### Changed files, verification and remaining gates

New: `pkg/backtest/causal.go`, `causal_test.go`,
`cmd/gelt/backtest_causal.go`, `backtest_causal_test.go`. `cmd/gelt/main.go` adds
only the separate dispatch; package README, this specification, the audit and
same Phase5 roadmap entry receive additive status/usage clarification.

Synthetic acceptance covers hand-derived gap/order/collision/ratchet oracles,
identity matrices and timezone/nanosecond boundaries, incomplete/changed plans,
whole-input/numeric/resource limits, direct touch/Nextafter separation, prefix
isolation, zero-result errors/cancellation, final open positions, legacy API
compatibility, actual deterministic BreakoutVol next-open lineage, strict CSV
boundaries and sanitized bounded output. No market dataset/campaign was run.

The first core check failed and its full output is preserved privately. Grouped
owner corrections repaired percentage-level arithmetic, clarified queued-exit
fixtures, removed an unapproved unused-threshold restriction and avoided dynamic
interface comparability panic. Session66290 later printed `ok` but its terminal
status was lost; it remains UNKNOWN permanently. The one separately authorized
November1 package command exited0 with Go **cached** success; fresh execution of
its test bodies is not claimed. The initial new CLI targeted check found a test
fixture incorrectly rejecting a permitted final newline; the correction keeps
direct numeric-token rejection and separately accepts the CSV line ending.
Exact current-source validation and independent/distinct adversarial review,
hosted CI, normal merge and remote postmerge checks remain required; working
receipts must not be presented as postreview or hosted proof.

TASK_010-B, fees/slippage, coherent cash/equity/drawdown and cost-aware rebalancing
remain unimplemented and outside A. This candidate does not enable V2/PAMR,
providers, acquisition, inference, qualification, execution or trading. All16 and
C07/C13/C14 remain UNKNOWN; NOT_READY/CLOSED/DEFER remains unchanged.


Local candidate verification (2026-11-01): full `go test -race ./... -count=1`,
`go vet ./...` and CLI build exited0 with unchanged tested source. The built
binary's synthetic positive next-open/open-position summary, unsupported plan
and missing-argument cases each have separately captured expected exit statuses.
`git diff --check` passed. These are pre-review working checks; later exact-head
and hosted results must be recorded separately. V2/scientific/protected-browser
paths are unchanged; the existing hosted V2 workflow path filter does not select
this Go/docs-only change. No V2/browser pass is inferred from that exclusion.


## TASK_010-B1 funded accounting source candidate (2026-11-02)

The owner specifically approved B1 funded cash and close-mark accounting,
synthetic tests, independent review and normal source delivery. Earlier blanket
B/accounting exclusions record A's historical scope; B2 fees/slippage/calibration
and cost-aware rebalancing remain excluded. B1 is a local implementation
candidate, not a delivered or operating backtester. The refined contract passed
independent accuracy/privacy review before authoring. Complete implementation
independent and distinct adversarial source/privacy review, applicable exact-head
local/hosted checks and ordinary merge/remote postmerge remain required.

### API, identity and event integration

```go
func (e *Engine) RunFundedCausal(ctx context.Context, symbol string,
    data []OHLCV, initialModelCash string) (FundedCausalResult, error)
```

RunCausal delegates to a private common loop with nil funded state, preserving
its public behavior and defaults. B1 uses typed funded state and model
`gelt.legacy-go.funded-close-next-open.v1`, cost
`frictionless_funded_fixed8_diagnostic`, data/authority `unqualified_offline`.
Nested replay carries the new IDs too; the A summary rejects them. Fresh exclusive
trusted evaluators, copied bars/fresh prefixes, whole-input validation and exact
name/symbol/time/EQUITY/plan membership checks remain. No new callback sandbox,
authentication, reset, concurrent/reentrant use or preemption guarantee exists.

Funding gates the eligible flat pending BUY before position/protection creation,
not by filtering a completed A trace. Insufficient cash records a bounded
`insufficient_model_cash` nonfill with bar/evaluation lineage and available versus
required units, consumes the attempt and continues. It creates no debit, fill,
position, protection, borrow or partial quantity. Active BUY and flat SELL retain
no-op semantics. Signals still undergo identity/domain checks while unfunded;
position-only enabled-to-zero checks do not apply to never-opened positions.
A's gap/protective/queued-exit/intrabar/stop-first/no-same-bar-reentry rules and
once-only eligible close evaluation remain. Pending final direction can be a
no-op and is not an actual unfilled order.

### Exact model accounting

Mandatory initial cash is at most32 ASCII bytes, ordinary unsigned integer or
integer plus dot and1..8 fractional digits, no sign/exponent/whitespace or
leading-zero integer. Range0..1,000,000 modelUSD. Parsing uses exact integer units
of10^-8, not ParseFloat or rounding excess precision. Output unit strings are
canonical integers, signed only for accounting PnL; human display is exactly8
fractional digits. This is an engineering model resolution, not actual cash or a
broker currency policy.

Entry quantity remains A's nominalUSD10/open float. Cash conversion forms the
exact binary-rational price×quantity with math/big.Rat, scales by10^8 and rounds
once, nearest ties-even. Debit, credit and close value share it; fill prices,
quantities/touch predicates and A float arithmetic are unchanged. Required entry
must equal1,000,000,000 units, otherwise fatal numeric failure without resizing.
Funding is exact cash>=required, no epsilon. Initial/cash/position value each fit
0..10^14 units; equity/peak fit0..2×10^14. Exact source product and rounded value
are bounded. Checked int64 arithmetic and big.Int ratio cross-products avoid
overflow. Unsupported range zeros the whole new result, without reducing A's
old supported domain.

Cash flows link actual FillIndex and bar/evaluation/entry lineage. Full exits
credit rounded proceeds and release entry basis. Realized accounting PnL is
credited units minus debit; unrealized is marked value minus retained debit.
Every close satisfies exactly `equity = cash + position value = initial equity +
realized PnL + unrealized PnL`. Float gross diagnostics remain separately labeled
and can differ slightly due cash quantization; they are not net/cash PnL.
No fees/slippage, tax, interest, dividend/split, leverage, shorts, reserve or
partial-funding model is added.

Every actual supplied bar has one close mark, including warmup before the20-close
evaluation threshold. Initial equity is separate, without an invented timestamp.
Close marking follows fills and any close evaluation/protection update; it does
not select fills. Initial capital seeds the high-water mark, then close equity
updates it. Strict exact loss/peak comparison keeps the earliest maximum on ties.
No positive loss means numerator0 and maximum bar null. Zero capital/peak means
null ratio/percent and `zero_initial_model_equity`; positive peak and zero equity
means100%. No intrabar peak metric or forced terminal liquidation is implied.
Final cash excludes open-position proceeds; final equity includes its close
value, with quantity/basis/unrealized PnL retained.

At most10,000 bars/evaluations/rejections/close marks and20,000 actual fills/cash
flows, one position. Fixed labels/reasons, validated identities and typed bounded
code/bar-index errors exclude raw callback rationale, AgentPrompt, private paths
and errors. Fatal errors return zero FundedCausalResult; expected insufficient
funding is nonfatal. Callback-internal state itself is not rollbackable.

### CLI, files and current verification

`gelt backtest-causal-funded <Target> <Symbol> <DataFile.csv> <InitialModelCash>`
requires exactly4args and reuses the unchanged strict CSV/exact BreakoutVol-only
fresh resolver. No provider/config/catalog/plan suite or account is initialized.
The separate human formatter checks fixed/nested identities, bounded canonical
units, accounting/DD and terminal consistency before formatting<=8192 UTF8 bytes.
These are internal formatting checks, not imported-record authentication or a
new general assessor. Fixed error codes never echo tokens/paths/private callback
text. One output write: short/error returns nonzero `output_error`, no retry or
atomic-output guarantee; a prefix may remain. No JSON command/export/persistence.

Changed files: private common-loop seams in `pkg/backtest/causal.go`; new
`causal_funded.go`, `causal_funded_test.go`,
`cmd/gelt/backtest_causal_funded.go`, `backtest_causal_funded_test.go`; separate
main.go dispatch; package README, this specification, audit and existing roadmap.
Old A/legacy tests and strategy/plan/risk/config/dependency/security source stay
unchanged.

Synthetic evidence covers100 cash,10 entry,close50 equity95/DD5%,exit110 cash101;
10 cash losing to9 then rejected later BUY before protection; zero/low/exact/
one-unit-short capital; exact1/512 and3/512 ties-even helper oracles; accounting
identities; warmup/final-open marks; DD ties/large exact products; A nonbinding
fresh-evaluator equivalence; gap/collision/ratchet/no-op and fatal
numeric/identity/membership/cancellation/resource cases; real BreakoutVol CSV
route, bounded/sanitized summary and prefix-error writer behavior. These are
constructed cases, not real-data coverage or operating observations.

Fresh core package race tests passed. The first CLI package check failed because
its successful controlled fixture always set AgentPrompt, correctly rejected by
the unchanged core. Owner correction removed it only from the valid fixture and
added a dedicated prompt-rejection case; production guards and old assertions
remain unchanged. Corrected fresh CLI package race passed. Originals/failure
outputs remain preserved. Full working/exact-review/hosted results must be
recorded separately; these checks and contract approval are not implementation
acceptance. Original A session66290 remains UNKNOWN permanently, separate from
its authorized cached check and later fresh tests.

No V2/PAMR lifecycle, market data/provider/acquisition, campaign/optimization,
qualification, actual capital or trading effects. All16/C07/C13/C14 UNKNOWN;
NOT_READY/CLOSED/DEFER. B2 costs and integration remain excluded.


Working verification update (2026-11-02): fresh full `go test -race ./... -count=1`,
`go vet ./...` and CLI build exited0 with source unchanged during each check.
Seven actual built-command cases passed: zero/low/funded capital, invalid cash,
unsupported target, missing arguments and the existing A command. Private owned
synthetic CSV only; no market-data call. These are pre-review working results;
V2/scientific, post-review exact-head and hosted/merge/postmerge gates remain
pending and are not inferred from prior A checks or untriggered hosted jobs.


## TASK_010-B2a declared-fee source candidate (2026-11-02)

B1 was delivered in [PR43](https://github.com/Zkrausman/Gelt/pull/43), merge
`805d6b31d16dd4977e606ead1b6d0cb6f52378cd`. Its earlier local/pending text above
is historical. The owner separately approved this opt-in declared-fee-only
increment, synthetic tests, independent review and ordinary source delivery.
Earlier B2 exclusions describe the previous scope; slippage, fee calibration,
acquisition, trading and cost-aware rebalancing remain excluded. This is a source
candidate, not an operating or profitability claim. No actual spending is needed:
the fee-inclusive10 modelUSD cap is simulated capital.

### Separate API and identities

```go
func (e *Engine) RunFeeScenarioCausal(ctx context.Context, symbol string,
    data []OHLCV, initialModelCash string, scenario FeeScenario) (FeeScenarioCausalResult, error)
type FeeScenario struct { FixedFee string; FeeBps string }
```

Model `gelt.legacy-go.fee-scenario-close-next-open.v1`, cost
`declared_fixed8_per_side_fee_scenario`, and nested replay use separate identities;
data/authority remain `unqualified_offline`. Declaration basis is
`uncalibrated_declared`, application `per_filled_side`, fee basis
`quantized_gross_notional`. No actual broker schedule or calibration is implied.
Legacy Run/Result/backtest, A and B1 APIs/defaults/results/errors remain unchanged.
The private common loop now accepts separate optional typed funded/fee state,
rejecting simultaneous use. B1's only source adjustment supplies the new nil
argument; its arithmetic, public result and tests are unchanged.

Initial cash retains B1's exact unsigned ASCII decimal grammar, at most32 bytes,
0..1,000,000 modelUSD with at most8 fractional digits. Fixed fee is mandatory,
same grammar and resolution, 0 inclusive to10 exclusive. Rate is a mandatory
canonical integer string, at most5 bytes, 0..10000 basis points inclusive. This
100% engineering bound is not a realistic fee assumption. No omitted/default
scenario, rounding excess precision, signs, whitespace or exponents. Invalid
scenario rejects before callbacks with sanitized `invalid_fee_scenario`.

### Fee-inclusive sizing and exact accounting

Let scale S=10^8, B=10S, F=declared fixed fee units, b=declared rate. Each actual
filled side charges `F + ceil(N*b/10000)`, where N is that side's gross notional
quantized once using exact binary-rational price×quantity and nearest ties-even.
No fees for rejected entries, no-ops, marks or pending terminal directions.

Eligible entry principal is the maximal integer
`T=floor((B-F)*10000/(10000+b))`. For a nonzero scenario the quantity is the
float64 at or immediately below exact `T/(S*open)`; exact raw principal must not
exceed T/S and its quantized value must equal T. Unsupported quantity/range fails,
without clamping or widening the inherited0.00001..1000 quantity domain. Explicit
F=0,b=0 uses B1's original10/open float, preserving zero-fee trace/accounting
apart from new identities and fee fields. Funding requires exact cash>=T+fee,
with total debit<=B. No loan, epsilon, fee waiver, partial funding or resizing to
available cash. Insufficient cash is a nonfatal `insufficient_model_cash` nonfill.

A valid scenario can yield T=0. If a flat eligible pending BUY reaches that
condition, return `numeric_range` and a zero whole result before funding or
position/protection creation, even with zero cash. HOLD/warmup/no eligible entry
does not fail solely because T=0. For F=9.99999999,b=0 the positive one-unit
principal still must pass the inherited quantity domain; b>=1 can yield T=0.

Retain principal and filled entry fee separately, with basis=principal+entryfee.
Exit cash delta is quantized gross minus the filled exit fee, including a
negative delta if existing cash covers it. Otherwise fail
`insufficient_exit_fee_cash`, zeroing the whole result; never waive fees or
report a partial successful exit. Net realized PnL is exit delta minus entry
basis. Net unrealized PnL is close value minus retained basis. Exact gross
accounting PnL excludes fees, while closed attributed fees include closed entry
and exit fees and open attributed fees contain only the retained entry fee.
Aggregate fees equal closed plus open fees. No double subtraction from equity:
`equity=cash+value=initial+net_realized+net_unrealized` at every supplied close.
Float gross diagnostics remain separately labeled and can differ by quantization.

Bounds remain10,000 bars/evaluations/rejections/marks,20,000 fills/cash flows and
one position. Checked integer arithmetic bounds initial/cash/gross/value/aggregate
fees to0..10^14 units, equity/peak to0..2×10^14, signed accounting PnL to±2×10^14,
and entry principal/basis to10^9. Fee multiplication uses checked integer
arithmetic and ceiling; quantity and quote conversion use exact rational math.
Every bar is marked including warmup; initial equity has no invented timestamp.
Strict exact loss/peak comparison preserves the first maximum on ties; zero
initial equity remains null with `zero_initial_model_equity`. Terminal open
positions retain basis/entry fee and close value, never assumed liquidation,
proceeds or a hypothetical exit fee. A's event ordering and protection semantics
are reused unchanged. Trusted fresh exclusive callbacks, identity checks and
whole-input validation remain; callback sandboxing, rollback, concurrent use,
authentication and preemption are not promised.

### Command, formatting and changed files

`gelt backtest-causal-fees <Target> <Symbol> <DataFile.csv> <InitialModelCash> <FixedPerSideFee> <FeeBps>`
requires exactly6 arguments and the unchanged bounded strict CSV parser and exact
BreakoutVol-only fresh resolver. No account/provider/config/catalog or plan suite
is initialized. No input is fetched or synthesized by the product command.
The separate <=8192 UTF8-byte human summary displays exact8 money, declared fee
basis, fee-inclusive cap, gross versus net accounting, cash/basis/fees/close
value/equity/drawdown and terminal/pending limitations. Formatting consistency
checks fixed/nested identities, canonical bounded units, scenario/trace/accounting
and nullable drawdown, with index checks before access. This internal typed-result
formatter is not an imported-record authenticator or general assessor. A/B1
formatters reject new identities. Errors are fixed safe code strings without raw
input tokens, private paths, callback rationale/prompts/errors. One output attempt:
short/error is nonzero `output_error`, may retain a prefix and is never retried.
No JSON export, persistence or effects are added.

Changed source: `pkg/backtest/causal.go` private integration and
`causal_funded.go` nil-argument compatibility; new `causal_fee_scenario.go` and
`causal_fee_scenario_test.go`; new `cmd/gelt/backtest_causal_fee_scenario.go` and
`backtest_causal_fee_scenario_test.go`; one main dispatch. Documentation updates
this specification, package README, cumulative roadmap and audit status. Old
A/B1/legacy tests, strategy/plan/risk/config/dependencies/security stay unchanged.

### Synthetic evidence and verification limits

Independent arithmetic cases include flat100-price entry/exit with cash10,
fixedfee1: principal9, entry cash0/equity9, final cash8, totalfees2, gross0,
net-2 and close drawdown20%. Terminal open has only entryfee1. At b=100,F=0,
T=990099009 and fee9900991 exactly exhaust the cap; T+1 violates it. At b=10000,
T=500000000 and fee500000000. Ceil cases N=1/10000/10001,b=1 produce1/1/2 units.
Exit price1/fixedfee1 fails with initial10 but succeeds with100 at final89.09,
net-10.91 and fees2. Tests distinguish T=0 rejection before funding from successful
HOLD/warmup, supported unfunded entries, explicit zero-fee B1 equivalence,
quantization ties, gap/touch/queued-exit precedence, fatal identity/numeric/resource
errors, malformed late CSV, bounded private-error handling and single-write
prefix failures. These are constructed acceptance cases, not market coverage.

The first core package race run failed two new fixture rows that queued a SELL
while expecting an intrabar fill. The owner corrected only the new fixture to
separate queued exits from intrabar cases and added explicit precedence coverage;
production ordering and old tests were unchanged. Corrected fresh core package
race passed. The first assembled CLI check failed compilation on an unused
`strconv` import; the owner removed only that import. Original failures are
retained. Later working, independent/adversarial implementation review, exact-head
and hosted/merge/postmerge results must be recorded separately; contract review
and these statements do not claim final implementation acceptance.

Working full verification (2026-11-02): fresh `go test -race ./... -count=1`,
`go vet ./...` and the CLI build exited0 with tested source unchanged. Twelve
actual built-command cases passed using an owned synthetic CSV: fixed fee,
zero/low capital,100bps, explicit zero fees, bad fixed fee/rate, zero target,
missing arguments, unsupported target and retained B1/A commands. This build
used the recorded working source snapshot, not a clean reviewed commit.
Full implementation source/privacy reviews, exact-head postreview checks and
hosted/merge/postmerge gates remain pending. V2/scientific checks have not yet
been run for B2a and are not inferred from prior deliveries. Original A session
66290 remains UNKNOWN, separate from later authorized gates. Author provenance,
retained STOPs and nonadditive usage qualifications remain in private receipts.

No V2/PAMR/provider/lifecycle activation, slippage, live data/acquisition,
qualification, optimization campaign, actual capital or trading. All16 and
C07/C13/C14 remain UNKNOWN; NOT_READY/CLOSED/DEFER unchanged.
