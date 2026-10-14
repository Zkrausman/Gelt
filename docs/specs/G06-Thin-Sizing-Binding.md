---
type: specification-closeout
title: G06 constructed offline sizing-to-simulator binding
status: candidate-awaiting-complete-source-reviews-and-exact-source-checks
date: 2026-10-14
---

# Constructed binding

The owner explicitly approved implementing this connection, its tests and normal
PR delivery (approval Sentinel_5a425dc82a80819193f2e4ab989ca53f). Both original
reviewers passed frozen contract revision3 SHA256
`74f55671b14e1247801dc559ba239380b3c1f9e29b360235f73aad33b4cb465a`:
independent `01a13c05-e977-71f4-9616-c3417116cf97`, adversarial
`01a13c06-0077-7463-ab6a-1478ad56e9a3`. This later owner approval supersedes
the immutable contract's earlier implementation-authority stop. The ten-path
scope remains constructed offline binding only, with no market-data retrieval,
terms acceptance, genuine-run admission, provider/inference, scheduler, live
account, public order route, G07 controls or promotion authority.

Configured fixtures can explicitly choose sizing-bound mode instead of the old
direction-only callback. The persisted closed policy binds run/source/config,
helper policy ID, quantum and both limits. The owned clock supplies evaluation
time and the lifecycle supplies disposition; producer callbacks receive defensive
copies and supply actual G05 bytes/receipt plus a separate observation. The
coordinator builds a full helper input, generates/replays the proposal, and
constructs exactly its side, full quantity and selected limit. The adapter
replays the pinned whole input/proposal and rejects substituted terms or changed
current snapshot, policy, config, observation age or expiry. It never re-evaluates
a stale proposal with new time/inputs. Default v1 and unsized v2 behavior stays
available; caller-quantity HTTP previews cannot bypass bound construction.

The lifecycle's existing exclusive queue stays held through preparation,
preview and asynchronous mock admission. A generation/account lease rejects all
unresolved work before claim and is invalidated synchronously by halt. After
confirmation creates its own exact durable claim, only a private lifecycle-minted
one-use permit can recognize that claim. The synthetic facts owner proves the
full expected projection and absence of all other open work through bounded
transaction-local replay. Forged, cloned, prior, changed or halted permits reject.
Before submit, the adapter checks current binding/freshness and consumes the
permit exactly once. Confirmation distinguishes unconsumed pre-submit failure
from consumed invocation; it does not rely solely on the legacy dispatchStarted
flag. A failed pre-submit claim remains unresolved; a submitted response loss
retains actual UNKNOWN. Halt cannot revoke an already invoked effect. No
cross-database transaction or automatic retry/reissue is claimed.

Optional closed version1 sizingEvidence metadata extends configured v2 previews
and derived order views. Admission atomically persists its compact link in the
existing preview JSON; submit persists the same preview with dispatch identity.
The existing database schema/user_version, single connection, writer ownership,
WAL/FULL, poison rules, caps and decision tombstones are retained. Old v1/v2 rows
reopen without invented sizing fields. Bound policy presence prevents silent
legacy downgrade or conversion of an existing unbound database.

The existing mock owner writes full canonical input/proposal/manifest files beside
its private DB. Files have fixed or digest names, mode0600 under mode0700
directories, no symlinks/hardlinked files or arbitrary caller paths. Metadata
size/count guards precede bounded reads: input262144 bytes, other files8192,
at most1000 artifacts/orphans and aggregate8388608 bytes. The unchanged harness
4KiB and mock8KiB interfaces carry compact links only. Full replay inputs never
cross those HTTP boundaries. Policy and replay files are immutable and read/hash/
helper-replay checked on admission, submit, reads and reopen.

New root publication syncs its parent. Policy syncs its staging file and root,
renames then syncs the root again. Artifacts sync all files and the staging
directory, atomically rename the complete directory, then sync the evidence root.
Admission follows only after success. Uncertain persistence/corruption fences and
preserves ownership; published orphans and unused/expired admission evidence are
retained, not deleted to regain capacity. Lost admission responses yield no
usable dispatch authority even if the store committed. Invalid/missing/malformed
input is sanitized response-only, with no rejected raw bytes/digests or pretend
validated artifact. Valid no_action/abstain can retain full replay evidence but
creates no admission/order. Evidence excludes raw tokens/cookies/CSRF/handles;
test assertions report booleans rather than printing generated capabilities.

Sizing-bound reopen is read-only: durable facts and replay links remain inspectable
but volatile prepared/pending authority is not restored, and resume/admission/
confirmation/order mutation are rejected. Evidence replay cannot authenticate
external provenance, resolve lifecycle UNKNOWN or resume a runner.

Changed files are the lifecycle, harness, mock adapter/contract/storage/transport;
new synthetic-sizing-binding-evidence.ts and synthetic-sizing-binding.test.ts;
the complete V2 import inventory; and this report. G05, the accepted pure sizing
helper, simulation economics, dependencies/workflows, existing tests and UI/BFF/
bootstrap/provider files are unchanged. Constructed native-store/transport cases
cover actual rule sizing, entry/whole exit, observed fills, duplicates, current
binding/freshness, loss before/after invocation, no-effect results, generation
invalidation, evidence durability/corruption/capacity and read-only reopen.
Separate in-memory lifecycle cases challenge exact own-claim permits and other
owner open work; they are component tests, not genuine execution evidence.

Local dependencies remain absent. No local runtime tests, held listener/ownership/
cleanup/native/MCP/model probes, installation, data access or CI reruns have been
performed. Static inventory/whitespace evidence and complete fresh source reviews
precede normal exact-head Go/Linux/scientific/protected-browser checks, ordinary
PR/merge and separate integrated verification. Exact results will be recorded in
the delivery PR and receipt; no test pass is claimed by this source-stage report.
Genuine dataset/rights/availability/calibration/control/schedule/mapping and
prospective producer/runner admission remain separate prerequisites. G07 is not
implemented or accepted by this constructed binding.


The first complete independent source review held candidate bc130377 with two
high findings and one medium finding (turn01a13c24-8e9a-7632-96a4-94d56b551fb7).
Actionable lifecycle orders incorrectly included mock-only type/timeInForce
fields; the constructed order and permit fixture now use only the retained strict
lifecycle shape. Mock previews still carry their separate LIMIT/DAY fields.
Permit assertions now require the complete actual dispatch arguments as well as
sizing identity: dispatchId, full intent/owner/account/routing/order, fee/currency,
preview terms/hash/expiry must match the privately minted claim. The adapter
snapshots these values before awaits and validates them before one-use consumption;
new substitution cases retain a genuine permit while altering actual arguments.
Confirmation also samples safe current time and checks expiry after pre-claim
await and before any durable intent write; its new case keeps observation freshness
valid so expiry rejection is tested independently. These are source corrections,
not runtime pass claims. The stale adversarial G05 result is excluded from binding
acceptance. Both complete fresh source reviews remain required on the corrected
head; no test, CI or publication has occurred.

The corrected adversarial review of frozen bc130377 returned no blocker/high
findings (turn01a13c29-19ec-77db-ae17-e514c18ca86b). That historical result does
not override the independent HOLD or accept this corrected source. All three
independent findings are consolidated; both fresh complete reviews must decide
the resulting exact head before any runtime/publication gate.


The next independent complete review held source236879 on current writer
validation for filesystem evidence preparation (turn01a13c36-373e-70d0-9926-
eb5721001f6d); the three earlier fixes were verified. Evidence preparation now
calls the existing native ownership/database identity validation before mutation
and in a finally block after success, rejection or uncertainty. Validation failure
poisons the owner and does not remove or recreate its marker. Ordinary prewrite
capacity rejection remains distinct; complete/orphan replay artifacts remain
retained. New constructed regression source covers removed/mismatched markers
for both proposals and valid no_action evidence, plus ownership loss immediately
after durable artifact publication: no admission/usable authority is produced,
and the published orphan is retained. These tests have not run. Complete fresh
reviews on the eventual consolidated head still precede runtime/publication.

The complete adversarial source review of frozen236879 reported no blocker/high
findings (turn01a13c37-043d-7001-819a-baf45c62d572). It remains historical
acceptance of that source and cannot clear the current-ownership correction.
Both full fresh source reviews must identify the next exact head.
