package main

import (
	"bytes"
	"context"
	"gelt/pkg/backtest"
	"strings"
	"testing"
)

func TestTrend50WindowCLIProjectionAndOutput(t *testing.T) {
	b := trend50TestBars(54, false)
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: b[53].Timestamp, EndExclusiveUnix: b[53].Timestamp + 1}
	s := comparisonCLIScenario()
	r, e := backtest.RunTrend50WindowComparisonCausal(nil, "TEST", b, w, "100", s)
	if e != nil {
		t.Fatal(e)
	}
	if !trend50WindowCLIResultValid(context.Background(), r, b, "TEST", w, "100", s) {
		t.Fatal("valid rejected")
	}
	bad := r
	bad.WarmupStartSourceIndex++
	if trend50WindowCLIResultValid(context.Background(), bad, b, "TEST", w, "100", s) {
		t.Fatal("forged offset")
	}
	bad = r
	bad.Passive.EndingEquityUnits = "1"
	if trend50WindowCLIResultValid(context.Background(), bad, b, "TEST", w, "100", s) {
		t.Fatal("forged score")
	}
	var out, err bytes.Buffer
	if runBacktestCausalTrend50WindowComparisonData(nil, "TEST", b, w, "100", s, &out, &err) != 0 {
		t.Fatal(err.String())
	}
	for _, v := range []string{"starting equity", "replay index - 50", "reseeds", "conditional on normalized signals"} {
		if !strings.Contains(out.String(), v) {
			t.Fatalf("missing %s", v)
		}
	}
	if out.Len() > 8192 {
		t.Fatal("output bound")
	}
	if runBacktestCausalTrend50WindowComparisonData(nil, "TEST", b, w, "100", s, nil, &err) != 1 {
		t.Fatal("nil writer")
	}
}

type twShortWriter struct{ calls int }

func (w *twShortWriter) Write(p []byte) (int, error) { w.calls++; return len(p) / 2, nil }
func TestTrend50WindowCLIAdmissionAndShortWrite(t *testing.T) {
	b := trend50TestBars(51, false)
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: b[50].Timestamp, EndExclusiveUnix: b[50].Timestamp + 1}
	s := comparisonCLIScenario()
	var err bytes.Buffer
	sw := &twShortWriter{}
	if runBacktestCausalTrend50WindowComparisonData(nil, "TEST", b, w, "100", s, sw, &err) != 1 || sw.calls != 1 || err.String() != "backtest-causal-trend50-window-compare: output_error\n" {
		t.Fatalf("short write calls %d error %q", sw.calls, err.String())
	}
	err.Reset()
	if runBacktestCausalTrend50WindowComparison(nil, nil, &bytes.Buffer{}, &err) != 1 || !strings.Contains(err.String(), "invalid_arguments") {
		t.Fatal(err.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err.Reset()
	args := make([]string, 10)
	if runBacktestCausalTrend50WindowComparison(ctx, args, &bytes.Buffer{}, &err) != 1 || err.String() != "backtest-causal-trend50-window-compare: canceled\n" {
		t.Fatal(err.String())
	}
}
