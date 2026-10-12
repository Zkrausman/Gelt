---
type: skill
title: "[Engine] Promotion Engine Orchestrator & CLI Integration"
status: active
dependencies: [ZAR-58, ZAR-56, ZAR-60, ZAR-59, ZAR-57, ZAR-55]
command: ./gelt.exe plan promote <strategy>
---

# ZAR-61: Promotion Engine Orchestrator & CLI Integration

## Architectural Decision Record (ADR)

### Context & Problem Statement
Gelt needs an automated orchestration layer to run background scans on shadow trading strategies, evaluate their performance metrics, and optionally promote them to live status (hot-swap) if they meet all risk and performance criteria. We also need a manual CLI command to securely trigger this promotion and a pre-market test-suite check to validate the promotion config.

### Multi-Hop Architectural Analysis
1. **Thread Safety & Hot-Swapping:**
   - `PlanRegistry` requires acquiring `evalLock` using `PromotePlan()` to block concurrent evaluations (`EvaluateActive()`) during hot-swap transitions.
   - The engine utilizes a ticker (e.g., 15 mins) and must perform these checks securely.

2. **Metrics & Notification (Alert Only vs. Auto-Promo):**
   - We calculate strategy metrics inside the engine because `PromotionEvaluator.Evaluate` returns a simple `[]string`.
   - The engine parses `ShadowTrade` objects (filtered by `Status == "CLOSED"`) to compute `WinRate`, `ProfitFactor`, `VaR`, and `TotalTrades`.
   - If `PromoAlertOnly == true`, the system dispatches `notify.SendPromotionAlert(metrics)` and halts.
   - If `AutoPromoEnabled == true`, the system automatically calls `registry.PromotePlan(qualifiedPlan)`.

3. **Constraints & Guardrails:**
   - Pre-Close Lockout engine (`IsPromotionWindowOpen`) guarantees promotions do not happen near the 3:50 PM ET market close.
   - Intraday Drawdown Monitor uses a kill switch (`IntradayDrawdownMonitor`) to abort or revert failed promoted strategies.
   - Go 1.22+ and strictly structured `slog` output is mandatory. No Thneed daemons locally.

### Mathematical Constraints
The performance of the strategy must adhere strictly to these bounding rules before promotion:
- **Win Rate ($\omega$):** $\omega = \frac{\text{Wins}}{\text{Total Trades}} > 0.65$
- **Profit Factor ($PF$):** $PF = \frac{\sum |\text{Win USD}|}{\sum |\text{Loss USD}|} > 1.5$
- **Trades ($N$):** $N \geq 3$
- **Value at Risk (VaR):** $VaR_{95} < 5\%$
  (Expressed dynamically as $( \frac{| VaR |}{\text{Initial Balance}} ) \times 100 < 5.0$)

## OKF Specification Compliance
- The core orchestrator is `pkg/shadow/PromotionEngine`.
- Integrates `PromotionConfig`, `PromotionEvaluator`, `PlanRegistry`, and `notify`.
- Added CLI command `gelt plan promote <name>` to manually trigger promotion.
- Wired `LoadPromotionConfig().Validate()` into the `./gelt.exe test-suite`.
