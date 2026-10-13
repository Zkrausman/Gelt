# Gelt Paper2Agent reference adapter

One reviewed PyPortfolioOpt operation, one local stdio MCP tool, one inert Gelt
evidence export. This is fixed-reference numerical evidence, not market data,
a portfolio recommendation, a strategy, or permission to trade.

## Run in an isolated Python 3.12 environment

From this directory, using official uv (no global installs):

    UV_CACHE_DIR=/tmp/gelt-uv-cache uv sync --frozen --no-install-project
    .venv/bin/python -m pytest -q
    .venv/bin/python verify.py /tmp/gelt-reference-new-run

The output directory must have no prior files with these names. Export uses
exclusive creation, never overwrites an evidence artifact. Each run ID includes
a UUID4 run nonce, timestamp, upstream commit, adapter source digest, lock,
input and output hashes, so same-millisecond replays can coexist in
the immutable Gelt store. Invoke server.py
with the environment's Python for local stdio only. verify.py launches a real
subprocess with `/usr/bin/env -i`, an absolute Python path, minimal PATH/HOME,
PYTHONNOUSERSITE and update checks disabled. It inherits no provider or broker
credentials. Linux/POSIX `/usr/bin/env` is presently required by the verification
launcher. This is reviewed trusted code, not an untrusted-code sandbox.

## Scientific contract

Input object has only `tickers` and `covariance`: 2–8 distinct uppercase labels
and a same-order square numeric matrix. Reject booleans, strings, nonfinite
numbers, absolute entries above100, asymmetry, and any negative eigenvalue of the scale-normalized matrix. Nonzero maximum
absolute entry must be at least1e-200. Negative raw diagonals and nonzero entries
erased by scale normalization are rejected before optimization.
No silent matrix symmetrization, PSD repair, expected-return calculation, data
retrieval, file path, arbitrary code, package installation, or broker call.
PSD verification is conservative: some mathematically singular PSD inputs may be
rejected due to floating-point eigensolver roundoff; the adapter never repairs them.

The covariance is divided by its maximum absolute entry before optimization
(zero matrix remains zero), preserving the minimizer across units/scales.
The library minimizes the normalized w' C w subject to sum(w)=1 and0<=w<=1. CLARABEL0.11.1 is
explicitly chosen with gap/feasibility tolerances1e-10 and maximum200 iterations.
Only optimal finite results passing budget/bound tolerances1e-8 are emitted.
Normalized KKT checks enforce stationarity1e-7 (support weights>1e-5), dual
feasibility1e-7, complementarity1e-8, nonnegative variance and a simplex
duality-gap bound1e-8. The latter is a numerical normalized-objective diagnostic; the exact convex
bound assumes exact feasibility and PSD, while these checks use floating-point
eigenvalues and feasibility tolerances. Raw variance is computed in input units.
Weights are raw CVXPY solver values, before PyPortfolioOpt's16-digit output
rounding; neither clean_weights nor presentation rounding is used.

Output contains ticker order, raw weights, variance in the input's unknown units,
covariance scaling and normalized KKT/duality-gap diagnostics,
budget/bound residuals, solver status/version/options/iterations, non-market
classification, and promotion_allowed=false. Actual stdio discovery negotiates
MCP2026-07-28 with installed FastMCP4.0.3 and Pydantic2.13.5. Validation occurs
explicitly on the raw dict: FastMCP's typed-parameter coercion would otherwise
coerce boolean covariance values before strict model validation.

verify.py compares the real MCP call to a separate direct PyPortfolioOpt call,
and separately to an exhaustive simplex active-set/KKT oracle using NumPy linear
algebra with no PyPortfolioOpt/CVXPY invocation. It tests KKT residuals at the
actual MCP weights too. Source hashes in tests pin the reviewed installed source
files to the official1.6.0 git commit. The fixture is from that same commit.

## Evidence import contract

artifacts/evidence.json matches `gelt.research-evidence.v1`, <=65,536 bytes.
It is self-contained: fixture numbers/order, raw result JSON, comparisons,
solver metadata, citations, dependency versions, lock hash, and limitations.
A sidecar mcp-output.json contains the identical raw result; mcp-handshake.json
records negotiated metadata. Inner input/output digests use UTF-8 canonical JSON
(sorted keys, compact comma/colon separators, ASCII escaping, no NaN). Input is
exactly FIXTURE; output is the full tool result object, also embedded verbatim in
provenance assumptions. The outer artifact SHA256 is computed over exact file
bytes, including its trailing newline. Gelt independently validates/imports the
outer artifact; inner hashes/source claims remain producer assertions.

Historical, cost/slippage, and shadow stages are explicitly not_run with no
metrics. Recommendation is insufficient_evidence and promotionAllowed=false.
No live/paid dataset, model campaign, market return frequency, or observation
period has been verified. The ETF-looking ticker labels do not change that.

See NOTICE.md for licenses and precise paper/archive/runtime distinctions.
The adapter tests do not replace the repository's full Go/V2 prepublication gates.

## G04 selected runnable source package

The delivery boundary is a deterministic source ZIP: adapter/server/oracle/
verification and delivery/parity code, tests, project and frozen lock, existing
fixed reference artifacts, README/NOTICE and all four retained license texts.
Dependencies are separate distributions resolved through uv.lock, not vendored.
The immutable adapter/server/oracle/verify/lock/evidence hashes are unchanged.
No new paper, strategy, model campaign or trading permission is selected.

`delivery.py build /absolute/fresh/output --source-commit <checked-out-40-hex-sha>`
creates paper-package.zip and its byte SHA-256/content/source receipt. ZIP members
have normalized metadata. `delivery.py extract <zip> <expected-sha256>
/absolute/fresh/location` verifies the digest, exact bounded inventory, file
mode/type, manifest and original pins before creating the exclusive destination;
no traversal, symlink, overwrite, arbitrary extra file or automatic repair is
allowed. This is integrity validation of reviewed trusted source, not signature
authentication or a general untrusted-code sandbox.

The supported recipient lane is CPython 3.12 on Linux, with official pinned uv:

```sh
cd /absolute/fresh/location
uv sync --frozen --no-install-project
.venv/bin/python -m pytest -q
.venv/bin/python verify.py /absolute/fresh/reference-output
.venv/bin/python parity.py /absolute/path/paper-package.zip <expected-sha256> /absolute/fresh/parity-receipt.json
```

The package CI gate performs that new-location workflow independently of the
checkout's environment and records extraction/source/lock/license/runtime binds.
The real stdio case inventory contains nine successful fixture/scale/degenerate/
permutation calls compared to direct pinned PyPortfolioOpt and the independent
oracle, plus eighteen finite-JSON contract error calls, including the
positive-diagonal indefinite matrix [[1,2],[2,1]]. Nonunique optimum weights are
not equated; objectives and certificates are compared. IEEE NaN/Infinity are
not standard JSON numbers: their direct Python rejection is recorded separately,
with no on-wire MCP parity claim or reliance on SDK null/extension encoding.
The actual discovered tool schema is recorded; a raw dictionary schema alone
is not the numerical validation contract. No error text or private credentials
is copied into the case receipt. Actual candidate/integrated results remain
separate from these authored expectations until the exact gate passes.

This establishes a selected numerical tool package when validated. Gelt owner
consumption, supported isolated Codex decisions, market inputs, simulated agent
executions and shadow observations remain separate downstream acceptance.
