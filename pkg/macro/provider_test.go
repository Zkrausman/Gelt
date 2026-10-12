package macro

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gelt/pkg/data"
)

func TestFredProvider_Fetch(t *testing.T) {
	mockResponse := `
	{
		"observations": [
			{"date": "2026-07-01", "value": "5.25"},
			{"date": "2026-07-02", "value": "5.30"},
			{"date": "2026-07-03", "value": "."},
			{"date": "2026-07-05", "value": "5.40"}
		]
	}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("series_id") != "DFF" {
			t.Errorf("Expected series_id DFF, got %s", r.URL.Query().Get("series_id"))
		}
		if r.URL.Query().Get("api_key") != "test-key" {
			t.Errorf("Expected api_key test-key, got %s", r.URL.Query().Get("api_key"))
		}
		if r.URL.Query().Get("observation_start") != "2026-07-01" {
			t.Errorf("Expected observation_start 2026-07-01, got %s", r.URL.Query().Get("observation_start"))
		}
		if r.URL.Query().Get("observation_end") != "2026-07-05" {
			t.Errorf("Expected observation_end 2026-07-05, got %s", r.URL.Query().Get("observation_end"))
		}
		fmt.Fprintln(w, mockResponse)
	}))
	defer server.Close()

	provider := NewFredProvider("test-key")
	provider.client.BaseURL = server.URL
	provider.client.httpClient = server.Client()

	start, _ := time.Parse("2006-01-02", "2026-07-01")
	end, _ := time.Parse("2006-01-02", "2026-07-05")

	req := data.FeatureRequest{
		FeatureKey: "Macro.FRED.DFF",
		Start:      start,
		End:        end,
	}

	points, err := provider.Fetch(context.Background(), req)
	if err != nil {
		t.Fatalf("Fetch returned error: %v", err)
	}

	if len(points) != 5 {
		t.Fatalf("Expected 5 points, got %d", len(points))
	}

	// 2026-07-01
	if points[0].Value != 5.25 {
		t.Errorf("Expected 5.25 for 07-01, got %f", points[0].Value)
	}
	// 2026-07-02
	if points[1].Value != 5.30 {
		t.Errorf("Expected 5.30 for 07-02, got %f", points[1].Value)
	}
	// 2026-07-03 - FRED returns ".", should forward-fill 5.30
	if points[2].Value != 5.30 {
		t.Errorf("Expected 5.30 for 07-03, got %f", points[2].Value)
	}
	// 2026-07-04 - missing from FRED, should forward-fill 5.30
	if points[3].Value != 5.30 {
		t.Errorf("Expected 5.30 for 07-04, got %f", points[3].Value)
	}
	// 2026-07-05
	if points[4].Value != 5.40 {
		t.Errorf("Expected 5.40 for 07-05, got %f", points[4].Value)
	}
}

func TestFredProvider_Fetch_MissingKey(t *testing.T) {
	provider := NewFredProvider("") // Empty API Key
	_, err := provider.Fetch(context.Background(), data.FeatureRequest{
		FeatureKey: "Macro.FRED.DFF",
	})
	if err == nil {
		t.Fatalf("Expected error for missing API key")
	}
}

func TestFredProvider_Fetch_InvalidKey(t *testing.T) {
	provider := NewFredProvider("test-key")
	_, err := provider.Fetch(context.Background(), data.FeatureRequest{
		FeatureKey: "Invalid.Prefix.DFF",
	})
	if err == nil {
		t.Fatalf("Expected error for invalid feature key prefix")
	}
}

func TestRegisterProvider(t *testing.T) {
	registry := data.NewFeatureRegistry()
	RegisterProvider(registry, "test-key")

	req := data.FeatureRequest{
		FeatureKey: "Macro.FRED.DFF",
	}

	// It should route to our FredProvider correctly
	// Just passing here validates the mapping exists because it will fail with "API Key not configured" or invalid URL if it actually calls our provider.
	// We just ensure we don't get the "no feature provider registered" error.
	_, err := registry.Query(context.Background(), req)
	if err != nil {
		// "FRED request failed" is expected as we haven't mocked the endpoint for the registry call, but it proves the routing works.
		if err.Error() == "no feature provider registered for feature key: Macro.FRED.DFF" {
			t.Fatalf("RegisterProvider failed to register in FeatureRegistry")
		}
	}
}
