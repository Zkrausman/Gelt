# Gelt Antigravity Agent Bridge (`pkg/agent`)

The `pkg/agent` package provides the multi-turn agentic client bridge and session manager connecting Gelt to the Antigravity Agent API.

## Architecture & Component Topology

```mermaid
graph TD
    ClientBridge["Agent Client Bridge<br>[pkg/agent/antigravity.go]"]
    Types["Interaction Types & Schemas<br>[pkg/agent/types.go]"]
    RemoteAPI["Antigravity Agent API Server"]

    subgraph Tool_Bindings["Local Tool Execution Bindings"]
        JournalTool["ReadShadowJournal<br>[~/.gelt/journals/shadow_journal.json]"]
        RegimeTool["WriteRegimeMatrix<br>[~/.gelt/regime_matrix.json]"]
    end

    ClientBridge --> Types
    ClientBridge -->|HTTP POST JSON| RemoteAPI
    RemoteAPI -->|ToolCalls Payload| ClientBridge
    ClientBridge --> JournalTool
    ClientBridge --> RegimeTool
```

## Features

- **Multi-Turn Execution Loop**: Automatically handles agent tool calls (`ReadShadowJournal`, `WriteRegimeMatrix`) up to a 10-turn safety ceiling.
- **Path Traversal Protection**: Restricts shadow journal reads strictly to `~/.gelt/journals/shadow_journal.json`.
- **Thread-Safe Regime Persistence**: Obtains `macro.MatrixMutex` write-locks when updating macro regime matrices.
- **Cross-Platform Compatibility**: Fully tested across Windows (`USERPROFILE`) and Unix (`HOME`) environments.
