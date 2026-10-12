package strategies

import (
	"context"
	"gelt/pkg/data"
	"strings"
	"testing"
	"time"
)

func TestVWAPReboundStrategy_Evaluate(t *testing.T) {
	strat := NewVWAPReboundStrategy()
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
			name: "neutral signal (too far below VWAP)",
			closes: func() []float64 {
				c := make([]float64, 20)
				for i := range c {
					c[i] = 100.0
				}
				c[19] = 95.0
				return c
			}(),
			volumes: func() []float64 {
				v := make([]float64, 20)
				for i := range v {
					v[i] = 1000
				}
				return v
			}(),
			wantErr:    false,
			wantSignal: SignalHold,
			wantScore:  50.0,
		},
		{
			name: "neutral signal (too far above VWAP)",
			closes: func() []float64 {
				c := make([]float64, 20)
				for i := range c {
					c[i] = 100.0
				}
				c[19] = 105.0
				return c
			}(),
			volumes: func() []float64 {
				v := make([]float64, 20)
				for i := range v {
					v[i] = 1000
				}
				return v
			}(),
			wantErr:    false,
			wantSignal: SignalHold,
			wantScore:  50.0,
		},
		{
			name: "bullish signal",
			closes: func() []float64 {
				c := make([]float64, 20)
				for i := range c {
					c[i] = 100.0
				}
				c[19] = 100.1 // Close to VWAP
				return c
			}(),
			volumes: func() []float64 {
				v := make([]float64, 20)
				for i := range v {
					v[i] = 1000
				}
				return v
			}(),
			wantErr:    false,
			wantSignal: SignalBuy, // diffPct >= -0.2 && diffPct <= 0.3
			wantScore:  88.0,
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

func TestVWAPReboundStrategy_Info(t *testing.T) {
	strat := NewVWAPReboundStrategy()
	registry := data.NewFeatureRegistry()
	registry.Register("Test", &mockFeatureProvider{})
	strat.Init(registry)
	if strat.Name() != "VWAPRebound" {
		t.Errorf("Name() = %v, want VWAPRebound", strat.Name())
	}
	if !strings.Contains(strat.Description(), "intraday pullback rebounds") {
		t.Errorf("Description() = %v", strat.Description())
	}
}

func TestVWAPReboundStrategy_EMAFilterDowntrendRejection(t *testing.T) {
	strat := NewVWAPReboundStrategy().WithTrendFilter(true)
	registry := data.NewFeatureRegistry()
	strat.Init(registry)

	closes := make([]float64, 55)
	volumes := make([]float64, 55)
	for i := 0; i < 55; i++ {
		closes[i] = 200.0 - float64(i)*1.0
		volumes[i] = 1000.0
	}

	sig, err := strat.Evaluate(context.Background(), time.Now(), "TEST", closes, volumes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sig.Signal != SignalHold {
		t.Errorf("expected SignalHold when EnableTrendFilter=true in downtrend, got %v", sig.Signal)
	}
}

func TestVWAPReboundStrategy_EMAFilterDisabled(t *testing.T) {
	strat := NewVWAPReboundStrategy().WithTrendFilter(false)
	registry := data.NewFeatureRegistry()
	strat.Init(registry)

	// Price near VWAP
	closes := make([]float64, 55)
	volumes := make([]float64, 55)
	for i := 0; i < 55; i++ {
		closes[i] = 100.0
		volumes[i] = 1000.0
	}
	closes[54] = 100.1

	sig, err := strat.Evaluate(context.Background(), time.Now(), "TEST", closes, volumes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sig.Signal != SignalBuy {
		t.Errorf("expected SignalBuy when EnableTrendFilter=false, got %v", sig.Signal)
	}
}
