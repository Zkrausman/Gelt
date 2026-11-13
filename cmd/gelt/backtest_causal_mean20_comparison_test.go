package main

import (
	"bytes"
	"context"
	"fmt"
	"gelt/pkg/backtest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mean20CLITestBars() []backtest.OHLCV {
	b := make([]backtest.OHLCV, 21)
	for i := range b {
		p := 100.0
		if i >= 19 {
			p = 80
		}
		b[i] = backtest.OHLCV{Timestamp: int64(i + 1), Open: p, High: p, Low: p, Close: p, Volume: 1}
	}
	b[20].Low = 78
	return b
}
func TestMean20CLIAndDisplay(t *testing.T) {
	bars := mean20CLITestBars()
	s := backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	r, err := backtest.RunMean20ComparisonCausal(nil, "TEST", bars, "100", s)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := mean20CLISummary(context.Background(), r, bars, "TEST", "100", s); !ok {
		t.Fatal("valid summary rejected")
	}
	bad := r
	bad.Strategy.ReferenceReplay.TargetName = "BreakoutVol"
	if _, ok := mean20CLISummary(context.Background(), bad, bars, "TEST", "100", s); ok {
		t.Fatal("target accepted")
	}
	if executionScenarioCLIResultValid(r.Strategy) {
		t.Fatal("old Breakout binding admitted MeanReversion")
	}
	if executionScenarioCLIResultValidForTarget(r.Strategy, "unrecognized") {
		t.Fatal("unknown target accepted")
	}
	var csv strings.Builder
	csv.WriteString("Timestamp,Open,High,Low,Close,Volume\n")
	for _, b := range bars {
		fmt.Fprintf(&csv, "%d,%.0f,%.0f,%.0f,%.0f,%.0f\n", b.Timestamp, b.Open, b.High, b.Low, b.Close, b.Volume)
	}
	path := filepath.Join(t.TempDir(), "fixture.csv")
	if err := os.WriteFile(path, []byte(csv.String()), 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"MeanReversion", "TEST", path, "100", "0", "0", "0", "0"}
	var out, errs bytes.Buffer
	if code := runBacktestCausalMean20Comparison(nil, args, &out, &errs); code != 0 || !strings.Contains(out.String(), "99.86607143") || out.Len() > 8192 {
		t.Fatalf("whole %d %s %s", code, out.String(), errs.String())
	}
	out.Reset()
	errs.Reset()
	if code := runBacktestCausalMean20Comparison(nil, append(args, "--window", "21", "22"), &out, &errs); code != 0 || !strings.Contains(out.String(), "99.86607143") {
		t.Fatalf("window %d %s %s", code, out.String(), errs.String())
	}
	out.Reset()
	errs.Reset()
	if code := runBacktestCausalMean20Comparison(nil, append(args, "--bad", "21", "22"), &out, &errs); code != 1 || out.Len() != 0 || !strings.Contains(errs.String(), "invalid_arguments") {
		t.Fatal("bad flag")
	}
}

type mean20ShortWriter struct{ calls int }

func (w *mean20ShortWriter) Write(p []byte) (int, error) { w.calls++; return len(p) / 2, nil }
func TestMean20DisplayRejectsMutations(t *testing.T) {
	bars := mean20CLITestBars()
	s := backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	makeResult := func() backtest.Mean20ComparisonResult {
		r, err := backtest.RunMean20ComparisonCausal(nil, "TEST", bars, "100", s)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	for _, mutate := range []func(*backtest.Mean20ComparisonResult){
		func(r *backtest.Mean20ComparisonResult) { r.ModelIdentity = backtest.ComparisonCausalModelIdentity },
		func(r *backtest.Mean20ComparisonResult) { r.Strategy.CloseMarks[20].EquityUnits = "1" },
		func(r *backtest.Mean20ComparisonResult) { r.Strategy.ReferenceReplay.Fills[0].Price = 79 },
		func(r *backtest.Mean20ComparisonResult) { r.Passive.FinalEquityUnits = "1" },
		func(r *backtest.Mean20ComparisonResult) {
			r.Cash.ModelIdentity = backtest.ComparisonPassiveModelIdentity
		},
		func(r *backtest.Mean20ComparisonResult) { p := 99.0; r.Strategy.MaxCloseMarkDrawdown.Percent = &p },
		func(r *backtest.Mean20ComparisonResult) { r.StrategyMinusCashUnits = "0" },
	} {
		r := makeResult()
		mutate(&r)
		if _, ok := mean20CLISummary(context.Background(), r, bars, "TEST", "100", s); ok {
			t.Fatal("accepted mutation")
		}
	}
	var csv strings.Builder
	csv.WriteString("Timestamp,Open,High,Low,Close,Volume\n")
	for _, b := range bars {
		fmt.Fprintf(&csv, "%d,%.0f,%.0f,%.0f,%.0f,%.0f\n", b.Timestamp, b.Open, b.High, b.Low, b.Close, b.Volume)
	}
	p := filepath.Join(t.TempDir(), "x.csv")
	if err := os.WriteFile(p, []byte(csv.String()), 0600); err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	short := &mean20ShortWriter{}
	code := runBacktestCausalMean20Comparison(nil, []string{"MeanReversion", "TEST", p, "100", "0", "0", "0", "0"}, short, &stderr)
	if code != 1 || short.calls != 1 || stderr.String() != "backtest-causal-meanrev-compare: output_error\n" {
		t.Fatal("short writer")
	}
}

func TestMean20DisplayRejectsCoherentAlternateOHLC(t *testing.T) {
	original := mean20CLITestBars()
	s := backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	for _, change := range []func([]backtest.OHLCV){
		func(b []backtest.OHLCV) { b[20].Open = 79 },
		func(b []backtest.OHLCV) { b[20].Low = 80 },
	} {
		alternate := append([]backtest.OHLCV(nil), original...)
		change(alternate)
		r, err := backtest.RunMean20ComparisonCausal(nil, "TEST", alternate, "100", s)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := mean20CLISummary(context.Background(), r, alternate, "TEST", "100", s); !ok {
			t.Fatal("coherent alternate result rejected on its own source")
		}
		if _, ok := mean20CLISummary(context.Background(), r, original, "TEST", "100", s); ok {
			t.Fatal("alternate-OHLC result accepted against original source")
		}
	}
}

func TestMean20WindowDisplayRejectsDetachedProjection(t *testing.T) {
	bars := mean20CLITestBars()
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 21, EndExclusiveUnix: 22}
	s := backtest.ExecutionScenario{FixedFee: "1", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	makeResult := func() backtest.Mean20WindowComparisonResult {
		r, err := backtest.RunMean20WindowComparisonCausal(nil, "TEST", bars, w, "100", s)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := makeResult()
	if _, ok := mean20WindowCLISummary(context.Background(), r, bars, "TEST", w, "100", s); !ok {
		t.Fatal("valid window rejected")
	}
	for _, mutate := range []func(*backtest.Mean20WindowComparisonResult){
		func(r *backtest.Mean20WindowComparisonResult) {
			r.ModelIdentity = backtest.WindowComparisonModelIdentity
		},
		func(r *backtest.Mean20WindowComparisonResult) {
			r.ReplayProfileIdentity = backtest.Trend50ComparisonModelIdentity
		},
		func(r *backtest.Mean20WindowComparisonResult) { r.ResetPolicy = "filtered_full_history" },
		func(r *backtest.Mean20WindowComparisonResult) { r.WarmupStartSourceIndex = 1 },
		func(r *backtest.Mean20WindowComparisonResult) { r.ScoredBars = 2 },
		func(r *backtest.Mean20WindowComparisonResult) {
			r.Strategy.ModelIdentity = backtest.ComparisonCashModelIdentity
		},
		func(r *backtest.Mean20WindowComparisonResult) {
			r.Cash.ModelIdentity = backtest.ComparisonPassiveModelIdentity
		},
		func(r *backtest.Mean20WindowComparisonResult) { r.Strategy.EndingEquityUnits = "0" },
		func(r *backtest.Mean20WindowComparisonResult) { r.Strategy.AggregateFeeUnits = "0" },
		func(r *backtest.Mean20WindowComparisonResult) { i := 99; r.Strategy.DrawdownSourceBarIndex = &i },
		func(r *backtest.Mean20WindowComparisonResult) {
			r.Replay.Strategy.ReferenceReplay.Evaluations[0].BarIndex = 20
		},
	} {
		r := makeResult()
		mutate(&r)
		if _, ok := mean20WindowCLISummary(context.Background(), r, bars, "TEST", w, "100", s); ok {
			t.Fatal("accepted detached window projection")
		}
	}
}

type mean20FailWriter struct{ calls int }

func (w *mean20FailWriter) Write([]byte) (int, error) {
	w.calls++
	return 0, fmt.Errorf("PRIVATE_WRITER_ERROR")
}
func TestMean20CLIErrorOrderAndWriters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "PRIVATE_INPUT.csv")
	bars := mean20CLITestBars()
	var csv strings.Builder
	csv.WriteString("Timestamp,Open,High,Low,Close,Volume\n")
	for _, b := range bars {
		fmt.Fprintf(&csv, "%d,%.0f,%.0f,%.0f,%.0f,%.0f\n", b.Timestamp, b.Open, b.High, b.Low, b.Close, b.Volume)
	}
	if err := os.WriteFile(path, []byte(csv.String()), 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"MeanReversion", "TEST", path, "100", "0", "0", "0", "0"}
	for _, writer := range []struct {
		name  string
		value interface{ Write([]byte) (int, error) }
	}{{"nil", nil}, {"failure", &mean20FailWriter{}}} {
		var errs bytes.Buffer
		if code := runBacktestCausalMean20Comparison(nil, args, writer.value, &errs); code != 1 || errs.String() != "backtest-causal-meanrev-compare: output_error\n" {
			t.Fatalf("%s: %d %s", writer.name, code, errs.String())
		}
		if w, ok := writer.value.(*mean20FailWriter); ok && w.calls != 1 {
			t.Fatal("writer retried")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out, errs bytes.Buffer
	if code := runBacktestCausalMean20Comparison(ctx, args, &out, &errs); code != 1 || out.Len() != 0 || errs.String() != "backtest-causal-meanrev-compare: canceled\n" {
		t.Fatal("pre-canceled command")
	}
	if err := os.WriteFile(path, []byte("bad\n"), 0600); err != nil {
		t.Fatal(err)
	}
	bad := append(append([]string(nil), args...), "--BAD", "00", "00")
	bad[0] = "PRIVATE_TARGET"
	out.Reset()
	errs.Reset()
	if code := runBacktestCausalMean20Comparison(nil, bad, &out, &errs); code != 1 || out.Len() != 0 || errs.String() != "backtest-causal-meanrev-compare: invalid_csv\n" {
		t.Fatal("parser precedence or unsanitized error")
	}
}
