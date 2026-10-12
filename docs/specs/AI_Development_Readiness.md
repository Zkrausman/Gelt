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
*   **Go Requirement:** Mandates Go 1.22+.
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
