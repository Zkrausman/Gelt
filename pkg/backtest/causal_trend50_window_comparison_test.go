package backtest

import (
	"context"
	"math"
	"reflect"
	"testing"
)

func twBars(n int) []OHLCV {
	b := make([]OHLCV, n)
	for i := range b {
		b[i] = OHLCV{Timestamp: int64(1000 + i*60), Open: 100, High: 100, Low: 100, Close: 100, Volume: 1}
	}
	return b
}
func TestTrend50WindowSelectionReseedAndExclusions(t *testing.T) {
	b := twBars(101)
	for i := 0; i < 50; i++ {
		b[i].Open = 1000
		b[i].High = 1000
		b[i].Low = 1000
		b[i].Close = 1000
	}
	w := DeclaredComparisonWindow{b[100].Timestamp, b[100].Timestamp + 1}
	r, err := RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", trend50Scenario())
	if err != nil {
		t.Fatal(err)
	}
	direct, err := RunTrend50ComparisonCausal(nil, "TEST", b[50:], "100", trend50Scenario())
	if err != nil || !reflect.DeepEqual(r.Replay, direct) {
		t.Fatalf("direct replay: %v", err)
	}
	full, err := RunTrend50ComparisonCausal(nil, "TEST", b, "100", trend50Scenario())
	if err != nil {
		t.Fatal(err)
	}
	a := r.Replay.Strategy.ReferenceReplay.Evaluations[0]
	f := full.Strategy.ReferenceReplay.Evaluations[50]
	if a.Signal != "SELL" || a.Score != 10 || f.Signal != "HOLD" || f.Score != 70 {
		t.Fatalf("reseed %v vs full %v", a, f)
	}
	if r.WarmupStartSourceIndex != 50 || r.ScoredBars != 1 || r.ConsumedBars != 51 || len(r.Replay.Strategy.ReferenceReplay.Evaluations) != 2 {
		t.Fatalf("selection %+v", r)
	}
	for i := 0; i < 50; i++ {
		b[i].Open = 100
		b[i].High = 100
		b[i].Low = 100
		b[i].Close = 100
	}
	r2, err := RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", trend50Scenario())
	if err != nil || !reflect.DeepEqual(r, r2) {
		t.Fatalf("excluded: %v", err)
	}
}
func TestTrend50WindowErrorsAndCosts(t *testing.T) {
	b := twBars(54)
	w := DeclaredComparisonWindow{b[53].Timestamp, b[53].Timestamp + 1}
	for i := 20; i < 49; i++ {
		p := 100 + float64(i-20)*1.5
		b[i+3].Open = p
		b[i+3].High = p
		b[i+3].Low = p
		b[i+3].Close = p
	}
	s := ExecutionScenario{"1", "1250", "2500", "5000"}
	r, err := RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	if err != nil {
		t.Fatal(err)
	}
	if r.Strategy.EndingEquityUnits != "9640000000" || math.Abs(r.Strategy.EndingModelQuantity-.064) > 1e-12 || r.Strategy.AggregateFeeUnits != "200000000" || r.Strategy.DrawdownSourceBarIndex == nil || *r.Strategy.DrawdownSourceBarIndex != 53 || *r.Strategy.DrawdownScoredBarIndex != 0 || r.Replay.Strategy.ReferenceReplay.TerminalPosition == nil {
		t.Fatalf("costs %+v", r.Strategy)
	}
	cases := []struct {
		b     []OHLCV
		w     DeclaredComparisonWindow
		cash  string
		code  CausalErrorCode
		index int
	}{{b, DeclaredComparisonWindow{b[49].Timestamp, b[50].Timestamp}, "100", Trend50WindowInsufficientWarmup, -1}, {b, DeclaredComparisonWindow{b[49].Timestamp + 1, b[50].Timestamp}, "100", Trend50WindowInvalidWindow, -1}, {b, w, "bad", FundedInvalidModelCash, -1}}
	bad := append([]OHLCV(nil), b...)
	bad[0].Low = 0
	cases = append(cases, struct {
		b     []OHLCV
		w     DeclaredComparisonWindow
		cash  string
		code  CausalErrorCode
		index int
	}{bad, w, "100", CausalInvalidInput, 0})
	for _, tc := range cases {
		got, e := RunTrend50WindowComparisonCausal(nil, "TEST", tc.b, tc.w, tc.cash, s)
		fe, ok := e.(*Trend50WindowComparisonError)
		if !ok || fe.Code != tc.code || fe.BarIndex != tc.index || !reflect.DeepEqual(got, Trend50WindowComparisonResult{}) {
			t.Fatalf("error %v result %+v", e, got)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, e := RunTrend50WindowComparisonCausal(ctx, "TEST", b, w, "bad", s)
	if fe, ok := e.(*Trend50WindowComparisonError); !ok || fe.Code != CausalCanceled || fe.BarIndex != -1 || !reflect.DeepEqual(got, Trend50WindowComparisonResult{}) {
		t.Fatal(e)
	}
}
func TestTrend50WindowPendingAndFutureExcluded(t *testing.T) {
	b := twBars(52)
	for i := 21; i <= 49; i++ {
		p := 100 + 1.5*float64(i-21)
		b[i].Open = p
		b[i].High = p
		b[i].Low = p
		b[i].Close = p
	}
	w := DeclaredComparisonWindow{b[50].Timestamp, b[51].Timestamp}
	r, e := RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", trend50Scenario())
	if e != nil {
		t.Fatal(e)
	}
	q := r.Replay.Strategy.ReferenceReplay
	if !q.PendingSignalUnfilled || q.TerminalPosition != nil || q.Evaluations[1].Signal != "BUY" || q.Evaluations[1].Score != 80 {
		t.Fatalf("pending %+v", q)
	}
	b[51].Open = 999
	b[51].High = 999
	b[51].Low = 999
	b[51].Close = 999
	again, e := RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", trend50Scenario())
	if e != nil || !reflect.DeepEqual(r, again) {
		t.Fatal(e)
	}
}

func TestTrend50WindowDrawdownTie(t *testing.T) {
	b := twBars(53)
	for i, p := range []float64{90, 1100, 1080} {
		j := 50 + i
		b[j].Close = p
		if p < 100 {
			b[j].Low = p
		} else {
			b[j].High = p
		}
	}
	w := DeclaredComparisonWindow{b[50].Timestamp, b[52].Timestamp + 1}
	r, e := RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", trend50Scenario())
	if e != nil {
		t.Fatal(e)
	}
	d := r.Passive.MaxCloseMarkDrawdown
	if d.BarIndex == nil || *d.BarIndex != 50 || r.Passive.DrawdownSourceBarIndex == nil || *r.Passive.DrawdownSourceBarIndex != 50 || *r.Passive.DrawdownScoredBarIndex != 0 {
		t.Fatalf("tie %+v", r.Passive)
	}
}
