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
	feeScenarioCLISummaryMaxBytes = 8192
	feeScenarioCLIUsage           = "Usage: gelt backtest-causal-fees <Target> <Symbol> <DataFile.csv> <InitialModelCash> <FixedPerSideFee> <FeeBps>\n" +
		"Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n"
)

func runBacktestCausalFees(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 6 {
		return feeScenarioCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return feeScenarioCLIFail(stderr, "canceled")
	}

	f, err := os.Open(args[2])
	if err != nil {
		return feeScenarioCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return feeScenarioCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return feeScenarioCLIFail(stderr, "input_file")
		default:
			return feeScenarioCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return feeScenarioCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return feeScenarioCLIFail(stderr, "canceled")
	}

	// Resolve only after the complete bounded CSV has been parsed and closed.
	engine, ok := newBacktestCausalEngine(args[0])
	if !ok {
		if args[0] != "BreakoutVol" {
			return feeScenarioCLIFail(stderr, "unsupported_target")
		}
		return feeScenarioCLIFail(stderr, "invalid_evaluator")
	}
	return runBacktestCausalFeesEngine(ctx, args[1], bars, args[3],
		backtest.FeeScenario{FixedFee: args[4], FeeBps: args[5]},
		engine, stdout, stderr)
}

// The actual command constructs a fresh trusted engine through the unchanged
// resolver. This typed package-local seam exists for synthetic tests only.
func runBacktestCausalFeesEngine(
	ctx context.Context,
	symbol string,
	bars []backtest.OHLCV,
	initialModelCash string,
	scenario backtest.FeeScenario,
	engine *backtest.Engine,
	stdout, stderr io.Writer,
) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return feeScenarioCLIFail(stderr, "canceled")
	}
	if engine == nil {
		return feeScenarioCLIFail(stderr, "invalid_evaluator")
	}
	result, err := engine.RunFeeScenarioCausal(ctx, symbol, bars, initialModelCash, scenario)
	if err != nil {
		return feeScenarioCLIFail(stderr, feeScenarioCLIEngineError(err))
	}
	summary, ok := backtestCausalFeesSummary(result)
	if !ok {
		return feeScenarioCLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return feeScenarioCLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return feeScenarioCLIFail(stderr, "output_error")
	}

	// One output attempt. Failure may leave a retained prefix; never retry.
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return feeScenarioCLIFail(stderr, "output_error")
	}
	return 0
}

func feeScenarioCLIEngineError(err error) string {
	var failure *backtest.FeeScenarioCausalError
	if !errors.As(err, &failure) || failure == nil {
		return "replay_failed"
	}
	switch failure.Code {
	case backtest.FundedInvalidModelCash:
		return "invalid_model_cash"
	case backtest.FeeScenarioInvalidScenario:
		return "invalid_fee_scenario"
	case backtest.FeeScenarioInsufficientExitFeeCash:
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

func feeScenarioCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_arguments", "input_file", "invalid_csv", "resource_limit",
		"unsupported_target", "invalid_model_cash", "invalid_fee_scenario",
		"insufficient_exit_fee_cash", "invalid_input", "invalid_symbol",
		"invalid_evaluator", "evaluator_identity", "evaluator_error",
		"plan_membership", "unsupported_condition", "numeric_range",
		"canceled", "invalid_result", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	message := "backtest-causal-fees: " + code + "\n"
	if code == "invalid_arguments" {
		message = feeScenarioCLIUsage + message
	}
	if stderr != nil {
		n, err := io.WriteString(stderr, message)
		if err != nil || n != len(message) {
			return 1
		}
	}
	return 1
}

func feeScenarioCLIAdd(a, b int64) (int64, bool) {
	if b > 0 && a > math.MaxInt64-b || b < 0 && a < math.MinInt64-b {
		return 0, false
	}
	return a + b, true
}

func feeScenarioCLIMul(a, b int64) (int64, bool) {
	if a < 0 || b < 0 || a != 0 && b > math.MaxInt64/a {
		return 0, false
	}
	return a * b, true
}

func feeScenarioCLISum(want int64, parts ...int64) bool {
	var sum int64
	for _, part := range parts {
		var ok bool
		sum, ok = feeScenarioCLIAdd(sum, part)
		if !ok {
			return false
		}
	}
	return sum == want
}

// Expected values have already been checked against their field domains.
// Equality with a canonical parsed integer also rejects negative unsigned
// fields because their expected values are nonnegative.
func feeScenarioCLIMatches(token string, want, bound int64) bool {
	value, ok := fundedCLIUnits(token, true, bound)
	return ok && value == want
}

// Consistency arithmetic for an internally computed declaration and trace.
// This does not parse command inputs or replace the core's input validation.
func feeScenarioCLICharge(gross, fixed, bps int64) (int64, bool) {
	if gross < 0 || gross > fundedCLIMaxUnits ||
		fixed < 0 || fixed >= fundedCLIEntryUnits || bps < 0 || bps > 10000 {
		return 0, false
	}
	product, ok := feeScenarioCLIMul(gross, bps)
	if !ok {
		return 0, false
	}
	proportional := product / 10000
	if product%10000 != 0 {
		proportional, ok = feeScenarioCLIAdd(proportional, 1)
		if !ok {
			return 0, false
		}
	}
	fee, ok := feeScenarioCLIAdd(fixed, proportional)
	return fee, ok && fee >= 0 && fee <= fundedCLIMaxEquity
}

func feeScenarioCLIDeclaration(
	d backtest.FeeScenarioCausalDeclaration,
) (fixed, bps, target int64, ok bool) {
	if d.RateDenominator != "10000" ||
		d.ScenarioBasis != backtest.FeeScenarioCausalBasis ||
		d.Application != backtest.FeeScenarioCausalApplication ||
		d.FeeBasis != backtest.FeeScenarioCausalFeeBasis {
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
	numerator, valid := feeScenarioCLIMul(fundedCLIEntryUnits-fixed, 10000)
	if !valid {
		return 0, 0, 0, false
	}
	// Zero remains a valid declaration. A successful flat result may have
	// no eligible entry attempt under this declaration.
	return fixed, bps, numerator / (10000 + bps), true
}

type feeScenarioCLIAccount struct {
	cash, principal, entryFee, basis int64
	grossClosed, realized            int64
	closedFees, fees                 int64
	quantity                         float64
	entry                            backtest.CausalFill
	closed, wins                     int
	gross, profit, loss              float64
}

func (a feeScenarioCLIAccount) valid(initial int64) bool {
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
	return feeScenarioCLISum(a.basis, a.principal, a.entryFee) &&
		feeScenarioCLISum(a.fees, a.closedFees, a.entryFee) &&
		feeScenarioCLISum(a.realized, a.grossClosed, -a.closedFees) &&
		feeScenarioCLISum(a.cash, initial, a.realized, -a.basis)
}

func feeScenarioCLIApplyFlow(
	a *feeScenarioCLIAccount,
	f backtest.CausalFill,
	flow backtest.FeeScenarioCausalCashFlow,
	fillIndex int,
	r backtest.CausalResult,
	initial, fixed, bps, target int64,
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
		!causalCLIFinite(f.Price, 0.01, 11000000) ||
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
	fee, ok := feeScenarioCLICharge(gross, fixed, bps)
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
		if fixed == 0 && bps == 0 {
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
		debit, ok = feeScenarioCLIAdd(gross, fee)
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
		delta, ok = feeScenarioCLIAdd(gross, -fee)
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
		next.realized, ok = feeScenarioCLIAdd(a.realized, delta)
		if !ok {
			return false
		}
		next.realized, ok = feeScenarioCLIAdd(next.realized, -a.basis)
		if !ok {
			return false
		}
		next.grossClosed, ok = feeScenarioCLIAdd(a.grossClosed, gross)
		if !ok {
			return false
		}
		next.grossClosed, ok = feeScenarioCLIAdd(next.grossClosed, -a.principal)
		if !ok {
			return false
		}
		next.closedFees, ok = feeScenarioCLIAdd(a.closedFees, a.entryFee)
		if !ok {
			return false
		}
		next.closedFees, ok = feeScenarioCLIAdd(next.closedFees, fee)
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
	next.cash, ok = feeScenarioCLIAdd(a.cash, delta)
	if !ok {
		return false
	}
	next.fees, ok = feeScenarioCLIAdd(a.fees, fee)
	if !ok || !next.valid(initial) {
		return false
	}
	if !feeScenarioCLIMatches(flow.GrossNotionalUnits, gross, fundedCLIMaxUnits) ||
		!feeScenarioCLIMatches(flow.FeeUnits, fee, fundedCLIMaxEquity) ||
		!feeScenarioCLIMatches(flow.NetCashDeltaUnits, delta, fundedCLIMaxEquity) ||
		!feeScenarioCLIMatches(flow.DebitedUnits, debit, fundedCLIMaxUnits) ||
		!feeScenarioCLIMatches(flow.CreditedUnits, credit, fundedCLIMaxUnits) ||
		!feeScenarioCLIMatches(flow.ModelCashUnits, next.cash, fundedCLIMaxUnits) ||
		!feeScenarioCLIMatches(flow.PositionPrincipalUnits, next.principal, fundedCLIEntryUnits) ||
		!feeScenarioCLIMatches(flow.PositionEntryFeeUnits, next.entryFee, fundedCLIEntryUnits) ||
		!feeScenarioCLIMatches(flow.PositionTotalBasisUnits, next.basis, fundedCLIEntryUnits) ||
		!feeScenarioCLIMatches(flow.GrossRealizedAccountingPnLUnits, next.grossClosed, fundedCLIMaxEquity) ||
		!feeScenarioCLIMatches(flow.NetRealizedAccountingPnLUnits, next.realized, fundedCLIMaxEquity) ||
		!feeScenarioCLIMatches(flow.ClosedAttributedFeeUnits, next.closedFees, fundedCLIMaxUnits) ||
		!feeScenarioCLIMatches(flow.AggregateFeeUnits, next.fees, fundedCLIMaxUnits) {
		return false
	}
	*a = next
	return true
}

// This boundary checks formatting consistency of a typed, internally computed
// standalone result. It is not an imported-record authenticator or evaluator.
func feeScenarioCLIResultValid(r backtest.FeeScenarioCausalResult) bool {
	replay := r.Replay
	if r.ModelIdentity != backtest.FeeScenarioCausalModelIdentity ||
		r.CostIdentity != backtest.FeeScenarioCausalCostIdentity ||
		r.DataLabel != backtest.CausalOfflineLabel ||
		r.AuthorityLabel != backtest.CausalOfflineLabel ||
		r.Scale != backtest.FundedCausalScale ||
		replay.ModelIdentity != backtest.FeeScenarioCausalModelIdentity ||
		replay.CostIdentity != backtest.FeeScenarioCausalCostIdentity ||
		replay.DataLabel != backtest.CausalOfflineLabel ||
		replay.AuthorityLabel != backtest.CausalOfflineLabel ||
		replay.TargetName != "BreakoutVol" ||
		len(replay.Symbol) == 0 || len(replay.Symbol) > 256 {
		return false
	}
	fixed, bps, target, ok := feeScenarioCLIDeclaration(r.Scenario)
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

	account := feeScenarioCLIAccount{cash: initial}
	peak, maxLoss, maxPeak, maxBar := initial, int64(0), int64(0), -1
	fillIndex, rejectedIndex := 0, 0
	var previousTime time.Time
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
			if !fill.Timestamp.Equal(mark.Timestamp) ||
				!feeScenarioCLIApplyFlow(&account, fill, r.CashFlows[fillIndex],
					fillIndex, replay, initial, fixed, bps, target) {
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
			!feeScenarioCLIMatches(mark.ModelCashUnits, account.cash, fundedCLIMaxUnits) ||
			!feeScenarioCLIMatches(mark.PositionPrincipalUnits, account.principal, fundedCLIEntryUnits) ||
			!feeScenarioCLIMatches(mark.PositionEntryFeeUnits, account.entryFee, fundedCLIEntryUnits) ||
			!feeScenarioCLIMatches(mark.PositionTotalBasisUnits, account.basis, fundedCLIEntryUnits) ||
			!causalCLIFinite(mark.ModelQuantity, 0, 1000) ||
			mark.ModelQuantity != account.quantity {
			return false
		}
		value, valid := fundedCLIUnits(mark.PositionValueUnits, false, fundedCLIMaxUnits)
		if !valid || account.quantity == 0 && value != 0 {
			return false
		}
		equity, valid := fundedCLIUnits(mark.EquityUnits, false, fundedCLIMaxEquity)
		if !valid || !feeScenarioCLISum(equity, account.cash, value) {
			return false
		}
		grossOpen, valid := feeScenarioCLIAdd(value, -account.principal)
		if !valid {
			return false
		}
		netOpen, valid := feeScenarioCLIAdd(value, -account.basis)
		if !valid ||
			!feeScenarioCLISum(netOpen, grossOpen, -account.entryFee) ||
			!feeScenarioCLISum(equity, initial, account.realized, netOpen) ||
			!feeScenarioCLIMatches(mark.GrossRealizedAccountingPnLUnits, account.grossClosed, fundedCLIMaxEquity) ||
			!feeScenarioCLIMatches(mark.GrossUnrealizedAccountingPnLUnits, grossOpen, fundedCLIMaxEquity) ||
			!feeScenarioCLIMatches(mark.NetRealizedAccountingPnLUnits, account.realized, fundedCLIMaxEquity) ||
			!feeScenarioCLIMatches(mark.NetUnrealizedAccountingPnLUnits, netOpen, fundedCLIMaxEquity) ||
			!feeScenarioCLIMatches(mark.ClosedAttributedFeeUnits, account.closedFees, fundedCLIMaxUnits) ||
			!feeScenarioCLIMatches(mark.OpenAttributedFeeUnits, account.entryFee, fundedCLIMaxUnits) ||
			!feeScenarioCLIMatches(mark.AggregateFeeUnits, account.fees, fundedCLIMaxUnits) {
			return false
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity // Both operands are bounded nonnegative equity.
		if !feeScenarioCLIMatches(mark.PeakEquityUnits, peak, fundedCLIMaxEquity) ||
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
			fee, valid := feeScenarioCLICharge(target, fixed, bps)
			if !valid || target <= 0 {
				return false
			}
			required, valid := feeScenarioCLIAdd(target, fee)
			if !valid || required <= 0 || required > fundedCLIEntryUnits ||
				rejected.Reason != backtest.FundedInsufficientModelCash ||
				!rejected.Timestamp.Equal(mark.Timestamp) ||
				rejected.EvaluationBarIndex != index-1 ||
				!rejected.EvaluationTimestamp.Equal(replay.Evaluations[index-20].Timestamp) ||
				replay.Evaluations[index-20].Signal != strategies.SignalBuy ||
				!feeScenarioCLIMatches(rejected.AvailableModelCashUnits, account.cash, fundedCLIMaxUnits) ||
				!feeScenarioCLIMatches(rejected.GrossNotionalUnits, target, fundedCLIEntryUnits) ||
				!feeScenarioCLIMatches(rejected.FeeUnits, fee, fundedCLIEntryUnits) ||
				!feeScenarioCLIMatches(rejected.RequiredModelCashUnits, required, fundedCLIEntryUnits) ||
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
	if fillIndex != len(replay.Fills) || rejectedIndex != len(r.RejectedEntries) ||
		replay.ClosedTradeCount != account.closed ||
		replay.WinningClosedTradeCount != account.wins ||
		!fundedCLINear(replay.GrossRealizedPnL, account.gross) ||
		!fundedCLINear(replay.GrossProfit, account.profit) ||
		!fundedCLINear(replay.GrossLoss, account.loss) {
		return false
	}
	if replay.GrossProfitFactor != nil &&
		!fundedCLINear(*replay.GrossProfitFactor, replay.GrossProfit/replay.GrossLoss) {
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
		p.EntryPrice != account.entry.Price ||
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
	return valid && feeScenarioCLIMatches(last.PositionValueUnits, value, fundedCLIMaxUnits)
}

func backtestCausalFeesSummary(r backtest.FeeScenarioCausalResult) (string, bool) {
	if !feeScenarioCLIResultValid(r) {
		return "", false
	}
	replay := r.Replay
	var out strings.Builder
	out.WriteString("GELT DECLARED-FEE CAUSAL CSV REPLAY SUMMARY\n")
	fmt.Fprintf(&out, "Model: %s\nCost: %s\nData: %s\nAuthority: %s\n",
		backtest.FeeScenarioCausalModelIdentity, backtest.FeeScenarioCausalCostIdentity,
		backtest.CausalOfflineLabel, backtest.CausalOfflineLabel)
	out.WriteString("Accounting: Scale 8 engineering modelUSD resolution (10^-8); exact8 decimal display.\n")
	fmt.Fprintf(&out, "Scenario basis: %s\nFixed per-side fee (modelUSD): %s\nFee rate (integer bps): %s\n",
		backtest.FeeScenarioCausalBasis, fundedCLIDecimal(r.Scenario.FixedFeeUnits), r.Scenario.FeeBps)
	out.WriteString("Rate denominator: 10000\nFee basis: quantized_gross_notional\nApplication: per_filled_side\n")
	out.WriteString("Fee formula: fixed fee + ceil(quantized gross notional units * bps / 10000).\n")
	out.WriteString("Entry cap: 10.00000000 modelUSD including declared entry fee; no partial funding.\n")
	out.WriteString("Costs: uncalibrated declared fees only; slippage excluded.\n")
	out.WriteString("Scope: offline model; no actual cash, holdings, execution, net performance or qualification claim.\n")
	out.WriteString("Fills: close signal / next open; no forced terminal liquidation or hypothetical exit fee.\n")
	out.WriteString("Float gross diagnostics are separate from exact fixed8 gross/net accounting PnL.\n")
	fmt.Fprintf(&out, "Bars: %d\nEvaluations: %d\nModel fills: %d\n",
		replay.TotalBars, len(replay.Evaluations), len(replay.Fills))
	fmt.Fprintf(&out, "Closed trades: %d\nWinning closed trades (float gross): %d\nRejected entries: %d\n",
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
	out.WriteString("Drawdown uses real-bar close marks and declared initial equity; no intrabar peak metric.\n")
	fmt.Fprintf(&out, "Float diagnostic gross realized PnL: %.12e\n",
		replay.GrossRealizedPnL)
	fmt.Fprintf(&out, "Float diagnostic gross profit: %.12e\nFloat diagnostic gross loss: %.12e\n",
		replay.GrossProfit, replay.GrossLoss)
	if replay.GrossProfitFactor != nil {
		fmt.Fprintf(&out, "Float diagnostic gross profit factor: %.12e\n", *replay.GrossProfitFactor)
	} else if replay.GrossProfitFactorReason == backtest.CausalNoClosedTrades {
		out.WriteString("Float diagnostic gross profit factor: null (no_closed_trades)\n")
	} else {
		out.WriteString("Float diagnostic gross profit factor: null (no_losing_closed_trades)\n")
	}
	if p := replay.TerminalPosition; p != nil {
		out.WriteString("Final open model position: present\n")
		fmt.Fprintf(&out, "Entry price (float diagnostic): %.12e\nLast close price (float diagnostic): %.12e\n",
			p.EntryPrice, p.LastClosePrice)
		fmt.Fprintf(&out, "Float diagnostic gross unrealized PnL: %.12e\n", p.GrossUnrealizedPnL)
		out.WriteString("Final cash excludes open-position proceeds; equity includes the close mark.\n")
		out.WriteString("Open attributed fees retain only the filled entry fee; no exit fee is assumed.\n")
	} else {
		out.WriteString("Final open model position: none\n")
	}
	fmt.Fprintf(&out, "Final directional signal pending: %t\n", replay.PendingSignalUnfilled)
	out.WriteString("Pending means no successor bar; may be a no-op, not an actual unfilled order.\n")
	if out.Len() > feeScenarioCLISummaryMaxBytes {
		return "", false
	}
	return out.String(), true
}
