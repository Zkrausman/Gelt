---
type: skill
status: active
dependencies: []
command: ./scripts/check-frontmatter.sh
---

# OKF Frontmatter Validator

## Agent Instructions

**When to use this skill:**
Use this skill to ensure all documentation files comply with the Open Knowledge Format (OKF) by checking for valid YAML frontmatter.

**How to use this skill:**
1. Execute the `command` specified in the frontmatter.
2. If the script fails, identify the missing or malformed frontmatter in the reported files and fix them.
3. Rerun the script until it exits successfully.
