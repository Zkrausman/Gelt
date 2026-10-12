# Offline get_accounts compatibility evidence

`get-accounts.json` is synthetic-ID test data based on the parent's retained,
authorized official decoded get_accounts observation from
**2026-09-18T03:17:46.356Z** (ZAR-212). All account IDs were replaced with ACCOUNT1/2,
RHS1/2 and CRYPTO1/2; funds and nickname were replaced with `0.00` and
`Fixture account`. No credentials or actual financial/account data are supplied.
It is not production telemetry, a live fixture, current access proof, or a new
broker call. Tests read it only through injected offline transport.

Evidence establishes decoded `data.accounts` and `guide`, the listed field names
and types, and a mixed accessible/inaccessible list. The original HTTP/SSE/MCP
wrapper was not retained. Test wrappers/protocol version are implementation
contracts, not an observed structuredContent encoding. One observation does not
establish complete requiredness or enum coverage. Retained metadata described
`agentic_allowed` as caller-relative access (false means read-only for this agent),
get_accounts input `{}`, nickname as non-authoritative, possibly empty RHC, and
RHS as crypto routing identity (not RHC).

Local policy is intentionally narrower: only explicit active/cash/individual,
agent access and both deactivation flags false plus usable ACCOUNT/RHS/RHC are
selectable. Unknown/missing policy excludes a record; malformed policy types,
invalid supplied identities or duplicate identities reject the response. Missing
crypto identities exclude non-crypto records, not their valid neighbors. No
nickname/default/guide grants authority; fixtures never substitute for real access.

`account-integration.test.ts` exercises actual OfficialProvider → normalization →
Connection callback/discover → sanitized status/select/disconnect. The first three
regressions were run against unchanged implementation source ab363b2 and failed
(exit 1): both connection paths returned `connection unavailable`; direct provider
rejected missing structuredContent.accounts and unknown data/guide. After mapping,
the same three passed (exit 0). Full evidence is in the ZAR-214 specification.
