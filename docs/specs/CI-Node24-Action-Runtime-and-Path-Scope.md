---
type: specification
title: "Gelt CI: Node 24 action runtime and V2 path-scoped checks"
status: implemented-pending-hosted-validation
scope: "GitHub Actions only; no trading or runtime feature change"
changed_files:
  - .github/workflows/v2.yml
  - docs/specs/CI-Node24-Action-Runtime-and-Path-Scope.md
---

# CI action-runtime update and shipping scope

The owner wants less friction shipping small Gelt tickets. The V2 Windows gate takes roughly 17–19 minutes even for Go-only V1 backtesting changes; it did not exercise their changed files. We **retain** CI rather than remove it: `.github/workflows/ci.yml` still builds, race-tests and vets Go on every PR and push to `master`. Both V2 jobs retain their existing tests, build, smoke, native Windows transport and private NTFS checks when V2 or its workflow changes.

## Implemented behavior

- Upgrade both `actions/setup-node` invocations in `.github/workflows/v2.yml` from v4 (Node 20 action runtime, deprecated warning) to v5 (Node 24 action runtime). The installed application/test `node-version: '22'` is **unchanged**, as required by the additive V2 charter and native Windows prerequisite; an app-runtime upgrade to Node 24 requires a separate compatibility test and authorization. `actions/checkout@v5` and `actions/setup-go@v6` are already present.
- Run `V2 offline foundation` on PRs targeting `master` and pushes to `master` only if paths under `v2/**` or `.github/workflows/v2.yml` change. Workflow changes trigger the full Linux and Windows V2 jobs themselves. Go-only V1 PRs therefore wait for the Go gate, not the unrelated V2 Windows gate. Mixed Go+V2 changes trigger both workflows.
- This is **not** an isolation or merge-approval change. A GitHub branch-protection rule requiring the V2 job on *every* PR would leave path-filtered PRs waiting for a skipped check; configure such rules for path scope or revisit filtering before enabling them. At implementation, the private repository's branch-protection API returned HTTP 403 (GitHub plan limitation), so no enforceable protected-check state is claimed.

## Verification and evidence boundary

- `GOPROXY=off go test -race ./...` passed at the merge base with this workflow edit; `git diff --check` passed.
- Diff self-review: only the two setup-node action versions and event path selectors change; no runner, V2 test command, toolchain version, secrets, release/deployment or broker path is changed.
- Hosted PR checks at the exact published head must verify that the workflow **does** run for its own change, including the native Windows job. A later V1-only PR can verify the negative path-filter case. Neither future check is claimed by these local results.
