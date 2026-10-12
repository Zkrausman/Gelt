# ZAR-213: additive offline V2 foundation

Authority: [M2 specification](../../../docs/specs/ZAR-213-V2-Baseline.md),
[startup and import guide](../../../v2/README.md),
[capability owner-GO addendum](official-crypto-capability-gate.md).

- V1 preservation identity is `357f0dbbd853848484a6afe2773f6a7ac3c9fe2d`, including
  M0/M1 docs. Older `ce1c4a4` was only a planning candidate. Parent alone verifies
  and publishes `archive/gelt-v1-zar213`; never reset/force/publish from the sandbox.
- Additive `v2/` imports public ErTasselli/OpenTerminal exact
  `6feb4869489c8ac9537b1405547983591e1d3263`. MIT and lockfile stay verbatim;
  `IMPORT-MANIFEST.json` accounts for every upstream path and local addition.
  Dependency notice texts are preserved, not a legal/security audit. Do not
  import upstream workflows, deployment files, settings, local data or caches.
- `web/` is Next.js/React UI, `server/` is market/analysis only, `worker/` is a
  separate Node/TypeScript non-executing authority foundation. M2 mounts only
  an offline page and local health/capabilities; provider/AI/portfolio modules
  are retained but unmounted. No generic web proxy, credentials or order routes.
- Worker v1 uses strict runtime schemas and explicit disabled/unconfigured state;
  binds literal 127.0.0.1 and rejects unsafe Host/Origin, methods, queries/bodies
  and unknown routes. Loopback is not authentication. Future BFF session/CSRF and
  protected-account controls are not implemented; upstream API keys do not grant
  execution security.
- Future sole-writer execution SQLite belongs only to worker, never the upstream
  analysis/portfolio DB. No ledger now. Exact decimals, explicit confirmation,
  fee-inclusive ≤$10 and unknown-outcome/manual reconciliation remain downstream
  requirements. Market analysis is never broker execution truth; no Go fallback.
- Supported startup: Node 22, `npm --prefix v2 ci --no-audit --no-fund`, `test`,
  `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build`, `test:smoke`, then `start`.
  Fixed loopback ports web 3000 / market 4000 / worker 4100. No provider secrets,
  broker or legacy daemon. Minimal child environment and TCP/DNS egress guard;
  not an OS sandbox. Supervisor joins children on failure/interruption.
- Keep all upstream server tests plus worker contract, boundary and lifecycle
  tests. Root Go 1.26.1 build/race/vet and separate Node offline CI are required.
  Build/dependency caches stay ignored; analysis DB is not opened by M2 startup.
  Never delete owner artifacts to obtain a clean status. Do not run `npm ci`
  concurrently with root Go `./...` discovery in the same worktree: npm replaces
  dependency directories while Go traverses the additive tree. Run local checks
  sequentially; separate CI jobs have isolated workspaces.

Normal independent Review, distinct adversarial Test, read-only Retro and
parent-owned App PR/CI remain required. No M2 merge, deployment or live-action
authority follows from local tests or owner trading attestation.

## Additive M3 transition

The M2 facts above describe the historical baseline. ZAR-214 adds protected named
connection APIs, worker-only OAuth/PKCE and platform-private encrypted vault without enabling
execution or changing the upstream pin/V1 preservation identities. Default startup
remains offline; explicit official-worker setup does not open market/web egress.
See [protected account boundary](zar-214-protected-account-boundary.md) for the
required raw-ingress Next wrapper, session/CSRF/service-auth, generation races,
Windows/browser/provider compatibility limits and owner-provisioning contract.

M3 account discovery now maps sanitized retained `data.accounts` evidence at a
separate raw-provider boundary; normalized fixture fields are not a provider
contract. Mixed inaccessible/non-crypto records are filtered under explicit local
policy, with malformed/ambiguous routing rejected. This does not alter offline
M2 defaults or prove live interoperability. The later owner-authorized native
Windows scope supersedes the initial Linux-only M3 intake: current-user DPAPI plus
verified private NTFS ACLs covers all private paths. Linux keeps its original
backing. Both require explicit owner provisioning; Windows hosted CI, not Linux
fixtures/WSL, is the mandatory native acceptance gate. See the protected-boundary
page for helper prerequisites, failure recovery and same-user/admin threat limits.
