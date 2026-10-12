package plans

import (
	"gelt/pkg/data"
	"gelt/pkg/strategies"
)

// DefaultPlanSuite constructs and registers built-in Trading Plans over the Strategy Catalog.
func DefaultPlanSuite() *PlanRegistry {
	reg := NewPlanRegistry()

	trend := strategies.NewTrendConfluenceStrategy()
	reversion := strategies.NewMeanReversionStrategy()
	breakout := strategies.NewBreakoutVolStrategy()
	vwap := strategies.NewVWAPReboundStrategy()

	// 1. IntradayAlphaPlan (Default): TrendConfluence (50%) + VWAPRebound (50%)
	alphaPlan := NewBasePlan(
		"IntradayAlphaPlan",
		"Default multi-strategy ensemble combining TrendConfluence (50%) and VWAPRebound (50%) for liquid US equities.",
		[]WeightedStrategy{
			{Strategy: trend, Weight: 0.50},
			{Strategy: vwap, Weight: 0.50},
		},
	)

	// 2. RangeBoundDefensivePlan: MeanReversion (70%) + VWAPRebound (30%)
	defensivePlan := NewBasePlan(
		"RangeBoundDefensivePlan",
		"Defensive mean-reversion plan combining Bollinger/RSI bounce (70%) and VWAP support (30%) for range-bound markets.",
		[]WeightedStrategy{
			{Strategy: reversion, Weight: 0.70},
			{Strategy: vwap, Weight: 0.30},
		},
	)

	// 3. BreakoutExpansionPlan: BreakoutVol (70%) + TrendConfluence (30%)
	breakoutPlan := NewBasePlan(
		"BreakoutExpansionPlan",
		"High-conviction volatility breakout plan combining ATR range expansion (70%) and trend momentum (30%).",
		[]WeightedStrategy{
			{Strategy: breakout, Weight: 0.70},
			{Strategy: trend, Weight: 0.30},
		},
	)

	optionsAlphaPlan := NewOptionsAlphaPlan()
	cryptoPlan := NewCryptoPlan()

	featureReg := data.NewFeatureRegistry()
	alphaPlan.Init(featureReg)
	defensivePlan.Init(featureReg)
	breakoutPlan.Init(featureReg)
	optionsAlphaPlan.Init(featureReg)
	cryptoPlan.Init(featureReg)

	reg.Register(alphaPlan)
	reg.Register(defensivePlan)
	reg.Register(breakoutPlan)
	reg.Register(optionsAlphaPlan)
	reg.Register(cryptoPlan)
	_ = reg.SetActive("IntradayAlphaPlan")

	return reg
}
