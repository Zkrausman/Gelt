---
type: completion_report
title: Offline startup notification isolation
---

# Offline startup notification isolation

Importing `pkg/notify` creates the default dispatcher and its existing worker without loading notification configuration. The worker resolves the default endpoint when it takes the first actual payload from the queue. This intentionally moves the configuration snapshot from startup to the first notification; later environment or file changes do not refresh it. `SetEndpoint` explicitly overrides the snapshot, including with an empty or localhost-sentinel value. A resolver already in progress cannot overwrite that override.

Resolution runs outside the dispatcher's mutex. Producers retain their nonblocking bounded queue and may drop alerts while resolution is blocked. A lazy default that resolves to disabled may temporarily queue its first payload, which is then dropped. Explicit endpoint constructors retain their existing disabled behavior, options, queue size, and timeout. `GetWebhookURL` remains available for explicit configuration loading and retains its existing behavior. This change adds no retries or delivery guarantee.

## Changed files

- `pkg/notify/notify.go`: defer default endpoint resolution to the worker and protect explicit overrides.
- `pkg/notify/lazy_dispatcher_test.go`: exercise lazy resolution, both payload forms, disabled endpoints, overrides, queue saturation, and concurrent producers with owned resolvers and transports.
- `docs/specs/Offline-Startup-Notification-Isolation.md`: document behavior and verification.

## Verification and limits

The focused `go test -race ./pkg/notify -run 'TestLazy' -count=1` passed with a pinned Go 1.26.1 toolchain in an isolated working environment. It checks regular and Discord payloads sharing one resolution, disabled explicit and lazy endpoints, override precedence before, during, and after resolution, and producer progress with a full queue and blocked resolver. Existing notify tests also cover explicit delivery and timeout behavior.

The isolated working checks `go test -race ./...`, `go vet ./...`, and `go build ./...` also passed. Final independent review and final-head verification remain separate gates. Unit tests use synthetic endpoints and do not establish delivery to a configured integration. This change does not claim that other packages or dependencies perform no startup I/O.
