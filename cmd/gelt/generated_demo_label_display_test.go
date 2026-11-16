package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestRenderGeneratedDemoLabel(t *testing.T) {
	unsafeControls := "\n\r\x1b\x7f\"|()\\"
	invalidUTF8 := string([]byte{0xff, 0x00})
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty uses fixed fallback", input: "", want: "label_unavailable"},
		{name: "safe ASCII is unchanged", input: "AbC09._:/-", want: "AbC09._:/-"},
		{name: "64 bytes are accepted", input: strings.Repeat("A", 64), want: strings.Repeat("A", 64)},
		{name: "65 bytes use fallback without truncation", input: strings.Repeat("A", 65), want: "label_unavailable"},
		{name: "controls and delimiters are byte escaped", input: unsafeControls, want: `\x0a\x0d\x1b\x7f\x22\x7c\x28\x29\x5c`},
		{name: "UTF-8 bytes are escaped individually", input: "é", want: `\xc3\xa9`},
		{name: "invalid UTF-8 and NUL are escaped", input: invalidUTF8, want: `\xff\x00`},
		{name: "all escaped output remains within 256 bytes", input: strings.Repeat("\x00", 64), want: strings.Repeat(`\x00`, 64)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := renderGeneratedDemoLabel(tt.input)
			if got != tt.want {
				t.Fatalf("renderGeneratedDemoLabel(%q) = %q, want %q", tt.input, got, tt.want)
			}
			if len(got) > 256 {
				t.Fatalf("rendered label exceeds bound: %d bytes", len(got))
			}
			if again := renderGeneratedDemoLabel(tt.input); again != got {
				t.Fatalf("rendering is not deterministic: %q then %q", got, again)
			}
		})
	}
}

func TestSyntheticSignalsEscapesDisplayedLabelOnly(t *testing.T) {
	baseline := syntheticPresentationChild(t, "", "signals", "acme")
	maliciousLabel := "acme\nINJECT|HEADER\x1b"
	got := syntheticPresentationChild(t, "", "signals", maliciousLabel)
	const rendered = `ACME\x0aINJECT\x7cHEADER\x1b`
	if !strings.Contains(got, "Gelt Synthetic Signals Demo ("+rendered+"):\n") {
		t.Fatalf("escaped label missing from success heading: %q", got)
	}
	if strings.ContainsAny(got, "\x00\x1b\r") || strings.Contains(got, "INJECT|HEADER") {
		t.Fatalf("raw control or delimiter-bearing label reached output: %q", got)
	}
	if strings.Count(got, "\n") != strings.Count(baseline, "\n") {
		t.Fatalf("label added a physical output line: baseline=%q output=%q", baseline, got)
	}
	if normalized := strings.Replace(got, rendered, "ACME", 1); normalized != baseline {
		t.Fatalf("symbol-only input changed demo calculations or other output:\nbase=%q\ngot =%q", baseline, normalized)
	}
}

func syntheticScanConfig(t *testing.T, symbol string) string {
	t.Helper()
	cfg := struct {
		ScreenerUniverse  []string           `json:"screener_universe"`
		SyntheticPriceMap map[string]float64 `json:"synthetic_price_map"`
	}{
		ScreenerUniverse:  []string{symbol},
		SyntheticPriceMap: map[string]float64{symbol: 123},
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal isolated synthetic config: %v", err)
	}
	return string(b)
}

func TestSyntheticScanEscapesDisplayedLabelOnly(t *testing.T) {
	baseline := syntheticPresentationChild(t, syntheticScanConfig(t, "ACME"), "scan")
	maliciousLabel := "ACME\nINJECT|ROW\x1b"
	got := syntheticPresentationChild(t, syntheticScanConfig(t, maliciousLabel), "scan")
	const rendered = `ACME\x0aINJECT\x7cROW\x1b`
	if !strings.Contains(got, rendered) {
		t.Fatalf("escaped label missing from scan row: %q", got)
	}
	if strings.ContainsAny(got, "\x00\x1b\r") || strings.Contains(got, "INJECT|ROW") {
		t.Fatalf("raw control or table delimiter reached output: %q", got)
	}
	if strings.Count(got, "\n") != strings.Count(baseline, "\n") {
		t.Fatalf("label added a physical table row: baseline=%q output=%q", baseline, got)
	}
	if normalized := strings.Replace(got, rendered, fmt.Sprintf("%-8s", "ACME"), 1); normalized != baseline {
		t.Fatalf("symbol-only input changed demo calculations or other output:\nbase=%q\ngot =%q", baseline, normalized)
	}
}
