package health

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"gelt/pkg/robinhood"
)

// HealthReport holds the results of the pre-market diagnostic checks.
type HealthReport struct {
	MCPReachable  bool
	OAuthValid    bool
	AccountHealth bool
	LatencyMs     int64
	Checks        []CheckResult
}

// CheckResult represents the outcome of a diagnostic check
type CheckResult struct {
	Name    string
	Status  string
	Latency int64
	Message string
}

// RunPreMarketCheck executes a full diagnostic suite against the Robinhood MCP Server.
func RunPreMarketCheck(cfg *robinhood.MCPConfig) HealthReport {
	report := HealthReport{
		Checks: make([]CheckResult, 0),
	}

	startAll := time.Now()

	// 1. MCP Server Pulse (Reachability via JSON-RPC)
	start := time.Now()
	reachable, reachableMsg := checkMCPReachable(cfg)
	lat := time.Since(start).Milliseconds()
	report.MCPReachable = reachable
	status := "FAIL"
	if reachable {
		status = "PASS"
	}
	report.Checks = append(report.Checks, CheckResult{
		Name:    "MCP Server Pulse",
		Status:  status,
		Latency: lat,
		Message: reachableMsg,
	})

	// 2. OAuth State
	start = time.Now()
	oauthValid, oauthMsg := checkOAuthState(cfg)
	lat = time.Since(start).Milliseconds()
	report.OAuthValid = oauthValid
	status = "FAIL"
	if oauthValid {
		status = "PASS"
	}
	report.Checks = append(report.Checks, CheckResult{
		Name:    "OAuth State",
		Status:  status,
		Latency: lat,
		Message: oauthMsg,
	})

	// 3. Account Health (Buying Power)
	start = time.Now()
	accHealth, accMsg := checkAccountHealth(cfg)
	lat = time.Since(start).Milliseconds()
	report.AccountHealth = accHealth
	status = "FAIL"
	if accHealth {
		status = "PASS"
	}
	report.Checks = append(report.Checks, CheckResult{
		Name:    "Account Health",
		Status:  status,
		Latency: lat,
		Message: accMsg,
	})

	report.LatencyMs = time.Since(startAll).Milliseconds()

	return report
}

func checkMCPReachable(cfg *robinhood.MCPConfig) (bool, string) {
	if cfg == nil || cfg.ServerURL == "" {
		return false, "Config missing or empty ServerURL"
	}

	// Try a minimal POST request to the MCP endpoint, expecting it to respond.
	// If it doesn't respond or returns a 404, it might be unreachable.
	reqBody := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "ping",
	}
	data, _ := json.Marshal(reqBody)

	client := &http.Client{Timeout: 5 * time.Second}

	// The requirement specifies 127.0.0.1:8080 as a possible check, but let's use cfg.ServerURL to be robust.
	// We will attempt to reach the URL via a standard HTTP call.
	req, err := http.NewRequest("POST", cfg.ServerURL, bytes.NewBuffer(data))
	if err != nil {
		return false, fmt.Sprintf("Failed to construct request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Sprintf("Connection failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// If it's a 404, the server is there but the route is wrong.
		return true, "Reachable (Status 404)"
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == 401 {
		return true, "Reachable (Auth Required)"
	}

	return true, "Reachable"
}

func checkOAuthState(cfg *robinhood.MCPConfig) (bool, string) {
	if cfg == nil || cfg.AuthToken == "" {
		return false, "Missing Auth Token"
	}

	// To check OAuth state, we can use the PingMCP function from robinhood package
	err := robinhood.PingMCP(cfg)
	if err != nil {
		return false, fmt.Sprintf("OAuth Invalid: %v", err)
	}

	return true, "Token Active and Valid"
}

func checkAccountHealth(cfg *robinhood.MCPConfig) (bool, string) {
	if cfg == nil {
		return false, "Config missing"
	}

	// We need to verify account buying power.
	// If the API supports a `get_account_status` or similar tool via ExecuteMCPOrder pattern.
	// Let's implement a call to a hypothetical tool "get_account" to fetch buying power.
	accountNumber := cfg.AccountID
	if accountNumber == "" {
		return false, "Account identifier is not configured"
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
		return false, fmt.Sprintf("Failed to marshal request: %v", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("POST", cfg.ServerURL, bytes.NewBuffer(data))
	if err != nil {
		return false, fmt.Sprintf("Failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		// Mock handling for tests, etc.
		return false, fmt.Sprintf("Network error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Sprintf("Failed to fetch account, HTTP %d", resp.StatusCode)
	}

	var mcpResp robinhood.MCPResponse
	if err := json.NewDecoder(resp.Body).Decode(&mcpResp); err != nil {
		return false, "Failed to decode response"
	}

	if mcpResp.Error != nil {
		return false, fmt.Sprintf("MCP Error: %s", mcpResp.Error.Message)
	}

	// Assuming response contains a buying_power field inside result
	// mcpResp.Result is json.RawMessage
	var resultMap map[string]interface{}
	if len(mcpResp.Result) > 0 {
		if err := json.Unmarshal(mcpResp.Result, &resultMap); err != nil {
			return false, "Failed to unmarshal result"
		}
	} else {
		return false, "Empty result"
	}

	bpVal, ok := resultMap["buying_power"]
	if !ok {
		return false, "Buying power field missing"
	}

	var buyingPower float64
	switch v := bpVal.(type) {
	case float64:
		buyingPower = v
	case string:
		fmt.Sscanf(v, "%f", &buyingPower)
	}

	if buyingPower >= 100.0 {
		return true, fmt.Sprintf("Healthy (BP: $%.2f)", buyingPower)
	}

	return false, fmt.Sprintf("Insufficient Buying Power (BP: $%.2f < $100.00)", buyingPower)
}
