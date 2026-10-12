package strategies

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/signals"
)

// RandomCryptoStrategy implements a lightweight statistical control module for crypto shadow testing.
type RandomCryptoStrategy struct {
	ATRStopMultiplier    float64
	ATRTargetMultiplier  float64
	AutoLiquidateAtClose bool
	registry             *data.FeatureRegistry
	BuyThreshold         float64
	SellThreshold        float64
}

// NewRandomCryptoStrategy constructs a new Random_Crypto strategy.
func NewRandomCryptoStrategy() *RandomCryptoStrategy {
	return &RandomCryptoStrategy{
		AutoLiquidateAtClose: false,
		BuyThreshold:         75.0,
		SellThreshold:        35.0,
		ATRStopMultiplier:    0.8,
		ATRTargetMultiplier:  2.0,
	}
}

// Init stores the FeatureRegistry reference.
func (s *RandomCryptoStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// Name returns the strategy name "Random_Crypto".
func (s *RandomCryptoStrategy) Name() string {
	return "Random_Crypto"
}

// Description returns the strategy description.
func (s *RandomCryptoStrategy) Description() string {
	return "Lightweight statistical control module generating randomized scores (0-100) for crypto shadow testing."
}

// CapitalRequirement returns the strategy's minimum capital requirement.
func (s *RandomCryptoStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns false for 24/7 crypto markets (AutoLiquidateAtClose: false).
func (s *RandomCryptoStrategy) IsIntradayOnly() bool {
	return false
}

// Evaluate generates a randomized score (0.0-100.0) mapped to BUY (>=75.0), SELL (<=35.0), or HOLD.
func (s *RandomCryptoStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) == 0 {
		return StrategySignal{}, fmt.Errorf("empty closes array for Random_Crypto strategy")
	}

	seed := evalTime.UnixNano()
	for _, ch := range symbol {
		seed += int64(ch)
	}
	r := rand.New(rand.NewSource(seed))

	score := r.Float64() * 100.0
	sig := SignalHold
	action := "HOLD"

	if score >= s.BuyThreshold {
		sig = SignalBuy
		action = "BUY"
	} else if score <= s.SellThreshold {
		sig = SignalSell
		action = "SELL"
	}

	rationale := fmt.Sprintf("Random Crypto Control Evaluation (Score: %.2f | Signal: %s)", score, action)

	stopPct := 3.5
	targetPct := 7.0
	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	lastClose := closes[len(closes)-1]
	if lastClose > 0 && atr > 0 {
		stopPct = (atr * s.ATRStopMultiplier / lastClose) * 100.0
		targetPct = (atr * s.ATRTargetMultiplier / lastClose) * 100.0
	}

	return StrategySignal{
		AssetClass:   AssetCrypto,
		StrategyName: s.Name(),
		Symbol:       symbol,
		Signal:       sig,
		Score:        score,
		StopLossPct:  stopPct,
		TargetPct:    targetPct,

		Rationale: rationale,
		Timestamp: evalTime,
	}, nil
}

// SetParams sets strategy parameters.
func (s *RandomCryptoStrategy) SetParams(params map[string]float64) {
	if val, ok := params["BuyThreshold"]; ok && val > 0.0 {
		s.BuyThreshold = val
	} else if val, ok := params["buy_threshold"]; ok && val > 0.0 {
		s.BuyThreshold = val
	}
	if val, ok := params["SellThreshold"]; ok && val > 0.0 {
		s.SellThreshold = val
	} else if val, ok := params["sell_threshold"]; ok && val > 0.0 {
		s.SellThreshold = val
	}
	if val, ok := params["atr_stop_multiplier"]; ok && val > 0.0 {
		s.ATRStopMultiplier = val
	}
	if val, ok := params["atr_target_multiplier"]; ok && val > 0.0 {
		s.ATRTargetMultiplier = val
	}
}
