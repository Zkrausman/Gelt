package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"strings"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

const (
	executionScenarioCLISummaryMaxBytes = 8192
	executionScenarioCLIUsage           = "Usage: gelt backtest-causal-execution <Target> <Symbol> <DataFile.csv> <InitialModelCash> <FixedPerSideFee> <FeeBps> <BuyAdverseBps> <SellAdverseBps>\n" +
		"Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n"
)

func runBacktestCausalExecution(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 8 {
		return executionScenarioCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return executionScenarioCLIFail(stderr, "canceled")
	}

	f, err := os.Open(args[2])
	if err != nil {
		return executionScenarioCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return executionScenarioCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return executionScenarioCLIFail(stderr, "input_file")
		default:
			return executionScenarioCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return executionScenarioCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return executionScenarioCLIFail(stderr, "canceled")
	}

	// Resolve only after the complete bounded CSV has been parsed and closed.
	engine, ok := newBacktestCausalEngine(args[0])
	if !ok {
		if args[0] != "BreakoutVol" {
			return executionScenarioCLIFail(stderr, "unsupported_target")
		}
		return executionScenarioCLIFail(stderr, "invalid_evaluator")
	}
	return runBacktestCausalExecutionEngine(ctx, args[1], bars, args[3],
		backtest.ExecutionScenario{FixedFee: args[4], FeeBps: args[5], BuyAdverseBps: args[6], SellAdverseBps: args[7]},
		engine, stdout, stderr)
}

// The actual command constructs a fresh trusted engine through the unchanged
// resolver. This typed package-local seam exists for synthetic tests only.
func runBacktestCausalExecutionEngine(
	ctx context.Context,
	symbol string,
	bars []backtest.OHLCV,
	initialModelCash string,
	scenario backtest.ExecutionScenario,
	engine *backtest.Engine,
	stdout, stderr io.Writer,
) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return executionScenarioCLIFail(stderr, "canceled")
	}
	if engine == nil {
		return executionScenarioCLIFail(stderr, "invalid_evaluator")
	}
	result, err := engine.RunExecutionScenarioCausal(ctx, symbol, bars, initialModelCash, scenario)
	if err != nil {
		return executionScenarioCLIFail(stderr, executionScenarioCLIEngineError(err))
	}
	summary, ok := backtestCausalExecutionSummary(result)
	if !ok {
		return executionScenarioCLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return executionScenarioCLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return executionScenarioCLIFail(stderr, "output_error")
	}

	// One output attempt. Failure may leave a retained prefix; never retry.
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return executionScenarioCLIFail(stderr, "output_error")
	}
	return 0
}

func executionScenarioCLIEngineError(err error) string {
	var failure *backtest.ExecutionScenarioCausalError
	if !errors.As(err, &failure) || failure == nil {
		return "replay_failed"
	}
	switch failure.Code {
	case backtest.FundedInvalidModelCash:
		return "invalid_model_cash"
	case backtest.ExecutionScenarioInvalidScenario:
		return "invalid_execution_scenario"
	case backtest.ExecutionScenarioInsufficientExitFeeCash:
		return "insufficient_exit_fee_cash"
	case backtest.CausalInvalidInput:
		return "invalid_input"
	case backtest.CausalInvalidSymbol:
		return "invalid_symbol"
	case backtest.CausalInvalidEvaluator:
		return "invalid_evaluator"
	case backtest.CausalEvaluatorIdentity:
		return "evaluator_identity"
	case backtest.CausalEvaluatorError:
		return "evaluator_error"
	case backtest.CausalPlanMembership:
		return "plan_membership"
	case backtest.CausalUnsupported:
		return "unsupported_condition"
	case backtest.CausalNumericRange:
		return "numeric_range"
	case backtest.CausalCanceled:
		return "canceled"
	case backtest.CausalResourceLimit:
		return "resource_limit"
	default:
		return "replay_failed"
	}
}

func executionScenarioCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_arguments", "input_file", "invalid_csv", "resource_limit",
		"unsupported_target", "invalid_model_cash", "invalid_execution_scenario",
		"insufficient_exit_fee_cash", "invalid_input", "invalid_symbol",
		"invalid_evaluator", "evaluator_identity", "evaluator_error",
		"plan_membership", "unsupported_condition", "numeric_range",
		"canceled", "invalid_result", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	message := "backtest-causal-execution: " + code + "\n"
	if code == "invalid_arguments" {
		message = executionScenarioCLIUsage + message
	}
	if stderr != nil {
		n, err := io.WriteString(stderr, message)
		if err != nil || n != len(message) {
			return 1
		}
	}
	return 1
}

func executionScenarioCLIAdd(a, b int64) (int64, bool) {
	if b > 0 && a > math.MaxInt64-b || b < 0 && a < math.MinInt64-b {
		return 0, false
	}
	return a + b, true
}

func executionScenarioCLIMul(a, b int64) (int64, bool) {
	if a < 0 || b < 0 || a != 0 && b > math.MaxInt64/a {
		return 0, false
	}
	return a * b, true
}

func executionScenarioCLISum(want int64, parts ...int64) bool {
	var sum int64
	for _, part := range parts {
		var ok bool
		sum, ok = executionScenarioCLIAdd(sum, part)
		if !ok {
			return false
		}
	}
	return sum == want
}

// Expected values have already been checked against their field domains.
// Equality with a canonical parsed integer also rejects negative unsigned
// fields because their expected values are nonnegative.
func executionScenarioCLIMatches(token string, want, bound int64) bool {
	value, ok := fundedCLIUnits(token, true, bound)
	return ok && value == want
}

// Consistency arithmetic for an internally computed declaration and trace.
// This does not parse command inputs or replace the core's input validation.
func executionScenarioCLICharge(gross, fixed, bps int64) (int64, bool) {
	if gross < 0 || gross > fundedCLIMaxUnits ||
		fixed < 0 || fixed >= fundedCLIEntryUnits || bps < 0 || bps > 10000 {
		return 0, false
	}
	product, ok := executionScenarioCLIMul(gross, bps)
	if !ok {
		return 0, false
	}
	proportional := product / 10000
	if product%10000 != 0 {
		proportional, ok = executionScenarioCLIAdd(proportional, 1)
		if !ok {
			return 0, false
		}
	}
	fee, ok := executionScenarioCLIAdd(fixed, proportional)
	return fee, ok && fee >= 0 && fee <= fundedCLIMaxEquity
}

func executionScenarioCLIDeclaration(
	d backtest.ExecutionScenarioCausalDeclaration,
) (fixed, bps, target int64, ok bool) {
	if d.RateDenominator != "10000" ||
		d.ScenarioBasis != backtest.ExecutionScenarioCausalBasis ||
		d.Application != backtest.ExecutionScenarioCausalApplication ||
		d.FeeBasis != backtest.ExecutionScenarioCausalFeeBasis ||
		d.PriceRule != "exact_binary_rational_then_adverse_float64_once" ||
		d.ProtectionGeometry != "reference_entry_and_ohlc_triggers_not_limit_fill_guarantees" {
		return 0, 0, 0, false
	}
	fixed, ok = fundedCLIUnits(d.FixedFeeUnits, false, fundedCLIEntryUnits-1)
	if !ok {
		return 0, 0, 0, false
	}
	bps, ok = fundedCLIUnits(d.FeeBps, false, 10000)
	if !ok {
		return 0, 0, 0, false
	}
	numerator, valid := executionScenarioCLIMul(fundedCLIEntryUnits-fixed, 10000)
	if !valid {
		return 0, 0, 0, false
	}
	// Zero remains a valid declaration. A successful flat result may have
	// no eligible entry attempt under this declaration.
	return fixed, bps, numerator / (10000 + bps), true
}

type executionScenarioCLIAccount struct {
	cash, principal, entryFee, basis int64
	grossClosed, realized            int64
	closedFees, fees                 int64
	quantity                         float64
	referenceEntry                   float64
	entry                            backtest.CausalFill
	closed, wins                     int
	gross, profit, loss              float64
}

func (a executionScenarioCLIAccount) valid(initial int64) bool {
	if initial < 0 || initial > fundedCLIMaxUnits ||
		a.cash < 0 || a.cash > fundedCLIMaxUnits ||
		a.principal < 0 || a.principal > fundedCLIEntryUnits ||
		a.entryFee < 0 || a.entryFee > fundedCLIEntryUnits ||
		a.basis < 0 || a.basis > fundedCLIEntryUnits ||
		a.grossClosed < -fundedCLIMaxEquity || a.grossClosed > fundedCLIMaxEquity ||
		a.realized < -fundedCLIMaxEquity || a.realized > fundedCLIMaxEquity ||
		a.closedFees < 0 || a.closedFees > fundedCLIMaxUnits ||
		a.fees < 0 || a.fees > fundedCLIMaxUnits {
		return false
	}
	if a.quantity == 0 {
		if a.principal != 0 || a.entryFee != 0 || a.basis != 0 {
			return false
		}
	} else if !causalCLIFinite(a.quantity, 0.00001, 1000) ||
		a.principal <= 0 || a.basis <= 0 {
		return false
	}
	// Negations below are safe after the explicit bounded-domain checks.
	return executionScenarioCLISum(a.basis, a.principal, a.entryFee) &&
		executionScenarioCLISum(a.fees, a.closedFees, a.entryFee) &&
		executionScenarioCLISum(a.realized, a.grossClosed, -a.closedFees) &&
		executionScenarioCLISum(a.cash, initial, a.realized, -a.basis)
}

func executionScenarioCLIApplyFlow(
	a *executionScenarioCLIAccount,
	f backtest.CausalFill,
	flow backtest.ExecutionScenarioCausalCashFlow,
	fillIndex int,
	r backtest.CausalResult,
	initial, fixed, bps, target, buyRate int64,
) bool {
	if !a.valid(initial) ||
		flow.FillIndex != fillIndex || flow.Kind != f.Kind ||
		flow.Reason != f.Reason || flow.BarIndex != f.BarIndex ||
		!flow.Timestamp.Equal(f.Timestamp) ||
		flow.EvaluationBarIndex != f.EvaluationBarIndex ||
		flow.EntrySignalBarIndex != f.EntrySignalBarIndex ||
		flow.EntryBarIndex != f.EntryBarIndex ||
		f.BarIndex < 20 || f.BarIndex >= r.TotalBars ||
		f.EvaluationBarIndex < 19 || f.EvaluationBarIndex >= f.BarIndex ||
		f.EntrySignalBarIndex < 19 || f.EntrySignalBarIndex >= r.TotalBars ||
		f.EntryBarIndex != f.EntrySignalBarIndex+1 ||
		f.EntryBarIndex > f.BarIndex ||
		!fundedCLITime(f.Timestamp) ||
		!causalCLIFinite(f.Price, math.SmallestNonzeroFloat64, 11000000) ||
		!causalCLIFinite(f.Quantity, 0.00001, 1000) ||
		!causalCLIFinite(f.Notional, 0, 1000000) ||
		!causalCLIFinite(f.GrossRealizedPnL, -1000000, 1000000) ||
		!causalCLIFinite(f.StopLoss, 0, 11000000) ||
		!causalCLIFinite(f.Target, 0, 11000000) ||
		(f.StopLoss > 0 && f.Target > 0 && f.StopLoss >= f.Target) ||
		!fundedCLINear(f.Notional, f.Price*f.Quantity) {
		return false
	}
	gross, ok := fundedCLIQuote(f.Price, f.Quantity)
	if !ok {
		return false
	}
	fee, ok := executionScenarioCLICharge(gross, fixed, bps)
	if !ok {
		return false
	}
	next := *a
	var debit, credit, delta int64
	switch f.Kind {
	case backtest.CausalEntry:
		if f.Reason != backtest.CausalNextOpenBuy || a.quantity != 0 ||
			f.EntryBarIndex != f.BarIndex ||
			f.EvaluationBarIndex != f.EntrySignalBarIndex ||
			f.GrossRealizedPnL != 0 || f.Ambiguous ||
			target <= 0 || gross != target ||
			r.Evaluations[f.EntrySignalBarIndex-19].Signal != strategies.SignalBuy {
			return false
		}
		if fixed == 0 && bps == 0 && buyRate == 0 {
			if f.Quantity != backtest.CausalEntryBudgetUSD/f.Price {
				return false
			}
		} else {
			raw := new(big.Rat).Mul(new(big.Rat).SetFloat64(f.Price),
				new(big.Rat).SetFloat64(f.Quantity))
			limit := new(big.Rat).SetFrac(big.NewInt(target), big.NewInt(fundedCLIUnitScale))
			if raw.Cmp(limit) > 0 {
				return false
			}
		}
		debit, ok = executionScenarioCLIAdd(gross, fee)
		if !ok || debit <= 0 || debit > fundedCLIEntryUnits || a.cash < debit {
			return false
		}
		delta = -debit
		next.principal, next.entryFee, next.basis = gross, fee, debit
		next.quantity, next.entry = f.Quantity, f
	case backtest.CausalExit:
		switch f.Reason {
		case backtest.CausalNextOpenSell:
			if f.EvaluationBarIndex != f.BarIndex-1 ||
				r.Evaluations[f.EvaluationBarIndex-19].Signal != strategies.SignalSell {
				return false
			}
		case backtest.CausalStopGap, backtest.CausalTargetGap,
			backtest.CausalStopTouch, backtest.CausalTargetTouch:
		default:
			return false
		}
		if a.quantity == 0 || f.Quantity != a.quantity ||
			f.EntryBarIndex != a.entry.BarIndex ||
			f.EntrySignalBarIndex != a.entry.EntrySignalBarIndex ||
			(f.Ambiguous && f.Reason != backtest.CausalStopTouch) ||
			!fundedCLINear(f.GrossRealizedPnL, (f.Price-a.entry.Price)*f.Quantity) {
			return false
		}
		delta, ok = executionScenarioCLIAdd(gross, -fee)
		if !ok {
			return false
		}
		if delta < 0 {
			debit = -delta
			if a.cash < debit {
				return false
			}
		} else {
			credit = delta
		}
		next.realized, ok = executionScenarioCLIAdd(a.realized, delta)
		if !ok {
			return false
		}
		next.realized, ok = executionScenarioCLIAdd(next.realized, -a.basis)
		if !ok {
			return false
		}
		next.grossClosed, ok = executionScenarioCLIAdd(a.grossClosed, gross)
		if !ok {
			return false
		}
		next.grossClosed, ok = executionScenarioCLIAdd(next.grossClosed, -a.principal)
		if !ok {
			return false
		}
		next.closedFees, ok = executionScenarioCLIAdd(a.closedFees, a.entryFee)
		if !ok {
			return false
		}
		next.closedFees, ok = executionScenarioCLIAdd(next.closedFees, fee)
		if !ok {
			return false
		}
		next.principal, next.entryFee, next.basis, next.quantity = 0, 0, 0, 0
		next.closed++
		next.gross += f.GrossRealizedPnL
		if f.GrossRealizedPnL > 0 {
			next.wins++
			next.profit += f.GrossRealizedPnL
		} else {
			next.loss -= f.GrossRealizedPnL
		}
	default:
		return false
	}
	next.cash, ok = executionScenarioCLIAdd(a.cash, delta)
	if !ok {
		return false
	}
	next.fees, ok = executionScenarioCLIAdd(a.fees, fee)
	if !ok || !next.valid(initial) {
		return false
	}
	if !executionScenarioCLIMatches(flow.GrossNotionalUnits, gross, fundedCLIMaxUnits) ||
		!executionScenarioCLIMatches(flow.FeeUnits, fee, fundedCLIMaxEquity) ||
		!executionScenarioCLIMatches(flow.NetCashDeltaUnits, delta, fundedCLIMaxEquity) ||
		!executionScenarioCLIMatches(flow.DebitedUnits, debit, fundedCLIMaxUnits) ||
		!executionScenarioCLIMatches(flow.CreditedUnits, credit, fundedCLIMaxUnits) ||
		!executionScenarioCLIMatches(flow.ModelCashUnits, next.cash, fundedCLIMaxUnits) ||
		!executionScenarioCLIMatches(flow.PositionPrincipalUnits, next.principal, fundedCLIEntryUnits) ||
		!executionScenarioCLIMatches(flow.PositionEntryFeeUnits, next.entryFee, fundedCLIEntryUnits) ||
		!executionScenarioCLIMatches(flow.PositionTotalBasisUnits, next.basis, fundedCLIEntryUnits) ||
		!executionScenarioCLIMatches(flow.GrossRealizedAccountingPnLUnits, next.grossClosed, fundedCLIMaxEquity) ||
		!executionScenarioCLIMatches(flow.NetRealizedAccountingPnLUnits, next.realized, fundedCLIMaxEquity) ||
		!executionScenarioCLIMatches(flow.ClosedAttributedFeeUnits, next.closedFees, fundedCLIMaxUnits) ||
		!executionScenarioCLIMatches(flow.AggregateFeeUnits, next.fees, fundedCLIMaxUnits) {
		return false
	}
	*a = next
	return true
}

// This boundary checks formatting consistency of a typed, internally computed
// standalone result. It is not an imported-record authenticator or evaluator.
func executionScenarioCLIResultValid(r backtest.ExecutionScenarioCausalResult) bool {
	return executionScenarioCLIResultValidForTarget(r, "BreakoutVol")
}
func mean20ExecutionScenarioCLIResultValid(r backtest.ExecutionScenarioCausalResult) bool {
	return executionScenarioCLIResultValidForTarget(r, "MeanReversion")
}
func executionScenarioCLIResultValidForTarget(r backtest.ExecutionScenarioCausalResult, expectedTarget string) bool {
	if expectedTarget != "BreakoutVol" && expectedTarget != "MeanReversion" {
		return false
	}
	replay := r.ReferenceReplay
	if r.ModelIdentity != backtest.ExecutionScenarioCausalModelIdentity ||
		r.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity ||
		r.DataLabel != backtest.CausalOfflineLabel ||
		r.AuthorityLabel != backtest.CausalOfflineLabel ||
		r.Scale != backtest.FundedCausalScale ||
		replay.ModelIdentity != backtest.ExecutionScenarioCausalModelIdentity ||
		replay.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity ||
		replay.DataLabel != backtest.CausalOfflineLabel ||
		replay.AuthorityLabel != backtest.CausalOfflineLabel ||
		replay.TargetName != expectedTarget ||
		len(replay.Symbol) == 0 || len(replay.Symbol) > 256 {
		return false
	}
	buyRate, buyOK := executionCLIAdverseRate(r.Scenario.BuyAdverseBps)
	sellRate, sellOK := executionCLIAdverseRate(r.Scenario.SellAdverseBps)
	if !buyOK || !sellOK || r.ReferenceReplayRole != "reference_trigger_diagnostic_only_not_execution_pnl" {
		return false
	}
	fixed, bps, target, ok := executionScenarioCLIDeclaration(r.Scenario)
	if !ok {
		return false
	}

	// Only a value copy is normalized for the immutable float-diagnostic
	// numeric checks. No old-mode summary is emitted or used as this summary.
	diagnostic := replay
	diagnostic.ModelIdentity = backtest.CausalModelIdentity
	diagnostic.CostIdentity = backtest.CausalCostIdentity
	if _, valid := backtestCausalSummary(diagnostic); !valid {
		return false
	}
	if !executionCLIReferenceDiagnosticsValid(replay) {
		return false
	}
	total := replay.TotalBars
	expectedEvaluations := total - 19
	if expectedEvaluations < 0 {
		expectedEvaluations = 0
	}
	if len(replay.Evaluations) != expectedEvaluations ||
		len(r.CloseMarks) != total || len(r.CashFlows) != len(replay.Fills) ||
		len(r.RejectedEntries) > total {
		return false
	}
	initial, ok := fundedCLIUnits(r.InitialModelCashUnits, false, fundedCLIMaxUnits)
	if !ok || r.InitialEquityUnits != r.InitialModelCashUnits {
		return false
	}
	for i, evaluation := range replay.Evaluations {
		if evaluation.BarIndex != i+19 ||
			evaluation.PrefixLength != evaluation.BarIndex+1 ||
			len(evaluation.Components) != 0 ||
			!fundedCLISignalValid(evaluation.CausalSignal, replay) {
			return false
		}
	}
	pending := false
	if len(replay.Evaluations) > 0 {
		last := replay.Evaluations[len(replay.Evaluations)-1]
		pending = last.Signal == strategies.SignalBuy || last.Signal == strategies.SignalSell
	}
	if replay.PendingSignalUnfilled != pending {
		return false
	}

	account := executionScenarioCLIAccount{cash: initial}
	peak, maxLoss, maxPeak, maxBar := initial, int64(0), int64(0), -1
	fillIndex, rejectedIndex := 0, 0
	var previousTime time.Time
	var adverseSum int64
	for index, mark := range r.CloseMarks {
		if mark.BarIndex != index || !fundedCLITime(mark.Timestamp) ||
			index > 0 && !mark.Timestamp.After(previousTime) {
			return false
		}
		previousTime = mark.Timestamp
		if index >= 19 && !replay.Evaluations[index-19].Timestamp.Equal(mark.Timestamp) {
			return false
		}
		startFill := fillIndex
		for fillIndex < len(replay.Fills) && replay.Fills[fillIndex].BarIndex == index {
			fill := replay.Fills[fillIndex]
			flow := r.CashFlows[fillIndex]
			rate := sellRate
			if fill.Kind == backtest.CausalEntry {
				rate = buyRate
			}
			price, ok := executionCLIPrice(fill.Price, rate, fill.Kind)
			if !ok || flow.ReferencePrice != fill.Price || flow.ExecutionPrice != price || flow.SideAdverseBps != fmt.Sprint(rate) {
				return false
			}
			referenceUnits, ok := fundedCLIQuote(fill.Price, fill.Quantity)
			if !ok {
				return false
			}
			executionUnits, ok := fundedCLIQuote(price, fill.Quantity)
			if !ok {
				return false
			}
			difference := executionUnits - referenceUnits
			if fill.Kind == backtest.CausalExit {
				difference = referenceUnits - executionUnits
			}
			adverseSum, ok = executionScenarioCLIAdd(adverseSum, difference)
			if !ok || difference < 0 || adverseSum > fundedCLIMaxUnits || !executionScenarioCLIMatches(flow.ReferenceNotionalUnits, referenceUnits, fundedCLIMaxUnits) || !executionScenarioCLIMatches(flow.AdverseDifferenceUnits, difference, fundedCLIMaxUnits) || !executionScenarioCLIMatches(flow.AggregateAdverseDifferenceUnits, adverseSum, fundedCLIMaxUnits) {
				return false
			}
			// Validate cash against an execution-price value copy; reference
			// replay, trigger geometry and its diagnostic PnL remain untouched.
			executed := fill
			executed.Price = price
			executed.Notional = price * fill.Quantity
			if fill.Kind == backtest.CausalExit {
				executed.GrossRealizedPnL = (price - account.entry.Price) * fill.Quantity
			} else {
				executed.GrossRealizedPnL = 0
				account.referenceEntry = fill.Price
			}
			if !fill.Timestamp.Equal(mark.Timestamp) || !executionScenarioCLIApplyFlow(&account, executed, flow, fillIndex, replay, initial, fixed, bps, target, buyRate) {
				return false
			}
			fillIndex++
		}
		if fillIndex < len(replay.Fills) && replay.Fills[fillIndex].BarIndex < index ||
			fillIndex-startFill > 2 {
			return false
		}
		if fillIndex-startFill == 2 &&
			(replay.Fills[startFill].Kind != backtest.CausalEntry ||
				replay.Fills[startFill+1].Kind != backtest.CausalExit) {
			return false
		}
		if !account.valid(initial) ||
			!executionScenarioCLIMatches(mark.ModelCashUnits, account.cash, fundedCLIMaxUnits) ||
			!executionScenarioCLIMatches(mark.PositionPrincipalUnits, account.principal, fundedCLIEntryUnits) ||
			!executionScenarioCLIMatches(mark.PositionEntryFeeUnits, account.entryFee, fundedCLIEntryUnits) ||
			!executionScenarioCLIMatches(mark.PositionTotalBasisUnits, account.basis, fundedCLIEntryUnits) ||
			!causalCLIFinite(mark.ModelQuantity, 0, 1000) ||
			mark.ModelQuantity != account.quantity {
			return false
		}
		value, valid := fundedCLIUnits(mark.PositionValueUnits, false, fundedCLIMaxUnits)
		if !valid || account.quantity == 0 && value != 0 {
			return false
		}
		equity, valid := fundedCLIUnits(mark.EquityUnits, false, fundedCLIMaxEquity)
		if !valid || !executionScenarioCLISum(equity, account.cash, value) {
			return false
		}
		grossOpen, valid := executionScenarioCLIAdd(value, -account.principal)
		if !valid {
			return false
		}
		netOpen, valid := executionScenarioCLIAdd(value, -account.basis)
		if !valid ||
			!executionScenarioCLISum(netOpen, grossOpen, -account.entryFee) ||
			!executionScenarioCLISum(equity, initial, account.realized, netOpen) ||
			!executionScenarioCLIMatches(mark.GrossRealizedAccountingPnLUnits, account.grossClosed, fundedCLIMaxEquity) ||
			!executionScenarioCLIMatches(mark.GrossUnrealizedAccountingPnLUnits, grossOpen, fundedCLIMaxEquity) ||
			!executionScenarioCLIMatches(mark.NetRealizedAccountingPnLUnits, account.realized, fundedCLIMaxEquity) ||
			!executionScenarioCLIMatches(mark.NetUnrealizedAccountingPnLUnits, netOpen, fundedCLIMaxEquity) ||
			!executionScenarioCLIMatches(mark.ClosedAttributedFeeUnits, account.closedFees, fundedCLIMaxUnits) ||
			!executionScenarioCLIMatches(mark.OpenAttributedFeeUnits, account.entryFee, fundedCLIMaxUnits) ||
			!executionScenarioCLIMatches(mark.AggregateFeeUnits, account.fees, fundedCLIMaxUnits) {
			return false
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity // Both operands are bounded nonnegative equity.
		if !executionScenarioCLIMatches(mark.PeakEquityUnits, peak, fundedCLIMaxEquity) ||
			!fundedCLIDrawdownValid(mark.CloseMarkDrawdown, loss, peak, index) {
			return false
		}
		if loss > 0 && (maxLoss == 0 || fundedCLIRatioGreater(loss, peak, maxLoss, maxPeak)) {
			maxLoss, maxPeak, maxBar = loss, peak, index
		}

		if rejectedIndex < len(r.RejectedEntries) &&
			r.RejectedEntries[rejectedIndex].BarIndex == index {
			rejected := r.RejectedEntries[rejectedIndex]
			if index < 20 {
				return false
			}
			fee, valid := executionScenarioCLICharge(target, fixed, bps)
			if !valid || target <= 0 {
				return false
			}
			required, valid := executionScenarioCLIAdd(target, fee)
			if !valid || required <= 0 || required > fundedCLIEntryUnits ||
				rejected.Reason != backtest.FundedInsufficientModelCash ||
				!rejected.Timestamp.Equal(mark.Timestamp) ||
				rejected.EvaluationBarIndex != index-1 ||
				!rejected.EvaluationTimestamp.Equal(replay.Evaluations[index-20].Timestamp) ||
				replay.Evaluations[index-20].Signal != strategies.SignalBuy ||
				!executionScenarioCLIMatches(rejected.AvailableModelCashUnits, account.cash, fundedCLIMaxUnits) ||
				!executionScenarioCLIMatches(rejected.GrossNotionalUnits, target, fundedCLIEntryUnits) ||
				!executionScenarioCLIMatches(rejected.FeeUnits, fee, fundedCLIEntryUnits) ||
				!executionScenarioCLIMatches(rejected.RequiredModelCashUnits, required, fundedCLIEntryUnits) ||
				account.cash >= required || account.quantity != 0 || startFill != fillIndex {
				return false
			}
			rejectedIndex++
		}
		if rejectedIndex < len(r.RejectedEntries) &&
			r.RejectedEntries[rejectedIndex].BarIndex <= index {
			return false
		}
	}
	if fillIndex != len(replay.Fills) || rejectedIndex != len(r.RejectedEntries) || replay.ClosedTradeCount != account.closed || !executionScenarioCLIMatches(r.AggregateAdverseDifferenceUnits, adverseSum, fundedCLIMaxUnits) {
		return false
	}

	// total >= 1 and len(CloseMarks) == total were established above.
	last := r.CloseMarks[total-1]
	if r.FinalModelCashUnits != last.ModelCashUnits ||
		r.FinalModelQuantity != last.ModelQuantity ||
		r.FinalPositionPrincipalUnits != last.PositionPrincipalUnits ||
		r.FinalPositionEntryFeeUnits != last.PositionEntryFeeUnits ||
		r.FinalPositionTotalBasisUnits != last.PositionTotalBasisUnits ||
		r.FinalPositionValueUnits != last.PositionValueUnits ||
		r.FinalEquityUnits != last.EquityUnits ||
		r.GrossRealizedAccountingPnLUnits != last.GrossRealizedAccountingPnLUnits ||
		r.GrossUnrealizedAccountingPnLUnits != last.GrossUnrealizedAccountingPnLUnits ||
		r.NetRealizedAccountingPnLUnits != last.NetRealizedAccountingPnLUnits ||
		r.NetUnrealizedAccountingPnLUnits != last.NetUnrealizedAccountingPnLUnits ||
		r.ClosedAttributedFeeUnits != last.ClosedAttributedFeeUnits ||
		r.OpenAttributedFeeUnits != last.OpenAttributedFeeUnits ||
		r.AggregateFeeUnits != last.AggregateFeeUnits ||
		r.PeakCloseEquityUnits != last.PeakEquityUnits {
		return false
	}
	if maxLoss == 0 {
		maxPeak = peak
	}
	if !fundedCLIDrawdownValid(r.MaxCloseMarkDrawdown, maxLoss, maxPeak, maxBar) {
		return false
	}
	p := replay.TerminalPosition
	if account.quantity == 0 {
		return p == nil
	}
	if p == nil || p.Quantity != account.quantity ||
		p.EntryPrice != account.referenceEntry ||
		p.EntryBarIndex != account.entry.BarIndex ||
		p.EntrySignalBarIndex != account.entry.EntrySignalBarIndex ||
		p.EntrySignalBarIndex < 19 || p.EntrySignalBarIndex-19 >= len(replay.Evaluations) ||
		!p.EntryTimestamp.Equal(account.entry.Timestamp) ||
		!p.EntrySignalTimestamp.Equal(replay.Evaluations[p.EntrySignalBarIndex-19].Timestamp) ||
		p.LastBarIndex != total-1 || !p.LastTimestamp.Equal(last.Timestamp) ||
		!causalCLIFinite(p.PeakPrice, p.EntryPrice, 11000000) ||
		p.PeakPrice < p.LastClosePrice ||
		p.StopEvaluationBarIndex < -1 || p.StopEvaluationBarIndex >= total ||
		p.TargetEvaluationBarIndex < -1 || p.TargetEvaluationBarIndex >= total ||
		!fundedCLINear(p.GrossUnrealizedPnL, (p.LastClosePrice-p.EntryPrice)*p.Quantity) {
		return false
	}
	value, valid := fundedCLIQuote(p.LastClosePrice, p.Quantity)
	return valid && executionScenarioCLIMatches(last.PositionValueUnits, value, fundedCLIMaxUnits)
}

func backtestCausalExecutionSummary(r backtest.ExecutionScenarioCausalResult) (string, bool) {
	if !executionScenarioCLIResultValid(r) {
		return "", false
	}
	replay := r.ReferenceReplay
	var out strings.Builder
	out.WriteString("GELT DECLARED EXECUTION-PRICE CAUSAL CSV REPLAY SUMMARY\n")
	fmt.Fprintf(&out, "Model: %s\nCost: %s\nData: %s\nAuthority: %s\n",
		backtest.ExecutionScenarioCausalModelIdentity, backtest.ExecutionScenarioCausalCostIdentity,
		backtest.CausalOfflineLabel, backtest.CausalOfflineLabel)
	out.WriteString("Accounting: Scale 8 engineering modelUSD resolution (10^-8); exact8 decimal display.\n")
	fmt.Fprintf(&out, "Scenario basis: %s\nFixed per-side fee (modelUSD): %s\nFee rate (integer bps): %s\n",
		backtest.ExecutionScenarioCausalBasis, fundedCLIDecimal(r.Scenario.FixedFeeUnits), r.Scenario.FeeBps)
	out.WriteString("Rate denominator: 10000\nFee basis: quantized_gross_notional\nApplication: per_filled_side\n")
	out.WriteString("Fee formula: fixed fee + ceil(quantized gross notional units * bps / 10000).\n")
	out.WriteString("Entry cap: 10.00000000 modelUSD including declared entry fee; no partial funding.\n")
	out.WriteString("Costs: uncalibrated declared adverse execution prices and fees; no calibrated spread, liquidity, fill or profitability evidence.\n")
	out.WriteString("Scope: offline model; no actual cash, holdings, execution, net performance or qualification claim.\n")
	out.WriteString("Reference events: close signal / next open plus reference protection triggers; no forced terminal liquidation or hypothetical exit costs.\n")
	out.WriteString("Reference-trigger geometry is not a limit-order fill guarantee; scenario quotes may lie outside OHLC.\nNo additional slippage cash charge: execution-price effect is already embedded.\nReference-only float diagnostics are not execution PnL or a counterfactual strategy.\n")
	fmt.Fprintf(&out, "Buy adverse bps: %s\nSell adverse bps: %s\nAdverse quote-difference diagnostic (not another charge): %s\n", r.Scenario.BuyAdverseBps, r.Scenario.SellAdverseBps, fundedCLIDecimal(r.AggregateAdverseDifferenceUnits))
	if len(r.CashFlows) > 0 {
		f := r.CashFlows[len(r.CashFlows)-1]
		fmt.Fprintf(&out, "Last modeled fill reference price: %.12e\nLast modeled execution price: %.12e\n", f.ReferencePrice, f.ExecutionPrice)
	}
	fmt.Fprintf(&out, "Bars: %d\nEvaluations: %d\nModel fills: %d\n",
		replay.TotalBars, len(replay.Evaluations), len(replay.Fills))
	fmt.Fprintf(&out, "Closed trades: %d\nReference-only winning closed trades (float gross): %d\nRejected entries: %d\n",
		replay.ClosedTradeCount, replay.WinningClosedTradeCount, len(r.RejectedEntries))
	fmt.Fprintf(&out, "Initial model cash: %s\nInitial model equity: %s\n",
		fundedCLIDecimal(r.InitialModelCashUnits), fundedCLIDecimal(r.InitialEquityUnits))
	fmt.Fprintf(&out, "Final model cash: %s\nFinal modeled quantity: %.12e\n",
		fundedCLIDecimal(r.FinalModelCashUnits), r.FinalModelQuantity)
	fmt.Fprintf(&out, "Final position principal: %s\nFinal position entry fee: %s\nFinal position total basis: %s\n",
		fundedCLIDecimal(r.FinalPositionPrincipalUnits),
		fundedCLIDecimal(r.FinalPositionEntryFeeUnits), fundedCLIDecimal(r.FinalPositionTotalBasisUnits))
	fmt.Fprintf(&out, "Final position value: %s\nFinal model equity: %s\n",
		fundedCLIDecimal(r.FinalPositionValueUnits), fundedCLIDecimal(r.FinalEquityUnits))
	fmt.Fprintf(&out, "Gross realized accounting PnL: %s\nGross unrealized accounting PnL: %s\n",
		fundedCLIDecimal(r.GrossRealizedAccountingPnLUnits),
		fundedCLIDecimal(r.GrossUnrealizedAccountingPnLUnits))
	fmt.Fprintf(&out, "Net realized accounting PnL: %s\nNet unrealized accounting PnL: %s\n",
		fundedCLIDecimal(r.NetRealizedAccountingPnLUnits),
		fundedCLIDecimal(r.NetUnrealizedAccountingPnLUnits))
	fmt.Fprintf(&out, "Closed attributed fees: %s\nOpen attributed fees: %s\nAggregate fees: %s\n",
		fundedCLIDecimal(r.ClosedAttributedFeeUnits), fundedCLIDecimal(r.OpenAttributedFeeUnits),
		fundedCLIDecimal(r.AggregateFeeUnits))
	fmt.Fprintf(&out, "Peak close equity: %s\n", fundedCLIDecimal(r.PeakCloseEquityUnits))
	d := r.MaxCloseMarkDrawdown
	if d.Percent == nil {
		out.WriteString("Max close-mark drawdown loss units: null\n")
		out.WriteString("Max close-mark drawdown peak units: null\n")
		out.WriteString("Max close-mark drawdown bar: null\n")
		out.WriteString("Max close-mark drawdown percent (derived): null\n")
		out.WriteString("Max close-mark drawdown reason: zero_initial_model_equity\n")
	} else {
		fmt.Fprintf(&out, "Max close-mark drawdown loss units: %s\nMax close-mark drawdown peak units: %s\n",
			*d.LossUnits, *d.PeakEquityUnits)
		if d.BarIndex == nil {
			out.WriteString("Max close-mark drawdown bar: null (no_positive_close_mark_loss)\n")
		} else {
			fmt.Fprintf(&out, "Max close-mark drawdown bar: %d\n", *d.BarIndex)
		}
		fmt.Fprintf(&out, "Max close-mark drawdown percent (derived): %.12e\n", *d.Percent)
	}
	out.WriteString("Drawdown uses supplied-bar close marks and declared initial equity; no intrabar peak metric.\n")
	fmt.Fprintf(&out, "Reference-only float diagnostic gross realized PnL: %.12e\n",
		replay.GrossRealizedPnL)
	fmt.Fprintf(&out, "Reference-only float diagnostic gross profit: %.12e\nReference-only float diagnostic gross loss: %.12e\n",
		replay.GrossProfit, replay.GrossLoss)
	if replay.GrossProfitFactor != nil {
		fmt.Fprintf(&out, "Reference-only float diagnostic gross profit factor: %.12e\n", *replay.GrossProfitFactor)
	} else if replay.GrossProfitFactorReason == backtest.CausalNoClosedTrades {
		out.WriteString("Reference-only float diagnostic gross profit factor: null (no_closed_trades)\n")
	} else {
		out.WriteString("Reference-only float diagnostic gross profit factor: null (no_losing_closed_trades)\n")
	}
	if p := replay.TerminalPosition; p != nil {
		out.WriteString("Final open model position: present\n")
		fmt.Fprintf(&out, "Reference entry price (float diagnostic): %.12e\nLast close price (float diagnostic): %.12e\n",
			p.EntryPrice, p.LastClosePrice)
		fmt.Fprintf(&out, "Reference-only float diagnostic gross unrealized PnL: %.12e\n", p.GrossUnrealizedPnL)
		out.WriteString("Final cash excludes open-position proceeds; equity includes the close mark.\n")
		out.WriteString("Open attributed fees retain only the filled entry fee; no exit fee is assumed.\n")
	} else {
		out.WriteString("Final open model position: none\n")
	}
	fmt.Fprintf(&out, "Final directional signal pending: %t\n", replay.PendingSignalUnfilled)
	out.WriteString("Pending means no successor bar; may be a no-op, not an actual unfilled order.\n")
	if out.Len() > executionScenarioCLISummaryMaxBytes {
		return "", false
	}
	return out.String(), true
}

func executionCLIAdverseRate(token string) (int64, bool) {
	if len(token) < 1 || len(token) > 4 || len(token) > 1 && token[0] == '0' {
		return 0, false
	}
	return fundedCLIUnits(token, false, 9999)
}

// Formatting check only; no data replay, evaluator or provider invocation.
func executionCLIPrice(p float64, rate int64, side backtest.CausalFillKind) (float64, bool) {
	if !causalCLIFinite(p, math.SmallestNonzeroFloat64, 11000000) || rate < 0 || rate > 9999 || (side != backtest.CausalEntry && side != backtest.CausalExit) {
		return 0, false
	}
	if rate == 0 {
		return p, true
	}
	n := int64(10000) + rate
	if side == backtest.CausalExit {
		n = 10000 - rate
	}
	exact := new(big.Rat).Mul(new(big.Rat).SetFloat64(p), big.NewRat(n, 10000))
	v, _ := exact.Float64()
	if !causalCLIFinite(v, math.SmallestNonzeroFloat64, 11000000) {
		return 0, false
	}
	cmp := new(big.Rat).SetFloat64(v).Cmp(exact)
	if side == backtest.CausalEntry && cmp < 0 {
		v = math.Nextafter(v, math.Inf(1))
	}
	if side == backtest.CausalExit && cmp > 0 {
		v = math.Nextafter(v, 0)
	}
	return v, causalCLIFinite(v, math.SmallestNonzeroFloat64, 11000000)
}

// Reconstruct reference diagnostics independently of execution-price cash
// accounting. This validates an internally computed display result, not imported
// authority. Match the core's ordered float operations exactly, with no tolerance
// allowing a fabricated reference aggregate to reach the human summary.
func executionCLIReferenceDiagnosticsValid(r backtest.CausalResult) bool {
	if len(r.Fills) > backtest.CausalMaxFills {
		return false
	}
	var entry backtest.CausalFill
	open := false
	closed, wins := 0, 0
	gross, profit, loss := 0.0, 0.0, 0.0
	for _, f := range r.Fills {
		if !causalCLIFinite(f.Price, math.SmallestNonzeroFloat64, 11000000) || !causalCLIFinite(f.Quantity, 0.00001, 1000) || !causalCLIFinite(f.Notional, 0, 1000000) || f.Notional != f.Price*f.Quantity {
			return false
		}
		switch f.Kind {
		case backtest.CausalEntry:
			if open || f.GrossRealizedPnL != 0 {
				return false
			}
			entry = f
			open = true
		case backtest.CausalExit:
			if !open || f.Quantity != entry.Quantity {
				return false
			}
			pnl := (f.Price - entry.Price) * f.Quantity
			if !causalCLIFinite(pnl, -1000000, 1000000) || f.GrossRealizedPnL != pnl {
				return false
			}
			gross += pnl
			closed++
			if pnl > 0 {
				profit += pnl
				wins++
			} else {
				loss -= pnl
			}
			if !causalCLIFinite(gross, -1000000, 1000000) || !causalCLIFinite(profit, 0, 1000000) || !causalCLIFinite(loss, 0, 1000000) {
				return false
			}
			open = false
		default:
			return false
		}
	}
	if open != (r.TerminalPosition != nil) || r.ClosedTradeCount != closed || r.WinningClosedTradeCount != wins || r.GrossRealizedPnL != gross || r.GrossProfit != profit || r.GrossLoss != loss {
		return false
	}
	switch {
	case closed == 0:
		return r.GrossProfitFactor == nil && r.GrossProfitFactorReason == backtest.CausalNoClosedTrades
	case loss == 0:
		return r.GrossProfitFactor == nil && r.GrossProfitFactorReason == backtest.CausalNoLosingClosedTrades
	default:
		expected := profit / loss
		return causalCLIFinite(expected, 0, math.MaxFloat64) && r.GrossProfitFactor != nil && *r.GrossProfitFactor == expected && r.GrossProfitFactorReason == ""
	}
}
