package plans

import (
	"gelt/pkg/strategies"
)

// NewOptionsAlphaPlan constructs the OptionsAlphaPlan combining LongOptions (70%) and TrendConfluence (30%).
// It targets directional momentum (calls/puts) with trend confirmation.
// Decisions are guided by consensus boundaries:
// Weighted Score >= 80.0 -> SignalBuy
// Weighted Score <= 35.0 -> SignalSell
func NewOptionsAlphaPlan() *BasePlan {
	longOps := strategies.NewLongOptionsStrategy()
	trend := strategies.NewTrendConfluenceStrategy()

	return NewBasePlan(
		"OptionsAlphaPlan",
		"Options alpha plan combining LongOptions (70%) and TrendConfluence (30%) for directional options trades.",
		[]WeightedStrategy{
			{Strategy: longOps, Weight: 0.70},
			{Strategy: trend, Weight: 0.30},
		},
	)
}
