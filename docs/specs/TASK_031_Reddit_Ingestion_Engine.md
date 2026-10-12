---
type: specification
title: TASK_031: Reddit API Sentiment Ingestion Engine
---

# TASK_031: Reddit API Sentiment Ingestion Engine

## Objective
Build a lightweight, asynchronous ingestion engine that polls the free Reddit Data API to extract text data from targeted financial subreddits, laying the groundwork for local sentiment analysis.

## Implementation Details
- Created `RedditClient` struct in `pkg/data/reddit.go` that securely authenticates using a Read-Only script application expecting standard `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` environment variables.
- Implemented `FetchSubreddit(subreddit string, limit int)` to extract `Title`, `Body`, `Score`, and `CreatedAt` from `/r/{subreddit}/hot.json`.
- Implemented `RedditCache` using `sync.RWMutex` for thread-safe access.
- Implemented `RedditEngine` with `StartPolling` goroutine to periodically fetch posts and update the cache.
- Updated `.env.example` to include all standard environment variables required by Gelt (e.g., ROBINHOOD_MCP_URL, ROBINHOOD_CLIENT_ID, DB_PATH, FRED_API_KEY, DISCORD_WEBHOOK_URL) and the new ones: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`.

## Testing Details
- Created `pkg/data/reddit_test.go`.
- Set up a `httptest.NewServer` to mock HTTP JSON responses mirroring the Reddit API structure to validate parsing logic without making live network calls or triggering rate limits.
- Tested `FetchSubreddit` to ensure it parses the mocked JSON correctly and extracts the fields.
- Tested `StartPolling` to ensure it updates the thread-safe cache correctly.
