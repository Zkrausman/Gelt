package backtest

import (
	"context"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/plans"
	"gelt/pkg/strategies"
)

func TestEngine_Run_BullTrend(t *testing.T) {
	// Generate a 100-bar synthetic bull trend
	var data []OHLCV
	startPrice := 100.0
	now := int64(1_700_000_000)

	for i := 0; i < 100; i++ {
		// Consistent upward movement
		open := startPrice + float64(i)*1.0
		closePrice := open + 0.8
		high := open + 1.0
		low := open - 0.2

		data = append(data, OHLCV{
			Timestamp: now + int64(i*86400),
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePrice,
			Volume:    1000.0,
		})
	}

	// Use a mock strategy that always buys after bar 20
	mock := &mockStrategy{signal: strategies.SignalBuy, startBar: 20}
	engine := NewStrategyEngine(mock)

	res, err := engine.Run(context.Background(), "MOCK", data)
	if err != nil {
		t.Fatalf("Engine Run failed: %v", err)
	}

	if res.TotalBars != 100 {
		t.Errorf("Expected 100 total bars, got %d", res.TotalBars)
	}

	// We expect at least 1 trade to have executed and hit target.
	if res.TotalTrades == 0 {
		t.Errorf("Expected trades to be executed")
	}

	// Since it's a bull trend and we always buy, win rate should be high
	if res.WinRate < 50.0 {
		t.Errorf("Expected high win rate in bull trend, got %.2f", res.WinRate)
	}
}

func TestEngine_Run_BearTrend(t *testing.T) {
	// Generate a 100-bar synthetic bear trend
	var data []OHLCV
	startPrice := 200.0
	now := int64(1_700_000_000)

	for i := 0; i < 100; i++ {
		// Consistent downward movement
		open := startPrice - float64(i)*1.0
		closePrice := open - 0.8
		high := open + 0.2
		low := open - 1.0

		data = append(data, OHLCV{
			Timestamp: now + int64(i*86400),
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePrice,
			Volume:    1000.0,
		})
	}

	// Use a mock strategy that always buys after bar 20
	// We expect these to hit stop losses
	mock := &mockStrategy{signal: strategies.SignalBuy, startBar: 20}
	engine := NewStrategyEngine(mock)

	res, err := engine.Run(context.Background(), "MOCK", data)
	if err != nil {
		t.Fatalf("Engine Run failed: %v", err)
	}

	if res.TotalBars != 100 {
		t.Errorf("Expected 100 total bars, got %d", res.TotalBars)
	}

	if res.TotalTrades == 0 {
		t.Errorf("Expected trades to be executed")
	}

	// Since it's a bear trend and we always buy, PnL should be negative
	if res.NetPnL > 0 {
		t.Errorf("Expected negative PnL in bear trend, got %.2f", res.NetPnL)
	}
}

func TestEngine_RunRejectsInvalidHistoricalBarsBeforeEvaluation(t *testing.T) {
	cases := []struct {
		name        string
		mutate      func([]OHLCV)
		wantInError string
	}{
		{name: "empty series", wantInError: "no historical data"},
		{name: "malformed first bar", mutate: func(bars []OHLCV) { bars[0].Open = 0 }, wantInError: "bar 0"},
		{name: "malformed middle bar", mutate: func(bars []OHLCV) { bars[12].Close = bars[12].High + 1 }, wantInError: "bar 12"},
		{name: "malformed last bar", mutate: func(bars []OHLCV) { bars[24].Volume = -1 }, wantInError: "bar 24"},
		{name: "zero timestamp", mutate: func(bars []OHLCV) { bars[12].Timestamp = 0 }, wantInError: "bar 12"},
		{name: "negative timestamp", mutate: func(bars []OHLCV) { bars[0].Timestamp = -1 }, wantInError: "bar 0"},
		{name: "duplicate timestamp", mutate: func(bars []OHLCV) { bars[12].Timestamp = bars[11].Timestamp }, wantInError: "bar 12"},
		{name: "out of order timestamp", mutate: func(bars []OHLCV) { bars[12].Timestamp = bars[11].Timestamp - 1 }, wantInError: "bar 12"},
		{name: "NaN open", mutate: func(bars []OHLCV) { bars[0].Open = math.NaN() }, wantInError: "bar 0"},
		{name: "positive infinity high", mutate: func(bars []OHLCV) { bars[12].High = math.Inf(1) }, wantInError: "bar 12"},
		{name: "negative infinity low", mutate: func(bars []OHLCV) { bars[24].Low = math.Inf(-1) }, wantInError: "bar 24"},
		{name: "NaN close", mutate: func(bars []OHLCV) { bars[12].Close = math.NaN() }, wantInError: "bar 12"},
		{name: "NaN volume", mutate: func(bars []OHLCV) { bars[24].Volume = math.NaN() }, wantInError: "bar 24"},
		{name: "infinite volume", mutate: func(bars []OHLCV) { bars[12].Volume = math.Inf(1) }, wantInError: "bar 12"},
		{name: "low above open", mutate: func(bars []OHLCV) { bars[12].Low = bars[12].Open + 0.1 }, wantInError: "bar 12"},
		{name: "low above close", mutate: func(bars []OHLCV) { bars[12].Low = bars[12].Close + 0.1 }, wantInError: "bar 12"},
		{name: "open above high", mutate: func(bars []OHLCV) { bars[12].High = bars[12].Open - 0.1 }, wantInError: "bar 12"},
		{name: "close above high", mutate: func(bars []OHLCV) { bars[12].High = bars[12].Close - 0.1 }, wantInError: "bar 12"},
		{name: "low above high", mutate: func(bars []OHLCV) { bars[12].Low = bars[12].High + 0.1 }, wantInError: "bar 12"},
		{name: "zero price", mutate: func(bars []OHLCV) { bars[12].Close = 0 }, wantInError: "bar 12"},
		{name: "negative price", mutate: func(bars []OHLCV) { bars[24].Low = -1 }, wantInError: "bar 24"},
		{name: "negative volume", mutate: func(bars []OHLCV) { bars[12].Volume = -1 }, wantInError: "bar 12"},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			bars := validHistoricalBars(25)
			if tt.mutate != nil {
				tt.mutate(bars)
			} else {
				bars = nil
			}

			strategy := &recordingStrategy{}
			result, err := NewStrategyEngine(strategy).Run(context.Background(), "MOCK", bars)
			if err == nil || !strings.Contains(err.Error(), tt.wantInError) {
				t.Fatalf("expected error containing %q, got result=%+v err=%v", tt.wantInError, result, err)
			}
			if result != (Result{}) {
				t.Errorf("invalid input returned nonzero result: %+v", result)
			}
			if len(strategy.evalTimes) != 0 {
				t.Errorf("strategy evaluated invalid input %d times", len(strategy.evalTimes))
			}

			plan := &recordingPlan{}
			result, err = NewPlanEngine(plan).Run(context.Background(), "MOCK", bars)
			if err == nil || !strings.Contains(err.Error(), tt.wantInError) {
				t.Fatalf("plan engine: expected error containing %q, got result=%+v err=%v", tt.wantInError, result, err)
			}
			if result != (Result{}) {
				t.Errorf("plan engine returned nonzero result: %+v", result)
			}
			if plan.calls != 0 {
				t.Errorf("plan evaluated invalid input %d times", plan.calls)
			}
		})
	}
}

func TestEngine_RunAcceptsSingleHistoricalBar(t *testing.T) {
	strategy := &recordingStrategy{}
	bars := validHistoricalBars(1)

	result, err := NewStrategyEngine(strategy).Run(context.Background(), "MOCK", bars)
	if err != nil {
		t.Fatalf("single valid bar was rejected: %v", err)
	}
	if result.TotalBars != 1 || result.TotalTrades != 0 {
		t.Errorf("unexpected result for one bar: %+v", result)
	}
	if len(strategy.evalTimes) != 0 {
		t.Errorf("single-bar run unexpectedly evaluated strategy %d times", len(strategy.evalTimes))
	}
}

func TestEngine_RunRepeatReplayIsDeterministicAndUsesInputTimes(t *testing.T) {
	bars := validHistoricalBars(25)
	firstStrategy := &recordingStrategy{}
	secondStrategy := &recordingStrategy{}

	firstResult, err := NewStrategyEngine(firstStrategy).Run(context.Background(), "MOCK", bars)
	if err != nil {
		t.Fatalf("first replay failed: %v", err)
	}
	secondResult, err := NewStrategyEngine(secondStrategy).Run(context.Background(), "MOCK", bars)
	if err != nil {
		t.Fatalf("second replay failed: %v", err)
	}

	if firstResult != secondResult {
		t.Errorf("repeat replay results differ: first=%+v second=%+v", firstResult, secondResult)
	}
	if !reflect.DeepEqual(firstStrategy.evalTimes, secondStrategy.evalTimes) {
		t.Fatalf("repeat replay evaluation times differ: first=%v second=%v", firstStrategy.evalTimes, secondStrategy.evalTimes)
	}
	wantTimes := make([]time.Time, 0, len(bars)-19)
	for i := 19; i < len(bars); i++ {
		wantTimes = append(wantTimes, time.Unix(bars[i].Timestamp, 0).UTC())
	}
	if !reflect.DeepEqual(firstStrategy.evalTimes, wantTimes) {
		t.Errorf("evaluation times do not match input timestamps: got=%v want=%v", firstStrategy.evalTimes, wantTimes)
	}
}

func validHistoricalBars(count int) []OHLCV {
	bars := make([]OHLCV, count)
	for i := range bars {
		bars[i] = OHLCV{
			Timestamp: 1_700_000_000 + int64(i*60),
			Open:      100,
			High:      101,
			Low:       99,
			Close:     100.5,
			Volume:    1000,
		}
	}
	return bars
}

type recordingStrategy struct {
	evalTimes []time.Time
}

func (s *recordingStrategy) Name() string                     { return "Recording Strategy" }
func (s *recordingStrategy) Description() string              { return "Records evaluation timestamps" }
func (s *recordingStrategy) CapitalRequirement() float64      { return 0 }
func (s *recordingStrategy) Init(*data.FeatureRegistry) error { return nil }
func (s *recordingStrategy) IsIntradayOnly() bool             { return true }
func (s *recordingStrategy) SetParams(map[string]float64)     {}
func (s *recordingStrategy) Evaluate(_ context.Context, evalTime time.Time, _ string, _ []float64, _ []float64) (strategies.StrategySignal, error) {
	s.evalTimes = append(s.evalTimes, evalTime)
	return strategies.StrategySignal{Signal: strategies.SignalHold, Timestamp: evalTime}, nil
}

type recordingPlan struct {
	calls int
}

func (*recordingPlan) Name() string                         { return "Recording Plan" }
func (*recordingPlan) Description() string                  { return "Records plan evaluations" }
func (*recordingPlan) Strategies() []plans.WeightedStrategy { return nil }
func (*recordingPlan) Init(*data.FeatureRegistry) error     { return nil }
func (p *recordingPlan) Evaluate(_ context.Context, evalTime time.Time, _ string, _ []float64, _ []float64) (plans.PlanEvaluation, error) {
	p.calls++
	return plans.PlanEvaluation{ConsensusSignal: strategies.SignalHold, Timestamp: evalTime}, nil
}

// mockStrategy is a simple strategy for testing
type mockStrategy struct {
	signal   strategies.SignalType
	startBar int
}

func (m *mockStrategy) Name() string        { return "Mock" }
func (m *mockStrategy) Description() string { return "Mock Strategy" }

func (m *mockStrategy) CapitalRequirement() float64 {
	return 0.0
}

func (m *mockStrategy) Init(registry *data.FeatureRegistry) error {
	return nil
}

func (m *mockStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (strategies.StrategySignal, error) {
	if len(closes) < m.startBar {
		return strategies.StrategySignal{Signal: strategies.SignalHold, Timestamp: evalTime}, nil
	}
	return strategies.StrategySignal{
		Signal:      m.signal,
		Score:       100.0,
		StopLossPct: 1.0,
		TargetPct:   1.0,
		Timestamp:   evalTime,
	}, nil
}

func (m *mockStrategy) IsIntradayOnly() bool {
	return true
}

func (m *mockStrategy) SetParams(params map[string]float64) {}
