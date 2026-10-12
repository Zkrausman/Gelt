package data

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type mockVolumeProvider struct {
	points []DataPoint
	err    error
	mu     sync.RWMutex
}

func (m *mockVolumeProvider) Fetch(ctx context.Context, req FeatureRequest) ([]DataPoint, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.err != nil {
		return nil, m.err
	}
	res := make([]DataPoint, len(m.points))
	copy(res, m.points)
	return res, nil
}

func (m *mockVolumeProvider) setPoints(points []DataPoint) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.points = points
}

func (m *mockVolumeProvider) setErr(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.err = err
}

func TestCryptoVolumeScreener_CancellationAndIdempotency(t *testing.T) {
	provider := &mockVolumeProvider{}
	screener := NewCryptoVolumeScreener(provider)

	ctx, cancel := context.WithCancel(context.Background())

	waitFn, err := screener.Start(ctx)
	if err != nil {
		t.Fatalf("expected Start to succeed, got %v", err)
	}

	// Idempotency check
	_, err = screener.Start(ctx)
	if err == nil {
		t.Fatalf("expected duplicate Start to return error")
	}

	// Trigger cancellation
	cancel()

	// Deterministic wait for shutdown
	waitFn()
}

func TestCryptoVolumeScreener_RestartLifecycle(t *testing.T) {
	provider := &mockVolumeProvider{}
	screener := NewCryptoVolumeScreener(provider)

	ctx1, cancel1 := context.WithCancel(context.Background())
	waitFn1, err := screener.Start(ctx1)
	if err != nil {
		t.Fatalf("Start 1 failed: %v", err)
	}

	var waiter1Returned int32
	var waiter1Ready sync.WaitGroup
	waiter1Ready.Add(1)

	// We trigger Wait on the specific generation 1
	go func() {
		waiter1Ready.Done()
		waitFn1()
		atomic.StoreInt32(&waiter1Returned, 1)
	}()

	waiter1Ready.Wait()

	ctx2, cancel2 := context.WithCancel(context.Background())

	// Create a goroutine that continuously tries to start generation 2
	started2 := make(chan struct{})
	var waitFn2 func()
	go func() {
		for {
			var err2 error
			if waitFn2, err2 = screener.Start(ctx2); err2 == nil {
				close(started2)
				break
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()

	// Since we haven't cancelled gen 1 yet, it should STILL be running,
	// meaning waiter1 has not returned and gen 2 has not started.
	time.Sleep(20 * time.Millisecond)
	if atomic.LoadInt32(&waiter1Returned) == 1 {
		t.Fatalf("waitFn1 returned before cancellation")
	}

	select {
	case <-started2:
		t.Fatalf("Generation 2 started before generation 1 finished")
	default:
	}

	// Cancel generation 1.
	cancel1()

	// Wait for generation 2 to successfully start.
	// This means Start() got the lock, saw isRunning == false, and set it to true.
	<-started2

	// Because waitFn1 is explicitly tied to generation 1's exit, it MUST have unblocked
	// during generation 1's exit defer BEFORE generation 2 could get the lock to start,
	// OR they raced for the lock. Either way, waitFn1 is safe and completely isolated from generation 2!
	// We wait to ensure the goroutine finishes its atomic write.
	for i := 0; i < 50; i++ {
		if atomic.LoadInt32(&waiter1Returned) == 1 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}

	if atomic.LoadInt32(&waiter1Returned) != 1 {
		t.Fatalf("waitFn1 did not return after generation 1 finished")
	}

	// Generation 2 is now live, and waitFn1 safely returned.
	// We verify we can wait on generation 2 explicitly.
	var waiter2Returned int32
	go func() {
		waitFn2()
		atomic.StoreInt32(&waiter2Returned, 1)
	}()

	cancel2()

	for i := 0; i < 50; i++ {
		if atomic.LoadInt32(&waiter2Returned) == 1 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}

	if atomic.LoadInt32(&waiter2Returned) != 1 {
		t.Fatalf("waitFn2 did not return after generation 2 was cancelled")
	}
}

func TestCryptoVolumeScreener_ConcurrentAccess(t *testing.T) {
	provider := &mockVolumeProvider{
		points: []DataPoint{
			{Timestamp: time.Now().Add(-24 * time.Hour), Value: 100},
			{Timestamp: time.Now(), Value: 100},
		},
	}
	screener := NewCryptoVolumeScreener(provider)

	ctx, cancel := context.WithCancel(context.Background())
	waitFn, _ := screener.Start(ctx)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			screener.SetTimeFunc(time.Now)
			screener.SetSymbols([]string{"Crypto.BTC.Volume", "Crypto.ETH.Volume"})
			_ = screener.LastChecked("Crypto.BTC.Volume")
		}()
	}

	wg.Wait()
	cancel()
	waitFn()
}

func TestCryptoVolumeScreener_OwnedSymbolIsolation(t *testing.T) {
	provider := &mockVolumeProvider{}
	screener := NewCryptoVolumeScreener(provider)

	symbols := []string{"SymbolA"}
	screener.SetSymbols(symbols)

	symbols[0] = "SymbolB"

	screener.CheckVolumes(context.Background())

	if screener.LastChecked("SymbolA").IsZero() {
		t.Fatalf("Expected SymbolA to be processed")
	}
	if !screener.LastChecked("SymbolB").IsZero() {
		t.Fatalf("Expected SymbolB to NOT be processed (mutation leaked!)")
	}
}

func TestCryptoVolumeScreener_OutOfOrderData(t *testing.T) {
	now := time.Now()
	provider := &mockVolumeProvider{
		points: []DataPoint{
			{Timestamp: now, Value: 500}, // Current (spike point)
			{Timestamp: now.Add(-10 * time.Minute), Value: 100}, // Mid point
			{Timestamp: now.Add(-24 * time.Hour), Value: 100}, // Earliest point
		},
	}
	screener := NewCryptoVolumeScreener(provider)
	screener.SetTimeFunc(func() time.Time { return now })
	screener.SetSymbols([]string{"TestSymbol"})

	screener.CheckVolumes(context.Background())

	select {
	case anomaly := <-screener.Anomalies():
		// The baseline points should be -24h and -10m (average 100).
		// The current should be `now` (500). Spike 400%.
		if anomaly.CurrentVolume != 500.0 {
			t.Fatalf("Expected current volume 500, got %v", anomaly.CurrentVolume)
		}
		if anomaly.BaselineVolume != 100.0 {
			t.Fatalf("Expected baseline 100, got %v", anomaly.BaselineVolume)
		}
	default:
		t.Fatal("Expected anomaly to trigger for out-of-order points")
	}
}

func TestCryptoVolumeScreener_BaselineInsufficiency(t *testing.T) {
	now := time.Now()
	// Create baseline of only 12 hours (insufficient, needs >= 23h)
	provider := &mockVolumeProvider{
		points: []DataPoint{
			{Timestamp: now.Add(-12 * time.Hour), Value: 100}, // baseline first point
			{Timestamp: now.Add(-10 * time.Minute), Value: 100}, // baseline last point
			{Timestamp: now, Value: 500}, // current tested point (spike)
		},
	}
	screener := NewCryptoVolumeScreener(provider)
	screener.SetTimeFunc(func() time.Time { return now })
	screener.SetSymbols([]string{"TestSymbol"})

	screener.CheckVolumes(context.Background()) // Deterministic synchronous execution

	select {
	case <-screener.Anomalies():
		t.Fatal("Expected no anomalies due to insufficient baseline")
	default:
		// Passed
	}
}

func TestCryptoVolumeScreener_ZeroOrInvalidBaseline(t *testing.T) {
	now := time.Now()
	// Baseline spans 24 hours, but averages to 0.
	provider := &mockVolumeProvider{
		points: []DataPoint{
			{Timestamp: now.Add(-24 * time.Hour), Value: 0},
			{Timestamp: now.Add(-1 * time.Hour), Value: 0},
			{Timestamp: now, Value: 500},
		},
	}
	screener := NewCryptoVolumeScreener(provider)
	screener.SetTimeFunc(func() time.Time { return now })
	screener.SetSymbols([]string{"TestSymbol"})

	screener.CheckVolumes(context.Background())

	select {
	case <-screener.Anomalies():
		t.Fatal("Expected no anomalies due to zero baseline")
	default:
	}
}

func TestCryptoVolumeScreener_TransientReadFailure(t *testing.T) {
	provider := &mockVolumeProvider{}
	provider.setErr(errors.New("transient network error"))

	screener := NewCryptoVolumeScreener(provider)
	screener.SetSymbols([]string{"TestSymbol"})

	screener.CheckVolumes(context.Background())

	if !screener.LastChecked("TestSymbol").IsZero() {
		t.Fatalf("LastChecked should be zero due to fetch error")
	}
}

func TestCryptoVolumeScreener_ExactlyThreshold(t *testing.T) {
	now := time.Now()
	// Valid baseline spanning 23+ hours. Average = 100.
	points := []DataPoint{
		{Timestamp: now.Add(-24 * time.Hour), Value: 100},
		{Timestamp: now.Add(-12 * time.Hour), Value: 100},
		{Timestamp: now.Add(-1 * time.Hour), Value: 100},
	}

	// 300% spike = current 400. (400 - 100) / 100 = 3.0
	pointsExactly := append(points, DataPoint{Timestamp: now, Value: 400})

	provider := &mockVolumeProvider{points: pointsExactly}
	screener := NewCryptoVolumeScreener(provider)
	screener.SetTimeFunc(func() time.Time { return now })
	screener.SetSymbols([]string{"TestSymbol"})

	screener.CheckVolumes(context.Background())

	select {
	case <-screener.Anomalies():
		t.Fatal("Expected no anomalies for exactly 300% spike")
	default:
		// Passed
	}

	// >300% spike (e.g. 401)
	pointsAbove := append(points, DataPoint{Timestamp: now, Value: 401})
	provider.setPoints(pointsAbove)

	screener.CheckVolumes(context.Background())

	select {
	case anomaly := <-screener.Anomalies():
		if anomaly.SpikeRatio <= 3.0 {
			t.Fatalf("Expected spike ratio > 3.0, got %v", anomaly.SpikeRatio)
		}
	default:
		t.Fatal("Expected anomaly for >300% spike")
	}
}
