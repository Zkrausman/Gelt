// Package regime provides passive market regime detection and telemetry alerts for Gelt.
package regime

import (
	"fmt"
	"math"

	"gelt/pkg/signals"
)

// MarketRegime identifies market volatility and trend classifications.
type MarketRegime string

// RegimeTrendingNormal represents a normal trending market state
const RegimeTrendingNormal MarketRegime = "Trending Normal"

// RegimeHighVolatility represents a highly volatile market state
const RegimeHighVolatility MarketRegime = "High Volatility"

// RegimeStatus contains indicator levels, detected regime, and alert messages.
type RegimeStatus struct {
	VIXValue        float64      `json:"vix_value"`
	EMA20Slope      float64      `json:"ema_20_slope"`
	DetectedRegime  MarketRegime `json:"detected_regime"`
	AlertTriggered  bool         `json:"alert_triggered"`
	AlertMessage    string       `json:"alert_message"`
	RecommendedPlan string       `json:"recommended_plan"`
}

// CalculateEMASlope computes the 20-period EMA slope over the last price bar.
func CalculateEMASlope(closes []float64, period int) (float64, error) {
	if len(closes) < period+1 {
		return 0.0, fmt.Errorf("insufficient data points (%d) for EMA %d slope calculation", len(closes), period)
	}

	emaSlice, err := signals.EMA(closes, period)
	if err != nil {
		return 0.0, fmt.Errorf("EMA calculation failed: %w", err)
	}

	if len(emaSlice) < 2 {
		return 0.0, fmt.Errorf("insufficient EMA data points for slope")
	}

	latestEMA := emaSlice[len(emaSlice)-1]
	prevEMA := emaSlice[len(emaSlice)-2]

	if math.IsNaN(latestEMA) || math.IsNaN(prevEMA) {
		return 0.0, fmt.Errorf("EMA calculation returned NaN values")
	}

	slope := latestEMA - prevEMA
	return slope, nil
}

// EvaluateRegime checks VIX volatility and 20-period EMA slope to detect market regime.
func EvaluateRegime(vix float64, closes []float64) (*RegimeStatus, error) {
	slope, err := CalculateEMASlope(closes, 20)
	if err != nil {
		return nil, fmt.Errorf("regime evaluation failed: %w", err)
	}

	isChop := (vix > 25.0) || (slope <= 0.0)

	status := &RegimeStatus{
		VIXValue:       vix,
		EMA20Slope:     slope,
		DetectedRegime: RegimeTrendingNormal,
		AlertTriggered: false,
	}

	if isChop {
		status.DetectedRegime = RegimeHighVolatility
		status.AlertTriggered = true
		status.RecommendedPlan = "RangeBoundDefensivePlan"
		status.AlertMessage = "[REGIME ALERT] High Volatility Detected (VIX > 25 / EMA Negative). Recommended Action: Switch to RangeBoundDefensivePlan."
	}

	return status, nil
}
