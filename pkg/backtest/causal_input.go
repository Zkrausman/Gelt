package backtest

// CausalInputIssue identifies the first common bar-admission failure using only
// fixed vocabulary. BarIndex is zero-based, or -1 for a whole-input issue.
// Code is CausalInvalidInput or CausalResourceLimit.
// Field is none, Timestamp, Open, High, Low, Close, Volume or OHLC. Reason is
// empty_input, row_limit, out_of_range, not_strictly_increasing or
// inconsistent_ohlc. No input values or source references are retained.
type CausalInputIssue struct {
	Code     CausalErrorCode
	BarIndex int
	Field    string
	Reason   string
}

// DiagnoseCausalBars checks the complete common numeric/domain admission without
// constructing an evaluator or running a replay. A nil issue means admitted
// input, including a valid single bar; it does not establish replay readiness,
// source authenticity or operating admission. The caller must own immutable
// access to data for the duration of the call; no snapshot is made.
func DiagnoseCausalBars(data []OHLCV) *CausalInputIssue {
	return causalBarsIssue(data)
}

// causalBarsIssue is shared with the existing causal replay admission. Keep its
// predicate order: input bounds, then each row's timestamp, prices, volume and
// combined geometry. Cross-field geometry does not identify a particular price.
func causalBarsIssue(data []OHLCV) *CausalInputIssue {
	if len(data) < 1 {
		return &CausalInputIssue{CausalInvalidInput, causalNoBar, "none", "empty_input"}
	}
	if len(data) > CausalMaxBars {
		return &CausalInputIssue{CausalResourceLimit, causalNoBar, "none", "row_limit"}
	}
	for i, b := range data {
		fail := func(field, reason string) *CausalInputIssue {
			return &CausalInputIssue{CausalInvalidInput, i, field, reason}
		}
		if b.Timestamp <= 0 || b.Timestamp > causalMaxTimestamp {
			return fail("Timestamp", "out_of_range")
		}
		if i > 0 && b.Timestamp <= data[i-1].Timestamp {
			return fail("Timestamp", "not_strictly_increasing")
		}
		if !causalFiniteRange(b.Open, 0.01, 1000000) {
			return fail("Open", "out_of_range")
		}
		if !causalFiniteRange(b.High, 0.01, 1000000) {
			return fail("High", "out_of_range")
		}
		if !causalFiniteRange(b.Low, 0.01, 1000000) {
			return fail("Low", "out_of_range")
		}
		if !causalFiniteRange(b.Close, 0.01, 1000000) {
			return fail("Close", "out_of_range")
		}
		if !causalFiniteRange(b.Volume, 0, 1000000000000) {
			return fail("Volume", "out_of_range")
		}
		if b.Low > b.Open || b.Low > b.Close || b.Open > b.High ||
			b.Close > b.High || b.Low > b.High {
			return fail("OHLC", "inconsistent_ohlc")
		}
	}
	return nil
}
