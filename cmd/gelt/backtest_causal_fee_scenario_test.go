package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

type feeScenarioCLIStrategy struct {
	*strategies.BreakoutVolStrategy
	mode   string
	calls  int
	cancel context.CancelFunc
}

func (s *feeScenarioCLIStrategy) Evaluate(
	ctx context.Context, at time.Time, symbol string, closes, volumes []float64,
) (strategies.StrategySignal, error) {
	s.calls++
	if s.cancel != nil {
		s.cancel()
	}
	if s.mode == "error" {
		return strategies.StrategySignal{}, errors.New("PRIVATE_CALLBACK_ERROR")
	}
	signal := strategies.StrategySignal{
		StrategyName: "BreakoutVol", Symbol: symbol, Timestamp: at,
		AssetClass: strategies.AssetEquity, Signal: strategies.SignalHold,
		Score: 90, Rationale: "PRIVATE_RATIONALE",
	}
	switch s.mode {
	case "hold":
	case "buy":
		signal.Signal = strategies.SignalBuy
	case "prompt":
		signal.AgentPrompt = "PRIVATE_PROMPT"
	case "identity":
		signal.Symbol = "PRIVATE_IDENTITY"
	case "numeric":
		signal.Score = math.NaN()
	default:
		switch len(closes) - 1 {
		case 19:
			signal.Signal = strategies.SignalBuy
		case 21:
			signal.Signal = strategies.SignalSell
		}
	}
	return signal, nil
}

func feeScenarioCLIBars(count int, price float64) []backtest.OHLCV {
	bars := make([]backtest.OHLCV, count)
	for i := range bars {
		bars[i] = backtest.OHLCV{
			Timestamp: int64(i + 1), Open: price, High: price,
			Low: price, Close: price, Volume: 0,
		}
	}
	return bars
}

func feeScenarioCLIEngine(mode string) (*backtest.Engine, *feeScenarioCLIStrategy) {
	s := &feeScenarioCLIStrategy{
		BreakoutVolStrategy: strategies.NewBreakoutVolStrategy(), mode: mode,
	}
	return backtest.NewStrategyEngine(s), s
}

func feeScenarioCLIResult(
	t *testing.T, count int, cash, fixed, bps, mode string,
) backtest.FeeScenarioCausalResult {
	t.Helper()
	engine, strategy := feeScenarioCLIEngine(mode)
	r, err := engine.RunFeeScenarioCausal(context.Background(), "TEST",
		feeScenarioCLIBars(count, 100), cash,
		backtest.FeeScenario{FixedFee: fixed, FeeBps: bps})
	if err != nil {
		t.Fatalf("synthetic core result failed: %v", err)
	}
	expected := count - 19
	if expected < 0 {
		expected = 0
	}
	if strategy.calls != expected {
		t.Fatalf("evaluation calls: got %d want %d", strategy.calls, expected)
	}
	return r
}

func feeScenarioCLIRun(ctx context.Context, args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := runBacktestCausalFees(ctx, args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func feeScenarioCLIRequireSummary(t *testing.T, r backtest.FeeScenarioCausalResult) string {
	t.Helper()
	out, ok := backtestCausalFeesSummary(r)
	if !ok || out == "" || len(out) > feeScenarioCLISummaryMaxBytes {
		t.Fatalf("summary rejected or exceeded bound: ok=%t bytes=%d", ok, len(out))
	}
	for _, forbidden := range []string{
		"PRIVATE_", `"cash_flows"`, `"close_marks"`, `"evaluations"`,
		"Costs: frictionless", "no fees or slippage",
	} {
		if strings.Contains(out, forbidden) {
			t.Fatalf("summary contains forbidden text %q", forbidden)
		}
	}
	return out
}

func feeScenarioCLIRequireLines(t *testing.T, out string, lines ...string) {
	t.Helper()
	for _, line := range lines {
		if !strings.Contains(out, line+"\n") {
			t.Fatalf("missing line %q in:\n%s", line, out)
		}
	}
}

func TestFeeScenarioCLIActualBreakoutCSV(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	code, out, stderr := feeScenarioCLIRun(context.Background(),
		"BreakoutVol", "TEST", path, "100", "1", "0")
	if code != 0 || stderr != "" {
		t.Fatalf("actual resolver failed: code=%d stderr=%q", code, stderr)
	}
	if len(out) > feeScenarioCLISummaryMaxBytes || strings.Contains(out, path) {
		t.Fatal("summary bound or path privacy failure")
	}
	feeScenarioCLIRequireLines(t, out,
		"Model: "+backtest.FeeScenarioCausalModelIdentity,
		"Cost: "+backtest.FeeScenarioCausalCostIdentity,
		"Data: unqualified_offline",
		"Authority: unqualified_offline",
		"Scenario basis: uncalibrated_declared",
		"Fixed per-side fee (modelUSD): 1.00000000",
		"Fee rate (integer bps): 0",
		"Rate denominator: 10000",
		"Fee basis: quantized_gross_notional",
		"Application: per_filled_side",
		"Bars: 21", "Evaluations: 2", "Model fills: 1",
		"Closed trades: 0", "Rejected entries: 0",
		"Initial model cash: 100.00000000",
		"Final model cash: 90.00000000",
		"Final position principal: 9.00000000",
		"Final position entry fee: 1.00000000",
		"Final position total basis: 10.00000000",
		"Final position value: 9.00000000",
		"Final model equity: 99.00000000",
		"Net unrealized accounting PnL: -1.00000000",
		"Closed attributed fees: 0.00000000",
		"Open attributed fees: 1.00000000",
		"Aggregate fees: 1.00000000",
		"Final open model position: present")
	for _, cash := range []string{"0", "9.99999999"} {
		code, out, stderr = feeScenarioCLIRun(context.Background(),
			"BreakoutVol", "TEST", path, cash, "1", "0")
		if code != 0 || stderr != "" {
			t.Fatalf("nonfill failed for cash %q: %d %q", cash, code, stderr)
		}
		feeScenarioCLIRequireLines(t, out,
			"Model fills: 0", "Rejected entries: 1",
			"Aggregate fees: 0.00000000", "Final open model position: none")
	}
}

func TestFeeScenarioCLIFixedFeeOracles(t *testing.T) {
	closed := feeScenarioCLIResult(t, 24, "10", "1", "0", "roundtrip")
	out := feeScenarioCLIRequireSummary(t, closed)
	if len(closed.CashFlows) != 2 ||
		closed.CashFlows[0].GrossNotionalUnits != "900000000" ||
		closed.CashFlows[0].FeeUnits != "100000000" ||
		closed.CashFlows[0].DebitedUnits != "1000000000" ||
		closed.CashFlows[1].CreditedUnits != "800000000" ||
		closed.CloseMarks[20].EquityUnits != "900000000" ||
		closed.CloseMarks[20].CloseMarkDrawdown.Percent == nil ||
		*closed.CloseMarks[20].CloseMarkDrawdown.Percent != 10 {
		t.Fatal("independent flat roundtrip entry/exit oracle mismatch")
	}
	feeScenarioCLIRequireLines(t, out,
		"Final model cash: 8.00000000",
		"Final model equity: 8.00000000",
		"Gross realized accounting PnL: 0.00000000",
		"Net realized accounting PnL: -2.00000000",
		"Closed attributed fees: 2.00000000",
		"Open attributed fees: 0.00000000",
		"Aggregate fees: 2.00000000",
		"Max close-mark drawdown loss units: 200000000",
		"Max close-mark drawdown peak units: 1000000000",
		"Max close-mark drawdown bar: 22",
		"Max close-mark drawdown percent (derived): 2.000000000000e+01",
		"Final open model position: none")
	if closed.MaxCloseMarkDrawdown.BarIndex == nil ||
		*closed.MaxCloseMarkDrawdown.BarIndex != 22 {
		t.Fatal("equal later close-mark loss displaced first maximum")
	}

	open := feeScenarioCLIResult(t, 24, "10", "1", "0", "buy")
	out = feeScenarioCLIRequireSummary(t, open)
	feeScenarioCLIRequireLines(t, out,
		"Model fills: 1",
		"Final model cash: 0.00000000",
		"Final model equity: 9.00000000",
		"Gross unrealized accounting PnL: 0.00000000",
		"Net unrealized accounting PnL: -1.00000000",
		"Aggregate fees: 1.00000000",
		"Final directional signal pending: true")
	if len(open.CashFlows) != 1 || open.OpenAttributedFeeUnits != "100000000" {
		t.Fatal("holding, pending BUY or terminal mark charged another fee")
	}
}

func TestFeeScenarioCLIBpsAndCeiling(t *testing.T) {
	for _, tc := range []struct {
		bps, principal, fee string
	}{
		{"100", "990099009", "9900991"},
		{"10000", "500000000", "500000000"},
	} {
		t.Run(tc.bps, func(t *testing.T) {
			r := feeScenarioCLIResult(t, 21, "10", "0", tc.bps, "buy")
			out := feeScenarioCLIRequireSummary(t, r)
			if len(r.CashFlows) != 1 {
				t.Fatal("expected one fill")
			}
			f := r.CashFlows[0]
			if f.GrossNotionalUnits != tc.principal || f.FeeUnits != tc.fee ||
				f.DebitedUnits != "1000000000" {
				t.Fatalf("bps oracle mismatch: %+v", f)
			}
			feeScenarioCLIRequireLines(t, out, "Fee rate (integer bps): "+tc.bps,
				"Final model cash: 0.00000000")
			principal, _ := strconv.ParseInt(tc.principal, 10, 64)
			rate, _ := strconv.ParseInt(tc.bps, 10, 64)
			nextFee := ((principal+1)*rate + 9999) / 10000
			if principal+1+nextFee <= 1000000000 {
				t.Fatal("next principal unit should exceed the cap")
			}
		})
	}
	for _, tc := range []struct {
		gross, fixed, bps, want int64
	}{
		{1, 0, 1, 1},
		{10000, 0, 1, 1},
		{10001, 0, 1, 2},
		{10001, 7, 1, 9},
		{0, 7, 10000, 7},
	} {
		got, ok := feeScenarioCLICharge(tc.gross, tc.fixed, tc.bps)
		if !ok || got != tc.want {
			t.Fatalf("ceiling oracle %+v: got %d ok=%t", tc, got, ok)
		}
	}
	if _, ok := feeScenarioCLIMul(math.MaxInt64, 2); ok {
		t.Fatal("unchecked multiplication overflow")
	}
	if _, ok := feeScenarioCLIAdd(math.MaxInt64, 1); ok {
		t.Fatal("unchecked addition overflow")
	}
	if _, ok := feeScenarioCLIAdd(math.MinInt64, -1); ok {
		t.Fatal("unchecked subtraction overflow")
	}
}

func TestFeeScenarioCLITiesEvenExitQuotes(t *testing.T) {
	for _, tc := range []struct {
		fixed, gross string
	}{
		{"9.80468750", "195312"},
		{"9.41406250", "585938"},
	} {
		t.Run(tc.fixed, func(t *testing.T) {
			bars := feeScenarioCLIBars(24, 100)
			for i := 22; i < len(bars); i++ {
				bars[i].Open, bars[i].High = 1, 1
				bars[i].Low, bars[i].Close = 1, 1
			}
			engine, _ := feeScenarioCLIEngine("roundtrip")
			r, err := engine.RunFeeScenarioCausal(context.Background(), "TEST", bars,
				"100", backtest.FeeScenario{FixedFee: tc.fixed, FeeBps: "0"})
			if err != nil {
				t.Fatal(err)
			}
			if len(r.CashFlows) != 2 || r.CashFlows[1].GrossNotionalUnits != tc.gross {
				t.Fatalf("ties-even gross mismatch: %+v", r.CashFlows)
			}
			feeScenarioCLIRequireSummary(t, r)
		})
	}
}

func TestFeeScenarioCLIZeroScenarioCompatibility(t *testing.T) {
	bars := fundedCLITestBars(24)
	newEngine, _ := feeScenarioCLIEngine("roundtrip")
	oldEngine, _ := feeScenarioCLIEngine("roundtrip")
	costed, err := newEngine.RunFeeScenarioCausal(context.Background(), "TEST", bars,
		"100", backtest.FeeScenario{FixedFee: "0", FeeBps: "0"})
	if err != nil {
		t.Fatal(err)
	}
	funded, err := oldEngine.RunFundedCausal(context.Background(), "TEST", bars, "100")
	if err != nil {
		t.Fatal(err)
	}
	feeScenarioCLIRequireSummary(t, costed)
	normalized := costed.Replay
	normalized.ModelIdentity = funded.Replay.ModelIdentity
	normalized.CostIdentity = funded.Replay.CostIdentity
	if !reflect.DeepEqual(normalized, funded.Replay) {
		t.Fatal("explicit zero scenario changed replay diagnostics or lineage")
	}
	if costed.FinalModelCashUnits != funded.FinalModelCashUnits ||
		costed.FinalModelQuantity != funded.FinalModelQuantity ||
		costed.FinalPositionTotalBasisUnits != funded.FinalPositionCostUnits ||
		costed.FinalPositionValueUnits != funded.FinalPositionValueUnits ||
		costed.FinalEquityUnits != funded.FinalEquityUnits ||
		costed.NetRealizedAccountingPnLUnits != funded.RealizedAccountingPnLUnits ||
		costed.NetUnrealizedAccountingPnLUnits != funded.UnrealizedAccountingPnLUnits ||
		costed.AggregateFeeUnits != "0" ||
		!reflect.DeepEqual(costed.MaxCloseMarkDrawdown, funded.MaxCloseMarkDrawdown) {
		t.Fatal("explicit zero scenario changed funded accounting")
	}
	for i, mark := range costed.CloseMarks {
		old := funded.CloseMarks[i]
		if mark.ModelCashUnits != old.ModelCashUnits ||
			mark.ModelQuantity != old.ModelQuantity ||
			mark.PositionTotalBasisUnits != old.PositionCostUnits ||
			mark.PositionValueUnits != old.PositionValueUnits ||
			mark.EquityUnits != old.EquityUnits ||
			mark.NetRealizedAccountingPnLUnits != old.RealizedPnLUnits ||
			mark.NetUnrealizedAccountingPnLUnits != old.UnrealizedPnLUnits ||
			!reflect.DeepEqual(mark.CloseMarkDrawdown, old.CloseMarkDrawdown) {
			t.Fatalf("zero scenario mark mismatch at %d", i)
		}
	}
	if _, ok := backtestCausalSummary(costed.Replay); ok {
		t.Fatal("A summary accepted new identities")
	}
	masked := funded
	masked.ModelIdentity = costed.ModelIdentity
	masked.CostIdentity = costed.CostIdentity
	masked.Replay = costed.Replay
	if _, ok := backtestCausalFundedSummary(masked); ok {
		t.Fatal("B1 summary accepted new identities")
	}
}

func TestFeeScenarioCLIExitDeficit(t *testing.T) {
	bars := feeScenarioCLIBars(24, 100)
	for i := 22; i < len(bars); i++ {
		bars[i].Open, bars[i].High = 1, 1
		bars[i].Low, bars[i].Close = 1, 1
	}
	scenario := backtest.FeeScenario{FixedFee: "1", FeeBps: "0"}
	engine, _ := feeScenarioCLIEngine("roundtrip")
	r, err := engine.RunFeeScenarioCausal(context.Background(), "TEST", bars, "10", scenario)
	if feeScenarioCLIEngineError(err) != "insufficient_exit_fee_cash" ||
		!reflect.DeepEqual(r, backtest.FeeScenarioCausalResult{}) {
		t.Fatalf("exit deficit did not zero result: %v", err)
	}
	engine, _ = feeScenarioCLIEngine("roundtrip")
	var stdout, stderr bytes.Buffer
	if runBacktestCausalFeesEngine(context.Background(), "TEST", bars, "10", scenario,
		engine, &stdout, &stderr) == 0 ||
		stdout.Len() != 0 ||
		stderr.String() != "backtest-causal-fees: insufficient_exit_fee_cash\n" {
		t.Fatal("exit deficit CLI failure mismatch")
	}
	engine, _ = feeScenarioCLIEngine("roundtrip")
	r, err = engine.RunFeeScenarioCausal(context.Background(), "TEST", bars, "100", scenario)
	if err != nil {
		t.Fatal(err)
	}
	out := feeScenarioCLIRequireSummary(t, r)
	feeScenarioCLIRequireLines(t, out,
		"Final model cash: 89.09000000",
		"Gross realized accounting PnL: -8.91000000",
		"Net realized accounting PnL: -10.91000000",
		"Aggregate fees: 2.00000000")
	if r.CashFlows[1].NetCashDeltaUnits != "-91000000" ||
		r.CashFlows[1].DebitedUnits != "91000000" ||
		r.CashFlows[1].CreditedUnits != "0" {
		t.Fatal("signed exit cash delta was clipped or misclassified")
	}
}

func TestFeeScenarioCLITargetZeroAndQuantityBounds(t *testing.T) {
	for _, bps := range []string{"1", "10000"} {
		for _, cash := range []string{"0", "100"} {
			engine, _ := feeScenarioCLIEngine("buy")
			r, err := engine.RunFeeScenarioCausal(context.Background(), "TEST",
				feeScenarioCLIBars(21, 100), cash,
				backtest.FeeScenario{FixedFee: "9.99999999", FeeBps: bps})
			if feeScenarioCLIEngineError(err) != "numeric_range" ||
				!reflect.DeepEqual(r, backtest.FeeScenarioCausalResult{}) {
				t.Fatalf("zero target cash=%s bps=%s: %v", cash, bps, err)
			}
		}
		for _, count := range []int{19, 21} {
			r := feeScenarioCLIResult(t, count, "0", "9.99999999", bps, "hold")
			out := feeScenarioCLIRequireSummary(t, r)
			feeScenarioCLIRequireLines(t, out,
				"Model fills: 0", "Rejected entries: 0",
				"Final model equity: 0.00000000",
				"Max close-mark drawdown reason: zero_initial_model_equity")
		}
	}
	for _, tc := range []struct {
		price float64
		fixed string
	}{
		{100, "9.99999999"},
		{1000000, "1"},
	} {
		engine, _ := feeScenarioCLIEngine("buy")
		r, err := engine.RunFeeScenarioCausal(context.Background(), "TEST",
			feeScenarioCLIBars(21, tc.price), "100",
			backtest.FeeScenario{FixedFee: tc.fixed, FeeBps: "0"})
		if feeScenarioCLIEngineError(err) != "numeric_range" ||
			!reflect.DeepEqual(r, backtest.FeeScenarioCausalResult{}) {
			t.Fatalf("unsupported positive quantity scenario %+v: %v", tc, err)
		}
	}
	r := feeScenarioCLIResult(t, 24, "0", "0", "0", "buy")
	if len(r.RejectedEntries) != 4 || len(r.CashFlows) != 0 || r.AggregateFeeUnits != "0" {
		t.Fatal("supported unfunded entry was fatal or charged fees")
	}
	feeScenarioCLIRequireSummary(t, r)
}

func TestFeeScenarioCLIArgumentsAndGrammar(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	valid := []string{"BreakoutVol", "TEST", path, "100", "1", "0"}
	for count := 0; count <= 7; count++ {
		if count == 6 {
			continue
		}
		args := append([]string(nil), valid...)
		for len(args) < count {
			args = append(args, "PRIVATE_EXTRA")
		}
		args = args[:count]
		code, out, stderr := feeScenarioCLIRun(context.Background(), args...)
		if code == 0 || out != "" ||
			stderr != feeScenarioCLIUsage+"backtest-causal-fees: invalid_arguments\n" {
			t.Fatalf("argument count %d: %d %q %q", count, code, out, stderr)
		}
	}
	for _, target := range []string{"", "breakoutvol", "Plan", "PRIVATE_TARGET"} {
		args := append([]string(nil), valid...)
		args[0] = target
		code, out, stderr := feeScenarioCLIRun(context.Background(), args...)
		if code == 0 || out != "" || stderr != "backtest-causal-fees: unsupported_target\n" {
			t.Fatalf("target fallback for %q", target)
		}
	}
	for _, tc := range []struct {
		index int
		token string
		code  string
	}{
		{3, "", "invalid_model_cash"},
		{3, "-1", "invalid_model_cash"},
		{3, "1000000.00000001", "invalid_model_cash"},
		{3, "1.000000001", "invalid_model_cash"},
		{4, "", "invalid_fee_scenario"},
		{4, "10", "invalid_fee_scenario"},
		{4, "10.00000000", "invalid_fee_scenario"},
		{4, "-0", "invalid_fee_scenario"},
		{4, "+1", "invalid_fee_scenario"},
		{4, "01", "invalid_fee_scenario"},
		{4, ".1", "invalid_fee_scenario"},
		{4, "1.", "invalid_fee_scenario"},
		{4, "1e0", "invalid_fee_scenario"},
		{4, " 1", "invalid_fee_scenario"},
		{4, "1.000000001", "invalid_fee_scenario"},
		{4, "PRIVATE_FEE", "invalid_fee_scenario"},
		{5, "", "invalid_fee_scenario"},
		{5, "00", "invalid_fee_scenario"},
		{5, "01", "invalid_fee_scenario"},
		{5, "+1", "invalid_fee_scenario"},
		{5, "-0", "invalid_fee_scenario"},
		{5, "1.0", "invalid_fee_scenario"},
		{5, "1e2", "invalid_fee_scenario"},
		{5, "10001", "invalid_fee_scenario"},
		{5, "100000", "invalid_fee_scenario"},
		{5, "１", "invalid_fee_scenario"},
		{5, "PRIVATE_RATE", "invalid_fee_scenario"},
	} {
		args := append([]string(nil), valid...)
		args[tc.index] = tc.token
		code, out, stderr := feeScenarioCLIRun(context.Background(), args...)
		if code == 0 || out != "" || stderr != "backtest-causal-fees: "+tc.code+"\n" {
			t.Fatalf("grammar index=%d token=%q: %d %q %q",
				tc.index, tc.token, code, out, stderr)
		}
	}
}

func TestFeeScenarioCLIWholeCSVAndCancellation(t *testing.T) {
	for _, tc := range []struct {
		name, content, code string
	}{
		{"late syntax", causalCLITestPositiveCSV(21) + "\nPRIVATE_BAD_ROW", "invalid_csv"},
		{"bytes", strings.Repeat("x", causalCSVMaxBytes+1), "resource_limit"},
		{"rows", causalCSVHeader + "\n" + strings.Repeat("1,100,100,100,100,0\n",
			backtest.CausalMaxBars+1), "resource_limit"},
		{"header", "PRIVATE_HEADER\n1,100,100,100,100,0", "invalid_csv"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := causalCLITestFile(t, tc.content)
			code, out, stderr := feeScenarioCLIRun(context.Background(),
				"PRIVATE_TARGET", "TEST", path, "100", "1", "0")
			if code == 0 || out != "" || stderr != "backtest-causal-fees: "+tc.code+"\n" {
				t.Fatalf("complete parse did not precede target resolution: %d %q %q",
					code, out, stderr)
			}
		})
	}
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	code, out, stderr := feeScenarioCLIRun(context.Background(),
		"BreakoutVol", "TEST", path+"/PRIVATE_MISSING", "100", "1", "0")
	if code == 0 || out != "" || stderr != "backtest-causal-fees: input_file\n" {
		t.Fatal("missing file did not remain sanitized")
	}
	lateDomain := causalCLITestPositiveCSV(21) + "\n22,100,99,100,100,0"
	path = causalCLITestFile(t, lateDomain)
	code, out, stderr = feeScenarioCLIRun(context.Background(),
		"BreakoutVol", "TEST", path, "100", "1", "0")
	if code == 0 || out != "" || stderr != "backtest-causal-fees: invalid_input\n" {
		t.Fatalf("late domain failure: %d %q %q", code, out, stderr)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	code, out, stderr = feeScenarioCLIRun(ctx,
		"BreakoutVol", "TEST", "PRIVATE_UNOPENED", "100", "1", "0")
	if code == 0 || out != "" || stderr != "backtest-causal-fees: canceled\n" {
		t.Fatal("pre-canceled context was not honored")
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	engine, strategy := feeScenarioCLIEngine("buy")
	strategy.cancel = cancel
	var stdout, errout bytes.Buffer
	code = runBacktestCausalFeesEngine(ctx, "TEST", feeScenarioCLIBars(21, 100),
		"100", backtest.FeeScenario{FixedFee: "1", FeeBps: "0"},
		engine, &stdout, &errout)
	if code == 0 || stdout.Len() != 0 ||
		errout.String() != "backtest-causal-fees: canceled\n" {
		t.Fatal("callback cancellation leaked partial result")
	}
}

func TestFeeScenarioCLICoreFailuresBeforeCallbacks(t *testing.T) {
	for _, tc := range []struct {
		cash, fixed, bps, want string
	}{
		{"PRIVATE_CASH", "1", "0", "invalid_model_cash"},
		{"100", "PRIVATE_FEE", "0", "invalid_fee_scenario"},
		{"100", "1", "PRIVATE_RATE", "invalid_fee_scenario"},
	} {
		engine, strategy := feeScenarioCLIEngine("buy")
		var stdout, stderr bytes.Buffer
		code := runBacktestCausalFeesEngine(context.Background(), "TEST",
			feeScenarioCLIBars(21, 100), tc.cash,
			backtest.FeeScenario{FixedFee: tc.fixed, FeeBps: tc.bps},
			engine, &stdout, &stderr)
		if code == 0 || stdout.Len() != 0 || strategy.calls != 0 ||
			stderr.String() != "backtest-causal-fees: "+tc.want+"\n" {
			t.Fatalf("preflight failure %+v: %d calls %q", tc, strategy.calls, stderr.String())
		}
	}
	for _, tc := range []struct{ mode, want string }{
		{"error", "evaluator_error"},
		{"identity", "evaluator_identity"},
		{"numeric", "numeric_range"},
		{"prompt", "unsupported_condition"},
	} {
		engine, _ := feeScenarioCLIEngine(tc.mode)
		var stdout, stderr bytes.Buffer
		code := runBacktestCausalFeesEngine(context.Background(), "TEST",
			feeScenarioCLIBars(21, 100), "100",
			backtest.FeeScenario{FixedFee: "1", FeeBps: "0"},
			engine, &stdout, &stderr)
		if code == 0 || stdout.Len() != 0 ||
			stderr.String() != "backtest-causal-fees: "+tc.want+"\n" {
			t.Fatalf("callback failure %s: %d %q", tc.mode, code, stderr.String())
		}
	}
}

func TestFeeScenarioCLIErrorMapping(t *testing.T) {
	codes := []backtest.CausalErrorCode{
		backtest.FundedInvalidModelCash, backtest.FeeScenarioInvalidScenario,
		backtest.FeeScenarioInsufficientExitFeeCash, backtest.CausalInvalidInput,
		backtest.CausalInvalidSymbol, backtest.CausalInvalidEvaluator,
		backtest.CausalEvaluatorIdentity, backtest.CausalEvaluatorError,
		backtest.CausalPlanMembership, backtest.CausalUnsupported,
		backtest.CausalNumericRange, backtest.CausalCanceled, backtest.CausalResourceLimit,
	}
	for _, code := range codes {
		err := fmt.Errorf("PRIVATE_WRAPPER: %w",
			&backtest.FeeScenarioCausalError{Code: code, BarIndex: 20})
		if got := feeScenarioCLIEngineError(err); got != string(code) {
			t.Fatalf("mapping %s: %s", code, got)
		}
	}
	var typedNil *backtest.FeeScenarioCausalError
	for _, err := range []error{
		nil, typedNil, errors.New("PRIVATE_ERROR"),
		&backtest.CausalError{Code: backtest.CausalNumericRange},
		&backtest.FundedCausalError{Code: backtest.FundedInvalidModelCash},
		&backtest.FeeScenarioCausalError{Code: "PRIVATE_CODE"},
	} {
		if got := feeScenarioCLIEngineError(err); got != "replay_failed" {
			t.Fatalf("unexpected mapping %q", got)
		}
	}
	var stderr bytes.Buffer
	if feeScenarioCLIFail(&stderr, "PRIVATE_CODE") == 0 ||
		stderr.String() != "backtest-causal-fees: replay_failed\n" {
		t.Fatal("raw local error code escaped")
	}
}

func TestFeeScenarioCLIMalformedSummary(t *testing.T) {
	mutations := []struct {
		name string
		edit func(*backtest.FeeScenarioCausalResult)
	}{
		{"old model", func(r *backtest.FeeScenarioCausalResult) { r.ModelIdentity = backtest.FundedCausalModelIdentity }},
		{"old cost", func(r *backtest.FeeScenarioCausalResult) { r.CostIdentity = backtest.CausalCostIdentity }},
		{"nested model", func(r *backtest.FeeScenarioCausalResult) { r.Replay.ModelIdentity = backtest.CausalModelIdentity }},
		{"nested cost", func(r *backtest.FeeScenarioCausalResult) { r.Replay.CostIdentity = backtest.FundedCausalCostIdentity }},
		{"data", func(r *backtest.FeeScenarioCausalResult) { r.DataLabel = "PRIVATE_DATA" }},
		{"authority", func(r *backtest.FeeScenarioCausalResult) { r.Replay.AuthorityLabel = "PRIVATE_AUTHORITY" }},
		{"scale", func(r *backtest.FeeScenarioCausalResult) { r.Scale = 7 }},
		{"scenario basis", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.ScenarioBasis = "PRIVATE_BASIS" }},
		{"fee basis", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.FeeBasis = "raw_float" }},
		{"application", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.Application = "per_mark" }},
		{"denominator", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.RateDenominator = "010000" }},
		{"fixed canonical", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.FixedFeeUnits = "0100000000" }},
		{"fixed cap", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.FixedFeeUnits = "1000000000" }},
		{"rate canonical", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.FeeBps = "00" }},
		{"rate bound", func(r *backtest.FeeScenarioCausalResult) { r.Scenario.FeeBps = "10001" }},
		{"initial negative", func(r *backtest.FeeScenarioCausalResult) { r.InitialModelCashUnits = "-1" }},
		{"initial overflow", func(r *backtest.FeeScenarioCausalResult) { r.InitialModelCashUnits = "9223372036854775807" }},
		{"initial equity", func(r *backtest.FeeScenarioCausalResult) { r.InitialEquityUnits = "1" }},
		{"zero bars", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TotalBars = 0 }},
		{"bar cap", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TotalBars = backtest.CausalMaxBars + 1 }},
		{"missing marks", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks = nil }},
		{"missing flows", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows = nil }},
		{"missing evaluations", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Evaluations = nil }},
		{"evaluation index", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Evaluations[0].BarIndex = -1 }},
		{"evaluation prefix", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Evaluations[0].PrefixLength = 0 }},
		{"evaluation score", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Evaluations[0].Score = math.NaN() }},
		{"target", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TargetName = "PRIVATE_TARGET" }},
		{"pending", func(r *backtest.FeeScenarioCausalResult) { r.Replay.PendingSignalUnfilled = false }},
		{"fill index", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Fills[0].BarIndex = math.MaxInt }},
		{"fill entry index", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Fills[0].EntrySignalBarIndex = math.MaxInt }},
		{"fill nan", func(r *backtest.FeeScenarioCausalResult) { r.Replay.Fills[0].Price = math.NaN() }},
		{"flow negative", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].FeeUnits = "-1" }},
		{"flow canonical", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].GrossNotionalUnits = "+900000000" }},
		{"flow fee", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].FeeUnits = "0" }},
		{"flow delta", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].NetCashDeltaUnits = "1000000000" }},
		{"flow debit", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].DebitedUnits = "999999999" }},
		{"flow lineage", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].FillIndex = -1 }},
		{"flow basis", func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[0].PositionTotalBasisUnits = "900000000" }},
		{"mark units", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].ModelCashUnits = "00" }},
		{"mark cash", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].ModelCashUnits = "1" }},
		{"mark principal", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].PositionPrincipalUnits = "1" }},
		{"mark fee", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].PositionEntryFeeUnits = "0" }},
		{"mark value", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].PositionValueUnits = "-1" }},
		{"mark quantity", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].ModelQuantity = math.Inf(1) }},
		{"mark net", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].NetUnrealizedAccountingPnLUnits = "0" }},
		{"mark aggregate", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].AggregateFeeUnits = "200000000" }},
		{"mark dd nil", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].CloseMarkDrawdown.Percent = nil }},
		{"mark dd nan", func(r *backtest.FeeScenarioCausalResult) {
			v := math.NaN()
			r.CloseMarks[20].CloseMarkDrawdown.Percent = &v
		}},
		{"mark time", func(r *backtest.FeeScenarioCausalResult) { r.CloseMarks[20].Timestamp = r.CloseMarks[19].Timestamp }},
		{"final cash", func(r *backtest.FeeScenarioCausalResult) { r.FinalModelCashUnits = "1" }},
		{"final quantity", func(r *backtest.FeeScenarioCausalResult) { r.FinalModelQuantity = math.NaN() }},
		{"final basis", func(r *backtest.FeeScenarioCausalResult) { r.FinalPositionTotalBasisUnits = "1" }},
		{"final fee", func(r *backtest.FeeScenarioCausalResult) { r.OpenAttributedFeeUnits = "0" }},
		{"final aggregate", func(r *backtest.FeeScenarioCausalResult) { r.AggregateFeeUnits = "0" }},
		{"final dd null", func(r *backtest.FeeScenarioCausalResult) { r.MaxCloseMarkDrawdown = backtest.FundedCausalDrawdown{} }},
		{"final dd bar", func(r *backtest.FeeScenarioCausalResult) { v := 21; r.MaxCloseMarkDrawdown.BarIndex = &v }},
		{"terminal missing", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TerminalPosition = nil }},
		{"terminal index", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TerminalPosition.EntrySignalBarIndex = math.MaxInt }},
		{"terminal negative index", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TerminalPosition.EntrySignalBarIndex = -1 }},
		{"terminal peak", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TerminalPosition.PeakPrice = math.Inf(1) }},
		{"terminal price", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TerminalPosition.LastClosePrice = 99 }},
		{"terminal gross", func(r *backtest.FeeScenarioCausalResult) { r.Replay.TerminalPosition.GrossUnrealizedPnL = math.NaN() }},
		{"float gross", func(r *backtest.FeeScenarioCausalResult) { r.Replay.GrossRealizedPnL = math.Inf(1) }},
		{"float factor", func(r *backtest.FeeScenarioCausalResult) { v := math.NaN(); r.Replay.GrossProfitFactor = &v }},
	}
	for _, tc := range mutations {
		t.Run(tc.name, func(t *testing.T) {
			r := feeScenarioCLIResult(t, 24, "10", "1", "0", "buy")
			tc.edit(&r)
			out, ok := backtestCausalFeesSummary(r)
			if ok || out != "" {
				t.Fatalf("malformed result accepted: %q", out)
			}
		})
	}
}

func TestFeeScenarioCLIRejectedAndClosedMutations(t *testing.T) {
	for _, edit := range []func(*backtest.FeeScenarioCausalResult){
		func(r *backtest.FeeScenarioCausalResult) { r.RejectedEntries[0].BarIndex = -1 },
		func(r *backtest.FeeScenarioCausalResult) { r.RejectedEntries[0].EvaluationBarIndex = math.MaxInt },
		func(r *backtest.FeeScenarioCausalResult) { r.RejectedEntries[0].FeeUnits = "0" },
		func(r *backtest.FeeScenarioCausalResult) { r.RejectedEntries[0].RequiredModelCashUnits = "900000000" },
		func(r *backtest.FeeScenarioCausalResult) { r.RejectedEntries[0].Reason = "PRIVATE_REASON" },
		func(r *backtest.FeeScenarioCausalResult) {
			r.RejectedEntries = append(r.RejectedEntries, r.RejectedEntries[0])
		},
	} {
		r := feeScenarioCLIResult(t, 21, "0", "1", "0", "buy")
		edit(&r)
		if out, ok := backtestCausalFeesSummary(r); ok || out != "" {
			t.Fatal("malformed rejection accepted")
		}
	}
	for _, edit := range []func(*backtest.FeeScenarioCausalResult){
		func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[1].ClosedAttributedFeeUnits = "100000000" },
		func(r *backtest.FeeScenarioCausalResult) { r.CashFlows[1].NetRealizedAccountingPnLUnits = "0" },
		func(r *backtest.FeeScenarioCausalResult) { r.Replay.ClosedTradeCount = 0 },
		func(r *backtest.FeeScenarioCausalResult) { r.Replay.WinningClosedTradeCount = 1 },
		func(r *backtest.FeeScenarioCausalResult) { r.Replay.Fills[1].Quantity *= 2 },
		func(r *backtest.FeeScenarioCausalResult) { r.GrossRealizedAccountingPnLUnits = "1" },
		func(r *backtest.FeeScenarioCausalResult) { r.NetRealizedAccountingPnLUnits = "0" },
	} {
		r := feeScenarioCLIResult(t, 24, "10", "1", "0", "roundtrip")
		edit(&r)
		if out, ok := backtestCausalFeesSummary(r); ok || out != "" {
			t.Fatal("malformed closed accounting accepted")
		}
	}
	zero := feeScenarioCLIResult(t, 19, "0", "1", "0", "hold")
	zero.MaxCloseMarkDrawdown.UndefinedReason = "PRIVATE_REASON"
	if out, ok := backtestCausalFeesSummary(zero); ok || out != "" {
		t.Fatal("arbitrary drawdown null reason accepted")
	}
}

type feeScenarioCLIWriter struct {
	bytes.Buffer
	calls  int
	short  bool
	fail   bool
	prefix int
}

func (w *feeScenarioCLIWriter) Write(p []byte) (int, error) {
	w.calls++
	if w.short || w.fail {
		n := w.prefix
		if n > len(p) {
			n = len(p)
		}
		_, _ = w.Buffer.Write(p[:n])
		if w.fail {
			return n, errors.New("PRIVATE_WRITER_ERROR")
		}
		return n, nil
	}
	return w.Buffer.Write(p)
}

// Do not promote bytes.Buffer.WriteString: route io.WriteString through Write
// so calls, retained prefixes and failures are observed by this test writer.
func (w *feeScenarioCLIWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

func TestFeeScenarioCLIOutputFailures(t *testing.T) {
	scenario := backtest.FeeScenario{FixedFee: "1", FeeBps: "0"}
	for _, tc := range []struct {
		name        string
		short, fail bool
	}{
		{"short", true, false},
		{"prefix error", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine, _ := feeScenarioCLIEngine("buy")
			stdout := &feeScenarioCLIWriter{short: tc.short, fail: tc.fail, prefix: 17}
			var stderr bytes.Buffer
			code := runBacktestCausalFeesEngine(context.Background(), "TEST",
				feeScenarioCLIBars(21, 100), "100", scenario, engine, stdout, &stderr)
			if code == 0 || stdout.calls != 1 || stdout.Len() != 17 ||
				stderr.String() != "backtest-causal-fees: output_error\n" {
				t.Fatalf("output failure retried or hidden: code=%d calls=%d bytes=%d stderr=%q",
					code, stdout.calls, stdout.Len(), stderr.String())
			}
			if !strings.HasPrefix("GELT DECLARED-FEE CAUSAL CSV REPLAY SUMMARY\n", stdout.String()) {
				t.Fatal("retained prefix mismatch")
			}
		})
	}
	engine, _ := feeScenarioCLIEngine("buy")
	stdout := &feeScenarioCLIWriter{}
	var stderr bytes.Buffer
	if runBacktestCausalFeesEngine(nil, "TEST", feeScenarioCLIBars(21, 100),
		"100", scenario, engine, stdout, &stderr) != 0 ||
		stdout.calls != 1 || stderr.Len() != 0 {
		t.Fatal("successful output did not make exactly one attempt")
	}
	engine, _ = feeScenarioCLIEngine("buy")
	stderr.Reset()
	if runBacktestCausalFeesEngine(context.Background(), "TEST", feeScenarioCLIBars(21, 100),
		"100", scenario, engine, nil, &stderr) == 0 ||
		stderr.String() != "backtest-causal-fees: output_error\n" {
		t.Fatal("nil stdout was not handled")
	}
	engine, _ = feeScenarioCLIEngine("buy")
	failingStderr := &feeScenarioCLIWriter{fail: true, prefix: 3}
	if runBacktestCausalFeesEngine(context.Background(), "TEST", feeScenarioCLIBars(21, 100),
		"PRIVATE_CASH", scenario, engine, io.Discard, failingStderr) == 0 ||
		failingStderr.calls != 1 {
		t.Fatal("stderr failure became success or was retried")
	}
	if runBacktestCausalFees(nil, nil, nil, nil) == 0 {
		t.Fatal("nil outputs on argument failure became success")
	}
	stderr.Reset()
	if runBacktestCausalFeesEngine(nil, "TEST", nil, "100", scenario,
		nil, nil, &stderr) == 0 ||
		stderr.String() != "backtest-causal-fees: invalid_evaluator\n" {
		t.Fatal("nil engine was not handled")
	}
}
