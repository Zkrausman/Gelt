package ai

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"gelt/pkg/strategies"
	"gelt/pkg/plans"
)

// AIResponse represents the structured decision output from the AI model.
type AIResponse struct {
	ConfidenceScore float64 `json:"confidence_score"`
	Decision        string  `json:"decision"` // e.g., "AUTHORIZE" or "VETO"
	Reasoning       string  `json:"reasoning"`
}

// Router handles the routing and overriding of AI evaluated signals.
type Router struct {
	ConfidenceThreshold float64
}

// NewRouter initializes an AI authorization router.
func NewRouter(threshold float64) *Router {
	if threshold == 0 {
		threshold = 75.0
	}
	return &Router{
		ConfidenceThreshold: threshold,
	}
}

// Route simulates sending the context to an AI and interpreting the result to authorize or override a signal.
func (r *Router) Route(signal strategies.StrategySignal, contextPayload string, mockResponse *AIResponse) (strategies.StrategySignal, error) {
	if signal.Signal != strategies.SignalAgentReview {
		return signal, nil
	}

	var payload plans.SignalContextPayload
	if err := json.Unmarshal([]byte(contextPayload), &payload); err != nil {
		return signal, fmt.Errorf("failed to unmarshal context payload: %w", err)
	}

	// In a real implementation, this is where the HTTP call to the LLM would happen.
	// We use the mockResponse for deterministic testing and injection.
	if mockResponse == nil {
		return signal, fmt.Errorf("AI response is required")
	}

	slog.Info("AI Evaluation Received",
		slog.Float64("confidence", mockResponse.ConfidenceScore),
		slog.String("decision", mockResponse.Decision),
		slog.String("reasoning", mockResponse.Reasoning),
	)

	// Evaluate against strict constraints
	if mockResponse.Decision == "VETO" || mockResponse.ConfidenceScore < r.ConfidenceThreshold {
		slog.Warn("AI Override Initiated: Canceling pending signal",
			slog.String("reason", mockResponse.Reasoning),
		)

		// Override and cancel
		overriddenSignal := signal
		overriddenSignal.Signal = strategies.SignalHold
		overriddenSignal.AgentPrompt = ""

		return overriddenSignal, nil
	}

	slog.Info("AI Authorization Granted: High conviction detected")

	// Authorize and restore original intended action
	authorizedSignal := signal
	authorizedSignal.Signal = payload.OriginalSignal.Signal
	authorizedSignal.AgentPrompt = ""

	return authorizedSignal, nil
}
