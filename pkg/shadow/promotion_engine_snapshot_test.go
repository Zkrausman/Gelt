package shadow

import (
	"testing"
	"time"

	"gelt/pkg/config"
	"gelt/pkg/plans"
	"gelt/pkg/risk"
)

func TestPromotionEngineEvaluatesCurrentLockedSnapshot(t *testing.T) {
	path := t.TempDir() + "/journal.json"
	store := NewStore(path, path+".cycles")
	qualifying := []ShadowTrade{
		{ID: "1", PlanName: "RangeBoundDefensivePlan", Status: "CLOSED", PnLUSD: 150},
		{ID: "2", PlanName: "RangeBoundDefensivePlan", Status: "CLOSED", PnLUSD: 150},
		{ID: "3", PlanName: "RangeBoundDefensivePlan", Status: "CLOSED", PnLUSD: 150},
	}
	if err := store.save(qualifying); err != nil {
		t.Fatal(err)
	}
	registry := plans.NewPlanRegistry()
	plan, _ := plans.DefaultPlanSuite().Get("RangeBoundDefensivePlan")
	registry.Register(plan)
	other, _ := plans.DefaultPlanSuite().Get("IntradayAlphaPlan")
	registry.Register(other)
	registry.SetActive("IntradayAlphaPlan")
	engine := NewPromotionEngine(&config.PromotionConfig{AutoPromoEnabled: true}, &PromotionEvaluator{
		InitialBalance: 10000, CapitalBudgetUSD: 10000,
		Gate: config.PromotionGate{MinTrades: 3, PromoteWinRate: 65, PromoteProfitFactor: 1.5, PromoteMaxVaR: 5},
	}, registry, risk.NewIntradayDrawdownMonitor(registry, -1.5, "CashPlan"), store)

	locked := make(chan struct{})
	release := make(chan struct{})
	go func() {
		if err := store.withMutation(path, func() error {
			close(locked)
			<-release
			return marshalAndReplace(path, qualifying[:2], store.replace)
		}); err != nil {
			t.Errorf("replace locked snapshot: %v", err)
		}
	}()
	<-locked
	done := make(chan struct{})
	go func() {
		defer close(done)
		engine.EvaluateAndPromoteAt(time.Date(2023, 10, 10, 10, 0, 0, 0, time.FixedZone("ET", -4*60*60)))
	}()
	close(release)
	<-done
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := engine.evaluator.evaluateTrades(trades); len(got) != 0 {
		t.Fatalf("current snapshot qualified plans = %v, want none", got)
	}
	active, err := registry.Active()
	if err != nil {
		t.Fatal(err)
	}
	if active.Name() != "IntradayAlphaPlan" {
		t.Fatalf("stale qualification promoted %q after locked snapshot changed", active.Name())
	}
}
