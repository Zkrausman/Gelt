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
An existing destination continues to prevent its legacy source from being
renamed. The migration does not promise an atomic multi-file transaction or
protection against concurrent directory namespace changes.

## Changed files and verification

- `pkg/config/app_config.go`: stop migration when either destination directory
  helper fails.
- `pkg/config/legacy_migration_test.go`: use disposable homes and working
  directories to cover journal and daemon directory obstructions, preserve all
  legacy bytes, reject relative working-directory destinations, and retain
  successful mappings and existing-target behavior.
- This specification records the scope and its limits.

Checks are recorded in the private delivery handoff. No real user home,
configuration, journal or daemon files are used. This storage-path correction
does not change trading behavior or grant operating authority.
