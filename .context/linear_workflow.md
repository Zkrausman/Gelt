---
type: agent-instruction
status: active
dependencies: []
---

# Linear Issue & Git Workflow Standard

## Purpose
Defines the strict version control and issue-tracking workflow for AI agents executing tasks.

## Agent Instructions
Whenever you are provided with a Linear Ticket ID (e.g., GELT-123), you MUST:
1. Update the Linear issue status to "In Progress" (via CLI if available).
2. Create a new git branch formatted as: `<TICKET-ID>-<brief-description>` (e.g., `GELT-123-dashboard-fix`).
3. Prefix all commit messages with the ticket ID: `[<TICKET-ID>] <message>`.
4. Ensure the GitHub PR title includes `[<TICKET-ID>]` and the body includes `Resolves <TICKET-ID>`.
