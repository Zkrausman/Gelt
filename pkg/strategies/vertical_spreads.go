package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/data"
	"time"

	"gelt/pkg/options"
	"gelt/pkg/risk"
	"gelt/pkg/signals"
)

// VerticalSpreadStrategy evaluates directional momentum for Vertical Debit Spreads (Bull Call, Bear Put).
type VerticalSpreadStrategy struct {
	riskProfile risk.OptionsRiskProfile
	registry    *data.FeatureRegistry
}

// NewVerticalSpreadStrategy initializes a new VerticalSpreadStrategy with default OptionsRiskProfile.
func NewVerticalSpreadStrategy() *VerticalSpreadStrategy {
	return &VerticalSpreadStrategy{
		riskProfile: risk.DefaultOptionsRiskProfile(),
	}
}

func (s *VerticalSpreadStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// Name returns the strategy name
func (s *VerticalSpreadStrategy) Name() string {
	return "VerticalSpread"
}

// Description returns the strategy description
func (s *VerticalSpreadStrategy) Description() string {
	return "Directional momentum strategy utilizing multi-leg vertical debit spreads (Bull Call, Bear Put) for strictly defined risk."
}

// Evaluate analyzes price closes/volumes and returns a StrategySignal with confidence score (0.0 to 100.0).
func (s *VerticalSpreadStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	summary, err := signals.EvaluateConfluence(symbol, closes)
	if err != nil {
		return StrategySignal{}, fmt.Errorf("vertical spread evaluation failed: %w", err)
	}

	sig := SignalHold
	score := summary.Score
	rationale := ""

	if summary.Bias == "BULLISH" || summary.Score >= 60.0 {
		sig = SignalBuy
		if score < 70.0 {
			score += 15.0
		}
		rationale = fmt.Sprintf("Bull Call Spread Setup Triggered | Score: %.1f | Bias: BULLISH", score)
	} else if summary.Bias == "BEARISH" || summary.Score <= 40.0 {
		sig = SignalSell
		if summary.Score <= 40.0 {
			score = 100.0 - summary.Score
		}
		rationale = fmt.Sprintf("Bear Put Spread Setup Triggered | Score: %.1f | Bias: BEARISH", score)
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

// EvaluateSpreadOrder evaluates a multi-leg options order for a vertical debit spread.
// Enforces that it is a net debit spread, expiration dates and types match, and passes risk profile validations.
func (s *VerticalSpreadStrategy) EvaluateSpreadOrder(longLeg, shortLeg options.OptionContract, quantity int, projectedLossUsd float64) (float64, error) {
	if longLeg.Type != shortLeg.Type {
		return 0.0, fmt.Errorf("mismatched option types: long leg is %s, short leg is %s", longLeg.Type, shortLeg.Type)
	}

	if longLeg.DaysToExpiry != shortLeg.DaysToExpiry {
		return 0.0, fmt.Errorf("mismatched expiration dates: long leg DTE %d, short leg DTE %d", longLeg.DaysToExpiry, shortLeg.DaysToExpiry)
	}

	if longLeg.Type == options.Call {
		if longLeg.Strike >= shortLeg.Strike {
			return 0.0, fmt.Errorf("invalid Bull Call Spread: long strike (%.2f) must be lower than short strike (%.2f)", longLeg.Strike, shortLeg.Strike)
		}
	} else if longLeg.Type == options.Put {
		if longLeg.Strike <= shortLeg.Strike {
			return 0.0, fmt.Errorf("invalid Bear Put Spread: long strike (%.2f) must be higher than short strike (%.2f)", longLeg.Strike, shortLeg.Strike)
		}
	} else {
		return 0.0, fmt.Errorf("unknown option type: %s", longLeg.Type)
	}

	netDebit := longLeg.Premium - shortLeg.Premium
	if netDebit <= 0 {
		return 0.0, fmt.Errorf("strategy only permits net debit spreads; calculated net debit is $%.2f (credit or zero)", netDebit)
	}

	// Create a synthetic contract to validate against the risk profile
	syntheticContract := options.OptionContract{
		Symbol:        longLeg.Symbol,
		Underlying:    longLeg.Underlying,
		Type:          longLeg.Type,
		Strike:        longLeg.Strike, // Doesn't matter much for risk check
		Premium:       netDebit,
		DaysToExpiry:  longLeg.DaysToExpiry,
		Delta:         longLeg.Delta - shortLeg.Delta,                         // Approximated net delta
		ImpliedVolPct: (longLeg.ImpliedVolPct + shortLeg.ImpliedVolPct) / 2.0, // Avg IV
	}

	nominalExposure, err := s.riskProfile.ValidateOptionsTrade(syntheticContract, quantity, projectedLossUsd)
	if err != nil {
		return 0.0, fmt.Errorf("spread risk governance rejection: %w", err)
	}

	return nominalExposure, nil
}

// CapitalRequirement returns the strategy's capital constraint.
func (s *VerticalSpreadStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for VerticalSpreadStrategy.
func (s *VerticalSpreadStrategy) IsIntradayOnly() bool {
	return true
}

// SetParams sets strategy parameters.
func (s *VerticalSpreadStrategy) SetParams(params map[string]float64) {
	// Default implementation, overridden by specific strategies if needed.
}
