package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"gelt/pkg/backtest"
)

func trend50TestBars(n int, bull bool) []backtest.OHLCV {
	bars := feeScenarioCLIBars(n, 100)
	if bull {
		for i := 20; i < 49 && i < n; i++ {
			p := 100 + float64(i-20)*1.5
			bars[i].Open = p
			bars[i].High = p
			bars[i].Low = p
			bars[i].Close = p
		}
	}
	return bars
}
func trend50TestResult(t *testing.T, n int, bull bool, cash string, s backtest.ExecutionScenario) (backtest.Trend50ComparisonResult, []backtest.OHLCV) {
	t.Helper()
	bars := trend50TestBars(n, bull)
	r, err := backtest.RunTrend50ComparisonCausal(context.Background(), "TEST", bars, cash, s)
	if err != nil {
		t.Fatal(err)
	}
	return r, bars
}
func trend50Copy(t *testing.T, r backtest.Trend50ComparisonResult) backtest.Trend50ComparisonResult {
	t.Helper()
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var copy backtest.Trend50ComparisonResult
	if err = json.Unmarshal(b, &copy); err != nil {
		t.Fatal(err)
	}
	return copy
}
func TestTrend50CLIValidResults(t *testing.T) {
	for _, n := range []int{1, 49, 50, 51, 52} {
		for _, bull := range []bool{false, true} {
			for _, cash := range []string{"0", "100"} {
				s := comparisonCLIScenario()
				if n == 52 {
					s = backtest.ExecutionScenario{FixedFee: "1", FeeBps: "100", BuyAdverseBps: "100", SellAdverseBps: "200"}
				}
				r, bars := trend50TestResult(t, n, bull, cash, s)
				if !trend50ComparisonCLIResultValid(context.Background(), r, bars, "TEST", cash, s) {
					t.Fatalf("valid result rejected n=%d bull=%v cash=%s", n, bull, cash)
				}
				if _, ok := backtestCausalTrend50ComparisonSummary(context.Background(), r, bars, "TEST", cash, s); !ok {
					t.Fatal("summary")
				}
			}
		}
	}
}
func TestTrend50CLIRejectForgedResults(t *testing.T) {
	s := comparisonCLIScenario()
	r, bars := trend50TestResult(t, 52, true, "100", s)
	if len(r.Strategy.ReferenceReplay.Fills) == 0 {
		t.Fatal("bull fixture failed to enter")
	}
	mutations := []func(*backtest.Trend50ComparisonResult){
		func(r *backtest.Trend50ComparisonResult) { r.ModelIdentity = backtest.ComparisonCausalModelIdentity },
		func(r *backtest.Trend50ComparisonResult) {
			r.Strategy.ModelIdentity = backtest.ExecutionScenarioCausalModelIdentity
		},
		func(r *backtest.Trend50ComparisonResult) {
			r.Passive.ModelIdentity = backtest.ComparisonPassiveModelIdentity
		},
		func(r *backtest.Trend50ComparisonResult) { r.Passive.Entry.PolicyDecisionBarIndex = 19 },
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.ReferenceReplay.Evaluations[0].PrefixLength = 20 },
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.ReferenceReplay.Fills[0].Price = 99 },
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.ReferenceReplay.Fills[0].EvaluationBarIndex = 48 },
		func(r *backtest.Trend50ComparisonResult) {
			r.Strategy.ReferenceReplay.Fills = nil
			r.Strategy.CashFlows = nil
		},
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.CashFlows[0].FeeUnits = "1" },
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.CloseMarks[50].EquityUnits = "1" },
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.ReferenceReplay.GrossProfit = 1 },
		func(r *backtest.Trend50ComparisonResult) { r.Passive.MaxCloseMarkDrawdown.Percent = nil },
		func(r *backtest.Trend50ComparisonResult) { r.Strategy.ReferenceReplay.TerminalPosition = nil },
	}
	for i, mutate := range mutations {
		copy := trend50Copy(t, r)
		mutate(&copy)
		if trend50ComparisonCLIResultValid(context.Background(), copy, bars, "TEST", "100", s) {
			t.Fatalf("forgery %d accepted", i)
		}
	}
	changed := append([]backtest.OHLCV(nil), bars...)
	changed[50].Open = 99
	changed[50].Low = 99
	if trend50ComparisonCLIResultValid(context.Background(), r, changed, "TEST", "100", s) {
		t.Fatal("changed source open accepted")
	}
	r, bars = trend50TestResult(t, 52, true, "0", s)
	if len(r.Strategy.RejectedEntries) == 0 {
		t.Fatal("nonfill fixture")
	}
	r.Strategy.RejectedEntries = nil
	if trend50ComparisonCLIResultValid(context.Background(), r, bars, "TEST", "0", s) {
		t.Fatal("omitted nonfill")
	}
}
func trend50CSV(n int) string {
	var b strings.Builder
	b.WriteString(causalCSVHeader + "\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "%d,100,100,100,100,1\n", 1700000000+i*60)
	}
	return b.String()
}
func TestTrend50CLICommand(t *testing.T) {
	for _, n := range []int{1, 49, 50, 51} {
		path := causalCLITestFile(t, trend50CSV(n))
		var out, err bytes.Buffer
		code := runBacktestCausalTrend50Comparison(nil, []string{"TrendConfluence", "TEST", path, "100", "1", "0", "0", "0"}, &out, &err)
		if code != 0 || err.Len() != 0 || out.Len() > 8192 || strings.Contains(out.String(), path) || !strings.Contains(out.String(), backtest.Trend50ComparisonModelIdentity) {
			t.Fatalf("n=%d code=%d out=%s err=%s", n, code, out.String(), err.String())
		}
	}
	path := causalCLITestFile(t, trend50CSV(51))
	for _, bad := range [][]string{nil, {"PRIVATE", "TEST", path, "100", "0", "0", "0", "0"}, {"TrendConfluence", "TEST", path, "100", "0", "0", "PRIVATE", "0"}} {
		var out, err bytes.Buffer
		if runBacktestCausalTrend50Comparison(nil, bad, &out, &err) != 1 || out.Len() != 0 || strings.Contains(err.String(), "PRIVATE") {
			t.Fatal("privacy failure")
		}
	}
	malformed := causalCLITestFile(t, trend50CSV(51)+"PRIVATE_BAD_ROW\n")
	var out, err bytes.Buffer
	if runBacktestCausalTrend50Comparison(nil, []string{"PRIVATE", "TEST", malformed, "100", "0", "0", "0", "0"}, &out, &err) != 1 || !strings.Contains(err.String(), "invalid_csv") || strings.Contains(err.String(), "PRIVATE") {
		t.Fatal("tail precedence")
	}
	for _, fail := range []bool{true, false} {
		w := &feeScenarioCLIWriter{fail: fail, short: !fail, prefix: 17}
		err.Reset()
		if runBacktestCausalTrend50Comparison(nil, []string{"TrendConfluence", "TEST", path, "100", "0", "0", "0", "0"}, w, &err) != 1 || w.calls != 1 || err.String() != "backtest-causal-trend50-compare: output_error\n" {
			t.Fatal("single output")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out.Reset()
	err.Reset()
	if runBacktestCausalTrend50Comparison(ctx, []string{"TrendConfluence", "TEST", path, "100", "0", "0", "0", "0"}, &out, &err) != 1 || out.Len() != 0 || !strings.Contains(err.String(), "canceled") {
		t.Fatal("cancel")
	}
}

func TestTrend50CLIReferenceEventsFromBars(t *testing.T) {
	bars := trend50TestBars(52, true)
	bars[51].High = 200
	bars[51].Low = 1
	s := backtest.ExecutionScenario{FixedFee: "1", FeeBps: "100", BuyAdverseBps: "100", SellAdverseBps: "100"}
	r, err := backtest.RunTrend50ComparisonCausal(nil, "TEST", bars, "100", s)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Strategy.ReferenceReplay.Fills) != 2 || r.Strategy.ReferenceReplay.Fills[1].Reason != backtest.CausalStopTouch || !r.Strategy.ReferenceReplay.Fills[1].Ambiguous {
		t.Fatalf("fixture: %+v", r.Strategy.ReferenceReplay.Fills)
	}
	if !trend50ComparisonCLIResultValid(context.Background(), r, bars, "TEST", "100", s) {
		t.Fatal("valid collision rejected")
	}
	fixed, bps, target, ok := executionScenarioCLIDeclaration(r.Scenario)
	if !ok {
		t.Fatal("declaration")
	}
	buy, _ := executionCLIAdverseRate(s.BuyAdverseBps)
	sell, _ := executionCLIAdverseRate(s.SellAdverseBps)
	oracle := func(r backtest.Trend50ComparisonResult, b []backtest.OHLCV) bool {
		return trend50ReferenceEvents(context.Background(), b, r.Strategy, 10000000000, fixed, bps, target, buy, sell)
	}
	if !oracle(r, bars) {
		t.Fatal("expected events rejected")
	}
	copy := trend50Copy(t, r)
	copy.Strategy.ReferenceReplay.Fills = copy.Strategy.ReferenceReplay.Fills[:1]
	if oracle(copy, bars) {
		t.Fatal("missing exit accepted")
	}
	copy = trend50Copy(t, r)
	copy.Strategy.ReferenceReplay.Fills[1].Reason = backtest.CausalTargetTouch
	if oracle(copy, bars) {
		t.Fatal("target before stop accepted")
	}
	copy = trend50Copy(t, r)
	copy.Strategy.ReferenceReplay.Fills[1].EvaluationBarIndex = 49
	if oracle(copy, bars) {
		t.Fatal("wrong protection ref accepted")
	}
	changed := append([]backtest.OHLCV(nil), bars...)
	changed[51].Low = 100
	if oracle(r, changed) {
		t.Fatal("source touch detached")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if trend50ComparisonCLIResultValid(ctx, r, bars, "TEST", "100", s) {
		t.Fatal("canceled validator")
	}
}
