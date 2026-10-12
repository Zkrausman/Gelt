# db-seeder Skill Package (`db-seeder`)

Skill for populating local test SQLite databases and trade journal data.

## Architecture

```mermaid
graph TD
    SkillMD[".agents/skills/db-seeder/SKILL.md"] --> Scripts[".agents/skills/db-seeder/scripts/"]
    SkillMD --> Refs[".agents/skills/db-seeder/references/"]
    SkillMD --> Examples[".agents/skills/db-seeder/examples/"]
```

## Description
Seeds local database tables and trade journal fixtures for offline backtesting and integration testing.
