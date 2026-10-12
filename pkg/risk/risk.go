// Package risk provides position sizing, stop-loss checks, and portfolio allocation guardrails for Gelt.
package risk

import (
	"fmt"
	"sync"
	"time"

	"gelt/pkg/notify"
	"gelt/pkg/options"
	"gelt/pkg/config"
)

var (
	nyLocation *time.Location
	nyLocOnce  sync.Once
)

func getNYLocation() *time.Location {
	nyLocOnce.Do(func() {
		loc, err := time.LoadLocation("America/New_York")
		if err != nil {
			nyLocation = time.Local
		} else {
			nyLocation = loc
		}
	})
	return nyLocation
}

// EquityRiskProfile defines parameterized governance constraints for stock/ETF trades.
type EquityRiskProfile struct {
	MaxTradeUsd     float64 `json:"max_trade_usd"`      // e.g. $10.00
	MaxDailyLossUsd float64 `json:"max_daily_loss_usd"` // e.g. $5.00
	MaxPositionPct  float64 `json:"max_position_pct"`   // e.g. 20.0%
}

// DefaultEquityRiskProfile returns default micro-cap equity constraints ($10 max trade, $5 daily loss).
func DefaultEquityRiskProfile() EquityRiskProfile {
	return EquityRiskProfile{
		MaxTradeUsd:     10.00,
		MaxDailyLossUsd: 5.00,
		MaxPositionPct:  20.0,
	}
}

// ValidateEquityTrade evaluates a proposed equity order against EquityRiskProfile constraints.
func (e EquityRiskProfile) ValidateEquityTrade(symbol string, amountUsd float64, portfolioTotalUsd float64) error {
	if amountUsd <= 0 {
		errMsg := fmt.Sprintf("trade amount must be positive, got $%.2f", amountUsd)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if amountUsd > e.MaxTradeUsd {
		errMsg := fmt.Sprintf("trade amount $%.2f exceeds maximum equity trade limit of $%.2f", amountUsd, e.MaxTradeUsd)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if portfolioTotalUsd > 0 {
		positionPct := (amountUsd / portfolioTotalUsd) * 100.0
		if positionPct > e.MaxPositionPct {
			errMsg := fmt.Sprintf("proposed position size %.2f%% for %s exceeds max limit of %.2f%%", positionPct, symbol, e.MaxPositionPct)
			notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
			return fmt.Errorf("%s", errMsg)
		}
	}

	return nil
}

// OptionsRiskProfile defines parameterized governance constraints for options contract orders.
type OptionsRiskProfile struct {
	MaxContractsPerTrade int     `json:"max_contracts_per_trade"` // e.g. 1 contract
	MaxDailyLossPct      float64 `json:"max_daily_loss_pct"`      // e.g. 20.0% percentage-based drawdown on premium
	MinDTE               int     `json:"min_dte"`                 // e.g. 14 DTE
	MaxImpliedVolPct     float64 `json:"max_implied_vol_pct"`     // e.g. 80.0% IV cap
}

// DefaultOptionsRiskProfile returns default options constraints (1 contract, 20% loss cap, 14 DTE).
func DefaultOptionsRiskProfile() OptionsRiskProfile {
	return OptionsRiskProfile{
		MaxContractsPerTrade: 1,
		MaxDailyLossPct:      20.0,
		MinDTE:               14,
		MaxImpliedVolPct:     80.0,
	}
}

// ValidateOptionsTrade evaluates an options order against OptionsRiskProfile.
// It computes dynamic nominal exposure (Premium * 100 * Quantity) and enforces percentage drawdown caps.
func (o OptionsRiskProfile) ValidateOptionsTrade(contract options.OptionContract, quantity int, projectedLossUsd float64) (float64, error) {
	if quantity <= 0 {
		errMsg := fmt.Sprintf("contract quantity must be positive, got %d", quantity)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return 0.0, fmt.Errorf("%s", errMsg)
	}

	if quantity > o.MaxContractsPerTrade {
		errMsg := fmt.Sprintf("requested quantity %d contracts exceeds max allowed of %d contract", quantity, o.MaxContractsPerTrade)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return 0.0, fmt.Errorf("%s", errMsg)
	}

	nominalExposure := contract.Premium * 100.0 * float64(quantity)
	if nominalExposure <= 0 {
		errMsg := fmt.Sprintf("invalid option contract premium $%.2f", contract.Premium)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return 0.0, fmt.Errorf("%s", errMsg)
	}

	if contract.DaysToExpiry < o.MinDTE {
		errMsg := fmt.Sprintf("contract DTE of %d days is below minimum required threshold of %d days", contract.DaysToExpiry, o.MinDTE)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return 0.0, fmt.Errorf("%s", errMsg)
	}

	if contract.ImpliedVolPct > o.MaxImpliedVolPct {
		errMsg := fmt.Sprintf("implied volatility %.1f%% exceeds maximum allowed IV of %.1f%%", contract.ImpliedVolPct, o.MaxImpliedVolPct)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return 0.0, fmt.Errorf("%s", errMsg)
	}

	// Percentage-based daily loss cap on total contract premium cost
	maxAllowedLoss := nominalExposure * (o.MaxDailyLossPct / 100.0)
	if projectedLossUsd > maxAllowedLoss {
		errMsg := fmt.Sprintf("projected options loss $%.2f exceeds maximum allowed percentage loss cap of $%.2f (%.1f%% of premium)", projectedLossUsd, maxAllowedLoss, o.MaxDailyLossPct)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return 0.0, fmt.Errorf("%s", errMsg)
	}

	return nominalExposure, nil
}

// RiskLimits defines portfolio-wide risk governance constraints.
type RiskLimits struct {
	MaxPositionPct  float64 // Maximum portfolio allocation percentage for a single ticker (e.g. 5.0%)
	MaxTradeUsd     float64 // Maximum dollar amount allowed for a single trade
	StopLossPct     float64 // Default stop-loss percentage (e.g. 3.0%)
	DailyLossCapUsd float64 // Maximum aggregate daily loss cap
	OptionsEnabled  bool    // Whether options trading is permitted under this risk profile
}

// DefaultRiskLimits returns sane default risk guardrails for a full-size account.
func DefaultRiskLimits(cfg *config.AppConfig) RiskLimits {
	limits := RiskLimits{
		MaxPositionPct:  5.0,
		MaxTradeUsd:     500.0,
		StopLossPct:     3.0,
		DailyLossCapUsd: 100.0,
		OptionsEnabled:  true,
	}
	if cfg != nil {
		if cfg.Risk.MaxPositionPct > 0 {
			limits.MaxPositionPct = cfg.Risk.MaxPositionPct
		}
		if cfg.Risk.DefaultStopLossPct > 0 {
			limits.StopLossPct = cfg.Risk.DefaultStopLossPct
		}
	}
	return limits
}

// TestAccountRiskLimits returns risk guardrails scaled for a small $50 paper/test account.
// Strategy logic is identical to DefaultRiskLimits — only dollar sizing is proportionally reduced.
// MaxPositionPct is raised to 20% to allow meaningful position entries on a small balance.
// Options are disabled during the test period — equities only.
func TestAccountRiskLimits(cfg *config.AppConfig) RiskLimits {
	limits := RiskLimits{
		MaxPositionPct:  20.0,  // 20% of $50 = $10 max position
		MaxTradeUsd:     10.0,  // $10 max per trade
		StopLossPct:     3.0,   // Unchanged: 3% stop-loss
		DailyLossCapUsd: 5.0,   // $5 daily loss cap (10% of account)
		OptionsEnabled:  false, // Equities only during test period
	}
	if cfg != nil {
		if cfg.Risk.MaxPositionPct > 0 {
			if cfg.Risk.MaxPositionPct > 20.0 {
				limits.MaxPositionPct = 20.0
			} else {
				limits.MaxPositionPct = cfg.Risk.MaxPositionPct
			}
		}
		if cfg.Risk.DefaultStopLossPct > 0 {
			limits.StopLossPct = cfg.Risk.DefaultStopLossPct
		}
	}
	return limits
}

// ValidateTrade evaluates a proposed trade against configured risk governance rules.
func (r RiskLimits) ValidateTrade(symbol string, amountUsd float64, portfolioTotalUsd float64) error {
	if amountUsd <= 0 {
		errMsg := fmt.Sprintf("trade amount must be positive, got $%.2f", amountUsd)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if amountUsd > r.MaxTradeUsd {
		errMsg := fmt.Sprintf("trade amount $%.2f exceeds maximum trade limit of $%.2f", amountUsd, r.MaxTradeUsd)
		notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if portfolioTotalUsd > 0 {
		positionPct := (amountUsd / portfolioTotalUsd) * 100.0
		if positionPct > r.MaxPositionPct {
			errMsg := fmt.Sprintf("proposed position size %.2f%% for %s exceeds max limit of %.2f%%", positionPct, symbol, r.MaxPositionPct)
			notify.DefaultDispatcher.Dispatch(notify.SeverityCritical, "RISK_VIOLATION", errMsg)
			return fmt.Errorf("%s", errMsg)
		}
	}

	return nil
}

// IsPreCloseWindow returns true if the current time falls within the 3:50 PM - 3:59 PM ET pre-close exit window.
func IsPreCloseWindow(t time.Time) bool {
	et := t.In(getNYLocation())
	return et.Hour() == 15 && et.Minute() >= 50
}

// AssetRiskProfile holds asset-specific intraday stop-loss and profit target guardrails.
type AssetRiskProfile struct {
	StopLossPct     float64
	TargetProfitPct float64
	AssetClass      string
}

// GetAdaptiveRiskGuardrails returns empirical intraday stop-loss and profit target levels based on asset class ATR and 15-min candle variance.
// - SPY (S&P 500): 0.35% trailing stop, 0.70% profit target (~$1.75 / ~$3.50 price movement)
// - QQQ / IWM (Nasdaq / Small-Cap ETF): 0.50% trailing stop, 1.00% profit target (~$2.25 / ~$4.50 price movement)
// - Mega-Cap Equities (AAPL, MSFT, GOOGL, AMZN): 1.00% trailing stop, 2.00% profit target
// - High-Beta Equities (NVDA, TSLA, AMD): 1.50% trailing stop, 3.00% profit target
func GetAdaptiveRiskGuardrails(symbol string, cfg *config.AppConfig) AssetRiskProfile {
	switch symbol {
	case "SPY", "VOO":
		profile := AssetRiskProfile{
			StopLossPct:     0.35,
			TargetProfitPct: 0.70,
			AssetClass:      "S&P 500 ETF (Micro-Intraday)",
		}

		if cfg != nil {
			overridden := false
			if cfg.Risk.PerSymbolStopLoss != nil {
				if stop, ok := cfg.Risk.PerSymbolStopLoss[symbol]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				} else if stop, ok := cfg.Risk.PerSymbolStopLoss[profile.AssetClass]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				}
			}
			if !overridden && cfg.Risk.DefaultStopLossPct > 0 {
				profile.StopLossPct = cfg.Risk.DefaultStopLossPct
			}
		}
		return profile
	case "QQQ", "IWM", "DIA":
		profile := AssetRiskProfile{
			StopLossPct:     0.50,
			TargetProfitPct: 1.00,
			AssetClass:      "Index ETF (Intraday)",
		}

		if cfg != nil {
			overridden := false
			if cfg.Risk.PerSymbolStopLoss != nil {
				if stop, ok := cfg.Risk.PerSymbolStopLoss[symbol]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				} else if stop, ok := cfg.Risk.PerSymbolStopLoss[profile.AssetClass]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				}
			}
			if !overridden && cfg.Risk.DefaultStopLossPct > 0 {
				profile.StopLossPct = cfg.Risk.DefaultStopLossPct
			}
		}
		return profile
	case "AAPL", "MSFT", "GOOGL", "AMZN":
		profile := AssetRiskProfile{
			StopLossPct:     1.00,
			TargetProfitPct: 2.00,
			AssetClass:      "Mega-Cap Tech",
		}

		if cfg != nil {
			overridden := false
			if cfg.Risk.PerSymbolStopLoss != nil {
				if stop, ok := cfg.Risk.PerSymbolStopLoss[symbol]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				} else if stop, ok := cfg.Risk.PerSymbolStopLoss[profile.AssetClass]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				}
			}
			if !overridden && cfg.Risk.DefaultStopLossPct > 0 {
				profile.StopLossPct = cfg.Risk.DefaultStopLossPct
			}
		}
		return profile
	default: // NVDA, TSLA, AMD, etc.
		profile := AssetRiskProfile{
			StopLossPct:     1.50,
			TargetProfitPct: 3.00,
			AssetClass:      "High-Beta Equity",
		}

		if cfg != nil {
			overridden := false
			if cfg.Risk.PerSymbolStopLoss != nil {
				if stop, ok := cfg.Risk.PerSymbolStopLoss[symbol]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				} else if stop, ok := cfg.Risk.PerSymbolStopLoss[profile.AssetClass]; ok && stop > 0 {
					profile.StopLossPct = stop
					overridden = true
				}
			}
			if !overridden && cfg.Risk.DefaultStopLossPct > 0 {
				profile.StopLossPct = cfg.Risk.DefaultStopLossPct
			}
		}
		return profile
	}
}
