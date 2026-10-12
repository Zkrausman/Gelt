package data

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
)

// DataPoint represents a single data point in a time series feature.
type DataPoint struct {
	Timestamp time.Time
	Value     float64
	Meta      map[string]any
}

// FeatureRequest defines the parameters for querying a feature.
type FeatureRequest struct {
	FeatureKey string
	Start      time.Time
	End        time.Time
	Resolution time.Duration
}

// FeatureStream describes metadata for a registered or available feature data stream.
type FeatureStream struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Unit        string `json:"unit"`
}

// FeatureProvider is the core interface that any data source must implement.
type FeatureProvider interface {
	Fetch(ctx context.Context, req FeatureRequest) ([]DataPoint, error)
}

// FeatureRegistry stores and routes feature requests to registered providers.
type FeatureRegistry struct {
	providers map[string]FeatureProvider
	streams   []FeatureStream
	mu        sync.RWMutex
}

// NewFeatureRegistry creates a new FeatureRegistry initialized with default feature streams.
func NewFeatureRegistry() *FeatureRegistry {
	r := &FeatureRegistry{
		providers: make(map[string]FeatureProvider),
		streams: []FeatureStream{
			{Key: "Equity.SPY", Name: "S&P 500 ETF (SPY)", Category: "Equity", Description: "S&P 500 index ETF price history", Unit: "USD"},
			{Key: "Equity.QQQ", Name: "Nasdaq 100 ETF (QQQ)", Category: "Equity", Description: "Invesco QQQ Trust index price", Unit: "USD"},
			{Key: "Macro.FRED.DFF", Name: "Effective Federal Funds Rate", Category: "Macro", Description: "FRED Federal Reserve Effective Funds Rate", Unit: "%"},
			{Key: "Macro.Yield10Y", Name: "10-Year Treasury Yield", Category: "Macro", Description: "US 10-Year Treasury Constant Maturity Rate", Unit: "%"},
			{Key: "Macro.VIX", Name: "CBOE Volatility Index (VIX)", Category: "Macro", Description: "Market volatility index", Unit: "Index"},
			{Key: "Sentiment.Reddit.WSB", Name: "Reddit WSB Sentiment", Category: "Sentiment", Description: "r/wallstreetbets aggregated sentiment score", Unit: "Score (-1 to +1)"},
		},
	}
	return r
}

// Register assigns a FeatureProvider to a specific feature prefix.
func (r *FeatureRegistry) Register(prefix string, p FeatureProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[prefix] = p
}

// ListRegisteredPrefixes returns a list of all registered feature prefixes.
func (r *FeatureRegistry) ListRegisteredPrefixes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var prefixes []string
	for prefix := range r.providers {
		prefixes = append(prefixes, prefix)
	}
	return prefixes
}

// RegisterStream adds metadata for an available feature stream.
func (r *FeatureRegistry) RegisterStream(stream FeatureStream) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, s := range r.streams {
		if s.Key == stream.Key {
			r.streams[i] = stream
			return
		}
	}
	r.streams = append(r.streams, stream)
}

// ListFeatures returns the available feature streams metadata.
func (r *FeatureRegistry) ListFeatures() []FeatureStream {
	r.mu.RLock()
	defer r.mu.RUnlock()
	res := make([]FeatureStream, len(r.streams))
	copy(res, r.streams)
	return res
}

// Query routes the FeatureRequest to the appropriate provider based on the FeatureKey.
func (r *FeatureRegistry) Query(ctx context.Context, req FeatureRequest) ([]DataPoint, error) {
	r.mu.RLock()
	var matchedProvider FeatureProvider
	var longestMatch string

	for prefix, provider := range r.providers {
		if strings.HasPrefix(req.FeatureKey, prefix) {
			if len(prefix) > len(longestMatch) {
				longestMatch = prefix
				matchedProvider = provider
			}
		}
	}
	r.mu.RUnlock()

	if matchedProvider != nil {
		pts, err := matchedProvider.Fetch(ctx, req)
		if err == nil && len(pts) > 0 {
			return pts, nil
		}
	}

	// Synthetic fallback generator for robust UI rendering and offline mode
	return GenerateSyntheticSeries(req)
}

// GenerateSyntheticSeries produces realistic deterministic time series data for any feature key.
func GenerateSyntheticSeries(req FeatureRequest) ([]DataPoint, error) {
	if req.Start.IsZero() || req.End.IsZero() {
		req.End = time.Now()
		req.Start = req.End.AddDate(0, 0, -30)
	}
	if req.Start.After(req.End) {
		return nil, fmt.Errorf("start time cannot be after end time")
	}

	res := req.Resolution
	if res <= 0 {
		res = 24 * time.Hour
	}

	var points []DataPoint
	curr := req.Start.Truncate(res)

	// Base values and scales per key type
	baseVal := 100.0
	trend := 0.05
	noiseScale := 1.0

	keyUpper := strings.ToUpper(req.FeatureKey)
	if strings.Contains(keyUpper, "SPY") {
		baseVal = 500.0
		trend = 0.4
		noiseScale = 3.5
	} else if strings.Contains(keyUpper, "QQQ") {
		baseVal = 450.0
		trend = 0.5
		noiseScale = 4.2
	} else if strings.Contains(keyUpper, "DFF") || strings.Contains(keyUpper, "YIELD") {
		baseVal = 4.35
		trend = -0.005
		noiseScale = 0.04
	} else if strings.Contains(keyUpper, "VIX") {
		baseVal = 16.5
		trend = 0.0
		noiseScale = 1.8
	} else if strings.Contains(keyUpper, "SENTIMENT") || strings.Contains(keyUpper, "REDDIT") {
		baseVal = 0.25
		trend = 0.002
		noiseScale = 0.15
	}

	step := 0
	currVal := baseVal

	for !curr.After(req.End) {
		// Deterministic pseudo-random variation
		sineWave := math.Sin(float64(step)*0.15) * noiseScale
		cosWave := math.Cos(float64(step)*0.35) * (noiseScale * 0.5)
		currVal = currVal + (trend * (0.5 - math.Sin(float64(step)*0.05))) + (sineWave + cosWave)*0.2

		if strings.Contains(keyUpper, "SENTIMENT") {
			if currVal > 1.0 {
				currVal = 1.0
			} else if currVal < -1.0 {
				currVal = -1.0
			}
		} else if currVal < 0 {
			currVal = 0.1
		}

		points = append(points, DataPoint{
			Timestamp: curr,
			Value:     math.Round(currVal*1000) / 1000,
			Meta:      map[string]any{"source": "synthetic"},
		})

		step++
		curr = curr.Add(res)
	}

	return points, nil
}
