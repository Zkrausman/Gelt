# ZAR-214: protected connection, never execution authority

Authority: [M3 specification](../../../docs/specs/ZAR-214-Protected-Account-Boundary.md),
[API](../../../v2/CONNECTION-API.md), [operations](../../../v2/CONNECTION-OPERATIONS.md).
Original ticket baseline is PR457 merge `a1498e3fc7394d4622a13236622aeb8b926e78f5`;
M2 upstream pin, MIT/lockfile/notices, V1 and archive identity remain unchanged.

- Worker alone owns OAuth S256 verifier/state, exchange/refresh tokens, MCP session
  headers, account routing identities and encrypted vault. BFF/browser never receive
  these secrets. Browser gets only opaque cookie/CSRF and validated official URL.
  No analysis DB, execution ledger, generic tool proxy, order/cancel/funding or Go
  fallback. MCP is a broker primitive boundary, not whole-application safety.
- Exact named connection routes use real one-hour owner sessions, Origin/Host/CSRF
  and a separate private BFF→worker service secret. Bootstrap is a short-lived
  CLI-provisioned private one-use grant, not an anonymous session endpoint. The
  supervisor uses a raw HTTP ingress gate **before Next adds forwarded headers**;
  it rejects caller forwarded headers and adds a server-only process proof. Bare
  next start/dev is not supported for this boundary. No reverse proxy/multi-instance.
- Secure/HttpOnly/SameSite=Lax loopback cookie is never downgraded. Browser acceptance
  on literal HTTP loopback is an explicit unproven compatibility limit; Node HTTP
  fixtures are not browser-login proof. Callback alone omits Origin/CSRF, still
  requires current cookie, fixed path/Host and one-use worker state binding.
- Pending flow has one slot, five-minute/session-bounded expiry. Consume bound state
  before exchange; use generation/credential identity checks after every async
  provider result. Serialized refresh/discovery plus synchronous atomic vault writes
  prevent disconnect from resurrecting stale credentials. Expired/error/restarted
  credentials cannot report connected until validated discovery. Disconnect clears
  local tokens/selection/pending state/browser session, not proven remote revocation.
- Secure storage is platform-dispatched. Linux retains AES-256-GCM, explicit
  separate random key, UID/mode/no-follow checks and file/directory fsync. Native
  Windows uses current-user DPAPI-wrapped keys and verified private NTFS DACLs,
  never chmod protection or Linux raw-key migration. Supported candidate: Windows
  11/Server2022+, Node22 x64, PowerShell5.1/.NET4.8, standard C:\Windows, trusted
  v2 checkout with packaged SHA-pinned helper. Real hosted Windows CI is a separate
  mandatory acceptance gate; Linux mocks are not native evidence.
- Every private config/service/grant/key/vault/lock/temp uses the same backing.
  New explicit application directories get protected descriptors at creation; no
  broad home/shared ACL repair. Windows helper retains ancestor handles without
  share-delete, verifies opened identity/NTFS/owner/ACL and rejects reparse,
  hardlinks, inherited private ACEs, unsafe ancestors and ambiguous/device/UNC/ADS
  paths. Same-user/admin/system compromise, malicious dependencies and snapshot
  rollback are excluded, as same-UID/root compromise is on Linux.
- Windows persistence is private same-directory WRITE_THROUGH creation, native
  flush and MoveFileEx replace/write-through, not POSIX directory fsync or a
  hardware power-loss guarantee. Persistent exclusive markers are never stolen;
  failed writes poison vault access and preserve ownership evidence across close
  and restart. Uncertain-state recovery requires stopped processes and explicit
  local clearing, not merely unlocking old ciphertext. Bootstrap compares under
  exclusive ownership and commits a consumed tombstone before issuing a session.
- Preparation accepts new public registration over bounded stdin and creates five
  explicit separate private directories. Fixed helper executable/scripts never
  receive secrets/storage paths in argv; request/output/time bounded, errors generic.
  Windows explicitly requires `GELT_WINDOWS_PRIVATE_PARENT` (canonical C: system
  volume ancestor, <=120 characters), never inherited TEMP/TMP/home discovery.
  Validate existing ancestors root-to-leaf before creating only a new random
  owner-private compilation directory; do not repair parent-directory ACLs. CodeDOM
  public-source compilation stays one-shot and scratch cleanup precedes success.
  Abrupt termination may leave private public-source scratch, not permission for
  broad cleanup. Per-operation 15-second deadlines remain unchanged.
  A four-byte big-endian byte length plus bounded strict UTF-8 frame replaces
  EOF-dependent TextReader reads; the fixed hash-pinned reader handles split input
  and is required to complete on open stdin (native acceptance remains required).
  Narrow LF rules keep packaged hashes byte-stable.
  Closed stage diagnostics distinguish framing/root/compilation/operation/cleanup
  without paths, requests or exceptions. Native success preflight measures stage
  elapsed time and exercises DPAPI/private filesystem operations, followed by full
  tests/build/smoke. Linux cannot certify native semantics; native evidence and
  timing must clear acceptance before any reuse design or lifecycle claims.
  Diagnosis brackets header/payload reads, UTF-8 decode, JSON parse and schema
  validation with fixed stage names; never report data lengths, request bytes,
  paths, environment or exceptions. Fixed synthetic write/pipe-completion/join
  timings distinguish JS scheduling from helper reads; a pipe write callback is
  not proof of native consumption. Compare identical closed/open/split-open frames
  in compiled direct Node22 and Vitest on Server2022; run both even when the first
  gate fails, and require real DPAPI plus private NTFS preflight and full security/
  build/smoke success. Neither framing stages, local other-version probes nor
  Linux tests establish the hosted root cause or native support. Do not guess a
  production transport fix or extend deadlines merely from a FRAME timeout.
  A FRAME marker precedes path construction/dot-sourcing/function entry/stdin
  opening/header allocation: absence of FRAME_HEADER is **pre-read** evidence,
  not evidence of a payload/EOF stall. Bracket each of those operations before
  and after. Independent hash-pinned native probes measure path construction,
  dot-source, OpenStandardInput on an empty open pipe, array construction, legacy
  Join-Path/New-Object autoload, fixed Utility import/JSON and Add-Type resolution.
  Run every probe in its own joined 15-second process in direct Node22 and Vitest;
  a failure cannot suppress the others or the real transport/DPAPI comparison.
  Production uses .NET Path.Combine/constructors/ordinal sorting rather than
  avoidable cmdlet autoload; disables module autoload and imports Utility by its
  fixed standard Windows manifest, qualifying JSON/Add-Type calls. The sole
  module search path is the fixed system PowerShell5.1 Modules directory, never
  inherited PSModulePath. Legacy diagnostic probes alone exercise autoload on
  that path. Those two unused autoload probes are bounded informational comparisons,
  not production prerequisites: report failures/timeouts without making them gates.
  Replacement .NET APIs, trusted explicit-import JSON/Add-Type and native enum-mask
  regressions remain mandatory in both direct Node and Vitest; production helper
  completion/DPAPI/NTFS failures always block acceptance. Numeric PowerShell masks
  on AceFlags require an explicit integer operand: `(([int]$ace.AceFlags) -band 8)`.
  Preserve InheritOnly mask 8 and unsafe-ancestor rights mask 0x500D0150; casting is
  type correctness, not a DACL relaxation. Native tests must cover ContainerInherit
  versus InheritOnly and real accepted/rejected ACLs past ROOT, not only a copied
  expression or Linux source checks.
  Add-Type resolution probes do not compile in ambient temp; actual
  compilation still requires validated private scratch. No OS/module cache/home
  discovery or extra user environment is authorized by a prerequisite failure.
  Only nonsecret required OS environment is forwarded, not PATH, credentials,
  proxies or NODE_OPTIONS. Cooperative IPC handles shutdown/parent disconnect and
  joins services; forced termination retains uncertain-state markers.
- Default startup stays offline. Explicit official-worker mode sends broker config
  only to worker, service config only to worker/BFF; market receives neither. Web
  and market retain offline TCP/DNS guards. Worker permits only fixed official
  token/MCP transport, verified TLS and no redirects; application guards are not
  firewalls. No public metadata or authenticated broker calls required by tests.
- Owner must provision a **new** public OAuth client with exact callback agreement;
  public metadata snapshot is not registration/authorization proof. No Pi import.
  MCP 2025-03-26 initialize/notification/tools-list/get_accounts only; bounded JSON
  or finite SSE, explicit empty-argument metadata. Unsupported schema/protocol/
  pagination is unavailable, never guessed REST behavior or general passthrough.
- Raw get_accounts normalization is separate from strict internal Account. Retained
  sanitized decoded evidence from 2026-09-18T03:17:46.356Z establishes `data.accounts`
  and mixed access, not raw MCP encoding/current access. Map type→cash,
  brokerage_account_type→individual, state→active, agentic_allowed→true and both
  deactivated/permanently_deactivated→false; only then derive internal eligibility.
  Never infer from nickname/default/guide. Unknown/missing policy excludes a record;
  malformed types, invalid supplied IDs and duplicates reject the whole response.
  Check duplicates in each ACCOUNT/RHS/RHC namespace before filtering. Missing/empty
  crypto IDs exclude non-crypto records while preserving usable neighbors. All
  three IDs remain required for selection; RHS is routing, not interchangeable RHC.
- Support bounded structured tool data or one JSON-text content block. If both are
  supplied they must agree deeply; reject errors/ambiguous envelopes/duplicate JSON
  keys/unsupported blocks. Safely bound and discard ordinary metadata and guide.
  Never pass raw IDs, funds or guidance to UI/logs. Connection independently checks
  normalized identity uniqueness and opaque handle collisions/reuse; rediscovery
  clears selection. Handle reservations live for the entire Connection instance,
  surviving rediscovery, failure and disconnect. The 10,000-reservation cap never
  evicts old handles; exhaustion clears credentials and requires owner worker
  restart. Restart restores no mapping and uses fresh cryptographic randomness.
  Offline actual-provider/Connection tests, not self-consistent
  normalized fixtures alone, establish the supported decoded-payload regression.
- Connected operation requires an owner-operated, explicitly provisioned Linux or supported native Windows
  runtime, with genuine final-head hosted acceptance on both platforms. OAuth registration acceptance, live wire compatibility and browser
  Secure-loopback-cookie compatibility remain unproven; not production readiness.
- Retain upstream 18 tests, worker/BFF/vault/race/import/lifecycle coverage and root
  Go 1.26.1 race/vet. Run checks sequentially (npm ci cannot race Go discovery).
  Local import updater preserves upstream hashes and refuses silently changing
  retained files. No dependency/lockfile upgrade. Generated artifacts and operational
  files stay outside committed inventory. Independent Review/Test evaluate the full
  original-baseline diff, not only remediation deltas; offline tests never prove
  live-provider access, browser compatibility, publication, CI or merge readiness.
