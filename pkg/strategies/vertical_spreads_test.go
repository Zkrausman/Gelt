package strategies

import (
	"context"
	"gelt/pkg/data"
	"testing"
	"time"

	"gelt/pkg/options"
)

func TestVerticalSpreadStrategy_Evaluate(t *testing.T) {
	strat := NewVerticalSpreadStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)

	// Create some dummy data (need at least 50 points for MACD/EMA to initialize properly)
	closes := make([]float64, 100)
	volumes := make([]float64, 100)

	// Uptrend to trigger BULLISH bias
	for i := 0; i < 100; i++ {
		closes[i] = 100.0 + float64(i*i)*0.1
		volumes[i] = 1000.0
	}

	sig, err := strat.Evaluate(context.Background(), time.Now(), "SPY", closes, volumes)
	if err != nil {
		t.Fatalf("Evaluate failed: %v", err)
	}

	if sig.Signal != SignalBuy {
		t.Errorf("expected SignalBuy for strong uptrend, got %s", sig.Signal)
	}

	// Downtrend to trigger BEARISH bias
	for i := 0; i < 100; i++ {
		closes[i] = 150.0 - float64(i)*0.5
		volumes[i] = 1000.0
	}

	sig, err = strat.Evaluate(context.Background(), time.Now(), "SPY", closes, volumes)
	if err != nil {
		t.Fatalf("Evaluate failed: %v", err)
	}

	if sig.Signal != SignalSell {
		t.Errorf("expected SignalSell for strong downtrend, got %s", sig.Signal)
	}
}

func TestVerticalSpreadStrategy_EvaluateSpreadOrder(t *testing.T) {
	strat := NewVerticalSpreadStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)

	validLongCall := options.OptionContract{
		Symbol:        "SPY240119C00400000",
		Underlying:    "SPY",
		Type:          options.Call,
		Strike:        400.0,
		Premium:       5.00,
		DaysToExpiry:  30,
		Delta:         0.50,
		ImpliedVolPct: 20.0,
	}

	validShortCall := options.OptionContract{
		Symbol:        "SPY240119C00410000",
		Underlying:    "SPY",
		Type:          options.Call,
		Strike:        410.0,
		Premium:       2.00, // Cheaper than long call
		DaysToExpiry:  30,
		Delta:         0.30,
		ImpliedVolPct: 18.0,
	}

	// 1. Valid Bull Call Spread (Net Debit)
	exposure, err := strat.EvaluateSpreadOrder(validLongCall, validShortCall, 1, 50.0)
	if err != nil {
		t.Fatalf("EvaluateSpreadOrder failed for valid Bull Call Spread: %v", err)
	}
	expectedExposure := (5.00 - 2.00) * 100.0 * 1 // Net Debit * 100 * Quantity = 3.00 * 100 * 1 = 300.0
	if exposure != expectedExposure {
		t.Errorf("expected nominal exposure %.2f, got %.2f", expectedExposure, exposure)
	}

	// 2. Invalid Net Credit (Short premium > Long premium)
	invalidCreditCall := validShortCall
	invalidCreditCall.Premium = 6.00 // More expensive than long call
	_, err = strat.EvaluateSpreadOrder(validLongCall, invalidCreditCall, 1, 100.0)
	if err == nil {
		t.Errorf("expected EvaluateSpreadOrder to fail for net credit spread, but it passed")
	}

	// 3. Invalid Bull Call Strikes (Long strike > Short strike)
	invalidLongCallStrike := validLongCall
	invalidLongCallStrike.Strike = 420.0
	_, err = strat.EvaluateSpreadOrder(invalidLongCallStrike, validShortCall, 1, 100.0)
	if err == nil {
		t.Errorf("expected EvaluateSpreadOrder to fail for invalid Bull Call strikes (long > short), but it passed")
	}

	// 4. Mismatched Type (Call vs Put)
	shortPut := validShortCall
	shortPut.Type = options.Put
	_, err = strat.EvaluateSpreadOrder(validLongCall, shortPut, 1, 100.0)
	if err == nil {
		t.Errorf("expected EvaluateSpreadOrder to fail for mismatched option types, but it passed")
	}

	// 5. Mismatched DTE
	shortDifferentDTE := validShortCall
	shortDifferentDTE.DaysToExpiry = 15
	_, err = strat.EvaluateSpreadOrder(validLongCall, shortDifferentDTE, 1, 100.0)
	if err == nil {
		t.Errorf("expected EvaluateSpreadOrder to fail for mismatched expiration dates, but it passed")
	}

	// 6. Valid Bear Put Spread (Net Debit)
	validLongPut := options.OptionContract{
		Symbol:        "SPY240119P00400000",
		Underlying:    "SPY",
		Type:          options.Put,
		Strike:        400.0,
		Premium:       4.00,
		DaysToExpiry:  30,
		Delta:         -0.50,
		ImpliedVolPct: 20.0,
	}

	validShortPut := options.OptionContract{
		Symbol:        "SPY240119P00390000",
		Underlying:    "SPY",
		Type:          options.Put,
		Strike:        390.0,
		Premium:       2.00, // Cheaper than long put
		DaysToExpiry:  30,
		Delta:         -0.30,
		ImpliedVolPct: 18.0,
	}

	_, err = strat.EvaluateSpreadOrder(validLongPut, validShortPut, 1, 30.0)
	if err != nil {
		t.Fatalf("EvaluateSpreadOrder failed for valid Bear Put Spread: %v", err)
	}

	// 7. Invalid Bear Put Strikes (Long strike < Short strike)
	invalidLongPutStrike := validLongPut
	invalidLongPutStrike.Strike = 380.0
	_, err = strat.EvaluateSpreadOrder(invalidLongPutStrike, validShortPut, 1, 100.0)
	if err == nil {
		t.Errorf("expected EvaluateSpreadOrder to fail for invalid Bear Put strikes (long < short), but it passed")
	}

	// 8. Risk Profile Rejection (Max Contracts Exceeded)
	_, err = strat.EvaluateSpreadOrder(validLongCall, validShortCall, 5, 100.0) // 5 contracts > default max (1)
	if err == nil {
		t.Errorf("expected EvaluateSpreadOrder to fail due to OptionsRiskProfile rejection (max contracts exceeded), but it passed")
	}
}
