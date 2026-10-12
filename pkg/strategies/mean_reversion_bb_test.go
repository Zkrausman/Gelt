package strategies

import (
	"context"
	"gelt/pkg/data"
	"testing"
	"time"
)

func TestMeanReversionBBStrategy_Name(t *testing.T) {
	s := NewMeanReversionBBStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	s.Init(registry)
	if s.Name() != "MeanReversionBB" {
		t.Errorf("expected MeanReversionBB, got %s", s.Name())
	}
}

func TestMeanReversionBBStrategy_Description(t *testing.T) {
	s := NewMeanReversionBBStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	s.Init(registry)
	if s.Description() == "" {
		t.Error("expected description to be populated")
	}
}

func TestMeanReversionBBStrategy_Evaluate(t *testing.T) {
	s := NewMeanReversionBBStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	s.Init(registry)

	tests := []struct {
		name          string
		closes        []float64
		volumes       []float64
		expectedSig   SignalType
		expectedScore float64
		expectError   bool
	}{
		{
			name:        "Insufficient Data",
			closes:      []float64{100.0, 101.0},
			volumes:     []float64{1000, 1000},
			expectError: true,
		},
		{
			name: "Buy Signal - Oversold",
			// Create a flat price array then drop the last element significantly
			closes: []float64{
				105.0, 95.0, 105.0, 95.0, 105.0,
				95.0, 105.0, 95.0, 105.0, 95.0,
				105.0, 95.0, 105.0, 95.0, 105.0,
				95.0, 105.0, 95.0, 105.0, 80.0, // Drop below lower band
			},
			volumes:       make([]float64, 20),
			expectedSig:   SignalBuy,
			expectedScore: 85.0,
			expectError:   false,
		},
		{
			name: "Sell Signal - Overbought",
			// Create a flat price array then spike the last element significantly
			closes: []float64{
				105.0, 95.0, 105.0, 95.0, 105.0,
				95.0, 105.0, 95.0, 105.0, 95.0,
				105.0, 95.0, 105.0, 95.0, 105.0,
				95.0, 105.0, 95.0, 105.0, 120.0, // Spike above upper band
			},
			volumes:       make([]float64, 20),
			expectedSig:   SignalSell,
			expectedScore: 85.0,
			expectError:   false,
		},
		{
			name: "Hold Signal - Middle of Bands",
			// Create fluctuating price array to give non-zero stddev
			closes: []float64{
				105.0, 95.0, 105.0, 95.0, 105.0,
				95.0, 105.0, 95.0, 105.0, 95.0,
				105.0, 95.0, 105.0, 95.0, 105.0,
				95.0, 105.0, 95.0, 105.0, 100.0, // Last price right in middle
			},
			volumes:       make([]float64, 20),
			expectedSig:   SignalHold,
			expectedScore: 50.0,
			expectError:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sig, err := s.Evaluate(context.Background(), time.Now(), "AAPL", tt.closes, tt.volumes)
			if (err != nil) != tt.expectError {
				t.Errorf("expected error: %v, got: %v", tt.expectError, err)
			}
			if !tt.expectError {
				if sig.Signal != tt.expectedSig {
					t.Errorf("expected signal %v, got %v", tt.expectedSig, sig.Signal)
				}
				if sig.Score != tt.expectedScore {
					t.Errorf("expected score %v, got %v", tt.expectedScore, sig.Score)
				}
			}
		})
	}
}
