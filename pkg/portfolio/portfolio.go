// Package portfolio provides asset correlation analysis, trailing stop evaluation, and portfolio-level risk metrics for Gelt.
package portfolio

import (
	"fmt"
	"math"
)

// Position represents an active portfolio holding.
type Position struct {
	Symbol          string  `json:"symbol"`
	Quantity        float64 `json:"quantity"`
	AverageBuyPrice float64 `json:"average_buy_price"`
	CurrentPrice    float64 `json:"current_price"`
	PeakPrice       float64 `json:"peak_price"`
}

// ExitSignal describes a recommended position exit triggered by trailing stop or profit target rules.
type ExitSignal struct {
	Symbol       string  `json:"symbol"`
	ShouldExit   bool    `json:"should_exit"`
	Reason       string  `json:"reason"` // "TRAILING_STOP_BREACH", "PROFIT_TARGET_REACHED"
	CurrentPrice float64 `json:"current_price"`
	TriggerPrice float64 `json:"trigger_price"`
	PnLPct       float64 `json:"pnl_pct"`
}

// CheckTrailingStop evaluates a position against a trailing stop loss percentage (e.g., 3.0%).
func CheckTrailingStop(p Position, stopLossPct float64) ExitSignal {
	if p.AverageBuyPrice <= 0 || p.CurrentPrice <= 0 {
		return ExitSignal{Symbol: p.Symbol, ShouldExit: false, Reason: "Invalid Price Data"}
	}

	peak := p.PeakPrice
	if peak < p.AverageBuyPrice {
		peak = p.AverageBuyPrice
	}
	if p.CurrentPrice > peak {
		peak = p.CurrentPrice
	}

	triggerPrice := peak * (1.0 - (stopLossPct / 100.0))
	pnlPct := ((p.CurrentPrice - p.AverageBuyPrice) / p.AverageBuyPrice) * 100.0

	if p.CurrentPrice <= triggerPrice {
		return ExitSignal{
			Symbol:       p.Symbol,
			ShouldExit:   true,
			Reason:       fmt.Sprintf("Trailing Stop Breached (Price $%.2f <= Trigger $%.2f)", p.CurrentPrice, triggerPrice),
			CurrentPrice: p.CurrentPrice,
			TriggerPrice: triggerPrice,
			PnLPct:       pnlPct,
		}
	}

	return ExitSignal{
		Symbol:       p.Symbol,
		ShouldExit:   false,
		Reason:       "Position Within Safe Bounds",
		CurrentPrice: p.CurrentPrice,
		TriggerPrice: triggerPrice,
		PnLPct:       pnlPct,
	}
}

// CalculatePearsonCorrelation computes Pearson correlation coefficient between two price return series (-1.0 to 1.0).
func CalculatePearsonCorrelation(returnsA, returnsB []float64) (float64, error) {
	if len(returnsA) != len(returnsB) || len(returnsA) < 2 {
		return 0.0, fmt.Errorf("returns series length mismatch or insufficient data")
	}

	n := float64(len(returnsA))
	var sumA, sumB, sumA2, sumB2, sumAB float64

	for i := 0; i < len(returnsA); i++ {
		a := returnsA[i]
		b := returnsB[i]
		sumA += a
		sumB += b
		sumA2 += a * a
		sumB2 += b * b
		sumAB += a * b
	}

	num := (n * sumAB) - (sumA * sumB)
	den := math.Sqrt(((n * sumA2) - (sumA * sumA)) * ((n * sumB2) - (sumB * sumB)))

	if den == 0 {
		return 0.0, nil
	}

	return num / den, nil
}
