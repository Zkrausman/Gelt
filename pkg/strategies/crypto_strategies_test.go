package strategies

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestCryptoStrategies_InversionOfControlAndEvaluation(t *testing.T) {
	now := time.Now()

	// Generate 50 synthetic close prices for evaluation
	closes := make([]float64, 50)
	vols := make([]float64, 50)
	base := 50000.0
	for i := 0; i < 50; i++ {
		closes[i] = base + float64(i*10)
		vols[i] = 1000.0 + float64(i*5)
	}

	tests := []struct {
		name               string
		strat              Strategy
		expectedName       string
		expectedAssetClass AssetClass
		expectedIsIntraday bool
		minScore           float64
		maxScore           float64
	}{
		{
			name:               "MACD_Crypto",
			strat:              NewMACDCryptoStrategy(),
			expectedName:       "MACD_Crypto",
			expectedAssetClass: AssetCrypto,
			expectedIsIntraday: false,
			minScore:           0.0,
			maxScore:           100.0,
		},
		{
			name:               "Random_Crypto",
			strat:              NewRandomCryptoStrategy(),
			expectedName:       "Random_Crypto",
			expectedAssetClass: AssetCrypto,
			expectedIsIntraday: false,
			minScore:           0.0,
			maxScore:           100.0,
		},
		{
			name:               "VWAP_Crypto",
			strat:              NewVWAPCryptoStrategy(),
			expectedName:       "VWAP_Crypto",
			expectedAssetClass: AssetCrypto,
			expectedIsIntraday: false,
			minScore:           0.0,
			maxScore:           100.0,
		},
		{
			name:               "AI_Choice_Crypto",
			strat:              NewAIChoiceCryptoStrategy(""),
			expectedName:       "AI_Choice_Crypto",
			expectedAssetClass: AssetCrypto,
			expectedIsIntraday: false,
			minScore:           50.0,
			maxScore:           50.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.strat.Name() != tt.expectedName {
				t.Errorf("expected strategy name %q, got %q", tt.expectedName, tt.strat.Name())
			}

			if tt.strat.IsIntradayOnly() != tt.expectedIsIntraday {
				t.Errorf("expected IsIntradayOnly %v for Inversion of Control, got %v", tt.expectedIsIntraday, tt.strat.IsIntradayOnly())
			}

			sig, err := tt.strat.Evaluate(context.Background(), now, "BTC", closes, vols)
			if err != nil {
				t.Fatalf("unexpected error evaluating %s: %v", tt.name, err)
			}

			if sig.AssetClass != tt.expectedAssetClass {
				t.Errorf("expected AssetClass %s, got %s", tt.expectedAssetClass, sig.AssetClass)
			}

			if sig.Score < tt.minScore || sig.Score > tt.maxScore {
				t.Errorf("expected score in range [%.1f, %.1f], got %.2f", tt.minScore, tt.maxScore, sig.Score)
			}

			if tt.name == "AI_Choice_Crypto" {
				if sig.Signal != SignalAgentReview {
					t.Errorf("expected SignalAgentReview for AI_Choice_Crypto, got %s", sig.Signal)
				}
				if !strings.Contains(sig.Rationale, "Agent Prompt") {
					t.Errorf("expected Agent Prompt in rationale, got %q", sig.Rationale)
				}
			}
		})
	}
}
