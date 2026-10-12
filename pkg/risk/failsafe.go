package risk

import "sync"

// FailSafe monitors consecutive failures to halt operations if a threshold is reached.
type FailSafe struct {
    mu                 sync.RWMutex
    consecutiveFailures int
    threshold          int
}

// NewFailSafe creates a new FailSafe with the specified threshold.
func NewFailSafe(threshold int) *FailSafe {
    return &FailSafe{
        threshold: threshold,
    }
}

// RecordFailure increments the consecutive failure count.
func (fs *FailSafe) RecordFailure() {
    fs.mu.Lock()
    defer fs.mu.Unlock()
    fs.consecutiveFailures++
}

// RecordSuccess resets the consecutive failure count to zero.
func (fs *FailSafe) RecordSuccess() {
    fs.mu.Lock()
    defer fs.mu.Unlock()
    fs.consecutiveFailures = 0
}

// IsTripped returns true if consecutive failures have reached or exceeded the threshold.
func (fs *FailSafe) IsTripped() bool {
    fs.mu.RLock()
    defer fs.mu.RUnlock()
    return fs.consecutiveFailures >= fs.threshold
}
