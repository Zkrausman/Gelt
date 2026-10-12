# Jules Orchestration Skill Package (`jules-orchestration`)

Coordinates the Gelt parent-agent workflow around Jules sessions and makes human handoffs explicit.

## Lifecycle

```mermaid
graph LR
    A[Dispatch ticket] --> B[Monitor Jules]
    B --> C{Research or code?}
    C -->|Research| D[Validate and persist report PR]
    C -->|Code| E[Build bounded review packet and run fresh reviews]
    D --> F[PR merged on master]
    E -->|Blocker/high finding| G[Remediate on same branch]
    G --> E
    E -->|Both final reviews clean + final verification| F
    F --> H[Report archive eligibility]
```

All user-facing updates include separate **Your actions** and **Status updates** tables.

Ticket acceptance is identical for local and Jules implementation: implement, verify, build an actual-diff review packet, fresh independent and adversarial review, remediate, repeat review after every change, then final verification. The packet constrains repository discovery to changed files and named seams without weakening review criteria. Jules only supplies an external implementer/remediator and requires parent monitoring while that work runs.
