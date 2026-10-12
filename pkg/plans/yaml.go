package plans

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"

	"gelt/pkg/strategies"
)

// DynamicPlan defines the schema for a trading plan loaded from YAML.
type DynamicPlan struct {
	PlanName             string                    `yaml:"plan_name"`
	Description          string                    `yaml:"description"`
	AssetClass           string                    `yaml:"asset_class"`
	AutoLiquidateAtClose bool                      `yaml:"auto_liquidate_at_close"`
	IntradayOnly         bool                      `yaml:"intraday_only"`
	Strategies           []DynamicStrategyConfig   `yaml:"strategies"`
}

type DynamicStrategyConfig struct {
	Name        string             `yaml:"name"`
	Weight      float64            `yaml:"weight"`
	Signal      string             `yaml:"signal,omitempty"`
	AgentPrompt string             `yaml:"agent_prompt,omitempty"`
	Params      map[string]float64 `yaml:"params,omitempty"`
}

// LoadPlanFromYAML reads a YAML file and constructs a TradingPlan.
func LoadPlanFromYAML(path string) (TradingPlan, error) {
	dataBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read plan YAML: %w", err)
	}

	var dynPlan DynamicPlan
	if err := yaml.Unmarshal(dataBytes, &dynPlan); err != nil {
		return nil, fmt.Errorf("failed to parse plan YAML: %w", err)
	}

	catalog := strategies.DefaultCatalog()
	var weightedStrats []WeightedStrategy

	for _, sc := range dynPlan.Strategies {
		strat, err := catalog.Get(sc.Name)
		if err != nil {
			return nil, fmt.Errorf("strategy %q not found in catalog", sc.Name)
		}

		// If it has AgentPrompt, handle it? We can just wrap or use it if supported.
		// For now we just load standard params and weight.
		weightedStrats = append(weightedStrats, WeightedStrategy{
			Strategy: strat,
			Weight:   sc.Weight,
			Params:   sc.Params,
		})
	}

	basePlan := NewBasePlan(dynPlan.PlanName, dynPlan.Description, weightedStrats)

	// Apply params via SetParams for safety here as well, though BasePlan.Init does it.
	for _, ws := range weightedStrats {
		var buy, sell float64
		hasBuy, hasSell := false, false

		if ws.Params != nil {
			v1, ok1 := ws.Params["BuyThreshold"]
			v2, ok2 := ws.Params["buy_threshold"]

			if ok1 && ok2 && v1 != v2 {
				return nil, fmt.Errorf("duplicate conflicting buy threshold alias in yaml source")
			} else if ok1 {
				buy = v1
				hasBuy = true
			} else if ok2 {
				buy = v2
				hasBuy = true
			}

			v3, ok3 := ws.Params["SellThreshold"]
			v4, ok4 := ws.Params["sell_threshold"]
			if ok3 && ok4 && v3 != v4 {
				return nil, fmt.Errorf("duplicate conflicting sell threshold alias in yaml source")
			} else if ok3 {
				sell = v3
				hasSell = true
			} else if ok4 {
				sell = v4
				hasSell = true
			}

			if hasBuy || hasSell {
				if !hasBuy {
					buy = 75.0 // fallback default
				}
				if !hasSell {
					sell = 35.0 // fallback default
				}

				if buy < 0 || buy > 100 || sell < 0 || sell > 100 {
					return nil, fmt.Errorf("yaml strategy %q thresholds out of bounds (buy: %.1f, sell: %.1f)", ws.Strategy.Name(), buy, sell)
				}
				if sell >= buy {
					return nil, fmt.Errorf("yaml strategy %q sell threshold (%.1f) must be less than buy threshold (%.1f)", ws.Strategy.Name(), sell, buy)
				}
			}
		}

		ws.Strategy.SetParams(ws.Params)
	}


	// We'll leave Init to be called later or we can init it right away if registry is available.
	// Typically callers like daemon or tests will init the plan.

	// Wait, BasePlan doesn't store AutoLiquidateAtClose or IntradayOnly right now,
	// but we'll return it as a BasePlan.
	return basePlan, nil
}
