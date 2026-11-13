package backtest

import (
	"context"
	"time"

	"gelt/pkg/strategies"
)

const (
	Mean20ComparisonModelIdentity                  = "gelt.legacy-go.mean-reversion-20-comparison.v1"
	Mean20EvaluationPolicyIdentity                 = "gelt.legacy-go.mean-reversion-fixed20-defaults.v1"
	Mean20InvalidResult            CausalErrorCode = "invalid_result"
)

type Mean20ComparisonResult struct {
	ModelIdentity, EvaluationPolicyIdentity, CostIdentity, ScenarioBasis, DataLabel, AuthorityLabel, CadencePolicy, IntradayEligibility, SelectionHistory, Symbol string
	TotalBars, Scale, FixedWarmupCloses, FirstEvaluationBarIndex, FirstEligibleFillBarIndex                                                                       int
	InitialModelCashUnits                                                                                                                                         string
	Scenario                                                                                                                                                      ExecutionScenarioCausalDeclaration
	Strategy                                                                                                                                                      ExecutionScenarioCausalResult
	Cash, Passive                                                                                                                                                 ComparisonControlResult
	StrategyMinusCashUnits, StrategyMinusPassiveUnits                                                                                                             string
}
type Mean20ComparisonError struct {
	Code     CausalErrorCode
	BarIndex int
}

func (e *Mean20ComparisonError) Error() string {
	if e != nil {
		switch e.Code {
		case FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash, CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit, Mean20InvalidResult:
			return "mean20 comparison: " + string(e.Code)
		}
	}
	return "mean20 comparison: invalid_result"
}
func mean20Failure(code CausalErrorCode, index int) (Mean20ComparisonResult, error) {
	switch code {
	case FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash, CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit, Mean20InvalidResult:
	default:
		code, index = Mean20InvalidResult, -1
	}
	if code == CausalCanceled {
		index = -1
	}
	return Mean20ComparisonResult{}, &Mean20ComparisonError{code, index}
}

func RunMean20ComparisonCausal(ctx context.Context, symbol string, data []OHLCV, initialModelCash string, scenario ExecutionScenario) (Mean20ComparisonResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return mean20Failure(CausalCanceled, -1)
	}
	initial, ok := fundedParseCash(initialModelCash)
	if !ok {
		return mean20Failure(FundedInvalidModelCash, -1)
	}
	fixed, bps, target, ok := feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps})
	if !ok {
		return mean20Failure(ExecutionScenarioInvalidScenario, -1)
	}
	buy, buyOK := executionScenarioRate(scenario.BuyAdverseBps)
	sell, sellOK := executionScenarioRate(scenario.SellAdverseBps)
	if !buyOK || !sellOK {
		return mean20Failure(ExecutionScenarioInvalidScenario, -1)
	}
	if len(data) > CausalMaxBars {
		return mean20Failure(CausalResourceLimit, -1)
	}
	bars := append([]OHLCV(nil), data...)
	if ctx.Err() != nil {
		return mean20Failure(CausalCanceled, -1)
	}
	i, code := causalValidateBars(bars)
	if ctx.Err() != nil {
		return mean20Failure(CausalCanceled, -1)
	}
	if code != "" {
		return mean20Failure(code, i)
	}
	if !causalSymbol(symbol) {
		return mean20Failure(CausalInvalidSymbol, -1)
	}
	strategy := strategies.NewMeanReversionStrategy()
	if strategy.Init(nil) != nil {
		return mean20Failure(CausalInvalidEvaluator, -1)
	}
	engine := &Engine{strategy: strategy}
	unchanged := func() bool {
		return engine.strategy == strategy && causalNil(engine.plan) && strategy.Name() == "MeanReversion" && strategy.BollingerPeriod == 20 && strategy.BollingerStdDev == 2 && strategy.RSIOversold == 35 && strategy.RSIOverbought == 65 && strategy.ATRStopMultiplier == .5 && strategy.ATRTargetMultiplier == 1.5
	}
	if !unchanged() {
		return mean20Failure(CausalEvaluatorIdentity, -1)
	}
	cash, passive, code, i := comparisonControls(ctx, symbol, bars, initial, fixed, bps, target, buy)
	if code != "" {
		if code == CausalCanceled {
			i = -1
		}
		return mean20Failure(code, i)
	}
	if ctx.Err() != nil {
		return mean20Failure(CausalCanceled, -1)
	}
	if !unchanged() {
		return mean20Failure(CausalEvaluatorIdentity, -1)
	}
	result, err := engine.RunExecutionScenarioCausal(ctx, symbol, bars, initialModelCash, scenario)
	if err != nil {
		if e, ok := err.(*ExecutionScenarioCausalError); ok && e != nil {
			if e.BarIndex < -1 || e.BarIndex >= len(bars) {
				return mean20Failure(Mean20InvalidResult, -1)
			}
			return mean20Failure(e.Code, e.BarIndex)
		}
		return mean20Failure(Mean20InvalidResult, -1)
	}
	if ctx.Err() != nil {
		return mean20Failure(CausalCanceled, -1)
	}
	if !unchanged() {
		return mean20Failure(CausalEvaluatorIdentity, -1)
	}
	if result.Scenario != newCausalExecutionScenarioState(initial, fixed, bps, target, buy, sell).result.Scenario || !mean20ResultConsistent(ctx, symbol, bars, initial, result, cash, passive) {
		if ctx.Err() != nil {
			return mean20Failure(CausalCanceled, -1)
		}
		return mean20Failure(Mean20InvalidResult, -1)
	}
	equity, ok := comparisonUnits(result.FinalEquityUnits, false, fundedMaxEquity)
	if !ok {
		return mean20Failure(CausalNumericRange, -1)
	}
	pe, ok := comparisonUnits(passive.FinalEquityUnits, false, fundedMaxEquity)
	if !ok {
		return mean20Failure(CausalNumericRange, -1)
	}
	gc, ok := fundedCheckedSub(equity, initial)
	if !ok {
		return mean20Failure(CausalNumericRange, -1)
	}
	gp, ok := fundedCheckedSub(equity, pe)
	if !ok || gp < -fundedMaxEquity || gp > fundedMaxEquity || gc < -fundedMaxEquity || gc > fundedMaxEquity {
		return mean20Failure(CausalNumericRange, -1)
	}
	if ctx.Err() != nil {
		return mean20Failure(CausalCanceled, -1)
	}
	return Mean20ComparisonResult{ModelIdentity: Mean20ComparisonModelIdentity, EvaluationPolicyIdentity: Mean20EvaluationPolicyIdentity, CostIdentity: ExecutionScenarioCausalCostIdentity, ScenarioBasis: ExecutionScenarioCausalBasis, DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel, CadencePolicy: "bar_index_only_cadence_and_session_unqualified", IntradayEligibility: "unestablished", SelectionHistory: "unestablished", Symbol: symbol, TotalBars: len(bars), Scale: 8, FixedWarmupCloses: 20, FirstEvaluationBarIndex: 19, FirstEligibleFillBarIndex: 20, InitialModelCashUnits: fundedUnits(initial), Scenario: result.Scenario, Strategy: result, Cash: cash, Passive: passive, StrategyMinusCashUnits: fundedUnits(gc), StrategyMinusPassiveUnits: fundedUnits(gp)}, nil
}

// This internal consistency check is not the CLI's independent event oracle.
// It verifies the profile projection and the state produced by this replay.
func mean20ResultConsistent(ctx context.Context, symbol string, bars []OHLCV, initial int64, r ExecutionScenarioCausalResult, cash, passive ComparisonControlResult) bool {
	replay := r.ReferenceReplay
	n := len(bars)
	expected := 0
	if n >= 20 {
		expected = n - 19
	}
	if r.ModelIdentity != ExecutionScenarioCausalModelIdentity || r.CostIdentity != ExecutionScenarioCausalCostIdentity || r.DataLabel != CausalOfflineLabel || r.AuthorityLabel != CausalOfflineLabel || r.Scale != 8 || r.InitialModelCashUnits != fundedUnits(initial) || r.InitialEquityUnits != fundedUnits(initial) || r.ReferenceReplayRole != "reference_trigger_diagnostic_only_not_execution_pnl" || replay.ModelIdentity != ExecutionScenarioCausalModelIdentity || replay.CostIdentity != ExecutionScenarioCausalCostIdentity || replay.TargetName != "MeanReversion" || replay.Symbol != symbol || replay.TotalBars != n || replay.DataLabel != CausalOfflineLabel || replay.AuthorityLabel != CausalOfflineLabel || len(replay.Evaluations) != expected || len(r.CloseMarks) != n || len(replay.Fills) != len(r.CashFlows) || len(replay.Fills) > CausalMaxFills || len(r.RejectedEntries) > n {
		return false
	}
	if cash.TotalBars != n || passive.TotalBars != n || cash.Scale != 8 || passive.Scale != 8 || cash.InitialModelCashUnits != fundedUnits(initial) || passive.InitialModelCashUnits != fundedUnits(initial) {
		return false
	}
	if cash.ModelIdentity != ComparisonCashModelIdentity || cash.PolicyIdentity != ComparisonCashPolicy || passive.ModelIdentity != ComparisonPassiveModelIdentity || passive.PolicyIdentity != ComparisonPassivePolicy || cash.Symbol != symbol || passive.Symbol != symbol || len(cash.CloseMarks) != n || len(passive.CloseMarks) != n {
		return false
	}
	if !trend50MarksConsistent(ctx, bars, initial, r.CloseMarks, r.MaxCloseMarkDrawdown) || !trend50MarksConsistent(ctx, bars, initial, cash.CloseMarks, cash.MaxCloseMarkDrawdown) || !trend50MarksConsistent(ctx, bars, initial, passive.CloseMarks, passive.MaxCloseMarkDrawdown) {
		return false
	}
	for i, b := range bars {
		if ctx.Err() != nil {
			return false
		}
		at := time.Unix(b.Timestamp, 0).UTC()
		m := r.CloseMarks[i]
		if m.BarIndex != i || !m.Timestamp.Equal(at) || cash.CloseMarks[i].BarIndex != i || !cash.CloseMarks[i].Timestamp.Equal(at) || passive.CloseMarks[i].BarIndex != i || !passive.CloseMarks[i].Timestamp.Equal(at) {
			return false
		}
		cashUnits, a := comparisonUnits(m.ModelCashUnits, false, fundedMaxUnits)
		value, bOK := comparisonUnits(m.PositionValueUnits, false, fundedMaxEquity)
		equity, c := comparisonUnits(m.EquityUnits, false, fundedMaxEquity)
		realized, d := comparisonUnits(m.NetRealizedAccountingPnLUnits, true, fundedMaxEquity)
		unrealized, eOK := comparisonUnits(m.NetUnrealizedAccountingPnLUnits, true, fundedMaxEquity)
		if !a || !bOK || !c || !d || !eOK || cashUnits+value != equity || initial+realized+unrealized != equity {
			return false
		}
		if i < 20 && (m.ModelCashUnits != fundedUnits(initial) || m.ModelQuantity != 0 || m.PositionValueUnits != "0" || m.EquityUnits != fundedUnits(initial) || m.AggregateFeeUnits != "0") {
			return false
		}
		if i >= 19 {
			e := replay.Evaluations[i-19]
			if e.BarIndex != i || e.PrefixLength != i+1 || e.Name != "MeanReversion" || e.Symbol != symbol || !e.Timestamp.Equal(at) || e.AssetClass != strategies.AssetEquity || len(e.Components) != 0 || causalDomain(e.Signal, e.Score, e.StopLossPct, e.TargetPct) != "" {
				return false
			}
		}
	}
	for i, f := range replay.Fills {
		if f.BarIndex < 20 || f.BarIndex >= n || f.EvaluationBarIndex < 19 || f.EvaluationBarIndex >= f.BarIndex || r.CashFlows[i].FillIndex != i || r.CashFlows[i].BarIndex != f.BarIndex {
			return false
		}
	}
	for _, e := range r.RejectedEntries {
		if e.BarIndex < 20 || e.BarIndex >= n || e.EvaluationBarIndex != e.BarIndex-1 {
			return false
		}
	}
	last := r.CloseMarks[n-1]
	if r.FinalModelCashUnits != last.ModelCashUnits || r.FinalModelQuantity != last.ModelQuantity || r.FinalPositionPrincipalUnits != last.PositionPrincipalUnits || r.FinalPositionEntryFeeUnits != last.PositionEntryFeeUnits || r.FinalPositionTotalBasisUnits != last.PositionTotalBasisUnits || r.FinalPositionValueUnits != last.PositionValueUnits || r.FinalEquityUnits != last.EquityUnits || r.GrossRealizedAccountingPnLUnits != last.GrossRealizedAccountingPnLUnits || r.GrossUnrealizedAccountingPnLUnits != last.GrossUnrealizedAccountingPnLUnits || r.NetRealizedAccountingPnLUnits != last.NetRealizedAccountingPnLUnits || r.NetUnrealizedAccountingPnLUnits != last.NetUnrealizedAccountingPnLUnits || r.ClosedAttributedFeeUnits != last.ClosedAttributedFeeUnits || r.OpenAttributedFeeUnits != last.OpenAttributedFeeUnits || r.AggregateFeeUnits != last.AggregateFeeUnits || r.PeakCloseEquityUnits != last.PeakEquityUnits {
		return false
	}

	if n < 20 && (replay.PendingSignalUnfilled || replay.TerminalPosition != nil || replay.ClosedTradeCount != 0 || replay.GrossProfitFactor != nil || replay.GrossProfitFactorReason != CausalNoClosedTrades) {
		return false
	}
	if !trend50ControlFinal(cash) || !trend50ControlFinal(passive) || cash.Entry != nil || cash.EntryStatus != "no_eligible_bar" {
		return false
	}
	if n <= 20 && (passive.Entry != nil || passive.EntryStatus != "no_eligible_bar" || len(replay.Fills) != 0 || len(r.RejectedEntries) != 0) {
		return false
	}
	if n > 20 && (passive.Entry == nil || passive.Entry.BarIndex != 20 || passive.Entry.PolicyDecisionBarIndex != 19 || passive.Entry.Reason != "fixed_after_20_closes_one_buy" || passive.Entry.Origin != "fixed_control_policy" || !passive.Entry.Timestamp.Equal(time.Unix(bars[20].Timestamp, 0).UTC()) || passive.Entry.ReferencePrice != bars[20].Open || (passive.EntryStatus != "filled" && passive.EntryStatus != FundedInsufficientModelCash)) {
		return false
	}
	return true
}
