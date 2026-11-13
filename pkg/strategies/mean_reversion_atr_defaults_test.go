package strategies

import (
	"context"
	"math"
	"testing"
	"time"
)

func TestMeanReversionATRDefaults(t *testing.T) {
	s := NewMeanReversionStrategy()
	if s.ATRStopMultiplier != 0.5 || s.ATRTargetMultiplier != 1.5 {
		t.Errorf("constructor multipliers = (%v, %v), want (0.5, 1.5)", s.ATRStopMultiplier, s.ATRTargetMultiplier)
	}
	closes := make([]float64, 20)
	for i := range closes {
		closes[i] = 100
	}
	closes[19] = 80
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	got, err := s.Evaluate(context.Background(), at, "TEST", closes, make([]float64, 20))
	if err != nil {
		t.Fatal(err)
	}
	if got.Signal != SignalBuy || got.Score != 85 || got.AssetClass != AssetEquity || got.StrategyName != "MeanReversion" || got.Symbol != "TEST" || !got.Timestamp.Equal(at) || got.Rationale != "Close: $80.00 | LowerBand: $90.28 | RSI: 0.0 | Oversold Bounce Triggered (BUY)" {
		t.Errorf("unexpected signal: %+v", got)
	}
	// The hand-derived fractions are compared with absolute tolerance for float rounding.
	if math.IsNaN(got.StopLossPct) || math.IsInf(got.StopLossPct, 0) || math.Abs(got.StopLossPct-75.0/56) > 1e-12 || math.IsNaN(got.TargetPct) || math.IsInf(got.TargetPct, 0) || math.Abs(got.TargetPct-225.0/56) > 1e-12 {
		t.Errorf("protection = (%v, %v), want (%v, %v)", got.StopLossPct, got.TargetPct, 75.0/56, 225.0/56)
	}
}

func TestMeanReversionATROverridesAndRegistry(t *testing.T) {
	closes := make([]float64, 20)
	for i := range closes {
		closes[i] = 100
	}
	closes[19] = 80
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	cases := []struct {
		name         string
		params       map[string]float64
		stop, target float64
	}{
		{"nil", nil, 75.0 / 56, 225.0 / 56}, {"empty", map[string]float64{}, 75.0 / 56, 225.0 / 56},
		{"stop only", map[string]float64{"atr_stop_multiplier": 0.75}, 225.0 / 112, 225.0 / 56},
		{"target only", map[string]float64{"atr_target_multiplier": 2}, 75.0 / 56, 75.0 / 14},
		{"both", map[string]float64{"atr_stop_multiplier": 0.75, "atr_target_multiplier": 2}, 225.0 / 112, 75.0 / 14},
		{"zero", map[string]float64{"atr_stop_multiplier": 0, "atr_target_multiplier": 0}, 75.0 / 56, 225.0 / 56},
		{"negative", map[string]float64{"atr_stop_multiplier": -1, "atr_target_multiplier": -1}, 75.0 / 56, 225.0 / 56},
		{"mixed", map[string]float64{"atr_stop_multiplier": 0, "atr_target_multiplier": -1}, 75.0 / 56, 225.0 / 56},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := NewMeanReversionStrategy()
			s.SetParams(tc.params)
			got, err := s.Evaluate(context.Background(), at, "TEST", closes, make([]float64, 20))
			if err != nil {
				t.Fatal(err)
			}
			if math.Abs(got.StopLossPct-tc.stop) > 1e-12 || math.Abs(got.TargetPct-tc.target) > 1e-12 {
				t.Errorf("protection = (%v,%v), want (%v,%v)", got.StopLossPct, got.TargetPct, tc.stop, tc.target)
			}
		})
	}
	s := NewMeanReversionStrategy()
	s.SetParams(map[string]float64{"atr_stop_multiplier": 0.75, "atr_target_multiplier": 2})
	s.SetParams(map[string]float64{"atr_stop_multiplier": 0, "atr_target_multiplier": -1})
	explicit := NewMeanReversionStrategy()
	explicit.ATRStopMultiplier, explicit.ATRTargetMultiplier = 0.75, 2
	a, err := s.Evaluate(context.Background(), at, "TEST", closes, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := explicit.Evaluate(context.Background(), at, "TEST", closes, nil)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("configured signals differ: %+v vs %+v", a, b)
	}
	reg := NewRegistry()
	registered := NewMeanReversionStrategy()
	if err := registered.Init(nil); err != nil {
		t.Fatal(err)
	}
	reg.Register(registered)
	entry, err := reg.Get("MeanReversion")
	if err != nil {
		t.Fatal(err)
	}
	retrieved, ok := entry.(*MeanReversionStrategy)
	if !ok {
		t.Fatalf("unexpected type %T", entry)
	}
	if retrieved.ATRStopMultiplier != 0.5 || retrieved.ATRTargetMultiplier != 1.5 {
		t.Fatalf("registry multipliers = (%v,%v)", retrieved.ATRStopMultiplier, retrieved.ATRTargetMultiplier)
	}
	got, err := retrieved.Evaluate(context.Background(), at, "TEST", closes, nil)
	if err != nil {
		t.Fatal(err)
	}
	direct, err := NewMeanReversionStrategy().Evaluate(context.Background(), at, "TEST", closes, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got != direct || math.Abs(got.StopLossPct-75.0/56) > 1e-12 || math.Abs(got.TargetPct-225.0/56) > 1e-12 {
		t.Errorf("registry signal = %+v, direct = %+v", got, direct)
	}
}

func TestMeanReversionATRSignalCompatibility(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	neutral, chop, oversold, overbought := make([]float64, 50), make([]float64, 50), make([]float64, 50), make([]float64, 50)
	for i := 0; i < 50; i++ {
		neutral[i] = 99 + float64(i%2)*2
		chop[i] = 100 + float64(i%2)*0.05
		oversold[i], overbought[i] = 105-float64(i%2)*10, 105-float64(i%2)*10
	}
	neutral[49] = 100
	chop[48], chop[49] = 99.8, 99.8
	for i := 45; i < 50; i++ {
		oversold[i] = 90 - float64(i-45)*10
		overbought[i] = 110 + float64(i-45)*10
	}
	for name, closes := range map[string][]float64{"neutral": neutral, "chop": chop, "oversold": oversold, "overbought": overbought} {
		t.Run(name, func(t *testing.T) {
			defaults, zero := NewMeanReversionStrategy(), NewMeanReversionStrategy()
			zero.ATRStopMultiplier, zero.ATRTargetMultiplier = 0, 0
			a, err := defaults.Evaluate(context.Background(), at, "TEST", closes, nil)
			if err != nil {
				t.Fatal(err)
			}
			b, err := zero.Evaluate(context.Background(), at, "TEST", closes, nil)
			if err != nil {
				t.Fatal(err)
			}
			a.StopLossPct, a.TargetPct = 0, 0
			if a != b {
				t.Errorf("non-protection fields differ: %+v vs %+v", a, b)
			}
			configured, explicit := NewMeanReversionStrategy(), NewMeanReversionStrategy()
			configured.SetParams(map[string]float64{"atr_stop_multiplier": 0.75, "atr_target_multiplier": 2})
			explicit.ATRStopMultiplier, explicit.ATRTargetMultiplier = 0.75, 2
			c, err := configured.Evaluate(context.Background(), at, "TEST", closes, nil)
			if err != nil {
				t.Fatal(err)
			}
			d, err := explicit.Evaluate(context.Background(), at, "TEST", closes, nil)
			if err != nil {
				t.Fatal(err)
			}
			if c != d {
				t.Errorf("configured signals differ: %+v vs %+v", c, d)
			}
		})
	}
}
