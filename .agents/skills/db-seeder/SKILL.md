---
name: db-seeder
description: Populates local SQLite development database with mock data or historical backtest states for testing.
---

# Local DB Seeder Skill

## Agent Instructions

1. Confirm the target is a local development or test database. Never seed a production database.
2. From the repository root, execute `go run ./cmd/gelt seed-db`.
3. Ensure the configured SQLite database file is updated.
4. Validate the seeded tables using the application or an available SQLite client.
