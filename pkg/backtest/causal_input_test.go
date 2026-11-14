package backtest

import (
	"math"
	"reflect"
	"testing"
)

// This is the frozen original admission predicate, independent of the new
// detailed issue implementation. Keep it unchanged as a compatibility oracle.
func originalCausalBarsAdmission(data []OHLCV) (int, CausalErrorCode) {
	if len(data) < 1 {
		return -1, CausalInvalidInput
	}
	if len(data) > 10000 {
		return -1, CausalResourceLimit
	}
	finite := func(v, low, high float64) bool {
		return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= low && v <= high
	}
	for i, b := range data {
		if b.Timestamp <= 0 || b.Timestamp > 253402300799 ||
			(i > 0 && b.Timestamp <= data[i-1].Timestamp) ||
			!finite(b.Open, 0.01, 1000000) ||
			!finite(b.High, 0.01, 1000000) ||
			!finite(b.Low, 0.01, 1000000) ||
			!finite(b.Close, 0.01, 1000000) ||
			!finite(b.Volume, 0, 1000000000000) ||
			b.Low > b.Open || b.Low > b.Close || b.Open > b.High ||
			b.Close > b.High || b.Low > b.High {
			return i, CausalInvalidInput
		}
	}
	return -1, ""
}

func diagnosticBars(n int) []OHLCV {
	bars := make([]OHLCV, n)
	for i := range bars {
		bars[i] = OHLCV{Timestamp: int64(i + 1), Open: 10, High: 20, Low: 1, Close: 11, Volume: 0}
	}
	return bars
}

func checkCausalInputIssue(t *testing.T, bars []OHLCV, want *CausalInputIssue) {
	t.Helper()
	got := DiagnoseCausalBars(bars)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("issue=%+v, want=%+v", got, want)
	}
	wantIndex, wantCode := originalCausalBarsAdmission(bars)
	index, code := causalValidateBars(bars)
	if index != wantIndex || code != wantCode {
		t.Fatalf("old admission changed: (%d,%s), want (%d,%s)", index, code, wantIndex, wantCode)
	}
	if got == nil {
		if code != "" {
			t.Fatal("public and old admission disagree")
		}
	} else if got.BarIndex != index || got.Code != code {
		t.Fatal("public and old issue code/index disagree")
	}
}

func TestDiagnoseCausalBarsInputBoundsAndNoMutation(t *testing.T) {
	checkCausalInputIssue(t, nil, &CausalInputIssue{CausalInvalidInput, -1, "none", "empty_input"})
	checkCausalInputIssue(t, []OHLCV{}, &CausalInputIssue{CausalInvalidInput, -1, "none", "empty_input"})
	for _, n := range []int{1, 2, 9999, 10000} {
		bars := diagnosticBars(n)
		before := append([]OHLCV(nil), bars...)
		checkCausalInputIssue(t, bars, nil)
		if !reflect.DeepEqual(bars, before) {
			t.Fatal("admission mutated input")
		}
	}
	bars := diagnosticBars(10001)
	bars[0].Timestamp = 0 // whole-input row limit has priority
	checkCausalInputIssue(t, bars, &CausalInputIssue{CausalResourceLimit, -1, "none", "row_limit"})
	bars = diagnosticBars(10000)
	bars[9999].Close = 0
	checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 9999, "Close", "out_of_range"})
	if reflect.TypeOf(CausalInputIssue{}).NumField() != 4 {
		t.Fatal("issue must retain only code, index, field and reason")
	}
}

func TestDiagnoseCausalBarsTimestampBoundsOrderAndPriority(t *testing.T) {
	for _, ts := range []int64{math.MinInt64, -1, 0, 253402300800, math.MaxInt64} {
		bars := diagnosticBars(2)
		bars[1].Timestamp, bars[1].Open = ts, 0
		checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 1, "Timestamp", "out_of_range"})
	}
	for _, ts := range []int64{1, 253402300799} {
		bars := diagnosticBars(1)
		bars[0].Timestamp = ts
		checkCausalInputIssue(t, bars, nil)
	}
	for _, ts := range []int64{1, 2} {
		bars := diagnosticBars(2)
		bars[0].Timestamp, bars[1].Timestamp = 2, ts
		bars[1].Open = 0
		checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 1, "Timestamp", "not_strictly_increasing"})
	}
	bars := diagnosticBars(2)
	bars[0].Volume, bars[1].Timestamp = -1, 0
	checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 0, "Volume", "out_of_range"})
}

func TestDiagnoseCausalBarsEveryNumericBoundary(t *testing.T) {
	columns := []struct {
		field     string
		get       func(*OHLCV) *float64
		low, high float64
	}{
		{"Open", func(b *OHLCV) *float64 { return &b.Open }, .01, 1000000},
		{"High", func(b *OHLCV) *float64 { return &b.High }, .01, 1000000},
		{"Low", func(b *OHLCV) *float64 { return &b.Low }, .01, 1000000},
		{"Close", func(b *OHLCV) *float64 { return &b.Close }, .01, 1000000},
		{"Volume", func(b *OHLCV) *float64 { return &b.Volume }, 0, 1e12},
	}
	for _, column := range columns {
		t.Run(column.field, func(t *testing.T) {
			for _, v := range []float64{math.NaN(), math.Inf(1), math.Inf(-1), math.Nextafter(column.low, math.Inf(-1)), math.Nextafter(column.high, math.Inf(1))} {
				bars := diagnosticBars(2)
				*column.get(&bars[1]) = v
				checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 1, column.field, "out_of_range"})
			}
			for _, v := range []float64{column.low, math.Nextafter(column.low, math.Inf(1)), math.Nextafter(column.high, math.Inf(-1)), column.high} {
				bars := diagnosticBars(1)
				// Equal prices keep geometry valid at each price boundary.
				if column.field != "Volume" {
					bars[0].Open, bars[0].High, bars[0].Low, bars[0].Close = v, v, v, v
				} else {
					bars[0].Volume = v
				}
				checkCausalInputIssue(t, bars, nil)
			}
		})
	}
	// Multiple numeric faults resolve in original CSV column order.
	for first := range columns {
		bars := diagnosticBars(1)
		for _, col := range columns[first:] {
			*col.get(&bars[0]) = math.NaN()
		}
		checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 0, columns[first].field, "out_of_range"})
	}
}

func TestDiagnoseCausalBarsCombinedGeometry(t *testing.T) {
	for _, prices := range [][4]float64{
		{1, 4, 2, 3}, // Low > Open
		{3, 4, 2, 1}, // Low > Close
		{4, 3, 1, 2}, // Open > High
		{2, 3, 1, 4}, // Close > High
		{2, 1, 3, 2}, // Low > High (also necessarily another inequality)
	} {
		bars := diagnosticBars(1)
		bars[0].Open, bars[0].High, bars[0].Low, bars[0].Close = prices[0], prices[1], prices[2], prices[3]
		checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 0, "OHLC", "inconsistent_ohlc"})
		bars[0].Volume = -1 // volume admission precedes combined geometry
		checkCausalInputIssue(t, bars, &CausalInputIssue{CausalInvalidInput, 0, "Volume", "out_of_range"})
	}
	bars := diagnosticBars(1)
	bars[0].Open, bars[0].High, bars[0].Low, bars[0].Close = 1, 1, 1, 1
	checkCausalInputIssue(t, bars, nil)
}
