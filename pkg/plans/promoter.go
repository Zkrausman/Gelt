package plans

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
)

// PlanHotSwapper safely orchestrates mid-session plan promotion
type PlanHotSwapper struct {
	mu          sync.RWMutex
	registry    *PlanRegistry
	AutoPromote bool
}

// NewPlanHotSwapper constructs a new hot-swapper connected to the plan registry.
func NewPlanHotSwapper(registry *PlanRegistry, autoPromote bool) *PlanHotSwapper {
	return &PlanHotSwapper{
		registry:    registry,
		AutoPromote: autoPromote,
	}
}

// ProposePromotion evaluates if a promotion is safe to execute.
// It verifies there are no open positions (using a simple position count)
// to prevent mid-session conflicts.
func (p *PlanHotSwapper) ProposePromotion(ctx context.Context, planName string, activePositions int) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if activePositions > 0 {
		slog.Warn("Plan promotion aborted due to open positions", "plan", planName, "active_positions", activePositions)
		return fmt.Errorf("promotion of %q rejected: %d active positions exist", planName, activePositions)
	}

	if !p.AutoPromote {
		slog.Info("Plan promotion proposed (Alert-Only Mode)", "plan", planName)
		return nil
	}

	// This legacy hot-swapper has no shadow-journal capital/provenance guard.
	// Do not let it create an alternate promotion path; the shadow
	// PromotionEngine owns guarded promotion after evaluation.
	return fmt.Errorf("automatic plan promotion is unavailable through PlanHotSwapper; use the guarded shadow promotion engine")
}
