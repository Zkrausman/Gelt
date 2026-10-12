package macro

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"gelt/pkg/robinhood"
)

func TestMCPMacroProvider_Caching(t *testing.T) {
	var callCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		w.Header().Set("Content-Type", "application/json")
		// Simulate Robinhood MCP quote response
		w.Write([]byte(`{"result": {"symbol": "VIX", "last_trade_price": "16.50"}}`))
	}))
	defer server.Close()

	cfg := &robinhood.MCPConfig{
		ServerURL: server.URL,
		AuthToken: "mock-token",
	}

	provider := NewMCPMacroProvider(cfg)
	ctx := context.Background()

	// First call should hit the server
	vix1, err := provider.FetchVIX(ctx)
	if err != nil {
		t.Fatalf("FetchVIX failed: %v", err)
	}
	if vix1 != 16.50 {
		t.Errorf("Expected VIX 16.50, got %v", vix1)
	}

	if atomic.LoadInt32(&callCount) != 1 {
		t.Errorf("Expected 1 API call, got %d", atomic.LoadInt32(&callCount))
	}

	// Second call should use cache
	vix2, err := provider.FetchVIX(ctx)
	if err != nil {
		t.Fatalf("FetchVIX failed on second call: %v", err)
	}
	if vix2 != 16.50 {
		t.Errorf("Expected VIX 16.50, got %v", vix2)
	}

	if atomic.LoadInt32(&callCount) != 1 {
		t.Errorf("Expected API calls to remain 1 due to caching, got %d", atomic.LoadInt32(&callCount))
	}
}
