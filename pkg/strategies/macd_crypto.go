package strategies

import (
	"context"
	"fmt"
	"math"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/signals"
)

// MACDCryptoStrategy implements a deterministic MACD strategy tuned for crypto using faster parameters (5, 34, 5).
type MACDCryptoStrategy struct {
	ATRStopMultiplier    float64
	ATRTargetMultiplier  float64
	AutoLiquidateAtClose bool
	registry             *data.FeatureRegistry
}

// NewMACDCryptoStrategy constructs a new MACD_Crypto strategy.
func NewMACDCryptoStrategy() *MACDCryptoStrategy {
	return &MACDCryptoStrategy{
		AutoLiquidateAtClose: false,
		ATRStopMultiplier:    0.8,
		ATRTargetMultiplier:  2.0,
	}
}

// Init stores the FeatureRegistry reference.
func (s *MACDCryptoStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// Name returns the unique strategy identifier "MACD_Crypto".
func (s *MACDCryptoStrategy) Name() string {
	return "MACD_Crypto"
}

// Description returns the strategy technical overview.
func (s *MACDCryptoStrategy) Description() string {
	return "Deterministic MACD strategy tuned for crypto using faster parameters (5, 34, 5) on a 5-minute timeframe."
}

// CapitalRequirement returns the strategy's minimum capital requirement.
func (s *MACDCryptoStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns false for 24/7 crypto markets (AutoLiquidateAtClose: false).
func (s *MACDCryptoStrategy) IsIntradayOnly() bool {
	return false
}

// Evaluate calculates MACD (5, 34, 5) crossover signals and outputs consensus confidence scores (0-100).
func (s *MACDCryptoStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) < 40 {
		return StrategySignal{}, fmt.Errorf("insufficient price data for MACD_Crypto strategy (%d candles, need >=40)", len(closes))
	}

	macdLine, signalLine, histogram, err := signals.MACD(closes, 5, 34, 5)
	if err != nil {
		return StrategySignal{}, fmt.Errorf("MACD_Crypto calculation failed: %w", err)
	}

	lastIdx := len(closes) - 1
	mVal := macdLine[lastIdx]
	sVal := signalLine[lastIdx]
	hVal := histogram[lastIdx]

	if math.IsNaN(mVal) || math.IsNaN(sVal) || math.IsNaN(hVal) {
		return StrategySignal{}, fmt.Errorf("NaN encountered in MACD_Crypto calculation")
	}

	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	lastClose := closes[lastIdx]
	stopPct := 3.5
	targetPct := 7.0
	if lastClose > 0 && atr > 0 {
		stopPct = (atr * s.ATRStopMultiplier / lastClose) * 100.0
		targetPct = (atr * s.ATRTargetMultiplier / lastClose) * 100.0
	}

	score := 50.0
	sig := SignalHold
	rationale := fmt.Sprintf("Crypto MACD (5,34,5): %.4f | Signal: %.4f | Hist: %.4f", mVal, sVal, hVal)

	if mVal > sVal && hVal > 0 {
		score = 85.0 // >= 75.0 triggers BUY
		sig = SignalBuy
		rationale += " | Bullish Crypto MACD Crossover (BUY)"
	} else if mVal < sVal && hVal < 0 {
		score = 30.0 // <= 35.0 triggers SELL
		sig = SignalSell
		rationale += " | Bearish Crypto MACD Crossover (SELL)"
	}

	return StrategySignal{
		AssetClass:   AssetCrypto,
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

// SetParams sets strategy parameters.
func (s *MACDCryptoStrategy) SetParams(params map[string]float64) {
	if v, ok := params["atr_stop_multiplier"]; ok && v > 0.0 {
		s.ATRStopMultiplier = v
	}
	if v, ok := params["atr_target_multiplier"]; ok && v > 0.0 {
		s.ATRTargetMultiplier = v
	}
}
