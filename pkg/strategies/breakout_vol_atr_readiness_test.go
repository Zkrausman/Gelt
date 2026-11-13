package strategies

import (
	"context"
	"fmt"
	"gelt/pkg/signals"
	"testing"
	"time"
)

func TestBreakoutATRReadiness(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	evaluate := func(period int, c []float64) (StrategySignal, error) {
		s := NewBreakoutVolStrategy()
		s.Init(nil)
		s.SetParams(map[string]float64{"atr_period": float64(period)})
		return s.Evaluate(context.Background(), at, "TEST", c, make([]float64, len(c)))
	}
	for _, period := range []int{20, 50} {
		for _, last := range []float64{99, 100, 101} {
			t.Run(fmt.Sprintf("missing_%d_%v", period, last), func(t *testing.T) {
				c := make([]float64, 20)
				for i := range c {
					c[i] = 100
				}
				c[19] = last
				if _, err := signals.CalculateATRFromCloses(c, period); err == nil {
					t.Fatal("helper accepted missing history")
				}
				got, err := evaluate(period, c)
				if err == nil || got != (StrategySignal{}) {
					t.Fatalf("got %#v, %v", got, err)
				}
			})
		}
	}
	for _, tc := range []struct{ period, n int }{{19, 20}, {20, 21}, {50, 51}} {
		t.Run(fmt.Sprintf("boundary_%d", tc.period), func(t *testing.T) {
			c := make([]float64, tc.n)
			for i := range c {
				c[i] = 100 + float64(i)
			}
			got, err := evaluate(tc.period, c)
			last := c[len(c)-1]
			want := StrategySignal{AssetClass: AssetEquity, StrategyName: "BreakoutVol", Symbol: "TEST", Signal: SignalHold, Score: 50, StopLossPct: (1.5 * 0.5 / last) * 100, TargetPct: (1.5 * 1.5 / last) * 100, Rationale: "Price Change: $1.00 | ATR: $1.50", Timestamp: at}
			if err != nil || got != want {
				t.Fatalf("got %#v, %v; want %#v", got, err, want)
			}
		})
	}
	for _, tc := range []struct{ period, n int }{{14, 20}, {20, 21}, {50, 51}} {
		c := make([]float64, tc.n)
		for i := range c {
			c[i] = 100
		}
		got, err := evaluate(tc.period, c)
		if err != nil || got.Signal != SignalHold || got.Score != 50 || got.StopLossPct != 0 || got.TargetPct != 0 {
			t.Fatalf("flat %d: %#v %v", tc.period, got, err)
		}
	}
	for _, last := range []float64{99, 100, 101} {
		c := make([]float64, 20)
		for i := range c {
			c[i] = 100
		}
		c[19] = last
		base, err := evaluate(14, c)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range []int{0, -1} {
			got, err := evaluate(p, c)
			if err != nil || got != base {
				t.Fatalf("fallback %d: %#v %v", p, got, err)
			}
		}
		atr := 1.5 / 14
		if last == 100 {
			atr = 0
		}
		change := last - 100
		sig, score, rationale := SignalHold, 50.0, fmt.Sprintf("Price Change: $%.2f | ATR: $%.2f", change, atr)
		if last > 100 {
			sig, score = SignalBuy, 90
			rationale += " | Bullish Volatility Expansion Breakout (BUY)"
		}
		if last < 100 {
			sig, score = SignalSell, 90
			rationale += " | Bearish Volatility Breakdown (SELL)"
		}
		want := StrategySignal{AssetClass: AssetEquity, StrategyName: "BreakoutVol", Symbol: "TEST", Signal: sig, Score: score, StopLossPct: (atr * 0.5 / last) * 100, TargetPct: (atr * 1.5 / last) * 100, Rationale: rationale, Timestamp: at}
		if base != want {
			t.Fatalf("default got %#v want %#v", base, want)
		}
	}
	for _, p := range []int{14, 20, 50} {
		got, err := evaluate(p, make([]float64, 19))
		if err == nil || err.Error() != "insufficient data for breakout strategy: 19 candles" || got != (StrategySignal{}) {
			t.Fatalf("minimum %d: %#v %v", p, got, err)
		}
	}
}
