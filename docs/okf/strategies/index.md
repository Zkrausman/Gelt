---
type: okf
title: Multi-Strategy Portfolio Architecture
status: active
dependencies: []
---

# Multi-Strategy Portfolio Architecture

## Purpose
This document outlines the architecture for the multi-strategy portfolio in the Gelt trading engine.

## Overview
The Portfolio Manager (`pkg/portfolio/manager.go`) coordinates multiple trading strategies concurrently using goroutines. It aggregates strategy signals, resolves conflicts, and enforces capital budgeting.

## Core Components
- **PortfolioManager**: Orchestrates the execution of strategies and handles risk governance across the entire portfolio.
- **Strategies**: Independent instances executing specific trading logic. They implement the `Evaluate` and `CapitalRequirement` methods.
- **Signal Resolution**: Conflicting signals across strategies are prioritized (e.g., SELL over BUY) to ensure safe portfolio management.

## State Management
- Available capital and portfolio state are protected using `sync.RWMutex`.
- A getter method `GetAvailableCapital()` provides thread-safe access to unexported state variables.
