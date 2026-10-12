package main

import (
	"errors"
	"gelt/pkg/config"
	"testing"
)

func TestResolveStrategies(t *testing.T) {
	tests := []struct {
		name          string
		appCfg        *config.AppConfig
		appCfgErr     error
		expectedError bool
		expectedNames []string
	}{
		{
			name:          "Missing config",
			appCfg:        nil,
			appCfgErr:     errors.New("config not found"),
			expectedError: true,
		},
		{
			name: "Legacy config with no fallback_strategies",
			appCfg: &config.AppConfig{
				ActivePlan: "",
			},
			appCfgErr:     nil,
			expectedError: true,
		},
		{
			name: "Invalid active_plan without configured fallback",
			appCfg: &config.AppConfig{
				ActivePlan: "invalid_plan.yaml",
			},
			appCfgErr:     nil,
			expectedError: true,
		},
		{
			name: "Invalid active_plan with configured fallback",
			appCfg: &config.AppConfig{
				ActivePlan:         "invalid_plan.yaml",
				FallbackStrategies: []string{"MACD", "VWAP"},
			},
			appCfgErr:     nil,
			expectedError: false,
			expectedNames: []string{"MACD", "VWAP"},
		},
		{
			name: "Valid configured fallback being used directly",
			appCfg: &config.AppConfig{
				FallbackStrategies: []string{"Random", "AIChoice"},
			},
			appCfgErr:     nil,
			expectedError: false,
			expectedNames: []string{"Random", "AIChoice"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			names, err := resolveStrategies(tt.appCfg, tt.appCfgErr, false)
			if tt.expectedError && err == nil {
				t.Errorf("expected error but got nil")
			}
			if !tt.expectedError && err != nil {
				t.Errorf("did not expect error but got %v", err)
			}
			if !tt.expectedError {
				if len(names) != len(tt.expectedNames) {
					t.Errorf("expected %d names, got %d", len(tt.expectedNames), len(names))
				} else {
					for i, n := range names {
						if n != tt.expectedNames[i] {
							t.Errorf("expected %s at index %d, got %s", tt.expectedNames[i], i, n)
						}
					}
				}
			}
		})
	}
}
