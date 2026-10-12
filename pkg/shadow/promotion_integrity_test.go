package shadow

import (
	"math"
	"testing"
	"time"

	"gelt/pkg/config"
)

func promotionEvaluator() *PromotionEvaluator {
	return &PromotionEvaluator{InitialBalance: 10000, CapitalBudgetUSD: 100, Gate: config.PromotionGate{MinTrades: 3, PromoteWinRate: 60, PromoteProfitFactor: 1, PromoteMaxVaR: 5, DemoteProfitFactor: 1, DemoteMaxDrawdown: 5}}
}

func TestPromotionEvaluatorRejectsInvalidInputsAndAllWinCandidate(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*PromotionEvaluator)
	}{
		{"infinite balance", func(e *PromotionEvaluator) { e.InitialBalance = math.Inf(1) }},
		{"nan gate", func(e *PromotionEvaluator) { e.Gate.PromoteWinRate = math.NaN() }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := promotionEvaluator()
			tc.mutate(e)
			if _, err := e.EvaluateAt(NewStore(t.TempDir()+"/j.json", t.TempDir()+"/c.json"), time.Date(2026, 1, 1, 10, 0, 0, 0, time.Local)); err == nil {
				t.Fatal("invalid promotion inputs were accepted")
			}
		})
	}
	e := promotionEvaluator()
	if got := e.evaluateTrades([]ShadowTrade{{PlanName: "p", Status: "CLOSED", PnLUSD: 1}, {PlanName: "p", Status: "CLOSED", PnLUSD: 2}, {PlanName: "p", Status: "CLOSED", PnLUSD: 3}}); len(got) != 0 {
		t.Fatalf("all-win sample qualified: %v", got)
	}
}

func TestGetPerformanceRejectsNonFiniteAndOverflowPnL(t *testing.T) {
	store := NewStore(t.TempDir()+"/j.json", t.TempDir()+"/c.json")
	if err := store.save([]ShadowTrade{{ID: "a", PlanName: "p", Symbol: "SPY", Status: "CLOSED", PnLUSD: math.MaxFloat64}, {ID: "b", PlanName: "p", Symbol: "QQQ", Status: "CLOSED", PnLUSD: math.MaxFloat64}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetPerformance("p"); err == nil {
		t.Fatal("overflowed closed PnL produced performance")
	}
}
