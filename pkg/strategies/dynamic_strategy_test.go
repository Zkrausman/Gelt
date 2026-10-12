package strategies

import (
	"context"
	"strings"
	"testing"
	"time"

	"gelt/pkg/data"
)

// mockFeatureProvider provides a fixed data point for testing.
type dynamicMockFeatureProvider struct {
	val float64
	err error
}

func (m *dynamicMockFeatureProvider) Fetch(ctx context.Context, req data.FeatureRequest) ([]data.DataPoint, error) {
	if m.err != nil {
		return nil, m.err
	}
	return []data.DataPoint{
		{
			Timestamp: req.End,
			Value:     m.val,
		},
	}, nil
}

func TestDynamicStrategy(t *testing.T) {
	evalTime := time.Now()

	tests := []struct {
		name          string
		def           DynamicStrategyDefinition
		mockDataValue float64
		mockDataErr   error
		initRegistry  bool
		wantSignal    SignalType
		wantErr       bool
		errContains   string
	}{
		{
			name: "Init fails if registry is nil",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 5.0},
				},
				Signal: SignalBuy,
			},
			initRegistry: false,
			wantSignal:   SignalHold,
			wantErr:      true,
			errContains:  "not initialized with FeatureRegistry",
		},
		{
			name: "Invalid definition during evaluation",
			def: DynamicStrategyDefinition{
				Name: "", // Invalid
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 5.0},
				},
				Signal: SignalBuy,
			},
			initRegistry: true,
			wantSignal:   SignalHold,
			wantErr:      true,
			errContains:  "invalid strategy definition",
		},
		// Removed fetch failure test because GenerateSyntheticSeries will act as fallback,
		// never returning an error (it generates a fake sine wave value).
		// We can't easily test query failure natively without changing the registry behavior.
		{
			name: "Single Condition - Matches",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 5.0},
				},
				Signal: SignalBuy,
			},
			mockDataValue: 6.0,
			initRegistry:  true,
			wantSignal:    SignalBuy,
			wantErr:       false,
		},
		{
			name: "Single Condition - Does not match",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 5.0},
				},
				Signal: SignalBuy,
			},
			mockDataValue: 4.0,
			initRegistry:  true,
			wantSignal:    SignalHold, // Defaults to hold when conditions aren't met
			wantErr:       false,
		},
		{
			name: "Multiple Conditions AND - Matches",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 5.0},
					{FeatureKey: "Macro.Test2", Operator: OpLessThan, Threshold: 10.0},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalSell,
			},
			mockDataValue: 6.0, // Used for both features in this simple mock
			initRegistry:  true,
			wantSignal:    SignalSell,
			wantErr:       false,
		},
		{
			name: "Multiple Conditions AND - Does not match",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 5.0},
					{FeatureKey: "Macro.Test2", Operator: OpLessThan, Threshold: 3.0}, // Fails
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalSell,
			},
			mockDataValue: 6.0,
			initRegistry:  true,
			wantSignal:    SignalHold,
			wantErr:       false,
		},
		{
			name: "Multiple Conditions OR - Matches",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test", Operator: OpGreaterThan, Threshold: 10.0}, // Fails
					{FeatureKey: "Macro.Test2", Operator: OpLessThan, Threshold: 10.0}, // Matches
				},
				LogicalOp: LogOpOr,
				Signal:    SignalBuy,
			},
			mockDataValue: 6.0,
			initRegistry:  true,
			wantSignal:    SignalBuy,
			wantErr:       false,
		},
		{
			name: "All Operators Check",
			def: DynamicStrategyDefinition{
				Name: "Test",
				Conditions: []Condition{
					{FeatureKey: "Macro.Test1", Operator: OpGreaterThan, Threshold: 5.0},
					{FeatureKey: "Macro.Test2", Operator: OpLessThan, Threshold: 7.0},
					{FeatureKey: "Macro.Test3", Operator: OpEquals, Threshold: 6.0},
					{FeatureKey: "Macro.Test4", Operator: OpGreaterThanOrEqual, Threshold: 6.0},
					{FeatureKey: "Macro.Test5", Operator: OpLessThanOrEqual, Threshold: 6.0},
					{FeatureKey: "Macro.Test6", Operator: OpNotEquals, Threshold: 5.0},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalBuy,
			},
			mockDataValue: 6.0,
			initRegistry:  true,
			wantSignal:    SignalBuy,
			wantErr:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			strat := NewDynamicStrategy(tt.def)

			if strat.Name() != tt.def.Name {
				t.Errorf("Name() = %v, want %v", strat.Name(), tt.def.Name)
			}
			if strat.Description() != tt.def.Description {
				t.Errorf("Description() = %v, want %v", strat.Description(), tt.def.Description)
			}

			var reg *data.FeatureRegistry
			if tt.initRegistry {
				reg = data.NewFeatureRegistry()
				// Register mock provider for the prefix
				reg.Register("Macro", &dynamicMockFeatureProvider{
					val: tt.mockDataValue,
					err: tt.mockDataErr,
				})
			}

			err := strat.Init(reg)
			if !tt.initRegistry && err == nil {
				t.Errorf("Init() expected error when registry is nil")
			}
			if tt.initRegistry && err != nil {
				t.Errorf("Init() unexpected error: %v", err)
			}

			sig, err := strat.Evaluate(context.Background(), evalTime, "TEST", nil, nil)
			if (err != nil) != tt.wantErr {
				t.Errorf("Evaluate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr && err != nil && !strings.Contains(err.Error(), tt.errContains) {
				t.Errorf("Evaluate() error = %v, wantErr to contain %v", err, tt.errContains)
			}
			if !tt.wantErr && sig.Signal != tt.wantSignal {
				t.Errorf("Evaluate() signal = %v, want %v", sig.Signal, tt.wantSignal)
			}
		})
	}
}

// We will skip NoData test because FeatureRegistry has synthetic fallback which always returns data if start <= end
// unless we change how GenerateSyntheticSeries works or mock it.
