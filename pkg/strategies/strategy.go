// Package strategies provides a catalog of quantitative trading strategies for Gelt.
package strategies

import (
	"context"
	"time"

	"gelt/pkg/data"
)


// AssetClass defines the type of asset being traded.
type AssetClass string

// AssetEquity indicates an equity asset
const AssetEquity AssetClass = "EQUITY"

// AssetCrypto indicates a crypto asset
const AssetCrypto AssetClass = "CRYPTO"

// AssetOptions indicates an options contract
const AssetOptions AssetClass = "OPTIONS"

// SignalType defines the directional bias of a strategy signal.
type SignalType string

// SignalBuy indicates a buy signal
const SignalBuy SignalType = "BUY"

// SignalSell indicates a sell signal
const SignalSell SignalType = "SELL"

// SignalHold indicates a hold signal
const SignalHold SignalType = "HOLD"

// SignalAgentReview indicates the decision should be deferred to the Agent
const SignalAgentReview SignalType = "AGENT_REVIEW"

// StrategySignal holds the output of a strategy evaluation.
type StrategySignal struct {
	StrategyName  string     `json:"strategy_name"`
	Symbol        string     `json:"symbol"`
	AssetClass    AssetClass `json:"asset_class"`
	Signal        SignalType `json:"signal"`
	Score         float64    `json:"score"`         // 0.0 - 100.0 confidence score
	StopLossPct   float64    `json:"stop_loss_pct"` // Dynamic ATR-calibrated stop loss %
	TargetPct     float64    `json:"target_pct"`    // Dynamic ATR-calibrated target %
	Rationale     string     `json:"rationale"`     // Technical rationale
	AgentPrompt   string     `json:"agent_prompt,omitempty"` // Instructions for the agent
	BuyThreshold  float64    `json:"buy_threshold,omitempty"`
	SellThreshold float64    `json:"sell_threshold,omitempty"`
	Timestamp     time.Time  `json:"timestamp"`
}

// Strategy defines the core contract for all Gelt quantitative trading strategies.
type Strategy interface {
	Name() string
	Description() string
	Init(registry *data.FeatureRegistry) error
	SetParams(params map[string]float64)
	CapitalRequirement() float64
	IsIntradayOnly() bool
	Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error)
}

