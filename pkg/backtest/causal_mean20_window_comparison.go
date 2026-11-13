package backtest

import (
	"context"
	"time"
)

const (
	Mean20WindowComparisonModelIdentity = "gelt.legacy-go.mean-reversion-20-declared-window-comparison.v1"
	Mean20WindowSelectionPolicy         = WindowComparisonSelectionPolicy
	Mean20WindowResetPolicy             = "reseed_at_first_of_exact20_prior_bars_flat_at_score_start.v1"
)

type Mean20WindowComparisonResult struct {
	ModelIdentity, ReplayProfileIdentity, EvaluationPolicyIdentity, SelectionPolicy, ResetPolicy, DataLabel, AuthorityLabel, CadencePolicy, IntradayEligibility, SelectionHistory string
	Window                                                                                                                                                                        DeclaredComparisonWindow
	SourceTotalBars, WarmupStartSourceIndex, ScoreStartSourceIndex, ScoreEndExclusiveSourceIndex                                                                                  int
	ExcludedBeforeWarmupCount, ExcludedAfterScoreCount, WarmupBars, ScoredBars, ConsumedBars                                                                                      int
	Replay                                                                                                                                                                        Mean20ComparisonResult
	Strategy, Cash, Passive                                                                                                                                                       WindowComparisonScore
}
type Mean20WindowComparisonError struct {
	Code     CausalErrorCode
	BarIndex int
}

func (e *Mean20WindowComparisonError) Error() string {
	if e != nil {
		switch e.Code {
		case WindowInvalidWindow, WindowInsufficientWarmup, WindowInvalidResult,
			FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash,
			CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity,
			CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
			return "mean20 window comparison: " + string(e.Code)
		}
	}
	return "mean20 window comparison: invalid_result"
}
func mean20WindowFailure(code CausalErrorCode, index int) (Mean20WindowComparisonResult, error) {
	switch code {
	case WindowInvalidWindow, WindowInsufficientWarmup, WindowInvalidResult, FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash, CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
	default:
		code, index = WindowInvalidResult, -1
	}
	return Mean20WindowComparisonResult{}, &Mean20WindowComparisonError{code, index}
}

func RunMean20WindowComparisonCausal(ctx context.Context, symbol string, data []OHLCV, w DeclaredComparisonWindow, cash string, scenario ExecutionScenario) (Mean20WindowComparisonResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return mean20WindowFailure(CausalCanceled, -1)
	}
	initial, ok := fundedParseCash(cash)
	if !ok {
		return mean20WindowFailure(FundedInvalidModelCash, -1)
	}
	if _, _, _, ok = feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps}); !ok {
		return mean20WindowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if _, ok = executionScenarioRate(scenario.BuyAdverseBps); !ok {
		return mean20WindowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if _, ok = executionScenarioRate(scenario.SellAdverseBps); !ok {
		return mean20WindowFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if len(data) > CausalMaxBars {
		return mean20WindowFailure(CausalResourceLimit, -1)
	}
	full := append([]OHLCV(nil), data...)
	if ctx.Err() != nil {
		return mean20WindowFailure(CausalCanceled, -1)
	}
	i, code := causalValidateBars(full)
	if ctx.Err() != nil {
		return mean20WindowFailure(CausalCanceled, -1)
	}
	if code != "" {
		return mean20WindowFailure(code, i)
	}
	if !causalSymbol(symbol) {
		return mean20WindowFailure(CausalInvalidSymbol, -1)
	}
	s, end, code := windowSelect(ctx, full, w)
	if code != "" {
		return mean20WindowFailure(code, -1)
	}
	offset := s - 20
	consumed := append([]OHLCV(nil), full[offset:end]...)
	replay, err := RunMean20ComparisonCausal(ctx, symbol, consumed, cash, scenario)
	if err != nil {
		failure, ok := err.(*Mean20ComparisonError)
		if !ok || failure == nil {
			return mean20WindowFailure(WindowInvalidResult, -1)
		}
		if failure.Code == CausalCanceled {
			return mean20WindowFailure(CausalCanceled, -1)
		}
		index := failure.BarIndex
		if index < -1 || index >= len(consumed) {
			return mean20WindowFailure(WindowInvalidResult, -1)
		}
		if index >= 0 {
			index += offset
		}
		return mean20WindowFailure(failure.Code, index)
	}
	if ctx.Err() != nil {
		return mean20WindowFailure(CausalCanceled, -1)
	}
	if !mean20WindowReplayShape(ctx, replay, consumed, symbol, initial) {
		if ctx.Err() != nil {
			return mean20WindowFailure(CausalCanceled, -1)
		}
		return mean20WindowFailure(WindowInvalidResult, -1)
	}
	r := Mean20WindowComparisonResult{ModelIdentity: Mean20WindowComparisonModelIdentity, ReplayProfileIdentity: Mean20ComparisonModelIdentity, EvaluationPolicyIdentity: Mean20EvaluationPolicyIdentity, ResetPolicy: Mean20WindowResetPolicy, CadencePolicy: "bar_index_only_cadence_and_session_unqualified", IntradayEligibility: "unestablished", SelectionPolicy: WindowComparisonSelectionPolicy, DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel, SelectionHistory: "unestablished", Window: w, SourceTotalBars: len(full), WarmupStartSourceIndex: offset, ScoreStartSourceIndex: s, ScoreEndExclusiveSourceIndex: end, ExcludedBeforeWarmupCount: offset, ExcludedAfterScoreCount: len(full) - end, WarmupBars: 20, ScoredBars: end - s, ConsumedBars: len(consumed), Replay: replay}
	r.Strategy, ok = windowScore(ctx, replay.Strategy.ModelIdentity, replay.Strategy.CloseMarks, initial, offset, replay.Strategy.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return mean20WindowFailure(CausalCanceled, -1)
		}
		return mean20WindowFailure(WindowInvalidResult, -1)
	}
	r.Cash, ok = windowScore(ctx, replay.Cash.ModelIdentity, replay.Cash.CloseMarks, initial, offset, replay.Cash.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return mean20WindowFailure(CausalCanceled, -1)
		}
		return mean20WindowFailure(WindowInvalidResult, -1)
	}
	r.Passive, ok = windowScore(ctx, replay.Passive.ModelIdentity, replay.Passive.CloseMarks, initial, offset, replay.Passive.MaxCloseMarkDrawdown)
	if !ok {
		if ctx.Err() != nil {
			return mean20WindowFailure(CausalCanceled, -1)
		}
		return mean20WindowFailure(WindowInvalidResult, -1)
	}
	if ctx.Err() != nil {
		return mean20WindowFailure(CausalCanceled, -1)
	}
	return r, nil
}

func mean20WindowReplayShape(ctx context.Context, r Mean20ComparisonResult, bars []OHLCV, symbol string, initial int64) bool {
	n := len(bars)
	if n < 21 || n > CausalMaxBars || r.ModelIdentity != Mean20ComparisonModelIdentity || r.Symbol != symbol || r.TotalBars != n || r.Scale != 8 || r.InitialModelCashUnits != fundedUnits(initial) || r.CostIdentity != ExecutionScenarioCausalCostIdentity || r.ScenarioBasis != ExecutionScenarioCausalBasis || r.DataLabel != CausalOfflineLabel || r.AuthorityLabel != CausalOfflineLabel || r.Strategy.ModelIdentity != ExecutionScenarioCausalModelIdentity || r.Cash.ModelIdentity != ComparisonCashModelIdentity || r.Passive.ModelIdentity != ComparisonPassiveModelIdentity {
		return false
	}
	if r.Strategy.CostIdentity != r.CostIdentity || r.Strategy.Scenario != r.Scenario || r.Strategy.InitialModelCashUnits != r.InitialModelCashUnits || r.Cash.Symbol != symbol || r.Passive.Symbol != symbol || r.Cash.TotalBars != n || r.Passive.TotalBars != n || r.Cash.Scale != 8 || r.Passive.Scale != 8 || r.Cash.InitialModelCashUnits != r.InitialModelCashUnits || r.Passive.InitialModelCashUnits != r.InitialModelCashUnits || r.Cash.PolicyIdentity != ComparisonCashPolicy || r.Passive.PolicyIdentity != ComparisonPassivePolicy {
		return false
	}
	replay := r.Strategy.ReferenceReplay
	if replay.TotalBars != n || replay.TargetName != "MeanReversion" || replay.Symbol != symbol || len(replay.Evaluations) != n-19 || len(r.Strategy.CloseMarks) != n || len(r.Cash.CloseMarks) != n || len(r.Passive.CloseMarks) != n {
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
