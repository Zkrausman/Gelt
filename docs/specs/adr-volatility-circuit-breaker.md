# ADR: Volatility Circuit Breakers (ATR Chop Filter)

## 1. Context and Problem Statement
Mean-reversion trading strategies (such as Bollinger Band bounces or RSI reversals) tend to produce false positives during periods of low-volatility "chop" (sideways markets with minimal price movement). During these periods, the asset price may touch bands or oscillators may fluctuate, but the lack of true momentum results in poor follow-through, leading to losses. We need a mechanism to quantify volatility and pause (circuit-break) signal generation when volatility drops below a configurable threshold.

## 2. Decision Drivers
- Need for a dynamic, asset-independent volatility measure.
- Minimal performance overhead (computational efficiency).
- Configurable thresholding for different asset classes.

## 3. Considered Options
- Average True Range (ATR) Percentage.
- Historical Volatility (Standard Deviation of Log Returns).
- Bollinger Band Width (BBW).

## 4. Decision
We selected **Average True Range (ATR) Percentage**. ATR is a standard, robust measure of absolute price movement, which is already calculated in our `pkg/signals` library. By calculating the ATR over a 14-period window and converting it to a percentage of the last closing price, we create a normalized volatility metric.

### Mathematical Constraint
Let $C_t$ be the close price at time $t$.
The ATR over $n$ periods is defined based on the simplified closing-price differences (as per `CalculateATRFromCloses`):

$$ ATR_n = \frac{1}{n} \sum_{i=0}^{n-1} |C_{t-i} - C_{t-i-1}| \times 1.5 $$

The circuit breaker enforces the condition:

$$ \frac{ATR_n}{C_t} \times 100 \ge \tau $$

Where $\tau$ is the `minVolatilityPct` threshold (defaulting to $1.5\%$). If the inequality is false, the circuit breaker triggers and sets the signal to `SignalHold`.

## 5. Consequences
- **Positive:** Reduces false-positive entries during low-volatility, sideways chop. Increases the expected win rate of mean-reversion strategies.
- **Negative:** May occasionally miss early breakouts that begin from a period of extreme low volatility, though those are typically caught by breakout/momentum strategies rather than mean-reversion.

## 6. Implementation Details
The filter is implemented as `IsVolatilityChop` in `pkg/strategies/filters.go` and integrated directly into the `Evaluate` methods of `MeanReversionStrategy` and `MeanReversionBBStrategy`.
