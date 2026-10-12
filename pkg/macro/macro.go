// Package macro provides asynchronous macroeconomic data ingestion (FRED API) for Gelt.
package macro

import (
	"context"
	"encoding/json"
	"fmt"
	"gelt/pkg/robinhood"
	"io"
	"net/http"
	"sync"
	"time"
)

// MacroData holds fetched macroeconomic series data.
type MacroData struct {
	SeriesID  string    `json:"series_id"` // e.g. "EFFR" or "FEDFUNDS"
	Value     float64   `json:"value"`     // Effective Federal Funds Rate %
	Date      string    `json:"date"`      // Date string YYYY-MM-DD
	Timestamp time.Time `json:"timestamp"`
}

// Client handles asynchronous FRED API data fetching with caching and non-blocking background refresh.
type Client struct {
	mu         sync.RWMutex
	apiKey     string
	BaseURL    string
	httpClient *http.Client
	cache      map[string]*MacroData
}

// NewClient initializes a FRED API client.
func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		BaseURL: "https://api.stlouisfed.org",
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		cache: make(map[string]*MacroData),
	}
}

// FetchSeriesAsync triggers an asynchronous background goroutine to fetch a FRED macro series (e.g. EFFR / FEDFUNDS),
// returning immediately so the calling trading thread is never blocked. Result is delivered via channel.
func (c *Client) FetchSeriesAsync(seriesID string) <-chan *MacroData {
	ch := make(chan *MacroData, 1)

	go func() {
		defer close(ch)

		// Check cache first to avoid blocking on network calls
		c.mu.RLock()
		cached, exists := c.cache[seriesID]
		c.mu.RUnlock()
		if exists {
			ch <- cached
			return
		}

		data, err := c.FetchSeries(seriesID)
		if err == nil {
			ch <- data
			return
		}

		// Baseline fallback if offline or API key missing
		fallback := &MacroData{
			SeriesID:  seriesID,
			Value:     5.33, // Default baseline Effective Federal Funds Rate
			Date:      time.Now().Format("2006-01-02"),
			Timestamp: time.Now(),
		}
		ch <- fallback
	}()

	return ch
}

// FetchSeries synchronously fetches a series from FRED or cache.
func (c *Client) FetchSeries(seriesID string) (*MacroData, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("FRED API key not configured")
	}

	url := fmt.Sprintf("%s/fred/series/observations?series_id=%s&api_key=%s&file_type=json&sort_order=desc&limit=1", c.BaseURL, seriesID, c.apiKey)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("FRED request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("FRED API returned HTTP status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	type fredResponse struct {
		Observations []struct {
			Date  string `json:"date"`
			Value string `json:"value"`
		} `json:"observations"`
	}

	var res fredResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to unmarshal FRED response: %w", err)
	}

	if len(res.Observations) == 0 {
		return nil, fmt.Errorf("no observations found for series %s", seriesID)
	}

	obs := res.Observations[0]
	var val float64
	_, _ = fmt.Sscanf(obs.Value, "%f", &val)

	data := &MacroData{
		SeriesID:  seriesID,
		Value:     val,
		Date:      obs.Date,
		Timestamp: time.Now(),
	}

	c.mu.Lock()
	c.cache[seriesID] = data
	c.mu.Unlock()

	return data, nil
}

// GetCached returns cached series data if available.
func (c *Client) GetCached(seriesID string) *MacroData {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cache[seriesID]
}

// MacroProvider defines the interface for fetching baseline macro indicators.
type MacroProvider interface {
	FetchVIX(ctx context.Context) (float64, error)
	FetchSPYTrend(ctx context.Context) (float64, error)
}

// MCPMacroProvider implements MacroProvider using the Robinhood MCP.
type MCPMacroProvider struct {
	cfg   *robinhood.MCPConfig
	mu    sync.RWMutex
	cache map[string]*cachedMacroValue
}

type cachedMacroValue struct {
	value     float64
	timestamp time.Time
}

// NewMCPMacroProvider initializes a new MCPMacroProvider.
func NewMCPMacroProvider(cfg *robinhood.MCPConfig) *MCPMacroProvider {
	return &MCPMacroProvider{
		cfg:   cfg,
		cache: make(map[string]*cachedMacroValue),
	}
}

// FetchVIX retrieves the current VIX index value, returning a cached version if fetched same-day.
func (p *MCPMacroProvider) FetchVIX(ctx context.Context) (float64, error) {
	p.mu.RLock()
	if cached, ok := p.cache["VIX"]; ok {
		if cached.timestamp.Format("2006-01-02") == time.Now().Format("2006-01-02") {
			p.mu.RUnlock()
			return cached.value, nil
		}
	}
	p.mu.RUnlock()

	quote, err := robinhood.FetchLiveQuote(p.cfg, "VIX")
	if err != nil {
		return 0, fmt.Errorf("failed to fetch VIX quote: %w", err)
	}

	p.mu.Lock()
	p.cache["VIX"] = &cachedMacroValue{
		value:     quote.LastPrice,
		timestamp: time.Now(),
	}
	p.mu.Unlock()

	return quote.LastPrice, nil
}

// FetchSPYTrend retrieves a recent SPY trend value (e.g. SMA) using the MCP, returning cached version if fetched same-day.
func (p *MCPMacroProvider) FetchSPYTrend(ctx context.Context) (float64, error) {
	p.mu.RLock()
	if cached, ok := p.cache["SPY_SMA"]; ok {
		if cached.timestamp.Format("2006-01-02") == time.Now().Format("2006-01-02") {
			p.mu.RUnlock()
			return cached.value, nil
		}
	}
	p.mu.RUnlock()

	indicator, err := robinhood.FetchTechnicalIndicator(p.cfg, "SPY", "sma", "day", 50)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch SPY SMA: %w", err)
	}

	p.mu.Lock()
	p.cache["SPY_SMA"] = &cachedMacroValue{
		value:     indicator.Latest.Value,
		timestamp: time.Now(),
	}
	p.mu.Unlock()

	return indicator.Latest.Value, nil
}
