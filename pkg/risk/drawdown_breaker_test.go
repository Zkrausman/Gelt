package risk

import (
	"testing"
)

// MockDemoter implements PlanRegistryDemoter for testing
type MockDemoter struct {
	ActivePlan string
	Locked     bool
	DemoteErr  error
}

func (m *MockDemoter) DemotePlan(name string) error {
	if m.DemoteErr != nil {
		return m.DemoteErr
	}
	m.ActivePlan = name
	m.Locked = true
	return nil
}

func TestIntradayDrawdownMonitor_DrawdownTriggersKillSwitch(t *testing.T) {
	demoter := &MockDemoter{
		ActivePlan: "IntradayAlphaPlan",
		Locked:     false,
	}

	monitor := NewIntradayDrawdownMonitor(demoter, -1.5, "DefensiveCashPlan")

	// Set initial equity
	monitor.Reset(10000.0)

	// Update to a new peak
	monitor.UpdateEquity(10200.0)
	if monitor.peakEquity != 10200.0 {
		t.Fatalf("expected peak to be 10200.0, got %v", monitor.peakEquity)
	}

	// Small drawdown (-1.0%), should not trigger
	monitor.UpdateEquity(10098.0)
	if monitor.IsTripped() {
		t.Fatalf("expected monitor to not be tripped at -1.0%% drawdown")
	}
	if demoter.Locked {
		t.Fatalf("expected demoter not to be locked")
	}

	// -1.51% drawdown, should trigger
	// 10200 * (1 - 0.0151) = 10045.98
	monitor.UpdateEquity(10045.0)

	if !monitor.IsTripped() {
		t.Fatalf("expected monitor to be tripped at >1.5%% drawdown")
	}

	if demoter.ActivePlan != "DefensiveCashPlan" {
		t.Fatalf("expected active plan to be DefensiveCashPlan, got %v", demoter.ActivePlan)
	}

	if !demoter.Locked {
		t.Fatalf("expected plan registry to be locked after demotion")
	}
}

func TestIntradayDrawdownMonitor_KillSwitchExplicit(t *testing.T) {
	demoter := &MockDemoter{
		ActivePlan: "IntradayAlphaPlan",
		Locked:     false,
	}

	monitor := NewIntradayDrawdownMonitor(demoter, 1.5, "RangeBoundDefensivePlan")

	monitor.KillSwitch()

	if !monitor.IsTripped() {
		t.Fatalf("expected monitor to be tripped")
	}

	if demoter.ActivePlan != "RangeBoundDefensivePlan" {
		t.Fatalf("expected active plan to be RangeBoundDefensivePlan, got %v", demoter.ActivePlan)
	}

	if !demoter.Locked {
		t.Fatalf("expected lock to be true")
	}
}
