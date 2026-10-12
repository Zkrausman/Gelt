package portfolio

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"gelt/pkg/regime"
	"gelt/pkg/strategies"
	"gelt/pkg/risk"
)

// PortfolioManager orchestrates multiple trading strategies concurrently,
// resolves conflicting signals, and enforces capital budgeting.
type PortfolioManager struct {
	mu               sync.RWMutex
	availableCapital float64
	currentRegime    regime.MarketRegime
	rebalancer       *Rebalancer
	failsafe         *risk.FailSafe
}

// NewPortfolioManager creates a new PortfolioManager with initial capital.
func NewPortfolioManager(initialCapital float64) *PortfolioManager {
	return &PortfolioManager{
		availableCapital: initialCapital,
		failsafe:         risk.NewFailSafe(3),
	}
}

// SetRebalancer assigns a Rebalancer to the PortfolioManager.
func (pm *PortfolioManager) SetRebalancer(r *Rebalancer) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.rebalancer = r
}

// UpdateRegime dynamically sets the active market regime.
func (pm *PortfolioManager) UpdateRegime(r regime.MarketRegime) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.currentRegime = r
}

// DeployMargin allocates new margin capital, halting if the regime is volatile.
func (pm *PortfolioManager) DeployMargin(amount float64) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if pm.currentRegime == regime.RegimeHighVolatility {
		return fmt.Errorf("margin deployment halted due to RegimeHighVolatility")
	}
	pm.availableCapital += amount
	return nil
}

// EvaluateStrategies runs the provided strategies concurrently and resolves signals.
// It prioritizes SELL signals over BUY signals. For BUY signals, it enforces
// capital budgeting by deducting CapitalRequirement from AvailableCapital.
func (pm *PortfolioManager) EvaluateStrategies(
	ctx context.Context,
	evalTime time.Time,
	symbol string,
	closes []float64,
	volumes []float64,
	strategyList []strategies.Strategy,
) ([]strategies.StrategySignal, error) {

	pm.mu.RLock()
	isTripped := pm.failsafe.IsTripped()
	pm.mu.RUnlock()

	if isTripped {
		return nil, fmt.Errorf("fail-safe tripped: halting sandbox execution")
	}

	type result struct {
		signal strategies.StrategySignal
		err    error
		req    float64
	}

	pm.mu.RLock()
	rebalancer := pm.rebalancer
	pm.mu.RUnlock()

	if rebalancer != nil {
		rebalancer.UpdateWeights()
	}

	resultsChan := make(chan result, len(strategyList))
	var wg sync.WaitGroup

	// 1. Run strategies concurrently
	for _, strat := range strategyList {
		wg.Add(1)
		go func(s strategies.Strategy) {
			defer wg.Done()
			req := s.CapitalRequirement()

			pm.mu.RLock()
			currentRegime := pm.currentRegime
			rebalancer := pm.rebalancer
			pm.mu.RUnlock()

			if currentRegime == regime.RegimeHighVolatility && strings.Contains(strings.ToLower(s.Description()), "momentum") {
				req = req * 0.5
			}

			if rebalancer != nil {
				weight := rebalancer.GetWeight(s.Name())
				req = req * weight
			}

			sig, err := s.Evaluate(ctx, evalTime, symbol, closes, volumes)
			resultsChan <- result{signal: sig, err: err, req: req}
		}(strat)
	}

	wg.Wait()
	close(resultsChan)

	var validSignals []result

	// 2. Collect results
	for res := range resultsChan {
		if res.err != nil {
			continue // Skip failed evaluations
		}
		if res.signal.Signal == strategies.SignalHold {
			continue // Skip HOLD signals
		}
		validSignals = append(validSignals, res)
	}

	if len(validSignals) == 0 {
		return nil, nil // No actionable signals
	}

	// 3. Resolve Collisions for the same symbol
	var sells []result
	var buys []result

	for _, res := range validSignals {
		if res.signal.Signal == strategies.SignalSell {
			sells = append(sells, res)
		} else if res.signal.Signal == strategies.SignalBuy {
			buys = append(buys, res)
		}
	}

	var finalSignals []strategies.StrategySignal

	// Prioritize SELL over BUY: if there's any SELL signal, we ignore BUYs
	if len(sells) > 0 {
		sort.Slice(sells, func(i, j int) bool {
			return sells[i].signal.Score > sells[j].signal.Score
		})

		// Take the highest scoring SELL signal
		finalSignals = append(finalSignals, sells[0].signal)
		return finalSignals, nil
	}

	// 4. Capital Budgeting: Sort BUYs by highest score first
	sort.Slice(buys, func(i, j int) bool {
		return buys[i].signal.Score > buys[j].signal.Score
	})

	pm.mu.Lock()
	defer pm.mu.Unlock()

	for _, res := range buys {
		if pm.availableCapital >= res.req {
			pm.availableCapital -= res.req
			finalSignals = append(finalSignals, res.signal)
		}
	}

	return finalSignals, nil
}

// GetAvailableCapital returns the currently available capital budget in a thread-safe manner.
func (pm *PortfolioManager) GetAvailableCapital() float64 {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.availableCapital
}

// GetFailSafe returns the manager's fail-safe instance.
func (pm *PortfolioManager) GetFailSafe() *risk.FailSafe {
	return pm.failsafe
}
