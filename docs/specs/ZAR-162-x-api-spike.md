---
type: implementation-ticket
title: ZAR-162 Spike — X API Discovery & Schema Validation
linear_issue_id: ZAR-162
linear_issue_url: https://linear.app/geltagentictrading/issue/ZAR-162/spike-x-api-discovery-and-schema-validation
status: review-ready
epic: market-data
timestamp: 2026-08-08T07:40:54Z
created: 2026-08-08T06:32:18Z
---

# ZAR-162 Spike: X API Discovery & Schema Validation

This is a market-data research artifact; it contains no implementation logic.

## Scope

Research X (Twitter) API v2 `recent search` for cashtag sentiment (e.g. `$AAPL`, `$BTC`). Identify endpoint, authentication, rate limits, and JSON schema before ingestion logic (ZAR-163).

## Findings

### Endpoint Information
| Field | Value |
|-------|-------|
| Endpoint | `GET /2/tweets/search/recent` |
| Purpose | Search recent Posts (Tweets) from the last 7 days. |
| Key Parameters | `query` (e.g., `$AAPL OR $BTC`), `max_results`, `next_token`, `start_time`, `end_time` |
| Security | `OAuth2UserToken`, `UserToken` (OAuth 1.0a), `BearerToken` |

### Authentication Methods
1. **Bearer Tokens (OAuth 2.0 App-Only)** — best for read-only generic cashtag searches; `Authorization: Bearer <token>`.
2. **OAuth 1.0a User Context** — requires signature; acts on behalf of a specific user.
3. **OAuth 2.0 Authorization Code (User Context)** — requires user consent; scopes `tweet.read`, `users.read`.

### Rate Limits — `GET /2/tweets/search/recent`
* **App-Only (Bearer Token):** 450 requests per 15 minutes.
* **User Context (OAuth 1.0a / OAuth 2.0):** 180 requests per 15 minutes per user.
* **HTTP 429 (Too Many Requests):** when window exceeded. HTTP 420 was v1/v1.1 only; v2 standardizes on 429.

### JSON Response Schema — `200 OK`
```json
{
  "data": [
    {
      "id": "1234567890",
      "text": "Buying more $AAPL today!"
    }
  ],
  "meta": {
    "newest_id": "1234567890",
    "oldest_id": "1234567890",
    "result_count": 1,
    "next_token": "b26v89c19zqg8o3fo7"
  }
}
```
* `data`: array of `Post` objects.
* `errors`: optional array of `Problem` objects if partial errors occur.
* `includes`: optional expansions (referenced users/media).
* `meta`: pagination (`newest_id`, `oldest_id`, `result_count`, `next_token`, `previous_token`).

### Sources
* X Developer API v2 OpenAPI: `https://api.twitter.com/2/openapi.json`
* X Developer Rate Limits (archived): `https://developer.twitter.com/en/docs/twitter-api/rate-limits`

## Verification

This spike is documentation-only; no implementation verification is required until ZAR-163.

## Changed files

- `docs/specs/ZAR-162-x-api-spike.md` (market-data research artifact)
