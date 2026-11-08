package backtest

import (
	"context"
	"encoding/json"
	"errors"
	"gelt/pkg/strategies"
	"math"
	"math/big"
	"reflect"
	"testing"
)

func execRun(t *testing.T, bars []OHLCV, cash string, s ExecutionScenario, signal func(int) strategies.SignalType, stop, target float64) ExecutionScenarioCausalResult {
	t.Helper()
	r, e := NewStrategyEngine(causalScript(signal, stop, target)).RunExecutionScenarioCausal(context.Background(), "TEST", bars, cash, s)
	if e != nil {
		t.Fatal(e)
	}
	if r.ModelIdentity != ExecutionScenarioCausalModelIdentity || r.ReferenceReplayRole != "reference_trigger_diagnostic_only_not_execution_pnl" {
		t.Fatal("identity")
	}
	for _, m := range r.CloseMarks {
		cash := feeScenarioUnits(t, m.ModelCashUnits)
		value := feeScenarioUnits(t, m.PositionValueUnits)
		eq := feeScenarioUnits(t, m.EquityUnits)
		initial := feeScenarioUnits(t, r.InitialEquityUnits)
		realized := feeScenarioUnits(t, m.NetRealizedAccountingPnLUnits)
		open := feeScenarioUnits(t, m.NetUnrealizedAccountingPnLUnits)
		if cash+value != eq || initial+realized+open != eq {
			t.Fatal("account identity")
		}
	}
	execCheckFlows(t, r)
	return r
}
func TestExecutionPriceAdverseRationalOracle(t *testing.T) {
	for _, p := range []float64{.01, .1, 100, 999999, 2000000} {
		for _, rate := range []int64{0, 1, 37, 100, 9999} {
			for _, side := range []CausalFillKind{CausalEntry, CausalExit} {
				got, code := executionScenarioPrice(p, rate, side)
				if code != "" {
					t.Fatal(code)
				}
				n := int64(10000) + rate
				if side == CausalExit {
					n = 10000 - rate
				}
				want := new(big.Rat).Mul(new(big.Rat).SetFloat64(p), big.NewRat(n, 10000))
				q := new(big.Rat).SetFloat64(got)
				if rate == 0 && math.Float64bits(p) != math.Float64bits(got) {
					t.Fatal("zero changed bits")
				}
				if side == CausalEntry {
					if q.Cmp(want) < 0 || new(big.Rat).SetFloat64(math.Nextafter(got, 0)).Cmp(want) >= 0 {
						t.Fatal("buy not minimal adverse")
					}
				} else if q.Cmp(want) > 0 || new(big.Rat).SetFloat64(math.Nextafter(got, math.Inf(1))).Cmp(want) <= 0 {
					t.Fatal("sell not maximal adverse")
				}
			}
		}
	}
	for _, p := range []float64{0, -1, math.NaN(), math.Inf(1), causalMaxLevel + 1} {
		if _, c := executionScenarioPrice(p, 1, CausalEntry); c == "" {
			t.Fatal("invalid price")
		}
	}
}
func TestExecutionScenarioExactRoundTripAndTerminal(t *testing.T) {
	s := ExecutionScenario{"0", "0", "100", "100"}
	r := execRun(t, causalBars(22), "10", s, feeScenarioRoundTripSignal, 0, 0)
	if len(r.CashFlows) != 2 || r.CashFlows[0].ExecutionPrice != 101 || r.CashFlows[1].ExecutionPrice != 99 || r.FinalModelCashUnits != "980198020" || r.NetRealizedAccountingPnLUnits != "-19801980" || r.AggregateFeeUnits != "0" {
		t.Fatalf("wrong execution accounting: %+v", r)
	}
	if r.ReferenceReplay.Fills[0].Price != 100 || r.ReferenceReplay.Fills[1].Price != 100 {
		t.Fatal("reference changed")
	}
	exact := new(big.Rat).Quo(big.NewRat(10, 1), big.NewRat(101, 1))
	if new(big.Rat).SetFloat64(r.FinalModelQuantity).Sign() != 0 || new(big.Rat).SetFloat64(r.CashFlows[0].ExecutionPrice).Sign() <= 0 {
		t.Fatal("state")
	}
	q := r.ReferenceReplay.Fills[0].Quantity
	if new(big.Rat).SetFloat64(q).Cmp(exact) > 0 {
		t.Fatal("quantity exceeds target")
	}
	open := execRun(t, causalBars(21), "10", s, causalBuyThenHold, 0, 0)
	if open.FinalModelQuantity <= 0 || len(open.CashFlows) != 1 || open.AggregateFeeUnits != "0" || open.FinalPositionPrincipalUnits != "1000000000" {
		t.Fatal("terminal liquidation")
	}
}
func TestExecutionZeroRateB2aEquivalence(t *testing.T) {
	for _, fees := range []FeeScenario{{"0", "0"}, {"1", "0"}, {"0", "100"}, {"0.00000001", "9999"}} {
		for _, n := range []int{19, 20, 21, 22, 24} {
			bars := causalBars(n)
			a, e := NewStrategyEngine(causalScript(feeScenarioRoundTripSignal, 0, 0)).RunFeeScenarioCausal(context.Background(), "TEST", bars, "100", fees)
			if e != nil {
				t.Fatal(e)
			}
			b := execRun(t, bars, "100", ExecutionScenario{fees.FixedFee, fees.FeeBps, "0", "0"}, feeScenarioRoundTripSignal, 0, 0)
			ref := b.ReferenceReplay
			ref.ModelIdentity = a.Replay.ModelIdentity
			ref.CostIdentity = a.Replay.CostIdentity
			if !reflect.DeepEqual(a.Replay, ref) {
				t.Fatal("reference equivalence")
			}
			// Compare every inherited accounting field by its public JSON key, not a selected metric.
			x, _ := json.Marshal(a)
			y, _ := json.Marshal(b)
			var am, bm map[string]json.RawMessage
			json.Unmarshal(x, &am)
			json.Unmarshal(y, &bm)
			for k, v := range am {
				if k == "model_identity" || k == "cost_identity" || k == "scenario" || k == "replay_float_gross_diagnostic" || k == "cash_flows" {
					continue
				}
				if !reflect.DeepEqual(v, bm[k]) {
					t.Fatalf("zero field %s", k)
				}
			}
			for i, f := range a.CashFlows {
				x, _ := json.Marshal(f)
				y, _ := json.Marshal(b.CashFlows[i])
				am = make(map[string]json.RawMessage)
				bm = make(map[string]json.RawMessage)
				json.Unmarshal(x, &am)
				json.Unmarshal(y, &bm)
				for k, v := range am {
					if !reflect.DeepEqual(v, bm[k]) {
						t.Fatalf("flow %s", k)
					}
				}
			}
		}
	}
}
func TestExecutionAllReferenceExitReasons(t *testing.T) {
	for _, tc := range []struct {
		name                                 string
		open, high, low, close, stop, target float64
		signal                               func(int) strategies.SignalType
		want                                 CausalFillReason
	}{
		{"sell", 100, 100, 100, 100, 0, 0, feeScenarioRoundTripSignal, CausalNextOpenSell},
		{"stopgap", 80, 100, 70, 90, 10, 10, causalBuyThenHold, CausalStopGap},
		{"targetgap", 120, 125, 115, 120, 10, 10, causalBuyThenHold, CausalTargetGap},
		{"stop", 100, 105, 80, 100, 10, 10, causalBuyThenHold, CausalStopTouch},
		{"target", 100, 120, 95, 100, 10, 10, causalBuyThenHold, CausalTargetTouch},
		{"ambiguous", 100, 120, 80, 100, 10, 10, causalBuyThenHold, CausalStopTouch},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bars := causalBars(22)
			causalSetBar(bars, 21, tc.open, tc.high, tc.low, tc.close)
			r := execRun(t, bars, "100", ExecutionScenario{"0", "0", "100", "100"}, tc.signal, tc.stop, tc.target)
			if len(r.CashFlows) != 2 || r.CashFlows[1].Reason != tc.want {
				t.Fatal("reason")
			}
			if r.CashFlows[1].ExecutionPrice >= r.CashFlows[1].ReferencePrice {
				t.Fatal("not adverse")
			}
			if tc.name == "ambiguous" && !r.ReferenceReplay.Fills[1].Ambiguous {
				t.Fatal("ambiguity")
			}
		})
	}
}
func TestExecutionHelperVersusReachableDomains(t *testing.T) {
	if _, c := executionScenarioPrice(2000000, 0, CausalExit); c != "" {
		t.Fatal(c)
	} // constructed helper, not public fill.
	bars := causalBars(22)
	for i := range bars {
		causalSetBar(bars, i, 1000000, 1000000, 1000000, 1000000)
	}
	r := execRun(t, bars, "100", ExecutionScenario{"0", "0", "0", "0"}, causalBuyThenHold, 0, 100)
	if len(r.CashFlows) != 1 || r.FinalModelQuantity <= 0 {
		t.Fatal("unreachable target filled")
	}
	small := causalBars(22)
	for i := range small {
		causalSetBar(small, i, .01, .01, .01, .01)
	}
	r = execRun(t, small, "10", ExecutionScenario{"0", "0", "0", "9999"}, feeScenarioRoundTripSignal, 0, 0)
	if r.CashFlows[1].ExecutionPrice >= .01 || r.FinalModelCashUnits != "100000" {
		t.Fatal("sub-cent exit rejected/misquoted")
	}
	_, e := NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)).RunExecutionScenarioCausal(context.Background(), "TEST", bars, "100", ExecutionScenario{"0", "0", "1", "0"})
	if e == nil {
		t.Fatal("entry price widened")
	}
}
func TestExecutionRejectedScenariosFundingAndSafety(t *testing.T) {
	for _, bad := range []string{"", "00", "01", "-0", "-1", "10000", "1.0", "1e1", " 1", "１"} {
		for _, buy := range []bool{true, false} {
			s := ExecutionScenario{"0", "0", "0", "0"}
			if buy {
				s.BuyAdverseBps = bad
			} else {
				s.SellAdverseBps = bad
			}
			v := causalNewStrategy()
			r, e := NewStrategyEngine(v).RunExecutionScenarioCausal(context.Background(), "TEST", causalBars(22), "10", s)
			var typed *ExecutionScenarioCausalError
			if !errors.As(e, &typed) || typed.Code != ExecutionScenarioInvalidScenario || len(v.calls) != 0 || !reflect.DeepEqual(r, ExecutionScenarioCausalResult{}) {
				t.Fatal("bad scenario not rejected before callbacks")
			}
		}
	}
	for _, cash := range []string{"0", "8.99999999", "9", "10"} {
		r := execRun(t, causalBars(21), cash, ExecutionScenario{"1", "0", "100", "100"}, causalBuyThenHold, 0, 0)
		if cash != "10" {
			if len(r.CashFlows) != 0 || len(r.RejectedEntries) != 1 {
				t.Fatal("funding")
			}
		} else if r.CashFlows[0].GrossNotionalUnits != "900000000" || r.CashFlows[0].FeeUnits != "100000000" {
			t.Fatal("fee cap")
		}
	}
	s := ExecutionScenario{"9.99999999", "1", "1", "1"}
	r, e := NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)).RunExecutionScenarioCausal(context.Background(), "TEST", causalBars(21), "0", s)
	if e == nil || !reflect.DeepEqual(r, ExecutionScenarioCausalResult{}) {
		t.Fatal("zero target")
	}
	execRun(t, causalBars(19), "0", s, causalBuyThenHold, 0, 0)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, e = NewStrategyEngine(causalNewStrategy()).RunExecutionScenarioCausal(ctx, "TEST", causalBars(22), "10", ExecutionScenario{"0", "0", "0", "0"})
	if e == nil || !reflect.DeepEqual(r, ExecutionScenarioCausalResult{}) {
		t.Fatal("cancel")
	}
}

// Independent contract oracle: binary-rational price*quantity, one ties-even
// scale conversion, then integer fee ceiling. No production quote/fee helper.
func execOracleUnits(p, q float64) int64 {
	v := new(big.Rat).Mul(new(big.Rat).SetFloat64(p), new(big.Rat).SetFloat64(q))
	v.Mul(v, big.NewRat(100000000, 1))
	n, rem := new(big.Int), new(big.Int)
	n.QuoRem(v.Num(), v.Denom(), rem)
	cmp := new(big.Int).Lsh(rem, 1).Cmp(v.Denom())
	if cmp > 0 || cmp == 0 && n.Bit(0) == 1 {
		n.Add(n, big.NewInt(1))
	}
	return n.Int64()
}
func execCheckFlows(t *testing.T, r ExecutionScenarioCausalResult) {
	t.Helper()
	cash := feeScenarioUnits(t, r.InitialModelCashUnits)
	fees, differences := int64(0), int64(0)
	fixed := feeScenarioUnits(t, r.Scenario.FixedFeeUnits)
	bps := feeScenarioUnits(t, r.Scenario.FeeBps)
	for i, f := range r.CashFlows {
		q := r.ReferenceReplay.Fills[i].Quantity
		gross := execOracleUnits(f.ExecutionPrice, q)
		ref := execOracleUnits(f.ReferencePrice, q)
		charge := fixed + (gross*bps+9999)/10000
		if feeScenarioUnits(t, f.GrossNotionalUnits) != gross || feeScenarioUnits(t, f.ReferenceNotionalUnits) != ref || feeScenarioUnits(t, f.FeeUnits) != charge {
			t.Fatal("quote/feeoracle")
		}
		delta := gross - charge
		difference := ref - gross
		if f.Kind == CausalEntry {
			delta = -gross - charge
			difference = gross - ref
			if -delta > 1000000000 {
				t.Fatal("cap")
			}
		}
		cash += delta
		fees += charge
		differences += difference
		if difference < 0 || feeScenarioUnits(t, f.NetCashDeltaUnits) != delta || feeScenarioUnits(t, f.ModelCashUnits) != cash || feeScenarioUnits(t, f.AggregateFeeUnits) != fees || feeScenarioUnits(t, f.AdverseDifferenceUnits) != difference || feeScenarioUnits(t, f.AggregateAdverseDifferenceUnits) != differences {
			t.Fatal("flow cash/attribution oracle")
		}
	}
	if feeScenarioUnits(t, r.AggregateFeeUnits) != fees || feeScenarioUnits(t, r.AggregateAdverseDifferenceUnits) != differences || feeScenarioUnits(t, r.FinalModelCashUnits) != cash {
		t.Fatal("aggregate")
	}
}
func TestExecutionFatalDeficitBoundsAndModes(t *testing.T) {
	bars := causalBars(22)
	causalSetBar(bars, 21, 1, 1, 1, 1)
	r, e := NewStrategyEngine(causalScript(feeScenarioRoundTripSignal, 0, 0)).RunExecutionScenarioCausal(context.Background(), "TEST", bars, "10", ExecutionScenario{"1", "0", "100", "100"})
	var typed *ExecutionScenarioCausalError
	if !errors.As(e, &typed) || typed.Code != ExecutionScenarioInsufficientExitFeeCash || !reflect.DeepEqual(r, ExecutionScenarioCausalResult{}) {
		t.Fatal("fee deficit must discard whole result")
	}
	execRun(t, bars, "100", ExecutionScenario{"1", "0", "100", "100"}, feeScenarioRoundTripSignal, 0, 0)
	_, e = NewStrategyEngine(causalNewStrategy()).RunExecutionScenarioCausal(context.Background(), "TEST", causalBars(CausalMaxBars+1), "100", ExecutionScenario{"0", "0", "0", "0"})
	if !errors.As(e, &typed) || typed.Code != CausalResourceLimit {
		t.Fatal("resource")
	}
	egn := NewStrategyEngine(causalNewStrategy())
	_, err := egn.runCausal(context.Background(), "TEST", causalBars(20), newCausalFundedState(100), nil, newCausalExecutionScenarioState(100, 0, 0, 100, 0, 0))
	if err == nil {
		t.Fatal("mixed modes")
	}
	_, err = egn.runCausal(context.Background(), "TEST", causalBars(20), nil, nil, nil, nil)
	if err == nil {
		t.Fatal("multiple execution modes")
	}
}

func TestExecutionCombinedFeesAndAdverseAccounting(t *testing.T) {
	for _, s := range []ExecutionScenario{{"0.00000001", "1", "37", "91"}, {"1", "100", "100", "100"}, {"0", "10000", "1", "9999"}, {"0", "0", "0", "100"}} {
		r := execRun(t, causalBars(22), "100", s, feeScenarioRoundTripSignal, 0, 0)
		if len(r.CashFlows) != 2 || r.FinalModelQuantity != 0 {
			t.Fatal("combined scenario not closed")
		}
	}
	for _, rate := range []int64{-1, 10000} {
		if _, code := executionScenarioPrice(100, rate, CausalEntry); code == "" {
			t.Fatal("rate bypass")
		}
	}
	if _, code := executionScenarioPrice(100, 1, CausalFillKind("invalid")); code == "" {
		t.Fatal("side bypass")
	}
}
