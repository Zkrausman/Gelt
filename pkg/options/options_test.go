package options

import (
	"testing"
)

func TestValidateOptionTrade(t *testing.T) {
	limits := DefaultOptionsRiskLimits()

	// Test valid option trade
	validContract := OptionContract{
		Symbol:        "AAPL260821C00200000",
		Underlying:    "AAPL",
		Type:          Call,
		Strike:        200.0,
		Premium:       1.50, // $150 total cost
		DaysToExpiry:  30,
		Delta:         0.45,
		ImpliedVolPct: 25.0,
	}

	err := limits.ValidateOptionTrade(validContract, 1)
	if err != nil {
		t.Fatalf("expected valid option trade, got error: %v", err)
	}

	// Test short DTE failure (e.g. 0DTE or 5 DTE < 14 DTE limit)
	shortDTEContract := validContract
	shortDTEContract.DaysToExpiry = 5
	err = limits.ValidateOptionTrade(shortDTEContract, 1)
	if err == nil {
		t.Fatalf("expected error for DTE < 14, got nil")
	}

	// Test high premium failure ($2.50 * 100 = $250 > $200 limit)
	expensiveContract := validContract
	expensiveContract.Premium = 2.50
	err = limits.ValidateOptionTrade(expensiveContract, 1)
	if err == nil {
		t.Fatalf("expected error for premium > $200, got nil")
	}
}
