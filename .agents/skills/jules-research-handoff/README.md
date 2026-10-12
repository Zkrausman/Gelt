# Jules Research Handoff Skill Package (`jules-research-handoff`)

Standardizes read-only Jules research sessions and ensures their validated findings are persisted through a ticketed documentation PR before the human archives the session.

## Lifecycle

```mermaid
graph LR
    A[Dispatch read-only Jules research] --> B[Structured report]
    B --> C[Parent validates against master]
    C --> D[Save docs/specs report]
    D --> E[Draft completion specification]
    E --> F[Fresh independent + adversarial review]
    F -->|Findings| G[Remediate and repeat both reviews]
    G --> F
    F -->|Both clean| H[Final verification, commit, push, open ticketed PR]
    H --> I[Confirm PR URL and mergeability]
    I --> J[Confirm merged commit on master]
    J --> K[Tell human to archive Jules conversation]
```

The parent agent owns persistence, the complete `ticket-delivery` review loop, and reporting. Jules owns research only. Any report, specification, or other ticket artifact change restarts fresh final reviews and final verification. The human retains the conversation until the associated PR is merged.
