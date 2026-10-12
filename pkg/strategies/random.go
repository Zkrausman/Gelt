package strategies

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"gelt/pkg/data"
)

// RandomStrategy implements a baseline benchmark strategy that outputs pseudo-random trade signals.
type RandomStrategy struct {
	registry *data.FeatureRegistry
}

// NewRandomStrategy creates a new Random strategy.
func NewRandomStrategy() *RandomStrategy {
	return &RandomStrategy{}
}

func (s *RandomStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

func (s *RandomStrategy) Name() string {
	return "Random"
}

func (s *RandomStrategy) Description() string {
	return "Benchmark strategy generating pseudo-random BUY/SELL/HOLD signals for baseline comparison."
}

func (s *RandomStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) == 0 {
		return StrategySignal{}, fmt.Errorf("empty closes array for Random strategy")
	}

	// Create a deterministic-per-tick pseudo-random generator based on symbol & timestamp
	seed := evalTime.UnixNano()
	for _, ch := range symbol {
		seed += int64(ch)
	}
	r := rand.New(rand.NewSource(seed))

	roll := r.Float64()
	sig := SignalHold
	score := 50.0
	action := "HOLD"

	if roll < 0.30 {
		sig = SignalBuy
		score = 75.0 + r.Float64()*15.0
		action = "BUY"
	} else if roll < 0.50 {
		sig = SignalSell
		score = 25.0 + r.Float64()*15.0
		action = "SELL"
	}

	rationale := fmt.Sprintf("Random Benchmark Evaluation (Roll: %.4f | Signal: %s)", roll, action)

	return StrategySignal{
		AssetClass:   AssetEquity,
		StrategyName: s.Name(),
		Symbol:       symbol,
		Signal:       sig,
		Score:        score,
		StopLossPct:  2.5,
		TargetPct:    5.0,
		Rationale:    rationale,
		Timestamp:    evalTime,
	}, nil
}

func (s *RandomStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for RandomStrategy.
func (s *RandomStrategy) IsIntradayOnly() bool {
	return true
}

// SetParams sets strategy parameters.
func (s *RandomStrategy) SetParams(params map[string]float64) {
	// Default implementation, overridden by specific strategies if needed.
}
