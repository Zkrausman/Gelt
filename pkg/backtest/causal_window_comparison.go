package backtest

import (
	"context"
	"reflect"
	"strconv"
	"time"
)

const (
	WindowComparisonModelIdentity                   = "gelt.legacy-go.declared-window-comparison.v1"
	WindowComparisonSelectionPolicy                 = "exact20_prior_bars_start_inclusive_end_exclusive.v1"
	WindowInvalidWindow             CausalErrorCode = "invalid_window"
	WindowInsufficientWarmup        CausalErrorCode = "insufficient_warmup"
	WindowInvalidResult             CausalErrorCode = "invalid_result"
)

type DeclaredComparisonWindow struct{ StartInclusiveUnix, EndExclusiveUnix int64 }
type WindowComparisonScore struct {
	ModelIdentity, StartingEquityUnits                                                    string
	EndingCashUnits, EndingPositionValueUnits, EndingEquityUnits                          string
	NetRealizedAccountingPnLUnits, NetUnrealizedAccountingPnLUnits, NetAccountingPnLUnits string
	AggregateFeeUnits                                                                     string
	EndingModelQuantity                                                                   float64
	MaxCloseMarkDrawdown                                                                  FundedCausalDrawdown
	DrawdownSourceBarIndex, DrawdownScoredBarIndex                                        *int
}
type WindowComparisonResult struct {
	ModelIdentity, SelectionPolicy, DataLabel, AuthorityLabel, SelectionHistory                  string
	Window                                                                                       DeclaredComparisonWindow
	SourceTotalBars, WarmupStartSourceIndex, ScoreStartSourceIndex, ScoreEndExclusiveSourceIndex int
	ExcludedBeforeWarmupCount, ExcludedAfterScoreCount, WarmupBars, ScoredBars, ConsumedBars     int
	Replay                                                                                       ComparisonCausalResult
	Strategy, Cash, Passive                                                                      WindowComparisonScore
}
type WindowComparisonError struct {
	Code     CausalErrorCode
	BarIndex int
}

func (e *WindowComparisonError) Error() string {
	if e != nil {
		switch e.Code {
		case WindowInvalidWindow, WindowInsufficientWarmup, WindowInvalidResult,
			FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash,
			CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity,
			CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
			return "window comparison: " + string(e.Code)
		}
	}
	return "window comparison: invalid_result"
}
func windowFailure(code CausalErrorCode, index int) (WindowComparisonResult, error) {
	switch code {
	case WindowInvalidWindow, WindowInsufficientWarmup, WindowInvalidResult, FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash, CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
	default:
		code, index = WindowInvalidResult, -1
	}
	return WindowComparisonResult{}, &WindowComparisonError{code, index}
}

// Precondition: the full private source copy has passed causalValidateBars.
func windowSelect(ctx context.Context, bars []OHLCV, w DeclaredComparisonWindow) (int, int, CausalErrorCode) {
	if w.StartInclusiveUnix < 1 || w.StartInclusiveUnix > causalMaxTimestamp || w.EndExclusiveUnix < 2 || w.EndExclusiveUnix > causalMaxTimestamp+1 || w.StartInclusiveUnix >= w.EndExclusiveUnix {
		return 0, 0, WindowInvalidWindow
	}
	s, e := -1, -1
	for i, b := range bars {
		if ctx.Err() != nil {
			return 0, 0, CausalCanceled
		}
		if b.Timestamp == w.StartInclusiveUnix {
			s = i
		}
		if b.Timestamp == w.EndExclusiveUnix {
			e = i
		}
	}
	if len(bars) > 0 && w.EndExclusiveUnix == bars[len(bars)-1].Timestamp+1 {
		e = len(bars)
	}
	if s < 0 || e <= s {
		return 0, 0, WindowInvalidWindow
	}
	if s < 20 {
		return 0, 0, WindowInsufficientWarmup
	}
	return s, e, ""
}

// RunWindowComparisonCausal selects one interval and invokes the shipped replay
// once. It requires exclusively owned input and a fresh trusted evaluator; it
// does not independently prove strategy fills against original OHLC geometry.
func (e *Engine) RunWindowComparisonCausal(ctx context.Context, symbol string, data []OHLCV, w DeclaredComparisonWindow, cash string, scenario ExecutionScenario) (WindowComparisonResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return windowFailure(CausalCanceled, -1)
	}
	initial, ok := fundedParseCash(cash)
	if !ok {
		return windowFailure(FundedInvalidModelCash, -1)
	}
	if _, _, _, ok = feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps}); !ok {
		return windowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if _, ok = executionScenarioRate(scenario.BuyAdverseBps); !ok {
		return windowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if _, ok = executionScenarioRate(scenario.SellAdverseBps); !ok {
		return windowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if len(data) > CausalMaxBars {
		return windowFailure(CausalResourceLimit, -1)
	}
	full := append([]OHLCV(nil), data...)
	if i, code := causalValidateBars(full); code != "" {
		return windowFailure(code, i)
	}
	if ctx.Err() != nil {
		return windowFailure(CausalCanceled, -1)
	}
	if !causalSymbol(symbol) {
		return windowFailure(CausalInvalidSymbol, -1)
	}
	s, end, code := windowSelect(ctx, full, w)
	if code != "" {
		return windowFailure(code, -1)
	}
	if e == nil || causalNil(e.strategy) == causalNil(e.plan) {
		return windowFailure(CausalInvalidEvaluator, -1)
	}
	if !causalNil(e.plan) {
		return windowFailure(CausalUnsupported, -1)
	}
	name := e.strategy.Name()
	if !causalName(name) {
		return windowFailure(CausalInvalidEvaluator, -1)
	}
	if name != "BreakoutVol" {
		return windowFailure(CausalUnsupported, -1)
	}
	offset := s - 20
	consumed := append([]OHLCV(nil), full[offset:end]...)
	replay, err := e.RunComparisonCausal(ctx, symbol, consumed, cash, scenario)
	if err != nil {
		failure, ok := err.(*ComparisonCausalError)
		if !ok || failure == nil {
			return windowFailure(WindowInvalidResult, -1)
		}
		index := failure.BarIndex
		if index < -1 || index >= len(consumed) {
			return windowFailure(WindowInvalidResult, -1)
		}
		if index >= 0 {
			index += offset
		}
		return windowFailure(failure.Code, index)
	}
	if ctx.Err() != nil {
		return windowFailure(CausalCanceled, -1)
	}
	if !windowReplayShape(ctx, replay, consumed, symbol, initial) {
		if ctx.Err() != nil {
			return windowFailure(CausalCanceled, -1)
		}
		return windowFailure(WindowInvalidResult, -1)
	}
	r := WindowComparisonResult{ModelIdentity: WindowComparisonModelIdentity, SelectionPolicy: WindowComparisonSelectionPolicy, DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel, SelectionHistory: "unestablished", Window: w, SourceTotalBars: len(full), WarmupStartSourceIndex: offset, ScoreStartSourceIndex: s, ScoreEndExclusiveSourceIndex: end, ExcludedBeforeWarmupCount: offset, ExcludedAfterScoreCount: len(full) - end, WarmupBars: 20, ScoredBars: end - s, ConsumedBars: len(consumed), Replay: replay}
	r.Strategy, ok = windowScore(ctx, replay.Strategy.ModelIdentity, replay.Strategy.CloseMarks, initial, offset, replay.Strategy.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return windowFailure(CausalCanceled, -1)
		}
		return windowFailure(WindowInvalidResult, -1)
	}
	r.Cash, ok = windowScore(ctx, replay.Cash.ModelIdentity, replay.Cash.CloseMarks, initial, offset, replay.Cash.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return windowFailure(CausalCanceled, -1)
		}
		return windowFailure(WindowInvalidResult, -1)
	}
	r.Passive, ok = windowScore(ctx, replay.Passive.ModelIdentity, replay.Passive.CloseMarks, initial, offset, replay.Passive.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return windowFailure(CausalCanceled, -1)
		}
		return windowFailure(WindowInvalidResult, -1)
	}
	if ctx.Err() != nil {
		return windowFailure(CausalCanceled, -1)
	}
	return r, nil
}

func windowReplayShape(ctx context.Context, r ComparisonCausalResult, bars []OHLCV, symbol string, initial int64) bool {
	n := len(bars)
	if n < 21 || n > CausalMaxBars || r.ModelIdentity != ComparisonCausalModelIdentity || r.Symbol != symbol || r.TotalBars != n || r.Scale != 8 || r.InitialModelCashUnits != fundedUnits(initial) || r.CostIdentity != ExecutionScenarioCausalCostIdentity || r.ScenarioBasis != ExecutionScenarioCausalBasis || r.DataLabel != CausalOfflineLabel || r.AuthorityLabel != CausalOfflineLabel || r.Strategy.ModelIdentity != ExecutionScenarioCausalModelIdentity || r.Cash.ModelIdentity != ComparisonCashModelIdentity || r.Passive.ModelIdentity != ComparisonPassiveModelIdentity {
		return false
	}
	if r.Strategy.CostIdentity != r.CostIdentity || r.Strategy.Scenario != r.Scenario || r.Strategy.InitialModelCashUnits != r.InitialModelCashUnits || r.Cash.Symbol != symbol || r.Passive.Symbol != symbol || r.Cash.TotalBars != n || r.Passive.TotalBars != n || r.Cash.Scale != 8 || r.Passive.Scale != 8 || r.Cash.InitialModelCashUnits != r.InitialModelCashUnits || r.Passive.InitialModelCashUnits != r.InitialModelCashUnits || r.Cash.PolicyIdentity != ComparisonCashPolicy || r.Passive.PolicyIdentity != ComparisonPassivePolicy {
		return false
	}
	replay := r.Strategy.ReferenceReplay
	if replay.TotalBars != n || replay.TargetName != "BreakoutVol" || replay.Symbol != symbol || len(replay.Evaluations) != n-19 || len(r.Strategy.CloseMarks) != n || len(r.Cash.CloseMarks) != n || len(r.Passive.CloseMarks) != n {
		return false
	}
	for j, e := range replay.Evaluations {
		if ctx.Err() != nil || e.BarIndex != j+19 || e.PrefixLength != j+20 || !e.Timestamp.Equal(time.Unix(bars[j+19].Timestamp, 0).UTC()) {
			return false
		}
	}
	validIndex := func(i int) bool { return i >= 0 && i < n }
	for _, f := range replay.Fills {
		if ctx.Err() != nil || f.BarIndex < 20 || !validIndex(f.BarIndex) || f.EvaluationBarIndex < 19 || !validIndex(f.EvaluationBarIndex) || f.EvaluationBarIndex >= f.BarIndex || f.EntrySignalBarIndex < 19 || !validIndex(f.EntrySignalBarIndex) || !validIndex(f.EntryBarIndex) || f.EntryBarIndex != f.EntrySignalBarIndex+1 || !f.Timestamp.Equal(time.Unix(bars[f.BarIndex].Timestamp, 0).UTC()) {
			return false
		}
	}
	for _, x := range r.Strategy.RejectedEntries {
		if ctx.Err() != nil || x.BarIndex < 20 || !validIndex(x.BarIndex) || x.EvaluationBarIndex != x.BarIndex-1 || !x.Timestamp.Equal(time.Unix(bars[x.BarIndex].Timestamp, 0).UTC()) || !x.EvaluationTimestamp.Equal(time.Unix(bars[x.EvaluationBarIndex].Timestamp, 0).UTC()) {
			return false
		}
	}
	if p := replay.TerminalPosition; p != nil {
		if p.EntrySignalBarIndex < 19 || !validIndex(p.EntrySignalBarIndex) || p.EntryBarIndex != p.EntrySignalBarIndex+1 || !validIndex(p.EntryBarIndex) || p.LastBarIndex != n-1 || !p.EntrySignalTimestamp.Equal(time.Unix(bars[p.EntrySignalBarIndex].Timestamp, 0).UTC()) || !p.EntryTimestamp.Equal(time.Unix(bars[p.EntryBarIndex].Timestamp, 0).UTC()) || !p.LastTimestamp.Equal(time.Unix(bars[n-1].Timestamp, 0).UTC()) || p.StopEvaluationBarIndex < -1 || p.StopEvaluationBarIndex >= n || p.TargetEvaluationBarIndex < -1 || p.TargetEvaluationBarIndex >= n {
			return false
		}
	}
	for _, marks := range [][]ExecutionScenarioCausalCloseMark{r.Strategy.CloseMarks, r.Cash.CloseMarks, r.Passive.CloseMarks} {
		for i, m := range marks {
			if ctx.Err() != nil || m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
				return false
			}
			if i < 20 && !windowFlat(m, initial) {
				return false
			}
		}
	}
	last := r.Strategy.CloseMarks[n-1]
	if r.Strategy.FinalModelCashUnits != last.ModelCashUnits || r.Strategy.FinalModelQuantity != last.ModelQuantity || r.Strategy.FinalPositionValueUnits != last.PositionValueUnits || r.Strategy.FinalEquityUnits != last.EquityUnits || r.Strategy.NetRealizedAccountingPnLUnits != last.NetRealizedAccountingPnLUnits || r.Strategy.NetUnrealizedAccountingPnLUnits != last.NetUnrealizedAccountingPnLUnits || r.Strategy.AggregateFeeUnits != last.AggregateFeeUnits {
		return false
	}
	for _, c := range []ComparisonControlResult{r.Cash, r.Passive} {
		last := c.CloseMarks[n-1]
		if c.FinalModelCashUnits != last.ModelCashUnits || c.FinalModelQuantity != last.ModelQuantity || c.FinalPositionValueUnits != last.PositionValueUnits || c.FinalEquityUnits != last.EquityUnits || c.NetRealizedAccountingPnLUnits != last.NetRealizedAccountingPnLUnits || c.NetUnrealizedAccountingPnLUnits != last.NetUnrealizedAccountingPnLUnits || c.AggregateFeeUnits != last.AggregateFeeUnits {
			return false
		}
		if c.Entry != nil && (c.Entry.BarIndex != 20 || c.Entry.PolicyDecisionBarIndex != 19 || !c.Entry.Timestamp.Equal(time.Unix(bars[20].Timestamp, 0).UTC())) {
			return false
		}
	}
	return true
}
func windowFlat(m ExecutionScenarioCausalCloseMark, initial int64) bool {
	return m.ModelCashUnits == fundedUnits(initial) && m.EquityUnits == fundedUnits(initial) && m.PeakEquityUnits == fundedUnits(initial) && m.ModelQuantity == 0 && m.PositionPrincipalUnits == "0" && m.PositionEntryFeeUnits == "0" && m.PositionTotalBasisUnits == "0" && m.PositionValueUnits == "0" && m.GrossRealizedAccountingPnLUnits == "0" && m.GrossUnrealizedAccountingPnLUnits == "0" && m.NetRealizedAccountingPnLUnits == "0" && m.NetUnrealizedAccountingPnLUnits == "0" && m.ClosedAttributedFeeUnits == "0" && m.OpenAttributedFeeUnits == "0" && m.AggregateFeeUnits == "0" && reflect.DeepEqual(m.CloseMarkDrawdown, fundedDrawdown(0, initial, m.BarIndex))
}
func windowScore(ctx context.Context, model string, marks []ExecutionScenarioCausalCloseMark, initial int64, offset int, expected FundedCausalDrawdown) (WindowComparisonScore, bool) {
	if len(marks) < 21 || len(marks) > CausalMaxBars || offset < 0 || offset+len(marks) > CausalMaxBars {
		return WindowComparisonScore{}, false
	}
	peak, maxLoss, maxPeak, maxIndex := initial, int64(0), int64(0), -1
	for i := 20; i < len(marks); i++ {
		if ctx.Err() != nil {
			return WindowComparisonScore{}, false
		}
		m := marks[i]
		if _, ok := comparisonUnits(m.AggregateFeeUnits, false, fundedMaxUnits); !ok || (m.ModelQuantity != 0 && !causalFiniteRange(m.ModelQuantity, .00001, 1000)) {
			return WindowComparisonScore{}, false
		}
		equity, ok := comparisonUnits(m.EquityUnits, false, fundedMaxEquity)
		if !ok {
			return WindowComparisonScore{}, false
		}
		cash, ok := comparisonUnits(m.ModelCashUnits, false, fundedMaxUnits)
		if !ok {
			return WindowComparisonScore{}, false
		}
		value, ok := comparisonUnits(m.PositionValueUnits, false, fundedMaxUnits)
		if !ok || cash+value != equity {
			return WindowComparisonScore{}, false
		}
		realized, ok := comparisonUnits(m.NetRealizedAccountingPnLUnits, true, fundedMaxEquity)
		if !ok {
			return WindowComparisonScore{}, false
		}
		unrealized, ok := comparisonUnits(m.NetUnrealizedAccountingPnLUnits, true, fundedMaxEquity)
		if !ok || initial+realized+unrealized != equity {
			return WindowComparisonScore{}, false
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity
		if m.PeakEquityUnits != fundedUnits(peak) || !reflect.DeepEqual(m.CloseMarkDrawdown, fundedDrawdown(loss, peak, i)) {
			return WindowComparisonScore{}, false
		}
		if loss > 0 && peak > 0 && (maxLoss == 0 || fundedRatioGreater(loss, peak, maxLoss, maxPeak)) {
			maxLoss, maxPeak, maxIndex = loss, peak, i
		}
	}
	if maxLoss == 0 {
		maxPeak = peak
	}
	dd := fundedDrawdown(maxLoss, maxPeak, maxIndex)
	if !reflect.DeepEqual(dd, expected) {
		return WindowComparisonScore{}, false
	}
	last := marks[len(marks)-1]
	eq, _ := strconv.ParseInt(last.EquityUnits, 10, 64)
	score := WindowComparisonScore{ModelIdentity: model, StartingEquityUnits: fundedUnits(initial), EndingCashUnits: last.ModelCashUnits, EndingPositionValueUnits: last.PositionValueUnits, EndingEquityUnits: last.EquityUnits, NetRealizedAccountingPnLUnits: last.NetRealizedAccountingPnLUnits, NetUnrealizedAccountingPnLUnits: last.NetUnrealizedAccountingPnLUnits, NetAccountingPnLUnits: fundedUnits(eq - initial), AggregateFeeUnits: last.AggregateFeeUnits, EndingModelQuantity: last.ModelQuantity, MaxCloseMarkDrawdown: dd}
	if dd.BarIndex != nil {
		source, scored := offset+*dd.BarIndex, *dd.BarIndex-20
		score.DrawdownSourceBarIndex = &source
		score.DrawdownScoredBarIndex = &scored
	}
	return score, true
}
