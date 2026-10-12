package broker

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"gelt/pkg/robinhood"
)

type AccountTelemetry struct {
	TotalEquity     float64    `json:"total_equity"`
	CashBuyingPower float64    `json:"cash_buying_power"`
	Positions       []Position `json:"positions"`
}

type Position struct {
	Symbol        string  `json:"symbol"`
	Quantity      float64 `json:"quantity"`
	UnrealizedPnL float64 `json:"unrealized_pnl"`
}

// GetAccountTelemetry queries the live Robinhood MCP wrapper methods for actual account data.
func GetAccountTelemetry(cfg *robinhood.MCPConfig) (*AccountTelemetry, error) {
	if cfg == nil || cfg.ServerURL == "" {
		return nil, fmt.Errorf("Robinhood MCP Server URL is not configured")
	}

	accountNumber := cfg.AccountID
	if accountNumber == "" {
		accountNumber = "DEMO_ACCOUNT_123456"
	}

	reqBody := robinhood.MCPRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params: robinhood.MCPParams{
			Name: "get_account",
			Arguments: map[string]interface{}{
				"account_number": accountNumber,
			},
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("POST", cfg.ServerURL, bytes.NewBuffer(data))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var mcpResp robinhood.MCPResponse
	if err := json.NewDecoder(resp.Body).Decode(&mcpResp); err != nil {
		return nil, fmt.Errorf("failed to decode response")
	}

	if mcpResp.Error != nil {
		return nil, fmt.Errorf("MCP Error: %s", mcpResp.Error.Message)
	}

	var resultMap map[string]interface{}
	if len(mcpResp.Result) > 0 {
		if err := json.Unmarshal(mcpResp.Result, &resultMap); err != nil {
			return nil, fmt.Errorf("failed to unmarshal result")
		}
	} else {
		return nil, fmt.Errorf("empty result")
	}

	telemetry := &AccountTelemetry{Positions: make([]Position, 0)}

	// Try buying_power or cash_buying_power
	if bp, ok := resultMap["buying_power"]; ok {
		switch v := bp.(type) {
		case float64:
			telemetry.CashBuyingPower = v
		case string:
			fmt.Sscanf(v, "%f", &telemetry.CashBuyingPower)
		}
	} else if cbp, ok := resultMap["cash_buying_power"]; ok {
		switch v := cbp.(type) {
		case float64:
			telemetry.CashBuyingPower = v
		case string:
			fmt.Sscanf(v, "%f", &telemetry.CashBuyingPower)
		}
	}

	if eq, ok := resultMap["total_equity"]; ok {
		switch v := eq.(type) {
		case float64:
			telemetry.TotalEquity = v
		case string:
			fmt.Sscanf(v, "%f", &telemetry.TotalEquity)
		}
	} else if port, ok := resultMap["portfolio_value"]; ok {
		switch v := port.(type) {
		case float64:
			telemetry.TotalEquity = v
		case string:
			fmt.Sscanf(v, "%f", &telemetry.TotalEquity)
		}
	}

	if posList, ok := resultMap["positions"].([]interface{}); ok {
		for _, p := range posList {
			if pm, isMap := p.(map[string]interface{}); isMap {
				pos := Position{}
				if sym, ok := pm["symbol"].(string); ok {
					pos.Symbol = sym
				}

				if qty, ok := pm["quantity"]; ok {
					switch v := qty.(type) {
					case float64:
						pos.Quantity = v
					case string:
						fmt.Sscanf(v, "%f", &pos.Quantity)
					}
				}

				if pnl, ok := pm["unrealized_pnl"]; ok {
					switch v := pnl.(type) {
					case float64:
						pos.UnrealizedPnL = v
					case string:
						fmt.Sscanf(v, "%f", &pos.UnrealizedPnL)
					}
				}
				telemetry.Positions = append(telemetry.Positions, pos)
			}
		}
	}

	return telemetry, nil
}
