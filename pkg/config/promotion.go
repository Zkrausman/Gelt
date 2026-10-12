package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type PromotionConfig struct {
	AutoPromoEnabled     bool
	PromoAlertOnly       bool
	PromoMinWinRate      float64
	PromoMinProfitFactor float64
	PromoMinTrades       int
	PromoMaxVarPct       float64
	PromoLockoutET       string
	PromoKillDrawdownPct float64
}

func LoadPromotionConfig() *PromotionConfig {
	cfg := &PromotionConfig{
		AutoPromoEnabled:     false,
		PromoAlertOnly:       true,
		PromoMinWinRate:      65.0,
		PromoMinProfitFactor: 1.5,
		PromoMinTrades:       3,
		PromoMaxVarPct:       5.0,
		PromoLockoutET:       "15:30",
		PromoKillDrawdownPct: -1.5,
	}

	if val, exists := os.LookupEnv("GELT_AUTO_PROMO_ENABLED"); exists {
		if b, err := strconv.ParseBool(val); err == nil {
			cfg.AutoPromoEnabled = b
		}
	}
	if val, exists := os.LookupEnv("GELT_PROMO_ALERT_ONLY"); exists {
		if b, err := strconv.ParseBool(val); err == nil {
			cfg.PromoAlertOnly = b
		}
	}
	if val, exists := os.LookupEnv("GELT_PROMO_MIN_WIN_RATE"); exists {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			cfg.PromoMinWinRate = f
		}
	}
	if val, exists := os.LookupEnv("GELT_PROMO_MIN_PROFIT_FACTOR"); exists {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			cfg.PromoMinProfitFactor = f
		}
	}
	if val, exists := os.LookupEnv("GELT_PROMO_MIN_TRADES"); exists {
		if i, err := strconv.Atoi(val); err == nil {
			cfg.PromoMinTrades = i
		}
	}
	if val, exists := os.LookupEnv("GELT_PROMO_MAX_VAR_PCT"); exists {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			cfg.PromoMaxVarPct = f
		}
	}
	if val, exists := os.LookupEnv("GELT_PROMO_LOCKOUT_ET"); exists {
		cfg.PromoLockoutET = val
	}
	if val, exists := os.LookupEnv("GELT_PROMO_KILL_DRAWDOWN_PCT"); exists {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			cfg.PromoKillDrawdownPct = f
		}
	}

	return cfg
}

func (c *PromotionConfig) Validate() error {
	if c.PromoMinWinRate < 0 || c.PromoMinWinRate > 100 {
		return fmt.Errorf("invalid PromoMinWinRate: %f, must be between 0 and 100", c.PromoMinWinRate)
	}
	if c.PromoMinProfitFactor < 0 {
		return fmt.Errorf("invalid PromoMinProfitFactor: %f, must be >= 0", c.PromoMinProfitFactor)
	}
	if c.PromoMinTrades < 0 {
		return fmt.Errorf("invalid PromoMinTrades: %d, must be >= 0", c.PromoMinTrades)
	}
	if c.PromoMaxVarPct < 0 {
		return fmt.Errorf("invalid PromoMaxVarPct: %f, must be >= 0", c.PromoMaxVarPct)
	}
	_, err := time.Parse("15:04", c.PromoLockoutET)
	if err != nil {
		return fmt.Errorf("invalid PromoLockoutET format: %s, expected HH:MM", c.PromoLockoutET)
	}
	if c.PromoKillDrawdownPct > 0 {
		return fmt.Errorf("invalid PromoKillDrawdownPct: %f, must be <= 0", c.PromoKillDrawdownPct)
	}
	return nil
}
