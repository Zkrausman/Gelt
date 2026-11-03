package main

import (
	"fmt"
	"math"
	"strings"

	"gelt/pkg/backtest"
)

type legacyBacktestInputKind uint8

const (
	legacyBacktestInputCSV legacyBacktestInputKind = iota + 1
	legacyBacktestInputSynthetic
)

// legacyBacktestSummary changes presentation only. Result retains the legacy
// engine's calculations and field names. No missing accounting is reconstructed.
// The fixed text and typed numeric fields keep this helper below 8192 bytes;
// that bound does not cover the existing command's separate input/error logs.
func legacyBacktestSummary(result backtest.Result, input legacyBacktestInputKind) string {
	var out strings.Builder
	out.WriteString("\nGELT LEGACY OFFLINE BACKTEST SUMMARY\n")
	out.WriteString("Display model: legacy_same_close_frictionless_diagnostic\n")
	out.WriteString("Authority: unqualified_offline\n")
	switch input {
	case legacyBacktestInputCSV:
		out.WriteString("Input: user_supplied_csv_unqualified\n")
		out.WriteString("Input caveat: existing permissive CSV ingestion; source and completeness are not verified.\n")
	case legacyBacktestInputSynthetic:
		out.WriteString("Input: wallclock_seeded_synthetic\n")
		out.WriteString("Input caveat: generated simulation, not observed historical data; this CLI run is not reproducible from arguments alone.\n")
	default:
		out.WriteString("Input: unknown_legacy_input\n")
		out.WriteString("Input caveat: provenance is unknown; no historical-data claim.\n")
	}
	fmt.Fprintf(&out, "Input bars: %d\nClosed simulated trades (includes forced terminal close): %d\n",
		result.TotalBars, result.TotalTrades)
	fmt.Fprintf(&out, "Win rate (legacy gross, %%): %.2f%%\n", result.WinRate)
	fmt.Fprintf(&out, "Gross realized price PnL (costs excluded): $%.2f\n", result.NetPnL)
	switch {
	case result.TotalTrades == 0:
		out.WriteString("Profit factor (legacy raw): undefined (no_closed_trades)\n")
	case math.IsNaN(result.ProfitFactor) || math.IsInf(result.ProfitFactor, 0):
		out.WriteString("Profit factor (legacy raw): undefined (nonfinite_legacy_value)\n")
	default:
		fmt.Fprintf(&out, "Profit factor (legacy raw): %.2f\n", result.ProfitFactor)
	}
	out.WriteString("Profit-factor caveat: denominator details are unavailable in Result; a finite legacy value is not an adequacy pass.\n")
	fmt.Fprintf(&out, "Realized-exit drawdown (legacy model 10000 baseline, %%): %.2f%%\n", result.MaxDrawdownPct)
	out.WriteString("Limits: simplified same-close/intrabar fills and forced final-close liquidation; fees and slippage excluded.\n")
	out.WriteString("Drawdown omits open-position close marks; it is not close-equity or intrabar portfolio risk.\n")
	out.WriteString("No actual cash, holdings, execution or trading qualification is established.\n")
	return out.String()
}
