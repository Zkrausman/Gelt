package thesis

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFormatSelfDoc(t *testing.T) {
	thesis := TradeThesis{
		ID:              "test-123",
		Symbol:          "DEMO",
		Side:            "buy",
		AmountUSD:       10.0,
		ConfluenceScore: 85.0,
		Bias:            "BULLISH",
		Signals:         []string{"RSI Oversold", "20 EMA > 50 EMA"},
		Catalyst:        "Market hours momentum test",
		StopLossPct:     3.0,
		TargetProfitPct: 6.0,
		OrderID:         "order-test-001",
		FillPrice:       500.0,
		Quantity:        0.02,
		Status:          "FILLED",
		Timestamp:       time.Now(),
	}

	rationale, evidence := thesis.FormatSelfDoc()

	if !strings.Contains(rationale, "[bd-3qwe self-doc] RATIONALE") {
		t.Errorf("Rationale missing header anchor")
	}
	if !strings.Contains(rationale, "BUY trade for DEMO") {
		t.Errorf("Rationale missing trade details")
	}
	if !strings.Contains(evidence, "[bd-3qwe self-doc] EVIDENCE") {
		t.Errorf("Evidence missing header anchor")
	}
	if !strings.Contains(evidence, "order-test-001") {
		t.Errorf("Evidence missing order ID")
	}
}

func TestSaveAndLoadJournal(t *testing.T) {
	tmpDir := t.TempDir()
	journalPath := filepath.Join(tmpDir, "journal.json")

	entry := TradeThesis{
		ID:              "trade-1",
		Symbol:          "DEMO",
		Side:            "buy",
		AmountUSD:       5.0,
		ConfluenceScore: 70.0,
		Bias:            "BULLISH",
		Status:          "FILLED",
		Timestamp:       time.Now(),
	}

	if err := SaveJournalEntry(journalPath, entry); err != nil {
		t.Fatalf("SaveJournalEntry failed: %v", err)
	}

	loaded, err := LoadJournal(journalPath)
	if err != nil {
		t.Fatalf("LoadJournal failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 journal entry, got %d", len(loaded))
	}

	if loaded[0].Symbol != "DEMO" {
		t.Errorf("Expected DEMO symbol, got %s", loaded[0].Symbol)
	}
}

func TestShadowTelemetrySelfDoc(t *testing.T) {
	record := ShadowTelemetryRecord{
		PlanName:     "SyntheticRangePlan",
		Mode:         "SHADOW",
		TotalTrades:  12,
		WinRate:      75.0,
		NetPnLUSD:    4.50,
		ProfitFactor: 3.20,
		AvgWin:       0.60,
		AvgLoss:      0.20,
		MaxDrawdown:  0.40,
		Timestamp:    time.Now(),
	}

	rationale, evidence := record.FormatShadowSelfDoc()

	if !strings.Contains(rationale, "[bd-3qwe self-doc] RATIONALE") {
		t.Errorf("Rationale missing header anchor")
	}
	if !strings.Contains(rationale, `plan "SyntheticRangePlan"`) {
		t.Errorf("Rationale missing plan name")
	}
	if !strings.Contains(evidence, "[bd-3qwe self-doc] EVIDENCE") {
		t.Errorf("Evidence missing header anchor")
	}
	if !strings.Contains(evidence, "Net PnL $4.50") {
		t.Errorf("Evidence missing Net PnL details")
	}

	tmpDir := t.TempDir()
	if err := SyncShadowTelemetry(tmpDir, record); err != nil {
		t.Fatalf("SyncShadowTelemetry failed: %v", err)
	}

	targetFile := filepath.Join(tmpDir, "shadow_telemetry_intradayalphaplan.md")
	if _, err := os.Stat(targetFile); err != nil {
		t.Fatalf("expected telemetry file at %s, got error: %v", targetFile, err)
	}
}

func TestSyncShadowTelemetryUsesConfiguredPath(t *testing.T) {
	targetDir := t.TempDir()
	t.Setenv("GELT_BEADS_BRAIN_PATH", targetDir)
	record := ShadowTelemetryRecord{PlanName: "SyntheticRangePlan", Mode: "SHADOW", Timestamp: time.Now()}
	if err := SyncShadowTelemetry("", record); err != nil {
		t.Fatalf("SyncShadowTelemetry failed with configured local path: %v", err)
	}
	path := filepath.Join(targetDir, "shadow_telemetry_syntheticrangeplan.md")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected synthetic telemetry file: %v", err)
	}
}

func TestSyncShadowTelemetryRequiresConfiguredPath(t *testing.T) {
	t.Setenv("GELT_BEADS_BRAIN_PATH", "")
	record := ShadowTelemetryRecord{PlanName: "SyntheticRangePlan", Mode: "SHADOW", Timestamp: time.Now()}
	if err := SyncShadowTelemetry("", record); err == nil {
		t.Fatal("expected an explicit unconfigured-path error")
	}
}
