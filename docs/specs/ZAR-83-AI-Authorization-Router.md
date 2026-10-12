---
type: spec
status: proposed
ticket: ZAR-83
---

# ZAR-83: AI Authorization Router and Overrides

## 1. Architectural Analysis

The Gelt system currently has a multi-hop architecture where strategy evaluation produces raw trading signals (e.g., BUY, SELL). As per GELT-152, these signals are intercepted and packaged into a hydrated context (`SignalContextPayload`) marked for `SignalAgentReview`.

This ticket, GELT-153 (ZAR-83), introduces the AI Orchestrator layer (`pkg/ai/orchestrator.go`). The purpose is to consume the hydrated context, query a mock/LLM model, and interpret its decision.

### State Lifecycle Trace
1. `Evaluator` intercepts a raw BUY/SELL signal.
2. `Evaluator` emits a `SignalAgentReview` with an `AgentPrompt` (JSON containing context).
3. `AI Orchestrator` receives the payload.
4. `AI Orchestrator` simulates querying an LLM.
5. If the AI response yields `Decision == "VETO"` OR `ConfidenceScore < 75.0`, the signal is canceled (overridden to `SignalHold`).
6. If the AI response yields a valid decision with `ConfidenceScore >= 75.0`, the signal is authorized (restored to original state).

### Concurrency & Thread Safety
Since the AI query might simulate external latency or process concurrent streams of signals across multiple plans, the orchestrator must operate safely. The design will rely on isolated pure functions where possible, or thread-safe structs. We will utilize standard `log/slog` for structured JSON output as required by `AGENTS.md`.

## 2. Mathematical Constraints

The performance logic implicitly applies a threshold for execution risk bounded by the AI's confidence score ($\gamma$).
Let $S_{in}$ be the incoming signal, and $S_{out}$ be the resulting execution signal.

$$
S_{out} =
\begin{cases}
S_{original} & \text{if } \gamma \geq 75.0 \text{ and } \text{Decision} \neq \text{VETO} \\
\text{SignalHold} & \text{otherwise}
\end{cases}
$$

This ensures we mitigate false positive setups from lower-conviction AI evaluations, directly reducing the probability of loss on suboptimal regimes.

## 3. Implementation Plan
- **Structs**: `AIResponse` containing `ConfidenceScore`, `Decision`, `Reasoning`.
- **Functions**: `RouteContext(signal strategies.StrategySignal, payload string) (strategies.StrategySignal, error)`
- **Testing**: We will construct unit tests in `cmd/orchestrator/orchestrator_test.go` covering edge cases: VETO, $\gamma < 75.0$, and normal authorizations.
