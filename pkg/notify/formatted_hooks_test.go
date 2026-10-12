package notify

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFormatDiscordEmbed(t *testing.T) {
	telemetry := TradeTelemetry{
		ActivePlan:       "AlphaPlan",
		ConfidenceScore:  85.5,
		ExecutionPrice:   150.25,
		DynamicATRMarker: 148.00,
		OrderStatus:      "FILLED",
	}

	tests := []struct {
		name      string
		eventType string
		severity  AlertSeverity
		expected  int
	}{
		{
			name:      "Buy Signal - Green",
			eventType: "BUY_SIGNAL",
			severity:  SeverityInfo,
			expected:  0x00FF00,
		},
		{
			name:      "Profit Take - Green",
			eventType: "PROFIT_TAKE",
			severity:  SeverityInfo,
			expected:  0x00FF00,
		},
		{
			name:      "Stop Loss - Red",
			eventType: "STOP_LOSS",
			severity:  SeverityCritical,
			expected:  0xFF0000,
		},
		{
			name:      "Risk Limit - Red",
			eventType: "RISK_LIMIT",
			severity:  SeverityCritical,
			expected:  0xFF0000,
		},
		{
			name:      "Regime Swap - Amber",
			eventType: "REGIME_SWAP",
			severity:  SeverityWarning,
			expected:  0xFFA500,
		},
		{
			name:      "Generic Critical - Red",
			eventType: "GENERIC_ERROR",
			severity:  SeverityCritical,
			expected:  0xFF0000,
		},
		{
			name:      "Generic Warning - Amber",
			eventType: "GENERIC_WARN",
			severity:  SeverityWarning,
			expected:  0xFFA500,
		},
		{
			name:      "Generic Info - Grey",
			eventType: "GENERIC_INFO",
			severity:  SeverityInfo,
			expected:  0x808080, // Using the default from FormatDiscordEmbed
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			webhook := FormatDiscordEmbed(telemetry, tt.eventType, tt.severity)

			if len(webhook.Embeds) != 1 {
				t.Fatalf("Expected 1 embed, got %d", len(webhook.Embeds))
			}

			embed := webhook.Embeds[0]

			if embed.Color != tt.expected {
				t.Errorf("Expected color %d, got %d", tt.expected, embed.Color)
			}

			if embed.Title != tt.eventType {
				t.Errorf("Expected title %s, got %s", tt.eventType, embed.Title)
			}

			// Verify fields are present
			if len(embed.Fields) != 5 {
				t.Errorf("Expected 5 fields, got %d", len(embed.Fields))
			}

			// Verify one of the fields values
			found := false
			for _, f := range embed.Fields {
				if f.Name == "Active Plan" && f.Value == "AlphaPlan" {
					found = true
				}
			}
			if !found {
				t.Errorf("Expected to find Active Plan field with value AlphaPlan")
			}
		})
	}
}

func TestDiscordWebhookMarshaling(t *testing.T) {
	telemetry := TradeTelemetry{
		ActivePlan:       "AlphaPlan",
		ConfidenceScore:  85.5,
		ExecutionPrice:   150.25,
		DynamicATRMarker: 148.00,
		OrderStatus:      "FILLED",
	}

	webhook := FormatDiscordEmbed(telemetry, "BUY_SIGNAL", SeverityInfo)

	jsonData, err := json.Marshal(webhook)
	if err != nil {
		t.Fatalf("Failed to marshal webhook: %v", err)
	}

	var unmarshaled DiscordWebhook
	if err := json.Unmarshal(jsonData, &unmarshaled); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if len(unmarshaled.Embeds) != 1 {
		t.Fatalf("Expected 1 embed after unmarshaling, got %d", len(unmarshaled.Embeds))
	}

	embed := unmarshaled.Embeds[0]
	if embed.Color != 0x00FF00 {
		t.Errorf("Expected color 0x00FF00 after unmarshaling, got %d", embed.Color)
	}
}

func TestSendPromotionAlert(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)

	var receivedWebhook DiscordWebhook
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		_ = json.Unmarshal(body, &receivedWebhook)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		wg.Done()
	}))
	defer server.Close()

	originalEndpoint := DefaultDispatcher.endpoint
	DefaultDispatcher.SetEndpoint(server.URL)
	defer DefaultDispatcher.SetEndpoint(originalEndpoint)

	metrics := PromotionMetrics{
		StrategyName: "MomentumRebound",
		WinRate:      68.5,
		ProfitFactor: 1.8,
		VaR:          3.2,
		TradeCount:   15,
	}

	SendPromotionAlert(metrics)

	c := make(chan struct{})
	go func() {
		wg.Wait()
		close(c)
	}()

	select {
	case <-c:
	case <-time.After(3 * time.Second):
		t.Fatal("Timeout waiting for webhook dispatch")
	}

	mu.Lock()
	discordWebhook := receivedWebhook
	mu.Unlock()

	if strings.Contains(discordWebhook.Content, "plan promote") {
		t.Errorf("Promotion alert advertised unavailable command: %s", discordWebhook.Content)
	}
	if !strings.Contains(discordWebhook.Content, "No manual activation command is available") {
		t.Errorf("Promotion alert did not disclose unavailable activation: %s", discordWebhook.Content)
	}

	if len(discordWebhook.Embeds) != 1 {
		t.Fatalf("Expected 1 embed, got %d", len(discordWebhook.Embeds))
	}

	embed := discordWebhook.Embeds[0]
	if len(embed.Fields) != 5 {
		t.Errorf("Expected 5 fields in embed, got %d", len(embed.Fields))
	}
}

func TestSendDemotionAlert(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)

	var receivedWebhook DiscordWebhook
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		_ = json.Unmarshal(body, &receivedWebhook)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		wg.Done()
	}))
	defer server.Close()

	originalEndpoint := DefaultDispatcher.endpoint
	DefaultDispatcher.SetEndpoint(server.URL)
	defer DefaultDispatcher.SetEndpoint(originalEndpoint)

	SendDemotionAlert("Intraday drawdown exceeded -1.5%")

	c := make(chan struct{})
	go func() {
		wg.Wait()
		close(c)
	}()

	select {
	case <-c:
	case <-time.After(3 * time.Second):
		t.Fatal("Timeout waiting for webhook dispatch")
	}

	mu.Lock()
	discordWebhook := receivedWebhook
	mu.Unlock()

	if len(discordWebhook.Embeds) != 1 {
		t.Fatalf("Expected 1 embed, got %d", len(discordWebhook.Embeds))
	}

	embed := discordWebhook.Embeds[0]
	if len(embed.Fields) != 1 {
		t.Errorf("Expected 1 field in embed, got %d", len(embed.Fields))
	}

	if embed.Fields[0].Value != "Intraday drawdown exceeded -1.5%" {
		t.Errorf("Expected reason in field value, got %s", embed.Fields[0].Value)
	}
}
