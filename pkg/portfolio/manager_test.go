package portfolio

import (
	"context"
	"errors"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/regime"
	"gelt/pkg/strategies"
)

// MockStrategy implements the Strategy interface for testing
type MockStrategy struct {
	name          string
	req           float64
	mockSignal    strategies.SignalType
	mockScore     float64
	mockErr       error
	delay         time.Duration
}

func (m *MockStrategy) Name() string {
	return m.name
}

func (m *MockStrategy) Description() string {
	return "Mock strategy for testing"
}

func (m *MockStrategy) Init(registry *data.FeatureRegistry) error {
	return nil
}

func (m *MockStrategy) CapitalRequirement() float64 {
	return m.req
}

func (m *MockStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (strategies.StrategySignal, error) {
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	if m.mockErr != nil {
		return strategies.StrategySignal{}, m.mockErr
	}
	return strategies.StrategySignal{
		StrategyName: m.name,
		Symbol:       symbol,
		Signal:       m.mockSignal,
		Score:        m.mockScore,
		Timestamp:    evalTime,
	}, nil
}

func TestPortfolioManager_ConcurrentExecution(t *testing.T) {
	pm := NewPortfolioManager(1000.0)

	// Fast strategy and slow strategy
	fastStrat := &MockStrategy{name: "Fast", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 80.0, delay: 10 * time.Millisecond}
	slowStrat := &MockStrategy{name: "Slow", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 90.0, delay: 50 * time.Millisecond}
	errStrat := &MockStrategy{name: "Err", req: 100.0, mockErr: errors.New("eval error")}
	holdStrat := &MockStrategy{name: "Hold", req: 100.0, mockSignal: strategies.SignalHold}

	strats := []strategies.Strategy{fastStrat, slowStrat, errStrat, holdStrat}

	start := time.Now()
	signals, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)
	duration := time.Since(start)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Should finish roughly around the slow strat's delay, not sum of all delays
	if duration > 100*time.Millisecond {
		t.Errorf("Execution took too long (%v), likely not concurrent", duration)
	}

	if len(signals) != 2 {
		t.Fatalf("Expected 2 valid BUY signals, got %d", len(signals))
	}

	// Highest score first, so Slow then Fast
	if signals[0].StrategyName != "Slow" {
		t.Errorf("Expected first signal to be from Slow, got %s", signals[0].StrategyName)
	}
	if signals[1].StrategyName != "Fast" {
		t.Errorf("Expected second signal to be from Fast, got %s", signals[1].StrategyName)
	}
}

func TestPortfolioManager_SignalResolution_SellPriority(t *testing.T) {
	pm := NewPortfolioManager(1000.0)

	buyStrat := &MockStrategy{name: "BuyStrat", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 99.0}
	sellStrat1 := &MockStrategy{name: "SellStrat1", req: 0.0, mockSignal: strategies.SignalSell, mockScore: 50.0}
	sellStrat2 := &MockStrategy{name: "SellStrat2", req: 0.0, mockSignal: strategies.SignalSell, mockScore: 80.0}

	strats := []strategies.Strategy{buyStrat, sellStrat1, sellStrat2}

	signals, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(signals) != 1 {
		t.Fatalf("Expected exactly 1 final signal (the highest scoring SELL), got %d", len(signals))
	}

	if signals[0].Signal != strategies.SignalSell {
		t.Errorf("Expected SELL signal priority, got %s", signals[0].Signal)
	}

	if signals[0].StrategyName != "SellStrat2" {
		t.Errorf("Expected SellStrat2 (score 80) to beat SellStrat1 (score 50), got %s", signals[0].StrategyName)
	}
}

func TestPortfolioManager_CapitalBudgeting(t *testing.T) {
	pm := NewPortfolioManager(150.0)

	// Strat 1 has highest score, takes 100
	strat1 := &MockStrategy{name: "Strat1", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 90.0}
	// Strat 2 has second highest score, takes 100 (budget won't allow this after Strat 1)
	strat2 := &MockStrategy{name: "Strat2", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 80.0}
	// Strat 3 has lowest score, takes 40 (budget will allow this after Strat 1)
	strat3 := &MockStrategy{name: "Strat3", req: 40.0, mockSignal: strategies.SignalBuy, mockScore: 70.0}

	strats := []strategies.Strategy{strat1, strat2, strat3}

	signals, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(signals) != 2 {
		t.Fatalf("Expected exactly 2 signals within budget, got %d", len(signals))
	}

	if signals[0].StrategyName != "Strat1" {
		t.Errorf("Expected Strat1 first, got %s", signals[0].StrategyName)
	}

	if signals[1].StrategyName != "Strat3" {
		t.Errorf("Expected Strat3 second due to budget, got %s", signals[1].StrategyName)
	}

	leftover := pm.GetAvailableCapital()

	if leftover != 10.0 {
		t.Errorf("Expected 10.0 capital remaining, got %.2f", leftover)
	}
}

func TestPortfolioManager_NoActionableSignals(t *testing.T) {
	pm := NewPortfolioManager(150.0)

	holdStrat := &MockStrategy{name: "Hold", req: 100.0, mockSignal: strategies.SignalHold}
	errStrat := &MockStrategy{name: "Err", req: 100.0, mockErr: errors.New("err")}

	strats := []strategies.Strategy{holdStrat, errStrat}

	signals, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if signals != nil {
		t.Errorf("Expected nil signals when no actionable signals exist")
	}
}


func TestPortfolioManager_RegimeUpdateAndMargin(t *testing.T) {
	pm := NewPortfolioManager(1000.0)

	// Default regime should not be volatile
	err := pm.DeployMargin(100.0)
	if err != nil {
		t.Fatalf("Expected no error when deploying margin in default regime, got %v", err)
	}

	pm.UpdateRegime(regime.RegimeHighVolatility)
	err = pm.DeployMargin(100.0)
	if err == nil {
		t.Fatal("Expected error when deploying margin in volatile regime, got nil")
	}

	pm.UpdateRegime(regime.RegimeTrendingNormal)
	err = pm.DeployMargin(100.0)
	if err != nil {
		t.Fatalf("Expected no error when deploying margin in normal regime, got %v", err)
	}
}


// InlineMomentumStrategy is a mock strategy for testing momentum regime behavior
type InlineMomentumStrategy struct {
	name          string
	req           float64
	mockSignal    strategies.SignalType
	mockScore     float64
}

func (m *InlineMomentumStrategy) Name() string { return m.name }
func (m *InlineMomentumStrategy) Description() string { return "This is a momentum strategy" }
func (m *InlineMomentumStrategy) Init(registry *data.FeatureRegistry) error { return nil }
func (m *InlineMomentumStrategy) CapitalRequirement() float64 { return m.req }
func (m *InlineMomentumStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (strategies.StrategySignal, error) {
	return strategies.StrategySignal{
		StrategyName: m.name,
		Symbol:       symbol,
		Signal:       m.mockSignal,
		Score:        m.mockScore,
		Timestamp:    evalTime,
	}, nil
}

func TestPortfolioManager_MomentumAllocationVolatileRegime_Real(t *testing.T) {
	pm := NewPortfolioManager(100.0)

	strat := &InlineMomentumStrategy{
		name:       "MomentumStrat",
		req:        100.0,
		mockSignal: strategies.SignalBuy,
		mockScore:  90.0,
	}

	strats := []strategies.Strategy{strat}

	// Set regime to volatile
	pm.UpdateRegime(regime.RegimeHighVolatility)

	signals, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(signals) != 1 {
		t.Fatalf("Expected 1 signal, got %d", len(signals))
	}

	// Because capital requirement was halved (100 -> 50), the remaining capital should be 50.
	remaining := pm.GetAvailableCapital()
	if remaining != 50.0 {
		t.Errorf("Expected 50.0 capital remaining after 50%% reduction of 100 requirement, got %.2f", remaining)
	}

	// Reset and try in normal regime
	pmNormal := NewPortfolioManager(100.0)
	pmNormal.UpdateRegime(regime.RegimeTrendingNormal)

	_, _ = pmNormal.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)

	remainingNormal := pmNormal.GetAvailableCapital()
	if remainingNormal != 0.0 {
		t.Errorf("Expected 0.0 capital remaining in normal regime (full 100 deducted), got %.2f", remainingNormal)
	}
}

func TestPortfolioManager_FailSafeTripped(t *testing.T) {
	pm := NewPortfolioManager(1000.0)

	fs := pm.failsafe
	fs.RecordFailure()
	fs.RecordFailure()
	fs.RecordFailure() // Trips the fail-safe

	strat := &MockStrategy{name: "BuyStrat", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 99.0}
	strats := []strategies.Strategy{strat}

	signals, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)

	if err == nil {
		t.Fatalf("Expected error when fail-safe is tripped, got nil")
	}

	if err.Error() != "fail-safe tripped: halting sandbox execution" {
		t.Fatalf("Expected fail-safe error, got %v", err)
	}

	if signals != nil {
		t.Fatalf("Expected nil signals when fail-safe is tripped")
	}
}

func (m *MockStrategy) IsIntradayOnly() bool {
	return true
}

func (s *InlineMomentumStrategy) IsIntradayOnly() bool {
	return true
}

func (m *MockStrategy) SetParams(params map[string]float64) {}

func (m *InlineMomentumStrategy) SetParams(params map[string]float64) {}
