---
type: completion_report
title: Agent supplied-CSV operator workflow
description: Route agent backtest requests through shipped offline comparison help while preserving operational boundaries.
timestamp: 2026-11-13T00:00:00Z
---

# Agent supplied-CSV operator workflow

The operator skill previously omitted all nine causal CSV commands, described
the legacy generated-data backtest as deterministic and prescribed integration
diagnostics for verification. An agent loading that skill could select a
different data/effect path despite the shipped offline chooser.

`skills/gelt-operator/SKILL.md` now starts supplied-CSV tasks with `help offline`
and exact per-command help. It maps the existing strategy/period choices,
distinguishes the four diagnostics, and explains input/declaration, endpoint,
warmup, accounting, output-failure and interpretation boundaries. The legacy
wall-clock-seeded fallback is explicit. Operational commands remain separate
references under the task's actual authority; no new approval ceremony or
operating release is introduced.

Only the skill and this specification change. Command dispatch, APIs, CSV
admission, calculations, costs, strategy defaults, output and configuration are
unchanged. No provider, data, model, broker or operating integration is added.
The held machine-readable comparison work and unpublished UI work are untouched.

Verification uses skill/frontmatter/link checks, independent source comparison
against the actual help and usage constants, and fifteen isolated compiled CLI
cases: chooser, nine detailed guides, the sole-help alias, synthetic whole and
selected-period comparisons, malformed input and unsupported target. The child
environment has an owned empty home, inert canaries and no network. Output,
exit, source/binary identity, filesystem invariance and child settlement are
recorded; this does not prove future agent behavior or provide an execution
sandbox merely by writing instructions.

Complete independent accuracy and distinct adversarial/privacy review precede
fresh applicable exact-head repository checks and ordinary PR/CI delivery.
Synthetic process acceptance is not browser acceptance, market-data authenticity,
cost calibration, profitability or operating qualification. NOT_READY / CLOSED /
DEFER and all existing acquisition, credential and uncertain-operation holds stay
in place.

## Legacy backtest compatibility clarification

The operator skill now warns that an explicit data-or-days operand with neither
a case-insensitive `.csv` suffix nor a valid integer can fall back to 100
synthetic bars. The legacy CSV parser discards numeric syntax errors, so a
nonnumeric `Volume` token may be carried forward as zero. Use the strict causal
commands for supplied CSV and `diagnose-causal-csv` for syntax and bar-domain
issues. The two changed files are `skills/gelt-operator/SKILL.md` and this
specification. CLI behavior and operating scope are unchanged.

Independent accuracy and adversarial reviews accepted the operator-note diff at
`b32990d6570301131173241d8a21877953e25662` without blocker or high-severity
findings. Source checks traced both warnings to the legacy dispatcher and bar
validator. On that head, four focused synthetic CSV tests, Go race/vet/build,
Linux V2 unit/build/smoke/protected HTTP checks, and the offline scientific
source and fresh-package checks passed. Neither changed path enters a protected
browser workflow. Fresh final reviews and exact-head checks cover this closeout.
