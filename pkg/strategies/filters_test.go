package strategies_test

import (
	"testing"
	"gelt/pkg/strategies"
)

func TestATRChopFilter_IsChop(t *testing.T) {
	// A 1.5% threshold filter
	filter := strategies.NewATRChopFilter(0.015, 14)

	t.Run("Chop Condition (Low Volatility)", func(t *testing.T) {
		closes := []float64{}
		for i := 0; i < 15; i++ {
			closes = append(closes, 100.0+(float64(i%2)*0.1))
		}

		isChop, err := filter.IsChop(closes)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !isChop {
			t.Errorf("expected IsChop to be true for low volatility")
		}
	})

	t.Run("Expansion Condition (High Volatility)", func(t *testing.T) {
		closes := []float64{}
		for i := 0; i < 15; i++ {
			closes = append(closes, 100.0+(float64(i%2)*5.0))
		}

		isChop, err := filter.IsChop(closes)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if isChop {
			t.Errorf("expected IsChop to be false for high volatility")
		}
	})

	t.Run("Insufficient Data", func(t *testing.T) {
		closes := []float64{100.0, 101.0}
		_, err := filter.IsChop(closes)
		if err == nil {
			t.Errorf("expected error for insufficient data, got nil")
		}
	})
}

func TestIsVolatilityChop(t *testing.T) {
	tests := []struct {
		name             string
		closes           []float64
		atrPeriod        int
		minVolatilityPct float64
		expected         bool // true if it is chop (blocked), false if it is good volatility
	}{
		{
			name:             "Not enough data",
			closes:           []float64{100.0, 101.0},
			atrPeriod:        14,
			minVolatilityPct: 1.5,
			expected:         false,
		},
		{
			name: "Low Volatility Chop (Blocked)",
			closes: []float64{
				100.0, 100.1, 99.9, 100.2, 99.8,
				100.1, 99.9, 100.0, 100.1, 99.9,
				100.0, 100.1, 99.9, 100.0, 100.0,
			},
			atrPeriod:        14,
			minVolatilityPct: 1.5,
			expected:         true,
		},
		{
			name: "High Volatility (Passing)",
			closes: []float64{
				100.0, 105.0, 95.0, 110.0, 90.0,
				105.0, 95.0, 108.0, 92.0, 105.0,
				98.0, 102.0, 95.0, 105.0, 100.0,
			},
			atrPeriod:        14,
			minVolatilityPct: 1.5,
			expected:         false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := strategies.IsVolatilityChop(tt.closes, tt.atrPeriod, tt.minVolatilityPct)
			if result != tt.expected {
				t.Errorf("IsVolatilityChop() = %v, want %v", result, tt.expected)
			}
		})
	}
}
