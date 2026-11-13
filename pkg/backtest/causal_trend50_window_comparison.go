package backtest

import (
	"context"
	"reflect"
	"strconv"
	"time"
)

const (
	Trend50WindowComparisonModelIdentity                 = "gelt.legacy-go.trend-confluence-50-declared-window-comparison.v1"
	Trend50WindowReplayProfileIdentity                   = Trend50ComparisonModelIdentity
	Trend50WindowResetPolicy                             = "reseed_at_first_of_exact50_prior_bars_flat_at_score_start.v1"
	Trend50WindowSelectionPolicy                         = "exact50_prior_bars_start_inclusive_end_exclusive.v1"
	Trend50WindowInvalidWindow           CausalErrorCode = "invalid_window"
	Trend50WindowInsufficientWarmup      CausalErrorCode = "insufficient_warmup"
	Trend50WindowInvalidResult           CausalErrorCode = "invalid_result"
)

type Trend50WindowComparisonResult struct {
	ModelIdentity, ReplayProfileIdentity, SelectionPolicy, ResetPolicy, DataLabel, AuthorityLabel, CadencePolicy, IntradayEligibility, SelectionHistory string
	Window                                                                                                                                              DeclaredComparisonWindow
	SourceTotalBars, WarmupStartSourceIndex, ScoreStartSourceIndex, ScoreEndExclusiveSourceIndex                                                        int
	ExcludedBeforeWarmupCount, ExcludedAfterScoreCount, WarmupBars, ScoredBars, ConsumedBars                                                            int
	Replay                                                                                                                                              Trend50ComparisonResult
	Strategy, Cash, Passive                                                                                                                             WindowComparisonScore
}
type Trend50WindowComparisonError struct {
	Code     CausalErrorCode
	BarIndex int
}

func (e *Trend50WindowComparisonError) Error() string {
	if e != nil {
		switch e.Code {
		case Trend50WindowInvalidWindow, Trend50WindowInsufficientWarmup, Trend50WindowInvalidResult,
			FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash,
			CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity,
			CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
			return "trend50 window comparison: " + string(e.Code)
		}
	}
	return "trend50 window comparison: invalid_result"
}
func trend50WindowFailure(code CausalErrorCode, index int) (Trend50WindowComparisonResult, error) {
	switch code {
	case Trend50WindowInvalidWindow, Trend50WindowInsufficientWarmup, Trend50WindowInvalidResult, FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash, CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
	default:
		code, index = Trend50WindowInvalidResult, -1
	}
	return Trend50WindowComparisonResult{}, &Trend50WindowComparisonError{code, index}
}

// Precondition: the full private source copy has passed causalValidateBars.
func trend50WindowSelect(ctx context.Context, bars []OHLCV, w DeclaredComparisonWindow) (int, int, CausalErrorCode) {
	if w.StartInclusiveUnix < 1 || w.StartInclusiveUnix > causalMaxTimestamp || w.EndExclusiveUnix < 2 || w.EndExclusiveUnix > causalMaxTimestamp+1 || w.StartInclusiveUnix >= w.EndExclusiveUnix {
		return 0, 0, Trend50WindowInvalidWindow
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
		return 0, 0, Trend50WindowInvalidWindow
	}
	if s < 50 {
		return 0, 0, Trend50WindowInsufficientWarmup
	}
	return s, e, ""
}

// RunTrend50WindowComparisonCausal reseeds the closed replay on exactly fifty
// preceding bars and scores the declared interval.
func RunTrend50WindowComparisonCausal(ctx context.Context, symbol string, data []OHLCV, w DeclaredComparisonWindow, cash string, scenario ExecutionScenario) (Trend50WindowComparisonResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return trend50WindowFailure(CausalCanceled, -1)
	}
	initial, ok := fundedParseCash(cash)
	if !ok {
		return trend50WindowFailure(FundedInvalidModelCash, -1)
	}
	if _, _, _, ok = feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps}); !ok {
		return trend50WindowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if _, ok = executionScenarioRate(scenario.BuyAdverseBps); !ok {
		return trend50WindowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if _, ok = executionScenarioRate(scenario.SellAdverseBps); !ok {
		return trend50WindowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if len(data) > CausalMaxBars {
		return trend50WindowFailure(CausalResourceLimit, -1)
	}
	full := append([]OHLCV(nil), data...)
	if ctx.Err() != nil {
		return trend50WindowFailure(CausalCanceled, -1)
	}
	if i, code := causalValidateBars(full); code != "" {
		return trend50WindowFailure(code, i)
	}
	if ctx.Err() != nil {
		return trend50WindowFailure(CausalCanceled, -1)
	}
	if !causalSymbol(symbol) {
		return trend50WindowFailure(CausalInvalidSymbol, -1)
	}
	s, end, code := trend50WindowSelect(ctx, full, w)
	if code != "" {
		return trend50WindowFailure(code, -1)
	}
	offset := s - 50
	consumed := append([]OHLCV(nil), full[offset:end]...)
	replay, err := RunTrend50ComparisonCausal(ctx, symbol, consumed, cash, scenario)
	if err != nil {
		failure, ok := err.(*Trend50ComparisonError)
		if !ok || failure == nil {
			return trend50WindowFailure(Trend50WindowInvalidResult, -1)
		}
		index := failure.BarIndex
		if failure.Code == CausalCanceled {
			return trend50WindowFailure(CausalCanceled, -1)
		}
		if index < -1 || index >= len(consumed) {
			return trend50WindowFailure(Trend50WindowInvalidResult, -1)
		}
		if index >= 0 {
			index += offset
		}
		return trend50WindowFailure(failure.Code, index)
	}
	if ctx.Err() != nil {
		return trend50WindowFailure(CausalCanceled, -1)
	}
	if !trend50WindowReplayShape(ctx, replay, consumed, symbol, initial) {
		if ctx.Err() != nil {
			return trend50WindowFailure(CausalCanceled, -1)
		}
		return trend50WindowFailure(Trend50WindowInvalidResult, -1)
	}
	r := Trend50WindowComparisonResult{ModelIdentity: Trend50WindowComparisonModelIdentity, ReplayProfileIdentity: Trend50WindowReplayProfileIdentity, SelectionPolicy: Trend50WindowSelectionPolicy, ResetPolicy: Trend50WindowResetPolicy, CadencePolicy: "bar_index_only_cadence_and_session_unqualified", IntradayEligibility: "unestablished", DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel, SelectionHistory: "unestablished", Window: w, SourceTotalBars: len(full), WarmupStartSourceIndex: offset, ScoreStartSourceIndex: s, ScoreEndExclusiveSourceIndex: end, ExcludedBeforeWarmupCount: offset, ExcludedAfterScoreCount: len(full) - end, WarmupBars: 50, ScoredBars: end - s, ConsumedBars: len(consumed), Replay: replay}
	r.Strategy, ok = trend50WindowScore(ctx, replay.Strategy.ModelIdentity, replay.Strategy.CloseMarks, initial, offset, replay.Strategy.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return trend50WindowFailure(CausalCanceled, -1)
		}
		return trend50WindowFailure(Trend50WindowInvalidResult, -1)
	}
	r.Cash, ok = trend50WindowScore(ctx, replay.Cash.ModelIdentity, replay.Cash.CloseMarks, initial, offset, replay.Cash.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return trend50WindowFailure(CausalCanceled, -1)
		}
		return trend50WindowFailure(Trend50WindowInvalidResult, -1)
	}
	r.Passive, ok = trend50WindowScore(ctx, replay.Passive.ModelIdentity, replay.Passive.CloseMarks, initial, offset, replay.Passive.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return trend50WindowFailure(CausalCanceled, -1)
		}
		return trend50WindowFailure(Trend50WindowInvalidResult, -1)
	}
	if ctx.Err() != nil {
		return trend50WindowFailure(CausalCanceled, -1)
	}
	return r, nil
}

func trend50WindowReplayShape(ctx context.Context, r Trend50ComparisonResult, bars []OHLCV, symbol string, initial int64) bool {
	n := len(bars)
	if n < 51 || n > CausalMaxBars || r.FixedWarmupCloses != 50 || r.FirstEvaluationBarIndex != 49 || r.FirstEligibleFillBarIndex != 50 || r.CadencePolicy != "bar_index_only_cadence_and_session_unqualified" || r.IntradayEligibility != "unestablished" || r.SelectionHistory != "unestablished" || r.ModelIdentity != Trend50ComparisonModelIdentity || r.Symbol != symbol || r.TotalBars != n || r.Scale != 8 || r.InitialModelCashUnits != fundedUnits(initial) || r.CostIdentity != ExecutionScenarioCausalCostIdentity || r.ScenarioBasis != ExecutionScenarioCausalBasis || r.DataLabel != CausalOfflineLabel || r.AuthorityLabel != CausalOfflineLabel || r.Strategy.ModelIdentity != Trend50StrategyModelIdentity || r.Cash.ModelIdentity != Trend50CashModelIdentity || r.Passive.ModelIdentity != Trend50PassiveModelIdentity {
		return false
	}
	if r.Strategy.CostIdentity != r.CostIdentity || r.Strategy.Scenario != r.Scenario || r.Strategy.InitialModelCashUnits != r.InitialModelCashUnits || r.Cash.Symbol != symbol || r.Passive.Symbol != symbol || r.Cash.TotalBars != n || r.Passive.TotalBars != n || r.Cash.Scale != 8 || r.Passive.Scale != 8 || r.Cash.InitialModelCashUnits != r.InitialModelCashUnits || r.Passive.InitialModelCashUnits != r.InitialModelCashUnits || r.Cash.PolicyIdentity != ComparisonCashPolicy || r.Passive.PolicyIdentity != "fixed_after_50_closes_one_buy_no_exit" {
		return false
	}
	replay := r.Strategy.ReferenceReplay
	if replay.TotalBars != n || replay.TargetName != "TrendConfluence" || replay.Symbol != symbol || len(replay.Evaluations) != n-49 || len(r.Strategy.CloseMarks) != n || len(r.Cash.CloseMarks) != n || len(r.Passive.CloseMarks) != n {
		return false
	}
	for j, e := range replay.Evaluations {
		if ctx.Err() != nil || e.BarIndex != j+49 || e.PrefixLength != j+50 || !e.Timestamp.Equal(time.Unix(bars[j+49].Timestamp, 0).UTC()) {
			return false
		}
	}
	validIndex := func(i int) bool { return i >= 0 && i < n }
	for _, f := range replay.Fills {
		if ctx.Err() != nil || f.BarIndex < 50 || !validIndex(f.BarIndex) || f.EvaluationBarIndex < 49 || !validIndex(f.EvaluationBarIndex) || f.EvaluationBarIndex >= f.BarIndex || f.EntrySignalBarIndex < 49 || !validIndex(f.EntrySignalBarIndex) || !validIndex(f.EntryBarIndex) || f.EntryBarIndex != f.EntrySignalBarIndex+1 || !f.Timestamp.Equal(time.Unix(bars[f.BarIndex].Timestamp, 0).UTC()) {
			return false
		}
	}
	for _, x := range r.Strategy.RejectedEntries {
		if ctx.Err() != nil || x.BarIndex < 50 || !validIndex(x.BarIndex) || x.EvaluationBarIndex != x.BarIndex-1 || !x.Timestamp.Equal(time.Unix(bars[x.BarIndex].Timestamp, 0).UTC()) || !x.EvaluationTimestamp.Equal(time.Unix(bars[x.EvaluationBarIndex].Timestamp, 0).UTC()) {
			return false
		}
	}
	if p := replay.TerminalPosition; p != nil {
		if p.EntrySignalBarIndex < 49 || !validIndex(p.EntrySignalBarIndex) || p.EntryBarIndex != p.EntrySignalBarIndex+1 || !validIndex(p.EntryBarIndex) || p.LastBarIndex != n-1 || !p.EntrySignalTimestamp.Equal(time.Unix(bars[p.EntrySignalBarIndex].Timestamp, 0).UTC()) || !p.EntryTimestamp.Equal(time.Unix(bars[p.EntryBarIndex].Timestamp, 0).UTC()) || !p.LastTimestamp.Equal(time.Unix(bars[n-1].Timestamp, 0).UTC()) || p.StopEvaluationBarIndex < -1 || p.StopEvaluationBarIndex >= n || p.TargetEvaluationBarIndex < -1 || p.TargetEvaluationBarIndex >= n {
			return false
		}
	}
	for _, marks := range [][]ExecutionScenarioCausalCloseMark{r.Strategy.CloseMarks, r.Cash.CloseMarks, r.Passive.CloseMarks} {
		for i, m := range marks {
			if ctx.Err() != nil || m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
				return false
			}
			if i < 50 && !windowFlat(m, initial) {
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
		if c.Entry != nil && (c.Entry.BarIndex != 50 || c.Entry.PolicyDecisionBarIndex != 49 || !c.Entry.Timestamp.Equal(time.Unix(bars[50].Timestamp, 0).UTC())) {
			return false
		}
	}
	return true
}
func trend50WindowScore(ctx context.Context, model string, marks []ExecutionScenarioCausalCloseMark, initial int64, offset int, expected FundedCausalDrawdown) (WindowComparisonScore, bool) {
	if len(marks) < 51 || len(marks) > CausalMaxBars || offset < 0 || offset+len(marks) > CausalMaxBars {
		return WindowComparisonScore{}, false
	}
	peak, maxLoss, maxPeak, maxIndex := initial, int64(0), int64(0), -1
	for i := 50; i < len(marks); i++ {
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
		total, sumOK := fundedCheckedAdd(realized, unrealized)
		accounted, equityOK := fundedCheckedAdd(initial, total)
		if !ok || !sumOK || !equityOK || accounted != equity {
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
		source, scored := offset+*dd.BarIndex, *dd.BarIndex-50
		score.DrawdownSourceBarIndex = &source
		score.DrawdownScoredBarIndex = &scored
	}
	return score, true
}
