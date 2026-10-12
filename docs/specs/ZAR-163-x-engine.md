---
type: implementation-ticket
title: ZAR-163 Impl — XEngine Polling and Thread-Safe Cache
linear_issue_id: ZAR-163
linear_issue_url: https://linear.app/geltagentictrading/issue/ZAR-163/impl-xengine-polling-and-thread-safe-cache
status: review-ready
epic: market-data
timestamp: 2026-08-08T00:00:00Z
created: 2026-08-08T06:32:18Z
---

# ZAR-163 Impl — XEngine Polling and Thread-Safe Cache

Depends on spike `docs/specs/ZAR-162-x-api-spike.md` (GET /2/tweets/search/recent, Bearer token, JSON data/meta).

## Scope

Create `XClient` in `pkg/data/x_api.go` — thread-safe `sync.RWMutex` cache (`XCache`), asynchronous `StartPolling` goroutine with `context.Context` and `time.Ticker`, authenticate via `X_API_KEY` / `X_API_SECRET` / `X_BEARER_TOKEN` env vars. Integrate as `XProvider` (`pkg/data/FeatureProvider` style) for `FeatureRegistry`. Add mocked unit tests mimicking API shape from spike. See Linear https://linear.app/geltagentictrading/issue/ZAR-163/impl-xengine-polling-and-thread-safe-cache.

## Implementation

- `pkg/data/x_api.go` — `XPost`, `XClient.SearchRecent` (httptest-injectable `BaseURL`, `http.Client`, Bearer header, JSON decode with `data[].id/text/created_at` + `meta.next_token`, `slog.Warn` on parse error, fallback `time.Now()`), `XCache` (`sync.RWMutex`, `map[string][]XPost`, `Update` Lock/Unlock, `Get` RLock/RUnlock + copy), `XEngine.StartPolling` (ticker, `ctx.Done`), `pollAll` (per-query `SearchRecent` + `Cache.Update` + `slog.Info/Error`), `XProvider.Fetch` (prefix `Social.X.Mentions.` validation, cache read). No Thneed, no hardcoded secrets, no network in tests — `httptest.NewServer`.
- `pkg/data/x_api_test.go` — httptest mocks for success, invalid JSON, empty payload, thread-safety under `-race`, invalid payload no panic.

## Verification

`go test -race ./pkg/data -count=1` (3.352s, no races), `go vet ./pkg/data/...` pass, and `go build ./...` pass.

## Changed files

- `pkg/data/x_api.go`
- `pkg/data/x_api_test.go`
- `docs/specs/ZAR-163-x-engine.md`
