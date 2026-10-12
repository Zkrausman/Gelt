package robinhood

import (
	"fmt"
	"math/rand"
	"time"

	"gelt/pkg/store"
)

// ExecuteSandboxOrder simulates the execution of an order in a sandbox environment.
// It bypasses the live MCP tool invocation and logs the simulated trade execution to the local journal.
func ExecuteSandboxOrder(cfg *MCPConfig, symbol string, quantity float64, amountUSD float64, side string, journal *store.Store) (*OrderResult, error) {
	if cfg == nil {
		return nil, fmt.Errorf("sandbox order requires MCPConfig")
	}

	fillPrice := 0.0
	if quantity > 0 {
		fillPrice = amountUSD / quantity
	}

	// Generate a simulated order ID
	orderID := fmt.Sprintf("rh-sandbox-%04x-%04x-%d", rand.Intn(0xffff), rand.Intn(0xffff), time.Now().UnixNano())

	result := &OrderResult{
		OrderID:   orderID,
		Symbol:    symbol,
		Quantity:  quantity,
		Side:      side,
		Status:    "FILLED",
		FillPrice: fillPrice,
	}

	// Write dry-run payload to gelt_journal.db (or the provided store)
	if journal != nil {
		trade := store.TradeRecord{
			Timestamp:      time.Now().UTC(),
			Symbol:         symbol,
			Side:           side,
			Quantity:       quantity,
			ExecutionPrice: fillPrice,
			RealizedPnL:    0.0,
			ActivePlan:     "sandbox-dry-run",
			MacroRegime:    "sandbox-regime",
		}
		journal.InsertTrade(trade)
	} else {
		return nil, fmt.Errorf("journal store is required for sandbox dry-run logging")
	}

	return result, nil
}
