package plans

import (
	"context"
	"testing"
)

func TestPlanHotSwapper_ProposePromotion(t *testing.T) {
	registry := NewPlanRegistry()

	// Create mock plans to satisfy the registry
	mockPlan := NewCryptoPlan() // Using an existing plan type for simplicity in test
	registry.Register(mockPlan)

	swapper := NewPlanHotSwapper(registry, true)
	ctx := context.Background()

	// Test case: Promotion should fail if there are active positions
	err := swapper.ProposePromotion(ctx, mockPlan.Name(), 1)
	if err == nil {
		t.Error("Expected error when active positions exist, got nil")
	}

	// The legacy hot-swapper has no journal-integrity guard and must not become
	// an alternate automatic-promotion path.
	err = swapper.ProposePromotion(ctx, mockPlan.Name(), 0)
	if err == nil {
		t.Error("Expected guarded-promotion error when no active positions")
	}

	active, err := registry.Active()
	if err != nil {
		t.Fatalf("Failed to get active plan: %v", err)
	}
	if active.Name() != mockPlan.Name() {
		t.Errorf("Active plan changed through unguarded hot-swap: got %s", active.Name())
	}
}

func TestPlanHotSwapper_AlertOnlyMode(t *testing.T) {
	registry := NewPlanRegistry()
	mockPlan := NewCryptoPlan()
	registry.Register(mockPlan)

	// Register and set an initial active plan
	initialPlan := NewOptionsAlphaPlan()
	registry.Register(initialPlan)
	registry.SetActive(initialPlan.Name())

	swapper := NewPlanHotSwapper(registry, false) // Alert only mode
	ctx := context.Background()

	err := swapper.ProposePromotion(ctx, mockPlan.Name(), 0)
	if err != nil {
		t.Errorf("Expected nil error in alert-only mode, got %v", err)
	}

	active, err := registry.Active()
	if err == nil && active.Name() == mockPlan.Name() {
		t.Errorf("Plan should not have been promoted in alert-only mode")
	}
	if active.Name() != initialPlan.Name() {
		t.Errorf("Active plan should have remained %s, got %s", initialPlan.Name(), active.Name())
	}
}
