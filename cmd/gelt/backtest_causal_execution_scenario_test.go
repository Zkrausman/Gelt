package main

import (
	"bytes"
	"context"
	"gelt/pkg/backtest"
	"math"
	"strings"
	"testing"
)

func executionCLIResult(t *testing.T, n int, mode string, s backtest.ExecutionScenario) backtest.ExecutionScenarioCausalResult {
	t.Helper()
	e, _ := feeScenarioCLIEngine(mode)
	r, err := e.RunExecutionScenarioCausal(context.Background(), "TEST", feeScenarioCLIBars(n, 100), "100", s)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestExecutionCLIActualCSVAndGrammar(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	for _, cash := range []string{"0", "9.99999999", "100"} {
		var out, err bytes.Buffer
		code := runBacktestCausalExecution(context.Background(), []string{"BreakoutVol", "TEST", path, cash, "1", "0", "100", "100"}, &out, &err)
		if code != 0 || err.Len() != 0 {
			t.Fatalf("CLI %d %s", code, err.String())
		}
		for _, s := range []string{"uncalibrated_declared", "Reference", "execution", "not a limit-order fill guarantee", "No additional slippage cash charge", "Buy adverse bps: 100", "supplied-bar close marks", "reference protection triggers", "10.00000000"} {
			if !strings.Contains(out.String(), s) {
				t.Fatalf("missing %s", s)
			}
		}
		if out.Len() > 8192 || strings.Contains(out.String(), path) {
			t.Fatal("bound/privacy")
		}
	}
	for _, bad := range []string{"", "-1", "00", "1.5", "10000", "SECRET"} {
		var out, err bytes.Buffer
		code := runBacktestCausalExecution(context.Background(), []string{"BreakoutVol", "TEST", path, "100", "0", "0", bad, "0"}, &out, &err)
		if code == 0 || out.Len() != 0 || err.String() != "backtest-causal-execution: invalid_execution_scenario\n" {
			t.Fatal("bad grammar", code, err.String())
		}
	}
	var out, err bytes.Buffer
	if runBacktestCausalExecution(context.Background(), nil, &out, &err) == 0 || out.Len() != 0 || !strings.Contains(err.String(), "<BuyAdverseBps> <SellAdverseBps>") {
		t.Fatal("usage")
	}
}
func TestExecutionCLISummariesAndSanitizedFailures(t *testing.T) {
	for _, mode := range []string{"hold", "buy", "roundtrip"} {
		for _, rate := range []string{"0", "1", "100", "9999"} {
			s := backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: rate, SellAdverseBps: rate}
			r := executionCLIResult(t, 24, mode, s)
			out, ok := backtestCausalExecutionSummary(r)
			if !ok || len(out) > 8192 || strings.Contains(out, "PRIVATE") {
				t.Fatalf("valid summary rejected %s %s", mode, rate)
			}
		}
	}
	for _, mode := range []string{"identity", "error", "prompt", "numeric"} {
		e, _ := feeScenarioCLIEngine(mode)
		var out, err bytes.Buffer
		code := runBacktestCausalExecutionEngine(context.Background(), "TEST", feeScenarioCLIBars(22, 100), "100", backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "1", SellAdverseBps: "1"}, e, &out, &err)
		if code == 0 || out.Len() != 0 || strings.Contains(err.String(), "PRIVATE") {
			t.Fatal("raw callback/error leak")
		}
	}
}
func TestExecutionCLIForgedSummaryRejected(t *testing.T) {
	for _, mutate := range []func(*backtest.ExecutionScenarioCausalResult){
		func(r *backtest.ExecutionScenarioCausalResult) { r.ModelIdentity = "PRIVATE" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.ReferenceReplayRole = "execution_pnl" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.Scenario.BuyAdverseBps = "001" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.Scenario.PriceRule = "PRIVATE" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.CashFlows[0].ExecutionPrice = math.NaN() },
		func(r *backtest.ExecutionScenarioCausalResult) { r.CashFlows[0].ReferencePrice = 1 },
		func(r *backtest.ExecutionScenarioCausalResult) { r.CashFlows[0].AdverseDifferenceUnits = "-1" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.CashFlows[0].GrossNotionalUnits = "999" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.CashFlows[0].FeeUnits = "1" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.AggregateAdverseDifferenceUnits = "0" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.FinalEquityUnits = "999" },
		func(r *backtest.ExecutionScenarioCausalResult) { r.ReferenceReplay.Fills[0].Price = 99 },
		func(r *backtest.ExecutionScenarioCausalResult) { r.CloseMarks[20].ModelQuantity = 0 },
	} {
		r := executionCLIResult(t, 24, "roundtrip", backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "100", SellAdverseBps: "100"})
		mutate(&r)
		if out, ok := backtestCausalExecutionSummary(r); ok || out != "" {
			t.Fatal("forged summary accepted")
		}
	}
}
func TestExecutionCLIWholeInputAndOutputOnce(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21)+"PRIVATE_BAD_CSV\n")
	var out, err bytes.Buffer
	if runBacktestCausalExecution(context.Background(), []string{"BreakoutVol", "TEST", path, "100", "0", "0", "0", "0"}, &out, &err) == 0 || out.Len() != 0 || strings.Contains(err.String(), path) || strings.Contains(err.String(), "PRIVATE") {
		t.Fatal("whole CSV")
	}
	for _, fail := range []bool{true, false} {
		e, _ := feeScenarioCLIEngine("buy")
		w := &feeScenarioCLIWriter{fail: fail, short: !fail, prefix: 17}
		err.Reset()
		code := runBacktestCausalExecutionEngine(context.Background(), "TEST", feeScenarioCLIBars(21, 100), "100", backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "1", SellAdverseBps: "1"}, e, w, &err)
		if code == 0 || w.calls != 1 || w.Len() != 17 || err.String() != "backtest-causal-execution: output_error\n" {
			t.Fatal("output retried/hidden")
		}
	}
}
