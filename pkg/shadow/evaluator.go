package shadow

import (
	"errors"
	"fmt"
	"gelt/pkg/config"
	"math"
	"sort"
	"time"
)

// PromotionEvaluator evaluates shadow trading plans to determine if they meet
// criteria for promotion.
type PromotionEvaluator struct {
	Gate             config.PromotionGate
	InitialBalance   float64
	CapitalBudgetUSD float64
}

// Evaluate analyzes trades from the store and returns a list of plan names
// that meet the promotion criteria:
// - Win Rate > 65%
// - Profit Factor > 1.5
// - Total Trades >= 3
// - VaR (5th percentile) < 5%

func (e *PromotionEvaluator) getInitialBalance() (float64, error) {
	if e == nil || !isFinitePromotionValue(e.InitialBalance) || e.InitialBalance <= 0 {
		return 0, fmt.Errorf("promotion requires a positive finite initial balance")
	}
	return e.InitialBalance, nil
}

func (e *PromotionEvaluator) validateGate() error {
	if e == nil || e.Gate.MinTrades < 0 || !isFinitePromotionValue(e.Gate.PromoteWinRate) || !isFinitePromotionValue(e.Gate.PromoteProfitFactor) || !isFinitePromotionValue(e.Gate.PromoteMaxVaR) || !isFinitePromotionValue(e.Gate.DemoteProfitFactor) || !isFinitePromotionValue(e.Gate.DemoteMaxDrawdown) {
		return fmt.Errorf("promotion requires finite gate values and nonnegative minimum trades")
	}
	if e.Gate.PromoteWinRate < 0 || e.Gate.PromoteWinRate > 100 || e.Gate.PromoteProfitFactor < 0 || e.Gate.PromoteMaxVaR < 0 || e.Gate.PromoteMaxVaR > 100 || e.Gate.DemoteProfitFactor < 0 || e.Gate.DemoteMaxDrawdown < 0 || e.Gate.DemoteMaxDrawdown > 100 {
		return fmt.Errorf("promotion gate values are outside safe bounds")
	}
	return nil
}

// capitalBudgetUSD is the configured runtime shadow-capital budget used to
// validate legacy OPEN journal records before historical PnL is considered.
// It must be supplied by production promotion wiring; InitialBalance is a
// valuation baseline, not an authorization to exceed the shadow budget.
func (e *PromotionEvaluator) capitalBudgetUSD() float64 {
	if e == nil {
		return 0
	}
	return e.CapitalBudgetUSD
}

func (e *PromotionEvaluator) Evaluate(store *Store) ([]string, error) {
	return e.EvaluateAt(store, time.Now())
}

func (e *PromotionEvaluator) EvaluateAt(store *Store, evalTime time.Time) ([]string, error) {
	if !IsPromotionWindowOpen(evalTime) {
		return []string{}, nil
	}
	if _, err := e.getInitialBalance(); err != nil {
		return nil, err
	}
	if err := e.validateGate(); err != nil {
		return nil, err
	}
	budget := e.capitalBudgetUSD()
	if !isValidReservationAmount(budget) {
		return nil, fmt.Errorf("verify capital reservation before promotion: configured positive finite shadow capital budget is required")
	}

	capitalState, err := store.LoadCapitalReservationState()
	if err != nil {
		return nil, fmt.Errorf("load capital reservation state before promotion: %w", err)
	}
	if capitalState.Degraded {
		return []string{}, nil
	}
	// Promotion may run without a preceding engine cycle. Validate the current
	// journal against the evaluator's capital baseline so invalid legacy OPEN
	// state is latched before historical PnL can be considered.
	if err := store.VerifyCapitalReservation(budget); err != nil {
		if errors.Is(err, ErrShadowCapitalDegraded) {
			return []string{}, nil
		}
		return nil, fmt.Errorf("verify capital reservation before promotion: %w", err)
	}

	trades, err := store.Load()
	if err != nil {
		return nil, err
	}

	return e.evaluateTrades(trades), nil
}

// evaluateTrades applies promotion gates to one caller-supplied journal snapshot.
// Callers that perform a promotion side effect must supply a snapshot held under
// the same journal lock as that side effect.
func (e *PromotionEvaluator) evaluateTrades(trades []ShadowTrade) []string {
	initialBalance, err := e.getInitialBalance()
	if err != nil || e.validateGate() != nil {
		return nil
	}
	planTradesMap := make(map[string][]ShadowTrade)
	for _, t := range trades {
		if t.Status == "CLOSED" {
			planTradesMap[t.PlanName] = append(planTradesMap[t.PlanName], t)
		}
	}

	var qualifiedPlans []string

	for planName, planTrades := range planTradesMap {
		totalTrades := len(planTrades)
		if totalTrades < e.Gate.MinTrades {
			continue // Criteria: Trades >= MinTrades
		}

		var winCount int
		var grossProfit float64
		var grossLoss float64

		validMetrics := true
		for _, t := range planTrades {
			if !isFinitePromotionValue(t.PnLUSD) {
				validMetrics = false
				break
			}
			if t.PnLUSD > 0 {
				winCount++
				grossProfit += t.PnLUSD
			} else if t.PnLUSD < 0 {
				grossLoss += math.Abs(t.PnLUSD)
			}
			if !isFinitePromotionValue(grossProfit) || !isFinitePromotionValue(grossLoss) {
				validMetrics = false
				break
			}
		}
		if !validMetrics {
			continue
		}

		winRate := (float64(winCount) / float64(totalTrades)) * 100.0
		if winRate <= e.Gate.PromoteWinRate {
			continue // Criteria: Win Rate > PromoteWinRate
		}

		var profitFactor float64
		if grossLoss > 0 {
			profitFactor = grossProfit / grossLoss
		} else if grossProfit > 0 {
			profitFactor = math.Inf(1)
		} else {
			profitFactor = 0.0
		}

		// An all-win sample has undefined/unbounded profit factor. Do not turn
		// it into an operator-facing promotion claim without a defined finite policy.
		if !isFinitePromotionValue(profitFactor) || profitFactor <= e.Gate.PromoteProfitFactor {
			continue // Criteria: Profit Factor > PromoteProfitFactor
		}

		// Run Monte Carlo simulation for VaR
		simResult := RunSimulation(planTrades, 1000, initialBalance)

		// Calculate VaR as a percentage of initial balance
		varPct := (math.Abs(simResult.ValueAtRisk) / initialBalance) * 100.0
		if !isFinitePromotionValue(simResult.ExpectedValue) || !isFinitePromotionValue(simResult.ValueAtRisk) || !isFinitePromotionValue(simResult.ProbabilityOfRuin) || !isFinitePromotionValue(varPct) {
			continue
		}

		// VaR must be < PromoteMaxVaR
		if varPct >= e.Gate.PromoteMaxVaR {
			continue
		}

		qualifiedPlans = append(qualifiedPlans, planName)
	}

	// Sort alphabetically for deterministic output
	sort.Strings(qualifiedPlans)

	return qualifiedPlans
}

func isFinitePromotionValue(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

type EvaluationSignal string

const (
	PROMOTE EvaluationSignal = "PROMOTE"
	DEMOTE  EvaluationSignal = "DEMOTE"
	HOLD    EvaluationSignal = "HOLD"
)

type StrategyMetrics struct {
	ProfitFactor float64
	WinRate      float64
	NetPnLUSD    float64
	MaxDrawdown  float64
	ClosedTrades int
}

type ShadowPerformanceEvaluator struct {
	Gate config.PromotionGate
}

func NewShadowPerformanceEvaluator(gate config.PromotionGate) *ShadowPerformanceEvaluator {
	return &ShadowPerformanceEvaluator{Gate: gate}
}

func (e *ShadowPerformanceEvaluator) EvaluatePlan(trades []ShadowTrade) (EvaluationSignal, StrategyMetrics) {
	var metrics StrategyMetrics
	if e == nil || e.Gate.MinTrades < 1 || !isFinitePromotionValue(e.Gate.PromoteProfitFactor) || !isFinitePromotionValue(e.Gate.DemoteProfitFactor) || !isFinitePromotionValue(e.Gate.DemoteMaxDrawdown) {
		return HOLD, metrics
	}

	for _, t := range trades {
		if t.Status == "CLOSED" {
			if !isFinitePromotionValue(t.PnLUSD) {
				return HOLD, StrategyMetrics{}
			}
			metrics.ClosedTrades++
		}
	}

	if metrics.ClosedTrades == 0 {
		return HOLD, metrics
	}

	var winCount int
	var grossProfit float64
	var grossLoss float64

	var cumPnL float64
	var peakPnL float64
	var maxDD float64

	initialBalance := 10000.0

	for _, t := range trades {
		if t.Status == "CLOSED" {
			metrics.NetPnLUSD += t.PnLUSD
			cumPnL += t.PnLUSD
			if !isFinitePromotionValue(metrics.NetPnLUSD) || !isFinitePromotionValue(cumPnL) {
				return HOLD, StrategyMetrics{}
			}

			if cumPnL > peakPnL {
				peakPnL = cumPnL
			}

			dd := peakPnL - cumPnL
			if dd > maxDD {
				maxDD = dd
			}

			if t.PnLUSD > 0 {
				winCount++
				grossProfit += t.PnLUSD
			} else if t.PnLUSD < 0 {
				grossLoss += math.Abs(t.PnLUSD)
			}
		}
	}

	metrics.WinRate = float64(winCount) / float64(metrics.ClosedTrades) * 100.0

	if grossLoss > 0 {
		metrics.ProfitFactor = grossProfit / grossLoss
	} else {
		return HOLD, metrics
	}
	if !isFinitePromotionValue(metrics.ProfitFactor) {
		return HOLD, StrategyMetrics{}
	}

	metrics.MaxDrawdown = (maxDD / initialBalance) * 100.0
	if !isFinitePromotionValue(metrics.MaxDrawdown) {
		return HOLD, StrategyMetrics{}
	}

	if metrics.ClosedTrades < e.Gate.MinTrades {
		return HOLD, metrics
	}

	if metrics.ProfitFactor < e.Gate.DemoteProfitFactor || metrics.MaxDrawdown > e.Gate.DemoteMaxDrawdown {
		return DEMOTE, metrics
	}

	if metrics.ProfitFactor > e.Gate.PromoteProfitFactor {
		return PROMOTE, metrics
	}

	return HOLD, metrics
}
