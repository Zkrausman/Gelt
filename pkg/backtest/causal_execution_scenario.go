package backtest

import (
	"context"
	"math"
	"math/big"
	"time"
)

const (
	ExecutionScenarioCausalModelIdentity = "gelt.legacy-go.execution-scenario-close-next-open.v1"
	ExecutionScenarioCausalCostIdentity  = "declared_fixed8_fees_and_adverse_execution_price_scenario"
	ExecutionScenarioCausalBasis         = "uncalibrated_declared"
	ExecutionScenarioCausalApplication   = "per_filled_side"
	ExecutionScenarioCausalFeeBasis      = "quantized_gross_notional"

	ExecutionScenarioInvalidScenario         CausalErrorCode = "invalid_execution_scenario"
	ExecutionScenarioInsufficientExitFeeCash CausalErrorCode = "insufficient_exit_fee_cash"

	executionScenarioRateDenominator = int64(10000)
)

// ExecutionScenario is mandatory declared model input. Neither field is inferred
// from an account, provider or actual fee schedule.
type ExecutionScenario struct {
	FixedFee       string
	FeeBps         string
	BuyAdverseBps  string
	SellAdverseBps string
}

// ExecutionScenarioCausalError retains only a fixed code and bounded input index.
type ExecutionScenarioCausalError struct {
	Code     CausalErrorCode `json:"code"`
	BarIndex int             `json:"bar_index"`
}

func (e *ExecutionScenarioCausalError) Error() string {
	if e == nil {
		return "execution scenario causal replay failed"
	}
	switch e.Code {
	case FundedInvalidModelCash:
		return "execution scenario causal replay: invalid_model_cash"
	case ExecutionScenarioInvalidScenario:
		return "execution scenario causal replay: invalid_execution_scenario"
	case ExecutionScenarioInsufficientExitFeeCash:
		return "execution scenario causal replay: insufficient_exit_fee_cash"
	case CausalInvalidInput:
		return "execution scenario causal replay: invalid_input"
	case CausalInvalidSymbol:
		return "execution scenario causal replay: invalid_symbol"
	case CausalInvalidEvaluator:
		return "execution scenario causal replay: invalid_evaluator"
	case CausalEvaluatorIdentity:
		return "execution scenario causal replay: evaluator_identity"
	case CausalEvaluatorError:
		return "execution scenario causal replay: evaluator_error"
	case CausalPlanMembership:
		return "execution scenario causal replay: plan_membership"
	case CausalUnsupported:
		return "execution scenario causal replay: unsupported_condition"
	case CausalNumericRange:
		return "execution scenario causal replay: numeric_range"
	case CausalCanceled:
		return "execution scenario causal replay: canceled"
	case CausalResourceLimit:
		return "execution scenario causal replay: resource_limit"
	default:
		return "execution scenario causal replay failed"
	}
}

type ExecutionScenarioCausalDeclaration struct {
	FixedFeeUnits      string `json:"fixed_fee_units"`
	FeeBps             string `json:"fee_bps"`
	RateDenominator    string `json:"rate_denominator"`
	ScenarioBasis      string `json:"scenario_basis"`
	Application        string `json:"application"`
	FeeBasis           string `json:"fee_basis"`
	BuyAdverseBps      string `json:"buy_adverse_bps"`
	SellAdverseBps     string `json:"sell_adverse_bps"`
	PriceRule          string `json:"price_rule"`
	ProtectionGeometry string `json:"protection_geometry"`
}

// All monetary fields are canonical integer counts of 10^-8 model USD.
// Signed fields are explicitly named delta or accounting PnL. Replay float
// gross diagnostics remain separate and are never used as accounting money.
type ExecutionScenarioCausalCashFlow struct {
	ReferencePrice                  float64          `json:"reference_price"`
	ExecutionPrice                  float64          `json:"execution_price"`
	SideAdverseBps                  string           `json:"side_adverse_bps"`
	ReferenceNotionalUnits          string           `json:"reference_notional_units"`
	AdverseDifferenceUnits          string           `json:"adverse_difference_units"`
	AggregateAdverseDifferenceUnits string           `json:"aggregate_adverse_difference_units"`
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

type ExecutionScenarioCausalRejectedEntry struct {
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

type ExecutionScenarioCausalCloseMark struct {
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

type ExecutionScenarioCausalResult struct {
	ModelIdentity                     string                                 `json:"model_identity"`
	CostIdentity                      string                                 `json:"cost_identity"`
	DataLabel                         string                                 `json:"data_label"`
	AuthorityLabel                    string                                 `json:"authority_label"`
	Scale                             int                                    `json:"scale"`
	ReferenceReplayRole               string                                 `json:"reference_replay_role"`
	AggregateAdverseDifferenceUnits   string                                 `json:"aggregate_adverse_difference_units"`
	Scenario                          ExecutionScenarioCausalDeclaration     `json:"scenario"`
	InitialModelCashUnits             string                                 `json:"initial_model_cash_units"`
	InitialEquityUnits                string                                 `json:"initial_equity_units"`
	ReferenceReplay                   CausalResult                           `json:"reference_trigger_replay"`
	CashFlows                         []ExecutionScenarioCausalCashFlow      `json:"cash_flows"`
	RejectedEntries                   []ExecutionScenarioCausalRejectedEntry `json:"rejected_entries"`
	CloseMarks                        []ExecutionScenarioCausalCloseMark     `json:"close_marks"`
	FinalModelCashUnits               string                                 `json:"final_model_cash_units"`
	FinalModelQuantity                float64                                `json:"final_model_quantity"`
	FinalPositionPrincipalUnits       string                                 `json:"final_position_principal_units"`
	FinalPositionEntryFeeUnits        string                                 `json:"final_position_entry_fee_units"`
	FinalPositionTotalBasisUnits      string                                 `json:"final_position_total_basis_units"`
	FinalPositionValueUnits           string                                 `json:"final_position_value_units"`
	FinalEquityUnits                  string                                 `json:"final_equity_units"`
	GrossRealizedAccountingPnLUnits   string                                 `json:"gross_realized_accounting_pnl_units"`
	GrossUnrealizedAccountingPnLUnits string                                 `json:"gross_unrealized_accounting_pnl_units"`
	NetRealizedAccountingPnLUnits     string                                 `json:"net_realized_accounting_pnl_units"`
	NetUnrealizedAccountingPnLUnits   string                                 `json:"net_unrealized_accounting_pnl_units"`
	ClosedAttributedFeeUnits          string                                 `json:"closed_attributed_fee_units"`
	OpenAttributedFeeUnits            string                                 `json:"open_attributed_fee_units"`
	AggregateFeeUnits                 string                                 `json:"aggregate_fee_units"`
	PeakCloseEquityUnits              string                                 `json:"peak_close_equity_units"`
	MaxCloseMarkDrawdown              FundedCausalDrawdown                   `json:"max_close_mark_drawdown"`
}

type causalExecutionScenarioState struct {
	result                     ExecutionScenarioCausalResult
	fixed, bps, target         int64
	buy, sell, difference      int64
	initial, cash              int64
	principal, entryFee, basis int64
	grossClosed, realized      int64
	closedFees, fees           int64
	peak, maxLoss, maxPeak     int64
	maxBar                     int
	quantity                   float64
}

func executionScenarioFailure(code CausalErrorCode, index int) (ExecutionScenarioCausalResult, error) {
	return ExecutionScenarioCausalResult{}, &ExecutionScenarioCausalError{Code: code, BarIndex: index}
}

// executionScenarioRate is deliberately separate from the existing fee grammar.
func executionScenarioRate(token string) (int64, bool) {
	if len(token) < 1 || len(token) > 4 || len(token) > 1 && token[0] == '0' {
		return 0, false
	}
	var value int64
	for i := 0; i < len(token); i++ {
		if token[i] < '0' || token[i] > '9' {
			return 0, false
		}
		value = value*10 + int64(token[i]-'0')
	}
	return value, value <= 9999
}

// Exact binary-rational multiplication followed by one adverse-direction
// float conversion. It is not a tick/decimal quote or an observed spread.
func executionScenarioPrice(reference float64, rate int64, side CausalFillKind) (float64, CausalErrorCode) {
	if !causalFiniteRange(reference, math.SmallestNonzeroFloat64, causalMaxLevel) || rate < 0 || rate > 9999 || (side != CausalEntry && side != CausalExit) {
		return 0, CausalNumericRange
	}
	if rate == 0 {
		return reference, ""
	}
	numerator := int64(10000) + rate
	if side == CausalExit {
		numerator = 10000 - rate
	}
	exact := new(big.Rat).Mul(new(big.Rat).SetFloat64(reference), new(big.Rat).SetFrac(big.NewInt(numerator), big.NewInt(10000)))
	price, _ := exact.Float64()
	if !causalFiniteRange(price, math.SmallestNonzeroFloat64, causalMaxLevel) {
		return 0, CausalNumericRange
	}
	cmp := new(big.Rat).SetFloat64(price).Cmp(exact)
	if side == CausalEntry && cmp < 0 {
		price = math.Nextafter(price, math.Inf(1))
	}
	if side == CausalExit && cmp > 0 {
		price = math.Nextafter(price, 0)
	}
	if !causalFiniteRange(price, math.SmallestNonzeroFloat64, causalMaxLevel) {
		return 0, CausalNumericRange
	}
	return price, ""
}

func newCausalExecutionScenarioState(initial, fixed, bps, target, buy, sell int64) *causalExecutionScenarioState {
	return newCausalExecutionScenarioStateForProfile(causalProfileShipped20, initial, fixed, bps, target, buy, sell)
}

func newCausalExecutionScenarioStateForProfile(profile causalReplayProfile, initial, fixed, bps, target, buy, sell int64) *causalExecutionScenarioState {
	model := ExecutionScenarioCausalModelIdentity
	if profile == causalProfileTrend50 {
		model = Trend50StrategyModelIdentity
	} else if profile != causalProfileShipped20 {
		return nil
	}
	units := fundedUnits(initial)
	return &causalExecutionScenarioState{
		fixed: fixed, bps: bps, target: target, buy: buy, sell: sell,
		initial: initial, cash: initial, peak: initial, maxBar: causalNoBar,
		result: ExecutionScenarioCausalResult{
			ModelIdentity: model,
			CostIdentity:  ExecutionScenarioCausalCostIdentity,
			DataLabel:     CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel,
			Scale:                           FundedCausalScale,
			ReferenceReplayRole:             "reference_trigger_diagnostic_only_not_execution_pnl",
			AggregateAdverseDifferenceUnits: "0",
			Scenario: ExecutionScenarioCausalDeclaration{
				FixedFeeUnits: fundedUnits(fixed), FeeBps: fundedUnits(bps),
				BuyAdverseBps: fundedUnits(buy), SellAdverseBps: fundedUnits(sell),
				PriceRule:          "exact_binary_rational_then_adverse_float64_once",
				ProtectionGeometry: "reference_entry_and_ohlc_triggers_not_limit_fill_guarantees",
				RateDenominator:    "10000", ScenarioBasis: ExecutionScenarioCausalBasis,
				Application: ExecutionScenarioCausalApplication, FeeBasis: ExecutionScenarioCausalFeeBasis,
			},
			InitialModelCashUnits: units, InitialEquityUnits: units,
		},
	}
}

// validAccount checks the retained-basis and attributed-fee identities without
// consulting float gross diagnostics or cached externally supplied records.
func (s *causalExecutionScenarioState) validAccount() bool {
	if s.difference < 0 || s.difference > fundedMaxUnits || s.initial < 0 || s.initial > fundedMaxUnits ||
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
func (s *causalExecutionScenarioState) entryGate(
	bar OHLCV, index int, evaluation CausalEvaluation,
) (float64, bool, CausalErrorCode) {
	if s.target == 0 {
		return 0, false, CausalNumericRange
	}
	if !s.validAccount() || s.quantity != 0 {
		return 0, false, CausalNumericRange
	}
	executionPrice, code := executionScenarioPrice(bar.Open, s.buy, CausalEntry)
	if code != "" {
		return 0, false, code
	}
	quantity, code := feeScenarioQuantity(executionPrice, s.target, s.fixed == 0 && s.bps == 0 && s.buy == 0)
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
	s.result.RejectedEntries = append(s.result.RejectedEntries, ExecutionScenarioCausalRejectedEntry{
		Reason: FundedInsufficientModelCash, BarIndex: index,
		Timestamp:          time.Unix(bar.Timestamp, 0).UTC(),
		EvaluationBarIndex: evaluation.BarIndex, EvaluationTimestamp: evaluation.Timestamp,
		AvailableModelCashUnits: fundedUnits(s.cash),
		GrossNotionalUnits:      fundedUnits(s.target), FeeUnits: fundedUnits(fee),
		RequiredModelCashUnits: fundedUnits(required),
	})
	return quantity, false, ""
}

func (s *causalExecutionScenarioState) fill(fill CausalFill, fillIndex int) CausalErrorCode {
	if len(s.result.CashFlows) >= CausalMaxFills {
		return CausalResourceLimit
	}
	if fillIndex != len(s.result.CashFlows) || !s.validAccount() {
		return CausalNumericRange
	}
	referencePrice := fill.Price
	rate := s.sell
	if fill.Kind == CausalEntry {
		rate = s.buy
	} else if fill.Kind != CausalExit {
		return CausalNumericRange
	}
	executionPrice, code := executionScenarioPrice(referencePrice, rate, fill.Kind)
	if code != "" {
		return code
	}
	referenceUnits, code := fundedQuoteUnits(referencePrice, fill.Quantity)
	if code != "" {
		return code
	}
	fill.Price = executionPrice // local copy only; reference replay and protection remain unchanged.
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
			fill.Price, s.target, s.fixed == 0 && s.bps == 0 && s.buy == 0,
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
				return ExecutionScenarioInsufficientExitFeeCash
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
	difference, valid := fundedCheckedSub(gross, referenceUnits)
	if fill.Kind == CausalExit {
		difference, valid = fundedCheckedSub(referenceUnits, gross)
	}
	if !valid || difference < 0 {
		return CausalNumericRange
	}
	next.difference, ok = fundedCheckedAdd(s.difference, difference)
	if !ok {
		return CausalNumericRange
	}
	next.fees, ok = fundedCheckedAdd(s.fees, fee)
	if !ok || !next.validAccount() {
		return CausalNumericRange
	}
	flow := ExecutionScenarioCausalCashFlow{
		ReferencePrice: referencePrice, ExecutionPrice: executionPrice, SideAdverseBps: fundedUnits(rate),
		ReferenceNotionalUnits: fundedUnits(referenceUnits), AdverseDifferenceUnits: fundedUnits(difference),
		AggregateAdverseDifferenceUnits: fundedUnits(next.difference),
		FillIndex:                       fillIndex, Kind: fill.Kind, Reason: fill.Reason,
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
	next.result.AggregateAdverseDifferenceUnits = fundedUnits(next.difference)
	next.result.CashFlows = append(next.result.CashFlows, flow)
	*s = next
	return ""
}

func (s *causalExecutionScenarioState) mark(bar OHLCV, index int, position *causalPosition) CausalErrorCode {
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
	mark := ExecutionScenarioCausalCloseMark{
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

// RunExecutionScenarioCausal is an opt-in, uncalibrated declared adverse execution-price and fee replay.
// The fixed8 entry debit is at most 10 model USD, including the declared fee.
// Adverse prices are declared stress assumptions, not calibrated fills or book evidence.
// It performs no actual money, broker, provider or liquidation action.
// The exclusive ownership and cancellation limitations of RunCausal apply.
// Fatal failure returns a zero entire result; it does not reset evaluator state.
func (e *Engine) RunExecutionScenarioCausal(
	ctx context.Context, symbol string, bars []OHLCV,
	initialModelCash string, scenario ExecutionScenario,
) (ExecutionScenarioCausalResult, error) {
	initial, ok := fundedParseCash(initialModelCash)
	if !ok {
		return executionScenarioFailure(FundedInvalidModelCash, causalNoBar)
	}
	fixed, bps, target, ok := feeScenarioParse(FeeScenario{FixedFee: scenario.FixedFee, FeeBps: scenario.FeeBps})
	if !ok {
		return executionScenarioFailure(ExecutionScenarioInvalidScenario, causalNoBar)
	}
	buy, buyOK := executionScenarioRate(scenario.BuyAdverseBps)
	sell, sellOK := executionScenarioRate(scenario.SellAdverseBps)
	if !buyOK || !sellOK {
		return executionScenarioFailure(ExecutionScenarioInvalidScenario, causalNoBar)
	}
	state := newCausalExecutionScenarioState(initial, fixed, bps, target, buy, sell)
	replay, err := e.runCausal(ctx, symbol, bars, nil, nil, state)
	if err != nil {
		if bounded, ok := err.(*CausalError); ok {
			return executionScenarioFailure(bounded.Code, bounded.BarIndex)
		}
		return executionScenarioFailure(CausalInvalidInput, causalNoBar)
	}
	state.result.ReferenceReplay = replay
	return state.result, nil
}
