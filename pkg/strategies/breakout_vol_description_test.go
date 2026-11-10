package strategies

import (
	"context"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestBreakoutVolDescriptionAccurate(t *testing.T) {
	s := NewBreakoutVolStrategy()
	if s.Name() != "BreakoutVol" || s.ATRExpansionMultiplier != 1.25 || s.ATRPeriod != 14 || s.ATRStopMultiplier != .5 || s.ATRTargetMultiplier != 1.5 {
		t.Fatal("description correction changed identity or defaults")
	}
	want := "Close-to-close volatility expansion against ATR-from-closes times a configurable multiplier (default 1.25). Volume is unused; scores 50/90 are fixed diagnostics, not calibrated probabilities."
	if s.Description() != want {
		t.Fatal("description no longer matches the declared calculation boundary")
	}
	s.SetParams(map[string]float64{"atr_expansion_multiplier": 3})
	if !strings.Contains(s.Description(), "configurable") || !strings.Contains(s.Description(), "default 1.25") || s.ATRExpansionMultiplier != 3 {
		t.Fatal("default description must not imply every configured run uses1.25")
	}
}

func TestBreakoutVolVolumeIndependenceAndDiagnosticValues(t *testing.T) {
	at := time.Unix(1700000000, 0).UTC()
	for _, direction := range []float64{-10, 0, 10} {
		closes := make([]float64, 20)
		for i := range closes {
			closes[i] = 100
		}
		closes[19] += direction
		var expected StrategySignal
		for caseIndex, volumes := range [][]float64{nil, {}, make([]float64, 20), {1}, {1e12, 0, 1e12}} {
			s := NewBreakoutVolStrategy()
			got, err := s.Evaluate(context.Background(), at, "TEST", closes, volumes)
			if err != nil {
				t.Fatal(err)
			}
			if caseIndex == 0 {
				expected = got
			} else if !reflect.DeepEqual(expected, got) {
				t.Fatal("volume unexpectedly changed the complete signal")
			}
			wantSignal, wantScore := SignalHold, float64(50)
			if direction > 0 {
				wantSignal, wantScore = SignalBuy, 90
			} else if direction < 0 {
				wantSignal, wantScore = SignalSell, 90
			}
			// Hand oracle:13 zero differences plus |direction|, averaged
			// across14 changes and multiplied by the unchanged helper's1.5.
			proxy := math.Abs(direction) / 14 * 1.5
			if got.Signal != wantSignal || got.Score != wantScore || got.StopLossPct != (proxy*.5/closes[19])*100 || got.TargetPct != (proxy*1.5/closes[19])*100 || got.Timestamp != at || got.Symbol != "TEST" || got.StrategyName != "BreakoutVol" || got.AssetClass != AssetEquity {
				t.Fatalf("fixed diagnostic/protection calculation changed: %+v", got)
			}
		}
	}
}

func TestBreakoutVolStrictConfiguredThresholdUnchanged(t *testing.T) {
	closes := make([]float64, 20)
	for i := range closes {
		closes[i] = 100
	}
	closes[19] = 110
	at := time.Unix(1700000000, 0).UTC()
	for _, multiplier := range []float64{1.25, 20} {
		s := NewBreakoutVolStrategy()
		s.SetParams(map[string]float64{"atr_expansion_multiplier": multiplier})
		got, err := s.Evaluate(context.Background(), at, "TEST", closes, nil)
		if err != nil {
			t.Fatal(err)
		}
		want, score := SignalBuy, float64(90)
		if multiplier == 20 {
			want, score = SignalHold, 50
		}
		if got.Signal != want || got.Score != score {
			t.Fatal("configured threshold behavior changed")
		}
	}
}
