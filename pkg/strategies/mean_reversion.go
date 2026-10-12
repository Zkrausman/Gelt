package strategies

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/signals"
)

// MeanReversionStrategy implements Bollinger Band lower-band bounce and RSI oversold reversal logic.
type MeanReversionStrategy struct {
	ATRStopMultiplier float64
	ATRTargetMultiplier float64
	registry        *data.FeatureRegistry
	chopFilter      *ATRChopFilter
	logger          *slog.Logger
	RSIOversold     float64
	RSIOverbought   float64
	BollingerPeriod int
	BollingerStdDev float64
}

// NewMeanReversionStrategy creates a new mean reversion strategy
func NewMeanReversionStrategy() *MeanReversionStrategy {
	return &MeanReversionStrategy{
		chopFilter:      NewATRChopFilter(0.015, 14),
		logger:          slog.Default(),
		RSIOversold:     35.0,
		RSIOverbought:   65.0,
		BollingerPeriod: 20,
		BollingerStdDev: 2.0,
	}
}

func (s *MeanReversionStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// SetParams sets strategy parameters.
func (s *MeanReversionStrategy) SetParams(params map[string]float64) {
	if v, ok := params["rsi_oversold"]; ok {
		s.RSIOversold = v
	}
	if v, ok := params["rsi_overbought"]; ok {
		s.RSIOverbought = v
	}
	if v, ok := params["bollinger_period"]; ok {
		s.BollingerPeriod = int(v)
	}
	if v, ok := params["bollinger_std_dev"]; ok {
		s.BollingerStdDev = v
	}
	if v, ok := params["atr_stop_multiplier"]; ok && v > 0.0 {
		s.ATRStopMultiplier = v
	}
	if v, ok := params["atr_target_multiplier"]; ok && v > 0.0 {
		s.ATRTargetMultiplier = v
	}
}

// Name returns the strategy name
func (s *MeanReversionStrategy) Name() string {
	return "MeanReversion"
}

// Description returns the strategy description
func (s *MeanReversionStrategy) Description() string {
	return "Identifies oversold bounce opportunities using Bollinger Bands (Lower Band touch) and RSI < 35."
}

// Evaluate evaluates the strategy against given prices and volumes
func (s *MeanReversionStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	period := s.BollingerPeriod
	if period <= 0 {
		period = 20
	}

	if len(closes) < period {
		return StrategySignal{}, fmt.Errorf("insufficient price data for mean reversion: %d candles", len(closes))
	}

	upper, _, lower, err := signals.BollingerBands(closes, period, s.BollingerStdDev)
	if err != nil {
		return StrategySignal{}, err
	}

	rsiValues, err := signals.RSI(closes, 14)
	if err != nil {
		return StrategySignal{}, err
	}

	lastClose := closes[len(closes)-1]
	lastRSI := rsiValues[len(rsiValues)-1]
	lowerBand := lower[len(lower)-1]
	upperBand := upper[len(upper)-1]

	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	stopPct := (atr * s.ATRStopMultiplier / lastClose) * 100.0
	targetPct := (atr * s.ATRTargetMultiplier / lastClose) * 100.0

	score := 50.0
	sig := SignalHold
	rationale := fmt.Sprintf("Close: $%.2f | LowerBand: $%.2f | RSI: %.1f", lastClose, lowerBand, lastRSI)

	// Volatility Circuit Breaker
	isChop, err := s.chopFilter.IsChop(closes)
	if err != nil {
		s.logger.Warn("ATR chop filter error, failing open", slog.String("error", err.Error()))
	} else if isChop {
		rationale += " | Blocked by Volatility Circuit Breaker (ATR Chop Filter)"
		return StrategySignal{
			AssetClass:   AssetEquity,
			StrategyName: s.Name(),
			Symbol:       symbol,
			Signal:       SignalHold,
			Score:        score,
			StopLossPct:  stopPct,
			TargetPct:    targetPct,
			Rationale:    rationale,
			Timestamp:    evalTime,
		}, nil
	}

	if lastClose <= lowerBand && lastRSI <= s.RSIOversold {
		score = 85.0
		sig = SignalBuy
		rationale += " | Oversold Bounce Triggered (BUY)"
	} else if lastClose >= upperBand && lastRSI >= s.RSIOverbought {
		score = 85.0
		sig = SignalSell
		rationale += " | Overbought Reversal Triggered (SELL)"
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
func (s *MeanReversionStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for MeanReversionStrategy.
func (s *MeanReversionStrategy) IsIntradayOnly() bool {
	return true
}
