// Package thesis provides structured trade thesis generation, local journal storage, and Thneed/Beads brain synchronization for Gelt.
package thesis

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// TradeThesis captures the complete decision context, technical signals, risk guardrails, and execution evidence for a trade.
type TradeThesis struct {
	ID              string    `json:"id"`
	Symbol          string    `json:"symbol"`
	Side            string    `json:"side"` // "buy" or "sell"
	AmountUSD       float64   `json:"amount_usd"`
	ConfluenceScore float64   `json:"confluence_score"`
	Bias            string    `json:"bias"`
	Signals         []string  `json:"signals"`
	Catalyst        string    `json:"catalyst"`
	ModelUsed       string    `json:"model_used,omitempty"`
	StopLossPct     float64   `json:"stop_loss_pct"`
	TargetProfitPct float64   `json:"target_profit_pct"`
	OrderID         string    `json:"order_id,omitempty"`
	FillPrice       float64   `json:"fill_price,omitempty"`
	Quantity        float64   `json:"quantity,omitempty"`
	Status          string    `json:"status"` // "SUBMITTED", "FILLED", "CANCELLED", "REJECTED"
	Timestamp       time.Time `json:"timestamp"`
}

// Journal holds a sequence of logged trade theses.
type Journal struct {
	Theses []TradeThesis `json:"theses"`
}

// FormatSelfDoc returns Thneed-compliant Rationale and Evidence string blocks for a trade thesis.
func (t TradeThesis) FormatSelfDoc() (rationale string, evidence string) {
	signalsStr := strings.Join(t.Signals, ", ")
	if signalsStr == "" {
		signalsStr = "None specified"
	}
	modelStr := t.ModelUsed
	if modelStr == "" {
		modelStr = "n/a"
	}

	rationale = fmt.Sprintf(`[bd-3qwe self-doc] RATIONALE
- Problem Context: Execute %s trade for %s ($%.2f notional).
- Catalyst & Confluence: Confluence Score %.1f/100 (%s Bias). Active signals: %s. Model Used: %s. Catalyst: %s.
- Scope & Risk: Mandatory Stop-Loss set at %.1f%% below entry. Target profit set at +%.1f%%.`,
		strings.ToUpper(t.Side), t.Symbol, t.AmountUSD,
		t.ConfluenceScore, t.Bias, signalsStr, modelStr, t.Catalyst,
		t.StopLossPct, t.TargetProfitPct,
	)

	evidence = fmt.Sprintf(`[bd-3qwe self-doc] EVIDENCE
- Order ID: %s
- Fill Details: Price $%.2f | Quantity %.6f shares | Status: %s
- Timestamp: %s`,
		t.OrderID, t.FillPrice, t.Quantity, t.Status,
		t.Timestamp.Format(time.RFC3339),
	)

	return rationale, evidence
}

// SaveJournalEntry appends a TradeThesis record to the local JSON journal file.
func SaveJournalEntry(journalPath string, t TradeThesis) error {
	dir := filepath.Dir(journalPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create journal directory: %w", err)
	}

	var journal Journal
	if data, err := os.ReadFile(journalPath); err == nil {
		_ = json.Unmarshal(data, &journal)
	}

	journal.Theses = append(journal.Theses, t)

	data, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal journal: %w", err)
	}

	return os.WriteFile(journalPath, data, 0644)
}

// LoadJournal reads all logged TradeThesis records from the local JSON journal file.
func LoadJournal(journalPath string) ([]TradeThesis, error) {
	data, err := os.ReadFile(journalPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []TradeThesis{}, nil
		}
		return nil, fmt.Errorf("failed to read journal file: %w", err)
	}

	var journal Journal
	if err := json.Unmarshal(data, &journal); err != nil {
		return nil, fmt.Errorf("failed to unmarshal journal JSON: %w", err)
	}

	return journal.Theses, nil
}

// ShadowTelemetryRecord captures shadow trading performance stats for Thneed brain self-documentation.
type ShadowTelemetryRecord struct {
	PlanName     string    `json:"plan_name"`
	Mode         string    `json:"mode"` // "LIVE" or "SHADOW"
	TotalTrades  int       `json:"total_trades"`
	WinRate      float64   `json:"win_rate"`
	NetPnLUSD    float64   `json:"net_pnl_usd"`
	ProfitFactor float64   `json:"profit_factor"`
	AvgWin       float64   `json:"avg_win"`
	AvgLoss      float64   `json:"avg_loss"`
	MaxDrawdown  float64   `json:"max_drawdown"`
	Timestamp    time.Time `json:"timestamp"`
}

// FormatShadowSelfDoc returns Thneed-compliant Rationale and Evidence string blocks for shadow engine telemetry.
func (s ShadowTelemetryRecord) FormatShadowSelfDoc() (rationale string, evidence string) {
	pfStr := fmt.Sprintf("%.2f", s.ProfitFactor)
	if math.IsInf(s.ProfitFactor, 0) {
		pfStr = "INF"
	}

	rationale = fmt.Sprintf(`[bd-3qwe self-doc] RATIONALE
- Plan Context: Shadow engine forward-test telemetry for plan %q (%s mode).
- Scope Boundary: Statistical evaluation across %d paper trades with Win Rate %.1f%%.
- Performance Goals: Track virtual PnL delta ($%.2f), Profit Factor %s, and Risk Drawdown limit ($%.2f).`,
		s.PlanName, s.Mode, s.TotalTrades, s.WinRate, s.NetPnLUSD, pfStr, s.MaxDrawdown,
	)

	evidence = fmt.Sprintf(`[bd-3qwe self-doc] EVIDENCE
- Telemetry Metrics: Net PnL $%.2f | Profit Factor %s | Avg Win $%.2f | Avg Loss $%.2f | Max DD $%.2f
- Trade Counts: Total %d trades | Win Rate %.1f%%
- Target Sync: GELT_BEADS_BRAIN_PATH (local path value omitted)
- Timestamp: %s`,
		s.NetPnLUSD, pfStr, s.AvgWin, s.AvgLoss, s.MaxDrawdown,
		s.TotalTrades, s.WinRate,
		s.Timestamp.Format(time.RFC3339),
	)

	return rationale, evidence
}

// SyncShadowTelemetry writes Thneed-formatted shadow telemetry records to the central beads brain target directory.
func SyncShadowTelemetry(targetDir string, record ShadowTelemetryRecord) error {
	if targetDir == "" {
		targetDir = strings.TrimSpace(os.Getenv("GELT_BEADS_BRAIN_PATH"))
	}
	if targetDir == "" {
		return fmt.Errorf("cannot sync shadow telemetry: GELT_BEADS_BRAIN_PATH is not configured")
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("failed to create target directory %s: %w", targetDir, err)
	}

	rationale, evidence := record.FormatShadowSelfDoc()
	content := fmt.Sprintf("# Shadow Telemetry: %s\n\n%s\n\n%s\n", record.PlanName, rationale, evidence)

	fileName := fmt.Sprintf("shadow_telemetry_%s.md", strings.ToLower(record.PlanName))
	filePath := filepath.Join(targetDir, fileName)

	return os.WriteFile(filePath, []byte(content), 0644)
}
