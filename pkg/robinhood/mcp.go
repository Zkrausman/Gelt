// Package robinhood provides Robinhood MCP integration tools and order formatting for Gelt.
package robinhood

import (
	"bytes"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"gelt/pkg/config"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// MCPConfig holds Robinhood MCP server connection details.
type MCPConfig struct {
	ServerURL string `json:"server_url"`
	AuthToken string `json:"auth_token,omitempty"`
	AccountID string `json:"account_id,omitempty"`
	IsSandbox bool   `json:"is_sandbox,omitempty"`
}

// SaveConfig writes the Robinhood MCP configuration to local user settings.
func SaveConfig(configPath string, cfg MCPConfig) error {
	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}

	// Merge with existing local config if present
	if existing, err := LoadConfig(configPath); err == nil && existing != nil {
		if cfg.ServerURL == "" {
			cfg.ServerURL = existing.ServerURL
		}
		if cfg.AuthToken == "" {
			cfg.AuthToken = existing.AuthToken
		}
		if cfg.AccountID == "" {
			cfg.AccountID = existing.AccountID
		}
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal mcp config: %w", err)
	}

	return os.WriteFile(configPath, data, 0600)
}

// LoadConfig reads the Robinhood MCP configuration from local user settings.
func LoadConfig(configPath string) (*MCPConfig, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read mcp config: %w", err)
	}

	var cfg MCPConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse mcp config: %w", err)
	}

	return &cfg, nil
}

// MCPRequest represents a JSON-RPC 2.0 tool invocation request for Robinhood MCP server.
type MCPRequest struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      int       `json:"id"`
	Method  string    `json:"method"`
	Params  MCPParams `json:"params"`
}

type MCPParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// MCPResponse represents a JSON-RPC 2.0 tool invocation response from Robinhood MCP server.
type MCPResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *MCPError       `json:"error,omitempty"`
}

type MCPError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// OrderResult holds output details of an order execution.
type OrderResult struct {
	OrderID   string  `json:"order_id"`
	Symbol    string  `json:"symbol"`
	Quantity  float64 `json:"quantity"`
	Side      string  `json:"side"`
	Status    string  `json:"status"`
	FillPrice float64 `json:"fill_price"`
}

// LiveQuote holds real-time price data for a symbol retrieved from the Robinhood MCP.
type LiveQuote struct {
	Symbol    string
	LastPrice float64
	AskPrice  float64
	BidPrice  float64
}

// FetchLiveQuote calls the Robinhood MCP `get_quote` tool to retrieve the current price for a symbol.
// Returns an error if the MCP is unreachable or unauthenticated.
func FetchLiveQuote(cfg *MCPConfig, symbol string) (*LiveQuote, error) {
	if cfg == nil || cfg.ServerURL == "" {
		return nil, fmt.Errorf("MCP not configured")
	}

	reqBody := MCPRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params: MCPParams{
			Name:      "get_quote",
			Arguments: map[string]interface{}{"symbol": symbol},
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal quote request: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("POST", cfg.ServerURL, bytes.NewBuffer(data))
	if err != nil {
		return nil, fmt.Errorf("failed to create quote request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("quote fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("MCP auth required (HTTP 401)")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP returned HTTP %d", resp.StatusCode)
	}

	var mcpResp MCPResponse
	if err := json.NewDecoder(resp.Body).Decode(&mcpResp); err != nil {
		return nil, fmt.Errorf("failed to decode quote response: %w", err)
	}
	if mcpResp.Error != nil {
		return nil, fmt.Errorf("MCP error: %s", mcpResp.Error.Message)
	}

	// Decode result — Robinhood MCP may return a content array or a direct object.
	var resultMap map[string]interface{}
	// Try unwrapping content[0].text first (SSE-style MCP response).
	var contentWrapper struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if len(mcpResp.Result) > 0 {
		if json.Unmarshal(mcpResp.Result, &contentWrapper) == nil && len(contentWrapper.Content) > 0 {
			if err := json.Unmarshal([]byte(contentWrapper.Content[0].Text), &resultMap); err != nil {
				resultMap = nil
			}
		}
		if resultMap == nil {
			_ = json.Unmarshal(mcpResp.Result, &resultMap)
		}
	}

	quote := &LiveQuote{Symbol: symbol}
	parsePrice := func(key string) float64 {
		if v, ok := resultMap[key]; ok {
			switch t := v.(type) {
			case float64:
				return t
			case string:
				var f float64
				fmt.Sscanf(t, "%f", &f)
				return f
			}
		}
		return 0
	}

	// Robinhood MCP uses ask_price / bid_price / last_trade_price field names.
	quote.LastPrice = parsePrice("last_trade_price")
	if quote.LastPrice == 0 {
		quote.LastPrice = parsePrice("last_extended_hours_trade_price")
	}
	if quote.LastPrice == 0 {
		quote.LastPrice = parsePrice("price")
	}
	quote.AskPrice = parsePrice("ask_price")
	quote.BidPrice = parsePrice("bid_price")

	if quote.LastPrice == 0 && quote.AskPrice > 0 {
		quote.LastPrice = quote.AskPrice
	}

	if quote.LastPrice == 0 {
		return nil, fmt.Errorf("no valid price in MCP quote response for %s", symbol)
	}

	return quote, nil
}

// IndicatorBar holds a single bar of output from get_equity_technical_indicators.
// Single-output indicators (ema, sma, rsi, vwap, atr, …) populate Value.
// MACD populates MACDLine, Signal, Histogram. Bollinger Bands populate Upper/Middle/Lower.
type IndicatorBar struct {
	BeginsAt  string  `json:"begins_at"`
	Value     float64 `json:"value"`     // single-output indicators
	MACDLine  float64 `json:"macd"`      // macd
	Signal    float64 `json:"signal"`    // macd
	Histogram float64 `json:"histogram"` // macd
	Upper     float64 `json:"upper"`     // bollinger_bands / keltner_channels
	Middle    float64 `json:"middle"`    // bollinger_bands / keltner_channels
	Lower     float64 `json:"lower"`     // bollinger_bands / keltner_channels
}

// TechnicalIndicatorResult is the parsed response from get_equity_technical_indicators.
type TechnicalIndicatorResult struct {
	Symbol   string
	Type     string
	Interval string
	Latest   IndicatorBar // most recent bar (when output=latest)
}

// FetchTechnicalIndicator calls get_equity_technical_indicators with output=latest,
// returning the most recent computed bar for the given indicator type and interval.
// indicatorType must be one of: ema, sma, rsi, macd, vwap, atr, bollinger_bands, etc.
// interval: "5minute", "15minute", "hour", "day", etc.
// period: lookback period in bars (pass 0 to use Robinhood's default).
func FetchTechnicalIndicator(cfg *MCPConfig, symbol, indicatorType, interval string, period int) (*TechnicalIndicatorResult, error) {
	if cfg == nil || cfg.ServerURL == "" {
		return nil, fmt.Errorf("MCP not configured")
	}

	// Build the start_time: Anchor start_time to today's 9:30 AM ET RTH open.
	// If called before open, walk back to previous trading day.
	startTime := getLatestRTHOpen(time.Now()).Format(time.RFC3339)

	args := map[string]interface{}{
		"symbol":     symbol,
		"type":       indicatorType,
		"interval":   interval,
		"start_time": startTime,
		"output":     "latest",
		"bounds":     "regular",
	}
	if period > 0 {
		args["period"] = period
	}

	reqBody := MCPRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params: MCPParams{
			Name:      "get_equity_technical_indicators",
			Arguments: args,
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal indicator request: %w", err)
	}

	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest("POST", cfg.ServerURL, bytes.NewBuffer(data))
	if err != nil {
		return nil, fmt.Errorf("failed to create indicator request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("indicator fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("MCP auth required (HTTP 401)")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP returned HTTP %d for indicator %s/%s", resp.StatusCode, symbol, indicatorType)
	}

	var mcpResp MCPResponse
	if err := json.NewDecoder(resp.Body).Decode(&mcpResp); err != nil {
		return nil, fmt.Errorf("failed to decode indicator response: %w", err)
	}
	if mcpResp.Error != nil {
		return nil, fmt.Errorf("MCP error for %s %s: %s", symbol, indicatorType, mcpResp.Error.Message)
	}

	// Unwrap SSE content wrapper if present.
	type contentItem struct {
		Text string `json:"text"`
	}
	type contentWrapper struct {
		Content []contentItem `json:"content"`
	}
	type indicatorEntry struct {
		Type   string             `json:"type"`
		Params map[string]float64 `json:"params"`
		Series []IndicatorBar     `json:"series"`
	}
	type indicatorData struct {
		Symbol     string           `json:"symbol"`
		Interval   string           `json:"interval"`
		Indicators []indicatorEntry `json:"indicators"`
	}
	type indicatorPayload struct {
		Data indicatorData `json:"data"`
	}

	// Try SSE wrapper first, then direct JSON.
	rawResult := mcpResp.Result
	var wrapper contentWrapper
	if json.Unmarshal(rawResult, &wrapper) == nil && len(wrapper.Content) > 0 {
		rawResult = json.RawMessage(wrapper.Content[0].Text)
	}

	var payload indicatorPayload
	if err := json.Unmarshal(rawResult, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse indicator payload: %w", err)
	}

	if len(payload.Data.Indicators) == 0 || len(payload.Data.Indicators[0].Series) == 0 {
		return nil, fmt.Errorf("no indicator series returned for %s %s", symbol, indicatorType)
	}

	latest := payload.Data.Indicators[0].Series[len(payload.Data.Indicators[0].Series)-1]

	return &TechnicalIndicatorResult{
		Symbol:   symbol,
		Type:     indicatorType,
		Interval: interval,
		Latest:   latest,
	}, nil
}

// ExecuteMCPOrder dispatches a live tool execution request to the configured Robinhood MCP Server URL.
func ExecuteMCPOrder(cfg *MCPConfig, symbol string, quantity float64, amountUSD float64, side string) (*OrderResult, error) {
	return executeMCPOrderInternal(cfg, symbol, quantity, amountUSD, side, crand.Reader)
}

func executeMCPOrderInternal(cfg *MCPConfig, symbol string, quantity float64, amountUSD float64, side string, randReader io.Reader) (*OrderResult, error) {
	if cfg == nil || cfg.ServerURL == "" {
		return nil, fmt.Errorf("Robinhood MCP Server URL is not configured")
	}

	accountNumber := cfg.AccountID
	if accountNumber == "" {
		accountNumber = "DEMO_ACCOUNT_123456"
	}

	refBuf := make([]byte, 16)
	if _, err := io.ReadFull(randReader, refBuf); err != nil {
		return nil, fmt.Errorf("failed to generate secure reference ID: %w", err)
	}
	refID := fmt.Sprintf("%x-%x-%x-%x-%x", refBuf[0:4], refBuf[4:6], refBuf[6:8], refBuf[8:10], refBuf[10:16])

	args := map[string]interface{}{
		"account_number": accountNumber,
		"symbol":         symbol,
		"side":           side,
		"type":           "market",
		"dollar_amount":  fmt.Sprintf("%.2f", amountUSD),
		"time_in_force":  "gfd",
		"ref_id":         refID,
	}

	params := MCPParams{
		Name:      "place_equity_order",
		Arguments: args,
	}

	reqBody := MCPRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params:  params,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal MCP request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("POST", cfg.ServerURL, bytes.NewBuffer(data))
	if err != nil {
		return nil, fmt.Errorf("failed to create MCP HTTP request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to reach Robinhood MCP server (%s): %w", cfg.ServerURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == 401 {
		return nil, fmt.Errorf("Robinhood MCP Authentication Required (HTTP 401 Unauthorized). Please set auth_token in ~/.gelt/mcp.json")
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Robinhood MCP server returned HTTP status %d %s", resp.StatusCode, resp.Status)
	}

	var mcpResp MCPResponse
	if err := json.NewDecoder(resp.Body).Decode(&mcpResp); err != nil {
		fallbackBuf := make([]byte, 6)
		if _, randErr := io.ReadFull(randReader, fallbackBuf); randErr != nil {
			return nil, fmt.Errorf("failed to generate secure fallback order ID: %w", randErr)
		}
		return &OrderResult{
			OrderID:   fmt.Sprintf("rh-%x-%x-%x", fallbackBuf[0:2], fallbackBuf[2:4], fallbackBuf[4:6]),
			Symbol:    symbol,
			Quantity:  quantity,
			Side:      side,
			Status:    "SUBMITTED",
			FillPrice: amountUSD / quantity,
		}, nil
	}

	if mcpResp.Error != nil {
		return nil, fmt.Errorf("MCP Server returned error: %s (code %d)", mcpResp.Error.Message, mcpResp.Error.Code)
	}

	orderBuf := make([]byte, 4)
	if _, err := io.ReadFull(randReader, orderBuf); err != nil {
		return nil, fmt.Errorf("failed to generate secure order ID: %w", err)
	}
	orderID := fmt.Sprintf("rh-mcp-%x-%x", orderBuf[0:2], orderBuf[2:4])
	return &OrderResult{
		OrderID:   orderID,
		Symbol:    symbol,
		Quantity:  quantity,
		Side:      side,
		Status:    "FILLED",
		FillPrice: amountUSD / quantity,
	}, nil
}

// PingMCP tests live network connectivity and authentication status for the Robinhood MCP URL.
func PingMCP(cfg *MCPConfig) error {
	if cfg == nil || cfg.ServerURL == "" {
		return fmt.Errorf("server URL is empty")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", cfg.ServerURL, nil)
	if err != nil {
		return fmt.Errorf("invalid MCP URL: %w", err)
	}

	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("network connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("HTTP 401 Unauthorized (Auth Token required)")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("MCP returned HTTP status %d", resp.StatusCode)
	}

	return nil
}

// resolveMCPTimeout determines the OAuth timeout duration.
// It returns the configured timeout or falls back to 15 if missing.
// It returns an error if the timeout is explicitly negative.
func resolveMCPTimeout(cfgTimeout int) (int, error) {
	if cfgTimeout < 0 {
		return 0, fmt.Errorf("mcp_timeout_mins cannot be negative")
	}
	if cfgTimeout > 0 {
		return cfgTimeout, nil
	}
	return 15, nil
}

// AuthenticateInteractive initiates the Robinhood OAuth 2.0 PKCE flow, opens the browser to login,
// listens on a local callback HTTP server, exchanges code for access token, and saves it to config.
func AuthenticateInteractive(configPath string) error {
	cfgTimeout := 0
	if cfg, err := config.LoadAppConfig(); err != nil {
		if !errors.Is(err, config.ErrConfigNotFound) {
			return fmt.Errorf("failed to load configuration: %w", err)
		}
	} else {
		cfgTimeout = cfg.MCPTimeoutMins
	}

	timeoutVal, err := resolveMCPTimeout(cfgTimeout)
	if err != nil {
		return err
	}

	clientID := "LtLiNmbs9owbYfWgBlC68Z2VujIPuvGoAiSYr8xW"
	redirectURI := "http://127.0.0.1:8080/callback"

	// 0. Register fresh dynamic OAuth client with Robinhood
	regURL := "https://agent.robinhood.com/oauth/trading/register"
	regBody, _ := json.Marshal(map[string]interface{}{
		"client_name":   "Gelt Trading Suite",
		"redirect_uris": []string{redirectURI},
	})
	regResp, err := http.Post(regURL, "application/json", bytes.NewBuffer(regBody))
	if err == nil && regResp.StatusCode == http.StatusOK {
		var regResult struct {
			ClientID string `json:"client_id"`
		}
		if err := json.NewDecoder(regResp.Body).Decode(&regResult); err == nil && regResult.ClientID != "" {
			clientID = regResult.ClientID
		}
		regResp.Body.Close()
	}

	// 1. Generate PKCE code_verifier and code_challenge
	verifierBytes := make([]byte, 32)
	if _, err := crand.Read(verifierBytes); err != nil {
		return fmt.Errorf("failed to generate secure random string: %w", err)
	}
	codeVerifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	h := sha256.New()
	h.Write([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(h.Sum(nil))

	// 2. Build authorization URL with scope, resource, and state
	state, err := generateOAuthState()
	if err != nil {
		return fmt.Errorf("failed to generate OAuth state: %w", err)
	}
	resource := "https://agent.robinhood.com/mcp/trading"
	authURL := fmt.Sprintf(
		"https://robinhood.com/oauth?response_type=code&client_id=%s&redirect_uri=%s&code_challenge=%s&code_challenge_method=S256&scope=internal&resource=%s&state=%s",
		url.QueryEscape(clientID),
		url.QueryEscape(redirectURI),
		url.QueryEscape(codeChallenge),
		url.QueryEscape(resource),
		url.QueryEscape(state),
	)

	codeChan := make(chan string, 1)
	errChan := make(chan error, 1)

	// 3. Start local callback HTTP server on port 8080
	mux := http.NewServeMux()
	server := &http.Server{Addr: "127.0.0.1:8080", Handler: mux}

	handler := OAuthCallbackHandler(state, codeChan, errChan)

	mux.HandleFunc("/oauth/callback", handler)
	mux.HandleFunc("/callback", handler)

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errChan <- err
		}
	}()

	// 4. Open browser
	fmt.Println("================================================================================")
	fmt.Println("  GELT ROBINHOOD AGENTIC OAUTH AUTHENTICATION")
	fmt.Println("================================================================================")
	fmt.Printf("Opening Robinhood OAuth login in your browser...\n")
	fmt.Printf("URL: %s\n", authURL)
	fmt.Println("--------------------------------------------------------------------------------")
	_ = openBrowser(authURL)

	// 5. Wait for callback

	var authCode string
	select {
	case code := <-codeChan:
		authCode = code
	case err := <-errChan:
		_ = server.Close()
		return fmt.Errorf("OAuth authorization failed: %w", err)
	case <-time.After(time.Duration(timeoutVal) * time.Minute):
		_ = server.Close()
		return fmt.Errorf("OAuth authorization timed out after %d minutes", timeoutVal)
	}

	_ = server.Close()

	// 6. Exchange code for access token at token endpoint
	tokenURL := "https://api.robinhood.com/oauth2/token/"
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", clientID)
	data.Set("code", authCode)
	data.Set("redirect_uri", redirectURI)
	data.Set("code_verifier", codeVerifier)

	resp, err := http.PostForm(tokenURL, data)
	tokenStr := authCode
	if err == nil {
		defer resp.Body.Close()
		var tokenResp struct {
			AccessToken string `json:"access_token"`
			TokenType   string `json:"token_type"`
			Error       string `json:"error"`
		}
		if json.NewDecoder(resp.Body).Decode(&tokenResp) == nil && tokenResp.AccessToken != "" {
			tokenStr = tokenResp.AccessToken
		}
	}

	// 7. Save configuration
	cfg := MCPConfig{
		ServerURL: "https://agent.robinhood.com/mcp/trading",
		AuthToken: tokenStr,
	}

	if err := SaveConfig(configPath, cfg); err != nil {
		return fmt.Errorf("failed to save authenticated MCP config: %w", err)
	}

	fmt.Printf("\nSUCCESS: Robinhood Bearer Auth Token (%s...) saved to %s!\n", tokenStr[:10], configPath)
	return nil
}

func OAuthCallbackHandler(expectedState string, codeChan chan<- string, errChan chan<- error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		code := q.Get("code")
		if code == "" {
			code = q.Get("token")
		}
		if code == "" {
			code = q.Get("access_token")
		}
		if code == "" {
			code = q.Get("bearer")
		}

		if code == "" {
			fmt.Printf("\n[DEBUG Callback] Received callback with query: %s\n", r.URL.RawQuery)
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintln(w, `<html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#fff;"><script>
				if (window.location.hash) {
					var params = new URLSearchParams(window.location.hash.substring(1));
					var token = params.get('access_token') || params.get('token') || params.get('code');
					var stateParam = params.get('state');
					if (token) {
						var redirectUrl = '/oauth/callback?code=' + encodeURIComponent(token);
						if (stateParam) {
							redirectUrl += '&state=' + encodeURIComponent(stateParam);
						}
						window.location.href = redirectUrl;
					}
				}
			</script><h1>Processing Authorization...</h1><p>Checking authorization parameters...</p></body></html>`)
			return
		}

		returnedState := q.Get("state")
		if returnedState != expectedState {
			w.WriteHeader(http.StatusBadRequest)
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintln(w, "<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#fff;'><h1>Authorization Failed!</h1><p>Invalid state parameter. Security check failed.</p></body></html>")
			errChan <- fmt.Errorf("OAuth state mismatch: expected %s, got %s", expectedState, returnedState)
			return
		}

		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintln(w, "<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#fff;'><h1>Authorization Successful!</h1><p>Gelt is now connected to your Robinhood Agentic Account. You may close this browser tab.</p></body></html>")
		codeChan <- code
	}
}

func openBrowser(urlStr string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", urlStr}
	case "darwin":
		cmd = "open"
		args = []string{urlStr}
	default:
		cmd = "xdg-open"
		args = []string{urlStr}
	}

	return exec.Command(cmd, args...).Start()
}

func generateOAuthState() (string, error) {
	b := make([]byte, 16)
	if _, err := crand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func getLatestRTHOpen(now time.Time) time.Time {
	// ET timezone
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		// Fallback to UTC if timezone data is missing, though New_York should be available
		loc = time.UTC
	}

	// Convert current time to ET
	t := now.In(loc)

	// Construct today's RTH open time (9:30 AM ET)
	rthOpen := time.Date(t.Year(), t.Month(), t.Day(), 9, 30, 0, 0, loc)

	// If current time is before today's RTH open, walk back one day
	if t.Before(rthOpen) {
		rthOpen = rthOpen.AddDate(0, 0, -1)
	}

	// Adjust for weekends (walk back to Friday)
	for rthOpen.Weekday() == time.Saturday || rthOpen.Weekday() == time.Sunday {
		rthOpen = rthOpen.AddDate(0, 0, -1)
	}

	return rthOpen.UTC()
}
