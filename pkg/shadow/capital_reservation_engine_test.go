package shadow

import (
	"context"
	"errors"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/strategies"
)

type capitalReservationBuyStrategy struct{}

func (capitalReservationBuyStrategy) Name() string                     { return "CapitalReservationBuy" }
func (capitalReservationBuyStrategy) Description() string              { return "deterministic test BUY" }
func (capitalReservationBuyStrategy) CapitalRequirement() float64      { return 0 }
func (capitalReservationBuyStrategy) IsIntradayOnly() bool             { return false }
func (capitalReservationBuyStrategy) SetParams(map[string]float64)     {}
func (capitalReservationBuyStrategy) Init(*data.FeatureRegistry) error { return nil }
func (s capitalReservationBuyStrategy) Evaluate(_ context.Context, at time.Time, symbol string, _ []float64, _ []float64) (strategies.StrategySignal, error) {
	return strategies.StrategySignal{StrategyName: s.Name(), Symbol: symbol, AssetClass: strategies.AssetEquity, Signal: strategies.SignalBuy, Timestamp: at}, nil
}

func newCapitalReservationTestEngine(t *testing.T, store *Store, symbols []string) *EnsembleEngine {
	t.Helper()
	now := time.Date(2026, time.August, 12, 22, 0, 0, 0, time.UTC)
	catalog := strategies.NewRegistry()
	catalog.Register(capitalReservationBuyStrategy{})
	engine := NewEnsembleEngine(EnsembleConfig{
		StrategyNames:    []string{"CapitalReservationBuy"},
		TotalCapitalUSD:  100,
		WatchSymbols:     symbols,
		ScanIntervalMins: 1,
		DurationMode:     "24h",
		Catalog:          catalog,
	}, store)
	engine.timeFunc = func() time.Time { return now }
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { return freshTestIndicators(now), nil }
	engine.fetchProviderBarsOverride = func(string) ([]ProviderBar, error) { return validTestBars(now), nil }
	return engine
}

func TestEnsembleReservesCapitalBeforeAdditionalShadowEntries(t *testing.T) {
	path := t.TempDir() + "/journal.json"
	store := NewStore(path, path+".cycles")
	engine := newCapitalReservationTestEngine(t, store, []string{"SPY", "QQQ"})
	alerts := 0
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var result EnsembleResult
	if err := engine.RunSession(ctx, func(res EnsembleResult) { result = res; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession: %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	buys, holds := 0, 0
	for _, signal := range result.Signals {
		switch signal.Signal {
		case "BUY":
			buys++
		case "HOLD":
			holds++
		}
	}
	if buys != 1 || holds != 1 || len(trades) != 1 || result.TotalDeployed != 100 || alerts != 1 {
		t.Fatalf("capacity denial did not prevent a second entry: signals=%+v trades=%+v deployed=%.2f alerts=%d", result.Signals, trades, result.TotalDeployed, alerts)
	}
	if result.CapitalReservationDegraded {
		t.Fatal("ordinary full-capacity HOLD must not mark the cycle degraded")
	}
}

func TestEnsembleHaltsWithoutMutationAfterRestartedIdentityDegradation(t *testing.T) {
	path := t.TempDir() + "/journal.json"
	store := NewStore(path, path+".cycles")
	legacy := ShadowTrade{ID: " ", PlanName: "legacy", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}
	if err := store.save([]ShadowTrade{legacy}); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("initial verification error = %v, want identity degradation", err)
	}

	restarted := NewStore(path, path+".cycles")
	engine := newCapitalReservationTestEngine(t, restarted, []string{"SPY"})
	alerts := 0
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }
	if err := engine.RunSession(context.Background(), nil); !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("RunSession error = %v, want identity degradation", err)
	}
	trades, err := restarted.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != 1 || trades[0] != legacy || alerts != 0 {
		t.Fatalf("identity-degraded restart mutated or alerted: trades=%+v alerts=%d", trades, alerts)
	}
}

func TestEnsembleFailsClosedBeforeJournalWorkForInvalidBudget(t *testing.T) {
	path := t.TempDir() + "/journal.json"
	store := NewStore(path, path+".cycles")
	legacy := ShadowTrade{ID: " ", PlanName: "legacy", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}
	if err := store.save([]ShadowTrade{legacy}); err != nil {
		t.Fatal(err)
	}
	engine := newCapitalReservationTestEngine(t, store, []string{"SPY"})
	engine.cfg.TotalCapitalUSD = 0
	fetches, alerts := 0, 0
	engine.fetchIndicatorsOverride = func(string) (LiveIndicators, error) { fetches++; return LiveIndicators{}, nil }
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }
	if err := engine.RunSession(context.Background(), nil); err == nil {
		t.Fatal("invalid budget session succeeded")
	}
	trades, err := store.Load()
	if err != nil || len(trades) != 1 || trades[0] != legacy {
		t.Fatalf("invalid budget mutated journal: trades=%+v err=%v", trades, err)
	}
	cycles, err := store.LoadCycleResults()
	if err != nil || len(cycles) != 0 || fetches != 0 || alerts != 0 {
		t.Fatalf("invalid budget performed work: cycles=%+v err=%v fetches=%d alerts=%d", cycles, err, fetches, alerts)
	}
}

func TestEnsembleBlocksEntriesAndMarksCycleDegradedForInvalidReservation(t *testing.T) {
	path := t.TempDir() + "/journal.json"
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("legacy-invalid", "legacy", 0)); err != nil {
		t.Fatal(err)
	}
	engine := newCapitalReservationTestEngine(t, store, []string{"SPY"})
	alerts := 0
	engine.sendTradeAlert = func(string, string, string, string, float64, float64, float64, float64) { alerts++ }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var result EnsembleResult
	if err := engine.RunSession(ctx, func(res EnsembleResult) { result = res; cancel() }); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunSession: %v, want context.Canceled", err)
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	cycles, err := store.LoadCycleResults()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Signals) != 1 || result.Signals[0].Signal != "HOLD" || !result.CapitalReservationDegraded || alerts != 0 || len(trades) != 1 || len(cycles) != 1 || !cycles[0].CapitalReservationDegraded {
		t.Fatalf("invalid reservation did not produce an explicit degraded HOLD cycle: result=%+v trades=%+v cycles=%+v alerts=%d", result, trades, cycles, alerts)
	}
}
