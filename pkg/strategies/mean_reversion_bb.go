package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/data"
	"time"

	"gelt/pkg/signals"
)

// MeanReversionBBStrategy identifies oversold and overbought conditions using Bollinger Bands.
type MeanReversionBBStrategy struct {
	registry *data.FeatureRegistry
}

// NewMeanReversionBBStrategy creates a new Bollinger Bands mean reversion strategy
func NewMeanReversionBBStrategy() *MeanReversionBBStrategy {
	return &MeanReversionBBStrategy{}
}

func (s *MeanReversionBBStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// Name returns the strategy name
func (s *MeanReversionBBStrategy) Name() string {
	return "MeanReversionBB"
}

// Description returns the strategy description
func (s *MeanReversionBBStrategy) Description() string {
	return "Identifies mean-reversion opportunities using 20-period Bollinger Bands (SMA +/- 2.0 StdDev)."
}

// Evaluate evaluates the strategy against given prices and volumes
func (s *MeanReversionBBStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) < 20 {
		return StrategySignal{}, fmt.Errorf("insufficient data for mean reversion bb strategy: %d candles", len(closes))
	}

	upper, _, lower, err := signals.BollingerBands(closes, 20, 2.0)
	if err != nil {
		return StrategySignal{}, err
	}

	lastClose := closes[len(closes)-1]
	lowerBand := lower[len(lower)-1]
	upperBand := upper[len(upper)-1]

	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	stopPct := (atr * 0.5 / lastClose) * 100.0
	targetPct := (atr * 1.5 / lastClose) * 100.0

	score := 50.0
	sig := SignalHold
	rationale := fmt.Sprintf("Close: $%.2f | LowerBand: $%.2f | UpperBand: $%.2f", lastClose, lowerBand, upperBand)

	if lastClose <= lowerBand {
		score = 85.0
		if !IsVolatilityChop(closes, 14, 1.5) {
			sig = SignalBuy
			rationale += " | Oversold Rebound (Price <= Lower Band)"
		} else {
			sig = SignalHold
			rationale += " | Blocked: Low Volatility Chop (ATR < 1.5%)"
		}
	} else if lastClose >= upperBand {
		score = 85.0
		if !IsVolatilityChop(closes, 14, 1.5) {
			sig = SignalSell
			rationale += " | Overbought Exhaustion (Price >= Upper Band)"
		} else {
			sig = SignalHold
			rationale += " | Blocked: Low Volatility Chop (ATR < 1.5%)"
		}
	}

	return StrategySignal{
		AssetClass:   AssetEquity,
		StrategyName: s.Name(),
		Symbol:       symbol,
		Signal:       sig,
		Score:        score,
		StopLossPct:  stopPct,
		TargetPct:    targetPct,
		Rationale:    rationale,
		Timestamp:    evalTime,
	}, nil
}

// CapitalRequirement returns the strategy's capital constraint.
func (s *MeanReversionBBStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for MeanReversionBBStrategy.
func (s *MeanReversionBBStrategy) IsIntradayOnly() bool {
	return true
}

// SetParams sets strategy parameters.
func (s *MeanReversionBBStrategy) SetParams(params map[string]float64) {
	// Default implementation, overridden by specific strategies if needed.
}
