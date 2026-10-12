package robinhood

import (
	"testing"
	"time"
	"gelt/pkg/store"
)

func TestExecuteSandboxOrder(t *testing.T) {
	// Initialize an in-memory SQLite store for testing
	journal, err := store.NewStore("file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("failed to create memory store: %v", err)
	}
	defer journal.Close()

	cfg := &MCPConfig{
		ServerURL: "https://agent.robinhood.com/mcp/trading",
		IsSandbox: true,
	}

	result, err := ExecuteSandboxOrder(cfg, "AAPL", 10.0, 1500.0, "BUY", journal)
	if err != nil {
		t.Fatalf("ExecuteSandboxOrder failed: %v", err)
	}

	if result.Status != "FILLED" {
		t.Errorf("expected status 'FILLED', got %s", result.Status)
	}

	if result.FillPrice != 150.0 {
		t.Errorf("expected fill price 150.0, got %f", result.FillPrice)
	}

	// Wait a tiny bit for the async write to complete
	time.Sleep(50 * time.Millisecond)

	// Query the DB directly to verify the payload was written
	rows, err := journal.DB().Query("SELECT symbol, side, quantity, execution_price FROM trades")
	if err != nil {
		t.Fatalf("failed to query trades: %v", err)
	}
	defer rows.Close()

	var count int
	for rows.Next() {
		count++
		var sym, side string
		var qty, price float64
		if err := rows.Scan(&sym, &side, &qty, &price); err != nil {
			t.Errorf("failed to scan row: %v", err)
		}
		if sym != "AAPL" || side != "BUY" || qty != 10.0 || price != 150.0 {
			t.Errorf("unexpected trade record: sym=%s, side=%s, qty=%f, price=%f", sym, side, qty, price)
		}
	}

	if count != 1 {
		t.Errorf("expected 1 trade record, got %d", count)
	}
}
