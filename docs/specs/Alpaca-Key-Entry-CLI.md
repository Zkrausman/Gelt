---
type: specification
title: "Alpaca key-entry CLI"
status: implemented-pending-independent-review
scope: "Explicit local credential provisioning only; no provider/account activation"
issue: "Owner-authorized local provisioning CLI boundary"
runtime: "Linux with trusted Node.js 22 and a separately built v2 worker"
changed_files:
  - v2/scripts/alpaca-key-entry.mjs
  - v2/worker/src/alpaca-key-entry-cli.test.ts
  - v2/package.json
  - docs/specs/Alpaca-Key-Entry-CLI.md
  - v2/IMPORT-MANIFEST.json
verification_scope: "Parent Node 24 safe CLI checks passed; Node 22 synthetic/full CI pending; no operator credential entry"
verification_evidence: "Parent reports Node 24 syntax/help/strict-argument/runtime-rejection/inert-import/actual-main delayed-I/O/deadline checks passed. Independent review found two deterministic test assertions, corrected in this revision; Node 22 synthetic/full CI rerun pending. No Node 22 operator-TTY acceptance claimed"
---

# Alpaca key-entry CLI

## Purpose and boundary

The standalone command gives an operator a narrow way to enter an Alpaca key ID
and secret into the already-reviewed local storage helper. It is not imported by
the application or worker startup path. Importing the script is inert. The CLI
does not accept credential input from command arguments, environment variables,
pipes, or files, and it does not validate a key with Alpaca or connect an
account. The unchanged helper performs a bounded readback of the newly written
file as part of its storage verification.

This software and synthetic-test delivery does not authorize actual credential
entry or provisioning. Any future real entry requires separate owner approval at
the time of action for the concrete trusted Node 22 binary, retained-lock
installation/build, canonical paths, and approved parent/broker metadata. The
maintainer prepares and checks the existing build and path/metadata state. The
owner provides only the essential action approval and enters both values at the
hidden TTY; file editing, permission changes, cleanup, and filesystem coding are
outside that interaction.

Run it from the repository root after a separate worker build:

```sh
cd v2
npm run build:worker
cd ..
node v2/scripts/alpaca-key-entry.mjs --data-dir /absolute/private-parent/alpaca-data --broker-vault-dir /absolute/private/broker-vault
```

The two path values are nonsecret absolute paths. The `--data-dir` target must
not exist, its existing parent must be a canonical current-user-owned `0700`
directory, and the broker vault must be a separate canonical current-user-owned
`0700` directory. Ancestors must pass the helper's owner/mode policy. The CLI
checks metadata only and rejects unsafe paths, symlinks, overlap, an existing
target, unsupported runtime settings, missing build output, and a non-dedicated
TTY before it requests either credential. The helper repeats the security
checks when it performs the exclusive write.

The command dynamically imports only the fixed script-relative compiled helper
at `v2/worker/dist/alpaca-iex-credentials.js`, after those preflight checks.
`npm run build:worker` is explicit; the CLI never builds, installs, downloads,
or recovers automatically. Use a trusted Node 22 binary and build tree, with
`NODE_OPTIONS`, `NODE_DEBUG`, `NODE_DEBUG_NATIVE`, `NODE_V8_COVERAGE`, and
`NODE_REDIRECT_WARNINGS` unset and no Node runtime flags. This boundary does not
protect against a compromised runtime, operating system, owner account, or
dynamically attached debugger.

Exit status `0` means help was displayed or the unchanged helper returned after
local storage. Status `2` means the arguments were invalid, `3` means the runtime
or launch settings were unsupported, `4` means preflight failed, `5` means the
worker build could not be loaded, and `6` means entry or its output ended in an
uncertain state. A redelivered signal can terminate the process with the
operating system's signal status instead of `6`.

## Entry and outcome handling

The command uses the existing `enterAlpacaKeyPairFromTty` helper without
changing its contract. It requires an interactive TTY for input and output,
available raw-mode controls, and no existing `data` or `readable` input
consumers. Both fields are hidden. The wrapper does not print key values, paths,
raw errors, or stack traces. It keeps stdout and stderr error guards installed
until tracked write callbacks settle and the queued error-event checkpoint has
completed. A write callback that does not settle within five seconds fails
closed; during entry, that failure is routed through the helper's existing
input-error path so terminal cleanup can run. The warning is drained before
the helper is invoked, and output failures after helper invocation are treated
as uncertain storage outcomes. In standalone mode only, process-lifetime stdout
and stderr listeners also swallow errors emitted after the scoped runner has
settled and force a nonzero exit code without terminating the process early.
Importing the module installs no listeners. The scoped runner itself only owns
errors through its tracked callback settlement and queued-event checkpoint.

Before entry, the CLI warns that interruption or an entry error may leave absent,
partial, or complete storage and instructs the operator to stop without retrying,
deleting, changing modes, revoking, or cleaning up. The helper restores terminal
state and then preserves `SIGINT`/`SIGTERM` termination semantics; in those
cases the process may exit before it can print the later uncertainty diagnostic.
The pre-entry warning is therefore the signal-path instruction. The CLI never
retries, deletes, changes modes, or attempts recovery after helper invocation.

## Read-only metadata reconciliation

If an authorized entry is interrupted or errors, preserve the paths as found
and perform only read-only metadata inspection within that action's authority;
this check does not require another approval. Do not open, display, hash, copy,
move, chmod, delete, or otherwise change the key file. Inspect each path
component one at a time with a no-follow metadata operation such as `lstat`.
Stop if any ancestor or target is a symlink, or if any component of the
parent/broker chains differs in device/inode/UID/mode from the approved
pre-entry identities and modes. Never follow a substituted data path or
traverse a symlink to inspect a child.
Record file type, owner UID, mode, device/inode, link count, and size; do not
record file contents. The CLI does not capture or print a metadata receipt, so
without an independently approved pre-entry baseline, report only current
metadata and do not claim the identities are unchanged.

Expected storage metadata after a complete write is a newly created data
directory at the requested data path owned by the current UID with mode `0700`,
and a regular `alpaca-keypair.json` file owned by that UID with mode `0600` and
one hard link.
The broker-vault metadata and contents should remain unchanged; compare the
directory identity and mode with the approved pre-entry baseline. A missing data
directory, a directory without the file, a partial file, or a complete-looking
file are all possible uncertain outcomes after an error. Never infer a complete
write from file presence, size, mode, or directory contents. Any corrective
write or cleanup requires separate concrete reconciliation authority. Do not
infer provider access from metadata observations.

## Scope and completion record

Only local storage is reported on a successful helper return. Success does not
establish provider authentication, account identity, account rights, data access,
application admission, scheduler linkage, or activation. This change does not
generate credentials, read existing credential stores, transmit credentials,
call a provider, enable trading, or modify the broker vault.

The implementation changes the five paths listed in the frontmatter. The V2
import manifest is refreshed only for the package metadata and new in-scope V2
source/test additions; dependency lockfiles and existing credential helper,
contract, and private-file code remain unchanged. The parent found the v1
queued-write error lifecycle defect with deterministic synthetic probes,
including a `setImmediate` error after the scoped listener closed. This revision
adds callback settlement, a bounded callback timeout, a standalone-process
error guard, and synthetic regressions for queued stderr/stdout errors and
unsettled writes. Parent-run Node 24 safe checks passed for syntax, help and
argument handling, unsupported-runtime rejection, inert import, standalone
late-I/O handling, and callback deadlines. Independent review also found two
test assertion defects: the help and malformed-argument cases reused output,
and the safety-notice case confused compiled-module loading with helper entry.
These assertions now use fresh terminals, exact hidden-prompt checks, and
separate loader/entry counts. Parent rerun of the synthetic suite and Node 22
full CI remains pending. No actual credential, Node 22 operator-TTY entry, or
provider/account verification is claimed here.
