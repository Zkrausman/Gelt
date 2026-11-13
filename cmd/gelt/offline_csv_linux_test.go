//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"gelt/pkg/backtest"
)

type offlineCSVForm struct {
	name, usage string
	run         func(context.Context, []string, io.Writer, io.Writer) int
	tokens      []string
}

// All argument lists have the real handler's full arity, including both
// MeanReversion forms. An argument-count rejection cannot satisfy a FIFO case.
func offlineCSVForms() []offlineCSVForm {
	return []offlineCSVForm{
		{"backtest-causal", causalCLIUsage, runBacktestCausal, []string{"BreakoutVol", "TEST", ""}},
		{"backtest-causal-funded", fundedCLIUsage, runBacktestCausalFunded, []string{"BreakoutVol", "TEST", "", "100"}},
		{"backtest-causal-fees", feeScenarioCLIUsage, runBacktestCausalFees, []string{"BreakoutVol", "TEST", "", "100", "0", "0"}},
		{"backtest-causal-execution", executionScenarioCLIUsage, runBacktestCausalExecution, []string{"BreakoutVol", "TEST", "", "100", "0", "0", "0", "0"}},
		{"backtest-causal-compare", comparisonCLIUsage, runBacktestCausalComparison, []string{"BreakoutVol", "TEST", "", "100", "0", "0", "0", "0"}},
		{"backtest-causal-window-compare", windowCLIUsage, runBacktestCausalWindowComparison, []string{"BreakoutVol", "TEST", "", "1700001200", "1700003001", "100", "0", "0", "0", "0"}},
		{"backtest-causal-trend50-compare", trend50CLIUsage, runBacktestCausalTrend50Comparison, []string{"TrendConfluence", "TEST", "", "100", "0", "0", "0", "0"}},
		{"backtest-causal-trend50-window-compare", trend50WindowCLIUsage, runBacktestCausalTrend50WindowComparison, []string{"TrendConfluence", "TEST", "", "1700003000", "1700003001", "100", "0", "0", "0", "0"}},
		{"backtest-causal-meanrev-compare", mean20CLIUsage, runBacktestCausalMean20Comparison, []string{"MeanReversion", "TEST", "", "100", "0", "0", "0", "0"}},
		{"backtest-causal-meanrev-compare", mean20CLIUsage, runBacktestCausalMean20Comparison, []string{"MeanReversion", "TEST", "", "100", "0", "0", "0", "0", "--window", "1700001200", "1700003001"}},
	}
}

func (f offlineCSVForm) args(path string) []string {
	args := append([]string(nil), f.tokens...)
	args[2] = path
	return args
}

func offlineCSVFixture(t *testing.T) (string, []backtest.OHLCV) {
	t.Helper()
	var csv strings.Builder
	csv.WriteString(causalCSVHeader + "\n")
	bars := make([]backtest.OHLCV, 51)
	for i := range bars {
		ts := int64(1700000000 + 60*i)
		fmt.Fprintf(&csv, "%d,100,100,100,100,1\n", ts)
		bars[i] = backtest.OHLCV{Timestamp: ts, Open: 100, High: 100, Low: 100, Close: 100, Volume: 1}
	}
	return causalCLITestFile(t, csv.String()), bars
}

// Expected complete bytes come from the unchanged typed execution/summary
// seams over independently constructed bars, without opening or parsing a path.
func offlineCSVExpected(t *testing.T, index int, bars []backtest.OHLCV) string {
	t.Helper()
	ctx := context.Background()
	s := backtest.ExecutionScenario{FixedFee: "0", FeeBps: "0", BuyAdverseBps: "0", SellAdverseBps: "0"}
	w := backtest.DeclaredComparisonWindow{StartInclusiveUnix: 1700001200, EndExclusiveUnix: 1700003001}
	var out, diagnostic bytes.Buffer
	code := 0
	if index <= 5 {
		engine, ok := newBacktestCausalEngine("BreakoutVol")
		if !ok {
			t.Fatal("synthetic evaluator unavailable")
		}
		switch index {
		case 0:
			code = runBacktestCausalEngine(ctx, "TEST", bars, engine, &out, &diagnostic)
		case 1:
			code = runBacktestCausalFundedEngine(ctx, "TEST", bars, "100", engine, &out, &diagnostic)
		case 2:
			code = runBacktestCausalFeesEngine(ctx, "TEST", bars, "100", backtest.FeeScenario{FixedFee: "0", FeeBps: "0"}, engine, &out, &diagnostic)
		case 3:
			code = runBacktestCausalExecutionEngine(ctx, "TEST", bars, "100", s, engine, &out, &diagnostic)
		case 4:
			code = runBacktestCausalComparisonEngine(ctx, "TEST", bars, "100", s, engine, &out, &diagnostic)
		case 5:
			code = runBacktestCausalWindowComparisonEngine(ctx, "TEST", bars, w, "100", s, engine, &out, &diagnostic)
		}
	} else {
		var summary string
		var valid bool
		switch index {
		case 6:
			r, err := backtest.RunTrend50ComparisonCausal(ctx, "TEST", bars, "100", s)
			if err != nil {
				t.Fatal(err)
			}
			summary, valid = backtestCausalTrend50ComparisonSummary(ctx, r, bars, "TEST", "100", s)
		case 7:
			w.StartInclusiveUnix = 1700003000
			code = runBacktestCausalTrend50WindowComparisonData(ctx, "TEST", bars, w, "100", s, &out, &diagnostic)
			valid = true
		case 8:
			r, err := backtest.RunMean20ComparisonCausal(ctx, "TEST", bars, "100", s)
			if err != nil {
				t.Fatal(err)
			}
			summary, valid = mean20CLISummary(ctx, r, bars, "TEST", "100", s)
		case 9:
			r, err := backtest.RunMean20WindowComparisonCausal(ctx, "TEST", bars, w, "100", s)
			if err != nil {
				t.Fatal(err)
			}
			summary, valid = mean20WindowCLISummary(ctx, r, bars, "TEST", w, "100", s)
		}
		if !valid {
			t.Fatal("synthetic summary rejected")
		}
		out.WriteString(summary)
	}
	if code != 0 || diagnostic.Len() != 0 || out.Len() == 0 {
		t.Fatalf("synthetic execution: code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
	}
	return out.String()
}

func TestOfflineCSVFileRegularAndSymlinkCompatibility(t *testing.T) {
	path, bars := offlineCSVFixture(t)
	link := filepath.Join(t.TempDir(), "regular-link.csv")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	for i, form := range offlineCSVForms() {
		t.Run(fmt.Sprintf("%d-%s", i, form.name), func(t *testing.T) {
			want := offlineCSVExpected(t, i, bars)
			for _, input := range []string{path, link} {
				var out, diagnostic bytes.Buffer
				code := form.run(context.Background(), form.args(input), &out, &diagnostic)
				if code != 0 || out.String() != want || diagnostic.Len() != 0 {
					t.Fatalf("regular/symlink output differs: code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
				}
			}
		})
	}
}

// The child executes only one real handler. It does not invoke main, mutate
// global stdio/environment, or recursively start another helper process.
func TestOfflineCSVFileChild(t *testing.T) {
	var args []string
	for i, arg := range os.Args {
		if arg == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) == 0 || args[0] != "offline-csv-file-child" {
		t.Skip("owned subprocess entry")
	}
	if len(args) != 4 {
		t.Fatal("invalid subprocess arguments")
	}
	i, err := strconv.Atoi(args[1])
	forms := offlineCSVForms()
	if err != nil || i < 0 || i >= len(forms) {
		t.Fatal("invalid subprocess form")
	}
	ctx := context.Background()
	if args[3] == "canceled" {
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(ctx)
		cancel()
	} else if args[3] != "active" {
		t.Fatal("invalid subprocess mode")
	}
	os.Exit(forms[i].run(ctx, forms[i].args(args[2]), os.Stdout, os.Stderr))
}

func offlineCSVChild(t *testing.T, index int, path, mode, want string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestOfflineCSVFileChild$", "--", "offline-csv-file-child", strconv.Itoa(index), path, mode)
	cmd.Env = []string{"HOME=" + os.Getenv("HOME"), "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "DISCORD_WEBHOOK_ENABLE=false"}
	var out, diagnostic bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &diagnostic
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	watchdog := time.NewTimer(30 * time.Second)
	defer watchdog.Stop()
	select {
	case err = <-done:
	case <-watchdog.C:
		// Only this freshly started child is owned. Always join its Wait before
		// failing, so a regression cannot leave a blocked process/goroutine.
		killErr := cmd.Process.Kill()
		waitErr := <-done
		t.Fatalf("deadlock watchdog expired (not a latency SLA): kill=%v wait=%v stdout=%q stderr=%q", killErr, waitErr, out.String(), diagnostic.String())
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 1 || out.Len() != 0 || diagnostic.String() != want {
		t.Fatalf("child result: error=%v stdout=%q stderr=%q", err, out.String(), diagnostic.String())
	}
}

func TestOfflineCSVFileFIFOAndPreCanceled(t *testing.T) {
	for i, form := range offlineCSVForms() {
		t.Run(fmt.Sprintf("%d-%s", i, form.name), func(t *testing.T) {
			path := causalCLITestFile(t, "regular before namespace substitution")
			info, err := os.Stat(path)
			if err != nil || !info.Mode().IsRegular() {
				t.Fatalf("pre-observation: %v", err)
			}
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if err := syscall.Mkfifo(path, 0600); err != nil {
				t.Fatal(err)
			}
			// Deterministically substitute the observed regular pathname with
			// a real unwritten FIFO before the handler's real kernel open.
			offlineCSVChild(t, i, path, "active", form.name+": input_file\n")
			offlineCSVChild(t, i, path, "canceled", form.name+": canceled\n")
		})
	}
}

func TestOfflineCSVFileDescriptorOwnership(t *testing.T) {
	regular, _ := offlineCSVFixture(t)
	dir := t.TempDir()
	fifo := filepath.Join(t.TempDir(), "unwritten.fifo")
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, path string
		regular    bool
		closed     bool
	}{
		{"regular", regular, true, false},
		{"directory", dir, false, false},
		{"FIFO", fifo, false, false},
		{"device", os.DevNull, false, false},
		{"closed-stat-failure", regular, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, err := os.OpenFile(tc.path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
			if err != nil {
				t.Fatal(err)
			}
			if tc.closed {
				if err := f.Close(); err != nil {
					t.Fatal(err)
				}
			}
			got, err := admitOfflineCSVFile(f)
			if tc.regular {
				if got != f || err != nil {
					if got != nil {
						_ = got.Close()
					}
					t.Fatalf("regular descriptor rejected: %v", err)
				}
				_, statErr := f.Stat()
				closeErr := f.Close()
				if statErr != nil || closeErr != nil {
					t.Fatalf("caller did not retain ownership: stat=%v close=%v", statErr, closeErr)
				}
			} else {
				_, statErr := f.Stat()
				if got != nil || err == nil || !errors.Is(statErr, os.ErrClosed) {
					_ = f.Close()
					t.Fatalf("rejected descriptor must be closed: returned=%v error=%v stat=%v", got, err, statErr)
				}
			}
		})
	}
}

func TestOfflineCSVFileOpenedInodeSurvivesPathReplacement(t *testing.T) {
	path, want := offlineCSVFixture(t)
	f, err := openOfflineCSV(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := f.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	// Parse the admitted descriptor directly, with no second path open and
	// no FIFO writer. Its inode still contains the original complete CSV.
	got, err := parseBacktestCausalCSV(f)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("opened inode changed: bars=%d error=%v", len(got), err)
	}
}

func TestOfflineCSVFileErrorsAndOrdering(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "raw-path-canary\nmissing.csv")
	for _, tc := range []struct {
		name, path, code string
	}{
		{"empty", causalCLITestFile(t, ""), "invalid_csv"},
		{"malformed", causalCLITestFile(t, "raw-input-canary\n"), "invalid_csv"},
		{"oversize", causalCLITestFile(t, strings.Repeat("x", causalCSVMaxBytes+1)), "resource_limit"},
		{"missing", missing, "input_file"},
		{"directory", dir, "input_file"},
		{"device", os.DevNull, "input_file"},
	} {
		for i, form := range offlineCSVForms() {
			t.Run(fmt.Sprintf("%s/%d-%s", tc.name, i, form.name), func(t *testing.T) {
				args := form.args(tc.path)
				args[0] = "raw-target-canary"
				for j := 3; j < len(args); j++ {
					args[j] = "raw-declaration-canary"
				}
				var out, diagnostic bytes.Buffer
				code := form.run(context.Background(), args, &out, &diagnostic)
				if code != 1 || out.Len() != 0 || diagnostic.String() != form.name+": "+tc.code+"\n" {
					t.Fatalf("input must precede target/window/cost and remain private: code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
				}
			})
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for i, form := range offlineCSVForms() {
		t.Run(fmt.Sprintf("arity-before-context/%d", i), func(t *testing.T) {
			args := form.args(missing)
			var out, diagnostic bytes.Buffer
			code := form.run(ctx, args[:len(args)-1], &out, &diagnostic)
			if code != 1 || out.Len() != 0 || diagnostic.String() != form.usage+form.name+": invalid_arguments\n" {
				t.Fatalf("arity/usage changed: code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
			}
		})
	}
}
