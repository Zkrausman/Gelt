---
title: "Volatility Circuit Breaker (ATR Chop Filter)"
ticket: ZAR-81
status: Proposed
type: Spec/ADR
---

# Volatility Circuit Breaker (ATR Chop Filter)

## 1. Context & Objective
The goal of this spec is to document the design and constraints of the `ATRChopFilter`.
Mean-reversion signals perform poorly in low volatility "chop" regimes. By monitoring the Average True Range (ATR) as a percentage of the asset price, we can dynamically filter signals.

## 2. Technical Description
A volatility circuit breaker will be implemented in `pkg/strategies/filters.go`.
It calculates the rolling ATR and enforces minimum volatility bounds. Mean-reversion buy/sell signals are blocked if the ATR drops below a configurable threshold.

## 3. Mathematical Constraints
The filter condition evaluates true (allowing trades) if and only if the volatility ratio is greater than or equal to the threshold:

$$ \frac{ATR}{Close} \ge Threshold $$

Where:
- $ATR$: Rolling 14-period Average True Range.
- $Close$: Current closing price.
- $Threshold$: Configurable baseline volatility (default = 1.5%, or 0.015).

If the ratio is below the threshold, the circuit breaker triggers and the signal is forced to `SignalHold`.

## 4. Acceptance Criteria
- Verify `go test -race ./pkg/strategies/...` passes when low ATR conditions trigger the chop filter and block mean-reversion buy signals.
- Configurable ATR threshold defaults to 1.5% of asset price and successfully allows trades when ATR expands above threshold.
