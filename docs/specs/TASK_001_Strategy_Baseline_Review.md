---
type: specification
title: TASK_001: Strategy Baseline Review
---

# TASK_001: Strategy Baseline Review

## Objective
Engineering Management requires a baseline assessment of Gelt's active trading edge and Strategy Catalog before initiating Phase 1 optimization (equities focus).

## Required Actions
1. **Run Strategy Catalog:** Execute `.\gelt.exe strategies` in the terminal and capture the full standard output.
2. **Extract Active Logic:** Locate the primary Go file(s) responsible for calculating the confidence scores (0.0 - 100.0) within the active trading plans (e.g., `IntradayAlphaPlan`).
3. **Report Generation:** Output the terminal results from Step 1, alongside the core quantitative logic/code snippets identified in Step 2, into a clear text response.