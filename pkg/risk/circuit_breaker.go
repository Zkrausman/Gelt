package risk

import "sync"

// EquityCurveMonitor tracks the account's High-Water Mark (HWM) and current balance
// to enforce a Global Drawdown Circuit Breaker.
type EquityCurveMonitor struct {
	mu        sync.RWMutex
	hwm       float64
	haltState bool
}

// NewEquityCurveMonitor initializes a new EquityCurveMonitor.
func NewEquityCurveMonitor(initialEquity float64) *EquityCurveMonitor {
	return &EquityCurveMonitor{
		hwm:       initialEquity,
		haltState: false,
	}
}

// CheckDrawdown evaluates the current equity against the High-Water Mark (HWM).
// If currentEquity falls below the HWM by more than maxDrawdownPercent, it triggers a HaltState.
func (e *EquityCurveMonitor) CheckDrawdown(currentEquity float64, maxDrawdownPercent float64) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Update High-Water Mark
	if currentEquity > e.hwm {
		e.hwm = currentEquity
	}

	// Calculate current drawdown percentage
	drawdownPercent := 0.0
	if e.hwm > 0 {
		drawdownPercent = ((e.hwm - currentEquity) / e.hwm) * 100.0
	}

	// Trigger halt state if drawdown exceeds threshold
	if drawdownPercent > maxDrawdownPercent {
		e.haltState = true
	}
}

// IsHalted returns the current global HaltState.
// This method is provided for the TradingPlanEngine to query and reject new SignalBuy requests.
func (e *EquityCurveMonitor) IsHalted() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.haltState
}

// ResetHalt explicitly resets the halt state and sets a new HWM.
func (e *EquityCurveMonitor) ResetHalt(newInitialEquity float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.haltState = false
	e.hwm = newInitialEquity
}

// GlobalBreaker is the singleton instance used by the trading engine to monitor global drawdown.
var GlobalBreaker = NewEquityCurveMonitor(0.0)
