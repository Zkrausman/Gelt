package strategies

import (
	"context"
	"gelt/pkg/data"
	"strings"
	"testing"
	"time"

	"gelt/pkg/options"
)

func generateBullishCloses(count int) ([]float64, []float64) {
	closes := make([]float64, count)
	volumes := make([]float64, count)
	for i := 0; i < 30; i++ {
		closes[i] = 100.0 + float64(i%2)*0.1
		volumes[i] = 10000.0
	}
	for i := 30; i < count; i++ {
		closes[i] = 100.0 + float64(i-30)*0.3
		volumes[i] = 10000.0 + float64(i)*50
	}
	return closes, volumes
}

func generateBearishCloses(count int) ([]float64, []float64) {
	closes := make([]float64, count)
	volumes := make([]float64, count)
	for i := 0; i < 30; i++ {
		closes[i] = 200.0 - float64(i%2)*0.1
		volumes[i] = 10000.0
	}
	for i := 30; i < count; i++ {
		closes[i] = 200.0 - float64(i-30)*0.4
		volumes[i] = 10000.0 + float64(i)*50
	}
	return closes, volumes
}

func TestLongOptionsCallSetup(t *testing.T) {
	strat := NewLongOptionsStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)
	closes, volumes := generateBullishCloses(60)

	sig, err := strat.Evaluate(context.Background(), time.Now(), "SPY", closes, volumes)
	if err != nil {
		t.Fatalf("Evaluate failed: %v", err)
	}

	if sig.Signal != SignalBuy {
		t.Errorf("expected SignalBuy for bullish momentum, got %s", sig.Signal)
	}

	if sig.Score < 60.0 {
		t.Errorf("expected Long Call score >= 60.0, got %.1f", sig.Score)
	}

	if !strings.Contains(sig.Rationale, "Long Call Setup") {
		t.Errorf("expected Long Call rationale, got %s", sig.Rationale)
	}
}

func TestLongOptionsPutSetup(t *testing.T) {
	strat := NewLongOptionsStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)
	closes, volumes := generateBearishCloses(60)

	sig, err := strat.Evaluate(context.Background(), time.Now(), "QQQ", closes, volumes)
	if err != nil {
		t.Fatalf("Evaluate failed: %v", err)
	}

	if sig.Signal != SignalSell {
		t.Errorf("expected SignalSell for bearish momentum, got %s", sig.Signal)
	}

	if sig.Score < 60.0 {
		t.Errorf("expected Long Put score >= 60.0, got %.1f", sig.Score)
	}

	if !strings.Contains(sig.Rationale, "Long Put Setup") {
		t.Errorf("expected Long Put rationale, got %s", sig.Rationale)
	}
}

func TestLongOptionsDebitEnforcement(t *testing.T) {
	strat := NewLongOptionsStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)

	validContract := options.OptionContract{
		Symbol:        "SPY260814C00500000",
		Underlying:    "SPY",
		Type:          options.Call,
		Strike:        500.0,
		Premium:       1.50, // $1.50 premium
		DaysToExpiry:  14,   // 14 DTE
		Delta:         0.50,
		ImpliedVolPct: 35.0,
	}

	// 1. Long Debit Buy Order -> MUST PASS with $150.00 nominal exposure
	nominal, err := strat.ValidateLongOptionOrder(validContract, 1, "buy", 10.00)
	if err != nil {
		t.Fatalf("expected valid long debit buy order to pass, got error: %v", err)
	}
	if nominal != 150.00 {
		t.Errorf("expected $150.00 nominal exposure, got $%.2f", nominal)
	}

	// 2. Short Credit Sell Order -> MUST BE BLOCKED LOCALLY
	_, errShort := strat.ValidateLongOptionOrder(validContract, 1, "sell", 10.00)
	if errShort == nil {
		t.Fatalf("expected short credit order to be rejected, got nil error")
	}
	if !strings.Contains(errShort.Error(), "short options credit orders are strictly forbidden") {
		t.Errorf("expected short options rejection error, got: %v", errShort)
	}

	// 3. Exceed Contract Count (2 contracts > 1 max) -> MUST BE REJECTED
	_, errQty := strat.ValidateLongOptionOrder(validContract, 2, "buy", 10.00)
	if errQty == nil {
		t.Fatalf("expected 2 contracts order to be rejected, got nil error")
	}

	// 4. Low DTE Contract (7 DTE < 14 DTE min) -> MUST BE REJECTED
	shortDTE := validContract
	shortDTE.DaysToExpiry = 7
	_, errDTE := strat.ValidateLongOptionOrder(shortDTE, 1, "buy", 10.00)
	if errDTE == nil {
		t.Fatalf("expected low DTE order to be rejected, got nil error")
	}

	// 5. High IV Contract (85% IV > 80% max) -> MUST BE REJECTED
	highIV := validContract
	highIV.ImpliedVolPct = 85.0
	_, errIV := strat.ValidateLongOptionOrder(highIV, 1, "buy", 10.00)
	if errIV == nil {
		t.Fatalf("expected high IV order to be rejected, got nil error")
	}
}
