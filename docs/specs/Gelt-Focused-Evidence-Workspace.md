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
| REPLACE | Home is a static candidate/evidence → readiness → recorded-results guide. The previous protected order/status page moves to `/orders`, preserving its contracts and adding credential/current-response guards after review. `/simulation` mounts the existing protected viewer directly, with six local React-state buttons instead of terminal widgets/store/shortcuts. Global branding/navigation is Gelt. |
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
new declarations, package resurrection, shared-dependency deletion, coordinated
proof overrides (including inherited metadata) and corrupt removal provenance. No runtime reads the provenance document.

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
open a dialog. The retained protected-order browser helper follows `/orders`; it is not newly
claimed as a current hosted gate. G01 retains its actual owner-entry/research
coverage, and mandatory G03 adds the client credential-race regression. Research/history/scientific hosted gates remain required.

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
failures or a new service launch. At the initial fa8e7c8 candidate, a mechanical comparison confirmed the moved
order logic differed only in imports, component name and presentation. The
grouped review correction below adds UI privacy guards; that original comparison
is historical, not a claim that the final component has no behavioral change. Worker/server/Go/
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

## Grouped review correction

The first independent reviewer found one LOW group: five new import reasons
incorrectly attributed UI stripdown additions to M4. The completed same-original
adversarial review also found two MEDIUM groups. All were accepted and grouped:

- The inherited order/status page retained protected data and pending responses
  across credential edits. Credential restore/edit, navigation and teardown now
  invalidate a generation and abort owned reads where supported. Connection,
  order surface, Pi fixture, history and timeline clear together. Every protected
  async success, error and completion path checks captured request identity,
  generation and credential; older success/failure cannot repopulate data or clear
  newer busy state, including a token changed away and back. Abort is an
  optimization, never the correctness guard. No auth/BFF/worker policy changes.
- Lock reconstruction allowed coordinated proof fields to conceal a changed or
  deleted retained package. Root/web are now the only metadata override keys, with explicit own-key reconstruction;
  the exact approved 122-package removal-key set is independently hash-pinned in
  code. Prior full-lock reconstruction still binds record contents and retained
  resolutions. No package or resolution is changed by this correction.
- Only the five newly added stripdown reasons are corrected, plus accurate
  provenance for the new credential regression test. Historical attribution,
  upstream hashes, notices and previous review originals remain unchanged. The
  local inventory helper now uses a neutral owner-review placeholder for future
  additions, avoiding automatic false M4 attribution without rewriting old records.

Five real-component callback/state regressions and two coordinated-proof negative
controls failed against the uncorrected candidate. Corrected focused tests then
passed. Additional Pi preparation/review and old-completion/busy regressions cover
the same family. The deterministic component harness invokes actual page callbacks
but does not emulate DOM/effect scheduling. The mandatory G03 protected-browser regression
adds explicitly intercepted client-only status/history responses across an ABA
credential edit, removes those interceptions before its real recorded-fixture
reads, and verifies data clearing and disabled controls; it remains a mandatory
hosted gate, not a local browser pass. The original native review reader exception
and corrected same-ID completion are preserved separately; raw command bytes do
not establish outer-tool conformance, semantic attention or backend proof.

A fresh independent and distinct adversarial final pair must inspect this entire
resulting source revision and correction delta; no old approval carries forward.

The grouped working run also retained one unchanged candidate integration test's
five-second timeout; no deadline or assertion was increased. A focused retry
initially omitted the established TMPDIR=/var/tmp verification environment and
was rejected by the existing private-storage guard. Repeating that focused case
with the original environment passed in 3.36 seconds under the unchanged limit.
The complete required suite must still pass; neither the failed run nor the
isolated pass replaces full verification. These are synthetic test receipts,
not source effects, native qualification or permission changes.

The complete repeated local V2 suite passed with a two-worker process cap: all
1,772 worker/web, 18 server and 53 script tests, the same files/assertions and
unchanged per-test deadlines. Types, Go race/vet/build, V2 build, offline smoke,
import accounting and diff/status checks also passed. Two default-worker-pool
attempts of the unchanged integration test timed out; those failures remain
retained, not relabeled. The local cap bounds process concurrency only and does
not change test configuration, assertions or deadlines. Hosted CI's normal npm
test command is unchanged and must independently pass; local bounded success is
not a waiver of that gate. The precise host-contention cause is not established.

## Hosted route correction after source review

The first hosted PR run passed nominal V2 unit tests, build, offline smoke, Go
and scientific checks. History browser acceptance passed its ten protected
history stages, then failed while looking for disabled order controls on the
old `/` route. The controls now live on `/orders`. Its final navigation
is corrected to `/orders`. A bounded scan of the other browser consumers also
found the research test still expecting the old root heading after its Workspace
link. That expectation now matches the new evidence-home heading, preserving
the same root navigation, back-navigation and protected evidence clearing. All
control, disabled-capability, no-external-call,
private fixture and cleanup assertions and deadlines remain unchanged. The
failed hosted receipt is retained. This correction requires fresh independent
and adversarial review, exact-head verification and every normal hosted gate;
no rerun or prior source approval certifies the corrected head.
