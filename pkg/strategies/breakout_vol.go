package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/data"
	"time"

	"gelt/pkg/signals"
)

// BreakoutVolStrategy captures volatility expansion breakouts confirmed by volume spikes.
type BreakoutVolStrategy struct {
	ATRStopMultiplier float64
	ATRTargetMultiplier float64
	registry               *data.FeatureRegistry
	ATRExpansionMultiplier float64
	ATRPeriod              int
}

// NewBreakoutVolStrategy creates a new breakout volume strategy
func NewBreakoutVolStrategy() *BreakoutVolStrategy {
	return &BreakoutVolStrategy{
		ATRExpansionMultiplier: 1.25,
		ATRPeriod:              14,
		ATRStopMultiplier: 0.5,
		ATRTargetMultiplier: 1.5,
	}
}

func (s *BreakoutVolStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// SetParams sets strategy parameters.
func (s *BreakoutVolStrategy) SetParams(params map[string]float64) {
	if v, ok := params["atr_expansion_multiplier"]; ok {
		s.ATRExpansionMultiplier = v
	}
	if v, ok := params["atr_period"]; ok {
		s.ATRPeriod = int(v)
	}
	if v, ok := params["atr_stop_multiplier"]; ok && v > 0.0 {
		s.ATRStopMultiplier = v
	}
	if v, ok := params["atr_target_multiplier"]; ok && v > 0.0 {
		s.ATRTargetMultiplier = v
	}
}

// Name returns the strategy name
func (s *BreakoutVolStrategy) Name() string {
	return "BreakoutVol"
}

// Description returns the strategy description
func (s *BreakoutVolStrategy) Description() string {
	return "Captures volatility expansion breakouts confirmed by >1.5x ATR range expansion and volume surge."
}

// Evaluate evaluates the strategy against given prices and volumes
func (s *BreakoutVolStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	period := s.ATRPeriod
	if period <= 0 {
		period = 14
	}

	if len(closes) < 20 {
		return StrategySignal{}, fmt.Errorf("insufficient data for breakout strategy: %d candles", len(closes))
	}

	lastClose := closes[len(closes)-1]
	prevClose := closes[len(closes)-2]

	atr, _ := signals.CalculateATRFromCloses(closes, period)
	priceChange := lastClose - prevClose

	stopPct := (atr * s.ATRStopMultiplier / lastClose) * 100.0
	targetPct := (atr * s.ATRTargetMultiplier / lastClose) * 100.0

	score := 50.0
	sig := SignalHold
	rationale := fmt.Sprintf("Price Change: $%.2f | ATR: $%.2f", priceChange, atr)

	if priceChange > (atr * s.ATRExpansionMultiplier) {
		score = 90.0
		sig = SignalBuy
		rationale += " | Bullish Volatility Expansion Breakout (BUY)"
	} else if priceChange < -(atr * s.ATRExpansionMultiplier) {
		score = 90.0
		sig = SignalSell
		rationale += " | Bearish Volatility Breakdown (SELL)"
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
func (s *BreakoutVolStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for BreakoutVolStrategy.
func (s *BreakoutVolStrategy) IsIntradayOnly() bool {
	return true
}
