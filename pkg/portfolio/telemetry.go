// Package portfolio provides session telemetry, account status dashboards, and risk auditing for Gelt.
package portfolio

import (
	"fmt"
	"math"
	"strings"

	"gelt/pkg/thesis"
)

// SessionTelemetry holds aggregate session metrics, PnL performance, risk exposure, and system health status.
type SessionTelemetry struct {
	AccountID       string  `json:"account_id"`
	StartingCapital float64 `json:"starting_capital"`
	AccountValue    float64 `json:"account_value"`
	CashBalance     float64 `json:"cash_balance"`
	BuyingPower     float64 `json:"buying_power"`
	RealizedPnL     float64 `json:"realized_pnl"`
	UnrealizedPnL   float64 `json:"unrealized_pnl"`
	WinCount        int     `json:"win_count"`
	LossCount       int     `json:"loss_count"`
	ActivePositions int     `json:"active_positions"`
	MaxPositions    int     `json:"max_positions"`
	DailyLossUsed   float64 `json:"daily_loss_used"`
	DailyLossCap    float64 `json:"daily_loss_cap"`
	TrailingStopPct float64 `json:"trailing_stop_pct"`
	MCPLatencyMs    int64   `json:"mcp_latency_ms"`
	JournalCount    int     `json:"journal_count"`
}

// GenerateTelemetry computes session metrics from open positions and trade journal records.
func GenerateTelemetry(
	accountID string,
	startingCapital float64,
	accountVal float64,
	cashVal float64,
	buyingPower float64,
	positions []Position,
	theses []thesis.TradeThesis,
	dailyLossCap float64,
	trailingStopPct float64,
	latencyMs int64,
) SessionTelemetry {
	var unrealized float64
	for _, pos := range positions {
		if pos.AverageBuyPrice > 0 {
			unrealized += (pos.CurrentPrice - pos.AverageBuyPrice) * pos.Quantity
		}
	}

	var realized float64
	var wins, losses int

	for _, t := range theses {
		if t.Status == "FILLED" && strings.EqualFold(t.Side, "sell") {
			pnl := (t.FillPrice - t.AmountUSD)
			realized += pnl
			if pnl >= 0 {
				wins++
			} else {
				losses++
			}
		}
	}

	dailyLossUsed := 0.0
	if realized < 0 {
		dailyLossUsed = math.Abs(realized)
	}

	return SessionTelemetry{
		AccountID:       accountID,
		StartingCapital: startingCapital,
		AccountValue:    accountVal,
		CashBalance:     cashVal,
		BuyingPower:     buyingPower,
		RealizedPnL:     realized,
		UnrealizedPnL:   unrealized,
		WinCount:        wins,
		LossCount:       losses,
		ActivePositions: len(positions),
		MaxPositions:    2,
		DailyLossUsed:   dailyLossUsed,
		DailyLossCap:    dailyLossCap,
		TrailingStopPct: trailingStopPct,
		MCPLatencyMs:    latencyMs,
		JournalCount:    len(theses),
	}
}

// FormatDashboard renders a human-readable telemetry dashboard.
func (st SessionTelemetry) FormatDashboard() string {
	winRate := 0.0
	totalTrades := st.WinCount + st.LossCount
	if totalTrades > 0 {
		winRate = (float64(st.WinCount) / float64(totalTrades)) * 100.0
	}

	realizedPct := 0.0
	if st.StartingCapital > 0 {
		realizedPct = (st.RealizedPnL / st.StartingCapital) * 100.0
	}

	dailyLossPct := 0.0
	if st.DailyLossCap > 0 {
		dailyLossPct = (st.DailyLossUsed / st.DailyLossCap) * 100.0
	}

	realizedSign := "+"
	if st.RealizedPnL < 0 {
		realizedSign = ""
	}

	unrealizedSign := "+"
	if st.UnrealizedPnL < 0 {
		unrealizedSign = ""
	}

	var sb strings.Builder
	sb.WriteString("================================================================================\n")
	sb.WriteString("  GELT SESSION TELEMETRY & PORTFOLIO DASHBOARD (v0.1.0)\n")
	sb.WriteString("================================================================================\n")
	sb.WriteString(fmt.Sprintf("  Account ID:            %s\n", st.AccountID))
	sb.WriteString(fmt.Sprintf("  Account Value:         $%.2f USD\n", st.AccountValue))
	sb.WriteString(fmt.Sprintf("  Available Cash:        $%.2f USD\n", st.CashBalance))
	sb.WriteString(fmt.Sprintf("  Buying Power:          $%.2f USD\n", st.BuyingPower))
	sb.WriteString("\n-- SESSION PERFORMANCE ---------------------------------------------------------\n")
	sb.WriteString(fmt.Sprintf("  Starting Capital:      $%.2f USD\n", st.StartingCapital))
	sb.WriteString(fmt.Sprintf("  Realized PnL:          %s$%.2f (%s%.2f%%)\n", realizedSign, st.RealizedPnL, realizedSign, realizedPct))
	sb.WriteString(fmt.Sprintf("  Unrealized PnL:        %s$%.2f\n", unrealizedSign, st.UnrealizedPnL))
	sb.WriteString(fmt.Sprintf("  Win / Loss Record:     %d Wins / %d Losses (%.1f%% Win Rate)\n", st.WinCount, st.LossCount, winRate))
	sb.WriteString("\n-- RISK & GOVERNANCE AUDIT -----------------------------------------------------\n")
	sb.WriteString(fmt.Sprintf("  Active Positions:      %d / %d Max Positions\n", st.ActivePositions, st.MaxPositions))
	sb.WriteString(fmt.Sprintf("  Daily Loss Used:       $%.2f / $%.2f Cap (%.1f%% used)\n", st.DailyLossUsed, st.DailyLossCap, dailyLossPct))
	sb.WriteString(fmt.Sprintf("  Trailing Stop Enforced: %.1f%%\n", st.TrailingStopPct))
	sb.WriteString("  Options Status:        DISABLED (Equities Only)\n")
	sb.WriteString("\n-- SYSTEM & THNEED SYNC --------------------------------------------------------\n")
	sb.WriteString(fmt.Sprintf("  Robinhood MCP:         CONNECTED (%dms round-trip)\n", st.MCPLatencyMs))
	sb.WriteString(fmt.Sprintf("  Thneed Journal:        %d Trade Rationales Logged\n", st.JournalCount))
	sb.WriteString("================================================================================\n")

	return sb.String()
}
