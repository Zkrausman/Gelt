package macro

// RegimeMatrix represents the shared local memory contract for macro regime context.
type RegimeMatrix struct {
	Score           float64            `json:"Score"`
	VolatilityFlags map[string]bool    `json:"VolatilityFlags"`
	MarketSentiment float64            `json:"MarketSentiment"`
	AssetBiases     map[string]float64 `json:"AssetBiases"`
}
