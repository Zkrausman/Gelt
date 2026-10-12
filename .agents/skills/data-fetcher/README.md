# data-fetcher Skill Package (`data-fetcher`)

Skill for retrieving external market, macro, or telemetry data.

## Architecture

```mermaid
graph TD
    SkillMD[".agents/skills/data-fetcher/SKILL.md"] --> Scripts[".agents/skills/data-fetcher/scripts/"]
    SkillMD --> Refs[".agents/skills/data-fetcher/references/"]
    SkillMD --> Examples[".agents/skills/data-fetcher/examples/"]
```

## Description
Provides instructions for fetching and caching macro, market, and telemetry data.
