package risk

import (
	"testing"
)

func TestEquityCurveMonitor_CheckDrawdown(t *testing.T) {
	monitor := NewEquityCurveMonitor(10000.0)

	// Test 1: Equity increases, HWM updates, no halt
	monitor.CheckDrawdown(10500.0, 2.0)
	if monitor.IsHalted() {
		t.Errorf("Expected not halted, got halted")
	}

	// Test 2: Equity drops, but within threshold
	monitor.CheckDrawdown(10350.0, 2.0) // HWM is 10500, drop is ~1.43%
	if monitor.IsHalted() {
		t.Errorf("Expected not halted after minor drop, got halted")
	}

	// Test 3: Equity drops past threshold, halt triggered
	monitor.CheckDrawdown(10200.0, 2.0) // HWM is 10500, drop is > 2.0%
	if !monitor.IsHalted() {
		t.Errorf("Expected halted after critical drawdown, got not halted")
	}

	// Test 4: Check state remains halted on partial recovery
	monitor.CheckDrawdown(10600.0, 2.0)
	if !monitor.IsHalted() {
		t.Errorf("Expected to remain halted on partial recovery until manually reset")
	}

	// Test 5: Reset
	monitor.ResetHalt(10600.0)
	if monitor.IsHalted() {
		t.Errorf("Expected not halted after reset")
	}
}
