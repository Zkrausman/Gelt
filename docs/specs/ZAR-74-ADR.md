# Architecture Decision Record: Event-Driven & Volatility-Triggered Heavy Agent Dispatcher

## 1. Context & Multi-Hop Architectural Analysis
The goal is to introduce an event-driven `Dispatcher` module within the Gelt orchestrator. This dispatcher sits between the passive metric polling/cron systems and the Heavy Antigravity Agent client bridge (GELT-131). It manages dual-dispatch logic:
1. Scheduled Crons (daily market close, telemetry report generation, 1-hour sentiment sweeps).
2. Volatility Circuit Breaker (ATR volatility spikes, fast decision node scores).

### State Lifecycle
1. **Trigger Phase**: Cron event fires OR a fast decision node pushes a metric (ATR / score).
2. **Evaluation Phase**:
   - Check if current month quota < 100 calls.
   - Evaluate thresholds: ATR $> 2.5 \times \text{standard deviation}$, OR score $\ge 85.0$.
3. **Execution Phase**:
   - If conditions met, invoke the `AntigravityAgentClient`.
   - Increment month quota state.

## 2. Configuration & State Management
Thresholds (MaxMonthlyCalls, ATRSpikeThreshold, DecisionScoreThreshold) are configured and loaded centrally from the `~/.gelt/config.json` AppConfig struct. The actual call count is persisted to `~/.gelt/quota_state.json`.

## 3. Thread Safety & Concurrency
Given the multi-source trigger environment (cron goroutines, incoming volatility events), the quota state check and increment must be atomic.
- Use `sync.Mutex` on the in-memory counter.
- Since persistence to `~/.gelt/quota_state.json` is a requirement (per Linear ticket), file I/O must be serialized behind the same mutex lock to prevent write races and file corruption.

## 4. Mathematical Constraints
The volatility trigger incorporates strict risk governance constraints. We define the spike threshold using Average True Range (ATR):
- $\text{Let } \sigma_{\text{ATR}} \text{ be the standard deviation of ATR over the lookback period.}$
- $\text{Trigger Condition: } \Delta \text{ATR} > 2.5 \sigma_{\text{ATR}}$
- $\text{Decision Score Condition: } \text{Score} \ge 85.0$

## 5. Agents.md & Security Compliance
- Uses Go `log/slog` for structured JSON output on `os.Stdout`.
- No new daemon architectures introduced.
- Strict quota logic ensures AI API limits are respected, securing the API billing account from runaways.
