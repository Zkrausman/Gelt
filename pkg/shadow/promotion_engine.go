package shadow

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"gelt/pkg/config"
	"gelt/pkg/notify"
	"gelt/pkg/plans"
	"gelt/pkg/risk"
)

// PromotionEngine orchestrates the evaluation of shadow plans
// and promotes them to live trading if criteria are met.
type PromotionEngine struct {
	cfg       *config.PromotionConfig
	evaluator *PromotionEvaluator
	registry  *plans.PlanRegistry
	monitor   *risk.IntradayDrawdownMonitor
	store     *Store
}

// NewPromotionEngine creates a new PromotionEngine instance.
func NewPromotionEngine(cfg *config.PromotionConfig, evaluator *PromotionEvaluator, registry *plans.PlanRegistry, monitor *risk.IntradayDrawdownMonitor, store *Store) *PromotionEngine {
	return &PromotionEngine{
		cfg:       cfg,
		evaluator: evaluator,
		registry:  registry,
		monitor:   monitor,
		store:     store,
	}
}

// Run starts the periodic background scan (e.g. every 15 mins).
func (pe *PromotionEngine) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case t := <-ticker.C:
			pe.EvaluateAndPromoteAt(t)
		}
	}
}

// EvaluateAndPromote runs the evaluation at the current time.
func (pe *PromotionEngine) EvaluateAndPromote() {
	pe.EvaluateAndPromoteAt(time.Now())
}

// EvaluateAndPromoteAt runs the evaluation at a specific time.
func (pe *PromotionEngine) EvaluateAndPromoteAt(evalTime time.Time) {
	if !IsPromotionWindowOpen(evalTime) {
		return
	}
	budget := pe.evaluator.capitalBudgetUSD()
	if !isValidReservationAmount(budget) {
		slog.Error("PromotionEngine requires configured positive finite shadow capital budget")
		return
	}

	// Evaluate gates and perform the resulting side effect from the same locked
	// journal snapshot, so a concurrent mutation cannot stale qualification.
	if err := pe.store.WithCapitalReservationGuard(budget, func() error {
		trades, err := pe.store.loadTrades()
		if err != nil {
			return fmt.Errorf("load trades for promotion metrics: %w", err)
		}
		qualified := pe.evaluator.evaluateTrades(trades)
		for _, planName := range qualified {
			if _, err := pe.registry.Get(planName); err != nil {
				slog.Warn("Qualified plan not found in registry", "plan", planName)
				continue
			}
			metrics := pe.calculateMetrics(planName, trades)
			if pe.cfg.PromoAlertOnly {
				slog.Info("PromotionEngine (Alert Only) generated promotion candidate alert", "plan", planName)
				notify.SendPromotionAlert(metrics)
			} else if pe.cfg.AutoPromoEnabled {
				// The registry is process-local; no durable daemon-owned activation
				// protocol exists. Never claim or perform an in-memory promotion.
				slog.Warn("Promotion candidate suppressed: durable activation is unavailable", "plan", planName)
				notify.SendPromotionAlert(metrics)
			}
		}
		return nil
	}); err != nil {
		slog.Warn("PromotionEngine suppressed promotion after capital-integrity check", "error", err)
	}
}

func (pe *PromotionEngine) calculateMetrics(planName string, allTrades []ShadowTrade) notify.PromotionMetrics {
	var totalTrades int
	var winCount int
	var grossProfit float64
	var grossLoss float64
	var planTrades []ShadowTrade

	for _, t := range allTrades {
		if t.PlanName == planName && t.Status == "CLOSED" {
			planTrades = append(planTrades, t)
			totalTrades++
			if t.PnLUSD > 0 {
				winCount++
				grossProfit += t.PnLUSD
			} else if t.PnLUSD < 0 {
				grossLoss += math.Abs(t.PnLUSD)
			}
		}
	}

	var winRate float64
	if totalTrades > 0 {
		winRate = float64(winCount) / float64(totalTrades)
	}

	var profitFactor float64
	if grossLoss > 0 {
		profitFactor = grossProfit / grossLoss
	} else if grossProfit > 0 {
		profitFactor = math.Inf(1)
	}

	initialBalance, err := pe.evaluator.getInitialBalance()
	if err != nil {
		return notify.PromotionMetrics{StrategyName: planName}
	}
	simResult := RunSimulation(planTrades, 1000, initialBalance)
	varPct := (math.Abs(simResult.ValueAtRisk) / initialBalance) * 100.0
	if !isFinitePromotionValue(winRate) || !isFinitePromotionValue(profitFactor) || !isFinitePromotionValue(varPct) {
		return notify.PromotionMetrics{StrategyName: planName}
	}

	return notify.PromotionMetrics{
		StrategyName: planName,
		WinRate:      winRate * 100, // as percentage for display
		ProfitFactor: profitFactor,
		VaR:          varPct,
		TradeCount:   totalTrades,
	}
}
