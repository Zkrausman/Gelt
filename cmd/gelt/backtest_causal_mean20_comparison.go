package main

import (
	"context"
	"errors"
	"fmt"
	"gelt/pkg/backtest"
	"io"
	"reflect"
	"strconv"
	"strings"
	"time"
)

func mean20CLIResultValid(ctx context.Context, r backtest.Mean20ComparisonResult, bars []backtest.OHLCV, symbol, cash string, scenario backtest.ExecutionScenario) bool {
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
	if len(bars) < 1 || len(bars) > 10000 || !comparisonCLISymbolPattern.MatchString(symbol) || r.ModelIdentity != backtest.Mean20ComparisonModelIdentity || r.EvaluationPolicyIdentity != backtest.Mean20EvaluationPolicyIdentity || r.CadencePolicy != "bar_index_only_cadence_and_session_unqualified" || r.IntradayEligibility != "unestablished" || r.SelectionHistory != "unestablished" || r.FixedWarmupCloses != 20 || r.FirstEvaluationBarIndex != 19 || r.FirstEligibleFillBarIndex != 20 || r.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity || r.ScenarioBasis != backtest.ExecutionScenarioCausalBasis || r.DataLabel != backtest.CausalOfflineLabel || r.AuthorityLabel != backtest.CausalOfflineLabel || r.Symbol != symbol || r.TotalBars != len(bars) || r.Scale != 8 || r.InitialModelCashUnits != strconv.FormatInt(initial, 10) {
		return false
	}
	f, b, target, ok := executionScenarioCLIDeclaration(r.Scenario)
	if !ok || f != fixed || b != bps || r.Scenario.BuyAdverseBps != scenario.BuyAdverseBps || r.Scenario.SellAdverseBps != scenario.SellAdverseBps || r.Strategy.Scenario != r.Scenario || r.Strategy.InitialModelCashUnits != r.InitialModelCashUnits || r.Strategy.ReferenceReplay.TargetName != "MeanReversion" || r.Strategy.ReferenceReplay.Symbol != symbol || r.Strategy.ReferenceReplay.TotalBars != len(bars) || !mean20ExecutionScenarioCLIResultValid(r.Strategy) || len(r.Strategy.CloseMarks) != len(bars) {
		return false
	}
	for i, bar := range bars {
		if ctx.Err() != nil || bar.Timestamp < 1 || bar.Timestamp > 253402300799 || i > 0 && bar.Timestamp <= bars[i-1].Timestamp || !causalCLIFinite(bar.Open, .01, 1000000) || !causalCLIFinite(bar.High, .01, 1000000) || !causalCLIFinite(bar.Low, .01, 1000000) || !causalCLIFinite(bar.Close, .01, 1000000) || !causalCLIFinite(bar.Volume, 0, 1e12) || bar.Low > bar.Open || bar.Low > bar.Close || bar.High < bar.Open || bar.High < bar.Close || bar.Low > bar.High {
			return false
		}
	}
	for i, m := range r.Strategy.CloseMarks {
		if ctx.Err() != nil || m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
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

func mean20CLISummary(ctx context.Context, r backtest.Mean20ComparisonResult, bars []backtest.OHLCV, symbol, cash string, scenario backtest.ExecutionScenario) (string, bool) {
	if !mean20CLIResultValid(ctx, r, bars, symbol, cash, scenario) {
		return "", false
	}
	initial, initialOK := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	fixed, bps, target, declarationOK := executionScenarioCLIDeclaration(r.Scenario)
	buy, buyOK := executionCLIAdverseRate(scenario.BuyAdverseBps)
	sell, sellOK := executionCLIAdverseRate(scenario.SellAdverseBps)
	if !initialOK || !declarationOK || !buyOK || !sellOK || !windowReferenceEvents(ctx, bars, r.Strategy, initial, fixed, bps, target, buy, sell) {
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
	fmt.Fprintf(&out, "Evaluation policy: %s; BB20 x2; RSI14 thresholds 35/65; ATR proxy14 stop/target multipliers 0.5/1.5; chop 0.015/14; defaults uncalibrated.\nWarmup 20; first evaluation 19; first eligible fill 20; cadence: %s; intraday eligibility and selection history: unestablished.\n", r.EvaluationPolicyIdentity, r.CadencePolicy)
	fmt.Fprintf(&out, "Terminal position open: %t; final directional signal unfilled: %t; closed trades: %d\n", r.Strategy.ReferenceReplay.TerminalPosition != nil, r.Strategy.ReferenceReplay.PendingSignalUnfilled, r.Strategy.ReferenceReplay.ClosedTradeCount)
	out.WriteString("Model | cash | open value | equity | realized PnL | unrealized PnL | net model PnL | fees | quantity | maximum close-mark drawdown\n")
	row := func(name, cash, value, equity, realized, unrealized, fees string, q float64, d backtest.FundedCausalDrawdown) {
		eq, _ := fundedCLIUnits(equity, false, fundedCLIMaxEquity)
		initial, _ := fundedCLIUnits(r.InitialModelCashUnits, false, fundedCLIMaxUnits)
		fmt.Fprintf(&out, "%s | %s | %s | %s | %s | %s | %s | %s | %.17g | %s\n", name, money(cash), money(value), money(equity), money(realized), money(unrealized), money(strconv.FormatInt(eq-initial, 10)), money(fees), q, dd(d))
	}
	s := r.Strategy
	row("strategy:MeanReversion", s.FinalModelCashUnits, s.FinalPositionValueUnits, s.FinalEquityUnits, s.NetRealizedAccountingPnLUnits, s.NetUnrealizedAccountingPnLUnits, s.AggregateFeeUnits, s.FinalModelQuantity, s.MaxCloseMarkDrawdown)
	for _, c := range []backtest.ComparisonControlResult{r.Cash, r.Passive} {
		row(c.PolicyIdentity, c.FinalModelCashUnits, c.FinalPositionValueUnits, c.FinalEquityUnits, c.NetRealizedAccountingPnLUnits, c.NetUnrealizedAccountingPnLUnits, c.AggregateFeeUnits, c.FinalModelQuantity, c.MaxCloseMarkDrawdown)
	}
	fmt.Fprintf(&out, "Passive eligibility: index20 open after20 closes; status: %s\n", r.Passive.EntryStatus)
	if e := r.Passive.Entry; e != nil {
		fmt.Fprintf(&out, "Passive required debit: %s; candidate principal: %s; candidate entry fee: %s; available cash: %s; reference price: %.17g; execution price: %.17g\n", money(e.RequiredModelCashUnits), money(e.PrincipalUnits), money(e.FeeUnits), money(e.AvailableModelCashUnits), e.ReferencePrice, e.ExecutionPrice)
	}
	fmt.Fprintf(&out, "Ending equity gaps (strategy minus control): cash %s; passive %s\n", money(r.StrategyMinusCashUnits), money(r.StrategyMinusPassiveUnits))
	out.WriteString("Controls do not evaluate strategies. Passive holds one lot to the final supplied close; no protection, rebalancing or terminal sale. SELL costs apply only to a SELL.\nExposure duration, protection and turnover differ; equal declarations do not imply equal risk. No extra execution-price cash charge. Synthetic uncalibrated scenario assumptions; supplied CSV authenticity is unknown. No ranking, statistical edge, profitability, qualification or operating admission.\n")
	out.WriteString("Original OHLC reference events are checked conditional on normalized signals; indicator calculations and input authenticity are not independently verified.\n")
	return out.String(), out.Len() <= comparisonCLISummaryMaxBytes
}

const mean20CLIUsage = "Usage: gelt backtest-causal-meanrev-compare MeanReversion SYMBOL CSV CASH FIXED_FEE FEE_BPS BUY_BPS SELL_BPS [--window START END]\n"

func mean20CLIFail(w io.Writer, code string) int {
	switch code {
	case "invalid_window", "insufficient_warmup", "invalid_result", "invalid_arguments", "input_file", "invalid_csv", "resource_limit", "unsupported_target", "invalid_model_cash", "invalid_execution_scenario", "insufficient_exit_fee_cash", "invalid_input", "invalid_symbol", "invalid_evaluator", "evaluator_identity", "evaluator_error", "plan_membership", "unsupported_condition", "numeric_range", "canceled", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	text := "backtest-causal-meanrev-compare: " + code + "\n"
	if code == "invalid_arguments" {
		text = mean20CLIUsage + text
	}
	if w != nil {
		_, _ = io.WriteString(w, text)
	}
	return 1
}
func runBacktestCausalMean20Comparison(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 8 && len(args) != 11 {
		return mean20CLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return mean20CLIFail(stderr, "canceled")
	}
	f, err := openOfflineCSV(args[2])
	if err != nil {
		return mean20CLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return mean20CLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return mean20CLIFail(stderr, "input_file")
		default:
			return mean20CLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return mean20CLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return mean20CLIFail(stderr, "canceled")
	}
	var w backtest.DeclaredComparisonWindow
	if len(args) == 11 {
		if args[8] != "--window" {
			return mean20CLIFail(stderr, "invalid_arguments")
		}
		var ok bool
		w.StartInclusiveUnix, ok = windowCLIUnix(args[9], true)
		if !ok {
			return mean20CLIFail(stderr, "invalid_window")
		}
		w.EndExclusiveUnix, ok = windowCLIUnix(args[10], false)
		if !ok {
			return mean20CLIFail(stderr, "invalid_window")
		}
	}
	if args[0] != "MeanReversion" {
		return mean20CLIFail(stderr, "unsupported_target")
	}
	scenario := backtest.ExecutionScenario{FixedFee: args[4], FeeBps: args[5], BuyAdverseBps: args[6], SellAdverseBps: args[7]}
	original := append([]backtest.OHLCV(nil), bars...)
	var summary string
	var valid bool
	if len(args) == 8 {
		result, err := backtest.RunMean20ComparisonCausal(ctx, args[1], bars, args[3], scenario)
		if err != nil {
			var x *backtest.Mean20ComparisonError
			if errors.As(err, &x) && x != nil {
				return mean20CLIFail(stderr, string(x.Code))
			}
			return mean20CLIFail(stderr, "replay_failed")
		}
		summary, valid = mean20CLISummary(ctx, result, original, args[1], args[3], scenario)
	} else {
		result, err := backtest.RunMean20WindowComparisonCausal(ctx, args[1], bars, w, args[3], scenario)
		if err != nil {
			var x *backtest.Mean20WindowComparisonError
			if errors.As(err, &x) && x != nil {
				return mean20CLIFail(stderr, string(x.Code))
			}
			return mean20CLIFail(stderr, "replay_failed")
		}
		summary, valid = mean20WindowCLISummary(ctx, result, original, args[1], w, args[3], scenario)
	}
	if ctx.Err() != nil {
		return mean20CLIFail(stderr, "canceled")
	}
	if !valid {
		return mean20CLIFail(stderr, "invalid_result")
	}
	if stdout == nil {
		return mean20CLIFail(stderr, "output_error")
	}
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return mean20CLIFail(stderr, "output_error")
	}
	return 0
}
