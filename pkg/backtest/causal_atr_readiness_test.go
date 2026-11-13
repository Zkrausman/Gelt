package backtest

import (
	"context"
	"gelt/pkg/strategies"
	"reflect"
	"testing"
	"time"
)

type atrRecordingStrategy struct {
	*strategies.BreakoutVolStrategy
	lengths []int
	times   []time.Time
}

func (s *atrRecordingStrategy) Evaluate(ctx context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
	s.lengths = append(s.lengths, len(closes))
	s.times = append(s.times, at)
	return s.BreakoutVolStrategy.Evaluate(ctx, at, symbol, closes, volumes)
}

func TestConfiguredBreakoutATRReadinessOfflineModes(t *testing.T) {
	scenario := ExecutionScenario{FixedFee: "0.10", FeeBps: "5", BuyAdverseBps: "10", SellAdverseBps: "10"}
	for _, mode := range []string{"causal", "funded", "fee", "execution", "comparison", "window"} {
		t.Run(mode, func(t *testing.T) {
			s := &atrRecordingStrategy{BreakoutVolStrategy: strategies.NewBreakoutVolStrategy()}
			s.Init(nil)
			s.SetParams(map[string]float64{"atr_period": 20})
			engine := NewStrategyEngine(s)
			n, index := 21, 19
			if mode == "window" {
				n, index = 27, 22
			}
			bars := causalBars(n)
			causalSetBar(bars, index, 100, 101, 100, 101)
			causalSetBar(bars, index+1, 101, 101, 0.01, 101)
			var result, zero any
			var err error
			switch mode {
			case "causal":
				result, err = engine.RunCausal(nil, "TEST", bars)
				zero = CausalResult{}
			case "funded":
				result, err = engine.RunFundedCausal(nil, "TEST", bars, "100")
				zero = FundedCausalResult{}
			case "fee":
				result, err = engine.RunFeeScenarioCausal(nil, "TEST", bars, "100", FeeScenario{FixedFee: "0.10", FeeBps: "5"})
				zero = FeeScenarioCausalResult{}
			case "execution":
				result, err = engine.RunExecutionScenarioCausal(nil, "TEST", bars, "100", scenario)
				zero = ExecutionScenarioCausalResult{}
			case "comparison":
				result, err = engine.RunComparisonCausal(nil, "TEST", bars, "100", scenario)
				zero = ComparisonCausalResult{}
			case "window":
				result, err = engine.RunWindowComparisonCausal(nil, "TEST", bars, DeclaredComparisonWindow{bars[23].Timestamp, bars[25].Timestamp}, "100", scenario)
				zero = WindowComparisonResult{}
			}
			if !reflect.DeepEqual(result, zero) {
				t.Fatalf("nonzero result: %#v", result)
			}
			var code CausalErrorCode
			var gotIndex int
			var valid bool
			switch e := err.(type) {
			case *CausalError:
				code, gotIndex, valid = e.Code, e.BarIndex, mode == "causal"
			case *FundedCausalError:
				code, gotIndex, valid = e.Code, e.BarIndex, mode == "funded"
			case *FeeScenarioCausalError:
				code, gotIndex, valid = e.Code, e.BarIndex, mode == "fee"
			case *ExecutionScenarioCausalError:
				code, gotIndex, valid = e.Code, e.BarIndex, mode == "execution"
			case *ComparisonCausalError:
				code, gotIndex, valid = e.Code, e.BarIndex, mode == "comparison"
			case *WindowComparisonError:
				code, gotIndex, valid = e.Code, e.BarIndex, mode == "window"
			}
			if !valid || code != CausalEvaluatorError || gotIndex != index {
				t.Fatalf("error: %#v", err)
			}
			if !reflect.DeepEqual(s.lengths, []int{20}) || len(s.times) != 1 || !s.times[0].Equal(time.Unix(bars[index].Timestamp, 0).UTC()) {
				t.Fatalf("callbacks lengths=%v times=%v", s.lengths, s.times)
			}
		})
	}
}
