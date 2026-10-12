package strategies

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gelt/pkg/notify"
)

func sampleData() ([]float64, []float64) {
	closes := make([]float64, 50)
	volumes := make([]float64, 50)
	base := 100.0
	for i := 0; i < 50; i++ {
		closes[i] = base + float64(i)*0.5
		volumes[i] = 10000.0 + float64(i)*100
	}
	return closes, volumes
}

func TestStrategyCatalog(t *testing.T) {
	catalog := DefaultCatalog()
	strats := catalog.List()

	if len(strats) != 15 {
		t.Fatalf("expected 15 strategies in default catalog, got %d", len(strats))
	}

	closes, volumes := sampleData()

	for _, s := range strats {
		sig, err := s.Evaluate(context.Background(), time.Now(), "TSLA", closes, volumes)
		if err != nil {
			t.Errorf("strategy %s evaluation failed: %v", s.Name(), err)
		}
		if sig.StrategyName != s.Name() {
			t.Errorf("expected strategy name %s, got %s", s.Name(), sig.StrategyName)
		}
		if sig.Score < 0.0 || sig.Score > 100.0 {
			t.Errorf("strategy %s score %.2f out of bounds [0, 100]", s.Name(), sig.Score)
		}
	}
}

func TestEnsembleRequestedFourStrategies(t *testing.T) {
	catalog := DefaultCatalog()
	requested := []string{"MACD", "VWAP", "AIChoice", "Random"}
	closes, volumes := sampleData()

	for _, name := range requested {
		s, err := catalog.Get(name)
		if err != nil {
			t.Fatalf("expected strategy %s to be registered: %v", name, err)
		}
		sig, err := s.Evaluate(context.Background(), time.Now(), "SPY", closes, volumes)
		if err != nil {
			t.Fatalf("evaluation failed for strategy %s: %v", name, err)
		}
		if sig.StrategyName != s.Name() {
			t.Errorf("expected StrategyName %s, got %s", s.Name(), sig.StrategyName)
		}
		if name == "AIChoice" && sig.AgentPrompt != DefaultAIPrompt {
			t.Errorf("expected prompt %q, got %q", DefaultAIPrompt, sig.AgentPrompt)
		}
	}
}

func TestEvaluateAll(t *testing.T) {
	catalog := DefaultCatalog()
	closes, volumes := sampleData()

	signals, err := catalog.EvaluateAll(context.Background(), time.Now(), "QQQ", closes, volumes)
	if err != nil {
		t.Fatalf("EvaluateAll failed: %v", err)
	}

	if len(signals) == 0 {
		t.Fatalf("expected signals from EvaluateAll, got empty slice")
	}

	// Verify signals are sorted descending by score
	for i := 0; i < len(signals)-1; i++ {
		if signals[i].Score < signals[i+1].Score {
			t.Errorf("signals not sorted descending by score: %.1f < %.1f", signals[i].Score, signals[i+1].Score)
		}
	}
}

func init() {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	notify.DefaultDispatcher.SetEndpoint(ts.URL)
}

func TestStrategyAssetClass(t *testing.T) {
	catalog := DefaultCatalog()
	strats := catalog.List()

	closes, volumes := sampleData()

	for _, s := range strats {
		sig, err := s.Evaluate(context.Background(), time.Now(), "AAPL", closes, volumes)
		if err != nil {
			t.Errorf("strategy %s evaluation failed: %v", s.Name(), err)
			continue
		}

		expectedClass := AssetEquity
		if s.Name() == "LongOptions" || s.Name() == "VerticalSpread" {
			expectedClass = AssetOptions
		} else if strings.HasSuffix(s.Name(), "_Crypto") {
			expectedClass = AssetCrypto
		}

		if sig.AssetClass != expectedClass {
			t.Errorf("expected AssetClass %s for strategy %s, got %s", expectedClass, s.Name(), sig.AssetClass)
		}
	}
}

func TestStrategySetParamsATRBounds(t *testing.T) {
	closes, volumes := sampleData()
	strat := NewMACDStrategy()

	// 1. Initial State
	sigDefault, err := strat.Evaluate(context.Background(), time.Now(), "AAPL", closes, volumes)
	if err != nil {
		t.Fatalf("Default evaluate failed: %v", err)
	}

	// 2. Apply Custom valid params
	strat.SetParams(map[string]float64{
		"atr_stop_multiplier":   1.0,
		"atr_target_multiplier": 3.0,
	})

	sigCustom, err := strat.Evaluate(context.Background(), time.Now(), "AAPL", closes, volumes)
	if err != nil {
		t.Fatalf("Custom evaluate failed: %v", err)
	}

	if sigDefault.StopLossPct == sigCustom.StopLossPct {
		t.Errorf("StopLossPct should have changed with custom multiplier")
	}
	if sigDefault.TargetPct == sigCustom.TargetPct {
		t.Errorf("TargetPct should have changed with custom multiplier")
	}

	// 3. Apply Invalid (non-positive) params, should be ignored
	strat.SetParams(map[string]float64{
		"atr_stop_multiplier":   -0.5,
		"atr_target_multiplier": 0.0,
	})

	sigInvalid, err := strat.Evaluate(context.Background(), time.Now(), "AAPL", closes, volumes)
	if err != nil {
		t.Fatalf("Invalid params evaluate failed: %v", err)
	}

	// Because they were ignored, the output should remain the same as the previous custom valid params
	if sigCustom.StopLossPct != sigInvalid.StopLossPct {
		t.Errorf("StopLossPct changed after invalid multiplier update. Expected %.2f, got %.2f", sigCustom.StopLossPct, sigInvalid.StopLossPct)
	}
	if sigCustom.TargetPct != sigInvalid.TargetPct {
		t.Errorf("TargetPct changed after invalid multiplier update. Expected %.2f, got %.2f", sigCustom.TargetPct, sigInvalid.TargetPct)
	}
}
