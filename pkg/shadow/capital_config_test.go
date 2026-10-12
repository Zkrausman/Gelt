package shadow

import (
	"context"
	"math"
	"path/filepath"
	"testing"
)

func TestEnsembleRejectsInvalidCapitalSplitBeforeArtifactsOrAlerts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	engine := newCapitalReservationTestEngine(t, store, []string{"SPY"})
	engine.cfg.StrategyNames = []string{"CapitalReservationBuy", "second"}
	engine.cfg.CapitalSplitPct = []float64{0.5, math.NaN()}
	alerts := 0
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }

	if err := engine.RunSession(context.Background(), nil); err == nil {
		t.Fatal("RunSession accepted NaN capital split")
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	cycles, err := store.LoadCycleResults()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != 0 || len(cycles) != 0 || alerts != 0 {
		t.Fatalf("invalid split produced artifacts or alerts: trades=%+v cycles=%+v alerts=%d", trades, cycles, alerts)
	}
}
