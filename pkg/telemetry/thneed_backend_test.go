package telemetry

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

type mockFallback struct {
	logCalled      bool
	logTradeCalled bool
	flushCalled    bool
}

func (m *mockFallback) Log(ctx context.Context, level Severity, msg string, fields ...Field) {
	m.logCalled = true
}

func (m *mockFallback) LogTrade(ctx context.Context, tradeEvent TradeTelemetryEvent) {
	m.logTradeCalled = true
}

func (m *mockFallback) Flush(ctx context.Context) error {
	m.flushCalled = true
	return nil
}

func TestThneedBackend_Fallback(t *testing.T) {
	// Test when enabled is false
	fallback := &mockFallback{}
	backend := NewThneedBackend("", false, fallback)

	ctx := context.Background()
	event := TradeTelemetryEvent{
		Symbol:    "DEMO",
		Action:    "BUY",
		Quantity:  10,
		Price:     150,
		Strategy:  "SyntheticTrendPlan",
		Timestamp: time.Now(),
	}

	backend.Log(ctx, SeverityInfo, "test msg")
	if !fallback.logCalled {
		t.Error("Expected fallback Log to be called")
	}

	backend.LogTrade(ctx, event)
	if !fallback.logTradeCalled {
		t.Error("Expected fallback LogTrade to be called")
	}

	err := backend.Flush(ctx)
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if !fallback.flushCalled {
		t.Error("Expected fallback Flush to be called")
	}

	tb := backend.(*ThneedBackend)
	// Check that eventCh wasn't written to since enabled is false
	select {
	case <-tb.eventCh:
		t.Error("Expected eventCh to be empty since backend is disabled")
	default:
		// Success
	}
}

func TestThneedBackend_NonBlocking(t *testing.T) {
	tmpDir := t.TempDir()
	fallback := &mockFallback{}
	t.Setenv("GELT_BEADS_BRAIN_PATH", tmpDir)
	backend := NewThneedBackend("", true, fallback)
	defer backend.Flush(context.Background())

	ctx := context.Background()
	event := TradeTelemetryEvent{
		Symbol:    "DEMO",
		Action:    "SELL",
		Quantity:  5,
		Price:     300,
		Strategy:  "SyntheticRangePlan",
		Timestamp: time.Now(),
	}

	// Verify LogTrade returns quickly (< 1ms)
	start := time.Now()
	backend.LogTrade(ctx, event)
	duration := time.Since(start)

	if duration > time.Millisecond {
		t.Errorf("LogTrade took too long: %v, expected < 1ms", duration)
	}

	if !fallback.logTradeCalled {
		t.Error("Expected fallback LogTrade to be called even when Thneed is enabled")
	}

	// Give worker time to process
	time.Sleep(10 * time.Millisecond)

	// Check if file was written
	files, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to read temp dir: %v", err)
	}

	if len(files) != 1 {
		t.Errorf("Expected 1 file written, got %d", len(files))
	} else {
		fileName := files[0].Name()
		if !strings.HasPrefix(fileName, "trade_telemetry_demo_") {
			t.Errorf("Unexpected file name: %s", fileName)
		}
	}
}

func TestThneedBackend_QueueFull(t *testing.T) {
	fallback := &mockFallback{}
	backend := NewThneedBackend(t.TempDir(), true, fallback)

	ctx := context.Background()

	// Flood the channel without locking or stopping the worker.
	// Since channel has capacity 1000, sending 1500 quickly should guarantee overflow.
	// Some will be consumed by the worker, but worker does file I/O which is slow.

	for i := 0; i < 1500; i++ {
		event := TradeTelemetryEvent{
			Symbol:    "DUMMY",
			Action:    "BUY",
			Quantity:  1,
			Price:     1,
			Strategy:  "TEST",
			Timestamp: time.Now(),
		}
		backend.LogTrade(ctx, event)
	}

	if !fallback.logCalled {
		t.Error("Expected fallback Log to be called due to queue full")
	}

	backend.Flush(ctx)
}

func TestThneedBackend_MkdirError(t *testing.T) {
	// Create a file to act as the base path so MkdirAll fails
	file, err := os.CreateTemp("", "mkdir_fail_test")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(file.Name())

	fallback := &mockFallback{}
	backend := NewThneedBackend(file.Name()+"/invalid_dir", true, fallback)
	defer backend.Flush(context.Background())

	ctx := context.Background()
	event := TradeTelemetryEvent{
		Symbol:    "DEMO",
		Action:    "BUY",
		Quantity:  10,
		Price:     150,
		Strategy:  "SyntheticTrendPlan",
		Timestamp: time.Now(),
	}

	// This should fail to write to the brain path
	backend.LogTrade(ctx, event)

	// Sleep slightly to let the goroutine process the channel
	time.Sleep(50 * time.Millisecond)
}

func TestThneedBackend_LogTradeClosed(t *testing.T) {
	backend := NewThneedBackend(t.TempDir(), true, nil)

	// Close it
	backend.Flush(context.Background())

	ctx := context.Background()
	event := TradeTelemetryEvent{
		Symbol:    "DEMO",
		Action:    "BUY",
		Quantity:  10,
		Price:     150,
		Strategy:  "SyntheticTrendPlan",
		Timestamp: time.Now(),
	}

	// Should hit the t.closed branch
	backend.LogTrade(ctx, event)
}

func TestThneedBackend_FlushNilFallback(t *testing.T) {
	backend := NewThneedBackend(t.TempDir(), true, nil)

	err := backend.Flush(context.Background())
	if err != nil {
		t.Errorf("Expected nil error, got %v", err)
	}
}

func TestThneedBackendWithoutConfiguredPathDisablesSync(t *testing.T) {
	t.Setenv("GELT_BEADS_BRAIN_PATH", "")
	backend := NewThneedBackend("", true, nil)
	if backend.(*ThneedBackend).enabled {
		t.Fatal("sync should be disabled when no destination is configured")
	}
	if err := backend.Flush(context.Background()); err != nil {
		t.Fatalf("flush failed: %v", err)
	}
}
