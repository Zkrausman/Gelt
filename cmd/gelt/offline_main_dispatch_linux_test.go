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
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

type offlineMainForm struct {
	name, command string
	handler       func(context.Context, []string, io.Writer, io.Writer) int
	tokens        []string
	pathIndex     int
}

// This is a dispatch oracle, not another accounting implementation. Distinct
// declarations make misplaced cash/cost operands observable in complete output.
func offlineMainForms() []offlineMainForm {
	return []offlineMainForm{
		{"diagnose", "diagnose-causal-csv", runDiagnoseCausalCSV, []string{""}, 0},
		{"aligned-window", "backtest-causal-aligned-window-compare", runBacktestCausalAlignedWindowComparison, []string{"OWNED.TEST", "", "1700003000", "1700003781", "100.12345678", "0.01", "17", "23", "31"}, 1},
		{"backtest-causal", "backtest-causal", runBacktestCausal, []string{"BreakoutVol", "OWNED.TEST", ""}, 2},
		{"funded", "backtest-causal-funded", runBacktestCausalFunded, []string{"BreakoutVol", "OWNED.TEST", "", "100.12345678"}, 2},
		{"fees", "backtest-causal-fees", runBacktestCausalFees, []string{"BreakoutVol", "OWNED.TEST", "", "100.12345678", "0.01", "17"}, 2},
		{"execution", "backtest-causal-execution", runBacktestCausalExecution, []string{"BreakoutVol", "OWNED.TEST", "", "100.12345678", "0.01", "17", "23", "31"}, 2},
		{"comparison", "backtest-causal-compare", runBacktestCausalComparison, []string{"BreakoutVol", "OWNED.TEST", "", "100.12345678", "0.01", "17", "23", "31"}, 2},
		{"window", "backtest-causal-window-compare", runBacktestCausalWindowComparison, []string{"BreakoutVol", "OWNED.TEST", "", "1700003000", "1700003781", "100.12345678", "0.01", "17", "23", "31"}, 2},
		{"trend50", "backtest-causal-trend50-compare", runBacktestCausalTrend50Comparison, []string{"TrendConfluence", "OWNED.TEST", "", "100.12345678", "0.01", "17", "23", "31"}, 2},
		{"trend50-window", "backtest-causal-trend50-window-compare", runBacktestCausalTrend50WindowComparison, []string{"TrendConfluence", "OWNED.TEST", "", "1700003000", "1700003781", "100.12345678", "0.01", "17", "23", "31"}, 2},
		{"meanrev", "backtest-causal-meanrev-compare", runBacktestCausalMean20Comparison, []string{"MeanReversion", "OWNED.TEST", "", "100.12345678", "0.01", "17", "23", "31"}, 2},
		{"meanrev-window", "backtest-causal-meanrev-compare", runBacktestCausalMean20Comparison, []string{"MeanReversion", "OWNED.TEST", "", "100.12345678", "0.01", "17", "23", "31", "--window", "1700003000", "1700003781"}, 2},
	}
}

func offlineMainCommandAllowed(command string) bool {
	switch command {
	case "diagnose-causal-csv", "backtest-causal-aligned-window-compare",
		"backtest-causal", "backtest-causal-funded", "backtest-causal-fees",
		"backtest-causal-execution", "backtest-causal-compare",
		"backtest-causal-window-compare", "backtest-causal-trend50-compare",
		"backtest-causal-trend50-window-compare", "backtest-causal-meanrev-compare":
		return true
	default:
		return false
	}
}

// Only the test binary contains this entry point. Fixture input cannot select
// operational, legacy-generated-data or arbitrary commands through this helper.
func TestOfflineMainDispatchHelper(t *testing.T) {
	if os.Getenv("GELT_OFFLINE_MAIN_HELPER") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			args := os.Args[i+1:]
			if len(args) == 0 || !offlineMainCommandAllowed(args[0]) {
				os.Exit(2)
			}
			os.Args = append([]string{"gelt"}, args...)
			main()
			os.Exit(2) // Every admitted main route exits explicitly.
		}
	}
	os.Exit(2)
}

type offlineMainResult struct {
	code               int
	stdout, diagnostic string
}

func offlineMainChild(t *testing.T, command string, args []string) offlineMainResult {
	t.Helper()
	home := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	operands := append([]string{"-test.run=^TestOfflineMainDispatchHelper$", "--", command}, args...)
	cmd := exec.CommandContext(ctx, os.Args[0], operands...)
	cmd.WaitDelay = 5 * time.Second
	cmd.Dir = home
	cmd.Env = []string{"HOME=" + home, "USERPROFILE=" + home, "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "DISCORD_WEBHOOK_ENABLE=false", "GELT_OFFLINE_MAIN_HELPER=1"}
	var out, diagnostic bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &diagnostic
	err := cmd.Run()
	if ctx.Err() != nil {
		t.Fatal("owned CLI child watchdog expired; this is a failed test, not an I/O deadline")
	}
	code := 0
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() < 0 {
			t.Fatalf("owned CLI child did not finish with a normal exit: %v", err)
		}
		code = exit.ExitCode()
	}
	files, err := os.ReadDir(home)
	if err != nil || len(files) != 0 {
		t.Fatal("owned CLI child unexpectedly wrote its disposable home")
	}
	if out.Len() > 32768 || diagnostic.Len() > offlineHelpMaxBytes || !utf8.Valid(out.Bytes()) || !utf8.Valid(diagnostic.Bytes()) {
		t.Fatal("owned CLI output exceeded its admitted text bounds")
	}
	return offlineMainResult{code, out.String(), diagnostic.String()}
}

func offlineMainTyped(form offlineMainForm, args []string) offlineMainResult {
	var out, diagnostic bytes.Buffer
	code := form.handler(context.Background(), append([]string(nil), args...), &out, &diagnostic)
	return offlineMainResult{code, out.String(), diagnostic.String()}
}

func offlineMainInput(t *testing.T) (string, string) {
	t.Helper()
	var csv strings.Builder
	csv.WriteString(causalCSVHeader + "\n")
	for i := 0; i < 64; i++ {
		fmt.Fprintf(&csv, "%d,100,100,100,100,1\n", 1700000000+60*i)
	}
	content := csv.String()
	path := filepath.Join(t.TempDir(), "owned supplied.csv")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path, content
}

func requireOfflineMainMatch(t *testing.T, got, want offlineMainResult) {
	t.Helper()
	if got != want {
		// Fixed metadata is enough to diagnose dispatch; do not dump result data.
		t.Fatalf("main/handler conformance: exit=%d want=%d stdout-match=%t stderr-match=%t", got.code, want.code, got.stdout == want.stdout, got.diagnostic == want.diagnostic)
	}
}

func TestOfflineMainDispatchConformance(t *testing.T) {
	forms := offlineMainForms()
	if len(forms) != 12 {
		t.Fatal("the fixed twelve supplied-CSV forms must remain covered")
	}
	for _, form := range forms {
		t.Run(form.name, func(t *testing.T) {
			path, original := offlineMainInput(t)
			args := append([]string(nil), form.tokens...)
			args[form.pathIndex] = path
			t.Run("valid", func(t *testing.T) {
				want := offlineMainTyped(form, args)
				if want.code != 0 || want.stdout == "" || want.diagnostic != "" {
					t.Fatal("owned complete input must succeed through the selected typed handler")
				}
				requireOfflineMainMatch(t, offlineMainChild(t, form.command, args), want)
			})
			t.Run("invalid-arity", func(t *testing.T) {
				short := args[:len(args)-1]
				want := offlineMainTyped(form, short)
				if want.code != 1 || want.stdout != "" || !strings.Contains(want.diagnostic, "invalid_arguments") || len(want.diagnostic) > 512 || strings.Contains(want.diagnostic, path) || strings.Contains(want.diagnostic, "OWNED.TEST") {
					t.Fatal("arity rejection must remain a fixed bounded diagnostic without operand text")
				}
				requireOfflineMainMatch(t, offlineMainChild(t, form.command, short), want)
			})
			actual, err := os.ReadFile(path)
			if err != nil || string(actual) != original {
				t.Fatal("owned supplied input bytes changed")
			}
		})
	}
}

func TestOfflineMainHelpDispatchConformance(t *testing.T) {
	seen := map[string]bool{}
	for _, form := range offlineMainForms() {
		if seen[form.command] {
			continue
		}
		seen[form.command] = true
		t.Run(form.command, func(t *testing.T) {
			body, ok := offlineDetailHelp(form.command)
			if !ok || body == "" || len(body) > offlineHelpMaxBytes {
				t.Fatal("fixed command must have admitted detail help")
			}
			requireOfflineMainMatch(t, offlineMainChild(t, form.command, []string{"--help"}), offlineMainResult{0, body, ""})
		})
	}
	if len(seen) != 11 {
		t.Fatal("eleven fixed command names must retain help precedence")
	}
}

func TestOfflineMainHelperRejectsOtherCommands(t *testing.T) {
	for _, command := range []string{"version", "OWNED_UNSUPPORTED_COMMAND"} {
		t.Run(command, func(t *testing.T) {
			requireOfflineMainMatch(t, offlineMainChild(t, command, nil), offlineMainResult{2, "", ""})
		})
	}
}
