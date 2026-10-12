---
type: Specification
title: Offline research Playwright acceptance
status: candidate-hosted-browser-pending
timestamp: 2026-10-07T01:56:00Z
---

# Scope and safety boundary

Add genuine Playwright automation against the actual Gelt Next research page,
protected owner BFF and immutable evidence store. This is a separate test package;
no production code, authentication rules, brokerage capabilities or V2 imported
lockfile changes. The runner creates disposable synthetic owner-session grants,
private storage and service secrets and hash-checks the actual reference-computation
artifact before import. Browser requests are restricted to its owned loopback app.
No real account, broker endpoint, credentials, order or market data is used.

# Changed files

- tests/research-browser/package.json and package-lock.json: exact Playwright pin.
- tests/research-browser/run.mjs: real browser/Next/store acceptance and labeled captures.
- tests/research-browser/.gitignore: local dependency/output exclusions.
- tests/research-browser/README.md: execution, evidence and honest limitations.
- This specification.

# Implemented checks

Real UI owner bootstrap, unauthenticated state, protected list/detail and 18 rows,
desktop/narrow captures, narrow overflow assertion, actual wheel access to numeric
results and the final section, keyboard Home/End reachability, targeted result/
recommendation captures, keyboard Clear, reload and
navigation clearing, CSRF rejection, late real response after clear, repeated load,
real Next restart invalidating sessions, persistent artifact, corrupt-on-disk
refusal and disabled selection. Browser-only clock advancement tests UI expiry;
server-time expiry retains its existing unit coverage. Production trade flows are
not present and this package makes no simulated-trading or market-performance claim.

# Verification and remaining gates

Exact dependency install and node syntax check passed in cloud. Actual Next/store
startup succeeded. Chromium with sandbox enabled failed before any interaction at
socket() Operation not permitted. No unsafe launch workaround was attempted.
Hosted Playwright interaction, actual screenshot pixel review, integrated Go race/
vet, V2 unit/build/smoke, native Windows checks and fresh independent/adversarial
final review remain required. A failed/blocked browser run is never a visual pass.

Screenshots are labeled synthetic and token inputs are masked. Captures are not
approved visual baselines. The run receipt always marks visualApproval pending;
reviewed baseline creation is a separate future change. Existing history CDP
acceptance stays intact and must not be relabeled Playwright.

## First hosted launch correction

The first exact-head hosted run passed the existing sandboxed history browser
gate and the production research HTTP gate. The new Playwright bundled
headless-shell binary then failed before interactions with “No usable sandbox”.
No application screenshots or visual success were claimed. CI now retains the
preinstalled vendor browser selected by the successful history step, prints its
actual executable/resolved path/version, and explicitly reuses it for Playwright.
The sandbox remains enabled; no OS security setting or browser protection is
disabled. The failed receipt is preserved, and new exact-head interaction, pixel
and cleanup acceptance remains required after review and verification.
