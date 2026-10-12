package risk

import (
	"log/slog"
	"sync"
)

// PlanRegistryDemoter is an interface abstracting the DemotePlan method of plans.PlanRegistry
// to avoid an import cycle between pkg/risk and pkg/plans.
type PlanRegistryDemoter interface {
	DemotePlan(name string) error
}

// IntradayDrawdownMonitor tracks the peak value of the active plan/account during a live session.
// It acts as a hard kill switch if the intraday drawdown exceeds a configured limit,
// demoting the active strategy to a defensive baseline and locking it for the session.
type IntradayDrawdownMonitor struct {
	mu           sync.RWMutex
	registry     PlanRegistryDemoter
	peakEquity   float64
	drawdownPct  float64
	fallbackPlan string
	tripped      bool
}

// NewIntradayDrawdownMonitor initializes a new IntradayDrawdownMonitor.
func NewIntradayDrawdownMonitor(registry PlanRegistryDemoter, maxDrawdownPct float64, fallbackPlan string) *IntradayDrawdownMonitor {
	return &IntradayDrawdownMonitor{
		registry:     registry,
		drawdownPct:  maxDrawdownPct,
		fallbackPlan: fallbackPlan,
	}
}

// UpdateEquity evaluates the current equity against the peak observed equity.
// If the current drawdown exceeds the configured limit, it triggers the KillSwitch.
func (m *IntradayDrawdownMonitor) UpdateEquity(currentEquity float64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.tripped {
		return // Already demoted
	}

	if currentEquity > m.peakEquity {
		m.peakEquity = currentEquity
		return
	}

	if m.peakEquity > 0 {
		currentDrawdownPct := ((m.peakEquity - currentEquity) / m.peakEquity) * 100.0

		// Check against max allowed drawdown (e.g., -1.5%).
		// If provided as negative (e.g. -1.5), flip it to compare.
		limit := m.drawdownPct
		if limit < 0 {
			limit = -limit
		}

		if currentDrawdownPct > limit {
			m.tripped = true
			m.killSwitchNoLock()
		}
	}
}

// killSwitchNoLock handles the demotion. It assumes mu is held.
func (m *IntradayDrawdownMonitor) killSwitchNoLock() {
	slog.Warn("EMERGENCY: Intraday drawdown exceeded limit, triggering kill switch",
		"fallback_plan", m.fallbackPlan,
	)

	err := m.registry.DemotePlan(m.fallbackPlan)
	if err != nil {
		slog.Error("Failed to demote plan via kill switch", "error", err)
	}
}

// KillSwitch is an explicit trigger to activate the demotion logic.
func (m *IntradayDrawdownMonitor) KillSwitch() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.tripped {
		return
	}
	m.tripped = true
	m.killSwitchNoLock()
}

// Reset resets the monitor for a new session.
func (m *IntradayDrawdownMonitor) Reset(initialEquity float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.peakEquity = initialEquity
	m.tripped = false
}

// IsTripped returns true if the kill switch has been activated during the current session.
func (m *IntradayDrawdownMonitor) IsTripped() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tripped
}
