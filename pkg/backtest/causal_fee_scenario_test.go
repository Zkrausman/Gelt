package backtest

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"gelt/pkg/plans"
	"gelt/pkg/strategies"
)

// Only explicitly supplied immutable A/B1 fixture helpers are reused.
// The fixed numerical oracles below are not obtained from production helpers.
func feeScenarioUnits(t *testing.T, token string) int64 {
	t.Helper()
	v, err := strconv.ParseInt(token, 10, 64)
	if err != nil || strconv.FormatInt(v, 10) != token {
		t.Fatalf("noncanonical units %q", token)
	}
	return v
}

func feeScenarioWantUnits(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("units got %s, want %s", got, want)
	}
}

func feeScenarioWantFailure(
	t *testing.T, result FeeScenarioCausalResult, err error, code CausalErrorCode, index int,
) {
	t.Helper()
	if !reflect.DeepEqual(result, FeeScenarioCausalResult{}) {
		t.Fatal("fatal failure returned partial evidence")
	}
	var bounded *FeeScenarioCausalError
	if !errors.As(err, &bounded) || bounded.Code != code || bounded.BarIndex != index {
		t.Fatalf("wanted %s at %d; got %T %v", code, index, err, err)
	}
	if index < -1 || index >= 10000 || len(err.Error()) > 80 ||
		strings.Contains(err.Error(), "SECRET") {
		t.Fatal("unbounded or unsanitized error")
	}
}

func feeScenarioRoundTripSignal(index int) strategies.SignalType {
	switch index {
	case 19:
		return strategies.SignalBuy
	case 20:
		return strategies.SignalSell
	default:
		return strategies.SignalHold
	}
}

func feeScenarioRun(
	t *testing.T, engine *Engine, bars []OHLCV, cash string, scenario FeeScenario,
) FeeScenarioCausalResult {
	t.Helper()
	result, err := engine.RunFeeScenarioCausal(context.Background(), "TEST", bars, cash, scenario)
	if err != nil {
		t.Fatalf("unexpected fee scenario failure: %v", err)
	}
	if result.ModelIdentity != "gelt.legacy-go.fee-scenario-close-next-open.v1" ||
		result.CostIdentity != "declared_fixed8_per_side_fee_scenario" ||
		result.DataLabel != "unqualified_offline" ||
		result.AuthorityLabel != "unqualified_offline" || result.Scale != 8 ||
		result.Replay.ModelIdentity != result.ModelIdentity ||
		result.Replay.CostIdentity != result.CostIdentity ||
		result.Replay.DataLabel != result.DataLabel ||
		result.Replay.AuthorityLabel != result.AuthorityLabel ||
		result.Scenario.ScenarioBasis != "uncalibrated_declared" ||
		result.Scenario.Application != "per_filled_side" ||
		result.Scenario.FeeBasis != "quantized_gross_notional" ||
		result.Scenario.RateDenominator != "10000" {
		t.Fatal("incorrect fee scenario identities")
	}
	feeScenarioCheck(t, result, bars)
	return result
}

// This checker reconstructs integer accounting from emitted fill-linked facts.
// It does not call the production parser, quote, fee, sizing or DD helpers.
func feeScenarioCheck(t *testing.T, result FeeScenarioCausalResult, bars []OHLCV) {
	t.Helper()
	initial := feeScenarioUnits(t, result.InitialModelCashUnits)
	fixed := feeScenarioUnits(t, result.Scenario.FixedFeeUnits)
	bps := feeScenarioUnits(t, result.Scenario.FeeBps)
	if result.InitialEquityUnits != result.InitialModelCashUnits ||
		len(result.CloseMarks) != len(bars) || result.Replay.TotalBars != len(bars) ||
		len(result.CashFlows) != len(result.Replay.Fills) ||
		len(result.CloseMarks) > 10000 || len(result.RejectedEntries) > 10000 ||
		len(result.CashFlows) > 20000 {
		t.Fatal("record or initial identity mismatch")
	}
	cash, principal, entryFee, basis := initial, int64(0), int64(0), int64(0)
	grossClosed, netClosed, closedFees, fees := int64(0), int64(0), int64(0), int64(0)
	quantity := 0.0
	flowIndex := 0
	peak, maxLoss, maxPeak, maxBar := initial, int64(0), int64(0), -1
	checkDD := func(got FundedCausalDrawdown, loss, denominator int64, index int) {
		t.Helper()
		if denominator == 0 {
			if got.UndefinedReason != "zero_initial_model_equity" ||
				got.LossUnits != nil || got.PeakEquityUnits != nil ||
				got.Percent != nil || got.BarIndex != nil {
				t.Fatal("invalid null drawdown")
			}
			return
		}
		if got.UndefinedReason != "" || got.LossUnits == nil ||
			got.PeakEquityUnits == nil || got.Percent == nil ||
			feeScenarioUnits(t, *got.LossUnits) != loss ||
			feeScenarioUnits(t, *got.PeakEquityUnits) != denominator {
			t.Fatal("incorrect exact drawdown pair")
		}
		want := 100 * float64(loss) / float64(denominator)
		if math.IsNaN(*got.Percent) || math.IsInf(*got.Percent, 0) ||
			math.Abs(*got.Percent-want) > 1e-10+1e-12*math.Abs(want) {
			t.Fatal("incorrect drawdown percentage")
		}
		if loss == 0 {
			if got.BarIndex != nil {
				t.Fatal("zero drawdown has a maximum bar")
			}
		} else if got.BarIndex == nil || *got.BarIndex != index {
			t.Fatal("incorrect first maximum drawdown bar")
		}
	}
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
				t.Fatal("actual-fill linkage mismatch")
			}
			gross := feeScenarioUnits(t, flow.GrossNotionalUnits)
			fee := feeScenarioUnits(t, flow.FeeUnits)
			if gross < 0 || gross > 100000000000000 {
				t.Fatal("gross range")
			}
			product := new(big.Int).Mul(big.NewInt(gross), big.NewInt(bps))
			proportional, remainder := new(big.Int), new(big.Int)
			proportional.QuoRem(product, big.NewInt(10000), remainder)
			if remainder.Sign() != 0 {
				proportional.Add(proportional, big.NewInt(1))
			}
			proportional.Add(proportional, big.NewInt(fixed))
			if !proportional.IsInt64() || proportional.Int64() != fee {
				t.Fatal("per-filled-side fee identity")
			}
			debit := feeScenarioUnits(t, flow.DebitedUnits)
			credit := feeScenarioUnits(t, flow.CreditedUnits)
			delta := feeScenarioUnits(t, flow.NetCashDeltaUnits)
			if debit < 0 || credit < 0 || debit != 0 && credit != 0 || delta != credit-debit {
				t.Fatal("signed cashflow identity")
			}
			switch fill.Kind {
			case CausalEntry:
				if basis != 0 || gross <= 0 || credit != 0 ||
					debit != gross+fee || debit > 1000000000 {
					t.Fatal("entry cap or overlap")
				}
				principal, entryFee, basis, quantity = gross, fee, debit, fill.Quantity
			case CausalExit:
				if basis <= 0 || fill.Quantity != quantity || delta != gross-fee {
					t.Fatal("exit identity")
				}
				grossClosed += gross - principal
				netClosed += delta - basis
				closedFees += entryFee + fee
				principal, entryFee, basis, quantity = 0, 0, 0, 0
			default:
				t.Fatal("unknown fill kind")
			}
			fees += fee
			cash += delta
			if cash < 0 || cash > 100000000000000 ||
				fees < 0 || fees > 100000000000000 ||
				netClosed != grossClosed-closedFees ||
				fees != closedFees+entryFee ||
				feeScenarioUnits(t, flow.ModelCashUnits) != cash ||
				feeScenarioUnits(t, flow.PositionPrincipalUnits) != principal ||
				feeScenarioUnits(t, flow.PositionEntryFeeUnits) != entryFee ||
				feeScenarioUnits(t, flow.PositionTotalBasisUnits) != basis ||
				feeScenarioUnits(t, flow.GrossRealizedAccountingPnLUnits) != grossClosed ||
				feeScenarioUnits(t, flow.NetRealizedAccountingPnLUnits) != netClosed ||
				feeScenarioUnits(t, flow.ClosedAttributedFeeUnits) != closedFees ||
				feeScenarioUnits(t, flow.AggregateFeeUnits) != fees {
				t.Fatal("flow accounting mismatch")
			}
			flowIndex++
		}
		value := feeScenarioUnits(t, mark.PositionValueUnits)
		equity := feeScenarioUnits(t, mark.EquityUnits)
		grossOpen := feeScenarioUnits(t, mark.GrossUnrealizedAccountingPnLUnits)
		netOpen := feeScenarioUnits(t, mark.NetUnrealizedAccountingPnLUnits)
		if mark.BarIndex != i || !mark.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0)) ||
			mark.Timestamp.Location() != time.UTC ||
			feeScenarioUnits(t, mark.ModelCashUnits) != cash || mark.ModelQuantity != quantity ||
			feeScenarioUnits(t, mark.PositionPrincipalUnits) != principal ||
			feeScenarioUnits(t, mark.PositionEntryFeeUnits) != entryFee ||
			feeScenarioUnits(t, mark.PositionTotalBasisUnits) != basis ||
			basis != principal+entryFee || grossOpen != value-principal ||
			netOpen != value-basis || netOpen != grossOpen-entryFee ||
			feeScenarioUnits(t, mark.GrossRealizedAccountingPnLUnits) != grossClosed ||
			feeScenarioUnits(t, mark.NetRealizedAccountingPnLUnits) != netClosed ||
			feeScenarioUnits(t, mark.ClosedAttributedFeeUnits) != closedFees ||
			feeScenarioUnits(t, mark.OpenAttributedFeeUnits) != entryFee ||
			feeScenarioUnits(t, mark.AggregateFeeUnits) != fees ||
			equity != cash+value || equity != initial+netClosed+netOpen ||
			value < 0 || value > 100000000000000 ||
			equity < 0 || equity > 200000000000000 {
			t.Fatalf("mark accounting mismatch at %d", i)
		}
		if basis == 0 && (quantity != 0 || value != 0) || basis > 0 && quantity <= 0 {
			t.Fatal("mark position identity")
		}
		if equity > peak {
			peak = equity
		}
		loss := peak - equity
		if peak > 0 && loss > 0 {
			left := new(big.Int).Mul(big.NewInt(loss), big.NewInt(maxPeak))
			right := new(big.Int).Mul(big.NewInt(maxLoss), big.NewInt(peak))
			if maxLoss == 0 || left.Cmp(right) > 0 {
				maxLoss, maxPeak, maxBar = loss, peak, i
			}
		}
		if feeScenarioUnits(t, mark.PeakEquityUnits) != peak {
			t.Fatal("peak mismatch")
		}
		checkDD(mark.CloseMarkDrawdown, loss, peak, i)
	}
	if flowIndex != len(result.CashFlows) {
		t.Fatal("unconsumed cashflow")
	}
	denominator := maxPeak
	if maxLoss == 0 {
		denominator = peak
	}
	checkDD(result.MaxCloseMarkDrawdown, maxLoss, denominator, maxBar)
	last := result.CloseMarks[len(result.CloseMarks)-1]
	if result.FinalModelCashUnits != last.ModelCashUnits ||
		result.FinalModelQuantity != last.ModelQuantity ||
		result.FinalPositionPrincipalUnits != last.PositionPrincipalUnits ||
		result.FinalPositionEntryFeeUnits != last.PositionEntryFeeUnits ||
		result.FinalPositionTotalBasisUnits != last.PositionTotalBasisUnits ||
		result.FinalPositionValueUnits != last.PositionValueUnits ||
		result.FinalEquityUnits != last.EquityUnits ||
		result.GrossRealizedAccountingPnLUnits != last.GrossRealizedAccountingPnLUnits ||
		result.GrossUnrealizedAccountingPnLUnits != last.GrossUnrealizedAccountingPnLUnits ||
		result.NetRealizedAccountingPnLUnits != last.NetRealizedAccountingPnLUnits ||
		result.NetUnrealizedAccountingPnLUnits != last.NetUnrealizedAccountingPnLUnits ||
		result.ClosedAttributedFeeUnits != last.ClosedAttributedFeeUnits ||
		result.OpenAttributedFeeUnits != last.OpenAttributedFeeUnits ||
		result.AggregateFeeUnits != last.AggregateFeeUnits ||
		result.PeakCloseEquityUnits != last.PeakEquityUnits {
		t.Fatal("final fields differ from last real close")
	}
	for _, rejected := range result.RejectedEntries {
		i := rejected.BarIndex
		gross := feeScenarioUnits(t, rejected.GrossNotionalUnits)
		fee := feeScenarioUnits(t, rejected.FeeUnits)
		required := feeScenarioUnits(t, rejected.RequiredModelCashUnits)
		available := feeScenarioUnits(t, rejected.AvailableModelCashUnits)
		if i < 20 || i >= len(bars) || rejected.EvaluationBarIndex != i-1 ||
			rejected.Reason != "insufficient_model_cash" ||
			!rejected.Timestamp.Equal(time.Unix(bars[i].Timestamp, 0)) ||
			!rejected.EvaluationTimestamp.Equal(time.Unix(bars[i-1].Timestamp, 0)) ||
			gross <= 0 || fee < 0 || required != gross+fee ||
			required > 1000000000 || available < 0 || available >= required {
			t.Fatal("rejection lineage or prospective amount mismatch")
		}
	}
}

func TestFeeScenarioFixedFeeFlatIndependentOracle(t *testing.T) {
	s := causalScript(feeScenarioRoundTripSignal, 0, 0)
	result := feeScenarioRun(t, NewStrategyEngine(s), causalBars(22), "10", FeeScenario{"1", "0"})
	if len(s.calls) != 3 || len(result.Replay.Fills) != 2 ||
		result.Replay.Fills[0].BarIndex != 20 || result.Replay.Fills[1].BarIndex != 21 ||
		result.Replay.TerminalPosition != nil || result.Replay.ClosedTradeCount != 1 {
		t.Fatal("incorrect flat roundtrip events")
	}
	causalOracle(t, result.Replay.Fills[0].Quantity, "9/100", "quantity")
	entry, exit := result.CashFlows[0], result.CashFlows[1]
	feeScenarioWantUnits(t, entry.GrossNotionalUnits, "900000000")
	feeScenarioWantUnits(t, entry.FeeUnits, "100000000")
	feeScenarioWantUnits(t, entry.DebitedUnits, "1000000000")
	feeScenarioWantUnits(t, entry.ModelCashUnits, "0")
	feeScenarioWantUnits(t, entry.PositionPrincipalUnits, "900000000")
	feeScenarioWantUnits(t, entry.PositionEntryFeeUnits, "100000000")
	feeScenarioWantUnits(t, entry.PositionTotalBasisUnits, "1000000000")
	feeScenarioWantUnits(t, result.CloseMarks[20].EquityUnits, "900000000")
	feeScenarioWantUnits(t, result.CloseMarks[20].NetUnrealizedAccountingPnLUnits, "-100000000")
	fundedWantDD(t, result.CloseMarks[20].CloseMarkDrawdown, "100000000", "1000000000", 20, 10)
	feeScenarioWantUnits(t, exit.GrossNotionalUnits, "900000000")
	feeScenarioWantUnits(t, exit.FeeUnits, "100000000")
	feeScenarioWantUnits(t, exit.CreditedUnits, "800000000")
	feeScenarioWantUnits(t, result.FinalModelCashUnits, "800000000")
	feeScenarioWantUnits(t, result.FinalEquityUnits, "800000000")
	feeScenarioWantUnits(t, result.GrossRealizedAccountingPnLUnits, "0")
	feeScenarioWantUnits(t, result.NetRealizedAccountingPnLUnits, "-200000000")
	feeScenarioWantUnits(t, result.ClosedAttributedFeeUnits, "200000000")
	feeScenarioWantUnits(t, result.OpenAttributedFeeUnits, "0")
	feeScenarioWantUnits(t, result.AggregateFeeUnits, "200000000")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "200000000", "1000000000", 21, 20)
	causalOracle(t, result.Replay.GrossRealizedPnL, "0", "money")
}

func TestFeeScenarioBpsAndCeilingIndependentOracles(t *testing.T) {
	for _, test := range []struct {
		bps       string
		principal string
		fee       string
	}{
		{"100", "990099009", "9900991"},
		{"10000", "500000000", "500000000"},
	} {
		t.Run(test.bps, func(t *testing.T) {
			result := feeScenarioRun(t,
				NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)),
				causalBars(21), "10", FeeScenario{"0", test.bps})
			entry := result.CashFlows[0]
			feeScenarioWantUnits(t, entry.GrossNotionalUnits, test.principal)
			feeScenarioWantUnits(t, entry.FeeUnits, test.fee)
			feeScenarioWantUnits(t, entry.DebitedUnits, "1000000000")
			n := feeScenarioUnits(t, test.principal) + 1
			b, _ := strconv.ParseInt(test.bps, 10, 64)
			// Independent integer next-principal cap proof.
			nextFee := (n*b + 9999) / 10000
			if n+nextFee <= 1000000000 {
				t.Fatal("oracle principal was not maximal")
			}
		})
	}
	for _, test := range []struct {
		gross, fixed, bps, want int64
	}{
		{1, 0, 1, 1},
		{10000, 0, 1, 1},
		{10001, 0, 1, 2},
		{1, 7, 1, 8},
		{10000, 7, 1, 8},
		{10001, 7, 1, 9},
		{100000000000000, 999999999, 10000, 100000999999999},
	} {
		got, code := feeScenarioFeeUnits(test.gross, test.fixed, test.bps)
		if code != "" || got != test.want {
			t.Fatalf("integer fee got %d/%s, want %d", got, code, test.want)
		}
	}
}

func TestFeeScenarioRationalQuantityAndQuoteTies(t *testing.T) {
	for _, test := range []struct {
		price  float64
		target int64
	}{
		{100, 900000000},
		{100, 990099009},
		{0.01, 999999999},
		{3, 500000000},
		{math.Nextafter(100, math.Inf(1)), 900000000},
	} {
		got, code := feeScenarioQuantity(test.price, test.target, false)
		if code != "" {
			t.Fatalf("supported rational sizing failed: %s", code)
		}
		price := new(big.Rat).SetFloat64(test.price)
		exact := new(big.Rat).SetFrac(big.NewInt(test.target), big.NewInt(100000000))
		exact.Quo(exact, price)
		binary := new(big.Rat).SetFloat64(got)
		if binary.Cmp(exact) > 0 ||
			new(big.Rat).SetFloat64(math.Nextafter(got, math.Inf(1))).Cmp(exact) <= 0 {
			t.Fatal("quantity is not the greatest binary float at or below target")
		}
		raw := new(big.Rat).Mul(price, binary)
		limit := new(big.Rat).SetFrac(big.NewInt(test.target), big.NewInt(100000000))
		if raw.Cmp(limit) > 0 {
			t.Fatal("raw binary principal exceeds target")
		}
	}
	for _, test := range []struct {
		price, quantity float64
		want            int64
	}{
		{0.5, 1.0 / 256, 195312},
		{0.5, 3.0 / 256, 585938},
	} {
		got, code := fundedQuoteUnits(test.price, test.quantity)
		if code != "" || got != test.want {
			t.Fatalf("exact half-unit ties-even got %d/%s, want %d", got, code, test.want)
		}
	}
	q, code := feeScenarioQuantity(1000000, 1000000000, true)
	if code != "" || q != 10.0/1000000 {
		t.Fatal("explicit zero scenario changed the inherited quantity minimum")
	}
	for _, test := range []struct {
		price  float64
		target int64
	}{
		{1000000, 999999999},
		{0.01, 1},
		{100, 0},
		{math.Nextafter(0.01, 0), 1000000000},
		{math.Nextafter(1000000, math.Inf(1)), 1000000000},
	} {
		if _, code := feeScenarioQuantity(test.price, test.target, false); code != CausalNumericRange {
			t.Fatal("unsupported sizing was expanded or clamped")
		}
	}
}

func TestFeeScenarioZeroTargetQuantityAndFundingAreDistinct(t *testing.T) {
	for _, bps := range []string{"1", "10000"} {
		for _, cash := range []string{"0", "10"} {
			s := causalScript(causalBuyThenHold, 10, 20)
			result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
				context.Background(), "TEST", causalBars(21), cash,
				FeeScenario{"9.99999999", bps})
			feeScenarioWantFailure(t, result, err, CausalNumericRange, 20)
			if len(s.calls) != 1 {
				t.Fatal("zero target replayed or advanced callbacks")
			}
		}
		hold := causalNewStrategy()
		flat := feeScenarioRun(t, NewStrategyEngine(hold), causalBars(22), "0",
			FeeScenario{"9.99999999", bps})
		if len(flat.Replay.Fills) != 0 || len(flat.RejectedEntries) != 0 ||
			flat.AggregateFeeUnits != "0" || len(hold.calls) != 3 {
			t.Fatal("no-attempt zero target failed or charged")
		}
	}
	_, _, target, ok := feeScenarioParse(FeeScenario{"9.99999999", "0"})
	if !ok || target != 1 {
		t.Fatal("positive one-unit target was conflated with zero")
	}
	bars := causalBars(21)
	for i := range bars {
		causalSetBar(bars, i, 0.01, 0.01, 0.01, 0.01)
	}
	s := causalScript(causalBuyThenHold, 0, 0)
	result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
		context.Background(), "TEST", bars, "0", FeeScenario{"9.99999999", "0"})
	feeScenarioWantFailure(t, result, err, CausalNumericRange, 20)
	if len(s.calls) != 1 {
		t.Fatal("unsupported positive quantity advanced callbacks")
	}
	unfunded := feeScenarioRun(t,
		NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)),
		causalBars(21), "0", FeeScenario{"0", "0"})
	if len(unfunded.RejectedEntries) != 1 || len(unfunded.Replay.Fills) != 0 ||
		unfunded.RejectedEntries[0].RequiredModelCashUnits != "1000000000" {
		t.Fatal("supported positive unfunded attempt was not a nonfatal rejection")
	}
}

func TestFeeScenarioFundingGateNoFeesOrProtection(t *testing.T) {
	s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 10, 20)
	bars := causalBars(24)
	for i := 20; i < len(bars); i++ {
		causalSetBar(bars, i, 100, 200, 1, 100)
	}
	result := feeScenarioRun(t, NewStrategyEngine(s), bars, "9.99999999", FeeScenario{"1", "0"})
	if len(result.RejectedEntries) != 4 || len(result.Replay.Fills) != 0 ||
		len(result.CashFlows) != 0 || result.Replay.TerminalPosition != nil ||
		len(s.calls) != 5 || !result.Replay.PendingSignalUnfilled {
		t.Fatal("rejected attempts created fills, protection or callback replay")
	}
	feeScenarioWantUnits(t, result.AggregateFeeUnits, "0")
	feeScenarioWantUnits(t, result.FinalModelCashUnits, "999999999")
	for _, rejected := range result.RejectedEntries {
		feeScenarioWantUnits(t, rejected.GrossNotionalUnits, "900000000")
		feeScenarioWantUnits(t, rejected.FeeUnits, "100000000")
		feeScenarioWantUnits(t, rejected.RequiredModelCashUnits, "1000000000")
	}
	// Exactly sufficient funding succeeds; the one-unit short case did not resize.
	exact := feeScenarioRun(t,
		NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)),
		causalBars(21), "10", FeeScenario{"1", "0"})
	if len(exact.Replay.Fills) != 1 || len(exact.RejectedEntries) != 0 {
		t.Fatal("strict funding boundary")
	}
}

func TestFeeScenarioExitDeficitIndependentOracles(t *testing.T) {
	bars := causalBars(22)
	causalSetBar(bars, 21, 1, 1, 1, 1)
	s := causalScript(feeScenarioRoundTripSignal, 0, 0)
	result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
		context.Background(), "TEST", bars, "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, FeeScenarioInsufficientExitFeeCash, 21)
	if len(s.calls) != 2 {
		t.Fatal("fatal exit deficit evaluated another close")
	}
	funded := feeScenarioRun(t,
		NewStrategyEngine(causalScript(feeScenarioRoundTripSignal, 0, 0)),
		bars, "100", FeeScenario{"1", "0"})
	exit := funded.CashFlows[1]
	feeScenarioWantUnits(t, exit.GrossNotionalUnits, "9000000")
	feeScenarioWantUnits(t, exit.FeeUnits, "100000000")
	feeScenarioWantUnits(t, exit.NetCashDeltaUnits, "-91000000")
	feeScenarioWantUnits(t, exit.DebitedUnits, "91000000")
	feeScenarioWantUnits(t, exit.CreditedUnits, "0")
	feeScenarioWantUnits(t, funded.FinalModelCashUnits, "8909000000")
	feeScenarioWantUnits(t, funded.NetRealizedAccountingPnLUnits, "-1091000000")
	feeScenarioWantUnits(t, funded.GrossRealizedAccountingPnLUnits, "-891000000")
	feeScenarioWantUnits(t, funded.AggregateFeeUnits, "200000000")
	causalOracle(t, funded.Replay.GrossRealizedPnL, "-891/100", "money")
}

func TestFeeScenarioProtectionOrderingIndependentOracles(t *testing.T) {
	for _, test := range []struct {
		name       string
		open, high float64
		low, close float64
		reason     CausalFillReason
		price      float64
		finalCash  string
		net        string
		queueSell  bool
		source     int
	}{
		{"stop gap before queued sell", 80, 85, 75, 80, CausalStopGap, 80, "9620000000", "-380000000", true, 19},
		{"target gap at limit", 130, 130, 125, 130, CausalTargetGap, 120, "9980000000", "-20000000", true, 19},
		{"stop touch", 100, 105, 85, 100, CausalStopTouch, 90, "9710000000", "-290000000", false, 19},
		{"target touch", 100, 125, 95, 100, CausalTargetTouch, 120, "9980000000", "-20000000", false, 19},
		{"queued exit before intrabar touches", 100, 125, 80, 100, CausalNextOpenSell, 100, "9800000000", "-200000000", true, 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			bars := causalBars(22)
			causalSetBar(bars, 21, test.open, test.high, test.low, test.close)
			s := causalScript(func(index int) strategies.SignalType {
				if index == 19 {
					return strategies.SignalBuy
				}
				if index == 20 && test.queueSell {
					return strategies.SignalSell
				}
				return strategies.SignalHold
			}, 10, 20)
			result := feeScenarioRun(t, NewStrategyEngine(s), bars, "100", FeeScenario{"1", "0"})
			if len(result.Replay.Fills) != 2 || len(s.calls) != 3 {
				t.Fatal("incorrect protection fill/callback counts")
			}
			exit := result.Replay.Fills[1]
			if exit.Reason != test.reason || exit.Price != test.price ||
				exit.EvaluationBarIndex != test.source || exit.EntrySignalBarIndex != 19 ||
				exit.EntryBarIndex != 20 || exit.Ambiguous {
				t.Fatal("protection ordering or lineage changed")
			}
			feeScenarioWantUnits(t, result.FinalModelCashUnits, test.finalCash)
			feeScenarioWantUnits(t, result.NetRealizedAccountingPnLUnits, test.net)
			feeScenarioWantUnits(t, result.AggregateFeeUnits, "200000000")
		})
	}
	// Both levels hit on the entry bar: stop-first, with no same-bar reentry.
	bars := causalBars(21)
	causalSetBar(bars, 20, 100, 125, 80, 100)
	s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 10, 20)
	result := feeScenarioRun(t, NewStrategyEngine(s), bars, "100", FeeScenario{"1", "0"})
	if len(result.Replay.Fills) != 2 || result.Replay.Fills[1].Reason != CausalStopTouch ||
		!result.Replay.Fills[1].Ambiguous || result.Replay.Fills[1].BarIndex != 20 ||
		result.Replay.TerminalPosition != nil || !result.Replay.PendingSignalUnfilled ||
		len(s.calls) != 2 {
		t.Fatal("entry-bar collision or no-reentry semantics")
	}
	feeScenarioWantUnits(t, result.FinalModelCashUnits, "9710000000")
	feeScenarioWantUnits(t, result.AggregateFeeUnits, "200000000")
}

func TestFeeScenarioPriorCloseRatchetAndNoReentry(t *testing.T) {
	bars := causalBars(22)
	causalSetBar(bars, 20, 100, 110, 95, 105)
	causalSetBar(bars, 21, 105, 106, 98, 100)
	result := feeScenarioRun(t,
		NewStrategyEngine(causalScript(causalBuyThenHold, 10, 0)),
		bars, "100", FeeScenario{"1", "0"})
	if len(result.Replay.Fills) != 2 || result.Replay.Fills[1].BarIndex != 21 ||
		result.Replay.Fills[1].Reason != CausalStopTouch ||
		result.Replay.Fills[1].Price != 99 || result.Replay.Fills[1].EvaluationBarIndex != 20 {
		t.Fatal("new close stop was applied retroactively or lost lineage")
	}
	feeScenarioWantUnits(t, result.FinalModelCashUnits, "9791000000")
	feeScenarioWantUnits(t, result.NetRealizedAccountingPnLUnits, "-209000000")

	gapBars := causalBars(22)
	causalSetBar(gapBars, 21, 80, 85, 75, 80)
	buy := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 10, 0)
	flat := feeScenarioRun(t, NewStrategyEngine(buy), gapBars, "100", FeeScenario{"1", "0"})
	if len(flat.Replay.Fills) != 2 || flat.Replay.TerminalPosition != nil ||
		!flat.Replay.PendingSignalUnfilled || len(buy.calls) != 3 {
		t.Fatal("exit allowed same-bar reentry or replayed callbacks")
	}
}

func TestFeeScenarioTerminalOpenNoopsWarmupAndDrawdownTies(t *testing.T) {
	s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 0, 0)
	result := feeScenarioRun(t, NewStrategyEngine(s), causalBars(24), "10", FeeScenario{"1", "0"})
	if len(result.Replay.Fills) != 1 || len(result.CashFlows) != 1 ||
		result.Replay.TerminalPosition == nil || !result.Replay.PendingSignalUnfilled ||
		len(s.calls) != 5 {
		t.Fatal("active BUY noop or final pending created a fee/liquidation")
	}
	feeScenarioWantUnits(t, result.FinalPositionPrincipalUnits, "900000000")
	feeScenarioWantUnits(t, result.FinalPositionEntryFeeUnits, "100000000")
	feeScenarioWantUnits(t, result.FinalPositionTotalBasisUnits, "1000000000")
	feeScenarioWantUnits(t, result.FinalPositionValueUnits, "900000000")
	feeScenarioWantUnits(t, result.FinalEquityUnits, "900000000")
	feeScenarioWantUnits(t, result.GrossUnrealizedAccountingPnLUnits, "0")
	feeScenarioWantUnits(t, result.NetUnrealizedAccountingPnLUnits, "-100000000")
	feeScenarioWantUnits(t, result.OpenAttributedFeeUnits, "100000000")
	feeScenarioWantUnits(t, result.ClosedAttributedFeeUnits, "0")
	feeScenarioWantUnits(t, result.AggregateFeeUnits, "100000000")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "100000000", "1000000000", 20, 10)
	for i := 0; i < 20; i++ {
		feeScenarioWantUnits(t, result.CloseMarks[i].EquityUnits, "1000000000")
		if result.CloseMarks[i].Timestamp.Unix() != causalBars(24)[i].Timestamp {
			t.Fatal("fabricated warmup mark")
		}
	}
	for _, n := range []int{1, 19, 20} {
		warm := causalScript(causalBuyThenHold, 0, 0)
		r := feeScenarioRun(t, NewStrategyEngine(warm), causalBars(n), "0",
			FeeScenario{"9.99999999", "10000"})
		if len(r.Replay.Fills) != 0 || len(r.CloseMarks) != n || r.AggregateFeeUnits != "0" {
			t.Fatal("warmup or final-only signal charged a fee")
		}
		if n < 20 && (len(warm.calls) != 0 || r.Replay.PendingSignalUnfilled) ||
			n == 20 && (len(warm.calls) != 1 || !r.Replay.PendingSignalUnfilled) {
			t.Fatal("warmup boundary changed")
		}
	}
	flatSell := feeScenarioRun(t,
		NewStrategyEngine(causalScript(func(int) strategies.SignalType {
			return strategies.SignalSell
		}, 0, 0)), causalBars(22), "0", FeeScenario{"1", "0"})
	if len(flatSell.Replay.Fills) != 0 || len(flatSell.RejectedEntries) != 0 ||
		flatSell.MaxCloseMarkDrawdown.UndefinedReason != "zero_initial_model_equity" {
		t.Fatal("flat SELL charged or zero equity drawdown was fabricated")
	}
}

func TestFeeScenarioZeroEquityAndRecoveryMarks(t *testing.T) {
	bars := causalBars(22)
	p := 100.0 / 9
	causalSetBar(bars, 21, p, p, p, p)
	result := feeScenarioRun(t,
		NewStrategyEngine(causalScript(feeScenarioRoundTripSignal, 0, 0)),
		bars, "10", FeeScenario{"1", "0"})
	feeScenarioWantUnits(t, result.CashFlows[1].GrossNotionalUnits, "100000000")
	feeScenarioWantUnits(t, result.FinalEquityUnits, "0")
	feeScenarioWantUnits(t, result.NetRealizedAccountingPnLUnits, "-1000000000")
	fundedWantDD(t, result.MaxCloseMarkDrawdown, "1000000000", "1000000000", 21, 100)

	recoveryBars := causalBars(24)
	causalSetBar(recoveryBars, 20, 100, 100, 50, 50)
	causalSetBar(recoveryBars, 21, 50, 50, 50, 50)
	causalSetBar(recoveryBars, 22, 50, 120, 50, 120)
	causalSetBar(recoveryBars, 23, 120, 120, 120, 120)
	recovery := feeScenarioRun(t,
		NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)),
		recoveryBars, "100", FeeScenario{"1", "0"})
	feeScenarioWantUnits(t, recovery.CloseMarks[20].EquityUnits, "9450000000")
	feeScenarioWantUnits(t, recovery.FinalEquityUnits, "10080000000")
	feeScenarioWantUnits(t, recovery.PeakCloseEquityUnits, "10080000000")
	fundedWantDD(t, recovery.MaxCloseMarkDrawdown, "550000000", "10000000000", 20, 5.5)
}

func TestFeeScenarioZeroFeeFreshB1Equivalence(t *testing.T) {
	for _, cash := range []string{"0", "9.99999999", "10", "100"} {
		bars := causalBars(24)
		causalSetBar(bars, 20, 100, 110, 95, 105)
		causalSetBar(bars, 21, 105, 106, 98, 100)
		a := causalScript(func(i int) strategies.SignalType {
			if i == 19 || i == 21 || i == 23 {
				return strategies.SignalBuy
			}
			return strategies.SignalHold
		}, 10, 0)
		b := causalScript(func(i int) strategies.SignalType {
			if i == 19 || i == 21 || i == 23 {
				return strategies.SignalBuy
			}
			return strategies.SignalHold
		}, 10, 0)
		old := fundedRun(t, NewStrategyEngine(a), bars, cash)
		got := feeScenarioRun(t, NewStrategyEngine(b), bars, cash, FeeScenario{"0.00000000", "0"})
		normalized := got.Replay
		normalized.ModelIdentity, normalized.CostIdentity = old.Replay.ModelIdentity, old.Replay.CostIdentity
		if !reflect.DeepEqual(normalized, old.Replay) || !reflect.DeepEqual(a.calls, b.calls) {
			t.Fatal("zero-fee trace, quantity or callback history differs from fresh B1")
		}
		if got.InitialModelCashUnits != old.InitialModelCashUnits ||
			got.FinalModelCashUnits != old.FinalModelCashUnits ||
			got.FinalModelQuantity != old.FinalModelQuantity ||
			got.FinalPositionPrincipalUnits != old.FinalPositionCostUnits ||
			got.FinalPositionTotalBasisUnits != old.FinalPositionCostUnits ||
			got.FinalPositionValueUnits != old.FinalPositionValueUnits ||
			got.FinalEquityUnits != old.FinalEquityUnits ||
			got.NetRealizedAccountingPnLUnits != old.RealizedAccountingPnLUnits ||
			got.NetUnrealizedAccountingPnLUnits != old.UnrealizedAccountingPnLUnits ||
			got.PeakCloseEquityUnits != old.PeakCloseEquityUnits ||
			!reflect.DeepEqual(got.MaxCloseMarkDrawdown, old.MaxCloseMarkDrawdown) ||
			got.AggregateFeeUnits != "0" || got.FinalPositionEntryFeeUnits != "0" {
			t.Fatal("zero-fee final accounting differs from B1")
		}
		for i, m := range got.CloseMarks {
			expected := old.CloseMarks[i]
			projected := FundedCausalCloseMark{
				BarIndex: m.BarIndex, Timestamp: m.Timestamp,
				ModelCashUnits: m.ModelCashUnits, ModelQuantity: m.ModelQuantity,
				PositionCostUnits:  m.PositionTotalBasisUnits,
				PositionValueUnits: m.PositionValueUnits, EquityUnits: m.EquityUnits,
				PeakEquityUnits:    m.PeakEquityUnits,
				RealizedPnLUnits:   m.NetRealizedAccountingPnLUnits,
				UnrealizedPnLUnits: m.NetUnrealizedAccountingPnLUnits,
				CloseMarkDrawdown:  m.CloseMarkDrawdown,
			}
			if !reflect.DeepEqual(projected, expected) ||
				m.GrossRealizedAccountingPnLUnits != m.NetRealizedAccountingPnLUnits ||
				m.GrossUnrealizedAccountingPnLUnits != m.NetUnrealizedAccountingPnLUnits {
				t.Fatal("zero-fee mark differs from B1")
			}
		}
		if len(got.RejectedEntries) != len(old.RejectedEntries) {
			t.Fatal("zero-fee rejection count differs")
		}
		for i, r := range got.RejectedEntries {
			projected := FundedCausalRejectedEntry{
				Reason: r.Reason, BarIndex: r.BarIndex, Timestamp: r.Timestamp,
				EvaluationBarIndex: r.EvaluationBarIndex, EvaluationTimestamp: r.EvaluationTimestamp,
				AvailableModelCashUnits: r.AvailableModelCashUnits,
				RequiredModelCashUnits:  r.RequiredModelCashUnits,
			}
			if !reflect.DeepEqual(projected, old.RejectedEntries[i]) || r.FeeUnits != "0" {
				t.Fatal("zero-fee rejection differs")
			}
		}
		for i, f := range got.CashFlows {
			projected := FundedCausalCashFlow{
				FillIndex: f.FillIndex, Kind: f.Kind, Reason: f.Reason,
				BarIndex: f.BarIndex, Timestamp: f.Timestamp,
				EvaluationBarIndex:  f.EvaluationBarIndex,
				EntrySignalBarIndex: f.EntrySignalBarIndex, EntryBarIndex: f.EntryBarIndex,
				DebitedUnits: f.DebitedUnits, CreditedUnits: f.CreditedUnits,
				ModelCashUnits: f.ModelCashUnits, PositionCostUnits: f.PositionTotalBasisUnits,
				RealizedPnLUnits: f.NetRealizedAccountingPnLUnits,
			}
			if !reflect.DeepEqual(projected, old.CashFlows[i]) || f.FeeUnits != "0" {
				t.Fatal("zero-fee cashflow differs")
			}
		}
	}
}

func TestFeeScenarioInputGrammarBeforeCallbacks(t *testing.T) {
	for _, scenario := range []FeeScenario{
		{"", "0"}, {"10", "0"}, {"10.00000000", "0"}, {"-1", "0"},
		{"+1", "0"}, {"01", "0"}, {"1.", "0"}, {".1", "0"},
		{"1e0", "0"}, {"1.000000001", "0"}, {" 1", "0"},
		{"SECRET", "0"}, {"1", ""}, {"1", "00"}, {"1", "01"},
		{"1", "+1"}, {"1", "-1"}, {"1", "1.0"}, {"1", "1e2"},
		{"1", "10001"}, {"1", "100000"}, {"1", " 1"}, {"1", "SECRET"},
		{"1", "١"}, {strings.Repeat("1", 33), "0"},
	} {
		s := causalNewStrategy()
		result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
			context.Background(), "TEST", causalBars(21), "10", scenario)
		feeScenarioWantFailure(t, result, err, FeeScenarioInvalidScenario, -1)
		if len(s.calls) != 0 {
			t.Fatal("invalid scenario reached callbacks")
		}
	}
	for _, cash := range []string{"", "01", "-1", "+1", "1e1", "1000000.00000001", "SECRET"} {
		s := causalNewStrategy()
		result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
			context.Background(), "TEST", causalBars(21), cash, FeeScenario{"0", "0"})
		feeScenarioWantFailure(t, result, err, FundedInvalidModelCash, -1)
		if len(s.calls) != 0 {
			t.Fatal("invalid cash reached callbacks")
		}
	}
	for _, scenario := range []FeeScenario{
		{"0", "0"}, {"0.00000000", "10000"}, {"9.99999999", "0"},
		{"9.99999999", "1"}, {"9.99999999", "10000"},
	} {
		feeScenarioRun(t, NewStrategyEngine(causalNewStrategy()), causalBars(1), "1000000", scenario)
	}
}

func TestFeeScenarioInheritedFailuresAndPrivacy(t *testing.T) {
	for _, test := range []struct {
		name string
		fn   func(*causalTestStrategy) func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error)
		code CausalErrorCode
	}{
		{"callback error", func(*causalTestStrategy) func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
			return func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
				return strategies.StrategySignal{}, errors.New("SECRET callback path")
			}
		}, CausalEvaluatorError},
		{"identity", func(s *causalTestStrategy) func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
			return func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				out.Symbol = "SECRET"
				return out, nil
			}
		}, CausalEvaluatorIdentity},
		{"agent prompt", func(s *causalTestStrategy) func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
			return func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				out.AgentPrompt = "SECRET"
				return out, nil
			}
		}, CausalUnsupported},
		{"numeric", func(s *causalTestStrategy) func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error) {
			return func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				out.Score = math.NaN()
				return out, nil
			}
		}, CausalNumericRange},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := causalNewStrategy()
			s.fn = test.fn(s)
			result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
				context.Background(), "TEST", causalBars(22), "100", FeeScenario{"1", "0"})
			feeScenarioWantFailure(t, result, err, test.code, 19)
			if len(s.calls) != 1 {
				t.Fatal("failure replayed or advanced callbacks")
			}
		})
	}
	s := causalNewStrategy()
	result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
		context.Background(), "SECRET/", causalBars(21), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalInvalidSymbol, -1)
	badBars := causalBars(21)
	badBars[20].Close = math.Inf(1)
	result, err = NewStrategyEngine(s).RunFeeScenarioCausal(
		context.Background(), "TEST", badBars, "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalInvalidInput, 20)
	if len(s.calls) != 0 {
		t.Fatal("whole-input preflight did not precede callbacks")
	}
	var absent *Engine
	result, err = absent.RunFeeScenarioCausal(
		context.Background(), "TEST", causalBars(21), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalInvalidEvaluator, -1)

	// Raw rationale is deliberately excluded from successful evidence.
	private := causalNewStrategy()
	private.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(private.name, symbol, at)
		out.Rationale = "SECRET internal rationale"
		return out, nil
	}
	success := feeScenarioRun(t, NewStrategyEngine(private), causalBars(20), "10", FeeScenario{"1", "0"})
	encoded, encodeErr := json.Marshal(success)
	if encodeErr != nil || strings.Contains(string(encoded), "SECRET") {
		t.Fatal("raw callback material leaked")
	}
}

func TestFeeScenarioPlanMembershipAndIdentity(t *testing.T) {
	for _, test := range []struct {
		name  string
		after func(*plans.PlanEvaluation)
		code  CausalErrorCode
	}{
		{"missing child", func(out *plans.PlanEvaluation) {
			out.StrategySignals = out.StrategySignals[:1]
		}, CausalPlanMembership},
		{"child identity", func(out *plans.PlanEvaluation) {
			out.StrategySignals[0].Symbol = "SECRET"
		}, CausalEvaluatorIdentity},
		{"parent identity", func(out *plans.PlanEvaluation) {
			out.Timestamp = out.Timestamp.Add(time.Nanosecond)
		}, CausalEvaluatorIdentity},
		{"hidden unsupported child", func(out *plans.PlanEvaluation) {
			out.StrategySignals[0].Signal = strategies.SignalAgentReview
		}, CausalUnsupported},
	} {
		t.Run(test.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = test.after
			result, err := NewPlanEngine(p).RunFeeScenarioCausal(
				context.Background(), "TEST", causalBars(21), "10", FeeScenario{"1", "0"})
			feeScenarioWantFailure(t, result, err, test.code, 19)
			if p.calls != 1 {
				t.Fatal("plan callback count")
			}
		})
	}
	p := causalNewPlan()
	p.after = func(out *plans.PlanEvaluation) {
		p.members[0].Weight = 0.5
	}
	result, err := NewPlanEngine(p).RunFeeScenarioCausal(
		context.Background(), "TEST", causalBars(21), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalPlanMembership, 19)
}

func TestFeeScenarioCancellationAndInputIsolation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := causalNewStrategy()
	result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
		ctx, "TEST", causalBars(21), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalCanceled, 0)
	if len(s.calls) != 0 {
		t.Fatal("pre-canceled run called evaluator")
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	s = causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		cancel()
		return causalCompleteSignal(s.name, symbol, at), errors.New("SECRET")
	}
	result, err = NewStrategyEngine(s).RunFeeScenarioCausal(
		ctx, "TEST", causalBars(21), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalCanceled, 19)

	bars := causalBars(22)
	original := append([]OHLCV(nil), bars...)
	mutating := causalNewStrategy()
	mutating.fn = func(_ context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
		for _, value := range closes {
			if value != 100 {
				t.Fatal("a prior callback mutated a later prefix")
			}
		}
		for _, value := range volumes {
			if value != 1000 {
				t.Fatal("a prior callback mutated later volumes")
			}
		}
		out := causalCompleteSignal(mutating.name, symbol, at)
		if len(closes) == 20 {
			out.Signal = strategies.SignalBuy
			bars[20].Open, bars[20].Close = 999, 999
		}
		closes[0], volumes[0] = -1, -1
		return out, nil
	}
	isolated, isolationErr := NewStrategyEngine(mutating).RunFeeScenarioCausal(
		nil, "TEST", bars, "10", FeeScenario{"1", "0"})
	if isolationErr != nil {
		t.Fatalf("input isolation failed: %v", isolationErr)
	}
	feeScenarioCheck(t, isolated, original)
	if len(isolated.Replay.Fills) != 1 || isolated.Replay.Fills[0].Price != 100 ||
		isolated.FinalPositionValueUnits != "900000000" || len(mutating.calls) != 3 {
		t.Fatal("runner-owned bars or callback count changed")
	}
	plainBars := causalBars(22)
	copyBars := append([]OHLCV(nil), plainBars...)
	feeScenarioRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)),
		plainBars, "10", FeeScenario{"1", "0"})
	if !reflect.DeepEqual(plainBars, copyBars) {
		t.Fatal("runner mutated supplied bars")
	}
}

func TestFeeScenarioProtectionDisableRemainsFatal(t *testing.T) {
	s := causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		if len(closes) == 20 {
			out.Signal, out.StopLossPct, out.TargetPct = strategies.SignalBuy, 10, 20
		}
		return out, nil
	}
	result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
		context.Background(), "TEST", causalBars(21), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalUnsupported, 20)
	if len(s.calls) != 2 {
		t.Fatal("protection failure replayed callbacks")
	}
}

func TestFeeScenarioCheckedRangesResourcesAndExclusiveState(t *testing.T) {
	if _, ok := feeScenarioCheckedMul(math.MaxInt64, 2); ok {
		t.Fatal("unchecked integer product")
	}
	if _, ok := feeScenarioCheckedMul(-1, 0); ok {
		t.Fatal("negative product input")
	}
	for _, test := range []struct{ gross, fixed, bps int64 }{
		{-1, 0, 0}, {100000000000001, 0, 0},
		{1, 1000000000, 0}, {1, 0, 10001}, {1, 0, -1},
	} {
		if _, code := feeScenarioFeeUnits(test.gross, test.fixed, test.bps); code != CausalNumericRange {
			t.Fatal("unsupported fee arithmetic accepted")
		}
	}
	s := causalNewStrategy()
	result, err := NewStrategyEngine(s).RunFeeScenarioCausal(
		context.Background(), "TEST", causalBars(10001), "10", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalResourceLimit, -1)
	if len(s.calls) != 0 {
		t.Fatal("over-limit input reached callbacks")
	}

	state := newCausalFeeScenarioState(1000000000, 100000000, 0, 900000000)
	state.result.CashFlows = make([]FeeScenarioCausalCashFlow, 20000)
	if code := state.fill(CausalFill{}, 20000); code != CausalResourceLimit {
		t.Fatal("cashflow cap")
	}
	state = newCausalFeeScenarioState(1000000000, 100000000, 0, 900000000)
	state.result.CloseMarks = make([]FeeScenarioCausalCloseMark, 10000)
	if code := state.mark(causalBars(1)[0], 10000, nil); code != CausalResourceLimit {
		t.Fatal("mark cap")
	}
	state = newCausalFeeScenarioState(0, 100000000, 0, 900000000)
	state.result.RejectedEntries = make([]FeeScenarioCausalRejectedEntry, 10000)
	if _, _, code := state.entryGate(causalBars(1)[0], 20, CausalEvaluation{}); code != CausalResourceLimit {
		t.Fatal("rejection cap")
	}

	// A consistent private account at the aggregate-fee boundary must reject
	// the next charged side, rather than overflow, clip or publish that flow.
	state = newCausalFeeScenarioState(100000000000000, 100000000, 0, 900000000)
	state.fees, state.closedFees, state.grossClosed = 99999999999999, 99999999999999, 99999999999999
	if !state.validAccount() {
		t.Fatal("invalid boundary fixture")
	}
	q, code := feeScenarioQuantity(100, 900000000, false)
	if code != "" {
		t.Fatal("boundary fixture quantity")
	}
	fill := CausalFill{Kind: CausalEntry, Price: 100, Quantity: q}
	if code := state.fill(fill, 0); code != CausalNumericRange ||
		len(state.result.CashFlows) != 0 || state.cash != 100000000000000 {
		t.Fatal("aggregate-fee cap was not checked before commit")
	}
	state = newCausalFeeScenarioState(100000000000000, 0, 0, 1000000000)
	state.quantity = 0.1
	state.principal, state.basis = 1000000000, 1000000000
	state.cash = 99999000000000
	if !state.validAccount() {
		t.Fatal("cash-overflow fixture")
	}
	if code := state.fill(CausalFill{Kind: CausalExit, Price: 1000000, Quantity: 0.1}, 0); code != CausalNumericRange || len(state.result.CashFlows) != 0 {
		t.Fatal("cash upper bound was clipped")
	}
	state = newCausalFeeScenarioState(1000000000, 100000000, 0, 900000000)
	state.basis = 1
	if code := state.mark(causalBars(1)[0], 0, nil); code != CausalNumericRange {
		t.Fatal("lost basis was accepted")
	}
	// The public wrappers cannot select both states; the private invariant is
	// nevertheless checked before any evaluator callback.
	fresh := causalNewStrategy()
	replay, replayErr := NewStrategyEngine(fresh).runCausal(
		context.Background(), "TEST", causalBars(21),
		newCausalFundedState(1000000000),
		newCausalFeeScenarioState(1000000000, 0, 0, 1000000000))
	causalWantFailure(t, replay, replayErr, CausalInvalidInput, -1)
	if len(fresh.calls) != 0 {
		t.Fatal("exclusive-state failure reached callbacks")
	}
}

func TestFeeScenarioInheritedGrossRangeStillFailsWholeRun(t *testing.T) {
	bars := causalBars(22)
	for i := 0; i <= 20; i++ {
		causalSetBar(bars, i, 0.01, 0.01, 0.01, 0.01)
	}
	causalSetBar(bars, 21, 1000000, 1000000, 1000000, 1000000)
	result, err := NewStrategyEngine(causalScript(feeScenarioRoundTripSignal, 0, 0)).
		RunFeeScenarioCausal(context.Background(), "TEST", bars, "100", FeeScenario{"1", "0"})
	feeScenarioWantFailure(t, result, err, CausalNumericRange, 21)
}
