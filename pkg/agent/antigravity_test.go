package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"gelt/pkg/macro"
)

func TestAntigravityAgentClient_Dispatch(t *testing.T) {
	// Create a mock server to return a sample InteractionResponse
	expectedResponse := InteractionResponse{
		SessionID: "test-session",
		Artifact:  "{\"test\":\"data\"}",
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("Expected POST request, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "Bearer test-api-key" {
			t.Errorf("Expected Authorization header, got %s", r.Header.Get("Authorization"))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(expectedResponse)
	}))
	defer server.Close()

	// Initialize the client with the mock server URL
	client := NewAntigravityAgentClient(Config{
		Endpoint: server.URL,
		APIKey:   "test-api-key",
	})

	// Dispatch a payload
	payload := InteractionPayload{
		SessionID: "test-session",
		Prompt:    "analyze market",
	}
	resp, err := client.Dispatch(context.Background(), payload)
	if err != nil {
		t.Fatalf("Dispatch failed: %v", err)
	}

	// Verify the response
	if resp.SessionID != expectedResponse.SessionID {
		t.Errorf("Expected SessionID %s, got %s", expectedResponse.SessionID, resp.SessionID)
	}
	if resp.Artifact != expectedResponse.Artifact {
		t.Errorf("Expected Artifact %s, got %s", expectedResponse.Artifact, resp.Artifact)
	}
}

func TestWriteRegimeMatrix(t *testing.T) {
	// Create a temporary home directory for testing
	tempHome, err := os.MkdirTemp("", "gelt-test-home-*")
	if err != nil {
		t.Fatalf("failed to create temp home dir: %v", err)
	}
	defer os.RemoveAll(tempHome)

	// Override the HOME and USERPROFILE environment variables for cross-platform test safety
	t.Setenv("HOME", tempHome)
	t.Setenv("USERPROFILE", tempHome)

	// Define a test matrix
	matrix := macro.RegimeMatrix{
		Score:           75.5,
		MarketSentiment: 80.0,
		VolatilityFlags: map[string]bool{"high_vol": true},
		AssetBiases:     map[string]float64{"BTC": 1.5},
	}

	// Write the matrix
	if err := WriteRegimeMatrix(matrix); err != nil {
		t.Fatalf("WriteRegimeMatrix failed: %v", err)
	}

	// Verify the file was created and contains the correct data
	geltDir := filepath.Join(tempHome, ".gelt")
	path := filepath.Join(geltDir, "regime_matrix.json")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatalf("Expected file %s to exist", path)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("Failed to read file %s: %v", path, err)
	}

	var readMatrix macro.RegimeMatrix
	if err := json.Unmarshal(data, &readMatrix); err != nil {
		t.Fatalf("Failed to unmarshal file data: %v", err)
	}

	if readMatrix.Score != matrix.Score {
		t.Errorf("Expected Score %f, got %f", matrix.Score, readMatrix.Score)
	}
	if readMatrix.MarketSentiment != matrix.MarketSentiment {
		t.Errorf("Expected MarketSentiment %f, got %f", matrix.MarketSentiment, readMatrix.MarketSentiment)
	}
	if !readMatrix.VolatilityFlags["high_vol"] {
		t.Errorf("Expected VolatilityFlags[\"high_vol\"] to be true")
	}
	if readMatrix.AssetBiases["BTC"] != 1.5 {
		t.Errorf("Expected AssetBiases[\"BTC\"] to be 1.5, got %f", readMatrix.AssetBiases["BTC"])
	}
}
