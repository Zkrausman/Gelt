---
title: "🔒 Synthetic Robinhood Application Mock Rebuild"
status: source-candidate-awaiting-complete-review
source_base: 9debdf6d055137d4f4f6e0121bd5930a43e18755
contract: gelt.synthetic-robinhood-mock.v1
transport: loopback-http-json-application-protocol
live_orders: false
official_robinhood_wire_compatibility: false
automated_acceptance: authored-not-run
complete_source_review: pending
application_demo_integration: authored-not-run
manual_owner_acceptance: pending
headless_subscription_acceptance: pending
changed_files:
  - v2/worker/src/synthetic-order-harness.ts
  - v2/worker/src/synthetic-mock-robinhood-contract.ts
  - v2/worker/src/synthetic-mock-robinhood-storage.ts
  - v2/worker/src/synthetic-mock-robinhood-transport.ts
  - v2/worker/src/synthetic-mock-robinhood-adapter.ts
  - v2/worker/src/synthetic-mock-robinhood.test.ts
  - v2/scripts/synthetic-mock-acceptance.mjs
  - v2/IMPORT-MANIFEST.json
  - v2/worker/src/synthetic-browser-demo.ts
  - v2/worker/src/synthetic-browser-demo.test.ts
  - v2/scripts/synthetic-browser-demo.mjs
  - v2/docs/SYNTHETIC-BROWSER-DEMO.md
  - .github/workflows/v2.yml
  - docs/specs/Synthetic-Mock-Robinhood-Rebuild.md
---

# 🎯 What

This source candidate adds an explicitly enabled, offline application mock for tests of Gelt's existing order lifecycle. It binds only to IPv4 loopback on an ephemeral port, uses one operation scope per exact route, stores mock facts in a separate private SQLite file, and returns only versioned synthetic data. The mock is not an official Robinhood API/MCP implementation, a broker sandbox, a market-data service, a production order route, or trading evidence.

The fixed fixture uses instrument `SYNTH-RH-USD`, a named test quote and application-mock starting limit of `0.90 USD`, a named test fee of `0.01 USD`, BUY LIMIT, day time-in-force, one synthetic account, exact decimal strings, and a fee-inclusive maximum of `$10`. The quote and fee are fixture constants, not market facts. The browser demo injects one clock closure into the harness; session bounds, lifecycle expiry, mock store/adapter expiry, and fallback preview creation share it so fixed-clock boundary behavior remains deterministic.

The test-only harness flag `GELT_SYNTHETIC_MOCK_ROBINHOOD=offline-test-only` selects a second adapter/store/transport. Preview creation and durable admission are serialized before the preview is returned. Adapter state captures the prepared preview, terms hash, and confirmation token across the HTTP await. An expired unused preview or an exact, schema-valid confirmation whose matching token was conclusively rejected for a different valid terms hash can be retired before a new preview is created; malformed confirmations with extra fields do not retire pending state. Dispatch clears its one-use pending state before its first await, so an uncertain dispatch is never retired or retried. Confirmation consumes a random single-use admission in the same SQLite transaction that creates the mock order and first accepted event. Repeated identical dispatch IDs and payloads replay the existing mock order after expiry and reopen; changed payloads conflict without a second effect.

The mock database stores only token digests. Construction, reads, and writes perform bounded relational and policy replay; reads re-parse the stored preview and strict submit payload, recompute the digest from persisted bytes, verify consumed-admission/order/event relationships, replay ordered events, and compare the derived view with the stored projection. The mock projection decoder enforces its own 8192-byte limit, including valid projections above the shared ledger decoder's separate 4096-character limit. Event replay rejects settlement without cancel request and acknowledgement, and repeated execution IDs. The existing private SQLite ownership, marker, main-file, and sidecar checks run around each atomic access. Corruption, ownership loss, or uncertain persistence poison the handle and retain ownership. Expected duplicate-admission conflicts remain recoverable; storage failures poison the handle. There is no automatic dispatch retry, stale-marker takeover, uncertainty recovery, public fill route, or public cancellation-settlement route.

The mock transport accepts only exact admission, submission, read, and cancellation paths. Every request has fixed synthetic issuer, audience, principal, account, and operation-specific scope; it also checks the loopback peer, exact Host, bearer, absence of Origin/forwarding headers, JSON size, and method. A test-only response-loss hook closes the socket only after the submit transaction commits. Fixture-only fill and cancellation-settlement methods exercise cancellation acknowledgement and late-fill ordering without adding those operations to HTTP.

The existing test-only browser demo now has an additional explicit launcher flag,
`--application-mock-test-only`, which selects that harness mode only for the
disposable loopback demo. Its fixed `SYNTH-RH-USD` draft uses the mock's named
`0.90 USD` quote, starting limit and `0.01 USD` fee. The fallback starts at
`1.00 USD`. After explicit preview and confirmation, the
page can show lifecycle history and separately fetch the durable mock order by
the confirmed intent ID. The response is parsed against the mock order view
contract and labeled as synthetic application state, not official Robinhood/MCP
or broker evidence. The browser never receives a harness bearer/session. The
fallback demo remains the default. The browser has no scenario control; unknown
outcomes remain unresolved, and cancellation acknowledgement is distinct from
terminal cancellation. The launcher bounds graceful shutdown to five seconds
and retains the private fixture if close does not complete. Editing an admitted mock draft clears
confirmation consent while keeping its exact preview visible and reserved until
expiry. The bridge rejects replacement previews before that expiry without
clearing the stored preview; stale preview IDs or mismatched terms hashes cannot
consume a newer preview. A fresh preview can replace the expired admission. In
the fallback browser bridge, a confirmation attempt consumes the pending
preview even when its hash is wrong; application-mock stale attempts preserve
the current preview so its exact identity can still be confirmed. Public
synthetic history omits preview IDs, while the integration regression checks
the preview-to-intent binding in persisted test-only lifecycle events. The mock
browser draft starts at the fixed quote, while the fallback draft keeps its
existing 1.00 USD value. The internal bridge type includes the harness-only
`mock-history` call without adding it to the browser operation allowlist.

## 💡 Why

The source establishes a local application-level test boundary around the accepted order lifecycle. It keeps mock storage separate from lifecycle facts so the browser demonstration can compare lifecycle history with the independent durable mock projection. This remains an explicitly selected test-only local demonstration; it does not integrate with the production UI, service, provider, credentials, or subscription headless workflow. The mock does not gain authority over production state or claim behavior of a live provider.

## ✅ Verification

The opt-in source runner is `v2/scripts/synthetic-mock-acceptance.mjs`. After runtime admission, invoke it from `v2/` with Node 22 and the repository's locked dependencies:

```sh
node scripts/synthetic-mock-acceptance.mjs
```

The runner starts only the authored Vitest file with a sanitized test environment. It preserves the 15-minute run limit, terminates the POSIX process group with a bounded TERM/KILL and settlement sequence, reports when Windows descendant termination cannot be confirmed, and schedules a bounded parent exit if a child or descendant still holds the event loop. Its authored cases cover isolated wrong-bearer and wrong-scope rejection against an existing readable mock order with an authorized control, concurrent preview/admission and exact HTTP submissions, confirmations, deterministic fixed-clock expiry at the exact boundary followed by fresh preview and confirmation in both harness modes, expired unused and conclusively rejected preview retirement, malformed extra-field confirmation isolation across previews, idempotent exact replay after expiry and reopen, expected admission conflict versus injected persistence failure, consumed-admission corruption, coherent impossible-cancellation and duplicate-execution projection corruption, a valid 16-execution projection above 4096 characters, over-limit projection rejection, storage ownership loss, pre-header response loss and stable UNKNOWN/mock identity through two clean reopens and reconciliation, late fill after cancellation acknowledgement, payload corruption, bounded response bodies, abort/premature close, bounded runner exit, and the absolute client deadline despite regular response chunks.

Historical read-only probes recorded the presence and version of Node 22.23.3 and Go 1.26.1; those observations do not establish approval provenance. The prior focused mock acceptance passed 27/27 and was accepted for its exact prior source identity; it does not verify this successor integration.

A subsequent complete review reported three P2 source findings: the internal mock-history bridge operation needed its own type, the mock draft limit needed to match the fixed quote, and draft edits needed honest handling while an admission remained live. This checkpoint records those source corrections and regressions.

The next complete review of the P2.1 integration identified two additional repair
items. Internal browser-demo forwarding now has one exactly-once settlement path,
rejects and destroys oversized responses, handles request/response errors,
aborts and premature closes, and applies an absolute deadline even while response
bytes continue to arrive. The mock projection replay now validates the stored
preview against the first accepted-event timestamp, including the exact expiry
boundary. Regressions are authored for overflow, abort-after-headers, request and
response errors, premature close, continuous response trickle, and accepted-event
timestamps at and after expiry. Existing identical replay after expiry remains
covered. These regressions are authored but were not run; UNKNOWN outcomes and
the no-confirmation-retry behavior were not changed.

The original P2.1 donor snapshot records historical V2 import accounting of
441 concrete path rows: 430 unchanged, five updated, and six new. Its raw JSON
had 447 rows: 436 unchanged, five updated, and six new; the 436 unchanged raw
rows included six pathless upstream omissions. These donor counts describe the
pre-integration snapshot only. The integrated current-master/G01/G02 candidate
has 452 manifest rows, including 446 concrete path rows. The manifest has a
self-row exempt from self-hashing. The M1 root specification
`docs/specs/ZAR-231-Research-Evidence-Read-View.md` remains preserved separately,
outside this V2 accounting. Earlier receipts remain unchanged.

For the application-demo integration and these corrections, no tests,
typecheck, build, application runtime, validator, or browser campaign was run.
The integration regression is authored but unexecuted. A fresh complete source
and evidence review is required for this successor identity.

### Windows CI follow-up (2026-10-12)

The native Windows run on PR head `ee30b792afe2e8026b50d47bb66a19bd054c1f67`
reproduced the concurrent loopback submission failure in the opt-in fixture.
The prior run's retained trace identifies the client's hard five-second request
deadline as the failure path. The focused concurrency case now uses a bounded
30-second test-only client while the default remains five seconds; the separate
continuous-response regression still verifies the default absolute five-second
deadline. The timeout override requires the existing test-only mock gate and
cannot be selected outside that mode. The integration assertions, loopback
binding, request authentication, storage ownership checks, and cleanup are
unchanged.

The same Windows run reached the 60-minute job deadline while Vitest remained
incomplete, before build and smoke. The native job remains serial and retains all
suite steps and operation deadlines; its job cap is 90 minutes to allow the
complete test, build, and smoke sequence. Successor-candidate local package tests
and hosted CI results remain pending at this specification revision.

### Import manifest follow-up (2026-10-12)

The original auditor found two stale import hashes on candidate
`f173c62b51108f2f928239edbcf553448ccf3da7`: the synthetic transport and its test.
Their `v2/IMPORT-MANIFEST.json` entries now match the exact file bytes. The
manifest verifier remains unchanged; upstream pins, path accounting, dependency
versions, and runtime safety gates are preserved. The pure import verifier and
whitespace check pass locally. Fresh independent and adversarial acceptance of
this corrected candidate and required hosted CI remain pending; the earlier
privacy PASS does not establish runtime acceptance.

## ✨ Result

The application-mock browser integration is authored and awaits review. Runtime
admission for this integration, actual-browser checks, Windows-native checks,
owner-manual acceptance, and subscription-backed headless acceptance remain
separate gates. No Gelt trial points are claimed or reallocated by this rebuild.

## Changed files

The source changes include the mock contract, independent storage, loopback transport, test adapter, existing test-only harness selection, focused regressions, opt-in browser demo mode, launcher and cleanup, V2 import accounting, and the specifications. The native Windows workflow timeout was raised from 60 to 90 minutes after the prior run reached its one-hour limit with tests incomplete; the existing tests, build, and smoke gates remain required. No production lifecycle/service/provider/BFF/UI, research parser/store, companion package, credential/configuration, or dependency file is changed.
