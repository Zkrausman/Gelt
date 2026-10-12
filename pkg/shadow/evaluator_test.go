package shadow

import (
	"gelt/pkg/config"
	"math"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestPromotionEvaluatorRejectsInvalidBudgetBeforeStoreAccess(t *testing.T) {
	loc, _ := time.LoadLocation("America/New_York")
	evalTime := time.Date(2026, time.August, 12, 10, 0, 0, 0, loc)
	for _, budget := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		evaluator := &PromotionEvaluator{CapitalBudgetUSD: budget}
		if _, err := evaluator.EvaluateAt(NewStore(filepath.Join(t.TempDir(), "missing", "journal.json"), ""), evalTime); err == nil {
			t.Fatalf("EvaluateAt accepted invalid budget %v", budget)
		}
	}
}

func TestPromotionEvaluatorRejectsClosedPnLOverflow(t *testing.T) {
	e := &PromotionEvaluator{InitialBalance: 10000, Gate: config.PromotionGate{MinTrades: 3, PromoteWinRate: 50, PromoteProfitFactor: 1, PromoteMaxVaR: 100}}
	trades := []ShadowTrade{
		{ID: "a", PlanName: "plan", Status: "CLOSED", PnLUSD: math.MaxFloat64},
		{ID: "b", PlanName: "plan", Status: "CLOSED", PnLUSD: math.MaxFloat64},
		{ID: "c", PlanName: "plan", Status: "CLOSED", PnLUSD: math.MaxFloat64},
	}
	if got := e.evaluateTrades(trades); len(got) != 0 {
		t.Fatalf("overflowing closed PnL qualified plans: %v", got)
	}
}

func TestPromotionEvaluator_Evaluate(t *testing.T) {
	// Use an isolated directory so replacement does not contend with an open temp handle.
	tmpFile := filepath.Join(t.TempDir(), "evaluator_test.json")
	store := NewStore(tmpFile, tmpFile+"_cycles.json")

	// Synthetic trades
	trades := []ShadowTrade{
		// 1. Qualifying Plan: Win Rate > 65%, PF > 1.5, Trades >= 3, VaR < 5% (Low drawdown)
		{ID: "q1", PlanName: "QualifyingPlan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "q2", PlanName: "QualifyingPlan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "q3", PlanName: "QualifyingPlan", PnLUSD: -10, Status: "CLOSED"}, // PF = 200/10 = 20, WR = 2/3 = 66.6%

		// 2. Low Win Rate: Win Rate <= 65%
		{ID: "lwr1", PlanName: "LowWinRatePlan", PnLUSD: 1000, Status: "CLOSED"}, // Big win so PF is high
		{ID: "lwr2", PlanName: "LowWinRatePlan", PnLUSD: -10, Status: "CLOSED"},
		{ID: "lwr3", PlanName: "LowWinRatePlan", PnLUSD: -10, Status: "CLOSED"}, // PF = 1000/20 = 50, WR = 1/3 = 33.3%

		// 3. High VaR: (Simulation might pick a path with huge drawdown, so we just give it massive losses)
		// To consistently hit VaR >= 5% ($500), we add massive drawdown possibilities.
		{ID: "hvr1", PlanName: "HighVaRPlan", PnLUSD: 1000, Status: "CLOSED"},
		{ID: "hvr2", PlanName: "HighVaRPlan", PnLUSD: 1000, Status: "CLOSED"},
		{ID: "hvr3", PlanName: "HighVaRPlan", PnLUSD: -600, Status: "CLOSED"}, // PF = 2000/600 = 3.33, WR = 2/3 = 66.6%, Max drawdown can be $600 or more if sampled repeatedly

		// 4. Low Trade Count: < 3 trades
		{ID: "ltc1", PlanName: "LowTradeCountPlan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "ltc2", PlanName: "LowTradeCountPlan", PnLUSD: 100, Status: "CLOSED"}, // WR = 100%, PF = Inf, Trades = 2

		// 5. Low Profit Factor: <= 1.5
		{ID: "lpf1", PlanName: "LowProfitFactorPlan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "lpf2", PlanName: "LowProfitFactorPlan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "lpf3", PlanName: "LowProfitFactorPlan", PnLUSD: -200, Status: "CLOSED"}, // PF = 200/200 = 1.0, WR = 2/3 = 66.6%
	}

	if err := store.save(trades); err != nil {
		t.Fatalf("failed to save trades: %v", err)
	}

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
	evalTime := time.Date(2023, 1, 10, 10, 0, 0, 0, time.UTC)
	qualifiedPlans, err := evaluator.EvaluateAt(store, evalTime)
	if err != nil {
		t.Fatalf("unexpected error during evaluation: %v", err)
	}

	// We expect ONLY "QualifyingPlan" to pass all filters.
	expectedPlans := []string{"QualifyingPlan"}

	if !reflect.DeepEqual(qualifiedPlans, expectedPlans) {
		t.Errorf("expected qualified plans %v, got %v", expectedPlans, qualifiedPlans)
	}
}

func TestPromotionEvaluatorRejectsLatchedCapitalHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{
		{ID: "winner-1", PlanName: "Plan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "winner-2", PlanName: "Plan", PnLUSD: 100, Status: "CLOSED"},
		{ID: "winner-3", PlanName: "Plan", PnLUSD: -10, Status: "CLOSED"},
		{ID: "invalid-open", PlanName: "Plan", AmountUSD: 0, Status: "OPEN"},
	}); err != nil {
		t.Fatal(err)
	}
	evaluator := &PromotionEvaluator{InitialBalance: 10000, CapitalBudgetUSD: 10000, Gate: config.PromotionGate{MinTrades: 3, PromoteWinRate: 65, PromoteProfitFactor: 1.5, PromoteMaxVaR: 5}}
	plans, err := evaluator.EvaluateAt(store, time.Date(2023, 1, 10, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 0 {
		t.Fatalf("latched capital history remained promotable: %v", plans)
	}
	state, err := store.LoadCapitalReservationState()
	if err != nil {
		t.Fatal(err)
	}
	if !state.Degraded {
		t.Fatal("promotion evaluation did not latch an invalid legacy open record")
	}
}

func TestShadowPerformanceEvaluator(t *testing.T) {
	gate := config.PromotionGate{
		MinTrades:           20,
		PromoteProfitFactor: 1.5,
		DemoteProfitFactor:  1.1,
		DemoteMaxDrawdown:   5.0,
	}
	evaluator := NewShadowPerformanceEvaluator(gate)

	// Helper to generate n closed trades with given PnL
	generateTrades := func(n int, pnl float64) []ShadowTrade {
		var trades []ShadowTrade
		for i := 0; i < n; i++ {
			trades = append(trades, ShadowTrade{Status: "CLOSED", PnLUSD: pnl})
		}
		return trades
	}

	t.Run("Gate holds when trades < 20", func(t *testing.T) {
		trades := generateTrades(10, 100) // PF = Inf, Trades = 10
		signal, metrics := evaluator.EvaluatePlan(trades)
		if signal != HOLD {
			t.Errorf("Expected HOLD, got %v", signal)
		}
		if metrics.ClosedTrades != 10 {
			t.Errorf("Expected 10 closed trades, got %v", metrics.ClosedTrades)
		}
	})

	t.Run("Promote when PF > 1.5 and trades >= 20", func(t *testing.T) {
		trades := generateTrades(20, 100)
		trades = append(trades, ShadowTrade{Status: "CLOSED", PnLUSD: -50})
		// PF = 2000 / 50 = 40.0

		signal, _ := evaluator.EvaluatePlan(trades)
		if signal != PROMOTE {
			t.Errorf("Expected PROMOTE, got %v", signal)
		}
	})

	t.Run("Demote when PF < 1.1 and trades >= 20", func(t *testing.T) {
		trades := generateTrades(10, 10)
		trades = append(trades, generateTrades(10, -10)...)
		// PF = 100 / 100 = 1.0

		signal, _ := evaluator.EvaluatePlan(trades)
		if signal != DEMOTE {
			t.Errorf("Expected DEMOTE, got %v", signal)
		}
	})

	t.Run("Demote when Max DD > 5.0% and trades >= 20", func(t *testing.T) {
		trades := generateTrades(10, 100) // Profit 1000
		// Drawdown needs to be > $500 (5% of 10000)
		trades = append(trades, generateTrades(10, -60)...) // Loss 600
		// Max DD = 600 > 500
		// PF = 1000 / 600 = 1.66 (PF is fine, but DD should trigger demote)

		signal, _ := evaluator.EvaluatePlan(trades)
		if signal != DEMOTE {
			t.Errorf("Expected DEMOTE, got %v", signal)
		}
	})
}
