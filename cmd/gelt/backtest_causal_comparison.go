package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gelt/pkg/backtest"
)

const (
	comparisonCLISummaryMaxBytes = 8192
	comparisonCLIUsage           = "Usage: gelt backtest-causal-compare <Target> <Symbol> <DataFile.csv> <InitialModelCash> <FixedPerSideFee> <FeeBps> <BuyAdverseBps> <SellAdverseBps>\n" +
		"Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n"
)

func runBacktestCausalComparison(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 8 {
		return comparisonCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return comparisonCLIFail(stderr, "canceled")
	}

	f, err := os.Open(args[2])
	if err != nil {
		return comparisonCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return comparisonCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return comparisonCLIFail(stderr, "input_file")
		default:
			return comparisonCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return comparisonCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return comparisonCLIFail(stderr, "canceled")
	}

	// Resolve only after the complete bounded CSV has been parsed and closed.
	engine, ok := newBacktestCausalEngine(args[0])
	if !ok {
		if args[0] != "BreakoutVol" {
			return comparisonCLIFail(stderr, "unsupported_target")
		}
		return comparisonCLIFail(stderr, "invalid_evaluator")
	}
	return runBacktestCausalComparisonEngine(ctx, args[1], bars, args[3],
		backtest.ExecutionScenario{FixedFee: args[4], FeeBps: args[5], BuyAdverseBps: args[6], SellAdverseBps: args[7]},
		engine, stdout, stderr)
}

// The actual command constructs a fresh trusted engine through the unchanged
// resolver. This typed package-local seam exists for synthetic tests only.
func runBacktestCausalComparisonEngine(
	ctx context.Context,
	symbol string,
	bars []backtest.OHLCV,
	initialModelCash string,
	scenario backtest.ExecutionScenario,
	engine *backtest.Engine,
	stdout, stderr io.Writer,
) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return comparisonCLIFail(stderr, "canceled")
	}
	if engine == nil {
		return comparisonCLIFail(stderr, "invalid_evaluator")
	}
	snapshot := append([]backtest.OHLCV(nil), bars...)
	result, err := engine.RunComparisonCausal(ctx, symbol, snapshot, initialModelCash, scenario)
	if err != nil {
		return comparisonCLIFail(stderr, comparisonCLIEngineError(err))
	}
	summary, ok := backtestCausalComparisonSummary(result, snapshot, symbol, initialModelCash, scenario)
	if !ok {
		return comparisonCLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return comparisonCLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return comparisonCLIFail(stderr, "output_error")
	}

	// One output attempt. Failure may leave a retained prefix; never retry.
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return comparisonCLIFail(stderr, "output_error")
	}
	return 0
}

func comparisonCLIEngineError(err error) string {
	var failure *backtest.ComparisonCausalError
	if !errors.As(err, &failure) || failure == nil {
		return "replay_failed"
	}
	switch failure.Code {
	case backtest.FundedInvalidModelCash:
		return "invalid_model_cash"
	case backtest.ExecutionScenarioInvalidScenario:
		return "invalid_execution_scenario"
	case backtest.ExecutionScenarioInsufficientExitFeeCash:
		return "insufficient_exit_fee_cash"
	case backtest.CausalInvalidInput:
		return "invalid_input"
	case backtest.CausalInvalidSymbol:
		return "invalid_symbol"
	case backtest.CausalInvalidEvaluator:
		return "invalid_evaluator"
	case backtest.CausalEvaluatorIdentity:
		return "evaluator_identity"
	case backtest.CausalEvaluatorError:
		return "evaluator_error"
	case backtest.CausalPlanMembership:
		return "plan_membership"
	case backtest.CausalUnsupported:
		return "unsupported_condition"
	case backtest.CausalNumericRange:
		return "numeric_range"
	case backtest.CausalCanceled:
		return "canceled"
	case backtest.CausalResourceLimit:
		return "resource_limit"
	default:
		return "replay_failed"
	}
}

func comparisonCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_arguments", "input_file", "invalid_csv", "resource_limit",
		"unsupported_target", "invalid_model_cash", "invalid_execution_scenario",
		"insufficient_exit_fee_cash", "invalid_input", "invalid_symbol",
		"invalid_evaluator", "evaluator_identity", "evaluator_error",
		"plan_membership", "unsupported_condition", "numeric_range",
		"canceled", "invalid_result", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	message := "backtest-causal-compare: " + code + "\n"
	if code == "invalid_arguments" {
		message = comparisonCLIUsage + message
	}
	if stderr != nil {
		n, err := io.WriteString(stderr, message)
		if err != nil || n != len(message) {
			return 1
		}
	}
	return 1
}

var comparisonCLIDecimalPattern = regexp.MustCompile(`\A(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?\z`)
var comparisonCLISymbolPattern = regexp.MustCompile(`\A[A-Z][A-Z0-9.\-]{0,15}\z`)

// Independent display-boundary reconstruction: never invoke an engine to
// validate its own output, and never accept detached control summary algebra.
func comparisonCLIInputUnits(s string, bound int64) (int64, bool) {
	if len(s) > 32 || !comparisonCLIDecimalPattern.MatchString(s) {
		return 0, false
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return 0, false
	}
	r.Mul(r, big.NewRat(fundedCLIUnitScale, 1))
	return r.Num().Int64(), r.IsInt() && r.Num().IsInt64() && r.Sign() >= 0 && r.Cmp(new(big.Rat).SetInt64(bound)) <= 0
}
func comparisonCLIQuantity(p float64, target int64, zero bool) (float64, bool) {
	if target <= 0 || target > fundedCLIEntryUnits || !causalCLIFinite(p, .01, 1000000) {
		return 0, false
	}
	q := 10 / p
	if !zero {
		r := new(big.Rat).Quo(big.NewRat(target, fundedCLIUnitScale), new(big.Rat).SetFloat64(p))
		q, _ = r.Float64()
		if new(big.Rat).SetFloat64(q).Cmp(r) > 0 {
			q = math.Nextafter(q, 0)
		}
		if new(big.Rat).Mul(new(big.Rat).SetFloat64(p), new(big.Rat).SetFloat64(q)).Cmp(big.NewRat(target, fundedCLIUnitScale)) > 0 {
			return 0, false
		}
	}
	n, ok := fundedCLIQuote(p, q)
	return q, ok && n == target && causalCLIFinite(q, .00001, 1000)
}
func comparisonCLIDD(loss, peak int64, bar int) backtest.FundedCausalDrawdown {
	if peak == 0 {
		return backtest.FundedCausalDrawdown{UndefinedReason: backtest.FundedZeroInitialEquity}
	}
	l, p := strconv.FormatInt(loss, 10), strconv.FormatInt(peak, 10)
	v, _ := new(big.Rat).Mul(big.NewRat(loss, peak), big.NewRat(100, 1)).Float64()
	d := backtest.FundedCausalDrawdown{LossUnits: &l, PeakEquityUnits: &p, Percent: &v}
	if loss > 0 {
		b := bar
		d.BarIndex = &b
	}
	return d
}
func comparisonCLIControl(bars []backtest.OHLCV, symbol string, initial, fixed, bps, target, buy int64, passive bool) (backtest.ComparisonControlResult, bool) {
	model, policy := backtest.ComparisonCashModelIdentity, backtest.ComparisonCashPolicy
	if passive {
		model, policy = backtest.ComparisonPassiveModelIdentity, backtest.ComparisonPassivePolicy
	}
	u := func(n int64) string { return strconv.FormatInt(n, 10) }
	r := backtest.ComparisonControlResult{ModelIdentity: model, PolicyIdentity: policy, Symbol: symbol, TotalBars: len(bars), Scale: 8, InitialModelCashUnits: u(initial), EntryStatus: "no_eligible_bar"}
	cash, principal, fee, basis, peak := initial, int64(0), int64(0), int64(0), initial
	var quantity float64
	maxLoss, maxPeak, maxBar := int64(0), int64(0), -1
	for i, b := range bars {
		if passive && i == 20 {
			p, ok := executionCLIPrice(b.Open, buy, backtest.CausalEntry)
			if !ok {
				return r, false
			}
			q, ok := comparisonCLIQuantity(p, target, fixed == 0 && bps == 0 && buy == 0)
			if !ok {
				return r, false
			}
			f, ok := executionScenarioCLICharge(target, fixed, bps)
			if !ok {
				return r, false
			}
			debit, ok := executionScenarioCLIAdd(target, f)
			if !ok || debit <= 0 || debit > fundedCLIEntryUnits {
				return r, false
			}
			r.Entry = &backtest.ComparisonControlEntry{Origin: "fixed_control_policy", Reason: "fixed_after_20_closes_one_buy", PolicyDecisionBarIndex: 19, BarIndex: 20, Timestamp: time.Unix(b.Timestamp, 0).UTC(), ReferencePrice: b.Open, ExecutionPrice: p, ModelQuantity: q, PrincipalUnits: u(target), FeeUnits: u(f), RequiredModelCashUnits: u(debit), AvailableModelCashUnits: u(initial)}
			r.EntryStatus = backtest.FundedInsufficientModelCash
			if initial >= debit {
				r.EntryStatus = "filled"
				cash = initial - debit
				principal = target
				fee = f
				basis = debit
				quantity = q
			}
		}
		value := int64(0)
		if quantity != 0 {
			var ok bool
			value, ok = fundedCLIQuote(b.Close, quantity)
			if !ok {
				return r, false
			}
		}
		equity, ok := executionScenarioCLIAdd(cash, value)
		if !ok || equity < 0 || equity > fundedCLIMaxEquity {
			return r, false
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity
		if loss > 0 && peak > 0 && (maxLoss == 0 || fundedCLIRatioGreater(loss, peak, maxLoss, maxPeak)) {
			maxLoss, maxPeak, maxBar = loss, peak, i
		}
		m := backtest.ExecutionScenarioCausalCloseMark{BarIndex: i, Timestamp: time.Unix(b.Timestamp, 0).UTC(), ModelCashUnits: u(cash), ModelQuantity: quantity, PositionPrincipalUnits: u(principal), PositionEntryFeeUnits: u(fee), PositionTotalBasisUnits: u(basis), PositionValueUnits: u(value), EquityUnits: u(equity), PeakEquityUnits: u(peak), GrossRealizedAccountingPnLUnits: "0", GrossUnrealizedAccountingPnLUnits: u(value - principal), NetRealizedAccountingPnLUnits: "0", NetUnrealizedAccountingPnLUnits: u(value - basis), ClosedAttributedFeeUnits: "0", OpenAttributedFeeUnits: u(fee), AggregateFeeUnits: u(fee), CloseMarkDrawdown: comparisonCLIDD(loss, peak, i)}
		r.CloseMarks = append(r.CloseMarks, m)
		r.FinalModelCashUnits = m.ModelCashUnits
		r.FinalModelQuantity = quantity
		r.FinalPositionPrincipalUnits = m.PositionPrincipalUnits
		r.FinalPositionEntryFeeUnits = m.PositionEntryFeeUnits
		r.FinalPositionTotalBasisUnits = m.PositionTotalBasisUnits
		r.FinalPositionValueUnits = m.PositionValueUnits
		r.FinalEquityUnits = m.EquityUnits
		r.NetRealizedAccountingPnLUnits = "0"
		r.NetUnrealizedAccountingPnLUnits = m.NetUnrealizedAccountingPnLUnits
		r.AggregateFeeUnits = m.AggregateFeeUnits
		r.PeakCloseEquityUnits = m.PeakEquityUnits
	}
	if maxPeak == 0 {
		maxPeak = peak
	}
	r.MaxCloseMarkDrawdown = comparisonCLIDD(maxLoss, maxPeak, maxBar)
	return r, true
}

func comparisonCLIResultValid(r backtest.ComparisonCausalResult, bars []backtest.OHLCV, symbol, cash string, scenario backtest.ExecutionScenario) bool {
	initial, ok := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	fixed, ok := comparisonCLIInputUnits(scenario.FixedFee, fundedCLIEntryUnits-1)
	if !ok {
		return false
	}
	bps, ok := fundedCLIUnits(scenario.FeeBps, false, 10000)
	if !ok || len(scenario.FeeBps) > 5 {
		return false
	}
	buy, ok := executionCLIAdverseRate(scenario.BuyAdverseBps)
	if !ok {
		return false
	}
	_, ok = executionCLIAdverseRate(scenario.SellAdverseBps)
	if !ok {
		return false
	}
	if len(bars) < 1 || len(bars) > 10000 || !comparisonCLISymbolPattern.MatchString(symbol) || r.ModelIdentity != backtest.ComparisonCausalModelIdentity || r.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity || r.ScenarioBasis != backtest.ExecutionScenarioCausalBasis || r.DataLabel != backtest.CausalOfflineLabel || r.AuthorityLabel != backtest.CausalOfflineLabel || r.Symbol != symbol || r.TotalBars != len(bars) || r.Scale != 8 || r.InitialModelCashUnits != strconv.FormatInt(initial, 10) {
		return false
	}
	f, b, target, ok := executionScenarioCLIDeclaration(r.Scenario)
	if !ok || f != fixed || b != bps || r.Scenario.BuyAdverseBps != scenario.BuyAdverseBps || r.Scenario.SellAdverseBps != scenario.SellAdverseBps || r.Strategy.Scenario != r.Scenario || r.Strategy.InitialModelCashUnits != r.InitialModelCashUnits || r.Strategy.ReferenceReplay.TargetName != "BreakoutVol" || r.Strategy.ReferenceReplay.Symbol != symbol || r.Strategy.ReferenceReplay.TotalBars != len(bars) || !executionScenarioCLIResultValid(r.Strategy) || len(r.Strategy.CloseMarks) != len(bars) {
		return false
	}
	for i, m := range r.Strategy.CloseMarks {
		if m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
			return false
		}
		value := int64(0)
		if m.ModelQuantity != 0 {
			var ok bool
			value, ok = fundedCLIQuote(bars[i].Close, m.ModelQuantity)
			if !ok {
				return false
			}
		}
		if m.PositionValueUnits != strconv.FormatInt(value, 10) {
			return false
		}
	}
	c, ok := comparisonCLIControl(bars, symbol, initial, fixed, bps, target, buy, false)
	if !ok || !reflect.DeepEqual(c, r.Cash) {
		return false
	}
	p, ok := comparisonCLIControl(bars, symbol, initial, fixed, bps, target, buy, true)
	if !ok || !reflect.DeepEqual(p, r.Passive) {
		return false
	}
	eq, ok := fundedCLIUnits(r.Strategy.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		return false
	}
	peq, ok := fundedCLIUnits(p.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		return false
	}
	return r.StrategyMinusCashUnits == strconv.FormatInt(eq-initial, 10) && r.StrategyMinusPassiveUnits == strconv.FormatInt(eq-peq, 10)
}

func backtestCausalComparisonSummary(r backtest.ComparisonCausalResult, bars []backtest.OHLCV, symbol, cash string, scenario backtest.ExecutionScenario) (string, bool) {
	if !comparisonCLIResultValid(r, bars, symbol, cash, scenario) {
		return "", false
	}
	money := func(s string) string { return fundedCLIDecimal(s) }
	dd := func(d backtest.FundedCausalDrawdown) string {
		if d.Percent == nil {
			return "undefined:" + d.UndefinedReason
		}
		return fmt.Sprintf("%.8g%%", *d.Percent)
	}
	var out strings.Builder
	fmt.Fprintf(&out, "Offline causal comparison: %s\nSymbol: %s; supplied bars: %d; data/authority: unqualified_offline\nCost: %s; basis: uncalibrated_declared\nInitial model cash: %s; fee-inclusive entry cap: 10.00000000\nFixed fee: %s; fee bps: %s; buy adverse bps: %s; sell adverse bps: %s\n", r.ModelIdentity, r.Symbol, r.TotalBars, r.CostIdentity, money(r.InitialModelCashUnits), money(r.Scenario.FixedFeeUnits), r.Scenario.FeeBps, r.Scenario.BuyAdverseBps, r.Scenario.SellAdverseBps)
	fmt.Fprintf(&out, "Strategy model: %s; cash model: %s; passive model: %s\n", r.Strategy.ModelIdentity, r.Cash.ModelIdentity, r.Passive.ModelIdentity)
	out.WriteString("Model | cash | open value | equity | realized PnL | unrealized PnL | net model PnL | fees | quantity | maximum close-mark drawdown\n")
	row := func(name, cash, value, equity, realized, unrealized, fees string, q float64, d backtest.FundedCausalDrawdown) {
		eq, _ := fundedCLIUnits(equity, false, fundedCLIMaxEquity)
		initial, _ := fundedCLIUnits(r.InitialModelCashUnits, false, fundedCLIMaxUnits)
		fmt.Fprintf(&out, "%s | %s | %s | %s | %s | %s | %s | %s | %.17g | %s\n", name, money(cash), money(value), money(equity), money(realized), money(unrealized), money(strconv.FormatInt(eq-initial, 10)), money(fees), q, dd(d))
	}
	s := r.Strategy
	row("strategy:BreakoutVol", s.FinalModelCashUnits, s.FinalPositionValueUnits, s.FinalEquityUnits, s.NetRealizedAccountingPnLUnits, s.NetUnrealizedAccountingPnLUnits, s.AggregateFeeUnits, s.FinalModelQuantity, s.MaxCloseMarkDrawdown)
	for _, c := range []backtest.ComparisonControlResult{r.Cash, r.Passive} {
		row(c.PolicyIdentity, c.FinalModelCashUnits, c.FinalPositionValueUnits, c.FinalEquityUnits, c.NetRealizedAccountingPnLUnits, c.NetUnrealizedAccountingPnLUnits, c.AggregateFeeUnits, c.FinalModelQuantity, c.MaxCloseMarkDrawdown)
	}
	fmt.Fprintf(&out, "Passive eligibility: index20 open after20 closes; status: %s\n", r.Passive.EntryStatus)
	if e := r.Passive.Entry; e != nil {
		fmt.Fprintf(&out, "Passive required debit: %s; candidate principal: %s; candidate entry fee: %s; available cash: %s; reference price: %.17g; execution price: %.17g\n", money(e.RequiredModelCashUnits), money(e.PrincipalUnits), money(e.FeeUnits), money(e.AvailableModelCashUnits), e.ReferencePrice, e.ExecutionPrice)
	}
	fmt.Fprintf(&out, "Ending equity gaps (strategy minus control): cash %s; passive %s\n", money(r.StrategyMinusCashUnits), money(r.StrategyMinusPassiveUnits))
	out.WriteString("Controls do not evaluate strategies. Passive holds one lot to the final supplied close; no protection, rebalancing or terminal sale. SELL costs apply only to a SELL.\nExposure duration, protection and turnover differ; equal declarations do not imply equal risk. No extra execution-price cash charge. Synthetic uncalibrated scenario assumptions; supplied CSV authenticity is unknown. No ranking, statistical edge, profitability, qualification or operating admission.\n")
	return out.String(), out.Len() <= comparisonCLISummaryMaxBytes
}
