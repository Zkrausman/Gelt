# Review Packet

The parent builds one concise review packet before every independent or adversarial ticket review. The packet constrains discovery; it does **not** narrow acceptance criteria or permit a reviewer to ignore an in-scope safety concern.

## Required packet fields

```markdown
## Review identity
- Ticket: `<TICKET>`
- Mode: `initial | remediation-delta | final`
- Base SHA / reviewed SHA: `<base>` / `<head or working-tree>`
- Target base and merge context: `<branch/SHA or local-only>`

## Change evidence
- Changed-file manifest and diff stat: `<parent-generated>`
- Complete changed-file patch: `<parent-generated patch for every changed file>`
- Approved surrounding seams and tests: `<paths and why each is relevant>`

## Acceptance evidence
- Invariants to decide: `<testable functional and safety claims>`
- Parent verification already run: `<each command, explicit exit status, and concise terminal-result evidence>`
- Prior blocker/high findings and remediation delta: `<or none>`

## Review boundary
- Inspect the complete supplied changed-file patch plus only the named changed files, seams, and tests.
- Do not perform repository discovery (`ls`, `find`, root scans, broad grep, `.git` inspection, or unrelated file reads).
- If the packet lacks necessary evidence, request the exact missing path/invariant rather than hunting the repository. The parent **must** supply an in-scope request or the review is blocked; it cannot be recorded as clean or used for acceptance with an unresolved evidence gap.
```

## Packet construction

- Generate the manifest and stat from the actual base/head diff.
- Include the complete patch for every changed file. For a large diff, split it into ordered packet parts with file names, base/head identity, and integrity-preserving coverage of every changed hunk; the reviewer may inspect the named full changed file when a patch part is insufficient. Never omit a changed hunk from an acceptance packet.
- An **initial** packet covers the approved changed-file set and its direct seams/tests.
- A **remediation-delta** packet covers the latest delta, each affected invariant, and the original finding it resolves.
- A **final** packet covers the complete final changed-file set, closeout specification, every accepted remediation, and final acceptance invariants.
- Preserve the packet with ticket evidence or in the review prompt so the review is reproducible.

## Reviewer decision rule

Reviewers must issue an explicit blocker/high finding or explicit clean result from this packet. They may request a narrowly named additional file only when needed to prove a concrete in-scope concern. The parent supplies that evidence or the reviewer returns `REVIEW_BLOCKED_EVIDENCE_GAP`; an unresolved request is a merge and Linear-Done stop, never a clean result. The reviewer never expands scope by exploratory repository search.
