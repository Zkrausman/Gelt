package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gelt/pkg/agent"
	"gelt/pkg/config"
)

// QuotaState tracks the number of calls made in the current month.
type QuotaState struct {
	Month string `json:"month"` // Format: YYYY-MM
	Calls int    `json:"calls"`
}

// Dispatcher manages when the Heavy Antigravity Agent is invoked.
type Dispatcher struct {
	mu         sync.Mutex
	client     agent.AntigravityAgentClient
	cfg        config.DispatcherConfig
	quotaState QuotaState
	stateFile  string
	logger     *slog.Logger
}

// NewDispatcher creates a new event-driven dispatcher.
func NewDispatcher(client agent.AntigravityAgentClient, cfg config.DispatcherConfig, logger *slog.Logger) (*Dispatcher, error) {
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user home dir: %w", err)
	}

	geltDir := filepath.Join(home, ".gelt")
	if err := os.MkdirAll(geltDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create .gelt dir: %w", err)
	}

	stateFile := filepath.Join(geltDir, "quota_state.json")

	d := &Dispatcher{
		client:    client,
		cfg:       cfg,
		stateFile: stateFile,
		logger:    logger,
	}

	if err := d.loadQuotaState(); err != nil {
		return nil, err
	}

	return d, nil
}

func (d *Dispatcher) loadQuotaState() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	data, err := os.ReadFile(d.stateFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Initialize new state if file doesn't exist
			d.quotaState = QuotaState{
				Month: currentMonth(),
				Calls: 0,
			}
			return nil
		}
		return fmt.Errorf("failed to read quota state file: %w", err)
	}

	var state QuotaState
	if err := json.Unmarshal(data, &state); err != nil {
		return fmt.Errorf("failed to parse quota state file: %w", err)
	}

	// Reset if it's a new month
	if state.Month != currentMonth() {
		state.Month = currentMonth()
		state.Calls = 0
	}

	d.quotaState = state
	return nil
}

func (d *Dispatcher) saveQuotaState() error {
	data, err := json.Marshal(d.quotaState)
	if err != nil {
		return fmt.Errorf("failed to marshal quota state: %w", err)
	}
	if err := os.WriteFile(d.stateFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write quota state file: %w", err)
	}
	return nil
}

func currentMonth() string {
	return time.Now().Format("2006-01")
}

// VolatilityTrigger initiates an out-of-band heavy agent session if thresholds are met.
// atrSpike should be the multiplier over standard deviation (e.g. > 2.5).
func (d *Dispatcher) VolatilityTrigger(ctx context.Context, atrSpike float64, decisionScore float64) error {
	if atrSpike > d.cfg.ATRSpikeThreshold || decisionScore >= d.cfg.DecisionScoreThreshold {
		d.logger.Info("volatility trigger conditions met",
			slog.Float64("atrSpike", atrSpike),
			slog.Float64("decisionScore", decisionScore))
		return d.DispatchAgent(ctx, "Analyze market volatility spike and fast decision signals")
	}
	return nil
}

// DispatchAgent attempts to invoke the Antigravity Agent if within monthly quota limits.
func (d *Dispatcher) DispatchAgent(ctx context.Context, prompt string) error {
	d.mu.Lock()

	// Check and potentially reset month
	currMonth := currentMonth()
	if d.quotaState.Month != currMonth {
		d.quotaState.Month = currMonth
		d.quotaState.Calls = 0
	}

	if d.quotaState.Calls >= d.cfg.MaxMonthlyCalls {
		d.mu.Unlock()
		d.logger.Warn("monthly quota limit reached", slog.Int("calls", d.quotaState.Calls))
		return fmt.Errorf("monthly quota limit reached (%d calls)", d.cfg.MaxMonthlyCalls)
	}

	d.quotaState.Calls++
	if err := d.saveQuotaState(); err != nil {
		d.quotaState.Calls--
		d.mu.Unlock()
		return err
	}
	calls := d.quotaState.Calls
	d.mu.Unlock() // Release the lock before network call

	d.logger.Info("dispatching heavy agent", slog.Int("current_month_calls", calls))

	payload := agent.InteractionPayload{
		Prompt: prompt,
	}

	_, err := d.client.Dispatch(ctx, payload)
	if err != nil {
		return fmt.Errorf("agent dispatch failed: %w", err)
	}

	return nil
}
