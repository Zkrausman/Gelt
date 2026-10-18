---
type: specification-closeout
title: Fixed SPY IEX one-shot acquisition command
date: 2026-10-18
repository_id: 1415613140
base_commit: 7cb34a2cbb37d7f8e75f51d33154106da12e5feb
status: source-review-candidate
actual_provider_access: false
---

# Fixed SPY IEX one-shot acquisition command

The delivered connector previously had no operator invocation. This change adds
one standalone, inert-on-import command around the existing credential reader
and connector. It changes exactly the command, its worker synthetic tests, this
specification and the V2 import manifest. No dependency, workflow, application
route, credential storage helper or connector policy changes.

## Frozen request and remaining authority

`node v2/scripts/alpaca-iex-acquire-once.mjs --describe` reports the fixed request
and its digest without importing the worker build, reading credentials or
requesting data. The finite window is 253 scheduled sessions from October 15,
2025 through October 16, 2026. The fixed GET is Alpaca `/v2/stocks/bars`, SPY,
IEX, USD, `1Day`, descending, `raw`, inclusive timestamps
`2025-10-15T04:00:00.000Z` through `2026-10-16T04:00:00.000Z`, and symbol mapping
`asof=2026-10-16`. Selection preceded acquisition or observed price results and
does not roll forward automatically. Raw prices are not adjusted total returns,
official primary-market closing auction prices or accepted strategy input.

The frozen calendar is a **proposal**, derived from the published NYSE 2025/2026
holiday schedule with November 28 and December 24, 2025 early core closes and
2026 IEX corroboration. `--describe` explicitly says calendar acceptance is false.
2025 IEX-specific historical corroboration and unexpected closure/completion
evidence remain unresolved. New York midnight provider timestamps and DST
offsets are frozen; completion uses the following New York midnight as a
conservative elapsed-day cutoff. This is not a provider promise of no subsequent
correction. An approval record must supply independently reviewed completion
evidence per session, not hashes generated to fill gaps. Local ordinals 0–252
describe this request window and do not supply G06 global runner ordinals.

Public references:

- [Alpaca historical bars](https://docs.alpaca.markets/us/reference/stockbars)
- [Alpaca aggregation FAQ](https://docs.alpaca.markets/us/docs/market-data-faq)
- [NYSE 2025/2026 schedule](https://ir.theice.com/press/news-details/2024/NYSE-Group-Announces-2025-2026-and-2027-Holiday-and-Early-Closings-Calendar/default.aspx)
- [IEX trading hours](https://www.iex.io/resources/trading/trading-hours-holidays)
- [Alpaca terms](https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf)

Source implementation approval authorizes no credential read or first connection.
Before an actual invocation, the operator/maintainer must resolve applicable
account/feed agreement and finite processing rights, complete calendar evidence,
and obtain action-time approval of the exact command bytes, record and private
credential directory. Public personal/noncommercial provisions do not establish
an account-specific retention entitlement. A paper key can also authenticate
paper trading operations; this command's fixed GET boundary is not a data-only
permission on that credential.

## Explicit local approval record

The acquisition invocation is deliberately incomplete until separately prepared:

```text
/usr/bin/env -i PATH=/usr/bin:/bin /ABSOLUTE/TRUSTED/NODE22 v2/scripts/alpaca-iex-acquire-once.mjs --acquire-once --data-dir ABSOLUTE_PRIVATE_DIRECTORY --approval-record ABSOLUTE_PRIVATE_RECORD
```

These are nonsecret paths. There are no symbol, endpoint, date, retry, credential,
provider fallback or output-file flags. Do not put secrets in arguments, shell
environment, pipes, records, logs or chat. The command supports Linux/trusted
Node 22 without extra Node flags. Acquisition permits only `PATH`, `LANG`,
`LC_ALL` and `TZ` environment names: use `/usr/bin/env -i PATH=/usr/bin:/bin`
with the exact trusted Node binary. Every other name is rejected before module
loading, approval processing or credential access, including TLS-verification,
custom-CA, OpenSSL, proxy, preload and diagnostic overrides. This prevents
inherited network settings from defeating fixed-endpoint authentication after
startup. **The external `env -i` invocation is mandatory before Node starts.**
`NODE_OPTIONS` preloads and loader flags execute before JavaScript can inspect
them; no in-process check can prevent a preload that has already executed. The
synthetic injected-environment cases prove the function's rejection ordering,
not safe Node startup. A trusted absolute `/usr/bin/env` and Node binary, clean
pre-Node environment, unchanged reviewed source/build and no hostile concurrent
artifact mutation are external launch prerequisites. Do not use a bare `node`
command, inherit the terminal environment, or claim the command establishes
trust in a preloaded/altered runtime. The maintainer owns verifying this exact
launch and native identities before requesting first-connection authority.
Its separately built modules resolve relative to the script, never the CWD.

Before any worker import, the command hashes a fixed 19-entry compiled ESM closure:
the four entry modules, private-files/windows-storage/storage-diagnostics, worker
package boundary, and the retained Zod 3.25.76 package/entry and complete V3 ESM
dependency closure. The literals were derived from this reviewed base using its
retained-lock compiler. Missing, altered, symbolic-link or oversized artifacts
fail before module import, approval-file processing or credential reads. Nested
worker dependency/package shadows and nested Zod package boundaries are refused.
No build/download is automatic. Updating a dependency/compiler or that runtime
closure requires a fresh reviewed source/digest change, not an approval-file
override. Node built-ins remain part of the externally trusted Node binary.
Hashing before imports is not an OS-enforced immutable snapshot: prevent hostile
concurrent writes in the trusted installation. No security-sensitive filesystem
permission change is performed or authorized by this command.

The bounded (256 KiB), single-link regular approval file must be owner-only
`0600` under an owner-only `0700` directory, with safe no-symlink ancestors.
The approval path must be outside the credential directory; pointing to the
credential file as an approval record is rejected before any file read.
It is strict duplicate-key-rejecting JSON with exactly these fields:

| Field | Meaning |
| --- | --- |
| `schema` | `gelt.alpaca-iex-acquire-once-approval.v1` |
| `repositoryId` | `1415613140` |
| `commandSha256` | SHA256 of the exact command source bytes |
| `requestSha256` | Digest printed by `--describe`; fixed request plus proposed schedule |
| `dataDirectory` | Exact separately approved private credential-directory path |
| `calendar` | Existing strict Alpaca session calendar, recomputed digest; exactly the 253 frozen timestamp/ordinal/completion rows, with real completion evidence references |
| `calendarEvidenceSha256` | Independently reviewed calendar/exception-evidence identity |
| `rightsEvidenceSha256` | Applicable account/feed rights evidence identity |
| `retentionEvidenceSha256` | Approved finite process-memory-only treatment evidence identity |
| `actionEvidenceSha256` | Exact separate one-invocation operator authorization evidence identity |
| `retention` | Literal `process_memory_only` |

No example with fabricated rights/completion hashes is supplied. The file binds
external evidence assertions and exact command/request/path; it is **not** a
signature, entitlement check or automated rights-admission service. A user who
can alter their own approval record/runtime can supply assertions; the operator
must independently review evidence rather than treating syntactic hashes as
proof. The software creates no approval, cache, reuse marker or persistent state.
One-shot means one connector call per process invocation, not durable prevention
of repeated manual invocations. A new provider invocation requires its own action
authority; the command never schedules or automatically retries one.

## Acquisition, failure and sanitized output

All gates and safe private-path checks precede the existing credential read. The
command first drains a constant notice and a queued-output-error checkpoint.
It performs exactly one existing helper read and connector call. The connector
allows at most three fixed-origin GETs (normally 100, 100 and 53 rows), ten seconds
and 512 KiB per page, redirects rejected and no retries. Short pages still consume
the three-page budget. Insufficient rows, unexpected token state, invalid numeric
tokens or response shape stop; no alternative request, account/auth probe,
subscription upgrade or trading endpoint is tried.

The original capture remains in the same process. Existing byte/token integrity
verification and exact full calendar timestamp matching must pass before the
sanitized summary. No normalizer, G05 decision/candidate, simulator or runner is
called. Summary fields are fixed status, SPY/IEX/1Day/raw identity, request and
calendar digests, counts, connector receipt time, no effects and no promotion.
No credentials, credential hashes, headers, prices, raw page bodies, response
errors, stack traces, cursor values or cursor-bearing URLs are displayed.

Market bytes remain in bounded process memory only, with references dropped at
completion; process exit is not a secure RAM-erasure guarantee. No data file,
report, telemetry, cache or persistent evidence store is written. Discarded raw
bytes cannot establish durable replay/market acceptance through a hash alone.
Any later prospective availability must be no earlier than actual acquisition;
historical bars are not claimed to have been known to a backdated decision.

Exit zero means `--describe` completed, or a bounded **unverified**, memory-only
capture was summarized. It never proves rights, entitlement, economic assumptions
or G05/G06/G07 acceptance. Failure exits nonzero with a constant diagnostic; no
raw thrown values are printed. After request start, failure reports acquisition
unavailable and instructs stop, without automatic retry/fallback. No key deletion,
regeneration, chmod or cleanup follows. Standalone stream error guards are local
to the command and set a nonzero exit; import installs no listeners. A finite
output checkpoint cannot guarantee that a later output error will not occur
after a request has already started.

## Verification and review record

The parent initially ran 44 new synthetic cases through the real existing connector
with injected fake transport; all passed. The final remediation adds 19 launch
environment cases (63 total), whose exact result is recorded in the review packet.
Coverage
includes three-page positive capture, fixed request identity, redaction, missing
and changed approval fields, calendar mismatch, unsupported runtime/launch,
provider denial/redirect/error, no retry, missing record, and output-error gate.
The initial check exposed string-versus-Buffer use of the strict existing JSON
parser; the command now passes original bytes. A subprocess assertion encountered
the local sandbox's `spawnSync EPERM`; it was removed from the unit suite and
direct standalone describe/import checks are separately recorded. No platform
failure is represented as a provider or product pass.

The first independent final review reported no blocker/high and public privacy
PASS. The distinct adversarial final review found HIGH inherited
`NODE_TLS_REJECT_UNAUTHORIZED` and related CA/proxy override acceptance. The
explicit environment allowlist and pre-credential rejection regressions resolve
that launch-boundary finding; fresh complete final reviews and verification
are required for the resulting four-file candidate. No previous clean review
is reused for changed source.

The original exact-head adversarial validator subsequently found HIGH missing
compiled/transitive runtime binding and an overstatement of pre-start preload
protection. The fixed 19-entry integrity table now executes before imports;
synthetic missing/changed/symlink/shadow/size cases verify that boundary. This
specification requires external clean-environment startup explicitly and does not
present injected environment tests as pre-start coverage. These changes require
the same original validator's fresh updated-head review before PR readiness.

Fresh independent and adversarial final review must cover all four changed files,
this closeout, named original connector/contract/parser/credential seams and exact
verification logs. Final review/CI/merge outcomes belong in exact-head delivery
receipts; this source snapshot does not claim they have already occurred. Normal
Go build/race/vet, Linux V2 build/tests/smoke, scientific and applicable protected
browser gates remain required. No genuine credential, provider or acquisition
operation was performed in source delivery.

The corrected runtime-binding candidate passed 74 synthetic cases. A direct
non-importing integrity check matched all 19 retained runtime artifacts. A benign
synthetic throwing preload supplied in the outer environment did not execute
when `/usr/bin/env -i` launched the trusted Node binary for `--describe`; it
returned only the static proposal summary. This verifies the documented external
launch pattern for that case, not an ability of JavaScript to undo preloads.
