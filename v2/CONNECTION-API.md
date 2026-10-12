# Protected connection API v1 (M3)

Authority: [ZAR-214 specification](../docs/specs/ZAR-214-Protected-Account-Boundary.md).
Implementation is an **offline-tested API**, not demonstrated live Robinhood
interoperability. Execution, public ledger writes, order/cancel/exercise/funding and arbitrary
MCP forwarding remain absent. MCP is not responsible for application safeguards.

## Browser boundary

Supported entrypoint is the supervisor and `scripts/web.mjs`, **not** `next start`
or `next dev` alone. Literal `http://127.0.0.1:3000`, single owner, single Next
process; no reverse proxy, forwarded-header trust, multi-instance or remote access.
Raw ingress rejects any `Forwarded`, `X-Forwarded-*`, `X-Gelt-Ingress` or wrong Host
before Next sees the request. A process-random server-only ingress proof then lets
the route distinguish Next-generated forwarding headers from caller input. Next
synthesizes `request.url` with localhost; it is **not** the authority check. Exact
raw Host plus ingress proof and exact browser Origin are the authority checks.

All operations below use `/api/connection/<operation>`, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, no CORS. Except callback, method is **POST**, exact
`Origin: http://127.0.0.1:3000`, `Content-Type: application/json`, ≤4096 bytes in
≤3 seconds. Authenticated requests require the opaque `__Host-gelt` cookie and
`X-Gelt-CSRF`. Cookie is Secure, HttpOnly, SameSite=Lax, Path=/, one-hour expiry;
server state also expires after one hour and is lost on restart. Bootstrap rotates
it. Lax permits official top-level callback GET; no other Origin/CSRF exemption.
Secure cookies are never downgraded. Browser support for Secure cookies on literal
HTTP loopback on either supported OS must be established by the operator; browsers that refuse them
cannot connect. HTTP is not TLS confidentiality. No universal browser
support or live login is claimed by Node HTTP smoke tests.

| Operation | Input | Success |
| --- | --- | --- |
| `bootstrap` | `{bootstrap: <43-char base64url owner grant>}` | `{version:"v1",csrf:<opaque>}` + cookie; exact Origin/JSON prevents login-CSRF; protected disk grant consumed once before session creation |
| `status` | `{}` | Status below; never performs broker calls or automatic refresh |
| `initiate` | `{}` | `{version:"v1",authorizationUrl:<fixed official OAuth URL>}`; worker owns verifier; requires disconnected state |
| `callback` | **GET** `?state=...&code=...` or `?state=...&error=...` | Always clean 303 `/connect` after authorized callback processing/error; never echoes query; requires current cookie/Host/ingress, not Origin/CSRF |
| `discover` | `{}` | Status after validated named `get_accounts`; refreshes only when required |
| `select` | `{account:<opaque discovery handle>}` | Status; only a current eligible discovered handle is valid |
| `disconnect` | `{}` | Disconnected Status only after durable local clear; clears browser session cookie; no remote-revocation promise |

### Protected read-only ledger history

The same BFF also exposes only two named, authenticated POST reads:
`/api/connection/history` accepts `{after,limit}` and
`/api/connection/intent` accepts `{intentId,after,limit}`. Both retain the exact
Origin/Host/ingress, owner session, CSRF, JSON bounds, no-store and private
worker-service checks above. They never accept an account ID or arbitrary query.
The worker resolves the currently selected, freshly discovered M3 handle to its
in-memory validated ACCOUNT/RHS/RHC identities, then calls the owner-bound ledger
`history`, `getIntent` and `timeline` contracts. No selected account, changed route,
missing record or unavailable/corrupt ledger fails closed; an authorized empty
history is an explicit empty list. Routing sent to the browser is masked.

Responses preserve stored exact-decimal text, distinguish requested from each
observed execution, omit unsupplied fees and return timeline events in storage
sequence (timestamps may be late). Acknowledgement/request/reconciliation is not a
fill; a cancellation cannot establish that no later execution exists. No candle
feed is currently connected, so history displays an explicit unsupported chart
fallback and retains the timeline. Any future overlay must provide independently
verified source, matching instrument, exact quote-currency and compatible event-time
evidence; USD and USDT are never aliases. These are read-only APIs, not dispatch,
ledger-write, broker or generic-proxy authority.

### Order-surface status only (ZAR-219 candidate)

The same protected BFF exposes `POST /api/connection/order-status` with `{}`.
It forwards only to private worker `POST /v1/orders/status`; no browser-supplied
account or arbitrary operation is accepted. Both boundaries apply the session,
Origin/Host/CSRF or worker-service checks and closed JSON validation. The response
is exactly `{version:"v1",mode:"disabled",execution:false,preview:false,
confirmation:false,dispatch:false,cancellation:false,reconciliation:false,
reason:"production_adapter_unsupported"}`. It is a read-only capability result,
not an order operation. There are no preview, confirmation, dispatch, cancel or
reconciliation routes; the M5 `OrderLifecycle` is still not runtime-wired. The UI
must keep those controls unavailable. An absent BFF/worker configuration fails
closed rather than substituting fixture values.

Bootstrap has no anonymous grant-generating endpoint. The owner reads a one-use
private file generated by CLI and pastes it into `/connect`. Browser storage may
contain only opaque session/CSRF (the minimum control page keeps CSRF in tab
sessionStorage); never a service secret, PKCE verifier, broker token or MCP session.
After callback use “Restore tab CSRF”, then status/discover. Selection is published
as API for M6, not a completed connection-card UI. Authentication failure: 401;
wrong Origin/Host/CSRF/service boundary: 403; unknown operation: 404; wrong method:
405; invalid query/media: 400; missing BFF configuration: 503; invalid closed body,
provider/storage/setup failure: 409 `connection_unavailable`. JSON errors include
`version:"v1"` and a bounded generic `error`, never raw exception/schema issues.
Non-connection catch-all APIs retain the M2 503 contract.

## Status and lifecycle

Closed runtime schema (`worker/src/connection-contract.ts`):

```
{ version: "v1", state: "disconnected" | "authorizing" | "connected" | "unavailable",
  reason: "offline" | "setup_required" | "authorization_pending" |
          "not_connected" | "provider_failure" | "ready",
  expiresAt: <epoch milliseconds or null>,
  accounts: [{handle: <43-char base64url>, label: "Account ••••<last <=4>"}],
  selected: <handle or null>, execution: false }
```

Connected requires an unexpired token AND successful validated account discovery;
it does not mean authorized to trade, selected, sufficient balance or live-provider
proof. All other states expose no accounts, selection or expiry. Restart restores
validated encrypted tokens but **not** connected/account/selection state; explicit
discover is required. Expiry immediately hides connected state. No background
refresh. Discover serializes refresh and discovery, refreshes within 30 seconds of
expiry, rotates credentials durably before use and replaces selection handles on
every discovery. Provider/validation/persistence errors latch unavailable, clear
in-memory actionable state and attempt durable token clearing. Recovery requires a
successful local disconnect, then fresh authorization (handle-capacity exhaustion
also requires worker restart, as described below). Vault clear failure cannot
acknowledge disconnect. Offline status remains disconnected without secrets.

Only one five-minute pending authorization exists. It is bound to cryptographic
state, S256 verifier, fixed registered redirect, application session and generation;
its expiry cannot exceed app-session expiry. Correctly bound state is consumed
before token exchange, including provider-denied callbacks. Wrong session/state
cannot consume another browser's transaction. Replay/malformed/expired callbacks
cannot exchange. Disconnect immediately increments generation and clears pending,
account and selected state; stale callback/refresh/discovery cannot write credentials
or resurrect connected state. All credential commits/clear are synchronous atomic
vault operations after generation/identity checks. No broker mutation retries.

## Private worker boundary

Only BFF sends `POST /v1/connection/{status,initiate,callback,discover,select,disconnect}`
and the narrowly named read-only `POST /v1/orders/status` (empty JSON body), with
separate `Authorization: Bearer <random service secret>`, opaque
`X-Gelt-Session`, bounded `X-Gelt-Session-Expires`, exact worker Host, JSON and
Content-Length ≤4096. No Origin or forwarded headers. Worker independently checks
all of these. No generic name+args, arbitrary URL, account-number input, Go fallback
or unauthenticated tool route exists. Health/capabilities remain public, contain
no account data, and distinguish unconfigured/protected setup with execution false.
Provider output is never passed through: worker and BFF both validate closed
success schemas. Private service errors are generic and not relayed by the BFF.

## Official transport and supported adapter

Owner-provisioned public OAuth client registration only (no client secret, installed
credential search or dynamic-registration request). Config must exactly match the
public ticket snapshot: issuer/resource `https://agent.robinhood.com/mcp/trading`,
authorization `https://robinhood.com/oauth`, token
`https://api.robinhood.com/oauth2/token/`, scope `internal`, S256, auth method `none`,
fixed callback above. Snapshot validation does not prove registration. Owner must
obtain a new authorized registration/redirect agreement; never reuse Pi material.
No discovery/registration-provided arbitrary URL can receive secrets. Scope internal
is server-advertised, not a least-privilege claim; local tool denial is mandatory.

Token exchange/refresh: fixed token endpoint, resource indicator, redirect:error,
10-second abort including response body, JSON ≤32KiB, Bearer type, expiry integer
1..86400 seconds, required initial refresh token. Refresh may retain existing
refresh token when no replacement is returned. Unsupported fields/forms fail closed.

MCP: fixed trading endpoint, protocol **2025-03-26**, initialize and initialized
notification, private validated MCP session header, tools/list then only
`tools/call {name:"get_accounts",arguments:{}}`. Tool metadata must explicitly
advertise an empty object argument schema. Retained historical metadata described input `{}`; runtime metadata must still
confirm the supported empty arguments. JSON-RPC IDs/results validated; errors rejected;
JSON or a finite single-message SSE body ≤128KiB, 10-second request deadline.
Pagination, other protocol versions, long-lived/resumable SSE, server requests,
nonempty/unknown argument schemas and unsupported response forms are unavailable.
Each discovery establishes a new MCP session; no remote session deletion/revocation
is asserted. No token is sent to the authorization-page origin by the worker.

### Evidence-backed raw account boundary

`worker/src/account-adapter.ts` separates the provider payload from strict internal
Account. Retained decoded observation (2026-09-18T03:17:46.356Z; see
[fixture provenance](worker/src/fixtures/README.md)) is `{data:{accounts:[...]},guide}`.
It does **not** establish a raw MCP wrapper or protocol version. Offline transport
supports structuredContent and/or exactly one JSON-text content block containing
that payload. Both representations, if present, must independently validate and
be deeply equal (object key order irrelevant; differences even in discarded guide
are rejected). Empty content alongside structured data is allowed. Tool errors,
unknown envelope fields, duplicate JSON keys, unsupported blocks, malformed JSON,
multiple text blocks and conflicts fail closed. Guide is bounded untrusted data,
never instructions. No fallback parsing guide or invoking other tools.

| Raw provider field | Selectable requirement / internal mapping |
| --- | --- |
| `type` | `cash` → `account_type:cash` |
| `brokerage_account_type` | `individual` → `ownership:individual` |
| `state` | `active` → `status:active` |
| `agentic_allowed` | exactly true → `agent_accessible:true` (caller-relative) |
| `deactivated`, `permanently_deactivated` | both explicitly false |
| three identifiers | preserve `account_number`, `rhs_account_number`, `rhc_account_number` separately |

Internal `eligible:true` is computed only when **all** local requirements above
hold. Invented internal keys are never required raw fields or accepted authority.
Nickname, is_default, funds, option level and ordinary irrelevant metadata neither
grant access nor leave the worker. Safely bounded JSON metadata is discarded:
≤12 nesting levels, ≤8192 nodes, strings ≤16Ki characters, keys ≤256 characters,
no prototype-like keys; transport ≤128KiB. Guide is optional bounded text. Envelope
and data keys are closed; account metadata is extensible within these bounds.

Lists have at most 100 raw records. Missing/unknown/disallowed policy strings,
missing safety flags or false access/deactivated records are excluded; wrongly
typed policy/flags reject the **whole** response. This is local fail-closed policy,
not a claim of a complete provider enum/requiredness specification. Valid supplied
IDs must be alphanumeric 1..64 characters. ACCOUNT is required; absent/empty RHS
or RHC excludes that non-crypto record without poisoning valid neighbors. Invalid
supplied IDs and duplicates in any of the three separate identifier namespaces
reject the response **before** filtering; filtering cannot hide ambiguous routing.
Empty/all-excluded lists remain unavailable. RHS is crypto routing identity, never
substituted with RHC. All three remain required for selectable accounts.

Connection independently validates the normalized response, rejects duplicate
identities and handle collisions/reuse, and atomically replaces handles/clears
selection after successful discovery. Handle reservations survive every discovery,
failure and disconnect for the lifetime of the worker's Connection instance; no
older handle may be reassigned to another account. Reservations (including partial
failed allocations) are bounded at 10,000 without eviction. Exhaustion fails closed,
clears credentials/selection and requires owner worker restart, not disconnect,
to recover capacity. Restart uses fresh cryptographic random handles and requires
fresh discovery; no handles or account mappings are restored from the vault.
Only opaque handles and a masked RHC suffix leave the worker. Selection grants no trading authority or instrument eligibility.
Offline compatibility success does not establish live authorization/interoperability.

## Platform-private persistence

The API/security contract is identical on Linux and native Windows. Linux keeps
UID/mode/no-follow and file/directory fsync. Windows uses current-user DPAPI-wrapped
keys, verified private NTFS descriptors on every configuration/grant/vault path,
handle-retained ancestor checks and native flush/write-through replacement; never
chmod as ACL protection. See operations for exact OS/prerequisite/threat limits.
Bootstrap is durably consumed under exclusive ownership before a session exists;
Windows retains a consumed tombstone. Failed persistence poisons the vault and
retains its writer marker even on graceful shutdown; restart refuses ownership
rather than resurrecting old credentials. Explicit offline clearing/reprovisioning,
not automatic retries or migration, recovers uncertain state. Native hosted tests
remain pending; API fixtures do not establish Windows acceptance or live OAuth.

Native helper correction does not change browser/worker API shapes or authentication.
Windows now requires explicit nonsecret `GELT_WINDOWS_PRIVATE_PARENT` on the fixed
C: system volume for validated new compilation scratch, never inherited TEMP/TMP.
Requests are bounded length-framed binary stdin, not EOF-dependent text. Internal
closed stage codes cannot flow into public errors. See operations for prerequisites
and synthetic native preflight; the prior hosted failure is not native acceptance,
and corrected Windows tests/build/smoke remain pending.

The subsequent published framing candidate also failed hosted preflight at FRAME;
Windows acceptance remains pending. The diagnostic candidate adds closed internal
header/payload/UTF-8/JSON/schema stages and compares identical synthetic closed,
open and split-open requests under compiled direct Node22 and Vitest. This changes
no public response/error or security contract. Neither diagnostic timing nor
Linux success is real DPAPI/private-NTFS acceptance; both native probes, full
security suites and built smoke must pass on the final hosted head.

### Prior pre-header Windows prerequisite correction (historical evidence)

Parent-supplied hosted run **35370708125 / job 105683722277** failed both direct
Node22 and Vitest at FRAME, with **no FRAME_HEADER**, in all three pipe modes.
FRAME precedes path construction, dot-source, stdin opening and allocation;
this is not evidence of an EOF/payload-read failure. Current diagnostics bracket
all these pre-read operations and independently probe fixed .NET calls, legacy
Join-Path/New-Object autoload, trusted Utility import/JSON and Add-Type resolution.
Each probe uses the production restricted environment, fixed reviewed/hash-pinned
script, empty open stdin, bounded output, unchanged 15-second deadline and joined
cleanup. Both direct and Vitest gates attempt every probe even after failures.

Production removes avoidable cmdlet autoload using .NET constructors/Path.Combine/
ordinal sorting, disables module autoload and imports the standard system Utility
manifest by absolute path; JSON/Add-Type calls are module-qualified. PSModulePath
is fixed to `C:\Windows\System32\WindowsPowerShell\v1.0\Modules`, never inherited.
No other environment, credential, cache/profile discovery, insecure fallback or
ACL repair is added. Add-Type probing resolves only; real compilation still needs
validated private scratch. No public API, storage/DPAPI/NTFS, service-role or
security contract changes. Linux checks cannot prove this correction: exact-head
Windows real DPAPI/ACL preflight, full tests/build/smoke remain a required parent
CI gate. PR458 remains a draft diagnostic candidate, not accepted native support.

### ROOT enum-mask correction (native acceptance pending)

Parent-reported native **35373683086 / job 105693300572** now reaches ROOT in
about 350ms for all closed/open/split-open frames: the former transport stall is
resolved by .NET replacements and trusted explicit imports. Legacy Join-Path and
New-Object autoload comparisons still time out at BEFORE; explicitly imported
JSON/Add-Type probes pass. These two unused autoload probes remain bounded,
sanitized diagnostic comparisons, **not production prerequisites**. Replacement
APIs, explicit imports, enum masks and real production DPAPI/NTFS operations must
pass both direct Node and Vitest gates. No deadline increase or blanket skip.

Parent's synthetic PowerShell5.1 reproduction identifies the actual ROOT failure:
`$ace.AceFlags -band 8` throws `Specified cast is not valid.` The corrected helper
uses `(([int]$ace.AceFlags) -band 8)`, retaining exactly InheritOnly mask 8 and
unsafe-access mask 0x500D0150. Other shipped PowerShell masks use like-typed
FileAttributes operands or integer access rights. Hash pins update with source;
no ACL repair/relaxation, crypto/environment fallback or public API change.
Native regressions require enum-mask correctness, accepted owner-private and
inherit-only ancestor ACLs, rejection of applicable untrusted rights, and actual
helper completion through cleanup. Existing encrypted restart/clear, provisioning,
BFF/bootstrap/private-worker and built lifecycle tests remain mandatory.

This supplied evidence establishes a concrete type defect, not final Windows
success. Linux verification cannot execute DPAPI/NTFS/PowerShell. Parent-owned
published exact-head Windows tests/build/smoke and Linux CI, plus fresh independent
and adversarial review, are still required before PR458 leaves draft. No live
OAuth/browser/broker acceptance, merge or deployment is claimed.

## M4 internal ledger boundary

[Ledger API v1](LEDGER-API.md) is worker-local, not a connection/BFF route.
Configured capabilities may now report `ledger:true` only while the owned handle
is available; `execution:false` and all M3 authentication rules remain unchanged.
No connection operation implicitly records orders, invokes ledger writes or
converts account selection into a broker action.
