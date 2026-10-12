package main_test

import (
	"encoding/json"
	"testing"
	"gelt/pkg/ai"
	"gelt/pkg/plans"
	"gelt/pkg/strategies"
)

func TestAIOrchestrator(t *testing.T) {
	router := ai.NewRouter(75.0)

	originalSignal := strategies.StrategySignal{
		StrategyName: "TestStrategy",
		Signal:       strategies.SignalBuy,
		AssetClass:   strategies.AssetEquity,
	}

	payload := plans.SignalContextPayload{
		OriginalSignal: originalSignal,
		RSI:            30.0,
		VWAP:           150.0,
		ActivePlan:     "TestPlan",
	}

	payloadBytes, _ := json.Marshal(payload)
	contextStr := string(payloadBytes)

	agentSignal := strategies.StrategySignal{
		StrategyName: "TestStrategy",
		Signal:       strategies.SignalAgentReview,
		AssetClass:   strategies.AssetEquity,
		AgentPrompt:  contextStr,
	}

	t.Run("VETO Decision cancels signal", func(t *testing.T) {
		mockResp := &ai.AIResponse{
			ConfidenceScore: 80.0,
			Decision:        "VETO",
			Reasoning:       "False positive breakout detected",
		}

		result, err := router.Route(agentSignal, contextStr, mockResp)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		if result.Signal != strategies.SignalHold {
			t.Errorf("Expected SignalHold, got %v", result.Signal)
		}
	})

	t.Run("Low Confidence (< 75.0) cancels signal", func(t *testing.T) {
		mockResp := &ai.AIResponse{
			ConfidenceScore: 70.0,
			Decision:        "AUTHORIZE",
			Reasoning:       "Looks okay but volume is light",
		}

		result, err := router.Route(agentSignal, contextStr, mockResp)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		if result.Signal != strategies.SignalHold {
			t.Errorf("Expected SignalHold, got %v", result.Signal)
		}
	})

	t.Run("High Confidence (>= 75.0) and AUTHORIZE restores signal", func(t *testing.T) {
		mockResp := &ai.AIResponse{
			ConfidenceScore: 85.0,
			Decision:        "AUTHORIZE",
			Reasoning:       "Strong setup",
		}

		result, err := router.Route(agentSignal, contextStr, mockResp)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		if result.Signal != strategies.SignalBuy {
			t.Errorf("Expected SignalBuy, got %v", result.Signal)
		}
	})

	t.Run("Ignore non-agent review signals", func(t *testing.T) {
		mockResp := &ai.AIResponse{}
		result, err := router.Route(originalSignal, "", mockResp)
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}

		if result.Signal != strategies.SignalBuy {
			t.Errorf("Expected original signal to pass through unharmed")
		}
	})
}
