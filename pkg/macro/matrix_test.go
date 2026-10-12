package macro

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestMacroMatrix(t *testing.T) {
	// Create mock server
	mockResponses := map[string]string{
		"EFFR":     `{"observations": [{"date": "2023-10-01", "value": "5.33"}]}`,
		"CPIAUCSL": `{"observations": [{"date": "2023-10-01", "value": "307.789"}]}`,
		"DGS10":    `{"observations": [{"date": "2023-10-01", "value": "4.8"}]}`,
		"PAYEMS":   `{"observations": [{"date": "2023-10-01", "value": "156900"}]}`,
	}

	mu := sync.Mutex{}
	callCounts := map[string]int{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seriesID := r.URL.Query().Get("series_id")

		mu.Lock()
		callCounts[seriesID]++
		mu.Unlock()

		resp, ok := mockResponses[seriesID]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(resp))
	}))
	defer server.Close()

	client := NewClient("mock-api-key")
	client.BaseURL = server.URL

	matrix := NewMacroMatrix()

	// Initial fetch
	StartMatrixIngestion(client, matrix, 10*time.Millisecond)

	// Verify initial fetch
	expected := map[string]float64{
		SeriesEFFR: 5.33,
		SeriesCPI:  307.789,
		Series10Y:  4.8,
		SeriesNFP:  156900,
	}

	for id, expectedVal := range expected {
		data := matrix.Get(id)
		if data == nil {
			t.Fatalf("expected matrix to have data for %s", id)
		}
		if data.Value != expectedVal {
			t.Errorf("expected value %f for %s, got %f", expectedVal, id, data.Value)
		}
	}

	// Wait for ticker to poll
	time.Sleep(30 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	for id := range expected {
		if callCounts[id] < 2 {
			t.Errorf("expected %s to be called at least 2 times, got %d", id, callCounts[id])
		}
	}
}

func TestMacroMatrixErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Mock an invalid JSON response
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`invalid json`))
	}))
	defer server.Close()

	client := NewClient("mock-api-key")
	client.BaseURL = server.URL

	matrix := NewMacroMatrix()

	StartMatrixIngestion(client, matrix, 10*time.Millisecond)

	// Since parsing will fail, the matrix should remain empty
	expected := []string{SeriesEFFR, SeriesCPI, Series10Y, SeriesNFP}
	for _, id := range expected {
		data := matrix.Get(id)
		if data != nil {
			t.Errorf("expected matrix to have no data for %s, got %v", id, data)
		}
	}
}
