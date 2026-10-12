package regime

import (
	"context"
	"errors"
	"testing"
)

type mockMacroProvider struct {
	vix      float64
	vixErr   error
	spy      float64
	spyErr   error
}

func (m *mockMacroProvider) FetchVIX(ctx context.Context) (float64, error) {
	return m.vix, m.vixErr
}

func (m *mockMacroProvider) FetchSPYTrend(ctx context.Context) (float64, error) {
	return m.spy, m.spyErr
}

func TestDetector_Detect(t *testing.T) {
	tests := []struct {
		name     string
		vix      float64
		vixErr   error
		spy      float64
		spyErr   error
		expected State
	}{
		{
			name:     "Volatile on VIX fetch error",
			vixErr:   errors.New("network error"),
			expected: RegimeVolatile,
		},
		{
			name:     "Volatile on SPY fetch error",
			vix:      15.0,
			spyErr:   errors.New("network error"),
			expected: RegimeVolatile,
		},
		{
			name:     "Volatile on invalid VIX",
			vix:      0,
			expected: RegimeVolatile,
		},
		{
			name:     "Volatile on invalid SPY",
			vix:      15.0,
			spy:      -1.0,
			expected: RegimeVolatile,
		},
		{
			name:     "High VIX -> Volatile",
			vix:      35.0,
			spy:      400.0,
			expected: RegimeVolatile,
		},
		{
			name:     "Medium VIX -> Bearish",
			vix:      25.0,
			spy:      400.0,
			expected: RegimeBearish,
		},
		{
			name:     "Low VIX -> Bullish",
			vix:      15.0,
			spy:      400.0,
			expected: RegimeBullish,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := &mockMacroProvider{
				vix:    tt.vix,
				vixErr: tt.vixErr,
				spy:    tt.spy,
				spyErr: tt.spyErr,
			}
			detector := NewDetector(provider)
			state := detector.Detect(context.Background())
			if state != tt.expected {
				t.Errorf("expected state %v, got %v", tt.expected, state)
			}
		})
	}
}

func TestDetector_Detect_NilProvider(t *testing.T) {
	detector := NewDetector(nil)
	state := detector.Detect(context.Background())
	if state != RegimeVolatile {
		t.Errorf("expected RegimeVolatile for nil provider, got %v", state)
	}
}
