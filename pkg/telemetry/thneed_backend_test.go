package telemetry

import (
	"context"
	"gelt/pkg/thesis"
	"os"
	"reflect"
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

// This checks queue backpressure, not a wall-clock latency SLA. There is no
// worker or consumer: the queue remains full until the producer has returned.
func TestThneedBackend_NonBlocking(t *testing.T) {
	fallback := &mockFallback{}
	backend := &ThneedBackend{
		enabled:  true,
		fallback: fallback,
		eventCh:  make(chan thesis.TradeThesis, 1),
	}
	sentinel := thesis.TradeThesis{Symbol: "QUEUED_SENTINEL", Side: "BUY"}
	backend.eventCh <- sentinel
	done := make(chan struct{})
	go func() {
		backend.LogTrade(context.Background(), TradeTelemetryEvent{
			Symbol: "DEMO", Action: "SELL", Quantity: 5, Price: 300,
			Strategy: "SyntheticRangePlan", Timestamp: time.Unix(1, 0),
		})
		close(done)
	}()

	// A generous deadlock guard bounds a broken blocking-send implementation.
	// It is not a numerical performance assertion. Cleanup must join the sole
	// producer before failing; making room afterward must never count as a pass.
	watchdog := time.NewTimer(5 * time.Second)
	defer watchdog.Stop()
	select {
	case <-done:
		// The completion receive synchronizes subsequent mock-state reads.
	case <-watchdog.C:
		// If both notifications are ready, completion without a consumer still
		// proves the invariant; do not fail merely on select scheduling order.
		select {
		case <-done:
		default:
			// No consumer exists and the queue started full. Release controlled
			// capacity to unblock the specific blocking-send regression, then join.
			select {
			case <-backend.eventCh:
			default:
			}
			<-done
			t.Fatal("LogTrade waited for queue capacity; watchdog cleanup released capacity and joined producer")
		}
	}
	if !fallback.logTradeCalled || !fallback.logCalled {
		t.Fatal("full queue must preserve trade fallback and report the dropped event")
	}
	if len(backend.eventCh) != 1 {
		t.Fatal("full queue changed before any consumer released capacity")
	}
	if got := <-backend.eventCh; !reflect.DeepEqual(got, sentinel) {
		t.Fatal("LogTrade replaced the queued sentinel instead of dropping the new event")
	}
}

func TestThneedBackend_WorkerFlushCompletesWrite(t *testing.T) {
	tmpDir := t.TempDir()
	fallback := &mockFallback{}
	backend := NewThneedBackend(tmpDir, true, fallback)
	ctx := context.Background()
	backend.LogTrade(ctx, TradeTelemetryEvent{
		Symbol: "DEMO", Action: "SELL", Quantity: 5, Price: 300,
		Strategy: "SyntheticRangePlan", Timestamp: time.Unix(1, 0),
	})
	// Flush joins the actual worker; no sleep or scheduling assumption decides
	// whether the test-owned file is ready. No producer runs concurrently here.
	if err := backend.Flush(ctx); err != nil {
		t.Fatalf("flush failed: %v", err)
	}
	if !fallback.logTradeCalled || !fallback.flushCalled {
		t.Fatal("expected trade and flush fallback calls")
	}
	files, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("failed to read test-owned directory: %v", err)
	}
	if len(files) != 1 || !strings.HasPrefix(files[0].Name(), "trade_telemetry_demo_") {
		t.Fatalf("expected one completed telemetry file, got %v", files)
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
