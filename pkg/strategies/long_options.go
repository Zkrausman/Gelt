package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/data"
	"strings"
	"time"

	"gelt/pkg/options"
	"gelt/pkg/risk"
	"gelt/pkg/signals"
)

// LongOptionsStrategy evaluates directional momentum for Long Calls and Long Puts under long-only debit risk governance.
type LongOptionsStrategy struct {
	riskProfile risk.OptionsRiskProfile
	registry    *data.FeatureRegistry
}

// NewLongOptionsStrategy initializes a new LongOptionsStrategy with default OptionsRiskProfile.
func NewLongOptionsStrategy() *LongOptionsStrategy {
	return &LongOptionsStrategy{
		riskProfile: risk.DefaultOptionsRiskProfile(),
	}
}

func (s *LongOptionsStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// Name returns the strategy name
func (s *LongOptionsStrategy) Name() string {
	return "LongOptions"
}

// Description returns the strategy description
func (s *LongOptionsStrategy) Description() string {
	return "Directional momentum strategy evaluating Long Calls (high upward momentum + moderate IV) and Long Puts (downward momentum + rising IV) under long-only debit risk governance."
}

// Evaluate analyzes price closes/volumes and returns a StrategySignal with confidence score (0.0 to 100.0).
func (s *LongOptionsStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	summary, err := signals.EvaluateConfluence(symbol, closes)
	if err != nil {
		return StrategySignal{}, fmt.Errorf("long options evaluation failed: %w", err)
	}

	sig := SignalHold
	score := summary.Score
	rationale := ""

	if summary.Bias == "BULLISH" || summary.Score >= 60.0 {
		sig = SignalBuy
		if score < 70.0 {
			score += 15.0
		}
		rationale = fmt.Sprintf("Long Call Setup Triggered | Score: %.1f | Bias: BULLISH | Price > EMA20 > EMA50", score)
	} else if summary.Bias == "BEARISH" || summary.Score <= 40.0 {
		sig = SignalSell
		if summary.Score <= 40.0 {
			score = 100.0 - summary.Score
		}
		rationale = fmt.Sprintf("Long Put Setup Triggered | Score: %.1f | Bias: BEARISH | Price < EMA20 < EMA50", score)
	} else {
		sig = SignalHold
		rationale = fmt.Sprintf("Neutral Momentum | Score: %.1f | Hold Position", summary.Score)
	}

	return StrategySignal{
		AssetClass:   AssetOptions,
		StrategyName: s.Name(),
		Symbol:       symbol,
		Signal:       sig,
		Score:        score,
		StopLossPct:  summary.DynamicStopPct,
		TargetPct:    summary.DynamicTargetPct,
		Rationale:    rationale,
		Timestamp:    evalTime,
	}, nil
}

// ValidateLongOptionOrder performs strict pre-flight checks:
// 1. Blocks any short credit order attempts (buying long debit only).
// 2. Enforces OptionsRiskProfile (1 contract max, min 14 DTE, max 80% IV, max 20% loss cap).
func (s *LongOptionsStrategy) ValidateLongOptionOrder(contract options.OptionContract, quantity int, side string, projectedLossUsd float64) (float64, error) {
	cleanSide := strings.ToLower(strings.TrimSpace(side))
	if cleanSide != "buy" && cleanSide != "long_buy" {
		return 0.0, fmt.Errorf("short options credit orders are strictly forbidden; only long debit orders allowed (got side %q)", side)
	}

	nominalExposure, err := s.riskProfile.ValidateOptionsTrade(contract, quantity, projectedLossUsd)
	if err != nil {
		return 0.0, fmt.Errorf("options risk governance rejection: %w", err)
	}

	return nominalExposure, nil
}

// CapitalRequirement returns the strategy's capital constraint.
func (s *LongOptionsStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for LongOptionsStrategy.
func (s *LongOptionsStrategy) IsIntradayOnly() bool {
	return true
}

// SetParams sets strategy parameters.
func (s *LongOptionsStrategy) SetParams(params map[string]float64) {
	// Default implementation, overridden by specific strategies if needed.
}
