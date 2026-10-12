package strategies

import (
	"context"
	"gelt/pkg/data"
	"strings"
	"testing"
	"time"
)

func TestBreakoutVolStrategy_Evaluate(t *testing.T) {
	strat := NewBreakoutVolStrategy()
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
			name: "neutral signal (constant closes)",
			closes: func() []float64 {
				c := make([]float64, 20)
				for i := range c {
					c[i] = 100
				}
				return c
			}(),
			volumes:    make([]float64, 20),
			wantErr:    false,
			wantSignal: SignalHold,
			wantScore:  50.0,
		},
		{
			name: "bullish breakout",
			closes: func() []float64 {
				c := make([]float64, 20)
				for i := 0; i < 19; i++ {
					c[i] = 100.0
				}
				c[19] = 110.0 // sudden jump
				return c
			}(),
			volumes:    make([]float64, 20),
			wantErr:    false,
			wantSignal: SignalBuy,
			wantScore:  90.0,
		},
		{
			name: "bearish breakdown",
			closes: func() []float64 {
				c := make([]float64, 20)
				for i := 0; i < 19; i++ {
					c[i] = 100.0
				}
				c[19] = 90.0 // sudden drop
				return c
			}(),
			volumes:    make([]float64, 20),
			wantErr:    false,
			wantSignal: SignalSell,
			wantScore:  90.0,
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

func TestBreakoutVolStrategy_Info(t *testing.T) {
	strat := NewBreakoutVolStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)
	if strat.Name() != "BreakoutVol" {
		t.Errorf("Name() = %v, want BreakoutVol", strat.Name())
	}
	if !strings.Contains(strat.Description(), "volatility expansion") {
		t.Errorf("Description() = %v", strat.Description())
	}
}
