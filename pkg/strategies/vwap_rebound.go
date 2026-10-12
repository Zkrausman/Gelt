package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/data"
	"time"

	"gelt/pkg/signals"
)

// VWAPReboundStrategy evaluates intraday pullback rebounds against institutional VWAP support/resistance.
type VWAPReboundStrategy struct {
	ATRStopMultiplier float64
	ATRTargetMultiplier float64
	registry          *data.FeatureRegistry
	EnableTrendFilter bool
	MinDiffPct        float64
	MaxDiffPct        float64
	EMAFastPeriod     int
	EMASlowPeriod     int
}

// NewVWAPReboundStrategy creates a new VWAP rebound strategy with default configuration.
func NewVWAPReboundStrategy() *VWAPReboundStrategy {
	return &VWAPReboundStrategy{
		EnableTrendFilter: false,
		MinDiffPct:        -0.2,
		MaxDiffPct:        0.3,
		EMAFastPeriod:     20,
		EMASlowPeriod:     50,
		ATRStopMultiplier: 0.4,
		ATRTargetMultiplier: 1.0,
	}
}

// WithTrendFilter sets whether the EMA 20/50 trend filter is enabled.
func (s *VWAPReboundStrategy) WithTrendFilter(enable bool) *VWAPReboundStrategy {
	s.EnableTrendFilter = enable
	return s
}

func (s *VWAPReboundStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// SetParams sets strategy parameters.
func (s *VWAPReboundStrategy) SetParams(params map[string]float64) {
	if v, ok := params["min_diff_pct"]; ok {
		s.MinDiffPct = v
	}
	if v, ok := params["max_diff_pct"]; ok {
		s.MaxDiffPct = v
	}
	if v, ok := params["ema_fast_period"]; ok {
		s.EMAFastPeriod = int(v)
	}
	if v, ok := params["ema_slow_period"]; ok {
		s.EMASlowPeriod = int(v)
	}
	if v, ok := params["atr_stop_multiplier"]; ok && v > 0.0 {
		s.ATRStopMultiplier = v
	}
	if v, ok := params["atr_target_multiplier"]; ok && v > 0.0 {
		s.ATRTargetMultiplier = v
	}
}

// Name returns the strategy name
func (s *VWAPReboundStrategy) Name() string {
	return "VWAPRebound"
}

// Description returns the strategy description
func (s *VWAPReboundStrategy) Description() string {
	return "Evaluates intraday pullback rebounds against institutional VWAP support and resistance levels."
}

// Evaluate evaluates the strategy against given prices and volumes
func (s *VWAPReboundStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) < 20 {
		return StrategySignal{}, fmt.Errorf("insufficient data for VWAP rebound: %d candles", len(closes))
	}

	vwap, err := signals.CalculateVWAP(closes, volumes)
	if err != nil {
		return StrategySignal{}, err
	}

	lastClose := closes[len(closes)-1]
	lastVWAP := vwap[len(vwap)-1]

	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	stopPct := (atr * s.ATRStopMultiplier / lastClose) * 100.0
	targetPct := (atr * s.ATRTargetMultiplier / lastClose) * 100.0

	diffPct := ((lastClose - lastVWAP) / lastVWAP) * 100.0

	score := 50.0
	sig := SignalHold
	rationale := fmt.Sprintf("Close: $%.2f | VWAP: $%.2f (Diff: %.2f%%)", lastClose, lastVWAP, diffPct)

	minDiff := s.MinDiffPct
	if minDiff == 0 {
		minDiff = -0.2
	}
	maxDiff := s.MaxDiffPct
	if maxDiff == 0 {
		maxDiff = 0.3
	}

	if diffPct >= minDiff && diffPct <= maxDiff {
		score = 88.0
		sig = SignalBuy
		rationale += " | Bullish VWAP Support Rebound (BUY)"
	}

	// EMA 20/50 Macro Trend Alignment Gate (evaluated only when EnableTrendFilter is true)
	fastPeriod := s.EMAFastPeriod
	if fastPeriod <= 0 {
		fastPeriod = 20
	}
	slowPeriod := s.EMASlowPeriod
	if slowPeriod <= 0 {
		slowPeriod = 50
	}

	if s.EnableTrendFilter && len(closes) >= slowPeriod && sig == SignalBuy {
		ema20, err20 := signals.EMA(closes, fastPeriod)
		ema50, err50 := signals.EMA(closes, slowPeriod)
		if err20 == nil && err50 == nil && len(ema20) > 0 && len(ema50) > 0 {
			lastEMA20 := ema20[len(ema20)-1]
			lastEMA50 := ema50[len(ema50)-1]
			if lastClose < lastEMA20 || lastEMA20 < lastEMA50 {
				sig = SignalHold
				score = 50.0
				rationale += " | Macro Downtrend Rejected (Price < EMA20 or EMA20 < EMA50)"
			}
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
func (s *VWAPReboundStrategy) CapitalRequirement() float64 {
	return 0.0
}

// VWAPStrategy is a wrapper for VWAPReboundStrategy with the name "VWAP".
type VWAPStrategy struct {
	VWAPReboundStrategy
}

// NewVWAPStrategy creates a new VWAP strategy with name "VWAP".
func NewVWAPStrategy() *VWAPStrategy {
	return &VWAPStrategy{
		VWAPReboundStrategy: *NewVWAPReboundStrategy(),
	}
}

// Name returns "VWAP"
func (s *VWAPStrategy) Name() string {
	return "VWAP"
}

// Evaluate evaluates VWAP strategy setting StrategyName to "VWAP"
func (s *VWAPStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	sig, err := s.VWAPReboundStrategy.Evaluate(ctx, evalTime, symbol, closes, volumes)
	if err != nil {
		return sig, err
	}
	sig.StrategyName = "VWAP"
	return sig, nil
}


// IsIntradayOnly returns true for VWAPReboundStrategy.
func (s *VWAPReboundStrategy) IsIntradayOnly() bool {
	return true
}

// IsIntradayOnly returns true for VWAPStrategy.
func (s *VWAPStrategy) IsIntradayOnly() bool {
	return true
}
