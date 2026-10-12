package shadow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestDaemon_Initialization(t *testing.T) {
	strategyNames := []string{"TrendConfluence"}
	cfg := DefaultEnsembleConfig(strategyNames)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	engine := NewEnsembleEngine(cfg, store)

	daemon := NewDaemon(engine)
	if daemon.engine == nil {
		t.Errorf("Expected engine to be initialized")
	}
}

// These fixtures are deliberately nonparallel: environment and stdout are process globals.
const daemonTestTimeout = 5 * time.Second

func offlineDaemon(t *testing.T) (*Daemon, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("GELT_BEADS_BRAIN_PATH", filepath.Join(home, "telemetry"))
	// DefaultEnsembleConfig can read MCP configuration, so isolate first.
	cfg := DefaultEnsembleConfig([]string{"TrendConfluence"})
	cfg.ScanIntervalMins = 1
	cfg.DurationMode = "1h" // Do not exit at wall-clock equity market close.
	cfg.WatchSymbols = nil
	store := NewStore(filepath.Join(home, "journal.json"), filepath.Join(home, "cycles.json"))
	return NewDaemon(NewEnsembleEngine(cfg, store)), filepath.Join(home, ".gelt", "daemon", "status.json")
}

type daemonTestRun struct {
	cancel context.CancelFunc
	done   chan struct{}
	err    error // Published by close(done); never read before completion.
}

func startDaemonTestRun(t *testing.T, run func(context.Context) error) *daemonTestRun {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	r := &daemonTestRun{cancel: cancel, done: make(chan struct{})}
	// Register BEFORE launching, and AFTER fixture resource cleanups. Fatal,
	// early return and body timeouts must still cancel/join before restoration.
	t.Cleanup(func() {
		cancel()
		err, completed := r.wait(daemonTestTimeout)
		if !completed {
			// Fatal alone would continue other cleanups while the worker is live.
			// Terminate the test process instead of restoring shared resources.
			fmt.Fprintln(os.Stderr, "daemon test cleanup: worker did not join; aborting before resource restoration")
			os.Exit(2)
		}
		if err != nil {
			t.Errorf("daemon test cleanup: RunBackground: %v", err)
		}
	})
	go func() {
		r.err = run(ctx)
		close(r.done)
	}()
	return r
}

// A closed notification, unlike a one-shot error channel, supports body AND cleanup waits.
func (r *daemonTestRun) wait(timeout time.Duration) (error, bool) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-r.done:
		return r.err, true
	case <-timer.C:
		return nil, false
	}
}

func (r *daemonTestRun) awaitReady(timeout time.Duration, ready func() bool) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-r.done:
			return fmt.Errorf("daemon exited before readiness: %v", r.err)
		default:
		}
		if ready() {
			return nil
		}
		select {
		case <-r.done:
			return fmt.Errorf("daemon exited before readiness: %v", r.err)
		case <-timer.C:
			return fmt.Errorf("timed out waiting for daemon readiness")
		case <-ticker.C:
		}
	}
}

func awaitDaemonRunning(t *testing.T, r *daemonTestRun, statusFile string) {
	t.Helper()
	// RUNNING is durably published after signal registration and an offline cycle.
	err := r.awaitReady(daemonTestTimeout, func() bool {
		data, err := os.ReadFile(statusFile)
		var status DaemonStatus
		return err == nil && json.Unmarshal(data, &status) == nil &&
			status.Status == "RUNNING" && status.PID == os.Getpid()
	})
	if err != nil {
		t.Fatal(err)
	}
}

func awaitDaemonStopped(t *testing.T, r *daemonTestRun, statusFile string) {
	t.Helper()
	if err, completed := r.wait(daemonTestTimeout); !completed || err != nil {
		t.Fatalf("daemon completion: completed=%v, error=%v", completed, err)
	}
	data, err := os.ReadFile(statusFile)
	if err != nil {
		t.Fatal(err)
	}
	var status DaemonStatus
	if err := json.Unmarshal(data, &status); err != nil {
		t.Fatal(err)
	}
	if status.Status != "STOPPED" || status.PID != 0 {
		t.Fatalf("expected STOPPED/PID 0, got %+v", status)
	}
}

func TestDaemon_GracefulShutdown(t *testing.T) {
	daemon, statusFile := offlineDaemon(t)
	r := startDaemonTestRun(t, daemon.RunBackground)
	awaitDaemonRunning(t, r, statusFile)
	r.cancel()
	awaitDaemonStopped(t, r, statusFile)
}

func TestDaemon_SignalHandling(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("proc.Signal POSIX inter-process signals are not supported on Windows")
	}
	daemon, statusFile := offlineDaemon(t)
	r := startDaemonTestRun(t, daemon.RunBackground)
	awaitDaemonRunning(t, r, statusFile)
	proc, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Signal(os.Interrupt); err != nil {
		t.Fatalf("send real OS interrupt: %v", err)
	}
	// No body cancellation: successful completion must come from the signal.
	awaitDaemonStopped(t, r, statusFile)
}

func TestDaemon_SingletonLock(t *testing.T) {
	daemonDir := t.TempDir()

	unlock, err := AcquireSingletonLock(daemonDir)
	if err != nil {
		t.Fatalf("Expected successful initial lock acquisition, got: %v", err)
	}

	// Second acquisition attempt should fail while first lock is held by current PID
	_, err = AcquireSingletonLock(daemonDir)
	if err == nil {
		t.Errorf("Expected error when attempting concurrent lock acquisition, got nil")
	}

	// Release first lock
	unlock()

	// Third acquisition attempt should succeed after lock is released
	unlock2, err := AcquireSingletonLock(daemonDir)
	if err != nil {
		t.Errorf("Expected successful lock re-acquisition after release, got: %v", err)
	}
	if unlock2 != nil {
		unlock2()
	}
}

func TestDaemon_AutoSpawnOrchestratorDisabledByDefault(t *testing.T) {
	strategyNames := []string{"TrendConfluence"}
	cfg := DefaultEnsembleConfig(strategyNames)
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	engine := NewEnsembleEngine(cfg, store)

	daemon := NewDaemon(engine)
	if daemon.autoSpawnOrchestrator {
		t.Fatal("automatic orchestrator must be disabled until it has verified price/provenance")
	}

	// Compatibility control may be set, but RunBackground deliberately does not
	// auto-start a bridge until it has verified price/provenance.
	daemon.SetAutoSpawnOrchestrator(true)
	if !daemon.autoSpawnOrchestrator {
		t.Fatal("compatibility control was not retained")
	}
}

func TestDaemon_AutoSpawnOrchestratorLifecycle(t *testing.T) {
	daemon, statusFile := offlineDaemon(t)
	daemon.SetAutoSpawnOrchestrator(true)
	r := startDaemonTestRun(t, daemon.RunBackground)
	awaitDaemonRunning(t, r, statusFile)
	r.cancel()
	awaitDaemonStopped(t, r, statusFile)
	if daemon.orchestratorCmd != nil {
		t.Error("automatic orchestrator must remain disabled without verified price/provenance")
	}
}

func TestDaemon_PublishCycleFailsClosedOnTelemetryOrStatusError(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	daemon := NewDaemon(NewEnsembleEngine(DefaultEnsembleConfig(nil), store))
	statusFile := filepath.Join(t.TempDir(), "status.json")
	res := EnsembleResult{CycleNumber: 1, EvalTime: time.Now().UTC(), TotalDeployed: 25}

	originalStatus := []byte(`{"status":"STOPPED"}`)
	if err := os.WriteFile(statusFile, originalStatus, 0644); err != nil {
		t.Fatal(err)
	}
	telemetryDir := t.TempDir()
	t.Setenv("GELT_BEADS_BRAIN_PATH", telemetryDir)
	telemetryFile := filepath.Join(telemetryDir, "shadow_telemetry.json")
	originalTelemetry := []byte(`{"cycle_number":0}`)
	if err := os.WriteFile(telemetryFile, originalTelemetry, 0644); err != nil {
		t.Fatal(err)
	}

	// Fail the production durable writer at replace time. The canonical telemetry
	// artifact must remain byte-for-byte intact and no RUNNING status may appear.
	daemon.writeArtifact = func(path string, data []byte, mode os.FileMode) error {
		if path == telemetryFile {
			return durableReplaceFileWithReplacer(path, data, mode, 0755, func(string, string) error {
				return fmt.Errorf("telemetry replace unavailable")
			})
		}
		return durableReplaceArtifact(path, data, mode)
	}
	if err := daemon.publishCycle(statusFile, res, 0); err == nil {
		t.Fatal("publishCycle succeeded after telemetry persistence failure")
	}
	assertFileBytes(t, telemetryFile, originalTelemetry)
	assertFileBytes(t, statusFile, originalStatus)

	// Status replacement failures preserve both existing artifacts; the telemetry
	// update is durably compensated with the prior bytes.
	daemon.writeArtifact = func(path string, data []byte, mode os.FileMode) error {
		if path == statusFile {
			return durableReplaceFileWithReplacer(path, data, mode, 0755, func(string, string) error {
				return fmt.Errorf("status replace unavailable")
			})
		}
		return durableReplaceArtifact(path, data, mode)
	}
	if err := daemon.publishCycle(statusFile, res, 0); err == nil {
		t.Fatal("publishCycle succeeded after status persistence failure")
	}
	assertFileBytes(t, telemetryFile, originalTelemetry)
	assertFileBytes(t, statusFile, originalStatus)

	// If compensation itself cannot commit, publication returns a visible error;
	// an emergency removal prevents the unacknowledged new telemetry from
	// surviving as a fresh success claim.
	writes := 0
	daemon.writeArtifact = func(path string, data []byte, mode os.FileMode) error {
		if path == statusFile {
			return fmt.Errorf("status unavailable")
		}
		if path == telemetryFile {
			writes++
			if writes == 2 {
				return fmt.Errorf("telemetry restore unavailable")
			}
		}
		return durableReplaceArtifact(path, data, mode)
	}
	if err := daemon.publishCycle(statusFile, res, 0); err == nil {
		t.Fatal("publishCycle succeeded after telemetry rollback failure")
	}
	if _, err := os.Stat(telemetryFile); !os.IsNotExist(err) {
		t.Fatalf("fresh telemetry survived failed rollback: %v", err)
	}
	assertFileBytes(t, statusFile, originalStatus)
}

func assertFileBytes(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(got) != string(want) {
		t.Fatalf("artifact %s changed after failed publication:\n got %q\nwant %q", path, got, want)
	}
}

func TestDaemonTelemetryIncludesCapitalReservationDegradation(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	daemon := NewDaemon(NewEnsembleEngine(DefaultEnsembleConfig(nil), store))
	telemetryDir := t.TempDir()
	t.Setenv("GELT_BEADS_BRAIN_PATH", telemetryDir)
	if _, err := daemon.writeTelemetry(EnsembleResult{CycleNumber: 1, EvalTime: time.Now().UTC(), CapitalReservationDegraded: true}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(telemetryDir, "shadow_telemetry.json"))
	if err != nil {
		t.Fatal(err)
	}
	var telemetry struct {
		CapitalReservationDegraded bool `json:"capital_reservation_degraded"`
	}
	if err := json.Unmarshal(data, &telemetry); err != nil {
		t.Fatal(err)
	}
	if !telemetry.CapitalReservationDegraded {
		t.Fatal("telemetry omitted persistent capital-reservation degradation")
	}
}

func TestDaemon_StoppedStatusUsesPersistedDeployment(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "journal.json"), filepath.Join(t.TempDir(), "cycles.json"))
	if err := store.addTrade(ShadowTrade{ID: "open", PlanName: "status-test", Symbol: "SPY", AmountUSD: 42, Status: "OPEN"}); err != nil {
		t.Fatal(err)
	}
	daemon := NewDaemon(NewEnsembleEngine(EnsembleConfig{ScanIntervalMins: 1, TotalCapitalUSD: 100}, store))
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := daemon.RunBackground(ctx); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(tmpHome, ".gelt", "daemon", "status.json"))
	if err != nil {
		t.Fatal(err)
	}
	var status DaemonStatus
	if err := json.Unmarshal(data, &status); err != nil {
		t.Fatal(err)
	}
	if status.Status != "STOPPED" || status.TotalDeployed != 42 {
		t.Fatalf("stopped status does not reflect persisted deployment: %+v", status)
	}
}

func TestDaemon_JSONLogging(t *testing.T) {
	// File capture avoids pipe-buffer deadlock and requires no reader goroutine.
	capturePath := filepath.Join(t.TempDir(), "stdout.jsonl")
	capture, err := os.Create(capturePath)
	if err != nil {
		t.Fatal(err)
	}
	oldStdout := os.Stdout
	os.Stdout = capture
	t.Cleanup(func() {
		os.Stdout = oldStdout
		if err := capture.Close(); err != nil {
			t.Error(err)
		}
	})
	daemon, statusFile := offlineDaemon(t)
	r := startDaemonTestRun(t, daemon.RunBackground)
	awaitDaemonRunning(t, r, statusFile)
	r.cancel()
	awaitDaemonStopped(t, r, statusFile)

	out, err := os.ReadFile(capturePath)
	if err != nil {
		t.Fatal(err)
	}
	foundJSON := false
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		var entry struct {
			Message   string `json:"msg"`
			Component string `json:"component"`
			Level     string `json:"level"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("invalid structured log %q: %v", line, err)
		}
		if entry.Message == "Starting background shadow trading service..." {
			foundJSON = true
			if entry.Component != "daemon" || entry.Level != "INFO" {
				t.Errorf("unexpected startup log: %+v", entry)
			}
		}
	}
	if !foundJSON {
		t.Error("did not find structured daemon startup log")
	}
}

func TestDaemonTestRun_RepeatableWaitAndTimeouts(t *testing.T) {
	var r *daemonTestRun
	t.Run("early return after timeouts", func(t *testing.T) {
		// Registered before lifecycle cleanup: observes join, not just cancellation.
		t.Cleanup(func() {
			select {
			case <-r.done:
				if r.err != nil {
					t.Errorf("cleanup result: %v", r.err)
				}
			default:
				t.Error("resource restoration preceded join")
			}
		})
		r = startDaemonTestRun(t, func(ctx context.Context) error {
			<-ctx.Done()
			return nil
		})
		if _, completed := r.wait(time.Millisecond); completed {
			t.Fatal("worker unexpectedly completed before cancellation")
		}
		if err := r.awaitReady(time.Millisecond, func() bool { return false }); err == nil || !strings.Contains(err.Error(), "timed out") {
			t.Fatalf("expected readiness timeout, got %v", err)
		}
		// Deliberately return without cancel or join: cleanup must do both.
	})
	for i := 0; i < 2; i++ {
		if err, completed := r.wait(daemonTestTimeout); !completed || err != nil {
			t.Fatalf("repeat wait %d: %v, %v", i, completed, err)
		}
	}
}

// Expected Fatal/error/cleanup-timeout paths run in isolated test processes so
// their failure cannot be mistaken for a passing fixture or kill the parent suite.
func TestDaemonTestRun_FailureCleanup(t *testing.T) {
	if mode := os.Getenv("GELT_DAEMON_CLEANUP_CHILD"); mode != "" {
		marker := os.Getenv("GELT_DAEMON_CLEANUP_MARKER")
		if mode == "unjoinable" {
			t.Cleanup(func() { _ = os.WriteFile(marker, []byte("unsafe restoration"), 0600) })
			startDaemonTestRun(t, func(context.Context) error { select {} })
			return // Cleanup must abort, not restore resources with a live worker.
		}
		if mode == "early-error" {
			r := startDaemonTestRun(t, func(context.Context) error { return errors.New("fixture sentinel error") })
			if err := r.awaitReady(daemonTestTimeout, func() bool { return false }); err == nil || !strings.Contains(err.Error(), "fixture sentinel error") {
				t.Fatalf("lost early error: %v", err)
			}
			for i := 0; i < 2; i++ {
				if err, completed := r.wait(daemonTestTimeout); !completed || err == nil || err.Error() != "fixture sentinel error" {
					t.Fatalf("lost completion error: %v, %v", completed, err)
				}
			}
			if err := os.WriteFile(marker, []byte("early error observed twice"), 0600); err != nil {
				t.Fatal(err)
			}
			return // Cleanup must ALSO report the RunBackground error.
		}
		capture, err := os.CreateTemp(t.TempDir(), "capture")
		if err != nil {
			t.Fatal(err)
		}
		oldStdout := os.Stdout
		os.Stdout = capture
		t.Cleanup(func() { os.Stdout = oldStdout; _ = capture.Close() })
		daemon, statusFile := offlineDaemon(t)
		home := os.Getenv("HOME")
		var r *daemonTestRun
		t.Cleanup(func() {
			// This runs after lifecycle cleanup but before environment/output restoration.
			select {
			case <-r.done:
			default:
				t.Fatal("resource restoration preceded join")
			}
			awaitDaemonStopped(t, r, statusFile)
			if os.Getenv("HOME") != home || os.Getenv("USERPROFILE") != home ||
				os.Getenv("GELT_BEADS_BRAIN_PATH") != filepath.Join(home, "telemetry") || os.Stdout != capture {
				t.Fatal("resources restored before join")
			}
			if err := os.WriteFile(marker, []byte("joined before restoration"), 0600); err != nil {
				t.Fatal(err)
			}
		})
		r = startDaemonTestRun(t, daemon.RunBackground)
		awaitDaemonRunning(t, r, statusFile)
		t.Fatal("intentional fixture Fatal")
	}
	for _, mode := range []string{"fatal", "early-error", "unjoinable"} {
		t.Run(mode, func(t *testing.T) {
			marker := filepath.Join(t.TempDir(), "cleanup-proof")
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDaemonTestRun_FailureCleanup$", "-test.count=1")
			cmd.Env = append(os.Environ(), "GELT_DAEMON_CLEANUP_CHILD="+mode, "GELT_DAEMON_CLEANUP_MARKER="+marker)
			out, err := cmd.CombinedOutput()
			if ctx.Err() != nil || err == nil || strings.Contains(string(out), "DATA RACE") {
				t.Fatalf("expected bounded child failure without races: %v, %v\n%s", ctx.Err(), err, out)
			}
			var exitErr *exec.ExitError
			if !errors.As(err, &exitErr) {
				t.Fatalf("could not execute child: %v", err)
			}
			if mode == "unjoinable" {
				if exitErr.ExitCode() != 2 || !strings.Contains(string(out), "aborting before resource restoration") {
					t.Fatalf("missing hard cleanup failure: %v\n%s", err, out)
				}
				if _, err := os.Stat(marker); !os.IsNotExist(err) {
					t.Fatalf("unjoined worker allowed restoration: %v", err)
				}
				return
			}
			want, message := "joined before restoration", "intentional fixture Fatal"
			if mode == "early-error" {
				want, message = "early error observed twice", "daemon test cleanup: RunBackground: fixture sentinel error"
			}
			data, readErr := os.ReadFile(marker)
			if exitErr.ExitCode() != 1 || readErr != nil || string(data) != want || !strings.Contains(string(out), message) {
				t.Fatalf("missing cleanup proof or unexpected failure: %v, %q, %v\n%s", err, data, readErr, out)
			}
		})
	}
}
