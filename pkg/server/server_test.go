package server

import (
	"context"
	"encoding/json"
	"gelt/pkg/data"
	"gelt/pkg/plans"
	"net/http"
	"net/http/httptest"
	"testing"
	"path/filepath"
	"gelt/pkg/config"
	"time"
)

func TestTelemetryServer(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)
	t.Setenv("DB_PATH", filepath.Join(tempDir, "gelt_journal.db"))
	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()
	s := NewTelemetryServer("127.0.0.1:8085", plansReg, featureReg)
	t.Cleanup(func() { s.Close() })

	tests := []struct {
		name     string
		path     string
		expected int
	}{
		{"Health Endpoint", "/api/v1/health", http.StatusOK},
		{"Plans Endpoint", "/api/v1/regime", http.StatusOK},
		{"Risk Endpoint", "/api/v1/risk", http.StatusOK},
		{"Shadow Endpoint", "/api/v1/shadow", http.StatusOK},
		{"Features List Endpoint", "/api/v1/features", http.StatusOK},
		{"Not Found", "/api/v1/unknown", http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := http.NewRequest("GET", tt.path, nil)
			if err != nil {
				t.Fatalf("Failed to create request: %v", err)
			}

			rr := httptest.NewRecorder()
			s.mux.ServeHTTP(rr, req)

			if status := rr.Code; status != tt.expected {
				t.Errorf("handler returned wrong status code: got %v want %v",
					status, tt.expected)
			}

			if tt.expected == http.StatusOK {
				var data interface{}
				if err := json.Unmarshal(rr.Body.Bytes(), &data); err != nil {
					t.Errorf("handler returned invalid JSON: %v", err)
				}
			}
		})
	}
}

// mockProvider implements FeatureProvider for testing.
type mockProvider struct {
	points []data.DataPoint
	err    error
}

func (m *mockProvider) Fetch(ctx context.Context, req data.FeatureRequest) ([]data.DataPoint, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.points, nil
}

func TestFeaturesEndpoint(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)
	t.Setenv("DB_PATH", filepath.Join(tempDir, "gelt_journal.db"))
	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()

	mock := &mockProvider{
		points: []data.DataPoint{
			{Timestamp: time.Now(), Value: 123.45},
		},
	}
	featureReg.Register("Test.Mock", mock)

	s := NewTelemetryServer("127.0.0.1:8085", plansReg, featureReg)
	t.Cleanup(func() { s.Close() })

	// Test 1: List prefixes
	req, _ := http.NewRequest("GET", "/api/v1/features", nil)
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("List prefixes handler returned wrong status code: got %v want %v", rr.Code, http.StatusOK)
	}

	var listResp map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &listResp)
	prefixes, ok := listResp["available_prefixes"].([]interface{})
	if !ok || len(prefixes) != 1 || prefixes[0].(string) != "Test.Mock" {
		t.Errorf("Expected Test.Mock in available prefixes, got: %v", listResp)
	}

	// Test 2: Fetch feature
	req2, _ := http.NewRequest("GET", "/api/v1/features?key=Test.Mock", nil)
	rr2 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Errorf("Fetch feature handler returned wrong status code: got %v want %v", rr2.Code, http.StatusOK)
	}

	var fetchResp map[string]interface{}
	json.Unmarshal(rr2.Body.Bytes(), &fetchResp)
	points, ok := fetchResp["points"].([]interface{})
	if !ok || len(points) != 1 {
		t.Errorf("Expected 1 point in fetch response, got: %v", fetchResp)
	}
}

func TestNewTelemetryServer_MetricSymbol(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)
	t.Setenv("DB_PATH", filepath.Join(tempDir, "gelt_journal.db"))

	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()

	// 1. Unconfigured config -> falls back to ""
	s := NewTelemetryServer("127.0.0.1:8086", plansReg, featureReg)
	t.Cleanup(func() { s.Close() })
	if s.metricSymbol != "" {
		t.Errorf("expected fallback metricSymbol to be empty, got %s", s.metricSymbol)
	}

	// Initialize config
	cfg, _, err := config.InitUserConfig()
	if err != nil {
		t.Fatalf("failed to init config: %v", err)
	}

	// 2. WatchSymbols has items -> sets to WatchSymbols[0]
	cfg.WatchSymbols = []string{"BTC", "ETH"}
	if err := config.SaveAppConfig(cfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	s2 := NewTelemetryServer("127.0.0.1:8087", plansReg, featureReg)
	t.Cleanup(func() { s2.Close() })
	if s2.metricSymbol != "BTC" {
		t.Errorf("expected metricSymbol to be BTC, got %s", s2.metricSymbol)
	}

	// 3. WatchSymbols is empty -> falls back to ""
	cfg.WatchSymbols = []string{}
	if err := config.SaveAppConfig(cfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	s3 := NewTelemetryServer("127.0.0.1:8088", plansReg, featureReg)
	t.Cleanup(func() { s3.Close() })
	if s3.metricSymbol != "" {
		t.Errorf("expected empty WatchSymbols to fallback to empty string, got %s", s3.metricSymbol)
	}
}

func TestFeatureQueryExplicitAndDegraded(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)
	t.Setenv("DB_PATH", filepath.Join(tempDir, "gelt_journal.db"))

	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()

	mock := &mockProvider{
		points: []data.DataPoint{
			{Timestamp: time.Now(), Value: 123.45},
		},
	}
	featureReg.Register("Test.Mock", mock)

	// Unconfigured server (WatchSymbols is empty) -> metricSymbol is ""
	s := NewTelemetryServer("127.0.0.1:8089", plansReg, featureReg)
	t.Cleanup(func() { s.Close() })

	// Test 1: Explicit key supplied should work
	req1, _ := http.NewRequest("GET", "/api/v1/features/query?key=Test.Mock", nil)
	rr1 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Errorf("Explicit key returned %d, want %d", rr1.Code, http.StatusOK)
	}

	// Test 2: Omitted key should return degraded status
	req2, _ := http.NewRequest("GET", "/api/v1/features/query", nil)
	rr2 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusBadRequest {
		t.Errorf("Omitted key with empty metricSymbol returned %d, want %d", rr2.Code, http.StatusBadRequest)
	}
	var resp map[string]interface{}
	json.Unmarshal(rr2.Body.Bytes(), &resp)
	if resp["status"] != "CONFIG_INVALID" {
		t.Errorf("Expected CONFIG_INVALID status, got %v", resp["status"])
	}

	// Test 3: Metrics endpoint with empty metricSymbol should return degraded status
	req3, _ := http.NewRequest("GET", "/api/v1/metrics", nil)
	rr3 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusBadRequest {
		t.Errorf("Metrics with empty metricSymbol returned %d, want %d", rr3.Code, http.StatusBadRequest)
	}
	var resp2 map[string]interface{}
	json.Unmarshal(rr3.Body.Bytes(), &resp2)
	if resp2["status"] != "CONFIG_INVALID" {
		t.Errorf("Expected CONFIG_INVALID status, got %v", resp2["status"])
	}
}
