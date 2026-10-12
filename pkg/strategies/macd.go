package strategies

import (
	"context"
	"fmt"
	"math"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/signals"
)

// MACDStrategy implements pure MACD (12, 26, 9) crossover and momentum evaluation.
type MACDStrategy struct {
	ATRStopMultiplier float64
	ATRTargetMultiplier float64
	registry *data.FeatureRegistry
}

// NewMACDStrategy constructs a new MACD strategy.
func NewMACDStrategy() *MACDStrategy {
	return &MACDStrategy{
		ATRStopMultiplier: 0.5,
		ATRTargetMultiplier: 1.25,
	}
}

func (s *MACDStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

func (s *MACDStrategy) Name() string {
	return "MACD"
}

func (s *MACDStrategy) Description() string {
	return "Pure MACD (12, 26, 9) crossover and histogram momentum strategy."
}

func (s *MACDStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) < 35 {
		return StrategySignal{}, fmt.Errorf("insufficient price data for MACD strategy (%d candles, need >=35)", len(closes))
	}

	macdLine, signalLine, histogram, err := signals.MACD(closes, 12, 26, 9)
	if err != nil {
		return StrategySignal{}, fmt.Errorf("MACD calculation failed: %w", err)
	}

	lastIdx := len(closes) - 1
	mVal := macdLine[lastIdx]
	sVal := signalLine[lastIdx]
	hVal := histogram[lastIdx]

	if math.IsNaN(mVal) || math.IsNaN(sVal) || math.IsNaN(hVal) {
		return StrategySignal{}, fmt.Errorf("NaN encountered in MACD calculation")
	}

	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	lastClose := closes[lastIdx]
	stopPct := 2.0
	targetPct := 4.0
	if lastClose > 0 && atr > 0 {
		stopPct = (atr * s.ATRStopMultiplier / lastClose) * 100.0
		targetPct = (atr * s.ATRTargetMultiplier / lastClose) * 100.0
	}

	score := 50.0
	sig := SignalHold
	rationale := fmt.Sprintf("MACD: %.4f | Signal: %.4f | Hist: %.4f", mVal, sVal, hVal)

	if mVal > sVal && hVal > 0 {
		score = 85.0
		sig = SignalBuy
		rationale += " | Bullish MACD Crossover (BUY)"
	} else if mVal < sVal && hVal < 0 {
		score = 30.0
		sig = SignalSell
		rationale += " | Bearish MACD Crossover (SELL)"
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

func (s *MACDStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for MACDStrategy.
func (s *MACDStrategy) IsIntradayOnly() bool {
	return true
}

// SetParams sets strategy parameters.
func (s *MACDStrategy) SetParams(params map[string]float64) {
	if v, ok := params["atr_stop_multiplier"]; ok && v > 0.0 {
		s.ATRStopMultiplier = v
	}
	if v, ok := params["atr_target_multiplier"]; ok && v > 0.0 {
		s.ATRTargetMultiplier = v
	}
}
