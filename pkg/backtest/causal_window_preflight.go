package backtest

import (
	"context"
	"sort"
)

// CausalWindowPreflight contains interval and warmup metadata only.
type CausalWindowPreflight struct {
	ScoredRows int
	Eligible20 bool
	Eligible50 bool
}

// InspectValidatedCausalWindow uses the existing 20- and 50-row selectors.
// The caller must first admit every bar with DiagnoseCausalBars and keep the
// input immutable during this call. No evaluator or engine is constructed.
func InspectValidatedCausalWindow(ctx context.Context, bars []OHLCV, w DeclaredComparisonWindow) (CausalWindowPreflight, CausalErrorCode) {
	if ctx == nil {
		ctx = context.Background()
	}
	_, _, code20 := windowSelect(ctx, bars, w)
	if code20 != "" && code20 != WindowInsufficientWarmup {
		return CausalWindowPreflight{}, code20
	}
	_, _, code50 := trend50WindowSelect(ctx, bars, w)
	if code50 != "" && code50 != Trend50WindowInsufficientWarmup {
		return CausalWindowPreflight{}, code50
	}
	// Both selectors have admitted the endpoints, but return zero indices for
	// insufficient warmup. Find the positions even when neither profile fits.
	start := sort.Search(len(bars), func(i int) bool { return bars[i].Timestamp >= w.StartInclusiveUnix })
	end := sort.Search(len(bars), func(i int) bool { return bars[i].Timestamp >= w.EndExclusiveUnix })
	return CausalWindowPreflight{ScoredRows: end - start, Eligible20: code20 == "", Eligible50: code50 == ""}, ""
}
