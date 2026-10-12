package config

import (
	"testing"
)

func TestLoadPromotionConfig_Defaults(t *testing.T) {
	cfg := LoadPromotionConfig()

	if cfg.AutoPromoEnabled != false {
		t.Errorf("Expected AutoPromoEnabled to be false, got %v", cfg.AutoPromoEnabled)
	}
	if cfg.PromoAlertOnly != true {
		t.Errorf("Expected PromoAlertOnly to be true, got %v", cfg.PromoAlertOnly)
	}
	if cfg.PromoMinWinRate != 65.0 {
		t.Errorf("Expected PromoMinWinRate to be 65.0, got %v", cfg.PromoMinWinRate)
	}
	if cfg.PromoMinProfitFactor != 1.5 {
		t.Errorf("Expected PromoMinProfitFactor to be 1.5, got %v", cfg.PromoMinProfitFactor)
	}
	if cfg.PromoMinTrades != 3 {
		t.Errorf("Expected PromoMinTrades to be 3, got %v", cfg.PromoMinTrades)
	}
	if cfg.PromoMaxVarPct != 5.0 {
		t.Errorf("Expected PromoMaxVarPct to be 5.0, got %v", cfg.PromoMaxVarPct)
	}
	if cfg.PromoLockoutET != "15:30" {
		t.Errorf("Expected PromoLockoutET to be '15:30', got %v", cfg.PromoLockoutET)
	}
	if cfg.PromoKillDrawdownPct != -1.5 {
		t.Errorf("Expected PromoKillDrawdownPct to be -1.5, got %v", cfg.PromoKillDrawdownPct)
	}
}

func TestLoadPromotionConfig_Overrides(t *testing.T) {
	t.Setenv("GELT_AUTO_PROMO_ENABLED", "true")
	t.Setenv("GELT_PROMO_ALERT_ONLY", "false")
	t.Setenv("GELT_PROMO_MIN_WIN_RATE", "70.5")
	t.Setenv("GELT_PROMO_MIN_PROFIT_FACTOR", "2.0")
	t.Setenv("GELT_PROMO_MIN_TRADES", "5")
	t.Setenv("GELT_PROMO_MAX_VAR_PCT", "4.5")
	t.Setenv("GELT_PROMO_LOCKOUT_ET", "16:00")
	t.Setenv("GELT_PROMO_KILL_DRAWDOWN_PCT", "-2.0")

	cfg := LoadPromotionConfig()

	if cfg.AutoPromoEnabled != true {
		t.Errorf("Expected AutoPromoEnabled to be true, got %v", cfg.AutoPromoEnabled)
	}
	if cfg.PromoAlertOnly != false {
		t.Errorf("Expected PromoAlertOnly to be false, got %v", cfg.PromoAlertOnly)
	}
	if cfg.PromoMinWinRate != 70.5 {
		t.Errorf("Expected PromoMinWinRate to be 70.5, got %v", cfg.PromoMinWinRate)
	}
	if cfg.PromoMinProfitFactor != 2.0 {
		t.Errorf("Expected PromoMinProfitFactor to be 2.0, got %v", cfg.PromoMinProfitFactor)
	}
	if cfg.PromoMinTrades != 5 {
		t.Errorf("Expected PromoMinTrades to be 5, got %v", cfg.PromoMinTrades)
	}
	if cfg.PromoMaxVarPct != 4.5 {
		t.Errorf("Expected PromoMaxVarPct to be 4.5, got %v", cfg.PromoMaxVarPct)
	}
	if cfg.PromoLockoutET != "16:00" {
		t.Errorf("Expected PromoLockoutET to be '16:00', got %v", cfg.PromoLockoutET)
	}
	if cfg.PromoKillDrawdownPct != -2.0 {
		t.Errorf("Expected PromoKillDrawdownPct to be -2.0, got %v", cfg.PromoKillDrawdownPct)
	}
}

func TestValidate_Valid(t *testing.T) {
	cfg := LoadPromotionConfig()
	err := cfg.Validate()
	if err != nil {
		t.Errorf("Expected no error for default config, got %v", err)
	}
}

func TestValidate_InvalidWinRate(t *testing.T) {
	cfg := LoadPromotionConfig()
	cfg.PromoMinWinRate = 101.0
	err := cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for win rate > 100")
	}

	cfg.PromoMinWinRate = -1.0
	err = cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for win rate < 0")
	}
}

func TestValidate_InvalidProfitFactor(t *testing.T) {
	cfg := LoadPromotionConfig()
	cfg.PromoMinProfitFactor = -0.1
	err := cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for negative profit factor")
	}
}

func TestValidate_InvalidTrades(t *testing.T) {
	cfg := LoadPromotionConfig()
	cfg.PromoMinTrades = -1
	err := cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for negative trades")
	}
}

func TestValidate_InvalidVarPct(t *testing.T) {
	cfg := LoadPromotionConfig()
	cfg.PromoMaxVarPct = -1.0
	err := cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for negative VaR percentage")
	}
}

func TestValidate_InvalidLockoutET(t *testing.T) {
	cfg := LoadPromotionConfig()
	cfg.PromoLockoutET = "25:00"
	err := cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for invalid time format")
	}

	cfg.PromoLockoutET = "abc"
	err = cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for invalid time string")
	}
}

func TestValidate_InvalidKillDrawdownPct(t *testing.T) {
	cfg := LoadPromotionConfig()
	cfg.PromoKillDrawdownPct = 1.0
	err := cfg.Validate()
	if err == nil {
		t.Errorf("Expected error for positive drawdown percentage")
	}
}
