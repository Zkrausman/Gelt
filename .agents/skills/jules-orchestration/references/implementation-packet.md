# Jules Implementation Packet

Use this packet for every new Jules implementation dispatch. It is a parent-side control: complete it before dispatch, place its applicable content in the provider prompt, and retain it with the ticket evidence. Do not use it for read-only research sessions.

## 1. Scope contract

- **Ticket / base / branch:** one Linear ticket, current `master` base SHA, and one named branch.
- **Goal:** one bounded behavior change stated as an observable outcome.
- **Allowed files/packages:** explicit paths or packages Jules may change.
- **Forbidden scope:** adjacent tickets, unrelated cleanup/refactors, helper scripts, generated files, and production changes outside the allowed scope.
- **Change budget:** minimum files and tests needed. New source files require a stated reason; temporary scripts and repository-root artifacts are prohibited.
- **Safety boundary:** enumerate prohibited brokers, credentials, network calls, VM/SSH activity, deployment, live trading, merges, and Linear updates as applicable.

## 2. Acceptance matrix

Provide a small, testable table in the dispatch prompt:

| Invariant | Required proof | Failure behavior |
| --- | --- | --- |
| `<safety or functional invariant>` | `<named deterministic test or command>` | `<safe failure outcome>` |

Every invariant must have deterministic, offline evidence. State the exact expected behavior for invalid, unavailable, stale, malformed, or empty inputs when applicable. Do not leave "degraded" or "fallback" behavior ambiguous.

## 3. Test and environment contract

- List focused tests first, then required repository-wide checks. Every implementation packet and its PR verification evidence must include `go test -race ./...` as required by `AGENTS.md`; it is mandatory even when the changed files are documentation or agent guidance.
- State toolchain/platform constraints known to affect verification.
- Tests must not require real services, root privileges, systemd, network access, credentials, or broker access.
- Prefer pure tests or contract/static checks for deployment artifacts. If a mock is necessary, it must be confined to a test temp directory and validate an observable outcome—not merely command invocation.
- Require `git diff --check`, `git status --short`, and removal or explicit disposition of all temporary, untracked, and out-of-scope artifacts before PR publication **and immediately before merge**. An unresolved artifact is a merge stop.

## 4. Milestone gates

1. **Plan gate:** map every acceptance invariant to a target file and a named test; identify any ambiguity before editing.
2. **Implementation gate:** stay within the allowed-file list and change budget. Stop and report when a required change exceeds either.
3. **Focused verification gate:** run the named focused tests after implementation; fix root causes before broader tests.
4. **Pre-review verification gate:** run the exact required commands, inspect complete output and exit status, then run diff/status hygiene checks. This evidence informs review; it is not final acceptance.
5. **PR gate:** publish exactly one draft PR from the designated branch only after all pre-review gates pass. If publication fails, retain the branch and report the blocker; do not create a replacement branch or PR. Draft the completion specification before final review. After both final reviews are clean, rerun the required commands as the final verification gate before merge.

A failed gate is a stop-and-report condition, not permission for speculative workarounds or adjacent refactors.

## 5. PR and review protocol

This is the same closed-loop acceptance protocol as local ticket delivery; the only Jules-specific difference is that Jules performs assigned changes on the ticket branch while the parent monitors and waits.

- One Jules session owns one ticket, branch, and draft PR. Remediation updates that same PR; the parent resolves conflicts locally if Jules cannot.
- The PR description must identify the ticket, acceptance invariants, changed files, and commands actually run.
- Jules may perform a self-check, but it is never an acceptance gate. The parent builds the shared `ticket-delivery` review packet (SHA/base, manifest/stat, targeted patch, named seams/tests, invariants, evidence, and remediation delta) and runs both a fresh independent review and a fresh adversarial review of the actual first PR/head SHA. Reviewers inspect only packet-named evidence and request exact missing seams rather than rediscovering repository scope.
- If either review has blocker/high findings, send one consolidated GitHub remediation comment naming exact paths, violated invariants, required proof, and rerun commands. After each head SHA or completion-specification change, repeat both fresh reviews. Continue until both final reviews explicitly report no blocker/high finding; escalate an unresolved material design decision rather than silently waiving it.
- Draft the completion specification before final review. Run final required verification only after the final clean reviews. A clean review becomes stale when any ticket artifact changes, including code, tests, configuration, documentation, prompts, skills, generated/operational artifacts, or the completion specification.
- Bind final acceptance to the exact reviewed PR head SHA and target-base SHA. Immediately before merge, confirm both remain unchanged, the PR is mergeable, and no merge-queue/conflict-resolution tree or artifact has changed; otherwise restart final reviews and verification.

## 6. Parent monitoring metrics

Record for each implementation session: plan time, first-change time, first-PR time, activity-event count, PR count, review rounds, out-of-scope artifacts, and final verification outcome. Treat more than one PR, an untracked artifact, repeated plan changes, or a stalled milestone as an efficiency/risk signal requiring intervention.
