package macro

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"gelt/pkg/data"
)

// FredProvider implements data.FeatureProvider for fetching FRED series.
type FredProvider struct {
	client *Client
}

// NewFredProvider initializes a FredProvider wrapping the existing macro Client.
func NewFredProvider(apiKey string) *FredProvider {
	return &FredProvider{
		client: NewClient(apiKey),
	}
}

// RegisterProvider is a convenience helper to attach this provider to a FeatureRegistry.
func RegisterProvider(registry *data.FeatureRegistry, apiKey string) {
	registry.Register("Macro.FRED", NewFredProvider(apiKey))
}

// Fetch fulfills the data.FeatureProvider interface.
func (p *FredProvider) Fetch(ctx context.Context, req data.FeatureRequest) ([]data.DataPoint, error) {
	if p.client.apiKey == "" {
		return nil, fmt.Errorf("FRED API key not configured")
	}

	// Example FeatureKey: "Macro.FRED.DFF"
	prefix := "Macro.FRED."
	if !strings.HasPrefix(req.FeatureKey, prefix) {
		return nil, fmt.Errorf("invalid feature key for FredProvider: %s", req.FeatureKey)
	}

	seriesID := strings.TrimPrefix(req.FeatureKey, prefix)
	if seriesID == "" {
		return nil, fmt.Errorf("empty series ID in feature key: %s", req.FeatureKey)
	}

	startStr := req.Start.Format("2006-01-02")
	endStr := req.End.Format("2006-01-02")

	url := fmt.Sprintf("%s/fred/series/observations?series_id=%s&api_key=%s&file_type=json&observation_start=%s&observation_end=%s",
		p.client.BaseURL, seriesID, p.client.apiKey, startStr, endStr)

	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.client.httpClient.Do(httpReq)
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

	// Map returned observations by date string for O(1) lookup
	obsMap := make(map[string]float64)
	for _, obs := range res.Observations {
		if obs.Value == "." {
			continue // FRED uses "." for missing values
		}
		val, err := strconv.ParseFloat(obs.Value, 64)
		if err == nil {
			obsMap[obs.Date] = val
		}
	}

	// Generate a continuous daily sequence, forward-filling missing days
	var points []data.DataPoint
	lastVal := math.NaN()

	curr := req.Start
	for !curr.After(req.End) {
		dateStr := curr.Format("2006-01-02")

		if val, exists := obsMap[dateStr]; exists {
			lastVal = val
		}

		points = append(points, data.DataPoint{
			Timestamp: curr,
			Value:     lastVal,
			Meta:      map[string]any{"series_id": seriesID},
		})

		curr = curr.AddDate(0, 0, 1)
	}

	return points, nil
}
