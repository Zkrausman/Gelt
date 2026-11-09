package backtest

import (
	"context"
	"errors"
	"gelt/pkg/strategies"
	"math"
	"math/big"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func comparisonFixture() (*Engine, *causalTestStrategy) {
	s := causalNewStrategy()
	s.name = "BreakoutVol"
	return NewStrategyEngine(s), s
}
func comparisonScenario() ExecutionScenario {
	return ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
}
func comparisonRun(t *testing.T, bars []OHLCV, cash string, scenario ExecutionScenario) ComparisonCausalResult {
	t.Helper()
	e, _ := comparisonFixture()
	r, err := e.RunComparisonCausal(context.Background(), "TEST", bars, cash, scenario)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func comparisonError(t *testing.T, r ComparisonCausalResult, err error, code CausalErrorCode, index int) {
	t.Helper()
	var x *ComparisonCausalError
	if !reflect.DeepEqual(r, ComparisonCausalResult{}) || !errors.As(err, &x) || x.Code != code || x.BarIndex != index {
		t.Fatalf("zero/typed failure: %#v %v", r, err)
	}
}

func TestComparisonExactControls(t *testing.T) {
	for _, tc := range []struct {
		close         float64
		equity, value string
	}{{110, "10100000000", "1100000000"}, {90, "9900000000", "900000000"}} {
		bars := causalBars(21)
		bars[20].Close = tc.close
		bars[20].High = math.Max(100, tc.close)
		bars[20].Low = math.Min(100, tc.close)
		r := comparisonRun(t, bars, "100", comparisonScenario())
		p := r.Passive
		if p.FinalModelCashUnits != "9000000000" || p.FinalEquityUnits != tc.equity || p.FinalPositionValueUnits != tc.value || p.EntryStatus != "filled" || p.Entry.BarIndex != 20 || p.Entry.PolicyDecisionBarIndex != 19 || p.Entry.Origin != "fixed_control_policy" || p.FinalModelQuantity != .1 || p.AggregateFeeUnits != "0" || p.NetRealizedAccountingPnLUnits != "0" {
			t.Fatalf("passive oracle %#v", p)
		}
		for i, m := range r.Cash.CloseMarks {
			if m.EquityUnits != "10000000000" || m.ModelQuantity != 0 || m.AggregateFeeUnits != "0" || m.BarIndex != i {
				t.Fatal("cash changed")
			}
		}
	}
	for _, tc := range []struct{ fixed, buy, value, equity string }{{"0", "100", "990099010", "9990099010"}, {"1", "0", "900000000", "9900000000"}} {
		s := comparisonScenario()
		s.FixedFee = tc.fixed
		s.BuyAdverseBps = tc.buy
		s.SellAdverseBps = "9999"
		p := comparisonRun(t, causalBars(23), "100", s).Passive
		if p.FinalPositionValueUnits != tc.value || p.FinalEquityUnits != tc.equity || p.FinalModelCashUnits != "9000000000" {
			t.Fatalf("cost oracle %#v", p)
		}
		if p.Entry.ExecutionPrice != 100*(1+float64(mustComparisonInt(tc.buy))/10000) {
			t.Fatal("entry price")
		}
	}
}
func mustComparisonInt(s string) int64 { v, _ := strconv.ParseInt(s, 10, 64); return v }

func TestComparisonFundingAndPrecedence(t *testing.T) {
	s := comparisonScenario()
	s.FixedFee = "1"
	for _, cash := range []string{"0", "9.99999999", "10"} {
		r := comparisonRun(t, causalBars(23), cash, s)
		p := r.Passive
		if cash == "10" {
			if p.EntryStatus != "filled" || p.FinalModelCashUnits != "0" {
				t.Fatal("exact funding")
			}
		} else if p.EntryStatus != FundedInsufficientModelCash || p.FinalModelQuantity != 0 || p.AggregateFeeUnits != "0" || p.Entry.FeeUnits != "100000000" {
			t.Fatal("nonfill charged/resized")
		}
	}
	s.FixedFee = "9.99999999"
	s.FeeBps = "10000"
	e, callback := comparisonFixture()
	r, err := e.RunComparisonCausal(nil, "TEST", causalBars(21), "0", s)
	comparisonError(t, r, err, CausalNumericRange, 20)
	if len(callback.calls) != 0 {
		t.Fatal("evaluated before fatal control")
	}
	for _, n := range []int{1, 19, 20} {
		r := comparisonRun(t, causalBars(n), "0", s)
		if r.Passive.Entry != nil || r.Passive.EntryStatus != "no_eligible_bar" || r.Cash.MaxCloseMarkDrawdown.Percent != nil {
			t.Fatal("invented entry or zero favorable DD")
		}
	}
	e, callback = comparisonFixture()
	bars := causalBars(21)
	bars[20].Open = 1000000
	bars[20].High = 1000000
	s = comparisonScenario()
	s.BuyAdverseBps = "1"
	r, err = e.RunComparisonCausal(nil, "TEST", bars, "0", s)
	comparisonError(t, r, err, CausalNumericRange, 20)
	if len(callback.calls) != 0 {
		t.Fatal("funding hid range")
	}
}

func TestComparisonOneStrategyReplayAndCompatibility(t *testing.T) {
	for _, n := range []int{1, 19, 20, 21, 10000} {
		bars := causalBars(n)
		e, s := comparisonFixture()
		s.keepPrefix = true
		r, err := e.RunComparisonCausal(nil, "TEST", bars, "100", comparisonScenario())
		if err != nil {
			t.Fatal(err)
		}
		want := n - 19
		if want < 0 {
			want = 0
		}
		if len(s.calls) != want || len(r.Passive.CloseMarks) != n {
			t.Fatal("callback/control count")
		}
		for j, c := range s.calls {
			if c.length != j+20 || len(c.closes) != j+20 || !c.at.Equal(time.Unix(bars[j+19].Timestamp, 0)) {
				t.Fatal("future prefix")
			}
		}
		old, _ := comparisonFixture()
		reference, err := old.RunExecutionScenarioCausal(nil, "TEST", bars, "100", comparisonScenario())
		if err != nil || !reflect.DeepEqual(r.Strategy, reference) {
			t.Fatal("old API changed")
		}
	}
	e, s := comparisonFixture()
	s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		s.name = "PRIVATE"
		return causalCompleteSignal("BreakoutVol", symbol, at), nil
	}
	r, err := e.RunComparisonCausal(nil, "TEST", causalBars(21), "100", comparisonScenario())
	if err == nil || !reflect.DeepEqual(r, ComparisonCausalResult{}) || len(s.calls) != 1 {
		t.Fatal("identity/retry")
	}
	e, s = comparisonFixture()
	ctx, cancel := context.WithCancel(context.Background())
	s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		cancel()
		return causalCompleteSignal("BreakoutVol", symbol, at), nil
	}
	r, err = e.RunComparisonCausal(ctx, "TEST", causalBars(22), "100", comparisonScenario())
	if err == nil || !reflect.DeepEqual(r, ComparisonCausalResult{}) || len(s.calls) != 1 {
		t.Fatal("cancel/retry")
	}
}

func TestComparisonDomainFailures(t *testing.T) {
	cases := []struct {
		name  string
		edit  func(*Engine, []OHLCV, *string, *ExecutionScenario)
		code  CausalErrorCode
		index int
	}{
		{"cash", func(_ *Engine, _ []OHLCV, c *string, _ *ExecutionScenario) { *c = "PRIVATE" }, FundedInvalidModelCash, -1},
		{"fee", func(_ *Engine, _ []OHLCV, _ *string, s *ExecutionScenario) { s.FixedFee = "10" }, ExecutionScenarioInvalidScenario, -1},
		{"rate", func(_ *Engine, _ []OHLCV, _ *string, s *ExecutionScenario) { s.SellAdverseBps = "10000" }, ExecutionScenarioInvalidScenario, -1},
		{"nan", func(_ *Engine, b []OHLCV, _ *string, _ *ExecutionScenario) { b[20].Close = math.NaN() }, CausalInvalidInput, 20},
		{"futurebad", func(_ *Engine, b []OHLCV, _ *string, _ *ExecutionScenario) { b[20].Volume = 1e12 + 1 }, CausalInvalidInput, 20},
		{"time", func(_ *Engine, b []OHLCV, _ *string, _ *ExecutionScenario) { b[20].Timestamp = b[19].Timestamp }, CausalInvalidInput, 20},
		{"evaluator", func(e *Engine, _ []OHLCV, _ *string, _ *ExecutionScenario) { e.strategy = nil }, CausalInvalidEvaluator, -1},
		{"foreign", func(e *Engine, _ []OHLCV, _ *string, _ *ExecutionScenario) {
			e.strategy.(*causalTestStrategy).name = "Foreign"
		}, CausalUnsupported, -1},
		{"plan", func(e *Engine, _ []OHLCV, _ *string, _ *ExecutionScenario) {
			e.strategy = nil
			e.plan = &causalTestPlan{name: "Plan"}
		}, CausalUnsupported, -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, s := comparisonFixture()
			bars := causalBars(21)
			cash := "100"
			scenario := comparisonScenario()
			tc.edit(e, bars, &cash, &scenario)
			r, err := e.RunComparisonCausal(nil, "TEST", bars, cash, scenario)
			comparisonError(t, r, err, tc.code, tc.index)
			if len(s.calls) != 0 {
				t.Fatal("callback before validation")
			}
		})
	}
	for _, n := range []int{0, 10001} {
		e, _ := comparisonFixture()
		r, err := e.RunComparisonCausal(nil, "TEST", causalBars(n), "100", comparisonScenario())
		if err == nil || !reflect.DeepEqual(r, ComparisonCausalResult{}) {
			t.Fatal("bar bound")
		}
	}
}

func TestComparisonEveryMarkAndDrawdownOracle(t *testing.T) {
	bars := causalBars(25)
	for i, c := range []float64{110, 90, 110, 90, 120} {
		bars[20+i].Close = c
		bars[20+i].High = math.Max(100, c)
		bars[20+i].Low = math.Min(100, c)
	}
	p := comparisonRun(t, bars, "100", comparisonScenario()).Passive
	// A .1 lot at100; final recovery does not erase the first 2/101 drawdown.
	if *p.MaxCloseMarkDrawdown.BarIndex != 21 || *p.MaxCloseMarkDrawdown.LossUnits != "200000000" || *p.MaxCloseMarkDrawdown.PeakEquityUnits != "10100000000" {
		t.Fatal("max versus current/tie")
	}
	for i, m := range p.CloseMarks {
		cash := mustComparisonInt(m.ModelCashUnits)
		value := mustComparisonInt(m.PositionValueUnits)
		equity := mustComparisonInt(m.EquityUnits)
		net := mustComparisonInt(m.NetUnrealizedAccountingPnLUnits)
		if cash+value != equity || 10000000000+net != equity {
			t.Fatal("account identity", i)
		}
		if i < 20 && m.ModelQuantity != 0 {
			t.Fatal("early entry")
		}
	}
}

func TestComparisonIndependentQuoteAndFeeOracles(t *testing.T) {
	// Independent exact-rational integer rounding; includes non-binary decimal
	// prices and tiny per-side rates. No core quote/fee helper is the oracle.
	round := func(price, quantity float64) int64 {
		x := new(big.Rat).Mul(new(big.Rat).SetFloat64(price), new(big.Rat).SetFloat64(quantity))
		x.Mul(x, big.NewRat(100000000, 1))
		q, rem := new(big.Int), new(big.Int)
		q.QuoRem(x.Num(), x.Denom(), rem)
		cmp := new(big.Int).Mul(rem, big.NewInt(2)).Cmp(x.Denom())
		if cmp > 0 || cmp == 0 && q.Bit(0) == 1 {
			q.Add(q, big.NewInt(1))
		}
		return q.Int64()
	}
	for _, price := range []float64{.01, .03, 99.99, math.Nextafter(100, 0), 100, math.Nextafter(100, math.Inf(1)), 999999} {
		for _, rate := range []string{"0", "1", "100", "10000"} {
			s := comparisonScenario()
			s.FixedFee = "0.12345678"
			s.FeeBps = rate
			bars := causalBars(22)
			for i := range bars {
				bars[i].Open = price
				bars[i].High = price
				bars[i].Low = price
				bars[i].Close = price
			}
			e, _ := comparisonFixture()
			r, err := e.RunComparisonCausal(nil, "TEST", bars, "100", s)
			// High-priced, lower-principal lots may violate the existing minimum
			// quantity. That rejection must not be hidden by cash or rounded up.
			target := (int64(1000000000) - 12345678) * 10000 / (10000 + mustComparisonInt(rate))
			if float64(target)/1e8/price < .00001 {
				if err == nil || !reflect.DeepEqual(r, ComparisonCausalResult{}) {
					t.Fatal("minimum quantity bypass")
				}
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			entry := r.Passive.Entry
			principal := round(entry.ExecutionPrice, entry.ModelQuantity)
			numerator := principal * mustComparisonInt(rate)
			fee := int64(12345678) + numerator/10000
			if numerator%10000 != 0 {
				fee++
			}
			if principal != target || mustComparisonInt(entry.PrincipalUnits) != principal || mustComparisonInt(entry.FeeUnits) != fee || mustComparisonInt(entry.RequiredModelCashUnits) != principal+fee {
				t.Fatal("rational/ceil fee oracle")
			}
			for _, m := range r.Passive.CloseMarks[20:] {
				if mustComparisonInt(m.PositionValueUnits) != round(price, entry.ModelQuantity) {
					t.Fatal("mark quote oracle")
				}
			}
		}
	}
}

func TestComparisonTypedNilAndSanitizedFailure(t *testing.T) {
	var strategy *causalTestStrategy
	r, err := NewStrategyEngine(strategy).RunComparisonCausal(nil, "TEST", causalBars(21), "100", comparisonScenario())
	comparisonError(t, r, err, CausalInvalidEvaluator, -1)
	e, s := comparisonFixture()
	e.plan = &causalTestPlan{name: "Plan"}
	r, err = e.RunComparisonCausal(nil, "TEST", causalBars(21), "100", comparisonScenario())
	comparisonError(t, r, err, CausalInvalidEvaluator, -1)
	if len(s.calls) != 0 {
		t.Fatal("invalid evaluator called")
	}
	e, s = comparisonFixture()
	s.fn = func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
		return strategies.StrategySignal{}, errors.New("PRIVATE_CALLBACK_SECRET")
	}
	r, err = e.RunComparisonCausal(nil, "TEST", causalBars(21), "100", comparisonScenario())
	comparisonError(t, r, err, CausalEvaluatorError, 19)
	if err.Error() != "causal comparison: evaluator_error" || len(s.calls) != 1 {
		t.Fatal("raw error or retry")
	}
}
