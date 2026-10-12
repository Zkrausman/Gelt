package server

import (
	"bytes"
	"encoding/json"
	"gelt/pkg/data"
	"gelt/pkg/plans"
	"gelt/pkg/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleGetDynamicStrategies(t *testing.T) {
	// Initialize server with memory DB
	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()
	s := NewTelemetryServer("127.0.0.1:8085", plansReg, featureReg)
	s.store, _ = store.NewStore(":memory:")

	// Pre-insert a strategy
	s.store.InsertDynamicStrategy("test-id-1", []byte(`{"name":"Strat1", "signal":"BUY"}`))

	req, _ := http.NewRequest("GET", "/api/v1/strategies/dynamic", nil)
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status OK, got %v", rr.Code)
	}

	var results []map[string]interface{}
	err := json.Unmarshal(rr.Body.Bytes(), &results)
	if err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("Expected 1 strategy, got %d", len(results))
	}
	if results[0]["id"] != "test-id-1" || results[0]["name"] != "Strat1" {
		t.Errorf("Unexpected strategy content: %v", results[0])
	}
}

func TestHandlePostDynamicStrategy(t *testing.T) {
	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()
	s := NewTelemetryServer("127.0.0.1:8085", plansReg, featureReg)
	s.store, _ = store.NewStore(":memory:")

	// Valid payload
	payload := []byte(`{
		"name": "My New Strat",
		"description": "Test",
		"signal": "BUY",
		"conditions": [
			{"feature_key": "Equity.SPY", "operator": ">", "threshold": 100}
		]
	}`)
	req, _ := http.NewRequest("POST", "/api/v1/strategies/dynamic", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf("Expected status Created, got %v. Body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["id"] == "" {
		t.Errorf("Expected ID to be returned, got empty")
	}

	// Verify in DB
	strats, _ := s.store.GetDynamicStrategies()
	if len(strats) != 1 {
		t.Errorf("Expected 1 strategy in DB, got %d", len(strats))
	}

	// Invalid payload (empty conditions)
	payload2 := []byte(`{
		"name": "My New Strat",
		"signal": "BUY",
		"conditions": []
	}`)
	req2, _ := http.NewRequest("POST", "/api/v1/strategies/dynamic", bytes.NewBuffer(payload2))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusBadRequest {
		t.Errorf("Expected Bad Request for invalid payload, got %v", rr2.Code)
	}
}

func TestHandleDeleteDynamicStrategy(t *testing.T) {
	plansReg := plans.DefaultPlanSuite()
	featureReg := data.NewFeatureRegistry()
	s := NewTelemetryServer("127.0.0.1:8085", plansReg, featureReg)
	s.store, _ = store.NewStore(":memory:")

	s.store.InsertDynamicStrategy("test-id-delete", []byte(`{"name":"StratToDelete"}`))

	// Delete via path
	req, _ := http.NewRequest("DELETE", "/api/v1/strategies/dynamic/test-id-delete", nil)
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status OK, got %v. Body: %s", rr.Code, rr.Body.String())
	}

	strats, _ := s.store.GetDynamicStrategies()
	if len(strats) != 0 {
		t.Errorf("Expected empty DB after delete, got %d", len(strats))
	}

	// Delete missing ID
	req2, _ := http.NewRequest("DELETE", "/api/v1/strategies/dynamic/", nil)
	rr2 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusBadRequest {
		t.Errorf("Expected Bad Request for missing ID, got %v", rr2.Code)
	}
}
