package backtest

import (
	"context"
	"math"
	"math/big"
	"time"
)

const (
	FeeScenarioCausalModelIdentity = "gelt.legacy-go.fee-scenario-close-next-open.v1"
	FeeScenarioCausalCostIdentity  = "declared_fixed8_per_side_fee_scenario"
	FeeScenarioCausalBasis         = "uncalibrated_declared"
	FeeScenarioCausalApplication   = "per_filled_side"
	FeeScenarioCausalFeeBasis      = "quantized_gross_notional"

	FeeScenarioInvalidScenario         CausalErrorCode = "invalid_fee_scenario"
	FeeScenarioInsufficientExitFeeCash CausalErrorCode = "insufficient_exit_fee_cash"

	feeScenarioRateDenominator = int64(10000)
)

// FeeScenario is mandatory declared model input. Neither field is inferred
// from an account, provider or actual fee schedule.
type FeeScenario struct {
	FixedFee string
	FeeBps   string
}

// FeeScenarioCausalError retains only a fixed code and bounded input index.
type FeeScenarioCausalError struct {
	Code     CausalErrorCode `json:"code"`
	BarIndex int             `json:"bar_index"`
}

func (e *FeeScenarioCausalError) Error() string {
	if e == nil {
		return "fee scenario causal replay failed"
	}
	switch e.Code {
	case FundedInvalidModelCash:
		return "fee scenario causal replay: invalid_model_cash"
	case FeeScenarioInvalidScenario:
		return "fee scenario causal replay: invalid_fee_scenario"
	case FeeScenarioInsufficientExitFeeCash:
		return "fee scenario causal replay: insufficient_exit_fee_cash"
	case CausalInvalidInput:
		return "fee scenario causal replay: invalid_input"
	case CausalInvalidSymbol:
		return "fee scenario causal replay: invalid_symbol"
	case CausalInvalidEvaluator:
		return "fee scenario causal replay: invalid_evaluator"
	case CausalEvaluatorIdentity:
		return "fee scenario causal replay: evaluator_identity"
	case CausalEvaluatorError:
		return "fee scenario causal replay: evaluator_error"
	case CausalPlanMembership:
		return "fee scenario causal replay: plan_membership"
	case CausalUnsupported:
		return "fee scenario causal replay: unsupported_condition"
	case CausalNumericRange:
		return "fee scenario causal replay: numeric_range"
	case CausalCanceled:
		return "fee scenario causal replay: canceled"
	case CausalResourceLimit:
		return "fee scenario causal replay: resource_limit"
	default:
		return "fee scenario causal replay failed"
	}
}

type FeeScenarioCausalDeclaration struct {
	FixedFeeUnits   string `json:"fixed_fee_units"`
	FeeBps          string `json:"fee_bps"`
	RateDenominator string `json:"rate_denominator"`
	ScenarioBasis   string `json:"scenario_basis"`
	Application     string `json:"application"`
	FeeBasis        string `json:"fee_basis"`
}

// All monetary fields are canonical integer counts of 10^-8 model USD.
// Signed fields are explicitly named delta or accounting PnL. Replay float
// gross diagnostics remain separate and are never used as accounting money.
type FeeScenarioCausalCashFlow struct {
	FillIndex                       int              `json:"fill_index"`
	Kind                            CausalFillKind   `json:"kind"`
	Reason                          CausalFillReason `json:"reason"`
	BarIndex                        int              `json:"bar_index"`
	Timestamp                       time.Time        `json:"timestamp"`
	EvaluationBarIndex              int              `json:"evaluation_bar_index"`
	EntrySignalBarIndex             int              `json:"entry_signal_bar_index"`
	EntryBarIndex                   int              `json:"entry_bar_index"`
	GrossNotionalUnits              string           `json:"gross_notional_units"`
	FeeUnits                        string           `json:"fee_units"`
	NetCashDeltaUnits               string           `json:"net_cash_delta_units"`
	DebitedUnits                    string           `json:"debited_units"`
	CreditedUnits                   string           `json:"credited_units"`
	ModelCashUnits                  string           `json:"model_cash_units"`
	PositionPrincipalUnits          string           `json:"position_principal_units"`
	PositionEntryFeeUnits           string           `json:"position_entry_fee_units"`
	PositionTotalBasisUnits         string           `json:"position_total_basis_units"`
	GrossRealizedAccountingPnLUnits string           `json:"gross_realized_accounting_pnl_units"`
	NetRealizedAccountingPnLUnits   string           `json:"net_realized_accounting_pnl_units"`
	ClosedAttributedFeeUnits        string           `json:"closed_attributed_fee_units"`
	AggregateFeeUnits               string           `json:"aggregate_fee_units"`
}

type FeeScenarioCausalRejectedEntry struct {
	Reason                  string    `json:"reason"`
	BarIndex                int       `json:"bar_index"`
	Timestamp               time.Time `json:"timestamp"`
	EvaluationBarIndex      int       `json:"evaluation_bar_index"`
	EvaluationTimestamp     time.Time `json:"evaluation_timestamp"`
	AvailableModelCashUnits string    `json:"available_model_cash_units"`
	GrossNotionalUnits      string    `json:"gross_notional_units"`
	FeeUnits                string    `json:"fee_units"`
	RequiredModelCashUnits  string    `json:"required_model_cash_units"`
}

type FeeScenarioCausalCloseMark struct {
	BarIndex                          int                  `json:"bar_index"`
	Timestamp                         time.Time            `json:"timestamp"`
	ModelCashUnits                    string               `json:"model_cash_units"`
	ModelQuantity                     float64              `json:"model_quantity"`
	PositionPrincipalUnits            string               `json:"position_principal_units"`
	PositionEntryFeeUnits             string               `json:"position_entry_fee_units"`
	PositionTotalBasisUnits           string               `json:"position_total_basis_units"`
	PositionValueUnits                string               `json:"position_value_units"`
	EquityUnits                       string               `json:"equity_units"`
	PeakEquityUnits                   string               `json:"peak_equity_units"`
	GrossRealizedAccountingPnLUnits   string               `json:"gross_realized_accounting_pnl_units"`
	GrossUnrealizedAccountingPnLUnits string               `json:"gross_unrealized_accounting_pnl_units"`
	NetRealizedAccountingPnLUnits     string               `json:"net_realized_accounting_pnl_units"`
	NetUnrealizedAccountingPnLUnits   string               `json:"net_unrealized_accounting_pnl_units"`
	ClosedAttributedFeeUnits          string               `json:"closed_attributed_fee_units"`
	OpenAttributedFeeUnits            string               `json:"open_attributed_fee_units"`
	AggregateFeeUnits                 string               `json:"aggregate_fee_units"`
	CloseMarkDrawdown                 FundedCausalDrawdown `json:"close_mark_drawdown"`
}

type FeeScenarioCausalResult struct {
	ModelIdentity                     string                           `json:"model_identity"`
	CostIdentity                      string                           `json:"cost_identity"`
	DataLabel                         string                           `json:"data_label"`
	AuthorityLabel                    string                           `json:"authority_label"`
	Scale                             int                              `json:"scale"`
	Scenario                          FeeScenarioCausalDeclaration     `json:"scenario"`
	InitialModelCashUnits             string                           `json:"initial_model_cash_units"`
	InitialEquityUnits                string                           `json:"initial_equity_units"`
	Replay                            CausalResult                     `json:"replay_float_gross_diagnostic"`
	CashFlows                         []FeeScenarioCausalCashFlow      `json:"cash_flows"`
	RejectedEntries                   []FeeScenarioCausalRejectedEntry `json:"rejected_entries"`
	CloseMarks                        []FeeScenarioCausalCloseMark     `json:"close_marks"`
	FinalModelCashUnits               string                           `json:"final_model_cash_units"`
	FinalModelQuantity                float64                          `json:"final_model_quantity"`
	FinalPositionPrincipalUnits       string                           `json:"final_position_principal_units"`
	FinalPositionEntryFeeUnits        string                           `json:"final_position_entry_fee_units"`
	FinalPositionTotalBasisUnits      string                           `json:"final_position_total_basis_units"`
	FinalPositionValueUnits           string                           `json:"final_position_value_units"`
	FinalEquityUnits                  string                           `json:"final_equity_units"`
	GrossRealizedAccountingPnLUnits   string                           `json:"gross_realized_accounting_pnl_units"`
	GrossUnrealizedAccountingPnLUnits string                           `json:"gross_unrealized_accounting_pnl_units"`
	NetRealizedAccountingPnLUnits     string                           `json:"net_realized_accounting_pnl_units"`
	NetUnrealizedAccountingPnLUnits   string                           `json:"net_unrealized_accounting_pnl_units"`
	ClosedAttributedFeeUnits          string                           `json:"closed_attributed_fee_units"`
	OpenAttributedFeeUnits            string                           `json:"open_attributed_fee_units"`
	AggregateFeeUnits                 string                           `json:"aggregate_fee_units"`
	PeakCloseEquityUnits              string                           `json:"peak_close_equity_units"`
	MaxCloseMarkDrawdown              FundedCausalDrawdown             `json:"max_close_mark_drawdown"`
}

type causalFeeScenarioState struct {
	result                     FeeScenarioCausalResult
	fixed, bps, target         int64
	initial, cash              int64
	principal, entryFee, basis int64
	grossClosed, realized      int64
	closedFees, fees           int64
	peak, maxLoss, maxPeak     int64
	maxBar                     int
	quantity                   float64
}

func feeScenarioFailure(code CausalErrorCode, index int) (FeeScenarioCausalResult, error) {
	return FeeScenarioCausalResult{}, &FeeScenarioCausalError{Code: code, BarIndex: index}
}

// Inputs to this multiplication are nonnegative. Check before multiplying,
// including when current public bounds already imply that the product fits.
func feeScenarioCheckedMul(a, b int64) (int64, bool) {
	if a < 0 || b < 0 || a != 0 && b > math.MaxInt64/a {
		return 0, false
	}
	return a * b, true
}

func feeScenarioParse(scenario FeeScenario) (fixed, bps, target int64, ok bool) {
	fixed, ok = fundedParseCash(scenario.FixedFee)
	if !ok || fixed >= fundedEntryUnits {
		return 0, 0, 0, false
	}
	token := scenario.FeeBps
	if len(token) == 0 || len(token) > 5 || len(token) > 1 && token[0] == '0' {
		return 0, 0, 0, false
	}
	for i := 0; i < len(token); i++ {
		if token[i] < '0' || token[i] > '9' {
			return 0, 0, 0, false
		}
		product, valid := feeScenarioCheckedMul(bps, 10)
		if !valid {
			return 0, 0, 0, false
		}
		bps, valid = fundedCheckedAdd(product, int64(token[i]-'0'))
		if !valid || bps > feeScenarioRateDenominator {
			return 0, 0, 0, false
		}
	}
	remaining, valid := fundedCheckedSub(fundedEntryUnits, fixed)
	if !valid {
		return 0, 0, 0, false
	}
	numerator, valid := feeScenarioCheckedMul(remaining, feeScenarioRateDenominator)
	if !valid {
		return 0, 0, 0, false
	}
	denominator, valid := fundedCheckedAdd(feeScenarioRateDenominator, bps)
	if !valid || denominator <= 0 {
		return 0, 0, 0, false
	}
	// Zero is valid here. It fails only at an eligible entry sizing attempt.
	return fixed, bps, numerator / denominator, true
}

func feeScenarioFeeUnits(gross, fixed, bps int64) (int64, CausalErrorCode) {
	if gross < 0 || gross > fundedMaxUnits ||
		fixed < 0 || fixed >= fundedEntryUnits ||
		bps < 0 || bps > feeScenarioRateDenominator {
		return 0, CausalNumericRange
	}
	product, ok := feeScenarioCheckedMul(gross, bps)
	if !ok {
		return 0, CausalNumericRange
	}
	proportional := product / feeScenarioRateDenominator
	if product%feeScenarioRateDenominator != 0 {
		proportional, ok = fundedCheckedAdd(proportional, 1)
		if !ok {
			return 0, CausalNumericRange
		}
	}
	fee, ok := fundedCheckedAdd(fixed, proportional)
	if !ok || fee < 0 || fee > fundedMaxEquity {
		return 0, CausalNumericRange
	}
	return fee, ""
}

// Nonzero scenarios round the exact rational target quantity down to binary
// float64, then independently require that the fixed8 quote still equals T.
func feeScenarioQuantity(price float64, target int64, zeroScenario bool) (float64, CausalErrorCode) {
	if target <= 0 || target > fundedEntryUnits ||
		!causalFiniteRange(price, 0.01, 1000000) {
		return 0, CausalNumericRange
	}
	var quantity float64
	if zeroScenario {
		if target != fundedEntryUnits {
			return 0, CausalNumericRange
		}
		quantity = CausalEntryBudgetUSD / price
	} else {
		priceRat := new(big.Rat).SetFloat64(price)
		exact := new(big.Rat).SetFrac(big.NewInt(target), big.NewInt(fundedUnitScale))
		exact.Quo(exact, priceRat)
		quantity, _ = exact.Float64()
		if !causalFiniteRange(quantity, 0.00001, 1000) {
			return 0, CausalNumericRange
		}
		binary := new(big.Rat).SetFloat64(quantity)
		if binary.Cmp(exact) > 0 {
			quantity = math.Nextafter(quantity, 0)
		}
		if !causalFiniteRange(quantity, 0.00001, 1000) {
			return 0, CausalNumericRange
		}
		raw := new(big.Rat).Mul(priceRat, new(big.Rat).SetFloat64(quantity))
		limit := new(big.Rat).SetFrac(big.NewInt(target), big.NewInt(fundedUnitScale))
		if raw.Cmp(limit) > 0 {
			return 0, CausalNumericRange
		}
	}
	if !causalFiniteRange(quantity, 0.00001, 1000) {
		return 0, CausalNumericRange
	}
	quoted, code := fundedQuoteUnits(price, quantity)
	if code != "" || quoted != target {
		return 0, CausalNumericRange
	}
	return quantity, ""
}

func newCausalFeeScenarioState(initial, fixed, bps, target int64) *causalFeeScenarioState {
	units := fundedUnits(initial)
	return &causalFeeScenarioState{
		fixed: fixed, bps: bps, target: target,
		initial: initial, cash: initial, peak: initial, maxBar: causalNoBar,
		result: FeeScenarioCausalResult{
			ModelIdentity: FeeScenarioCausalModelIdentity,
			CostIdentity:  FeeScenarioCausalCostIdentity,
			DataLabel:     CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel,
			Scale: FundedCausalScale,
			Scenario: FeeScenarioCausalDeclaration{
				FixedFeeUnits: fundedUnits(fixed), FeeBps: fundedUnits(bps),
				RateDenominator: "10000", ScenarioBasis: FeeScenarioCausalBasis,
				Application: FeeScenarioCausalApplication, FeeBasis: FeeScenarioCausalFeeBasis,
			},
			InitialModelCashUnits: units, InitialEquityUnits: units,
		},
	}
}

// validAccount checks the retained-basis and attributed-fee identities without
// consulting float gross diagnostics or cached externally supplied records.
func (s *causalFeeScenarioState) validAccount() bool {
	if s.initial < 0 || s.initial > fundedMaxUnits ||
		s.cash < 0 || s.cash > fundedMaxUnits ||
		s.principal < 0 || s.principal > fundedEntryUnits ||
		s.entryFee < 0 || s.entryFee > fundedEntryUnits ||
		s.basis < 0 || s.basis > fundedEntryUnits ||
		s.closedFees < 0 || s.closedFees > fundedMaxUnits ||
		s.fees < 0 || s.fees > fundedMaxUnits ||
		s.grossClosed < -fundedMaxEquity || s.grossClosed > fundedMaxEquity ||
		s.realized < -fundedMaxEquity || s.realized > fundedMaxEquity {
		return false
	}
	if s.quantity == 0 {
		if s.principal != 0 || s.entryFee != 0 || s.basis != 0 {
			return false
		}
	} else if !causalFiniteRange(s.quantity, 0.00001, 1000) ||
		s.principal <= 0 || s.basis <= 0 {
		return false
	}
	basis, ok := fundedCheckedAdd(s.principal, s.entryFee)
	if !ok || basis != s.basis {
		return false
	}
	fees, ok := fundedCheckedAdd(s.closedFees, s.entryFee)
	if !ok || fees != s.fees {
		return false
	}
	net, ok := fundedCheckedSub(s.grossClosed, s.closedFees)
	if !ok || net != s.realized {
		return false
	}
	cash, ok := fundedCheckedAdd(s.initial, s.realized)
	if !ok {
		return false
	}
	cash, ok = fundedCheckedSub(cash, s.basis)
	return ok && cash == s.cash
}

// No candidate position, protection, fill or fee is created by this gate.
// A zero target is fatal before the funding comparison, including with cash0.
func (s *causalFeeScenarioState) entryGate(
	bar OHLCV, index int, evaluation CausalEvaluation,
) (float64, bool, CausalErrorCode) {
	if s.target == 0 {
		return 0, false, CausalNumericRange
	}
	if !s.validAccount() || s.quantity != 0 {
		return 0, false, CausalNumericRange
	}
	quantity, code := feeScenarioQuantity(bar.Open, s.target, s.fixed == 0 && s.bps == 0)
	if code != "" {
		return 0, false, code
	}
	fee, code := feeScenarioFeeUnits(s.target, s.fixed, s.bps)
	if code != "" {
		return 0, false, code
	}
	required, ok := fundedCheckedAdd(s.target, fee)
	if !ok || required <= 0 || required > fundedEntryUnits {
		return 0, false, CausalNumericRange
	}
	if s.cash >= required {
		return quantity, true, ""
	}
	if len(s.result.RejectedEntries) >= CausalMaxBars {
		return 0, false, CausalResourceLimit
	}
	s.result.RejectedEntries = append(s.result.RejectedEntries, FeeScenarioCausalRejectedEntry{
		Reason: FundedInsufficientModelCash, BarIndex: index,
		Timestamp:          time.Unix(bar.Timestamp, 0).UTC(),
		EvaluationBarIndex: evaluation.BarIndex, EvaluationTimestamp: evaluation.Timestamp,
		AvailableModelCashUnits: fundedUnits(s.cash),
		GrossNotionalUnits:      fundedUnits(s.target), FeeUnits: fundedUnits(fee),
		RequiredModelCashUnits: fundedUnits(required),
	})
	return quantity, false, ""
}

func (s *causalFeeScenarioState) fill(fill CausalFill, fillIndex int) CausalErrorCode {
	if len(s.result.CashFlows) >= CausalMaxFills {
		return CausalResourceLimit
	}
	if fillIndex != len(s.result.CashFlows) || !s.validAccount() {
		return CausalNumericRange
	}
	gross, code := fundedQuoteUnits(fill.Price, fill.Quantity)
	if code != "" {
		return code
	}
	fee, code := feeScenarioFeeUnits(gross, s.fixed, s.bps)
	if code != "" {
		return code
	}
	next := *s
	var debit, credit, delta int64
	var ok bool
	switch fill.Kind {
	case CausalEntry:
		if s.quantity != 0 || gross != s.target || gross <= 0 {
			return CausalNumericRange
		}
		expectedQuantity, quantityCode := feeScenarioQuantity(
			fill.Price, s.target, s.fixed == 0 && s.bps == 0,
		)
		if quantityCode != "" || fill.Quantity != expectedQuantity {
			return CausalNumericRange
		}
		debit, ok = fundedCheckedAdd(gross, fee)
		if !ok || debit <= 0 || debit > fundedEntryUnits || s.cash < debit {
			return CausalNumericRange
		}
		delta, ok = fundedCheckedSub(0, debit)
		if !ok {
			return CausalNumericRange
		}
		next.principal, next.entryFee, next.basis = gross, fee, debit
		next.quantity = fill.Quantity
	case CausalExit:
		if s.quantity <= 0 || fill.Quantity != s.quantity || s.basis <= 0 {
			return CausalNumericRange
		}
		delta, ok = fundedCheckedSub(gross, fee)
		if !ok {
			return CausalNumericRange
		}
		if delta < 0 {
			debit, ok = fundedCheckedSub(0, delta)
			if !ok {
				return CausalNumericRange
			}
			if s.cash < debit {
				return FeeScenarioInsufficientExitFeeCash
			}
		} else {
			credit = delta
		}
		netPnL, valid := fundedCheckedSub(delta, s.basis)
		if !valid {
			return CausalNumericRange
		}
		next.realized, ok = fundedCheckedAdd(s.realized, netPnL)
		if !ok {
			return CausalNumericRange
		}
		grossPnL, valid := fundedCheckedSub(gross, s.principal)
		if !valid {
			return CausalNumericRange
		}
		next.grossClosed, ok = fundedCheckedAdd(s.grossClosed, grossPnL)
		if !ok {
			return CausalNumericRange
		}
		attributed, valid := fundedCheckedAdd(s.entryFee, fee)
		if !valid {
			return CausalNumericRange
		}
		next.closedFees, ok = fundedCheckedAdd(s.closedFees, attributed)
		if !ok {
			return CausalNumericRange
		}
		next.principal, next.entryFee, next.basis, next.quantity = 0, 0, 0, 0
	default:
		return CausalNumericRange
	}
	next.cash, ok = fundedCheckedAdd(s.cash, delta)
	if !ok {
		return CausalNumericRange
	}
	next.fees, ok = fundedCheckedAdd(s.fees, fee)
	if !ok || !next.validAccount() {
		return CausalNumericRange
	}
	flow := FeeScenarioCausalCashFlow{
		FillIndex: fillIndex, Kind: fill.Kind, Reason: fill.Reason,
		BarIndex: fill.BarIndex, Timestamp: fill.Timestamp,
		EvaluationBarIndex:  fill.EvaluationBarIndex,
		EntrySignalBarIndex: fill.EntrySignalBarIndex, EntryBarIndex: fill.EntryBarIndex,
		GrossNotionalUnits: fundedUnits(gross), FeeUnits: fundedUnits(fee),
		NetCashDeltaUnits: fundedUnits(delta),
		DebitedUnits:      fundedUnits(debit), CreditedUnits: fundedUnits(credit),
		ModelCashUnits:                  fundedUnits(next.cash),
		PositionPrincipalUnits:          fundedUnits(next.principal),
		PositionEntryFeeUnits:           fundedUnits(next.entryFee),
		PositionTotalBasisUnits:         fundedUnits(next.basis),
		GrossRealizedAccountingPnLUnits: fundedUnits(next.grossClosed),
		NetRealizedAccountingPnLUnits:   fundedUnits(next.realized),
		ClosedAttributedFeeUnits:        fundedUnits(next.closedFees),
		AggregateFeeUnits:               fundedUnits(next.fees),
	}
	next.result.CashFlows = append(next.result.CashFlows, flow)
	*s = next
	return ""
}

func (s *causalFeeScenarioState) mark(bar OHLCV, index int, position *causalPosition) CausalErrorCode {
	if len(s.result.CloseMarks) >= CausalMaxBars {
		return CausalResourceLimit
	}
	if index != len(s.result.CloseMarks) || !s.validAccount() {
		return CausalNumericRange
	}
	var value int64
	if position == nil {
		if s.quantity != 0 {
			return CausalNumericRange
		}
	} else {
		if s.quantity <= 0 || position.quantity != s.quantity {
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
	netOpen, ok := fundedCheckedSub(value, s.basis)
	if !ok || netOpen < -fundedMaxEquity || netOpen > fundedMaxEquity {
		return CausalNumericRange
	}
	grossOpen, ok := fundedCheckedSub(value, s.principal)
	if !ok || grossOpen < -fundedMaxEquity || grossOpen > fundedMaxEquity {
		return CausalNumericRange
	}
	reconciledOpen, ok := fundedCheckedSub(grossOpen, s.entryFee)
	if !ok || reconciledOpen != netOpen {
		return CausalNumericRange
	}
	accounted, ok := fundedCheckedAdd(s.initial, s.realized)
	if !ok {
		return CausalNumericRange
	}
	accounted, ok = fundedCheckedAdd(accounted, netOpen)
	if !ok || accounted != equity {
		return CausalNumericRange
	}
	peak := s.peak
	if equity > peak {
		peak = equity
	}
	if peak < 0 || peak > fundedMaxEquity {
		return CausalNumericRange
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
	mark := FeeScenarioCausalCloseMark{
		BarIndex: index, Timestamp: time.Unix(bar.Timestamp, 0).UTC(),
		ModelCashUnits: fundedUnits(s.cash), ModelQuantity: s.quantity,
		PositionPrincipalUnits:  fundedUnits(s.principal),
		PositionEntryFeeUnits:   fundedUnits(s.entryFee),
		PositionTotalBasisUnits: fundedUnits(s.basis),
		PositionValueUnits:      fundedUnits(value), EquityUnits: fundedUnits(equity),
		PeakEquityUnits:                   fundedUnits(peak),
		GrossRealizedAccountingPnLUnits:   fundedUnits(s.grossClosed),
		GrossUnrealizedAccountingPnLUnits: fundedUnits(grossOpen),
		NetRealizedAccountingPnLUnits:     fundedUnits(s.realized),
		NetUnrealizedAccountingPnLUnits:   fundedUnits(netOpen),
		ClosedAttributedFeeUnits:          fundedUnits(s.closedFees),
		OpenAttributedFeeUnits:            fundedUnits(s.entryFee),
		AggregateFeeUnits:                 fundedUnits(s.fees),
		CloseMarkDrawdown:                 fundedDrawdown(loss, peak, index),
	}
	s.peak, s.maxLoss, s.maxPeak, s.maxBar = peak, maxLoss, maxPeak, maxBar
	s.result.CloseMarks = append(s.result.CloseMarks, mark)
	s.result.FinalModelCashUnits = mark.ModelCashUnits
	s.result.FinalModelQuantity = mark.ModelQuantity
	s.result.FinalPositionPrincipalUnits = mark.PositionPrincipalUnits
	s.result.FinalPositionEntryFeeUnits = mark.PositionEntryFeeUnits
	s.result.FinalPositionTotalBasisUnits = mark.PositionTotalBasisUnits
	s.result.FinalPositionValueUnits = mark.PositionValueUnits
	s.result.FinalEquityUnits = mark.EquityUnits
	s.result.GrossRealizedAccountingPnLUnits = mark.GrossRealizedAccountingPnLUnits
	s.result.GrossUnrealizedAccountingPnLUnits = mark.GrossUnrealizedAccountingPnLUnits
	s.result.NetRealizedAccountingPnLUnits = mark.NetRealizedAccountingPnLUnits
	s.result.NetUnrealizedAccountingPnLUnits = mark.NetUnrealizedAccountingPnLUnits
	s.result.ClosedAttributedFeeUnits = mark.ClosedAttributedFeeUnits
	s.result.OpenAttributedFeeUnits = mark.OpenAttributedFeeUnits
	s.result.AggregateFeeUnits = mark.AggregateFeeUnits
	s.result.PeakCloseEquityUnits = mark.PeakEquityUnits
	s.result.MaxCloseMarkDrawdown = fundedDrawdown(maxLoss, maximumDenominator, maxBar)
	return ""
}

// RunFeeScenarioCausal is an opt-in, uncalibrated declared-fee replay.
// The fixed8 entry debit is at most 10 model USD, including the declared fee.
// It performs no actual money, broker, provider, slippage or liquidation action.
// The exclusive ownership and cancellation limitations of RunCausal apply.
// Fatal failure returns a zero entire result; it does not reset evaluator state.
func (e *Engine) RunFeeScenarioCausal(
	ctx context.Context, symbol string, bars []OHLCV,
	initialModelCash string, scenario FeeScenario,
) (FeeScenarioCausalResult, error) {
	initial, ok := fundedParseCash(initialModelCash)
	if !ok {
		return feeScenarioFailure(FundedInvalidModelCash, causalNoBar)
	}
	fixed, bps, target, ok := feeScenarioParse(scenario)
	if !ok {
		return feeScenarioFailure(FeeScenarioInvalidScenario, causalNoBar)
	}
	state := newCausalFeeScenarioState(initial, fixed, bps, target)
	replay, err := e.runCausal(ctx, symbol, bars, nil, state)
	if err != nil {
		if bounded, ok := err.(*CausalError); ok {
			return feeScenarioFailure(bounded.Code, bounded.BarIndex)
		}
		return feeScenarioFailure(CausalInvalidInput, causalNoBar)
	}
	state.result.Replay = replay
	return state.result, nil
}
