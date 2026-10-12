package strategies

import (
	"fmt"

	"gelt/pkg/signals"
)

// ATRChopFilter enforces a minimum volatility bound to prevent mean-reversion
// strategies from generating signals during low-volatility chop conditions.
type ATRChopFilter struct {
	ThresholdPct float64 // Configurable baseline volatility (e.g., 1.5% = 0.015)
	Period       int     // Lookback period for ATR (default 14)
}

// NewATRChopFilter creates a new ATR volatility circuit breaker.
// Defaults to 1.5% threshold if <= 0 is passed.
func NewATRChopFilter(thresholdPct float64, period int) *ATRChopFilter {
	if thresholdPct <= 0 {
		thresholdPct = 0.015
	}
	if period == 0 {
		period = 14
	}
	return &ATRChopFilter{
		ThresholdPct: thresholdPct,
		Period:       period,
	}
}

// IsChop returns true if the current volatility is below the threshold,
// indicating a chop condition where mean-reversion trades should be blocked.
func (f *ATRChopFilter) IsChop(closes []float64) (bool, error) {
	if len(closes) < f.Period {
		return false, fmt.Errorf("insufficient price data for ATR filter: %d candles", len(closes))
	}

	atr, err := signals.CalculateATRFromCloses(closes, f.Period)
	if err != nil {
		return false, err
	}

	lastClose := closes[len(closes)-1]
	if lastClose <= 0 {
		return false, fmt.Errorf("invalid close price: %f", lastClose)
	}

	volatilityRatio := atr / lastClose

	// Mathematical Constraint: ATR / Close < Threshold
	if volatilityRatio < f.ThresholdPct {
		return true, nil // Chop detected, block signal
	}

	return false, nil // Volatility is high enough, allow signal
}

// IsVolatilityChop evaluates whether current volatility is below the configurable baseline threshold.
// It returns true if the market is in low-volatility "chop", meaning mean-reversion signals should be paused.
// minVolatilityPct is passed as a percentage (e.g. 1.5 for 1.5%).
func IsVolatilityChop(closes []float64, atrPeriod int, minVolatilityPct float64) bool {
	if minVolatilityPct <= 0 {
		minVolatilityPct = 1.5
	}
	filter := NewATRChopFilter(minVolatilityPct/100.0, atrPeriod)
	isChop, err := filter.IsChop(closes)
	if err != nil {
		return false
	}
	return isChop
}
