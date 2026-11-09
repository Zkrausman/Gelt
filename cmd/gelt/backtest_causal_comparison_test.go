package main

import (
	"bytes"
	"context"
	"gelt/pkg/backtest"
	"math"
	"strings"
	"testing"
)

func comparisonCLIScenario() backtest.ExecutionScenario {
	return backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
}
func comparisonCLIResult(t *testing.T, n int, mode, cash string, s backtest.ExecutionScenario) (backtest.ComparisonCausalResult, []backtest.OHLCV) {
	t.Helper()
	e, _ := feeScenarioCLIEngine(mode)
	bars := feeScenarioCLIBars(n, 100)
	r, err := e.RunComparisonCausal(nil, "TEST", bars, cash, s)
	if err != nil {
		t.Fatal(err)
	}
	return r, bars
}

func TestComparisonCLIActualCSV(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(25))
	for _, cash := range []string{"0", "9.99999999", "10", "100"} {
		var out, err bytes.Buffer
		code := runBacktestCausalComparison(nil, []string{"BreakoutVol", "TEST", path, cash, "1", "1", "100", "200"}, &out, &err)
		if code != 0 || err.Len() != 0 {
			t.Fatalf("actual %d %s", code, err.String())
		}
		for _, label := range []string{backtest.ComparisonCausalModelIdentity, "flat_cash_no_interest_no_fills", "fixed_after_20_closes_one_buy_no_exit", "uncalibrated_declared", "maximum close-mark drawdown", "Exposure duration, protection and turnover differ", "No ranking", "10.00000000"} {
			if !strings.Contains(out.String(), label) {
				t.Fatal("missing disclosure", label)
			}
		}
		if out.Len() > 8192 || strings.Contains(out.String(), path) {
			t.Fatal("privacy/bound")
		}
	}
	for _, bad := range []string{"", "-1", "00", "1e2", "10000", "PRIVATE"} {
		var out, err bytes.Buffer
		if runBacktestCausalComparison(nil, []string{"BreakoutVol", "TEST", path, "100", "0", "0", bad, "0"}, &out, &err) != 1 || out.Len() != 0 || strings.Contains(err.String(), "PRIVATE") {
			t.Fatal("rate grammar/privacy")
		}
	}
	for _, n := range []int{1, 19, 20} {
		r, bars := comparisonCLIResult(t, n, "hold", "0", comparisonCLIScenario())
		if _, ok := backtestCausalComparisonSummary(r, bars, "TEST", "0", comparisonCLIScenario()); !ok {
			t.Fatal("short zero cash")
		}
	}
}

func TestComparisonCLIIndependentReconstruction(t *testing.T) {
	for _, mode := range []string{"hold", "buy", "roundtrip"} {
		for _, rate := range []string{"0", "1", "100", "9999"} {
			for _, cash := range []string{"0", "9.99999999", "100"} {
				s := comparisonCLIScenario()
				s.FixedFee = "1"
				s.FeeBps = "100"
				s.BuyAdverseBps = rate
				s.SellAdverseBps = rate
				r, bars := comparisonCLIResult(t, 24, mode, cash, s)
				if !comparisonCLIResultValid(r, bars, "TEST", cash, s) {
					t.Fatal("valid result rejected", mode, rate, cash)
				}
			}
		}
	}
	mutations := []func(*backtest.ComparisonCausalResult){
		func(r *backtest.ComparisonCausalResult) { r.ModelIdentity = "PRIVATE" },
		func(r *backtest.ComparisonCausalResult) { r.Passive.ModelIdentity = "PRIVATE" },
		func(r *backtest.ComparisonCausalResult) { r.Cash.TotalBars-- },
		func(r *backtest.ComparisonCausalResult) {
			r.Passive.CloseMarks[20].Timestamp = r.Passive.CloseMarks[19].Timestamp
		},
		func(r *backtest.ComparisonCausalResult) { r.Passive.Entry.ReferencePrice = 99 },
		func(r *backtest.ComparisonCausalResult) { r.Passive.Entry.ExecutionPrice = 99 },
		func(r *backtest.ComparisonCausalResult) { r.Passive.Entry.FeeUnits = "1" },
		func(r *backtest.ComparisonCausalResult) { r.Passive.Entry.PolicyDecisionBarIndex = 18 },
		func(r *backtest.ComparisonCausalResult) {
			r.Passive.EntryStatus = "no_eligible_bar"
			r.Passive.Entry = nil
		},
		func(r *backtest.ComparisonCausalResult) { r.Passive.FinalModelQuantity = math.NaN() },
		func(r *backtest.ComparisonCausalResult) { r.Passive.CloseMarks[20].PositionPrincipalUnits = "1" },
		func(r *backtest.ComparisonCausalResult) { r.Passive.FinalPositionTotalBasisUnits = "1" },
		func(r *backtest.ComparisonCausalResult) { r.Passive.CloseMarks[20].PeakEquityUnits = "1" },
		func(r *backtest.ComparisonCausalResult) { r.StrategyMinusCashUnits = "1" },
		func(r *backtest.ComparisonCausalResult) { r.Strategy.ReferenceReplay.GrossRealizedPnL = 1 },
		func(r *backtest.ComparisonCausalResult) { r.Strategy.ReferenceReplay.WinningClosedTradeCount = 999 },
		// Coordinated internally balanced flat-cash forgery still disagrees with
		// the actual policy and source closes, rather than just summary algebra.
		func(r *backtest.ComparisonCausalResult) {
			p := r.Passive
			r.Cash = p
			r.Cash.ModelIdentity = backtest.ComparisonCashModelIdentity
			r.Cash.PolicyIdentity = backtest.ComparisonCashPolicy
		},
	}
	for i, mutate := range mutations {
		r, bars := comparisonCLIResult(t, 24, "roundtrip", "100", comparisonCLIScenario())
		mutate(&r)
		if _, ok := backtestCausalComparisonSummary(r, bars, "TEST", "100", comparisonCLIScenario()); ok {
			t.Fatal("forgery accepted", i)
		}
	}
	r, bars := comparisonCLIResult(t, 24, "buy", "100", comparisonCLIScenario())
	bars[23].Close = 101
	bars[23].High = 101
	if comparisonCLIResultValid(r, bars, "TEST", "100", comparisonCLIScenario()) {
		t.Fatal("detached bar forgery")
	}
	r, bars = comparisonCLIResult(t, 24, "buy", "100", comparisonCLIScenario())
	s := comparisonCLIScenario()
	s.SellAdverseBps = "1"
	if comparisonCLIResultValid(r, bars, "TEST", "100", s) {
		t.Fatal("detached config")
	}
}

func TestComparisonCLIWholeInputPrivacyAndSingleAttempt(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21)+"PRIVATE_BAD_ROW\n")
	for _, args := range [][]string{nil, {"BreakoutVol", "TEST", path, "100", "0", "0", "0", "0"}, {"PRIVATE", "TEST", path, "100", "0", "0", "0", "0"}, {"BreakoutVol", "PRIVATE!", "PRIVATE_PATH", "100", "0", "0", "0", "0"}} {
		var out, err bytes.Buffer
		if runBacktestCausalComparison(nil, args, &out, &err) != 1 || out.Len() != 0 || strings.Contains(err.String(), "PRIVATE") {
			t.Fatal("input/usage privacy")
		}
	}
	for _, mode := range []string{"identity", "error", "prompt", "numeric"} {
		e, _ := feeScenarioCLIEngine(mode)
		var out, err bytes.Buffer
		if runBacktestCausalComparisonEngine(nil, "TEST", feeScenarioCLIBars(22, 100), "100", comparisonCLIScenario(), e, &out, &err) != 1 || out.Len() != 0 || strings.Contains(err.String(), "PRIVATE") {
			t.Fatal("callback leak")
		}
	}
	for _, fail := range []bool{true, false} {
		e, s := feeScenarioCLIEngine("buy")
		w := &feeScenarioCLIWriter{fail: fail, short: !fail, prefix: 17}
		var err bytes.Buffer
		if runBacktestCausalComparisonEngine(nil, "TEST", feeScenarioCLIBars(22, 100), "100", comparisonCLIScenario(), e, w, &err) != 1 || w.calls != 1 || w.Len() != 17 || s.calls != 3 || err.String() != "backtest-causal-compare: output_error\n" {
			t.Fatal("output retry/partial success", err.String())
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	e, s := feeScenarioCLIEngine("buy")
	var out, err bytes.Buffer
	if runBacktestCausalComparisonEngine(ctx, "TEST", feeScenarioCLIBars(22, 100), "100", comparisonCLIScenario(), e, &out, &err) != 1 || out.Len() != 0 || s.calls != 0 {
		t.Fatal("canceled callback")
	}
}
