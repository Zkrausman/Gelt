package backtest

import (
	"context"
	"errors"
	"gelt/pkg/strategies"
	"reflect"
	"testing"
	"time"
)

func windowFixture(t *testing.T, bars []OHLCV, s, e int, cash string, scenario ExecutionScenario) (WindowComparisonResult, *causalTestStrategy) {
	t.Helper()
	engine, spy := comparisonFixture()
	spy.keepPrefix = true
	end := bars[len(bars)-1].Timestamp + 1
	if e < len(bars) {
		end = bars[e].Timestamp
	}
	r, err := engine.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{bars[s].Timestamp, end}, cash, scenario)
	if err != nil {
		t.Fatal(err)
	}
	return r, spy
}
func TestWindowSelectionMappingAndExactOneReplay(t *testing.T) {
	bars := causalBars(27)
	r, spy := windowFixture(t, bars, 23, 25, "100", comparisonScenario())
	if r.WarmupStartSourceIndex != 3 || r.ScoreStartSourceIndex != 23 || r.ScoreEndExclusiveSourceIndex != 25 || r.ExcludedBeforeWarmupCount != 3 || r.ExcludedAfterScoreCount != 2 || r.ConsumedBars != 22 || r.ScoredBars != 2 || r.WarmupBars != 20 {
		t.Fatal("mapping", r)
	}
	if len(spy.calls) != 3 {
		t.Fatal("not one replay", len(spy.calls))
	}
	for j, c := range spy.calls {
		if c.length != 20+j || !c.at.Equal(time.Unix(bars[22+j].Timestamp, 0).UTC()) || !reflect.DeepEqual(c.closes, float64SliceForWindow(bars[3:23+j])) {
			t.Fatal("prefix", j, c)
		}
	}
	direct, _ := comparisonFixture()
	d, err := direct.RunComparisonCausal(nil, "TEST", bars[3:25], "100", comparisonScenario())
	if err != nil || !reflect.DeepEqual(d, r.Replay) {
		t.Fatal("shipped replay changed", err)
	}
	changed := append([]OHLCV(nil), bars...)
	for _, i := range []int{0, 1, 2, 25, 26} {
		changed[i].Open = 999
		changed[i].High = 1000
		changed[i].Low = 998
		changed[i].Close = 999
		changed[i].Volume = 987654
	}
	other, _ := windowFixture(t, changed, 23, 25, "100", comparisonScenario())
	if !reflect.DeepEqual(other, r) {
		t.Fatal("excluded values leaked")
	}
}
func float64SliceForWindow(b []OHLCV) []float64 {
	v := make([]float64, len(b))
	for i := range b {
		v[i] = b[i].Close
	}
	return v
}
func TestWindowK1AccountingAndFeeBaseline(t *testing.T) {
	b := causalBars(21)
	b[20].Close = 110
	b[20].High = 110
	r, spy := windowFixture(t, b, 20, 21, "100", comparisonScenario())
	if len(spy.calls) != 2 || r.Passive.EndingEquityUnits != "10100000000" || r.Cash.EndingEquityUnits != "10000000000" || r.Passive.StartingEquityUnits != "10000000000" {
		t.Fatal("K1oracle", r.Passive)
	}
	scenario := comparisonScenario()
	scenario.FixedFee = "1"
	r, _ = windowFixture(t, causalBars(21), 20, 21, "100", scenario)
	if r.Passive.EndingEquityUnits != "9900000000" || r.Passive.AggregateFeeUnits != "100000000" || r.Passive.NetAccountingPnLUnits != "-100000000" || r.Passive.DrawdownSourceBarIndex == nil || *r.Passive.DrawdownSourceBarIndex != 20 || *r.Passive.DrawdownScoredBarIndex != 0 || *r.Passive.MaxCloseMarkDrawdown.Percent != 1 {
		t.Fatal("entry DD baseline", r.Passive)
	}
	for _, cash := range []string{"0", "9.99999999", "10"} {
		r, _ := windowFixture(t, causalBars(21), 20, 21, cash, scenario)
		if cash == "10" {
			if r.Replay.Passive.EntryStatus != "filled" {
				t.Fatal("exactdebit")
			}
		} else if r.Replay.Passive.EntryStatus != FundedInsufficientModelCash || r.Passive.AggregateFeeUnits != "0" {
			t.Fatal("nonfill")
		}
	}
	zero, _ := windowFixture(t, causalBars(21), 20, 21, "0", comparisonScenario())
	if zero.Strategy.MaxCloseMarkDrawdown.Percent != nil || zero.Passive.DrawdownSourceBarIndex != nil {
		t.Fatal("zeroDD")
	}
}
func TestWindowPreflightPriorityAndZeroResult(t *testing.T) {
	good := causalBars(27)
	valid := DeclaredComparisonWindow{good[23].Timestamp, good[25].Timestamp}
	for _, tc := range []struct {
		name         string
		mutate       func([]OHLCV)
		w            DeclaredComparisonWindow
		cash, symbol string
		scenario     ExecutionScenario
		code         CausalErrorCode
		index        int
	}{
		{"cash first", nil, DeclaredComparisonWindow{}, "bad", "?", comparisonScenario(), FundedInvalidModelCash, -1},
		{"symbol beforewindow", nil, DeclaredComparisonWindow{}, "100", "?", comparisonScenario(), CausalInvalidSymbol, -1},
		{"invalid excluded before", func(b []OHLCV) { b[0].Volume = -1 }, valid, "100", "TEST", comparisonScenario(), CausalInvalidInput, 0},
		{"invalid excluded future", func(b []OHLCV) { b[26].Close = 0 }, valid, "100", "TEST", comparisonScenario(), CausalInvalidInput, 26},
		{"missing start", nil, DeclaredComparisonWindow{good[23].Timestamp + 1, good[25].Timestamp}, "100", "TEST", comparisonScenario(), WindowInvalidWindow, -1},
		{"missing end beforewarmup", nil, DeclaredComparisonWindow{good[19].Timestamp, good[25].Timestamp + 1}, "100", "TEST", comparisonScenario(), WindowInvalidWindow, -1},
		{"short warmup", nil, DeclaredComparisonWindow{good[19].Timestamp, good[25].Timestamp}, "100", "TEST", comparisonScenario(), WindowInsufficientWarmup, -1},
		{"reversed", nil, DeclaredComparisonWindow{good[25].Timestamp, good[23].Timestamp}, "100", "TEST", comparisonScenario(), WindowInvalidWindow, -1},
		{"equal", nil, DeclaredComparisonWindow{good[23].Timestamp, good[23].Timestamp}, "100", "TEST", comparisonScenario(), WindowInvalidWindow, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := append([]OHLCV(nil), good...)
			if tc.mutate != nil {
				tc.mutate(b)
			}
			e, spy := comparisonFixture()
			r, err := e.RunWindowComparisonCausal(nil, tc.symbol, b, tc.w, tc.cash, tc.scenario)
			var x *WindowComparisonError
			if !reflect.DeepEqual(r, WindowComparisonResult{}) || !errors.As(err, &x) || x.Code != tc.code || x.BarIndex != tc.index || len(spy.calls) != 0 {
				t.Fatalf("got %#v %v calls%d", r, err, len(spy.calls))
			}
		})
	}
	s := comparisonScenario()
	s.FixedFee = "9.99999999"
	s.FeeBps = "10000"
	e, spy := comparisonFixture()
	r, err := e.RunWindowComparisonCausal(nil, "TEST", good, valid, "0", s)
	var x *WindowComparisonError
	if !errors.As(err, &x) || x.Code != CausalNumericRange || x.BarIndex != 23 || len(spy.calls) != 0 || !reflect.DeepEqual(r, WindowComparisonResult{}) {
		t.Fatal("numeric beforefunding", err)
	}
}
func TestWindowTerminalAndErrorSourceIndices(t *testing.T) {
	bars := causalBars(27)
	e, s := comparisonFixture()
	s.fn = func(ctx context.Context, at time.Time, symbol string, c, v []float64) (strategies.StrategySignal, error) {
		sig := causalCompleteSignal("BreakoutVol", symbol, at)
		sig.Signal = strategies.SignalBuy
		return sig, nil
	}
	r, err := e.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{bars[23].Timestamp, bars[25].Timestamp}, "100", comparisonScenario())
	if err != nil || len(s.calls) != 3 || !r.Replay.Strategy.ReferenceReplay.PendingSignalUnfilled || r.Replay.Strategy.ReferenceReplay.TerminalPosition == nil || r.Replay.Strategy.ReferenceReplay.TerminalPosition.LastBarIndex != 21 {
		t.Fatal("terminal", err)
	}
	e, s = comparisonFixture()
	s.fn = func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
		return strategies.StrategySignal{}, errors.New("private callback text")
	}
	r, err = e.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{bars[23].Timestamp, bars[25].Timestamp}, "100", comparisonScenario())
	var x *WindowComparisonError
	if !reflect.DeepEqual(r, WindowComparisonResult{}) || !errors.As(err, &x) || x.Code != CausalEvaluatorError || x.BarIndex != 22 || err.Error() == "private callback text" {
		t.Fatal("sourceerror", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, err = e.RunWindowComparisonCausal(ctx, "TEST", bars, DeclaredComparisonWindow{}, "bad", comparisonScenario())
	if !errors.As(err, &x) || x.Code != CausalCanceled || !reflect.DeepEqual(r, WindowComparisonResult{}) {
		t.Fatal("cancel", err)
	}
}
func TestWindowMaximumBoundsAndSentinel(t *testing.T) {
	bars := causalBars(10000)
	e, spy := comparisonFixture()
	r, err := e.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{bars[20].Timestamp, bars[9999].Timestamp + 1}, "100", comparisonScenario())
	if err != nil || r.ScoredBars != 9980 || len(spy.calls) != 9981 {
		t.Fatal("maximum", err, len(spy.calls))
	}
	b := causalBars(21)
	for i := range b {
		b[i].Timestamp = 253402300799 - int64(20-i)
	}
	r, _ = windowFixture(t, b, 20, 21, "100", comparisonScenario())
	if r.Window.EndExclusiveUnix != 253402300800 {
		t.Fatal("maximumsentinel")
	}
}
func TestWindowScoreRejectsForgedWarmupAndDrawdown(t *testing.T) {
	r, _ := windowFixture(t, causalBars(23), 20, 23, "100", comparisonScenario())
	marks := append([]ExecutionScenarioCausalCloseMark(nil), r.Replay.Passive.CloseMarks...)
	marks[0].AggregateFeeUnits = "1"
	if windowReplayShape(context.Background(), ComparisonCausalResult{ModelIdentity: r.Replay.ModelIdentity}, causalBars(23), "TEST", 10000000000) {
		t.Fatal("shape accepted")
	}
	if windowFlat(marks[0], 10000000000) {
		t.Fatal("warmup fee")
	}
	marks = append([]ExecutionScenarioCausalCloseMark(nil), r.Replay.Passive.CloseMarks...)
	marks[20].PeakEquityUnits = "1"
	if _, ok := windowScore(context.Background(), r.Passive.ModelIdentity, marks, 10000000000, 0, r.Passive.MaxCloseMarkDrawdown); ok {
		t.Fatal("wrong peak")
	}
	b := causalBars(23)
	for _, i := range []int{20, 22} {
		b[i].Close = 90
		b[i].Low = 90
	}
	tied, _ := windowFixture(t, b, 20, 23, "100", comparisonScenario())
	if tied.Passive.MaxCloseMarkDrawdown.BarIndex == nil || *tied.Passive.MaxCloseMarkDrawdown.BarIndex != 20 {
		t.Fatal("earliest tie")
	}
}

func TestWindowErrorAndSourceBoundaries(t *testing.T) {
	for _, n := range []int{0, 1, 19, 20, 10001} {
		bars := causalBars(n)
		engine, spy := comparisonFixture()
		r, err := engine.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{1, 2}, "100", comparisonScenario())
		if err == nil || !reflect.DeepEqual(r, WindowComparisonResult{}) || len(spy.calls) != 0 {
			t.Fatal("bad full source admitted", n)
		}
	}
	bars := causalBars(27)
	engine, spy := comparisonFixture()
	scenario := comparisonScenario()
	scenario.FeeBps = "00"
	bars[26].Open = 0
	r, err := engine.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{}, "100", scenario)
	var x *WindowComparisonError
	if !errors.As(err, &x) || x.Code != ExecutionScenarioInvalidScenario || x.BarIndex != -1 || len(spy.calls) != 0 || !reflect.DeepEqual(r, WindowComparisonResult{}) {
		t.Fatal("config priority", err)
	}
	bars = causalBars(27)
	r, _ = windowFixture(t, bars, 23, 26, "100", comparisonScenario())
	if r.ExcludedAfterScoreCount != 1 || r.ScoreEndExclusiveSourceIndex != 26 {
		t.Fatal("exact end must exclude boundary bar")
	}
	r, _ = windowFixture(t, bars, 23, 27, "100", comparisonScenario())
	if r.ExcludedAfterScoreCount != 0 || r.ScoreEndExclusiveSourceIndex != 27 {
		t.Fatal("sentinel must include last")
	}
	good, _ := windowFixture(t, bars, 23, 25, "100", comparisonScenario())
	for _, mutate := range []func(*ComparisonCausalResult){func(r *ComparisonCausalResult) { r.Strategy.FinalEquityUnits = "1" }, func(r *ComparisonCausalResult) { r.Cash.FinalModelCashUnits = "1" }, func(r *ComparisonCausalResult) { r.Passive.PolicyIdentity = "foreign" }, func(r *ComparisonCausalResult) { r.Strategy.CloseMarks[0].ModelCashUnits = "1" }} {
		copy := good.Replay
		copy.Strategy.CloseMarks = append([]ExecutionScenarioCausalCloseMark(nil), good.Replay.Strategy.CloseMarks...)
		mutate(&copy)
		if windowReplayShape(context.Background(), copy, bars[3:25], "TEST", 10000000000) {
			t.Fatal("forged API projection accepted")
		}
	}
}
