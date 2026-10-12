package strategies

import (
	"context"
	"time"
)

// VWAPCryptoStrategy adapts VWAPReboundStrategy for 24/7 crypto markets.
type VWAPCryptoStrategy struct {
	VWAPReboundStrategy
	AutoLiquidateAtClose bool
}

// NewVWAPCryptoStrategy creates a new VWAP_Crypto strategy with AutoLiquidateAtClose: false.
func NewVWAPCryptoStrategy() *VWAPCryptoStrategy {
	return &VWAPCryptoStrategy{
		AutoLiquidateAtClose: false,
	}
}

// Name returns the strategy name "VWAP_Crypto".
func (s *VWAPCryptoStrategy) Name() string {
	return "VWAP_Crypto"
}

// Description returns the strategy description.
func (s *VWAPCryptoStrategy) Description() string {
	return "Evaluates intraday pullback rebounds against institutional VWAP support/resistance for 24/7 crypto markets."
}

// IsIntradayOnly returns false for 24/7 crypto markets (AutoLiquidateAtClose: false).
func (s *VWAPCryptoStrategy) IsIntradayOnly() bool {
	return false
}

// Evaluate evaluates VWAP rebound signals for crypto assets.
func (s *VWAPCryptoStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	sig, err := s.VWAPReboundStrategy.Evaluate(ctx, evalTime, symbol, closes, volumes)
	if err != nil {
		return sig, err
	}
	sig.StrategyName = s.Name()
	sig.AssetClass = AssetCrypto
	return sig, nil
}
