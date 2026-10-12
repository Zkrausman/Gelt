package strategies

import (
	"context"
	"gelt/pkg/data"
	"strings"
	"testing"
	"time"
)

func TestMeanReversionStrategy_Evaluate(t *testing.T) {
	strat := NewMeanReversionStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)

	tests := []struct {
		name       string
		closes     []float64
		volumes    []float64
		wantErr    bool
		wantSignal SignalType
		wantScore  float64
	}{
		{
			name:    "insufficient data",
			closes:  []float64{100, 101},
			volumes: []float64{1000, 1000},
			wantErr: true,
		},
		{
			name: "neutral signal",
			closes: func() []float64 {
				c := make([]float64, 50)
				for i := range c {
					// alternate to keep RSI neutral (~50) and bollinger bands separated
					if i%2 == 0 {
						c[i] = 101.0
					} else {
						c[i] = 99.0
					}
				}
				// make sure the last close is inside the bollinger bands
				c[49] = 100.0
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalHold,
			wantScore:  50.0,
		},
		{
			name: "bullish signal (oversold)",
			closes: func() []float64 {
				c := make([]float64, 50)
				for i := 0; i < 45; i++ {
					if i%2 == 0 {
						c[i] = 105.0
					} else {
						c[i] = 95.0
					}
				}
				// Sharp drop to pierce lower band and crush RSI
				val := 90.0
				for i := 45; i < 50; i++ {
					c[i] = val
					val -= 10.0
				}
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalBuy, // Close <= lowerBand, RSI <= 35
			wantScore:  85.0,
		},
		{
			name: "bullish signal blocked by chop filter (low volatility)",
			closes: func() []float64 {
				c := make([]float64, 50)
				// Create a very tight, low volatility range (ATR will be very small)
				for i := range c {
					c[i] = 100.0 + (float64(i%2) * 0.05)
				}
				// Keep volatility extremely low, and artificially lower the last close
				// just enough to break the lower band and RSI.
				for i := 48; i < 50; i++ {
					c[i] = 99.8 // A tiny drop
				}
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalHold, // Blocked by chop filter
			wantScore:  50.0,
		},
		{
			name: "bearish signal (overbought)",
			closes: func() []float64 {
				c := make([]float64, 50)
				for i := 0; i < 45; i++ {
					if i%2 == 0 {
						c[i] = 105.0
					} else {
						c[i] = 95.0
					}
				}
				// Sharp rise to pierce upper band and spike RSI
				val := 110.0
				for i := 45; i < 50; i++ {
					c[i] = val
					val += 10.0
				}
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalSell, // Close >= upperBand, RSI >= 65
			wantScore:  85.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sig, err := strat.Evaluate(context.Background(), time.Now(), "TEST", tt.closes, tt.volumes)
			if (err != nil) != tt.wantErr {
				t.Errorf("Evaluate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if sig.Signal != tt.wantSignal {
				t.Errorf("Evaluate() signal = %v, want %v", sig.Signal, tt.wantSignal)
			}
			if sig.Score != tt.wantScore {
				t.Errorf("Evaluate() score = %v, want %v", sig.Score, tt.wantScore)
			}
			if sig.Score < 0.0 || sig.Score > 100.0 {
				t.Errorf("Evaluate() score = %v, out of bounds [0, 100]", sig.Score)
			}
			if sig.StrategyName != strat.Name() {
				t.Errorf("Evaluate() StrategyName = %v, want %v", sig.StrategyName, strat.Name())
			}
		})
	}
}

func TestMeanReversionStrategy_Info(t *testing.T) {
	strat := NewMeanReversionStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)
	if strat.Name() != "MeanReversion" {
		t.Errorf("Name() = %v, want MeanReversion", strat.Name())
	}
	if !strings.Contains(strat.Description(), "oversold bounce") {
		t.Errorf("Description() = %v", strat.Description())
	}
}
