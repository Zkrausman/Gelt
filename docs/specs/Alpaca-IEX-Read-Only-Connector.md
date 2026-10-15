---
type: specification-closeout
title: Standalone Alpaca IEX historical bars connector
status: candidate-awaiting-independent-reviews-and-hosted-checks
date: 2026-10-15
execution_enabled: false
---

# Standalone Alpaca IEX historical bars connector

This source candidate adds a narrow, standalone read-only connector for daily
historical bars for exactly one explicitly named stock symbol. It targets
Alpaca's documented [historical stock bars endpoint](https://docs.alpaca.markets/us/reference/stockbars),
`GET https://data.alpaca.markets/v2/stocks/bars`, with a single `symbols` value,
`timeframe=1Day`, `feed=iex`, `currency=USD`, an explicit adjustment, `sort=desc`,
explicit `start`, `end` and `asof`, and bounded pagination. Alpaca documents the
`end` bound as inclusive. The connector requires `start` and `end` to equal the
first and last provider timestamps in the caller-supplied session calendar and
records all request parameters and page-token digests. `asof` is only Alpaca's
symbol/entity mapping selector; it does not establish a security's identity,
eligibility, listing, or market-data rights. No adjustment or mapping default is
selected.

The transport uses GET only, a fixed origin/path, redirects disabled, a bounded
timeout and response body, at most three pages and 253 observations, exact
single-symbol response validation, and no retries or provider fallback. It is
not imported by an application startup, worker launcher, UI, account connector,
stream, or order path. Calls require `enabled: true` and an explicit key pair.
The acquisition seam accepts an injected fetch implementation so source tests
can use synthetic responses only. No provider request or real credential was
used for this candidate.

The connector captures its own receipt timestamp after the final bounded page;
the public options expose an injectable fetch function only, not an injectable
clock. Each response body is retained losslessly as bounded base64 in the
returned in-memory evidence alongside its SHA-256 digest and exact request metadata. The
strict JSON parser exposes source numeric tokens by structural path; close
values are derived from those tokens without converting a rounded JavaScript
number back into decimal text. Exponents, unsupported precision, duplicate JSON
keys, extra symbols or row fields, malformed timestamps, invalid OHLC relations,
repeated continuation tokens, and mismatches between retained bytes and parsed
observations fail closed. This module does not store market data on disk.

The G05-shaped normalization requires explicit source/feed/symbol/adjustment,
`asof`, a caller-supplied calendar with contiguous session ordinals and explicit
closed/completed evidence, one availability fact per observation, a received
time, and a decision time. The calendar must match the request and captured
response; all bars must be within its inclusive request bounds, completed no
later than receipt, and available no earlier than receipt or completion and no
later than the decision. The calendar digest is recomputed over its canonical
symbol/session fields before use. This prevents edits from reusing an unrelated
claimed digest and prevents a newly acquired response from claiming that an
unseen revision was available before its capture. The output retains
`classification=market_shadow_input`, `eligibility=unverified`,
`effectAuthority=none`, and `promotionAllowed=false`. Caller-provided calendar
and availability declarations are not independently authenticated; computed
content hashes bind their supplied values to the output but do not prove their truth, data rights, freshness policy,
costs, or admission. Missing, partial, ambiguous, or inconsistent evidence is
rejected. No scheduling, costs, retention policy, or G05/G06/G07 acceptance rule
is introduced.

The separate key-pair helper supports a future explicit local provisioning
action. On Linux it creates a new owner-only `0700` directory and exclusive
owner-only `0600` file, requires the requested path to be separate from the
existing broker-vault path, pins opened directory/file identity, rejects
symlinks, hard links, owner/mode changes and oversized reads, and emits only
constant sanitized errors. Hidden key entry requires a TTY, disables echo,
bounds input, restores terminal mode on success/error/cancel/close/signal, and
does not take secrets from argv, environment variables, or chat. The helper is
not wired to an application route or automatically invoked. This is a Linux-only
path/identity checked implementation, not a general cross-platform credential
manager or a claim of eliminating every filesystem race. JavaScript strings
cannot be reliably zeroed after use. No provisioning action or real terminal
entry was performed.

Changed source and synthetic test seams are `v2/worker/src/alpaca-iex-contract.ts`,
`alpaca-iex-connector.ts`, `alpaca-iex-normalization.ts`,
`alpaca-iex-credentials.ts`, `alpaca-iex.test.ts`,
`alpaca-iex-credentials.test.ts`, `research-json.ts`, and the direct number-token
regression in `research.test.ts`; inventory is updated in
`v2/IMPORT-MANIFEST.json`. These are code-only synthetic/mock checks. They do
not establish genuine-feed behavior, G05/G06/G07 acceptance, exchange/data
rights, eligibility, or runtime admission. Focused tests, typecheck/build and
the established hosted checks have not been run by this source writer. Fresh
independent and adversarial full-diff reviews and parent-run hosted checks remain
pending on the exact candidate. The source writer made no commit or publication;
parent delivery evidence is recorded separately.
