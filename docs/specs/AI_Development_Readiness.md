---
type: specification
title: Specification: AI Development Readiness & Context Governance Pass
---

# Specification: AI Development Readiness & Context Governance Pass

## 1. Overview
The goal of this initiative is to establish centralized repository context files, agent instruction manifests, and engineering guardrails. This ensures that future AI coding passes, autonomous agents, and inline assistants strictly adhere to the Gelt Trading Engine's architectural guidelines.

## 2. Components

### 2.1 AGENTS.md
Located at the repository root, `AGENTS.md` provides explicit instructions for autonomous AI agents reading the repository. It codifies the following guardrails:
*   **Go Requirement:** `go.mod` declares Go 1.25.0. Go CI uses 1.26.1.
*   **Concurrency:** Requires thread-safe metrics injection and state modification using `sync.RWMutex`.
*   **Telemetry:** Enforces the Zero-Fake-Telemetry rule; no mock data on production endpoints.
*   **Database:** Restricts the embedded SQLite database to a single connection (`SetMaxOpenConns(1)`).
*   **Backtesting Boundaries:** Ensures `pkg/backtest` remains 100% offline, deterministic, and free of Robinhood MCP network calls.

### 2.2 Copilot Instructions
Located at `.github/copilot-instructions.md`, this file provides real-time contextual hints for inline IDE assistants (like GitHub Copilot). It reinforces idiomatic Go practices, thread safety, testing isolation (using `httptest`), and specific DOM element requirements for the web dashboard templates.

## 3. Rationale
As AI tools become more integrated into the development workflow, setting explicit boundaries prevents the introduction of subtle bugs, such as race conditions in metrics, unintended network calls during offline backtesting, or regressions in the decoupled dashboard UI polling.

## 4. Completion Status
*   [x] `AGENTS.md` created in repository root.
*   [x] `.github/copilot-instructions.md` created.
*   [x] `docs/specs/AI_Development_Readiness.md` documented.

### Agent onboarding clarification

`AGENTS.md` now describes checkout-relative commands, Node.js 22 for V2, and
the existing Gelt operator skill for offline supplied-CSV work. It keeps the
standard checks and the separately authorized integration command distinct.
The changed paths are `AGENTS.md` and this specification.

At candidate `d8b68830e4260f7f6e29d8551066b52ba4b528fa`, the independent
static content review and the distinct critical review passed. The eight
documentation links and Go build, race tests, and vet passed. Linux V2
worker/web (2,052 passed, 28 Windows-only skips), server (18), scripts (59),
inventory, build, offline smoke, and protected HTTP passed. Scientific tests
passed from source and fresh extraction (97 each), with 18 reference
comparisons and 27 local stdio parity cases. Neither changed path matches the
protected-browser workflow filters.

These checks apply to the named candidate. Final reviews and exact-head
verification follow this closeout. Publication is pending.
