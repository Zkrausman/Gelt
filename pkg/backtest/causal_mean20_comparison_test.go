package backtest

import (
	"context"
	"math"
	"reflect"
	"testing"

	"gelt/pkg/strategies"
)

func mean20Bars(prices []float64) []OHLCV {
	b := make([]OHLCV, len(prices))
	for i, p := range prices {
		b[i] = OHLCV{Timestamp: 1700000000 + int64(60*i), Open: p, High: p, Low: p, Close: p, Volume: 1}
	}
	return b
}
func mean20Fixture() []OHLCV {
	p := make([]float64, 21)
	for i := 0; i < 19; i++ {
		p[i] = 100
	}
	p[19] = 80
	p[20] = 80
	b := mean20Bars(p)
	b[20].Low = 78
	return b
}
func TestMean20OwnedAccounting(t *testing.T) {
	bars := mean20Fixture()
	for _, tc := range []struct{ name, cash, fixed, bps, buy, sell, equity, fee, passive string }{
		{"zero", "100", "0", "0", "0", "0", "9986607143", "0", "10000000000"},
		{"fixed", "100", "1", "0", "0", "0", "9787946429", "200000000", "9900000000"},
		{"stress", "100", "1", "10000", "2500", "2500", "8900000000", "916383929", "9360000000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := ExecutionScenario{FixedFee: tc.fixed, FeeBps: tc.bps, BuyAdverseBps: tc.buy, SellAdverseBps: tc.sell}
			r, err := RunMean20ComparisonCausal(context.Background(), "TEST", bars, tc.cash, s)
			if err != nil {
				t.Fatal(err)
			}
			if r.ModelIdentity != Mean20ComparisonModelIdentity || r.EvaluationPolicyIdentity != Mean20EvaluationPolicyIdentity || r.Strategy.ReferenceReplay.TargetName != "MeanReversion" || r.Strategy.ModelIdentity != ExecutionScenarioCausalModelIdentity || r.Strategy.FinalEquityUnits != tc.equity || r.Strategy.AggregateFeeUnits != tc.fee || r.Passive.FinalEquityUnits != tc.passive {
				t.Fatalf("unexpected: %+v", r)
			}
			e := r.Strategy.ReferenceReplay.Evaluations[0]
			if e.Signal != strategies.SignalBuy || e.Score != 85 || math.Abs(e.StopLossPct-75.0/56) > 1e-12 || math.Abs(e.TargetPct-225.0/56) > 1e-12 {
				t.Fatalf("evaluation: %+v", e)
			}
			if len(r.Strategy.ReferenceReplay.Fills) != 2 || r.Strategy.ReferenceReplay.TerminalPosition != nil || !r.Strategy.ReferenceReplay.PendingSignalUnfilled {
				t.Fatal("expected stop and pending signal")
			}
			own := strategies.NewMeanReversionStrategy()
			if err := own.Init(nil); err != nil {
				t.Fatal(err)
			}
			generic, err := (&Engine{strategy: own}).RunExecutionScenarioCausal(context.Background(), "TEST", bars, tc.cash, s)
			if err != nil || !reflect.DeepEqual(generic, r.Strategy) {
				t.Fatalf("generic differential: %v", err)
			}
		})
	}
}
func TestMean20ReseedAndErrors(t *testing.T) {
	p := make([]float64, 41)
	for i := 0; i < 19; i++ {
		p[i] = 1
	}
	for i := 19; i < 39; i++ {
		p[i] = 100
	}
	p[39] = 80
	p[40] = 80
	b := mean20Bars(p)
	s := ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	whole, err := RunMean20ComparisonCausal(nil, "TEST", b, "100", s)
	if err != nil {
		t.Fatal(err)
	}
	w := DeclaredComparisonWindow{StartInclusiveUnix: b[40].Timestamp, EndExclusiveUnix: b[40].Timestamp + 1}
	r, err := RunMean20WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	if err != nil {
		t.Fatal(err)
	}
	if whole.Strategy.ReferenceReplay.Evaluations[20].Signal != strategies.SignalHold || r.Replay.Strategy.ReferenceReplay.Evaluations[0].Signal != strategies.SignalBuy || r.WarmupStartSourceIndex != 20 || r.ScoredBars != 1 || r.Strategy.EndingEquityUnits != "10000000000" {
		t.Fatalf("reseed mismatch: %+v", r)
	}
	bad := append([]OHLCV(nil), b...)
	bad[0].Low = 0
	zero, err := RunMean20WindowComparisonCausal(nil, "TEST", bad, w, "100", s)
	x, ok := err.(*Mean20WindowComparisonError)
	if !ok || x.BarIndex != 0 || !reflect.DeepEqual(zero, Mean20WindowComparisonResult{}) {
		t.Fatalf("invalid source: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = RunMean20ComparisonCausal(ctx, "", nil, "bad", s)
	if x, ok := err.(*Mean20ComparisonError); !ok || x.Code != CausalCanceled || x.BarIndex != -1 {
		t.Fatalf("cancellation: %v", err)
	}
}

func TestMean20WarmupSignalsAndFunding(t *testing.T) {
	zero := ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	for _, n := range []int{1, 19, 20, 21} {
		b := mean20Fixture()[:n]
		r, err := RunMean20ComparisonCausal(nil, "TEST", b, "100", zero)
		if err != nil {
			t.Fatal(err)
		}
		count := n - 19
		if count < 0 {
			count = 0
		}
		if len(r.Strategy.ReferenceReplay.Evaluations) != count || (n <= 20 && (len(r.Strategy.ReferenceReplay.Fills) != 0 || r.Passive.Entry != nil)) {
			t.Fatalf("warmup %d", n)
		}
	}
	for _, tc := range []struct {
		p      float64
		signal strategies.SignalType
		score  float64
	}{{120, strategies.SignalSell, 85}, {99, strategies.SignalHold, 50}, {100, strategies.SignalHold, 50}} {
		b := mean20Fixture()[:20]
		b[19] = OHLCV{Timestamp: b[19].Timestamp, Open: tc.p, High: tc.p, Low: tc.p, Close: tc.p, Volume: 1}
		r, err := RunMean20ComparisonCausal(nil, "TEST", b, "100", zero)
		if err != nil {
			t.Fatal(err)
		}
		e := r.Strategy.ReferenceReplay.Evaluations[0]
		if e.Signal != tc.signal || e.Score != tc.score {
			t.Fatalf("signal %.0f: %+v", tc.p, e)
		}
	}
	for _, tc := range []struct {
		cash  string
		fills int
	}{{"10", 2}, {"9.99999999", 0}, {"0", 0}} {
		r, err := RunMean20ComparisonCausal(nil, "TEST", mean20Fixture(), tc.cash, zero)
		if err != nil || len(r.Strategy.ReferenceReplay.Fills) != tc.fills {
			t.Fatalf("funding %s %v", tc.cash, err)
		}
	}
	stress := ExecutionScenario{FixedFee: "1", FeeBps: "10000", BuyAdverseBps: "2500", SellAdverseBps: "2500"}
	r, err := RunMean20ComparisonCausal(nil, "TEST", mean20Fixture(), "10", stress)
	x, ok := err.(*Mean20ComparisonError)
	if !ok || x.Code != ExecutionScenarioInsufficientExitFeeCash || x.BarIndex != 20 || !reflect.DeepEqual(r, Mean20ComparisonResult{}) {
		t.Fatalf("exit fee: %v", err)
	}
	r, err = RunMean20ComparisonCausal(nil, "TEST", mean20Fixture(), "11", stress)
	if err != nil || r.Strategy.FinalEquityUnits != "0" {
		t.Fatalf("zero equity: %v", err)
	}
}
func TestMean20WindowSelectionAndInvariance(t *testing.T) {
	p := make([]float64, 25)
	for i := range p {
		p[i] = 100
	}
	p[22] = 80
	p[23] = 80
	p[24] = 80
	b := mean20Bars(p)
	s := ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	w := DeclaredComparisonWindow{b[23].Timestamp, b[24].Timestamp}
	r, err := RunMean20WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	if err != nil {
		t.Fatal(err)
	}
	b[0].Open = 2
	b[0].Low = 2
	b[24].High = 90
	b[24].Open = 90
	b[24].Low = 80
	r2, err := RunMean20WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	if err != nil || !reflect.DeepEqual(r, r2) {
		t.Fatalf("excluded rows changed replay: %v", err)
	}
	w = DeclaredComparisonWindow{b[1].Timestamp, b[1].Timestamp}
	_, err = RunMean20WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	x, ok := err.(*Mean20WindowComparisonError)
	if !ok || x.Code != WindowInvalidWindow {
		t.Fatalf("boundary precedence: %v", err)
	}
	w = DeclaredComparisonWindow{b[1].Timestamp, b[2].Timestamp}
	_, err = RunMean20WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	x, ok = err.(*Mean20WindowComparisonError)
	if !ok || x.Code != WindowInsufficientWarmup {
		t.Fatalf("warmup: %v", err)
	}
}

func TestMean20WindowErrorMappingAndFullValidation(t *testing.T) {
	prefix := mean20Bars([]float64{50, 50, 50})
	b := append(prefix, mean20Fixture()...)
	for i := range b {
		b[i].Timestamp = int64(i + 1)
	}
	w := DeclaredComparisonWindow{StartInclusiveUnix: b[23].Timestamp, EndExclusiveUnix: b[23].Timestamp + 1}
	stress := ExecutionScenario{FixedFee: "1", FeeBps: "10000", BuyAdverseBps: "2500", SellAdverseBps: "2500"}
	r, err := RunMean20WindowComparisonCausal(nil, "TEST", b, w, "10", stress)
	x, ok := err.(*Mean20WindowComparisonError)
	if !ok || x.Code != ExecutionScenarioInsufficientExitFeeCash || x.BarIndex != 23 || !reflect.DeepEqual(r, Mean20WindowComparisonResult{}) {
		t.Fatalf("mapped failure: %v", err)
	}
	zero := ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	future := append(append([]OHLCV(nil), b...), OHLCV{Timestamp: 25, Open: 80, High: 80, Low: 81, Close: 80, Volume: 1})
	r, err = RunMean20WindowComparisonCausal(nil, "TEST", future, w, "100", zero)
	x, ok = err.(*Mean20WindowComparisonError)
	if !ok || x.Code != CausalInvalidInput || x.BarIndex != 24 || !reflect.DeepEqual(r, Mean20WindowComparisonResult{}) {
		t.Fatalf("invalid excluded future: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, err = RunMean20WindowComparisonCausal(ctx, "", nil, w, "bad", zero)
	x, ok = err.(*Mean20WindowComparisonError)
	if !ok || x.Code != CausalCanceled || x.BarIndex != -1 || !reflect.DeepEqual(r, Mean20WindowComparisonResult{}) {
		t.Fatalf("window cancellation: %v", err)
	}
}

func TestMean20ValidationOrderAndTerminalHolding(t *testing.T) {
	zero := ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	for _, tc := range []struct {
		cash   string
		bars   []OHLCV
		symbol string
		code   CausalErrorCode
	}{
		{"bad", nil, "", FundedInvalidModelCash},
		{"100", make([]OHLCV, CausalMaxBars+1), "", CausalResourceLimit},
		{"100", nil, "", CausalInvalidInput},
		{"100", mean20Fixture(), "", CausalInvalidSymbol},
	} {
		r, err := RunMean20ComparisonCausal(nil, tc.symbol, tc.bars, tc.cash, zero)
		x, ok := err.(*Mean20ComparisonError)
		if !ok || x.Code != tc.code || !reflect.DeepEqual(r, Mean20ComparisonResult{}) {
			t.Fatalf("precedence %s: %v", tc.code, err)
		}
	}
	bars := mean20Fixture()
	bars[20].Low = 80
	scenario := ExecutionScenario{FixedFee: "1", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "9999"}
	r, err := RunMean20ComparisonCausal(nil, "TEST", bars, "100", scenario)
	if err != nil || r.Strategy.ReferenceReplay.TerminalPosition == nil || !r.Strategy.ReferenceReplay.PendingSignalUnfilled || r.Strategy.AggregateFeeUnits != "100000000" || r.Strategy.FinalEquityUnits != "9900000000" || len(r.Strategy.ReferenceReplay.Fills) != 1 {
		t.Fatalf("terminal holding charged an exit: %v %+v", err, r.Strategy)
	}
	max := mean20Fixture()
	for i := range max {
		max[i].Timestamp = 253402300779 + int64(i)
	}
	w := DeclaredComparisonWindow{253402300799, 253402300800}
	wr, err := RunMean20WindowComparisonCausal(nil, "TEST", max, w, "100", zero)
	if err != nil || wr.ScoredBars != 1 || wr.ScoreEndExclusiveSourceIndex != 21 {
		t.Fatalf("maximum end sentinel: %v", err)
	}
}
