package notify

import (
	"fmt"
	"strconv"
	"strings"
)

// DiscordWebhook represents the structure of a Discord webhook payload.
type DiscordWebhook struct {
	Content string         `json:"content,omitempty"`
	Embeds  []DiscordEmbed `json:"embeds,omitempty"`
}

// DiscordEmbed represents a rich embed within a Discord webhook.
type DiscordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	Color       int                 `json:"color,omitempty"`
	Fields      []DiscordEmbedField `json:"fields,omitempty"`
	Footer      *DiscordEmbedFooter `json:"footer,omitempty"`
}

// DiscordEmbedField represents a field within a Discord embed.
type DiscordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// DiscordEmbedFooter represents the footer of a Discord embed.
type DiscordEmbedFooter struct {
	Text string `json:"text"`
}

// TradeTelemetry holds the necessary data to format a trade execution or risk alert embed.
type TradeTelemetry struct {
	ActivePlan       string
	ConfidenceScore  float64
	ExecutionPrice   float64
	DynamicATRMarker float64
	OrderStatus      string
}

// FormatDiscordEmbed creates a DiscordWebhook payload from trade telemetry and event details.
func FormatDiscordEmbed(telemetry TradeTelemetry, eventType string, severity AlertSeverity) DiscordWebhook {
	// Map severity/eventType to Discord embed colors
	var color int

	// Default color mapping logic based on requirements
	// Green/0x00FF00 for Buy/Profit
	// Red/0xFF0000 for Stop Loss/Risk
	// Amber/0xFFA500 for Regime Swaps
	if severity == SeverityCritical {
		color = 0xFF0000 // Red
	} else if severity == SeverityWarning {
		color = 0xFFA500 // Amber
	} else {
		// Assuming INFO is green for positive actions like buy/profit
		if eventType == "BUY" || eventType == "PROFIT" {
			color = 0x00FF00 // Green
		} else {
			color = 0x808080 // Default grey for other info
		}
	}

	// A more explicit check based on the requirement wording:
	if eventType == "BUY_SIGNAL" || eventType == "PROFIT_TAKE" {
		color = 0x00FF00
	} else if eventType == "STOP_LOSS" || eventType == "RISK_LIMIT" {
		color = 0xFF0000
	} else if eventType == "REGIME_SWAP" {
		color = 0xFFA500
	}

	embed := DiscordEmbed{
		Title:       eventType,
		Description: "Gelt Trade Telemetry",
		Color:       color,
		Fields: []DiscordEmbedField{
			{
				Name:   "Active Plan",
				Value:  telemetry.ActivePlan,
				Inline: true,
			},
			{
				Name:   "Confidence",
				Value:  formatFloat(telemetry.ConfidenceScore),
				Inline: true,
			},
			{
				Name:   "Execution Price",
				Value:  formatFloat(telemetry.ExecutionPrice),
				Inline: true,
			},
			{
				Name:   "ATR Trailing Stop",
				Value:  formatFloat(telemetry.DynamicATRMarker),
				Inline: true,
			},
			{
				Name:   "Order Status",
				Value:  telemetry.OrderStatus,
				Inline: false,
			},
		},
		Footer: &DiscordEmbedFooter{
			Text: "Gelt Autonomous Trading Engine",
		},
	}

	return DiscordWebhook{
		Embeds: []DiscordEmbed{embed},
	}
}

func formatFloat(f float64) string {
	return strconv.FormatFloat(f, 'f', 2, 64)
}

// PromotionMetrics holds the empirical evaluation data for shadow-to-live promotion.
type PromotionMetrics struct {
	StrategyName string
	WinRate      float64
	ProfitFactor float64
	VaR          float64
	TradeCount   int
}

// SendPromotionAlert sends a Discord webhook containing promotion evaluation metrics.
// It does not advertise activation because no durable manual activation command exists.
func SendPromotionAlert(metrics PromotionMetrics) {
	if DefaultDispatcher == nil {
		return
	}

	embed := DiscordEmbed{
		Title:       "Strategy Promotion Candidate",
		Description: "A shadow strategy has met all auto-promotion criteria.",
		Fields: []DiscordEmbedField{
			{
				Name:   "Strategy",
				Value:  metrics.StrategyName,
				Inline: true,
			},
			{
				Name:   "Win Rate",
				Value:  formatFloat(metrics.WinRate) + "%",
				Inline: true,
			},
			{
				Name:   "Profit Factor",
				Value:  formatFloat(metrics.ProfitFactor),
				Inline: true,
			},
			{
				Name:   "Monte Carlo VaR (5%)",
				Value:  formatFloat(metrics.VaR) + "%",
				Inline: true,
			},
			{
				Name:   "Trade Count",
				Value:  strconv.Itoa(metrics.TradeCount),
				Inline: true,
			},
		},
		Footer: &DiscordEmbedFooter{
			Text: "Gelt Shadow Engine",
		},
	}

	webhook := DiscordWebhook{
		Content: "Promotion candidate recorded. No manual activation command is available; this alert does not activate trading.",
		Embeds:  []DiscordEmbed{embed},
	}

	DefaultDispatcher.DispatchDiscord(webhook, SeverityInfo, "PROMOTION_CANDIDATE")
}

// SendDemotionAlert sends a Discord webhook when a strategy is demoted due to a hard risk limit.
func SendDemotionAlert(reason string) {
	if DefaultDispatcher == nil {
		return
	}

	embed := DiscordEmbed{
		Title:       "Strategy Demotion Alert",
		Description: "A live strategy has been demoted and the kill switch activated.",
		Fields: []DiscordEmbedField{
			{
				Name:   "Reason",
				Value:  reason,
				Inline: false,
			},
		},
		Footer: &DiscordEmbedFooter{
			Text: "Gelt Risk Engine",
		},
	}

	webhook := DiscordWebhook{
		Embeds: []DiscordEmbed{embed},
	}

	DefaultDispatcher.DispatchDiscord(webhook, SeverityCritical, "STRATEGY_DEMOTION")
}

// SendTradeAlert dispatches a Discord webhook embed for trade events (BUY, CLOSE, STOP_LOSS, TARGET_PROFIT).
func SendTradeAlert(planName, symbol, side, eventType string, entryPrice, exitPrice, pnlUSD, pnlPct float64) {
	if DefaultDispatcher == nil {
		return
	}

	var color int
	if eventType == "BUY" || eventType == "BUY_SIGNAL" || pnlUSD > 0 {
		color = 0x00FF00 // Green
	} else if pnlUSD < 0 || eventType == "STOP_LOSS" || strings.Contains(strings.ToUpper(eventType), "STOP") {
		color = 0xFF0000 // Red
	} else {
		color = 0xFFA500 // Amber
	}

	fields := []DiscordEmbedField{
		{Name: "Strategy", Value: planName, Inline: true},
		{Name: "Symbol", Value: symbol, Inline: true},
		{Name: "Event", Value: eventType, Inline: true},
		{Name: "Entry Price", Value: formatFloat(entryPrice), Inline: true},
	}

	if exitPrice > 0 {
		fields = append(fields,
			DiscordEmbedField{Name: "Exit Price", Value: formatFloat(exitPrice), Inline: true},
			DiscordEmbedField{Name: "PnL", Value: fmt.Sprintf("$%.2f (%.2f%%)", pnlUSD, pnlPct), Inline: true},
		)
	}

	embed := DiscordEmbed{
		Title:       fmt.Sprintf("Trade Alert: %s %s", strings.ToUpper(side), symbol),
		Description: fmt.Sprintf("Gelt Shadow Engine %s execution", strings.ToUpper(side)),
		Color:       color,
		Fields:      fields,
		Footer:      &DiscordEmbedFooter{Text: "Gelt Shadow Engine"},
	}

	webhook := DiscordWebhook{Embeds: []DiscordEmbed{embed}}
	DefaultDispatcher.DispatchDiscord(webhook, SeverityInfo, eventType)
}
