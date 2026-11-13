package backtest

import (
	"context"
	"math"
	"testing"
	"time"

	"gelt/pkg/strategies"
)

func TestMeanReversionATRDefaultsCausal(t *testing.T) {
	bars := make([]OHLCV, 21)
	for i := range bars {
		price := 100.0
		if i >= 19 {
			price = 80
		}
		bars[i] = OHLCV{Timestamp: 1700000000 + int64(i)*60, Open: price, High: price, Low: price, Close: price, Volume: 1}
	}
	bars[20].Low = 78
	for _, disabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "defaults", true: "explicit zero"}[disabled], func(t *testing.T) {
			s := strategies.NewMeanReversionStrategy()
			if disabled {
				s.ATRStopMultiplier = 0
				s.ATRTargetMultiplier = 0
			}
			got, err := NewStrategyEngine(s).RunCausal(context.Background(), "TEST", bars)
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Evaluations) != 2 || !got.PendingSignalUnfilled {
				t.Fatalf("evaluations/pending: %+v", got)
			}
			for i, e := range got.Evaluations {
				if e.BarIndex != 19+i || e.Signal != strategies.SignalBuy || e.Score != 85 {
					t.Errorf("evaluation %d: %+v", i, e)
				}
			}
			if len(got.Fills) == 0 {
				t.Fatal("missing entry")
			}
			entry := got.Fills[0]
			if entry.Kind != CausalEntry || entry.Reason != CausalNextOpenBuy || entry.BarIndex != 20 || entry.EvaluationBarIndex != 19 || entry.EntrySignalBarIndex != 19 || entry.EntryBarIndex != 20 || entry.Price != 80 || entry.Quantity != 0.125 || !entry.Timestamp.Equal(time.Unix(bars[20].Timestamp, 0).UTC()) || entry.Ambiguous {
				t.Errorf("entry: %+v", entry)
			}
			if disabled {
				if len(got.Fills) != 1 || got.TerminalPosition == nil || got.TerminalPosition.StopLoss != 0 || got.TerminalPosition.Target != 0 || got.TerminalPosition.StopEvaluationBarIndex != -1 || got.TerminalPosition.TargetEvaluationBarIndex != -1 || got.ClosedTradeCount != 0 {
					t.Errorf("disabled result: %+v", got)
				}
				return
			}
			if len(got.Fills) != 2 || got.TerminalPosition != nil || got.ClosedTradeCount != 1 || got.WinningClosedTradeCount != 0 || math.Abs(got.GrossRealizedPnL-(-15.0/112)) > 1e-12 || math.Abs(got.GrossLoss-15.0/112) > 1e-12 || got.GrossProfit != 0 {
				t.Fatalf("result: %+v", got)
			}
			exit := got.Fills[1]
			if exit.Kind != CausalExit || exit.Reason != CausalStopTouch || exit.BarIndex != 20 || exit.EvaluationBarIndex != 19 || exit.EntrySignalBarIndex != 19 || exit.EntryBarIndex != 20 || math.Abs(exit.Price-1105.0/14) > 1e-12 || math.Abs(exit.Target-1165.0/14) > 1e-12 || exit.Quantity != 0.125 || !exit.Timestamp.Equal(time.Unix(bars[20].Timestamp, 0).UTC()) || exit.Ambiguous {
				t.Errorf("exit: %+v", exit)
			}
		})
	}
}
