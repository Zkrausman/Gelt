package risk

import (
	"net/http/httptest"
	"net/http"
	"gelt/pkg/notify"
	"testing"
	"gelt/pkg/config"
	"time"

	"gelt/pkg/options"
)

func TestValidateTrade(t *testing.T) {
	cfg, _ := config.LoadAppConfig()
	limits := DefaultRiskLimits(cfg)

	// Test valid trade
	err := limits.ValidateTrade("AAPL", 100.0, 5000.0)
	if err != nil {
		t.Fatalf("expected valid trade, got error: %v", err)
	}

	// Test trade exceeding max trade USD
	err = limits.ValidateTrade("TSLA", 1000.0, 10000.0)
	if err == nil {
		t.Fatalf("expected error for exceeding MaxTradeUsd, got nil")
	}

	// Test trade exceeding position percentage limit
	err = limits.ValidateTrade("NVDA", 400.0, 5000.0) // 8% > 5%
	if err == nil {
		t.Fatalf("expected error for exceeding MaxPositionPct, got nil")
	}
}

func TestGetAdaptiveRiskGuardrails(t *testing.T) {
	cfg, _ := config.LoadAppConfig()
	spy := GetAdaptiveRiskGuardrails("SPY", cfg)
	if spy.StopLossPct != 0.35 || spy.TargetProfitPct != 0.70 {
		t.Errorf("expected 0.35%% stop and 0.70%% target for SPY, got %.2f%% / %.2f%%", spy.StopLossPct, spy.TargetProfitPct)
	}

	qqq := GetAdaptiveRiskGuardrails("QQQ", cfg)
	if qqq.StopLossPct != 0.50 || qqq.TargetProfitPct != 1.00 {
		t.Errorf("expected 0.50%% stop and 1.00%% target for QQQ, got %.2f%% / %.2f%%", qqq.StopLossPct, qqq.TargetProfitPct)
	}

	equity := GetAdaptiveRiskGuardrails("NVDA", cfg)
	if equity.StopLossPct != 1.50 || equity.TargetProfitPct != 3.00 {
		t.Errorf("expected 1.50%% stop and 3.00%% target for NVDA, got %.2f%% / %.2f%%", equity.StopLossPct, equity.TargetProfitPct)
	}
}

func TestIsPreCloseWindow(t *testing.T) {
	loc, _ := time.LoadLocation("America/New_York")
	t350 := time.Date(2026, 7, 24, 15, 52, 0, 0, loc)
	if !IsPreCloseWindow(t350) {
		t.Errorf("expected 3:52 PM ET to be in pre-close window")
	}

	t200 := time.Date(2026, 7, 24, 14, 0, 0, 0, loc)
	if IsPreCloseWindow(t200) {
		t.Errorf("expected 2:00 PM ET not to be in pre-close window")
	}
}

func TestEquityRiskProfileRejection(t *testing.T) {
	profile := DefaultEquityRiskProfile() // MaxTradeUsd = $10.00

	// Valid $8.00 equity trade
	if err := profile.ValidateEquityTrade("AAPL", 8.00, 50.00); err != nil {
		t.Errorf("expected $8.00 trade to pass, got error: %v", err)
	}

	// $12.00 equity trade MUST be rejected
	err := profile.ValidateEquityTrade("AAPL", 12.00, 50.00)
	if err == nil {
		t.Fatalf("expected $12.00 equity trade to be rejected, got nil error")
	}
}

func TestOptionsRiskProfileNominalExposure(t *testing.T) {
	profile := DefaultOptionsRiskProfile() // MaxContractsPerTrade = 1, MaxDailyLossPct = 20.0%

	contract := options.OptionContract{
		Symbol:        "SPY260814C00500000",
		Underlying:    "SPY",
		Type:          options.Call,
		Strike:        500.0,
		Premium:       1.50, // $1.50 premium
		DaysToExpiry:  14,   // 14 DTE
		Delta:         0.50,
		ImpliedVolPct: 35.0,
	}

	// $1.50 options contract MUST be accepted with $150 nominal exposure
	nominal, err := profile.ValidateOptionsTrade(contract, 1, 10.00) // $10 projected loss < $30 max loss (20% of $150)
	if err != nil {
		t.Fatalf("expected $1.50 option contract to be accepted, got error: %v", err)
	}

	if nominal != 150.00 {
		t.Errorf("expected $150.00 nominal exposure for $1.50 contract, got $%.2f", nominal)
	}

	// Test loss limit rejection: $40 projected loss > 20% of $150 ($30 max loss) MUST be rejected before transmission
	_, errLoss := profile.ValidateOptionsTrade(contract, 1, 40.00)
	if errLoss == nil {
		t.Fatalf("expected options order violating percentage loss limit to be rejected, got nil error")
	}
}

func BenchmarkIsPreCloseWindow(b *testing.B) {
	loc, _ := time.LoadLocation("America/New_York")
	t := time.Date(2026, 7, 24, 15, 52, 0, 0, loc)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		IsPreCloseWindow(t)
	}
}

func init() {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	notify.DefaultDispatcher.SetEndpoint(ts.URL)
}


func TestTestAccountRiskLimitsClamping(t *testing.T) {
	cfg := &config.AppConfig{
		Risk: config.RiskConfig{
			MaxPositionPct: 30.0, // Should clamp to 20.0
			DefaultStopLossPct: 4.0,
		},
	}
	limits := TestAccountRiskLimits(cfg)
	if limits.MaxPositionPct != 20.0 {
		t.Fatalf("expected MaxPositionPct to clamp to 20.0, got %f", limits.MaxPositionPct)
	}
	if limits.StopLossPct != 4.0 {
		t.Fatalf("expected StopLossPct to be 4.0, got %f", limits.StopLossPct)
	}

	cfgZero := &config.AppConfig{
		Risk: config.RiskConfig{
			MaxPositionPct: 0.0, // Should fallback to default 20.0
		},
	}
	limitsZero := TestAccountRiskLimits(cfgZero)
	if limitsZero.MaxPositionPct != 20.0 {
		t.Fatalf("expected MaxPositionPct to fallback to 20.0 for zero config, got %f", limitsZero.MaxPositionPct)
	}
}

func TestGetAdaptiveRiskGuardrailsValidation(t *testing.T) {
	cfg := &config.AppConfig{
		Risk: config.RiskConfig{
			DefaultStopLossPct: 3.5,
			PerSymbolStopLoss: map[string]float64{
				"SPY": -1.0, // Should be rejected, fallback to DefaultStopLossPct
				"QQQ": 0.0,  // Should be rejected, fallback to DefaultStopLossPct
				"AAPL": 1.5, // Should be accepted
			},
		},
	}

	spyProfile := GetAdaptiveRiskGuardrails("SPY", cfg)
	if spyProfile.StopLossPct != 3.5 {
		t.Fatalf("expected SPY StopLossPct to fallback to 3.5 due to negative config, got %f", spyProfile.StopLossPct)
	}

	qqqProfile := GetAdaptiveRiskGuardrails("QQQ", cfg)
	if qqqProfile.StopLossPct != 3.5 {
		t.Fatalf("expected QQQ StopLossPct to fallback to 3.5 due to zero config, got %f", qqqProfile.StopLossPct)
	}

	aaplProfile := GetAdaptiveRiskGuardrails("AAPL", cfg)
	if aaplProfile.StopLossPct != 1.5 {
		t.Fatalf("expected AAPL StopLossPct to be 1.5, got %f", aaplProfile.StopLossPct)
	}

	tslaProfile := GetAdaptiveRiskGuardrails("TSLA", cfg) // NVDA fallback should be ignored, fall back to DefaultStopLossPct since it's not configured
	if tslaProfile.StopLossPct != 3.5 {
		t.Fatalf("expected TSLA StopLossPct to fallback to 3.5 due to missing config, got %f", tslaProfile.StopLossPct)
	}
}


func TestBacktestRepeatabilityIndependentOfConfig(t *testing.T) {
	// Verify that calling TestAccountRiskLimits(nil) is fully deterministic
	// and doesn't read from the global environment.
	limits1 := TestAccountRiskLimits(nil)
	limits2 := TestAccountRiskLimits(nil)

	if limits1.MaxPositionPct != limits2.MaxPositionPct || limits1.StopLossPct != limits2.StopLossPct {
		t.Fatalf("TestAccountRiskLimits(nil) is not deterministic: %v != %v", limits1, limits2)
	}
	if limits1.MaxPositionPct != 20.0 {
		t.Fatalf("expected deterministic MaxPositionPct to be 20.0, got %f", limits1.MaxPositionPct)
	}
}
