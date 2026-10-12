package plans

import (
	"encoding/json"
	"testing"
	"time"

	"gelt/pkg/strategies"
)

func TestInterceptSignal_BuyOrSell(t *testing.T) {
	tests := []struct {
		name       string
		signalType strategies.SignalType
	}{
		{"Intercept BUY", strategies.SignalBuy},
		{"Intercept SELL", strategies.SignalSell},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rawSignal := strategies.StrategySignal{
				StrategyName: "TestStrat",
				Symbol:       "SPY",
				Signal:       tt.signalType,
				Timestamp:    time.Now(),
			}
			orderBook := map[string]interface{}{"bids": []float64{100.0}, "asks": []float64{101.0}}
			rsi := 30.5
			vwap := 100.5
			planName := "IntradayAlphaPlan"

			interceptedSignal, payloadJSON, err := InterceptSignal(rawSignal, orderBook, rsi, vwap, planName)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if interceptedSignal.Signal != strategies.SignalAgentReview {
				t.Errorf("expected signal to be %s, got %s", strategies.SignalAgentReview, interceptedSignal.Signal)
			}

			if interceptedSignal.AgentPrompt != payloadJSON {
				t.Errorf("expected AgentPrompt to match payloadJSON, got %s", interceptedSignal.AgentPrompt)
			}

			var payload SignalContextPayload
			if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
				t.Fatalf("failed to unmarshal payload: %v", err)
			}

			if payload.OriginalSignal.Signal != tt.signalType {
				t.Errorf("expected payload original signal %s, got %s", tt.signalType, payload.OriginalSignal.Signal)
			}
			if payload.RSI != rsi {
				t.Errorf("expected payload RSI %f, got %f", rsi, payload.RSI)
			}
			if payload.VWAP != vwap {
				t.Errorf("expected payload VWAP %f, got %f", vwap, payload.VWAP)
			}
			if payload.ActivePlan != planName {
				t.Errorf("expected payload ActivePlan %s, got %s", planName, payload.ActivePlan)
			}
		})
	}
}

func TestInterceptSignal_Hold(t *testing.T) {
	rawSignal := strategies.StrategySignal{
		StrategyName: "TestStrat",
		Symbol:       "SPY",
		Signal:       strategies.SignalHold,
		Timestamp:    time.Now(),
	}

	interceptedSignal, payloadJSON, err := InterceptSignal(rawSignal, nil, 50.0, 100.0, "TestPlan")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if interceptedSignal.Signal != strategies.SignalHold {
		t.Errorf("expected signal to remain HOLD, got %s", interceptedSignal.Signal)
	}

	if payloadJSON != "" {
		t.Errorf("expected empty payload for HOLD, got %s", payloadJSON)
	}
}
