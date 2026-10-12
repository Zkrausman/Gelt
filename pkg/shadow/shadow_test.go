package shadow

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestShadowStore(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "gelt_shadow_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "shadow_journal.json")
	store := NewStore(filePath, filepath.Join(tempDir, "cycles.json"))

	trades, err := store.Load()
	if err != nil {
		t.Fatalf("expected empty load, got error: %v", err)
	}
	if len(trades) != 0 {
		t.Fatalf("expected 0 trades, got %d", len(trades))
	}

	// Add sample closed trade
	sample := ShadowTrade{
		ID:         "shadow-1",
		PlanName:   "RangeBoundDefensivePlan",
		Symbol:     "SPY",
		Side:       "buy",
		EntryPrice: 450.0,
		ExitPrice:  452.25,
		Quantity:   0.022,
		AmountUSD:  10.0,
		PnLUSD:     0.05,
		PnLPct:     0.5,
		Status:     "CLOSED",
		EntryTime:  time.Now().Add(-50 * time.Minute),
		ExitTime:   time.Now().Add(-40 * time.Minute),
	}

	if err := store.addTrade(sample); err != nil {
		t.Fatalf("failed to add shadow trade: %v", err)
	}

	loaded, _ := store.Load()
	if len(loaded) != 1 {
		t.Fatalf("expected 1 loaded trade, got %d", len(loaded))
	}

	perf, err := store.GetPerformance("IntradayAlphaPlan")
	if err != nil {
		t.Fatalf("failed to get performance: %v", err)
	}

	if len(perf) != 1 {
		t.Fatalf("expected 1 plan performance entry, got %d", len(perf))
	}

	if perf[0].PlanName != "RangeBoundDefensivePlan" {
		t.Errorf("expected RangeBoundDefensivePlan, got %s", perf[0].PlanName)
	}
	if perf[0].WinRate != 100.0 {
		t.Errorf("expected 100%% win rate, got %.1f%%", perf[0].WinRate)
	}
	if perf[0].ProfitFactor != 0 {
		t.Errorf("expected undefined all-win ProfitFactor to be suppressed as 0, got %.2f", perf[0].ProfitFactor)
	}
	if perf[0].AvgWin != 0.05 {
		t.Errorf("expected AvgWin 0.05, got %.2f", perf[0].AvgWin)
	}

	// Add loss trade and another win to test multi-trade metrics & MaxDrawdown
	sampleLoss := ShadowTrade{
		ID:         "shadow-2",
		PlanName:   "RangeBoundDefensivePlan",
		Symbol:     "QQQ",
		Side:       "buy",
		EntryPrice: 380.0,
		ExitPrice:  375.0,
		Quantity:   0.02,
		AmountUSD:  7.60,
		PnLUSD:     -0.10,
		PnLPct:     -1.3,
		Status:     "CLOSED",
		EntryTime:  time.Now().Add(-30 * time.Minute),
		ExitTime:   time.Now().Add(-20 * time.Minute),
	}
	sampleWin2 := ShadowTrade{
		ID:         "shadow-3",
		PlanName:   "RangeBoundDefensivePlan",
		Symbol:     "AAPL",
		Side:       "buy",
		EntryPrice: 180.0,
		ExitPrice:  185.0,
		Quantity:   0.03,
		AmountUSD:  5.40,
		PnLUSD:     0.15,
		PnLPct:     2.7,
		Status:     "CLOSED",
		EntryTime:  time.Now().Add(-10 * time.Minute),
		ExitTime:   time.Now(),
	}

	_ = store.addTrade(sampleLoss)
	_ = store.addTrade(sampleWin2)

	perf2, err := store.GetPerformance("IntradayAlphaPlan")
	if err != nil {
		t.Fatalf("failed to get performance: %v", err)
	}

	p := perf2[0]
	if p.TotalTrades != 3 {
		t.Errorf("expected 3 total trades, got %d", p.TotalTrades)
	}
	if p.WinCount != 2 {
		t.Errorf("expected 2 wins, got %d", p.WinCount)
	}
	if p.LossCount != 1 {
		t.Errorf("expected 1 loss, got %d", p.LossCount)
	}
	// Gross profit: 0.05 + 0.15 = 0.20
	// Gross loss: 0.10
	// Profit factor: 0.20 / 0.10 = 2.0
	if p.ProfitFactor != 2.0 {
		t.Errorf("expected ProfitFactor 2.0, got %.2f", p.ProfitFactor)
	}
	// Avg win: 0.20 / 2 = 0.10
	if p.AvgWin != 0.10 {
		t.Errorf("expected AvgWin 0.10, got %.2f", p.AvgWin)
	}
	// Avg loss: 0.10 / 1 = 0.10
	if p.AvgLoss != 0.10 {
		t.Errorf("expected AvgLoss 0.10, got %.2f", p.AvgLoss)
	}
	// Equity sequence: trade1 PnL +0.05 (cum=0.05, peak=0.05, dd=0), trade2 PnL -0.10 (cum=-0.05, peak=0.05, dd=0.10), trade3 PnL +0.15 (cum=0.10, peak=0.10, dd=0)
	// Max drawdown = 0.10
	if p.MaxDrawdown != 0.10 {
		t.Errorf("expected MaxDrawdown 0.10, got %.2f", p.MaxDrawdown)
	}
}

func TestUpdateTrades(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "shadow_update_test.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	trade1 := ShadowTrade{ID: "t1", PnLUSD: 0, Status: "OPEN"}
	trade2 := ShadowTrade{ID: "t2", PnLUSD: 10, Status: "CLOSED"}

	err := store.addTrade(trade1)
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	_ = store.addTrade(trade2)

	// Update t1
	updatedTrade := trade1
	updatedTrade.PnLUSD = 50.0

	err = store.updateTrades([]ShadowTrade{updatedTrade})
	if err != nil {
		t.Fatalf("expected nil error on update, got %v", err)
	}

	loaded, _ := store.Load()
	if len(loaded) != 2 {
		t.Fatalf("expected 2 trades, got %d", len(loaded))
	}

	if loaded[0].ID == "t1" && loaded[0].PnLUSD != 50.0 {
		t.Errorf("expected PnLUSD 50.0 for t1, got %v", loaded[0].PnLUSD)
	}
}

func TestUpdateTrades_DuplicateIDs(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "shadow_dup_update_test.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	trade1 := ShadowTrade{ID: "dup1", Status: "OPEN"}
	trade2 := ShadowTrade{ID: "dup1", Status: "OPEN"}

	_ = store.addTrade(trade1)
	_ = store.addTrade(trade2)

	updated := trade1
	updated.Status = "CLOSED"

	err := store.updateTrades([]ShadowTrade{updated})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	loaded, _ := store.Load()
	for _, tr := range loaded {
		if tr.ID == "dup1" && tr.Status != "CLOSED" {
			t.Errorf("expected all duplicate trades with ID dup1 to be CLOSED, but found one still OPEN")
		}
	}
}

func TestSaveCycleResultGuarded(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "gelt_shadow_cycles_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "shadow_journal.json")
	cyclesFilePath := filepath.Join(tempDir, "cycles.json")
	store := NewStore(filePath, cyclesFilePath)

	// Save a result
	res := EnsembleResult{
		CycleNumber:   1,
		EvalTime:      time.Now(),
		TotalDeployed: 1000.0,
		Signals: []EnsembleSignal{
			{Symbol: "BTC", Signal: "BUY", Score: 85.0},
		},
	}

	if err := store.SaveCycleResultGuarded(1000, res); err != nil {
		t.Fatalf("SaveCycleResultGuarded failed: %v", err)
	}

	// Load it back
	results, err := store.LoadCycleResults()
	if err != nil {
		t.Fatalf("LoadCycleResults failed: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("Expected 1 result, got %d", len(results))
	}

	if results[0].CycleNumber != 1 || results[0].Signals[0].Symbol != "BTC" {
		t.Errorf("Loaded cycle result data mismatched: %+v", results[0])
	}
}

func TestShadowTradeNewFields(t *testing.T) {
	trade := ShadowTrade{
		ID:           "test-trade-new-fields",
		PlanName:     "IntradayAlphaPlan",
		Symbol:       "BTC",
		AssetClass:   "CRYPTO",
		Side:         "buy",
		EntryPrice:   65097.5,
		PeakPrice:    65097.5,
		MarketPrice:  65000.0,
		FillPrice:    65097.5,
		Quantity:     0.015,
		AmountUSD:    976.46,
		SlippagePct:  0.0015,
		SlippageUSD:  1.46,
		Status:       "OPEN",
		IntradayOnly: false,
		SignalTime:   time.Now().Add(-10 * time.Minute),
		EntryTime:    time.Now().Add(-9 * time.Minute),
	}

	if trade.AssetClass != "CRYPTO" {
		t.Errorf("expected CRYPTO asset class, got %s", trade.AssetClass)
	}

	if trade.SlippagePct != 0.0015 {
		t.Errorf("expected 0.0015 slippage pct, got %v", trade.SlippagePct)
	}

	if trade.MarketPrice != 65000.0 {
		t.Errorf("expected 65000 market price, got %v", trade.MarketPrice)
	}
}
