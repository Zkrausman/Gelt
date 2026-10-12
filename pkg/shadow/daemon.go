package shadow

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"gelt/pkg/config"
)

type DaemonStatus struct {
	Status          string    `json:"status"`
	Reason          string    `json:"reason,omitempty"`
	CycleNumber     int       `json:"cycle_number"`
	LastScanTime    time.Time `json:"last_scan_time"`
	TotalDeployed   float64   `json:"total_deployed"`
	PID             int       `json:"pid"`
	OrchestratorPID int       `json:"orchestrator_pid,omitempty"`
}

type Daemon struct {
	engine                *EnsembleEngine
	autoSpawnOrchestrator bool
	orchestratorCmd       *exec.Cmd
	logger                *slog.Logger
	writeArtifact         func(string, []byte, os.FileMode) error
	removeArtifact        func(string) error
}

func NewDaemon(engine *EnsembleEngine) *Daemon {
	// Automatic bridge execution is disabled: its heuristic output lacks the
	// verified price/provenance required for promotable shadow journal records.
	// A caller may explicitly enable it only after that bridge contract is fixed.
	autoSpawn := false
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	return &Daemon{
		engine:                engine,
		autoSpawnOrchestrator: autoSpawn,
		logger:                logger,
		writeArtifact:         durableReplaceArtifact,
		removeArtifact:        os.Remove,
	}
}

func (d *Daemon) SetAutoSpawnOrchestrator(autoSpawn bool) {
	d.autoSpawnOrchestrator = autoSpawn
}

func (d *Daemon) spawnOrchestratorBridge(ctx context.Context) (int, error) {
	binName := "orchestrator"
	if runtime.GOOS == "windows" {
		binName = "orchestrator.exe"
	}

	execDir := ""
	if execPath, err := os.Executable(); err == nil {
		execDir = filepath.Dir(execPath)
	}

	var cmd *exec.Cmd
	targetPath := filepath.Join(execDir, binName)
	if _, err := os.Stat(targetPath); err == nil {
		cmd = exec.CommandContext(ctx, targetPath)
	} else if path, err := exec.LookPath(binName); err == nil {
		cmd = exec.CommandContext(ctx, path)
	} else if _, err := os.Stat("cmd/orchestrator/main.go"); err == nil {
		cmd = exec.CommandContext(ctx, "go", "run", "./cmd/orchestrator")
	} else {
		return 0, fmt.Errorf("orchestrator binary or source not found")
	}

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("failed to start orchestrator process: %w", err)
	}

	d.orchestratorCmd = cmd
	pid := cmd.Process.Pid
	d.logger.Info("Auto-spawned LLM Orchestrator Bridge", "pid", pid, "component", "daemon")

	go func() {
		_ = cmd.Wait()
	}()

	return pid, nil
}

func (d *Daemon) stopOrchestratorBridge() {
	if d.orchestratorCmd != nil && d.orchestratorCmd.Process != nil {
		_ = d.orchestratorCmd.Process.Kill()
		d.orchestratorCmd = nil
	}
}

// AcquireSingletonLock ensures only a single instance of the Gelt Daemon can run concurrently.
// It returns an unlock function to release the lockfile upon process exit.
func AcquireSingletonLock(daemonDir string) (func(), error) {
	if err := os.MkdirAll(daemonDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create daemon dir: %w", err)
	}

	pidFile := filepath.Join(daemonDir, "daemon.pid")

	// Hold the platform OS lock for the daemon lifetime. The PID file remains
	// diagnostic/recovery metadata only; it is never the ownership primitive.
	releaseLock, err := tryLockDaemon(pidFile)
	if err != nil {
		return nil, fmt.Errorf("acquire daemon lifetime lock: %w", err)
	}
	if err := os.WriteFile(pidFile, []byte(fmt.Sprintf("%d", os.Getpid())), 0644); err != nil {
		_ = releaseLock()
		return nil, fmt.Errorf("write daemon lock owner: %w", err)
	}
	return func() {
		_ = os.Remove(pidFile)
		_ = releaseLock()
	}, nil
}

func (d *Daemon) RunBackground(ctx context.Context) error {
	daemonDir, err := config.UserDaemonDir()
	if err != nil {
		home, _ := os.UserHomeDir()
		daemonDir = filepath.Join(home, ".gelt", "daemon")
		_ = os.MkdirAll(daemonDir, 0755)
	}

	unlock, err := AcquireSingletonLock(daemonDir)
	if err != nil {
		return err
	}
	defer unlock()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		select {
		case <-sigChan:
			d.logger.Info("Received shutdown signal, terminating gracefully...", "component", "daemon")
			cancel()
		case <-ctx.Done():
		}
	}()

	// Do not automatically execute the heuristic bridge. Its current output lacks
	// verified price/provenance and must not enter a promotable shadow journal.
	// SetAutoSpawnOrchestrator is retained for API compatibility, but has no
	// effect until the bridge receives a separately reviewed data contract.
	var orchPID int
	if d.autoSpawnOrchestrator {
		d.logger.Warn("orchestrator auto-spawn disabled pending verified price/provenance contract", "component", "daemon")
	}

	d.logger.Info("Starting background shadow trading service...", "component", "daemon")

	statusFile := filepath.Join(daemonDir, "status.json")

	var publicationErr error
	onCycle := func(res EnsembleResult) {
		if publicationErr != nil {
			return
		}
		if publishErr := d.publishCycle(statusFile, res, orchPID); publishErr != nil {
			publicationErr = publishErr
			d.logger.Error("shadow daemon publication failed; halting service", "error", publishErr, "component", "daemon")
			cancel()
		}
	}

	err = d.engine.RunSession(ctx, onCycle)
	if publicationErr != nil {
		err = publicationErr
	}
	if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
		trades, loadErr := d.engine.store.Load()
		deployed := 0.0
		if loadErr == nil {
			deployed = totalPersistedOpenDeployment(trades)
		}
		state, stateErr := d.engine.store.LoadCapitalReservationState()
		halted := DaemonStatus{Status: "HALTED", Reason: redactDaemonReason(err), LastScanTime: time.Now().UTC(), TotalDeployed: deployed, PID: 0}
		if stateErr == nil && state.Degraded {
			halted.Reason = "shadow capital integrity degraded"
		}
		if writeErr := d.writeDaemonStatus(statusFile, halted); writeErr != nil {
			_ = d.removeArtifact(statusFile)
			return fmt.Errorf("shadow engine halted: %w; invalidate daemon status: %v", err, writeErr)
		}
		return err
	}

	// Do not claim a zero-deployed STOPPED state unless the persisted journal can
	// be read. A journal failure leaves the last known status intact and returns
	// an observable error instead of publishing fabricated shutdown telemetry.
	trades, loadErr := d.engine.store.Load()
	if loadErr != nil {
		d.logger.Error("load shadow journal before stopped status failed", "error", loadErr, "component", "daemon")
		return fmt.Errorf("load journal before stopped status: %w", loadErr)
	}
	status := DaemonStatus{
		Status:        "STOPPED",
		CycleNumber:   0,
		LastScanTime:  time.Now(),
		TotalDeployed: totalPersistedOpenDeployment(trades),
		PID:           0,
	}
	if writeErr := d.writeDaemonStatus(statusFile, status); writeErr != nil {
		d.logger.Error("write stopped shadow daemon status failed", "error", writeErr, "component", "daemon")
		return writeErr
	}
	return nil
}

func redactDaemonReason(err error) string {
	if err == nil {
		return ""
	}
	return "shadow engine stopped safely"
}

// StatusIsCurrent reports whether a RUNNING status is owned by a currently live PID.
func StatusIsCurrent(status DaemonStatus) bool {
	return status.Status != "RUNNING" || isProcessAlive(status.PID)
}

func (d *Daemon) writeDaemonStatus(statusFile string, status DaemonStatus) error {
	data, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal daemon status: %w", err)
	}
	if err := d.writeArtifact(statusFile, data, 0644); err != nil {
		return fmt.Errorf("write daemon status: %w", err)
	}
	return nil
}

func (d *Daemon) publishCycle(statusFile string, res EnsembleResult, orchPID int) error {
	// Persist telemetry before publishing RUNNING status. If status persistence
	// then fails, restore the prior telemetry bytes so neither surface retains a
	// fresh-success claim for the unacknowledged cycle.
	telemetryFile, err := telemetryPath()
	if err != nil {
		return err
	}
	previousTelemetry, existed, err := readOptionalFile(telemetryFile)
	if err != nil {
		return fmt.Errorf("read prior shadow telemetry: %w", err)
	}
	if _, err := d.writeTelemetry(res); err != nil {
		return fmt.Errorf("write shadow telemetry: %w", err)
	}
	status := DaemonStatus{
		Status:          "RUNNING",
		CycleNumber:     res.CycleNumber,
		LastScanTime:    res.EvalTime,
		TotalDeployed:   res.TotalDeployed,
		PID:             os.Getpid(),
		OrchestratorPID: orchPID,
	}
	if err := d.writeDaemonStatus(statusFile, status); err != nil {
		if restoreErr := d.restoreOptionalFile(telemetryFile, previousTelemetry, existed); restoreErr != nil {
			return fmt.Errorf("write daemon status: %w; restore prior telemetry: %v", err, restoreErr)
		}
		return err
	}
	return nil
}

func readOptionalFile(path string) ([]byte, bool, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		return data, true, nil
	}
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	return nil, false, err
}

func (d *Daemon) restoreOptionalFile(path string, data []byte, existed bool) error {
	if existed {
		if err := d.writeArtifact(path, data, 0644); err != nil {
			// The new telemetry is already committed but unacknowledged because the
			// paired status write failed. If the old bytes cannot be restored, remove
			// that fresh-success claim rather than misrepresenting the failed cycle.
			if removeErr := d.removeArtifact(path); removeErr != nil && !os.IsNotExist(removeErr) {
				return fmt.Errorf("restore prior artifact: %w; remove unacknowledged artifact: %v", err, removeErr)
			}
			return fmt.Errorf("restore prior artifact: %w; removed unacknowledged artifact", err)
		}
		return nil
	}
	if err := d.removeArtifact(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (d *Daemon) syncTelemetry(res EnsembleResult) error {
	_, err := d.writeTelemetry(res)
	return err
}

func telemetryPath() (string, error) {
	brainDir := os.Getenv("GELT_BEADS_BRAIN_PATH")
	if brainDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			brainDir = filepath.Join(home, ".gelt", "telemetry")
		} else {
			brainDir = ".gelt/telemetry"
		}
	}
	return filepath.Join(brainDir, "shadow_telemetry.json"), nil
}

func (d *Daemon) writeTelemetry(res EnsembleResult) (string, error) {
	telemetryFile, err := telemetryPath()
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal telemetry: %w", err)
	}
	if err := d.writeArtifact(telemetryFile, data, 0644); err != nil {
		return "", fmt.Errorf("write telemetry: %w", err)
	}
	return telemetryFile, nil
}
