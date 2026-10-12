// Package options provides options contract evaluation and risk guardrails for Gelt.
package options

import (
	"fmt"
)

// OptionType defines Call or Put options.
type OptionType string

// Call represents a call option
const Call OptionType = "CALL"

// Put represents a put option
const Put OptionType = "PUT"

// OptionContract represents an equity options contract.
type OptionContract struct {
	Symbol        string
	Underlying    string
	Type          OptionType
	Strike        float64
	Premium       float64 // Premium price per share (e.g. $2.50 = $250 total per contract)
	DaysToExpiry  int     // DTE (Days To Expiration)
	Delta         float64 // Delta (0.0 to 1.0 for Calls, -1.0 to 0.0 for Puts)
	ImpliedVolPct float64 // Implied Volatility percentage (e.g. 35.0%)
}

// OptionsRiskLimits defines governance constraints specifically for options trades.
type OptionsRiskLimits struct {
	MaxContractPremiumUsd float64 // Maximum total dollar cost for a single contract (e.g. $200.00)
	MinDTE                int     // Minimum Days To Expiration allowed (e.g. 14 DTE to avoid 0DTE decay)
	MaxContractsPerTrade  int     // Maximum contract volume per order (e.g. 2 contracts)
	MaxImpliedVolPct      float64 // Maximum IV limit to avoid buying extreme IV crush options (e.g. 80.0%)
}

// DefaultOptionsRiskLimits returns safe default options guardrails for a full-size account.
func DefaultOptionsRiskLimits() OptionsRiskLimits {
	return OptionsRiskLimits{
		MaxContractPremiumUsd: 200.0,
		MinDTE:                14,
		MaxContractsPerTrade:  2,
		MaxImpliedVolPct:      80.0,
	}
}

// TestAccountOptionsRiskLimits returns options guardrails scaled for a $50 paper/test account.
// Strategy logic is identical to DefaultOptionsRiskLimits — only dollar sizing is reduced.
func TestAccountOptionsRiskLimits() OptionsRiskLimits {
	return OptionsRiskLimits{
		MaxContractPremiumUsd: 10.0, // $10 max total contract cost (e.g. $0.10 premium x 100 shares)
		MinDTE:                14,   // Unchanged: avoid short-dated decay
		MaxContractsPerTrade:  1,    // 1 contract max per trade
		MaxImpliedVolPct:      80.0, // Unchanged: avoid IV crush
	}
}

// ValidateOptionTrade checks an option contract against risk governance rules.
func (o OptionsRiskLimits) ValidateOptionTrade(contract OptionContract, quantity int) error {
	if quantity <= 0 {
		return fmt.Errorf("contract quantity must be positive, got %d", quantity)
	}

	if quantity > o.MaxContractsPerTrade {
		return fmt.Errorf("requested quantity %d contracts exceeds max allowed of %d", quantity, o.MaxContractsPerTrade)
	}

	totalCost := contract.Premium * 100.0 * float64(quantity)
	if totalCost > o.MaxContractPremiumUsd {
		return fmt.Errorf("total contract cost $%.2f exceeds maximum limit of $%.2f", totalCost, o.MaxContractPremiumUsd)
	}

	if contract.DaysToExpiry < o.MinDTE {
		return fmt.Errorf("contract DTE of %d days is below minimum required threshold of %d days", contract.DaysToExpiry, o.MinDTE)
	}

	if contract.ImpliedVolPct > o.MaxImpliedVolPct {
		return fmt.Errorf("implied volatility %.1f%% exceeds maximum allowed IV of %.1f%%", contract.ImpliedVolPct, o.MaxImpliedVolPct)
	}

	return nil
}
