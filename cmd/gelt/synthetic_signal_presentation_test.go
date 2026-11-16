package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Exercise actual main dispatch in an owned child, with no user configuration.
func TestSyntheticSignalPresentationProcess(t *testing.T) {
	if os.Getenv("GELT_SYNTHETIC_PRESENTATION_HELPER") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append([]string{"gelt"}, os.Args[i+1:]...)
			main()
			os.Exit(0)
		}
	}
	os.Exit(2)
}

func syntheticPresentationChild(t *testing.T, cfg string, args ...string) string {
	t.Helper()
	home := t.TempDir()
	for _, dir := range []string{"journals", "daemon"} {
		if err := os.MkdirAll(filepath.Join(home, ".gelt", dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if cfg != "" {
		if err := os.WriteFile(filepath.Join(home, ".gelt", "config.json"), []byte(cfg), 0600); err != nil {
			t.Fatal(err)
		}
	}
	argv := append([]string{"-test.run=^TestSyntheticSignalPresentationProcess$", "--"}, args...)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], argv...)
	cmd.WaitDelay = 5 * time.Second
	cmd.Dir = home
	cmd.Env = []string{"HOME=" + home, "USERPROFILE=" + home, "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "GELT_SYNTHETIC_PRESENTATION_HELPER=1"}
	var out, diagnostic bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &diagnostic
	if err := cmd.Run(); err != nil || diagnostic.Len() != 0 {
		t.Fatalf("demo child: %v; stderr=%q", err, diagnostic.String())
	}
	if !strings.HasPrefix(out.String(), syntheticSignalDisclosure+"Gelt Synthetic ") || strings.Count(out.String(), "SYNTHETIC DEMO:") != 1 {
		t.Fatalf("missing leading provenance: %q", out.String())
	}
	if strings.Contains(out.String(), "Gelt Market Screener Results") || strings.Contains(out.String(), "Gelt Technical Signals Evaluation") {
		t.Fatalf("unqualified legacy heading: %q", out.String())
	}
	if cfg != "" {
		b, err := os.ReadFile(filepath.Join(home, ".gelt", "config.json"))
		if err != nil || string(b) != cfg {
			t.Fatalf("owned fixture changed: %v", err)
		}
	}
	return out.String()
}

func TestSyntheticSignalsLabelAndSymbolOnly(t *testing.T) {
	defaultText := syntheticPresentationChild(t, "", "signals")
	customText := syntheticPresentationChild(t, "", "signals", "demo")
	if !strings.Contains(defaultText, "Gelt Synthetic Signals Demo (SPY):\n") || !strings.Contains(customText, "Gelt Synthetic Signals Demo (DEMO):\n") {
		t.Fatal("default/custom symbol labels changed")
	}
	// A requested symbol labels the same generated closes; it does not fetch
	// that symbol's market prices or change the generated indicator values.
	if strings.Replace(customText, "(DEMO):", "(SPY):", 1) != defaultText {
		t.Fatal("symbol-only selection changed generated calculations")
	}
}

func TestSyntheticScanConfiguredAndEmptyResults(t *testing.T) {
	const cfg = `{"screener_universe":["DEMO"],"synthetic_price_map":{"DEMO":123}}`
	text := syntheticPresentationChild(t, cfg, "scan")
	if !strings.Contains(text, "Gelt Synthetic Screener Demo (1 tickers scanned, min score: 0.0):\n") || !strings.Contains(text, "DEMO    ") {
		t.Fatal("configured demo universe was not retained")
	}
	text = syntheticPresentationChild(t, cfg, "scan", "101")
	if !strings.Contains(text, "min score: 101.0") || strings.Contains(text, "DEMO    ") || !strings.Contains(text, "Score (0-100)") {
		t.Fatal("empty scan must retain provenance and columns without a data row")
	}
}

func TestSyntheticSignalGenericHelpLabels(t *testing.T) {
	text := globalHelp(Version)
	for _, line := range []string{
		"signals [SYMBOL]                     Show indicators and scores from generated demo closes\n",
		"scan [MIN_SCORE]                     Rank generated demo series using watchlist declarations\n",
	} {
		if !strings.Contains(text, line) {
			t.Fatalf("missing generated-demo discovery: %q", line)
		}
	}
}
