package main

import (
	"bytes"
	"context"
	"math"
	"reflect"
	"strconv"
	"testing"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

// Verify the pre-existing admission, mapping and score layers before testing
// the added original-reference-event condition.
func assertWindowPriorLayers(t *testing.T, r backtest.WindowComparisonResult, full []backtest.OHLCV, w backtest.DeclaredComparisonWindow) {
	t.Helper()
	ctx := context.Background()
	s, e, ok := windowCLISelection(ctx, full, w)
	if !ok {
		t.Fatal("selection")
	}
	offset := s - 20
	bars := full[offset:e]
	if !comparisonCLIResultValid(r.Replay, bars, "TEST", "100", comparisonCLIScenario()) || !windowCLIReferences(r.Replay, bars) {
		t.Fatal("prior comparison/reference layers")
	}
	for _, x := range []struct {
		model string
		marks []backtest.ExecutionScenarioCausalCloseMark
		got   backtest.WindowComparisonScore
	}{{r.Replay.Strategy.ModelIdentity, r.Replay.Strategy.CloseMarks, r.Strategy}, {r.Replay.Cash.ModelIdentity, r.Replay.Cash.CloseMarks, r.Cash}, {r.Replay.Passive.ModelIdentity, r.Replay.Passive.CloseMarks, r.Passive}} {
		want, ok := windowCLIScore(ctx, x.model, x.marks, 10000000000, offset)
		if !ok || !reflect.DeepEqual(want, x.got) {
			t.Fatal("prior score projection")
		}
	}
}

type windowProtectedFixture struct {
	*strategies.BreakoutVolStrategy
}

func (*windowProtectedFixture) Evaluate(_ context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
	sig := strategies.StrategySignal{StrategyName: "BreakoutVol", Symbol: symbol, Timestamp: at, AssetClass: strategies.AssetEquity, Signal: strategies.SignalHold, Score: 90, StopLossPct: 5, TargetPct: 20}
	if len(closes) == 20 {
		sig.Signal = strategies.SignalBuy
	}
	return sig, nil
}
func protectedWindow(t *testing.T, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) backtest.WindowComparisonResult {
	t.Helper()
	engine := backtest.NewStrategyEngine(&windowProtectedFixture{strategies.NewBreakoutVolStrategy()})
	r, err := engine.RunWindowComparisonCausal(nil, "TEST", bars, w, cash, s)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestWindowReferenceOmittedEntryBalanced(t *testing.T) {
	original, bars, w := windowCLIResult(t, "buy")
	flat, _, _ := windowCLIResult(t, "hold")
	if len(original.Replay.Strategy.ReferenceReplay.Fills) == 0 || original.Replay.Strategy.ReferenceReplay.Evaluations[0].Signal != strategies.SignalBuy {
		t.Fatal("BUY fixture")
	}
	flat.Replay.Strategy.ReferenceReplay.Evaluations = append([]backtest.CausalEvaluation(nil), original.Replay.Strategy.ReferenceReplay.Evaluations...)
	flat.Replay.Strategy.ReferenceReplay.PendingSignalUnfilled = original.Replay.Strategy.ReferenceReplay.PendingSignalUnfilled
	assertWindowPriorLayers(t, flat, bars, w)
	if windowCLIResultValid(nil, flat, bars, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("omitted entry accepted")
	}
	if _, ok := backtestCausalWindowComparisonSummary(nil, flat, bars, "TEST", w, "100", comparisonCLIScenario()); ok {
		t.Fatal("omitted entry summary")
	}
}
func TestWindowReferenceLowOnlyBalanced(t *testing.T) {
	bars := feeScenarioCLIBars(27, 100)
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 24, EndExclusiveUnix: 26}
	bars[23].Low = 90
	altered := append([]backtest.OHLCV(nil), bars...)
	altered[23].Low = 100
	original := protectedWindow(t, bars, w, "100", comparisonCLIScenario())
	alternate := protectedWindow(t, altered, w, "100", comparisonCLIScenario())
	if !reflect.DeepEqual(original.Replay.Strategy.ReferenceReplay.Evaluations, alternate.Replay.Strategy.ReferenceReplay.Evaluations) || !reflect.DeepEqual(original.Replay.Cash, alternate.Replay.Cash) || !reflect.DeepEqual(original.Replay.Passive, alternate.Replay.Passive) {
		t.Fatal("geometry isolation")
	}
	fills := original.Replay.Strategy.ReferenceReplay.Fills
	if len(fills) != 2 || fills[1].Reason != backtest.CausalStopTouch || fills[1].Price != 95 || fills[1].BarIndex != 20 || alternate.Replay.Strategy.ReferenceReplay.TerminalPosition == nil {
		t.Fatalf("fixture %+v", fills)
	}
	if !windowCLIResultValid(nil, original, bars, "TEST", w, "100", comparisonCLIScenario()) || !windowCLIResultValid(nil, alternate, altered, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("real results")
	}
	assertWindowPriorLayers(t, alternate, bars, w)
	if windowCLIResultValid(nil, alternate, bars, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("omitted low-touch exit accepted")
	}
	if _, ok := backtestCausalWindowComparisonSummary(nil, alternate, bars, "TEST", w, "100", comparisonCLIScenario()); ok {
		t.Fatal("low-only summary")
	}
}
func TestWindowReferenceAdmissionAndBounds(t *testing.T) {
	r, bars, w := windowCLIResult(t, "hold")
	s, e, ok := windowCLISelection(context.Background(), bars, w)
	if !ok {
		t.Fatal("selection")
	}
	consumed := bars[s-20 : e]
	check := func(ctx context.Context, x backtest.ExecutionScenarioCausalResult, b []backtest.OHLCV) bool {
		return windowReferenceEvents(ctx, b, x, 10000000000, 0, 0, 1000000000, 0, 0)
	}
	if !check(nil, r.Replay.Strategy, consumed) {
		t.Fatal("nil context valid")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if check(ctx, r.Replay.Strategy, consumed) {
		t.Fatal("cancel")
	}
	for _, v := range []float64{.009, 100, math.NaN(), math.Inf(1)} {
		x := cloneWindowCLI(t, r).Replay.Strategy
		x.ReferenceReplay.Evaluations[0].StopLossPct = v
		if check(nil, x, consumed) {
			t.Fatalf("stop %v", v)
		}
	}
	for _, v := range []float64{.009, 1000.01, math.NaN(), math.Inf(1)} {
		x := cloneWindowCLI(t, r).Replay.Strategy
		x.ReferenceReplay.Evaluations[0].TargetPct = v
		if check(nil, x, consumed) {
			t.Fatalf("target %v", v)
		}
	}
	for _, pair := range [][2]float64{{0, 0}, {.01, .01}, {99.99, 1000}} {
		x := cloneWindowCLI(t, r).Replay.Strategy
		for i := range x.ReferenceReplay.Evaluations {
			x.ReferenceReplay.Evaluations[i].StopLossPct = pair[0]
			x.ReferenceReplay.Evaluations[i].TargetPct = pair[1]
		}
		if !check(nil, x, consumed) {
			t.Fatalf("valid flat boundaries %+v", pair)
		}
	}
	x := cloneWindowCLI(t, r).Replay.Strategy
	x.ReferenceReplay.Evaluations = x.ReferenceReplay.Evaluations[:1]
	if check(nil, x, consumed) {
		t.Fatal("shape")
	}
	if check(nil, r.Replay.Strategy, nil) {
		t.Fatal("empty")
	}
	x = cloneWindowCLI(t, r).Replay.Strategy
	x.ReferenceReplay.Evaluations[0].BarIndex = -1
	if check(nil, x, consumed) {
		t.Fatal("index")
	}
}

type windowScriptFixture struct {
	*strategies.BreakoutVolStrategy
	script func(int) (strategies.SignalType, float64, float64)
}

func (s *windowScriptFixture) Evaluate(_ context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
	signal, stop, target := s.script(len(closes) - 1)
	return strategies.StrategySignal{StrategyName: "BreakoutVol", Symbol: symbol, Timestamp: at, AssetClass: strategies.AssetEquity, Signal: signal, Score: 90, StopLossPct: stop, TargetPct: target}, nil
}
func windowScriptResult(t *testing.T, bars []backtest.OHLCV, cash string, scenario backtest.ExecutionScenario, script func(int) (strategies.SignalType, float64, float64)) backtest.ExecutionScenarioCausalResult {
	t.Helper()
	engine := backtest.NewStrategyEngine(&windowScriptFixture{strategies.NewBreakoutVolStrategy(), script})
	r, err := engine.RunExecutionScenarioCausal(nil, "TEST", bars, cash, scenario)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func windowCheckReference(t *testing.T, bars []backtest.OHLCV, r backtest.ExecutionScenarioCausalResult, cash string, scenario backtest.ExecutionScenario) bool {
	t.Helper()
	initial, ok := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	if !ok {
		t.Fatal("cash")
	}
	fixed, bps, target, ok := executionScenarioCLIDeclaration(r.Scenario)
	if !ok {
		t.Fatal("declaration")
	}
	buy, ok := executionCLIAdverseRate(scenario.BuyAdverseBps)
	if !ok {
		t.Fatal("buy")
	}
	sell, ok := executionCLIAdverseRate(scenario.SellAdverseBps)
	if !ok {
		t.Fatal("sell")
	}
	return windowReferenceEvents(nil, bars, r, initial, fixed, bps, target, buy, sell)
}
func TestWindowReferenceEventOrderingAndFunding(t *testing.T) {
	scenario := comparisonCLIScenario()
	script := func(i int) (strategies.SignalType, float64, float64) {
		if i == 19 {
			return strategies.SignalBuy, 5, 20
		}
		if i == 20 {
			return strategies.SignalSell, 5, 20
		}
		return strategies.SignalHold, 5, 20
	}
	cases := []struct {
		name      string
		mutate    func([]backtest.OHLCV)
		reason    backtest.CausalFillReason
		price     float64
		ambiguous bool
	}{
		{"both", func(b []backtest.OHLCV) { b[20].Low = 90; b[20].High = 125 }, backtest.CausalStopTouch, 95, true},
		{"stop gap before sell", func(b []backtest.OHLCV) { b[21].Open = 90; b[21].Low = 90 }, backtest.CausalStopGap, 90, false},
		{"target gap before sell", func(b []backtest.OHLCV) { b[21].Open = 125; b[21].High = 125 }, backtest.CausalTargetGap, 120, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bars := feeScenarioCLIBars(22, 100)
			tc.mutate(bars)
			r := windowScriptResult(t, bars, "100", scenario, script)
			if len(r.ReferenceReplay.Fills) != 2 {
				t.Fatal("fixture fills")
			}
			f := r.ReferenceReplay.Fills[1]
			if f.Reason != tc.reason || f.Price != tc.price || f.Ambiguous != tc.ambiguous || !windowCheckReference(t, bars, r, "100", scenario) {
				t.Fatalf("%+v", f)
			}
			bad := r
			bad.ReferenceReplay.Fills = append([]backtest.CausalFill(nil), r.ReferenceReplay.Fills[:1]...)
			if windowCheckReference(t, bars, bad, "100", scenario) {
				t.Fatal("missing exit")
			}
		})
	}
	bars := feeScenarioCLIBars(22, 100)
	bars[20].High = 110
	bars[21].Open = 105
	bars[21].High = 105
	bars[21].Low = 104
	bars[21].Close = 105
	hold := func(i int) (strategies.SignalType, float64, float64) {
		if i == 19 {
			return strategies.SignalBuy, 5, 20
		}
		return strategies.SignalHold, 5, 20
	}
	r := windowScriptResult(t, bars, "100", scenario, hold)
	if len(r.ReferenceReplay.Fills) != 2 || r.ReferenceReplay.Fills[1].Reason != backtest.CausalStopTouch || r.ReferenceReplay.Fills[1].Price != 104.5 || r.ReferenceReplay.Fills[1].EvaluationBarIndex != 20 || !windowCheckReference(t, bars, r, "100", scenario) {
		t.Fatal("trailing source")
	}
	repeat := func(i int) (strategies.SignalType, float64, float64) {
		if i == 19 || i == 20 {
			return strategies.SignalBuy, 5, 20
		}
		return strategies.SignalSell, 5, 20
	}
	bars = feeScenarioCLIBars(22, 100)
	bars[21].Open = 90
	bars[21].Low = 90
	r = windowScriptResult(t, bars, "100", scenario, repeat)
	if len(r.ReferenceReplay.Fills) != 2 || r.ReferenceReplay.Fills[1].Reason != backtest.CausalStopGap || !windowCheckReference(t, bars, r, "100", scenario) {
		t.Fatal("exit prevents reentry")
	}
	for _, cash := range []string{"0", "9.99999999", "10"} {
		bars = feeScenarioCLIBars(21, 100)
		r = windowScriptResult(t, bars, cash, scenario, hold)
		if !windowCheckReference(t, bars, r, cash, scenario) {
			t.Fatal("funding", cash)
		}
		if cash == "10" && len(r.ReferenceReplay.Fills) != 1 || cash != "10" && len(r.RejectedEntries) != 1 {
			t.Fatal("funding fixture", cash)
		}
	}
	fees := backtest.ExecutionScenario{FixedFee: "1", FeeBps: "100", BuyAdverseBps: "100", SellAdverseBps: "100"}
	r = windowScriptResult(t, feeScenarioCLIBars(21, 100), "100", fees, hold)
	if !windowCheckReference(t, feeScenarioCLIBars(21, 100), r, "100", fees) {
		t.Fatal("fee adverse")
	}
	engine := backtest.NewStrategyEngine(&windowProtectedFixture{strategies.NewBreakoutVolStrategy()})
	_, err := engine.RunWindowComparisonCausal(nil, "TEST", feeScenarioCLIBars(21, 100), backtest.DeclaredComparisonWindow{StartInclusiveUnix: 21, EndExclusiveUnix: 22}, "0", backtest.ExecutionScenario{FixedFee: "9.99999999", FeeBps: "10000", BuyAdverseBps: "0", SellAdverseBps: "0"})
	if e, ok := err.(*backtest.WindowComparisonError); !ok || e.Code != backtest.CausalNumericRange {
		t.Fatalf("zero target before funding: %v", err)
	}
}

type windowCancelAfter struct {
	context.Context
	calls int
}

func (c *windowCancelAfter) Err() error {
	c.calls++
	if c.calls > 4 {
		return context.Canceled
	}
	return nil
}
func TestWindowReferenceCooperativeCancelAndMalformed(t *testing.T) {
	r, bars, w := windowCLIResult(t, "hold")
	s, e, _ := windowCLISelection(context.Background(), bars, w)
	bars = bars[s-20 : e]
	state := r.Replay.Strategy
	ctx := &windowCancelAfter{Context: context.Background()}
	if windowReferenceEvents(ctx, bars, state, 10000000000, 0, 0, 1000000000, 0, 0) || ctx.calls <= 4 {
		t.Fatal("during-validation cancellation")
	}
	bad := cloneWindowCLI(t, r).Replay.Strategy
	bad.ReferenceReplay.Fills = []backtest.CausalFill{{BarIndex: 99999}}
	if windowReferenceEvents(nil, bars, bad, 10000000000, 0, 0, 1000000000, 0, 0) {
		t.Fatal("bad fill index")
	}
	bad = cloneWindowCLI(t, r).Replay.Strategy
	bad.RejectedEntries = []backtest.ExecutionScenarioCausalRejectedEntry{{BarIndex: -1}}
	if windowReferenceEvents(nil, bars, bad, 10000000000, 0, 0, 1000000000, 0, 0) {
		t.Fatal("bad nonfill index")
	}
}

func TestWindowReferenceTerminalProtectionAndSelection(t *testing.T) {
	script := func(i int) (strategies.SignalType, float64, float64) {
		if i == 19 {
			return strategies.SignalBuy, 5, 20
		}
		return strategies.SignalBuy, 5, 30
	}
	bars := feeScenarioCLIBars(21, 100)
	r := windowScriptResult(t, bars, "100", comparisonCLIScenario(), script)
	p := r.ReferenceReplay.TerminalPosition
	if p == nil || p.Target != 130 || p.TargetEvaluationBarIndex != 20 || !r.ReferenceReplay.PendingSignalUnfilled || !windowCheckReference(t, bars, r, "100", comparisonCLIScenario()) {
		t.Fatalf("terminal %+v", p)
	}
	forged := r
	terminal := *p
	terminal.TargetEvaluationBarIndex = 19
	forged.ReferenceReplay.TerminalPosition = &terminal
	if windowCheckReference(t, bars, forged, "100", comparisonCLIScenario()) {
		t.Fatal("terminal target ref")
	}
	original, full, w := windowCLIResult(t, "hold")
	changed := append([]backtest.OHLCV(nil), full...)
	changed[0].Open = 99
	changed[0].Low = 99
	changed[26].High = 101
	if !windowCLIResultValid(nil, original, changed, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("valid excluded values altered result")
	}
	end := feeScenarioCLIBars(21, 100)
	for i := range end {
		end[i].Timestamp = 253402300799 - int64(20-i)
	}
	endWindow := backtest.DeclaredComparisonWindow{StartInclusiveUnix: end[20].Timestamp, EndExclusiveUnix: 253402300800}
	engine, _ := feeScenarioCLIEngine("hold")
	result, err := engine.RunWindowComparisonCausal(nil, "TEST", end, endWindow, "100", comparisonCLIScenario())
	if err != nil || !windowCLIResultValid(nil, result, end, "TEST", endWindow, "100", comparisonCLIScenario()) {
		t.Fatalf("maximum sentinel: %v", err)
	}
}

func TestWindowReferenceEverySignalDomain(t *testing.T) {
	r, full, w := windowCLIResult(t, "hold")
	s, e, _ := windowCLISelection(context.Background(), full, w)
	bars := full[s-20 : e]
	check := func(x backtest.ExecutionScenarioCausalResult) bool {
		return windowReferenceEvents(nil, bars, x, 10000000000, 0, 0, 1000000000, 0, 0)
	}
	for _, v := range []float64{-1, 100.01, math.NaN(), math.Inf(1)} {
		x := cloneWindowCLI(t, r).Replay.Strategy
		x.ReferenceReplay.Evaluations[len(x.ReferenceReplay.Evaluations)-1].Score = v
		if check(x) {
			t.Fatalf("score %v", v)
		}
	}
	x := cloneWindowCLI(t, r).Replay.Strategy
	x.ReferenceReplay.Evaluations[len(x.ReferenceReplay.Evaluations)-1].Signal = "INVALID"
	if check(x) {
		t.Fatal("invalid final signal")
	}
}
func TestWindowReferenceNilOutput(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(27))
	var stderr bytes.Buffer
	if runBacktestCausalWindowComparison(nil, []string{"BreakoutVol", "TEST", path, "24", "26", "100", "0", "0", "0", "0"}, nil, &stderr) != 1 || stderr.String() != "backtest-causal-window-compare: output_error\n" {
		t.Fatal("nil output")
	}
}

func TestWindowReferenceAlternateOpenAtMappedSourceIndex(t *testing.T) {
	bars := feeScenarioCLIBars(27, 100)
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 24, EndExclusiveUnix: 26}
	originalEngine, _ := feeScenarioCLIEngine("buy")
	original, err := originalEngine.RunWindowComparisonCausal(nil, "TEST", bars, w, "100", comparisonCLIScenario())
	if err != nil {
		t.Fatal(err)
	}
	altered := append([]backtest.OHLCV(nil), bars...)
	altered[23].Open = 99
	altered[23].Low = 99
	engine, _ := feeScenarioCLIEngine("buy")
	forged, err := engine.RunWindowComparisonCausal(nil, "TEST", altered, w, "100", comparisonCLIScenario())
	if err != nil {
		t.Fatal(err)
	}
	if forged.WarmupStartSourceIndex != 3 || forged.ScoreStartSourceIndex != 23 || forged.Replay.Strategy.ReferenceReplay.Fills[0].BarIndex != 20 || !reflect.DeepEqual(original.Replay.Strategy.ReferenceReplay.Evaluations, forged.Replay.Strategy.ReferenceReplay.Evaluations) {
		t.Fatal("mapping fixture")
	}
	if !windowCLIResultValid(nil, forged, altered, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("alternate input invalid")
	}
	forged.Replay.Cash = original.Replay.Cash
	forged.Replay.Passive = original.Replay.Passive
	forged.Cash = original.Cash
	forged.Passive = original.Passive
	equity, ok := fundedCLIUnits(forged.Replay.Strategy.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		t.Fatal("equity")
	}
	passive, ok := fundedCLIUnits(original.Replay.Passive.FinalEquityUnits, false, fundedCLIMaxEquity)
	if !ok {
		t.Fatal("passive")
	}
	forged.Replay.StrategyMinusCashUnits = strconv.FormatInt(equity-10000000000, 10)
	forged.Replay.StrategyMinusPassiveUnits = strconv.FormatInt(equity-passive, 10)
	assertWindowPriorLayers(t, forged, bars, w)
	if windowCLIResultValid(nil, forged, bars, "TEST", w, "100", comparisonCLIScenario()) {
		t.Fatal("source23 open mismatch accepted")
	}
}

func TestWindowReferenceOmittedNonfillAndExitFeeFailure(t *testing.T) {
	buy := func(i int) (strategies.SignalType, float64, float64) {
		if i == 19 {
			return strategies.SignalBuy, 0, 0
		}
		return strategies.SignalHold, 0, 0
	}
	bars := feeScenarioCLIBars(21, 100)
	r := windowScriptResult(t, bars, "0", comparisonCLIScenario(), buy)
	if len(r.RejectedEntries) != 1 || !windowCheckReference(t, bars, r, "0", comparisonCLIScenario()) {
		t.Fatal("nonfill fixture")
	}
	r.RejectedEntries = nil
	if windowCheckReference(t, bars, r, "0", comparisonCLIScenario()) {
		t.Fatal("omitted nonfill accepted")
	}
	sell := func(i int) (strategies.SignalType, float64, float64) {
		if i == 19 {
			return strategies.SignalBuy, 0, 0
		}
		if i == 20 {
			return strategies.SignalSell, 0, 0
		}
		return strategies.SignalHold, 0, 0
	}
	bars = feeScenarioCLIBars(22, 100)
	bars[21].Open = .01
	bars[21].High = .01
	bars[21].Low = .01
	bars[21].Close = .01
	engine := backtest.NewStrategyEngine(&windowScriptFixture{strategies.NewBreakoutVolStrategy(), sell})
	result, err := engine.RunExecutionScenarioCausal(nil, "TEST", bars, "10", backtest.ExecutionScenario{FixedFee: "1", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"})
	if e, ok := err.(*backtest.ExecutionScenarioCausalError); !ok || e.Code != backtest.ExecutionScenarioInsufficientExitFeeCash || !reflect.DeepEqual(result, backtest.ExecutionScenarioCausalResult{}) {
		t.Fatalf("exit fee deficit: %v", err)
	}
	flatSell := func(int) (strategies.SignalType, float64, float64) { return strategies.SignalSell, 0, 0 }
	r = windowScriptResult(t, feeScenarioCLIBars(21, 100), "100", comparisonCLIScenario(), flatSell)
	if len(r.ReferenceReplay.Fills) != 0 || !r.ReferenceReplay.PendingSignalUnfilled || !windowCheckReference(t, feeScenarioCLIBars(21, 100), r, "100", comparisonCLIScenario()) {
		t.Fatal("flat sell noop")
	}
}
