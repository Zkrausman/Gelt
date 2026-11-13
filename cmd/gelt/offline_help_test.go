package main

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
	"unicode/utf8"
)

var offlineHelpTopics = []struct {
	name, usage, target, profile string
}{
	{"backtest-causal", causalCLIUsage, "BreakoutVol", "20-close warmup"},
	{"backtest-causal-funded", fundedCLIUsage, "BreakoutVol", "20-close warmup"},
	{"backtest-causal-fees", feeScenarioCLIUsage, "BreakoutVol", "20-close warmup"},
	{"backtest-causal-execution", executionScenarioCLIUsage, "BreakoutVol", "20-close warmup"},
	{"backtest-causal-compare", comparisonCLIUsage, "BreakoutVol", "20-close warmup"},
	{"backtest-causal-window-compare", windowCLIUsage, "BreakoutVol", "20-close warmup"},
	{"backtest-causal-trend50-compare", trend50CLIUsage, "TrendConfluence", "50-close profile"},
	{"backtest-causal-trend50-window-compare", trend50WindowCLIUsage, "TrendConfluence", "50-close profile"},
	{"backtest-causal-meanrev-compare", mean20CLIUsage, "MeanReversion", "20-close warmup"},
}

func TestOfflineHelpAliasesAndUsage(t *testing.T) {
	for _, topic := range offlineHelpTopics {
		t.Run(topic.name, func(t *testing.T) {
			want, ok := offlineDetailHelp(topic.name)
			if !ok || !strings.HasPrefix(want, topic.usage+"\n") || strings.Count(want, topic.usage) != 1 {
				t.Fatal("detail must directly retain the exact existing usage")
			}
			for _, note := range []string{topic.target, topic.profile, "Purpose:", "Timestamp,Open,High,Low,Close,Volume", "unestablished"} {
				if !strings.Contains(want, note) {
					t.Errorf("missing detail note %q", note)
				}
			}
			for _, args := range [][]string{
				{"help", topic.name}, {"--help", topic.name}, {"-h", topic.name},
				{topic.name, "--help"}, {topic.name, "-h"},
			} {
				var out, diagnostic bytes.Buffer
				handled, code := runOfflineHelp(args, &out, &diagnostic)
				if !handled || code != 0 || out.String() != want || diagnostic.Len() != 0 {
					t.Errorf("alias %q: handled=%t code=%d output equality=%t stderr=%q", args, handled, code, out.String() == want, diagnostic.String())
				}
			}
		})
	}
}

func TestOfflineHelpGlobalAndChooser(t *testing.T) {
	for _, prefix := range []string{"help", "--help", "-h"} {
		for _, topic := range []string{"", "offline"} {
			args := []string{prefix}
			want := globalHelp(Version)
			if topic != "" {
				args = append(args, topic)
				want = offlineChooserHelp
			}
			var out, diagnostic bytes.Buffer
			if handled, code := runOfflineHelp(args, &out, &diagnostic); !handled || code != 0 || out.String() != want || diagnostic.Len() != 0 {
				t.Fatalf("alias %q differs", args)
			}
			counts := map[string]int{}
			catalogue := strings.SplitN(strings.SplitN(out.String(), "Supplied-CSV offline commands:\n", 2)[1], "\n\n", 2)[0]
			for _, line := range strings.Split(catalogue, "\n") {
				if fields := strings.Fields(line); len(fields) > 0 {
					counts[fields[0]]++
				}
			}
			for _, command := range offlineHelpTopics {
				if counts[command.name] != 1 {
					t.Errorf("catalogue occurrence of %s = %d", command.name, counts[command.name])
				}
			}
		}
	}
	global := globalHelp("owned-test-version")
	for _, text := range []string{"(owned-test-version)", "gelt help offline", "gelt help NAME", "Other commands:", "dashboard / serve", "buy <SYMBOL>", "[DataFile.csv | Days]", "CSV/generated-synthetic diagnostic"} {
		if !strings.Contains(global, text) {
			t.Errorf("global help missing %q", text)
		}
	}
	for _, text := range []string{
		"BreakoutVol: backtest-causal-compare", "backtest-causal-window-compare for a selected period",
		"TrendConfluence: backtest-causal-trend50-compare", "backtest-causal-trend50-window-compare for a selected period",
		"MeanReversion: backtest-causal-meanrev-compare", "append --window START END",
		"Fixed 20-close warmup; first evaluation index 19; first eligible fill index 20",
		"Fixed 50-close warmup; first evaluation index 49; first eligible fill index 50",
		"zero-based", "Reference/funded/fees/execution", "flat cash and one",
	} {
		if !strings.Contains(offlineChooserHelp, text) {
			t.Errorf("chooser missing %q", text)
		}
	}
}

func TestOfflineHelpInputCostWindowAndLimitNotes(t *testing.T) {
	for _, text := range []string{
		"Timestamp,Open,High,Low,Close,Volume", "strictly increasing Unix-second", "1..253402300799",
		"canonical unsigned ASCII", "leading-zero integer", "quoting, BOM, whitespace, signs or exponents", "LF and CRLF",
		"1 MiB (1048576 bytes), 10000 rows, 32 bytes", "0.01..1000000", "Low <= Open/Close <= High", "0..1e12", "float64",
		"fixed8 (up to 8 decimal places) in 0..1000000", "fixed8 in 0..<10", "fee bps 0..10000", "adverse bps 0..9999",
		"entry cap is 10 inclusive of entry fee", "No cash resizing, loan", "forced terminal sell or SELL cost without a SELL",
		"uncalibrated assumptions", "START is inclusive; END is exclusive", "exact supplied timestamps",
		"complete source's last timestamp plus one second", "not the\n  next cadence interval", "nonempty score interval", "20 or 50 preceding warmup rows",
		"including excluded\n  rows, are validated", "Finite-prefix strategy reseeding", "RSI/EMA memory",
		"Supplied-data authenticity", "adequate/converged history", "cadence/session", "statistical edge", "profitability", "operating admission",
	} {
		if !strings.Contains(offlineInputHelp, text) {
			t.Errorf("common notes missing %q", text)
		}
	}
	for _, name := range []string{"backtest-causal-window-compare", "backtest-causal-trend50-window-compare"} {
		body, _ := offlineDetailHelp(name)
		if !strings.Contains(body, "START/END precede cash and cost declarations") {
			t.Errorf("missing argument order note for %s", name)
		}
	}
	body, _ := offlineDetailHelp("backtest-causal-meanrev-compare")
	if !strings.Contains(body, "Append --window START END after the cost declarations") {
		t.Fatal("missing MeanReversion argument order note")
	}
}

func TestOfflineHelpClosedTopics(t *testing.T) {
	for _, prefix := range []string{"help", "--help", "-h"} {
		for _, topic := range []string{"buy", "dashboard", "backtest", "version", "HELP", "--help", "unknown-\xff-private\ncanary"} {
			var out, diagnostic bytes.Buffer
			handled, code := runOfflineHelp([]string{prefix, topic}, &out, &diagnostic)
			if !handled || code != 1 || out.Len() != 0 || diagnostic.String() != "gelt help: unsupported_topic\n" {
				t.Errorf("unknown topic under %q must reject with fixed diagnostic", prefix)
			}
		}
		for _, topics := range [][]string{{"offline", "EXTRA"}, {"buy", "EXTRA"}, {"backtest-causal", "--help"}, {"offline", "", ""}} {
			var out, diagnostic bytes.Buffer
			handled, code := runOfflineHelp(append([]string{prefix}, topics...), &out, &diagnostic)
			if !handled || code != 1 || out.Len() != 0 || diagnostic.String() != "gelt help: invalid_arguments\n" {
				t.Errorf("extra topics under %q must reject with fixed diagnostic", prefix)
			}
		}
	}
}

func TestOfflineHelpLeavesOtherGrammarToDispatch(t *testing.T) {
	cases := [][]string{nil, {}, {"version"}, {"version", "--help"}, {"buy", "--help"}, {"dashboard", "-h"}, {"backtest", "--help"}, {"offline"}, {"unknown", "--help"}}
	for _, topic := range offlineHelpTopics {
		cases = append(cases,
			[]string{topic.name}, []string{topic.name, "help"},
			[]string{topic.name, "--help", "EXTRA"}, []string{topic.name, "-h", "EXTRA"},
			[]string{topic.name, "BreakoutVol", "SYMBOL", "--help"},
			[]string{topic.name, "--help", "SYMBOL", "data.csv", "100", "0", "0", "0", "0"},
			[]string{topic.name, "unsupported", "-h", "data.csv", "100", "0", "0", "0", "0"},
			[]string{topic.name, topic.target, "SYMBOL", "data.csv", "100", "0", "0", "0", "0"},
		)
	}
	cases = append(cases,
		[]string{"backtest-causal-meanrev-compare", "MeanReversion", "SYMBOL", "--help", "100", "0", "0", "0", "0"},
		[]string{"backtest-causal-meanrev-compare", "MeanReversion", "SYMBOL", "data.csv", "100", "0", "0", "0", "0", "--window", "1700001200", "1700003001"},
		[]string{"backtest-causal-window-compare", "BreakoutVol", "SYMBOL", "data.csv", "1700001200", "1700003001", "100", "0", "0", "0", "0"},
		[]string{"backtest-causal-trend50-window-compare", "TrendConfluence", "SYMBOL", "data.csv", "1700003000", "1700003001", "100", "0", "0", "0", "0"},
	)
	for _, args := range cases {
		var out, diagnostic bytes.Buffer
		if handled, code := runOfflineHelp(args, &out, &diagnostic); handled || code != 0 || out.Len() != 0 || diagnostic.Len() != 0 {
			t.Errorf("non-help invocation claimed: %q", args)
		}
	}
}

type offlineHelpWriter struct {
	calls int
	body  []byte
	n     int
	err   error
}

func (w *offlineHelpWriter) Write(p []byte) (int, error) {
	w.calls++
	w.body = append(w.body, p...)
	return w.n, w.err
}

func TestOfflineHelpOutputBounds(t *testing.T) {
	bodies := []string{globalHelp(Version), offlineChooserHelp}
	for _, topic := range offlineHelpTopics {
		body, _ := offlineDetailHelp(topic.name)
		bodies = append(bodies, body)
	}
	bodies = append(bodies, strings.Repeat("x", offlineHelpMaxBytes), strings.Repeat("é", offlineHelpMaxBytes/2))
	for i, body := range bodies {
		if len(body) == 0 || len(body) > offlineHelpMaxBytes || !utf8.ValidString(body) {
			t.Fatalf("rendered body %d violates output bound: %d bytes", i, len(body))
		}
		out := &offlineHelpWriter{n: len(body)}
		diagnostic := &offlineHelpWriter{}
		if code := writeOfflineHelp(body, out, diagnostic); code != 0 || out.calls != 1 || string(out.body) != body || diagnostic.calls != 0 {
			t.Errorf("body %d: expected exactly one successful stdout attempt", i)
		}
	}
	for _, body := range []string{"", "bad\xffUTF8", strings.Repeat("x", offlineHelpMaxBytes+1), strings.Repeat("é", offlineHelpMaxBytes/2) + "x", globalHelp(strings.Repeat("v", offlineHelpMaxBytes)), globalHelp("\xff")} {
		out := &offlineHelpWriter{}
		diagnostic := &offlineHelpWriter{}
		if code := writeOfflineHelp(body, out, diagnostic); code != 1 || out.calls != 0 || diagnostic.calls != 1 || string(diagnostic.body) != "gelt help: invalid_output\n" {
			t.Fatal("invalid output must fail before stdout with one fixed diagnostic attempt")
		}
	}
}

func TestOfflineHelpOutputFailuresDoNotRetry(t *testing.T) {
	body := "valid help\n"
	for _, tc := range []struct {
		name string
		out  *offlineHelpWriter
	}{
		{"short", &offlineHelpWriter{n: len(body) - 1}},
		{"zero", &offlineHelpWriter{}},
		{"error", &offlineHelpWriter{err: errors.New("private writer error")}},
		{"partial error", &offlineHelpWriter{n: 3, err: io.ErrClosedPipe}},
		{"full error", &offlineHelpWriter{n: len(body), err: io.ErrShortWrite}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			diagnostic := &offlineHelpWriter{}
			if code := writeOfflineHelp(body, tc.out, diagnostic); code != 1 || tc.out.calls != 1 || diagnostic.calls != 1 || string(diagnostic.body) != "gelt help: output_error\n" {
				t.Fatal("failed output must not retry or expose writer error")
			}
		})
	}
	var diagnostic bytes.Buffer
	if code := writeOfflineHelp(body, nil, &diagnostic); code != 1 || diagnostic.String() != "gelt help: output_error\n" {
		t.Fatal("nil stdout must fail with fixed diagnostic")
	}
	for _, stderr := range []io.Writer{nil, &offlineHelpWriter{}, &offlineHelpWriter{n: 2, err: io.ErrClosedPipe}} {
		if code := writeOfflineHelp(body, nil, stderr); code != 1 {
			t.Fatal("stderr failure must preserve failure exit")
		}
		if w, ok := stderr.(*offlineHelpWriter); ok && w.calls != 1 {
			t.Fatal("stderr must not retry")
		}
	}
	for _, args := range [][]string{{"help", "buy"}, {"help", "offline", "EXTRA"}} {
		diagnostic := &offlineHelpWriter{err: errors.New("private stderr failure")}
		if handled, code := runOfflineHelp(args, nil, diagnostic); !handled || code != 1 || diagnostic.calls != 1 {
			t.Fatal("grammar errors must make only one stderr attempt")
		}
	}
}
