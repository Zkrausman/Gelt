package macro

import (
	"testing"
	"time"
)

func TestAsyncFREDNoBlocking(t *testing.T) {
	client := NewClient("") // Empty API key forces offline fallback path

	start := time.Now()
	ch := client.FetchSeriesAsync("EFFR")
	elapsed := time.Since(start)

	// FetchSeriesAsync must return immediately without waiting for network/goroutine
	if elapsed > 10*time.Millisecond {
		t.Errorf("FetchSeriesAsync took %v, expected non-blocking < 10ms return", elapsed)
	}

	select {
	case data := <-ch:
		if data == nil {
			t.Fatalf("expected non-nil macro data from channel")
		}
		if data.SeriesID != "EFFR" {
			t.Errorf("expected series ID EFFR, got %s", data.SeriesID)
		}
		if data.Value <= 0 {
			t.Errorf("expected positive EFFR value, got %.2f", data.Value)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timed out waiting for async FRED channel response")
	}
}

func TestCachedMacroData(t *testing.T) {
	client := NewClient("mock-api-key")

	sample := &MacroData{
		SeriesID:  "FEDFUNDS",
		Value:     5.25,
		Date:      "2026-07-01",
		Timestamp: time.Now(),
	}

	client.mu.Lock()
	client.cache["FEDFUNDS"] = sample
	client.mu.Unlock()

	cached := client.GetCached("FEDFUNDS")
	if cached == nil || cached.Value != 5.25 {
		t.Errorf("expected cached value 5.25, got %v", cached)
	}

	// Async call should return cached data instantly
	ch := client.FetchSeriesAsync("FEDFUNDS")
	select {
	case data := <-ch:
		if data.Value != 5.25 {
			t.Errorf("expected cached value 5.25 from async fetch, got %.2f", data.Value)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("timed out waiting for cached async channel response")
	}
}
