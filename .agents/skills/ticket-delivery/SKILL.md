---
name: ticket-delivery
description: Required closed-loop implementation, adversarial review, remediation, and verification workflow for every ticketed Gelt change, whether implemented locally or through Jules.
---

# Ticket Delivery

Use this skill for **every ticketed Gelt implementation**, including local parent-agent changes, Jules implementation sessions, and ticketed documentation/process changes. There is one acceptance loop for all tickets. Jules changes only *who performs an assigned implementation/remediation step and how the parent waits for and monitors that work*; it does not create a different acceptance standard. This skill does not apply to read-only research until that research becomes a ticketed documentation change.

## Required closed loop

A ticket is not ready to report, publish, merge, mark Done, or hand off until this exact loop completes:

1. **Implement** — stay within the ticket’s approved scope and safety boundary.
2. **Verify** — run focused deterministic tests, then `go test -race ./...`, `go vet ./...`, `git diff --check`, and inspect `git status --short`. Remove or explicitly account for every untracked or out-of-scope artifact before review; unresolved artifacts block publication and merge.
3. **Build review packet** — the parent creates the actual-diff packet required by `references/review-packet.md`: review SHA/base, changed-file manifest/stat, targeted patch, named seams/tests, acceptance invariants, verification evidence, and prior-finding/remediation delta.
4. **Fresh independent review** — a read-only reviewer inspects the review packet and the actual supplied diff from fresh context. It checks functional correctness, regression risk, scope, tests, and maintainability.
5. **Fresh adversarial review** — a distinct read-only reviewer uses the same packet to challenge trading, risk, telemetry, security, concurrency, and operational failure modes.
6. **Remediate** — one writer applies every accepted blocker/high finding. Escalate unresolved product, safety, authority, or architecture decisions instead of guessing.
7. **Repeat review** — after **every** remediation change, build a remediation-delta packet and run fresh independent and adversarial review against the resulting diff. Repeat remediation and review until both reviews report no blocker/high finding.
8. **Closeout draft** — update `docs/specs/<TICKET>.md` with changed files, review evidence, and verification evidence. This is an implementation change, so it must occur **before** the final review.
9. **Fresh final review and verification** — build a final packet covering the complete final changed-file set and closeout specification, then run both fresh reviews. Only after both explicitly report no blocker/high finding, rerun the required verification suite. For a PR, record the exact reviewed head SHA, target-base SHA, and mergeability; immediately before merge, confirm all three remain unchanged/mergeable. Any head, base, merge-queue, conflict-resolution, or artifact change restarts final review and verification. Only then may PR/Linear/merge workflow proceed.

Passing tests never replace the final fresh review. A clean review is stale as soon as **any ticketed artifact** changes, including code, tests, configuration, documentation, prompts, skills, generated/operational artifacts, or the completion specification; repeat the final-review-and-verification stage after every such change.

## Review independence

- Reviewers are read-only and must not approve their own implementation or remediation.
- Use fresh context and the parent-built actual-diff review packet, not the implementer’s summary alone.
- Reviewers inspect only the packet patch plus its named changed files, seams, and tests; no repository archaeology (`ls`, `find`, root scans, broad grep, `.git` inspection, or unrelated reads).
- A reviewer who needs more evidence requests the exact path/invariant; the parent supplies it or the review returns `REVIEW_BLOCKED_EVIDENCE_GAP`. An unresolved request is a merge and Linear-Done stop, never a clean review. The reviewer must not hunt for scope on its own.
- Independent review checks functional correctness, regression risk, scope, tests, and maintainability.
- Adversarial review checks risk boundaries, fail-closed behavior, concurrency/TOCTOU, telemetry truthfulness, credentials, broker/live-order boundaries, promotion, and operational claims.
- Report findings with severity, exact file/line evidence, the violated invariant, and the smallest safe remediation.
- “No blocker/high findings” must be explicit. Optional suggestions do not require another loop unless accepted and implemented.

## Jules integration

For a Jules ticket, use the **same nine steps above**. Jules may perform the assigned implementation or remediation step on the same branch/PR; the parent waits, monitors, independently reviews, supplies consolidated remediation, and runs final verification. A new PR head SHA starts a new review cycle. Never merge based only on Jules self-review or CI.

`jules-orchestration` adds provider lifecycle and human reporting requirements; it does not replace or weaken this acceptance loop. When instructions differ, this closed-loop acceptance rule is stricter and wins.

## Stop rules

Stop and escalate rather than close out when review reveals live broker/order behavior, synthetic or misleading telemetry, unapproved promotion/activation, credentials, a scope breach, unresolved risk guardrail conflict, or a failed required command.

## Current platform scope

Owner instruction dated 2026-10-13 makes Gelt delivery Linux-only. Apply the full
closed loop to Go build/race/vet, Linux V2 tests/build/smoke, scientific and the
applicable protected-browser gates. Windows compatibility is unsupported legacy
work and is not a release gate; retain its security code/assertions and unresolved
receipts accurately. No unsafe or platform-independent defect is waived. No
repository protection/admin setting may be bypassed or altered to implement
this scope. Any future platform-support expansion needs its own approved review
and exact native verification.
