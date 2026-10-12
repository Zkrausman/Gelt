package shadow

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"gelt/pkg/config"
	"gelt/pkg/notify"
	"gelt/pkg/plans"
	"gelt/pkg/risk"
)

func TestPromotionEngine_AlertOnly(t *testing.T) {
	// Setup test webhook server
	var webhookCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&webhookCalls, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Configure notify to use test server
	notify.DefaultDispatcher.SetEndpoint(server.URL)

	// Setup store with a winning strategy
	tmpFile, err := os.CreateTemp("", "journal_*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	store := NewStore(tmpFile.Name(), tmpFile.Name()+"_cycles.json")

	// Create qualifying trades
	trades := []ShadowTrade{
		{ID: "1", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
		{ID: "2", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: -50},
		{ID: "3", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
		{ID: "4", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
	}
	b, _ := json.Marshal(trades)
	os.WriteFile(tmpFile.Name(), b, 0644)

	cfg := &config.PromotionConfig{
		AutoPromoEnabled: false,
		PromoAlertOnly:   true,
	}

	registry := plans.NewPlanRegistry()
	pSuite := plans.DefaultPlanSuite()
	targetPlan, _ := pSuite.Get("RangeBoundDefensivePlan")
	registry.Register(targetPlan)

	monitor := risk.NewIntradayDrawdownMonitor(registry, -1.5, "CashPlan")
	evaluator := &PromotionEvaluator{
		InitialBalance:   10000.0,
		CapitalBudgetUSD: 10000.0,
		Gate: config.PromotionGate{
			MinTrades:           3,
			PromoteWinRate:      65.0,
			PromoteProfitFactor: 1.5,
			PromoteMaxVaR:       5.0,
			DemoteProfitFactor:  1.1,
			DemoteMaxDrawdown:   5.0,
		},
	}

	engine := NewPromotionEngine(cfg, evaluator, registry, monitor, store)

	// Run evaluation at a valid time (e.g. 10:00 AM ET)
	loc, _ := time.LoadLocation("America/New_York")
	evalTime := time.Date(2023, 10, 10, 10, 0, 0, 0, loc)

	engine.EvaluateAndPromoteAt(evalTime)

	// Wait for async webhook dispatcher
	time.Sleep(100 * time.Millisecond)

	if atomic.LoadInt32(&webhookCalls) == 0 {
		t.Error("Expected webhook to be called in AlertOnly mode")
	}
}

func TestPromotionEngineSuppressesPromotionWhenCapitalStateLatches(t *testing.T) {
	var webhookCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&webhookCalls, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	notify.DefaultDispatcher.SetEndpoint(server.URL)

	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{
		{ID: "1", PlanName: "RangeBoundDefensivePlan", Status: "CLOSED", PnLUSD: 150},
		{ID: "2", PlanName: "RangeBoundDefensivePlan", Status: "CLOSED", PnLUSD: 150},
		{ID: "3", PlanName: "RangeBoundDefensivePlan", Status: "CLOSED", PnLUSD: 150},
		{ID: "invalid-open", PlanName: "RangeBoundDefensivePlan", Status: "OPEN", AmountUSD: 0},
	}); err != nil {
		t.Fatal(err)
	}
	registry := plans.NewPlanRegistry()
	plan, _ := plans.DefaultPlanSuite().Get("RangeBoundDefensivePlan")
	registry.Register(plan)
	evaluator := &PromotionEvaluator{InitialBalance: 10000, CapitalBudgetUSD: 10000, Gate: config.PromotionGate{MinTrades: 3, PromoteWinRate: 65, PromoteProfitFactor: 1.5, PromoteMaxVaR: 5}}
	engine := NewPromotionEngine(&config.PromotionConfig{PromoAlertOnly: true}, evaluator, registry, risk.NewIntradayDrawdownMonitor(registry, -1.5, "CashPlan"), store)
	loc, _ := time.LoadLocation("America/New_York")
	engine.EvaluateAndPromoteAt(time.Date(2023, 10, 10, 10, 0, 0, 0, loc))
	time.Sleep(100 * time.Millisecond)
	if atomic.LoadInt32(&webhookCalls) != 0 {
		t.Fatal("latched capital history emitted a promotion alert")
	}
	state, err := store.LoadCapitalReservationState()
	if err != nil {
		t.Fatal(err)
	}
	if !state.Degraded {
		t.Fatal("promotion evaluation did not latch invalid open capital state")
	}
}

func TestPromotionEngine_AutoPromoIsSuppressedWithoutDurableActivation(t *testing.T) {
	tmpFile, _ := os.CreateTemp("", "journal_*.json")
	defer os.Remove(tmpFile.Name())

	store := NewStore(tmpFile.Name(), tmpFile.Name()+"_cycles.json")

	trades := []ShadowTrade{
		{ID: "1", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
		{ID: "2", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
		{ID: "3", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
		{ID: "4", PlanName: "RangeBoundDefensivePlan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 150},
	}
	b, _ := json.Marshal(trades)
	os.WriteFile(tmpFile.Name(), b, 0644)

	cfg := &config.PromotionConfig{
		AutoPromoEnabled: true,
		PromoAlertOnly:   false,
	}

	registry := plans.NewPlanRegistry()
	pSuite := plans.DefaultPlanSuite()
	targetPlan, _ := pSuite.Get("RangeBoundDefensivePlan")
	registry.Register(targetPlan)

	initialPlan, _ := pSuite.Get("IntradayAlphaPlan")
	registry.Register(initialPlan)
	registry.SetActive("IntradayAlphaPlan")

	monitor := risk.NewIntradayDrawdownMonitor(registry, -1.5, "IntradayAlphaPlan")

	evaluator := &PromotionEvaluator{
		InitialBalance:   10000.0,
		CapitalBudgetUSD: 10000.0,
		Gate: config.PromotionGate{
			MinTrades:           3,
			PromoteWinRate:      65.0,
			PromoteProfitFactor: 1.5,
			PromoteMaxVaR:       5.0,
			DemoteProfitFactor:  1.1,
			DemoteMaxDrawdown:   5.0,
		},
	}
	engine := NewPromotionEngine(cfg, evaluator, registry, monitor, store)

	loc, _ := time.LoadLocation("America/New_York")
	evalTime := time.Date(2023, 10, 10, 10, 0, 0, 0, loc)

	engine.EvaluateAndPromoteAt(evalTime)

	active, err := registry.Active()
	if err != nil {
		t.Fatal(err)
	}

	if active.Name() != "IntradayAlphaPlan" {
		t.Errorf("Auto-promotion must be suppressed without durable activation, got %s", active.Name())
	}
}
