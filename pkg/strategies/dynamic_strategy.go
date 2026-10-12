package strategies

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gelt/pkg/data"
)

// DynamicStrategy implements the Strategy interface based on a flexible, data-driven definition.
type DynamicStrategy struct {
	Def      DynamicStrategyDefinition
	registry *data.FeatureRegistry
}

// NewDynamicStrategy creates a new executable strategy from a schema definition.
func NewDynamicStrategy(def DynamicStrategyDefinition) *DynamicStrategy {
	return &DynamicStrategy{
		Def: def,
	}
}

// Name returns the strategy name configured in the definition.
func (s *DynamicStrategy) Name() string {
	return s.Def.Name
}

// Description returns the strategy description.
func (s *DynamicStrategy) Description() string {
	return s.Def.Description
}

// Init stores the FeatureRegistry for querying data during evaluation.
func (s *DynamicStrategy) Init(registry *data.FeatureRegistry) error {
	if registry == nil {
		return fmt.Errorf("feature registry cannot be nil")
	}
	s.registry = registry
	return nil
}

// Evaluate queries the FeatureRegistry for each condition and evaluates rules.
func (s *DynamicStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if s.registry == nil {
		return StrategySignal{}, fmt.Errorf("strategy %q not initialized with FeatureRegistry", s.Name())
	}

	if err := s.Def.Validate(); err != nil {
		return StrategySignal{}, fmt.Errorf("invalid strategy definition: %w", err)
	}

	var matchCount int
	var rationales []string

	for _, cond := range s.Def.Conditions {
		req := data.FeatureRequest{
			FeatureKey: cond.FeatureKey,
			Start:      evalTime,
			End:        evalTime,
			Resolution: 24 * time.Hour, // Use default or daily
		}

		pts, err := s.registry.Query(ctx, req)
		if err != nil {
			return StrategySignal{}, fmt.Errorf("failed to query feature %s: %w", cond.FeatureKey, err)
		}

		if len(pts) == 0 {
			// No data available for this feature, cannot evaluate condition
			rationales = append(rationales, fmt.Sprintf("no data for %s", cond.FeatureKey))
			continue
		}

		// Use the latest point returned
		latest := pts[len(pts)-1].Value
		matched := false

		switch cond.Operator {
		case OpGreaterThan:
			matched = latest > cond.Threshold
		case OpLessThan:
			matched = latest < cond.Threshold
		case OpEquals:
			matched = latest == cond.Threshold
		case OpGreaterThanOrEqual:
			matched = latest >= cond.Threshold
		case OpLessThanOrEqual:
			matched = latest <= cond.Threshold
		case OpNotEquals:
			matched = latest != cond.Threshold
		}

		if matched {
			matchCount++
			rationales = append(rationales, fmt.Sprintf("%s(%.2f) %s %.2f", cond.FeatureKey, latest, cond.Operator, cond.Threshold))
		} else {
			rationales = append(rationales, fmt.Sprintf("%s(%.2f) NOT %s %.2f", cond.FeatureKey, latest, cond.Operator, cond.Threshold))
		}
	}

	var finalMatch bool
	if s.Def.LogicalOp == LogOpOr {
		finalMatch = matchCount > 0
	} else {
		// LogOpAnd or undefined (default to AND)
		finalMatch = matchCount == len(s.Def.Conditions)
	}

	sig := SignalHold
	if finalMatch {
		sig = s.Def.Signal
	}

	rationale := strings.Join(rationales, " | ")
	if rationale == "" {
		rationale = "no conditions evaluated"
	}

	return StrategySignal{
		AssetClass:    AssetEquity,
		StrategyName:  s.Name(),
		Symbol:        symbol,
		Signal:        sig,
		Score:         0.0, // Dynamic strategies don't inherently have a 0-100 score unless calculated
		StopLossPct:   0.0, // Not defined in schema
		TargetPct:     0.0, // Not defined in schema
		Rationale:     rationale,
		BuyThreshold:  s.Def.BuyThreshold,
		SellThreshold: s.Def.SellThreshold,
		Timestamp:     evalTime,
	}, nil
}

// CapitalRequirement returns the strategy's capital constraint.
func (s *DynamicStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true if the dynamic strategy is marked as intraday only.
func (s *DynamicStrategy) IsIntradayOnly() bool {
	return s.Def.IntradayOnly
}

// SetParams sets strategy parameters.
func (s *DynamicStrategy) SetParams(params map[string]float64) {
	// Default implementation, overridden by specific strategies if needed.
}
