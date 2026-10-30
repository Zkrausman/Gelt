---
type: specification
title: Gelt focused evidence workspace
status: source-candidate-pending-independent-review
scope: UI simplification and terminal-exclusive dependency removal only
source_baseline: 97cabe8f68d292777646384dc9b8e3fedc5c10a1
---

# Focused Gelt workspace

The owner approved replacing the general terminal surface with a small Gelt-owned
UI, preserving valuable shared foundations and existing controls. This supersedes
the old terminal-foundation preference without rewriting earlier records.

**Qualification NOT_READY; production CLOSED; operations DEFER;
C07/C13/C14 UNKNOWN.** Source navigation is not runtime, account, candidate,
strategy, risk or promotion evidence. No acquisition, provider call, credential,
permission, security configuration, campaign, trading activation or new engine
is included.

## KEEP / REMOVE / REPLACE boundary

| Disposition | Actual scope and reason |
| --- | --- |
| KEEP | Next/React/TypeScript and Tailwind support the existing Gelt pages. Session, Origin/Host/CSRF, raw ingress, private worker and protected BFF contracts are unchanged. Research evidence, history/timeline, connection controls, six recorded-result sections, worker math/inspection/assessor/ledger/lifecycle/risk fences, Go V1, tests and data remain. |
| REMOVE | Fifteen terminal market widgets; Terminal, Workspace, TopBar, Sidebar, CommandPalette and Flash components; the persisted terminal store; generic terminal API/key/indicator/link helpers; React Query wrapper. These 27 files form the retired market-widget graph. No surviving application import needs them. |
| REMOVE dependencies | Seven web runtime declarations: React Query, d3, hls.js, lightweight-charts, react-grid-layout, recharts, zustand; two widget-only types packages; unused root concurrently. 122 unneeded lock entries are removed; no retained resolution is upgraded. |
| REPLACE | Home is a static candidate/evidence → readiness → recorded-results guide. The previous protected order/status page moves intact to `/orders`, with module paths and presentation adjusted. `/simulation` mounts the existing protected viewer directly, with six local React-state buttons instead of terminal widgets/store/shortcuts. Global branding/navigation is Gelt. |
| RETAIN provenance | MIT/copyright attribution, original upstream pin and all 82 upstream path identities/hashes remain in the import manifest. Removed imported paths are explicitly omitted, not silently erased from provenance. Exact preceding and upstream lock reconstruction is preserved by `provenance/terminal-dependency-removal.json`. Removed-package notice texts remain as historical attribution; current dependency inventory is pruned. |
| RETAIN shared/legacy analysis | The existing server health/supervisor and test-covered analysis helpers remain. They are not mounted as market widgets or enabled by this change. Do not describe this delivery as erasing all derived source or eliminating all server dependencies. No private archive, duplicate repository, upstream history or owner records are modified. |

## User-visible behavior

The home page explains fixed source limits and links the protected evidence
library, readiness/status page and recorded synthetic results. It shows no
invented signals, risk metrics, balances, candidate status or live account health.
Existing protected views still require the same owner session and permitted data.
This is navigation over existing capabilities, not new artifact upload/import,
assessor invocation, paper conversion, data retrieval or lifecycle integration.

`/orders` retains exact drafts, synthetic Pi handoff invalidation/review,
connection freshness, disabled preview/confirm/cancel and read-only durable
history. Moving the page confers no new authority. The protected browser
regression follows its new route and retains its full failure/security assertions.

Recorded results retain every panel and original evidence disclosure, protected
request identity checks, switching/late-response rejection, denial clearing and
session-expiry behavior. Panel selection lives only in component memory. The old
`openterminal-workspace` storage key is never read, migrated, written or deleted
by the application. Existing preferences cannot activate widgets; stored grants,
CSRF or protected results are not added to it. Ordinary buttons replace the
retired command dialog; keyboard tab/enter activation uses standard controls.

Pages flow vertically on desktop and narrow screens. A global navigation bar,
visible focus styles and skip link provide access without a draggable grid,
market clock, external feed widget, live TV or AI palette. No external fonts,
image feeds or new API calls are added.

## Dependency and source accounting

The lockfile change was produced offline with scripts disabled, then unrelated
npm normalization of optional-platform/dev metadata was discarded. The original
objects for every retained package remain identical. Build-time verification
reconstructs the exact previous lock hash and original imported upstream hash,
and restricts root/web declaration changes to the ten stated removals and Gelt
root package name. Negative tests reject version/integrity/platform mutations,
new declarations, package resurrection, shared-dependency deletion and corrupt
removal provenance. No runtime reads the provenance document.

A clean `npm ci --offline --no-audit --no-fund` succeeded from the pruned lock.
Current package notices retain their original text/hash; original MIT is verbatim.
Import accounting covers the entire current candidate, including additions,
modified paths and explicit omitted upstream files. No dependency/security
upgrade or new dependency is bundled into this simplification.

## Verification and review gates

The initial working test pass exposed missing explicit React imports in two new
server-render assertions under Vitest's JSX mode. The components were corrected;
the initial failed output is retained and is not a pass. The final candidate
requires the complete Linux V2 tests/types/build/offline smoke, import accounting,
Go race/vet/build and diff/status checks. Windows code and conditional tests stay
retained as unsupported legacy evidence under the owner's Linux-only policy;
no platform-independent failure is waived.

The G03 protected browser regression retains unauthorized reads, actual fixture
login/BFF reads, independent mock fills, old-widget isolation, late-response
rejection, denial/recovery, narrow results, session expiry, no external origins
and owned cleanup. It adds desktop/narrow home evidence, no protected home input,
correct links/title and no horizontal overflow. Its former palette check is
replaced by six plain-panel selection plus proof the retired shortcut does not
open a dialog. G01's full protected draft/handoff/security browser gate follows
`/orders`. Research/history/scientific hosted gates remain required.

Fresh independent and distinct adversarial accuracy/privacy review cover the
complete actual diff, removed files, dependency provenance, full import inventory,
protected-view seams and this specification. Exact-head checks follow acceptance;
ordinary draft PR/CI/merge and remote/post-merge verification remain required.
Formal GitHub Approve is not authorized by standing delivery approval. Passing
source tests or UI screenshots cannot qualify actual input, runtime, rights,
strategy economics or trading. No current readiness requirement is relaxed.

## Working-candidate evidence before final review

The grouped corrected working candidate passed all nine local checks: 1,763
worker/web tests, 18 server tests and 50 script tests; worker types, Go race/vet/
build, V2 build, offline smoke, complete import inventory and diff/status checks.
Twenty-eight unsupported legacy Windows tests were skipped, not certified.
Occupied-port/child-exit diagnostics are asserted negative controls, not operating
failures or a new service launch. A mechanical comparison confirms the moved
order component preserves every state/action/security branch apart from imports,
component name, height/scroll presentation and footer text. Worker/server/Go/
workflow/research-browser source boundaries are unchanged.

The built public home and recorded-result shell were inspected in an isolated
browser tab; `/orders` showed all execution controls disabled and no protected
response requested. At a 390px viewport the document width was 375px, with no
horizontal overflow. Full-page narrow screenshot capture was unavailable in the
local browser tool, so no pixel-level mobile acceptance is claimed. No installed
local Chrome/Edge/Playwright binary was available and none was downloaded; the
full authenticated G01/G03 and other exact-head hosted browser/scientific gates
remain pending, mandatory acceptance gates. The temporary unauthenticated web
child and browser tab were stopped/closed; no owner session or private data was
opened for this visual check. Final independent/adversarial source review,
exact-head verification and normal publication are not yet claimed.
