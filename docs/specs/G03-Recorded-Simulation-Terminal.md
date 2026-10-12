---
type: Specification and Completion Report
title: G03 Restore the recorded simulation terminal
description: Retained OpenTerminal shell with protected read-only inspection of recorded independent application-mock facts.
timestamp: 2026-10-12T00:00:00Z
status: candidate-awaiting-final-review-and-exact-head-ci
---

## Approved boundary

G03 follows delivered browser entry and the existing isolated mock core. It can
proceed independently of paper-package and subscription-decision readiness.
The later autonomous decision/execution journey remains separate. Owner viewing
does not grant effect authority, and this ticket adds no per-trade confirmation
requirement to the autonomous simulated product.

The `/simulation` route reuses Terminal, Workspace, Sidebar, TopBar,
CommandPalette and Zustand. Only run, paper, data, decision, orders and results
panels are available. It does not mount the legacy market/AI/portfolio widgets,
fetch symbol/provider feeds or create another simulator, ledger or database.
The existing home, history, research and connection routes remain available.

## Recorded fixture and protected reads

The opt-in recorded-terminal launcher exercises two fresh bounded scenarios
through the existing G02 harness and independent durable application mock:
one partial fill followed by settled cancellation, and one response-loss
UNKNOWN dispatch with an independently observed mock acceptance and no fill.
This is scripted fixture preparation, not a Codex decision or real market run.
Existing exact decimals, synthetic instrument/units, fee-inclusive cap, admission,
expiry, single-use dispatch and UNKNOWN fences remain unchanged. No automatic
redispatch or UNKNOWN recovery is added.

Only the already-redacted synthetic history and independent mock-order readback,
requested fixture terms and explicit non-agent labels enter the bounded private
snapshot. No grant, bearer, session, confirmation token or admission handle is
serialized. This immutable view artifact is not another execution store. Each
owned fixture closes once before removal; uncertain close retains its root.

Named `simulation-list` and `simulation-detail` POST operations use the existing
Host/Origin/ingress/Secure owner cookie/CSRF boundary. They read only an explicitly
configured private snapshot with a pinned original-byte SHA-256 under
`GELT_SIMULATION_VIEW=recorded-fixture-only`. Caller-selected paths, writes,
imports, execution and worker/provider forwarding are absent. With no configured
artifact, reads truthfully report unavailable. Read failures report unavailable;
hash, bounded-JSON or schema failures report corrupt. Selection misses report
missing. Session validity is rechecked before response publication.

The strict synthetic view schema binds the history intent to the independent
mock dispatch, verifies event count and unique selections/executions, preserves
decimal strings and reserves serialized-response headroom. Integrity proves
the selected bytes, not independent authenticity or a paper/strategy outcome.

## Browser behavior

Run switching, refresh, session/CSRF replacement, expiry and unmount invalidate
the active generation and abort its request. A response that ignores abort
cannot publish success, failure or finally effects after its generation changes.
Reads have bounded bodies and an absolute client deadline. Protected run data
clears while loading, on read failure and on authoritative owner denial/expiry.
Generic 401/403/network failures do not become invented owner-session diagnoses.
Only benign shell preferences live in Zustand/local storage; protected fixture
data stays in component memory.

The UI distinguishes requested terms, mock acknowledgement, cancellation
acknowledgement, terminal status, observed executions and UNKNOWN. It displays
configured fixture units and exact observed quantity/price/fee strings. A missing
fee remains unreported. Cash, positions, P&L, market inputs, paper linkage and agent
recommendations are unavailable rather than fabricated. The protected viewer is
read-only and has no order controls or scheduling/pause/resume authority.

## Delivery and verification

Changed areas: retained shell components and benign panel preference; new
simulation page/workspace and bounded request coordinator; pure view contract
and private snapshot reader; two named BFF read branches; opt-in fixture/launcher;
focused contract, reader, BFF and request regressions; import manifest; and hosted
G03 protected-browser acceptance in the existing Linux CI job.

Pure import verification, JavaScript syntax checks and whitespace checks pass on
the authored candidate. No local listener, ownership, cleanup, installed-owner
acceptance or held historical workload was run. Required candidate Go build/race/
vet, full V2/native Windows tests/build/smoke, fresh independent/adversarial source
review and exact-head hosted browser evidence remain pending. CI results must be
bound to the eventual reviewed head; earlier G01/G02 passes are not transferred.

The hosted browser gate uses the real existing viewer login, Next/BFF and fresh
G02-produced snapshot. It checks unauthenticated denial, exact independent fills,
six-panel whitelist, run switching/late response, denial/recovery, narrow layout
reachability and browser-clock expiry. Server expiry is separately unit-tested.
It retains only synthetic screenshots and a non-secret stage/source-tree receipt;
raw locator errors and grants are never logged. Final acceptance requires pixel
inspection and confirmed owned browser/web/snapshot cleanup. This does not claim
owner consumption, native Windows browser acceptance or autonomous agent use.

After an admitted locked build, the opt-in viewer recipe is:

```sh
node v2/scripts/recorded-terminal-demo.mjs --recorded-terminal-only
```

It never installs or builds. It creates fresh isolated scripted fixtures, starts
the existing web-only protected viewer and stops through its established bounded
shutdown. The one-use viewer grant opens `/connect`; `/simulation` then reads the
recorded data. Any uncertain failure retains owned fixtures for review. Existing
local runtime and no-rerun holds still apply to execution of this recipe.

Paper-package extraction/MCP parity, Codex subscription/isolation GO and genuine
autonomous execution are separate downstream prerequisites. This recorded-fixture
delivery does not satisfy them or require the owner to enter simulated trades.
