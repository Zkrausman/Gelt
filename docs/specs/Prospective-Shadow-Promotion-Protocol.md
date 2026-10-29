---
type: planning-specification
title: "Prospective shadow evidence and promotion decision protocol"
status: proposed-protocol-documentation-only
implementation_status: not-implemented
date: 2026-10-28
---

# Prospective shadow evidence and promotion decisions

This protocol defines the evidence package and decisions to prepare **before** a
separately authorized observation. It implements no evaluator, scheduler,
promotion mechanism or operating policy. A valid rejection or an honest
insufficient-evidence result is a useful outcome. No strategy is selected or
declared eligible here.

Current disposition: **qualification NOT_READY; production CLOSED; operations
DEFER; SPY253 C07/C13/C14 UNKNOWN**. No acquisition, provider/account call,
qualification, actual shadow/simulator/paper/live campaign, capital allocation,
credential/security change or held retry is released. Publishing this protocol
does not populate missing case parameters or designate an operational supplier.

## Governing records and shipped capability

This is the bounded evaluation/observation protocol preparation called for by
[ZAR-209](ZAR-209-Research-to-Shadow.md) and the [roadmap](../ROADMAP.md), not a new
research epic. ZAR-209's execution-first MVP sequencing gate for actual
conversion/research operation remains intact. Separately approved source slices
are not acceptance of that MVP or permission for an actual campaign.

| Existing evidence | What it supports | What it does not supply |
| --- | --- | --- |
| [PR26 baseline integration](https://github.com/Zkrausman/Gelt/pull/26) / [specification](Candidate-Shadow-Synthetic-Integration.md) | Fixed G05 baseline candidate, configured synthetic lifecycle, durable simulated outcomes and protected read/reopen. | General paper conversion, actual market observation, qualified runtime or broker settlement. |
| [PR27 PAMR conversion](https://github.com/Zkrausman/Gelt/pull/27) / [fidelity specification](Selected-PAMR-Conversion-Fidelity.md) | Selected mathematical recipe and inert artifact, with explicit reference/rights/runtime limitations. | Execution of the unchanged rejected reference, full reference/dependency closure, strategy edge or trading admission. |
| [PR28 fixed consumer](https://github.com/Zkrausman/Gelt/pull/28) / [specification](PAMR-Synthetic-Consumer.md) | Constructed risk/reserve quarter-scale adaptation, exact sizing, once-only prefix consumption and simulated lifecycle evidence. | Calibrated costs, actual positions/fills or admission of non-constructed inputs. |
| [PR29 finite inspection](https://github.com/Zkrausman/Gelt/pull/29) / [specification](SPY253-PAMR-Inspection.md), merge [`448a9e9`](https://github.com/Zkrausman/Gelt/commit/448a9e9249b17674a3a60ddd9dd05d9e5cbe3ee9) | Inspect all 253 original closes, select newest 65 structurally compatible closes, derive 64 exactly representable adjacent relatives and an inert post-window artifact. | Actual eligibility/completion/availability, full 252-relative history, 64 independent trades or activation of PR28's constructed consumer. Repeating/oversized ratios reject without rounding. |

The [automatic-lifecycle goal](Automatic-Strategy-Lifecycle-Goal-Clarification.md)
retains eventual automatic promotion, demotion and stopping without routine
manual per-strategy management. Its implementation remains separately scoped.
Legacy epic approval labels, profit-factor/trade-count examples, VaR values and
demotion numbers are historical material, **not adopted criteria** for this
protocol. Neither an old flag nor an alert/CLI path admits the current V2 system.

## Three independent claims

1. **Technical control readiness:** a bounded implemented mechanism correctly
   enforces its approved identity, risk, transition, halt and recovery contract.
2. **Strategy evidence:** an exact candidate satisfies a prospectively frozen
   evaluation policy with adequate, trustworthy observations and disclosed limits.
3. **Permission to transact:** the owner has explicitly released the applicable
   operating scope, accounts, capital and independent execution controls.

No claim substitutes for another. A correct mechanism can promote nothing; good
metrics cannot authorize a transaction. A future approved global policy may
automate eligible transitions without routine per-strategy clicks, but this
document supplies neither that implementation nor its initial live release.

## Case registration to freeze before observation

The following are **proposed required fields**, not an implemented schema.
Each value needs its evidence locator, version/digest and accountable supplier.
An unfilled required field is explicitly UNKNOWN and blocks case admission.
Hashes bind recorded bytes; they do not authenticate their authors or truth.

| Registration group | Exact content and acceptance rule |
| --- | --- |
| Identity and claim | Case ID and protocol revision; exact hypothesis and intended decision; candidate/source/recipe/parameters/initial state and adaptation versions. State whether the claim is a baseline, selected PAMR adaptation or another separately approved case. No arbitrary code selector or implicit promotion target. |
| Input transformation | Exact original-to-derived lineage, instrument/currency/feed/adjustment/as-of convention, history selection, ordering, decimal/rational representation and rejected-input policy. For PR29 reuse, disclose 253→65→64, initialization, decimal rejection and inert-only classification. Do not silently enlarge history, round rejected ratios or relabel market input as constructed. |
| Data and causal time | Exact proposed observation window, calendar, eligible-session/completion convention, decision cadence and availability deadline; actual receipt/order/clock evidence and revision policy. Distinguish a post-window calculation, historical replay and future observation. A later download cannot prove earlier decision availability. Frozen historical SPY253 dates are not a current observation window. |
| Research separation | Training/calibration, validation and untouched evaluation boundaries; selection register including failed variants; hypothesis, metrics, baselines, decision rules and uncertainty method fixed before evaluation results are inspected. Prior inspection or tuning contamination must be disclosed; affected results cannot be relabeled untouched or prospective. |
| Costs and comparison | Explicit fee/spread/slippage/liquidity/fill assumptions, calibration evidence and stress variants; capital, cash, position and reservation conventions. Define the cash/passive or other justified comparator on compatible time, input and cost conventions. A declared fixture cost, close price or requested quantity is not a calibrated fill. |
| Observation adequacy | Defined sampling unit, dependence/overlap treatment, intended duration and information/sample requirement, uncertainty reporting, missingness policy and rationale for the chosen claim. Record candidate selection/multiple-testing limits. There is no universal trade count or duration here; 64 updates are not 64 independent observations or evidence of power. |
| Quantitative decision policy | Case-specific metric definitions, acceptance/rejection criteria and justified cutoffs, supplied by the accountable research/risk policy roles and independently reviewed. Explicitly define undefined/no-trade/zero-loss-denominator behavior; do not treat an undefined profit factor as a passing infinity. No numeric policy is chosen by this document. |
| Finite operation and handling | Separately approved inputs/recipients/copies/lifetimes, exact resource/event/page/byte/time ceilings, allowed outputs and retention/exposure policy, deployed closure and reviewer/handling admission. No unlimited polling, hidden data export or assumption that Linux/same-process execution is a trust profile. |
| Controls and evidence | Actual producer/evaluator/acceptor/clock/settlement custodians; immutable run/config/policy identities; stop/reconciliation procedures, durable records, review independence, failure and restart evidence. Define bounds without adopting a new engine/store or restoring spent capabilities. |
| Authority | Exact scope approval and operating exclusions; separate qualification and any later transaction release. A protocol digest, configured flag, successful source test or self-signed declaration grants no authority. |

Changing candidate, transformation, costs, comparator, metric definitions,
decision rules, window or other material policy creates a new registration
revision/epoch. Preserve the prior record and why it changed. Do not extend a
window until a result passes, cherry-pick completed winners or remove failed
variants from the selection register. Any planned sequential decision or interim
analysis must have its stopping/selection implications specified beforehand.
Safety stopping is allowed only under its separately approved procedure and
does not make a shortened observation satisfy its original statistical plan.

## Readiness gates and actual suppliers

These are evidence requirements for a later approval, not commands to execute.
The Gelt source owner prepares and reconciles the packet; the owner is not asked
to assemble code, credentials or private exports. Supplier roles below are not
invented provider guarantees or assignments to unnamed operators.

| Gate | Evidence required before progression | Current dependency / accountable role |
| --- | --- | --- |
| R0 — scope and case | One frozen registration with complete required fields and exact allowed operation. | Protocol documentation can proceed now. Actual case selection and quantitative policy are unestablished; source owner prepares the concrete proposal, research/risk policy acceptors must be identified. |
| R1 — candidate fidelity | Reviewed equations/implementation/adaptations, source/dependency/rights limitations and a compatible artifact/consumer contract. Independent fidelity evidence appropriate to the actual claim. | PR26–29 provide bounded source evidence only. Actual candidate acceptance and nonfixture consumer connection are not established; source owner owns technical evidence. |
| R2 — inputs | Applicable original-object/private-completion review, all sixteen checks and actual input-policy evidence; rights, calendar, availability, completion/revision handling and transformations compatible with the case. No favorable use of UNKNOWN. | C07/C13/C14 remain UNKNOWN. Account-specific facts, where genuinely needed, come from the applicable account owner; provider documentation alone is not actual observation/authentication. No blanket agreement/key request. |
| R3 — runtime and handling | Identified actual components/custodians, supported deployed closure, independent reviewer admission, finite exposure/copy/lifetime enforcement, clocks/order, cancellation, complete applicable settlement/release and own acknowledgement. | Actual operational supplier/acceptor and qualified profile remain unadmitted. Linux selection, GC, reference drop, foreground exit or static privacy review do not qualify these facts. |
| R4 — economic/evaluation policy | Complete cost/comparator/calibration/stress basis, causal separation and justified adequacy/decision criteria frozen independently of outcomes. | Research/risk/calibration evidence suppliers are not established by synthetic fees or legacy thresholds. No criteria are filled by default. |
| R5 — bounded durable consumer | Compatible admitted identity through actual authorized consumer; every decision/abstention, requested term and observed simulated execution has complete durable lineage. Qualification must cover duplicate, partial, cancellation, uncertainty, corruption and restart boundaries. | Existing synthetic lifecycle/fences are source conformance only. PR29 is deliberately rejected by the PR28 constructed consumer; source tests do not clear this dependency. |
| R6 — observation and assessment | Separately authorized finite observation completed or stopped honestly; complete selected/failed/censored records, uncertainty, all adverse receipts and independent assessment of predeclared criteria. | No actual campaign/result or sufficient observation time is established. A source merge or passing fixture is not prospective evidence. |
| R7 — promotion controls | Separately approved, implemented and qualified control transition with versioned policy, risk/capital/portfolio limits, monitoring, safe halt/demotion/reconciliation and recovery acceptance. | The future product goal is not implementation or qualification. Stopping new orders, canceling an order and managing existing positions are distinct operations. None is released here. |
| R8 — live release | Explicit owner-controlled initial operating/transaction release with applicable account authority and independent execution checks. | NOT AUTHORIZED. Evidence completeness or a recommendation cannot supply this release. |

R0–R5 must be satisfied for the **specific** proposed observation before it can
be admitted; their documentary existence is insufficient. R6 can only describe
an actually authorized observation. R7/R8 remain independent requirements for
any later live promotion. No source-only path may set C07/C13/C14 to pass or
manufacture a new factual supplier to make these gates appear ready.

## Records, uncertainty and bounded decisions

A proposed case record must bind the registration, candidate and input versions
to every decision, including abstentions/no-action and rejected inputs. Retain
requested terms separately from observed simulated fills, marks, fees, cash,
positions and reservations. Every presented value identifies its model and data
basis. Shadow fills remain simulated; they are not broker-confirmed executions
or actual account holdings. Missing data cannot be replaced with synthetic
production telemetry. Logs, notifications and matching JSON/digests cannot become
the authoritative execution or admission journal.

The future evidence supplier must demonstrate ordering, completeness and restart
behavior within its accepted bounds. Reopen/read replay cannot restore a spent
capability, clear dispatch UNKNOWN, duplicate a fill or acquire permission to run
again. Reproducing authorized inert data is distinct from replaying an uncertain
effect. Corruption or conflicting joins retain evidence and ownership fences;
they cannot be repaired into a favorable result by a reader. New evidence or a
provider correction is versioned and assessed for applicability without deleting
the prior observation or hiding a contradiction.

Preserve the existing original-byte kernel's closed sixteen-check/reason space,
private completion, single-use reservation, additive receipts **R**, current
settlement **C**, immutable sole emission **E** and separate own acknowledgement.
This protocol adds no wire fields, emits no status and permits no second emission,
recapture, resend or unknown-outcome retry. Later contradictions may invalidate
current favorable interpretation without rewriting the original artifact.

Proposed assessment outcomes carry **no effect authority**:

| Outcome | Meaning and required treatment |
| --- | --- |
| `NOT_READY` | A required registration, authority, input, consumer or qualification gate is missing before observation. List the exact dependency and supplier; do not start a run. This is the present operating disposition. |
| `INVALIDATED` | Contradiction, broken provenance, missing required integrity/order or uncertain execution prevents reliable interpretation. Retain adverse evidence; follow only an independently authorized stop/reconciliation procedure. No positive recommendation or automatic repair/retry. |
| `INSUFFICIENT` | No established integrity failure, but the available valid observations or uncertainty/calibration basis cannot support the preregistered decision. Report what is missing; do not shrink criteria or silently extend the window. |
| `REJECTED` | Valid applicable evidence establishes a preregistered rejection condition. Preserve the failed case and limits. An unsafe or insufficient case cannot be relabeled a clean quantitative rejection merely to claim a completed evaluation. |
| `EVIDENCE_COMPLETE_FOR_REVIEW` | All applicable evidence/adequacy requirements and predeclared evaluation criteria are met, with limitations and independent assessment recorded. This permits review of the evidence package only; it is not strategy promotion, technical control readiness or permission to transact. |

Established integrity/authority defects block any positive classification.
Where evidence cannot decide between rejection and insufficiency, retain the
uncertainty and use `INSUFFICIENT`; preregistration must specify the case's
quantitative decision logic. Missing values, no trades, selectively closed trades
or an undefined ratio never become an automatic pass. The December 31 target
does not alter evidence standards or create an observation window of adequate
length. No profitability, completion probability or deadline is guaranteed.

## Documentation acceptance and next concrete dependency

The [PAMR A64 proposed case registration](PAMR-A64-Proposed-Case-Registration.md)
fills known source bindings and names concrete identity/ordinal/window gaps. Its
engineering objective is selected for preparation only. Actual suppliers,
consumer and policy remain unadmitted; no case, operating policy or observation
is accepted by that proposal.

This planning slice is acceptable only if reviewers can trace the gates and
case-record fields to the existing source/goal boundaries, verify that no legacy
numeric threshold is adopted, distinguish all three promotion claims, and show
that missing/contradicted/insufficient evidence cannot become permission. The
tables above are decision examples/requirements, not observed strategy outcomes.
They require no campaign or product test to be written or run here.

The next concrete input is **one proposed case registration**, prepared by the
Gelt source owner from existing candidate contracts and evidence. It must present
the actual case/claim, compatible consumer boundary, quantitative policy and
adequacy rationale with named evidence suppliers or explicit missing facts.
Known PR29 lineage and finite limits may be reused; its historical window,
constructed fees and 64 updates cannot fill actual availability, calibration,
sample adequacy or operating admission. No source/qualification approval should
be requested until its exact deliverable and prerequisites are concrete.

Before an actual observation can be proposed for approval, the essential external
dependency remains an identified supported runtime/handling/acceptor binding and
accepted applicable input/economic policy. That is not supplied by a document or
a request for the user to code/produce credentials. A future source validator,
consumer adaptation, qualification operation or campaign needs its own bounded
authority; none is implemented or released by this protocol. Full remaining
planning/review/implementation, qualification and observation effort is UNKNOWN;
completed estimates and overlapping historical ranges must not be summed.

## Change and verification boundary

Changed files are this protocol, an additive roadmap link/current planning section
and an additive ZAR-209 protocol link. Existing history, legacy epics, product
source, tests, inventory, dependencies and workflows remain unchanged. This
document is a specification/completion draft for documentation only, not an
implemented schema or adoption of an operating policy.

Applicable documentation checks cover the exact three-file scope, preserved
original bytes outside the two insertions, frontmatter, relative links/anchors,
private-path/credential exclusions and all stated CLOSED/UNKNOWN boundaries.
Go race/vet, whitespace/status, fresh independent and distinct adversarial
accuracy/privacy reviews, exact-head verification and ordinary draft PR/CI/merge
with remote proof remain delivery gates. The unchanged V2 workflow path filter
does not select these documentation-only paths; no source, browser, provider or
qualification suite is rerun solely for this protocol. Publication receipts
belong to the PR/delivery record; no formal GitHub approve action is granted.
