package main

import (
	"bytes"
	"context"
	"encoding/json"
	"gelt/pkg/backtest"
	"strconv"
	"strings"
	"testing"
)

func windowCLIResult(t *testing.T, mode string) (backtest.WindowComparisonResult, []backtest.OHLCV, backtest.DeclaredComparisonWindow) {
	t.Helper()
	bars := feeScenarioCLIBars(27, 100)
	window := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 24, EndExclusiveUnix: 26}
	engine, _ := feeScenarioCLIEngine(mode)
	r, err := engine.RunWindowComparisonCausal(nil, "TEST", bars, window, "100", comparisonCLIScenario())
	if err != nil {
		t.Fatal(err)
	}
	return r, bars, window
}
func cloneWindowCLI(t *testing.T, r backtest.WindowComparisonResult) backtest.WindowComparisonResult {
	t.Helper()
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var out backtest.WindowComparisonResult
	if err = json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func TestWindowCLIActualCSVAndBoundedLabels(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(27))
	for _, cash := range []string{"0", "9.99999999", "10", "100"} {
		var stdout, stderr bytes.Buffer
		args := []string{"BreakoutVol", "TEST", path, "24", "26", cash, "1", "0", "0", "0"}
		if code := runBacktestCausalWindowComparison(nil, args, &stdout, &stderr); code != 0 {
			t.Fatalf("%d %s", code, stderr.String())
		}
		for _, label := range []string{backtest.WindowComparisonModelIdentity, backtest.WindowComparisonSelectionPolicy, "Source bars: 27; warmup: 20; scored: 2; consumed: 22", "selection_history_unestablished", "strategy fill causality against original open/high/low is not independently revalidated", "10.00000000", "Exposure, protection and turnover differ"} {
			if !strings.Contains(stdout.String(), label) {
				t.Fatal("missing", label)
			}
		}
		if stdout.Len() > 8192 || stderr.Len() != 0 || strings.Contains(stdout.String(), path) || strings.Contains(stdout.String(), "PRIVATE_") {
			t.Fatal("privacy/output")
		}
	}
}
func TestWindowCLIIndependentProjectionForgeries(t *testing.T) {
	for _, mode := range []string{"hold", "buy", "roundtrip"} {
		good, bars, w := windowCLIResult(t, mode)
		if !windowCLIResultValid(nil, good, bars, "TEST", w, "100", comparisonCLIScenario()) {
			t.Fatal("valid denied", mode)
		}
		mutations := []func(*backtest.WindowComparisonResult){
			func(r *backtest.WindowComparisonResult) { r.SourceTotalBars++ }, func(r *backtest.WindowComparisonResult) { r.WarmupStartSourceIndex++ }, func(r *backtest.WindowComparisonResult) { r.ScoreStartSourceIndex++ }, func(r *backtest.WindowComparisonResult) { r.ScoreEndExclusiveSourceIndex++ }, func(r *backtest.WindowComparisonResult) { r.ExcludedAfterScoreCount++ }, func(r *backtest.WindowComparisonResult) { r.ScoredBars++ }, func(r *backtest.WindowComparisonResult) { r.Window.EndExclusiveUnix++ }, func(r *backtest.WindowComparisonResult) { r.Strategy.StartingEquityUnits = "999" }, func(r *backtest.WindowComparisonResult) { r.Passive.EndingEquityUnits = "1" }, func(r *backtest.WindowComparisonResult) { r.Cash.MaxCloseMarkDrawdown.UndefinedReason = "forged" }, func(r *backtest.WindowComparisonResult) { r.Replay.Strategy.CloseMarks[0].AggregateFeeUnits = "1" }, func(r *backtest.WindowComparisonResult) { r.Replay.Strategy.CloseMarks[20].EquityUnits = "1" }, func(r *backtest.WindowComparisonResult) { r.Replay.Passive.Entry.BarIndex = 21 }, func(r *backtest.WindowComparisonResult) { r.Replay.Strategy.ReferenceReplay.WinningClosedTradeCount++ }, func(r *backtest.WindowComparisonResult) { r.Replay.Strategy.ReferenceReplay.GrossProfit = 1 }, func(r *backtest.WindowComparisonResult) {
				r.Replay.Strategy.ReferenceReplay.GrossProfitFactorReason = "forged"
			},
		}
		for i, mutate := range mutations {
			r := cloneWindowCLI(t, good)
			mutate(&r)
			if windowCLIResultValid(nil, r, bars, "TEST", w, "100", comparisonCLIScenario()) {
				t.Fatalf("forgery%d %s", i, mode)
			}
		}
		changed := append([]backtest.OHLCV(nil), bars...)
		changed[23].Close = 101
		changed[23].High = 101
		if windowCLIResultValid(nil, good, changed, "TEST", w, "100", comparisonCLIScenario()) {
			t.Fatal("wrong original close")
		}
	}
}
func TestWindowCLIValidationLimitIsExplicit(t *testing.T) {
	original := feeScenarioCLIBars(21, 100)
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 21, EndExclusiveUnix: 22}
	altered := append([]backtest.OHLCV(nil), original...)
	altered[20].Open = 99
	altered[20].Low = 99
	engine, _ := feeScenarioCLIEngine("buy")
	r, err := engine.RunWindowComparisonCausal(nil, "TEST", altered, w, "100", comparisonCLIScenario())
	if err != nil {
		t.Fatal(err)
	}
	controlEngine, _ := feeScenarioCLIEngine("hold")
	controls, err := controlEngine.RunComparisonCausal(nil, "TEST", original, "100", comparisonCLIScenario())
	if err != nil {
		t.Fatal(err)
	}
	r.Replay.Cash = controls.Cash
	r.Replay.Passive = controls.Passive
	eq, _ := strconv.ParseInt(r.Replay.Strategy.FinalEquityUnits, 10, 64)
	r.Replay.StrategyMinusPassiveUnits = strconv.FormatInt(eq-10000000000, 10)
	// Both controls still have equity100 on the original input; their score rows match.
	r.Cash.EndingCashUnits = controls.Cash.FinalModelCashUnits
	r.Passive.EndingCashUnits = controls.Passive.FinalModelCashUnits
	r.Passive.EndingPositionValueUnits = controls.Passive.FinalPositionValueUnits
	r.Passive.EndingEquityUnits = controls.Passive.FinalEquityUnits
	r.Passive.NetUnrealizedAccountingPnLUnits = controls.Passive.NetUnrealizedAccountingPnLUnits
	r.Passive.NetAccountingPnLUnits = "0"
	r.Passive.EndingModelQuantity = controls.Passive.FinalModelQuantity
	r.Passive.MaxCloseMarkDrawdown = controls.Passive.MaxCloseMarkDrawdown
	r.Passive.DrawdownSourceBarIndex = nil
	r.Passive.DrawdownScoredBarIndex = nil
	// This coherent alternate-open strategy trace is NOT independent original-OHLC proof.
	if !windowCLIResultValid(nil, r, original, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("limitation fixture no longer matches shipped consistency checks; adjudicate rather than overclaim")
	}
}
func TestWindowCLINegativeInputCancellationAndOneWrite(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(27))
	base := []string{"BreakoutVol", "TEST", path, "24", "26", "100", "0", "0", "0", "0"}
	for _, bad := range []string{"", "0", "024", "+24", "-24", "24 ", "1e2", "253402300800", "PRIVATE"} {
		args := append([]string(nil), base...)
		args[3] = bad
		var o, e bytes.Buffer
		if runBacktestCausalWindowComparison(nil, args, &o, &e) != 1 || o.Len() != 0 || e.String() != "backtest-causal-window-compare: invalid_window\n" {
			t.Fatal("timestamp", bad, e.String())
		}
	}
	for _, content := range []string{causalCLITestPositiveCSV(27) + "\nPRIVATE_TAIL", strings.Repeat("x", causalCSVMaxBytes+1)} {
		args := append([]string(nil), base...)
		args[0] = "PRIVATE_TARGET"
		args[2] = causalCLITestFile(t, content)
		var o, e bytes.Buffer
		if runBacktestCausalWindowComparison(nil, args, &o, &e) != 1 || o.Len() != 0 || strings.Contains(e.String(), "PRIVATE") {
			t.Fatal("parse/sanitizer")
		}
	}
	args := append([]string(nil), base...)
	args[0] = "TrendConfluence"
	var o, e bytes.Buffer
	if runBacktestCausalWindowComparison(nil, args, &o, &e) != 1 || !strings.Contains(e.String(), "unsupported_target") {
		t.Fatal("subset")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	o.Reset()
	e.Reset()
	if runBacktestCausalWindowComparison(ctx, base, &o, &e) != 1 || o.Len() != 0 || !strings.Contains(e.String(), "canceled") {
		t.Fatal("cancel")
	}
	for _, fail := range []bool{false, true} {
		writer := &feeScenarioCLIWriter{short: !fail, fail: fail, prefix: 5}
		e.Reset()
		if runBacktestCausalWindowComparison(nil, base, writer, &e) != 1 || writer.calls != 1 || !strings.Contains(e.String(), "output_error") {
			t.Fatal("write retry", writer.calls)
		}
	}
}
func TestWindowCLICancelDuringReplayAndLegacyCompatibility(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	engine, spy := feeScenarioCLIEngine("hold")
	spy.cancel = cancel
	var out, stderr bytes.Buffer
	if runBacktestCausalWindowComparisonEngine(ctx, "TEST", feeScenarioCLIBars(21, 100), backtest.DeclaredComparisonWindow{StartInclusiveUnix: 21, EndExclusiveUnix: 22}, "100", comparisonCLIScenario(), engine, &out, &stderr) != 1 || out.Len() != 0 || !strings.Contains(stderr.String(), "canceled") {
		t.Fatal("callbackcancel")
	}
	path := causalCLITestFile(t, causalCLITestPositiveCSV(27))
	out.Reset()
	stderr.Reset()
	if runBacktestCausalComparison(nil, []string{"BreakoutVol", "TEST", path, "100", "0", "0", "0", "0"}, &out, &stderr) != 0 || !strings.Contains(out.String(), backtest.ComparisonCausalModelIdentity) || strings.Contains(out.String(), "declared-window") {
		t.Fatal("old comparison changed")
	}
}

func TestWindowCLIFeeDrawdownAndMalformedExcludedDomain(t *testing.T) {
	bars := feeScenarioCLIBars(27, 100)
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 24, EndExclusiveUnix: 26}
	scenario := comparisonCLIScenario()
	scenario.FixedFee = "1"
	engine, _ := feeScenarioCLIEngine("hold")
	r, err := engine.RunWindowComparisonCausal(nil, "TEST", bars, w, "100", scenario)
	if err != nil || !windowCLIResultValid(nil, r, bars, "TEST", w, "100", scenario) {
		t.Fatal("fee DD", err)
	}
	if r.Passive.DrawdownSourceBarIndex == nil || *r.Passive.DrawdownSourceBarIndex != 23 || *r.Passive.DrawdownScoredBarIndex != 0 {
		t.Fatal("DDmap")
	}
	for _, mutate := range []func(*backtest.WindowComparisonResult){func(r *backtest.WindowComparisonResult) { *r.Passive.DrawdownSourceBarIndex++ }, func(r *backtest.WindowComparisonResult) { *r.Passive.DrawdownScoredBarIndex++ }, func(r *backtest.WindowComparisonResult) { *r.Passive.MaxCloseMarkDrawdown.Percent = 50 }} {
		bad := cloneWindowCLI(t, r)
		mutate(&bad)
		if windowCLIResultValid(nil, bad, bars, "TEST", w, "100", scenario) {
			t.Fatal("forged DDmap")
		}
	}
	full := causalCLITestPositiveCSV(27) + "\n28,100,100,100,100,1000000000001"
	path := causalCLITestFile(t, full)
	var out, stderr bytes.Buffer
	if runBacktestCausalWindowComparison(nil, []string{"BreakoutVol", "TEST", path, "24", "26", "100", "0", "0", "0", "0"}, &out, &stderr) != 1 || out.Len() != 0 || !strings.Contains(stderr.String(), "invalid_input") {
		t.Fatal("invalid excluded numeric tail")
	}
}
