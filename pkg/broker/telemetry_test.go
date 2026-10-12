package broker

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gelt/pkg/robinhood"
)

func TestGetAccountTelemetry(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := robinhood.MCPResponse{
			JSONRPC: "2.0",
			ID:      1,
			Result: json.RawMessage(`{
				"buying_power": "1234.56",
				"total_equity": "5000.00",
				"positions": [
					{
						"symbol": "AAPL",
						"quantity": "10.0",
						"unrealized_pnl": "150.0"
					},
					{
						"symbol": "TSLA",
						"quantity": "5.0",
						"unrealized_pnl": "-50.0"
					}
				]
			}`),
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockServer.Close()

	cfg := &robinhood.MCPConfig{
		ServerURL: mockServer.URL,
		AuthToken: "mock-token",
		AccountID: "mock-account",
	}

	telemetry, err := GetAccountTelemetry(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if telemetry.CashBuyingPower != 1234.56 {
		t.Errorf("expected buying power 1234.56, got %f", telemetry.CashBuyingPower)
	}
	if telemetry.TotalEquity != 5000.00 {
		t.Errorf("expected equity 5000.00, got %f", telemetry.TotalEquity)
	}
	if len(telemetry.Positions) != 2 {
		t.Fatalf("expected 2 positions, got %d", len(telemetry.Positions))
	}
	if telemetry.Positions[0].Symbol != "AAPL" || telemetry.Positions[0].Quantity != 10.0 || telemetry.Positions[0].UnrealizedPnL != 150.0 {
		t.Errorf("unexpected position data for AAPL: %+v", telemetry.Positions[0])
	}
}
