---
type: Specification and Completion Report
title: Exact raw decimal agreement at zero tolerance
description: Compare accepted research result number tokens exactly when both original tolerance tokens are mathematically zero.
timestamp: 2026-10-07T00:00:00Z
---

# Scope and contract clarification

The accepted `gelt.research-evidence.v1` schema stores decoded JavaScript finite
numbers and its original documentation did not promise exact decimal arithmetic.
The accepted import/read path nevertheless described a supplied-number agreement
check. A raw synthetic counterexample proved distinct actual/expected number
tokens can decode to the same binary64 value and pass a zero-tolerance check.
This change clarifies only zero-tolerance comparison. It does not claim the old
contract promised exact numbers or change producer-supplied scientific claims.

## Behavior

The strict UTF-8/duplicate-key/depth-bounded parser captures actual, expected,
absolute-tolerance and relative-tolerance number tokens by their decoded object
key and result-array index during the same parse as schema decoding. Each token
is limited to 4096 characters and exponent magnitude 100000. Comparison converts
the decimal notation to a sign, a leading-zero-free coefficient and a bounded
base-10 exponent, stripping coefficient trailing zeroes without expanding powers
of ten or using a general arbitrary-precision library. Equivalent spelling
(`1e3` and `1000.0`) compares equal; negative and positive zero compare equal.

When both raw tolerances normalize to zero, Gelt compares normalized raw actual
and expected decimals. Any nonzero tolerance token selects the original
approximate binary64 formula, even if that tolerance underflows to zero in
JavaScript. Overflow and nonfinite intermediate calculations still fail the
approximate check. Nonzero-tolerance values remain subject to ordinary floating
point rounding and underflow; this change does not promise exact tolerance math.
Original negative nonzero tolerances are rejected, including a value that
previously underflowed to negative zero during decoding. Tokens outside the
lexical bounds or missing/malformed capture fail import before the writer lock;
an existing stored envelope with that data reads as corrupt.

Every detail and list read recomputes comparison from the retained source bytes.
Existing envelopes are not migrated or rewritten. Their displayed comparison
status can change from passed to failed at zero tolerance, or become corrupt for
negative raw tolerances or unsupported lexemes. Original bytes, digest, size,
import timestamp, provenance and producer claims remain unchanged. A numeric
failure does not remove a schema-valid record and does not enable scientific
reproduction or promotion. The response shape stays unchanged; its diagnostic
text reports exact/approximate comparison counts. The UI explains that decoded
display values can round or underflow, so identical displayed numbers can fail
the exact check.

## Changed files

- `v2/worker/src/research-json.ts`: bounded result lexeme capture during strict parse.
- `v2/worker/src/research-numbers.ts`: bounded decimal normalization and comparison.
- `v2/worker/src/research-store.ts`: validate lexemes before storage and recompute
  comparison on import/read without changing storage envelope or record schema.
- `v2/worker/src/research-numbers.test.ts`: raw counterexamples, equivalent forms,
  zero/nonzero underflowed tolerances, malformed tokens, exponent/length bounds,
  immutable original bytes and legacy-envelope reads. Numeric acceptance cases
  use the actual parser/schema/comparison path; representative exact and
  approximate cases retain full import/read/idempotency integration coverage.
- `v2/web/app/research/evidence-detail.tsx`, `v2/web/lib/research-view.test.ts`:
  explain exact and approximate comparison bases without changing the wire schema.
- `tests/research-browser/run.mjs`: real synthetic raw-mismatch fixture and
  desktop/narrow display assertion.
- `v2/RESEARCH-OPERATIONS.md`: clarified semantics, bounds and old-record effects.
- `v2/IMPORT-MANIFEST.json`: hashes and rationale for local V2 additions.
- `docs/specs/ZAR-241-Research-Raw-Zero-Tolerance.md`: this specification.

## Local verification evidence

On Node 24.21.0 / npm 11.19.0 / Vitest 2.1.9, the focused existing and new tests
passed: 56 tests across worker and view files. The full V2 suite passed (18 server
tests; 347 worker/web tests, 28 skipped; 31 files passed, one Windows-only file
skipped). `NEXT_TELEMETRY_DISABLED=1 npm run build`, `npm run test:smoke`, the
real built research HTTP read-path test, and an additional replay of all 18
preserved raw files and old storage envelopes passed. Original envelopes and
fixture bytes were byte-identical after read; the large-integer old envelope now
reads as available with comparison failed. The old negative-underflow tolerance
is rejected on import and reads corrupt, as specified.

The required Go 1.26.1 toolchain was downloaded from go.dev and archive SHA-256
verified as `031f088e5d955bab8657ede27ad4e3bc5b7c1ba281f05f245bcc304f327c987a`.
`go build -v ./...`, `go test -v -race ./...` and `go vet ./...` each exited zero.
Hosted Linux/Node 22, native Windows and sandboxed browser checks, plus fresh
independent/adversarial reviews, are pending. This local check suite makes no live
provider, browser-owner, account, broker, trading, publication or performance claim.

## Windows test-budget follow-up (2026-10-07)

The prior d52ed146 Windows full-test job exceeded its existing 60-minute limit
and was cancelled. Its tests did not complete; the following Windows build and
smoke steps were skipped. The read-only receipt showed a serial suite progressing
through `synthetic-companion-intent.test.ts`; the new numeric test was the likely
next file by Vitest file-size ordering, but the active test was not recorded.

The new numeric file retains 30 tests: all 22 numeric rows run through raw JSON
parsing, schema validation and the real comparator; two representative raw rows
also run through import, reread, digest-idempotency, provenance and unchanged
envelope checks. The legacy-envelope/list assertions, all four invalid-input
cases and writer-lock absence assertions, and parser/normalizer boundary cases
remain. No test is skipped and no operation deadline is changed.

Source-derived Windows helper-call counts for successful fixtures are estimates,
not runtime telemetry: approximately 2,006 before and 306 after, an estimated
84.7% reduction. This is achieved by removing storage round trips from 20 numeric
matrix rows, while retaining the integration contracts above. Each helper call
still uses the existing bounded PowerShell transport.

After this test refactor, focused numeric Vitest passed (30 tests); full V2 tests
passed (348 passed, 28 skipped), including the 82-upstream/434-candidate import
inventory; V2 build and offline smoke passed. Go build, race-enabled tests and vet
passed. Fresh independent/adversarial reviews and all hosted checks for the new
head are pending. The inspected desktop/narrow browser screenshots and prior
hosted browser receipt belong to d52ed146 only; no browser rerun is claimed here.
