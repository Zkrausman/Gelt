package backtest

import (
	"context"
	"reflect"
	"testing"
	"time"

	"gelt/pkg/strategies"
)

func TestTrend50ConstantHandOracle(t *testing.T) {
	bars := make([]OHLCV, 51)
	for i := range bars {
		bars[i] = OHLCV{Timestamp: int64(i + 1), Open: 100, High: 100, Low: 100, Close: 100, Volume: 1}
	}
	scenario := ExecutionScenario{FixedFee: "1", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	for _, n := range []int{1, 49, 50, 51} {
		r, err := RunTrend50ComparisonCausal(context.Background(), "TEST", bars[:n], "100", scenario)
		if err != nil {
			t.Fatalf("N=%d: %v", n, err)
		}
		want := 0
		if n >= 50 {
			want = n - 49
		}
		if len(r.Strategy.ReferenceReplay.Evaluations) != want {
			t.Fatalf("N=%d count %d", n, len(r.Strategy.ReferenceReplay.Evaluations))
		}
		if n >= 50 {
			e := r.Strategy.ReferenceReplay.Evaluations[0]
			if e.Signal != "SELL" || e.Score != 10 || e.StopLossPct != .5 || e.TargetPct != 1.25 || e.BarIndex != 49 || e.PrefixLength != 50 {
				t.Fatalf("unexpected hand oracle: %+v", e)
			}
		}
		if n == 51 && (r.Passive.FinalEquityUnits != "9900000000" || r.Passive.AggregateFeeUnits != "100000000") {
			t.Fatalf("passive %+v", r.Passive)
		}
	}
}

func trend50Scenario() ExecutionScenario { return ExecutionScenario{"0", "0", "0", "0"} }
func trend50Core(t *testing.T, bars []OHLCV, cash int64, strategy *causalTestStrategy, fixed, bps, buy, sell int64) (CausalResult, *causalExecutionScenarioState, error) {
	t.Helper()
	target := (fundedEntryUnits - fixed) * 10000 / (10000 + bps)
	state := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, cash, fixed, bps, target, buy, sell)
	r, err := NewStrategyEngine(strategy).runCausalCore(causalProfileTrend50, context.Background(), "TEST", bars, nil, nil, state)
	return r, state, err
}

func TestTrend50CorePrefixAndCount(t *testing.T) {
	for _, n := range []int{1, 49, 50, 51, 10000} {
		s := causalNewStrategy()
		bars := causalBars(n)
		r, _, err := trend50Core(t, bars, 10000000000, s, 0, 0, 0, 0)
		if err != nil {
			t.Fatalf("N=%d: %v", n, err)
		}
		want := 0
		if n >= 50 {
			want = n - 49
		}
		if len(s.calls) != want || len(r.Evaluations) != want {
			t.Fatalf("N=%d calls=%d evals=%d", n, len(s.calls), len(r.Evaluations))
		}
		for i, c := range s.calls {
			if c.length != i+50 || !c.at.Equal(time.Unix(bars[i+49].Timestamp, 0).UTC()) {
				t.Fatalf("N=%d call=%d %+v", n, i, c)
			}
		}
		if len(r.Fills) != 0 {
			t.Fatal("unexpected fill")
		}
	}
}
func TestTrend50OwnedDifferentialAndPrefix(t *testing.T) {
	for _, shape := range []string{"up", "bull", "bear"} {
		bars := causalBars(53)
		for i := range bars {
			p := 100.0
			switch shape {
			case "up":
				p += float64(i) * 2
			case "bull":
				if i >= 20 && i < 49 {
					p += float64(i-20) * 1.5
				}
			case "bear":
				p = 200
				if i >= 20 && i < 49 {
					p -= float64(i-20) * 1.5
				}
			}
			bars[i].Open = p
			bars[i].High = p
			bars[i].Low = p
			bars[i].Close = p
		}
		got, err := RunTrend50ComparisonCausal(context.Background(), "TEST", bars, "100", trend50Scenario())
		if err != nil {
			t.Fatalf("%s: %v", shape, err)
		}
		standalone := strategies.NewTrendConfluenceStrategy()
		if err := standalone.Init(nil); err != nil {
			t.Fatal(err)
		}
		for i, e := range got.Strategy.ReferenceReplay.Evaluations {
			k := i + 49
			closes := make([]float64, k+1)
			volumes := make([]float64, k+1)
			for j := range closes {
				closes[j], volumes[j] = bars[j].Close, bars[j].Volume
			}
			sig, err := standalone.Evaluate(context.Background(), time.Unix(bars[k].Timestamp, 0).UTC(), "TEST", closes, volumes)
			if err != nil {
				t.Fatal(err)
			}
			if e.Name != sig.StrategyName || e.Symbol != sig.Symbol || !e.Timestamp.Equal(sig.Timestamp) || e.AssetClass != sig.AssetClass || e.Signal != sig.Signal || e.Score != sig.Score || e.StopLossPct != sig.StopLossPct || e.TargetPct != sig.TargetPct {
				t.Fatalf("%s prefix %d: %+v vs %+v", shape, k, e, sig)
			}
		}
		want := map[string]strategies.SignalType{"up": strategies.SignalHold, "bull": strategies.SignalBuy, "bear": strategies.SignalSell}[shape]
		if got.Strategy.ReferenceReplay.Evaluations[0].Signal != want {
			t.Fatalf("%s wrong fixture signal", shape)
		}
		changed := append([]OHLCV(nil), bars...)
		for i := range changed {
			changed[i].Volume = float64(i)
		}
		changed[52].Open++
		changed[52].High++
		changed[52].Low++
		changed[52].Close++
		alt, err := RunTrend50ComparisonCausal(context.Background(), "TEST", changed, "100", trend50Scenario())
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got.Strategy.ReferenceReplay.Evaluations[:2], alt.Strategy.ReferenceReplay.Evaluations[:2]) || !reflect.DeepEqual(got.Strategy.CloseMarks[:52], alt.Strategy.CloseMarks[:52]) {
			t.Fatalf("%s prefix changed", shape)
		}
		changed[52] = bars[52]
		alt, err = RunTrend50ComparisonCausal(context.Background(), "TEST", changed, "100", trend50Scenario())
		if err != nil || !reflect.DeepEqual(got.Strategy.ReferenceReplay.Evaluations, alt.Strategy.ReferenceReplay.Evaluations) {
			t.Fatalf("%s volume changed signals: %v", shape, err)
		}
	}
}
func TestTrend50PassiveFundingAndEligibility(t *testing.T) {
	bars := causalBars(51)
	causalSetBar(bars, 50, 100, 110, 100, 110)
	r, err := RunTrend50ComparisonCausal(context.Background(), "TEST", bars, "100", trend50Scenario())
	if err != nil {
		t.Fatal(err)
	}
	if r.Passive.Entry == nil || r.Passive.Entry.BarIndex != 50 || r.Passive.Entry.PolicyDecisionBarIndex != 49 || r.Passive.Entry.ReferencePrice != 100 || r.Passive.FinalModelQuantity != .1 || r.Passive.FinalModelCashUnits != "9000000000" || r.Passive.FinalPositionValueUnits != "1100000000" || r.Passive.FinalEquityUnits != "10100000000" {
		t.Fatalf("passive %+v", r.Passive)
	}
	r, err = RunTrend50ComparisonCausal(context.Background(), "TEST", bars, "9.99999999", trend50Scenario())
	if err != nil || r.Passive.EntryStatus != FundedInsufficientModelCash || r.Passive.FinalModelQuantity != 0 {
		t.Fatalf("nonfill %+v %v", r.Passive, err)
	}
	_, err = RunTrend50ComparisonCausal(context.Background(), "TEST", bars, "0", ExecutionScenario{"9.99999999", "10000", "0", "0"})
	if e, ok := err.(*Trend50ComparisonError); !ok || e.Code != CausalNumericRange || e.BarIndex != 50 {
		t.Fatalf("zero target precedence: %v", err)
	}
}
func TestTrend50CoreEventOrder(t *testing.T) {
	buy := func(i int) strategies.SignalType {
		if i == 49 {
			return strategies.SignalBuy
		}
		if i == 50 {
			return strategies.SignalSell
		}
		return strategies.SignalHold
	}
	for _, tc := range []struct {
		name         string
		bars         []OHLCV
		stop, target float64
		reason       CausalFillReason
		ambiguous    bool
	}{
		{"sell", causalBars(52), 0, 0, CausalNextOpenSell, false},
		{"both", causalBars(51), 5, 5, CausalStopTouch, true},
		{"gap", causalBars(52), 5, 5, CausalStopGap, false},
	} {
		switch tc.name {
		case "both":
			causalSetBar(tc.bars, 50, 100, 106, 94, 100)
		case "gap":
			causalSetBar(tc.bars, 51, 94, 100, 94, 98)
		}
		r, s, err := trend50Core(t, tc.bars, 10000000000, causalScript(buy, tc.stop, tc.target), 100000000, 0, 100, 100)
		if err != nil {
			t.Fatalf("%s %v", tc.name, err)
		}
		if len(r.Fills) != 2 || r.Fills[0].BarIndex != 50 || r.Fills[1].Reason != tc.reason || r.Fills[1].Ambiguous != tc.ambiguous || len(s.result.CashFlows) != 2 || s.result.CashFlows[0].FeeUnits != "100000000" {
			t.Fatalf("%s fills=%+v flows=%+v", tc.name, r.Fills, s.result.CashFlows)
		}
	}
	r, s, err := trend50Core(t, causalBars(51), 10000000000, causalScript(buy, 0, 0), 100000000, 0, 100, 100)
	if err != nil || r.TerminalPosition == nil || len(r.Fills) != 1 || s.result.FinalModelQuantity <= 0 {
		t.Fatalf("open terminal: %+v %v", r, err)
	}
}
func TestTrend50ClosedAdmission(t *testing.T) {
	ctx := context.Background()
	bars := causalBars(50)
	fixture := causalNewStrategy()
	engine := NewStrategyEngine(fixture)
	st := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, 10000000000, 0, 0, fundedEntryUnits, 0, 0)
	for _, p := range []causalReplayProfile{causalProfileInvalid, 3, 255} {
		if _, err := engine.runCausalProfile(p, ctx, "TEST", bars, nil, nil, st); err == nil {
			t.Fatal("unknown profile accepted")
		}
		if newCausalExecutionScenarioStateForProfile(p, 0, 0, 0, 0, 0, 0) != nil {
			t.Fatal("unknown state")
		}
		if _, _, code, _ := comparisonControlsForProfile(p, ctx, "TEST", bars, 0, 0, 0, 0, 0); code == "" {
			t.Fatal("unknown control")
		}
	}
	if _, err := engine.runCausalProfile(causalProfileTrend50, ctx, "TEST", bars, nil, nil, st); err == nil || len(fixture.calls) != 0 {
		t.Fatal("foreign evaluator admitted")
	}
	actual := strategies.NewTrendConfluenceStrategy()
	actual.Init(nil)
	ae := NewStrategyEngine(actual)
	for _, states := range [][]*causalExecutionScenarioState{nil, {nil}, {st, st}} {
		if _, err := ae.runCausalProfile(causalProfileTrend50, ctx, "TEST", bars, nil, nil, states...); err == nil {
			t.Fatal("invalid states admitted")
		}
	}
	actual.BuyScoreThreshold = 74
	if _, err := ae.runCausalProfile(causalProfileTrend50, ctx, "TEST", bars, nil, nil, st); err == nil {
		t.Fatal("changed default admitted")
	}
	if _, err := NewStrategyEngine(strategies.NewTrendConfluenceStrategy()).RunCausal(ctx, "TEST", bars); err == nil {
		t.Fatal("old API changed warmup")
	}
}
func TestTrend50InputErrorsAndCancel(t *testing.T) {
	for _, tc := range []struct {
		bars         []OHLCV
		symbol, cash string
		scenario     ExecutionScenario
		code         CausalErrorCode
	}{
		{nil, "TEST", "100", trend50Scenario(), CausalInvalidInput}, {causalBars(10001), "TEST", "100", trend50Scenario(), CausalResourceLimit}, {causalBars(1), "bad", "100", trend50Scenario(), CausalInvalidSymbol}, {causalBars(1), "TEST", "-1", trend50Scenario(), FundedInvalidModelCash}, {causalBars(1), "TEST", "100", ExecutionScenario{"0", "0", "10000", "0"}, ExecutionScenarioInvalidScenario},
	} {
		r, err := RunTrend50ComparisonCausal(context.Background(), tc.symbol, tc.bars, tc.cash, tc.scenario)
		e, ok := err.(*Trend50ComparisonError)
		if !ok || e.Code != tc.code || !reflect.DeepEqual(r, Trend50ComparisonResult{}) {
			t.Fatalf("want %s got %+v %v", tc.code, r, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, err := RunTrend50ComparisonCausal(ctx, "TEST", causalBars(1), "100", trend50Scenario())
	if e, ok := err.(*Trend50ComparisonError); !ok || e.Code != CausalCanceled || !reflect.DeepEqual(r, Trend50ComparisonResult{}) {
		t.Fatalf("cancel: %+v %v", r, err)
	}
}

func TestTrend50PostValidationRejectsDetachedFields(t *testing.T) {
	bars := causalBars(51)
	initial := int64(10000000000)
	strategy := strategies.NewTrendConfluenceStrategy()
	strategy.Init(nil)
	engine := NewStrategyEngine(strategy)
	state := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, initial, 0, 0, fundedEntryUnits, 0, 0)
	replay, err := engine.runCausalProfile(causalProfileTrend50, context.Background(), "TEST", bars, nil, nil, state)
	if err != nil {
		t.Fatal(err)
	}
	state.result.ReferenceReplay = replay
	cash, passive, code, _ := comparisonControlsForProfile(causalProfileTrend50, context.Background(), "TEST", bars, initial, 0, 0, fundedEntryUnits, 0)
	if code != "" {
		t.Fatal(code)
	}
	check := func() bool {
		return trend50ResultConsistent(context.Background(), "TEST", bars, initial, state, cash, passive)
	}
	if !check() {
		t.Fatal("valid result rejected")
	}
	original := state.result
	for _, mutate := range []func(){
		func() { state.result.ModelIdentity = ExecutionScenarioCausalModelIdentity },
		func() {
			state.result.ReferenceReplay.Evaluations = append([]CausalEvaluation(nil), replay.Evaluations...)
			state.result.ReferenceReplay.Evaluations[0].PrefixLength = 20
		},
		func() {
			state.result.CloseMarks = append([]ExecutionScenarioCausalCloseMark(nil), original.CloseMarks...)
			state.result.CloseMarks[0].EquityUnits = "1"
		},
		func() { state.result.FinalPositionPrincipalUnits = "1" },
		func() { state.result.Scenario.FixedFeeUnits = "1" },
	} {
		state.result = original
		mutate()
		if check() {
			t.Fatal("detached result accepted")
		}
	}
	state.result = original
	saved := passive
	passive.ModelIdentity = ComparisonPassiveModelIdentity
	if check() {
		t.Fatal("old control accepted")
	}
	passive = saved
	if got := (&Trend50ComparisonError{Trend50InvalidResult, -1}).Error(); got != "trend50 comparison: invalid_result" {
		t.Fatal(got)
	}
}
func TestTrend50CoreProtectionFundingAndCancellation(t *testing.T) {
	buySell := func(i int) strategies.SignalType {
		if i == 49 {
			return strategies.SignalBuy
		}
		if i == 50 {
			return strategies.SignalSell
		}
		return strategies.SignalHold
	}
	bars := causalBars(52)
	causalSetBar(bars, 51, .01, .01, .01, .01)
	_, _, err := trend50Core(t, bars, 1000000000, causalScript(buySell, 0, 0), 100000000, 0, 0, 0)
	if e, ok := err.(*CausalError); !ok || e.Code != ExecutionScenarioInsufficientExitFeeCash || e.BarIndex != 51 {
		t.Fatalf("exit fee deficit: %v", err)
	}
	trail := causalBars(53)
	causalSetBar(trail, 50, 100, 110, 100, 108)
	causalSetBar(trail, 51, 110, 110, 104, 106)
	r, _, err := trend50Core(t, trail, 10000000000, causalScript(func(i int) strategies.SignalType {
		if i == 49 {
			return strategies.SignalBuy
		}
		return strategies.SignalHold
	}, 5, 0), 0, 0, 0, 0)
	if err != nil || len(r.Fills) != 2 || r.Fills[1].Reason != CausalStopTouch || r.Fills[1].BarIndex != 51 || r.Fills[1].EvaluationBarIndex != 50 {
		t.Fatalf("trailing stop %+v %v", r.Fills, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	fixture := causalNewStrategy()
	fixture.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
		cancel()
		return causalCompleteSignal(fixture.name, symbol, at), nil
	}
	state := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, 10000000000, 0, 0, fundedEntryUnits, 0, 0)
	_, err = NewStrategyEngine(fixture).runCausalCore(causalProfileTrend50, ctx, "TEST", causalBars(51), nil, nil, state)
	if e, ok := err.(*CausalError); !ok || e.Code != CausalCanceled || len(fixture.calls) != 1 {
		t.Fatalf("post callback cancellation: %v", err)
	}
}
func TestTrend50AdmissionRejectsMixedStatesAndPlan(t *testing.T) {
	bars := causalBars(50)
	state := newCausalExecutionScenarioStateForProfile(causalProfileTrend50, 10000000000, 0, 0, fundedEntryUnits, 0, 0)
	actual := strategies.NewTrendConfluenceStrategy()
	actual.Init(nil)
	engine := NewStrategyEngine(actual)
	if _, err := engine.runCausalProfile(causalProfileTrend50, context.Background(), "TEST", bars, &causalFundedState{}, nil, state); err == nil {
		t.Fatal("funded state admitted")
	}
	if _, err := engine.runCausalProfile(causalProfileTrend50, context.Background(), "TEST", bars, nil, &causalFeeScenarioState{}, state); err == nil {
		t.Fatal("fee state admitted")
	}
	plan := causalNewPlan()
	if _, err := NewPlanEngine(plan).runCausalProfile(causalProfileTrend50, context.Background(), "TEST", bars, nil, nil, state); err == nil || plan.calls != 0 {
		t.Fatal("plan admitted")
	}
}

func TestTrend50ShortTerminalAndDrawdown(t *testing.T) {
	bars := causalBars(51)
	r, err := RunTrend50ComparisonCausal(context.Background(), "TEST", bars[:50], "100", trend50Scenario())
	if err != nil {
		t.Fatal(err)
	}
	if !r.Strategy.ReferenceReplay.PendingSignalUnfilled || r.Strategy.ReferenceReplay.TerminalPosition != nil || len(r.Strategy.ReferenceReplay.Fills) != 0 || r.Passive.EntryStatus != "no_eligible_bar" {
		t.Fatal("50-bar terminal semantics")
	}
	r, err = RunTrend50ComparisonCausal(context.Background(), "TEST", bars, "100", ExecutionScenario{"1", "0", "0", "0"})
	if err != nil {
		t.Fatal(err)
	}
	dd := r.Passive.MaxCloseMarkDrawdown
	if dd.Percent == nil || *dd.Percent != 1 || dd.BarIndex == nil || *dd.BarIndex != 50 || r.Passive.FinalModelQuantity != .09 {
		t.Fatalf("fee drawdown: %+v", dd)
	}
}
func TestTrend50ActualNumericExtreme(t *testing.T) {
	bars := causalBars(50)
	for i := range bars {
		p := .01
		if i%2 == 0 {
			p = 1000000
		}
		bars[i].Open = p
		bars[i].High = p
		bars[i].Low = p
		bars[i].Close = p
	}
	r, err := RunTrend50ComparisonCausal(context.Background(), "TEST", bars, "100", trend50Scenario())
	if e, ok := err.(*Trend50ComparisonError); !ok || e.Code != CausalNumericRange || e.BarIndex != 49 || !reflect.DeepEqual(r, Trend50ComparisonResult{}) {
		t.Fatalf("extreme must fail bounded: %+v %v", r, err)
	}
}
func TestTrend50Old20WrapperMatchesCore(t *testing.T) {
	for _, n := range []int{1, 19, 20, 21, 10000} {
		bars := causalBars(n)
		a := NewStrategyEngine(causalNewStrategy())
		b := NewStrategyEngine(causalNewStrategy())
		old, oldErr := a.runCausal(context.Background(), "TEST", bars, nil, nil)
		core, coreErr := b.runCausalCore(causalProfileShipped20, context.Background(), "TEST", bars, nil, nil)
		if !reflect.DeepEqual(old, core) || !reflect.DeepEqual(oldErr, coreErr) {
			t.Fatalf("N=%d mismatch", n)
		}
	}
	a, b := NewPlanEngine(causalNewPlan()), NewPlanEngine(causalNewPlan())
	old, oldErr := a.runCausal(context.Background(), "TEST", causalBars(21), nil, nil)
	core, coreErr := b.runCausalCore(causalProfileShipped20, context.Background(), "TEST", causalBars(21), nil, nil)
	if !reflect.DeepEqual(old, core) || !reflect.DeepEqual(oldErr, coreErr) {
		t.Fatal("plan mismatch")
	}
}

func TestTrend50CoreDirectionalNoopsAndAdversePrices(t *testing.T) {
	signals := func(i int) strategies.SignalType {
		switch i {
		case 49, 50:
			return strategies.SignalBuy
		case 51, 52, 53:
			return strategies.SignalSell
		default:
			return strategies.SignalHold
		}
	}
	r, s, err := trend50Core(t, causalBars(54), 10000000000, causalScript(signals, 0, 0), 0, 0, 100, 100)
	if err != nil || len(r.Fills) != 2 || r.Fills[0].BarIndex != 50 || r.Fills[1].BarIndex != 52 || !r.PendingSignalUnfilled || r.TerminalPosition != nil {
		t.Fatalf("noops: %+v %v", r, err)
	}
	if len(s.result.CashFlows) != 2 || s.result.CashFlows[0].ExecutionPrice != 101 || s.result.CashFlows[1].ExecutionPrice != 99 || s.result.AggregateAdverseDifferenceUnits == "0" {
		t.Fatalf("adverse: %+v", s.result.CashFlows)
	}
}
