package shadow

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"gelt/pkg/config"
)

func TestStoreBindsCapitalBudgetAndRejectsMismatchAcrossStores(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	first := NewStore(path, path+".cycles")
	if err := first.ReserveTrade(ShadowTrade{ID: "one", PlanName: "a", Symbol: "SPY", Status: "OPEN", AmountUSD: 50}, 100); err != nil {
		t.Fatal(err)
	}
	second := NewStore(path, path+".cycles")
	if err := second.ReserveTrade(ShadowTrade{ID: "two", PlanName: "b", Symbol: "QQQ", Status: "OPEN", AmountUSD: 50}, 200); !errors.Is(err, ErrInvalidShadowReservation) {
		t.Fatalf("mismatched budget error = %v, want invalid reservation", err)
	}
	state, err := first.LoadCapitalReservationState()
	if err != nil || state.CapitalBudgetUSD != 100 {
		t.Fatalf("canonical budget state = %+v, err=%v", state, err)
	}
}

func TestEnsembleRejectsNonPositiveIntervalBeforeJournalOrProviderWork(t *testing.T) {
	for _, interval := range []int{0, -1} {
		t.Run(fmt.Sprintf("interval-%d", interval), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "journal.json")
			store := NewStore(path, path+".cycles")
			engine := NewEnsembleEngine(EnsembleConfig{TotalCapitalUSD: 100, ScanIntervalMins: interval}, store)
			if err := engine.RunSession(context.Background(), nil); err == nil {
				t.Fatal("RunSession accepted a non-positive interval")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("invalid interval touched journal: %v", err)
			}
		})
	}
}

func TestGetPerformanceDoesNotBindFreshCanonicalBudget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{{ID: "closed", PlanName: "plan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetPerformance("plan"); err != nil {
		t.Fatalf("GetPerformance: %v", err)
	}
	state, err := store.LoadCapitalReservationState()
	if err != nil {
		t.Fatal(err)
	}
	if state.CapitalBudgetUSD != 0 {
		t.Fatalf("GetPerformance bound budget %v, want zero", state.CapitalBudgetUSD)
	}
	if err := store.ReserveTrade(ShadowTrade{ID: "open", PlanName: "other", Symbol: "QQQ", Status: "OPEN", AmountUSD: 50}, 100); err != nil {
		t.Fatalf("normal reservation after performance read: %v", err)
	}
	state, err = store.LoadCapitalReservationState()
	if err != nil || state.CapitalBudgetUSD != 100 {
		t.Fatalf("reservation did not bind normal budget: state=%+v err=%v", state, err)
	}
}

func TestEnsembleRejectsInvalidSlippageBeforeSession(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	engine := newCapitalReservationTestEngine(t, NewStore(path, path+".cycles"), []string{"SPY"})
	engine.cfg.Slippage.EquityPct = -0.01
	if err := engine.validateCapitalConfiguration(); err == nil {
		t.Fatal("negative slippage accepted")
	}
	engine.cfg.Slippage.EquityPct = math.Inf(1)
	if err := engine.validateCapitalConfiguration(); err == nil {
		t.Fatal("infinite slippage accepted")
	}
}

func TestShadowPerformanceEvaluatorRejectsAllWinAndNonFiniteMetrics(t *testing.T) {
	e := NewShadowPerformanceEvaluator(testPromotionGate())
	allWins := []ShadowTrade{{Status: "CLOSED", PnLUSD: 1}, {Status: "CLOSED", PnLUSD: 1}, {Status: "CLOSED", PnLUSD: 1}}
	if signal, _ := e.EvaluatePlan(allWins); signal != HOLD {
		t.Fatalf("all-win signal = %s, want HOLD", signal)
	}
	if signal, _ := e.EvaluatePlan([]ShadowTrade{{Status: "CLOSED", PnLUSD: math.Inf(1)}}); signal != HOLD {
		t.Fatalf("non-finite signal = %s, want HOLD", signal)
	}
}

func testPromotionGate() config.PromotionGate {
	return config.PromotionGate{MinTrades: 3, PromoteProfitFactor: 1.5, DemoteProfitFactor: 1.1, DemoteMaxDrawdown: 5}
}
