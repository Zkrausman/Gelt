---
title: MeanReversion ATR constructor defaults
status: implementation-draft
---

# MeanReversion ATR constructor defaults

The MeanReversion constructor initializes its ATR stop multiplier to 0.5 and
its target multiplier to 1.5. These are explicit uncalibrated model defaults;
the historical pair is unknown. MeanReversionBB uses the same pair, which is a
repository convention, not evidence of calibration or market suitability.

Previously the constructor left both fields at zero. The change intentionally
alters protection percentages for default and partially overridden consumers,
including the default catalog and built-in plans that construct MeanReversion.
A positive `SetParams` value continues to override its corresponding field;
nonpositive values continue to be ignored. Fully positive configured pairs
produce the same evaluation inputs as before. Signal direction, score, identity,
rationale, indicators and replay algorithms are unchanged. Manually zeroed fields
continue to disable protection in the generic causal replay.

## Changed files

- `pkg/strategies/mean_reversion.go`: initialize the two multiplier fields.
- `pkg/strategies/mean_reversion_atr_defaults_test.go`: synthetic signal,
  override and direct registry coverage.
- `pkg/backtest/mean_reversion_atr_defaults_test.go`: synthetic causal replay
  and explicitly disabled-protection control.
- `pkg/strategies/README.md`: document defaults and compatibility boundary.
- `docs/specs/MeanReversion-ATR-Defaults.md`: this specification.

## Working verification and review

A new synthetic constructor regression failed against the omitted-default
baseline with both multipliers and both protection percentages at zero. Focused
race-enabled strategy and causal tests passed after the change. Full working
race, vet, build and diff checks are recorded separately as working evidence;
independent and adversarial source reviews and fresh final verification remain
pending. The synthetic model results are not calibration, profitability,
execution or trading qualification evidence.
