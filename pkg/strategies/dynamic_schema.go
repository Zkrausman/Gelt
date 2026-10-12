package strategies

import (
	"encoding/json"
	"errors"
	"fmt"

)

// Operator represents a comparison operator in a dynamic strategy rule.
type Operator string

const (
	// OpGreaterThan represents the > operator
	OpGreaterThan Operator = ">"
	// OpLessThan represents the < operator
	OpLessThan Operator = "<"
	// OpEquals represents the == operator
	OpEquals Operator = "=="
	// OpGreaterThanOrEqual represents the >= operator
	OpGreaterThanOrEqual Operator = ">="
	// OpLessThanOrEqual represents the <= operator
	OpLessThanOrEqual Operator = "<="
	// OpNotEquals represents the != operator
	OpNotEquals Operator = "!="
)

// LogicalOperator represents how multiple conditions are combined.
type LogicalOperator string

const (
	// LogOpAnd requires all conditions to be met.
	LogOpAnd LogicalOperator = "AND"
	// LogOpOr requires at least one condition to be met.
	LogOpOr LogicalOperator = "OR"
)

// Condition defines a single rule to evaluate a specific feature against a threshold.
type Condition struct {
	FeatureKey string   `json:"feature_key"`
	Operator   Operator `json:"operator"`
	Threshold  float64  `json:"threshold"`
	AgentPrompt string  `json:"agent_prompt,omitempty"`
}

// DynamicStrategyDefinition represents the structure of a strategy loaded from JSON/YAML.
type DynamicStrategyDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	AssetClass  AssetClass      `json:"asset_class"`
	Conditions  []Condition     `json:"conditions"`
	LogicalOp   LogicalOperator `json:"logical_op"`
	Signal      SignalType      `json:"signal"`
	IntradayOnly bool           `json:"intraday_only"`
	AutoLiquidateAtClose bool   `json:"auto_liquidate_at_close,omitempty"`
	BuyThreshold  float64       `json:"buy_threshold,omitempty"`
	SellThreshold float64       `json:"sell_threshold,omitempty"`
}

// Validate checks if the strategy definition is structurally sound and uses valid operators.
func (d *DynamicStrategyDefinition) Validate() error {
	if d.AssetClass == "" {
		d.AssetClass = AssetEquity
	} else if d.AssetClass != AssetEquity && d.AssetClass != AssetCrypto && d.AssetClass != AssetOptions {
		return fmt.Errorf("invalid asset class: %s", d.AssetClass)
	}
	if d.Name == "" {
		return errors.New("strategy name cannot be empty")
	}

	if len(d.Conditions) == 0 {
		return errors.New("strategy must have at least one condition")
	}

	if d.LogicalOp != LogOpAnd && d.LogicalOp != LogOpOr {
		if len(d.Conditions) > 1 {
			return fmt.Errorf("invalid logical operator: %s", d.LogicalOp)
		}
		// If there is only one condition, we don't strictly enforce logical operator
		// though setting it to AND is good practice.
	}

	if d.Signal != SignalBuy && d.Signal != SignalSell && d.Signal != SignalHold && d.Signal != SignalAgentReview {
		return fmt.Errorf("invalid signal type: %s", d.Signal)
	}

	for i, cond := range d.Conditions {
		if cond.AgentPrompt != "" {
			continue
		}

		if cond.FeatureKey == "" {
			return fmt.Errorf("condition %d: feature key cannot be empty", i)
		}
		switch cond.Operator {
		case OpGreaterThan, OpLessThan, OpEquals, OpGreaterThanOrEqual, OpLessThanOrEqual, OpNotEquals:
			// valid
		default:
			return fmt.Errorf("condition %d: invalid operator: %s", i, cond.Operator)
		}
	}

	return nil
}


// UnmarshalJSON implements custom unmarshaling to set default values.
func (d *DynamicStrategyDefinition) UnmarshalJSON(data []byte) error {
	type Alias DynamicStrategyDefinition
	aux := &struct {
		IntradayOnly *bool `json:"intraday_only"`
		*Alias
	}{
		Alias: (*Alias)(d),
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	if aux.IntradayOnly != nil {
		d.IntradayOnly = *aux.IntradayOnly
	} else {
		d.IntradayOnly = true // default
	}
	d.AutoLiquidateAtClose = d.IntradayOnly

	if d.BuyThreshold == 0.0 {
		d.BuyThreshold = 75.0
	}
	if d.SellThreshold == 0.0 {
		d.SellThreshold = 35.0
	}

	return nil
}
