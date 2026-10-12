package main

import (
	"context"
	"fmt"
	"math/rand"
	"testing"

	"gelt/pkg/backtest"
	"gelt/pkg/plans"
)

func TestSyntheticBacktestBarsPassHistoricalValidation(t *testing.T) {
	const now = int64(1_800_000_000)
	for _, basePrice := range []float64{150, 250, 450, 500} {
		t.Run(fmt.Sprintf("base-%.0f", basePrice), func(t *testing.T) {
			bars := generateSyntheticBacktestBars(basePrice, 100, rand.New(rand.NewSource(42)), now)
			if len(bars) != 100 {
				t.Fatalf("got %d bars, want 100", len(bars))
			}
			for i, bar := range bars {
				if bar.Timestamp != now-int64((100-i)*86400) {
					t.Fatalf("bar %d: unexpected timestamp %d", i, bar.Timestamp)
				}
				if bar.Low <= 0 || bar.Low > bar.Open || bar.Low > bar.Close || bar.High < bar.Open || bar.High < bar.Close || bar.Volume < 0 {
					t.Fatalf("bar %d: invalid synthetic OHLCV: %+v", i, bar)
				}
			}

			plan, err := plans.DefaultPlanSuite().Get("IntradayAlphaPlan")
			if err != nil {
				t.Fatal(err)
			}
			result, err := backtest.NewPlanEngine(plan).Run(context.Background(), "SPY", bars)
			if err != nil {
				t.Fatalf("synthetic bars must pass backtest preflight: %v", err)
			}
			if result.TotalBars != len(bars) {
				t.Fatalf("got %d replayed bars, want %d", result.TotalBars, len(bars))
			}
		})
	}
}
