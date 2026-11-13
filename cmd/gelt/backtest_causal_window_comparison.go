package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"time"

	"gelt/pkg/backtest"
)

const windowCLIUsage = "Usage: gelt backtest-causal-window-compare <Target> <Symbol> <CSV> <StartInclusiveUnix> <EndExclusiveUnix> <InitialCash> <FixedFee> <FeeBps> <BuyBps> <SellBps>\nSupported target: BreakoutVol only.\n"

func windowCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_window", "insufficient_warmup", "invalid_result", "invalid_arguments", "input_file", "invalid_csv", "resource_limit", "unsupported_target", "invalid_model_cash", "invalid_execution_scenario", "insufficient_exit_fee_cash", "invalid_input", "invalid_symbol", "invalid_evaluator", "evaluator_identity", "evaluator_error", "plan_membership", "unsupported_condition", "numeric_range", "canceled", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	text := "backtest-causal-window-compare: " + code + "\n"
	if code == "invalid_arguments" {
		text = windowCLIUsage + text
	}
	if stderr != nil {
		_, _ = io.WriteString(stderr, text)
	}
	return 1
}
func windowCLIUnix(s string, start bool) (int64, bool) {
	if len(s) < 1 || len(s) > 12 || s[0] == '0' {
		return 0, false
	}
	for _, b := range []byte(s) {
		if b < '0' || b > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseInt(s, 10, 64)
	low, high := int64(2), int64(253402300800)
	if start {
		low, high = 1, 253402300799
	}
	return n, err == nil && n >= low && n <= high
}
func runBacktestCausalWindowComparison(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 10 {
		return windowCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return windowCLIFail(stderr, "canceled")
	}
	f, err := openOfflineCSV(args[2])
	if err != nil {
		return windowCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return windowCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return windowCLIFail(stderr, "input_file")
		default:
			return windowCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return windowCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return windowCLIFail(stderr, "canceled")
	}
	start, ok := windowCLIUnix(args[3], true)
	if !ok {
		return windowCLIFail(stderr, "invalid_window")
	}
	end, ok := windowCLIUnix(args[4], false)
	if !ok {
		return windowCLIFail(stderr, "invalid_window")
	}
	engine, ok := newBacktestCausalEngine(args[0])
	if !ok {
		if args[0] != "BreakoutVol" {
			return windowCLIFail(stderr, "unsupported_target")
		}
		return windowCLIFail(stderr, "invalid_evaluator")
	}
	return runBacktestCausalWindowComparisonEngine(ctx, args[1], bars, backtest.DeclaredComparisonWindow{StartInclusiveUnix: start, EndExclusiveUnix: end}, args[5], backtest.ExecutionScenario{FixedFee: args[6], FeeBps: args[7], BuyAdverseBps: args[8], SellAdverseBps: args[9]}, engine, stdout, stderr)
}

// Package-local typed seam is for synthetic tests only, never a caller resolver.
func runBacktestCausalWindowComparisonEngine(ctx context.Context, symbol string, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario, engine *backtest.Engine, stdout, stderr io.Writer) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return windowCLIFail(stderr, "canceled")
	}
	original := append([]backtest.OHLCV(nil), bars...)
	r, err := engine.RunWindowComparisonCausal(ctx, symbol, append([]backtest.OHLCV(nil), original...), w, cash, scenario)
	if err != nil {
		var failure *backtest.WindowComparisonError
		if errors.As(err, &failure) && failure != nil {
			return windowCLIFail(stderr, string(failure.Code))
		}
		return windowCLIFail(stderr, "replay_failed")
	}
	summary, ok := backtestCausalWindowComparisonSummary(ctx, r, original, symbol, w, cash, scenario)
	if !ok {
		if ctx.Err() != nil {
			return windowCLIFail(stderr, "canceled")
		}
		return windowCLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return windowCLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return windowCLIFail(stderr, "output_error")
	}
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return windowCLIFail(stderr, "output_error")
	}
	return 0
}

// Independent source selection, never derived from returned mapping metadata.
func windowCLISelection(ctx context.Context, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow) (int, int, bool) {
	if len(bars) < 21 || len(bars) > 10000 || w.StartInclusiveUnix < 1 || w.StartInclusiveUnix > 253402300799 || w.EndExclusiveUnix < 2 || w.EndExclusiveUnix > 253402300800 || w.StartInclusiveUnix >= w.EndExclusiveUnix {
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
	return s, e, s >= 20 && e > s
}
func windowCLIFlat(m backtest.ExecutionScenarioCausalCloseMark, initial int64) bool {
	u := strconv.FormatInt(initial, 10)
	return m.ModelCashUnits == u && m.EquityUnits == u && m.PeakEquityUnits == u && m.ModelQuantity == 0 && m.PositionPrincipalUnits == "0" && m.PositionEntryFeeUnits == "0" && m.PositionTotalBasisUnits == "0" && m.PositionValueUnits == "0" && m.GrossRealizedAccountingPnLUnits == "0" && m.GrossUnrealizedAccountingPnLUnits == "0" && m.NetRealizedAccountingPnLUnits == "0" && m.NetUnrealizedAccountingPnLUnits == "0" && m.ClosedAttributedFeeUnits == "0" && m.OpenAttributedFeeUnits == "0" && m.AggregateFeeUnits == "0" && reflect.DeepEqual(m.CloseMarkDrawdown, comparisonCLIDD(0, initial, m.BarIndex))
}
func windowCLIScore(ctx context.Context, model string, marks []backtest.ExecutionScenarioCausalCloseMark, initial int64, offset int) (backtest.WindowComparisonScore, bool) {
	if len(marks) < 21 || len(marks) > 10000 {
		return backtest.WindowComparisonScore{}, false
	}
	peak, lossMax, peakAtMax, indexMax := initial, int64(0), int64(0), -1
	for i, m := range marks {
		if ctx.Err() != nil {
			return backtest.WindowComparisonScore{}, false
		}
		if i < 20 {
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
		source, scored := offset+*dd.BarIndex, *dd.BarIndex-20
		r.DrawdownSourceBarIndex = &source
		r.DrawdownScoredBarIndex = &scored
	}
	return r, true
}
func windowCLIReferences(r backtest.ComparisonCausalResult, bars []backtest.OHLCV) bool {
	n := len(bars)
	replay := r.Strategy.ReferenceReplay
	at := func(i int, t time.Time) bool {
		return i >= 0 && i < n && t.Equal(time.Unix(bars[i].Timestamp, 0).UTC())
	}
	for _, f := range replay.Fills {
		if !at(f.BarIndex, f.Timestamp) || f.BarIndex < 20 || f.EvaluationBarIndex < 19 || f.EvaluationBarIndex >= f.BarIndex || f.EntrySignalBarIndex < 19 || f.EntrySignalBarIndex >= n || f.EntryBarIndex != f.EntrySignalBarIndex+1 || f.EntryBarIndex >= n {
			return false
		}
	}
	for _, x := range r.Strategy.RejectedEntries {
		if !at(x.BarIndex, x.Timestamp) || x.BarIndex < 20 || x.EvaluationBarIndex != x.BarIndex-1 || !at(x.EvaluationBarIndex, x.EvaluationTimestamp) {
			return false
		}
	}
	if p := replay.TerminalPosition; p != nil {
		if !at(p.EntrySignalBarIndex, p.EntrySignalTimestamp) || p.EntrySignalBarIndex < 19 || !at(p.EntryBarIndex, p.EntryTimestamp) || p.EntryBarIndex != p.EntrySignalBarIndex+1 || p.LastBarIndex != n-1 || !at(p.LastBarIndex, p.LastTimestamp) || p.StopEvaluationBarIndex < -1 || p.StopEvaluationBarIndex >= n || p.TargetEvaluationBarIndex < -1 || p.TargetEvaluationBarIndex >= n {
			return false
		}
	}
	return true
}
func windowCLIResultValid(ctx context.Context, r backtest.WindowComparisonResult, full []backtest.OHLCV, symbol string, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	s, e, ok := windowCLISelection(ctx, full, w)
	if !ok {
		return false
	}
	offset := s - 20
	bars := full[offset:e]
	if !comparisonCLIResultValid(r.Replay, bars, symbol, cash, scenario) || ctx.Err() != nil || !windowCLIReferences(r.Replay, bars) {
		return false
	}
	initial, ok := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	fixed, bps, target, ok := executionScenarioCLIDeclaration(r.Replay.Scenario)
	if !ok {
		return false
	}
	buy, buyOK := executionCLIAdverseRate(scenario.BuyAdverseBps)
	sell, sellOK := executionCLIAdverseRate(scenario.SellAdverseBps)
	if !buyOK || !sellOK || !windowReferenceEvents(ctx, bars, r.Replay.Strategy, initial, fixed, bps, target, buy, sell) {
		return false
	}
	strategy, ok := windowCLIScore(ctx, r.Replay.Strategy.ModelIdentity, r.Replay.Strategy.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(strategy.MaxCloseMarkDrawdown, r.Replay.Strategy.MaxCloseMarkDrawdown) {
		return false
	}
	flat, ok := windowCLIScore(ctx, r.Replay.Cash.ModelIdentity, r.Replay.Cash.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(flat.MaxCloseMarkDrawdown, r.Replay.Cash.MaxCloseMarkDrawdown) {
		return false
	}
	passive, ok := windowCLIScore(ctx, r.Replay.Passive.ModelIdentity, r.Replay.Passive.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(passive.MaxCloseMarkDrawdown, r.Replay.Passive.MaxCloseMarkDrawdown) {
		return false
	}
	expected := backtest.WindowComparisonResult{ModelIdentity: backtest.WindowComparisonModelIdentity, SelectionPolicy: backtest.WindowComparisonSelectionPolicy, DataLabel: backtest.CausalOfflineLabel, AuthorityLabel: backtest.CausalOfflineLabel, SelectionHistory: "unestablished", Window: w, SourceTotalBars: len(full), WarmupStartSourceIndex: offset, ScoreStartSourceIndex: s, ScoreEndExclusiveSourceIndex: e, ExcludedBeforeWarmupCount: offset, ExcludedAfterScoreCount: len(full) - e, WarmupBars: 20, ScoredBars: e - s, ConsumedBars: e - offset, Replay: r.Replay, Strategy: strategy, Cash: flat, Passive: passive}
	return reflect.DeepEqual(r, expected) && ctx.Err() == nil
}
func backtestCausalWindowComparisonSummary(ctx context.Context, r backtest.WindowComparisonResult, full []backtest.OHLCV, symbol string, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) (string, bool) {
	if !windowCLIResultValid(ctx, r, full, symbol, w, cash, scenario) {
		return "", false
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Offline declared-window comparison: %s\nPolicy: %s; symbol: %s\nStart inclusive: %d; end exclusive: %d\nSource bars: %d; warmup: %d; scored: %d; consumed: %d; excluded before warmup: %d; after score: %d\nSource warmup start: %d; score start: %d; score end exclusive: %d; source index = replay index + %d; scored index = replay index - 20\nData/authority: unqualified_offline; declared_window; selection_history_unestablished; assumptions: uncalibrated_declared\n", r.ModelIdentity, r.SelectionPolicy, symbol, w.StartInclusiveUnix, w.EndExclusiveUnix, r.SourceTotalBars, r.WarmupBars, r.ScoredBars, r.ConsumedBars, r.ExcludedBeforeWarmupCount, r.ExcludedAfterScoreCount, r.WarmupStartSourceIndex, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.WarmupStartSourceIndex)
	fmt.Fprintf(&b, "Initial model cash: %s; fee-inclusive entry cap: 10.00000000; fixed fee: %s; fee bps: %s; buy adverse bps: %s; sell adverse bps: %s\n", fundedCLIDecimal(r.Replay.InitialModelCashUnits), fundedCLIDecimal(r.Replay.Scenario.FixedFeeUnits), r.Replay.Scenario.FeeBps, r.Replay.Scenario.BuyAdverseBps, r.Replay.Scenario.SellAdverseBps)
	b.WriteString("Model | cash | open value | equity | realized PnL | unrealized PnL | net PnL | fees | quantity | maximum close-mark drawdown | DD source/scored indices\n")
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
		fmt.Fprintf(&b, "%s | %s | %s | %s | %s | %s | %s | %s | %.17g | %s | %s/%s\n", x.ModelIdentity, fundedCLIDecimal(x.EndingCashUnits), fundedCLIDecimal(x.EndingPositionValueUnits), fundedCLIDecimal(x.EndingEquityUnits), fundedCLIDecimal(x.NetRealizedAccountingPnLUnits), fundedCLIDecimal(x.NetUnrealizedAccountingPnLUnits), fundedCLIDecimal(x.NetAccountingPnLUnits), fundedCLIDecimal(x.AggregateFeeUnits), x.EndingModelQuantity, dd, source, scored)
	}
	fmt.Fprintf(&b, "Passive entry: %s; first eligible replay index20/source %d\n", r.Replay.Passive.EntryStatus, r.ScoreStartSourceIndex)
	if e := r.Replay.Passive.Entry; e != nil {
		fmt.Fprintf(&b, "Passive required debit: %s; principal: %s; entry fee: %s; available cash: %s; reference price: %.17g; execution price: %.17g\n", fundedCLIDecimal(e.RequiredModelCashUnits), fundedCLIDecimal(e.PrincipalUnits), fundedCLIDecimal(e.FeeUnits), fundedCLIDecimal(e.AvailableModelCashUnits), e.ReferencePrice, e.ExecutionPrice)
	}
	fmt.Fprintf(&b, "Strategy terminal position open: %t; final directional signal unfilled: %t; closed trades: %d\nEnding equity strategy minus cash: %s; minus passive: %s\n", r.Replay.Strategy.ReferenceReplay.TerminalPosition != nil, r.Replay.Strategy.ReferenceReplay.PendingSignalUnfilled, r.Replay.Strategy.ReferenceReplay.ClosedTradeCount, fundedCLIDecimal(r.Replay.StrategyMinusCashUnits), fundedCLIDecimal(r.Replay.StrategyMinusPassiveUnits))
	b.WriteString("Controls do not evaluate strategies. Passive holds to the final scored close with no protection, rebalancing or terminal sale; SELL costs apply only to a SELL. Exposure, protection and turnover differ. No ranking, edge, profitability, untouched-data or qualification claim.\nOriginal OHLC reference events are checked conditional on normalized signals; indicator calculations and input authenticity are not independently verified.\n")
	return b.String(), b.Len() <= 8192
}
