package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"gelt/pkg/backtest"
	"gelt/pkg/strategies"
)

func causalCLITestCSV(rows ...string) string {
	return causalCSVHeader + "\n" + strings.Join(rows, "\n")
}

func causalCLITestFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "synthetic.csv")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func causalCLITestRun(ctx context.Context, args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := runBacktestCausal(ctx, args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func causalCLITestParseFailure(t *testing.T, input string, want error) {
	t.Helper()
	bars, err := parseBacktestCausalCSV(strings.NewReader(input))
	if err != want || bars != nil {
		t.Fatalf("want nil bars and %v; got %d bars and %v", want, len(bars), err)
	}
}

func TestBacktestCausalCSVLineEndings(t *testing.T) {
	base := causalCLITestCSV("1,100,101,99,100.5,0", "2,100,102,98,101,10.25")
	want := []backtest.OHLCV{
		{Timestamp: 1, Open: 100, High: 101, Low: 99, Close: 100.5, Volume: 0},
		{Timestamp: 2, Open: 100, High: 102, Low: 98, Close: 101, Volume: 10.25},
	}
	for _, ending := range []string{"\n", "\r\n"} {
		for _, final := range []bool{false, true} {
			name := fmt.Sprintf("crlf=%t/final=%t", ending == "\r\n", final)
			t.Run(name, func(t *testing.T) {
				input := strings.ReplaceAll(base, "\n", ending)
				if final {
					input += ending
				}
				got, err := parseBacktestCausalCSV(strings.NewReader(input))
				if err != nil || !reflect.DeepEqual(got, want) {
					t.Fatalf("parsed bars differ: %#v, %v", got, err)
				}
			})
		}
	}
}

func TestBacktestCausalCSVRejectsWholeMalformedInput(t *testing.T) {
	good := causalCLITestCSV("1,100,100,100,100,0")
	cases := map[string]string{
		"empty":              "",
		"header-only":        causalCSVHeader,
		"header-newline":     causalCSVHeader + "\n",
		"BOM":                "\xef\xbb\xbf" + good,
		"lower-header":       strings.Replace(good, "Timestamp", "timestamp", 1),
		"header-space":       strings.Replace(good, "Open", " Open", 1),
		"extra-header":       strings.Replace(good, "Volume", "Volume,Other", 1),
		"blank-row":          good + "\n\n2,100,100,100,100,0",
		"two-final-newlines": good + "\n\n",
		"bare-CR-final":      good + "\r",
		"bare-CR-body":       good + "\r2,100,100,100,100,0",
		"missing-field":      causalCLITestCSV("1,100,100,100,100"),
		"extra-field":        causalCLITestCSV("1,100,100,100,100,0,1"),
		"trailing-comma":     causalCLITestCSV("1,100,100,100,100,0,"),
		"empty-field":        causalCLITestCSV("1,100,,100,100,0"),
		"quote":              causalCLITestCSV("1,\"100\",100,100,100,0"),
		"UTF8-number":        causalCLITestCSV("1,１００,100,100,100,0"),
		"invalid-UTF8":       good + "\xff",
		"late-malformed":     good + "\n2,100,100,100,100,0\n3,100,broken,100,100,0",
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			causalCLITestParseFailure(t, input, causalCSVInvalid)
		})
	}
}

func TestBacktestCausalCSVNumericGrammar(t *testing.T) {
	invalid := []string{
		"", "+1", "-1", "-0", " 1", "1 ", "\t1", "1\t", "1\r",
		"01", "00", "01.5", "00.0", ".1", "1.", "1..0",
		"1e2", "1E2", "NaN", "Inf", "Infinity", "0x1", "1_000",
		"1/2", "\"1\"", "١", "1\x00", "1\n",
	}
	for _, token := range invalid {
		for column := 0; column < 6; column++ {
			t.Run(fmt.Sprintf("%q/column=%d", token, column), func(t *testing.T) {
				if causalCSVNumber([]byte(token), column != 0) {
					t.Fatal("invalid numeric token accepted")
				}
				// At the final field, this newline is a permitted CSV line
				// ending, not part of the numeric token. Keep the direct
				// token rejection above and assert the file grammar separately.
				if token == "1\n" && column == 5 {
					bars, err := parseBacktestCausalCSV(strings.NewReader(
						causalCLITestCSV("1,1,1,1,1," + token)))
					if err != nil || len(bars) != 1 || bars[0].Volume != 1 {
						t.Fatal("permitted final newline rejected")
					}
					return
				}
				fields := []string{"1", "1", "1", "1", "1", "0"}
				fields[column] = token
				causalCLITestParseFailure(t,
					causalCLITestCSV(strings.Join(fields, ",")), causalCSVInvalid)
			})
		}
	}
	for _, token := range []string{"0", "1", "10", "0.0", "1.25", "100.000"} {
		t.Run("valid/"+token, func(t *testing.T) {
			bars, err := parseBacktestCausalCSV(strings.NewReader(
				causalCLITestCSV("1," + token + ",1,1,1,0")))
			if err != nil || len(bars) != 1 {
				t.Fatalf("valid syntax rejected: %v", err)
			}
		})
	}
	causalCLITestParseFailure(t, causalCLITestCSV("1.0,1,1,1,1,0"), causalCSVInvalid)
	causalCLITestParseFailure(t,
		causalCLITestCSV("9223372036854775808,1,1,1,1,0"), causalCSVInvalid)

	// ParseInt's exact signed-integer limit is accepted by the parser;
	// RunCausal subsequently applies its smaller timestamp domain.
	if _, err := parseBacktestCausalCSV(strings.NewReader(
		causalCLITestCSV("9223372036854775807,1,1,1,1,0"))); err != nil {
		t.Fatal(err)
	}
}

func TestBacktestCausalCSVTokenBoundaries(t *testing.T) {
	for _, size := range []int{31, 32, 33} {
		for column := 1; column < 6; column++ {
			t.Run(fmt.Sprintf("size=%d/column=%d", size, column), func(t *testing.T) {
				fields := []string{"1", "1", "1", "1", "1", "0"}
				fields[column] = "1." + strings.Repeat("0", size-2)
				bars, err := parseBacktestCausalCSV(strings.NewReader(
					causalCLITestCSV(strings.Join(fields, ","))))
				if size <= causalCSVMaxToken {
					if err != nil || len(bars) != 1 {
						t.Fatalf("boundary token rejected: %v", err)
					}
				} else if err != causalCSVInvalid || bars != nil {
					t.Fatalf("oversized token accepted: %v", err)
				}
			})
		}
	}
	for _, size := range []int{31, 32, 33} {
		// All exceed ParseInt's range; no oversized or overflowing timestamp
		// may slip through even when its lexical digits are otherwise valid.
		causalCLITestParseFailure(t,
			causalCLITestCSV(strings.Repeat("9", size)+",1,1,1,1,0"),
			causalCSVInvalid)
	}
}

func TestBacktestCausalCSVRowBoundaries(t *testing.T) {
	for _, count := range []int{9999, 10000, 10001} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			var input strings.Builder
			input.WriteString(causalCSVHeader)
			for i := 1; i <= count; i++ {
				fmt.Fprintf(&input, "\n%d,1,1,1,1,0", i)
			}
			bars, err := parseBacktestCausalCSV(strings.NewReader(input.String()))
			if count <= backtest.CausalMaxBars {
				if err != nil || len(bars) != count {
					t.Fatalf("row boundary rejected: %d %v", len(bars), err)
				}
			} else if err != causalCSVLimit || bars != nil {
				t.Fatalf("excess rows accepted: %d %v", len(bars), err)
			}
		})
	}
}

// causalCLITestSizedCSV builds valid grammar at an exact byte size without
// exceeding row/token limits. Repeated timestamps are deliberate: this is a
// parser-only fixture, not a RunCausal numerical/domain fixture.
func causalCLITestSizedCSV(t *testing.T, size int) string {
	t.Helper()
	const rows = 7000
	extra := size - len(causalCSVHeader) - 1 - rows*22
	if extra < 0 || extra > rows*5*29 {
		t.Fatal("invalid exact-size fixture request")
	}
	var out strings.Builder
	out.Grow(size)
	out.WriteString(causalCSVHeader)
	out.WriteByte('\n')
	for i := 0; i < rows; i++ {
		out.WriteByte('1')
		for j := 0; j < 5; j++ {
			n := extra
			if n > 29 {
				n = 29
			}
			extra -= n
			out.WriteString(",1.0")
			out.WriteString(strings.Repeat("0", n))
		}
		out.WriteByte('\n')
	}
	if extra != 0 || out.Len() != size {
		t.Fatal("exact-size fixture construction failed")
	}
	return out.String()
}

type causalCLICountReader struct {
	reader io.Reader
	read   int
}

func (r *causalCLICountReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += n
	return n, err
}

func TestBacktestCausalCSVByteBoundariesAndBoundedRead(t *testing.T) {
	for _, size := range []int{causalCSVMaxBytes - 1, causalCSVMaxBytes, causalCSVMaxBytes + 1} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			reader := &causalCLICountReader{
				reader: strings.NewReader(causalCLITestSizedCSV(t, size)),
			}
			bars, err := parseBacktestCausalCSV(reader)
			if size <= causalCSVMaxBytes {
				if err != nil || len(bars) != 7000 || reader.read != size {
					t.Fatalf("byte boundary rejected: %d %d %v", len(bars), reader.read, err)
				}
			} else if err != causalCSVLimit || bars != nil {
				t.Fatalf("oversized input accepted: %v", err)
			}
			if reader.read > causalCSVMaxBytes+1 {
				t.Fatal("read exceeded max+1")
			}
		})
	}
	reader := &causalCLICountReader{
		reader: strings.NewReader(strings.Repeat("x", causalCSVMaxBytes*2)),
	}
	bars, err := parseBacktestCausalCSV(reader)
	if err != causalCSVLimit || bars != nil || reader.read != causalCSVMaxBytes+1 {
		t.Fatalf("unbounded read: %d %v", reader.read, err)
	}
}

type causalCLIReadError struct{}

func (causalCLIReadError) Read([]byte) (int, error) {
	return 0, errors.New("PRIVATE_READER_TEXT")
}

func TestBacktestCausalCSVReaderFailureSanitized(t *testing.T) {
	bars, err := parseBacktestCausalCSV(causalCLIReadError{})
	if bars != nil || err != causalCSVRead ||
		strings.Contains(err.Error(), "PRIVATE_READER_TEXT") {
		t.Fatalf("reader failure leaked or accepted: %v", err)
	}
}

func TestBacktestCausalCLIArgumentsAndUnsupportedTargets(t *testing.T) {
	for _, args := range [][]string{
		nil, {"BreakoutVol"}, {"BreakoutVol", "TEST"},
		{"BreakoutVol", "TEST", "unused", "extra"},
	} {
		code, stdout, stderr := causalCLITestRun(context.Background(), args...)
		if code == 0 || stdout != "" ||
			stderr != causalCLIUsage+"backtest-causal: invalid_arguments\n" {
			t.Fatalf("argument handling differs: %d %q %q", code, stdout, stderr)
		}
	}
	path := causalCLITestFile(t, causalCLITestCSV("1,100,100,100,100,0"))
	for _, target := range []string{"", "breakoutvol", "DefaultPlan", "PRIVATE_TARGET\nsecret", "../BreakoutVol"} {
		code, stdout, stderr := causalCLITestRun(nil, target, "TEST", path)
		want := "Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n" +
			"backtest-causal: unsupported_target\n"
		if code == 0 || stdout != "" || stderr != want ||
			strings.Contains(stderr, path) {
			t.Fatalf("unsupported target not sanitized: %d %q %q", code, stdout, stderr)
		}
	}
	first, ok := newBacktestCausalEngine("BreakoutVol")
	second, ok2 := newBacktestCausalEngine("BreakoutVol")
	if !ok || !ok2 || first == nil || second == nil || first == second {
		t.Fatal("resolver did not return fresh engines")
	}
}

func TestBacktestCausalCLIRejectsBeforeTargetResolution(t *testing.T) {
	path := causalCLITestFile(t,
		causalCLITestCSV("1,100,100,100,100,0", "2,100,PRIVATE_PARSE,100,100,0"))
	code, stdout, stderr := causalCLITestRun(nil, "PRIVATE_TARGET", "TEST", path)
	if code == 0 || stdout != "" || stderr != "backtest-causal: invalid_csv\n" {
		t.Fatalf("whole input not rejected first: %d %q %q", code, stdout, stderr)
	}
}

func TestBacktestCausalCLIPathAndNumericFailuresSanitized(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "PRIVATE_MISSING.csv")
	code, stdout, stderr := causalCLITestRun(nil, "BreakoutVol", "TEST", missing)
	if code == 0 || stdout != "" || stderr != "backtest-causal: input_file\n" {
		t.Fatalf("path failure not sanitized: %d %q %q", code, stdout, stderr)
	}

	for name, row := range map[string]string{
		"price-domain":     "1,1000001,1000001,1000001,1000001,0",
		"zero-price":       "1,0,0,0,0,0",
		"OHLC":             "1,100,99,100,100,0",
		"volume-domain":    "1,100,100,100,100,1000000000001",
		"timestamp-domain": "253402300800,100,100,100,100,0",
	} {
		t.Run(name, func(t *testing.T) {
			path := causalCLITestFile(t, causalCLITestCSV(row))
			code, stdout, stderr := causalCLITestRun(nil, "BreakoutVol", "TEST", path)
			if code == 0 || stdout != "" || stderr != "backtest-causal: invalid_input\n" {
				t.Fatalf("domain failure differs: %d %q %q", code, stdout, stderr)
			}
		})
	}
	path := causalCLITestFile(t, causalCLITestCSV("1,100,100,100,100,0"))
	code, stdout, stderr = causalCLITestRun(nil, "BreakoutVol", "PRIVATE_symbol\n", path)
	if code == 0 || stdout != "" || stderr != "backtest-causal: invalid_symbol\n" {
		t.Fatalf("symbol failure differs: %d %q %q", code, stdout, stderr)
	}
}

func causalCLITestPositiveCSV(count int) string {
	var out strings.Builder
	out.WriteString(causalCSVHeader)
	for i := 0; i < count; i++ {
		switch i {
		case 19:
			fmt.Fprintf(&out, "\n%d,100,105,100,105,1000", i+1)
		case 20:
			fmt.Fprintf(&out, "\n%d,106,106,106,106,1000", i+1)
		default:
			fmt.Fprintf(&out, "\n%d,100,100,100,100,1000", i+1)
		}
	}
	return out.String()
}

func causalCLITestRequireSummary(t *testing.T, output string, fragments ...string) {
	t.Helper()
	if len(output) > causalSummaryMaxBytes {
		t.Fatal("summary exceeded fixed byte bound")
	}
	for _, fragment := range fragments {
		if !strings.Contains(output, fragment) {
			t.Fatalf("missing summary field %q in %q", fragment, output)
		}
	}
	for _, forbidden := range []string{
		"Net PnL", "Win Rate", "Max Drawdown", "AgentPrompt", "Rationale",
		"PRIVATE_", "Timestamp,Open", "Price Change:", "qualified=true",
		"promoted", "next_open_buy",
	} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("unexpected output text %q", forbidden)
		}
	}
}

func TestBacktestCausalCLIActualBreakoutNextOpenAndEndOpen(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(21))
	code, stdout, stderr := causalCLITestRun(nil, "BreakoutVol", "TEST", path)
	if code != 0 || stderr != "" {
		t.Fatalf("positive fixture failed: %d %q", code, stderr)
	}
	causalCLITestRequireSummary(t, stdout,
		"Model: gelt.legacy-go.close-next-open.v1\n",
		"Cost: frictionless_diagnostic\n",
		"Data: unqualified_offline\n",
		"Authority: unqualified_offline\n",
		"Bars: 21\n", "Evaluations: 2\n", "Model fills: 1\n",
		"Closed trades: 0\n", "Winning closed trades: 0\n",
		"Gross realized PnL: 0.000000000000e+00\n",
		"Gross profit factor: null (no_closed_trades)\n",
		"Final open model position: present\n",
		"Entry price: 1.060000000000e+02\n",
		"Last close price: 1.060000000000e+02\n",
		"Gross unrealized PnL: 0.000000000000e+00\n",
		"Entry signal bar: 19\n", "Entry fill bar: 20\n", "Final bar: 20\n",
		"Final directional signal pending: true\n",
		"may be a no-op, not an actual unfilled order")
	if strings.Contains(stdout, path) {
		t.Fatal("path leaked into summary")
	}

	// Verify the quantity numerically without treating display rounding as
	// fill arithmetic, and independently assert the actual engine lineage.
	bars, err := parseBacktestCausalCSV(strings.NewReader(causalCLITestPositiveCSV(21)))
	if err != nil {
		t.Fatal(err)
	}
	engine, ok := newBacktestCausalEngine("BreakoutVol")
	if !ok {
		t.Fatal("resolver rejected supported target")
	}
	result, err := engine.RunCausal(context.Background(), "TEST", bars)
	if err != nil || len(result.Fills) != 1 || result.TerminalPosition == nil {
		t.Fatalf("positive engine result failed: %v", err)
	}
	fill := result.Fills[0]
	if fill.Price != 106 || fill.BarIndex != 20 || fill.EvaluationBarIndex != 19 ||
		fill.EntrySignalBarIndex != 19 || fill.Kind != backtest.CausalEntry ||
		fill.Reason != backtest.CausalNextOpenBuy ||
		math.Abs(fill.Quantity-5.0/53.0) > 1e-12+1e-12*(5.0/53.0) {
		t.Fatalf("next-open lineage or quantity differs: %+v", fill)
	}
	for _, line := range strings.Split(stdout, "\n") {
		if strings.HasPrefix(line, "Quantity: ") {
			value, err := strconv.ParseFloat(strings.TrimPrefix(line, "Quantity: "), 64)
			if err != nil || math.Abs(value-5.0/53.0) > 1e-12 {
				t.Fatalf("display quantity differs: %q", line)
			}
		}
	}

	// With no successor, the signal remains pending and creates no fill.
	shortPath := causalCLITestFile(t, causalCLITestPositiveCSV(20))
	code, stdout, stderr = causalCLITestRun(nil, "BreakoutVol", "TEST", shortPath)
	if code != 0 || stderr != "" {
		t.Fatalf("20-bar fixture failed: %d %q", code, stderr)
	}
	causalCLITestRequireSummary(t, stdout,
		"Bars: 20\n", "Evaluations: 1\n", "Model fills: 0\n",
		"Final open model position: none\n",
		"Final directional signal pending: true\n")
}

func TestBacktestCausalCLIShortSeriesAndCancellation(t *testing.T) {
	path := causalCLITestFile(t, causalCLITestPositiveCSV(19))
	code, stdout, stderr := causalCLITestRun(nil, "BreakoutVol", "TEST", path)
	if code != 0 || stderr != "" {
		t.Fatalf("short series failed: %d %q", code, stderr)
	}
	causalCLITestRequireSummary(t, stdout,
		"Evaluations: 0\n", "Model fills: 0\n",
		"Final open model position: none\n",
		"Final directional signal pending: false\n")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	code, stdout, stderr = causalCLITestRun(ctx, "BreakoutVol", "TEST", path)
	if code == 0 || stdout != "" || stderr != "backtest-causal: canceled\n" {
		t.Fatalf("cancellation differs: %d %q %q", code, stdout, stderr)
	}
}

// This test double is available only through the typed local engine seam.
// No evaluator, callback, provider or model selector is exposed in CLI args.
type causalCLITestStrategy struct {
	*strategies.BreakoutVolStrategy
	mode   string
	calls  int
	cancel context.CancelFunc
}

func (s *causalCLITestStrategy) Evaluate(
	ctx context.Context, at time.Time, symbol string, closes, volumes []float64,
) (strategies.StrategySignal, error) {
	s.calls++
	if s.mode == "error" {
		return strategies.StrategySignal{}, errors.New("PRIVATE_CALLBACK_TEXT")
	}
	if s.cancel != nil {
		s.cancel()
	}
	signal := strategies.StrategySignal{
		StrategyName: "BreakoutVol", Symbol: symbol, Timestamp: at,
		AssetClass: strategies.AssetEquity, Signal: strategies.SignalBuy,
		Score: 90, StopLossPct: 5, TargetPct: 20,
		Rationale: "PRIVATE_RATIONALE",
	}
	if s.mode == "numeric" {
		signal.Score = math.NaN()
	}
	if s.mode == "identity" {
		signal.Symbol = "PRIVATE_IDENTITY"
	}
	return signal, nil
}

func TestBacktestCausalCLIEvaluatorFailuresAndCanceledCallback(t *testing.T) {
	bars, err := parseBacktestCausalCSV(strings.NewReader(causalCLITestPositiveCSV(21)))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		mode string
		want string
	}{
		{"error", "evaluator_error"},
		{"numeric", "numeric_range"},
		{"identity", "evaluator_identity"},
		{"cancel", "canceled"},
	} {
		t.Run(test.mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := &causalCLITestStrategy{
				BreakoutVolStrategy: strategies.NewBreakoutVolStrategy(),
				mode:                test.mode,
			}
			if test.mode == "cancel" {
				s.cancel = cancel
			}
			var stdout, stderr bytes.Buffer
			code := runBacktestCausalEngine(ctx, "TEST", bars,
				backtest.NewStrategyEngine(s), &stdout, &stderr)
			if code == 0 || stdout.Len() != 0 ||
				stderr.String() != "backtest-causal: "+test.want+"\n" ||
				s.calls != 1 {
				t.Fatalf("failure differs: %d %q %q calls=%d",
					code, stdout.String(), stderr.String(), s.calls)
			}
		})
	}
	if causalCLIEngineError(errors.New("PRIVATE_UNKNOWN")) != "replay_failed" ||
		causalCLIEngineError(&backtest.CausalError{Code: "PRIVATE_CODE"}) != "replay_failed" {
		t.Fatal("unknown errors were not sanitized")
	}
	var stderr bytes.Buffer
	causalCLIFail(&stderr, "PRIVATE_CODE")
	if stderr.String() != "backtest-causal: replay_failed\n" {
		t.Fatal("unknown local error code leaked")
	}
}

func TestBacktestCausalCLIPendingMayBeNoOp(t *testing.T) {
	bars := make([]backtest.OHLCV, 21)
	for i := range bars {
		bars[i] = backtest.OHLCV{
			Timestamp: int64(i + 1), Open: 100, High: 100,
			Low: 100, Close: 100, Volume: 0,
		}
	}
	s := &causalCLITestStrategy{
		BreakoutVolStrategy: strategies.NewBreakoutVolStrategy(),
	}
	var stdout, stderr bytes.Buffer
	code := runBacktestCausalEngine(nil, "TEST", bars,
		backtest.NewStrategyEngine(s), &stdout, &stderr)
	if code != 0 || stderr.Len() != 0 || s.calls != 2 {
		t.Fatalf("no-op fixture failed: %d %q calls=%d", code, stderr.String(), s.calls)
	}
	causalCLITestRequireSummary(t, stdout.String(),
		"Model fills: 1\n", "Closed trades: 0\n",
		"Final open model position: present\n",
		"Final directional signal pending: true\n",
		"may be a no-op, not an actual unfilled order")
}

func causalCLITestSummaryResult() backtest.CausalResult {
	return backtest.CausalResult{
		ModelIdentity:           backtest.CausalModelIdentity,
		CostIdentity:            backtest.CausalCostIdentity,
		DataLabel:               backtest.CausalOfflineLabel,
		AuthorityLabel:          backtest.CausalOfflineLabel,
		TotalBars:               21,
		GrossProfitFactorReason: backtest.CausalNoClosedTrades,
	}
}

func TestBacktestCausalSummaryBoundAndValidatedFigures(t *testing.T) {
	r := causalCLITestSummaryResult()
	r.TotalBars = backtest.CausalMaxBars
	r.Evaluations = make([]backtest.CausalEvaluation, backtest.CausalMaxBars)
	r.Fills = make([]backtest.CausalFill, backtest.CausalMaxFills)
	r.ClosedTradeCount = backtest.CausalMaxBars
	r.WinningClosedTradeCount = backtest.CausalMaxBars
	r.GrossRealizedPnL = -1000000
	r.GrossProfit = 1000000
	r.GrossLoss = math.SmallestNonzeroFloat64
	pf := math.MaxFloat64
	r.GrossProfitFactor = &pf
	r.GrossProfitFactorReason = ""
	r.TargetName = "PRIVATE_TARGET"
	r.Symbol = "PRIVATE_SYMBOL"
	r.TerminalPosition = &backtest.CausalTerminalPosition{
		Quantity: 1000, EntryPrice: 0.01, LastClosePrice: 1000000,
		GrossUnrealizedPnL: -1000000, StopLoss: 0.000001, Target: 11000000,
		EntrySignalBarIndex: 9998, EntryBarIndex: 9999, LastBarIndex: 9999,
	}
	output, ok := backtestCausalSummary(r)
	if !ok || len(output) > causalSummaryMaxBytes {
		t.Fatalf("finite boundary summary rejected or too large: %t %d", ok, len(output))
	}
	causalCLITestRequireSummary(t, output,
		"Gross profit factor: 1.797693134862e+308\n",
		"Final open model position: present\n")

	for name, mutate := range map[string]func(*backtest.CausalResult){
		"model":      func(r *backtest.CausalResult) { r.ModelIdentity = "PRIVATE_MODEL" },
		"count":      func(r *backtest.CausalResult) { r.TotalBars = 10001 },
		"negative":   func(r *backtest.CausalResult) { r.ClosedTradeCount = -1 },
		"wins":       func(r *backtest.CausalResult) { r.WinningClosedTradeCount = 1 },
		"NaN":        func(r *backtest.CausalResult) { r.GrossRealizedPnL = math.NaN() },
		"Inf":        func(r *backtest.CausalResult) { r.GrossProfit = math.Inf(1) },
		"money":      func(r *backtest.CausalResult) { r.GrossLoss = 1000001 },
		"reason":     func(r *backtest.CausalResult) { r.GrossProfitFactorReason = "PRIVATE_REASON" },
		"factor-Inf": func(r *backtest.CausalResult) { v := math.Inf(1); r.GrossProfitFactor = &v },
		"position": func(r *backtest.CausalResult) {
			r.TerminalPosition = &backtest.CausalTerminalPosition{Quantity: math.NaN()}
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := causalCLITestSummaryResult()
			mutate(&result)
			if output, ok := backtestCausalSummary(result); ok || output != "" {
				t.Fatalf("invalid result produced summary: %q", output)
			}
		})
	}

	noLoss := causalCLITestSummaryResult()
	noLoss.ClosedTradeCount = 1
	noLoss.WinningClosedTradeCount = 1
	noLoss.GrossProfit = 1
	noLoss.GrossRealizedPnL = 1
	noLoss.GrossProfitFactorReason = backtest.CausalNoLosingClosedTrades
	output, ok = backtestCausalSummary(noLoss)
	if !ok || !strings.Contains(output, "Gross profit factor: null (no_losing_closed_trades)\n") {
		t.Fatal("no-losing-trades reason missing")
	}
}

type causalCLIWriteError struct{}

func (causalCLIWriteError) Write([]byte) (int, error) {
	return 0, errors.New("PRIVATE_WRITE_ERROR")
}

func TestBacktestCausalCLIOutputFailureSanitized(t *testing.T) {
	bars, err := parseBacktestCausalCSV(strings.NewReader(
		causalCLITestCSV("1,100,100,100,100,0")))
	if err != nil {
		t.Fatal(err)
	}
	engine, ok := newBacktestCausalEngine("BreakoutVol")
	if !ok {
		t.Fatal("resolver failed")
	}
	var stderr bytes.Buffer
	code := runBacktestCausalEngine(nil, "TEST", bars, engine,
		causalCLIWriteError{}, &stderr)
	if code == 0 || stderr.String() != "backtest-causal: output_error\n" {
		t.Fatalf("output failure not sanitized: %d %q", code, stderr.String())
	}
}
