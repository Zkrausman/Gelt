package backtest

import (
	"context"
	"reflect"
	"time"

	"gelt/pkg/strategies"
)

const (
	Trend50ComparisonModelIdentity                 = "gelt.legacy-go.trend-confluence-50-comparison.v1"
	Trend50StrategyModelIdentity                   = "gelt.legacy-go.trend-confluence-50-execution-scenario.v1"
	Trend50CashModelIdentity                       = "gelt.legacy-go.trend-confluence-50-flat-cash-control.v1"
	Trend50InvalidResult           CausalErrorCode = "invalid_result"
	Trend50PassiveModelIdentity                    = "gelt.legacy-go.trend-confluence-50-one-lot-passive-control.v1"
)

type Trend50ComparisonResult struct {
	ModelIdentity, CostIdentity, ScenarioBasis, DataLabel, AuthorityLabel, CadencePolicy, IntradayEligibility, SelectionHistory, Symbol string
	TotalBars, Scale, FixedWarmupCloses, FirstEvaluationBarIndex, FirstEligibleFillBarIndex                                             int
	InitialModelCashUnits                                                                                                               string
	Scenario                                                                                                                            ExecutionScenarioCausalDeclaration
	Strategy                                                                                                                            ExecutionScenarioCausalResult
	Cash, Passive                                                                                                                       ComparisonControlResult
	StrategyMinusCashUnits, StrategyMinusPassiveUnits                                                                                   string
}
type Trend50ComparisonError struct {
	Code     CausalErrorCode
	BarIndex int
}

func (e *Trend50ComparisonError) Error() string {
	if e != nil {
		switch e.Code {
		case FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash, CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError, CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit, Trend50InvalidResult:
			return "trend50 comparison: " + string(e.Code)
		}
	}
	return "trend50 comparison failed"
}
func trend50Failure(code CausalErrorCode, index int) (Trend50ComparisonResult, error) {
	return Trend50ComparisonResult{}, &Trend50ComparisonError{code, index}
}

func RunTrend50ComparisonCausal(ctx context.Context, symbol string, data []OHLCV, initialModelCash string, scenario ExecutionScenario) (Trend50ComparisonResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return trend50Failure(CausalCanceled, -1)
	}
	initial, ok := fundedParseCash(initialModelCash)
	if !ok {
		return trend50Failure(FundedInvalidModelCash, -1)
	}
	fixed, bps, target, ok := feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps})
	if !ok {
		return trend50Failure(ExecutionScenarioInvalidScenario, -1)
	}
	buy, buyOK := executionScenarioRate(scenario.BuyAdverseBps)
	sell, sellOK := executionScenarioRate(scenario.SellAdverseBps)
	if !buyOK || !sellOK {
		return trend50Failure(ExecutionScenarioInvalidScenario, -1)
	}
	if len(data) > CausalMaxBars {
		return trend50Failure(CausalResourceLimit, -1)
	}
	bars := append([]OHLCV(nil), data...)
	if i, code := causalValidateBars(bars); code != "" {
		return trend50Failure(code, i)
	}
	if !causalSymbol(symbol) {
		return trend50Failure(CausalInvalidSymbol, -1)
	}
	strategy := strategies.NewTrendConfluenceStrategy()
	if strategy.Init(nil) != nil {
		return trend50Failure(CausalInvalidEvaluator, -1)
	}
	engine := &Engine{strategy: strategy}
	unchanged := func() bool {
		return engine.strategy == strategy && causalNil(engine.plan) && strategy.Name() == "TrendConfluence" && strategy.BuyScoreThreshold == 75 && strategy.SellScoreThreshold == 0
	}
	if !unchanged() {
		return trend50Failure(CausalEvaluatorIdentity, -1)
	}
	cash, passive, code, i := comparisonControlsForProfile(causalProfileTrend50, ctx, symbol, bars, initial, fixed, bps, target, buy)
	if code != "" {
		return trend50Failure(code, i)
	}
	if ctx.Err() != nil {
		return trend50Failure(CausalCanceled, -1)
	}
	if !unchanged() {
		return trend50Failure(CausalEvaluatorIdentity, -1)
	}
	state := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, initial, fixed, bps, target, buy, sell)
	replay, err := engine.runCausalProfile(causalProfileTrend50, ctx, symbol, bars, nil, nil, state)
	if err != nil {
		if e, ok := err.(*CausalError); ok {
			return trend50Failure(e.Code, e.BarIndex)
		}
		return trend50Failure(CausalInvalidInput, -1)
	}
	if ctx.Err() != nil {
		return trend50Failure(CausalCanceled, -1)
	}
	if !unchanged() {
		return trend50Failure(CausalEvaluatorIdentity, -1)
	}
	state.result.ReferenceReplay = replay
	if !trend50ResultConsistent(ctx, symbol, bars, initial, state, cash, passive) {
		if ctx.Err() != nil {
			return trend50Failure(CausalCanceled, -1)
		}
		return trend50Failure(Trend50InvalidResult, -1)
	}
	equity, ok := comparisonUnits(state.result.FinalEquityUnits, false, fundedMaxEquity)
	if !ok {
		return trend50Failure(CausalNumericRange, -1)
	}
	pe, ok := comparisonUnits(passive.FinalEquityUnits, false, fundedMaxEquity)
	if !ok {
		return trend50Failure(CausalNumericRange, -1)
	}
	gc, ok := fundedCheckedSub(equity, initial)
	if !ok {
		return trend50Failure(CausalNumericRange, -1)
	}
	gp, ok := fundedCheckedSub(equity, pe)
	if !ok || gp < -fundedMaxEquity || gp > fundedMaxEquity || gc < -fundedMaxEquity || gc > fundedMaxEquity {
		return trend50Failure(CausalNumericRange, -1)
	}
	if ctx.Err() != nil {
		return trend50Failure(CausalCanceled, -1)
	}
	return Trend50ComparisonResult{ModelIdentity: Trend50ComparisonModelIdentity, CostIdentity: ExecutionScenarioCausalCostIdentity, ScenarioBasis: ExecutionScenarioCausalBasis, DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel, CadencePolicy: "bar_index_only_cadence_and_session_unqualified", IntradayEligibility: "unestablished", SelectionHistory: "unestablished", Symbol: symbol, TotalBars: len(bars), Scale: 8, FixedWarmupCloses: 50, FirstEvaluationBarIndex: 49, FirstEligibleFillBarIndex: 50, InitialModelCashUnits: fundedUnits(initial), Scenario: state.result.Scenario, Strategy: state.result, Cash: cash, Passive: passive, StrategyMinusCashUnits: fundedUnits(gc), StrategyMinusPassiveUnits: fundedUnits(gp)}, nil
}

// This internal consistency check is not the CLI's independent event oracle.
// It verifies the profile projection and the state produced by this replay.
func trend50ResultConsistent(ctx context.Context, symbol string, bars []OHLCV, initial int64, state *causalExecutionScenarioState, cash, passive ComparisonControlResult) bool {
	if state == nil || !state.validAccount() {
		return false
	}
	r := state.result
	replay := r.ReferenceReplay
	n := len(bars)
	expected := 0
	if n >= 50 {
		expected = n - 49
	}
	if r.ModelIdentity != Trend50StrategyModelIdentity || r.CostIdentity != ExecutionScenarioCausalCostIdentity || r.DataLabel != CausalOfflineLabel || r.AuthorityLabel != CausalOfflineLabel || r.Scale != 8 || r.InitialModelCashUnits != fundedUnits(initial) || r.InitialEquityUnits != fundedUnits(initial) || r.ReferenceReplayRole != "reference_trigger_diagnostic_only_not_execution_pnl" || replay.ModelIdentity != Trend50StrategyModelIdentity || replay.CostIdentity != ExecutionScenarioCausalCostIdentity || replay.TargetName != "TrendConfluence" || replay.Symbol != symbol || replay.TotalBars != n || replay.DataLabel != CausalOfflineLabel || replay.AuthorityLabel != CausalOfflineLabel || len(replay.Evaluations) != expected || len(r.CloseMarks) != n || len(replay.Fills) != len(r.CashFlows) || len(replay.Fills) > CausalMaxFills || len(r.RejectedEntries) > n {
		return false
	}
	declaration := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, initial, state.fixed, state.bps, state.target, state.buy, state.sell).result.Scenario
	if r.Scenario != declaration || cash.TotalBars != n || passive.TotalBars != n || cash.Scale != 8 || passive.Scale != 8 || cash.InitialModelCashUnits != fundedUnits(initial) || passive.InitialModelCashUnits != fundedUnits(initial) {
		return false
	}
	if cash.ModelIdentity != Trend50CashModelIdentity || cash.PolicyIdentity != ComparisonCashPolicy || passive.ModelIdentity != Trend50PassiveModelIdentity || passive.PolicyIdentity != "fixed_after_50_closes_one_buy_no_exit" || cash.Symbol != symbol || passive.Symbol != symbol || len(cash.CloseMarks) != n || len(passive.CloseMarks) != n {
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
		if i < 50 && (m.ModelCashUnits != fundedUnits(initial) || m.ModelQuantity != 0 || m.PositionValueUnits != "0" || m.EquityUnits != fundedUnits(initial) || m.AggregateFeeUnits != "0") {
			return false
		}
		if i >= 49 {
			e := replay.Evaluations[i-49]
			if e.BarIndex != i || e.PrefixLength != i+1 || e.Name != "TrendConfluence" || e.Symbol != symbol || !e.Timestamp.Equal(at) || e.AssetClass != strategies.AssetEquity || len(e.Components) != 0 || causalDomain(e.Signal, e.Score, e.StopLossPct, e.TargetPct) != "" {
				return false
			}
		}
	}
	for i, f := range replay.Fills {
		if f.BarIndex < 50 || f.BarIndex >= n || f.EvaluationBarIndex < 49 || f.EvaluationBarIndex >= f.BarIndex || r.CashFlows[i].FillIndex != i || r.CashFlows[i].BarIndex != f.BarIndex {
			return false
		}
	}
	for _, e := range r.RejectedEntries {
		if e.BarIndex < 50 || e.BarIndex >= n || e.EvaluationBarIndex != e.BarIndex-1 {
			return false
		}
	}
	last := r.CloseMarks[n-1]
	if r.FinalModelCashUnits != last.ModelCashUnits || r.FinalModelQuantity != last.ModelQuantity || r.FinalPositionPrincipalUnits != last.PositionPrincipalUnits || r.FinalPositionEntryFeeUnits != last.PositionEntryFeeUnits || r.FinalPositionTotalBasisUnits != last.PositionTotalBasisUnits || r.FinalPositionValueUnits != last.PositionValueUnits || r.FinalEquityUnits != last.EquityUnits || r.GrossRealizedAccountingPnLUnits != last.GrossRealizedAccountingPnLUnits || r.GrossUnrealizedAccountingPnLUnits != last.GrossUnrealizedAccountingPnLUnits || r.NetRealizedAccountingPnLUnits != last.NetRealizedAccountingPnLUnits || r.NetUnrealizedAccountingPnLUnits != last.NetUnrealizedAccountingPnLUnits || r.ClosedAttributedFeeUnits != last.ClosedAttributedFeeUnits || r.OpenAttributedFeeUnits != last.OpenAttributedFeeUnits || r.AggregateFeeUnits != last.AggregateFeeUnits || r.PeakCloseEquityUnits != last.PeakEquityUnits {
		return false
	}
	if r.FinalModelCashUnits != fundedUnits(state.cash) || r.FinalPositionPrincipalUnits != fundedUnits(state.principal) || r.FinalPositionEntryFeeUnits != fundedUnits(state.entryFee) || r.FinalPositionTotalBasisUnits != fundedUnits(state.basis) || r.NetRealizedAccountingPnLUnits != fundedUnits(state.realized) || r.AggregateFeeUnits != fundedUnits(state.fees) || r.FinalModelQuantity != state.quantity {
		return false
	}
	if n < 50 && (replay.PendingSignalUnfilled || replay.TerminalPosition != nil || replay.ClosedTradeCount != 0 || replay.GrossProfitFactor != nil || replay.GrossProfitFactorReason != CausalNoClosedTrades) {
		return false
	}
	if !trend50ControlFinal(cash) || !trend50ControlFinal(passive) || cash.Entry != nil || cash.EntryStatus != "no_eligible_bar" {
		return false
	}
	if n <= 50 && (passive.Entry != nil || passive.EntryStatus != "no_eligible_bar" || len(replay.Fills) != 0 || len(r.RejectedEntries) != 0) {
		return false
	}
	if n > 50 && (passive.Entry == nil || passive.Entry.BarIndex != 50 || passive.Entry.PolicyDecisionBarIndex != 49 || passive.Entry.Reason != "fixed_after_50_closes_one_buy" || passive.Entry.Origin != "fixed_control_policy" || !passive.Entry.Timestamp.Equal(time.Unix(bars[50].Timestamp, 0).UTC()) || passive.Entry.ReferencePrice != bars[50].Open || (passive.EntryStatus != "filled" && passive.EntryStatus != FundedInsufficientModelCash)) {
		return false
	}
	return true
}

// trend50MarksConsistent reconciles every close with its source price and the
// same fixed-point accounting and drawdown domains used by the replay.
func trend50MarksConsistent(ctx context.Context, bars []OHLCV, initial int64, marks []ExecutionScenarioCausalCloseMark, maxDD FundedCausalDrawdown) bool {
	if len(marks) != len(bars) {
		return false
	}
	peak, maxLoss, maxPeak, maxBar := initial, int64(0), int64(0), -1
	for i, m := range marks {
		if ctx.Err() != nil || m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
			return false
		}
		cash, a := comparisonUnits(m.ModelCashUnits, false, fundedMaxUnits)
		principal, b := comparisonUnits(m.PositionPrincipalUnits, false, fundedEntryUnits)
		fee, c := comparisonUnits(m.PositionEntryFeeUnits, false, fundedEntryUnits)
		basis, d := comparisonUnits(m.PositionTotalBasisUnits, false, fundedEntryUnits)
		value, e := comparisonUnits(m.PositionValueUnits, false, fundedMaxEquity)
		equity, f := comparisonUnits(m.EquityUnits, false, fundedMaxEquity)
		grossReal, g := comparisonUnits(m.GrossRealizedAccountingPnLUnits, true, fundedMaxEquity)
		grossOpen, h := comparisonUnits(m.GrossUnrealizedAccountingPnLUnits, true, fundedMaxEquity)
		netReal, j := comparisonUnits(m.NetRealizedAccountingPnLUnits, true, fundedMaxEquity)
		netOpen, k := comparisonUnits(m.NetUnrealizedAccountingPnLUnits, true, fundedMaxEquity)
		closed, l := comparisonUnits(m.ClosedAttributedFeeUnits, false, fundedMaxUnits)
		open, o := comparisonUnits(m.OpenAttributedFeeUnits, false, fundedMaxUnits)
		aggregate, q := comparisonUnits(m.AggregateFeeUnits, false, fundedMaxUnits)
		if !a || !b || !c || !d || !e || !f || !g || !h || !j || !k || !l || !o || !q {
			return false
		}
		if basis != principal+fee || open != fee || aggregate != closed+open || grossReal-closed != netReal || grossOpen != value-principal || netOpen != value-basis || cash+value != equity || initial+netReal+netOpen != equity {
			return false
		}
		if m.ModelQuantity == 0 {
			if principal != 0 || basis != 0 || value != 0 {
				return false
			}
		} else {
			if !causalFiniteRange(m.ModelQuantity, .00001, 1000) {
				return false
			}
			quote, code := fundedQuoteUnits(bars[i].Close, m.ModelQuantity)
			if code != "" || quote != value {
				return false
			}
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity
		if m.PeakEquityUnits != fundedUnits(peak) || !reflect.DeepEqual(m.CloseMarkDrawdown, fundedDrawdown(loss, peak, i)) {
			return false
		}
		if loss > 0 && peak > 0 && (maxLoss == 0 || fundedRatioGreater(loss, peak, maxLoss, maxPeak)) {
			maxLoss, maxPeak, maxBar = loss, peak, i
		}
	}
	if maxPeak == 0 {
		maxPeak = peak
	}
	return reflect.DeepEqual(maxDD, fundedDrawdown(maxLoss, maxPeak, maxBar))
}
func trend50ControlFinal(c ComparisonControlResult) bool {
	if len(c.CloseMarks) == 0 {
		return false
	}
	m := c.CloseMarks[len(c.CloseMarks)-1]
	return c.FinalModelCashUnits == m.ModelCashUnits && c.FinalModelQuantity == m.ModelQuantity && c.FinalPositionPrincipalUnits == m.PositionPrincipalUnits && c.FinalPositionEntryFeeUnits == m.PositionEntryFeeUnits && c.FinalPositionTotalBasisUnits == m.PositionTotalBasisUnits && c.FinalPositionValueUnits == m.PositionValueUnits && c.FinalEquityUnits == m.EquityUnits && c.NetRealizedAccountingPnLUnits == m.NetRealizedAccountingPnLUnits && c.NetUnrealizedAccountingPnLUnits == m.NetUnrealizedAccountingPnLUnits && c.AggregateFeeUnits == m.AggregateFeeUnits && c.PeakCloseEquityUnits == m.PeakEquityUnits
}
