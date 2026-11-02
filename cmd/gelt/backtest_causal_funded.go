package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"os"
	"strconv"
	"strings"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

const (
	fundedCLISummaryMaxBytes = 8192
	fundedCLIUnitScale       = int64(100000000)
	fundedCLIEntryUnits      = int64(1000000000)
	fundedCLIMaxUnits        = int64(100000000000000)
	fundedCLIMaxEquity       = int64(200000000000000)
	fundedCLIUsage           = "Usage: gelt backtest-causal-funded <Target> <Symbol> <DataFile.csv> <InitialModelCash>\n" +
		"Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n"
)

// runBacktestCausalFunded receives arguments excluding the command name.
// The fourth token is mandatory and reaches the core unchanged.
func runBacktestCausalFunded(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 4 {
		return fundedCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return fundedCLIFail(stderr, "canceled")
	}

	f, err := os.Open(args[2])
	if err != nil {
		return fundedCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return fundedCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return fundedCLIFail(stderr, "input_file")
		default:
			return fundedCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return fundedCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return fundedCLIFail(stderr, "canceled")
	}

	// Resolve only after the entire bounded CSV has been parsed and closed.
	engine, ok := newBacktestCausalEngine(args[0])
	if !ok {
		if args[0] != "BreakoutVol" {
			return fundedCLIFail(stderr, "unsupported_target")
		}
		return fundedCLIFail(stderr, "invalid_evaluator")
	}
	return runBacktestCausalFundedEngine(
		ctx, args[1], bars, args[3], engine, stdout, stderr,
	)
}

// The typed seam is local to this package. The actual command always creates
// its fresh trusted engine with newBacktestCausalEngine.
func runBacktestCausalFundedEngine(
	ctx context.Context,
	symbol string,
	bars []backtest.OHLCV,
	initialModelCash string,
	engine *backtest.Engine,
	stdout, stderr io.Writer,
) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return fundedCLIFail(stderr, "canceled")
	}
	if engine == nil {
		return fundedCLIFail(stderr, "invalid_evaluator")
	}
	result, err := engine.RunFundedCausal(ctx, symbol, bars, initialModelCash)
	if err != nil {
		return fundedCLIFail(stderr, fundedCLIEngineError(err))
	}
	summary, ok := backtestCausalFundedSummary(result)
	if !ok {
		return fundedCLIFail(stderr, "invalid_result")
	}
	if ctx.Err() != nil {
		return fundedCLIFail(stderr, "canceled")
	}
	if stdout == nil {
		return fundedCLIFail(stderr, "output_error")
	}

	// One attempt only. A writer may retain a prefix even when it fails.
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return fundedCLIFail(stderr, "output_error")
	}
	return 0
}

func fundedCLIEngineError(err error) string {
	var failure *backtest.FundedCausalError
	if !errors.As(err, &failure) || failure == nil {
		return "replay_failed"
	}
	switch failure.Code {
	case backtest.FundedInvalidModelCash:
		return "invalid_model_cash"
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

// No caller-supplied code or error text crosses this boundary.
func fundedCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_arguments", "input_file", "invalid_csv", "resource_limit",
		"unsupported_target", "invalid_model_cash", "invalid_input",
		"invalid_symbol", "invalid_evaluator", "evaluator_identity",
		"evaluator_error", "plan_membership", "unsupported_condition",
		"numeric_range", "canceled", "invalid_result", "output_error",
		"replay_failed":
	default:
		code = "replay_failed"
	}
	message := "backtest-causal-funded: " + code + "\n"
	if code == "invalid_arguments" {
		message = fundedCLIUsage + message
	}
	if stderr != nil {
		n, err := io.WriteString(stderr, message)
		if err != nil || n != len(message) {
			return 1
		}
	}
	return 1
}

// The bound makes every subsequent addition/subtraction safely fit int64.
// FormatInt equality rejects signs on nonnegative values, -0, leading zeros,
// whitespace, non-ASCII digits and all other noncanonical representations.
func fundedCLIUnits(token string, signed bool, bound int64) (int64, bool) {
	if len(token) == 0 || len(token) > 16 {
		return 0, false
	}
	v, err := strconv.ParseInt(token, 10, 64)
	if err != nil || v > bound || v < -bound ||
		(!signed && v < 0) || strconv.FormatInt(v, 10) != token {
		return 0, false
	}
	return v, true
}

// Called only after canonical bounded-unit validation; money never uses
// ParseFloat or a float intermediary.
func fundedCLIDecimal(token string) string {
	negative := strings.HasPrefix(token, "-")
	if negative {
		token = token[1:]
	}
	if len(token) <= backtest.FundedCausalScale {
		token = strings.Repeat("0", backtest.FundedCausalScale+1-len(token)) + token
	}
	point := len(token) - backtest.FundedCausalScale
	out := token[:point] + "." + token[point:]
	if negative {
		out = "-" + out
	}
	return out
}

func fundedCLITime(at time.Time) bool {
	return at.Unix() >= 0 && at.Unix() <= 253402300799 &&
		at.Nanosecond() == 0 && at.Location() == time.UTC
}

func fundedCLINear(a, b float64) bool {
	return causalCLIFinite(a, -math.MaxFloat64, math.MaxFloat64) &&
		causalCLIFinite(b, -math.MaxFloat64, math.MaxFloat64) &&
		math.Abs(a-b) <= 1e-10+1e-12*math.Abs(b)
}

// Exact binary-rational multiplication and ties-to-even conversion check the
// link from a displayed trace fill/terminal price to its stored unit amount.
// This is a formatting consistency check, not a second replay implementation.
func fundedCLIQuote(price, quantity float64) (int64, bool) {
	if !causalCLIFinite(price, math.SmallestNonzeroFloat64, 11000000) ||
		!causalCLIFinite(quantity, 0.00001, 1000) {
		return 0, false
	}
	p := new(big.Rat).SetFloat64(price)
	q := new(big.Rat).SetFloat64(quantity)
	if p == nil || q == nil {
		return 0, false
	}
	scaled := new(big.Rat).Mul(p, q)
	scaled.Mul(scaled, new(big.Rat).SetInt64(fundedCLIUnitScale))
	if scaled.Sign() <= 0 ||
		scaled.Cmp(new(big.Rat).SetInt64(fundedCLIMaxUnits)) > 0 {
		return 0, false
	}
	whole, remainder := new(big.Int), new(big.Int)
	whole.QuoRem(scaled.Num(), scaled.Denom(), remainder)
	comparison := new(big.Int).Lsh(remainder, 1).Cmp(scaled.Denom())
	if comparison > 0 || comparison == 0 && whole.Bit(0) == 1 {
		whole.Add(whole, big.NewInt(1))
	}
	if !whole.IsInt64() {
		return 0, false
	}
	v := whole.Int64()
	return v, v >= 0 && v <= fundedCLIMaxUnits
}

func fundedCLIRatioGreater(loss, peak, oldLoss, oldPeak int64) bool {
	left := new(big.Int).Mul(big.NewInt(loss), big.NewInt(oldPeak))
	right := new(big.Int).Mul(big.NewInt(oldLoss), big.NewInt(peak))
	return left.Cmp(right) > 0
}

// expectedBar is meaningful only for a positive loss.
func fundedCLIDrawdownValid(
	d backtest.FundedCausalDrawdown,
	loss, peak int64,
	expectedBar int,
) bool {
	if peak == 0 {
		return loss == 0 && d.LossUnits == nil && d.PeakEquityUnits == nil &&
			d.Percent == nil && d.BarIndex == nil &&
			d.UndefinedReason == backtest.FundedZeroInitialEquity
	}
	if loss < 0 || loss > peak || peak > fundedCLIMaxEquity ||
		d.UndefinedReason != "" || d.LossUnits == nil ||
		d.PeakEquityUnits == nil || d.Percent == nil {
		return false
	}
	n, ok := fundedCLIUnits(*d.LossUnits, false, fundedCLIMaxEquity)
	if !ok || n != loss {
		return false
	}
	denominator, ok := fundedCLIUnits(*d.PeakEquityUnits, false, fundedCLIMaxEquity)
	if !ok || denominator != peak {
		return false
	}
	if loss == 0 {
		if d.BarIndex != nil {
			return false
		}
	} else if d.BarIndex == nil || *d.BarIndex != expectedBar {
		return false
	}
	exact := new(big.Rat).SetFrac(big.NewInt(loss), big.NewInt(peak))
	exact.Mul(exact, big.NewRat(100, 1))
	expected, _ := exact.Float64()
	return causalCLIFinite(*d.Percent, 0, 100) &&
		fundedCLINear(*d.Percent, expected)
}

type fundedCLIAccount struct {
	cash, basis, realized int64
	quantity              float64
	entry                 backtest.CausalFill
	closed, wins          int
	gross, profit, loss   float64
}

func fundedCLIApplyFlow(
	a *fundedCLIAccount,
	f backtest.CausalFill,
	flow backtest.FundedCausalCashFlow,
	fillIndex, totalBars int,
) bool {
	if flow.FillIndex != fillIndex || flow.Kind != f.Kind ||
		flow.Reason != f.Reason || flow.BarIndex != f.BarIndex ||
		!flow.Timestamp.Equal(f.Timestamp) ||
		flow.EvaluationBarIndex != f.EvaluationBarIndex ||
		flow.EntrySignalBarIndex != f.EntrySignalBarIndex ||
		flow.EntryBarIndex != f.EntryBarIndex ||
		f.BarIndex < 20 || f.BarIndex >= totalBars ||
		f.EvaluationBarIndex < 19 || f.EvaluationBarIndex >= f.BarIndex ||
		f.EntrySignalBarIndex < 19 ||
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
	debit, ok := fundedCLIUnits(flow.DebitedUnits, false, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	credit, ok := fundedCLIUnits(flow.CreditedUnits, false, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	amount, ok := fundedCLIQuote(f.Price, f.Quantity)
	if !ok {
		return false
	}

	switch f.Kind {
	case backtest.CausalEntry:
		if f.Reason != backtest.CausalNextOpenBuy || a.quantity != 0 ||
			a.basis != 0 || f.EntryBarIndex != f.BarIndex ||
			f.EvaluationBarIndex != f.EntrySignalBarIndex ||
			f.GrossRealizedPnL != 0 || f.Ambiguous ||
			debit != fundedCLIEntryUnits || debit != amount ||
			credit != 0 || a.cash < debit {
			return false
		}
		a.cash -= debit
		a.basis = debit
		a.quantity = f.Quantity
		a.entry = f
	case backtest.CausalExit:
		switch f.Reason {
		case backtest.CausalNextOpenSell, backtest.CausalStopGap,
			backtest.CausalTargetGap, backtest.CausalStopTouch,
			backtest.CausalTargetTouch:
		default:
			return false
		}
		if a.quantity == 0 || f.Quantity != a.quantity ||
			f.EntryBarIndex != a.entry.BarIndex ||
			f.EntrySignalBarIndex != a.entry.EntrySignalBarIndex ||
			a.basis != fundedCLIEntryUnits || debit != 0 || credit != amount ||
			(f.Ambiguous && f.Reason != backtest.CausalStopTouch) ||
			!fundedCLINear(f.GrossRealizedPnL,
				(f.Price-a.entry.Price)*f.Quantity) {
			return false
		}
		a.cash += credit
		a.realized += credit - a.basis
		a.basis, a.quantity = 0, 0
		a.closed++
		a.gross += f.GrossRealizedPnL
		if f.GrossRealizedPnL > 0 {
			a.wins++
			a.profit += f.GrossRealizedPnL
		} else {
			a.loss -= f.GrossRealizedPnL
		}
	default:
		return false
	}
	if a.cash < 0 || a.cash > fundedCLIMaxUnits {
		return false
	}
	cash, ok := fundedCLIUnits(flow.ModelCashUnits, false, fundedCLIMaxUnits)
	if !ok || cash != a.cash {
		return false
	}
	basis, ok := fundedCLIUnits(flow.PositionCostUnits, false, fundedCLIMaxUnits)
	if !ok || basis != a.basis {
		return false
	}
	realized, ok := fundedCLIUnits(flow.RealizedPnLUnits, true, fundedCLIMaxEquity)
	return ok && realized == a.realized
}

func fundedCLISignalValid(s backtest.CausalSignal, r backtest.CausalResult) bool {
	if s.Name != r.TargetName || s.Symbol != r.Symbol ||
		!fundedCLITime(s.Timestamp) || s.AssetClass != strategies.AssetEquity ||
		!causalCLIFinite(s.Score, 0, 100) ||
		!causalCLIFinite(s.StopLossPct, 0, 1000000) ||
		!causalCLIFinite(s.TargetPct, 0, 1000000) {
		return false
	}
	switch s.Signal {
	case strategies.SignalBuy, strategies.SignalSell, strategies.SignalHold:
		return true
	default:
		return false
	}
}

// Validate only an internally computed standalone result's formatting
// consistency. This function does not authenticate imported records, sources,
// clocks, callbacks, broker activity or strategy qualification.
func fundedCLIResultValid(r backtest.FundedCausalResult) bool {
	replay := r.Replay
	if r.ModelIdentity != backtest.FundedCausalModelIdentity ||
		r.CostIdentity != backtest.FundedCausalCostIdentity ||
		r.DataLabel != backtest.CausalOfflineLabel ||
		r.AuthorityLabel != backtest.CausalOfflineLabel ||
		r.Scale != backtest.FundedCausalScale ||
		replay.ModelIdentity != backtest.FundedCausalModelIdentity ||
		replay.CostIdentity != backtest.FundedCausalCostIdentity ||
		replay.DataLabel != backtest.CausalOfflineLabel ||
		replay.AuthorityLabel != backtest.CausalOfflineLabel ||
		replay.TargetName != "BreakoutVol" ||
		len(replay.Symbol) == 0 || len(replay.Symbol) > 256 {
		return false
	}

	// Reuse the immutable A summary's bounded gross/terminal numeric checks
	// on a value copy. The original funded nested identities remain intact,
	// and feeding the original funded replay to the A summary must fail.
	diagnostic := replay
	diagnostic.ModelIdentity = backtest.CausalModelIdentity
	diagnostic.CostIdentity = backtest.CausalCostIdentity
	if _, ok := backtestCausalSummary(diagnostic); !ok {
		return false
	}
	total := replay.TotalBars
	expectedEvaluations := total - 19
	if expectedEvaluations < 0 {
		expectedEvaluations = 0
	}
	if len(replay.Evaluations) != expectedEvaluations ||
		len(r.CloseMarks) != total ||
		len(r.CashFlows) != len(replay.Fills) ||
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
		pending = last.Signal == strategies.SignalBuy ||
			last.Signal == strategies.SignalSell
	}
	if replay.PendingSignalUnfilled != pending {
		return false
	}

	account := fundedCLIAccount{cash: initial}
	peak, maxLoss, maxPeak, maxBar := initial, int64(0), int64(0), -1
	fillIndex, rejectedIndex := 0, 0
	var previousTime time.Time
	for index, mark := range r.CloseMarks {
		if mark.BarIndex != index || !fundedCLITime(mark.Timestamp) ||
			(index > 0 && !mark.Timestamp.After(previousTime)) {
			return false
		}
		previousTime = mark.Timestamp
		if index >= 19 &&
			!replay.Evaluations[index-19].Timestamp.Equal(mark.Timestamp) {
			return false
		}
		startFill := fillIndex
		for fillIndex < len(replay.Fills) &&
			replay.Fills[fillIndex].BarIndex == index {
			fill := replay.Fills[fillIndex]
			if !fill.Timestamp.Equal(mark.Timestamp) ||
				!fundedCLIApplyFlow(&account, fill, r.CashFlows[fillIndex],
					fillIndex, total) {
				return false
			}
			fillIndex++
		}
		if fillIndex < len(replay.Fills) &&
			replay.Fills[fillIndex].BarIndex < index {
			return false
		}
		if fillIndex-startFill > 2 {
			return false
		}

		cash, valid := fundedCLIUnits(mark.ModelCashUnits, false, fundedCLIMaxUnits)
		if !valid || cash != account.cash {
			return false
		}
		basis, valid := fundedCLIUnits(mark.PositionCostUnits, false, fundedCLIMaxUnits)
		if !valid || basis != account.basis ||
			!causalCLIFinite(mark.ModelQuantity, 0, 1000) ||
			mark.ModelQuantity != account.quantity {
			return false
		}
		value, valid := fundedCLIUnits(mark.PositionValueUnits, false, fundedCLIMaxUnits)
		if !valid || (account.quantity == 0 && value != 0) {
			return false
		}
		equity, valid := fundedCLIUnits(mark.EquityUnits, false, fundedCLIMaxEquity)
		if !valid || equity != cash+value {
			return false
		}
		realized, valid := fundedCLIUnits(mark.RealizedPnLUnits, true, fundedCLIMaxEquity)
		if !valid || realized != account.realized ||
			cash != initial+realized-basis {
			return false
		}
		unrealized, valid := fundedCLIUnits(mark.UnrealizedPnLUnits, true, fundedCLIMaxEquity)
		if !valid || unrealized != value-basis ||
			equity != initial+realized+unrealized {
			return false
		}
		if equity > peak {
			peak = equity
		}
		storedPeak, valid := fundedCLIUnits(mark.PeakEquityUnits, false, fundedCLIMaxEquity)
		loss := peak - equity
		if !valid || storedPeak != peak ||
			!fundedCLIDrawdownValid(mark.CloseMarkDrawdown, loss, peak, index) {
			return false
		}
		if loss > 0 && (maxLoss == 0 ||
			fundedCLIRatioGreater(loss, peak, maxLoss, maxPeak)) {
			maxLoss, maxPeak, maxBar = loss, peak, index
		}

		if rejectedIndex < len(r.RejectedEntries) &&
			r.RejectedEntries[rejectedIndex].BarIndex == index {
			rejected := r.RejectedEntries[rejectedIndex]
			available, availableOK := fundedCLIUnits(
				rejected.AvailableModelCashUnits, false, fundedCLIMaxUnits)
			required, requiredOK := fundedCLIUnits(
				rejected.RequiredModelCashUnits, false, fundedCLIMaxUnits)
			if index < 20 || rejected.Reason != backtest.FundedInsufficientModelCash ||
				!rejected.Timestamp.Equal(mark.Timestamp) ||
				rejected.EvaluationBarIndex != index-1 ||
				!rejected.EvaluationTimestamp.Equal(replay.Evaluations[index-20].Timestamp) ||
				replay.Evaluations[index-20].Signal != strategies.SignalBuy ||
				!availableOK || !requiredOK || available != cash ||
				required != fundedCLIEntryUnits || available >= required ||
				account.quantity != 0 || startFill != fillIndex {
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

	last := r.CloseMarks[len(r.CloseMarks)-1]
	if r.FinalModelCashUnits != last.ModelCashUnits ||
		r.FinalModelQuantity != last.ModelQuantity ||
		r.FinalPositionCostUnits != last.PositionCostUnits ||
		r.FinalPositionValueUnits != last.PositionValueUnits ||
		r.FinalEquityUnits != last.EquityUnits ||
		r.RealizedAccountingPnLUnits != last.RealizedPnLUnits ||
		r.UnrealizedAccountingPnLUnits != last.UnrealizedPnLUnits ||
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
		!p.EntryTimestamp.Equal(account.entry.Timestamp) ||
		!p.EntrySignalTimestamp.Equal(replay.Evaluations[p.EntrySignalBarIndex-19].Timestamp) ||
		p.LastBarIndex != total-1 || !p.LastTimestamp.Equal(last.Timestamp) ||
		!causalCLIFinite(p.PeakPrice, p.EntryPrice, 11000000) ||
		p.PeakPrice < p.LastClosePrice ||
		p.StopEvaluationBarIndex < -1 || p.StopEvaluationBarIndex >= total ||
		p.TargetEvaluationBarIndex < -1 || p.TargetEvaluationBarIndex >= total ||
		!fundedCLINear(p.GrossUnrealizedPnL,
			(p.LastClosePrice-p.EntryPrice)*p.Quantity) {
		return false
	}
	value, valid := fundedCLIQuote(p.LastClosePrice, p.Quantity)
	return valid && strconv.FormatInt(value, 10) == last.PositionValueUnits
}

func backtestCausalFundedSummary(r backtest.FundedCausalResult) (string, bool) {
	if !fundedCLIResultValid(r) {
		return "", false
	}
	replay := r.Replay
	var out strings.Builder
	out.WriteString("GELT FUNDED CAUSAL CSV REPLAY SUMMARY\n")
	fmt.Fprintf(&out, "Model: %s\nCost: %s\nData: %s\nAuthority: %s\n",
		backtest.FundedCausalModelIdentity, backtest.FundedCausalCostIdentity,
		backtest.CausalOfflineLabel, backtest.CausalOfflineLabel)
	out.WriteString("Accounting: Scale 8 engineering modelUSD resolution (10^-8); exact8 decimal display.\n")
	out.WriteString("Costs: frictionless; no fees or slippage.\n")
	out.WriteString("Scope: offline model; no real cash, holdings, execution or qualification.\n")
	out.WriteString("Fills: close signal / next open; no forced terminal liquidation.\n")
	out.WriteString("Float gross diagnostics are separate from fixed8 accounting PnL.\n")
	fmt.Fprintf(&out, "Bars: %d\nEvaluations: %d\nModel fills: %d\n",
		replay.TotalBars, len(replay.Evaluations), len(replay.Fills))
	fmt.Fprintf(&out, "Closed trades: %d\nWinning closed trades: %d\nRejected entries: %d\n",
		replay.ClosedTradeCount, replay.WinningClosedTradeCount, len(r.RejectedEntries))
	fmt.Fprintf(&out, "Initial model cash: %s\nInitial model equity: %s\n",
		fundedCLIDecimal(r.InitialModelCashUnits), fundedCLIDecimal(r.InitialEquityUnits))
	fmt.Fprintf(&out, "Final model cash: %s\nFinal modeled quantity: %.12e\n",
		fundedCLIDecimal(r.FinalModelCashUnits), r.FinalModelQuantity)
	fmt.Fprintf(&out, "Final position cost basis: %s\nFinal position value: %s\nFinal model equity: %s\n",
		fundedCLIDecimal(r.FinalPositionCostUnits),
		fundedCLIDecimal(r.FinalPositionValueUnits), fundedCLIDecimal(r.FinalEquityUnits))
	fmt.Fprintf(&out, "Realized accounting PnL: %s\nUnrealized accounting PnL: %s\n",
		fundedCLIDecimal(r.RealizedAccountingPnLUnits),
		fundedCLIDecimal(r.UnrealizedAccountingPnLUnits))
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
	out.WriteString("Drawdown uses close marks and declared initial equity; no intrabar peak metric.\n")
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
		out.WriteString("Final model cash excludes open-position proceeds; equity includes the close mark.\n")
	} else {
		out.WriteString("Final open model position: none\n")
	}
	fmt.Fprintf(&out, "Final directional signal pending: %t\n", replay.PendingSignalUnfilled)
	out.WriteString("Pending means no successor bar; may be a no-op, not an actual unfilled order.\n")
	if out.Len() > fundedCLISummaryMaxBytes {
		return "", false
	}
	return out.String(), true
}
