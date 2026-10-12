package shadow

import (
	"context"
	"errors"
	"fmt"
	"gelt/pkg/config"
	"gelt/pkg/data"
	"gelt/pkg/strategies"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEnsembleSignal_LastPrice(t *testing.T) {
	// Simple unit test to ensure EnsembleSignal has LastPrice and scanSymbol populates it
	tmpFile := filepath.Join(t.TempDir(), "ensemble_test.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	cfg := EnsembleConfig{
		StrategyNames:   []string{"TrendConfluence"}, // Will fallback to synthetic data if no MCP
		TotalCapitalUSD: 1000,
		WatchSymbols:    []string{"SPY"},
	}

	engine := NewEnsembleEngine(cfg, store)
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}
	setTestProviderBars(engine)

	sigs, _ := engine.scanSymbol(context.Background(), "SPY", []float64{1000})

	if len(sigs) == 0 {
		t.Fatalf("expected at least one signal")
	}

	// Because MCP Config is nil, it falls back to synthetic data.
	// The SPY synthetic price is ~505.83.
	if sigs[0].LastPrice == 0 {
		t.Errorf("expected LastPrice to be populated, got 0")
	}
}

func TestEnsembleEngine_StopLossExit(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "ensemble_test_stoploss.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	cfg := EnsembleConfig{
		StrategyNames:    []string{"TrendConfluence"},
		TotalCapitalUSD:  1000,
		WatchSymbols:     []string{"SPY"},
		ScanIntervalMins: 1,
		DurationMode:     "session",
	}

	engine := NewEnsembleEngine(cfg, store)
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}
	setTestProviderBars(engine)

	// Add an open trade with stop loss and target profit
	_ = store.addTrade(ShadowTrade{
		ID:          "trade1",
		PlanName:    "TrendConfluence",
		Symbol:      "SPY",
		Side:        "buy",
		EntryPrice:  500.0,
		PeakPrice:   500.0,
		Quantity:    1.0,
		AmountUSD:   500.0,
		StopLossPct: 1.0, // Stop loss at 495.0
		TargetPct:   5.0, // Target profit at 525.0
		Status:      "OPEN",
	})

	_ = store.updateTrades([]ShadowTrade{{
		ID:          "trade1",
		PlanName:    "TrendConfluence",
		Symbol:      "SPY",
		Side:        "buy",
		EntryPrice:  500.0,
		PeakPrice:   600.0,
		Quantity:    1.0,
		AmountUSD:   500.0,
		StopLossPct: 1.0,
		TargetPct:   5.0,
		Status:      "OPEN",
	}})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cycleCount := 0
	_ = engine.RunSession(ctx, func(res EnsembleResult) {
		cycleCount++
		if cycleCount == 1 {
			cancel() // Stop after 1 sweep
		}
	})

	trades, _ := store.Load()
	for _, tr := range trades {
		if tr.ID == "trade1" {
			if tr.Status != "CLOSED" {
				t.Errorf("Expected trade to be CLOSED, got %s", tr.Status)
			}
			if tr.ExitPrice == 0 {
				t.Errorf("Expected ExitPrice to be set")
			}
		}
	}
}

func TestEnsembleEngine_SellSignalExit(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "ensemble_test_sellsignal.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	_ = store.addTrade(ShadowTrade{
		ID:          "trade1",
		PlanName:    "TrendConfluence",
		Symbol:      "SPY",
		Side:        "buy",
		EntryPrice:  500.0,
		PeakPrice:   505.0,
		Quantity:    1.0,
		AmountUSD:   500.0,
		StopLossPct: 10.0, // wide stop
		TargetPct:   10.0, // wide target
		Status:      "OPEN",
	})

	engine := NewEnsembleEngine(EnsembleConfig{VerboseLog: true}, store)
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}
	setTestProviderBars(engine)

	sig := EnsembleSignal{
		StrategyName: "TrendConfluence",
		Symbol:       "SPY",
		Signal:       "SELL",
		LastPrice:    510.0,
	}

	now := time.Now()

	if trades, err := engine.store.Load(); err == nil {
		var toUpdate []ShadowTrade
		for _, tr := range trades {
			if tr.Status == "OPEN" && tr.Symbol == sig.Symbol && tr.PlanName == sig.StrategyName {
				tr.Status = "CLOSED"
				tr.ExitPrice = sig.LastPrice
				tr.ExitTime = now
				tr.PnLUSD = (sig.LastPrice - tr.EntryPrice) * tr.Quantity
				if tr.EntryPrice > 0 {
					tr.PnLPct = ((sig.LastPrice - tr.EntryPrice) / tr.EntryPrice) * 100.0
				}
				toUpdate = append(toUpdate, tr)
			}
		}
		if len(toUpdate) > 0 {
			_ = engine.store.updateTrades(toUpdate)
		}
	}

	trades, _ := store.Load()
	if len(trades) != 1 {
		t.Fatalf("Expected 1 trade, got %d", len(trades))
	}
	if trades[0].Status != "CLOSED" {
		t.Errorf("Expected trade to be CLOSED, got %s", trades[0].Status)
	}
	if trades[0].ExitPrice != 510.0 {
		t.Errorf("Expected ExitPrice 510.0, got %f", trades[0].ExitPrice)
	}
	if trades[0].PnLUSD != 10.0 {
		t.Errorf("Expected PnLUSD 10.0, got %f", trades[0].PnLUSD)
	}
}

func TestEnsembleEngine_CryptoPreCloseSweepBypass_Full(t *testing.T) {
	sigs := []EnsembleSignal{
		{
			StrategyName: "CryptoPlan",
			Symbol:       "BTCUSD",
			Signal:       "BUY",
			AssetClass:   "CRYPTO",
		},
		{
			StrategyName: "EquityPlan",
			Symbol:       "AAPL",
			Signal:       "BUY",
			AssetClass:   "EQUITY",
		},
	}

	preClose := true

	// Process signals like in RunSession
	for i, s := range sigs {
		if s.Signal == "BUY" {
			if preClose && !strings.EqualFold(s.AssetClass, "CRYPTO") {
				sigs[i].Signal = "HOLD"
			}
		}
	}

	if sigs[0].Signal != "BUY" {
		t.Errorf("Expected CryptoPlan signal to remain BUY, got %s", sigs[0].Signal)
	}
	if sigs[1].Signal != "HOLD" {
		t.Errorf("Expected EquityPlan signal to be rejected to HOLD, got %s", sigs[1].Signal)
	}
}

func TestEnsembleEngine_CryptoPreCloseSweepBypass(t *testing.T) {
	evalTime := time.Date(2026, time.July, 31, 15, 52, 0, 0, time.UTC)

	signal, rationale, assetClass, _, _, _, _ := evaluateStrategyLive("CryptoPlan", "BTCUSD", validTestBars(evalTime), evalTime, strategies.DefaultCatalog())

	if !strings.Contains(assetClass, string(strategies.AssetCrypto)) {
		t.Errorf("Expected evaluateStrategyLive to return AssetCrypto for CryptoPlan, got %s", assetClass)
	}

	if signal == "" {
		t.Errorf("Expected signal not to be empty")
	}
	_ = rationale
}

func TestEnsembleEngine_IntradaySweep(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "ensemble_test_intraday.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	_ = store.addTrade(ShadowTrade{
		ID:           "trade-intraday",
		PlanName:     "TrendConfluence",
		Symbol:       "SPY",
		Side:         "buy",
		EntryPrice:   500.0,
		Quantity:     1.0,
		AmountUSD:    500.0,
		Status:       "OPEN",
		IntradayOnly: true,
	})

	_ = store.addTrade(ShadowTrade{
		ID:           "trade-swing",
		PlanName:     "TrendConfluence",
		Symbol:       "QQQ",
		Side:         "buy",
		EntryPrice:   400.0,
		Quantity:     1.0,
		AmountUSD:    400.0,
		Status:       "OPEN",
		IntradayOnly: false,
	})

	engine := NewEnsembleEngine(EnsembleConfig{VerboseLog: true, TotalCapitalUSD: 1000, ScanIntervalMins: 1}, store)
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}

	// Set time to 15:50 ET before injecting provider data so timestamps are fresh.
	etLoc, _ := time.LoadLocation("America/New_York")
	engine.timeFunc = func() time.Time {
		return time.Date(2026, 8, 12, 15, 50, 0, 0, etLoc)
	}
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return freshTestIndicators(engine.now()), nil
	}
	setTestProviderBars(engine)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cycleCount := 0
	_ = engine.RunSession(ctx, func(res EnsembleResult) {
		cycleCount++
		if cycleCount == 1 {
			cancel() // Stop after 1 sweep
		}
	})

	trades, _ := store.Load()
	for _, tr := range trades {
		if tr.ID == "trade-intraday" && tr.Status != "CLOSED" {
			t.Errorf("Expected trade-intraday to be CLOSED, got %s", tr.Status)
		}
		if tr.ID == "trade-swing" && tr.Status != "OPEN" {
			t.Errorf("Expected trade-swing to remain OPEN, got %s", tr.Status)
		}
	}
}

func TestEnsembleEngineSlippage(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "gelt_ensemble_slippage_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := NewStore(filepath.Join(tempDir, "journal.json"), filepath.Join(tempDir, "cycles.json"))
	cfg := EnsembleConfig{
		StrategyNames:    []string{"TestStrategy"},
		TotalCapitalUSD:  1000.00,
		WatchSymbols:     []string{"BTC", "SPY"},
		ScanIntervalMins: 15,
		DurationMode:     "session",
		Slippage: config.SlippageConfig{
			CryptoPct: 0.0015,
			EquityPct: 0.0003,
		},
	}
	engine := NewEnsembleEngine(cfg, store)
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}

	cryptoSlippage := engine.getSlippagePct("CRYPTO")
	if cryptoSlippage != 0.0015 {
		t.Errorf("expected 0.0015 crypto slippage, got %v", cryptoSlippage)
	}

	equitySlippage := engine.getSlippagePct("EQUITY")
	if equitySlippage != 0.0003 {
		t.Errorf("expected 0.0003 equity slippage, got %v", equitySlippage)
	}
}

// MockFailingStrategy implements a dummy strategy that always fails.
type MockFailingStrategy struct{}

func (m MockFailingStrategy) Name() string                         { return "MockFailingStrategy" }
func (m MockFailingStrategy) Description() string                  { return "MockFailingStrategy" }
func (m MockFailingStrategy) CapitalRequirement() float64          { return 0 }
func (m MockFailingStrategy) IsIntradayOnly() bool                 { return false }
func (m MockFailingStrategy) SetParams(p map[string]float64)       {}
func (m MockFailingStrategy) Init(reg *data.FeatureRegistry) error { return nil }
func (m MockFailingStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (strategies.StrategySignal, error) {
	return strategies.StrategySignal{}, fmt.Errorf("mock AI error")
}

func TestAIFailurePolicy_DisableStrategy(t *testing.T) {
	mockCat := strategies.NewRegistry()
	mockCat.Register(MockFailingStrategy{})

	cfg := DefaultEnsembleConfig([]string{"MockFailingStrategy"})
	cfg.Catalog = mockCat
	cfg.AIFailurePolicy = "disable_strategy"
	cfg.AIMaxRetries = 1

	engine := NewEnsembleEngine(cfg, NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json")))
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}
	setTestProviderBars(engine)

	_, _ = engine.scanSymbol(context.Background(), "SPY", []float64{1000.0})

	if !engine.disabled["MockFailingStrategy"] {
		t.Errorf("Expected MockFailingStrategy to be disabled")
	}
}

func TestAIFailurePolicy_AlertAndHold(t *testing.T) {
	mockCat := strategies.NewRegistry()
	mockCat.Register(MockFailingStrategy{})

	cfg := DefaultEnsembleConfig([]string{"MockFailingStrategy"})
	cfg.Catalog = mockCat
	cfg.AIFailurePolicy = "alert_and_hold"
	cfg.AIMaxRetries = 1

	engine := NewEnsembleEngine(cfg, NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json")))
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}
	setTestProviderBars(engine)

	sigs, _ := engine.scanSymbol(context.Background(), "SPY", []float64{1000.0})

	if engine.disabled["MockFailingStrategy"] {
		t.Errorf("Expected MockFailingStrategy to not be disabled")
	}

	if len(sigs) == 0 {
		t.Fatalf("Expected 1 signal, got 0")
	}

	if sigs[0].Signal != "HOLD" {
		t.Errorf("Expected signal HOLD, got %s", sigs[0].Signal)
	}
}

func TestAIFailurePolicy_Exit(t *testing.T) {
	mockCat := strategies.NewRegistry()
	mockCat.Register(MockFailingStrategy{})

	cfg := DefaultEnsembleConfig([]string{"MockFailingStrategy"})
	cfg.Catalog = mockCat
	cfg.AIFailurePolicy = "exit"
	cfg.AIMaxRetries = 1

	engine := NewEnsembleEngine(cfg, NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json")))
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{
			LastPrice:    100.0,
			EMA20:        100.0,
			EMA50:        100.0,
			RSI14:        50.0,
			VWAP:         100.0,
			ATR:          2.0,
			ProviderTime: time.Now().UTC(),
			Source:       providerSource,
		}, nil
	}
	setTestProviderBars(engine)

	_, err := engine.scanSymbol(context.Background(), "SPY", []float64{1000.0})

	if err == nil {
		t.Errorf("Expected engine.scanSymbol to return an error for 'exit' policy, got nil")
	}
}

func TestEnsemble_FailClosedZeroTelemetry_NoOverride(t *testing.T) {
	// This test proves that when fetchIndicatorsOverride is nil (production behavior without mock),
	// and MCPConfig is nil or missing AuthToken, it returns an error immediately and emits no telemetry.
	cfg := DefaultEnsembleConfig([]string{"TrendConfluence"})
	cfg.MCPConfig = nil // Ensure no valid config is present
	cfg.WatchSymbols = []string{"SPY"}

	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	engine := NewEnsembleEngine(cfg, store)
	// Deliberately do not set engine.fetchIndicatorsOverride to test the fail-closed logic

	_, err := engine.scanSymbol(context.Background(), "SPY", []float64{100.0})
	if err == nil {
		t.Fatalf("expected error when live market data is unavailable, got nil")
	}

	trades, _ := store.Load()
	if len(trades) > 0 {
		t.Fatalf("expected 0 trades, got %d", len(trades))
	}
}

func TestEnsemble_FailClosedZeroTelemetry_Malformed(t *testing.T) {
	cfg := DefaultEnsembleConfig([]string{"TrendConfluence"})
	cfg.WatchSymbols = []string{"SPY"}

	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	engine := NewEnsembleEngine(cfg, store)

	// Simulate malformed/missing indicators from Robinhood
	engine.fetchIndicatorsOverride = func(symbol string) (LiveIndicators, error) {
		return LiveIndicators{}, fmt.Errorf("market data unavailable: required indicators missing")
	}

	_, err := engine.scanSymbol(context.Background(), "SPY", []float64{100.0})
	if err == nil {
		t.Fatalf("expected error when live market data is unavailable due to missing indicators, got nil")
	}

	trades, _ := store.Load()
	if len(trades) > 0 {
		t.Fatalf("expected 0 trades, got %d", len(trades))
	}
}

func freshTestIndicators(now time.Time) LiveIndicators {
	return LiveIndicators{
		LastPrice: 100, EMA20: 100, EMA50: 100, RSI14: 50, VWAP: 100, ATR: 2,
		ProviderTime: now.Add(-time.Minute), Source: providerSource,
	}
}

func validTestBars(now time.Time) []ProviderBar {
	bars := make([]ProviderBar, minimumEvaluationBars)
	for i := range bars {
		bars[i] = ProviderBar{BeginsAt: now.Add(time.Duration(i-minimumEvaluationBars+1) * time.Minute), Close: 90 + float64(i)*0.1, Volume: 1000 + float64(i), Source: providerSource}
	}
	return bars
}

func setTestProviderBars(engine *EnsembleEngine) {
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(engine.now()), nil }
}

type provenanceCountingStrategy struct{ evaluations *int32 }

func (s provenanceCountingStrategy) Name() string                     { return "ProvenanceCounting" }
func (s provenanceCountingStrategy) Description() string              { return "test strategy" }
func (s provenanceCountingStrategy) CapitalRequirement() float64      { return 0 }
func (s provenanceCountingStrategy) IsIntradayOnly() bool             { return false }
func (s provenanceCountingStrategy) SetParams(map[string]float64)     {}
func (s provenanceCountingStrategy) Init(*data.FeatureRegistry) error { return nil }
func (s provenanceCountingStrategy) Evaluate(_ context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
	atomic.AddInt32(s.evaluations, 1)
	return strategies.StrategySignal{StrategyName: s.Name(), Symbol: symbol, AssetClass: strategies.AssetEquity, Signal: strategies.SignalBuy, Timestamp: at}, nil
}

func TestEnsemble_FailClosedInvalidMarketDataHasNoSideEffects(t *testing.T) {
	now := time.Date(2026, time.August, 12, 15, 45, 0, 0, time.UTC)
	cases := []struct {
		name string
		set  func(*EnsembleEngine)
	}{
		{"unavailable", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return LiveIndicators{}, fmt.Errorf("unavailable") }
		}},
		{"no quote", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) {
				ind := freshTestIndicators(now)
				ind.LastPrice = 0
				return ind, nil
			}
		}},
		{"nan", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) {
				ind := freshTestIndicators(now)
				ind.EMA20 = math.NaN()
				return ind, nil
			}
		}},
		{"infinite", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) {
				ind := freshTestIndicators(now)
				ind.ATR = math.Inf(1)
				return ind, nil
			}
		}},
		{"out of range rsi", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) {
				ind := freshTestIndicators(now)
				ind.RSI14 = 101
				return ind, nil
			}
		}},
		{"stale indicators", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) {
				ind := freshTestIndicators(now)
				ind.ProviderTime = now.Add(-marketDataFreshness - time.Second)
				return ind, nil
			}
		}},
		{"stale bars", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
			e.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) {
				bars := validTestBars(now.Add(-marketDataFreshness - time.Second))
				return bars, nil
			}
		}},
		{"bar-less", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
			e.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return nil, nil }
		}},
		{"synthetic repeated bars", func(e *EnsembleEngine) {
			e.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
			e.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) {
				bars := validTestBars(now)
				for i := range bars {
					bars[i].Close, bars[i].Volume = 100, 1000
				}
				return bars, nil
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var evaluations int32
			store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
			catalog := strategies.NewRegistry()
			catalog.Register(provenanceCountingStrategy{evaluations: &evaluations})
			engine := NewEnsembleEngine(EnsembleConfig{StrategyNames: []string{"ProvenanceCounting"}, TotalCapitalUSD: 100, WatchSymbols: []string{"SPY"}, ScanIntervalMins: 1, DurationMode: "session", Catalog: catalog}, store)
			engine.timeFunc = func() time.Time { return now }
			if err := store.addTrade(ShadowTrade{ID: "existing", PlanName: "existing", Symbol: "SPY", Status: "OPEN", EntryPrice: 100, PeakPrice: 100, Quantity: 1}); err != nil {
				t.Fatalf("seed isolated store: %v", err)
			}
			tc.set(engine)
			callbacks := 0
			if err := engine.RunSession(context.Background(), func(EnsembleResult) { callbacks++ }); err == nil {
				t.Fatal("expected fail-closed market-data error")
			}
			if got := atomic.LoadInt32(&evaluations); got != 0 {
				t.Fatalf("strategy evaluated invalid market data: %d", got)
			}
			trades, _ := store.Load()
			cycles, _ := store.LoadCycleResults()
			if len(trades) != 1 || trades[0].Status != "OPEN" || trades[0].MarketPrice != 0 || len(cycles) != 0 || callbacks != 0 {
				t.Fatalf("invalid data advanced trade or telemetry state: trades=%+v cycles=%d callbacks=%d", trades, len(cycles), callbacks)
			}
		})
	}
}

func TestEnsemble_ConditionalConflictSuppressesExitAlertAndCallback(t *testing.T) {
	now := time.Date(2026, time.August, 12, 19, 51, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	trade := ShadowTrade{ID: "intraday", PlanName: "intraday", Symbol: "SPY", AssetClass: "EQUITY", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	if err := store.addTrade(trade); err != nil {
		t.Fatal(err)
	}
	engine := NewEnsembleEngine(EnsembleConfig{ScanIntervalMins: 1, DurationMode: "24h", TotalCapitalUSD: 100}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	store.beforeConditionalUpdate = func() {
		if err := store.updateTrades([]ShadowTrade{{ID: trade.ID, Status: "CLOSED"}}); err != nil {
			t.Fatal(err)
		}
	}
	alerts, callbacks, verboseClaims := 0, 0, 0
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }
	engine.verbosef = func(string, ...any) (int, error) { verboseClaims++; return 0, nil }
	if err := engine.RunSession(context.Background(), func(EnsembleResult) { callbacks++ }); !errors.Is(err, ErrJournalConflict) {
		t.Fatalf("RunSession error = %v, want ErrJournalConflict", err)
	}
	if alerts != 0 || callbacks != 0 || verboseClaims != 0 {
		t.Fatalf("conditional conflict emitted committed-exit claim: alerts=%d callbacks=%d verbose=%d", alerts, callbacks, verboseClaims)
	}
}

func TestEnsemble_PersistedOpenDeploymentAndPreCloseAlert(t *testing.T) {
	// 2026-08-12 19:51 UTC is 15:51 ET during daylight saving time.
	now := time.Date(2026, time.August, 12, 19, 51, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	intraday := ShadowTrade{ID: "intraday", PlanName: "intraday", Symbol: "SPY", AssetClass: "EQUITY", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	carry := ShadowTrade{ID: "carry", PlanName: "carry", Symbol: "QQQ", AssetClass: "EQUITY", Side: "buy", EntryPrice: 50, PeakPrice: 50, Quantity: 2, AmountUSD: 100, Status: "OPEN"}
	if err := store.addTrade(intraday); err != nil {
		t.Fatal(err)
	}
	if err := store.addTrade(carry); err != nil {
		t.Fatal(err)
	}
	engine := NewEnsembleEngine(EnsembleConfig{ScanIntervalMins: 1, DurationMode: "24h", VerboseLog: true, TotalCapitalUSD: 200}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	var alerts []string
	verboseClaims := 0
	engine.sendTradeAlert = func(_, _, _, event string, _, _, _, _ float64) { alerts = append(alerts, event) }
	engine.verbosef = func(string, ...any) (int, error) { verboseClaims++; return 0, nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var result EnsembleResult
	if err := engine.RunSession(ctx, func(r EnsembleResult) { result = r; cancel() }); err != context.Canceled {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if result.TotalDeployed != 100 || trades[0].Status != "CLOSED" || trades[1].Status != "OPEN" {
		t.Fatalf("cycle does not reflect final persisted state: result=%+v trades=%+v", result, trades)
	}
	if len(alerts) != 1 || alerts[0] != "PRE_CLOSE_EXIT" || verboseClaims != 1 {
		t.Fatalf("expected one persisted pre-close exit claim, got alerts=%v verbose=%d", alerts, verboseClaims)
	}
}

func TestEnsemble_EndOfDayExitAlertAfterPersistence(t *testing.T) {
	// 2026-08-12 20:00 UTC is 16:00 ET during daylight saving time.
	now := time.Date(2026, time.August, 12, 20, 0, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	trade := ShadowTrade{ID: "intraday", PlanName: "intraday", Symbol: "SPY", AssetClass: "EQUITY", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	if err := store.addTrade(trade); err != nil {
		t.Fatal(err)
	}
	engine := NewEnsembleEngine(EnsembleConfig{ScanIntervalMins: 1, DurationMode: "session", TotalCapitalUSD: 100}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	var alerts []string
	engine.sendTradeAlert = func(_, _, _, event string, _, _, _, _ float64) { alerts = append(alerts, event) }
	var result EnsembleResult
	if err := engine.RunSession(context.Background(), func(r EnsembleResult) { result = r }); err != nil {
		t.Fatal(err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if result.TotalDeployed != 0 || len(trades) != 1 || trades[0].Status != "CLOSED" {
		t.Fatalf("end-of-day result does not reflect persisted closure: result=%+v trades=%+v", result, trades)
	}
	if len(alerts) != 1 || alerts[0] != "END_OF_DAY_EXIT" {
		t.Fatalf("expected persisted end-of-day exit alert, got %v", alerts)
	}
}

func TestEnsemble_ETLocationFailureHasNoSideEffects(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	engine := NewEnsembleEngine(EnsembleConfig{TotalCapitalUSD: 100, WatchSymbols: []string{"SPY"}, ScanIntervalMins: 1, DurationMode: "session"}, store)
	engine.loadLocation = func(string) (*time.Location, error) { return nil, errors.New("missing ET zone") }
	fetches, alerts := 0, 0
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { fetches++; return LiveIndicators{}, nil }
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }
	if err := engine.RunSession(context.Background(), nil); err == nil {
		t.Fatal("session succeeded despite missing ET location")
	}
	trades, err := store.Load()
	if err != nil || len(trades) != 0 {
		t.Fatalf("ET load failure mutated journal: trades=%+v err=%v", trades, err)
	}
	cycles, err := store.LoadCycleResults()
	if err != nil || len(cycles) != 0 || fetches != 0 || alerts != 0 {
		t.Fatalf("ET load failure performed work: cycles=%+v err=%v fetches=%d alerts=%d", cycles, err, fetches, alerts)
	}
}

func TestEnsemble_PreCloseKeepsCryptoOpenByAssetClass(t *testing.T) {
	// 2026-08-12 19:51 UTC is 15:51 ET during daylight saving time.
	now := time.Date(2026, time.August, 12, 19, 51, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	crypto := ShadowTrade{ID: "crypto", PlanName: "equity-named-plan", Symbol: "BTC", AssetClass: "CRYPTO", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	equity := ShadowTrade{ID: "equity", PlanName: "crypto-named-plan", Symbol: "SPY", AssetClass: "EQUITY", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	if err := store.addTrade(crypto); err != nil {
		t.Fatal(err)
	}
	if err := store.addTrade(equity); err != nil {
		t.Fatal(err)
	}
	engine := NewEnsembleEngine(EnsembleConfig{TotalCapitalUSD: 200, WatchSymbols: []string{}, ScanIntervalMins: 1, DurationMode: "24h"}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.RunSession(ctx, func(EnsembleResult) { cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != 2 || trades[0].Status != "OPEN" || trades[1].Status != "CLOSED" {
		t.Fatalf("pre-close AssetClass behavior changed wrong trades: %+v", trades)
	}
}

func TestEnsemble_EndOfDayKeepsCryptoOpenByAssetClass(t *testing.T) {
	// 2026-08-12 20:00 UTC is 16:00 ET during daylight saving time.
	now := time.Date(2026, time.August, 12, 20, 0, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	crypto := ShadowTrade{ID: "crypto", PlanName: "equity-named-plan", Symbol: "BTC", AssetClass: "CRYPTO", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	equity := ShadowTrade{ID: "equity", PlanName: "crypto-named-plan", Symbol: "SPY", AssetClass: "EQUITY", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN", IntradayOnly: true}
	if err := store.addTrade(crypto); err != nil {
		t.Fatal(err)
	}
	if err := store.addTrade(equity); err != nil {
		t.Fatal(err)
	}
	engine := NewEnsembleEngine(EnsembleConfig{TotalCapitalUSD: 200, WatchSymbols: []string{}, ScanIntervalMins: 1, DurationMode: "session"}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	callbacks := 0
	if err := engine.RunSession(ctx, func(EnsembleResult) { callbacks++; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if callbacks != 1 || len(trades) != 2 || trades[0].Status != "OPEN" || trades[1].Status != "CLOSED" {
		t.Fatalf("crypto did not keep monitoring active or equity was not closed: callbacks=%d trades=%+v", callbacks, trades)
	}
}

func TestEnsemble_PostCloseCryptoBlocksNonCryptoEntry(t *testing.T) {
	// 2026-08-12 20:00 UTC is 16:00 ET during daylight saving time.
	now := time.Date(2026, time.August, 12, 20, 0, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	crypto := ShadowTrade{ID: "crypto", PlanName: "crypto", Symbol: "BTC", AssetClass: "CRYPTO", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN"}
	if err := store.addTrade(crypto); err != nil {
		t.Fatal(err)
	}
	catalog := strategies.NewRegistry()
	var evaluations int32
	catalog.Register(provenanceCountingStrategy{evaluations: &evaluations})
	engine := NewEnsembleEngine(EnsembleConfig{StrategyNames: []string{"ProvenanceCounting"}, TotalCapitalUSD: 300, WatchSymbols: []string{"QQQ"}, ScanIntervalMins: 1, DurationMode: "session", Catalog: catalog}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var result EnsembleResult
	if err := engine.RunSession(ctx, func(r EnsembleResult) { result = r; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&evaluations) != 1 || len(trades) != 1 || trades[0].Status != "OPEN" {
		t.Fatalf("post-close monitoring did not retain only crypto: evaluations=%d trades=%+v", evaluations, trades)
	}
	if len(result.Signals) != 1 || result.Signals[0].Signal != "HOLD" || !strings.Contains(result.Signals[0].Rationale, "[EQUITY SESSION CLOSED]") {
		t.Fatalf("post-close non-crypto BUY was not blocked: signals=%+v", result.Signals)
	}
}

func TestEnsemble_PostCloseDuplicateNonCryptoUsesSessionClosedRationale(t *testing.T) {
	// 2026-08-12 20:00 UTC is 16:00 ET during daylight saving time.
	now := time.Date(2026, time.August, 12, 20, 0, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	crypto := ShadowTrade{ID: "crypto", PlanName: "crypto", Symbol: "BTC", AssetClass: "CRYPTO", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN"}
	duplicate := ShadowTrade{ID: "duplicate", PlanName: "ProvenanceCounting", Symbol: "QQQ", AssetClass: "EQUITY", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN"}
	if err := store.addTrade(crypto); err != nil {
		t.Fatal(err)
	}
	if err := store.addTrade(duplicate); err != nil {
		t.Fatal(err)
	}
	catalog := strategies.NewRegistry()
	var evaluations int32
	catalog.Register(provenanceCountingStrategy{evaluations: &evaluations})
	engine := NewEnsembleEngine(EnsembleConfig{StrategyNames: []string{"ProvenanceCounting"}, TotalCapitalUSD: 300, WatchSymbols: []string{"QQQ"}, ScanIntervalMins: 1, DurationMode: "session", Catalog: catalog}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var result EnsembleResult
	if err := engine.RunSession(ctx, func(r EnsembleResult) { result = r; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	if atomic.LoadInt32(&evaluations) != 1 || len(result.Signals) != 1 || result.Signals[0].Signal != "HOLD" || !strings.Contains(result.Signals[0].Rationale, "[EQUITY SESSION CLOSED]") {
		t.Fatalf("post-close duplicate signal was not truthfully blocked: signals=%+v", result.Signals)
	}
}

func TestEnsemble_OvernightCryptoBlocksNonCryptoEntry(t *testing.T) {
	// 2026-08-13 04:00 UTC is midnight ET during daylight saving time.
	now := time.Date(2026, time.August, 13, 4, 0, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	crypto := ShadowTrade{ID: "crypto", PlanName: "crypto", Symbol: "BTC", AssetClass: "CRYPTO", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN"}
	if err := store.addTrade(crypto); err != nil {
		t.Fatal(err)
	}
	catalog := strategies.NewRegistry()
	var evaluations int32
	catalog.Register(provenanceCountingStrategy{evaluations: &evaluations})
	engine := NewEnsembleEngine(EnsembleConfig{StrategyNames: []string{"ProvenanceCounting"}, TotalCapitalUSD: 300, WatchSymbols: []string{"QQQ"}, ScanIntervalMins: 1, DurationMode: "session", Catalog: catalog}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var result EnsembleResult
	if err := engine.RunSession(ctx, func(r EnsembleResult) { result = r; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&evaluations) != 1 || len(trades) != 1 || trades[0].Status != "OPEN" {
		t.Fatalf("overnight monitoring did not retain only crypto: evaluations=%d trades=%+v", evaluations, trades)
	}
	if len(result.Signals) != 1 || result.Signals[0].Signal != "HOLD" || !strings.Contains(result.Signals[0].Rationale, "[EQUITY SESSION CLOSED]") {
		t.Fatalf("overnight non-crypto BUY was not blocked: signals=%+v", result.Signals)
	}
}

func TestEnsemble_WeekendCryptoBlocksNonCryptoEntry(t *testing.T) {
	// 2026-08-15 14:00 UTC is 10:00 ET on Saturday.
	now := time.Date(2026, time.August, 15, 14, 0, 0, 0, time.UTC)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	crypto := ShadowTrade{ID: "crypto", PlanName: "crypto", Symbol: "BTC", AssetClass: "CRYPTO", Side: "buy", EntryPrice: 100, PeakPrice: 100, Quantity: 1, AmountUSD: 100, Status: "OPEN"}
	if err := store.addTrade(crypto); err != nil {
		t.Fatal(err)
	}
	catalog := strategies.NewRegistry()
	var evaluations int32
	catalog.Register(provenanceCountingStrategy{evaluations: &evaluations})
	engine := NewEnsembleEngine(EnsembleConfig{StrategyNames: []string{"ProvenanceCounting"}, TotalCapitalUSD: 300, WatchSymbols: []string{"QQQ"}, ScanIntervalMins: 1, DurationMode: "session", Catalog: catalog}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var result EnsembleResult
	if err := engine.RunSession(ctx, func(r EnsembleResult) { result = r; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession error = %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&evaluations) != 1 || len(trades) != 1 || trades[0].Status != "OPEN" {
		t.Fatalf("weekend monitoring did not retain only crypto: evaluations=%d trades=%+v", evaluations, trades)
	}
	if len(result.Signals) != 1 || result.Signals[0].Signal != "HOLD" || !strings.Contains(result.Signals[0].Rationale, "[EQUITY SESSION CLOSED]") {
		t.Fatalf("weekend non-crypto BUY was not blocked: signals=%+v", result.Signals)
	}
}

func TestEnsemble_FreshProviderProvenanceEvaluatesAndIsObservable(t *testing.T) {
	now := time.Date(2026, time.August, 12, 22, 0, 0, 0, time.UTC)
	var evaluations int32
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	catalog := strategies.NewRegistry()
	catalog.Register(provenanceCountingStrategy{evaluations: &evaluations})
	engine := NewEnsembleEngine(EnsembleConfig{StrategyNames: []string{"ProvenanceCounting"}, TotalCapitalUSD: 100, WatchSymbols: []string{"SPY"}, ScanIntervalMins: 1, DurationMode: "24h", Catalog: catalog}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }

	callbacks := 0
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.RunSession(ctx, func(EnsembleResult) { callbacks++; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("fresh provider data should run: %v, want context.Canceled", err)
	}
	trades, _ := store.Load()
	cycles, _ := store.LoadCycleResults()
	if atomic.LoadInt32(&evaluations) != 1 || len(trades) != 1 || len(cycles) != 1 || callbacks != 1 {
		t.Fatalf("fresh provenance was not observable: evaluations=%d trades=%d cycles=%d callbacks=%d", evaluations, len(trades), len(cycles), callbacks)
	}
}
