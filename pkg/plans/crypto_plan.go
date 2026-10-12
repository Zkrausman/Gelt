package plans

import (
	"context"
	"time"

	"gelt/pkg/strategies"
)

// CryptoPlan implements a 24/7 Crypto momentum and breakout plan with wide ATR volatility guardrails.
type CryptoPlan struct {
	*BasePlan
	VolMultiplier float64 // Scales ATR stop-loss and target bounds for crypto volatility
}

// NewCryptoPlan constructs the CryptoPlan combining BreakoutVol (60%) and TrendConfluence (40%).
func NewCryptoPlan() *CryptoPlan {
	trend := strategies.NewTrendConfluenceStrategy()
	breakout := strategies.NewBreakoutVolStrategy()

	base := NewBasePlan(
		"CryptoPlan",
		"24/7 Crypto momentum and breakout plan with wide ATR volatility guardrails.",
		[]WeightedStrategy{
			{Strategy: breakout, Weight: 0.60},
			{Strategy: trend, Weight: 0.40},
		},
	)
	return &CryptoPlan{
		BasePlan:      base,
		VolMultiplier: 1.75, // Scales ATR stop-loss and target bounds for crypto volatility
	}
}

// Evaluate evaluates the plan, setting AssetClass to AssetCrypto and expanding ATR guardrails.
func (cp *CryptoPlan) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error) {
	eval, err := cp.BasePlan.Evaluate(ctx, evalTime, symbol, closes, volumes)
	if err != nil {
		return eval, err
	}

	eval.AssetClass = strategies.AssetCrypto
	eval.StopLossPct = eval.StopLossPct * cp.VolMultiplier // e.g. 1.0% -> 1.75%
	eval.TargetPct = eval.TargetPct * cp.VolMultiplier     // e.g. 2.5% -> 4.37%

	return eval, nil
}
