package data

import (
	"context"
	"testing"
	"time"
)

// mockProvider implements FeatureProvider for testing.
type mockProvider struct {
	points []DataPoint
	err    error
}

func (m *mockProvider) Fetch(ctx context.Context, req FeatureRequest) ([]DataPoint, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.points, nil
}

func TestFeatureRegistry_Register(t *testing.T) {
	registry := NewFeatureRegistry()
	provider := &mockProvider{}

	registry.Register("Test.Prefix", provider)

	registry.mu.RLock()
	defer registry.mu.RUnlock()

	if p, ok := registry.providers["Test.Prefix"]; !ok || p != provider {
		t.Errorf("Register() failed to store the provider properly")
	}
}

func TestFeatureRegistry_Query(t *testing.T) {
	registry := NewFeatureRegistry()
	expectedPoints := []DataPoint{
		{Timestamp: time.Now(), Value: 100.0, Meta: map[string]any{"key": "value"}},
	}

	mock1 := &mockProvider{points: expectedPoints}
	mock2 := &mockProvider{points: []DataPoint{{Value: 999.0}}}

	registry.Register("Macro", mock1)
	registry.Register("Macro.FRED", mock2)

	tests := []struct {
		name       string
		featureKey string
		wantValue  float64
		wantErr    bool
	}{
		{
			name:       "exact match",
			featureKey: "Macro.FRED",
			wantValue:  999.0,
			wantErr:    false,
		},
		{
			name:       "prefix match",
			featureKey: "Macro.Other",
			wantValue:  100.0,
			wantErr:    false,
		},
		{
			name:       "no match synthetic fallback",
			featureKey: "Unknown.Key",
			wantValue:  100.0,
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := FeatureRequest{
				FeatureKey: tt.featureKey,
				Start:      time.Now().Add(-24 * time.Hour),
				End:        time.Now(),
				Resolution: 24 * time.Hour,
			}

			points, err := registry.Query(context.Background(), req)

			if (err != nil) != tt.wantErr {
				t.Errorf("Query() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr && len(points) == 0 {
				t.Errorf("Query() returned 0 points")
			}
		})
	}
}

func TestFeatureRegistry_ListFeatures(t *testing.T) {
	registry := NewFeatureRegistry()
	streams := registry.ListFeatures()
	if len(streams) == 0 {
		t.Errorf("ListFeatures() returned empty slice")
	}

	custom := FeatureStream{
		Key:      "Custom.Feature",
		Name:     "Custom Feature",
		Category: "Custom",
	}
	registry.RegisterStream(custom)

	updated := registry.ListFeatures()
	found := false
	for _, s := range updated {
		if s.Key == "Custom.Feature" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("RegisterStream() failed to add stream")
	}
}
