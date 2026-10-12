---
type: specification
title: TASK 032: Local VADER NLP Sentiment Scoring Engine
---

# TASK 032: Local VADER NLP Sentiment Scoring Engine

## Objective
Implement a local VADER (Valence Aware Dictionary and sEntiment Reasoner) sentiment scoring package in Go to analyze unstructured text extracted by the Reddit Ingestion Engine without incurring external API latency or costs.

## Implementation Details
1. **Target Directory:** `pkg/sentiment/`
2. **Library Used:** `github.com/jonreiter/govader`
   - Chosen for its pure-Go implementation of VADER, reducing the need for CGO or external dependencies, ensuring high portability and speed.
3. **Struct & Methods:**
   - `SentimentAnalyzer`: Wraps the `govader` analyzer.
   - `NewSentimentAnalyzer()`: Initializes the analyzer and injects custom retail financial slang (e.g., "printing", "tanking", "moon", "calls", "puts") into the default VADER lexicon to better capture retail momentum and slang.
   - `EvaluateText(text string) (float64, error)`: Returns a normalized compound polarity score ranging from -1.0 to 1.0.
   - `EvaluateRedditPosts(posts []data.RedditPost, keyword string) float64`: Consumes posts from the `pkg/data` Reddit cache, aggregates scores across a specific ticker/keyword, and outputs a standardized retail momentum score from `0.0` to `100.0`.

## Testing & Validation
- Unit tests were written in `pkg/sentiment/scorer_test.go`.
- Explicit test cases validated:
  - Positive financial strings ("Calls are printing massively!").
  - Negative financial strings ("This stock is completely tanking").
  - Sarcastic/Negated strings (handled via standard negation rules and lexicon adjustments).
  - Reddit post aggregation by ticker, confirming accurate calculation of 0-100 average scores.
- The test suite was verified with `go test -race ./...` and returned 100% pass rates, ensuring thread safety and deterministic logic.

## System of Record
This module establishes a fast, cost-free, and local NLP pipeline tailored to retail trading terminology, replacing the need for external API-based sentiment analysis tools.
