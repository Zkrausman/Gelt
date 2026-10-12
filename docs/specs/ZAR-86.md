---
title: "[ZAR-86] User-Level Config Binder for Strategy Parameters"
status: complete
type: architectural decision record (ADR)
---

# Gelt Execution Directive: Linear Ticket Implementation

## 1. System Context & Role
Gelt Quantitative Strategy Engine

## 2. Objective
Bind all strategy indicator parameters and threshold options (`MeanReversion`, `BreakoutVol`, `TrendConfluence`, `VWAPRebound`) directly to user-level configuration files (`~/.gelt/config.json` and trading plan YAML files) to ensure 100% user-level configurability.

## 3. Context & Multi-Hop Architectural Analysis Required
- Implemented `StrategyConfig` map to `AppConfig` allowing per-strategy overrides globally.
- Enforced configuration resolution priority: YAML Plan Parameters -> `config.json` overrides -> Hardcoded Safe Defaults.
- Modified `BasePlan.Init()` to hydrate Strategy instances at initialization rather than during runtime ticks (`Evaluate()`) to guarantee state isolation and thread safety.

## 4. Metacognitive & Mathematical Deliverables (System of Record)
- Threshold validation constraint logic applied linearly: $x \ge Threshold$ or $x \le Threshold$, preventing floating-point precision issues during conditional comparisons.

## 5. Execution Guardrails & Shipping
- Integrated `gopkg.in/yaml.v3` for proper unmarshaling of the dynamic trading plan schema.
- All Go Race Detection flags (`go test -race ./...`) successfully passed.
