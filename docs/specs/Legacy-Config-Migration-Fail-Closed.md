---
type: Specification
title: Fail closed on legacy config migration directory errors
description: Prevent failed journal or daemon directory creation from turning legacy migration destinations into relative paths.
timestamp: 2026-11-16T00:00:00Z
---

# Fail closed on legacy config migration directory errors

`MigrateLegacyFiles` creates `~/.gelt/journals` and `~/.gelt/daemon` through
helpers that return an empty path when directory creation fails. The migration
previously ignored those errors and built destination paths anyway. With an
empty directory path, a journal or daemon destination can resolve relative to
the process working directory.

The migration now returns before building its mapping or attempting any rename
when either directory helper fails. Because both directory checks precede the
rename loop, all legacy root files remain in place on either failure. The public
void API and caller behavior remain unchanged.

When both directories are available, the existing mappings remain unchanged.
The existing `os.Stat` destination check continues to prevent the legacy source
from being renamed when the destination is stat-visible. A dangling symlink may
be treated as absent by `os.Stat`; this correction does not change that existing
behavior. The migration does not promise an atomic multi-file transaction or
protection against concurrent directory namespace changes.

## Changed files and verification

- `pkg/config/app_config.go`: stop migration when either destination directory
  helper fails.
- `pkg/config/legacy_migration_test.go`: use disposable homes and working
  directories to cover journal and daemon directory obstructions, preserve all
  legacy bytes, reject relative working-directory destinations, and retain
  successful mappings and existing-target behavior.
- This specification records the scope and its limits.

The isolated focused race test `go test -race ./pkg/config -count=1` passed
(`ok gelt/pkg/config 1.026s`). It used disposable HOME/cwd trees, a read-only
source mount and Go SDK, fresh task-owned cache/temp/module-cache directories,
and disabled network access. This test ran before the documentation-only
correction that clarified stat-visible destination behavior; the executable
source and test files were unchanged by that clarification. `gofmt -d` with the
project Go SDK and `git diff --check` also passed. The complete repository
release checks are run separately before publication.

An independent source review and a distinct adversarial review accepted the
corrected candidate after one Low wording issue was fixed: the existing-target
description now matches the `os.Stat` check and notes that dangling-symlink
behavior is unchanged. Their review found no remaining blocker, high, actionable
medium, or privacy finding. The final review covers this completion
specification as part of the complete changed-file set.

No real user home, configuration, journal or daemon files are used. This
storage-path correction does not change trading behavior or grant operating
authority.
