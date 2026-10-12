---
type: skill
status: active
dependencies: [pkg/data]
command: go run ./cmd/gelt fetch-data
---

# Data Fetcher Skill

## Agent Instructions

**When to use this skill:**
Use this skill when you need to manually trigger the ingestion of the latest external market data, such as FRED macroeconomic indicators or Reddit sentiment.

**How to use this skill:**
1. Execute the `command` specified in the frontmatter.
2. Verify the output logs to ensure data was fetched without errors.
3. Check the local SQLite database or cache to confirm the new data points are present.
