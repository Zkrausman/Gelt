package plans

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"gelt/pkg/notify"
	"gelt/pkg/regime"
	"gelt/pkg/risk"
	"gelt/pkg/strategies"
)

// PlanRegistry manages trading plans and tracks the single active trading plan using thread-safe state locks.
type PlanRegistry struct {
	mu              sync.RWMutex
	evalLock        sync.RWMutex
	plans           map[string]TradingPlan
	activeName      string
	defensiveLocked bool // Session hysteresis lock to prevent continuous thrashing
}

// NewPlanRegistry constructs an empty PlanRegistry.
func NewPlanRegistry() *PlanRegistry {
	return &PlanRegistry{
		plans: make(map[string]TradingPlan),
	}
}

// Register adds a trading plan to the registry.
func (r *PlanRegistry) Register(p TradingPlan) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.plans[p.Name()] = p
	if r.activeName == "" {
		r.activeName = p.Name()
	}
}

// SetActive performs a thread-safe hot-swap of the active trading plan.
// It waits for any active evaluation tick to complete before applying the state transition.
func (r *PlanRegistry) SetActive(name string) error {
	r.evalLock.Lock()
	defer r.evalLock.Unlock()

	r.mu.Lock()
	p, exists := r.plans[name]
	if !exists {
		r.mu.Unlock()
		return fmt.Errorf("trading plan %q not found in registry", name)
	}

	oldPlan := r.activeName
	if oldPlan == name {
		r.mu.Unlock()
		return nil
	}

	r.activeName = name
	r.defensiveLocked = false // Manual CLI set resets hysteresis lock
	r.mu.Unlock()

	fmt.Printf("[STATE CHANGE] Active Plan seamlessly transitioned from %s to %s.\n", oldPlan, p.Name())
	return nil
}

// Active returns the currently active TradingPlan.
func (r *PlanRegistry) Active() (TradingPlan, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, exists := r.plans[r.activeName]
	if !exists {
		return nil, fmt.Errorf("no active trading plan configured")
	}
	return p, nil
}

// EvaluateActive executes signal evaluation under a read-lock on the active plan,
// preventing mid-evaluation state corruption during hot-swaps.
func (r *PlanRegistry) EvaluateActive(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error) {
	r.evalLock.RLock()
	defer r.evalLock.RUnlock()

	active, err := r.Active()
	if err != nil {
		return PlanEvaluation{}, err
	}

	eval, err := active.Evaluate(ctx, evalTime, symbol, closes, volumes)
	if err != nil {
		return eval, err
	}

	if risk.GlobalBreaker.IsHalted() && eval.ConsensusSignal == strategies.SignalBuy {
		eval.ConsensusSignal = strategies.SignalHold
		eval.Rationale += " | [REJECTED] Global Drawdown Circuit Breaker is active"
	}

	return eval, nil
}

// EvaluateRegimeAndAutoSwap evaluates macro volatility (VIX and EMA slope) via pkg/regime.
// If HIGH_VOLATILITY_CHOP is detected and the hysteresis lock is not engaged, it automatically acquires evalLock
// and hot-swaps the active trading plan to RangeBoundDefensivePlan.
func (r *PlanRegistry) EvaluateRegimeAndAutoSwap(vix float64, closes []float64) (*regime.RegimeStatus, bool, error) {
	status, err := regime.EvaluateRegime(vix, closes)
	if err != nil {
		return nil, false, fmt.Errorf("regime evaluation failed: %w", err)
	}

	if status.AlertTriggered && status.RecommendedPlan != "" {
		r.evalLock.Lock()
		defer r.evalLock.Unlock()

		r.mu.Lock()
		defer r.mu.Unlock()

		if !r.defensiveLocked && r.activeName != status.RecommendedPlan {
			oldPlan := r.activeName
			targetPlan := status.RecommendedPlan

			if _, exists := r.plans[targetPlan]; exists {
				r.activeName = targetPlan
				r.defensiveLocked = true // Engages session hysteresis lock

				msg := fmt.Sprintf("%s\n[AUTONOMOUS REGIME SWITCH] Active Plan automatically transitioned from %s to %s.\n", status.AlertMessage, oldPlan, targetPlan)
				fmt.Print(msg)
				notify.DefaultDispatcher.Dispatch(notify.SeverityWarning, "AUTONOMOUS_SWAP", msg)
				return status, true, nil
			}
		}
	}

	return status, false, nil
}

// ResetHysteresis unlocks the defensive session lock.
func (r *PlanRegistry) ResetHysteresis() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.defensiveLocked = false
}

// IsDefensiveLocked returns whether the session hysteresis safety lock is active.
func (r *PlanRegistry) IsDefensiveLocked() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.defensiveLocked
}

// Get retrieves a trading plan by name.
func (r *PlanRegistry) Get(name string) (TradingPlan, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, exists := r.plans[name]
	if !exists {
		return nil, fmt.Errorf("trading plan %q not found in registry", name)
	}
	return p, nil
}

// List returns all registered trading plans sorted by name.
func (r *PlanRegistry) List() []TradingPlan {
	r.mu.RLock()
	defer r.mu.RUnlock()

	list := make([]TradingPlan, 0, len(r.plans))
	for _, p := range r.plans {
		list = append(list, p)
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].Name() < list[j].Name()
	})

	return list
}

// PromotePlan performs an atomic hot-swap of the active live trading plan,
// acquiring the evaluation lock to block concurrent EvaluateActive ticks.
func (r *PlanRegistry) PromotePlan(name string) error {
	r.evalLock.Lock()
	defer r.evalLock.Unlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.defensiveLocked {
		return fmt.Errorf("promotion blocked: session defensive lock is active")
	}

	if _, exists := r.plans[name]; !exists {
		return fmt.Errorf("trading plan %q not found in registry", name)
	}

	oldPlan := r.activeName
	if oldPlan == name {
		return nil
	}

	r.activeName = name
	r.defensiveLocked = false

	slog.Info("Active Plan seamlessly promoted",
		"old_plan", oldPlan,
		"new_plan", name,
	)

	return nil
}

// DemotePlan performs an atomic hot-swap of the active live trading plan to a defensive baseline,
// acquiring the evaluation lock to block concurrent EvaluateActive ticks, and engages the session hysteresis lock.
func (r *PlanRegistry) DemotePlan(name string) error {
	r.evalLock.Lock()
	defer r.evalLock.Unlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.plans[name]; !exists {
		return fmt.Errorf("trading plan %q not found in registry", name)
	}

	oldPlan := r.activeName
	if oldPlan == name {
		r.defensiveLocked = true
		return nil
	}

	r.activeName = name
	r.defensiveLocked = true

	slog.Warn("Active Plan demoted due to kill switch",
		"old_plan", oldPlan,
		"new_plan", name,
	)

	return nil
}
