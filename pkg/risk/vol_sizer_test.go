package risk

import "testing"

func TestCalculateVolAdjustedSize(t *testing.T) {
	tests := []struct {
		name        string
		baseSize    int
		currentATR  float64
		baselineATR float64
		maxLossCap  float64
		expected    int
	}{
		{
			name:        "Equal ATR - normal scaling",
			baseSize:    10,
			currentATR:  1.0,
			baselineATR: 1.0,
			maxLossCap:  100.0,
			expected:    10,
		},
		{
			name:        "Doubled ATR - cuts position by 50%",
			baseSize:    10,
			currentATR:  2.0,
			baselineATR: 1.0,
			maxLossCap:  100.0,
			expected:    5,
		},
		{
			name:        "Halved ATR - scales position up to risk cap (which allows it)",
			baseSize:    10,
			currentATR:  0.5,
			baselineATR: 1.0,
			maxLossCap:  100.0,
			expected:    20, // 10 * (1.0/0.5) = 20, maxLoss allowed = 100 / 0.5 = 200, so 20 is within cap
		},
		{
			name:        "Capped by maxLossCap",
			baseSize:    10,
			currentATR:  1.0,
			baselineATR: 1.0,
			maxLossCap:  8.0, // base size says 10, but 10 * 1.0 = 10, which exceeds 8.0 cap
			expected:    8,   // 8.0 / 1.0 = 8
		},
		{
			name:        "Doubled ATR and Capped by maxLossCap",
			baseSize:    10,
			currentATR:  2.0,
			baselineATR: 1.0,
			maxLossCap:  8.0, // base size would be 5 (from 10 * 0.5). 5 * 2 = 10 risk, which exceeds 8 cap. 8 / 2 = 4 max allowed
			expected:    4,
		},
		{
			name:        "Negative input edge case",
			baseSize:    -5,
			currentATR:  1.0,
			baselineATR: 1.0,
			maxLossCap:  10.0,
			expected:    0,
		},
		{
			name:        "Zero ATR edge case",
			baseSize:    10,
			currentATR:  0.0,
			baselineATR: 1.0,
			maxLossCap:  10.0,
			expected:    0,
		},
		{
			name: "Test Account Cap Constraints (e.g. $10 hard trade cap limit)",
			// Suppose we have a $10 hard trade cap, which is equivalent to a max loss cap in a way
			// or just maxLossCap = $10. Let's say ATR is $2 per share. Max shares we can buy is $10/$2 = 5 shares.
			baseSize:    10,
			currentATR:  2.0,
			baselineATR: 2.0,
			maxLossCap:  10.0,
			expected:    5,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculateVolAdjustedSize(tc.baseSize, tc.currentATR, tc.baselineATR, tc.maxLossCap)
			if got != tc.expected {
				t.Errorf("CalculateVolAdjustedSize(%d, %.2f, %.2f, %.2f) = %d; expected %d",
					tc.baseSize, tc.currentATR, tc.baselineATR, tc.maxLossCap, got, tc.expected)
			}
		})
	}
}
