package plans

import (
	"encoding/json"
	"fmt"
	"gelt/pkg/strategies"
)

// SignalContextPayload represents the hydrated context for an AI evaluation.
type SignalContextPayload struct {
	OriginalSignal strategies.StrategySignal `json:"original_signal"`
	OrderBookDepth interface{}               `json:"order_book_depth"`
	RSI            float64                   `json:"rsi"`
	VWAP           float64                   `json:"vwap"`
	ActivePlan     string                    `json:"active_plan"`
}

// InterceptSignal evaluates a raw strategy signal and if it's a BUY or SELL,
// packages the state into a hydrated context for AI evaluation, halting automatic execution.
func InterceptSignal(signal strategies.StrategySignal, orderBookDepth interface{}, rsi float64, vwap float64, activePlan string) (strategies.StrategySignal, string, error) {
	if signal.Signal == strategies.SignalBuy || signal.Signal == strategies.SignalSell {
		payload := SignalContextPayload{
			OriginalSignal: signal,
			OrderBookDepth: orderBookDepth,
			RSI:            rsi,
			VWAP:           vwap,
			ActivePlan:     activePlan,
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return signal, "", fmt.Errorf("failed to marshal signal context payload: %w", err)
		}

		// Halt automatic dispatch by returning SignalAgentReview
		signal.Signal = strategies.SignalAgentReview
		signal.AgentPrompt = string(payloadBytes)

		return signal, string(payloadBytes), nil
	}

	return signal, "", nil
}
