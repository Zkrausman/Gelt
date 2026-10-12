package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/data"
	"time"

	"gelt/pkg/signals"
)

// TrendConfluenceStrategy implements 20/50 EMA + MACD + RSI momentum trend following.
type TrendConfluenceStrategy struct {
	registry           *data.FeatureRegistry
	BuyScoreThreshold  float64
	SellScoreThreshold float64
}

// NewTrendConfluenceStrategy creates a new trend confluence strategy
func NewTrendConfluenceStrategy() *TrendConfluenceStrategy {
	return &TrendConfluenceStrategy{
		BuyScoreThreshold:  75.0,
		SellScoreThreshold: 0.0,
	}
}

func (s *TrendConfluenceStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// SetParams sets strategy parameters.
func (s *TrendConfluenceStrategy) SetParams(params map[string]float64) {
	if v, ok := params["buy_score_threshold"]; ok {
		s.BuyScoreThreshold = v
	}
	if v, ok := params["sell_score_threshold"]; ok {
		s.SellScoreThreshold = v
	}
}

// Name returns the strategy name
func (s *TrendConfluenceStrategy) Name() string {
	return "TrendConfluence"
}

// Description returns the strategy description
func (s *TrendConfluenceStrategy) Description() string {
	return "Multi-indicator momentum strategy combining 20/50 EMA trend alignment, MACD momentum, and RSI levels."
}

// Evaluate evaluates the strategy against given prices and volumes
func (s *TrendConfluenceStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	summary, err := signals.EvaluateConfluence(symbol, closes)
	if err != nil {
		return StrategySignal{}, fmt.Errorf("trend confluence evaluation failed: %w", err)
	}

	sig := SignalHold
	if summary.Bias == "BULLISH" && summary.Score >= s.BuyScoreThreshold {
		sig = SignalBuy
	} else if summary.Bias == "BEARISH" {
		// If SellScoreThreshold is 0 or less, we might ignore it or we should just check the score.
		// Actually, previously it was just if Bias == "BEARISH".
		// To allow configuring, let's say if SellScoreThreshold > 0, we use it, otherwise we just check Bias.
		if s.SellScoreThreshold > 0 {
			if summary.Score <= s.SellScoreThreshold {
				sig = SignalSell
			}
		} else {
			sig = SignalSell
		}
	}

	topSig := "Bullish Alignment"
	if len(summary.SignalsTriggered) > 0 {
		topSig = summary.SignalsTriggered[0]
	}

	rationale := fmt.Sprintf("Score: %.1f | Bias: %s | Top Signal: %s", summary.Score, summary.Bias, topSig)

	return StrategySignal{
		AssetClass:   AssetEquity,
		StrategyName: s.Name(),
		Symbol:       symbol,
		Signal:       sig,
		Score:        summary.Score,
		StopLossPct:  summary.DynamicStopPct,
		TargetPct:    summary.DynamicTargetPct,
		Rationale:    rationale,
		Timestamp:    evalTime,
	}, nil
}

// CapitalRequirement returns the strategy's capital constraint.
func (s *TrendConfluenceStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for TrendConfluenceStrategy.
func (s *TrendConfluenceStrategy) IsIntradayOnly() bool {
	return true
}
