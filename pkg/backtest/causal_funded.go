package backtest

import (
	"context"
	"math"
	"math/big"
	"strconv"
	"time"
)

const (
	FundedCausalModelIdentity = "gelt.legacy-go.funded-close-next-open.v1"
	FundedCausalCostIdentity  = "frictionless_funded_fixed8_diagnostic"
	FundedCausalScale         = 8

	FundedInvalidModelCash CausalErrorCode = "invalid_model_cash"

	FundedInsufficientModelCash = "insufficient_model_cash"
	FundedZeroInitialEquity     = "zero_initial_model_equity"

	fundedUnitScale  = int64(100000000)
	fundedEntryUnits = int64(1000000000)
	fundedMaxUnits   = int64(100000000000000)
	fundedMaxEquity  = int64(200000000000000)
)

// FundedCausalError never retains input tokens or callback errors.
type FundedCausalError struct {
	Code     CausalErrorCode `json:"code"`
	BarIndex int             `json:"bar_index"`
}

func (e *FundedCausalError) Error() string {
	if e == nil {
		return "funded causal replay failed"
	}
	switch e.Code {
	case FundedInvalidModelCash:
		return "funded causal replay: invalid_model_cash"
	case CausalInvalidInput:
		return "funded causal replay: invalid_input"
	case CausalInvalidSymbol:
		return "funded causal replay: invalid_symbol"
	case CausalInvalidEvaluator:
		return "funded causal replay: invalid_evaluator"
	case CausalEvaluatorIdentity:
		return "funded causal replay: evaluator_identity"
	case CausalEvaluatorError:
		return "funded causal replay: evaluator_error"
	case CausalPlanMembership:
		return "funded causal replay: plan_membership"
	case CausalUnsupported:
		return "funded causal replay: unsupported_condition"
	case CausalNumericRange:
		return "funded causal replay: numeric_range"
	case CausalCanceled:
		return "funded causal replay: canceled"
	case CausalResourceLimit:
		return "funded causal replay: resource_limit"
	default:
		return "funded causal replay failed"
	}
}

// All monetary strings below are canonical integer counts of 10^-8 model USD.
// Quantity and the separately labeled Replay gross diagnostics remain float64.
// None of these records establishes actual cash, holdings or execution.
type FundedCausalCashFlow struct {
	FillIndex           int              `json:"fill_index"`
	Kind                CausalFillKind   `json:"kind"`
	Reason              CausalFillReason `json:"reason"`
	BarIndex            int              `json:"bar_index"`
	Timestamp           time.Time        `json:"timestamp"`
	EvaluationBarIndex  int              `json:"evaluation_bar_index"`
	EntrySignalBarIndex int              `json:"entry_signal_bar_index"`
	EntryBarIndex       int              `json:"entry_bar_index"`
	DebitedUnits        string           `json:"debited_units"`
	CreditedUnits       string           `json:"credited_units"`
	ModelCashUnits      string           `json:"model_cash_units"`
	PositionCostUnits   string           `json:"position_cost_units"`
	RealizedPnLUnits    string           `json:"realized_accounting_pnl_units"`
}

type FundedCausalRejectedEntry struct {
	Reason                  string    `json:"reason"`
	BarIndex                int       `json:"bar_index"`
	Timestamp               time.Time `json:"timestamp"`
	EvaluationBarIndex      int       `json:"evaluation_bar_index"`
	EvaluationTimestamp     time.Time `json:"evaluation_timestamp"`
	AvailableModelCashUnits string    `json:"available_model_cash_units"`
	RequiredModelCashUnits  string    `json:"required_model_cash_units"`
}

// A nil ratio has a fixed UndefinedReason. A positive-peak zero drawdown has
// numerator "0", a positive denominator, percent 0 and no maximum bar index.
type FundedCausalDrawdown struct {
	LossUnits       *string  `json:"loss_units"`
	PeakEquityUnits *string  `json:"peak_equity_units"`
	Percent         *float64 `json:"percent"`
	BarIndex        *int     `json:"bar_index"`
	UndefinedReason string   `json:"undefined_reason"`
}

type FundedCausalCloseMark struct {
	BarIndex           int                  `json:"bar_index"`
	Timestamp          time.Time            `json:"timestamp"`
	ModelCashUnits     string               `json:"model_cash_units"`
	ModelQuantity      float64              `json:"model_quantity"`
	PositionCostUnits  string               `json:"position_cost_units"`
	PositionValueUnits string               `json:"position_value_units"`
	EquityUnits        string               `json:"equity_units"`
	PeakEquityUnits    string               `json:"peak_equity_units"`
	RealizedPnLUnits   string               `json:"realized_accounting_pnl_units"`
	UnrealizedPnLUnits string               `json:"unrealized_accounting_pnl_units"`
	CloseMarkDrawdown  FundedCausalDrawdown `json:"close_mark_drawdown"`
}

type FundedCausalResult struct {
	ModelIdentity                string                      `json:"model_identity"`
	CostIdentity                 string                      `json:"cost_identity"`
	DataLabel                    string                      `json:"data_label"`
	AuthorityLabel               string                      `json:"authority_label"`
	Scale                        int                         `json:"scale"`
	InitialModelCashUnits        string                      `json:"initial_model_cash_units"`
	InitialEquityUnits           string                      `json:"initial_equity_units"`
	Replay                       CausalResult                `json:"replay_float_gross_diagnostic"`
	CashFlows                    []FundedCausalCashFlow      `json:"cash_flows"`
	RejectedEntries              []FundedCausalRejectedEntry `json:"rejected_entries"`
	CloseMarks                   []FundedCausalCloseMark     `json:"close_marks"`
	FinalModelCashUnits          string                      `json:"final_model_cash_units"`
	FinalModelQuantity           float64                     `json:"final_model_quantity"`
	FinalPositionCostUnits       string                      `json:"final_position_cost_units"`
	FinalPositionValueUnits      string                      `json:"final_position_value_units"`
	FinalEquityUnits             string                      `json:"final_equity_units"`
	RealizedAccountingPnLUnits   string                      `json:"realized_accounting_pnl_units"`
	UnrealizedAccountingPnLUnits string                      `json:"unrealized_accounting_pnl_units"`
	PeakCloseEquityUnits         string                      `json:"peak_close_equity_units"`
	MaxCloseMarkDrawdown         FundedCausalDrawdown        `json:"max_close_mark_drawdown"`
}

type causalFundedState struct {
	result               FundedCausalResult
	initial, cash, basis int64
	realized, peak       int64
	maxLoss, maxPeak     int64
	maxBar               int
	quantity             float64
}

func fundedFailure(code CausalErrorCode, index int) (FundedCausalResult, error) {
	return FundedCausalResult{}, &FundedCausalError{Code: code, BarIndex: index}
}

func fundedUnits(v int64) string {
	return strconv.FormatInt(v, 10)
}

// fundedParseCash accepts only the declared ordinary unsigned ASCII grammar.
// It never converts model cash through float64.
func fundedParseCash(token string) (int64, bool) {
	if len(token) == 0 || len(token) > 32 {
		return 0, false
	}
	i := 0
	var whole int64
	for i < len(token) && token[i] >= '0' && token[i] <= '9' {
		digit := int64(token[i] - '0')
		if whole > (1000000-digit)/10 {
			return 0, false
		}
		whole = whole*10 + digit
		i++
	}
	if i == 0 || i > 1 && token[0] == '0' {
		return 0, false
	}
	var fraction int64
	digits := 0
	if i < len(token) {
		if token[i] != '.' {
			return 0, false
		}
		i++
		for i < len(token) && token[i] >= '0' && token[i] <= '9' {
			if digits == FundedCausalScale {
				return 0, false
			}
			fraction = fraction*10 + int64(token[i]-'0')
			digits++
			i++
		}
		if digits == 0 {
			return 0, false
		}
	}
	if i != len(token) {
		return 0, false
	}
	for digits < FundedCausalScale {
		fraction *= 10
		digits++
	}
	units := whole*fundedUnitScale + fraction
	if units > fundedMaxUnits {
		return 0, false
	}
	return units, true
}

func fundedCheckedAdd(a, b int64) (int64, bool) {
	if b > 0 && a > math.MaxInt64-b || b < 0 && a < math.MinInt64-b {
		return 0, false
	}
	return a + b, true
}

func fundedCheckedSub(a, b int64) (int64, bool) {
	if b > 0 && a < math.MinInt64+b || b < 0 && a > math.MaxInt64+b {
		return 0, false
	}
	return a - b, true
}

// fundedQuoteUnits multiplies exact binary float values as rationals, scales
// once, and rounds once to nearest with ties to even. Neither a float product
// nor a decimal rendering participates in the conversion. The exact source
// value and its rounded representation must both fit the position-value bound.
func fundedQuoteUnits(price, quantity float64) (int64, CausalErrorCode) {
	if !causalFiniteRange(price, math.SmallestNonzeroFloat64, causalMaxLevel) ||
		!causalFiniteRange(quantity, math.SmallestNonzeroFloat64, 1000) {
		return 0, CausalNumericRange
	}
	p := new(big.Rat).SetFloat64(price)
	q := new(big.Rat).SetFloat64(quantity)
	if p == nil || q == nil {
		return 0, CausalNumericRange
	}
	scaled := new(big.Rat).Mul(p, q)
	scaled.Mul(scaled, new(big.Rat).SetInt64(fundedUnitScale))
	if scaled.Sign() <= 0 || scaled.Cmp(new(big.Rat).SetInt64(fundedMaxUnits)) > 0 {
		return 0, CausalNumericRange
	}
	rounded, remainder := new(big.Int), new(big.Int)
	rounded.QuoRem(scaled.Num(), scaled.Denom(), remainder)
	twice := new(big.Int).Lsh(remainder, 1)
	comparison := twice.Cmp(scaled.Denom())
	if comparison > 0 || comparison == 0 && rounded.Bit(0) == 1 {
		rounded.Add(rounded, big.NewInt(1))
	}
	if !rounded.IsInt64() {
		return 0, CausalNumericRange
	}
	units := rounded.Int64()
	if units < 0 || units > fundedMaxUnits {
		return 0, CausalNumericRange
	}
	return units, ""
}

// fundedRatioGreater deliberately uses unbounded products: valid unit pairs
// can require approximately 96 bits for their cross-products.
func fundedRatioGreater(loss, peak, oldLoss, oldPeak int64) bool {
	left := new(big.Int).Mul(big.NewInt(loss), big.NewInt(oldPeak))
	right := new(big.Int).Mul(big.NewInt(oldLoss), big.NewInt(peak))
	return left.Cmp(right) > 0
}

func fundedDrawdown(loss, peak int64, bar int) FundedCausalDrawdown {
	if peak == 0 {
		return FundedCausalDrawdown{UndefinedReason: FundedZeroInitialEquity}
	}
	numerator, denominator := fundedUnits(loss), fundedUnits(peak)
	ratio := new(big.Rat).SetFrac(big.NewInt(loss), big.NewInt(peak))
	ratio.Mul(ratio, big.NewRat(100, 1))
	percent, _ := ratio.Float64()
	out := FundedCausalDrawdown{
		LossUnits: &numerator, PeakEquityUnits: &denominator, Percent: &percent,
	}
	if loss > 0 {
		index := bar
		out.BarIndex = &index
	}
	return out
}

func newCausalFundedState(initial int64) *causalFundedState {
	units := fundedUnits(initial)
	return &causalFundedState{
		initial: initial, cash: initial, peak: initial, maxBar: causalNoBar,
		result: FundedCausalResult{
			ModelIdentity: FundedCausalModelIdentity, CostIdentity: FundedCausalCostIdentity,
			DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel,
			Scale: FundedCausalScale, InitialModelCashUnits: units, InitialEquityUnits: units,
		},
	}
}

// entryGate is called only for the eligible flat pending BUY. No position or
// protection is constructed until this gate permits the full fixed-size entry.
func (s *causalFundedState) entryGate(
	bar OHLCV, index int, evaluation CausalEvaluation,
) (bool, CausalErrorCode) {
	quantity := CausalEntryBudgetUSD / bar.Open
	if !causalFiniteRange(quantity, 0.00001, 1000) ||
		s.quantity != 0 || s.basis != 0 {
		return false, CausalNumericRange
	}
	required, code := fundedQuoteUnits(bar.Open, quantity)
	if code != "" || required != fundedEntryUnits {
		return false, CausalNumericRange
	}
	if s.cash >= required {
		return true, ""
	}
	if len(s.result.RejectedEntries) >= CausalMaxBars {
		return false, CausalResourceLimit
	}
	s.result.RejectedEntries = append(s.result.RejectedEntries, FundedCausalRejectedEntry{
		Reason: FundedInsufficientModelCash, BarIndex: index,
		Timestamp:          time.Unix(bar.Timestamp, 0).UTC(),
		EvaluationBarIndex: evaluation.BarIndex, EvaluationTimestamp: evaluation.Timestamp,
		AvailableModelCashUnits: fundedUnits(s.cash), RequiredModelCashUnits: fundedUnits(required),
	})
	return false, ""
}

func (s *causalFundedState) fill(fill CausalFill, fillIndex int) CausalErrorCode {
	if len(s.result.CashFlows) >= CausalMaxFills {
		return CausalResourceLimit
	}
	if fillIndex != len(s.result.CashFlows) {
		return CausalNumericRange
	}
	amount, code := fundedQuoteUnits(fill.Price, fill.Quantity)
	if code != "" {
		return code
	}
	cash, basis, realized, quantity := s.cash, s.basis, s.realized, s.quantity
	var debit, credit int64
	var ok bool
	switch fill.Kind {
	case CausalEntry:
		if quantity != 0 || basis != 0 || amount != fundedEntryUnits || cash < amount {
			return CausalNumericRange
		}
		cash, ok = fundedCheckedSub(cash, amount)
		if !ok {
			return CausalNumericRange
		}
		debit, basis, quantity = amount, amount, fill.Quantity
	case CausalExit:
		if quantity <= 0 || fill.Quantity != quantity || basis != fundedEntryUnits {
			return CausalNumericRange
		}
		cash, ok = fundedCheckedAdd(cash, amount)
		if !ok {
			return CausalNumericRange
		}
		pnl, valid := fundedCheckedSub(amount, basis)
		if !valid {
			return CausalNumericRange
		}
		realized, ok = fundedCheckedAdd(realized, pnl)
		if !ok {
			return CausalNumericRange
		}
		credit, basis, quantity = amount, 0, 0
	default:
		return CausalNumericRange
	}
	if cash < 0 || cash > fundedMaxUnits {
		return CausalNumericRange
	}
	// This identity also detects a lost or duplicated position basis.
	accounted, ok := fundedCheckedAdd(s.initial, realized)
	if !ok {
		return CausalNumericRange
	}
	accounted, ok = fundedCheckedSub(accounted, basis)
	if !ok || accounted != cash {
		return CausalNumericRange
	}
	flow := FundedCausalCashFlow{
		FillIndex: fillIndex, Kind: fill.Kind, Reason: fill.Reason,
		BarIndex: fill.BarIndex, Timestamp: fill.Timestamp,
		EvaluationBarIndex:  fill.EvaluationBarIndex,
		EntrySignalBarIndex: fill.EntrySignalBarIndex, EntryBarIndex: fill.EntryBarIndex,
		DebitedUnits: fundedUnits(debit), CreditedUnits: fundedUnits(credit),
		ModelCashUnits: fundedUnits(cash), PositionCostUnits: fundedUnits(basis),
		RealizedPnLUnits: fundedUnits(realized),
	}
	s.cash, s.basis, s.realized, s.quantity = cash, basis, realized, quantity
	s.result.CashFlows = append(s.result.CashFlows, flow)
	return ""
}

func (s *causalFundedState) mark(bar OHLCV, index int, position *causalPosition) CausalErrorCode {
	if len(s.result.CloseMarks) >= CausalMaxBars {
		return CausalResourceLimit
	}
	if index != len(s.result.CloseMarks) || s.cash < 0 || s.cash > fundedMaxUnits {
		return CausalNumericRange
	}
	var value int64
	if position == nil {
		if s.quantity != 0 || s.basis != 0 {
			return CausalNumericRange
		}
	} else {
		if position.quantity != s.quantity || s.basis != fundedEntryUnits {
			return CausalNumericRange
		}
		var code CausalErrorCode
		value, code = fundedQuoteUnits(bar.Close, position.quantity)
		if code != "" {
			return code
		}
	}
	equity, ok := fundedCheckedAdd(s.cash, value)
	if !ok || equity < 0 || equity > fundedMaxEquity {
		return CausalNumericRange
	}
	unrealized, ok := fundedCheckedSub(value, s.basis)
	if !ok {
		return CausalNumericRange
	}
	accounted, ok := fundedCheckedAdd(s.initial, s.realized)
	if !ok {
		return CausalNumericRange
	}
	accounted, ok = fundedCheckedAdd(accounted, unrealized)
	if !ok || accounted != equity {
		return CausalNumericRange
	}
	peak := s.peak
	if equity > peak {
		peak = equity
	}
	loss, ok := fundedCheckedSub(peak, equity)
	if !ok || loss < 0 {
		return CausalNumericRange
	}
	maxLoss, maxPeak, maxBar := s.maxLoss, s.maxPeak, s.maxBar
	if peak > 0 && loss > 0 &&
		(maxLoss == 0 || fundedRatioGreater(loss, peak, maxLoss, maxPeak)) {
		maxLoss, maxPeak, maxBar = loss, peak, index
	}
	maximumDenominator := maxPeak
	if maxLoss == 0 {
		maximumDenominator = peak
	}
	mark := FundedCausalCloseMark{
		BarIndex: index, Timestamp: time.Unix(bar.Timestamp, 0).UTC(),
		ModelCashUnits: fundedUnits(s.cash), ModelQuantity: s.quantity,
		PositionCostUnits: fundedUnits(s.basis), PositionValueUnits: fundedUnits(value),
		EquityUnits: fundedUnits(equity), PeakEquityUnits: fundedUnits(peak),
		RealizedPnLUnits: fundedUnits(s.realized), UnrealizedPnLUnits: fundedUnits(unrealized),
		CloseMarkDrawdown: fundedDrawdown(loss, peak, index),
	}
	s.peak, s.maxLoss, s.maxPeak, s.maxBar = peak, maxLoss, maxPeak, maxBar
	s.result.CloseMarks = append(s.result.CloseMarks, mark)
	s.result.FinalModelCashUnits = mark.ModelCashUnits
	s.result.FinalModelQuantity = mark.ModelQuantity
	s.result.FinalPositionCostUnits = mark.PositionCostUnits
	s.result.FinalPositionValueUnits = mark.PositionValueUnits
	s.result.FinalEquityUnits = mark.EquityUnits
	s.result.RealizedAccountingPnLUnits = mark.RealizedPnLUnits
	s.result.UnrealizedAccountingPnLUnits = mark.UnrealizedPnLUnits
	s.result.PeakCloseEquityUnits = mark.PeakEquityUnits
	s.result.MaxCloseMarkDrawdown = fundedDrawdown(maxLoss, maximumDenominator, maxBar)
	return ""
}

// RunFundedCausal is a separate opt-in fixed8 model-cash and close-mark replay.
// initialModelCash is mandatory model input, never an actual-account lookup.
// The caller ownership, prefix isolation and cancellation limitations of
// RunCausal also apply. Fatal failures return no partial accounting evidence.
// An expected insufficient-cash entry is a recorded nonfill and replay continues.
func (e *Engine) RunFundedCausal(
	ctx context.Context, symbol string, data []OHLCV, initialModelCash string,
) (FundedCausalResult, error) {
	initial, ok := fundedParseCash(initialModelCash)
	if !ok {
		return fundedFailure(FundedInvalidModelCash, causalNoBar)
	}
	state := newCausalFundedState(initial)
	replay, err := e.runCausal(ctx, symbol, data, state, nil)
	if err != nil {
		if bounded, ok := err.(*CausalError); ok {
			return fundedFailure(bounded.Code, bounded.BarIndex)
		}
		return fundedFailure(CausalInvalidInput, causalNoBar)
	}
	state.result.Replay = replay
	return state.result, nil
}
