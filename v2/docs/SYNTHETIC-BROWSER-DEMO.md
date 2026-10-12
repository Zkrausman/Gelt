---
type: specification
title: "ZAR-219 test-only synthetic browser demonstration"
status: partial-candidate-m8-open
execution_enabled: false
---

# ZAR-219 isolated synthetic browser demonstration

This is **SYNTHETIC OFFLINE TEST / NOT BROKER DATA**, not the production
`v2/web` screen or worker service. `v2/scripts/start.mjs` remains execution-disabled.
No connection/credentials/provider/broker calls are made. The separate test runner
owns both HTTP listeners (ephemeral ports bound only to `127.0.0.1`) and the private
SQLite fixture. Only the server-to-server bridge holds the harness bearer/session;
the browser cannot call the harness (its Origin rejection remains). The browser
receives a five-minute nonrenewable HttpOnly SameSite cookie plus page CSRF value.
Exact loopback Host/Origin and no forwarding headers are required. Only named
resume/preview/confirm/history/reconcile/cancel operations are available. Scenario
selection is available only to test runner code, never the browser bridge.
Application-mock mode adds only the `mock-state` read operation.

From `v2/`, on Node 22 with installed lockfile dependencies and **an explicitly
provisioned trusted Windows private parent** (`GELT_WINDOWS_PRIVATE_PARENT`, per
`worker/native/private-storage.ps1`; do not reuse an unvalidated temp directory):

```sh
./node_modules/.bin/tsc -p worker
NODE_ENV=test node scripts/synthetic-browser-demo.mjs --offline-test-only
```

The optional application-protocol mock is selected explicitly by adding
`--application-mock-test-only`. This enables only the versioned local synthetic
mock adapter and its separate private SQLite file for the disposable demo fixture:

```sh
NODE_ENV=test node scripts/synthetic-browser-demo.mjs --offline-test-only --application-mock-test-only
```

In this mode the fixed instrument is `SYNTH-RH-USD` with the mock's named test
quote and starting limit `0.90 USD` and fee `0.01 USD`; the fallback demo keeps
its `1.00 USD` starting limit. After explicit preview and confirmation, the page
shows lifecycle history and provides a separate read of durable mock state
using the confirmed synthetic intent ID. The mock section is labeled as an
application protocol mock, not official Robinhood or MCP, and is not broker
evidence. A cancellation acknowledgement remains separate from terminal
cancellation. An unknown outcome remains unresolved and is never retried.

Editing an admitted mock draft clears confirmation consent but keeps the exact
preview visible and reserved through its expiry. Restore the displayed terms to
confirm them, or wait until expiry before requesting a replacement. A stale
preview ID or mismatched terms hash does not consume a newer bridge preview.
Fallback-mode wrong-hash confirmation attempts retain the original single-use
consumption behavior. Public synthetic history omits preview IDs; the authored
integration regression verifies the preview-to-intent binding from the
test-only persisted lifecycle events instead.

Open the printed `http://127.0.0.1:<ephemeral-port>/` only in a local browser.
Use Resume, Preview, review exact synthetic order/fee/expiry, tick confirmation,
Confirm, then Refresh synthetic history. In application-mock mode, use the
separate durable mock state button after confirmation. Ctrl-C/SIGTERM closes both
listeners before removing this run's private fixture. Cleanup is bounded to five
seconds; if closure does not finish, the launcher exits with failure and retains
the fixture for manual review. No persistent service should be left running.
On Windows PowerShell set `$env:NODE_ENV='test'` before invoking `node` instead
of the POSIX inline environment syntax. This intentionally refuses startup when
private storage guardrails are not satisfied. A successful confirmation means only
a synthetic lifecycle outcome, not a broker fill; unknown outcomes block new orders.
The source-tagged history preserves event order and shows each synthetic observed
execution's own exact-decimal quantity, price and observed fee (when present).
The fixture's partial executions are 0.004 @ 1.01 with fee 0.003 and 0.002
@ 1.02 with fee 0.002 USD, distinct from the requested 0.010 @ 1.00 and
preview fee 0.01. No requested amount stands in for an observed execution;
no total is projected from requested terms. These are test-runner-generated
SQLite fixture facts, never broker fills or production history.

Changed files in this slice: `worker/src/synthetic-browser-demo.ts`,
`worker/src/synthetic-browser-demo.test.ts`, `scripts/synthetic-browser-demo.mjs`,
and this document. Focused tests: `./node_modules/.bin/vitest run --config
worker/vitest.config.ts worker/src/synthetic-browser-demo.test.ts
worker/src/synthetic-order-harness.test.ts`. Full Node/Windows/Go gates and real provider capabilities remain unverified;
**M8 remains OPEN**.

## ZAR-238 separate companion-kernel partial integration (not runtime-wired)

`worker/src/synthetic-companion.ts` is a separate, default-disabled in-process
contract kernel. It is not imported by this browser demonstration, its worker
harness, production `service.ts`, or the BFF. It provisions a short-lived random
credential bound to an owner-session string, validates a strict v1 synthetic-only
preview with loopback/session/nonce/expiry/revision checks and identity-local
replay/duplicate checks retained until identity expiry (not a durable
session-wide intent), and requires explicitly supplied synthetic quote and fee
inputs associated with the owner session and full order terms before exact
fee-inclusive USD ≤10 validation. This in-process association digest is not
independent source authentication. The only accepted instrument and account/route
pairs are synthetic. The closed response reports no authorizing power, broker facts or
execution. No HTTP listener, CLI/private-file provisioning, BFF route, UI control,
production startup change or `OrderLifecycle.confirm()` call is included. The
`remoteAddress` parameter is not a substitute for a real socket-bound loopback
transport. The original Squire candidate was UNVERIFIED. Separate operator
integration first passed 12/12 focused Node24 tests; after replay-scope
regressions, the latest focused run passed 14/14. Worker no-emit TypeScript,
local import verification (82 upstream/404 candidate), Node24 V2 build and
offline smoke, and Go race passed locally. Cumulative supported-platform tests,
final exact-head review and CI remain open. M8 remains open and no broker
capability is implied.
