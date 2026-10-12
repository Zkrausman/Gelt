---
name: data-fetcher
description: Triggers ingestion of latest external market data including FRED macroeconomic indicators and Reddit sentiment.
---

# Data Fetcher Skill

## Agent Instructions

1. From the repository root, execute `go run ./cmd/gelt fetch-data`.
2. Verify the output logs to ensure data was fetched without errors.
3. Check the local SQLite database or cache to confirm the new data points are present.

This command performs external network access. If the environment requires approval, request it rather than substituting fabricated data.
