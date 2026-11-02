package backtest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"strings"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/plans"
	"gelt/pkg/strategies"
)

type causalRecordedCall struct {
	at     time.Time
	symbol string
	length int
	closes []float64
	volume []float64
}

type causalTestStrategy struct {
	name       string
	calls      []causalRecordedCall
	keepPrefix bool
	fn         func(context.Context, time.Time, string, []float64, []float64) (strategies.StrategySignal, error)
}

func causalNewStrategy() *causalTestStrategy {
	return &causalTestStrategy{name: "Causal Local"}
}

func (s *causalTestStrategy) Name() string                   { return s.name }
func (*causalTestStrategy) Description() string              { return "local causal fixture" }
func (*causalTestStrategy) Init(*data.FeatureRegistry) error { return nil }
func (*causalTestStrategy) SetParams(map[string]float64)     {}
func (*causalTestStrategy) CapitalRequirement() float64      { return 0 }
func (*causalTestStrategy) IsIntradayOnly() bool             { return true }

func causalCompleteSignal(name, symbol string, at time.Time) strategies.StrategySignal {
	return strategies.StrategySignal{
		StrategyName: name, Symbol: symbol, Timestamp: at,
		AssetClass: strategies.AssetEquity, Signal: strategies.SignalHold,
		Score: 50, StopLossPct: 0, TargetPct: 0,
		BuyThreshold: 75, SellThreshold: 35,
	}
}

func (s *causalTestStrategy) Evaluate(
	ctx context.Context, at time.Time, symbol string, closes, volumes []float64,
) (strategies.StrategySignal, error) {
	call := causalRecordedCall{at: at, symbol: symbol, length: len(closes)}
	if s.keepPrefix {
		call.closes = append([]float64(nil), closes...)
		call.volume = append([]float64(nil), volumes...)
	}
	s.calls = append(s.calls, call)
	if s.fn != nil {
		return s.fn(ctx, at, symbol, closes, volumes)
	}
	return causalCompleteSignal(s.name, symbol, at), nil
}

type causalTestPlan struct {
	name    string
	members []plans.WeightedStrategy
	calls   int
	err     error
	after   func(*plans.PlanEvaluation)
}

func causalNewPlan() *causalTestPlan {
	a, b := causalNewStrategy(), causalNewStrategy()
	a.name, b.name = "Child A", "Child B"
	return &causalTestPlan{
		name: "Causal Plan",
		members: []plans.WeightedStrategy{
			{Strategy: b, Weight: 0.25},
			{Strategy: a, Weight: 0.75},
		},
	}
}

func (p *causalTestPlan) Name() string                         { return p.name }
func (*causalTestPlan) Description() string                    { return "local causal plan fixture" }
func (*causalTestPlan) Init(*data.FeatureRegistry) error       { return nil }
func (p *causalTestPlan) Strategies() []plans.WeightedStrategy { return p.members }

func (p *causalTestPlan) Evaluate(
	ctx context.Context, at time.Time, symbol string, closes, volumes []float64,
) (plans.PlanEvaluation, error) {
	p.calls++
	if p.err != nil {
		return plans.PlanEvaluation{}, p.err
	}
	out := plans.PlanEvaluation{
		PlanName: p.name, Symbol: symbol, Timestamp: at,
		AssetClass: strategies.AssetEquity, ConsensusSignal: strategies.SignalHold,
		WeightedScore: 50, StopLossPct: 0, TargetPct: 0,
	}
	for _, member := range p.members {
		signal, err := member.Strategy.Evaluate(ctx, at, symbol, closes, volumes)
		if err != nil {
			return plans.PlanEvaluation{}, err
		}
		out.StrategySignals = append(out.StrategySignals, signal)
	}
	if p.after != nil {
		p.after(&out)
	}
	return out, nil
}

func causalBars(n int) []OHLCV {
	out := make([]OHLCV, n)
	for i := range out {
		out[i] = OHLCV{
			Timestamp: 1700000000 + int64(i)*60,
			Open:      100, High: 100, Low: 100, Close: 100, Volume: 1000,
		}
	}
	return out
}

func causalSetBar(bars []OHLCV, i int, open, high, low, close float64) {
	bars[i].Open, bars[i].High, bars[i].Low, bars[i].Close = open, high, low, close
}

func causalScript(
	signal func(int) strategies.SignalType, stop, target float64,
) *causalTestStrategy {
	s := causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		out.Signal, out.StopLossPct, out.TargetPct = signal(len(closes)-1), stop, target
		return out, nil
	}
	return s
}

func causalBuyThenHold(index int) strategies.SignalType {
	if index == 19 {
		return strategies.SignalBuy
	}
	return strategies.SignalHold
}

func causalRun(t *testing.T, engine *Engine, bars []OHLCV) CausalResult {
	t.Helper()
	result, err := engine.RunCausal(context.Background(), "TEST", bars)
	if err != nil {
		t.Fatalf("unexpected causal failure: %v", err)
	}
	if result.ModelIdentity != "gelt.legacy-go.close-next-open.v1" ||
		result.CostIdentity != "frictionless_diagnostic" ||
		result.DataLabel != "unqualified_offline" ||
		result.AuthorityLabel != "unqualified_offline" {
		t.Fatalf("incorrect model labels: %+v", result)
	}
	return result
}

func causalWantFailure(t *testing.T, result CausalResult, err error, code CausalErrorCode, index int) {
	t.Helper()
	if !reflect.DeepEqual(result, CausalResult{}) {
		t.Fatalf("failure returned a partial result: %+v", result)
	}
	var bounded *CausalError
	if !errors.As(err, &bounded) || bounded.Code != code || bounded.BarIndex != index {
		t.Fatalf("wanted %s at %d; got %T %v", code, index, err, err)
	}
	if bounded.BarIndex < -1 || bounded.BarIndex >= CausalMaxBars {
		t.Fatalf("unbounded error index: %d", bounded.BarIndex)
	}
	if len(err.Error()) > 80 || strings.Contains(err.Error(), "SECRET") {
		t.Fatalf("unsanitized error: %q", err.Error())
	}
}

// Expected values are independent rational/decimal constants, never a replay
// of runner computations. These tolerances do not participate in touch tests.
func causalOracle(t *testing.T, got float64, expected, kind string) {
	t.Helper()
	rational, ok := new(big.Rat).SetString(expected)
	if !ok {
		t.Fatalf("bad test oracle %q", expected)
	}
	want, _ := rational.Float64()
	base := 1e-8
	if kind == "quantity" {
		base = 1e-12
	} else if kind == "factor" {
		base = 1e-10
	}
	if math.IsNaN(got) || math.IsInf(got, 0) || math.Abs(got-want) > base+1e-12*math.Abs(want) {
		t.Fatalf("%s: got %.17g, wanted %s", kind, got, expected)
	}
}

func TestCausalWarmupNextOpenAndTerminal(t *testing.T) {
	for _, count := range []int{1, 19, 20, 21} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			bars := causalBars(count)
			if count == 21 {
				causalSetBar(bars, 20, 110, 115, 110, 115)
			}
			s := causalScript(causalBuyThenHold, 0, 0)
			result := causalRun(t, NewStrategyEngine(s), bars)
			wantEvaluations := count - 19
			if wantEvaluations < 0 {
				wantEvaluations = 0
			}
			if result.TotalBars != count || len(result.Evaluations) != wantEvaluations ||
				len(s.calls) != wantEvaluations {
				t.Fatalf("warmup/call count mismatch: %+v calls=%d", result, len(s.calls))
			}
			for i, evaluation := range result.Evaluations {
				index := i + 19
				if evaluation.BarIndex != index || evaluation.PrefixLength != index+1 ||
					!evaluation.Timestamp.Equal(time.Unix(bars[index].Timestamp, 0)) ||
					s.calls[i].length != index+1 || s.calls[i].symbol != "TEST" ||
					!s.calls[i].at.Equal(evaluation.Timestamp) {
					t.Fatalf("incorrect evaluation lineage: %+v", evaluation)
				}
			}
			if result.ClosedTradeCount != 0 || result.GrossProfitFactor != nil ||
				result.GrossProfitFactorReason != CausalNoClosedTrades {
				t.Fatalf("unfilled/terminal mark counted as closed: %+v", result)
			}
			if count < 21 {
				if len(result.Fills) != 0 || result.TerminalPosition != nil ||
					result.PendingSignalUnfilled != (count == 20) {
					t.Fatalf("premature fill: %+v", result)
				}
				return
			}
			if len(result.Fills) != 1 || result.PendingSignalUnfilled {
				t.Fatalf("incorrect next-open result: %+v", result)
			}
			fill := result.Fills[0]
			if fill.Kind != CausalEntry || fill.Reason != CausalNextOpenBuy ||
				fill.Price != 110 || fill.BarIndex != 20 || fill.EvaluationBarIndex != 19 ||
				fill.EntrySignalBarIndex != 19 || fill.EntryBarIndex != 20 ||
				!fill.Timestamp.Equal(time.Unix(bars[20].Timestamp, 0)) {
				t.Fatalf("incorrect fill lineage: %+v", fill)
			}
			causalOracle(t, fill.Quantity, "1/11", "quantity")
			causalOracle(t, fill.Notional, "10", "money")
			terminal := result.TerminalPosition
			if terminal == nil || terminal.EntryPrice != 110 || terminal.LastClosePrice != 115 ||
				terminal.StopLoss != 0 || terminal.Target != 0 ||
				terminal.StopEvaluationBarIndex != -1 || terminal.TargetEvaluationBarIndex != -1 ||
				terminal.EntrySignalBarIndex != 19 || terminal.EntryBarIndex != 20 ||
				terminal.LastBarIndex != 20 ||
				!terminal.EntrySignalTimestamp.Equal(time.Unix(bars[19].Timestamp, 0)) ||
				!terminal.EntryTimestamp.Equal(fill.Timestamp) ||
				!terminal.LastTimestamp.Equal(fill.Timestamp) {
				t.Fatalf("incorrect terminal evidence: %+v", terminal)
			}
			causalOracle(t, terminal.GrossUnrealizedPnL, "5/11", "money")
		})
	}
}

func TestCausalProtectionOrderingHandOracles(t *testing.T) {
	cases := []struct {
		name       string
		open, high float64
		low, close float64
		reason     CausalFillReason
		price, pnl string
		ambiguous  bool
		queueSell  bool
		source     int
	}{
		{"ordinary stop", 100, 103, 94, 100, CausalStopTouch, "95", "-1/2", false, false, 19},
		{"opening stop gap", 90, 92, 88, 90, CausalStopGap, "90", "-1", false, true, 19},
		{"ordinary target", 100, 111, 96, 105, CausalTargetTouch, "110", "1", false, false, 19},
		{"opening target gap", 115, 116, 114, 115, CausalTargetGap, "110", "1", false, true, 19},
		{"both touched", 100, 115, 90, 100, CausalStopTouch, "95", "-1/2", true, false, 19},
		{"queued market exit before later intrabar touches", 100, 115, 90, 100, CausalNextOpenSell, "100", "0", false, true, 20},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bars := causalBars(22)
			causalSetBar(bars, 21, tc.open, tc.high, tc.low, tc.close)
			s := causalScript(func(i int) strategies.SignalType {
				if i == 19 {
					return strategies.SignalBuy
				}
				// Only opening protection precedes the queued market exit.
				if i == 20 && tc.queueSell {
					return strategies.SignalSell
				}
				return strategies.SignalHold
			}, 5, 10)
			result := causalRun(t, NewStrategyEngine(s), bars)
			if len(result.Fills) != 2 || result.ClosedTradeCount != 1 ||
				result.TerminalPosition != nil || len(s.calls) != 3 {
				t.Fatalf("incorrect exit accounting/evaluation count: %+v", result)
			}
			exit := result.Fills[1]
			if exit.Kind != CausalExit || exit.Reason != tc.reason ||
				exit.BarIndex != 21 || exit.EvaluationBarIndex != tc.source ||
				exit.Ambiguous != tc.ambiguous {
				t.Fatalf("incorrect protection ordering: %+v", exit)
			}
			causalOracle(t, exit.Price, tc.price, "price")
			causalOracle(t, exit.GrossRealizedPnL, tc.pnl, "money")
			causalOracle(t, result.GrossRealizedPnL, tc.pnl, "money")
			if tc.pnl[0] == '-' {
				if result.WinningClosedTradeCount != 0 || result.GrossProfitFactor == nil ||
					result.GrossProfitFactorReason != "" {
					t.Fatalf("incorrect losing-trade factor: %+v", result)
				}
				causalOracle(t, *result.GrossProfitFactor, "0", "factor")
			} else if result.WinningClosedTradeCount != func() int {
				if tc.pnl == "0" {
					return 0
				}
				return 1
			}() || result.GrossProfitFactor != nil ||
				result.GrossProfitFactorReason != CausalNoLosingClosedTrades {
				t.Fatalf("incorrect no-loss factor: %+v", result)
			}
		})
	}
}

func TestCausalSameBarEntryCollisionAndNoReentry(t *testing.T) {
	bars := causalBars(21)
	causalSetBar(bars, 20, 100, 115, 90, 100)
	s := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 5, 10)
	result := causalRun(t, NewStrategyEngine(s), bars)
	if len(result.Fills) != 2 || result.Fills[0].Kind != CausalEntry ||
		result.Fills[1].Kind != CausalExit || result.Fills[1].Reason != CausalStopTouch ||
		!result.Fills[1].Ambiguous || result.Fills[0].BarIndex != 20 ||
		result.Fills[1].BarIndex != 20 || result.ClosedTradeCount != 1 ||
		result.TerminalPosition != nil || !result.PendingSignalUnfilled || len(s.calls) != 2 {
		t.Fatalf("incorrect same-bar collision: %+v", result)
	}
	causalOracle(t, result.GrossRealizedPnL, "-1/2", "money")
}

func TestCausalTrailingStopOnlyAppliesOnNextBar(t *testing.T) {
	bars := causalBars(22)
	causalSetBar(bars, 20, 100, 110, 96, 105)
	causalSetBar(bars, 21, 105, 106, 104, 105)
	s := causalScript(causalBuyThenHold, 5, 20)
	result := causalRun(t, NewStrategyEngine(s), bars)
	if len(result.Fills) != 2 || result.Fills[1].BarIndex != 21 ||
		result.Fills[1].Reason != CausalStopTouch ||
		result.Fills[1].EvaluationBarIndex != 20 || len(s.calls) != 3 {
		t.Fatalf("retrospective or duplicate close evaluation: %+v", result)
	}
	causalOracle(t, result.Fills[1].Price, "104.5", "price")
	causalOracle(t, result.GrossRealizedPnL, "0.45", "money")
}

func TestCausalExplicitExitNoOpsAndFinalSignal(t *testing.T) {
	bars := causalBars(23)
	causalSetBar(bars, 22, 107, 107, 107, 107)
	s := causalScript(func(i int) strategies.SignalType {
		switch i {
		case 19, 20:
			return strategies.SignalBuy
		default:
			return strategies.SignalSell
		}
	}, 0, 0)
	result := causalRun(t, NewStrategyEngine(s), bars)
	if len(result.Fills) != 2 || result.Fills[1].Reason != CausalNextOpenSell ||
		result.Fills[1].EvaluationBarIndex != 21 || result.Fills[1].BarIndex != 22 ||
		result.TerminalPosition != nil || !result.PendingSignalUnfilled {
		t.Fatalf("incorrect explicit exit/no-op handling: %+v", result)
	}
	causalOracle(t, result.GrossRealizedPnL, "0.7", "money")

	flatSell := causalScript(func(int) strategies.SignalType { return strategies.SignalSell }, 0, 0)
	flat := causalRun(t, NewStrategyEngine(flatSell), causalBars(22))
	if len(flat.Fills) != 0 || flat.ClosedTradeCount != 0 || !flat.PendingSignalUnfilled {
		t.Fatalf("SELL while flat created a trade: %+v", flat)
	}

	reentryBars := causalBars(22)
	causalSetBar(reentryBars, 21, 90, 100, 90, 100)
	reentry := causalScript(func(int) strategies.SignalType { return strategies.SignalBuy }, 5, 20)
	exited := causalRun(t, NewStrategyEngine(reentry), reentryBars)
	if len(exited.Fills) != 2 || exited.Fills[1].Reason != CausalStopGap ||
		exited.TerminalPosition != nil || len(exited.Evaluations) != 3 {
		t.Fatalf("opening exit allowed same-bar reentry: %+v", exited)
	}
}

func TestCausalDisabledActivationAndEnabledZeroRejection(t *testing.T) {
	bars := causalBars(22)
	causalSetBar(bars, 20, 100, 110, 90, 100)
	causalSetBar(bars, 21, 100, 101, 98, 100)
	s := causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		if len(closes) == 20 {
			out.Signal = strategies.SignalBuy
		} else {
			out.StopLossPct, out.TargetPct = 10, 20
		}
		return out, nil
	}
	result := causalRun(t, NewStrategyEngine(s), bars)
	if len(result.Fills) != 2 || result.Fills[0].StopLoss != 0 ||
		result.Fills[0].Target != 0 || result.Fills[1].BarIndex != 21 ||
		result.Fills[1].EvaluationBarIndex != 20 || result.Fills[1].Reason != CausalStopTouch {
		t.Fatalf("disabled protection applied retroactively or never activated: %+v", result)
	}
	causalOracle(t, result.Fills[1].Price, "99", "price")

	for _, which := range []string{"stop", "target"} {
		t.Run(which, func(t *testing.T) {
			s := causalNewStrategy()
			s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				if len(closes) == 20 {
					out.Signal = strategies.SignalBuy
					if which == "stop" {
						out.StopLossPct = 5
					} else {
						out.TargetPct = 20
					}
				}
				return out, nil
			}
			result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(21))
			causalWantFailure(t, result, err, CausalUnsupported, 20)
		})
	}
}

func TestCausalStopRatchetCannotLoosen(t *testing.T) {
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
		}
		if len(closes) >= 22 {
			out.StopLossPct = 20
		}
		return out, nil
	}
	result := causalRun(t, NewStrategyEngine(s), bars)
	if len(result.Fills) != 2 || result.Fills[1].BarIndex != 22 ||
		result.Fills[1].EvaluationBarIndex != 20 {
		t.Fatalf("stop loosened or lineage changed without ratchet: %+v", result)
	}
	causalOracle(t, result.Fills[1].Price, "104.5", "price")
}

func TestCausalDirectTouchesHaveNoEpsilon(t *testing.T) {
	for _, target := range []bool{false, true} {
		for _, side := range []int{-1, 0, 1} {
			t.Run(fmt.Sprintf("target=%t/side=%d", target, side), func(t *testing.T) {
				level := 95.0
				if target {
					level = 110
				}
				touch := level
				if side < 0 {
					touch = math.Nextafter(level, math.Inf(-1))
				} else if side > 0 {
					touch = math.Nextafter(level, math.Inf(1))
				}
				bars := causalBars(21)
				if target {
					causalSetBar(bars, 20, 100, touch, 100, 100)
				} else {
					causalSetBar(bars, 20, 100, 100, touch, 100)
				}
				result := causalRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 5, 10)), bars)
				wantHit := side <= 0
				wantReason := CausalStopTouch
				if target {
					wantHit, wantReason = side >= 0, CausalTargetTouch
				}
				if (len(result.Fills) == 2) != wantHit {
					t.Fatalf("touch predicate broadened: touch=%.17g fills=%+v", touch, result.Fills)
				}
				if wantHit && (result.Fills[1].Price != level || result.Fills[1].Reason != wantReason) {
					t.Fatalf("touch fill changed level: %+v", result.Fills[1])
				}
			})
		}
	}

	for _, stop := range []bool{false, true} {
		for _, side := range []int{-1, 0, 1} {
			t.Run(fmt.Sprintf("opening-stop=%t/side=%d", stop, side), func(t *testing.T) {
				level := 110.0
				if stop {
					level = 95
				}
				open := level
				if side < 0 {
					open = math.Nextafter(level, math.Inf(-1))
				} else if side > 0 {
					open = math.Nextafter(level, math.Inf(1))
				}
				bars := causalBars(22)
				causalSetBar(bars, 21, open, open, open, open)
				result := causalRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 5, 10)), bars)
				wantHit := side >= 0
				if stop {
					wantHit = side <= 0
				}
				if (len(result.Fills) == 2) != wantHit {
					t.Fatalf("opening predicate broadened: %+v", result)
				}
				if wantHit {
					wantPrice, wantReason := level, CausalTargetGap
					if stop {
						wantPrice, wantReason = open, CausalStopGap
					}
					if result.Fills[1].Price != wantPrice || result.Fills[1].Reason != wantReason {
						t.Fatalf("incorrect exact opening fill: %+v", result.Fills[1])
					}
				}
			})
		}
	}
}

type causalIdentityMutation struct {
	name string
	sig  func(*strategies.StrategySignal)
	plan func(*plans.PlanEvaluation)
}

func causalIdentityMutations() []causalIdentityMutation {
	return []causalIdentityMutation{
		{"name case", func(s *strategies.StrategySignal) { s.StrategyName = strings.ToLower(s.StrategyName) },
			func(p *plans.PlanEvaluation) { p.PlanName = strings.ToLower(p.PlanName) }},
		{"name empty", func(s *strategies.StrategySignal) { s.StrategyName = "" },
			func(p *plans.PlanEvaluation) { p.PlanName = "" }},
		{"name long suffix", func(s *strategies.StrategySignal) { s.StrategyName += strings.Repeat("X", 129) },
			func(p *plans.PlanEvaluation) { p.PlanName += strings.Repeat("X", 129) }},
		{"symbol", func(s *strategies.StrategySignal) { s.Symbol = "SECRET" },
			func(p *plans.PlanEvaluation) { p.Symbol = "SECRET" }},
		{"symbol case", func(s *strategies.StrategySignal) { s.Symbol = "test" },
			func(p *plans.PlanEvaluation) { p.Symbol = "test" }},
		{"time zero", func(s *strategies.StrategySignal) { s.Timestamp = time.Time{} },
			func(p *plans.PlanEvaluation) { p.Timestamp = time.Time{} }},
		{"time second", func(s *strategies.StrategySignal) { s.Timestamp = s.Timestamp.Add(time.Second) },
			func(p *plans.PlanEvaluation) { p.Timestamp = p.Timestamp.Add(time.Second) }},
		{"time nanosecond", func(s *strategies.StrategySignal) { s.Timestamp = s.Timestamp.Add(time.Nanosecond) },
			func(p *plans.PlanEvaluation) { p.Timestamp = p.Timestamp.Add(time.Nanosecond) }},
		{"asset empty", func(s *strategies.StrategySignal) { s.AssetClass = "" },
			func(p *plans.PlanEvaluation) { p.AssetClass = "" }},
		{"asset crypto", func(s *strategies.StrategySignal) { s.AssetClass = strategies.AssetCrypto },
			func(p *plans.PlanEvaluation) { p.AssetClass = strategies.AssetCrypto }},
	}
}

func TestCausalExactIdentityMatrices(t *testing.T) {
	for _, mutation := range causalIdentityMutations() {
		t.Run("standalone/"+mutation.name, func(t *testing.T) {
			s := causalNewStrategy()
			s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				mutation.sig(&out)
				return out, nil
			}
			result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(20))
			causalWantFailure(t, result, err, CausalEvaluatorIdentity, 19)
		})
		t.Run("top plan/"+mutation.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = mutation.plan
			result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
			causalWantFailure(t, result, err, CausalEvaluatorIdentity, 19)
		})
		t.Run("component/"+mutation.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = func(out *plans.PlanEvaluation) { mutation.sig(&out.StrategySignals[0]) }
			result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
			causalWantFailure(t, result, err, CausalEvaluatorIdentity, 19)
		})
	}
}

func TestCausalSameInstantDifferentTimezoneAndBoundedNames(t *testing.T) {
	for _, mode := range []string{"strategy", "plan"} {
		t.Run(mode, func(t *testing.T) {
			location := time.FixedZone("equivalent", -7*60*60)
			if mode == "strategy" {
				s := causalNewStrategy()
				s.name = strings.Repeat("A", 128)
				s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
					return causalCompleteSignal(s.name, symbol, at.In(location)), nil
				}
				result := causalRun(t, NewStrategyEngine(s), causalBars(20))
				if result.TargetName != s.name || result.Evaluations[0].Timestamp.Location() != time.UTC {
					t.Fatalf("name/time normalization failure: %+v", result)
				}
			} else {
				p := causalNewPlan()
				p.name = strings.Repeat("P", 128)
				p.after = func(out *plans.PlanEvaluation) {
					out.Timestamp = out.Timestamp.In(location)
					for i := range out.StrategySignals {
						out.StrategySignals[i].Timestamp = out.StrategySignals[i].Timestamp.In(location)
					}
				}
				result := causalRun(t, NewPlanEngine(p), causalBars(20))
				if result.TargetName != p.name || len(result.Evaluations[0].Components) != 2 ||
					result.Evaluations[0].Components[0].Name != "Child A" ||
					result.Evaluations[0].Components[1].Name != "Child B" {
					t.Fatalf("valid plan identity rejected or membership order incorrect: %+v", result)
				}
				for _, child := range result.Evaluations[0].Components {
					if child.Timestamp.Location() != time.UTC {
						t.Fatal("component did not retain canonical supplied instant")
					}
				}
			}
		})
	}

	p := causalNewPlan()
	a, b := p.members[0].Strategy.(*causalTestStrategy), p.members[1].Strategy.(*causalTestStrategy)
	a.name, b.name = strings.Repeat("X", 127)+"A", strings.Repeat("X", 127)+"B"
	result := causalRun(t, NewPlanEngine(p), causalBars(20))
	if len(result.Evaluations[0].Components) != 2 ||
		result.Evaluations[0].Components[0].Name == result.Evaluations[0].Components[1].Name {
		t.Fatal("bounded names were truncated into a collision")
	}
}

func TestCausalPlanCompleteSetsAndMembershipChanges(t *testing.T) {
	cases := []struct {
		name string
		code CausalErrorCode
		edit func(*causalTestPlan, *plans.PlanEvaluation)
	}{
		{"incomplete", CausalPlanMembership, func(_ *causalTestPlan, out *plans.PlanEvaluation) {
			out.ConsensusSignal = strategies.SignalBuy
			out.StrategySignals = out.StrategySignals[:1]
		}},
		{"duplicate", CausalEvaluatorIdentity, func(_ *causalTestPlan, out *plans.PlanEvaluation) {
			out.StrategySignals[1] = out.StrategySignals[0]
		}},
		{"foreign", CausalEvaluatorIdentity, func(_ *causalTestPlan, out *plans.PlanEvaluation) {
			out.StrategySignals[0].StrategyName = "Foreign SECRET"
		}},
		{"membership removed", CausalPlanMembership, func(p *causalTestPlan, _ *plans.PlanEvaluation) {
			p.members = p.members[:1]
		}},
		{"weight changed", CausalPlanMembership, func(p *causalTestPlan, _ *plans.PlanEvaluation) {
			p.members[0].Weight = 0.5
		}},
		{"child renamed", CausalPlanMembership, func(p *causalTestPlan, _ *plans.PlanEvaluation) {
			p.members[0].Strategy.(*causalTestStrategy).name = "Renamed"
		}},
		{"same name replacement", CausalPlanMembership, func(p *causalTestPlan, _ *plans.PlanEvaluation) {
			replacement := causalNewStrategy()
			replacement.name = p.members[0].Strategy.Name()
			p.members[0].Strategy = replacement
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = func(out *plans.PlanEvaluation) { tc.edit(p, out) }
			result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(21))
			causalWantFailure(t, result, err, tc.code, 19)
			if p.calls != 1 {
				t.Fatalf("failed plan was retried %d times", p.calls)
			}
		})
	}

	// A hidden child is rejected even when the remaining child's consensus
	// and every returned identity/domain field are otherwise valid.
	for _, consensus := range []strategies.SignalType{strategies.SignalHold, strategies.SignalBuy} {
		p := causalNewPlan()
		p.after = func(out *plans.PlanEvaluation) {
			out.ConsensusSignal = consensus
			out.StrategySignals = out.StrategySignals[:1]
		}
		result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
		causalWantFailure(t, result, err, CausalPlanMembership, 19)
	}

	p := causalNewPlan()
	p.after = func(out *plans.PlanEvaluation) {
		out.StrategySignals[0].Signal = strategies.SignalAgentReview
		out.ConsensusSignal = strategies.SignalHold
	}
	result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
	causalWantFailure(t, result, err, CausalUnsupported, 19)
	p = causalNewPlan()
	p.after = func(out *plans.PlanEvaluation) { out.StrategySignals[0].AgentPrompt = "SECRET" }
	result, err = NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
	causalWantFailure(t, result, err, CausalUnsupported, 19)
}

func TestCausalPlanUsesReturnedConsensusAndCallsOnce(t *testing.T) {
	p := causalNewPlan()
	p.after = func(out *plans.PlanEvaluation) {
		// Deliberately differs from children. The runner validates the result;
		// it does not replace trusted plan aggregation with a new algorithm.
		out.ConsensusSignal = strategies.SignalBuy
		out.WeightedScore = 80
		out.StopLossPct, out.TargetPct = 5, 20
	}
	result := causalRun(t, NewPlanEngine(p), causalBars(22))
	if p.calls != 3 || len(result.Evaluations) != 3 || len(result.Fills) != 1 ||
		result.Fills[0].BarIndex != 20 || result.TerminalPosition == nil {
		t.Fatalf("plan consensus or once-per-close behavior changed: %+v", result)
	}
	for _, member := range p.members {
		if len(member.Strategy.(*causalTestStrategy).calls) != 3 {
			t.Fatal("runner independently reevaluated a plan child")
		}
	}
}

func TestCausalInvalidPlanDeclarationsAndEvaluatorConfiguration(t *testing.T) {
	cases := []struct {
		name string
		edit func(*causalTestPlan)
	}{
		{"empty", func(p *causalTestPlan) { p.members = nil }},
		{"too many", func(p *causalTestPlan) {
			p.members = nil
			for i := 0; i < 17; i++ {
				s := causalNewStrategy()
				s.name = fmt.Sprintf("Child %d", i)
				p.members = append(p.members, plans.WeightedStrategy{Strategy: s, Weight: 0.1})
			}
		}},
		{"nil", func(p *causalTestPlan) { p.members[0].Strategy = nil }},
		{"typed nil", func(p *causalTestPlan) {
			var s *causalTestStrategy
			p.members[0].Strategy = s
		}},
		{"duplicate", func(p *causalTestPlan) { p.members[1].Strategy = p.members[0].Strategy }},
		{"zero total", func(p *causalTestPlan) {
			for i := range p.members {
				p.members[i].Weight = 0
			}
		}},
		{"negative", func(p *causalTestPlan) { p.members[0].Weight = -0.1 }},
		{"above one", func(p *causalTestPlan) { p.members[0].Weight = math.Nextafter(1, 2) }},
		{"NaN", func(p *causalTestPlan) { p.members[0].Weight = math.NaN() }},
		{"Inf", func(p *causalTestPlan) { p.members[0].Weight = math.Inf(1) }},
		{"bad child name", func(p *causalTestPlan) { p.members[0].Strategy.(*causalTestStrategy).name = "bad\nname" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := causalNewPlan()
			tc.edit(p)
			result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
			causalWantFailure(t, result, err, CausalPlanMembership, -1)
			if p.calls != 0 {
				t.Fatal("invalid declaration reached Evaluate")
			}
		})
	}

	var nilEngine *Engine
	var nilStrategy *causalTestStrategy
	var nilPlan *causalTestPlan
	for _, engine := range []*Engine{
		nilEngine, {}, NewStrategyEngine(nil), NewStrategyEngine(nilStrategy),
		NewPlanEngine(nil), NewPlanEngine(nilPlan),
		{strategy: causalNewStrategy(), plan: causalNewPlan()},
	} {
		result, err := engine.RunCausal(nil, "TEST", causalBars(20))
		causalWantFailure(t, result, err, CausalInvalidEvaluator, -1)
	}
	for _, name := range []string{"", strings.Repeat("A", 129), "A\nB", string([]byte{0xff})} {
		s := causalNewStrategy()
		s.name = name
		result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(20))
		causalWantFailure(t, result, err, CausalInvalidEvaluator, -1)
		p := causalNewPlan()
		p.name = name
		result, err = NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(20))
		causalWantFailure(t, result, err, CausalInvalidEvaluator, -1)
	}
}

func TestCausalWholeInputPreflightAndBoundaries(t *testing.T) {
	invalid := []struct {
		name  string
		edit  func([]OHLCV)
		index int
	}{
		{"first malformed", func(b []OHLCV) { b[0].Open = 0 }, 0},
		{"last malformed", func(b []OHLCV) { b[24].Close = 101 }, 24},
		{"zero timestamp", func(b []OHLCV) { b[12].Timestamp = 0 }, 12},
		{"negative timestamp", func(b []OHLCV) { b[0].Timestamp = -1 }, 0},
		{"duplicate timestamp", func(b []OHLCV) { b[12].Timestamp = b[11].Timestamp }, 12},
		{"decreasing timestamp", func(b []OHLCV) { b[12].Timestamp = b[11].Timestamp - 1 }, 12},
		{"timestamp ceiling", func(b []OHLCV) { b[24].Timestamp = 253402300800 }, 24},
		{"price below", func(b []OHLCV) { b[0].Low = math.Nextafter(0.01, 0) }, 0},
		{"price above", func(b []OHLCV) { b[24].High = math.Nextafter(1000000, math.Inf(1)) }, 24},
		{"volume negative", func(b []OHLCV) { b[24].Volume = math.Nextafter(0, -1) }, 24},
		{"volume above", func(b []OHLCV) { b[24].Volume = math.Nextafter(1000000000000, math.Inf(1)) }, 24},
		{"open NaN", func(b []OHLCV) { b[0].Open = math.NaN() }, 0},
		{"high Inf", func(b []OHLCV) { b[12].High = math.Inf(1) }, 12},
		{"low Inf", func(b []OHLCV) { b[12].Low = math.Inf(-1) }, 12},
		{"close NaN", func(b []OHLCV) { b[24].Close = math.NaN() }, 24},
		{"volume NaN", func(b []OHLCV) { b[24].Volume = math.NaN() }, 24},
		{"volume Inf", func(b []OHLCV) { b[24].Volume = math.Inf(1) }, 24},
		{"low above open", func(b []OHLCV) { b[12].Low = 100.1 }, 12},
		{"open above high", func(b []OHLCV) { b[12].Open = 101 }, 12},
		{"close below low", func(b []OHLCV) { b[12].Close = 99 }, 12},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			bars := causalBars(25)
			tc.edit(bars)
			s := causalNewStrategy()
			result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", bars)
			causalWantFailure(t, result, err, CausalInvalidInput, tc.index)
			if len(s.calls) != 0 {
				t.Fatal("whole input was not checked before evaluation")
			}
			p := causalNewPlan()
			result, err = NewPlanEngine(p).RunCausal(nil, "TEST", bars)
			causalWantFailure(t, result, err, CausalInvalidInput, tc.index)
			if p.calls != 0 {
				t.Fatal("invalid whole input reached plan")
			}
		})
	}
	result, err := NewStrategyEngine(causalNewStrategy()).RunCausal(nil, "TEST", nil)
	causalWantFailure(t, result, err, CausalInvalidInput, -1)
	result, err = NewStrategyEngine(causalNewStrategy()).RunCausal(nil, "TEST", causalBars(10001))
	causalWantFailure(t, result, err, CausalResourceLimit, -1)

	for _, price := range []float64{0.01, 1000000} {
		bars := causalBars(21)
		for i := range bars {
			causalSetBar(bars, i, price, price, price, price)
			bars[i].Volume = 1000000000000
			bars[i].Timestamp = 253402300779 + int64(i)
		}
		result := causalRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)), bars)
		want := "1000"
		if price == 1000000 {
			want = "1/100000"
		}
		causalOracle(t, result.Fills[0].Quantity, want, "quantity")
		if result.Evaluations[1].Timestamp.Unix() != 253402300799 {
			t.Fatal("upper timestamp boundary changed")
		}
	}
	bars := causalBars(1)
	bars[0].Timestamp, bars[0].Volume = 1, 0
	causalRun(t, NewStrategyEngine(causalNewStrategy()), bars)

	// Exercise the accepted full resource bound without retaining prefix copies.
	full := causalRun(t, NewStrategyEngine(causalNewStrategy()), causalBars(10000))
	if full.TotalBars != 10000 || len(full.Evaluations) != 9981 || len(full.Fills) != 0 {
		t.Fatalf("accepted resource boundary changed: bars=%d evaluations=%d", full.TotalBars, len(full.Evaluations))
	}
}

func TestCausalSymbolValidation(t *testing.T) {
	for _, symbol := range []string{"", "test", "1TEST", "T EST", "T\nEST", "Ä", "A_B", strings.Repeat("A", 17)} {
		s := causalNewStrategy()
		result, err := NewStrategyEngine(s).RunCausal(nil, symbol, causalBars(20))
		causalWantFailure(t, result, err, CausalInvalidSymbol, -1)
		if len(s.calls) != 0 {
			t.Fatal("invalid symbol reached evaluator")
		}
	}
	for _, symbol := range []string{"A", "BRK.B", "A-1", strings.Repeat("A", 16)} {
		result, err := NewStrategyEngine(causalNewStrategy()).RunCausal(nil, symbol, causalBars(20))
		if err != nil || result.Symbol != symbol || result.Evaluations[0].Symbol != symbol {
			t.Fatalf("valid symbol rejected: %q %v", symbol, err)
		}
	}
}

func TestCausalEvaluationDomainsAndExactPercentageBounds(t *testing.T) {
	cases := []struct {
		name string
		edit func(*strategies.StrategySignal)
		code CausalErrorCode
	}{
		{"unknown signal", func(s *strategies.StrategySignal) { s.Signal = "SECRET" }, CausalUnsupported},
		{"agent", func(s *strategies.StrategySignal) { s.Signal = strategies.SignalAgentReview }, CausalUnsupported},
		{"prompt", func(s *strategies.StrategySignal) { s.AgentPrompt = "SECRET" }, CausalUnsupported},
		{"score below", func(s *strategies.StrategySignal) { s.Score = math.Nextafter(0, -1) }, CausalNumericRange},
		{"score above", func(s *strategies.StrategySignal) { s.Score = math.Nextafter(100, 101) }, CausalNumericRange},
		{"score NaN", func(s *strategies.StrategySignal) { s.Score = math.NaN() }, CausalNumericRange},
		{"score Inf", func(s *strategies.StrategySignal) { s.Score = math.Inf(1) }, CausalNumericRange},
		{"stop tiny", func(s *strategies.StrategySignal) { s.StopLossPct = math.Nextafter(0.01, 0) }, CausalNumericRange},
		{"stop above", func(s *strategies.StrategySignal) { s.StopLossPct = math.Nextafter(99.99, 100) }, CausalNumericRange},
		{"stop negative", func(s *strategies.StrategySignal) { s.StopLossPct = -1 }, CausalNumericRange},
		{"stop NaN", func(s *strategies.StrategySignal) { s.StopLossPct = math.NaN() }, CausalNumericRange},
		{"stop Inf", func(s *strategies.StrategySignal) { s.StopLossPct = math.Inf(1) }, CausalNumericRange},
		{"target tiny", func(s *strategies.StrategySignal) { s.TargetPct = math.Nextafter(0.01, 0) }, CausalNumericRange},
		{"target above", func(s *strategies.StrategySignal) { s.TargetPct = math.Nextafter(1000, 1001) }, CausalNumericRange},
		{"target negative", func(s *strategies.StrategySignal) { s.TargetPct = -1 }, CausalNumericRange},
		{"target NaN", func(s *strategies.StrategySignal) { s.TargetPct = math.NaN() }, CausalNumericRange},
		{"target Inf", func(s *strategies.StrategySignal) { s.TargetPct = math.Inf(1) }, CausalNumericRange},
	}
	for _, tc := range cases {
		t.Run("standalone/"+tc.name, func(t *testing.T) {
			s := causalNewStrategy()
			s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				out := causalCompleteSignal(s.name, symbol, at)
				tc.edit(&out)
				return out, nil
			}
			result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(21))
			causalWantFailure(t, result, err, tc.code, 19)
		})
		t.Run("component/"+tc.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = func(out *plans.PlanEvaluation) { tc.edit(&out.StrategySignals[0]) }
			result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(21))
			causalWantFailure(t, result, err, tc.code, 19)
		})
		// Only fields present on PlanEvaluation are copied into this case.
		if tc.name == "prompt" {
			continue
		}
		t.Run("top plan/"+tc.name, func(t *testing.T) {
			p := causalNewPlan()
			p.after = func(out *plans.PlanEvaluation) {
				s := causalCompleteSignal("temporary", "TEST", out.Timestamp)
				tc.edit(&s)
				out.ConsensusSignal, out.WeightedScore = s.Signal, s.Score
				out.StopLossPct, out.TargetPct = s.StopLossPct, s.TargetPct
			}
			result, err := NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(21))
			causalWantFailure(t, result, err, tc.code, 19)
		})
	}

	for _, stop := range []float64{0, 0.01, 99.99} {
		for _, target := range []float64{0, 0.01, 1000} {
			for _, score := range []float64{0, 100} {
				s := causalNewStrategy()
				s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
					out := causalCompleteSignal(s.name, symbol, at)
					out.StopLossPct, out.TargetPct, out.Score = stop, target, score
					return out, nil
				}
				causalRun(t, NewStrategyEngine(s), causalBars(20))
			}
		}
	}

	// An enabled target at the maximum is a derived 11,000,000 level.
	bars := causalBars(21)
	for i := range bars {
		causalSetBar(bars, i, 1000000, 1000000, 1000000, 1000000)
	}
	result := causalRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 0, 1000)), bars)
	if result.TerminalPosition == nil || result.TerminalPosition.Target != 11000000 {
		t.Fatalf("maximum enabled level changed: %+v", result.TerminalPosition)
	}
}

func TestCausalEqualOrOverlappingNewLevelsFail(t *testing.T) {
	for _, high := range []float64{220, math.Nextafter(220, math.Inf(1))} {
		bars := causalBars(21)
		causalSetBar(bars, 20, 100, high, 100, 100)
		s := causalNewStrategy()
		s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
			out := causalCompleteSignal(s.name, symbol, at)
			if len(closes) == 20 {
				out.Signal = strategies.SignalBuy
			} else {
				out.StopLossPct, out.TargetPct = 50, 10
			}
			return out, nil
		}
		result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", bars)
		causalWantFailure(t, result, err, CausalNumericRange, 20)
	}
}

func TestCausalErrorsCancellationAndSanitization(t *testing.T) {
	secret := errors.New("SECRET provider /private/path raw rationale")
	s := causalNewStrategy()
	s.fn = func(_ context.Context, _ time.Time, _ string, _, _ []float64) (strategies.StrategySignal, error) {
		return strategies.StrategySignal{}, secret
	}
	result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(21))
	causalWantFailure(t, result, err, CausalEvaluatorError, 19)
	if errors.Is(err, secret) || len(s.calls) != 1 {
		t.Fatal("raw callback error retained or failed callback retried")
	}
	p := causalNewPlan()
	p.err = secret
	result, err = NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(21))
	causalWantFailure(t, result, err, CausalEvaluatorError, 19)
	if p.calls != 1 {
		t.Fatal("plan error was swallowed or retried")
	}

	p = causalNewPlan()
	child := p.members[0].Strategy.(*causalTestStrategy)
	child.fn = func(_ context.Context, _ time.Time, _ string, _, _ []float64) (strategies.StrategySignal, error) {
		return strategies.StrategySignal{}, secret
	}
	result, err = NewPlanEngine(p).RunCausal(nil, "TEST", causalBars(21))
	causalWantFailure(t, result, err, CausalEvaluatorError, 19)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s = causalNewStrategy()
	result, err = NewStrategyEngine(s).RunCausal(ctx, "TEST", causalBars(21))
	causalWantFailure(t, result, err, CausalCanceled, 0)
	if len(s.calls) != 0 {
		t.Fatal("pre-canceled run evaluated")
	}

	for _, plan := range []bool{false, true} {
		ctx, cancel = context.WithCancel(context.Background())
		if plan {
			p = causalNewPlan()
			p.after = func(*plans.PlanEvaluation) { cancel() }
			result, err = NewPlanEngine(p).RunCausal(ctx, "TEST", causalBars(21))
		} else {
			s = causalNewStrategy()
			s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
				cancel()
				return causalCompleteSignal(s.name, symbol, at), nil
			}
			result, err = NewStrategyEngine(s).RunCausal(ctx, "TEST", causalBars(21))
		}
		causalWantFailure(t, result, err, CausalCanceled, 19)
		cancel()
	}

	// A later callback error discards already recorded fills and evaluations.
	s = causalScript(causalBuyThenHold, 0, 0)
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		if len(closes) == 21 {
			return strategies.StrategySignal{}, secret
		}
		out := causalCompleteSignal(s.name, symbol, at)
		out.Signal = strategies.SignalBuy
		return out, nil
	}
	result, err = NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(21))
	causalWantFailure(t, result, err, CausalEvaluatorError, 20)

	// An evaluator requiring a longer warmup fails honestly at fixed index 19.
	s = causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		if len(closes) < 50 {
			return strategies.StrategySignal{}, errors.New("insufficient data SECRET")
		}
		return causalCompleteSignal(s.name, symbol, at), nil
	}
	result, err = NewStrategyEngine(s).RunCausal(nil, "TEST", causalBars(60))
	causalWantFailure(t, result, err, CausalEvaluatorError, 19)
	if len(s.calls) != 1 {
		t.Fatal("fixed warmup was silently skipped")
	}
}

func TestCausalPrefixAndSourceSnapshotIsolation(t *testing.T) {
	bars := causalBars(22)
	original := append([]OHLCV(nil), bars...)
	s := causalScript(causalBuyThenHold, 0, 0)
	s.keepPrefix = true
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, volumes []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		if len(closes) == 20 {
			out.Signal = strategies.SignalBuy
		}
		for i := range closes {
			closes[i], volumes[i] = -123, -456
		}
		return out, nil
	}
	result := causalRun(t, NewStrategyEngine(s), bars)
	if !reflect.DeepEqual(bars, original) || len(result.Fills) != 1 || result.Fills[0].Price != 100 {
		t.Fatalf("callback mutated source/runner state: %+v", result)
	}
	for _, call := range s.calls {
		for i := range call.closes {
			if call.closes[i] != 100 || call.volume[i] != 1000 {
				t.Fatalf("prefix mutation reached a later evaluation: %+v", call)
			}
		}
	}

	// Mutation through a caller alias after preflight cannot alter the owned
	// bar snapshot. This does not assert callback purity or concurrent safety.
	bars = causalBars(21)
	s = causalNewStrategy()
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		if len(closes) == 20 {
			out.Signal = strategies.SignalBuy
			causalSetBar(bars, 20, 200, 200, 200, 200)
		}
		return out, nil
	}
	result = causalRun(t, NewStrategyEngine(s), bars)
	if result.Fills[0].Price != 100 || result.TerminalPosition.LastClosePrice != 100 {
		t.Fatal("caller alias replaced runner-owned bars")
	}
}

func TestCausalFreshDeterminismAndFuturePrefixIsolation(t *testing.T) {
	bars := causalBars(23)
	causalSetBar(bars, 20, 110, 110, 110, 110)
	firstStrategy := causalScript(causalBuyThenHold, 0, 0)
	secondStrategy := causalScript(causalBuyThenHold, 0, 0)
	firstStrategy.keepPrefix, secondStrategy.keepPrefix = true, true
	first := causalRun(t, NewStrategyEngine(firstStrategy), bars)
	second := causalRun(t, NewStrategyEngine(secondStrategy), bars)
	if !reflect.DeepEqual(first, second) ||
		!reflect.DeepEqual(firstStrategy.calls, secondStrategy.calls) {
		t.Fatal("fresh identical runs differ")
	}

	changed := append([]OHLCV(nil), bars...)
	causalSetBar(changed, 20, 120, 120, 120, 120)
	laterStrategy := causalScript(causalBuyThenHold, 0, 0)
	laterStrategy.keepPrefix = true
	later := causalRun(t, NewStrategyEngine(laterStrategy), changed)
	if !reflect.DeepEqual(first.Evaluations[0], later.Evaluations[0]) ||
		!reflect.DeepEqual(firstStrategy.calls[0], laterStrategy.calls[0]) ||
		first.Fills[0].Price != 110 || later.Fills[0].Price != 120 {
		t.Fatal("changed next open altered the earlier close signal or failed to alter fill")
	}
	changed = append([]OHLCV(nil), bars...)
	causalSetBar(changed, 22, 130, 130, 130, 130)
	later = causalRun(t, NewStrategyEngine(causalScript(causalBuyThenHold, 0, 0)), changed)
	if !reflect.DeepEqual(first.Evaluations[:3], later.Evaluations[:3]) {
		t.Fatal("future bar altered a prior normalized signal")
	}
}

func TestCausalNumericNotionalAndAccumulationEnvelope(t *testing.T) {
	// Entry quantity 1000; an exit at 1000 has notional 1,000,000 and
	// gross PnL 999,990. A second exit at .02 adds exactly 10.
	makeRun := func(secondExit float64) ([]OHLCV, *causalTestStrategy) {
		bars := causalBars(24)
		causalSetBar(bars, 20, 0.01, 0.01, 0.01, 0.01)
		causalSetBar(bars, 21, 1000, 1000, 1000, 1000)
		causalSetBar(bars, 22, 0.01, 0.01, 0.01, 0.01)
		causalSetBar(bars, 23, secondExit, secondExit, secondExit, secondExit)
		s := causalScript(func(i int) strategies.SignalType {
			switch i {
			case 19, 21:
				return strategies.SignalBuy
			case 20, 22:
				return strategies.SignalSell
			default:
				return strategies.SignalHold
			}
		}, 0, 0)
		return bars, s
	}
	bars, s := makeRun(0.02)
	result := causalRun(t, NewStrategyEngine(s), bars)
	if result.ClosedTradeCount != 2 || len(result.Fills) != 4 {
		t.Fatalf("numeric boundary accounting incorrect: %+v", result)
	}
	causalOracle(t, result.Fills[1].Notional, "1000000", "money")
	causalOracle(t, result.GrossRealizedPnL, "1000000", "money")
	causalOracle(t, result.GrossProfit, "1000000", "money")

	bars, s = makeRun(0.02000001)
	result, err := NewStrategyEngine(s).RunCausal(nil, "TEST", bars)
	causalWantFailure(t, result, err, CausalNumericRange, 23)

	bars = causalBars(22)
	causalSetBar(bars, 20, 0.01, 0.01, 0.01, 0.01)
	causalSetBar(bars, 21, 1001, 1001, 1001, 1001)
	s = causalScript(func(i int) strategies.SignalType {
		if i == 19 {
			return strategies.SignalBuy
		}
		return strategies.SignalSell
	}, 0, 0)
	result, err = NewStrategyEngine(s).RunCausal(nil, "TEST", bars)
	causalWantFailure(t, result, err, CausalNumericRange, 21)

	s = causalScript(causalBuyThenHold, 0, 0)
	result, err = NewStrategyEngine(s).RunCausal(nil, "TEST", bars)
	causalWantFailure(t, result, err, CausalNumericRange, 21)
}

func TestCausalMixedProfitFactorHandOracleAndBreakeven(t *testing.T) {
	bars := causalBars(24)
	causalSetBar(bars, 21, 110, 110, 110, 110)
	causalSetBar(bars, 23, 95, 95, 95, 95)
	s := causalScript(func(i int) strategies.SignalType {
		if i == 19 || i == 21 {
			return strategies.SignalBuy
		}
		if i == 20 || i == 22 {
			return strategies.SignalSell
		}
		return strategies.SignalHold
	}, 0, 0)
	result := causalRun(t, NewStrategyEngine(s), bars)
	if result.ClosedTradeCount != 2 || result.WinningClosedTradeCount != 1 ||
		result.GrossProfitFactor == nil || result.GrossProfitFactorReason != "" {
		t.Fatalf("incorrect mixed accounting: %+v", result)
	}
	causalOracle(t, result.GrossProfit, "1", "money")
	causalOracle(t, result.GrossLoss, "1/2", "money")
	causalOracle(t, result.GrossRealizedPnL, "1/2", "money")
	causalOracle(t, *result.GrossProfitFactor, "2", "factor")

	s = causalScript(func(i int) strategies.SignalType {
		if i == 19 {
			return strategies.SignalBuy
		}
		return strategies.SignalSell
	}, 0, 0)
	result = causalRun(t, NewStrategyEngine(s), causalBars(22))
	if result.ClosedTradeCount != 1 || result.WinningClosedTradeCount != 0 ||
		result.GrossRealizedPnL != 0 || result.GrossProfitFactor != nil ||
		result.GrossProfitFactorReason != CausalNoLosingClosedTrades {
		t.Fatalf("breakeven factor incorrectly defined: %+v", result)
	}
}

func TestCausalPublicEvidenceOmitsRawCallbackMaterial(t *testing.T) {
	s := causalScript(causalBuyThenHold, 0, 0)
	s.fn = func(_ context.Context, at time.Time, symbol string, closes, _ []float64) (strategies.StrategySignal, error) {
		out := causalCompleteSignal(s.name, symbol, at)
		out.Rationale = "SECRET /private/path raw strategy text"
		if len(closes) == 20 {
			out.Signal = strategies.SignalBuy
		}
		return out, nil
	}
	result := causalRun(t, NewStrategyEngine(s), causalBars(21))
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"SECRET", "/private/path", "rationale", "agent_prompt", "NetPnL", "MaxDrawdownPct"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("public evidence retained %q", forbidden)
		}
	}

	p := causalNewPlan()
	p.after = func(out *plans.PlanEvaluation) {
		out.Rationale = "SECRET parent"
		for i := range out.StrategySignals {
			out.StrategySignals[i].Rationale = "SECRET child"
		}
	}
	result = causalRun(t, NewPlanEngine(p), causalBars(20))
	encoded, err = json.Marshal(result)
	if err != nil || strings.Contains(string(encoded), "SECRET") {
		t.Fatalf("plan raw text escaped into public evidence: %v", err)
	}
}

func TestCausalDirectExistingBreakoutFixture(t *testing.T) {
	// Toy closes, not market evidence: 19 flat closes followed by 105.
	// Every OHLC bar is independently consistent, and the successor open is
	// deliberately distinct from the breakout close.
	bars := causalBars(21)
	causalSetBar(bars, 19, 100, 105, 100, 105)
	causalSetBar(bars, 20, 106, 106, 106, 106)
	for i, bar := range bars {
		if bar.Low > bar.Open || bar.Low > bar.Close ||
			bar.Open > bar.High || bar.Close > bar.High {
			t.Fatalf("invalid toy OHLC at %d", i)
		}
	}
	s := strategies.NewBreakoutVolStrategy()
	if err := s.Init(nil); err != nil {
		t.Fatal(err)
	}
	result := causalRun(t, NewStrategyEngine(s), bars)
	if len(result.Evaluations) != 2 || result.Evaluations[0].Name != "BreakoutVol" ||
		result.Evaluations[0].Signal != strategies.SignalBuy ||
		result.Evaluations[0].Score != 90 || len(result.Fills) != 1 ||
		result.Fills[0].Price != 106 || result.Fills[0].BarIndex != 20 ||
		result.Fills[0].EvaluationBarIndex != 19 || result.Fills[0].EntrySignalBarIndex != 19 ||
		!result.Evaluations[0].Timestamp.Equal(time.Unix(bars[19].Timestamp, 0)) ||
		!result.Fills[0].Timestamp.Equal(time.Unix(bars[20].Timestamp, 0)) {
		t.Fatalf("direct BreakoutVol lineage mismatch: %+v", result)
	}
	causalOracle(t, result.Fills[0].Quantity, "5/53", "quantity")
	if result.TerminalPosition == nil || result.ClosedTradeCount != 0 {
		t.Fatal("toy open position was artificially liquidated")
	}
}

func TestCausalLegacyWholeResultAndAPIBehaviorPreserved(t *testing.T) {
	bars := causalBars(21)
	causalSetBar(bars, 20, 110, 110, 110, 110)
	alwaysBuy := func(int) strategies.SignalType { return strategies.SignalBuy }

	legacyStrategy := causalScript(alwaysBuy, 5, 20)
	legacy, err := NewStrategyEngine(legacyStrategy).Run(nil, "TEST", bars)
	if err != nil {
		t.Fatal(err)
	}
	want := Result{
		TotalBars: 21, TotalTrades: 1, WinningTrades: 1,
		WinRate: 100, NetPnL: 1, ProfitFactor: math.Inf(1), MaxDrawdownPct: 0,
	}
	if legacy != want || len(legacyStrategy.calls) != 3 {
		t.Fatalf("legacy whole result/callback behavior changed: %+v calls=%d", legacy, len(legacyStrategy.calls))
	}

	causalStrategy := causalScript(alwaysBuy, 5, 20)
	causal := causalRun(t, NewStrategyEngine(causalStrategy), bars)
	if causal.ClosedTradeCount != 0 || causal.GrossRealizedPnL != 0 ||
		len(causal.Fills) != 1 || causal.Fills[0].Price != 110 ||
		causal.TerminalPosition == nil || causal.TerminalPosition.EntryPrice != 110 ||
		len(causalStrategy.calls) != 2 {
		t.Fatalf("causal path accidentally preserved legacy close fills: %+v", causal)
	}

	// Existing plan constructor/Run remain independently usable.
	p := causalNewPlan()
	p.after = func(out *plans.PlanEvaluation) {
		out.ConsensusSignal = strategies.SignalBuy
		out.StopLossPct, out.TargetPct = 5, 20
	}
	legacyPlan, err := NewPlanEngine(p).Run(nil, "TEST", bars)
	if err != nil || legacyPlan != want || p.calls != 3 {
		t.Fatalf("legacy plan API changed: %+v calls=%d err=%v", legacyPlan, p.calls, err)
	}

	// The old API still accepts a positive price outside the new envelope.
	legacyBars := causalBars(1)
	causalSetBar(legacyBars, 0, 0.001, 0.001, 0.001, 0.001)
	legacy, err = NewStrategyEngine(causalNewStrategy()).Run(nil, "TEST", legacyBars)
	if err != nil || legacy != (Result{TotalBars: 1}) {
		t.Fatalf("causal domain leaked into legacy validation: %+v %v", legacy, err)
	}
	result, err := NewStrategyEngine(causalNewStrategy()).RunCausal(nil, "TEST", legacyBars)
	causalWantFailure(t, result, err, CausalInvalidInput, 0)
}

// Unused legacy metadata is neither part of causal policy nor retained output.
func TestCausalUnusedThresholdMetadataDoesNotExpandContract(t *testing.T) {
	for _, plan := range []bool{false, true} {
		s := causalNewStrategy()
		s.fn = func(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
			out := causalCompleteSignal(s.name, symbol, at)
			out.BuyThreshold, out.SellThreshold = math.NaN(), math.Inf(1)
			return out, nil
		}
		engine := NewStrategyEngine(s)
		if plan {
			p := causalNewPlan()
			p.members[0].Strategy = s
			engine = NewPlanEngine(p)
		}
		result := causalRun(t, engine, causalBars(20))
		if _, err := json.Marshal(result); err != nil {
			t.Fatalf("unused metadata retained: %v", err)
		}
	}
}

type causalValueStrategy struct{ payload any }

func (causalValueStrategy) Name() string                     { return "Value Child" }
func (causalValueStrategy) Description() string              { return "trusted test value" }
func (causalValueStrategy) Init(*data.FeatureRegistry) error { return nil }
func (causalValueStrategy) SetParams(map[string]float64)     {}
func (causalValueStrategy) CapitalRequirement() float64      { return 0 }
func (causalValueStrategy) IsIntradayOnly() bool             { return true }
func (v causalValueStrategy) Evaluate(_ context.Context, at time.Time, symbol string, _, _ []float64) (strategies.StrategySignal, error) {
	return causalCompleteSignal(v.Name(), symbol, at), nil
}
func TestCausalPlanValueWithUncomparableDynamicFieldDoesNotPanic(t *testing.T) {
	p := causalNewPlan()
	p.members[0].Strategy = causalValueStrategy{payload: []int{1, 2}}
	result := causalRun(t, NewPlanEngine(p), causalBars(20))
	if len(result.Evaluations) != 1 {
		t.Fatal("value member rejected")
	}
}
