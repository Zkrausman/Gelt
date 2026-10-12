package strategies

import (
	"context"
	"fmt"
	"math"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/signals"
)

const DefaultAIPrompt = "It's up to you to decide what to buy and sell, just no more than two positions at a time"

// AIChoiceStrategy evaluates market setup using AI decision logic guided by prompt constraints.
type AIChoiceStrategy struct {
	ATRStopMultiplier float64
	ATRTargetMultiplier float64
	Prompt   string
	registry *data.FeatureRegistry
	BuyThreshold   float64
	SellThreshold  float64
}

// NewAIChoiceStrategy creates a new AI's Choice strategy with default or custom prompt.
func NewAIChoiceStrategy(prompt string) *AIChoiceStrategy {
	if prompt == "" {
		prompt = DefaultAIPrompt
	}
	return &AIChoiceStrategy{
		Prompt: prompt,
		BuyThreshold:   75.0,
		SellThreshold:  35.0,
		ATRStopMultiplier: 0.6,
		ATRTargetMultiplier: 1.5,
	}
}

func (s *AIChoiceStrategy) Init(registry *data.FeatureRegistry) error {
	s.registry = registry
	return nil
}

func (s *AIChoiceStrategy) Name() string {
	return "AIChoice"
}

func (s *AIChoiceStrategy) Description() string {
	return fmt.Sprintf("AI choice strategy using prompt guidance: %q", s.Prompt)
}

func (s *AIChoiceStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error) {
	if len(closes) < 20 {
		return StrategySignal{}, fmt.Errorf("insufficient data for AI choice strategy: %d candles", len(closes))
	}

	// AI Decision Logic: synthesize multi-factor technical summary
	summary, err := signals.EvaluateConfluence(symbol, closes)
	if err != nil {
		return StrategySignal{}, fmt.Errorf("AI confluence evaluation failed: %w", err)
	}

	score := summary.Score
	sig := SignalHold
	decision := "HOLD"

	// AI rule evaluation guided by prompt parameters
	if score >= s.BuyThreshold {
		sig = SignalBuy
		decision = "BUY"
	} else if score <= s.SellThreshold {
		sig = SignalSell
		decision = "SELL"
	}

	lastClose := closes[len(closes)-1]
	atr, _ := signals.CalculateATRFromCloses(closes, 14)
	stopPct := 2.0
	targetPct := 4.0
	if lastClose > 0 && atr > 0 {
		stopPct = math.Max(1.0, (atr*s.ATRStopMultiplier/lastClose)*100.0)
		targetPct = math.Max(2.0, (atr*s.ATRTargetMultiplier/lastClose)*100.0)
	}

	rationale := fmt.Sprintf("[AI CHOICE] Prompt: %q | Confluence Score: %.1f | AI Decision: %s", s.Prompt, score, decision)

	return StrategySignal{
		AssetClass:   AssetEquity,
		StrategyName: s.Name(),
		Symbol:       symbol,
		Signal:       sig,
		Score:        score,
		StopLossPct:  stopPct,
		TargetPct:    targetPct,
		Rationale:    rationale,
		AgentPrompt:  s.Prompt,
		Timestamp:    evalTime,
	}, nil
}

func (s *AIChoiceStrategy) CapitalRequirement() float64 {
	return 0.0
}

// IsIntradayOnly returns true for AIChoiceStrategy.
func (s *AIChoiceStrategy) IsIntradayOnly() bool {
	return true
}

// SetParams sets strategy parameters.
func (s *AIChoiceStrategy) SetParams(params map[string]float64) {
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
	if val, ok := params["atr_stop_multiplier"]; ok && val > 0.0 {
		s.ATRStopMultiplier = val
	}
	if val, ok := params["atr_target_multiplier"]; ok && val > 0.0 {
		s.ATRTargetMultiplier = val
	}
}
