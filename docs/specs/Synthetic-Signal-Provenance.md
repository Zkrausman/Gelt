---
type: Specification
title: Synthetic signal and screener provenance
description: Label the generated-price inputs of the existing signals and scan CLI previews without changing calculations.
timestamp: 2026-11-16T00:00:00Z
---

# Synthetic signal and screener provenance

`gelt signals [SYMBOL]` always evaluates sixty generated closes with start price
500 and seed 42. The symbol is a label, not a request for that symbol's prices.
`gelt scan [MIN_SCORE]` generates every series using the configured/default
watchlist, synthetic price anchors and existing per-entry seeds. Neither preview
uses observed market prices. Previously their technical-signal and market-screener
headings omitted that fact.

Both branches now print a leading `SYNTHETIC DEMO` disclosure and use explicitly
synthetic success headings. The disclosure applies to prices and calculations;
symbols, thresholds and configuration remain declarations. Scores, bias, stops
and targets are illustrative diagnostics, not calibrated probabilities or
market-suitability evidence. Generic help and operator/CLI documentation describe
the generated inputs accurately.

## Compatibility and boundaries

Generation, seeds, calculations, numerical formatting, defaults, argument parsing,
filtering, ranking and configuration selection are unchanged. Equal-score order
was already unspecified by the map iteration and score-only sort. `scan` retains
its existing configuration reads and legacy-file migration effects; this change
does not make it a read-only CSV command. Supplied-CSV commands, their detailed
help, strategy APIs, provider paths and dashboard behavior are unchanged. A
leading disclosure remains present even if a later command error occurs. These
legacy previews retain their existing output-write behavior; no atomic output,
latency or delivery guarantee is added.

No acquisition, trading, qualification, profitability or operating authority is
introduced. Existing runtime and production holds remain.

## Changed files and verification

- `cmd/gelt/main.go`: shared fixed disclosure and synthetic headings for the two
  generated-price previews.
- `cmd/gelt/offline_help.go`: accurate generic command descriptions.
- `cmd/gelt/synthetic_signal_presentation_test.go`: actual dispatch in owned child
  processes, symbol-only semantics, declared scan universe, empty results and help.
- `cmd/gelt/README.md` and `skills/gelt-operator/SKILL.md`: user and assistant
  provenance and unchanged local-configuration boundary.
- This specification records the bounded correction and evidence scope.

Working verification covers focused race-enabled presentation tests and the Go
race/vet/build/diff checks. Compiled baseline/candidate acceptance uses owned
synthetic fixtures and homes, disables child network access, compares numerical
output with only the intentional disclosure/heading changes, and preserves
unspecified equal-score permutations. It also checks unchanged detailed offline
help. Complete source/privacy reviews precede fresh final-head checks and normal
draft-PR/CI delivery. Source and synthetic acceptance establish only these
presentation and compatibility guarantees, not market or operating evidence.

## Current-source integration verification

The six-file labeling change is integrated with the current supplied-CSV,
unknown-command and version-output routes. Focused presentation tests, the full
Go race suite, vet, package/CLI builds and static diff checks passed using owned
isolated source, homes and resources. Fresh compiled current-source baseline and
candidate cases preserve complete status/streams after only the intentional
labels and permutations within equal-score groups. They cover default/custom
signals, default/configured/invalid-generated-series/empty scans, threshold
parsing, generic help, all eleven supplied-CSV detailed help bodies, version,
no arguments and the fixed unknown-command diagnostic.

The private compatibility oracle was strengthened to reject reordered unequal
score groups, with an owned counterexample. The affected candidate checks passed
against retained fresh baseline observations; no baseline processes were repeated.
These are finite synthetic compatibility checks, not independent indicator
mathematics, hostile-process containment or a market/operating evaluation.
Fresh exact-integration source/privacy review and final-head checks remain the
subsequent publication gates.
