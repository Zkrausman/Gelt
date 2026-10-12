package plans

import (
	"context"
	"sync"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/strategies"
)

// MockPlan is a simple trading plan for testing
type MockPlan struct {
	name string
}




func (m *MockPlan) Name() string { return m.name }

func (m *MockPlan) Description() string { return "Mock description" }

func (m *MockPlan) Init(registry *data.FeatureRegistry) error { return nil }

func (m *MockPlan) Strategies() []WeightedStrategy { return nil }




func (m *MockPlan) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error) {
	// Simulate some work
	time.Sleep(1 * time.Millisecond)
	return PlanEvaluation{
		ConsensusSignal: strategies.SignalBuy,
		Rationale:       "mock evaluation",
	}, nil
}

func TestPlanRegistry_PromotePlan_Concurrency(t *testing.T) {
	registry := NewPlanRegistry()

	planA := &MockPlan{name: "PlanA"}
	planB := &MockPlan{name: "PlanB"}

	registry.Register(planA)
	registry.Register(planB)

	// Ensure initial active plan is A
	if registry.activeName != "PlanA" {
		t.Fatalf("Expected active plan to be PlanA, got %s", registry.activeName)
	}

	var wg sync.WaitGroup
	ctx := context.Background()
	evalTime := time.Now()
	closes := []float64{100.0, 101.0}
	volumes := []float64{1000, 1100}

	// Spawn 100 parallel goroutines calling EvaluateActive
	numEvals := 100
	for i := 0; i < numEvals; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Call EvaluateActive a few times to increase race condition likelihood
			for j := 0; j < 5; j++ {
				_, err := registry.EvaluateActive(ctx, evalTime, "AAPL", closes, volumes)
				if err != nil {
					t.Errorf("EvaluateActive failed: %v", err)
				}
				time.Sleep(time.Millisecond)
			}
		}()
	}

	// Concurrently call PromotePlan
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond) // Let evaluations start
		err := registry.PromotePlan("PlanB")
		if err != nil {
			t.Errorf("PromotePlan failed: %v", err)
		}
	}()

	wg.Wait()

	active, err := registry.Active()
	if err != nil {
		t.Fatalf("Failed to get active plan: %v", err)
	}
	if active.Name() != "PlanB" {
		t.Errorf("Expected active plan to be PlanB after promotion, got %s", active.Name())
	}

	if registry.IsDefensiveLocked() {
		t.Errorf("Expected defensive locked to be false after promotion")
	}
}

func (m *MockPlan) SetParams(params map[string]float64) {}
