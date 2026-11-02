package backtest

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"gelt/pkg/plans"
	"gelt/pkg/strategies"
)

// These tests reuse only the explicitly supplied immutable A fixture helpers.
func fundedRun(t *testing.T, engine *Engine, bars []OHLCV, cash string) FundedCausalResult {
	t.Helper()
	result, err := engine.RunFundedCausal(context.Background(), "TEST", bars, cash)
	if err != nil {
		t.Fatalf("unexpected funded failure: %v", err)
	}
	if result.ModelIdentity != "gelt.legacy-go.funded-close-next-open.v1" ||
		result.CostIdentity != "frictionless_funded_fixed8_diagnostic" ||
		result.DataLabel != "unqualified_offline" ||
		result.AuthorityLabel != "unqualified_offline" || result.Scale != 8 ||
		result.Replay.ModelIdentity != result.ModelIdentity ||
		result.Replay.CostIdentity != result.CostIdentity ||
		result.Replay.DataLabel != result.DataLabel ||
		result.Replay.AuthorityLabel != result.AuthorityLabel {
		t.Fatalf("incorrect funded identities: %+v", result)
	}
	fundedCheckIdentities(t, result, bars)
	return result
}

func fundedWantFailure(
	t *testing.T, result FundedCausalResult, err error, code CausalErrorCode, index int,
) {
	t.Helper()
	if !reflect.DeepEqual(result, FundedCausalResult{}) {
		t.Fatalf("fatal failure returned partial account: %+v", result)
	}
	var bounded *FundedCausalError
	if !errors.As(err, &bounded) || bounded.Code != code || bounded.BarIndex != index {
		t.Fatalf("wanted %s at %d, got %T %v", code, index, err, err)
	}
	if bounded.BarIndex < -1 || bounded.BarIndex >= CausalMaxBars ||
		len(err.Error()) > 80 || strings.Contains(err.Error(), "SECRET") {
		t.Fatalf("unbounded or unsanitized failure: %v", err)
	}
}

func fundedReadUnits(t *testing.T, token string) int64 {
	t.Helper()
	value, err := strconv.ParseInt(token, 10, 64)
	if err != nil || strconv.FormatInt(value, 10) != token {
		t.Fatalf("noncanonical unit output %q", token)
	}
	return value
}

func fundedWantUnits(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("units got %s, want %s", got, want)
	}
}

func fundedWantDD(t *testing.T, got FundedCausalDrawdown, loss, peak string, bar int, percent float64) {
	t.Helper()
	if got.UndefinedReason != "" || got.LossUnits == nil || got.PeakEquityUnits == nil ||
		got.Percent == nil || *got.LossUnits != loss || *got.PeakEquityUnits != peak ||
		math.IsNaN(*got.Percent) || math.IsInf(*got.Percent, 0) ||
		math.Abs(*got.Percent-percent) > 1e-10+1e-12*math.Abs(percent) {
		t.Fatalf("incorrect exact drawdown: %+v", got)
	}
	if bar == -1 {
		if got.BarIndex != nil {
			t.Fatalf("zero drawdown has a maximum bar: %+v", got)
		}
	} else if got.BarIndex == nil || *got.BarIndex != bar {
		t.Fatalf("drawdown bar got %+v, want %d", got.BarIndex, bar)
	}
}

// This checker uses only integer identities on emitted facts. It does not call
// the implementation's parser, quote converter, arithmetic or drawdown helpers.
func fundedCheckIdentities(t *testing.T, result FundedCausalResult, bars []OHLCV) {
	t.Helper()
	initial := fundedReadUnits(t, result.InitialModelCashUnits)
	if result.InitialEquityUnits != result.InitialModelCashUnits ||
		len(result.CloseMarks) != len(bars) || result.Replay.TotalBars != len(bars) ||
		len(result.CashFlows) != len(result.Replay.Fills) ||
		len(result.CloseMarks) > 10000 || len(result.RejectedEntries) > 10000 ||
		len(result.CashFlows) > 20000 {
		t.Fatal("incorrect record count or initial identity")
	}
	cash, basis, realized := initial, int64(0), int64(0)
	flowIndex := 0
	for i, mark := range result.CloseMarks {
		for flowIndex < len(result.CashFlows) && result.CashFlows[flowIndex].BarIndex == i {
			flow := result.CashFlows[flowIndex]
			fill := result.Replay.Fills[flowIndex]
			if flow.FillIndex != flowIndex || flow.Kind != fill.Kind ||
				flow.Reason != fill.Reason || flow.BarIndex != fill.BarIndex ||
				!flow.Timestamp.Equal(fill.Timestamp) ||
				flow.EvaluationBarIndex != fill.EvaluationBarIndex ||
				flow.EntrySignalBarIndex != fill.EntrySignalBarIndex ||
				flow.EntryBarIndex != fill.EntryBarIndex {
				t.Fatal("cash flow lost actual-fill lineage")
			}
			debit := fundedReadUnits(t, flow.DebitedUnits)
			credit := fundedReadUnits(t, flow.CreditedUnits)
			switch fill.Kind {
			case CausalEntry:
				if debit != 1000000000 || credit != 0 || basis != 0 {
					t.Fatal("entry amount or position overlap")
				}
				basis = debit
			case CausalExit:
				if debit != 0 || credit < 0 || basis != 1000000000 {
					t.Fatal("exit without retained entry basis")
				}
				realized += credit - basis
				basis = 0
			default:
				t.Fatal("unexpected flow kind")
			}
			cash += credit - debit
			if cash < 0 || cash > 100000000000000 ||
				fundedReadUnits(t, flow.ModelCashUnits) != cash ||
				fundedReadUnits(t, flow.PositionCostUnits) != basis ||
				fundedReadUnits(t, flow.RealizedPnLUnits) != realized {
				t.Fatal("cash flow identity failed")
			}
			flowIndex++
		}
		value := fundedReadUnits(t, mark.PositionValueUnits)
		equity := fundedReadUnits(t, mark.EquityUnits)
		unrealized := fundedReadUnits(t, mark.UnrealizedPnLUnits)
		if mark.BarIndex != i || !mark.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0)) ||
			mark.Timestamp.Location() != time.UTC ||
			fundedReadUnits(t, mark.ModelCashUnits) != cash ||
			fundedReadUnits(t, mark.PositionCostUnits) != basis ||
			fundedReadUnits(t, mark.RealizedPnLUnits) != realized ||
			unrealized != value-basis || equity != cash+value ||
			equity != initial+realized+unrealized ||
			value < 0 || value > 100000000000000 ||
			equity < 0 || equity > 200000000000000 {
			t.Fatalf("close accounting identity failed at %d: %+v", i, mark)
		}
		if basis == 0 && (mark.ModelQuantity != 0 || value != 0) ||
			basis != 0 && mark.ModelQuantity <= 0 {
			t.Fatal("position/quantity identity failed")
		}
	}
	if flowIndex != len(result.CashFlows) {
		t.Fatal("unconsumed cash flows")
	}
	last := result.CloseMarks[len(result.CloseMarks)-1]
	if result.FinalModelCashUnits != last.ModelCashUnits ||
		result.FinalModelQuantity != last.ModelQuantity ||
		result.FinalPositionCostUnits != last.PositionCostUnits ||
		result.FinalPositionValueUnits != last.PositionValueUnits ||
		result.FinalEquityUnits != last.EquityUnits ||
		result.RealizedAccountingPnLUnits != last.RealizedPnLUnits ||
		result.UnrealizedAccountingPnLUnits != last.UnrealizedPnLUnits ||
		result.PeakCloseEquityUnits != last.PeakEquityUnits {
		t.Fatal("terminal accounting differs from final real close mark")
	}
	for _, rejection := range result.RejectedEntries {
		i := rejection.BarIndex
		if i < 20 || i >= len(bars) || rejection.EvaluationBarIndex != i-1 ||
			rejection.Reason != "insufficient_model_cash" ||
			rejection.RequiredModelCashUnits != "1000000000" ||
			!rejection.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0)) ||
			!rejection.EvaluationTimestamp.Equal(time.Unix(bars[i-1].Timestamp, 0)) ||
			fundedReadUnits(t, rejection.AvailableModelCashUnits) >= 1000000000 {
			t.Fatal("invalid rejection lineage or amount")
		}
	}
}

func TestFundedIndependentOpenLossRecoveryOracle(t *testing.T) {
	bars := causalBars(23)
	causalSetBar(bars, 20, 100, 100, 50, 50)
	causalSetBar(bars, 21, 50, 110, 50, 110)
	causalSetBar(bars, 22, 110, 110, 110, 110)
	s := causalScript(func(i int) strategies.SignalType {
		switch i {
		case 19:
			return strategies.SignalBuy
		case 21:
			return strategies.SignalSell
		default:
			return strategies.SignalHold
		}
	}, 0, 0)
	result := fundedRun(t, NewStrategyEngine(s), bars, "100")
	if len(s.calls) != 4 || len(result.Replay.Fills) != 2 ||
		result.Replay.Fills[0].Price != 100 || result.Replay.Fills[1].Price != 110 ||
		result.Replay.TerminalPosition != nil || result.Replay.ClosedTradeCount != 1 {
		t.Fatal("incorrect hand-oracle event path")
	}
	causalOracle(t, result.Replay.Fills[0].Quantity, "1/10", "quantity")
	mark := result.CloseMarks[20]
	fundedWantUnits(t, mark.ModelCashUnits, "9000000000")
	fundedWantUnits(t, mark.PositionCostUnits, "1000000000")
	fundedWantUnits(t, mark.PositionValueUnits, "500000000")
	fundedWantUnits(t, mark.EquityUnits, "9500000000")
	fundedWantUnits(t, mark.RealizedPnLUnits, "0")
	fundedWantUnits(t, mark.UnrealizedPnLUnits, "-500000000")
	fundedWantUnits(t, result.CashFlows[1].CreditedUnits, "1100000000")
	fundedWantUnits(t, result.FinalModelCashUnits, "10100000000")
	fundedWantUnits(t, result.FinalEquityUnits, "10100000000")
	fundedWantUnits(t, result.RealizedAccountingPnLUnits, "100000000")
	fundedWantUnits(t, result.UnrealizedAccountingPnLUnits, "0")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "500000000", "10000000000", 20, 5)
	fundedWantDD(t, mark.CloseMarkDrawdown, "500000000", "10000000000", 20, 5)
	causalOracle(t, result.Replay.GrossRealizedPnL, "1", "money")
}

func TestFundedLossThenRejectionContinuesWithoutProtectionOrReplay(t *testing.T) {
	bars := causalBars(26)
	for i := 21; i < len(bars); i++ {
		causalSetBar(bars, i, 90, 90, 90, 90)
	}
	s := causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		switch len(closes) - 1 {
		case 19:
			out.Signal = strategies.SignalBuy
		case 20, 23:
			out.Signal = strategies.SignalSell
		case 21, 24:
			out.Signal, out.StopLossPct, out.TargetPct = strategies.SignalBuy, 5, 20
		}
		// Close 22 turns both fields off. No position exists: the BUY at
		// close 21 was rejected at open 22, so no transition may fail.
		return out, nil
	}
	result := fundedRun(t, NewStrategyEngine(s), bars, "10")
	if len(s.calls) != 7 || len(result.Replay.Evaluations) != 7 ||
		len(result.Replay.Fills) != 2 || len(result.RejectedEntries) != 2 ||
		result.Replay.TerminalPosition != nil || result.Replay.PendingSignalUnfilled {
		t.Fatalf("binding funding changed callback/no-op path: %+v", result)
	}
	if result.RejectedEntries[0].BarIndex != 22 || result.RejectedEntries[1].BarIndex != 25 {
		t.Fatal("rejection attempts were replayed or restored")
	}
	for _, rejection := range result.RejectedEntries {
		fundedWantUnits(t, rejection.AvailableModelCashUnits, "900000000")
	}
	for i := 21; i < len(bars); i++ {
		if result.CloseMarks[i].ModelQuantity != 0 {
			t.Fatal("rejected entry created a position")
		}
		fundedWantUnits(t, result.CloseMarks[i].PositionCostUnits, "0")
	}
	fundedWantUnits(t, result.FinalModelCashUnits, "900000000")
	fundedWantUnits(t, result.RealizedAccountingPnLUnits, "-100000000")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "100000000", "1000000000", 21, 10)
}

func TestFundedCashBoundariesAndRepeatedAttempts(t *testing.T) {
	for _, tc := range []struct {
		cash, initial  string
		fills, rejects int
		undefined      bool
	}{
		{"0", "0", 0, 3, true},
		{"0.00000001", "1", 0, 3, false},
		{"9.99999999", "999999999", 0, 3, false},
		{"10", "1000000000", 1, 0, false},
		{"10.00000000", "1000000000", 1, 0, false},
		{"1000000.00000000", "100000000000000", 1, 0, false},
	} {
		t.Run(tc.cash, func(t *testing.T) {
			s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 0, 0)
			result := fundedRun(t, NewStrategyEngine(s), causalBars(23), tc.cash)
			fundedWantUnits(t, result.InitialModelCashUnits, tc.initial)
			if len(result.Replay.Fills) != tc.fills || len(result.RejectedEntries) != tc.rejects ||
				len(s.calls) != 4 || !result.Replay.PendingSignalUnfilled {
				t.Fatal("incorrect exact funding boundary/no-op behavior")
			}
			fundedWantUnits(t, result.FinalEquityUnits, tc.initial)
			dd := result.MaxCloseMarkDrawdown
			if tc.undefined {
				if dd.LossUnits != nil || dd.PeakEquityUnits != nil || dd.Percent != nil ||
					dd.BarIndex != nil || dd.UndefinedReason != "zero_initial_model_equity" {
					t.Fatal("zero-capital drawdown presented as defined")
				}
				for _, mark := range result.CloseMarks {
					if mark.CloseMarkDrawdown.Percent != nil ||
						mark.CloseMarkDrawdown.UndefinedReason != "zero_initial_model_equity" {
						t.Fatal("zero-capital mark has favorable defined ratio")
					}
				}
			} else {
				fundedWantDD(t, dd, "0", tc.initial, -1, 0)
			}
		})
	}
}

func TestFundedCashGrammar(t *testing.T) {
	for _, token := range []string{
		"", " ", " 10", "10 ", "+10", "-0", "-1", ".1", "1.", "01", "00.1",
		"1e1", "1E1", "1_0", "1,0", "NaN", "Inf", "１０", "0\n",
		"1.000000001", "1000000.00000001", "1000001",
		"12345678901234567890123456789012345", "SECRET",
	} {
		t.Run(token, func(t *testing.T) {
			s := causalNewStrategy()
			result, err := NewStrategyEngine(s).RunFundedCausal(nil, "TEST", causalBars(21), token)
			fundedWantFailure(t, result, err, FundedInvalidModelCash, -1)
			if len(s.calls) != 0 {
				t.Fatal("invalid capital reached evaluator")
			}
		})
	}
	for _, tc := range []struct{ token, units string }{
		{"0", "0"}, {"0.0", "0"}, {"1.2", "120000000"},
		{"0.00000001", "1"}, {"123.45678901", "12345678901"},
		{"1000000", "100000000000000"},
	} {
		got, ok := fundedParseCash(tc.token)
		if !ok || strconv.FormatInt(got, 10) != tc.units {
			t.Fatalf("valid exact cash rejected: %q", tc.token)
		}
	}
}

func TestFundedQuoteIndependentTiesEvenAndRange(t *testing.T) {
	for _, tc := range []struct {
		price, quantity float64
		units           int64
	}{
		{1, 1.0 / 512, 195312},
		{1, 3.0 / 512, 585938},
		{1, 5.0 / 512, 976562},
		{100, 0.1, 1000000000},
		{110, 0.1, 1100000000},
		{50, 0.1, 500000000},
		{1000000, 1, 100000000000000},
		{math.SmallestNonzeroFloat64, 1, 0},
	} {
		got, code := fundedQuoteUnits(tc.price, tc.quantity)
		if code != "" || got != tc.units {
			t.Fatalf("quote (%g,%g): got %d/%s, want %d", tc.price, tc.quantity, got, code, tc.units)
		}
	}
	for _, tc := range [][2]float64{
		{0, 1}, {-1, 1}, {1, 0}, {1, -1}, {math.NaN(), 1},
		{1, math.Inf(1)}, {1000000, math.Nextafter(1, 2)},
		{11000001, 1}, {1, 1001},
	} {
		if _, code := fundedQuoteUnits(tc[0], tc[1]); code != CausalNumericRange {
			t.Fatalf("unsupported exact source product accepted: %v", tc)
		}
	}
}

func TestFundedAllBarsWarmupAndFinalOpen(t *testing.T) {
	for _, count := range []int{1, 19, 20, 21} {
		bars := causalBars(count)
		if count == 21 {
			causalSetBar(bars, 20, 100, 100, 50, 50)
		}
		s := causalScript(causalBuyThenHold, 0, 0)
		result := fundedRun(t, NewStrategyEngine(s), bars, "100")
		want := count - 19
		if want < 0 {
			want = 0
		}
		if len(s.calls) != want || len(result.Replay.Evaluations) != want ||
			result.Replay.PendingSignalUnfilled != (count == 20) {
			t.Fatal("warmup/evaluation/pending semantics changed")
		}
		for i := 0; i < count && i < 20; i++ {
			fundedWantUnits(t, result.CloseMarks[i].ModelCashUnits, "10000000000")
			fundedWantUnits(t, result.CloseMarks[i].EquityUnits, "10000000000")
		}
		if count < 21 {
			if len(result.CashFlows) != 0 || result.Replay.TerminalPosition != nil {
				t.Fatal("warmup or final pending signal created a fill")
			}
			continue
		}
		if result.Replay.TerminalPosition == nil || result.FinalModelQuantity != 0.1 ||
			len(result.CashFlows) != 1 || result.Replay.ClosedTradeCount != 0 {
			t.Fatal("final open position was liquidated")
		}
		fundedWantUnits(t, result.FinalModelCashUnits, "9000000000")
		fundedWantUnits(t, result.FinalPositionValueUnits, "500000000")
		fundedWantUnits(t, result.FinalPositionCostUnits, "1000000000")
		fundedWantUnits(t, result.FinalEquityUnits, "9500000000")
		fundedWantUnits(t, result.RealizedAccountingPnLUnits, "0")
		fundedWantUnits(t, result.UnrealizedAccountingPnLUnits, "-500000000")
	}
}

func TestFundedProtectionHandOraclesAndFreshAEquivalence(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		open, high, low, close float64
		reason                 CausalFillReason
		price                  float64
		credit, pnl            string
		ambiguous, queueSell   bool
		source                 int
	}{
		{"stop", 100, 103, 94, 100, CausalStopTouch, 95, "950000000", "-50000000", false, false, 19},
		{"stop gap", 90, 92, 88, 90, CausalStopGap, 90, "900000000", "-100000000", false, true, 19},
		{"target", 100, 111, 96, 105, CausalTargetTouch, 110, "1100000000", "100000000", false, false, 19},
		{"target gap", 115, 116, 114, 115, CausalTargetGap, 110, "1100000000", "100000000", false, true, 19},
		{"collision", 100, 115, 90, 100, CausalStopTouch, 95, "950000000", "-50000000", true, false, 19},
		{"queued exit", 100, 115, 90, 100, CausalNextOpenSell, 100, "1000000000", "0", false, true, 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bars := causalBars(22)
			causalSetBar(bars, 21, tc.open, tc.high, tc.low, tc.close)
			factory := func() *causalTestStrategy {
				return causalScript(func(i int) strategies.SignalType {
					if i == 19 {
						return strategies.SignalBuy
					}
					if i == 20 && tc.queueSell {
						return strategies.SignalSell
					}
					return strategies.SignalHold
				}, 5, 10)
			}
			aStrategy, bStrategy := factory(), factory()
			a := causalRun(t, NewStrategyEngine(aStrategy), bars)
			b := fundedRun(t, NewStrategyEngine(bStrategy), bars, "100")
			if len(b.Replay.Fills) != 2 || b.Replay.ClosedTradeCount != 1 ||
				b.Replay.TerminalPosition != nil || len(b.RejectedEntries) != 0 {
				t.Fatal("unexpected protection trace")
			}
			exit := b.Replay.Fills[1]
			if exit.Reason != tc.reason || exit.Price != tc.price ||
				exit.Ambiguous != tc.ambiguous || exit.EvaluationBarIndex != tc.source ||
				exit.BarIndex != 21 {
				t.Fatalf("protection oracle mismatch: %+v", exit)
			}
			fundedWantUnits(t, b.CashFlows[1].CreditedUnits, tc.credit)
			fundedWantUnits(t, b.RealizedAccountingPnLUnits, tc.pnl)
			normalized := b.Replay
			normalized.ModelIdentity, normalized.CostIdentity = CausalModelIdentity, CausalCostIdentity
			if !reflect.DeepEqual(a, normalized) || !reflect.DeepEqual(aStrategy.calls, bStrategy.calls) {
				t.Fatal("nonbinding funded replay diverged from fresh exclusive A evaluator")
			}
		})
	}
}

func TestFundedSameBarEntryExitAndTrailing(t *testing.T) {
	bars := causalBars(21)
	causalSetBar(bars, 20, 100, 115, 90, 100)
	s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 5, 10)
	result := fundedRun(t, NewStrategyEngine(s), bars, "10")
	if len(result.Replay.Fills) != 2 || len(result.CashFlows) != 2 ||
		result.Replay.Fills[0].BarIndex != 20 || result.Replay.Fills[1].BarIndex != 20 ||
		result.Replay.Fills[1].Reason != CausalStopTouch ||
		!result.Replay.Fills[1].Ambiguous || result.FinalModelQuantity != 0 ||
		!result.Replay.PendingSignalUnfilled || len(s.calls) != 2 {
		t.Fatal("same-bar accounting/collision/no-reentry failure")
	}
	fundedWantUnits(t, result.FinalModelCashUnits, "950000000")
	fundedWantUnits(t, result.RealizedAccountingPnLUnits, "-50000000")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "50000000", "1000000000", 20, 5)

	bars = causalBars(22)
	causalSetBar(bars, 20, 100, 110, 96, 105)
	causalSetBar(bars, 21, 105, 106, 104, 105)
	trailing := causalScript(causalBuyThenHold, 5, 20)
	result = fundedRun(t, NewStrategyEngine(trailing), bars, "100")
	if len(result.Replay.Fills) != 2 || result.Replay.Fills[1].BarIndex != 21 ||
		result.Replay.Fills[1].Price != 104.5 ||
		result.Replay.Fills[1].EvaluationBarIndex != 20 ||
		result.Replay.Fills[1].Reason != CausalStopTouch || len(trailing.calls) != 3 {
		t.Fatal("close-known trailing level used retroactively")
	}
	fundedWantUnits(t, result.CashFlows[1].CreditedUnits, "1045000000")
	fundedWantUnits(t, result.RealizedAccountingPnLUnits, "45000000")
}

func TestFundedStopRatchetAndDisabledActivation(t *testing.T) {
	for _, activation := range []bool{false, true} {
		bars := causalBars(23)
		causalSetBar(bars, 20, 100, 110, 100, 105)
		causalSetBar(bars, 21, 106, 106, 105, 105)
		causalSetBar(bars, 22, 105, 105, 104, 105)
		s := causalNewStrategy()
		s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
			out := causalCompleteSignal(s.name, symbol, at)
			out.StopLossPct, out.TargetPct = 5, 30
			if len(closes) == 20 {
				out.Signal = strategies.SignalBuy
				if activation {
					out.StopLossPct, out.TargetPct = 0, 0
				}
			}
			if len(closes) >= 22 {
				out.StopLossPct = 20
			}
			return out, nil
		}
		result := fundedRun(t, NewStrategyEngine(s), bars, "100")
		if len(result.Replay.Fills) != 2 || result.Replay.Fills[1].Price != 104.5 ||
			result.Replay.Fills[1].BarIndex != 22 ||
			result.Replay.Fills[1].EvaluationBarIndex != 20 {
			t.Fatal("stop loosened or activation changed lineage")
		}
		if activation && (result.Replay.Fills[0].StopLoss != 0 || result.Replay.Fills[0].Target != 0) {
			t.Fatal("disabled entry protection activated before close")
		}
	}
}

func TestFundedNoOpsPendingAndNoSameBarReentry(t *testing.T) {
	flat := fundedRun(t, NewStrategyEngine(causalScript(func(int) strategies.SignalType {
		return strategies.SignalSell
	}, 0, 0)), causalBars(23), "0")
	if len(flat.RejectedEntries) != 0 || len(flat.Replay.Fills) != 0 ||
		!flat.Replay.PendingSignalUnfilled {
		t.Fatal("flat SELL became a funding rejection")
	}
	bars := causalBars(22)
	causalSetBar(bars, 21, 90, 100, 90, 100)
	result := fundedRun(t, NewStrategyEngine(causalScript(func(int) strategies.SignalType {
		return strategies.SignalBuy
	}, 5, 20)), bars, "10")
	if len(result.Replay.Fills) != 2 || result.Replay.Fills[1].Reason != CausalStopGap ||
		len(result.RejectedEntries) != 0 || result.FinalModelQuantity != 0 ||
		!result.Replay.PendingSignalUnfilled {
		t.Fatal("opening exit allowed same-bar reentry or rejection")
	}
	active := fundedRun(t, NewStrategyEngine(causalScript(func(int) strategies.SignalType {
		return strategies.SignalBuy
	}, 0, 0)), causalBars(23), "10")
	if len(active.Replay.Fills) != 1 || len(active.RejectedEntries) != 0 ||
		!active.Replay.PendingSignalUnfilled || active.Replay.TerminalPosition == nil {
		t.Fatal("active BUY no-op consumed additional cash")
	}
}

func TestFundedDrawdownFirstTiesAndExactLargeCrossProducts(t *testing.T) {
	bars := causalBars(24)
	causalSetBar(bars, 20, 100, 100, 50, 50)
	causalSetBar(bars, 21, 50, 100, 50, 100)
	causalSetBar(bars, 22, 100, 100, 50, 50)
	causalSetBar(bars, 23, 50, 100, 50, 100)
	result := fundedRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)), bars, "100")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "500000000", "10000000000", 20, 5)
	fundedWantDD(t, result.CloseMarks[22].CloseMarkDrawdown, "500000000", "10000000000", 22, 5)

	if fundedRatioGreater(100000000000000, 200000000000000, 50000000000000, 100000000000000) {
		t.Fatal("equal large ratios replaced first maximum")
	}
	if !fundedRatioGreater(100000000000001, 200000000000000, 50000000000000, 100000000000000) {
		t.Fatal("large cross-products overflowed or rounded")
	}
	fundedWantDD(t, fundedDrawdown(200000000000000, 200000000000000, 7),
		"200000000000000", "200000000000000", 7, 100)
	fundedWantDD(t, fundedDrawdown(1, 200000000000000, 3),
		"1", "200000000000000", 3, 0.0000000000005)
	zero := fundedDrawdown(0, 0, -1)
	if zero.Percent != nil || zero.LossUnits != nil || zero.PeakEquityUnits != nil ||
		zero.BarIndex != nil || zero.UndefinedReason != "zero_initial_model_equity" {
		t.Fatal("zero-peak helper divided or fabricated a ratio")
	}
	fundedWantDD(t, fundedDrawdown(0, 1, -1), "0", "1", -1, 0)
}

func TestFundedNumericFatalWholeResult(t *testing.T) {
	// A permits this position's unclosed gross diagnostic; the funded close
	// value is 1,000,001 model USD, exceeding its separate value envelope.
	bars := causalBars(21)
	causalSetBar(bars, 20, 0.01, 1000.001, 0.01, 1000.001)
	result, err := NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)).
		RunFundedCausal(nil, "TEST", bars, "10")
	fundedWantFailure(t, result, err, CausalNumericRange, 20)

	// A bounded exit credit still cannot push cash beyond its own cap.
	bars = causalBars(22)
	causalSetBar(bars, 21, 110, 110, 110, 110)
	s := causalScript(func(i int) strategies.SignalType {
		if i == 19 {
			return strategies.SignalBuy
		}
		if i == 20 {
			return strategies.SignalSell
		}
		return strategies.SignalHold
	}, 0, 0)
	result, err = NewStrategyEngine(s).RunFundedCausal(nil, "TEST", bars, "1000000")
	fundedWantFailure(t, result, err, CausalNumericRange, 21)

	// The retained A per-fill/gross bounds are still enforced as well.
	bars = causalBars(22)
	causalSetBar(bars, 20, 0.01, 0.01, 0.01, 0.01)
	causalSetBar(bars, 21, 1000000, 1000000, 1000000, 1000000)
	s = causalScript(func(i int) strategies.SignalType {
		if i == 19 {
			return strategies.SignalBuy
		}
		return strategies.SignalSell
	}, 0, 0)
	result, err = NewStrategyEngine(s).RunFundedCausal(nil, "TEST", bars, "10")
	fundedWantFailure(t, result, err, CausalNumericRange, 21)
}

func TestFundedCheckedArithmeticAndStateFailClosedBoundaries(t *testing.T) {
	for _, tc := range []struct {
		a, b     int64
		add, sub bool
	}{
		{math.MaxInt64, 1, false, true},
		{math.MinInt64, -1, false, true},
		{math.MinInt64, 1, true, false},
		{math.MaxInt64, -1, true, false},
		{0, math.MinInt64, true, false},
		{-1, math.MinInt64, false, true},
		{100000000000000, 100000000000000, true, true},
	} {
		_, add := fundedCheckedAdd(tc.a, tc.b)
		_, sub := fundedCheckedSub(tc.a, tc.b)
		if add != tc.add || sub != tc.sub {
			t.Fatalf("checked arithmetic boundary mismatch: %+v", tc)
		}
	}
	bar := causalBars(1)[0]
	state := newCausalFundedState(0)
	state.result.RejectedEntries = make([]FundedCausalRejectedEntry, CausalMaxBars)
	before := len(state.result.RejectedEntries)
	if allowed, code := state.entryGate(bar, 20, CausalEvaluation{BarIndex: 19}); allowed ||
		code != CausalResourceLimit || len(state.result.RejectedEntries) != before || state.cash != 0 {
		t.Fatal("rejection capacity mutated state or silently dropped evidence")
	}
	state = newCausalFundedState(10 * fundedUnitScale)
	state.result.CloseMarks = make([]FundedCausalCloseMark, CausalMaxBars)
	if code := state.mark(bar, CausalMaxBars, nil); code != CausalResourceLimit {
		t.Fatal("close-mark capacity was not enforced")
	}
	state = newCausalFundedState(10 * fundedUnitScale)
	state.result.CashFlows = make([]FundedCausalCashFlow, CausalMaxFills)
	if code := state.fill(CausalFill{}, CausalMaxFills); code != CausalResourceLimit {
		t.Fatal("cash-flow capacity was not enforced")
	}
	state = newCausalFundedState(10 * fundedUnitScale)
	if code := state.fill(CausalFill{Kind: CausalEntry, Price: 100, Quantity: 0.1}, 1); code != CausalNumericRange ||
		state.cash != 10*fundedUnitScale || len(state.result.CashFlows) != 0 {
		t.Fatal("bad actual-fill index committed accounting")
	}
	// A corrupted private state cannot yield a successful overflowing mark.
	state = newCausalFundedState(10 * fundedUnitScale)
	state.cash = math.MaxInt64
	if code := state.mark(bar, 0, nil); code != CausalNumericRange || len(state.result.CloseMarks) != 0 {
		t.Fatal("out-of-range cash was published")
	}
}

func TestFundedInputResourceCancellationAndEvaluatorFailures(t *testing.T) {
	invalid := causalBars(21)
	invalid[20].Close = math.NaN()
	s := causalNewStrategy()
	result, err := NewStrategyEngine(s).RunFundedCausal(nil, "TEST", invalid, "10")
	fundedWantFailure(t, result, err, CausalInvalidInput, 20)
	if len(s.calls) != 0 {
		t.Fatal("whole-input preflight did not precede evaluation")
	}
	result, err = NewStrategyEngine(causalNewStrategy()).RunFundedCausal(nil, "TEST", nil, "10")
	fundedWantFailure(t, result, err, CausalInvalidInput, -1)
	result, err = NewStrategyEngine(causalNewStrategy()).RunFundedCausal(nil, "TEST", causalBars(10001), "10")
	fundedWantFailure(t, result, err, CausalResourceLimit, -1)
	result, err = NewStrategyEngine(causalNewStrategy()).RunFundedCausal(nil, "secret", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalInvalidSymbol, -1)
	var nilEngine *Engine
	result, err = nilEngine.RunFundedCausal(nil, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalInvalidEvaluator, -1)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err = NewStrategyEngine(causalNewStrategy()).RunFundedCausal(ctx, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalCanceled, 0)

	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	s = causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		cancel()
		return causalCompleteSignal(s.name, symbol, at), errors.New("SECRET callback detail")
	}
	result, err = NewStrategyEngine(s).RunFundedCausal(ctx, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalCanceled, 19)

	s = causalNewStrategy()
	s.fn = func(_ context.Context, _ time.Time, _ string, _, _ []float64) (strategies.StrategySignal, error) {
		return strategies.StrategySignal{}, errors.New("SECRET callback detail")
	}
	result, err = NewStrategyEngine(s).RunFundedCausal(nil, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalEvaluatorError, 19)
}

func TestFundedReturnedIdentityDomainAndPrivateText(t *testing.T) {
	for _, tc := range []struct {
		name string
		code CausalErrorCode
		edit func(*strategies.StrategySignal)
	}{
		{"name", CausalEvaluatorIdentity, func(s *strategies.StrategySignal) { s.StrategyName = "SECRET" }},
		{"symbol", CausalEvaluatorIdentity, func(s *strategies.StrategySignal) { s.Symbol = "OTHER" }},
		{"time", CausalEvaluatorIdentity, func(s *strategies.StrategySignal) { s.Timestamp = s.Timestamp.Add(time.Nanosecond) }},
		{"asset", CausalEvaluatorIdentity, func(s *strategies.StrategySignal) { s.AssetClass = strategies.AssetCrypto }},
		{"signal", CausalUnsupported, func(s *strategies.StrategySignal) { s.Signal = strategies.SignalAgentReview }},
		{"prompt", CausalUnsupported, func(s *strategies.StrategySignal) { s.AgentPrompt = "SECRET" }},
		{"score", CausalNumericRange, func(s *strategies.StrategySignal) { s.Score = math.Inf(1) }},
		{"stop", CausalNumericRange, func(s *strategies.StrategySignal) { s.StopLossPct = 0.001 }},
		{"target", CausalNumericRange, func(s *strategies.StrategySignal) { s.TargetPct = math.NaN() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := causalNewStrategy()
			s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				tc.edit(&out)
				return out, nil
			}
			result, err := NewStrategyEngine(s).RunFundedCausal(nil, "TEST", causalBars(21), "0")
			fundedWantFailure(t, result, err, tc.code, 19)
		})
	}
	s := causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		s.name = "SECRET changed identity"
		return out, nil
	}
	result, err := NewStrategyEngine(s).RunFundedCausal(nil, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalEvaluatorIdentity, 19)

	s = causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at.In(time.FixedZone("fixture", 3600)))
		out.Rationale = "SECRET private rationale"
		return out, nil
	}
	result = fundedRun(t, NewStrategyEngine(s), causalBars(21), "10")
	encoded, marshalErr := json.Marshal(result)
	if marshalErr != nil || strings.Contains(string(encoded), "SECRET") {
		t.Fatal("raw callback material retained in successful funded evidence")
	}
}

func TestFundedPlanMembershipAndComponentFailures(t *testing.T) {
	for _, tc := range []struct {
		name string
		code CausalErrorCode
		edit func(*plans.PlanEvaluation)
	}{
		{"missing child", CausalPlanMembership, func(p *plans.PlanEvaluation) { p.StrategySignals = p.StrategySignals[:1] }},
		{"parent identity", CausalEvaluatorIdentity, func(p *plans.PlanEvaluation) { p.PlanName = "SECRET" }},
		{"child identity", CausalEvaluatorIdentity, func(p *plans.PlanEvaluation) { p.StrategySignals[0].Symbol = "OTHER" }},
		{"duplicate", CausalEvaluatorIdentity, func(p *plans.PlanEvaluation) { p.StrategySignals[0] = p.StrategySignals[1] }},
		{"hidden prompt", CausalUnsupported, func(p *plans.PlanEvaluation) { p.StrategySignals[0].AgentPrompt = "SECRET" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = tc.edit
			result, err := NewPlanEngine(p).RunFundedCausal(nil, "TEST", causalBars(21), "10")
			fundedWantFailure(t, result, err, tc.code, 19)
		})
	}
	p := causalNewPlan()
	p.after = func(_ *plans.PlanEvaluation) { p.members[0].Weight = 0.5 }
	result, err := NewPlanEngine(p).RunFundedCausal(nil, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalPlanMembership, 19)
	p = causalNewPlan()
	p.members = nil
	result, err = NewPlanEngine(p).RunFundedCausal(nil, "TEST", causalBars(21), "10")
	fundedWantFailure(t, result, err, CausalPlanMembership, -1)

	// Independent fresh plans retain exactly the same declared consensus path.
	aPlan, bPlan := causalNewPlan(), causalNewPlan()
	for _, plan := range []*causalTestPlan{aPlan, bPlan} {
		plan.after = func(out *plans.PlanEvaluation) {
			out.ConsensusSignal = strategies.SignalBuy
		}
	}
	a := causalRun(t, NewPlanEngine(aPlan), causalBars(22))
	b := fundedRun(t, NewPlanEngine(bPlan), causalBars(22), "100")
	normalized := b.Replay
	normalized.ModelIdentity, normalized.CostIdentity = CausalModelIdentity, CausalCostIdentity
	if !reflect.DeepEqual(a, normalized) || aPlan.calls != bPlan.calls || aPlan.calls != 3 {
		t.Fatal("funded plan recomputed consensus or replayed callbacks")
	}
}

func TestFundedEnabledProtectionZeroStillFatal(t *testing.T) {
	for _, stop := range []bool{false, true} {
		s := causalNewStrategy()
		s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
			out := causalCompleteSignal(s.name, symbol, at)
			if len(closes) == 20 {
				out.Signal = strategies.SignalBuy
				if stop {
					out.StopLossPct = 5
				} else {
					out.TargetPct = 20
				}
			}
			return out, nil
		}
		result, err := NewStrategyEngine(s).RunFundedCausal(nil, "TEST", causalBars(21), "10")
		fundedWantFailure(t, result, err, CausalUnsupported, 20)
	}
}

func TestFundedFreshPrefixesAndOwnedBars(t *testing.T) {
	bars := causalBars(22)
	original := append([]OHLCV(nil), bars...)
	s := causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
		for _, close := range closes {
			if close != 100 {
				t.Fatal("previous callback mutation entered a later close prefix")
			}
		}
		for _, volume := range volumes {
			if volume != 1000 {
				t.Fatal("previous callback mutation entered a later volume prefix")
			}
		}
		out := causalCompleteSignal(s.name, symbol, at)
		closes[0], volumes[0] = -1, -1
		return out, nil
	}
	result := fundedRun(t, NewStrategyEngine(s), bars, "10")
	if !reflect.DeepEqual(bars, original) || len(s.calls) != 3 || len(result.Replay.Fills) != 0 {
		t.Fatal("funded accounting changed input ownership or evaluation count")
	}
}

func TestFundedMaximumBarsAndNoSilentRejectionDrop(t *testing.T) {
	bars := causalBars(CausalMaxBars)
	s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 0, 0)
	result := fundedRun(t, NewStrategyEngine(s), bars, "0")
	if len(result.CloseMarks) != 10000 || len(result.Replay.Evaluations) != 9981 ||
		len(s.calls) != 9981 || len(result.RejectedEntries) != 9980 ||
		len(result.CashFlows) != 0 || len(result.Replay.Fills) != 0 ||
		!result.Replay.PendingSignalUnfilled {
		t.Fatal("bounded replay silently skipped marks, callbacks or funding attempts")
	}
}
