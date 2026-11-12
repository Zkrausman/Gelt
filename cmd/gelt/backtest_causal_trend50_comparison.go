package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

func trend50CLIApplyFlow(
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
		f.BarIndex < 50 || f.BarIndex >= r.TotalBars ||
		f.EvaluationBarIndex < 49 || f.EvaluationBarIndex >= f.BarIndex ||
		f.EntrySignalBarIndex < 49 || f.EntrySignalBarIndex >= r.TotalBars ||
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
			r.Evaluations[f.EntrySignalBarIndex-49].Signal != strategies.SignalBuy {
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
				r.Evaluations[f.EvaluationBarIndex-49].Signal != strategies.SignalSell {
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
func trend50ExecutionCLIResultValid(ctx context.Context, r backtest.ExecutionScenarioCausalResult) bool {
	replay := r.ReferenceReplay
	if replay.TotalBars < 1 || replay.TotalBars > backtest.CausalMaxBars || len(replay.Fills) > backtest.CausalMaxFills {
		return false
	}
	if r.ModelIdentity != backtest.Trend50StrategyModelIdentity ||
		r.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity ||
		r.DataLabel != backtest.CausalOfflineLabel ||
		r.AuthorityLabel != backtest.CausalOfflineLabel ||
		r.Scale != backtest.FundedCausalScale ||
		replay.ModelIdentity != backtest.Trend50StrategyModelIdentity ||
		replay.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity ||
		replay.DataLabel != backtest.CausalOfflineLabel ||
		replay.AuthorityLabel != backtest.CausalOfflineLabel ||
		replay.TargetName != "TrendConfluence" ||
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

	if !executionCLIReferenceDiagnosticsValid(replay) {
		return false
	}
	total := replay.TotalBars
	expectedEvaluations := total - 49
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
		if ctx.Err() != nil {
			return false
		}
		if evaluation.BarIndex != i+49 ||
			evaluation.PrefixLength != evaluation.BarIndex+1 ||
			len(evaluation.Components) != 0 ||
			!fundedCLISignalValid(evaluation.CausalSignal, replay) ||
			!(evaluation.StopLossPct == 0 || causalCLIFinite(evaluation.StopLossPct, .01, 99.99)) || !(evaluation.TargetPct == 0 || causalCLIFinite(evaluation.TargetPct, .01, 1000)) {
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
		if ctx.Err() != nil {
			return false
		}
		if mark.BarIndex != index || !fundedCLITime(mark.Timestamp) ||
			index > 0 && !mark.Timestamp.After(previousTime) {
			return false
		}
		previousTime = mark.Timestamp
		if index >= 49 && !replay.Evaluations[index-49].Timestamp.Equal(mark.Timestamp) {
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
			if !fill.Timestamp.Equal(mark.Timestamp) || !trend50CLIApplyFlow(&account, executed, flow, fillIndex, replay, initial, fixed, bps, target, buyRate) {
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
			if index < 50 {
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
				!rejected.EvaluationTimestamp.Equal(replay.Evaluations[index-50].Timestamp) ||
				replay.Evaluations[index-50].Signal != strategies.SignalBuy ||
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
		p.EntrySignalBarIndex < 49 || p.EntrySignalBarIndex-49 >= len(replay.Evaluations) ||
		!p.EntryTimestamp.Equal(account.entry.Timestamp) ||
		!p.EntrySignalTimestamp.Equal(replay.Evaluations[p.EntrySignalBarIndex-49].Timestamp) ||
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

func trend50CLIControl(ctx context.Context, bars []backtest.OHLCV, symbol string, initial, fixed, bps, target, buy int64, passive bool) (backtest.ComparisonControlResult, bool) {
	model, policy := backtest.Trend50CashModelIdentity, backtest.ComparisonCashPolicy
	if passive {
		model, policy = backtest.Trend50PassiveModelIdentity, "fixed_after_50_closes_one_buy_no_exit"
	}
	u := func(n int64) string { return strconv.FormatInt(n, 10) }
	r := backtest.ComparisonControlResult{ModelIdentity: model, PolicyIdentity: policy, Symbol: symbol, TotalBars: len(bars), Scale: 8, InitialModelCashUnits: u(initial), EntryStatus: "no_eligible_bar"}
	cash, principal, fee, basis, peak := initial, int64(0), int64(0), int64(0), initial
	var quantity float64
	maxLoss, maxPeak, maxBar := int64(0), int64(0), -1
	for i, b := range bars {
		if ctx.Err() != nil {
			return r, false
		}
		if passive && i == 50 {
			p, ok := executionCLIPrice(b.Open, buy, backtest.CausalEntry)
			if !ok {
				return r, false
			}
			q, ok := comparisonCLIQuantity(p, target, fixed == 0 && bps == 0 && buy == 0)
			if !ok {
				return r, false
			}
			f, ok := executionScenarioCLICharge(target, fixed, bps)
			if !ok {
				return r, false
			}
			debit, ok := executionScenarioCLIAdd(target, f)
			if !ok || debit <= 0 || debit > fundedCLIEntryUnits {
				return r, false
			}
			r.Entry = &backtest.ComparisonControlEntry{Origin: "fixed_control_policy", Reason: "fixed_after_50_closes_one_buy", PolicyDecisionBarIndex: 49, BarIndex: 50, Timestamp: time.Unix(b.Timestamp, 0).UTC(), ReferencePrice: b.Open, ExecutionPrice: p, ModelQuantity: q, PrincipalUnits: u(target), FeeUnits: u(f), RequiredModelCashUnits: u(debit), AvailableModelCashUnits: u(initial)}
			r.EntryStatus = backtest.FundedInsufficientModelCash
			if initial >= debit {
				r.EntryStatus = "filled"
				cash = initial - debit
				principal = target
				fee = f
				basis = debit
				quantity = q
			}
		}
		value := int64(0)
		if quantity != 0 {
			var ok bool
			value, ok = fundedCLIQuote(b.Close, quantity)
			if !ok {
				return r, false
			}
		}
		equity, ok := executionScenarioCLIAdd(cash, value)
		if !ok || equity < 0 || equity > fundedCLIMaxEquity {
			return r, false
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity
		if loss > 0 && peak > 0 && (maxLoss == 0 || fundedCLIRatioGreater(loss, peak, maxLoss, maxPeak)) {
			maxLoss, maxPeak, maxBar = loss, peak, i
		}
		m := backtest.ExecutionScenarioCausalCloseMark{BarIndex: i, Timestamp: time.Unix(b.Timestamp, 0).UTC(), ModelCashUnits: u(cash), ModelQuantity: quantity, PositionPrincipalUnits: u(principal), PositionEntryFeeUnits: u(fee), PositionTotalBasisUnits: u(basis), PositionValueUnits: u(value), EquityUnits: u(equity), PeakEquityUnits: u(peak), GrossRealizedAccountingPnLUnits: "0", GrossUnrealizedAccountingPnLUnits: u(value - principal), NetRealizedAccountingPnLUnits: "0", NetUnrealizedAccountingPnLUnits: u(value - basis), ClosedAttributedFeeUnits: "0", OpenAttributedFeeUnits: u(fee), AggregateFeeUnits: u(fee), CloseMarkDrawdown: comparisonCLIDD(loss, peak, i)}
		r.CloseMarks = append(r.CloseMarks, m)
		r.FinalModelCashUnits = m.ModelCashUnits
		r.FinalModelQuantity = quantity
		r.FinalPositionPrincipalUnits = m.PositionPrincipalUnits
		r.FinalPositionEntryFeeUnits = m.PositionEntryFeeUnits
		r.FinalPositionTotalBasisUnits = m.PositionTotalBasisUnits
		r.FinalPositionValueUnits = m.PositionValueUnits
		r.FinalEquityUnits = m.EquityUnits
		r.NetRealizedAccountingPnLUnits = "0"
		r.NetUnrealizedAccountingPnLUnits = m.NetUnrealizedAccountingPnLUnits
		r.AggregateFeeUnits = m.AggregateFeeUnits
		r.PeakCloseEquityUnits = m.PeakEquityUnits
	}
	if maxPeak == 0 {
		maxPeak = peak
	}
	r.MaxCloseMarkDrawdown = comparisonCLIDD(maxLoss, maxPeak, maxBar)
	return r, true
}

// trend50ReferenceEvents derives all event opportunities from the supplied
// bars and validated normalized signals. It does not invoke an evaluator or
// consume the producer's fills to decide whether an event exists.
type trend50Position struct {
	entry, quantity, peak, stop, target       float64
	entrySignal, entryBar, stopBar, targetBar int
}

func trend50ReferenceEvents(ctx context.Context, bars []backtest.OHLCV, r backtest.ExecutionScenarioCausalResult, initial, fixed, bps, target, buy, sell int64) bool {
	replay := r.ReferenceReplay
	cash := initial
	var pos *trend50Position
	var pending *backtest.CausalEvaluation
	fillIndex, rejectedIndex := 0, 0
	for i, bar := range bars {
		if ctx.Err() != nil {
			return false
		}
		exited := false
		emit := func(kind backtest.CausalFillKind, reason backtest.CausalFillReason, source int, price float64, ambiguous bool) bool {
			if pos == nil || fillIndex >= len(replay.Fills) {
				return false
			}
			pnl := 0.0
			if kind == backtest.CausalExit {
				pnl = (price - pos.entry) * pos.quantity
			}
			expected := backtest.CausalFill{Kind: kind, Reason: reason, BarIndex: i, Timestamp: time.Unix(bar.Timestamp, 0).UTC(), EvaluationBarIndex: source, EntrySignalBarIndex: pos.entrySignal, EntryBarIndex: pos.entryBar, Price: price, Quantity: pos.quantity, Notional: price * pos.quantity, GrossRealizedPnL: pnl, StopLoss: pos.stop, Target: pos.target, Ambiguous: ambiguous}
			if !reflect.DeepEqual(expected, replay.Fills[fillIndex]) {
				return false
			}
			fillIndex++
			rate := sell
			if kind == backtest.CausalEntry {
				rate = buy
			}
			execution, ok := executionCLIPrice(price, rate, kind)
			if !ok {
				return false
			}
			gross, ok := fundedCLIQuote(execution, pos.quantity)
			if !ok {
				return false
			}
			fee, ok := executionScenarioCLICharge(gross, fixed, bps)
			if !ok {
				return false
			}
			delta := gross - fee
			if kind == backtest.CausalEntry {
				delta = -gross - fee
			}
			next, ok := executionScenarioCLIAdd(cash, delta)
			if !ok || next < 0 || next > fundedCLIMaxUnits {
				return false
			}
			cash = next
			if kind == backtest.CausalExit {
				pos = nil
				exited = true
			}
			return true
		}
		if pos != nil {
			switch {
			case pos.stop > 0 && bar.Open <= pos.stop:
				if !emit(backtest.CausalExit, backtest.CausalStopGap, pos.stopBar, bar.Open, false) {
					return false
				}
			case pos.target > 0 && bar.Open >= pos.target:
				if !emit(backtest.CausalExit, backtest.CausalTargetGap, pos.targetBar, pos.target, false) {
					return false
				}
			case pending != nil && pending.Signal == strategies.SignalSell:
				if !emit(backtest.CausalExit, backtest.CausalNextOpenSell, pending.BarIndex, bar.Open, false) {
					return false
				}
			}
		}
		if !exited && pos == nil && pending != nil && pending.Signal == strategies.SignalBuy {
			execution, ok := executionCLIPrice(bar.Open, buy, backtest.CausalEntry)
			if !ok {
				return false
			}
			quantity, ok := comparisonCLIQuantity(execution, target, fixed == 0 && bps == 0 && buy == 0)
			if !ok {
				return false
			}
			fee, ok := executionScenarioCLICharge(target, fixed, bps)
			if !ok {
				return false
			}
			debit, ok := executionScenarioCLIAdd(target, fee)
			if !ok || debit <= 0 || debit > fundedCLIEntryUnits {
				return false
			}
			if cash < debit {
				expected := backtest.ExecutionScenarioCausalRejectedEntry{Reason: backtest.FundedInsufficientModelCash, BarIndex: i, Timestamp: time.Unix(bar.Timestamp, 0).UTC(), EvaluationBarIndex: pending.BarIndex, EvaluationTimestamp: pending.Timestamp, AvailableModelCashUnits: strconv.FormatInt(cash, 10), GrossNotionalUnits: strconv.FormatInt(target, 10), FeeUnits: strconv.FormatInt(fee, 10), RequiredModelCashUnits: strconv.FormatInt(debit, 10)}
				if rejectedIndex >= len(r.RejectedEntries) || !reflect.DeepEqual(expected, r.RejectedEntries[rejectedIndex]) {
					return false
				}
				rejectedIndex++
			} else {
				pos = &trend50Position{entry: bar.Open, quantity: quantity, peak: bar.Open, entrySignal: pending.BarIndex, entryBar: i, stopBar: -1, targetBar: -1}
				if pending.StopLossPct > 0 {
					pos.stop = bar.Open - bar.Open*pending.StopLossPct/100
					pos.stopBar = pending.BarIndex
				}
				if pending.TargetPct > 0 {
					pos.target = bar.Open + bar.Open*pending.TargetPct/100
					pos.targetBar = pending.BarIndex
				}
				if !trend50Levels(pos.stop, pos.target) || !emit(backtest.CausalEntry, backtest.CausalNextOpenBuy, pending.BarIndex, bar.Open, false) {
					return false
				}
			}
		}
		pending = nil
		if pos != nil {
			stop := pos.stop > 0 && bar.Low <= pos.stop
			hitTarget := pos.target > 0 && bar.High >= pos.target
			if stop {
				if !emit(backtest.CausalExit, backtest.CausalStopTouch, pos.stopBar, pos.stop, hitTarget) {
					return false
				}
			} else if hitTarget {
				if !emit(backtest.CausalExit, backtest.CausalTargetTouch, pos.targetBar, pos.target, false) {
					return false
				}
			}
		}
		if i >= 49 {
			e := replay.Evaluations[i-49]
			if pos != nil {
				if pos.stop > 0 && e.StopLossPct == 0 || pos.target > 0 && e.TargetPct == 0 {
					return false
				}
				pos.peak = math.Max(pos.peak, bar.High)
				if e.StopLossPct > 0 {
					candidate := pos.peak - pos.peak*e.StopLossPct/100
					if candidate > pos.stop {
						pos.stop = candidate
						pos.stopBar = i
					}
				}
				if e.TargetPct > 0 {
					candidate := pos.entry + pos.entry*e.TargetPct/100
					if candidate != pos.target {
						pos.target = candidate
						pos.targetBar = i
					}
				}
				if !trend50Levels(pos.stop, pos.target) {
					return false
				}
			}
			pending = &replay.Evaluations[i-49]
		}
	}
	if fillIndex != len(replay.Fills) || rejectedIndex != len(r.RejectedEntries) {
		return false
	}
	if pos == nil {
		return replay.TerminalPosition == nil
	}
	last := len(bars) - 1
	p := backtest.CausalTerminalPosition{Quantity: pos.quantity, EntryPrice: pos.entry, LastClosePrice: bars[last].Close, GrossUnrealizedPnL: (bars[last].Close - pos.entry) * pos.quantity, PeakPrice: pos.peak, StopLoss: pos.stop, Target: pos.target, StopEvaluationBarIndex: pos.stopBar, TargetEvaluationBarIndex: pos.targetBar, EntrySignalBarIndex: pos.entrySignal, EntrySignalTimestamp: time.Unix(bars[pos.entrySignal].Timestamp, 0).UTC(), EntryBarIndex: pos.entryBar, EntryTimestamp: time.Unix(bars[pos.entryBar].Timestamp, 0).UTC(), LastBarIndex: last, LastTimestamp: time.Unix(bars[last].Timestamp, 0).UTC()}
	return reflect.DeepEqual(&p, replay.TerminalPosition)
}
func trend50Levels(stop, target float64) bool {
	return (stop == 0 || causalCLIFinite(stop, math.SmallestNonzeroFloat64, 11000000)) && (target == 0 || causalCLIFinite(target, math.SmallestNonzeroFloat64, 11000000)) && (stop == 0 || target == 0 || stop < target)
}

func trend50ComparisonCLIResultValid(ctx context.Context, r backtest.Trend50ComparisonResult, bars []backtest.OHLCV, symbol, cash string, scenario backtest.ExecutionScenario) bool {
	initial, ok := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	fixed, ok := comparisonCLIInputUnits(scenario.FixedFee, fundedCLIEntryUnits-1)
	if !ok {
		return false
	}
	bps, ok := fundedCLIUnits(scenario.FeeBps, false, 10000)
	if !ok || len(scenario.FeeBps) > 5 {
		return false
	}
	buy, ok := executionCLIAdverseRate(scenario.BuyAdverseBps)
	if !ok {
		return false
	}
	sell, ok := executionCLIAdverseRate(scenario.SellAdverseBps)
	if !ok {
		return false
	}
	if len(bars) < 1 || len(bars) > 10000 || !comparisonCLISymbolPattern.MatchString(symbol) || r.ModelIdentity != backtest.Trend50ComparisonModelIdentity || r.CostIdentity != backtest.ExecutionScenarioCausalCostIdentity || r.ScenarioBasis != backtest.ExecutionScenarioCausalBasis || r.DataLabel != backtest.CausalOfflineLabel || r.AuthorityLabel != backtest.CausalOfflineLabel || r.Symbol != symbol || r.TotalBars != len(bars) || r.Scale != 8 || r.FixedWarmupCloses != 50 || r.FirstEvaluationBarIndex != 49 || r.FirstEligibleFillBarIndex != 50 || r.CadencePolicy != "bar_index_only_cadence_and_session_unqualified" || r.IntradayEligibility != "unestablished" || r.SelectionHistory != "unestablished" || r.InitialModelCashUnits != strconv.FormatInt(initial, 10) {
		return false
	}
	f, b, target, ok := executionScenarioCLIDeclaration(r.Scenario)
	if !ok || f != fixed || b != bps || r.Scenario.BuyAdverseBps != scenario.BuyAdverseBps || r.Scenario.SellAdverseBps != scenario.SellAdverseBps || r.Strategy.Scenario != r.Scenario || r.Strategy.InitialModelCashUnits != r.InitialModelCashUnits || r.Strategy.ReferenceReplay.TargetName != "TrendConfluence" || r.Strategy.ReferenceReplay.Symbol != symbol || r.Strategy.ReferenceReplay.TotalBars != len(bars) || !trend50ExecutionCLIResultValid(ctx, r.Strategy) || len(r.Strategy.CloseMarks) != len(bars) {
		return false
	}
	for i, b := range bars {
		if ctx.Err() != nil {
			return false
		}
		if b.Timestamp < 1 || b.Timestamp > 253402300799 || i > 0 && b.Timestamp <= bars[i-1].Timestamp || !causalCLIFinite(b.Open, .01, 1000000) || !causalCLIFinite(b.High, .01, 1000000) || !causalCLIFinite(b.Low, .01, 1000000) || !causalCLIFinite(b.Close, .01, 1000000) || !causalCLIFinite(b.Volume, 0, 1e12) || b.Low > b.Open || b.Low > b.Close || b.Open > b.High || b.Close > b.High {
			return false
		}
	}
	if !trend50ReferenceEvents(ctx, bars, r.Strategy, initial, fixed, bps, target, buy, sell) {
		return false
	}
	for i, e := range r.Strategy.ReferenceReplay.Evaluations {
		if ctx.Err() != nil {
			return false
		}
		if !e.Timestamp.Equal(time.Unix(bars[i+49].Timestamp, 0).UTC()) {
			return false
		}
	}
	for i, m := range r.Strategy.CloseMarks {
		if ctx.Err() != nil {
			return false
		}
		if m.BarIndex != i || !m.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0).UTC()) {
			return false
		}
		value := int64(0)
		if m.ModelQuantity != 0 {
			var ok bool
			value, ok = fundedCLIQuote(bars[i].Close, m.ModelQuantity)
			if !ok {
				return false
			}
		}
		if m.PositionValueUnits != strconv.FormatInt(value, 10) {
			return false
		}
	}
	c, ok := trend50CLIControl(ctx, bars, symbol, initial, fixed, bps, target, buy, false)
	if !ok || !reflect.DeepEqual(c, r.Cash) {
		return false
	}
	p, ok := trend50CLIControl(ctx, bars, symbol, initial, fixed, bps, target, buy, true)
	if !ok || !reflect.DeepEqual(p, r.Passive) {
		return false
	}
	eq, ok := fundedCLIUnits(r.Strategy.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		return false
	}
	peq, ok := fundedCLIUnits(p.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		return false
	}
	return r.StrategyMinusCashUnits == strconv.FormatInt(eq-initial, 10) && r.StrategyMinusPassiveUnits == strconv.FormatInt(eq-peq, 10)
}

func backtestCausalTrend50ComparisonSummary(ctx context.Context, r backtest.Trend50ComparisonResult, bars []backtest.OHLCV, symbol, cash string, scenario backtest.ExecutionScenario) (string, bool) {
	if !trend50ComparisonCLIResultValid(ctx, r, bars, symbol, cash, scenario) {
		return "", false
	}
	money := func(s string) string { return fundedCLIDecimal(s) }
	dd := func(d backtest.FundedCausalDrawdown) string {
		if d.Percent == nil {
			return "undefined:" + d.UndefinedReason
		}
		return fmt.Sprintf("%.8g%%", *d.Percent)
	}
	var out strings.Builder
	fmt.Fprintf(&out, "Offline causal TrendConfluence comparison: %s\nSymbol: %s; supplied bars: %d; data/authority: unqualified_offline\nCost: %s; basis: uncalibrated_declared\nInitial model cash: %s; fee-inclusive entry cap: 10.00000000\nFixed fee: %s; fee bps: %s; buy adverse bps: %s; sell adverse bps: %s\n", r.ModelIdentity, r.Symbol, r.TotalBars, r.CostIdentity, money(r.InitialModelCashUnits), money(r.Scenario.FixedFeeUnits), r.Scenario.FeeBps, r.Scenario.BuyAdverseBps, r.Scenario.SellAdverseBps)
	fmt.Fprintf(&out, "Strategy model: %s; cash model: %s; passive model: %s\n", r.Strategy.ModelIdentity, r.Cash.ModelIdentity, r.Passive.ModelIdentity)
	out.WriteString("Model | cash | open value | equity | realized PnL | unrealized PnL | net model PnL | fees | quantity | maximum close-mark drawdown\n")
	row := func(name, cash, value, equity, realized, unrealized, fees string, q float64, d backtest.FundedCausalDrawdown) {
		eq, _ := fundedCLIUnits(equity, false, fundedCLIMaxEquity)
		initial, _ := fundedCLIUnits(r.InitialModelCashUnits, false, fundedCLIMaxUnits)
		fmt.Fprintf(&out, "%s | %s | %s | %s | %s | %s | %s | %s | %.17g | %s\n", name, money(cash), money(value), money(equity), money(realized), money(unrealized), money(strconv.FormatInt(eq-initial, 10)), money(fees), q, dd(d))
	}
	s := r.Strategy
	row("strategy:TrendConfluence", s.FinalModelCashUnits, s.FinalPositionValueUnits, s.FinalEquityUnits, s.NetRealizedAccountingPnLUnits, s.NetUnrealizedAccountingPnLUnits, s.AggregateFeeUnits, s.FinalModelQuantity, s.MaxCloseMarkDrawdown)
	for _, c := range []backtest.ComparisonControlResult{r.Cash, r.Passive} {
		row(c.PolicyIdentity, c.FinalModelCashUnits, c.FinalPositionValueUnits, c.FinalEquityUnits, c.NetRealizedAccountingPnLUnits, c.NetUnrealizedAccountingPnLUnits, c.AggregateFeeUnits, c.FinalModelQuantity, c.MaxCloseMarkDrawdown)
	}
	fmt.Fprintf(&out, "Passive eligibility: index50 open after50 closes; status: %s\n", r.Passive.EntryStatus)
	if e := r.Passive.Entry; e != nil {
		fmt.Fprintf(&out, "Passive required debit: %s; candidate principal: %s; candidate entry fee: %s; available cash: %s; reference price: %.17g; execution price: %.17g\n", money(e.RequiredModelCashUnits), money(e.PrincipalUnits), money(e.FeeUnits), money(e.AvailableModelCashUnits), e.ReferencePrice, e.ExecutionPrice)
	}
	fmt.Fprintf(&out, "Ending equity gaps (strategy minus control): cash %s; passive %s\n", money(r.StrategyMinusCashUnits), money(r.StrategyMinusPassiveUnits))
	out.WriteString("Cadence and session unqualified; intraday eligibility and selection history unestablished. Controls do not evaluate strategies. Passive holds one lot to the final supplied close; no protection, rebalancing or terminal sale. SELL costs apply only to a SELL.\nExposure duration, protection and turnover differ; equal declarations do not imply equal risk. No extra execution-price cash charge. Synthetic uncalibrated scenario assumptions; supplied CSV authenticity is unknown. No ranking, statistical edge, profitability, qualification or operating admission.\n")
	return out.String(), out.Len() <= comparisonCLISummaryMaxBytes
}

const trend50CLIUsage = "Usage: gelt backtest-causal-trend50-compare <Target> <Symbol> <CSV> <InitialCash> <FixedFee> <FeeBps> <BuyBps> <SellBps>\nSupported target: TrendConfluence only.\n"

func trend50CLIFail(w io.Writer, code string) int {
	switch code {
	case "invalid_arguments", "input_file", "invalid_csv", "resource_limit", "unsupported_target", "invalid_model_cash", "invalid_execution_scenario", "insufficient_exit_fee_cash", "invalid_input", "invalid_symbol", "invalid_evaluator", "evaluator_identity", "evaluator_error", "plan_membership", "unsupported_condition", "numeric_range", "canceled", "invalid_result", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	msg := "backtest-causal-trend50-compare: " + code + "\n"
	if code == "invalid_arguments" {
		msg = trend50CLIUsage + msg
	}
	if w != nil {
		_, _ = io.WriteString(w, msg)
	}
	return 1
}
func trend50CLIError(err error) string {
	var e *backtest.Trend50ComparisonError
	if !errors.As(err, &e) || e == nil {
		return "replay_failed"
	}
	switch e.Code {
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
	case backtest.Trend50InvalidResult:
		return "invalid_result"
	}
	return "replay_failed"
}
func runBacktestCausalTrend50Comparison(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 8 {
		return trend50CLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return trend50CLIFail(stderr, "canceled")
	}
	f, err := os.Open(args[2])
	if err != nil {
		return trend50CLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return trend50CLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return trend50CLIFail(stderr, "input_file")
		default:
			return trend50CLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return trend50CLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return trend50CLIFail(stderr, "canceled")
	}
	if args[0] != "TrendConfluence" {
		return trend50CLIFail(stderr, "unsupported_target")
	}
	scenario := backtest.ExecutionScenario{FixedFee: args[4], FeeBps: args[5], BuyAdverseBps: args[6], SellAdverseBps: args[7]}
	r, err := backtest.RunTrend50ComparisonCausal(ctx, args[1], bars, args[3], scenario)
	if err != nil {
		return trend50CLIFail(stderr, trend50CLIError(err))
	}
	summary, ok := backtestCausalTrend50ComparisonSummary(ctx, r, bars, args[1], args[3], scenario)
	if !ok {
		if ctx.Err() != nil {
			return trend50CLIFail(stderr, "canceled")
		}
		return trend50CLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return trend50CLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return trend50CLIFail(stderr, "output_error")
	}
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return trend50CLIFail(stderr, "output_error")
	}
	return 0
}
