package orchestrator

import (
	"context"
	"sync"
	"testing"

	"gelt/pkg/agent"
	"gelt/pkg/config"
)

// mockClient is a dummy client for testing.
type mockClient struct {
	calls int
	mu    sync.Mutex
}

func (m *mockClient) Dispatch(ctx context.Context, payload agent.InteractionPayload) (*agent.InteractionResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	return &agent.InteractionResponse{}, nil
}

func TestDispatcher_QuotaLimit(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	client := &mockClient{}

	cfg := config.DispatcherConfig{
		MaxMonthlyCalls:        100,
		ATRSpikeThreshold:      2.5,
		DecisionScoreThreshold: 85.0,
	}

	dispatcher, err := NewDispatcher(client, cfg, nil)
	if err != nil {
		t.Fatalf("Failed to initialize dispatcher: %v", err)
	}

	ctx := context.Background()

	// Exhaust the quota
	for i := 0; i < cfg.MaxMonthlyCalls; i++ {
		err := dispatcher.DispatchAgent(ctx, "Test prompt")
		if err != nil {
			t.Fatalf("Expected success on call %d, got error: %v", i+1, err)
		}
	}

	// 101st call should fail
	err = dispatcher.DispatchAgent(ctx, "Test prompt")
	if err == nil {
		t.Fatalf("Expected error when exceeding quota, got nil")
	}

	if client.calls != cfg.MaxMonthlyCalls {
		t.Fatalf("Expected %d client calls, got %d", cfg.MaxMonthlyCalls, client.calls)
	}
}

func TestDispatcher_VolatilityTrigger(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	client := &mockClient{}

	cfg := config.DispatcherConfig{
		MaxMonthlyCalls:        100,
		ATRSpikeThreshold:      2.5,
		DecisionScoreThreshold: 85.0,
	}

	dispatcher, err := NewDispatcher(client, cfg, nil)
	if err != nil {
		t.Fatalf("Failed to initialize dispatcher: %v", err)
	}

	ctx := context.Background()

	// Should trigger (ATR spike)
	err = dispatcher.VolatilityTrigger(ctx, 2.6, 50.0)
	if err != nil {
		t.Fatalf("Expected success on ATR trigger, got: %v", err)
	}

	// Should trigger (Decision score)
	err = dispatcher.VolatilityTrigger(ctx, 1.0, 86.0)
	if err != nil {
		t.Fatalf("Expected success on score trigger, got: %v", err)
	}

	// Should not trigger
	err = dispatcher.VolatilityTrigger(ctx, 1.0, 50.0)
	if err != nil {
		t.Fatalf("Expected nil err when no trigger, got: %v", err)
	}

	if client.calls != 2 {
		t.Fatalf("Expected 2 client calls, got %d", client.calls)
	}
}

func TestDispatcher_Concurrency(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	client := &mockClient{}

	cfg := config.DispatcherConfig{
		MaxMonthlyCalls:        100,
		ATRSpikeThreshold:      2.5,
		DecisionScoreThreshold: 85.0,
	}

	dispatcher, err := NewDispatcher(client, cfg, nil)
	if err != nil {
		t.Fatalf("Failed to initialize dispatcher: %v", err)
	}

	var wg sync.WaitGroup
	ctx := context.Background()

	// Attempt to dispatch 150 times concurrently
	// Only 100 should succeed
	numAttempts := 150

	for i := 0; i < numAttempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = dispatcher.DispatchAgent(ctx, "Concurrent prompt")
		}()
	}

	wg.Wait()

	if client.calls != cfg.MaxMonthlyCalls {
		t.Fatalf("Expected exactly %d client calls under concurrent load, got %d", cfg.MaxMonthlyCalls, client.calls)
	}
}
