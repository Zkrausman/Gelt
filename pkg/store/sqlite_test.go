package store

import (
	"sync"
	"testing"
	"time"
)

func TestNewStore(t *testing.T) {
	s, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	// Verify table exists by attempting a query
	var count int
	err = s.db.QueryRow("SELECT COUNT(*) FROM trades").Scan(&count)
	if err != nil {
		t.Fatalf("failed to query trades table: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 rows in new table, got %d", count)
	}
}

func TestInsertTrade(t *testing.T) {
	s, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	record := TradeRecord{
		Timestamp:      time.Now(),
		Symbol:         "AAPL",
		Side:           "BUY",
		Quantity:       10.5,
		ExecutionPrice: 150.25,
		RealizedPnL:    0.0,
		ActivePlan:     "TestPlan",
		MacroRegime:    "BULL",
	}

	s.InsertTrade(record)

	// Wait for goroutines to finish
	s.wg.Wait()

	var count int
	err = s.db.QueryRow("SELECT COUNT(*) FROM trades").Scan(&count)
	if err != nil {
		t.Fatalf("failed to query trades table: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 row in table, got %d", count)
	}

	var symbol, side string
	var quantity float64
	err = s.db.QueryRow("SELECT symbol, side, quantity FROM trades LIMIT 1").Scan(&symbol, &side, &quantity)
	if err != nil {
		t.Fatalf("failed to query trade details: %v", err)
	}

	if symbol != "AAPL" || side != "BUY" || quantity != 10.5 {
		t.Errorf("inserted data mismatch: got %s, %s, %f", symbol, side, quantity)
	}
}

func TestInsertTradeConcurrency(t *testing.T) {
	s, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	numTrades := 100
	var wg sync.WaitGroup

	for i := 0; i < numTrades; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			record := TradeRecord{
				Timestamp:      time.Now(),
				Symbol:         "TSLA",
				Side:           "SELL",
				Quantity:       float64(idx),
				ExecutionPrice: 200.0,
				RealizedPnL:    10.0,
				ActivePlan:     "TestPlan",
				MacroRegime:    "BEAR",
			}
			s.InsertTrade(record)
		}(i)
	}

	wg.Wait()
	s.wg.Wait()

	var count int
	err = s.db.QueryRow("SELECT COUNT(*) FROM trades").Scan(&count)
	if err != nil {
		t.Fatalf("failed to query trades table: %v", err)
	}
	if count != numTrades {
		t.Errorf("expected %d rows in table, got %d", numTrades, count)
	}
}

func TestInsertDynamicStrategy(t *testing.T) {
	s, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	id := "test-strat-1"
	definition := []byte(`{"name":"My Strat", "signal":"BUY"}`)

	err = s.InsertDynamicStrategy(id, definition)
	if err != nil {
		t.Fatalf("failed to insert dynamic strategy: %v", err)
	}

	var count int
	err = s.db.QueryRow("SELECT COUNT(*) FROM dynamic_strategies").Scan(&count)
	if err != nil {
		t.Fatalf("failed to query count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 strategy, got %d", count)
	}
}

func TestGetDynamicStrategies(t *testing.T) {
	s, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	s.InsertDynamicStrategy("id1", []byte(`{"name":"Strat1"}`))
	s.InsertDynamicStrategy("id2", []byte(`{"name":"Strat2"}`))

	strats, err := s.GetDynamicStrategies()
	if err != nil {
		t.Fatalf("failed to get dynamic strategies: %v", err)
	}

	if len(strats) != 2 {
		t.Fatalf("expected 2 strategies, got %d", len(strats))
	}

	if string(strats["id1"]) != `{"name":"Strat1"}` {
		t.Errorf("unexpected strategy 1: %s", strats["id1"])
	}
}

func TestDeleteDynamicStrategy(t *testing.T) {
	s, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	s.InsertDynamicStrategy("id1", []byte(`{"name":"Strat1"}`))
	s.InsertDynamicStrategy("id2", []byte(`{"name":"Strat2"}`))

	err = s.DeleteDynamicStrategy("id1")
	if err != nil {
		t.Fatalf("failed to delete strategy: %v", err)
	}

	strats, _ := s.GetDynamicStrategies()
	if len(strats) != 1 {
		t.Fatalf("expected 1 strategy after deletion, got %d", len(strats))
	}
	if _, exists := strats["id1"]; exists {
		t.Errorf("expected id1 to be deleted")
	}
}
