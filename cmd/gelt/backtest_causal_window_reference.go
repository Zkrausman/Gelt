package main

import (
	"context"
	"math"
	"reflect"
	"strconv"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

// windowReferenceEvents checks event opportunities against consumed OHLC and
// normalized records. It does not calculate indicators or authenticate data.
type windowReferencePosition struct {
	entry, quantity, peak, stop, target       float64
	entrySignal, entryBar, stopBar, targetBar int
}

func windowReferenceEvents(ctx context.Context, bars []backtest.OHLCV, r backtest.ExecutionScenarioCausalResult, initial, fixed, bps, target, buy, sell int64) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil || len(bars) < 1 || len(bars) > backtest.CausalMaxBars {
		return false
	}
	replay := r.ReferenceReplay
	n := len(bars)
	count := n - 19
	if count < 0 {
		count = 0
	}
	if replay.TotalBars != n || len(replay.Evaluations) != count || len(replay.Fills) > backtest.CausalMaxFills || len(r.RejectedEntries) > n || initial < 0 || initial > fundedCLIMaxUnits || fixed < 0 || fixed >= fundedCLIEntryUnits || bps < 0 || bps > 10000 || target < 0 || target > fundedCLIEntryUnits || buy < 0 || buy > 9999 || sell < 0 || sell > 9999 {
		return false
	}
	for i, b := range bars {
		if ctx.Err() != nil || b.Timestamp < 1 || b.Timestamp > 253402300799 || i > 0 && b.Timestamp <= bars[i-1].Timestamp || !causalCLIFinite(b.Open, .01, 1000000) || !causalCLIFinite(b.High, .01, 1000000) || !causalCLIFinite(b.Low, .01, 1000000) || !causalCLIFinite(b.Close, .01, 1000000) || !causalCLIFinite(b.Volume, 0, 1e12) || b.Low > b.Open || b.Low > b.Close || b.Open > b.High || b.Close > b.High {
			return false
		}
	}
	for i, e := range replay.Evaluations {
		index := i + 19
		if ctx.Err() != nil || e.BarIndex != index || e.PrefixLength != index+1 || len(e.Components) != 0 || !e.Timestamp.Equal(time.Unix(bars[index].Timestamp, 0).UTC()) || !fundedCLISignalValid(e.CausalSignal, replay) || !(e.StopLossPct == 0 || causalCLIFinite(e.StopLossPct, .01, 99.99)) || !(e.TargetPct == 0 || causalCLIFinite(e.TargetPct, .01, 1000)) {
			return false
		}
	}
	for _, f := range replay.Fills {
		if ctx.Err() != nil || f.BarIndex < 20 || f.BarIndex >= n || f.EvaluationBarIndex < 19 || f.EvaluationBarIndex >= f.BarIndex || f.EntrySignalBarIndex < 19 || f.EntrySignalBarIndex >= n || f.EntryBarIndex != f.EntrySignalBarIndex+1 || f.EntryBarIndex > f.BarIndex {
			return false
		}
	}
	for _, x := range r.RejectedEntries {
		if ctx.Err() != nil || x.BarIndex < 20 || x.BarIndex >= n || x.EvaluationBarIndex != x.BarIndex-1 {
			return false
		}
	}
	cash := initial
	var pos *windowReferencePosition
	var pending *backtest.CausalEvaluation
	fillIndex, rejectedIndex := 0, 0
	for i, bar := range bars {
		if ctx.Err() != nil {
			return false
		}
		exited := false
		emit := func(kind backtest.CausalFillKind, reason backtest.CausalFillReason, source int, price float64, ambiguous bool) bool {
			if pos == nil || fillIndex >= len(replay.Fills) {
				return false
			}
			pnl := 0.0
			if kind == backtest.CausalExit {
				pnl = (price - pos.entry) * pos.quantity
			}
			expected := backtest.CausalFill{Kind: kind, Reason: reason, BarIndex: i, Timestamp: time.Unix(bar.Timestamp, 0).UTC(), EvaluationBarIndex: source, EntrySignalBarIndex: pos.entrySignal, EntryBarIndex: pos.entryBar, Price: price, Quantity: pos.quantity, Notional: price * pos.quantity, GrossRealizedPnL: pnl, StopLoss: pos.stop, Target: pos.target, Ambiguous: ambiguous}
			if !reflect.DeepEqual(expected, replay.Fills[fillIndex]) {
				return false
			}
			fillIndex++
			rate := sell
			if kind == backtest.CausalEntry {
				rate = buy
			}
			execution, ok := executionCLIPrice(price, rate, kind)
			if !ok {
				return false
			}
			gross, ok := fundedCLIQuote(execution, pos.quantity)
			if !ok {
				return false
			}
			fee, ok := executionScenarioCLICharge(gross, fixed, bps)
			if !ok {
				return false
			}
			delta := gross - fee
			if kind == backtest.CausalEntry {
				delta = -gross - fee
			}
			next, ok := executionScenarioCLIAdd(cash, delta)
			if !ok || next < 0 || next > fundedCLIMaxUnits {
				return false
			}
			cash = next
			if kind == backtest.CausalExit {
				pos = nil
				exited = true
			}
			return true
		}
		if pos != nil {
			switch {
			case pos.stop > 0 && bar.Open <= pos.stop:
				if !emit(backtest.CausalExit, backtest.CausalStopGap, pos.stopBar, bar.Open, false) {
					return false
				}
			case pos.target > 0 && bar.Open >= pos.target:
				if !emit(backtest.CausalExit, backtest.CausalTargetGap, pos.targetBar, pos.target, false) {
					return false
				}
			case pending != nil && pending.Signal == strategies.SignalSell:
				if !emit(backtest.CausalExit, backtest.CausalNextOpenSell, pending.BarIndex, bar.Open, false) {
					return false
				}
			}
		}
		if !exited && pos == nil && pending != nil && pending.Signal == strategies.SignalBuy {
			execution, ok := executionCLIPrice(bar.Open, buy, backtest.CausalEntry)
			if !ok {
				return false
			}
			quantity, ok := comparisonCLIQuantity(execution, target, fixed == 0 && bps == 0 && buy == 0)
			if !ok {
				return false
			}
			fee, ok := executionScenarioCLICharge(target, fixed, bps)
			if !ok {
				return false
			}
			debit, ok := executionScenarioCLIAdd(target, fee)
			if !ok || debit <= 0 || debit > fundedCLIEntryUnits {
				return false
			}
			if cash < debit {
				expected := backtest.ExecutionScenarioCausalRejectedEntry{Reason: backtest.FundedInsufficientModelCash, BarIndex: i, Timestamp: time.Unix(bar.Timestamp, 0).UTC(), EvaluationBarIndex: pending.BarIndex, EvaluationTimestamp: pending.Timestamp, AvailableModelCashUnits: strconv.FormatInt(cash, 10), GrossNotionalUnits: strconv.FormatInt(target, 10), FeeUnits: strconv.FormatInt(fee, 10), RequiredModelCashUnits: strconv.FormatInt(debit, 10)}
				if rejectedIndex >= len(r.RejectedEntries) || !reflect.DeepEqual(expected, r.RejectedEntries[rejectedIndex]) {
					return false
				}
				rejectedIndex++
			} else {
				pos = &windowReferencePosition{entry: bar.Open, quantity: quantity, peak: bar.Open, entrySignal: pending.BarIndex, entryBar: i, stopBar: -1, targetBar: -1}
				if pending.StopLossPct > 0 {
					pos.stop = bar.Open - bar.Open*pending.StopLossPct/100
					pos.stopBar = pending.BarIndex
				}
				if pending.TargetPct > 0 {
					pos.target = bar.Open + bar.Open*pending.TargetPct/100
					pos.targetBar = pending.BarIndex
				}
				if !windowReferenceLevels(pos.stop, pos.target) || !emit(backtest.CausalEntry, backtest.CausalNextOpenBuy, pending.BarIndex, bar.Open, false) {
					return false
				}
			}
		}
		pending = nil
		if pos != nil {
			stop := pos.stop > 0 && bar.Low <= pos.stop
			hitTarget := pos.target > 0 && bar.High >= pos.target
			if stop {
				if !emit(backtest.CausalExit, backtest.CausalStopTouch, pos.stopBar, pos.stop, hitTarget) {
					return false
				}
			} else if hitTarget {
				if !emit(backtest.CausalExit, backtest.CausalTargetTouch, pos.targetBar, pos.target, false) {
					return false
				}
			}
		}
		if i >= 19 {
			e := replay.Evaluations[i-19]
			if pos != nil {
				if pos.stop > 0 && e.StopLossPct == 0 || pos.target > 0 && e.TargetPct == 0 {
					return false
				}
				pos.peak = math.Max(pos.peak, bar.High)
				if e.StopLossPct > 0 {
					candidate := pos.peak - pos.peak*e.StopLossPct/100
					if candidate > pos.stop {
						pos.stop = candidate
						pos.stopBar = i
					}
				}
				if e.TargetPct > 0 {
					candidate := pos.entry + pos.entry*e.TargetPct/100
					if candidate != pos.target {
						pos.target = candidate
						pos.targetBar = i
					}
				}
				if !windowReferenceLevels(pos.stop, pos.target) {
					return false
				}
			}
			pending = &replay.Evaluations[i-19]
		}
	}
	if fillIndex != len(replay.Fills) || rejectedIndex != len(r.RejectedEntries) {
		return false
	}
	if pos == nil {
		return replay.TerminalPosition == nil
	}
	last := len(bars) - 1
	p := backtest.CausalTerminalPosition{Quantity: pos.quantity, EntryPrice: pos.entry, LastClosePrice: bars[last].Close, GrossUnrealizedPnL: (bars[last].Close - pos.entry) * pos.quantity, PeakPrice: pos.peak, StopLoss: pos.stop, Target: pos.target, StopEvaluationBarIndex: pos.stopBar, TargetEvaluationBarIndex: pos.targetBar, EntrySignalBarIndex: pos.entrySignal, EntrySignalTimestamp: time.Unix(bars[pos.entrySignal].Timestamp, 0).UTC(), EntryBarIndex: pos.entryBar, EntryTimestamp: time.Unix(bars[pos.entryBar].Timestamp, 0).UTC(), LastBarIndex: last, LastTimestamp: time.Unix(bars[last].Timestamp, 0).UTC()}
	return reflect.DeepEqual(&p, replay.TerminalPosition)
}
func windowReferenceLevels(stop, target float64) bool {
	return (stop == 0 || causalCLIFinite(stop, math.SmallestNonzeroFloat64, 11000000)) && (target == 0 || causalCLIFinite(target, math.SmallestNonzeroFloat64, 11000000)) && (stop == 0 || target == 0 || stop < target)
}
