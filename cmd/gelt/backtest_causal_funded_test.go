package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

func fundedCLITestRun(ctx context.Context, args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := runBacktestCausalFunded(ctx, args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func fundedCLITestSummary(t *testing.T, output string, fragments ...string) {
	t.Helper()
	if !utf8.ValidString(output) || len(output) > fundedCLISummaryMaxBytes {
		t.Fatal("summary is invalid UTF-8 or exceeds its byte bound")
	}
	for _, fragment := range fragments {
		if !strings.Contains(output, fragment) {
			t.Fatalf("missing %q in %q", fragment, output)
		}
	}
	for _, forbidden := range []string{
		"PRIVATE_", "AgentPrompt", "Rationale", "Timestamp,Open",
		"qualified=true", "promoted", "Net PnL", "insufficient_model_cash",
	} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("unexpected summary text %q", forbidden)
		}
	}
}

func TestBacktestCausalFundedActualRouteAndMandatoryCapital(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	for _, test := range []struct {
		capital, cash, equity string
		fills, rejected       int
		open                  string
		nullDD                bool
	}{
		{"0", "0.00000000", "0.00000000", 0, 1, "none", true},
		{"9.99999999", "9.99999999", "9.99999999", 0, 1, "none", false},
		{"10", "0.00000000", "10.00000000", 1, 0, "present", false},
		{"100.00000000", "90.00000000", "100.00000000", 1, 0, "present", false},
	} {
		t.Run(test.capital, func(t *testing.T) {
			code, output, diagnostic := fundedCLITestRun(nil,
				"BreakoutVol", "TEST", path, test.capital)
			if code != 0 || diagnostic != "" {
				t.Fatalf("actual route failed: %d %q", code, diagnostic)
			}
			fundedCLITestSummary(t, output,
				"Model: gelt.legacy-go.funded-close-next-open.v1\n",
				"Cost: frictionless_funded_fixed8_diagnostic\n",
				"Data: unqualified_offline\nAuthority: unqualified_offline\n",
				"Accounting: Scale 8 engineering modelUSD resolution",
				"Costs: frictionless; no fees or slippage.\n",
				"no real cash, holdings, execution or qualification",
				"Bars: 21\nEvaluations: 2\n",
				fmt.Sprintf("Model fills: %d\n", test.fills),
				fmt.Sprintf("Rejected entries: %d\n", test.rejected),
				"Final model cash: "+test.cash+"\n",
				"Final model equity: "+test.equity+"\n",
				"Final open model position: "+test.open+"\n",
				"Final directional signal pending: true\n",
				"may be a no-op, not an actual unfilled order")
			if strings.Contains(output, path) {
				t.Fatal("input path leaked")
			}
			if test.nullDD {
				fundedCLITestSummary(t, output,
					"Max close-mark drawdown loss units: null\n",
					"Max close-mark drawdown peak units: null\n",
					"Max close-mark drawdown percent (derived): null\n",
					"Max close-mark drawdown reason: zero_initial_model_equity\n")
			} else {
				fundedCLITestSummary(t, output,
					"Max close-mark drawdown loss units: 0\n",
					"Max close-mark drawdown bar: null (no_positive_close_mark_loss)\n",
					"Max close-mark drawdown percent (derived): 0.000000000000e+00\n")
				if strings.Contains(output, "zero_initial_model_equity") {
					t.Fatal("positive capital mislabeled as undefined drawdown")
				}
			}
		})
	}

	for _, args := range [][]string{
		nil,
		{"BreakoutVol"},
		{"BreakoutVol", "TEST"},
		{"BreakoutVol", "TEST", path},
		{"BreakoutVol", "TEST", path, "100", "PRIVATE_EXTRA"},
	} {
		code, output, diagnostic := fundedCLITestRun(nil, args...)
		if code == 0 || output != "" ||
			diagnostic != fundedCLIUsage+"backtest-causal-funded: invalid_arguments\n" {
			t.Fatalf("argument handling differs: %d %q %q", code, output, diagnostic)
		}
	}
	for _, target := range []string{"", "breakoutvol", "DefaultPlan", "PRIVATE_TARGET\nsecret"} {
		code, output, diagnostic := fundedCLITestRun(nil, target, "TEST", path, "100")
		if code == 0 || output != "" ||
			diagnostic != "backtest-causal-funded: unsupported_target\n" {
			t.Fatalf("unsupported target escaped: %d %q %q", code, output, diagnostic)
		}
	}
}

func TestBacktestCausalFundedCapitalGrammarReachesCoreUnchanged(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	for _, token := range []string{
		"", "+10", "-0", " 10", "10 ", "01", "00.0", ".1", "1.",
		"1e1", "NaN", "Inf", "10.000000000", "1000000.00000001",
		"1000001", "١٠", "PRIVATE_CASH", strings.Repeat("9", 33),
	} {
		t.Run(strconv.Quote(token), func(t *testing.T) {
			code, output, diagnostic := fundedCLITestRun(nil,
				"BreakoutVol", "TEST", path, token)
			if code == 0 || output != "" ||
				diagnostic != "backtest-causal-funded: invalid_model_cash\n" {
				t.Fatalf("capital grammar changed: %d %q %q", code, output, diagnostic)
			}
		})
	}
	short := causalCLITestFile(t, causalCLITestPositiveCSV(19))
	for _, token := range []string{"0", "0.00000001", "10.0", "1000000.00000000"} {
		code, output, diagnostic := fundedCLITestRun(nil, "BreakoutVol", "TEST", short, token)
		if code != 0 || diagnostic != "" {
			t.Fatalf("valid capital rejected: %q %d %q", token, code, diagnostic)
		}
		fundedCLITestSummary(t, output,
			"Evaluations: 0\nModel fills: 0\n",
			"Final open model position: none\n",
			"Final directional signal pending: false\n")
	}
}

type fundedCLITestStrategy struct {
	*strategies.BreakoutVolStrategy
	mode   string
	calls  int
	cancel context.CancelFunc
}

func (s *fundedCLITestStrategy) Evaluate(
	ctx context.Context, at time.Time, symbol string, closes, volumes []float64,
) (strategies.StrategySignal, error) {
	s.calls++
	if s.mode == "error" {
		return strategies.StrategySignal{}, errors.New("PRIVATE_CALLBACK_ERROR")
	}
	if s.cancel != nil {
		s.cancel()
	}
	signal := strategies.StrategySignal{
		StrategyName: "BreakoutVol", Symbol: symbol, Timestamp: at,
		AssetClass: strategies.AssetEquity, Signal: strategies.SignalHold,
		Score: 90, StopLossPct: 0, TargetPct: 0,
		Rationale: "PRIVATE_RATIONALE",
	}
	switch s.mode {
	case "buy":
		signal.Signal = strategies.SignalBuy
	case "numeric":
		signal.Score = math.NaN()
	case "identity":
		signal.Symbol = "PRIVATE_IDENTITY"
	case "prompt":
		signal.AgentPrompt = "PRIVATE_PROMPT"
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

func fundedCLITestBars(count int) []backtest.OHLCV {
	bars := make([]backtest.OHLCV, count)
	for i := range bars {
		bars[i] = backtest.OHLCV{
			Timestamp: int64(i + 1), Open: 100, High: 100,
			Low: 100, Close: 100, Volume: 0,
		}
	}
	if count > 20 {
		bars[20].Low, bars[20].Close = 50, 50
	}
	if count > 21 {
		bars[21].Open, bars[21].High = 50, 50
		bars[21].Low, bars[21].Close = 50, 50
	}
	for i := 22; i < count; i++ {
		bars[i].Open, bars[i].High = 110, 110
		bars[i].Low, bars[i].Close = 110, 110
	}
	return bars
}

func fundedCLITestResult(t *testing.T, count int, cash, mode string) backtest.FundedCausalResult {
	t.Helper()
	s := &fundedCLITestStrategy{
		BreakoutVolStrategy: strategies.NewBreakoutVolStrategy(), mode: mode,
	}
	result, err := backtest.NewStrategyEngine(s).RunFundedCausal(
		context.Background(), "TEST", fundedCLITestBars(count), cash)
	if err != nil {
		t.Fatalf("controlled engine failed: %v", err)
	}
	if s.calls != count-19 {
		t.Fatalf("unexpected evaluation count: %d", s.calls)
	}
	return result
}

func TestBacktestCausalFundedControlledOpenLossAndRecovery(t *testing.T) {
	open := fundedCLITestResult(t, 21, "100", "")
	if open.FinalModelCashUnits != "9000000000" ||
		open.FinalPositionValueUnits != "500000000" ||
		open.FinalEquityUnits != "9500000000" ||
		open.RealizedAccountingPnLUnits != "0" ||
		open.UnrealizedAccountingPnLUnits != "-500000000" ||
		open.FinalModelQuantity != 0.1 {
		t.Fatalf("open-loss integer oracle differs: %+v", open)
	}
	output, ok := backtestCausalFundedSummary(open)
	if !ok {
		t.Fatal("valid terminal-open result rejected")
	}
	fundedCLITestSummary(t, output,
		"Final model cash: 90.00000000\n",
		"Final modeled quantity: 1.000000000000e-01\n",
		"Final position value: 5.00000000\n",
		"Final model equity: 95.00000000\n",
		"Realized accounting PnL: 0.00000000\n",
		"Unrealized accounting PnL: -5.00000000\n",
		"Max close-mark drawdown loss units: 500000000\n",
		"Max close-mark drawdown peak units: 10000000000\n",
		"Max close-mark drawdown bar: 20\n",
		"Max close-mark drawdown percent (derived): 5.000000000000e+00\n",
		"Float diagnostic gross realized PnL: 0.000000000000e+00\n",
		"Float diagnostic gross unrealized PnL: -5.000000000000e+00\n",
		"Final open model position: present\n",
		"cash excludes open-position proceeds; equity includes the close mark")

	recovered := fundedCLITestResult(t, 24, "100", "")
	if len(recovered.Replay.Fills) != 2 ||
		recovered.FinalModelCashUnits != "10100000000" ||
		recovered.FinalEquityUnits != "10100000000" ||
		recovered.RealizedAccountingPnLUnits != "100000000" ||
		recovered.UnrealizedAccountingPnLUnits != "0" ||
		recovered.PeakCloseEquityUnits != "10100000000" ||
		recovered.FinalModelQuantity != 0 ||
		recovered.MaxCloseMarkDrawdown.BarIndex == nil ||
		*recovered.MaxCloseMarkDrawdown.BarIndex != 20 {
		t.Fatalf("recovery integer oracle differs: %+v", recovered)
	}
	output, ok = backtestCausalFundedSummary(recovered)
	if !ok {
		t.Fatal("valid recovered result rejected")
	}
	fundedCLITestSummary(t, output,
		"Model fills: 2\nClosed trades: 1\nWinning closed trades: 1\n",
		"Final model cash: 101.00000000\n",
		"Final model equity: 101.00000000\n",
		"Realized accounting PnL: 1.00000000\n",
		"Unrealized accounting PnL: 0.00000000\n",
		"Peak close equity: 101.00000000\n",
		"Max close-mark drawdown bar: 20\n",
		"Max close-mark drawdown percent (derived): 5.000000000000e+00\n",
		"Final open model position: none\n",
		"Final directional signal pending: false\n")

	var stdout, stderr bytes.Buffer
	s := &fundedCLITestStrategy{BreakoutVolStrategy: strategies.NewBreakoutVolStrategy()}
	code := runBacktestCausalFundedEngine(nil, "TEST", fundedCLITestBars(24),
		"100", backtest.NewStrategyEngine(s), &stdout, &stderr)
	if code != 0 || stderr.Len() != 0 || stdout.String() != output || s.calls != 5 {
		t.Fatalf("typed seam differs: %d %q calls=%d", code, stderr.String(), s.calls)
	}

	if old, accepted := backtestCausalSummary(recovered.Replay); accepted || old != "" {
		t.Fatal("immutable A summary accepted funded replay identity")
	}
}

func TestBacktestCausalFundedRepeatedRejectionsAndPendingNoOp(t *testing.T) {
	for _, cash := range []string{"0", "9.99999999"} {
		result := fundedCLITestResult(t, 24, cash, "buy")
		if len(result.Replay.Fills) != 0 || len(result.CashFlows) != 0 ||
			len(result.RejectedEntries) != 4 ||
			result.Replay.ClosedTradeCount != 0 ||
			result.Replay.TerminalPosition != nil ||
			!result.Replay.PendingSignalUnfilled {
			t.Fatalf("rejected entries became fills or stopped replay: %+v", result)
		}
		output, ok := backtestCausalFundedSummary(result)
		if !ok {
			t.Fatal("valid unfunded result rejected")
		}
		fundedCLITestSummary(t, output,
			"Model fills: 0\nClosed trades: 0\n",
			"Rejected entries: 4\n",
			"Final directional signal pending: true\n")
	}
	result := fundedCLITestResult(t, 21, "100", "buy")
	output, ok := backtestCausalFundedSummary(result)
	if !ok {
		t.Fatal("active-position pending BUY rejected")
	}
	fundedCLITestSummary(t, output,
		"Model fills: 1\n", "Rejected entries: 0\n",
		"Final open model position: present\n",
		"Final directional signal pending: true\n",
		"may be a no-op, not an actual unfilled order")
}

func TestBacktestCausalFundedCSVFilesAndCancellationSanitized(t *testing.T) {
	good := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	for _, test := range []struct {
		name, content, target, want string
	}{
		{"late", causalCLITestPositiveCSV(21) + "\n22,100,PRIVATE_PARSE,100,100,0",
			"PRIVATE_TARGET", "invalid_csv"},
		{"limit", strings.Repeat("x", causalCSVMaxBytes+1),
			"BreakoutVol", "resource_limit"},
		{"domain", causalCLITestCSV("1,100,99,100,100,0"),
			"BreakoutVol", "invalid_input"},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := causalCLITestFile(t, test.content)
			code, output, diagnostic := fundedCLITestRun(nil, test.target, "TEST", path, "100")
			if code == 0 || output != "" ||
				diagnostic != "backtest-causal-funded: "+test.want+"\n" {
				t.Fatalf("CSV failure differs: %d %q %q", code, output, diagnostic)
			}
		})
	}
	for _, path := range []string{
		filepath.Join(t.TempDir(), "PRIVATE_MISSING.csv"), t.TempDir(),
	} {
		code, output, diagnostic := fundedCLITestRun(nil, "BreakoutVol", "TEST", path, "100")
		if code == 0 || output != "" ||
			diagnostic != "backtest-causal-funded: input_file\n" {
			t.Fatalf("file error leaked: %d %q %q", code, output, diagnostic)
		}
	}
	code, output, diagnostic := fundedCLITestRun(nil,
		"BreakoutVol", "PRIVATE_symbol\n", good, "100")
	if code == 0 || output != "" ||
		diagnostic != "backtest-causal-funded: invalid_symbol\n" {
		t.Fatalf("symbol failure leaked: %d %q %q", code, output, diagnostic)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	code, output, diagnostic = fundedCLITestRun(ctx, "BreakoutVol", "TEST", good, "100")
	if code == 0 || output != "" ||
		diagnostic != "backtest-causal-funded: canceled\n" {
		t.Fatalf("cancellation differs: %d %q %q", code, output, diagnostic)
	}
}

func TestBacktestCausalFundedEvaluatorAndErrorMapping(t *testing.T) {
	for _, test := range []struct{ mode, want string }{
		{"error", "evaluator_error"},
		{"numeric", "numeric_range"},
		{"identity", "evaluator_identity"},
		{"prompt", "unsupported_condition"},
		{"cancel", "canceled"},
	} {
		t.Run(test.mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := &fundedCLITestStrategy{
				BreakoutVolStrategy: strategies.NewBreakoutVolStrategy(), mode: test.mode,
			}
			if test.mode == "cancel" {
				s.cancel = cancel
			}
			var stdout, stderr bytes.Buffer
			code := runBacktestCausalFundedEngine(ctx, "TEST", fundedCLITestBars(21),
				"100", backtest.NewStrategyEngine(s), &stdout, &stderr)
			if code == 0 || stdout.Len() != 0 ||
				stderr.String() != "backtest-causal-funded: "+test.want+"\n" ||
				s.calls != 1 {
				t.Fatalf("callback failure differs: %d %q calls=%d",
					code, stderr.String(), s.calls)
			}
		})
	}
	for _, code := range []backtest.CausalErrorCode{
		backtest.FundedInvalidModelCash, backtest.CausalInvalidInput,
		backtest.CausalInvalidSymbol, backtest.CausalInvalidEvaluator,
		backtest.CausalEvaluatorIdentity, backtest.CausalEvaluatorError,
		backtest.CausalPlanMembership, backtest.CausalUnsupported,
		backtest.CausalNumericRange, backtest.CausalCanceled,
		backtest.CausalResourceLimit,
	} {
		err := fmt.Errorf("PRIVATE_WRAPPER: %w",
			&backtest.FundedCausalError{Code: code, BarIndex: 20})
		if got := fundedCLIEngineError(err); got != string(code) {
			t.Fatalf("mapping differs: %q -> %q", code, got)
		}
	}
	var typedNil *backtest.FundedCausalError
	for _, err := range []error{
		errors.New("PRIVATE_ERROR"),
		&backtest.FundedCausalError{Code: "PRIVATE_CODE"},
		&backtest.CausalError{Code: backtest.CausalNumericRange},
		typedNil,
		nil,
	} {
		if fundedCLIEngineError(err) != "replay_failed" {
			t.Fatal("unknown or wrong error type was accepted")
		}
	}
	var stderr bytes.Buffer
	if fundedCLIFail(&stderr, "PRIVATE_CODE") == 0 ||
		stderr.String() != "backtest-causal-funded: replay_failed\n" {
		t.Fatal("arbitrary local error code leaked")
	}
}

func TestBacktestCausalFundedCanonicalUnitsAndExactDecimalDisplay(t *testing.T) {
	for _, test := range []struct {
		units, display string
		signed         bool
	}{
		{"0", "0.00000000", false},
		{"1", "0.00000001", false},
		{"99999999", "0.99999999", false},
		{"100000000", "1.00000000", false},
		{"100000000000000", "1000000.00000000", false},
		{"200000000000000", "2000000.00000000", false},
		{"-1", "-0.00000001", true},
		{"-500000000", "-5.00000000", true},
		{"-200000000000000", "-2000000.00000000", true},
	} {
		if _, ok := fundedCLIUnits(test.units, test.signed, fundedCLIMaxEquity); !ok {
			t.Fatalf("canonical units rejected: %q", test.units)
		}
		if got := fundedCLIDecimal(test.units); got != test.display {
			t.Fatalf("decimal display differs: %q -> %q", test.units, got)
		}
	}
	for _, token := range []string{
		"", "-0", "+0", "+1", "00", "01", "-01", "1.0", "1e8",
		" 1", "1 ", "١", "NaN", "200000000000001",
		"-200000000000001", "9223372036854775808",
		"-9223372036854775808", strings.Repeat("9", 1000),
	} {
		if _, ok := fundedCLIUnits(token, true, fundedCLIMaxEquity); ok {
			t.Fatalf("invalid units accepted: %q", token)
		}
	}
	if _, ok := fundedCLIUnits("-1", false, fundedCLIMaxUnits); ok {
		t.Fatal("unsigned money accepted negative units")
	}
	for _, test := range []struct {
		price, quantity float64
		units           int64
	}{
		{1, 1.0 / 512, 195312},
		{1, 3.0 / 512, 585938},
		{100, 0.1, 1000000000},
	} {
		got, ok := fundedCLIQuote(test.price, test.quantity)
		if !ok || got != test.units {
			t.Fatalf("rational quote oracle differs: %d %t", got, ok)
		}
	}
}

func TestBacktestCausalFundedSummaryRejectsMalformedResults(t *testing.T) {
	for name, mutate := range map[string]func(*backtest.FundedCausalResult){
		"old-model": func(r *backtest.FundedCausalResult) {
			r.ModelIdentity = backtest.CausalModelIdentity
		},
		"old-nested-model": func(r *backtest.FundedCausalResult) {
			r.Replay.ModelIdentity = backtest.CausalModelIdentity
		},
		"old-cost": func(r *backtest.FundedCausalResult) {
			r.CostIdentity = backtest.CausalCostIdentity
		},
		"nested-cost": func(r *backtest.FundedCausalResult) {
			r.Replay.CostIdentity = "PRIVATE_COST"
		},
		"data":        func(r *backtest.FundedCausalResult) { r.DataLabel = "PRIVATE_DATA" },
		"authority":   func(r *backtest.FundedCausalResult) { r.AuthorityLabel = "PRIVATE_AUTH" },
		"nested-data": func(r *backtest.FundedCausalResult) { r.Replay.DataLabel = "PRIVATE_DATA" },
		"nested-authority": func(r *backtest.FundedCausalResult) {
			r.Replay.AuthorityLabel = "PRIVATE_AUTH"
		},
		"scale": func(r *backtest.FundedCausalResult) { r.Scale = 2 },
		"initial-nonnumeric": func(r *backtest.FundedCausalResult) {
			r.InitialModelCashUnits = "PRIVATE_CASH"
		},
		"initial-overflow": func(r *backtest.FundedCausalResult) {
			r.InitialModelCashUnits = "9223372036854775808"
		},
		"initial-leading-zero": func(r *backtest.FundedCausalResult) {
			r.InitialModelCashUnits = "010000000000"
		},
		"initial-equity":     func(r *backtest.FundedCausalResult) { r.InitialEquityUnits = "0" },
		"final-noncanonical": func(r *backtest.FundedCausalResult) { r.FinalModelCashUnits = "+1" },
		"final-quantity":     func(r *backtest.FundedCausalResult) { r.FinalModelQuantity = math.NaN() },
		"final-equity":       func(r *backtest.FundedCausalResult) { r.FinalEquityUnits = "1" },
		"final-basis":        func(r *backtest.FundedCausalResult) { r.FinalPositionCostUnits = "1" },
		"final-value":        func(r *backtest.FundedCausalResult) { r.FinalPositionValueUnits = "1" },
		"final-realized":     func(r *backtest.FundedCausalResult) { r.RealizedAccountingPnLUnits = "1" },
		"final-unrealized":   func(r *backtest.FundedCausalResult) { r.UnrealizedAccountingPnLUnits = "1" },
		"final-peak":         func(r *backtest.FundedCausalResult) { r.PeakCloseEquityUnits = "0" },
		"bars":               func(r *backtest.FundedCausalResult) { r.Replay.TotalBars = 10001 },
		"negative-trades":    func(r *backtest.FundedCausalResult) { r.Replay.ClosedTradeCount = -1 },
		"wins":               func(r *backtest.FundedCausalResult) { r.Replay.WinningClosedTradeCount = 2 },
		"gross-nan":          func(r *backtest.FundedCausalResult) { r.Replay.GrossRealizedPnL = math.NaN() },
		"gross-inf":          func(r *backtest.FundedCausalResult) { r.Replay.GrossProfit = math.Inf(1) },
		"gross-reason": func(r *backtest.FundedCausalResult) {
			r.Replay.GrossProfitFactorReason = "PRIVATE_REASON"
		},
		"gross-factor": func(r *backtest.FundedCausalResult) {
			v := math.Inf(1)
			r.Replay.GrossProfitFactor = &v
			r.Replay.GrossProfitFactorReason = ""
		},
		"missing-marks": func(r *backtest.FundedCausalResult) { r.CloseMarks = r.CloseMarks[:1] },
		"missing-flows": func(r *backtest.FundedCausalResult) { r.CashFlows = nil },
		"mark-index":    func(r *backtest.FundedCausalResult) { r.CloseMarks[20].BarIndex = 19 },
		"mark-cash":     func(r *backtest.FundedCausalResult) { r.CloseMarks[20].ModelCashUnits = "1" },
		"mark-value": func(r *backtest.FundedCausalResult) {
			r.CloseMarks[20].PositionValueUnits = "100000000000001"
		},
		"mark-equity": func(r *backtest.FundedCausalResult) { r.CloseMarks[20].EquityUnits = "1" },
		"mark-pnl":    func(r *backtest.FundedCausalResult) { r.CloseMarks[20].UnrealizedPnLUnits = "-0" },
		"mark-quantity": func(r *backtest.FundedCausalResult) {
			r.CloseMarks[20].ModelQuantity = math.Inf(1)
		},
		"mark-time": func(r *backtest.FundedCausalResult) {
			r.CloseMarks[20].Timestamp = r.CloseMarks[19].Timestamp
		},
		"flow-link":         func(r *backtest.FundedCausalResult) { r.CashFlows[0].FillIndex = 1 },
		"flow-debit":        func(r *backtest.FundedCausalResult) { r.CashFlows[0].DebitedUnits = "999999999" },
		"flow-credit":       func(r *backtest.FundedCausalResult) { r.CashFlows[1].CreditedUnits = "1" },
		"flow-reason":       func(r *backtest.FundedCausalResult) { r.CashFlows[0].Reason = "PRIVATE_REASON" },
		"fill-price":        func(r *backtest.FundedCausalResult) { r.Replay.Fills[0].Price = math.NaN() },
		"fill-quantity":     func(r *backtest.FundedCausalResult) { r.Replay.Fills[0].Quantity = math.Inf(1) },
		"fill-kind":         func(r *backtest.FundedCausalResult) { r.Replay.Fills[0].Kind = "PRIVATE_KIND" },
		"fill-reason":       func(r *backtest.FundedCausalResult) { r.Replay.Fills[0].Reason = "PRIVATE_REASON" },
		"evaluation-count":  func(r *backtest.FundedCausalResult) { r.Replay.Evaluations = nil },
		"evaluation-prefix": func(r *backtest.FundedCausalResult) { r.Replay.Evaluations[0].PrefixLength = 1 },
		"evaluation-nan":    func(r *backtest.FundedCausalResult) { r.Replay.Evaluations[0].Score = math.NaN() },
		"pending":           func(r *backtest.FundedCausalResult) { r.Replay.PendingSignalUnfilled = true },
		"dd-nil":            func(r *backtest.FundedCausalResult) { r.MaxCloseMarkDrawdown.Percent = nil },
		"dd-private-reason": func(r *backtest.FundedCausalResult) {
			r.MaxCloseMarkDrawdown.UndefinedReason = "PRIVATE_REASON"
		},
		"dd-percent": func(r *backtest.FundedCausalResult) {
			v := 0.0
			r.MaxCloseMarkDrawdown.Percent = &v
		},
		"dd-noncanonical": func(r *backtest.FundedCausalResult) {
			v := "0500000000"
			r.MaxCloseMarkDrawdown.LossUnits = &v
		},
		"dd-zero-peak": func(r *backtest.FundedCausalResult) {
			v := "0"
			r.MaxCloseMarkDrawdown.PeakEquityUnits = &v
		},
		"dd-tied-later-bar": func(r *backtest.FundedCausalResult) {
			v := 21
			r.MaxCloseMarkDrawdown.BarIndex = &v
		},
		"dd-mark": func(r *backtest.FundedCausalResult) {
			r.CloseMarks[20].CloseMarkDrawdown.BarIndex = nil
		},
		"oversized-text": func(r *backtest.FundedCausalResult) {
			r.InitialModelCashUnits = strings.Repeat("9", 100000)
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := fundedCLITestResult(t, 24, "100", "")
			mutate(&result)
			if output, ok := backtestCausalFundedSummary(result); ok || output != "" {
				t.Fatalf("malformed result produced output: %q", output)
			}
		})
	}
}

func TestBacktestCausalFundedUndefinedDDAndTerminalRejection(t *testing.T) {
	for name, mutate := range map[string]func(*backtest.FundedCausalResult){
		"zero-invented-percent": func(r *backtest.FundedCausalResult) {
			v := 0.0
			r.MaxCloseMarkDrawdown.Percent = &v
		},
		"zero-missing-reason": func(r *backtest.FundedCausalResult) {
			r.MaxCloseMarkDrawdown.UndefinedReason = ""
		},
		"rejection-reason": func(r *backtest.FundedCausalResult) {
			r.RejectedEntries[0].Reason = "PRIVATE_REASON"
		},
		"rejection-required": func(r *backtest.FundedCausalResult) {
			r.RejectedEntries[0].RequiredModelCashUnits = "0"
		},
		"rejection-available": func(r *backtest.FundedCausalResult) {
			r.RejectedEntries[0].AvailableModelCashUnits = "1"
		},
		"rejection-lineage": func(r *backtest.FundedCausalResult) {
			r.RejectedEntries[0].EvaluationBarIndex = 0
		},
		"rejection-capacity": func(r *backtest.FundedCausalResult) {
			r.RejectedEntries = make([]backtest.FundedCausalRejectedEntry, 10001)
		},
		"flat-invented-position": func(r *backtest.FundedCausalResult) {
			r.Replay.TerminalPosition = &backtest.CausalTerminalPosition{}
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := fundedCLITestResult(t, 24, "0", "buy")
			mutate(&result)
			if output, ok := backtestCausalFundedSummary(result); ok || output != "" {
				t.Fatal("invalid undefined-DD or rejection result accepted")
			}
		})
	}
	for name, mutate := range map[string]func(*backtest.FundedCausalResult){
		"missing-position": func(r *backtest.FundedCausalResult) { r.Replay.TerminalPosition = nil },
		"quantity":         func(r *backtest.FundedCausalResult) { r.Replay.TerminalPosition.Quantity = 1 },
		"last-close":       func(r *backtest.FundedCausalResult) { r.Replay.TerminalPosition.LastClosePrice = 51 },
		"entry-time": func(r *backtest.FundedCausalResult) {
			r.Replay.TerminalPosition.EntryTimestamp = time.Time{}
		},
		"last-time": func(r *backtest.FundedCausalResult) {
			r.Replay.TerminalPosition.LastTimestamp = time.Time{}
		},
		"peak-nan": func(r *backtest.FundedCausalResult) {
			r.Replay.TerminalPosition.PeakPrice = math.NaN()
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := fundedCLITestResult(t, 21, "100", "")
			mutate(&result)
			if output, ok := backtestCausalFundedSummary(result); ok || output != "" {
				t.Fatal("inconsistent terminal position accepted")
			}
		})
	}
	positive := fundedCLITestResult(t, 24, "9", "buy")
	positive.MaxCloseMarkDrawdown = backtest.FundedCausalDrawdown{
		UndefinedReason: backtest.FundedZeroInitialEquity,
	}
	if output, ok := backtestCausalFundedSummary(positive); ok || output != "" {
		t.Fatal("positive no-loss capital accepted zero-capital null convention")
	}
	if output, ok := backtestCausalFundedSummary(backtest.FundedCausalResult{}); ok || output != "" {
		t.Fatal("zero result accepted")
	}
}

func TestBacktestCausalFundedSummaryBoundOnMaximumBarCount(t *testing.T) {
	bars := make([]backtest.OHLCV, backtest.CausalMaxBars)
	for i := range bars {
		bars[i] = backtest.OHLCV{
			Timestamp: int64(i + 1), Open: 100, High: 100,
			Low: 100, Close: 100, Volume: 0,
		}
	}
	s := &fundedCLITestStrategy{
		BreakoutVolStrategy: strategies.NewBreakoutVolStrategy(), mode: "buy",
	}
	result, err := backtest.NewStrategyEngine(s).RunFundedCausal(
		context.Background(), "TEST", bars, "0")
	if err != nil || len(result.RejectedEntries) != backtest.CausalMaxBars-20 {
		t.Fatalf("maximum-bar fixture failed: %v", err)
	}
	output, ok := backtestCausalFundedSummary(result)
	if !ok {
		t.Fatal("bounded maximum-bar result rejected")
	}
	fundedCLITestSummary(t, output,
		"Bars: 10000\n", "Evaluations: 9981\n",
		"Model fills: 0\n", "Rejected entries: 9980\n")
}

type fundedCLITestWriter struct {
	calls  int
	mode   string
	output bytes.Buffer
}

func (w *fundedCLITestWriter) Write(p []byte) (int, error) {
	w.calls++
	switch w.mode {
	case "short":
		n := len(p) / 2
		_, _ = w.output.Write(p[:n])
		return n, nil
	case "prefix-error":
		n := 7
		if len(p) < n {
			n = len(p)
		}
		_, _ = w.output.Write(p[:n])
		return n, errors.New("PRIVATE_WRITE_ERROR")
	case "error":
		return 0, errors.New("PRIVATE_WRITE_ERROR")
	default:
		return w.output.Write(p)
	}
}

func TestBacktestCausalFundedOneWriteAndFailureRetainsPrefix(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	_, expected, diagnostic := fundedCLITestRun(nil, "BreakoutVol", "TEST", path, "100")
	if diagnostic != "" || expected == "" {
		t.Fatal("reference summary failed")
	}
	for _, mode := range []string{"success", "short", "prefix-error", "error"} {
		t.Run(mode, func(t *testing.T) {
			writer := &fundedCLITestWriter{mode: mode}
			var stderr bytes.Buffer
			code := runBacktestCausalFunded(nil,
				[]string{"BreakoutVol", "TEST", path, "100"}, writer, &stderr)
			if writer.calls != 1 {
				t.Fatalf("output retried: %d", writer.calls)
			}
			if mode == "success" {
				if code != 0 || stderr.Len() != 0 || writer.output.String() != expected {
					t.Fatal("single successful write differs")
				}
				return
			}
			if code == 0 || stderr.String() != "backtest-causal-funded: output_error\n" {
				t.Fatalf("writer failure became success or leaked: %d %q", code, stderr.String())
			}
			switch mode {
			case "short":
				if writer.output.String() != expected[:len(expected)/2] {
					t.Fatal("short-write prefix was not retained")
				}
			case "prefix-error":
				if writer.output.String() != expected[:7] {
					t.Fatal("prefix-plus-error output was not retained")
				}
			case "error":
				if writer.output.Len() != 0 {
					t.Fatal("zero-byte failure unexpectedly produced output")
				}
			}
		})
	}
	for _, mode := range []string{"short", "prefix-error", "error"} {
		stderr := &fundedCLITestWriter{mode: mode}
		if code := runBacktestCausalFunded(nil, nil, io.Discard, stderr); code == 0 ||
			stderr.calls != 1 {
			t.Fatal("stderr failure became success or retried")
		}
	}
	var stderr bytes.Buffer
	if code := runBacktestCausalFunded(nil,
		[]string{"BreakoutVol", "TEST", path, "100"}, nil, &stderr); code == 0 ||
		stderr.String() != "backtest-causal-funded: output_error\n" {
		t.Fatal("nil stdout was accepted")
	}
}
