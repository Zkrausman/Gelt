package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"gelt/pkg/backtest"
)

func alignedTestFixture() ([]backtest.OHLCV, string) {
	bars := make([]backtest.OHLCV, 53)
	var csv strings.Builder
	csv.WriteString(causalCSVHeader + "\n")
	for i := range bars {
		bars[i] = backtest.OHLCV{Timestamp: 1700000000 + int64(60*i), Open: 10, High: 11, Low: 9, Close: 10, Volume: 1}
		if i == 50 {
			bars[i].Low, bars[i].Close = 8, 9
		}
		if i == 51 {
			bars[i].High, bars[i].Close = 13, 12
		}
		b := bars[i]
		fmt.Fprintf(&csv, "%d,%.17g,%.17g,%.17g,%.17g,%.17g\n", b.Timestamp, b.Open, b.High, b.Low, b.Close, b.Volume)
	}
	return bars, csv.String()
}

func alignedTestWindow() backtest.DeclaredComparisonWindow {
	return backtest.DeclaredComparisonWindow{StartInclusiveUnix: 1700003000, EndExclusiveUnix: 1700003120}
}
func alignedTestScenario() backtest.ExecutionScenario {
	return backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
}
func alignedTestArgs(path string) []string {
	return []string{"FIXTURE", path, "1700003000", "1700003120", "100", "0", "0", "0", "0"}
}

func alignedTestFacts(r backtest.Trend50WindowComparisonResult) alignedWindowFacts {
	return alignedWindowFacts{r.Window, r.SourceTotalBars, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.ScoredBars, r.Replay.Symbol, r.Replay.Scale, r.Replay.InitialModelCashUnits, r.Replay.CostIdentity, r.Replay.ScenarioBasis, r.DataLabel, r.AuthorityLabel, r.SelectionHistory, r.Replay.Scenario}
}

// This oracle checks native integration and unchanged section bytes. It is
// separate from the counted invocation and is not independent accounting math.
func alignedTestNativeSections(t *testing.T, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (string, string, string, alignedWindowProjection) {
	t.Helper()
	ctx := context.Background()
	runners := nativeAlignedWindowRunners()
	trend, err := runners.Trend(ctx, "FIXTURE", append([]backtest.OHLCV(nil), bars...), w, cash, s)
	if err != nil {
		t.Fatal(err)
	}
	trendText, ok := backtestCausalTrend50WindowComparisonSummary(ctx, trend, bars, "FIXTURE", w, cash, s)
	if !ok {
		t.Fatal("native Trend summary rejected")
	}
	breakout, err := runners.Breakout(ctx, "FIXTURE", append([]backtest.OHLCV(nil), bars...), w, cash, s)
	if err != nil {
		t.Fatal(err)
	}
	breakoutText, ok := backtestCausalWindowComparisonSummary(ctx, breakout, bars, "FIXTURE", w, cash, s)
	if !ok {
		t.Fatal("native Breakout summary rejected")
	}
	mean, err := runners.Mean(ctx, "FIXTURE", append([]backtest.OHLCV(nil), bars...), w, cash, s)
	if err != nil {
		t.Fatal(err)
	}
	meanText, ok := mean20WindowCLISummary(ctx, mean, bars, "FIXTURE", w, cash, s)
	if !ok {
		t.Fatal("native Mean summary rejected")
	}
	projection, ok := projectAlignedWindow(ctx, alignedTestFacts(trend), trend.Replay.Cash, trend.Replay.Passive, trend.Cash, trend.Passive, 50)
	if !ok {
		t.Fatal("validated Trend projection rejected")
	}
	if breakout.WarmupBars != 20 || trend.WarmupBars != 50 || mean.WarmupBars != 20 || breakout.WarmupStartSourceIndex != projection.Facts.ScoreStart-20 || trend.WarmupStartSourceIndex != projection.Facts.ScoreStart-50 || mean.WarmupStartSourceIndex != projection.Facts.ScoreStart-20 {
		t.Fatal("native histories changed")
	}
	return breakoutText, trendText, meanText, projection
}

func TestAlignedWindowNativeSectionsOrderAndCopies(t *testing.T) {
	bars, _ := alignedTestFixture()
	for _, tc := range []struct {
		start, end int64
		scenario   backtest.ExecutionScenario
	}{
		{1700003000, 1700003120, alignedTestScenario()},
		{1700003060, 1700003120, alignedTestScenario()},
		{1700003000, 1700003121, alignedTestScenario()},
		{1700003000, 1700003060, backtest.ExecutionScenario{FixedFee: "0.25", FeeBps: "50", BuyAdverseBps: "25", SellAdverseBps: "35"}},
	} {
		w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: tc.start, EndExclusiveUnix: tc.end}
		b, tr, m, p := alignedTestNativeSections(t, bars, w, "100", tc.scenario)
		header := fmt.Sprintf("GELT ALIGNED DECLARED-WINDOW COMPARISON\nInput: one admitted CSV parse; symbol: FIXTURE\nStart inclusive: %d; end exclusive: %d\nSource bars: 53; source score start: %d; score end exclusive: %d; scored bars: %d\nShared cash/passive controls: complete scored paths, entries, basis, fees, peaks and drawdowns checked equal.\nNative histories: BreakoutVol20 / TrendConfluence50 / MeanReversion20 prior bars; separate finite-prefix reseeding.\nData/authority: unqualified_offline; assumptions: uncalibrated_declared; selection history unestablished.\nFixed families; no ranking, tuning, edge, profitability or operating qualification claim.\n", tc.start, tc.end, p.Facts.ScoreStart, p.Facts.ScoreEnd, p.Facts.ScoredBars)
		want := header + "\n=== BreakoutVol ===\n" + b + "\n=== TrendConfluence ===\n" + tr + "\n=== MeanReversion ===\n" + m
		trace := []string{}
		base := nativeAlignedWindowRunners()
		copyCheck := func(name string, input []backtest.OHLCV) {
			trace = append(trace, name)
			if !reflect.DeepEqual(input, bars) || &input[0] == &bars[0] {
				t.Fatal("native input was not a separate original copy")
			}
		}
		runners := alignedWindowRunners{
			Trend: func(ctx context.Context, symbol string, input []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Trend50WindowComparisonResult, error) {
				copyCheck("Trend", input)
				r, e := base.Trend(ctx, symbol, input, w, cash, s)
				input[0].Close = 123
				return r, e
			},
			Breakout: func(ctx context.Context, symbol string, input []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.WindowComparisonResult, error) {
				copyCheck("Breakout", input)
				r, e := base.Breakout(ctx, symbol, input, w, cash, s)
				input[0].Close = 456
				return r, e
			},
			Mean: func(ctx context.Context, symbol string, input []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Mean20WindowComparisonResult, error) {
				copyCheck("Mean", input)
				r, e := base.Mean(ctx, symbol, input, w, cash, s)
				input[0].Close = 789
				return r, e
			},
		}
		out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
		if code := runAlignedWindowData(nil, "FIXTURE", bars, w, "100", tc.scenario, out, diagnostic, runners); code != 0 || string(out.attempt) != want || out.calls != 1 || diagnostic.calls != 0 || !reflect.DeepEqual(trace, []string{"Trend", "Breakout", "Mean"}) || bars[0].Close != 10 {
			t.Fatalf("native orchestration: code=%d trace=%v stderr=%q", code, trace, diagnostic.attempt)
		}
	}
}

func TestAlignedWindowHandControls(t *testing.T) {
	bars, _ := alignedTestFixture()
	// Mathematical 9/10 uses the retained nonzero-scenario downward binary64
	// representation, rather than the nearest .9 literal above the rational.
	// Expected bits and this exact rational boundary do not call sizing code.
	floorNineTenths := math.Float64frombits(0x3feccccccccccccc)
	nineTenths := new(big.Rat).SetFrac64(9, 10)
	if new(big.Rat).SetFloat64(floorNineTenths).Cmp(nineTenths) > 0 || new(big.Rat).SetFloat64(math.Nextafter(floorNineTenths, math.Inf(1))).Cmp(nineTenths) <= 0 {
		t.Fatal("fixed-fee hand quantity must be the greatest binary64 not above 9/10")
	}
	for _, tc := range []struct {
		cash, fee                                                                                          string
		quantity, attempted                                                                                float64
		principal, entryFee, endingCash, firstValue, firstEquity, value, equity, net, peak, ddLoss, ddPeak string
		percent                                                                                            float64
		filled, defined                                                                                    bool
	}{
		{"100", "0", 1, 1, "1000000000", "0", "9000000000", "900000000", "9900000000", "1200000000", "10200000000", "200000000", "10200000000", "100000000", "10000000000", 1, true, true},
		{"100", "1", floorNineTenths, floorNineTenths, "900000000", "100000000", "9000000000", "810000000", "9810000000", "1080000000", "10080000000", "80000000", "10080000000", "190000000", "10000000000", 1.9, true, true},
		{"9", "0", 0, 1, "0", "0", "900000000", "0", "900000000", "0", "900000000", "0", "900000000", "0", "900000000", 0, false, true},
		{"10", "0", 1, 1, "1000000000", "0", "0", "900000000", "900000000", "1200000000", "1200000000", "200000000", "1200000000", "100000000", "1000000000", 10, true, true},
		{"0", "0", 0, 1, "0", "0", "0", "0", "0", "0", "0", "0", "0", "", "", 0, false, false},
	} {
		t.Run("cash="+tc.cash+"/fee="+tc.fee, func(t *testing.T) {
			s := alignedTestScenario()
			s.FixedFee = tc.fee
			initialUnits := tc.cash + "00000000"
			if tc.cash == "0" {
				initialUnits = "0"
			}
			_, _, _, p := alignedTestNativeSections(t, bars, alignedTestWindow(), tc.cash, s)
			passive := p.Passive
			f := passive.Final
			if f.Quantity != tc.quantity || f.Principal != tc.principal || f.EntryFee != tc.entryFee || f.Basis != "1000000000" && tc.filled || f.Basis != "0" && !tc.filled || f.Cash != tc.endingCash || f.Value != tc.value || f.Equity != tc.equity || f.Realized != "0" || f.Unrealized != tc.net || f.Fees != tc.entryFee || f.Peak != tc.peak {
				t.Fatalf("hand final facts differ: %+v", f)
			}
			entry := passive.Entry
			if entry == nil || entry.BarIndex != 0 || entry.PolicyDecisionBarIndex != -1 || entry.ModelQuantity != tc.attempted || entry.RequiredModelCashUnits != "1000000000" || entry.AvailableModelCashUnits != initialUnits || entry.ReferencePrice != 10 || entry.ExecutionPrice != 10 {
				t.Fatalf("hand attempted entry differs: %+v", entry)
			}
			if tc.filled && (entry.PrincipalUnits != tc.principal || entry.FeeUnits != tc.entryFee || f.EntryStatus != "filled") || !tc.filled && f.EntryStatus != backtest.FundedInsufficientModelCash {
				t.Fatal("attempt/holdings distinction changed")
			}
			first, last := passive.Marks[0], passive.Marks[1]
			if first.Value.BarIndex != 0 || last.Value.BarIndex != 1 || first.Value.PositionValueUnits != tc.firstValue || first.Value.EquityUnits != tc.firstEquity || first.Value.ModelQuantity != tc.quantity || last.Value.NetUnrealizedAccountingPnLUnits != tc.net || last.Value.ClosedAttributedFeeUnits != "0" || last.Value.OpenAttributedFeeUnits != tc.entryFee || last.Drawdown.HasBar {
				t.Fatal("hand complete scored path differs")
			}
			dd := passive.Drawdown
			if dd.Defined != tc.defined || dd.Loss != tc.ddLoss || dd.Peak != tc.ddPeak || dd.Percent != tc.percent || dd.HasBar != tc.filled || tc.filled && dd.Bar != 0 {
				t.Fatalf("hand maximum drawdown differs: %+v", dd)
			}
			if !tc.defined && dd.UndefinedReason != backtest.FundedZeroInitialEquity {
				t.Fatal("undefined drawdown changed")
			}
			if p.PassiveScore.HasSource != tc.filled || p.PassiveScore.HasScored != tc.filled || tc.filled && (p.PassiveScore.Source != 50 || p.PassiveScore.Scored != 0) {
				t.Fatal("source/scored maximum location changed")
			}
			if p.Cash.Entry != nil || p.Cash.Final.Quantity != 0 || p.Cash.Final.Cash != initialUnits || p.Cash.Final.Equity != initialUnits || p.Cash.Drawdown.HasBar || p.Cash.Drawdown.Defined != tc.defined {
				t.Fatal("hand flat cash control changed")
			}
		})
	}
}

type alignedTestWriter struct {
	calls           int
	attempt, prefix []byte
	n               *int
	err             error
	onWrite         func()
}

func (w *alignedTestWriter) Write(p []byte) (int, error) {
	w.calls++
	w.attempt = append(w.attempt, p...)
	if w.onWrite != nil {
		w.onWrite()
	}
	n := len(p)
	if w.n != nil {
		n = *w.n
	}
	if n > 0 && n <= len(p) {
		w.prefix = append(w.prefix, p[:n]...)
	}
	return n, w.err
}

func TestAlignedWindowNativeFailuresAndValidationStop(t *testing.T) {
	bars, _ := alignedTestFixture()
	for family := 0; family < 3; family++ {
		for _, kind := range []string{"error", "result", "canceled", "canceled-error"} {
			ctx, cancel := context.WithCancel(context.Background())
			base := nativeAlignedWindowRunners()
			counts := [3]int{}
			alter := func(i int) error {
				if i == family && strings.HasPrefix(kind, "canceled") {
					cancel()
				}
				if i == family && (kind == "error" || kind == "canceled-error") {
					return errors.New("PRIVATE\xff\ncredential=CANARY")
				}
				return nil
			}
			runners := alignedWindowRunners{
				Trend: func(ctx context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Trend50WindowComparisonResult, error) {
					counts[0]++
					r, e := base.Trend(ctx, sym, b, w, cash, s)
					if x := alter(0); x != nil {
						return r, x
					}
					if family == 0 && kind == "result" {
						r.SourceTotalBars--
					}
					return r, e
				},
				Breakout: func(ctx context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.WindowComparisonResult, error) {
					counts[1]++
					r, e := base.Breakout(ctx, sym, b, w, cash, s)
					if x := alter(1); x != nil {
						return r, x
					}
					if family == 1 && kind == "result" {
						r.SourceTotalBars--
					}
					return r, e
				},
				Mean: func(ctx context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Mean20WindowComparisonResult, error) {
					counts[2]++
					r, e := base.Mean(ctx, sym, b, w, cash, s)
					if x := alter(2); x != nil {
						return r, x
					}
					if family == 2 && kind == "result" {
						r.SourceTotalBars--
					}
					return r, e
				},
			}
			out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
			code := runAlignedWindowData(ctx, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), out, diagnostic, runners)
			cancel()
			wantFamily, wantCode := []string{"TrendConfluence", "BreakoutVol", "MeanReversion"}[family], "invalid_result"
			if kind == "error" {
				wantFamily, wantCode = "input", "replay_failed"
			}
			if strings.HasPrefix(kind, "canceled") {
				wantCode = "canceled"
			}
			if code != 1 || out.calls != 0 || diagnostic.calls != 1 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: "+wantFamily+": "+wantCode+"\n" {
				t.Fatalf("family=%d kind=%s: code=%d stderr=%q", family, kind, code, diagnostic.attempt)
			}
			for i, n := range counts {
				want := 0
				if i <= family {
					want = 1
				}
				if n != want {
					t.Fatal("later native call or retry after failure")
				}
			}
		}
	}
}

func TestAlignedWindowNativeErrorVocabulary(t *testing.T) {
	codes := []string{"invalid_window", "insufficient_warmup", "invalid_result", "resource_limit", "invalid_model_cash", "invalid_execution_scenario", "insufficient_exit_fee_cash", "invalid_input", "invalid_symbol", "invalid_evaluator", "evaluator_identity", "evaluator_error", "plan_membership", "unsupported_condition", "numeric_range", "canceled"}
	for _, family := range []string{"TrendConfluence", "BreakoutVol", "MeanReversion"} {
		for index, code := range append(append([]string(nil), codes...), "PRIVATE\xff\n", "invalid_csv", "output_error") {
			var err error
			switch family {
			case "TrendConfluence":
				err = &backtest.Trend50WindowComparisonError{Code: backtest.CausalErrorCode(code)}
			case "BreakoutVol":
				err = &backtest.WindowComparisonError{Code: backtest.CausalErrorCode(code)}
			case "MeanReversion":
				err = &backtest.Mean20WindowComparisonError{Code: backtest.CausalErrorCode(code)}
			}
			gotFamily, gotCode := alignedWindowNativeError(family, fmt.Errorf("PRIVATE_WRAPPER: %w", err))
			if index < len(codes) {
				if gotFamily != family || gotCode != code {
					t.Fatal("known correct-family error lost")
				}
			} else if gotFamily != "input" || gotCode != "replay_failed" {
				t.Fatal("unknown native error leaked")
			}
		}
		var trend *backtest.Trend50WindowComparisonError
		var breakout *backtest.WindowComparisonError
		var mean *backtest.Mean20WindowComparisonError
		for _, err := range []error{nil, trend, breakout, mean, errors.New("PRIVATE\xff\n"), &backtest.CausalError{Code: backtest.CausalInvalidInput}} {
			f, c := alignedWindowNativeError(family, err)
			if f != "input" || c != "replay_failed" {
				t.Fatal("unknown/nil/wrong native type admitted")
			}
		}
	}
	for _, pair := range [][2]string{{"PRIVATE", "canceled"}, {"input", "invalid_result"}, {"alignment", "invalid_symbol"}, {"output", "invalid_csv"}, {"BreakoutVol", "invalid_arguments"}} {
		w := &alignedTestWriter{}
		if alignedWindowFail(w, pair[0], pair[1]) != 1 || string(w.attempt) != "backtest-causal-aligned-window-compare: input: replay_failed\n" {
			t.Fatal("inconsistent family/code leaked")
		}
	}
}

func TestAlignedWindowInputLifecycleAndPrecedence(t *testing.T) {
	_, csv := alignedTestFixture()
	for _, tc := range []struct {
		content           string
		readErr, closeErr error
		cancel            bool
		want              string
	}{
		{csv, nil, nil, false, ""},
		{"PRIVATE_HEADER\n1,1,1,1,1,0", nil, errors.New("PRIVATE_CLOSE"), true, "invalid_csv"},
		{csv, errors.New("PRIVATE_READ"), errors.New("PRIVATE_CLOSE"), true, "input_file"},
		{csv, nil, errors.New("PRIVATE_CLOSE"), true, "input_file"},
		{csv, nil, nil, true, "canceled"},
	} {
		ctx, cancel := context.WithCancel(context.Background())
		var reader io.Reader = strings.NewReader(tc.content)
		if tc.readErr != nil {
			reader = &diagnosticErrorReader{content: []byte(tc.content), err: tc.readErr}
		}
		owned := &diagnosticReadCloser{reader: reader, closeErr: tc.closeErr}
		if tc.cancel {
			owned.onClose = cancel
		}
		opens, parses := 0, 0
		open := func(string) (io.ReadCloser, error) { opens++; return owned, nil }
		parse := func(r io.Reader) ([]backtest.OHLCV, error) { parses++; return parseBacktestCausalCSV(r) }
		out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
		code := runAlignedWindowInput(ctx, alignedTestArgs("PRIVATE_PATH"), out, diagnostic, open, parse, nativeAlignedWindowRunners())
		cancel()
		if opens != 1 || parses != 1 || owned.closes != 1 {
			t.Fatal("input lifecycle count changed")
		}
		if tc.want == "" {
			if code != 0 || out.calls != 1 || diagnostic.calls != 0 {
				t.Fatal("valid lifecycle failed")
			}
		} else if code != 1 || out.calls != 0 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: input: "+tc.want+"\n" {
			t.Fatal("parse/close/cancel precedence changed")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, args := range [][]string{nil, {"PRIVATE"}, append(alignedTestArgs("PRIVATE"), "EXTRA"), alignedTestArgs("PRIVATE")} {
		opens := 0
		var diagnostic bytes.Buffer
		code := runAlignedWindowInput(ctx, args, nil, &diagnostic, func(string) (io.ReadCloser, error) { opens++; return nil, errors.New("PRIVATE") }, nil, alignedWindowRunners{})
		want := "backtest-causal-aligned-window-compare: input: canceled\n"
		if len(args) != 9 {
			want = alignedWindowCLIUsage + "backtest-causal-aligned-window-compare: input: invalid_arguments\n"
		}
		if code != 1 || opens != 0 || diagnostic.String() != want || len(want) > 512 || !utf8.ValidString(want) {
			t.Fatal("pre-admission order/diagnostic changed")
		}
	}
}

func TestAlignedWindowNativeAdmissionAndWindowLimits(t *testing.T) {
	bars, _ := alignedTestFixture()
	for _, tc := range []struct {
		start, end   int64
		cash, symbol string
		scenario     backtest.ExecutionScenario
		mutate       func([]backtest.OHLCV)
		want         string
	}{
		{1700002940, 1700003120, "100", "FIXTURE", alignedTestScenario(), nil, "insufficient_warmup"},
		{1700003001, 1700003120, "100", "FIXTURE", alignedTestScenario(), nil, "invalid_window"},
		{1700003000, 1700003180, "100", "FIXTURE", alignedTestScenario(), nil, "invalid_window"},
		{1700003000, 1700003000, "100", "FIXTURE", alignedTestScenario(), nil, "invalid_window"},
		{1700003000, 1700003120, "BAD", "PRIVATE\n", alignedTestScenario(), func(b []backtest.OHLCV) { b[0].Open = 0 }, "invalid_model_cash"},
		{1700003000, 1700003120, "100", "PRIVATE\n", backtest.ExecutionScenario{FixedFee: "BAD"}, func(b []backtest.OHLCV) { b[0].Open = 0 }, "invalid_execution_scenario"},
		{1700003000, 1700003120, "100", "PRIVATE\n", alignedTestScenario(), func(b []backtest.OHLCV) { b[0].Open = 0 }, "invalid_input"},
		{1700003000, 1700003120, "100", "FIXTURE", alignedTestScenario(), func(b []backtest.OHLCV) { b[52].Open = 0 }, "invalid_input"},
		{1700003000, 1700003120, "100", "PRIVATE\n", alignedTestScenario(), nil, "invalid_symbol"},
	} {
		input := append([]backtest.OHLCV(nil), bars...)
		if tc.mutate != nil {
			tc.mutate(input)
		}
		r := nativeAlignedWindowRunners()
		calls := 0
		trend := r.Trend
		r.Trend = func(ctx context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Trend50WindowComparisonResult, error) {
			calls++
			return trend(ctx, sym, b, w, cash, s)
		}
		r.Breakout = nil
		r.Mean = nil
		out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
		code := runAlignedWindowData(nil, tc.symbol, input, backtest.DeclaredComparisonWindow{StartInclusiveUnix: tc.start, EndExclusiveUnix: tc.end}, tc.cash, tc.scenario, out, diagnostic, r)
		if code != 1 || calls != 1 || out.calls != 0 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: TrendConfluence: "+tc.want+"\n" {
			t.Fatalf("native admission differs: code=%d stderr=%q", code, diagnostic.attempt)
		}
	}
	for _, token := range []string{"", "01", "+1", "1e2", " 1", "253402300800"} {
		args := alignedTestArgs("unused")
		args[2] = token
		var diagnostic bytes.Buffer
		if code := runAlignedWindowInput(nil, args, nil, &diagnostic, func(string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader(causalCLITestCSV("1,1,1,1,1,0"))), nil
		}, parseBacktestCausalCSV, alignedWindowRunners{}); code != 1 || diagnostic.String() != "backtest-causal-aligned-window-compare: input: invalid_window\n" {
			t.Fatal("START token bypassed unchanged timestamp parser")
		}
	}
	// Shift the entire fixture without changing cadence so the terminal+1
	// sentinel reaches the existing upper timestamp boundary exactly.
	for i := range bars {
		bars[i].Timestamp = 253402297679 + int64(60*i)
	}
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: bars[50].Timestamp, EndExclusiveUnix: 253402300800}
	var out, diagnostic bytes.Buffer
	if code := runAlignedWindowData(nil, "FIXTURE", bars, w, "100", alignedTestScenario(), &out, &diagnostic, nativeAlignedWindowRunners()); code != 0 || diagnostic.Len() != 0 {
		t.Fatalf("terminal upper timestamp boundary: %d %q", code, diagnostic.String())
	}
}

func TestAlignedWindowReportBoundsAndWriterFailures(t *testing.T) {
	for _, sizes := range [][4]int{{2048, 8192, 8192, 8192}, {1, 1, 1, 1}} {
		body, ok := assembleAlignedWindowReport(strings.Repeat("h", sizes[0]), strings.Repeat("b", sizes[1]), strings.Repeat("t", sizes[2]), strings.Repeat("m", sizes[3]))
		if !ok || len(body) > 32768 || !utf8.ValidString(body) {
			t.Fatal("valid synthetic report bounds rejected")
		}
	}
	for i := 0; i < 4; i++ {
		for _, bad := range []string{"", "PRIVATE\xff", strings.Repeat("x", []int{2049, 8193, 8193, 8193}[i])} {
			parts := [4]string{"h", "b", "t", "m"}
			parts[i] = bad
			if body, ok := assembleAlignedWindowReport(parts[0], parts[1], parts[2], parts[3]); ok || body != "" {
				t.Fatal("invalid synthetic report admitted")
			}
		}
	}
	if alignedWindowText(strings.Repeat("x", 32769), 32768) || !alignedWindowText(strings.Repeat("é", 16384), 32768) {
		t.Fatal("combined UTF8 byte guard changed")
	}
	bars, _ := alignedTestFixture()
	for _, n := range []int{-1, 0, 5, math.MaxInt} {
		count := n
		out := &alignedTestWriter{n: &count, err: errors.New("PRIVATE_WRITER")}
		diagnostic := &alignedTestWriter{err: errors.New("PRIVATE_STDERR")}
		if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), out, diagnostic, nativeAlignedWindowRunners()); code != 1 || out.calls != 1 || diagnostic.calls != 1 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: output: output_error\n" {
			t.Fatal("output attempt/retry contract changed")
		}
		if n == 5 && string(out.prefix) != string(out.attempt[:5]) {
			t.Fatal("failed output prefix was not retained")
		}
	}
	short := 5
	for _, output := range []*alignedTestWriter{{n: &short}, {err: errors.New("PRIVATE_FULL_COUNT_ERROR")}} {
		diagnostic := &alignedTestWriter{}
		if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), output, diagnostic, nativeAlignedWindowRunners()); code != 1 || output.calls != 1 || diagnostic.calls != 1 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: output: output_error\n" {
			t.Fatal("short-nil-error or full-count-error output accepted")
		}
	}
	for _, stdout := range []io.Writer{nil, &alignedTestWriter{n: new(int)}} {
		if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), stdout, nil, nativeAlignedWindowRunners()); code != 1 {
			t.Fatal("nil/zero writer accepted")
		}
	}
	// Cancellation after the sole write begins cannot roll back the report.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := &alignedTestWriter{onWrite: cancel}
	var diagnostic bytes.Buffer
	if code := runAlignedWindowData(ctx, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), out, &diagnostic, nativeAlignedWindowRunners()); code != 0 || out.calls != 1 || diagnostic.Len() != 0 {
		t.Fatal("write-time cancellation gained a rollback guarantee")
	}
}

func TestAlignedWindowHelpAndExistingDetailBytes(t *testing.T) {
	for _, args := range [][]string{{"help", "backtest-causal-aligned-window-compare"}, {"--help", "backtest-causal-aligned-window-compare"}, {"-h", "backtest-causal-aligned-window-compare"}, {"backtest-causal-aligned-window-compare", "--help"}, {"backtest-causal-aligned-window-compare", "-h"}} {
		var out, diagnostic bytes.Buffer
		if handled, code := runOfflineHelp(args, &out, &diagnostic); !handled || code != 0 || out.String() != alignedWindowCLIHelp || diagnostic.Len() != 0 || len(out.String()) > 16384 {
			t.Fatal("static new help alias changed")
		}
	}
	for _, flag := range []string{"--help", "-h"} {
		args := append([]string{"backtest-causal-aligned-window-compare"}, alignedTestArgs(flag)...)
		if handled, _ := runOfflineHelp(args, nil, nil); handled {
			t.Fatal("full data invocation intercepted")
		}
	}
	for _, body := range []string{globalHelp(Version), offlineChooserHelp} {
		if strings.Count(body, "  backtest-causal-aligned-window-compare ") != 1 {
			t.Fatal("new catalogue entry missing/duplicated")
		}
	}
	// The older nine replay bodies have frozen source-derived lengths/hashes
	// in TestDiagnoseCausalCSVOldDetailedHelpBytes; retain its independent oracle.
	const priorDiagnoseDigest = "983ac70c3233e7605e8ad5538111e4c2da5377350e57423a728c358fec232b40"
	if fmt.Sprintf("%x", sha256.Sum256([]byte(diagnoseCausalCSVHelp))) != priorDiagnoseDigest {
		t.Fatal("existing diagnose detail bytes changed")
	}
}

// This context provides deterministic phase checkpoints without timers or
// concurrent mutation. It is used only by direct bounded projection tests.
type alignedTestCancelContext struct {
	context.Context
	calls, cancelAt int
}

func (c *alignedTestCancelContext) Err() error {
	c.calls++
	if c.calls >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func TestAlignedWindowProjectionMismatchAndShapes(t *testing.T) {
	bars, _ := alignedTestFixture()
	_, _, _, baseline := alignedTestNativeSections(t, bars, alignedTestWindow(), "100", alignedTestScenario())
	ctx := context.Background()
	if !alignedWindowEqual(ctx, baseline, baseline) {
		t.Fatal("validated projection does not match itself")
	}
	// A fresh validated projection is required for each mutation so slices and
	// pointers cannot corrupt the saved baseline or another fixture.
	fresh := func() alignedWindowProjection {
		_, _, _, p := alignedTestNativeSections(t, bars, alignedTestWindow(), "100", alignedTestScenario())
		return p
	}
	mutations := []func(*alignedWindowProjection){
		func(p *alignedWindowProjection) { p.Facts.SourceTotalBars-- }, func(p *alignedWindowProjection) { p.Facts.Scenario.FeeBps = "1" },
		func(p *alignedWindowProjection) { p.Passive.Entry.BarIndex++ }, func(p *alignedWindowProjection) { p.Passive.Entry.PolicyDecisionBarIndex++ }, func(p *alignedWindowProjection) { p.Passive.Entry = nil },
		func(p *alignedWindowProjection) { p.Passive.Marks[0].Value.PositionTotalBasisUnits = "1" }, func(p *alignedWindowProjection) { p.Passive.Marks[0].Value.ModelQuantity = .5 }, func(p *alignedWindowProjection) { p.Passive.Marks[0].Value.NetUnrealizedAccountingPnLUnits = "1" }, func(p *alignedWindowProjection) { p.Passive.Marks[0].Drawdown.Bar++ },
		func(p *alignedWindowProjection) { p.Passive.Marks = p.Passive.Marks[:1] }, func(p *alignedWindowProjection) { p.Passive.Marks[1].Drawdown.HasBar = true },
		func(p *alignedWindowProjection) { p.Passive.Final.Principal = "1" }, func(p *alignedWindowProjection) { p.Passive.Final.EntryFee = "1" }, func(p *alignedWindowProjection) { p.Passive.Final.Basis = "1" }, func(p *alignedWindowProjection) { p.Passive.Final.Peak = "1" }, func(p *alignedWindowProjection) { p.Passive.Drawdown.Loss = "1" },
		func(p *alignedWindowProjection) { p.PassiveScore.Value.EndingEquityUnits = "1" }, func(p *alignedWindowProjection) { p.PassiveScore.Source-- }, func(p *alignedWindowProjection) { p.PassiveScore.Scored++ }, func(p *alignedWindowProjection) { p.PassiveScore.HasSource = false }, func(p *alignedWindowProjection) { p.Cash.Final.Cash = "1" },
	}
	for i, mutate := range mutations {
		p := fresh()
		mutate(&p)
		if alignedWindowEqual(ctx, baseline, p) {
			t.Fatalf("forged projection mutation %d not compared", i)
		}
	}
	for _, cancelAt := range []int{1, 2, 4} {
		c := &alignedTestCancelContext{Context: ctx, cancelAt: cancelAt}
		if alignedWindowEqual(c, baseline, baseline) {
			t.Fatal("projection equality ignored cancellation")
		}
	}
	r, err := nativeAlignedWindowRunners().Trend(ctx, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario())
	if err != nil {
		t.Fatal(err)
	}
	for _, warmup := range []int{-50, 0, 20, 51, math.MaxInt} {
		if _, ok := projectAlignedWindowControl(ctx, r.Replay.Passive, warmup, 2, true); ok {
			t.Fatal("bad native mapping admitted at projection boundary")
		}
	}
	for _, scored := range []int{-1, 0, 1, 3, math.MaxInt} {
		if _, ok := projectAlignedWindowControl(ctx, r.Replay.Passive, 50, scored, true); ok {
			t.Fatal("bad mark shape admitted at projection boundary")
		}
	}
	if _, ok := projectAlignedWindowDrawdown(backtest.FundedCausalDrawdown{BarIndex: new(int)}, 50, 52); ok {
		t.Fatal("mixed nil drawdown shape admitted")
	}
	bad := r.Cash
	source, scored := 10000, 0
	bad.DrawdownSourceBarIndex = &source
	bad.DrawdownScoredBarIndex = &scored
	if _, ok := projectAlignedWindowScore(bad, 50, 2, 50); ok {
		t.Fatal("source drawdown shape admitted")
	}
	cancelCtx := &alignedTestCancelContext{Context: ctx, cancelAt: 3}
	if _, ok := projectAlignedWindow(cancelCtx, alignedTestFacts(r), r.Replay.Cash, r.Replay.Passive, r.Cash, r.Passive, 50); ok {
		t.Fatal("projection loop ignored cancellation")
	}
}

func TestAlignedWindowForgedNativeResults(t *testing.T) {
	bars, _ := alignedTestFixture()
	// Every mutation still goes through the unchanged original-source summary
	// validator; agreement of forged returned control facts is insufficient.
	for _, mutate := range []func(*backtest.Trend50WindowComparisonResult){
		func(r *backtest.Trend50WindowComparisonResult) { r.ScoreStartSourceIndex-- }, func(r *backtest.Trend50WindowComparisonResult) { r.Window.EndExclusiveUnix++ }, func(r *backtest.Trend50WindowComparisonResult) { r.WarmupBars = 20 }, func(r *backtest.Trend50WindowComparisonResult) { r.Replay.Scenario.FeeBps = "1" }, func(r *backtest.Trend50WindowComparisonResult) { r.Replay.InitialModelCashUnits = "1" }, func(r *backtest.Trend50WindowComparisonResult) { r.Replay.Passive.Entry.Reason = "PRIVATE" }, func(r *backtest.Trend50WindowComparisonResult) { r.Replay.Passive.Entry.ModelQuantity = .5 }, func(r *backtest.Trend50WindowComparisonResult) { r.Replay.Passive.FinalPositionTotalBasisUnits = "1" }, func(r *backtest.Trend50WindowComparisonResult) { r.Replay.Passive.CloseMarks[50].ModelQuantity = .5 }, func(r *backtest.Trend50WindowComparisonResult) {
			r.Replay.Passive.CloseMarks[50].NetUnrealizedAccountingPnLUnits = "1"
		}, func(r *backtest.Trend50WindowComparisonResult) { r.Passive.DrawdownSourceBarIndex = nil }, func(r *backtest.Trend50WindowComparisonResult) { r.Passive.MaxCloseMarkDrawdown.BarIndex = nil },
	} {
		runners := nativeAlignedWindowRunners()
		trend := runners.Trend
		runners.Breakout = nil
		runners.Mean = nil
		runners.Trend = func(ctx context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Trend50WindowComparisonResult, error) {
			r, e := trend(ctx, sym, b, w, cash, s)
			if e == nil {
				mutate(&r)
			}
			return r, e
		}
		out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
		if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), out, diagnostic, runners); code != 1 || out.calls != 0 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: TrendConfluence: invalid_result\n" {
			t.Fatal("forged native result escaped original-source validation")
		}
	}
}

func TestAlignedWindowBoundedReader(t *testing.T) {
	reader := &causalCLICountReader{reader: strings.NewReader(strings.Repeat("PRIVATE", 200000))}
	owned := &diagnosticReadCloser{reader: reader}
	var diagnostic bytes.Buffer
	code := runAlignedWindowInput(nil, alignedTestArgs("PRIVATE_PATH"), nil, &diagnostic, func(string) (io.ReadCloser, error) { return owned, nil }, parseBacktestCausalCSV, alignedWindowRunners{})
	if code != 1 || reader.read != 1048577 || owned.closes != 1 || diagnostic.String() != "backtest-causal-aligned-window-compare: input: resource_limit\n" {
		t.Fatal("one bounded parse/close changed")
	}
	// END is parsed only after a valid START, before the first native call.
	args := alignedTestArgs("PRIVATE")
	args[3] = "02"
	_, csv := alignedTestFixture()
	diagnostic.Reset()
	if code := runAlignedWindowInput(nil, args, nil, &diagnostic, func(string) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader(csv)), nil }, parseBacktestCausalCSV, alignedWindowRunners{}); code != 1 || diagnostic.String() != "backtest-causal-aligned-window-compare: input: invalid_window\n" {
		t.Fatal("END parse must precede any native call")
	}
}

func TestAlignedWindowEveryProjectedEconomicField(t *testing.T) {
	bars, _ := alignedTestFixture()
	_, _, _, baseline := alignedTestNativeSections(t, bars, alignedTestWindow(), "100", alignedTestScenario())
	// Work on fresh private projections, not native result aliases. Mutating
	// every stored scalar distinguishes full-path equality from final totals.
	fresh := func() alignedWindowProjection {
		_, _, _, p := alignedTestNativeSections(t, bars, alignedTestWindow(), "100", alignedTestScenario())
		return p
	}
	for _, selectValue := range []func(*alignedWindowProjection) reflect.Value{
		func(p *alignedWindowProjection) reflect.Value { return reflect.ValueOf(&p.Passive.Final).Elem() },
		func(p *alignedWindowProjection) reflect.Value {
			return reflect.ValueOf(&p.Passive.Marks[0].Value).Elem()
		},
		func(p *alignedWindowProjection) reflect.Value {
			return reflect.ValueOf(&p.Passive.Marks[1].Value).Elem()
		},
		func(p *alignedWindowProjection) reflect.Value { return reflect.ValueOf(&p.Passive.Drawdown).Elem() },
		func(p *alignedWindowProjection) reflect.Value { return reflect.ValueOf(&p.PassiveScore.Value).Elem() },
	} {
		shape := selectValue(&baseline)
		for i := 0; i < shape.NumField(); i++ {
			kind := shape.Field(i).Kind()
			if kind != reflect.String && kind != reflect.Int && kind != reflect.Float64 && kind != reflect.Bool {
				continue
			}
			// ModelIdentity has already been deliberately removed from the
			// normalized score, so it is not a retained economic field.
			if shape.Type().Field(i).Name == "ModelIdentity" {
				continue
			}
			p := fresh()
			field := selectValue(&p).Field(i)
			switch kind {
			case reflect.String:
				field.SetString(field.String() + "X")
			case reflect.Int:
				field.SetInt(field.Int() + 1)
			case reflect.Float64:
				field.SetFloat(field.Float() + 1)
			case reflect.Bool:
				field.SetBool(!field.Bool())
			}
			if alignedWindowEqual(context.Background(), baseline, p) {
				t.Fatalf("projected field %s not compared", shape.Type().Field(i).Name)
			}
		}
	}
	p := fresh()
	p.Passive.Marks[0].Value.Timestamp = p.Passive.Marks[0].Value.Timestamp.Add(time.Second)
	if alignedWindowEqual(context.Background(), baseline, p) {
		t.Fatal("mark timestamp not compared")
	}
}

type alignedTestArmedContext struct {
	context.Context
	armed bool
	calls int
}

func (c *alignedTestArmedContext) Err() error {
	if c.armed {
		c.calls++
		if c.calls >= 2 {
			return context.Canceled
		}
	}
	return nil
}

func TestAlignedWindowValidationAndFinalOutputCancellation(t *testing.T) {
	bars, _ := alignedTestFixture()
	for family := 0; family < 3; family++ {
		ctx := &alignedTestArmedContext{Context: context.Background()}
		runners := nativeAlignedWindowRunners()
		trend, breakout, mean := runners.Trend, runners.Breakout, runners.Mean
		runners.Trend = func(ctxIn context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Trend50WindowComparisonResult, error) {
			r, e := trend(ctxIn, sym, b, w, cash, s)
			if family == 0 {
				ctx.armed = true
			}
			return r, e
		}
		runners.Breakout = func(ctxIn context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.WindowComparisonResult, error) {
			r, e := breakout(ctxIn, sym, b, w, cash, s)
			if family == 1 {
				ctx.armed = true
			}
			return r, e
		}
		runners.Mean = func(ctxIn context.Context, sym string, b []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, s backtest.ExecutionScenario) (backtest.Mean20WindowComparisonResult, error) {
			r, e := mean(ctxIn, sym, b, w, cash, s)
			if family == 2 {
				ctx.armed = true
			}
			return r, e
		}
		out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
		if code := runAlignedWindowData(ctx, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), out, diagnostic, runners); code != 1 || out.calls != 0 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: "+[]string{"TrendConfluence", "BreakoutVol", "MeanReversion"}[family]+": canceled\n" {
			t.Fatal("cancellation during native summary lost active family")
		}
	}
	// Measure an uncanceled bounded call's Err observations, then cancel only
	// at its final pre-write observation. No timer or live service participates.
	dry := &alignedTestCancelContext{Context: context.Background(), cancelAt: math.MaxInt}
	if code := runAlignedWindowData(dry, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), &alignedTestWriter{}, nil, nativeAlignedWindowRunners()); code != 0 {
		t.Fatal("checkpoint control run failed")
	}
	final := &alignedTestCancelContext{Context: context.Background(), cancelAt: dry.calls}
	out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
	if code := runAlignedWindowData(final, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), out, diagnostic, nativeAlignedWindowRunners()); code != 1 || out.calls != 0 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: output: canceled\n" {
		t.Fatal("final pre-write cancellation was not output-attributed")
	}
}

func TestAlignedWindowExcludedFutureAndPriceBounds(t *testing.T) {
	bars, _ := alignedTestFixture()
	var original, mutated, diagnostic bytes.Buffer
	if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), &original, &diagnostic, nativeAlignedWindowRunners()); code != 0 {
		t.Fatal("control fixture failed")
	}
	bars[52].Close, bars[52].High = 500, 501
	if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), &mutated, &diagnostic, nativeAlignedWindowRunners()); code != 0 || mutated.String() != original.String() || diagnostic.Len() != 0 {
		t.Fatal("valid excluded future changed scored results")
	}
	for _, price := range []float64{.01, 1000000} {
		for i := range bars {
			bars[i].Open, bars[i].High, bars[i].Low, bars[i].Close, bars[i].Volume = price, price, price, price, 1e12
		}
		var out, err bytes.Buffer
		if code := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "100", alignedTestScenario(), &out, &err, nativeAlignedWindowRunners()); code != 0 || err.Len() != 0 {
			t.Fatalf("admitted numeric boundary: price=%g code=%d stderr=%q", price, code, err.String())
		}
	}
}

func TestAlignedWindowLowCashFeeAdmissionIsNative(t *testing.T) {
	bars, _ := alignedTestFixture()
	s := alignedTestScenario()
	s.FixedFee = "1"
	ctx := context.Background()
	r := nativeAlignedWindowRunners()
	family, code := "", ""
	if _, err := r.Trend(ctx, "FIXTURE", append([]backtest.OHLCV(nil), bars...), alignedTestWindow(), "9", s); err != nil {
		family, code = alignedWindowNativeError("TrendConfluence", err)
	} else if _, err = r.Breakout(ctx, "FIXTURE", append([]backtest.OHLCV(nil), bars...), alignedTestWindow(), "9", s); err != nil {
		family, code = alignedWindowNativeError("BreakoutVol", err)
	} else if _, err = r.Mean(ctx, "FIXTURE", append([]backtest.OHLCV(nil), bars...), alignedTestWindow(), "9", s); err != nil {
		family, code = alignedWindowNativeError("MeanReversion", err)
	}
	out, diagnostic := &alignedTestWriter{}, &alignedTestWriter{}
	status := runAlignedWindowData(nil, "FIXTURE", bars, alignedTestWindow(), "9", s, out, diagnostic, nativeAlignedWindowRunners())
	if family != "" {
		if status != 1 || out.calls != 0 || string(diagnostic.attempt) != "backtest-causal-aligned-window-compare: "+family+": "+code+"\n" {
			t.Fatal("legitimate native low-cash fee failure was suppressed")
		}
	} else if status != 0 || out.calls != 1 || diagnostic.calls != 0 {
		t.Fatal("native low-cash integration disagreed")
	}
}
