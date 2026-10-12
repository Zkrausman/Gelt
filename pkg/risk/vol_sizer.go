package risk

import "math"

// CalculateVolAdjustedSize calculates a dynamic volatility-adjusted position size.
// It scales the base size inversely to ATR expansion. If currentATR doubles relative to
// baselineATR, the position size is cut by 50%.
// It also ensures that the total risk (assuming loss = currentATR * size) never exceeds maxLossCap.
func CalculateVolAdjustedSize(baseSize int, currentATR float64, baselineATR float64, maxLossCap float64) int {
	if currentATR <= 0 || baselineATR <= 0 || maxLossCap <= 0 || baseSize <= 0 {
		return 0
	}

	// Calculate volatility ratio.
	// E.g., if baseline is 1.0 and current is 2.0, the ratio is 0.5.
	volRatio := baselineATR / currentATR

	// Scale base size based on volatility expansion.
	adjustedSizeFloat := float64(baseSize) * volRatio

	// Determine the maximum size allowed based on the risk limit.
	// This ensures the size * currentATR never breaches maxLossCap.
	maxAllowedSizeFloat := maxLossCap / currentATR

	// The final size is the minimum of the volatility-adjusted size and the risk-capped size.
	finalSizeFloat := math.Min(adjustedSizeFloat, maxAllowedSizeFloat)

	// Round down to the nearest integer to ensure we do not exceed caps.
	finalSize := int(math.Floor(finalSizeFloat))

	if finalSize < 0 {
		return 0
	}
	return finalSize
}
