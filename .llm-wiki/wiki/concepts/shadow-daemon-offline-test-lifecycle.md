# Offline shadow daemon lifecycle fixtures

Source: [daemon_test.go](../../../pkg/shadow/daemon_test.go); rationale: [ZAR-211 specification](../../../docs/specs/ZAR-211-Scope-Runtime-Release-Gates.md).

GracefulShutdown, SignalHandling, AutoSpawnOrchestratorLifecycle and JSONLogging share these test-only constraints:

1. Keep tests nonparallel because environment/stdout are process globals. Isolate HOME, USERPROFILE and GELT_BEADS_BRAIN_PATH before DefaultEnsembleConfig, which can load MCP configuration. Use a new empty journal and nil WatchSymbols: lifecycle tests need no production market-data operations. Select non-session `1h` duration to avoid wall-clock market-close exit; this is not a one-hour test wait.
2. Register cancel-and-bounded-join cleanup **before launch**, after resource-restoration cleanups so LIFO joins first on normal return, Fatal or timeout. Store the run result then close a done channel; receive done before reading the result. Body and cleanup can wait repeatedly without consuming a one-shot error channel.
3. Readiness polls durable RUNNING/current PID after signal registration, every 1ms with a 5s deadline and early-exit detection. Completion is also bounded at 5s. Fixed startup/cancel sleeps are not readiness. Require successful RunBackground and STOPPED/PID 0. Linux signal testing sends a real os.Interrupt; cleanup context cancellation is only fallback, not the asserted signal path.
4. JSONLogging creates file-based stdout capture before NewDaemon; no pipe/reader goroutine. Read after completion, assert valid JSON/startup message/component/level, restore output and close only after lifecycle join. Orchestrator compatibility control still must not start the unverified bridge.
5. Cleanup reports run errors. If cancellation cannot join within 5s, hard-fail the test process before resource restoration; t.Fatal alone would still allow other cleanups around a live worker. Bounded subprocess regressions (20s parent timeout) cover intentional Fatal with a real offline daemon, early-error reporting and this unjoinable-worker path. Additional helper coverage checks early return, readiness/completion timeouts, repeated waits and cleanup order.

These changes do not alter production daemon.go, market-data fail-closed behavior, trading or deployment scripts, and do not claim coverage of every production internal goroutine. The synchronous already-canceled persisted-deployment fixture is separate from the four asynchronous fixtures above.

CI targets master, pins Go 1.26.1 compatible with go.mod 1.25.0, and retains build/race tests with vet. Run focused fixtures (including repeated Linux signals), full `GOTOOLCHAIN=go1.26.1 go test -race ./...`, `GOTOOLCHAIN=go1.26.1 go vet ./...` and diff checks. Distinguish working-tree/pre-evidence-commit results from exact-head checks after the evidence commit. No production changes or skipped Linux signal coverage are justified by fixture failures.
