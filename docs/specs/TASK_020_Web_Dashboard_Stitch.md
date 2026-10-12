---
type: specification
title: TASK_020: Web Dashboard Generation & Telemetry Server via Google Stitch MCP
---

# TASK_020: Web Dashboard Generation & Telemetry Server via Google Stitch MCP

## Overview

A lightweight local Web Dashboard for Gelt has been implemented. This dashboard serves as a real-time monitor for the system's quantitative strategies, broker connection state, and risk metrics. It consists of a Go HTTP telemetry status server providing JSON API endpoints, and a modern dark-mode quant UI accessible via a web browser.

## Technical Components

### 1. Backend Status Telemetry Server (`pkg/server/server.go`)

An asynchronous HTTP server that listens on `127.0.0.1:8085` and exposes the following JSON API endpoints:

- `GET /api/v1/health`: Returns pre-market pulse, broker connection, and buying power telemetry using mock integration with `pkg/health`.
- `GET /api/v1/plans`: Returns active trading plan details, strategy ensemble weights, and evaluation confidence scores from `pkg/plans`.
- `GET /api/v1/risk`: Returns active open positions, ATR trailing stops, and daily risk cap state based on limits defined in `pkg/risk`.
- `GET /api/v1/shadow`: Returns performance leaderboard data (win rate, total PnL, trades, etc.) from `pkg/shadow`.

Additionally, the server hosts the compiled static frontend files seamlessly.

### 2. Frontend Generation

The web dashboard UI is built as a clean, responsive, dark-mode single-page application using HTML, CSS (with variables for easy theme mapping), and JavaScript. It's embedded directly into the Go binary via `go:embed`.

Key Panels Designed:
- **Header/Pulse Bar:** Broker status, Buying Power, and System Latency.
- **Strategy Overview:** Active plan name, overall confidence score, and macro regime status.
- **Risk & Positions:** Real-time updates on active position sizes, unrealized PnL, and trailing ATR stop limits.
- **Shadow Leaderboard:** Tracks trading performance of active and shadow trading strategies with net profitability metrics.

The frontend polls the `/api/v1/*` endpoints automatically every 5 seconds to provide near real-time state visualization without page reloads.

### 3. CLI Integration

The Gelt CLI in `cmd/gelt/main.go` was updated with the following command:

- `gelt dashboard` (or `gelt serve`)

Executing this command initiates the Telemetry Server in the background and automatically opens the user's default web browser to the dashboard URL (`http://127.0.0.1:8085`), displaying the live interface.

## Testing & Verification

- Unit tests for the server endpoints are located in `pkg/server/server_test.go` utilizing `net/http/httptest`.
- The main executable compiles successfully (`go build -o gelt.exe ./cmd/gelt`).
- Integration has been verified manually by running the web dashboard and observing the mocked internal state payloads being visually interpreted by the browser.
