package shadow

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func reservationTrade(id, plan string, amount float64) ShadowTrade {
	return ShadowTrade{ID: id, PlanName: plan, Symbol: "TEST", Status: "OPEN", AmountUSD: amount}
}

func TestStoreReserveTradeEnforcesAggregateBudget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")

	if err := store.ReserveTrade(reservationTrade("a-1", "strategy-a", 60), 100); err != nil {
		t.Fatalf("reserve first strategy allocation: %v", err)
	}
	if err := store.ReserveTrade(reservationTrade("b-1", "strategy-b", 50), 100); !errors.Is(err, ErrInsufficientShadowCapital) {
		t.Fatalf("aggregate reservation error = %v, want ErrInsufficientShadowCapital", err)
	}
	if err := store.ReserveTrade(reservationTrade("b-1", "strategy-b", 40), 100); err != nil {
		t.Fatalf("reserve remaining aggregate capital: %v", err)
	}

	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got := totalPersistedOpenDeployment(trades); got != 100 {
		t.Fatalf("reserved open deployment = $%.2f, want $100.00", got)
	}
}

func TestDurableReplaceFailsWhenPostRenameDirectorySyncFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	err := durableReplaceFileWithOps(path, []byte("[]"), 0600, 0700, replaceFile, func(string) error { return errors.New("sync failed") })
	if err == nil {
		t.Fatal("directory sync failure was accepted")
	}
	if data, readErr := os.ReadFile(path); readErr != nil || string(data) != "[]" {
		t.Fatalf("rename did not occur before sync failure: data=%q err=%v", data, readErr)
	}
}

func TestStoreReserveTradeFailsClosedOnPostRenameDirectorySyncFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	store.replace = func(target string, data []byte) error {
		return durableReplaceFileWithOps(target, data, 0600, 0700, replaceFile, func(string) error { return errors.New("sync failed") })
	}
	if err := store.ReserveTrade(reservationTrade("new", "plan", 10), 100); err == nil {
		t.Fatal("reservation succeeded despite post-rename directory sync failure")
	}
}

func TestRebaselineCompletionIntentSurvivesCleanStateSyncFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("invalid", "strategy", 0)); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveTrade(reservationTrade("new", "other", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatal(err)
	}
	writes := 0
	store.replace = func(target string, data []byte) error {
		writes++
		if target == store.capitalStateFilePath && writes >= 4 {
			return durableReplaceFileWithOps(target, data, 0600, 0700, replaceFile, func(string) error { return errors.New("final state sync failed") })
		}
		return durableReplace(target, data)
	}
	if err := store.RebaselineCapitalReservation(); err == nil {
		t.Fatal("rebaseline unexpectedly succeeded after final-state durability failure")
	}
	restarted := NewStore(path, path+".cycles")
	if err := restarted.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowRebaselinePending) {
		t.Fatalf("restart verification error = %v, want pending halt", err)
	}
}

func TestRebaselineCrashAfterCleanStateBeforeIntentRemovalRemainsHalted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("invalid", "strategy", 0)); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveTrade(reservationTrade("new", "other", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatal(err)
	}
	// Simulate a process crash after the completed state replacement succeeds but
	// before intent removal: preserve the marker and present a clean empty journal.
	archive := "journal.rebaseline-archive-crash-window"
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), archive), []byte(`[{"id":"invalid","plan_name":"strategy","status":"OPEN","amount_usd":0}]`), 0600); err != nil {
		t.Fatal(err)
	}
	complete := CapitalReservationState{SchemaVersion: 1, RebaselinedAt: time.Now().UTC(), RebaselineArchive: archive}
	stateData, err := json.Marshal(complete)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.capitalStateFilePath, stateData, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.rebaselineIntentPath, []byte("pending\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("[]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	restarted := NewStore(path, path+".cycles")
	if err := restarted.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowRebaselinePending) {
		t.Fatalf("crash-window verification error = %v, want pending halt", err)
	}
}

func TestStoreReserveTradeRejectsInvalidPersistedOpenReservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("invalid", "strategy-a", 0)); err != nil {
		t.Fatal(err)
	}

	err := store.ReserveTrade(reservationTrade("new", "strategy-b", 20), 100)
	if !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatalf("reservation error = %v, want ErrShadowCapitalDegraded", err)
	}
	state, stateErr := store.LoadCapitalReservationState()
	if stateErr != nil {
		t.Fatal(stateErr)
	}
	if !state.Degraded || !state.RebaselineRequired || state.Reason != "invalid_open_amount" {
		t.Fatalf("invalid reservation did not persist required degradation state: %+v", state)
	}
	trades, loadErr := store.Load()
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if len(trades) != 1 || trades[0].ID != "invalid" {
		t.Fatalf("invalid open position changed or new trade persisted: %+v", trades)
	}
}

func TestStoreReserveTradeLatchesOverBudgetStateAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("legacy-over-budget", "strategy", 101)); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveTrade(reservationTrade("new", "strategy", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatalf("reservation error = %v, want ErrShadowCapitalDegraded", err)
	}

	restarted := NewStore(path, path+".cycles")
	state, err := restarted.LoadCapitalReservationState()
	if err != nil {
		t.Fatal(err)
	}
	if !state.Degraded || state.Reason != "open_deployment_exceeds_budget" {
		t.Fatalf("over-budget journal did not retain degradation state: %+v", state)
	}
	if err := restarted.ReserveTrade(reservationTrade("later", "strategy", 1), 1000); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatalf("restarted reservation error = %v, want latched ErrShadowCapitalDegraded", err)
	}
}

func TestStoreRebaselineCapitalReservationArchivesJournalBeforeClearingLatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("legacy-invalid", "strategy", 0)); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveTrade(reservationTrade("new", "strategy", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatal(err)
	}
	if err := store.RebaselineCapitalReservation(); err != nil {
		t.Fatalf("auditable rebaseline: %v", err)
	}
	state, err := store.LoadCapitalReservationState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Degraded || state.RebaselinedAt.IsZero() || state.RebaselineArchive == "" {
		t.Fatalf("rebaseline state lacks archive provenance: %+v", state)
	}
	archiveTrades, err := readJSON[ShadowTrade](filepath.Join(filepath.Dir(path), state.RebaselineArchive), "archive")
	if err != nil || len(archiveTrades) != 1 || archiveTrades[0].ID != "legacy-invalid" {
		t.Fatalf("archive = %+v, err=%v", archiveTrades, err)
	}
	trades, err := store.Load()
	if err != nil || len(trades) != 0 {
		t.Fatalf("replacement journal = %+v, err=%v", trades, err)
	}
}

func TestStoreRebaselineFailureAfterPendingLeavesMutationHalt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(reservationTrade("legacy-invalid", "strategy", 0)); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveTrade(reservationTrade("new", "strategy", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatal(err)
	}
	calls := 0
	store.replace = func(target string, data []byte) error {
		calls++
		if target == path && calls >= 3 { // archive, pending state, then canonical replacement
			return errors.New("injected canonical replacement failure")
		}
		return durableReplace(target, data)
	}
	if err := store.RebaselineCapitalReservation(); err == nil {
		t.Fatal("rebaseline succeeded despite canonical replacement failure")
	}
	state, err := store.LoadCapitalReservationState()
	if err != nil {
		t.Fatal(err)
	}
	if !state.Degraded || !state.RebaselinePending || state.RebaselineArchive == "" {
		t.Fatalf("state = %+v, want pending degraded archive provenance", state)
	}
	if err := store.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatalf("verification after pending failure = %v, want degraded halt", err)
	}
	trades, err := store.Load()
	if err != nil || len(trades) != 1 || trades[0].ID != "legacy-invalid" {
		t.Fatalf("canonical journal was not retained: trades=%+v err=%v", trades, err)
	}
}

func TestStoreRebaselineRefusesMissingOrEmptyJournal(t *testing.T) {
	for _, empty := range []bool{true, false} {
		path := filepath.Join(t.TempDir(), "journal.json")
		store := NewStore(path, path+".cycles")
		if err := store.addTrade(reservationTrade("legacy-invalid", "strategy", 0)); err != nil {
			t.Fatal(err)
		}
		if err := store.ReserveTrade(reservationTrade("new", "strategy", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
			t.Fatal(err)
		}
		if empty {
			if err := os.WriteFile(path, []byte("[]"), 0600); err != nil {
				t.Fatal(err)
			}
		} else if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := store.RebaselineCapitalReservation(); !errors.Is(err, ErrShadowCapitalDegraded) {
			t.Fatalf("rebaseline after journal removal/truncation error = %v, want degraded refusal", err)
		}
		state, err := store.LoadCapitalReservationState()
		if err != nil || !state.Degraded {
			t.Fatalf("latch cleared after unauditable rebaseline: state=%+v err=%v", state, err)
		}
	}
}

func TestStoreVerifyCapitalReservationLatchesUnicodeEqualFoldDuplicates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{
		{ID: "ſ", PlanName: "alpha", Symbol: "SPY", Status: "CLOSED"},
		{ID: "s", PlanName: "beta", Symbol: "QQQ", Status: "CLOSED"},
	}); err != nil {
		t.Fatal(err)
	}
	err := store.VerifyCapitalReservation(100)
	if !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("verification error = %v, want Unicode identity degradation", err)
	}
}

func TestStoreReserveTradeRejectsDuplicateIDAndOpenPlanSymbol(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.ReserveTrade(ShadowTrade{ID: "one", PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}, 100); err != nil {
		t.Fatal(err)
	}
	if err := store.ReserveTrade(ShadowTrade{ID: "one", PlanName: "other", Symbol: "QQQ", Status: "OPEN", AmountUSD: 10}, 100); !errors.Is(err, ErrInvalidShadowReservation) {
		t.Fatalf("duplicate ID error = %v", err)
	}
	if err := store.ReserveTrade(ShadowTrade{ID: "two", PlanName: "PLAN", Symbol: "spy", Status: "OPEN", AmountUSD: 10}, 100); !errors.Is(err, ErrInvalidShadowReservation) {
		t.Fatalf("duplicate plan/symbol error = %v", err)
	}
}

func TestStoreReserveTradeRejectsSurroundingWhitespaceAndNormalizedDuplicate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.ReserveTrade(ShadowTrade{ID: "one", PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}, 100); err != nil {
		t.Fatal(err)
	}
	for _, trade := range []ShadowTrade{
		{ID: " two", PlanName: "other", Symbol: "QQQ", Status: "OPEN", AmountUSD: 10},
		{ID: "two", PlanName: "plan ", Symbol: "SPY", Status: "OPEN", AmountUSD: 10},
		{ID: "two", PlanName: "plan", Symbol: "spy", Status: "OPEN", AmountUSD: 10},
	} {
		if err := store.ReserveTrade(trade, 100); !errors.Is(err, ErrInvalidShadowReservation) {
			t.Fatalf("ReserveTrade(%+v) error = %v, want invalid reservation", trade, err)
		}
	}
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != 1 {
		t.Fatalf("trades = %+v, want only original trade", trades)
	}
}

func TestStoreReserveTradeLatchesNormalizedLegacyWhitespaceDuplicate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{{ID: "one", PlanName: "plan ", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}}); err != nil {
		t.Fatal(err)
	}
	err := store.ReserveTrade(ShadowTrade{ID: "two", PlanName: "plan", Symbol: "spy", Status: "OPEN", AmountUSD: 10}, 100)
	if !errors.Is(err, ErrShadowCapitalDegraded) || !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("ReserveTrade error = %v, want identity degradation", err)
	}
	trades, loadErr := store.Load()
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if len(trades) != 1 {
		t.Fatalf("trades = %+v, want unchanged legacy journal", trades)
	}
}

func TestStoreIdentityDegradationSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{{ID: " ", PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}}); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("initial verification error = %v, want identity degradation", err)
	}
	restarted := NewStore(path, path+".cycles")
	if err := restarted.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("restarted verification error = %v, want identity degradation", err)
	}
}

func TestStoreVerifyCapitalReservationLatchesNoncanonicalLegacyIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{{ID: "one", PlanName: "plan ", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}}); err != nil {
		t.Fatal(err)
	}
	err := store.VerifyCapitalReservation(100)
	if !errors.Is(err, ErrShadowCapitalDegraded) || !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("verification error = %v, want identity degradation", err)
	}
	state, stateErr := store.LoadCapitalReservationState()
	if stateErr != nil {
		t.Fatal(stateErr)
	}
	if state.Reason != "blank_or_noncanonical_open_identity" {
		t.Fatalf("latch reason = %q, want blank_or_noncanonical_open_identity", state.Reason)
	}
}

func TestStoreVerifyCapitalReservationUsesAdmissionUnicodeEquivalence(t *testing.T) {
	cases := []struct {
		name   string
		trades []ShadowTrade
	}{
		{"duplicate-id", []ShadowTrade{{ID: "ſ", PlanName: "a", Symbol: "SPY", Status: "CLOSED"}, {ID: "s", PlanName: "b", Symbol: "QQQ", Status: "CLOSED"}}},
		{"duplicate-open-pair", []ShadowTrade{{ID: "one", PlanName: "ſ", Symbol: "SPY", Status: "OPEN", AmountUSD: 1}, {ID: "two", PlanName: "s", Symbol: "spy", Status: "OPEN", AmountUSD: 1}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "journal.json")
			store := NewStore(path, path+".cycles")
			if err := store.save(tc.trades); err != nil {
				t.Fatal(err)
			}
			if err := store.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowIdentityDegraded) {
				t.Fatalf("verification error = %v, want Unicode-equivalent identity degradation", err)
			}
		})
	}
}

func TestStoreIdentityCorruptionOverridesExistingNonIdentityLatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.save([]ShadowTrade{{ID: "valid", PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 0}}); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowCapitalDegraded) {
		t.Fatal(err)
	}
	if err := store.save([]ShadowTrade{{ID: " ", PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 0}}); err != nil {
		t.Fatal(err)
	}
	restarted := NewStore(path, path+".cycles")
	if err := restarted.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("restarted verification error = %v, want identity degradation", err)
	}
}

func TestStoreReserveTradeRejectsNonNFCIdentityAndLatchesLegacyIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	decomposed := "cafe\u0301"
	if err := store.ReserveTrade(ShadowTrade{ID: "one", PlanName: decomposed, Symbol: "SPY", Status: "OPEN", AmountUSD: 10}, 100); !errors.Is(err, ErrInvalidShadowReservation) {
		t.Fatalf("non-NFC entry error = %v, want invalid reservation", err)
	}
	if err := store.save([]ShadowTrade{{ID: "one", PlanName: decomposed, Symbol: "SPY", Status: "OPEN", AmountUSD: 10}}); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyCapitalReservation(100); !errors.Is(err, ErrShadowIdentityDegraded) {
		t.Fatalf("legacy non-NFC verification error = %v, want identity degradation", err)
	}
}

func TestStoreReserveTradeSerializesConcurrentDuplicatePlanSymbol(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	const writers = 8
	start := make(chan struct{})
	outcomes := make(chan error, writers)
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			outcomes <- NewStore(path, path+".cycles").ReserveTrade(ShadowTrade{ID: fmt.Sprintf("trade-%d", i), PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 10}, 100)
		}(i)
	}
	close(start)
	wg.Wait()
	close(outcomes)
	succeeded := 0
	for err := range outcomes {
		if err == nil {
			succeeded++
			continue
		}
		if !errors.Is(err, ErrInvalidShadowReservation) {
			t.Fatalf("duplicate reservation error = %v", err)
		}
	}
	if succeeded != 1 {
		t.Fatalf("successful duplicate reservations = %d, want 1", succeeded)
	}
}

func TestStoreVerifyCapitalReservationLatchesLegacyIdentityViolations(t *testing.T) {
	cases := []struct {
		name, reason string
		trades       []ShadowTrade
	}{
		{"blank-id", "blank_or_noncanonical_trade_id", []ShadowTrade{{ID: " ", PlanName: "a", Symbol: "SPY", Status: "CLOSED"}}},
		{"duplicate-id", "duplicate_trade_id", []ShadowTrade{{ID: "one", PlanName: "a", Symbol: "SPY", Status: "CLOSED"}, {ID: "one", PlanName: "b", Symbol: "QQQ", Status: "CLOSED"}}},
		{"blank-open-identity", "blank_or_noncanonical_open_identity", []ShadowTrade{{ID: "one", PlanName: " ", Symbol: "SPY", Status: "OPEN", AmountUSD: 1}}},
		{"duplicate-open-pair", "duplicate_open_plan_symbol", []ShadowTrade{{ID: "one", PlanName: "a", Symbol: "SPY", Status: "OPEN", AmountUSD: 1}, {ID: "two", PlanName: "A", Symbol: "spy", Status: "OPEN", AmountUSD: 1}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "journal.json")
			store := NewStore(path, path+".cycles")
			if err := store.save(tc.trades); err != nil {
				t.Fatal(err)
			}
			if err := store.ReserveTrade(reservationTrade("new", "new", 1), 100); !errors.Is(err, ErrShadowCapitalDegraded) {
				t.Fatalf("ReserveTrade error = %v, want degraded", err)
			}
			state, err := store.LoadCapitalReservationState()
			if err != nil {
				t.Fatal(err)
			}
			if !state.Degraded || state.Reason != tc.reason {
				t.Fatalf("state = %+v, want %q", state, tc.reason)
			}
			trades, err := store.Load()
			if err != nil {
				t.Fatal(err)
			}
			if len(trades) != len(tc.trades) {
				t.Fatalf("trades changed: %+v", trades)
			}
		})
	}
}

func TestStoreReserveTradeRejectsBlankIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	for _, trade := range []ShadowTrade{
		{ID: " ", PlanName: "plan", Symbol: "SPY", Status: "OPEN", AmountUSD: 1},
		{ID: "id", PlanName: " ", Symbol: "SPY", Status: "OPEN", AmountUSD: 1},
		{ID: "id", PlanName: "plan", Symbol: " ", Status: "OPEN", AmountUSD: 1},
	} {
		if err := store.ReserveTrade(trade, 100); !errors.Is(err, ErrInvalidShadowReservation) {
			t.Fatalf("ReserveTrade(%+v) error = %v", trade, err)
		}
	}
}

func TestStoreReserveTradeSerializesConcurrentCapacityChecks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	const (
		writers = 8
		amount  = 25.0
	)
	start := make(chan struct{})
	var wg sync.WaitGroup
	outcomes := make(chan error, writers)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			outcomes <- NewStore(path, path+".cycles").ReserveTrade(reservationTrade(fmt.Sprintf("trade-%d", i), fmt.Sprintf("strategy-%d", i), amount), 100)
		}(i)
	}
	close(start)
	wg.Wait()
	close(outcomes)

	succeeded := 0
	for err := range outcomes {
		if err == nil {
			succeeded++
			continue
		}
		if !errors.Is(err, ErrInsufficientShadowCapital) && !errors.Is(err, ErrInvalidShadowReservation) {
			t.Fatalf("concurrent reservation error = %v", err)
		}
	}
	if succeeded != 4 {
		t.Fatalf("successful reservations = %d, want 4", succeeded)
	}
	trades, err := NewStore(path, path+".cycles").Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != succeeded || totalPersistedOpenDeployment(trades) != 100 {
		t.Fatalf("concurrent reservations over-allocated or lost state: trades=%+v", trades)
	}
}
