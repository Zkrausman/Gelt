# Private reference-computation evidence

This first ZAR-209 implementation slice imports inert, immutable JSON from an
isolated scientific MCP run. It does not execute artifacts, generate trading
strategies, call a broker, run a historical/shadow protocol, or authorize capital.
Every accepted record retains `insufficient_evidence` and `promotionAllowed=false`.
Costs, historical and shadow stages must be `not_run` for this artifact kind.

## Operator setup and import

Build V2 normally. Research storage is disabled until explicitly configured. Set
`GELT_RESEARCH_ROOT` to the provisioned canonical directory in the existing
owner-configured launcher environment. The launcher forwards it only to the web
role in `official-worker` mode; research reads do not call the worker or broker.
Provision an **already private, empty, canonical directory** separate from all
five existing owner directories (key, worker config/vault, BFF config, owner bootstrap handoff,
execution ledger). This command validates existing private backing; it does not
repair permissions, create credentials, or provision execution.

    node worker/dist/research-operator.js provision RESEARCH_ROOT KEY_DIR WORKER_DIR BFF_DIR OWNER_DIR LEDGER_DIR
    node worker/dist/research-operator.js import RESEARCH_ROOT ABSOLUTE_JSON_FILE

OWNER_DIR is the existing separate owner handoff directory containing
`bootstrap.txt`; the BFF directory separately contains the `bootstrap.json` grant
digest. These are not the same directory. All paths must be absolute and canonical. Provisioning configuration is capped
at 8,192 serialized UTF-8 bytes before any write, matching its read limit.
Research roots must leave space for a maximum-length evidence ID and atomic
temporary filename: at most 141 UTF-16 units on Windows, or 3,983 UTF-8 bytes
on Linux. Existing native helper limits and security policy are unchanged. Use an ordinary regular JSON file, not
a URL, ZIP, executable or symlink. Input is capped at **65,536 original bytes**,
including whitespace. Windows input must already be staged as a private NTFS
file under the existing approved private-storage policy; the fixed native helper
validates source owner/DACL, ancestors, local volume, reparse points and links.
Linux input is read through a bounded regular-file descriptor with no-follow,
single-link, canonical-path and before/after metadata checks. Import performs no
artifact-selected process invocation, network request or dynamic code loading.
The existing Windows private-storage helper is the sole fixed OS helper used.

Never put research data in credential, BFF, bootstrap or execution directories.
Provisioning records those five exclusions and revalidates their physical
separation on reads and writes. Removing one of these directories makes storage
unavailable until its approved setup is restored. Production startup never
provisions or imports evidence automatically.

## Data contract and interpretation

`worker/src/research-contract.ts` defines `gelt.research-evidence.v1`, with the
single `reference_computation` kind. Every object rejects unknown keys. Strings,
arrays, IDs, timestamps, git pins, SHA-256 values and finite numbers are bounded;
UTF-8, JSON depth/node count and duplicate/escaped-duplicate keys are validated
before schema decoding. Canonical evidence JSON is capped at 508 KiB so compact
number literals can expand safely; 4 KiB is reserved for Gelt/session metadata
within the shared 512 KiB BFF/client response limit. Both the BFF and browser
enforce that wire limit. Citation identifiers are inert text, not fetch targets.
There are no executable, arbitrary endpoint or environment fields.

`producerClaims` are unverified producer statements. A producer's `passed`
reference/MCP/reproduction claim does not make Gelt's scientific reproduction
passed. Gelt independently checks artifact schema, stored-original byte integrity,
and supplied actual/expected numeric agreement against supplied tolerances.

When BOTH ORIGINAL tolerance tokens are mathematically zero, comparison uses
exact normalized decimal equality of the original actual/expected tokens. This
is a clarified zero-tolerance rule, not a claim that the original v1 contract
already guaranteed exact arithmetic. Equivalent spellings (`1e3`, `1000.0`)
compare equal, as do positive and negative zero. Distinct original values cannot
pass only because decoding rounded them to the same finite number.

When either original tolerance is nonzero, comparison retains the approximate
JavaScript finite-number formula after decoding:

    abs(actual - expected) <= absoluteTolerance + relativeTolerance * abs(expected)

Rounding and underflow can affect this approximate comparison, even when a
nonzero tolerance decodes to zero. It does not establish exact raw-decimal
agreement within nonzero tolerances. Overflow or nonfinite intermediate
calculations fail this comparison. This test
is not an independently run solver, reference-code audit or statistical finding.
Gelt's `scientificReproduction` is always `not_run`.

Each of the four result-number tokens is limited to 4096 ASCII characters and
an explicit exponent magnitude at most 100000 (leading exponent zeros allowed
within the token bound). Normalization stores a signed coefficient and adjusted
exponent without expanding powers of ten. Original negative nonzero tolerances
are rejected, including negative values that would decode to negative zero.
Missing, malformed or unsupported tokens reject import before writer ownership;
the same condition in an existing envelope returns `corrupt`. These bounds do
not change numeric input-array fields. Existing finite-number/schema and response
size limits continue to apply.

Every read recomputes the comparison from preserved original bytes. Old records
may change from passed to failed at zero tolerance, or become `corrupt` if outside
the lexical bounds or containing a negative raw tolerance. Nothing rewrites the
envelope, original bytes/hash, import timestamp or producer provenance. Failed
numeric comparison still permits an available record; it never promotes science.
The response shape is unchanged. Its comparison detail reports exact/approximate
counts and failures. The view explains that displayed decoded numbers (including
tolerances) can round or underflow, so identical table values can have a failed
exact comparison. Nonzero-tolerance approximation remains an explicit limitation.

`originalSha256` is SHA-256 of the original file's exact bytes, before JSON
parsing, including all whitespace. `originalBytes` is their exact length. The
producer's `inputSha256`, `outputSha256` and dependency-lock hash remain unverified
claims in Gelt; the adapter documentation defines and verifies the particular
serialized bytes in its isolated producer run. A SHA-256 digest is an integrity
check, not a signature or producer authentication. The same-user/administrator
compromise exclusions of existing private-storage helpers remain applicable.

## Persistence and bounded reads

The store permits at most 100 records. A single private envelope retains original
bytes as canonical base64, original digest/length and import timestamp. Envelope
size is checked below 90,000 bytes; the existing Windows 150,000-byte storage
limit is unchanged. No independently updated index or chunk manifest exists.

Each evidence ID has one filename prefixed with `evidence-`. New imports take a
persistent exclusive store writer marker, recheck the destination, then commit
through existing `replacePrivate`: Linux temporary-file write/fsync, rename and
parent-directory fsync; Windows private NTFS fixed-helper write/flush and
write-through same-volume replacement. The committed record is reread and
validated before successful ownership cleanup. Source data cannot choose paths.
Existing evidence is never overwritten. Identical original digests for the same
ID are idempotent; any changed original bytes under that ID are a conflict, even
if parsed JSON is equivalent.

Read APIs revalidate private storage, schema, canonical base64, original byte
count, original SHA-256 and ID binding. Missing records, corrupt records and
unavailable storage are distinct. Listing is bounded and does not synthesize
records. Detail and list reads revalidate the private root and ownership markers
after collecting results, so a concurrent post-commit interruption cannot publish
evidence under a retained writer marker. Unexpected files, unsafe provisioning or writer markers fail closed.

## Interrupted operations and limits

There is no lock timeout or automatic takeover. An interruption before commit
leaves no accepted record; interruption after commit but before ownership cleanup
can leave committed bytes plus a writer marker, and all public reads remain
unavailable until owner recovery. Do not delete a marker while an importer might
still run. Stop and join all relevant processes, preserve the directory as
incident evidence, and have an operator inspect the committed envelope and any
temporary file against the original artifact before explicit manual recovery.
No production recovery command is included in this first slice.

The filesystem helpers define durability. Tests cover deterministic failure seams
before commit and before cleanup, genuine independent-process restart/readback,
idempotency, tampering and retained ownership. These tests do not prove survival
of every power loss, storage-controller cache behavior or same-user compromise.
If final marker removal itself fails after unlink, the committed bytes were
already flushed and validated, but the operation reports failure; check the
record and retry the identical import only after verifying no writer is active.

No broker execution status, execution-MVP acceptance, shadow completion,
promotion eligibility or profitability follows from this research milestone.
