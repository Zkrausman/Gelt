package main

import (
	"bytes"
	"context"
	"fmt"
	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
	"math"
	"strings"
	"testing"
	"time"
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

// Two reference roundtrips make both positive and negative reference PnL
// visible while execution prices/fees remain separate model facts.
type executionReferenceStrategy struct{ *feeScenarioCLIStrategy }

func (s *executionReferenceStrategy) Evaluate(ctx context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
	signal, err := s.feeScenarioCLIStrategy.Evaluate(ctx, at, symbol, closes, volumes)
	switch len(closes) - 1 {
	case 23:
		signal.Signal = strategies.SignalBuy
	case 25:
		signal.Signal = strategies.SignalSell
	}
	return signal, err
}
func executionReferenceFixture(t *testing.T, kind string) backtest.ExecutionScenarioCausalResult {
	t.Helper()
	e, s := feeScenarioCLIEngine("roundtrip")
	bars := feeScenarioCLIBars(24, 100)
	switch kind {
	case "hold":
		e, _ = feeScenarioCLIEngine("hold")
	case "profit":
		bars[22].Open = 110
		bars[22].High = 110
		bars[22].Low = 110
		bars[22].Close = 110
	case "loss":
		bars[22].Open = 90
		bars[22].High = 90
		bars[22].Low = 90
		bars[22].Close = 90
	case "mixed":
		bars = feeScenarioCLIBars(28, 100)
		bars[22].Open = 110
		bars[22].High = 110
		bars[22].Low = 110
		bars[22].Close = 110
		bars[26].Open = 90
		bars[26].High = 90
		bars[26].Low = 90
		bars[26].Close = 90
		e = backtest.NewStrategyEngine(&executionReferenceStrategy{s})
	}
	r, err := e.RunExecutionScenarioCausal(context.Background(), "TEST", bars, "100", backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "100", SellAdverseBps: "100"})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestExecutionCLIReferenceDiagnosticsPositiveStates(t *testing.T) {
	for _, kind := range []string{"hold", "flat", "profit", "loss", "mixed"} {
		t.Run(kind, func(t *testing.T) {
			r := executionReferenceFixture(t, kind)
			if out, ok := backtestCausalExecutionSummary(r); !ok || out == "" {
				t.Fatal("genuine reference result rejected")
			}
		})
	}
}
func TestExecutionCLIReferenceAggregateMutations(t *testing.T) {
	cases := []struct {
		name   string
		change func(*backtest.CausalResult)
	}{
		{"realized", func(r *backtest.CausalResult) { r.GrossRealizedPnL += 1 }},
		{"realized tiny", func(r *backtest.CausalResult) { r.GrossRealizedPnL = math.Nextafter(r.GrossRealizedPnL, math.Inf(1)) }},
		{"winning", func(r *backtest.CausalResult) {
			if r.WinningClosedTradeCount > 0 {
				r.WinningClosedTradeCount--
			} else {
				r.WinningClosedTradeCount++
			}
		}},
		{"profit", func(r *backtest.CausalResult) { r.GrossProfit += 1 }},
		{"loss", func(r *backtest.CausalResult) { r.GrossLoss += 1 }},
		{"profitfactor value", func(r *backtest.CausalResult) { v := 7.0; r.GrossProfitFactor = &v; r.GrossProfitFactorReason = "" }},
		{"profitfactor tiny", func(r *backtest.CausalResult) {
			v := math.SmallestNonzeroFloat64
			if r.GrossProfitFactor != nil {
				v = math.Nextafter(*r.GrossProfitFactor, math.Inf(1))
			}
			r.GrossProfitFactor = &v
			r.GrossProfitFactorReason = ""
		}},
		{"profitfactor nil", func(r *backtest.CausalResult) {
			r.GrossProfitFactor = nil
			r.GrossProfitFactorReason = backtest.CausalNoLosingClosedTrades
		}},
		{"profitfactor reason", func(r *backtest.CausalResult) { r.GrossProfitFactorReason = backtest.CausalNoClosedTrades }},
	}
	for _, kind := range []string{"hold", "flat", "profit", "loss", "mixed"} {
		for _, tc := range cases {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				r := executionReferenceFixture(t, kind)
				// Mutations that would preserve the already-correct nil state are not counterexamples.
				if tc.name == "profitfactor nil" && r.ReferenceReplay.GrossProfitFactor == nil {
					return
				}
				if tc.name == "profitfactor reason" && r.ReferenceReplay.GrossProfitFactorReason == backtest.CausalNoClosedTrades {
					return
				}
				tc.change(&r.ReferenceReplay)
				if out, ok := backtestCausalExecutionSummary(r); ok || out != "" {
					t.Fatal("forged reference aggregate accepted")
				}
			})
		}
	}
	for _, index := range []int{0, 1} {
		t.Run(fmt.Sprintf("per-fill-pnl-%d", index), func(t *testing.T) {
			r := executionReferenceFixture(t, "flat")
			r.ReferenceReplay.Fills[index].GrossRealizedPnL = 1
			if out, ok := backtestCausalExecutionSummary(r); ok || out != "" {
				t.Fatal("forged reference fill PnL accepted")
			}
		})
	}
	t.Run("reference notional", func(t *testing.T) {
		r := executionReferenceFixture(t, "flat")
		r.ReferenceReplay.Fills[0].Notional += 1
		if out, ok := backtestCausalExecutionSummary(r); ok || out != "" {
			t.Fatal("forged reference notional accepted")
		}
	})
	t.Run("coordinated aggregates and profitfactor", func(t *testing.T) {
		r := executionReferenceFixture(t, "mixed")
		r.ReferenceReplay.GrossProfit *= 2
		r.ReferenceReplay.GrossLoss *= 2
		pf := r.ReferenceReplay.GrossProfit / r.ReferenceReplay.GrossLoss
		r.ReferenceReplay.GrossProfitFactor = &pf
		if out, ok := backtestCausalExecutionSummary(r); ok || out != "" {
			t.Fatal("self-consistent forged aggregates accepted")
		}
	})
}
