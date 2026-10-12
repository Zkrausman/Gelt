# Synthetic offline research Playwright acceptance

This separate test-only package pins Playwright 1.56.1, without changing the V2
imported dependency boundary. It drives the real built Next application, owner
bootstrap controls, protected research BFF and immutable research store. The
immutable 18-result Paper2Agent artifact is hash-pinned. Owner sessions, service
secrets and storage are disposable synthetic fixtures. No broker/worker process,
external authentication, market data or order execution is involved.

After the standard V2 build, on an ordinary non-root sandbox-capable host:

```sh
npm --prefix tests/research-browser ci --ignore-scripts --no-audit --no-fund
npm --prefix tests/research-browser exec -- playwright install chromium
NODE_ENV=test GELT_OFFLINE_RESEARCH=fixture-only \
  node tests/research-browser/run.mjs --offline-test-only
```

GELT_TEST_BROWSER_PATH may select an installed reputable Chromium/Edge binary.
GELT_RESEARCH_SCREENSHOTS selects the artifact directory; GELT_TEST_REPO_ROOT is
only for testing a separately assembled checkout. There is no production import,
flag or injection point. Production auth, ingress, Origin/Host/CSRF and startup
are unchanged. Chromium sandbox is explicitly enabled. Never use no-sandbox or
security-bypass flags to obtain a passing run.

Coverage: bootstrap through actual controls, unauthenticated safe state, real
list/detail and all 18 rows, desktop/narrow screenshots, no document overflow,
keyboard clear, reload and navigation clearing, invalid-CSRF denial, delayed real
response after Clear, repeated loads, actual process restart invalidating session,
retained artifact, actual disk tamper/re-read, and browser-clock UI expiry. Browser
clock advancement is not evidence of server-time expiry. Existing unit and HTTP
security tests remain mandatory. Existing CDP history acceptance is independent
and must not be renamed or removed.

Artifacts are clearly labeled SYNTHETIC, mask session inputs, record executed
checks and retain a pending-pixel-review status. Screenshots are evidence captures,
not approved visual regression baselines. Actual screenshots must be inspected at
desktop and narrow sizes before accepting a baseline. No update-all/approve-all
command exists. Full production trading E2E remains unavailable: production
OrderAdapter and order capabilities remain disabled.

Local cloud receipt: dependency install and syntax check passed; real Next/store
startup succeeded; Chromium sandbox launch was blocked by socket() Operation not
permitted. No browser interactions or visual checks are claimed locally. Hosted
browser execution, screenshot inspection and fresh final reviews remain required.

## Hosted sandbox selection

CI uses the exact preinstalled vendor browser selected and successfully exercised
by the sandboxed history gate earlier in the same job. Its executable, resolved
path and version are printed, then `GELT_TEST_BROWSER_PATH` is passed to this
runner. Playwright remains pinned and `chromiumSandbox: true` remains mandatory.
The first hosted bundled headless-shell launch failed before interactions because
that binary lacked a usable Ubuntu sandbox profile. That failure is retained; it
is not a visual pass. Do not disable AppArmor, namespaces, TLS checks or sandbox
flags to make an unsupported browser launch.
