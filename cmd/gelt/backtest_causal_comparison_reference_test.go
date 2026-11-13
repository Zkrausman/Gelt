package main

import (
	"bytes"
	"context"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

func wholeReferenceResult(t *testing.T, bars []backtest.OHLCV, protected bool) backtest.ComparisonCausalResult {
	t.Helper()
	var e *backtest.Engine
	if protected {
		e = backtest.NewStrategyEngine(&windowProtectedFixture{strategies.NewBreakoutVolStrategy()})
	} else {
		e, _ = feeScenarioCLIEngine("buy")
	}
	r, err := e.RunComparisonCausal(nil, "TEST", bars, "100", comparisonCLIScenario())
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func wholeReferenceAccept(t *testing.T, r backtest.ComparisonCausalResult, bars []backtest.OHLCV, cash string, s backtest.ExecutionScenario) {
	t.Helper()
	if !comparisonCLIResultValid(r, bars, "TEST", cash, s) {
		t.Fatal("legacy rejected matching producer")
	}
	out, ok := backtestCausalComparisonSummary(r, bars, "TEST", cash, s)
	if !ok || !strings.HasSuffix(out, "Original OHLC reference events are checked conditional on normalized signals; indicator calculations and input authenticity are not independently verified.\n") {
		t.Fatal("summary rejected matching producer")
	}
}
func wholeReferenceReject(t *testing.T, r backtest.ComparisonCausalResult, bars []backtest.OHLCV) {
	t.Helper()
	s := comparisonCLIScenario()
	if !comparisonCLIResultValid(r, bars, "TEST", "100", s) {
		t.Fatal("forgery failed legacy layer")
	}
	if out, ok := backtestCausalComparisonSummary(r, bars, "TEST", "100", s); ok || out != "" {
		t.Fatal("forgery admitted")
	}
}
func TestWholeReferenceBalancedOmittedEntry(t *testing.T) {
	buy, bars := comparisonCLIResult(t, 24, "buy", "100", comparisonCLIScenario())
	flat, _ := comparisonCLIResult(t, 24, "hold", "100", comparisonCLIScenario())
	wholeReferenceAccept(t, buy, bars, "100", comparisonCLIScenario())
	wholeReferenceAccept(t, flat, bars, "100", comparisonCLIScenario())
	if len(buy.Strategy.ReferenceReplay.Fills) != 1 || buy.Strategy.ReferenceReplay.Fills[0].BarIndex != 20 || len(flat.Strategy.ReferenceReplay.Fills) != 0 || flat.Strategy.ReferenceReplay.TerminalPosition != nil {
		t.Fatal("fixture")
	}
	flat.Strategy.ReferenceReplay.Evaluations = append([]backtest.CausalEvaluation(nil), buy.Strategy.ReferenceReplay.Evaluations...)
	flat.Strategy.ReferenceReplay.PendingSignalUnfilled = buy.Strategy.ReferenceReplay.PendingSignalUnfilled
	wholeReferenceReject(t, flat, bars)
}
func TestWholeReferenceBalancedOmittedFundingNonfill(t *testing.T) {
	s := comparisonCLIScenario()
	buy, bars := comparisonCLIResult(t, 24, "buy", "0", s)
	flat, _ := comparisonCLIResult(t, 24, "hold", "0", s)
	wholeReferenceAccept(t, buy, bars, "0", s)
	wholeReferenceAccept(t, flat, bars, "0", s)
	if len(buy.Strategy.RejectedEntries) == 0 || len(flat.Strategy.RejectedEntries) != 0 {
		t.Fatal("funding fixture")
	}
	flat.Strategy.ReferenceReplay.Evaluations = append([]backtest.CausalEvaluation(nil), buy.Strategy.ReferenceReplay.Evaluations...)
	flat.Strategy.ReferenceReplay.PendingSignalUnfilled = buy.Strategy.ReferenceReplay.PendingSignalUnfilled
	if !comparisonCLIResultValid(flat, bars, "TEST", "0", s) {
		t.Fatal("legacy funding layer")
	}
	if out, ok := backtestCausalComparisonSummary(flat, bars, "TEST", "0", s); ok || out != "" {
		t.Fatal("omitted funding nonfill admitted")
	}
}
func TestWholeReferenceAlternateOpen(t *testing.T) {
	bars := feeScenarioCLIBars(24, 100)
	alt := append([]backtest.OHLCV(nil), bars...)
	alt[20].Open = 99
	alt[20].Low = 99
	original := wholeReferenceResult(t, bars, false)
	forged := wholeReferenceResult(t, alt, false)
	wholeReferenceAccept(t, original, bars, "100", comparisonCLIScenario())
	wholeReferenceAccept(t, forged, alt, "100", comparisonCLIScenario())
	if !reflect.DeepEqual(original.Strategy.ReferenceReplay.Evaluations, forged.Strategy.ReferenceReplay.Evaluations) || len(original.Strategy.ReferenceReplay.Fills) != 1 || len(forged.Strategy.ReferenceReplay.Fills) != 1 || original.Strategy.ReferenceReplay.Fills[0].BarIndex != 20 || forged.Strategy.ReferenceReplay.Fills[0].BarIndex != 20 || original.Strategy.ReferenceReplay.Fills[0].Price != 100 || forged.Strategy.ReferenceReplay.Fills[0].Price != 99 {
		t.Fatal("fixture")
	}
	forged.Cash = original.Cash
	forged.Passive = original.Passive
	eq, ok := fundedCLIUnits(forged.Strategy.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		t.Fatal("equity")
	}
	peq, ok := fundedCLIUnits(original.Passive.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		t.Fatal("passive")
	}
	forged.StrategyMinusCashUnits = strconv.FormatInt(eq-10000000000, 10)
	forged.StrategyMinusPassiveUnits = strconv.FormatInt(eq-peq, 10)
	wholeReferenceReject(t, forged, bars)
}
func TestWholeReferenceLowOnlyOmittedStop(t *testing.T) {
	bars := feeScenarioCLIBars(24, 100)
	bars[20].Low = 90
	alt := append([]backtest.OHLCV(nil), bars...)
	alt[20].Low = 100
	original := wholeReferenceResult(t, bars, true)
	forged := wholeReferenceResult(t, alt, true)
	wholeReferenceAccept(t, original, bars, "100", comparisonCLIScenario())
	wholeReferenceAccept(t, forged, alt, "100", comparisonCLIScenario())
	fills := original.Strategy.ReferenceReplay.Fills
	if len(fills) != 2 || fills[0].Price != 100 || fills[0].BarIndex != 20 || fills[1].Ambiguous || original.Strategy.ReferenceReplay.TerminalPosition != nil || len(forged.Strategy.ReferenceReplay.Fills) != 1 || fills[1].Reason != backtest.CausalStopTouch || fills[1].Price != 95 || fills[1].BarIndex != 20 || forged.Strategy.ReferenceReplay.TerminalPosition == nil || !reflect.DeepEqual(original.Strategy.ReferenceReplay.Evaluations, forged.Strategy.ReferenceReplay.Evaluations) || !reflect.DeepEqual(original.Cash, forged.Cash) || !reflect.DeepEqual(original.Passive, forged.Passive) {
		t.Fatal("fixture")
	}
	wholeReferenceReject(t, forged, bars)
}
func TestWholeReferenceProducerCompatibility(t *testing.T) {
	for _, n := range []int{1, 19, 20, 21, 24} {
		for _, mode := range []string{"hold", "buy", "roundtrip"} {
			for _, cash := range []string{"0", "9.99999999", "10", "100"} {
				for _, s := range []backtest.ExecutionScenario{comparisonCLIScenario(), {FixedFee: "1", FeeBps: "100", BuyAdverseBps: "100", SellAdverseBps: "200"}} {
					r, bars := comparisonCLIResult(t, n, mode, cash, s)
					wholeReferenceAccept(t, r, bars, cash, s)
				}
			}
		}
	}
	for _, n := range []int{1, 19, 20} {
		s := backtest.ExecutionScenario{FixedFee: "9.99999999", FeeBps: "10000", BuyAdverseBps: "0", SellAdverseBps: "0"}
		r, b := comparisonCLIResult(t, n, "buy", "0", s)
		wholeReferenceAccept(t, r, b, "0", s)
	}
	s := backtest.ExecutionScenario{FixedFee: "9.99999999", FeeBps: "10000", BuyAdverseBps: "0", SellAdverseBps: "0"}
	e, _ := feeScenarioCLIEngine("hold")
	if _, err := e.RunComparisonCausal(nil, "TEST", feeScenarioCLIBars(21, 100), "0", s); err == nil || !strings.Contains(err.Error(), "numeric_range") {
		t.Fatalf("zero target: %v", err)
	}
}
func TestWholeReferenceCancelAndNilWriter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	e, s := feeScenarioCLIEngine("buy")
	s.cancel = cancel
	var out, err bytes.Buffer
	if runBacktestCausalComparisonEngine(ctx, "TEST", feeScenarioCLIBars(22, 100), "100", comparisonCLIScenario(), e, &out, &err) != 1 || out.Len() != 0 || err.String() != "backtest-causal-compare: canceled\n" {
		t.Fatalf("cancel: %q", err.String())
	}
	e, _ = feeScenarioCLIEngine("buy")
	err.Reset()
	if runBacktestCausalComparisonEngine(nil, "TEST", feeScenarioCLIBars(22, 100), "100", comparisonCLIScenario(), e, nil, &err) != 1 || err.String() != "backtest-causal-compare: output_error\n" {
		t.Fatalf("nil writer: %q", err.String())
	}
}
