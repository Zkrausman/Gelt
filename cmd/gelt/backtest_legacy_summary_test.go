package main

import (
	"math"
	"strings"
	"testing"

	"gelt/pkg/backtest"
)

func TestLegacySummaryPreservesNumbersAndClarifiesMeaning(t *testing.T) {
	r := backtest.Result{TotalBars: 31, TotalTrades: 4, WinningTrades: 3,
		WinRate: 75, NetPnL: 7.25, ProfitFactor: 1.5, MaxDrawdownPct: 3.25}
	before := r
	out := legacyBacktestSummary(r, legacyBacktestInputCSV)
	for _, line := range []string{
		"Input: user_supplied_csv_unqualified",
		"Authority: unqualified_offline", "Input bars: 31",
		"Closed simulated trades (includes forced terminal close): 4",
		"Win rate (legacy gross, %): 75.00%",
		"Gross realized price PnL (costs excluded): $7.25",
		"Profit factor (legacy raw): 1.50",
		"Realized-exit drawdown (legacy model 10000 baseline, %): 3.25%",
		"Limits: simplified same-close/intrabar fills and forced final-close liquidation; fees and slippage excluded.",
	} {
		if !strings.Contains(out, line+"\n") {
			t.Fatalf("missing truthful line %q in %q", line, out)
		}
	}
	if r != before {
		t.Fatal("formatting mutated the legacy result")
	}
	for _, misleading := range []string{"Net PnL ($)", "Historical Bars:", "Max Drawdown (%):", "frictionless_funded_fixed8", "declared_fixed8_per_side"} {
		if strings.Contains(out, misleading) {
			t.Fatalf("misleading or foreign-mode label %q", misleading)
		}
	}
}

func TestLegacySummaryInputProvenance(t *testing.T) {
	for _, tc := range []struct {
		kind          legacyBacktestInputKind
		label, caveat string
	}{
		{legacyBacktestInputCSV, "user_supplied_csv_unqualified", "source and completeness are not verified"},
		{legacyBacktestInputSynthetic, "wallclock_seeded_synthetic", "not observed historical data"},
		{0, "unknown_legacy_input", "provenance is unknown"},
		{255, "unknown_legacy_input", "provenance is unknown"},
	} {
		out := legacyBacktestSummary(backtest.Result{}, tc.kind)
		if !strings.Contains(out, "Input: "+tc.label+"\n") || !strings.Contains(out, tc.caveat) {
			t.Fatalf("incorrect provenance for %d: %q", tc.kind, out)
		}
		if strings.Contains(out, "deterministic offline backtest") || strings.Contains(out, "Historical Bars:") {
			t.Fatal("whole-run determinism or historical observations implied")
		}
	}
}

func TestLegacySummaryProfitFactorDoesNotInventDenominator(t *testing.T) {
	for _, tc := range []struct {
		trades int
		value  float64
		want   string
	}{
		{0, 0, "undefined (no_closed_trades)"},
		{0, math.Inf(1), "undefined (no_closed_trades)"},
		{1, math.Inf(1), "undefined (nonfinite_legacy_value)"},
		{1, math.Inf(-1), "undefined (nonfinite_legacy_value)"},
		{1, math.NaN(), "undefined (nonfinite_legacy_value)"},
		{1, 0, "0.00"},
		{1, -1, "-1.00"},
		{2, 1.25, "1.25"},
	} {
		out := legacyBacktestSummary(backtest.Result{TotalTrades: tc.trades, ProfitFactor: tc.value}, legacyBacktestInputCSV)
		if !strings.Contains(out, "Profit factor (legacy raw): "+tc.want+"\n") {
			t.Fatalf("wrong PF display for %d/%v: %q", tc.trades, tc.value, out)
		}
		if strings.Contains(out, "INF") || strings.Contains(out, "NaN") || strings.Contains(out, "no_losing_closed_trades") {
			t.Fatal("nonfinite favorable score or unavailable denominator reason emitted")
		}
		if !strings.Contains(out, "denominator details are unavailable in Result") {
			t.Fatal("legacy denominator limitation missing")
		}
	}
}

func TestLegacySummaryBoundAndExistingNumericPrecision(t *testing.T) {
	for _, value := range []float64{math.MaxFloat64, -math.MaxFloat64, math.SmallestNonzeroFloat64, 0, -7.25} {
		r := backtest.Result{TotalBars: math.MaxInt, TotalTrades: math.MaxInt,
			WinRate: value, NetPnL: value, ProfitFactor: value, MaxDrawdownPct: value}
		out := legacyBacktestSummary(r, legacyBacktestInputSynthetic)
		if len(out) > 8192 || out == "" {
			t.Fatalf("fixed helper output exceeded bound: %d", len(out))
		}
	}
	out := legacyBacktestSummary(backtest.Result{NetPnL: -7.25, MaxDrawdownPct: 3.125}, legacyBacktestInputCSV)
	if !strings.Contains(out, "PnL (costs excluded): $-7.25\n") || !strings.Contains(out, "baseline, %): 3.12%\n") {
		t.Fatal("existing two-decimal formatting changed")
	}
}
