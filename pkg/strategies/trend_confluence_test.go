package strategies

import (
	"context"
	"gelt/pkg/data"
	"strings"
	"testing"
	"time"
)

func TestTrendConfluenceStrategy_Evaluate(t *testing.T) {
	strat := NewTrendConfluenceStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)

	tests := []struct {
		name       string
		closes     []float64
		volumes    []float64
		wantErr    bool
		wantSignal SignalType
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
					c[i] = 100.0 + float64(i)*2 // steady uptrend, score = 45 (NEUTRAL)
				}
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalHold,
		},
		{
			name: "bullish signal (score >= 75)",
			closes: func() []float64 {
				c := make([]float64, 50)
				for i := range c {
					c[i] = 100.0
				}
				for i := 20; i < 49; i++ {
					c[i] = 100.0 + float64(i-20)*1.5
				}
				c[49] = 100.0 // drop to lower bollinger band in uptrend -> score = 80 (BULLISH)
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalBuy,
		},
		{
			name: "bearish signal (score <= 35)",
			closes: func() []float64 {
				c := make([]float64, 50)
				for i := range c {
					c[i] = 200.0
				}
				for i := 20; i < 49; i++ {
					c[i] = 200.0 - float64(i-20)*1.5
				}
				c[49] = 200.0 // spike to upper bollinger band in downtrend -> score <= 35 (BEARISH)
				return c
			}(),
			volumes:    make([]float64, 50),
			wantErr:    false,
			wantSignal: SignalSell,
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
			if sig.Score < 0.0 || sig.Score > 100.0 {
				t.Errorf("Evaluate() score = %v, out of bounds [0, 100]", sig.Score)
			}
			if sig.StrategyName != strat.Name() {
				t.Errorf("Evaluate() StrategyName = %v, want %v", sig.StrategyName, strat.Name())
			}
		})
	}
}

func TestTrendConfluenceStrategy_Info(t *testing.T) {
	strat := NewTrendConfluenceStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)
	if strat.Name() != "TrendConfluence" {
		t.Errorf("Name() = %v, want TrendConfluence", strat.Name())
	}
	if !strings.Contains(strat.Description(), "Multi-indicator momentum strategy") {
		t.Errorf("Description() = %v", strat.Description())
	}
}
