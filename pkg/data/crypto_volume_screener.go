package data

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"
)

// VolumeAnomaly represents a significant spike in trading volume.
type VolumeAnomaly struct {
	Timestamp      time.Time
	FeatureKey     string
	BaselineVolume float64
	CurrentVolume  float64
	SpikeRatio     float64 // (current - baseline) / baseline
}

// CryptoVolumeScreener is a background worker that polls crypto volume and detects anomalies.
type CryptoVolumeScreener struct {
	provider    FeatureProvider
	interval    time.Duration
	threshold   float64 // Spike threshold > (e.g. 3.0 for >300%)
	anomalies   chan VolumeAnomaly
	mu          sync.RWMutex
	timeFunc    func() time.Time // For deterministic testing
	logger      *slog.Logger
	symbols     []string
	lastChecked map[string]time.Time

	// Concurrency safety and synchronization
	stateMu   sync.Mutex
	isRunning bool
}

// NewCryptoVolumeScreener creates a new CryptoVolumeScreener.
func NewCryptoVolumeScreener(provider FeatureProvider) *CryptoVolumeScreener {
	return &CryptoVolumeScreener{
		provider:    provider,
		interval:    15 * time.Minute,
		threshold:   3.0,
		anomalies:   make(chan VolumeAnomaly, 100),
		timeFunc:    time.Now,
		logger:      slog.Default(),
		symbols:     []string{"Crypto.BTC.Volume", "Crypto.ETH.Volume"},
		lastChecked: make(map[string]time.Time),
	}
}

// SetTimeFunc sets the clock function for testing.
func (s *CryptoVolumeScreener) SetTimeFunc(fn func() time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeFunc = fn
}

// SetSymbols sets the list of symbols to poll.
func (s *CryptoVolumeScreener) SetSymbols(symbols []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.symbols = make([]string, len(symbols))
	copy(s.symbols, symbols)
}

// Anomalies returns a read-only channel for detected anomalies.
func (s *CryptoVolumeScreener) Anomalies() <-chan VolumeAnomaly {
	return s.anomalies
}

// LastChecked returns the last time a symbol was checked.
func (s *CryptoVolumeScreener) LastChecked(symbol string) time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastChecked[symbol]
}

// Start begins the polling loop in a non-blocking manner.
// It returns an error if already started. On success, it returns a generation-specific
// join function that blocks until this specific worker generation has completely exited.
func (s *CryptoVolumeScreener) Start(ctx context.Context) (func(), error) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()

	if s.isRunning {
		return nil, fmt.Errorf("screener is already running")
	}

	s.isRunning = true
	genDone := make(chan struct{})

	go func() {
		defer func() {
			s.stateMu.Lock()
			s.isRunning = false
			s.stateMu.Unlock()
			close(genDone)
		}()
		s.pollLoop(ctx)
	}()

	return func() { <-genDone }, nil
}

func (s *CryptoVolumeScreener) pollLoop(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	// Initial check on start
	s.checkVolumes(ctx)

	for {
		select {
		case <-ctx.Done():
			s.logger.Info("CryptoVolumeScreener stopped due to context cancellation")
			return
		case <-ticker.C:
			s.checkVolumes(ctx)
		}
	}
}

// CheckVolumes explicitly triggers a full sweep. Exported for testability.
func (s *CryptoVolumeScreener) CheckVolumes(ctx context.Context) {
	s.checkVolumes(ctx)
}

func (s *CryptoVolumeScreener) checkVolumes(ctx context.Context) {
	s.mu.RLock()
	symbols := make([]string, len(s.symbols))
	copy(symbols, s.symbols)
	s.mu.RUnlock()

	for _, symbol := range symbols {
		select {
		case <-ctx.Done():
			return // Context cancelled during processing
		default:
		}

		s.checkSymbolVolume(ctx, symbol)
	}
}

func (s *CryptoVolumeScreener) checkSymbolVolume(ctx context.Context, symbol string) {
	s.mu.RLock()
	now := s.timeFunc()
	s.mu.RUnlock()

	req := FeatureRequest{
		FeatureKey: symbol,
		Start:      now.Add(-24 * time.Hour),
		End:        now,
		Resolution: s.interval,
	}

	points, err := s.provider.Fetch(ctx, req)
	if err != nil {
		s.logger.Error("CryptoVolumeScreener transient read failure", "symbol", symbol, "error", err)
		return
	}

	// Update last checked time
	s.mu.Lock()
	s.lastChecked[symbol] = now
	s.mu.Unlock()

	if len(points) < 2 {
		return // Cannot compare current to past if < 2 points exist
	}

	// Clone and sort points by timestamp to ensure correctness independent of provider ordering.
	sortedPoints := make([]DataPoint, len(points))
	copy(sortedPoints, points)
	sort.Slice(sortedPoints, func(i, j int) bool {
		return sortedPoints[i].Timestamp.Before(sortedPoints[j].Timestamp)
	})

	// Calculate baseline over the past 24h EXCLUDING the very last (current) point.
	firstTime := sortedPoints[0].Timestamp
	lastBaselineTime := sortedPoints[len(sortedPoints)-2].Timestamp // The last point in the baseline window
	baselineDuration := lastBaselineTime.Sub(firstTime)

	// Baseline insufficiency check: require at least 23 hours of data in the BASELINE window
	if baselineDuration < 23*time.Hour {
		s.logger.Debug("CryptoVolumeScreener baseline insufficiency", "symbol", symbol, "baselineDuration", baselineDuration)
		return
	}

	var sum float64
	for i := 0; i < len(sortedPoints)-1; i++ {
		sum += sortedPoints[i].Value
	}

	count := len(sortedPoints) - 1
	baseline := sum / float64(count)

	// Invalid or zero baseline check
	if baseline <= 0.0 {
		s.logger.Warn("CryptoVolumeScreener invalid baseline", "symbol", symbol, "baseline", baseline)
		return
	}

	current := sortedPoints[len(sortedPoints)-1].Value
	spikeRatio := (current - baseline) / baseline

	if spikeRatio > s.threshold {
		anomaly := VolumeAnomaly{
			Timestamp:      sortedPoints[len(sortedPoints)-1].Timestamp,
			FeatureKey:     symbol,
			BaselineVolume: baseline,
			CurrentVolume:  current,
			SpikeRatio:     spikeRatio,
		}

		// Emit anomaly
		select {
		case s.anomalies <- anomaly:
			s.logger.Info(fmt.Sprintf("VolumeAnomaly emitted for %s", symbol),
				"baseline", baseline, "current", current, "spike_ratio", spikeRatio)
		default:
			s.logger.Warn("CryptoVolumeScreener channel full, dropping anomaly", "symbol", symbol)
		}
	}
}
