package strategies

import (
	"context"
	"fmt"
	"time"

	"gelt/pkg/data"
)

// AIChoiceCryptoStrategy represents an AI-delegated strategy module that defers trade decisions to an external LLM orchestrator.
type AIChoiceCryptoStrategy struct {
	Prompt               string
	AutoLiquidateAtClose bool
	BuyThreshold         float64
	SellThreshold        float64
	registry             *data.FeatureRegistry
}

// NewAIChoiceCryptoStrategy creates a new AI_Choice_Crypto strategy instance.
func NewAIChoiceCryptoStrategy(prompt string) *AIChoiceCryptoStrategy {
	if prompt == "" {
		prompt = "It's up to you to decide what to buy and sell, just no more than two positions at a time"
	}
	return &AIChoiceCryptoStrategy{
		Prompt:               prompt,
		AutoLiquidateAtClose: false,
		BuyThreshold:          75.0,
		SellThreshold:         35.0,
	}
}

// Init stores the FeatureRegistry reference.
func (s *AIChoiceCryptoStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

// Name returns the strategy name "AI_Choice_Crypto".
func (s *AIChoiceCryptoStrategy) Name() string {
	return "AI_Choice_Crypto"
}

// Description returns the strategy description.
func (s *AIChoiceCryptoStrategy) Description() string {
	return fmt.Sprintf("AI-delegated strategy for 24/7 crypto markets deferring decisions to orchestrator via prompt: %q", s.Prompt)
}

// CapitalRequirement returns the strategy's minimum capital requirement.
func (s *AIChoiceCryptoStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns false for 24/7 crypto markets (AutoLiquidateAtClose: false).
func (s *AIChoiceCryptoStrategy) IsIntradayOnly() bool {
	return false
}

// Evaluate strictly outputs a neutral score of 50.0 and SignalAgentReview with the AgentPrompt payload attached.
func (s *AIChoiceCryptoStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) == 0 {
		return StrategySignal{}, fmt.Errorf("empty price data for AI_Choice_Crypto strategy")
	}

	rationale := fmt.Sprintf("[AI CHOICE] Agent Prompt: %q | Status: AGENT_REVIEW", s.Prompt)

	return StrategySignal{
		AssetClass:    AssetCrypto,
		StrategyName:  s.Name(),
		Symbol:        symbol,
		Signal:        SignalAgentReview,
		Score:         50.0,
		StopLossPct:   3.5,
		TargetPct:     7.0,
		Rationale:     rationale,
		AgentPrompt:   s.Prompt,
		BuyThreshold:    s.BuyThreshold,
		SellThreshold:   s.SellThreshold,
		Timestamp:     evalTime,
	}, nil
}

// SetParams sets strategy parameters.
func (s *AIChoiceCryptoStrategy) SetParams(params map[string]float64) {
	if val, ok := params["BuyThreshold"]; ok && val > 0.0 {
		s.BuyThreshold = val
	} else if val, ok := params["buy_threshold"]; ok && val > 0.0 {
		s.BuyThreshold = val
	}
	if val, ok := params["SellThreshold"]; ok && val > 0.0 {
		s.SellThreshold = val
	} else if val, ok := params["sell_threshold"]; ok && val > 0.0 {
		s.SellThreshold = val
	}
}
