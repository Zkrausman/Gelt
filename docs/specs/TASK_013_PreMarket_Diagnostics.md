---
type: specification
title: TASK_013: Broker Integration Pre-Market Health Diagnostic Suite
---

# TASK_013: Broker Integration Pre-Market Health Diagnostic Suite

## Overview
This specification details the implementation of an automated pre-market diagnostic suite (`pkg/health`) to run full connectivity, OAuth PKCE token status, and account buying power checks against the Robinhood MCP Server before live trading sessions begin.

## Implementation Details

### 1. New Package (`pkg/health`)
Created `diagnostic.go` which implements `RunPreMarketCheck(cfg *robinhood.MCPConfig) HealthReport`.
- **MCP Server Pulse:** Verifies HTTP POST JSON-RPC reachability by sending a dummy `ping` request to the configured `ServerURL` (defaults to `127.0.0.1:8080` if not set, but uses config).
- **OAuth State:** Checks token freshness using the existing `robinhood.PingMCP(cfg)` which tests standard GET authorization against the URL.
- **Account Health:** Verifies account buying power meets a minimum intraday buffer requirement of $100.00 liquid minimum. It does this by dispatching a `get_account` tool call to the MCP server.
- Returns a structured `HealthReport` containing pass/fail states for each check.

### 2. CLI Integration
Expanded the `gelt test-suite` subcommand in `cmd/gelt/main.go` to integrate the new diagnostic suite.
- Loads config and executes `health.RunPreMarketCheck`.
- Displays a formatted diagnostic table showing each check, latency (ms), and PASS/FAIL indicators.

### 3. Verification
Unit tests are implemented in `pkg/health/diagnostic_test.go` using mock HTTP responses (mocking the MCP JSON-RPC Server) to verify PASS/FAIL handling across reachability, token expiry, and low buying power scenarios.
