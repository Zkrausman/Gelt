package backtest

import (
	"context"
	"strconv"
	"time"
)

const (
	ComparisonCausalModelIdentity  = "gelt.legacy-go.causal-comparison.v1"
	ComparisonCashModelIdentity    = "gelt.legacy-go.flat-cash-control.v1"
	ComparisonPassiveModelIdentity = "gelt.legacy-go.one-lot-passive-control.v1"
	ComparisonCashPolicy           = "flat_cash_no_interest_no_fills"
	ComparisonPassivePolicy        = "fixed_after_20_closes_one_buy_no_exit"
)

// These controls are accounting counterfactuals, never strategy evaluations or orders.
type ComparisonControlEntry struct {
	Origin, Reason                                                            string
	PolicyDecisionBarIndex, BarIndex                                          int
	Timestamp                                                                 time.Time
	ReferencePrice, ExecutionPrice, ModelQuantity                             float64
	PrincipalUnits, FeeUnits, RequiredModelCashUnits, AvailableModelCashUnits string
}
type ComparisonControlResult struct {
	ModelIdentity, PolicyIdentity, Symbol                                                                   string
	TotalBars, Scale                                                                                        int
	InitialModelCashUnits, EntryStatus                                                                      string
	Entry                                                                                                   *ComparisonControlEntry
	CloseMarks                                                                                              []ExecutionScenarioCausalCloseMark
	FinalModelCashUnits                                                                                     string
	FinalModelQuantity                                                                                      float64
	FinalPositionPrincipalUnits, FinalPositionEntryFeeUnits, FinalPositionTotalBasisUnits                   string
	FinalPositionValueUnits, FinalEquityUnits                                                               string
	NetRealizedAccountingPnLUnits, NetUnrealizedAccountingPnLUnits, AggregateFeeUnits, PeakCloseEquityUnits string
	MaxCloseMarkDrawdown                                                                                    FundedCausalDrawdown
}
type ComparisonCausalResult struct {
	ModelIdentity, CostIdentity, ScenarioBasis, DataLabel, AuthorityLabel, Symbol string
	TotalBars, Scale                                                              int
	InitialModelCashUnits                                                         string
	Scenario                                                                      ExecutionScenarioCausalDeclaration
	Strategy                                                                      ExecutionScenarioCausalResult
	Cash, Passive                                                                 ComparisonControlResult
	StrategyMinusCashUnits, StrategyMinusPassiveUnits                             string
}
type ComparisonCausalError struct {
	Code     CausalErrorCode
	BarIndex int
}

func (e *ComparisonCausalError) Error() string {
	if e != nil {
		switch e.Code {
		case FundedInvalidModelCash, ExecutionScenarioInvalidScenario, ExecutionScenarioInsufficientExitFeeCash,
			CausalInvalidInput, CausalInvalidSymbol, CausalInvalidEvaluator, CausalEvaluatorIdentity, CausalEvaluatorError,
			CausalPlanMembership, CausalUnsupported, CausalNumericRange, CausalCanceled, CausalResourceLimit:
			return "causal comparison: " + string(e.Code)
		}
	}
	return "causal comparison failed"
}
func comparisonFailure(code CausalErrorCode, index int) (ComparisonCausalResult, error) {
	return ComparisonCausalResult{}, &ComparisonCausalError{code, index}
}
func comparisonUnits(token string, signed bool, bound int64) (int64, bool) {
	v, err := strconv.ParseInt(token, 10, 64)
	return v, err == nil && strconv.FormatInt(v, 10) == token && (signed || v >= 0) && v >= -bound && v <= bound
}

type comparisonControlState struct {
	result                               ComparisonControlResult
	initial, cash, principal, fee, basis int64
	quantity                             float64
	peak, maxLoss, maxPeak               int64
	maxBar                               int
}

func newComparisonControl(model, policy, symbol string, n int, initial int64) comparisonControlState {
	return comparisonControlState{initial: initial, cash: initial, peak: initial, maxBar: -1,
		result: ComparisonControlResult{ModelIdentity: model, PolicyIdentity: policy, Symbol: symbol, TotalBars: n,
			Scale: 8, InitialModelCashUnits: fundedUnits(initial), EntryStatus: "no_eligible_bar"}}
}
func (s *comparisonControlState) mark(bar OHLCV, index int) CausalErrorCode {
	if index != len(s.result.CloseMarks) || index >= CausalMaxBars || s.cash < 0 || s.cash > fundedMaxUnits ||
		s.principal < 0 || s.fee < 0 || s.basis < 0 || s.basis > fundedEntryUnits {
		return CausalNumericRange
	}
	basis, ok := fundedCheckedAdd(s.principal, s.fee)
	if !ok || basis != s.basis || s.cash != s.initial-s.basis {
		return CausalNumericRange
	}
	var value int64
	if s.quantity != 0 {
		if !causalFiniteRange(s.quantity, .00001, 1000) || s.principal <= 0 {
			return CausalNumericRange
		}
		var code CausalErrorCode
		value, code = fundedQuoteUnits(bar.Close, s.quantity)
		if code != "" {
			return code
		}
	} else if s.basis != 0 || s.principal != 0 || s.fee != 0 {
		return CausalNumericRange
	}
	equity, ok := fundedCheckedAdd(s.cash, value)
	if !ok || equity < 0 || equity > fundedMaxEquity {
		return CausalNumericRange
	}
	gross, ok := fundedCheckedSub(value, s.principal)
	if !ok || gross < -fundedMaxEquity || gross > fundedMaxEquity {
		return CausalNumericRange
	}
	net, ok := fundedCheckedSub(value, s.basis)
	if !ok || net < -fundedMaxEquity || net > fundedMaxEquity {
		return CausalNumericRange
	}
	accounted, ok := fundedCheckedAdd(s.initial, net)
	if !ok || accounted != equity || gross-s.fee != net {
		return CausalNumericRange
	}
	if equity > s.peak {
		s.peak = equity
	}
	loss := s.peak - equity
	if loss > 0 && s.peak > 0 && (s.maxLoss == 0 || fundedRatioGreater(loss, s.peak, s.maxLoss, s.maxPeak)) {
		s.maxLoss, s.maxPeak, s.maxBar = loss, s.peak, index
	}
	m := ExecutionScenarioCausalCloseMark{BarIndex: index, Timestamp: time.Unix(bar.Timestamp, 0).UTC(),
		ModelCashUnits: fundedUnits(s.cash), ModelQuantity: s.quantity, PositionPrincipalUnits: fundedUnits(s.principal),
		PositionEntryFeeUnits: fundedUnits(s.fee), PositionTotalBasisUnits: fundedUnits(s.basis), PositionValueUnits: fundedUnits(value),
		EquityUnits: fundedUnits(equity), PeakEquityUnits: fundedUnits(s.peak), GrossRealizedAccountingPnLUnits: "0",
		GrossUnrealizedAccountingPnLUnits: fundedUnits(gross), NetRealizedAccountingPnLUnits: "0", NetUnrealizedAccountingPnLUnits: fundedUnits(net),
		ClosedAttributedFeeUnits: "0", OpenAttributedFeeUnits: fundedUnits(s.fee), AggregateFeeUnits: fundedUnits(s.fee), CloseMarkDrawdown: fundedDrawdown(loss, s.peak, index)}
	s.result.CloseMarks = append(s.result.CloseMarks, m)
	s.result.FinalModelCashUnits = m.ModelCashUnits
	s.result.FinalModelQuantity = m.ModelQuantity
	s.result.FinalPositionPrincipalUnits = m.PositionPrincipalUnits
	s.result.FinalPositionEntryFeeUnits = m.PositionEntryFeeUnits
	s.result.FinalPositionTotalBasisUnits = m.PositionTotalBasisUnits
	s.result.FinalPositionValueUnits = m.PositionValueUnits
	s.result.FinalEquityUnits = m.EquityUnits
	s.result.NetRealizedAccountingPnLUnits = "0"
	s.result.NetUnrealizedAccountingPnLUnits = m.NetUnrealizedAccountingPnLUnits
	s.result.AggregateFeeUnits = m.AggregateFeeUnits
	s.result.PeakCloseEquityUnits = m.PeakEquityUnits
	denom := s.maxPeak
	if denom == 0 {
		denom = s.peak
	}
	s.result.MaxCloseMarkDrawdown = fundedDrawdown(s.maxLoss, denom, s.maxBar)
	return ""
}
func comparisonControls(ctx context.Context, symbol string, bars []OHLCV, initial, fixed, bps, target, buy int64) (ComparisonControlResult, ComparisonControlResult, CausalErrorCode, int) {
	cash := newComparisonControl(ComparisonCashModelIdentity, ComparisonCashPolicy, symbol, len(bars), initial)
	passive := newComparisonControl(ComparisonPassiveModelIdentity, ComparisonPassivePolicy, symbol, len(bars), initial)
	for i, bar := range bars {
		if ctx.Err() != nil {
			return ComparisonControlResult{}, ComparisonControlResult{}, CausalCanceled, i
		}
		if i == 20 {
			if target == 0 {
				return ComparisonControlResult{}, ComparisonControlResult{}, CausalNumericRange, i
			}
			price, code := executionScenarioPrice(bar.Open, buy, CausalEntry)
			if code != "" {
				return ComparisonControlResult{}, ComparisonControlResult{}, code, i
			}
			quantity, code := feeScenarioQuantity(price, target, fixed == 0 && bps == 0 && buy == 0)
			if code != "" {
				return ComparisonControlResult{}, ComparisonControlResult{}, code, i
			}
			principal, code := fundedQuoteUnits(price, quantity)
			if code != "" || principal != target {
				return ComparisonControlResult{}, ComparisonControlResult{}, CausalNumericRange, i
			}
			fee, code := feeScenarioFeeUnits(principal, fixed, bps)
			if code != "" {
				return ComparisonControlResult{}, ComparisonControlResult{}, code, i
			}
			debit, ok := fundedCheckedAdd(principal, fee)
			if !ok || debit <= 0 || debit > fundedEntryUnits {
				return ComparisonControlResult{}, ComparisonControlResult{}, CausalNumericRange, i
			}
			passive.result.Entry = &ComparisonControlEntry{Origin: "fixed_control_policy", Reason: "fixed_after_20_closes_one_buy", PolicyDecisionBarIndex: 19,
				BarIndex: 20, Timestamp: time.Unix(bar.Timestamp, 0).UTC(), ReferencePrice: bar.Open, ExecutionPrice: price, ModelQuantity: quantity,
				PrincipalUnits: fundedUnits(principal), FeeUnits: fundedUnits(fee), RequiredModelCashUnits: fundedUnits(debit), AvailableModelCashUnits: fundedUnits(initial)}
			if initial < debit {
				passive.result.EntryStatus = FundedInsufficientModelCash
			} else {
				passive.result.EntryStatus = "filled"
				passive.cash = initial - debit
				passive.principal = principal
				passive.fee = fee
				passive.basis = debit
				passive.quantity = quantity
			}
		}
		if code := cash.mark(bar, i); code != "" {
			return ComparisonControlResult{}, ComparisonControlResult{}, code, i
		}
		if code := passive.mark(bar, i); code != "" {
			return ComparisonControlResult{}, ComparisonControlResult{}, code, i
		}
	}
	return cash.result, passive.result, "", -1
}

// RunComparisonCausal computes controls first and invokes the existing strategy
// replay once. Fresh exclusively owned input/evaluator and stable pure metadata
// are required; name/reference checks are not authentication or sandboxing.
func (e *Engine) RunComparisonCausal(ctx context.Context, symbol string, data []OHLCV, initialModelCash string, scenario ExecutionScenario) (ComparisonCausalResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return comparisonFailure(CausalCanceled, -1)
	}
	initial, ok := fundedParseCash(initialModelCash)
	if !ok {
		return comparisonFailure(FundedInvalidModelCash, -1)
	}
	fixed, bps, target, ok := feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps})
	if !ok {
		return comparisonFailure(ExecutionScenarioInvalidScenario, -1)
	}
	buy, buyOK := executionScenarioRate(scenario.BuyAdverseBps)
	sell, sellOK := executionScenarioRate(scenario.SellAdverseBps)
	if !buyOK || !sellOK {
		return comparisonFailure(ExecutionScenarioInvalidScenario, -1)
	}
	if len(data) > CausalMaxBars {
		return comparisonFailure(CausalResourceLimit, -1)
	}
	bars := append([]OHLCV(nil), data...)
	if i, code := causalValidateBars(bars); code != "" {
		return comparisonFailure(code, i)
	}
	if !causalSymbol(symbol) {
		return comparisonFailure(CausalInvalidSymbol, -1)
	}
	if e == nil || causalNil(e.strategy) == causalNil(e.plan) {
		return comparisonFailure(CausalInvalidEvaluator, -1)
	}
	if !causalNil(e.plan) {
		return comparisonFailure(CausalUnsupported, -1)
	}
	strategy := e.strategy
	name := strategy.Name()
	if !causalName(name) {
		return comparisonFailure(CausalInvalidEvaluator, -1)
	}
	if name != "BreakoutVol" {
		return comparisonFailure(CausalUnsupported, -1)
	}
	unchanged := func() bool {
		return causalNil(e.plan) && !causalNil(e.strategy) && causalSameStrategy(e.strategy, strategy) && strategy.Name() == name
	}
	cash, passive, code, i := comparisonControls(ctx, symbol, bars, initial, fixed, bps, target, buy)
	if code != "" {
		return comparisonFailure(code, i)
	}
	if ctx.Err() != nil {
		return comparisonFailure(CausalCanceled, -1)
	}
	if !unchanged() {
		return comparisonFailure(CausalEvaluatorIdentity, -1)
	}
	result, err := e.RunExecutionScenarioCausal(ctx, symbol, bars, initialModelCash, scenario)
	if err != nil {
		if x, ok := err.(*ExecutionScenarioCausalError); ok {
			return comparisonFailure(x.Code, x.BarIndex)
		}
		return comparisonFailure(CausalInvalidInput, -1)
	}
	if ctx.Err() != nil {
		return comparisonFailure(CausalCanceled, -1)
	}
	if !unchanged() || result.ReferenceReplay.TargetName != name || result.ReferenceReplay.Symbol != symbol {
		return comparisonFailure(CausalEvaluatorIdentity, -1)
	}
	declaration := newCausalExecutionScenarioState(initial, fixed, bps, target, buy, sell).result.Scenario
	if result.ModelIdentity != ExecutionScenarioCausalModelIdentity || result.CostIdentity != ExecutionScenarioCausalCostIdentity || result.Scenario != declaration ||
		result.InitialModelCashUnits != fundedUnits(initial) || result.ReferenceReplay.TotalBars != len(bars) || len(result.CloseMarks) != len(bars) {
		return comparisonFailure(CausalNumericRange, -1)
	}
	for i, m := range result.CloseMarks {
		if m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
			return comparisonFailure(CausalNumericRange, i)
		}
	}
	equity, valid := comparisonUnits(result.FinalEquityUnits, false, fundedMaxEquity)
	if !valid {
		return comparisonFailure(CausalNumericRange, -1)
	}
	passiveEquity, valid := comparisonUnits(passive.FinalEquityUnits, false, fundedMaxEquity)
	if !valid {
		return comparisonFailure(CausalNumericRange, -1)
	}
	gapCash, ok := fundedCheckedSub(equity, initial)
	if !ok || gapCash < -fundedMaxEquity || gapCash > fundedMaxEquity {
		return comparisonFailure(CausalNumericRange, -1)
	}
	gapPassive, ok := fundedCheckedSub(equity, passiveEquity)
	if !ok || gapPassive < -fundedMaxEquity || gapPassive > fundedMaxEquity {
		return comparisonFailure(CausalNumericRange, -1)
	}
	return ComparisonCausalResult{ModelIdentity: ComparisonCausalModelIdentity, CostIdentity: ExecutionScenarioCausalCostIdentity, ScenarioBasis: ExecutionScenarioCausalBasis,
		DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel, Symbol: symbol, TotalBars: len(bars), Scale: 8, InitialModelCashUnits: fundedUnits(initial), Scenario: declaration,
		Strategy: result, Cash: cash, Passive: passive, StrategyMinusCashUnits: fundedUnits(gapCash), StrategyMinusPassiveUnits: fundedUnits(gapPassive)}, nil
}
