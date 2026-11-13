package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"strconv"
	"strings"

	"gelt/pkg/backtest"
)

const trend50WindowCLIUsage = "Usage: gelt backtest-causal-trend50-window-compare <Target> <Symbol> <CSV> <StartInclusiveUnix> <EndExclusiveUnix> <InitialCash> <FixedFee> <FeeBps> <BuyBps> <SellBps>\nSupported target: TrendConfluence only.\n"

func trend50WindowCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_window", "insufficient_warmup", "invalid_result", "invalid_arguments", "input_file", "invalid_csv", "resource_limit", "unsupported_target", "invalid_model_cash", "invalid_execution_scenario", "insufficient_exit_fee_cash", "invalid_input", "invalid_symbol", "invalid_evaluator", "evaluator_identity", "evaluator_error", "plan_membership", "unsupported_condition", "numeric_range", "canceled", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	text := "backtest-causal-trend50-window-compare: " + code + "\n"
	if code == "invalid_arguments" {
		text = trend50WindowCLIUsage + text
	}
	if stderr != nil {
		_, _ = io.WriteString(stderr, text)
	}
	return 1
}
func runBacktestCausalTrend50WindowComparison(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 10 {
		return trend50WindowCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return trend50WindowCLIFail(stderr, "canceled")
	}
	f, err := os.Open(args[2])
	if err != nil {
		return trend50WindowCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return trend50WindowCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return trend50WindowCLIFail(stderr, "input_file")
		default:
			return trend50WindowCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return trend50WindowCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return trend50WindowCLIFail(stderr, "canceled")
	}
	start, ok := windowCLIUnix(args[3], true)
	if !ok {
		return trend50WindowCLIFail(stderr, "invalid_window")
	}
	end, ok := windowCLIUnix(args[4], false)
	if !ok {
		return trend50WindowCLIFail(stderr, "invalid_window")
	}
	if args[0] != "TrendConfluence" {
		return trend50WindowCLIFail(stderr, "unsupported_target")
	}
	return runBacktestCausalTrend50WindowComparisonData(ctx, args[1], bars, backtest.DeclaredComparisonWindow{StartInclusiveUnix: start, EndExclusiveUnix: end}, args[5], backtest.ExecutionScenario{FixedFee: args[6], FeeBps: args[7], BuyAdverseBps: args[8], SellAdverseBps: args[9]}, stdout, stderr)
}

// Package-local typed seam is for synthetic tests only, never a caller resolver.
func runBacktestCausalTrend50WindowComparisonData(ctx context.Context, symbol string, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario, stdout, stderr io.Writer) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return trend50WindowCLIFail(stderr, "canceled")
	}
	original := append([]backtest.OHLCV(nil), bars...)
	r, err := backtest.RunTrend50WindowComparisonCausal(ctx, symbol, append([]backtest.OHLCV(nil), original...), w, cash, scenario)
	if err != nil {
		var failure *backtest.Trend50WindowComparisonError
		if errors.As(err, &failure) && failure != nil {
			return trend50WindowCLIFail(stderr, string(failure.Code))
		}
		return trend50WindowCLIFail(stderr, "replay_failed")
	}
	summary, ok := backtestCausalTrend50WindowComparisonSummary(ctx, r, original, symbol, w, cash, scenario)
	if !ok {
		if ctx.Err() != nil {
			return trend50WindowCLIFail(stderr, "canceled")
		}
		return trend50WindowCLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return trend50WindowCLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return trend50WindowCLIFail(stderr, "output_error")
	}
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return trend50WindowCLIFail(stderr, "output_error")
	}
	return 0
}

// Independent source selection, never derived from returned mapping metadata.
func trend50WindowCLISelection(ctx context.Context, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow) (int, int, bool) {
	if len(bars) < 51 || len(bars) > 10000 || w.StartInclusiveUnix < 1 || w.StartInclusiveUnix > 253402300799 || w.EndExclusiveUnix < 2 || w.EndExclusiveUnix > 253402300800 || w.StartInclusiveUnix >= w.EndExclusiveUnix {
		return 0, 0, false
	}
	s, e := -1, -1
	for i, b := range bars {
		if ctx.Err() != nil || b.Timestamp < 1 || b.Timestamp > 253402300799 || i > 0 && b.Timestamp <= bars[i-1].Timestamp || !causalCLIFinite(b.Open, .01, 1000000) || !causalCLIFinite(b.High, .01, 1000000) || !causalCLIFinite(b.Low, .01, 1000000) || !causalCLIFinite(b.Close, .01, 1000000) || !causalCLIFinite(b.Volume, 0, 1e12) || b.Low > b.Open || b.Low > b.Close || b.High < b.Open || b.High < b.Close || b.Low > b.High {
			return 0, 0, false
		}
		if b.Timestamp == w.StartInclusiveUnix {
			s = i
		}
		if b.Timestamp == w.EndExclusiveUnix {
			e = i
		}
	}
	if w.EndExclusiveUnix == bars[len(bars)-1].Timestamp+1 {
		e = len(bars)
	}
	return s, e, s >= 50 && e > s
}
func trend50WindowCLIScore(ctx context.Context, model string, marks []backtest.ExecutionScenarioCausalCloseMark, initial int64, offset int) (backtest.WindowComparisonScore, bool) {
	if len(marks) < 51 || len(marks) > 10000 {
		return backtest.WindowComparisonScore{}, false
	}
	peak, lossMax, peakAtMax, indexMax := initial, int64(0), int64(0), -1
	for i, m := range marks {
		if ctx.Err() != nil {
			return backtest.WindowComparisonScore{}, false
		}
		if i < 50 {
			if !windowCLIFlat(m, initial) {
				return backtest.WindowComparisonScore{}, false
			}
			continue
		}
		equity, ok := fundedCLIUnits(m.EquityUnits, false, fundedCLIMaxEquity)
		if !ok {
			return backtest.WindowComparisonScore{}, false
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity
		if m.PeakEquityUnits != strconv.FormatInt(peak, 10) || !fundedCLIDrawdownValid(m.CloseMarkDrawdown, loss, peak, i) {
			return backtest.WindowComparisonScore{}, false
		}
		if loss > 0 && peak > 0 && (lossMax == 0 || fundedCLIRatioGreater(loss, peak, lossMax, peakAtMax)) {
			lossMax, peakAtMax, indexMax = loss, peak, i
		}
	}
	if lossMax == 0 {
		peakAtMax = peak
	}
	dd := comparisonCLIDD(lossMax, peakAtMax, indexMax)
	last := marks[len(marks)-1]
	equity, ok := fundedCLIUnits(last.EquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		return backtest.WindowComparisonScore{}, false
	}
	r := backtest.WindowComparisonScore{ModelIdentity: model, StartingEquityUnits: strconv.FormatInt(initial, 10), EndingCashUnits: last.ModelCashUnits, EndingPositionValueUnits: last.PositionValueUnits, EndingEquityUnits: last.EquityUnits, NetRealizedAccountingPnLUnits: last.NetRealizedAccountingPnLUnits, NetUnrealizedAccountingPnLUnits: last.NetUnrealizedAccountingPnLUnits, NetAccountingPnLUnits: strconv.FormatInt(equity-initial, 10), AggregateFeeUnits: last.AggregateFeeUnits, EndingModelQuantity: last.ModelQuantity, MaxCloseMarkDrawdown: dd}
	if dd.BarIndex != nil {
		source, scored := offset+*dd.BarIndex, *dd.BarIndex-50
		r.DrawdownSourceBarIndex = &source
		r.DrawdownScoredBarIndex = &scored
	}
	return r, true
}
func trend50WindowCLIResultValid(ctx context.Context, r backtest.Trend50WindowComparisonResult, full []backtest.OHLCV, symbol string, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	s, e, ok := trend50WindowCLISelection(ctx, full, w)
	if !ok {
		return false
	}
	offset := s - 50
	bars := full[offset:e]
	if !trend50ComparisonCLIResultValid(ctx, r.Replay, bars, symbol, cash, scenario) || ctx.Err() != nil {
		return false
	}
	initial, ok := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	strategy, ok := trend50WindowCLIScore(ctx, r.Replay.Strategy.ModelIdentity, r.Replay.Strategy.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(strategy.MaxCloseMarkDrawdown, r.Replay.Strategy.MaxCloseMarkDrawdown) {
		return false
	}
	flat, ok := trend50WindowCLIScore(ctx, r.Replay.Cash.ModelIdentity, r.Replay.Cash.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(flat.MaxCloseMarkDrawdown, r.Replay.Cash.MaxCloseMarkDrawdown) {
		return false
	}
	passive, ok := trend50WindowCLIScore(ctx, r.Replay.Passive.ModelIdentity, r.Replay.Passive.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(passive.MaxCloseMarkDrawdown, r.Replay.Passive.MaxCloseMarkDrawdown) {
		return false
	}
	expected := backtest.Trend50WindowComparisonResult{ModelIdentity: backtest.Trend50WindowComparisonModelIdentity, ReplayProfileIdentity: backtest.Trend50WindowReplayProfileIdentity, SelectionPolicy: backtest.Trend50WindowSelectionPolicy, ResetPolicy: backtest.Trend50WindowResetPolicy, CadencePolicy: "bar_index_only_cadence_and_session_unqualified", IntradayEligibility: "unestablished", DataLabel: backtest.CausalOfflineLabel, AuthorityLabel: backtest.CausalOfflineLabel, SelectionHistory: "unestablished", Window: w, SourceTotalBars: len(full), WarmupStartSourceIndex: offset, ScoreStartSourceIndex: s, ScoreEndExclusiveSourceIndex: e, ExcludedBeforeWarmupCount: offset, ExcludedAfterScoreCount: len(full) - e, WarmupBars: 50, ScoredBars: e - s, ConsumedBars: e - offset, Replay: r.Replay, Strategy: strategy, Cash: flat, Passive: passive}
	return reflect.DeepEqual(r, expected) && ctx.Err() == nil
}
func backtestCausalTrend50WindowComparisonSummary(ctx context.Context, r backtest.Trend50WindowComparisonResult, full []backtest.OHLCV, symbol string, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) (string, bool) {
	if !trend50WindowCLIResultValid(ctx, r, full, symbol, w, cash, scenario) {
		return "", false
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Offline declared-window comparison: %s\nProfile: %s; selection: %s; reset: %s; symbol: %s\nStart inclusive: %d; end exclusive: %d\nSource bars: %d; warmup: %d; scored: %d; consumed: %d; excluded before warmup: %d; after score: %d\nSource warmup start: %d; score start: %d; score end exclusive: %d; source index = replay index + %d; scored index = replay index - 50\nData/authority: unqualified_offline; declared_window; selection_history_unestablished; assumptions: uncalibrated_declared\n", r.ModelIdentity, r.ReplayProfileIdentity, r.SelectionPolicy, r.ResetPolicy, symbol, w.StartInclusiveUnix, w.EndExclusiveUnix, r.SourceTotalBars, r.WarmupBars, r.ScoredBars, r.ConsumedBars, r.ExcludedBeforeWarmupCount, r.ExcludedAfterScoreCount, r.WarmupStartSourceIndex, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.WarmupStartSourceIndex)
	fmt.Fprintf(&b, "Initial model cash: %s; fee-inclusive entry cap: 10.00000000; fixed fee: %s; fee bps: %s; buy adverse bps: %s; sell adverse bps: %s\n", fundedCLIDecimal(r.Replay.InitialModelCashUnits), fundedCLIDecimal(r.Replay.Scenario.FixedFeeUnits), r.Replay.Scenario.FeeBps, r.Replay.Scenario.BuyAdverseBps, r.Replay.Scenario.SellAdverseBps)
	b.WriteString("Model | starting equity | cash | open value | equity | realized PnL | unrealized PnL | net PnL | fees | quantity | maximum close-mark drawdown | DD source/scored indices\n")
	for _, x := range []backtest.WindowComparisonScore{r.Strategy, r.Cash, r.Passive} {
		dd := "undefined:" + x.MaxCloseMarkDrawdown.UndefinedReason
		if x.MaxCloseMarkDrawdown.Percent != nil {
			dd = fmt.Sprintf("%.8g%%", *x.MaxCloseMarkDrawdown.Percent)
		}
		source, scored := "none", "none"
		if x.DrawdownSourceBarIndex != nil {
			source = strconv.Itoa(*x.DrawdownSourceBarIndex)
			scored = strconv.Itoa(*x.DrawdownScoredBarIndex)
		}
		fmt.Fprintf(&b, "%s | %s | %s | %s | %s | %s | %s | %s | %s | %.17g | %s | %s/%s\n", x.ModelIdentity, fundedCLIDecimal(x.StartingEquityUnits), fundedCLIDecimal(x.EndingCashUnits), fundedCLIDecimal(x.EndingPositionValueUnits), fundedCLIDecimal(x.EndingEquityUnits), fundedCLIDecimal(x.NetRealizedAccountingPnLUnits), fundedCLIDecimal(x.NetUnrealizedAccountingPnLUnits), fundedCLIDecimal(x.NetAccountingPnLUnits), fundedCLIDecimal(x.AggregateFeeUnits), x.EndingModelQuantity, dd, source, scored)
	}
	fmt.Fprintf(&b, "Passive entry: %s; first eligible replay index50/source %d\n", r.Replay.Passive.EntryStatus, r.ScoreStartSourceIndex)
	if e := r.Replay.Passive.Entry; e != nil {
		fmt.Fprintf(&b, "Passive required debit: %s; principal: %s; entry fee: %s; available cash: %s; reference price: %.17g; execution price: %.17g\n", fundedCLIDecimal(e.RequiredModelCashUnits), fundedCLIDecimal(e.PrincipalUnits), fundedCLIDecimal(e.FeeUnits), fundedCLIDecimal(e.AvailableModelCashUnits), e.ReferencePrice, e.ExecutionPrice)
	}
	fmt.Fprintf(&b, "Strategy terminal position open: %t; final directional signal unfilled: %t; closed trades: %d\nEnding equity strategy minus cash: %s; minus passive: %s\n", r.Replay.Strategy.ReferenceReplay.TerminalPosition != nil, r.Replay.Strategy.ReferenceReplay.PendingSignalUnfilled, r.Replay.Strategy.ReferenceReplay.ClosedTradeCount, fundedCLIDecimal(r.Replay.StrategyMinusCashUnits), fundedCLIDecimal(r.Replay.StrategyMinusPassiveUnits))
	b.WriteString("Finite50 replay reseeds indicators at the first consumed bar; convergence, adequate history and intraday eligibility are unestablished. Cadence and sessions are unqualified. Controls do not evaluate strategies. Passive holds to the final scored close with no protection, rebalancing or terminal sale; SELL costs apply only to a SELL. Exposure, protection and turnover differ. No ranking, edge, profitability, untouched-data or qualification claim.\nOriginal OHLC reference events are checked conditional on normalized signals; indicator calculations and input authenticity are not independently verified.\n")
	return b.String(), b.Len() <= 8192
}
