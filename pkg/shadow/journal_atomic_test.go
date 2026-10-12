package shadow

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

func TestStoreSubprocessAppend(t *testing.T) {
	if os.Getenv("GELT_SHADOW_SUBPROCESS_APPEND") != "1" {
		return
	}
	path, id := os.Getenv("GELT_SHADOW_JOURNAL"), os.Getenv("GELT_SHADOW_TRADE_ID")
	if path == "" || id == "" {
		t.Fatal("subprocess journal path and trade ID are required")
	}
	if err := NewStore(path, path+".cycles").addTrade(ShadowTrade{ID: id, Status: "OPEN"}); err != nil {
		t.Fatal(err)
	}
}

func TestStoreConcurrentAppendAcrossProcesses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	const writers = 8
	commands := make([]*exec.Cmd, 0, writers)
	for i := 0; i < writers; i++ {
		cmd := exec.Command(os.Args[0], "-test.run=^TestStoreSubprocessAppend$")
		cmd.Env = append(os.Environ(), "GELT_SHADOW_SUBPROCESS_APPEND=1", "GELT_SHADOW_JOURNAL="+path, fmt.Sprintf("GELT_SHADOW_TRADE_ID=process-%d", i))
		commands = append(commands, cmd)
	}
	for _, cmd := range commands {
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
	}
	for _, cmd := range commands {
		if err := cmd.Wait(); err != nil {
			t.Fatalf("subprocess failed: %v", err)
		}
	}
	trades, err := NewStore(path, path+".cycles").Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != writers {
		t.Fatalf("got %d trades, want %d", len(trades), writers)
	}
}

func TestStoreConcurrentAppendAcrossInstances(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	const writers = 64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			s := NewStore(path, path+".cycles")
			if err := s.addTrade(ShadowTrade{ID: fmt.Sprintf("trade-%d", i), Status: "OPEN"}); err != nil {
				t.Errorf("AddTrade(%d): %v", i, err)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	trades, err := NewStore(path, path+".cycles").Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != writers {
		t.Fatalf("got %d trades, want %d", len(trades), writers)
	}
	seen := map[string]bool{}
	for _, trade := range trades {
		seen[trade.ID] = true
	}
	if len(seen) != writers {
		t.Fatalf("got %d unique trades, want %d", len(seen), writers)
	}
}

func TestStoreConcurrentAppendAndUpdatePreservesBoth(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	if err := store.addTrade(ShadowTrade{ID: "seed", Status: "OPEN"}); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		if err := store.updateTrades([]ShadowTrade{{ID: "seed", Status: "CLOSED", PnLUSD: 12}}); err != nil {
			t.Error(err)
		}
	}()
	go func() {
		defer wg.Done()
		<-start
		if err := NewStore(path, path+".cycles").addTrade(ShadowTrade{ID: "append", Status: "OPEN"}); err != nil {
			t.Error(err)
		}
	}()
	close(start)
	wg.Wait()
	trades, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != 2 {
		t.Fatalf("got %d trades, want 2", len(trades))
	}
	found := map[string]ShadowTrade{}
	for _, trade := range trades {
		found[trade.ID] = trade
	}
	if found["seed"].Status != "CLOSED" || found["seed"].PnLUSD != 12 {
		t.Fatalf("seed update lost: %+v", found["seed"])
	}
	if _, ok := found["append"]; !ok {
		t.Fatal("concurrent append lost")
	}
}

func TestStoreConditionalUpdateRejectsStaleSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	first, second := NewStore(path, path+".cycles"), NewStore(path, path+".cycles")
	seed := ShadowTrade{ID: "seed", Status: "OPEN", PnLUSD: 1}
	if err := first.addTrade(seed); err != nil {
		t.Fatal(err)
	}
	if err := second.updateTrades([]ShadowTrade{{ID: "seed", Status: "OPEN", PnLUSD: 2}}); err != nil {
		t.Fatal(err)
	}
	staleUpdate := seed
	staleUpdate.Status = "CLOSED"
	if err := first.updateTradesIfCurrent([]ShadowTrade{seed}, []ShadowTrade{staleUpdate}); !errors.Is(err, ErrJournalConflict) {
		t.Fatalf("UpdateTradesIfCurrent error = %v, want ErrJournalConflict", err)
	}
	trades, err := first.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(trades) != 1 || trades[0].PnLUSD != 2 || trades[0].Status != "OPEN" {
		t.Fatalf("newer journal state overwritten: %+v", trades)
	}
}

func TestStoreConditionalUpdateRequiresExactOneToOneIDs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	seed := ShadowTrade{ID: "seed", Status: "OPEN"}
	if err := store.addTrade(seed); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name     string
		expected []ShadowTrade
		updated  []ShadowTrade
	}{
		{"missing-current", []ShadowTrade{{ID: "removed", Status: "OPEN"}}, []ShadowTrade{{ID: "removed", Status: "CLOSED"}}},
		{"mismatched-id", []ShadowTrade{seed}, []ShadowTrade{{ID: "other", Status: "CLOSED"}}},
		{"duplicate-expected", []ShadowTrade{seed, seed}, []ShadowTrade{{ID: "seed", Status: "CLOSED"}, {ID: "seed", Status: "CLOSED"}}},
		{"duplicate-updated", []ShadowTrade{seed, ShadowTrade{ID: "other", Status: "OPEN"}}, []ShadowTrade{{ID: "seed", Status: "CLOSED"}, {ID: "seed", Status: "CLOSED"}}},
		{"empty", nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := store.updateTradesIfCurrent(tc.expected, tc.updated); !errors.Is(err, ErrJournalConflict) {
				t.Fatalf("error = %v, want ErrJournalConflict", err)
			}
			trades, err := store.Load()
			if err != nil || len(trades) != 1 || trades[0] != seed {
				t.Fatalf("conflict changed journal: trades=%+v err=%v", trades, err)
			}
		})
	}
}

func TestStoreCorruptJournalIsPreserved(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	bad := []byte("{ not json")
	if err := os.WriteFile(path, bad, 0600); err != nil {
		t.Fatal(err)
	}
	s := NewStore(path, path+".cycles")
	if err := s.addTrade(ShadowTrade{ID: "new"}); err == nil {
		t.Fatal("AddTrade succeeded on corrupt journal")
	}
	if err := s.save([]ShadowTrade{{ID: "replacement"}}); err == nil {
		t.Fatal("Save succeeded on corrupt journal")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, bad) {
		t.Fatalf("corrupt journal changed: %q", got)
	}
}

func TestReadJSONRejectsNullAndNonArrayJournals(t *testing.T) {
	for _, document := range []string{"null", `{}`, `"not an array"`} {
		t.Run(document, func(t *testing.T) {
			tradePath := filepath.Join(t.TempDir(), "journal.json")
			if err := os.WriteFile(tradePath, []byte(document), 0600); err != nil {
				t.Fatal(err)
			}
			store := NewStore(tradePath, tradePath+".cycles")
			if _, err := store.Load(); err == nil {
				t.Fatalf("Load accepted non-array trade journal %q", document)
			}

			cyclePath := filepath.Join(t.TempDir(), "cycles.json")
			if err := os.WriteFile(cyclePath, []byte(document), 0600); err != nil {
				t.Fatal(err)
			}
			cycleStore := NewStore(cyclePath+".journal", cyclePath)
			if _, err := cycleStore.LoadCycleResults(); err == nil {
				t.Fatalf("LoadCycleResults accepted non-array cycle journal %q", document)
			}
		})
	}
}

func TestStoreCorruptCycleJournalIsPreserved(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	cyclePath := path + ".cycles"
	bad := []byte("{ not json")
	if err := os.WriteFile(cyclePath, bad, 0600); err != nil {
		t.Fatal(err)
	}
	s := NewStore(path, cyclePath)
	if err := s.SaveCycleResultGuarded(100, EnsembleResult{CycleNumber: 1}); err == nil {
		t.Fatal("SaveCycleResultGuarded succeeded on corrupt cycle journal")
	}
	got, err := os.ReadFile(cyclePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, bad) {
		t.Fatalf("corrupt cycle journal changed: %q", got)
	}
}

func TestStoreReplaceFailurePreservesJournalAndCleansTemporaryFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.json")
	s := NewStore(path, path+".cycles")
	if err := s.addTrade(ShadowTrade{ID: "old"}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s.replace = func(string, []byte) error { return fmt.Errorf("injected replacement failure") }
	if err := s.addTrade(ShadowTrade{ID: "new"}); err == nil {
		t.Fatal("AddTrade succeeded")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("canonical journal changed after replace failure")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "journal.json" && entry.Name() != "journal.json.lock" {
			t.Fatalf("unexpected artifact %q", entry.Name())
		}
	}
}

func TestRunSessionFailsClosedWhenJournalCannotLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	if err := os.WriteFile(path, []byte("not json"), 0600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path, path+".cycles")
	engine := NewEnsembleEngine(EnsembleConfig{ScanIntervalMins: 1}, store)
	called := false
	if err := engine.RunSession(context.Background(), func(EnsembleResult) { called = true }); err == nil {
		t.Fatal("RunSession succeeded with corrupt journal")
	}
	if called {
		t.Fatal("RunSession invoked cycle callback after persistence failure")
	}
}

func TestRunSessionFailsClosedWhenCyclePersistenceFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	store := NewStore(path, path+".cycles")
	store.replace = func(string, []byte) error { return fmt.Errorf("injected replacement failure") }
	engine := NewEnsembleEngine(EnsembleConfig{ScanIntervalMins: 1}, store)
	called := false
	if err := engine.RunSession(context.Background(), func(EnsembleResult) { called = true }); err == nil {
		t.Fatal("RunSession succeeded after cycle persistence failure")
	}
	if called {
		t.Fatal("RunSession invoked cycle callback after persistence failure")
	}
}

func TestStoreReadersSeeOnlyValidDocuments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	s := NewStore(path, path+".cycles")
	if err := s.addTrade(ShadowTrade{ID: "seed"}); err != nil {
		t.Fatal(err)
	}
	const writes = 30
	var wg sync.WaitGroup
	errCh := make(chan error, writes*2)
	for i := 0; i < writes; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			if err := s.addTrade(ShadowTrade{ID: fmt.Sprintf("w-%d", i)}); err != nil {
				errCh <- err
			}
		}(i)
		go func() {
			defer wg.Done()
			if _, err := s.Load(); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}
}
