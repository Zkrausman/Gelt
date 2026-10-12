package strategies

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDynamicStrategyDefinition_Validate(t *testing.T) {
	tests := []struct {
		name    string
		def     DynamicStrategyDefinition
		wantErr bool
		errMsg  string
	}{
		{
			name: "Valid Strategy - Single Condition",
			def: DynamicStrategyDefinition{
				Name:        "Test Strategy",
				Description: "A test strategy",
				Conditions: []Condition{
					{
						FeatureKey: "Macro.FRED.EFFR",
						Operator:   OpGreaterThan,
						Threshold:  5.0,
					},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalBuy,
			},
			wantErr: false,
		},
		{
			name: "Valid Strategy - Multiple Conditions AND",
			def: DynamicStrategyDefinition{
				Name:        "Test Strategy",
				Description: "A test strategy",
				Conditions: []Condition{
					{
						FeatureKey: "Macro.FRED.EFFR",
						Operator:   OpGreaterThan,
						Threshold:  5.0,
					},
					{
						FeatureKey: "Macro.FRED.VIX",
						Operator:   OpLessThan,
						Threshold:  20.0,
					},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalBuy,
			},
			wantErr: false,
		},
		{
			name: "Valid Strategy - Multiple Conditions OR",
			def: DynamicStrategyDefinition{
				Name:        "Test Strategy",
				Description: "A test strategy",
				Conditions: []Condition{
					{
						FeatureKey: "Macro.FRED.EFFR",
						Operator:   OpGreaterThan,
						Threshold:  5.0,
					},
					{
						FeatureKey: "Macro.FRED.VIX",
						Operator:   OpLessThan,
						Threshold:  20.0,
					},
				},
				LogicalOp: LogOpOr,
				Signal:    SignalSell,
			},
			wantErr: false,
		},
		{
			name: "Invalid - Empty Name",
			def: DynamicStrategyDefinition{
				Name: "",
				Conditions: []Condition{
					{FeatureKey: "key", Operator: OpEquals, Threshold: 1},
				},
				Signal: SignalBuy,
			},
			wantErr: true,
			errMsg:  "strategy name cannot be empty",
		},
		{
			name: "Invalid - No Conditions",
			def: DynamicStrategyDefinition{
				Name:       "Test Strategy",
				Conditions: []Condition{},
				Signal:     SignalBuy,
			},
			wantErr: true,
			errMsg:  "strategy must have at least one condition",
		},
		{
			name: "Invalid - Invalid Logical Operator with multiple conditions",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "key1", Operator: OpEquals, Threshold: 1},
					{FeatureKey: "key2", Operator: OpEquals, Threshold: 2},
				},
				LogicalOp: "INVALID",
				Signal:    SignalBuy,
			},
			wantErr: true,
			errMsg:  "invalid logical operator: INVALID",
		},
		{
			name: "Valid - Invalid Logical Operator with single condition is accepted",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "key1", Operator: OpEquals, Threshold: 1},
				},
				LogicalOp: "INVALID",
				Signal:    SignalBuy,
			},
			wantErr: false,
		},
		{
			name: "Invalid - Invalid Signal",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "key1", Operator: OpEquals, Threshold: 1},
				},
				LogicalOp: LogOpAnd,
				Signal:    "INVALID_SIGNAL",
			},
			wantErr: true,
			errMsg:  "invalid signal type: INVALID_SIGNAL",
		},
		{
			name: "Invalid - Empty Feature Key",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "", Operator: OpEquals, Threshold: 1},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalBuy,
			},
			wantErr: true,
			errMsg:  "condition 0: feature key cannot be empty",
		},
		{
			name: "Invalid - Invalid Operator",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "key", Operator: "INVALID_OP", Threshold: 1},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalBuy,
			},
			wantErr: true,
			errMsg:  "condition 0: invalid operator: INVALID_OP",
		},
		{
			name: "Valid - All Operators",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "key1", Operator: OpGreaterThan, Threshold: 1},
					{FeatureKey: "key2", Operator: OpLessThan, Threshold: 1},
					{FeatureKey: "key3", Operator: OpEquals, Threshold: 1},
					{FeatureKey: "key4", Operator: OpGreaterThanOrEqual, Threshold: 1},
					{FeatureKey: "key5", Operator: OpLessThanOrEqual, Threshold: 1},
					{FeatureKey: "key6", Operator: OpNotEquals, Threshold: 1},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalBuy,
			},
			wantErr: false,
		},
		{
			name: "Valid - Hold Signal",
			def: DynamicStrategyDefinition{
				Name: "Test Strategy",
				Conditions: []Condition{
					{FeatureKey: "key1", Operator: OpEquals, Threshold: 1},
				},
				LogicalOp: LogOpAnd,
				Signal:    SignalHold,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.def.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && !strings.Contains(err.Error(), tt.errMsg) {
				t.Errorf("Validate() error = %v, wantErrMsg to contain %v", err, tt.errMsg)
			}
		})
	}
}

func TestDynamicStrategyDefinition_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name     string
		jsonStr  string
		expected bool
	}{
		{
			name:     "Explicitly false",
			jsonStr:  `{"name":"T","description":"T","conditions":[{"feature_key":"k","operator":"==","threshold":1}],"signal":"BUY","intraday_only":false}`,
			expected: false,
		},
		{
			name:     "Explicitly true",
			jsonStr:  `{"name":"T","description":"T","conditions":[{"feature_key":"k","operator":"==","threshold":1}],"signal":"BUY","intraday_only":true}`,
			expected: true,
		},
		{
			name:     "Missing defaults to true",
			jsonStr:  `{"name":"T","description":"T","conditions":[{"feature_key":"k","operator":"==","threshold":1}],"signal":"BUY"}`,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var def DynamicStrategyDefinition
			err := json.Unmarshal([]byte(tt.jsonStr), &def)
			if err != nil {
				t.Fatalf("Failed to unmarshal JSON: %v", err)
			}
			if def.IntradayOnly != tt.expected {
				t.Errorf("Expected IntradayOnly=%v, got %v", tt.expected, def.IntradayOnly)
			}
		})
	}
}

func TestDynamicStrategyDefinition_Validate_AssetClass(t *testing.T) {
	tests := []struct {
		name          string
		def           DynamicStrategyDefinition
		expectErr     bool
		expectedClass AssetClass
	}{
		{
			name: "default asset class is equity",
			def: DynamicStrategyDefinition{
				Name: "TestStrategy",
				Conditions: []Condition{
					{FeatureKey: "RSI", Operator: OpGreaterThan, Threshold: 50},
				},
				Signal: SignalBuy,
			},
			expectErr:     false,
			expectedClass: AssetEquity,
		},
		{
			name: "valid explicit asset class crypto",
			def: DynamicStrategyDefinition{
				Name:       "CryptoStrat",
				AssetClass: AssetCrypto,
				Conditions: []Condition{
					{FeatureKey: "MACD", Operator: OpGreaterThan, Threshold: 0},
				},
				Signal: SignalBuy,
			},
			expectErr:     false,
			expectedClass: AssetCrypto,
		},
		{
			name: "invalid asset class",
			def: DynamicStrategyDefinition{
				Name:       "BadStrat",
				AssetClass: AssetClass("BOND"),
				Conditions: []Condition{
					{FeatureKey: "RSI", Operator: OpGreaterThan, Threshold: 50},
				},
				Signal: SignalBuy,
			},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.def.Validate()
			if tt.expectErr {
				if err == nil {
					t.Errorf("expected error, got nil")
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				if tt.def.AssetClass != tt.expectedClass {
					t.Errorf("expected asset class %s, got %s", tt.expectedClass, tt.def.AssetClass)
				}
			}
		})
	}
}

