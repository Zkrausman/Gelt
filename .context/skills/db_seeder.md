---
type: skill
status: active
dependencies: [pkg/store]
command: go run ./cmd/gelt seed-db
---

# Local DB Seeder Skill

## Agent Instructions

**When to use this skill:**
Use this skill when you need to populate the local SQLite development database with mock data or historical backtest states for testing purposes.

**How to use this skill:**
1. Execute the `command` specified in the frontmatter.
2. Ensure the SQLite database file (`gelt_journal.db` or similar) is updated.
3. Validate the seeded tables using the sqlite3 CLI tool or by querying it in the application.
