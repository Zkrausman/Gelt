// Package plans provides high-level trading plan orchestration over Gelt's Strategy Catalog.
package plans

import (
	"errors"
	"gelt/pkg/config"
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/signals"
	"gelt/pkg/strategies"
)

// WeightedStrategy pairs an atomic catalog strategy with a composite weight (0.0 to 1.0).
type WeightedStrategy struct {
	Strategy strategies.Strategy `json:"strategy"`
	Weight   float64             `json:"weight" yaml:"weight"`
	Params   map[string]float64  `json:"params,omitempty" yaml:"params,omitempty"`
}

// PlanEvaluation holds the composite consensus signal of a Trading Plan evaluation.
type PlanEvaluation struct {
	PlanName        string                      `json:"plan_name"`
	AssetClass      strategies.AssetClass       `json:"asset_class"`
	Symbol          string                      `json:"symbol"`
	ConsensusSignal strategies.SignalType       `json:"consensus_signal"` // BUY, SELL, HOLD
	WeightedScore   float64                     `json:"weighted_score"`   // 0.0 - 100.0 composite confidence
	StopLossPct     float64                     `json:"stop_loss_pct"`
	TargetPct       float64                     `json:"target_pct"`
	StrategySignals []strategies.StrategySignal `json:"strategy_signals"`
	Rationale       string                      `json:"rationale"`
	Timestamp       time.Time                   `json:"timestamp"`
}

// TradingPlan defines the orchestrator contract combining multiple weighted strategies.
type TradingPlan interface {
	Name() string
	Description() string
	Strategies() []WeightedStrategy
	Init(registry *data.FeatureRegistry) error
	Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error)
}

// BasePlan provides standard multi-strategy ensemble evaluation logic.
type BasePlan struct {
	planName          string
	description       string
	strategies        []WeightedStrategy
	registry          *data.FeatureRegistry
	EnableTrendFilter bool
	BuyThreshold      float64
	SellThreshold     float64
}

// NewBasePlan constructs a BasePlan instance.
func NewBasePlan(name, description string, weightedStrats []WeightedStrategy) *BasePlan {
	return &BasePlan{
		planName:    name,
		description: description,
		strategies:  weightedStrats,
	}
}

// WithTrendFilter enables or disables macro trend alignment filtering for this plan.
func (p *BasePlan) WithTrendFilter(enable bool) *BasePlan {
	p.EnableTrendFilter = enable
	return p
}

func (p *BasePlan) Init(registry *data.FeatureRegistry) error {
	// Try loading app config for default params
	appCfg, err := config.LoadAppConfig()
	if err != nil && !errors.Is(err, config.ErrConfigNotFound) {
		return fmt.Errorf("failed to load app config: %w", err)
	}

	p.registry = registry

	p.BuyThreshold = 75.0
	p.SellThreshold = 35.0
	if appCfg != nil {
		p.BuyThreshold = appCfg.BuyThreshold
		p.SellThreshold = appCfg.SellThreshold
	}
	for _, ws := range p.strategies {
		mergedParams := make(map[string]float64)

		// Helper to merge and canonicalize keys
		mergeAndCanonicalize := func(source map[string]float64) error {
			var buy, sell float64
			var hasBuy, hasSell bool

			for k, v := range source {
				if k == "BuyThreshold" || k == "buy_threshold" {
					if hasBuy && buy != v {
						return fmt.Errorf("duplicate conflicting buy threshold alias in source")
					}
					buy = v
					hasBuy = true
					mergedParams["BuyThreshold"] = v
				} else if k == "SellThreshold" || k == "sell_threshold" {
					if hasSell && sell != v {
						return fmt.Errorf("duplicate conflicting sell threshold alias in source")
					}
					sell = v
					hasSell = true
					mergedParams["SellThreshold"] = v
				} else {
					if (k == "atr_stop_multiplier" || k == "atr_target_multiplier") && v <= 0 {
						return fmt.Errorf("invalid %s override: must be > 0, got %f", k, v)
					}
					mergedParams[k] = v
				}
			}
			return nil
		}

		if appCfg != nil && appCfg.StrategyConfig != nil {
			if defs, ok := appCfg.StrategyConfig[ws.Strategy.Name()]; ok {
				if err := mergeAndCanonicalize(defs); err != nil {
					return fmt.Errorf("invalid strategy config: %w", err)
				}
			}
		}
		if ws.Params != nil {
			if err := mergeAndCanonicalize(ws.Params); err != nil {
				return fmt.Errorf("invalid yaml params: %w", err)
			}
		}

		if _, ok := mergedParams["BuyThreshold"]; !ok {
			mergedParams["BuyThreshold"] = p.BuyThreshold
		}
		if _, ok := mergedParams["SellThreshold"]; !ok {
			mergedParams["SellThreshold"] = p.SellThreshold
		}

		effectiveBuy := mergedParams["BuyThreshold"]
		effectiveSell := mergedParams["SellThreshold"]

		if effectiveBuy < 0 || effectiveBuy > 100 || effectiveSell < 0 || effectiveSell > 100 {
			return fmt.Errorf("strategy %q effective thresholds out of bounds (buy: %.1f, sell: %.1f)", ws.Strategy.Name(), effectiveBuy, effectiveSell)
		}
		if effectiveSell >= effectiveBuy {
			return fmt.Errorf("strategy %q effective sell threshold (%.1f) must be less than buy threshold (%.1f)", ws.Strategy.Name(), effectiveSell, effectiveBuy)
		}

		ws.Strategy.SetParams(mergedParams)

		if err := ws.Strategy.Init(registry); err != nil {
			return fmt.Errorf("failed to initialize strategy %q: %w", ws.Strategy.Name(), err)
		}
	}
	return nil
}

// Name returns the name of the trading plan
func (p *BasePlan) Name() string {
	return p.planName
}

// Description returns the description of the trading plan
func (p *BasePlan) Description() string {
	return p.description
}

// Strategies returns the strategies configured for this plan
func (p *BasePlan) Strategies() []WeightedStrategy {
	return p.strategies
}

// Evaluate runs all weighted strategies, computes composite score & dynamic ATR stops, and returns PlanEvaluation.
func (p *BasePlan) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error) {
	if len(p.strategies) == 0 {
		return PlanEvaluation{}, fmt.Errorf("trading plan %q contains no strategies", p.planName)
	}

	var collectedSignals []strategies.StrategySignal
	var totalWeight float64
	var weightedScore float64
	var totalStop float64
	var totalTarget float64

	var rationales []string
	var assetClass strategies.AssetClass = strategies.AssetEquity

	for _, ws := range p.strategies {
		sig, err := ws.Strategy.Evaluate(ctx, evalTime, symbol, closes, volumes)
		if err != nil {
			continue
		}
		collectedSignals = append(collectedSignals, sig)
		if len(collectedSignals) == 1 {
			assetClass = sig.AssetClass
		}
		totalWeight += ws.Weight
		weightedScore += sig.Score * ws.Weight
		totalStop += sig.StopLossPct * ws.Weight
		totalTarget += sig.TargetPct * ws.Weight

		rationales = append(rationales, fmt.Sprintf("[%s (w=%.1f): %s Score=%.1f]", ws.Strategy.Name(), ws.Weight, sig.Signal, sig.Score))
	}

	if totalWeight == 0 {
		totalWeight = 1.0
	}

	finalScore := weightedScore / totalWeight
	avgStop := totalStop / totalWeight
	avgTarget := totalTarget / totalWeight

	consensus := strategies.SignalHold
	if finalScore >= p.BuyThreshold {
		consensus = strategies.SignalBuy
	} else if finalScore <= p.SellThreshold {
		consensus = strategies.SignalSell
	}

	// Composite Macro Trend Alignment Filter for Consensus BUY Signals
	if p.EnableTrendFilter && consensus == strategies.SignalBuy && len(closes) >= 50 {
		lastClose := closes[len(closes)-1]
		ema20, err20 := signals.EMA(closes, 20)
		ema50, err50 := signals.EMA(closes, 50)
		if err20 == nil && err50 == nil && len(ema20) > 0 && len(ema50) > 0 {
			lastEMA20 := ema20[len(ema20)-1]
			lastEMA50 := ema50[len(ema50)-1]
			if lastClose < lastEMA20 || lastEMA20 < lastEMA50 {
				consensus = strategies.SignalHold
				rationales = append(rationales, "[Macro Trend Filter: Consensus BUY overridden to HOLD due to downtrend]")
			}
		}
	}

	sort.Slice(collectedSignals, func(i, j int) bool {
		return collectedSignals[i].Score > collectedSignals[j].Score
	})

	return PlanEvaluation{
		PlanName:        p.planName,
		AssetClass:      assetClass,
		Symbol:          symbol,
		ConsensusSignal: consensus,
		WeightedScore:   finalScore,
		StopLossPct:     avgStop,
		TargetPct:       avgTarget,
		StrategySignals: collectedSignals,
		Rationale:       strings.Join(rationales, " | "),
		Timestamp:       evalTime,
	}, nil
}
