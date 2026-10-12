package plans

import (
	"os"
	"path/filepath"
	"gelt/pkg/config"
	"net/http/httptest"
	"net/http"
	"gelt/pkg/notify"
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/risk"
	"gelt/pkg/strategies"
)

func sampleData() ([]float64, []float64) {
	closes := make([]float64, 50)
	volumes := make([]float64, 50)
	base := 100.0
	for i := 0; i < 50; i++ {
		closes[i] = base + float64(i)*0.5
		volumes[i] = 10000.0 + float64(i)*100
	}
	return closes, volumes
}

func TestPlanRegistry(t *testing.T) {
	reg := DefaultPlanSuite()
	plansList := reg.List()

	if len(plansList) != 5 {
		t.Fatalf("expected 5 built-in trading plans, got %d", len(plansList))
	}

	active, err := reg.Active()
	if err != nil {
		t.Fatalf("failed to get active plan: %v", err)
	}

	if active.Name() != "IntradayAlphaPlan" {
		t.Errorf("expected default active plan 'IntradayAlphaPlan', got %s", active.Name())
	}

	// Test switching active plan
	if err := reg.SetActive("RangeBoundDefensivePlan"); err != nil {
		t.Fatalf("failed to set active plan: %v", err)
	}

	newActive, _ := reg.Active()
	if newActive.Name() != "RangeBoundDefensivePlan" {
		t.Errorf("expected new active plan 'RangeBoundDefensivePlan', got %s", newActive.Name())
	}
}

func TestPlanEvaluation(t *testing.T) {
	reg := DefaultPlanSuite()
	active, _ := reg.Active()

	closes, volumes := sampleData()

	eval, err := active.Evaluate(context.Background(), time.Now(), "TSLA", closes, volumes)
	if err != nil {
		t.Fatalf("plan evaluation failed: %v", err)
	}

	if eval.PlanName != active.Name() {
		t.Errorf("expected plan name %s, got %s", active.Name(), eval.PlanName)
	}

	if eval.WeightedScore < 0.0 || eval.WeightedScore > 100.0 {
		t.Errorf("weighted score %.2f out of bounds [0, 100]", eval.WeightedScore)
	}

	if eval.ConsensusSignal != strategies.SignalBuy && eval.ConsensusSignal != strategies.SignalHold && eval.ConsensusSignal != strategies.SignalSell {
		t.Errorf("invalid consensus signal: %s", eval.ConsensusSignal)
	}
}

func TestConcurrentHotSwap(t *testing.T) {
	reg := DefaultPlanSuite()
	closes, volumes := sampleData()

	var wg sync.WaitGroup
	// Run concurrent evaluation ticks
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_, err := reg.EvaluateActive(context.Background(), time.Now(), "SPY", closes, volumes)
				if err != nil {
					t.Errorf("concurrent evaluation failed: %v", err)
				}
			}
		}()
	}

	// Run concurrent plan hot-swaps
	wg.Add(1)
	go func() {
		defer wg.Done()
		plans := []string{"IntradayAlphaPlan", "RangeBoundDefensivePlan", "BreakoutExpansionPlan", "OptionsAlphaPlan"}
		for i := 0; i < 30; i++ {
			p := plans[i%len(plans)]
			_ = reg.SetActive(p)
		}
	}()

	wg.Wait()
}

func TestAutonomousRegimeSwap(t *testing.T) {
	reg := DefaultPlanSuite()

	// 1. Verify default active plan is IntradayAlphaPlan
	active, err := reg.Active()
	if err != nil {
		t.Fatalf("failed to get active plan: %v", err)
	}
	if active.Name() != "IntradayAlphaPlan" {
		t.Fatalf("expected initial active plan IntradayAlphaPlan, got %s", active.Name())
	}

	// 2. Inject mock market data with VIX spike to 28.0
	closes, _ := sampleData()
	vixSpike := 28.0

	status, swapped, err := reg.EvaluateRegimeAndAutoSwap(vixSpike, closes)
	if err != nil {
		t.Fatalf("EvaluateRegimeAndAutoSwap failed: %v", err)
	}

	// 3. Assert automatic state transition to RangeBoundDefensivePlan
	if !swapped {
		t.Errorf("expected autonomous regime swap to occur, got swapped=false")
	}
	if !status.AlertTriggered {
		t.Errorf("expected alert triggered for VIX 28.0")
	}

	newActive, _ := reg.Active()
	if newActive.Name() != "RangeBoundDefensivePlan" {
		t.Errorf("expected active plan pointer to be RangeBoundDefensivePlan, got %s", newActive.Name())
	}

	// 4. Test Hysteresis Lock (Anti-Thrashing)
	if !reg.IsDefensiveLocked() {
		t.Errorf("expected defensive hysteresis lock to be active after auto-swap")
	}

	// Inject boundary VIX 25.1 — should remain locked in RangeBoundDefensivePlan without second swap call
	_, secondSwapped, err := reg.EvaluateRegimeAndAutoSwap(25.1, closes)
	if err != nil {
		t.Fatalf("second regime evaluation failed: %v", err)
	}
	if secondSwapped {
		t.Errorf("expected second swap to be blocked by hysteresis lock")
	}

	// 5. Test manual CLI override resets hysteresis lock
	if err := reg.SetActive("IntradayAlphaPlan"); err != nil {
		t.Fatalf("manual SetActive failed: %v", err)
	}
	if reg.IsDefensiveLocked() {
		t.Errorf("expected manual SetActive to reset hysteresis lock")
	}
	revertedActive, _ := reg.Active()
	if revertedActive.Name() != "IntradayAlphaPlan" {
		t.Errorf("expected plan reverted to IntradayAlphaPlan, got %s", revertedActive.Name())
	}
}

func TestEvaluateActive_CircuitBreaker(t *testing.T) {
	reg := DefaultPlanSuite()

	closes := []float64{100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130}
	volumes := make([]float64, len(closes))
	for i := range volumes {
		volumes[i] = 1000
	}

	// Force the HaltState to be true and observe that SignalBuy doesn't happen.

	risk.GlobalBreaker.ResetHalt(10000.0)
	risk.GlobalBreaker.CheckDrawdown(5000.0, 10.0) // 50% drawdown, triggering halt

	if !risk.GlobalBreaker.IsHalted() {
		t.Fatalf("Expected GlobalBreaker to be halted")
	}

	eval, err := reg.EvaluateActive(context.Background(), time.Now(), "SPY", closes, volumes)
	if err != nil {
		t.Fatalf("EvaluateActive failed: %v", err)
	}

	if eval.ConsensusSignal == strategies.SignalBuy {
		t.Errorf("Expected SignalBuy to be rejected due to HaltState")
	}

	// Reset for other tests
	risk.GlobalBreaker.ResetHalt(10000.0)
}

type mockHighScoreStrategy struct{}

func (m *mockHighScoreStrategy) Init(r *data.FeatureRegistry) error { return nil }
func (m *mockHighScoreStrategy) Name() string                        { return "MockHighScore" }
func (m *mockHighScoreStrategy) Description() string                 { return "Mock" }
func (m *mockHighScoreStrategy) Evaluate(ctx context.Context, t time.Time, s string, c []float64, v []float64) (strategies.StrategySignal, error) {
	return strategies.StrategySignal{
		StrategyName: "MockHighScore",
		Signal:       strategies.SignalBuy,
		Score:        95.0,
	}, nil
}
func (m *mockHighScoreStrategy) CapitalRequirement() float64 { return 0 }
func (m *mockHighScoreStrategy) IsIntradayOnly() bool        { return false }

func TestBasePlan_MacroTrendAlignment(t *testing.T) {
	plan := NewBasePlan("TestPlan", "Test", []WeightedStrategy{
		{Strategy: &mockHighScoreStrategy{}, Weight: 1.0},
	}).WithTrendFilter(true)

	// 55 candles in downtrend (price < 20 EMA < 50 EMA)
	closes := make([]float64, 55)
	volumes := make([]float64, 55)
	for i := 0; i < 55; i++ {
		closes[i] = 200.0 - float64(i)*1.0
		volumes[i] = 1000.0
	}

	eval, err := plan.Evaluate(context.Background(), time.Now(), "SPY", closes, volumes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if eval.ConsensusSignal != strategies.SignalHold {
		t.Errorf("expected consensus signal to be overridden to SignalHold when WithTrendFilter(true), got %v", eval.ConsensusSignal)
	}
}

func init() {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	notify.DefaultDispatcher.SetEndpoint(ts.URL)
}
func (s *mockHighScoreStrategy) SetParams(params map[string]float64) {}


type MockThresholdStrategy struct {
	fixedScore float64
	capturedParams map[string]float64
}

func (s *MockThresholdStrategy) Name() string { return "MockThreshold" }
func (s *MockThresholdStrategy) Description() string { return "Mock" }
func (s *MockThresholdStrategy) Init(registry *data.FeatureRegistry) error { return nil }
func (s *MockThresholdStrategy) SetParams(params map[string]float64) { s.capturedParams = params }
func (s *MockThresholdStrategy) CapitalRequirement() float64 { return 0.0 }
func (s *MockThresholdStrategy) IsIntradayOnly() bool { return false }
func (s *MockThresholdStrategy) Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (strategies.StrategySignal, error) {
	return strategies.StrategySignal{
		AssetClass: strategies.AssetEquity,
		Score: s.fixedScore,
	}, nil
}

func TestBasePlan_EvaluateConsensusBoundaries(t *testing.T) {
	// Isolate AppConfig to avoid loading ~/.gelt/config.json
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	// Create custom app config with specific thresholds
	cfg, _, err := config.InitUserConfig()
	if err != nil {
		t.Fatalf("InitUserConfig failed: %v", err)
	}
	cfg.BuyThreshold = 85.0
	cfg.SellThreshold = 45.0
	config.SaveAppConfig(cfg)

	registry := data.NewFeatureRegistry()
	mockStrat := &MockThresholdStrategy{fixedScore: 86.0} // Passes 85.0, fails 75.0 check if inverted

	weightedStrats := []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0},
	}

	plan := NewBasePlan("TestPlan", "desc", weightedStrats)
	err = plan.Init(registry)
	if err != nil {
		t.Fatalf("Failed to init plan: %v", err)
	}

	eval, _ := plan.Evaluate(context.Background(), time.Now(), "SPY", []float64{100.0, 101.0}, []float64{1000.0, 1000.0})
	if eval.ConsensusSignal != strategies.SignalBuy {
		t.Fatalf("Expected BUY consensus (score 86 >= 85), got %s", eval.ConsensusSignal)
	}

	mockStrat.fixedScore = 44.0 // Passes 45.0, fails 35.0
	eval, _ = plan.Evaluate(context.Background(), time.Now(), "SPY", []float64{100.0, 101.0}, []float64{1000.0, 1000.0})
	if eval.ConsensusSignal != strategies.SignalSell {
		t.Fatalf("Expected SELL consensus (score 44 <= 45), got %s", eval.ConsensusSignal)
	}

	mockStrat.fixedScore = 60.0 // HOLD
	eval, _ = plan.Evaluate(context.Background(), time.Now(), "SPY", []float64{100.0, 101.0}, []float64{1000.0, 1000.0})
	if eval.ConsensusSignal != strategies.SignalHold {
		t.Fatalf("Expected HOLD consensus, got %s", eval.ConsensusSignal)
	}
}

func TestPlan_OverrideHierarchy(t *testing.T) {
	// Isolate AppConfig
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	cfg, _, err := config.InitUserConfig()
	if err != nil {
		t.Fatalf("InitUserConfig failed: %v", err)
	}
	cfg.BuyThreshold = 80.0 // AppConfig level
	cfg.SellThreshold = 30.0
	cfg.StrategyConfig = map[string]map[string]float64{
		"MockThreshold": {
			"buy_threshold": 90.0, // StrategyConfig level
			"sell_threshold": 20.0,
		},
	}
	config.SaveAppConfig(cfg)

	registry := data.NewFeatureRegistry()
	mockStrat := &MockThresholdStrategy{fixedScore: 50.0}

	invalidStrats := []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0, Params: map[string]float64{"BuyThreshold": 110.0, "SellThreshold": 35.0}},
	}
	plan2 := NewBasePlan("TestPlan2", "desc", invalidStrats)
	err = plan2.Init(registry)
	if err == nil {
		t.Fatal("Expected error for out of bounds BuyThreshold")
	}

	invalidStrats2 := []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0, Params: map[string]float64{"BuyThreshold": 50.0, "SellThreshold": 60.0}},
	}
	plan3 := NewBasePlan("TestPlan3", "desc", invalidStrats2)
	err = plan3.Init(registry)
	if err == nil {
		t.Fatal("Expected error for SellThreshold >= BuyThreshold")
	}

	validStrats := []WeightedStrategy{
		// Params override StrategyConfig overrides AppConfig
		{Strategy: mockStrat, Weight: 1.0, Params: map[string]float64{"BuyThreshold": 95.0, "SellThreshold": 15.0}},
	}
	plan4 := NewBasePlan("TestPlan4", "desc", validStrats)
	err = plan4.Init(registry)
	if err != nil {
		t.Fatalf("Expected nil error for valid thresholds, got: %v", err)
	}

	// Test that strategy config > app config
	validStrats2 := []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0}, // No Params, should use StrategyConfig (90, 20)
	}
	plan5 := NewBasePlan("TestPlan5", "desc", validStrats2)
	err = plan5.Init(registry)
	if err != nil {
		t.Fatalf("Failed to init plan5: %v", err)
	}

	// The effective thresholds for plan5's strategy should be 90.0 and 20.0, but plan5.BuyThreshold itself
	// is the AppConfig level (80.0). Let's verify base plan uses AppConfig (80)
	if plan5.BuyThreshold != 80.0 {
		t.Fatalf("Expected BasePlan BuyThreshold to be 80.0 from AppConfig, got %v", plan5.BuyThreshold)
	}

	mockStrat.fixedScore = 85.0
	eval, _ := plan5.Evaluate(context.Background(), time.Now(), "SPY", []float64{100.0}, []float64{1000.0})
	// Consensus uses BasePlan threshold (80.0). Since 85 > 80, it should be BUY.
	if eval.ConsensusSignal != strategies.SignalBuy {
		t.Fatalf("Expected BUY consensus from BasePlan.BuyThreshold 80.0, got %v", eval.ConsensusSignal)
	}
}

func TestPlan_MixedAliasPrecedence(t *testing.T) {
	registry := data.NewFeatureRegistry()
	mockStrat := &MockThresholdStrategy{fixedScore: 50.0}

	// Setup AppConfig overrides
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	cfg, _, err := config.InitUserConfig()
	if err != nil {
		t.Fatalf("InitUserConfig failed: %v", err)
	}

	// StrategyConfig has BuyThreshold (camelCase)
	cfg.StrategyConfig = map[string]map[string]float64{
		"MockThreshold": {
			"BuyThreshold": 90.0,
			"SellThreshold": 20.0,
		},
	}
	config.SaveAppConfig(cfg)

	// ws.Params uses buy_threshold (snake_case)
	weightedStrats := []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0, Params: map[string]float64{"buy_threshold": 95.0, "sell_threshold": 15.0}},
	}

	plan := NewBasePlan("TestPlan", "desc", weightedStrats)
	err = plan.Init(registry)
	if err != nil {
		t.Fatalf("Failed to init plan: %v", err)
	}

	// Verify that snake_case overrides camelCase correctly
	// The effective thresholds should be 95.0 and 15.0 in the parameters passed to the strategy
	if mockStrat.capturedParams["BuyThreshold"] != 95.0 || mockStrat.capturedParams["SellThreshold"] != 15.0 {
		t.Fatalf("Expected strategy to receive effective thresholds 95/15, got %v/%v", mockStrat.capturedParams["BuyThreshold"], mockStrat.capturedParams["SellThreshold"])
	}

	// Test StrategyConfig conflicting aliases failure
	cfg.StrategyConfig = map[string]map[string]float64{
		"MockThreshold": {
			"BuyThreshold": 90.0,
			"buy_threshold": 80.0,
			"SellThreshold": 20.0,
		},
	}
	config.SaveAppConfig(cfg)

	plan2 := NewBasePlan("TestPlan2", "desc", []WeightedStrategy{{Strategy: mockStrat, Weight: 1.0}})
	if err := plan2.Init(registry); err == nil {
		t.Fatal("Expected error from Init due to conflicting StrategyConfig aliases")
	}

	// Test ws.Params conflicting aliases failure
	cfg.StrategyConfig = nil
	config.SaveAppConfig(cfg)
	plan3 := NewBasePlan("TestPlan3", "desc", []WeightedStrategy{{Strategy: mockStrat, Weight: 1.0, Params: map[string]float64{"BuyThreshold": 95.0, "buy_threshold": 85.0}}})
	if err := plan3.Init(registry); err == nil {
		t.Fatal("Expected error from Init due to conflicting ws.Params aliases")
	}
}

func TestLoadPlanFromYAML_ConflictingAliases(t *testing.T) {
	yamlContent := `
plan_name: TestYAML
description: Test
asset_class: EQUITY
auto_liquidate_at_close: false
intraday_only: false
strategies:
  - name: Random_Crypto
    weight: 1.0
    params:
      buy_threshold: 40.0
      BuyThreshold: 50.0
      sell_threshold: 30.0
`
	tmpFile, err := os.CreateTemp("", "test_plan_*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write([]byte(yamlContent)); err != nil {
		t.Fatalf("Failed to write temp file: %v", err)
	}
	tmpFile.Close()

	_, err = LoadPlanFromYAML(tmpFile.Name())
	if err == nil {
		t.Fatal("Expected error from LoadPlanFromYAML for conflicting aliases, got nil")
	}
}

func TestBasePlan_Init_InvalidATR(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	t.Setenv("USERPROFILE", tempDir)

	mockStrat := &MockThresholdStrategy{}
	plan := NewBasePlan("TestPlan", "desc", []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0},
	})

	// Inject invalid ATR via AppConfig
	cfg, _, _ := config.InitUserConfig()
	cfg.StrategyConfig = map[string]map[string]float64{
		"MockThreshold": {
			"atr_stop_multiplier": -1.0, // Invalid
		},
	}
	config.SaveAppConfig(cfg)

	registry := data.NewFeatureRegistry()
	err := plan.Init(registry)
	if err == nil {
		t.Fatal("Expected initialization error for invalid ATR multiplier")
	}
	if !strings.Contains(err.Error(), "invalid atr_stop_multiplier override") {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestBasePlan_Init_MalformedConfig(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	t.Setenv("USERPROFILE", tempDir)

	// Write a malformed config.json to $HOME/.gelt/config.json
	geltDir := filepath.Join(tempDir, ".gelt")
	os.MkdirAll(geltDir, 0755)
	configPath := filepath.Join(geltDir, "config.json")
	os.WriteFile(configPath, []byte("{ malformed json"), 0644)

	mockStrat := &MockThresholdStrategy{}
	plan := NewBasePlan("TestPlan", "desc", []WeightedStrategy{
		{Strategy: mockStrat, Weight: 1.0},
	})

	registry := data.NewFeatureRegistry()
	err := plan.Init(registry)
	if err == nil {
		t.Fatal("Expected initialization error for malformed config.json")
	}
	if !strings.Contains(err.Error(), "failed to load app config") {
		t.Errorf("Unexpected error message for malformed config: %v", err)
	}
}
