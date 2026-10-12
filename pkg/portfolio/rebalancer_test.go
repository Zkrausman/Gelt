package portfolio

import (
	"context"
	"sync"
	"testing"
	"time"

	"gelt/pkg/store"
	"gelt/pkg/strategies"
)

func TestRebalancer_ConcurrentUpdates(t *testing.T) {
	// Initialize an in-memory SQLite store
	s, err := store.NewStore("file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	// Initialize Rebalancer and PortfolioManager
	rebalancer := NewRebalancer(s.DB())
	pm := NewPortfolioManager(10000.0)
	pm.SetRebalancer(rebalancer)

	// Create mock strategies
	strat1 := &MockStrategy{name: "Strat1", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 90.0, delay: 10 * time.Millisecond}
	strat2 := &MockStrategy{name: "Strat2", req: 100.0, mockSignal: strategies.SignalBuy, mockScore: 80.0, delay: 10 * time.Millisecond}
	strats := []strategies.Strategy{strat1, strat2}

	var wg sync.WaitGroup
	numIterations := 50

	// Goroutine 1: Continuously insert trades (simulating journal writes)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < numIterations; i++ {
			s.InsertTrade(store.TradeRecord{
				Timestamp:      time.Now(),
				Symbol:         "AAPL",
				Side:           "SELL",
				Quantity:       1.0,
				ExecutionPrice: 150.0,
				RealizedPnL:    50.0, // Should incrementally increase weight
				ActivePlan:     "Strat1",
				MacroRegime:    "BULL",
			})
			time.Sleep(2 * time.Millisecond)
		}
	}()

	// Goroutine 2: Continuously evaluate strategies (simulating live trading loop)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < numIterations; i++ {
			_, err := pm.EvaluateStrategies(context.Background(), time.Now(), "AAPL", nil, nil, strats)
			if err != nil {
				t.Errorf("EvaluateStrategies error: %v", err)
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()

	wg.Wait()
	// Wait for store asynchronous inserts to finish
	time.Sleep(50 * time.Millisecond)

	// Final manual update to ensure we catch all trades
	rebalancer.UpdateWeights()

	weight1 := rebalancer.GetWeight("Strat1")
	weight2 := rebalancer.GetWeight("Strat2")

	// Strat1 had 50 trades of 50.0 PnL = 2500.0 PnL
	// Weight should be 1.0 + (2500.0 / 1000.0) = 3.5
	expectedWeight := 1.0 + float64(numIterations*50)/1000.0

	if weight1 != expectedWeight {
		t.Errorf("Expected Strat1 weight to be %f, got %f", expectedWeight, weight1)
	}

	// Strat2 had no trades, should be default 1.0
	if weight2 != 1.0 {
		t.Errorf("Expected Strat2 weight to be 1.0, got %f", weight2)
	}
}
