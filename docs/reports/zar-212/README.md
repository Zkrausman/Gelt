# ZAR-212 official crypto capability evidence

## Superseding owner decision — 2026-09-18 (M2 intake)

**Current capability disposition: owner-reviewed GO for bounded ZAR-213 M2.**
The reconciled owner intake reports PR456 merged at
`357f0dbbd853848484a6afe2773f6a7ac3c9fe2d` and the dated
[ZAR-212 owner decision](https://linear.app/geltagentictrading/issue/ZAR-212).
OpenTerminal supplies market/analysis; the separate worker owns future application
safeguards; official Robinhood MCP supplies broker execution/status primitives.
The owner reports having tested trading: this is **owner attestation**, not
independently captured fills or additional E1–E7 evidence. Historical observations,
unknowns and the original technical HOLD remain unchanged below. This addendum
supersedes only the earlier HOLD/PENDING/blocked **disposition**, not its evidence.

Only additive, non-executing foundation work is authorized here. No live actions,
credentials, order/ledger implementation or merge is authorized. See the
[M2 specification](../../specs/ZAR-213-V2-Baseline.md) for preservation, local-only architecture and pending parent
publication/review gates. All following original M1 restrictions and decision
records describe their historical assessment context, not a new current blocker.

## Historical M1 assessment (preserved)

**Technical recommendation: HOLD. Owner GO/NO-GO: PENDING.** ZAR-212 remains In Progress; ZAR-213 remains blocked. This report is deliverable evidence for review, not gate acceptance, an exact-order selection or live-action authority. See the [specification](../../specs/ZAR-212-Official-Crypto-Capability-Gate.md) and unchanged authoritative [ZAR-211 scope](../../specs/ZAR-211-Scope-Runtime-Release-Gates.md).

## Provenance and evidence vocabulary

Source: parent-supplied sanitized authenticated host receipts E1–E7 in the reconciled ZAR-212 Linear intake dated 2026-09-18. Parent used the official endpoint <https://agent.robinhood.com/mcp/trading> after owner-operated OAuth succeeded. Official support provenance supplied by parent: <https://robinhood.com/us/en/support/articles/agentic-trading-overview/#ConnectyourAIagent>. These URLs are provenance, not sandbox requests. Parent reports 87 exposed tools; earlier OAuth failures were resolved but their root cause was not established.

Evidence below is a **normalized transcription of that packet**, not raw captures, sandbox-observed broker traffic, fixtures, signatures or independently authenticated evidence. The recommendation, gap analysis and prospective safety requirements are this assessment's conclusions, not additional parent observations. No broker calls were made for this repository implementation. No place or cancel call was made in the parent packet. No credentials, OAuth material, balances, actual order/fill identifiers or transient preview identifiers are included. `ACCOUNT_A`, `RHS_A`, `CRYPTO_A` are consistent redactions of linked account identifiers, not mock telemetry. The pair UUID is public market metadata.

- **O — observed by parent:** successful read/preview or returned values reported in E1–E7; not observation by this sandbox.
- **D — documented:** authenticated schema/tool guide statements reported by parent; not verified server behavior.
- **U — unverified/not supplied:** unknown wire details or guarantees. No inference of support from absence of an error or from preview shape.

Matrices cover every input field and relevant response field supplied in the packet. They do **not** reconstruct full tool schemas. Required/optional labels refer to supplied input contracts. For response fields, “present” means reported in a receipt, not schema-required; response requiredness/nullability is unknown throughout unless explicitly stated. Types described as “semantic” express meaning only, not a proven wire type. Unspecified input nullability, enumerations, formats and defaults remain unknown. A schema's documented acceptance is not future worker acceptance policy.

## Receipt index

| ID | Evidence and classification | Limitation |
| --- | --- | --- |
| E1 | O: `get_accounts` returned an active cash individual account accessible to the agent with linked account numbers. Another visible account was not accessible for this agent's trading. D: crypto routing uses RHS number. | Visibility is not trading authority; no balances requested. Account-wide eligibility is not established. |
| E2 | D: preview/place schemas, string money/quantity inputs, exclusive amounts, prices and ref_id retry guidance. O: schemas inspected by parent. | Place never invoked; documented idempotency is not tested replay/retention. |
| E3 | D: order list/detail filters and read guide; cancel eligibility warning. O: BTC-USD history returned empty. | No observed order, detail, fill, cancel, replay or unknown-submission recovery. Empty BTC-USD result says nothing conclusive about other assets/accounts. |
| E4 | O: account-routed BTC-USD quote succeeded, including pair, decimal values, time and routing below. D: loose symbols schema. | Historical snapshot, not current price or freshness/clock guarantee. |
| E5 | O: two non-executing $1 BUY previews succeeded (market and limit). | No created orders or fills; transient order-shaped IDs are redacted and unusable as durable identity. |
| E6 | D: dollar-amount limit BUY final debit does not exceed requested amount; market BUY can exceed it up to collar. | No live debit/fill evidence; no perpetual zero-fee, affordability or fill guarantee. |
| E7 | O: catalog pagination via official tool found BTC-USD and constraints below. | Empty filtered page with cursor was not exhaustion; constraints need later refresh. |

## Input field/type/requiredness matrix

### Accounts and preview/place

`get_accounts` (E1): no input schema supplied; inputs, types and requiredness **U**. Its successful result does not establish that it has no inputs.

The following shared fields belong to both `preview_crypto_order` and `place_crypto_order` (E2, **D**); place mirrors preview with the additional ref_id. Preview invocation evidence is E5 (**O**), not placement evidence.

| Field | Type supported by packet | Requiredness | Contract / limits of evidence |
| --- | --- | --- | --- |
| `rhs_account_number` | Account identifier; exact wire type U | Required | Use RHS_A, not CRYPTO_A. |
| `symbol` | Symbol text; exact schema type U | Required | Bare `BTC` or `BTC-USD` resolves per E2; E5 used BTC-USD. Full enum U. |
| `side` | Side value; exact schema type U | Required | E5 BUY; full enum U. Later MVP permits BUY only. |
| `type` | Order-type value; exact schema type U | Required | Market/limit previews observed; limit and stop_limit named in price rules. Full enum U. |
| `quantity` | String | Individually optional; exactly one of quantity/dollar_amount required | Base quantity, not binary floating point. |
| `dollar_amount` | String | Individually optional; exactly one of quantity/dollar_amount required | Quote-currency amount; E5 used `1.00`. Never send both amount fields or neither. |
| `limit_price` | String | Conditional | Price required for limit and stop_limit per E2. Exact validation beyond this is U. |
| `stop_price` | String | Conditional/optional as supplied | Field exposed; exact stop/stop_limit trigger requiredness not separately supplied (U). No stop candidate authorized. |
| `time_in_force` | TIF value; exact schema type U | Optional | E5 limit used `gtc`; full enum/default U. |
| `ref_id` (place only) | UUID identity documented; exact wire schema type U | Schema optional; documentation requires fresh UUID per logical order | Same UUID for transient retries per guide. Future worker must require and persist its own stable ref; preview ref_id must never be promoted. Replay/retention U. |

The packet says “Price required for limit and stop_limit”; it does not supply a full conditional schema for stop_price. Do not invent one or infer stop support sufficient for bounded spend. Unspecified scalar schema types above require sanitized schema evidence before implementing the worker boundary.

### Order reads and cancellation

`get_crypto_orders` (E3, **D**):

| Field | Type supported by packet | Requiredness | Contract / unknowns |
| --- | --- | --- | --- |
| `rhs_account_number` | Account identifier; wire type U | Required | RHS_A routing. |
| `order_id` | UUID detail lookup; wire type U | Optional | Detail by broker ID; no detail response observed. |
| `state` | State value; wire type/enum U | Optional | Do not infer all states from preview. |
| `state_group` | Group value; wire type U | Optional | Guide documents `open` / `closed`. |
| `side` | Side value; wire type/enum U | Optional | Filtering does not prove unique intent match. |
| `symbol` | Symbol value; wire type U | Optional | Empty BTC-USD result is a query-specific observation. |
| `created_at_gte` | Time lower bound; wire type/format U | Optional | Inclusivity, timezone/clock semantics and consistency U beyond field name. |
| `updated_at_gte` | Time lower bound; wire type/format U | Optional | Update discovery; not proven complete recovery. |
| `cursor` | Pagination token; wire type U | Optional | Ordering, stability, retention and expiry U. |

No `ref_id` query filter is exposed. Echo of ref_id in list results is not proven. No supplied upper-time-bound filter or page-size input; do not invent one.

`cancel_crypto_order` (E3, **D**):

| Field | Type supported by packet | Requiredness | Contract / unknowns |
| --- | --- | --- | --- |
| `rhs_account_number` | Account identifier; wire type U | Required | RHS_A routing. |
| `order_id` | Broker order identifier; exact schema type U | Required | Cancel may be rejected after fill/cancel or ineligibility. No invocation or response observed. |

### Quotes and catalog

`get_crypto_quotes` (E4, **D**, account-routed success **O**):

| Field | Type supported by packet | Requiredness | Contract / unknowns |
| --- | --- | --- | --- |
| `symbols` | `unknown[] \| null` in exposed schema | Required argument; nullable in schema | Observed BTC-USD array request. Later boundary must validate nonempty supported symbol strings, reject null/malformed members; schema alone is insufficient. |
| `timezone` | Timezone value; exact schema type U | Optional | Default/accepted zones U. |
| `rhs_account_number` | Account identifier; exact schema type U | Optional | Account routing succeeded; future single-account boundary should require approved routing. |

`get_currency_pairs` (E7):

| Field | Type supported by packet | Requiredness | Contract / unknowns |
| --- | --- | --- | --- |
| `limit` | Numeric values 1 and 100 observed; exact schema type U | U | O: limit=1 yielded empty filtered results plus next cursor; repeated with 100. |
| `cursor` | Returned token passed to official tool; wire type U | U | O: parent followed returned cursor to final page, never internal next URL directly. Other inputs/schema not supplied. |

## Relevant response field matrix

Names below are exact where named in the intake; descriptions explicitly labeled “semantic” are not invented JSON keys. **All response schema requiredness and nullability remain U.** No place/cancel response schema or observed response exists in this packet.

| Tool / fields | Type / presence supported | Classification and meaning |
| --- | --- | --- |
| Accounts: `account_number`, `rhs_account_number`, `rhc_account_number` | Identifiers, exact types U; present | E1 O: ACCOUNT_A → RHS_A → CRYPTO_A linked. Crypto calls use RHS_A, not CRYPTO_A. |
| Accounts: active, cash, individual, accessible (semantic attributes; keys unspecified) | Exact types/keys U; reported | E1 O: one accessible account, another inaccessible. Not all visible accounts tradable. |
| Quotes: returned symbol and pair (semantic labels; keys unspecified) | Symbol text / public UUID; reported | E4 O: BTCUSD and pair UUID below; BTCUSD display normalization is not arbitrary symbol equivalence. |
| Quotes: bid, ask, mark | Decimal strings; present as supplied labels | E4 O: historical values below; exact response nesting U. |
| Quotes: `updated_at`, other time fields | Timestamp text for updated_at; other keys/types U | E4 O: updated_at supplied; no values for other time fields. Broker clock correctness/latency U. |
| Quotes: routing (semantic label) | Text; reported | E4 O: Market Maker Routing. |
| Preview: `id`, `ref_id`, `account_id` | Transient identifiers; types U; present, values redacted | E5 O: order-shaped simulation fields, not broker order/client identity or fill evidence. |
| Preview: `quantity`, `price` | Decimal strings; present | E5 O: simulated quantity/price below. |
| Preview: `estimated_fee`, `net_rounded_estimated_notional` | Decimal strings; present | E5 O: estimates, not actual charged fees or debit. |
| Preview: `cumulative_quantity`, `rounded_executed_notional` | Decimal strings; present | E5 O: both zero; no executions established. |
| Preview: `routing` | Text; present | E5 O: Market Maker Routing. |
| Preview: `state`, `state_group` | Text; present | E5 O: new/open in non-executing preview; not live status. |
| Preview: simulation time (semantic label; key unspecified) | Timestamp text; reported | E5 O: times below, not a clock accuracy guarantee. |
| Orders: `average_price` | VWAP value; wire type U; not observed | E3 D: volume-weighted average price, not by itself execution identity. |
| Orders: `cumulative_quantity`, `canceled_quantity` | Quantities; wire types U; not observed in orders | E3 D: account for partial fills/cancel; preview's zero cumulative quantity does not validate this live contract. |
| Orders: `executions[]` | Array documented; element fields/types U | E3 D: present in detail, omitted in list per guide. No detail/fill observed; execution IDs, fees, timestamps and identity stability U. |
| Orders: order ID/status/ref_id echo and list envelope | Exact response fields/types U | E3: UUID detail input and documented state filters do not establish response schema; list ref echo unproven. Empty history is the only O result. |
| Catalog: `id` | UUID text; present | E7 O: public pair UUID below. |
| Catalog: quote USD, asset BTC (semantic labels) | Currency text; reported; exact keys U | E7 O: instrument/quote currency. |
| Catalog: `tradability`, `individual` | Text; present as supplied labels; nesting U | E7 O: both tradable; not permanent eligibility. |
| Catalog: `market_orders_only`, `halted` | Booleans; present | E7 O: both false. |
| Catalog: `min_order_size`, `max_order_size` | Decimal strings; present | E7 O: base quantity bounds below. |
| Catalog: `min_order_quantity_increment`, `min_order_price_increment`, `min_order_quote_amount` | Decimal strings; present | E7 O: quantity step, price step, quote minimum below. |
| Catalog: next cursor / internal next URL (semantic labels) | Exact wire types/keys U; cursor reported | E7 O: continued only through official MCP tool; empty filtered page not exhaustion. |

## Historical snapshots (normalized, not raw responses)

All figures and times are historical capability evidence from E4–E7, **not current prices, fees, constraints, eligibility or validated clocks**. Decimal strings are preserved without conversion to binary floating point. No exact order is selected or authorized by these examples.

### E4 quote

| Attribute | Supplied value |
| --- | --- |
| Request symbol / returned symbol | BTC-USD / BTCUSD |
| Public pair UUID | `3d961844-d360-45fc-989b-f6fca761d511` |
| `updated_at` | `2026-09-17T23:18:24.949-04:00` |
| mark | `77446.76799737` |
| bid | `76714.311922` |
| ask | `78179.22407274` |
| Routing | Market Maker Routing |

### E5 previews: simulations only

Both requests: RHS_A routing, BTC-USD, BUY, `dollar_amount='1.00'`. Limit additionally used `limit_price='70000.00'`, `time_in_force='gtc'`. The market request is capability evidence, **not** the recommended spend-safe type.

| Attribute | Market simulation | Limit simulation |
| --- | --- | --- |
| Reported time | `2026-09-17T23:18:29.149926-04:00` | `2026-09-17T23:18:34.465328-04:00` |
| `quantity` | `0.00001279` | `0.00001428` |
| `price` | `78167.50266183` | `70000` |
| `estimated_fee` | `0` | `0` |
| `net_rounded_estimated_notional` | `1` | `1` |
| `cumulative_quantity` | `0` | `0` |
| `rounded_executed_notional` | `0` | `0` |
| `routing` | Market Maker Routing | Market Maker Routing |
| `state` / `state_group` | new / open | new / open |

Transient `id`, `ref_id` and `account_id` values are intentionally omitted. **No orders were created.** Never copy preview ref_id into a live logical intent or count new/open as submission/fill evidence.

### E7 pair constraints

Parent first received empty filtered results at `limit=1` with a next cursor, then used `limit=100` and followed the returned cursor through the official tool. BTC-USD was observed on the final page. An empty page is not end-of-catalog when a continuation exists; neither this path nor a cached pair record guarantees future completeness.

| Field / attribute | Supplied value |
| --- | --- |
| `id` | `3d961844-d360-45fc-989b-f6fca761d511` |
| Quote / asset | USD / BTC |
| `tradability` / `individual` | tradable / tradable |
| `market_orders_only` / `halted` | false / false |
| `min_order_size` / `max_order_size` | `0.000001` / `20` |
| `min_order_quantity_increment` | `0.00000001` |
| `min_order_price_increment` | `0.01` |
| `min_order_quote_amount` | `0.01` |

## Spend feasibility: candidate, not permission

E6's official preview guide documents a final debit bound for **dollar-amount LIMIT BUY**, while market BUY can exceed the requested amount up to its collar. Together with E5, this supports only a limit-buy *candidate* for ZAR-211's hard **total debit including fees ≤ $10** ceiling. It does not prove an executed fee-inclusive debit, continued zero fees, affordability, execution price or any fill. Market and stop substitutions are not allowed. Do not automatically raise the cap, fund the account or use unofficial APIs if a compliant order is unavailable.

Later, fresh official account/pair eligibility, quote and fee/constraints preview evidence must inform ZAR-220 exact-order authorization; the worker must revalidate that evidence before any separately authorized ZAR-221 dispatch, after all prior gates. Use exact decimal arithmetic, explicit BTC/USD units, base min/max and quantity increment, limit-price increment and quote minimum. Both base and quote checks must pass; `$0.01` quote minimum alone does not satisfy BTC minimum size. Reject unsafe rounding or ambiguous fee inclusion rather than rounding spend upward. A $1 preview and a $10 planning ceiling are neither the owner's chosen amount nor approval of a specific price/TIF. Stale/unknown constraints, fees, affordability or quote freshness block execution. Actual execution evidence remains separately authorized ZAR-221 work, not evidence to manufacture for M1.

## Prospective identity, restart and reconciliation constraints

These refine evidence requirements for the unchanged ZAR-211 Node/TypeScript sole-writer SQLite worker; **nothing here implements runtime or authorizes retries**.

1. Before any later authorized submission, durably persist the logical intent, exact account/pair/side/type/amount/price/TIF, owner authorization association, request fingerprint and a fresh worker-generated UUID ref_id. Persist submission-attempt state before network dispatch. Retries/restarts must recover that same logical identity; never mint a replacement UUID to escape ambiguity or use a transient preview identity.
2. E2 documents SAME ref_id for transient retries, but server replay, payload-mismatch behavior, concurrency handling, retention/expiry and crash recovery are unverified. This guidance is not general retry authority. Until those guarantees and a safe recovery path are established, any timeout/disconnect/unknown submission remains **blocked/reconciling**, including across restart. Do not blind-resubmit even with the same ref_id. A definitely unsent intent is distinct from an ambiguously sent one, and must not be inferred merely from a missing local acknowledgment.
3. If a broker order ID is durably known, use documented UUID detail lookup to reconcile. Confirm account, instrument and intent association against actual evidence, then persist response provenance and timeline. A missing detail response, temporary not-found or cancel acknowledgment cannot by itself prove no execution.
4. Without broker ID, no ref_id query filter exists and list echo is unproven. A later approved reconciliation procedure must search the approved account using symbol/side and recorded creation/update lower bounds with a conservative clock-skew overlap; include open and closed groups (not only open). Before starting, persist fixed search windows and finite page/elapsed-time budgets. The exposed schema has no upper-bound filter: enforce the investigation cutoff locally only where returned timestamps are validated. Ordering, timestamp meaning, page stability and eventual consistency must be established; otherwise mark coverage incomplete. Numeric budgets and skew tolerances are not supplied or proven here and must be approved before that procedure can run.
5. Traverse returned cursors through official MCP only; continue empty pages with next cursors. Stop on exhausted cursors, repeated/expired tokens, malformed data, errors or the recorded page/time budget. Persist bounds, cursors/progress, candidate IDs and coverage limitations for restart/audit. Exhaustion or an empty result is not proof of non-submission when consistency/retention/identity is unverified. Multiple plausible matches must not be guessed into a unique association.
6. If identity or coverage cannot be proven, retain blocked/reconciling, halt new orders for the unresolved single-account MVP intent and escalate to owner/manual broker-supported investigation. Never reset state to “not submitted,” release reserved spend or create a replacement order merely because a search ended. Manual review also cannot manufacture a fill or authorize blind resubmission.
7. Cancel is a race-prone request, not proof of final cancellation or prevention of fills. Reconcile after rejection/timeout and partial fill; preserve cumulative filled and canceled quantities, actual executions and charged fees. Halt-new-orders is not liquidation. Closed/canceled does not mean zero fills. No cancel call or race was observed in E1–E7.

Required future fill evidence: broker order identity and verified intent/account/pair association; stable execution identities (or an officially supported deduplication key), actual quantity/price/fees/currency/time per execution, terminal/partial status, cumulative quantity and documented VWAP agreement, and durable restart reconciliation without double counting. E3 documents average_price as VWAP and executions in detail but not list; it supplies **no execution element schema or observed detail**. Never substitute a quote, preview, estimate or list status for fills. Empty BTC-USD history does not establish no historical fills on other assets/accounts.

## HOLD gaps and next evidence

HOLD reflects material feasibility gaps, not a claim the broker cannot support this MVP. Successful routing, quotes, constraints and small previews justify continued *evidence review*, not conditional execution. No live probe, order or cancel may be used to close these gaps under this delivery.

| Gap / risk | Evidence needed for reconsideration | Safe next source / authority |
| --- | --- | --- |
| Incomplete exact schema/validation | Sanitized full input/output schemas, conditional prices, types, nullability, enum/defaults and error contracts; especially order detail/execution elements | Parent/owner-supplied official schema/documentation; no sandbox access. Unknowns stay explicit until supplied. |
| Actual order/fill identity and fee accounting | Redacted pre-existing detail/execution evidence tied to official field semantics; show stable IDs and partial-fill/VWAP/fee/cancel relationships | Owner may supply already-existing authorized history from an eligible account/asset; current empty BTC-USD query is not account-wide history. If unavailable, retain gap; never make fills for evidence. |
| Replay/retention and restart identity | Official guarantees for same-ref replay, retention duration, changed payload/concurrent calls and safe retry eligibility, plus a feasible verification plan | Official documentation/support evidence supplied by parent; no replay probe here. Later offline tests may check local safety, not prove server behavior. |
| Unknown submission without broker ID | Proven read-path identity correlation, list/detail ref echo or another official exact match mechanism; pagination/time/consistency/retention guarantees and approved bounded manual escalation | Official evidence and existing sanitized reads if independently authorized later. No unsupported ref filter, heuristic unique-match assumption or blind retry. |
| Cancellation and partial-fill race | Documented result/error/terminal states and actual pre-existing detail reconciliation sufficient to avoid lost/double-counted fills | Supplied official contracts/history; never a cancel experiment here. |
| Hard spend feasibility over time | Explicit fee-inclusive limit debit semantics and fresh eligible constraints/quote/fee preview fitting both base/quote requirements at ≤$10 | E6 is a documented bound only. Fresh evidence and exact-order confirmation remain ZAR-220/221 after prior gates, not current execution authority. |

Owner review should assess whether these contracts make safe spend, unknown-outcome handling and real fill evidence feasible. If evidence remains insufficient or official support is absent, retain HOLD/NO-GO or explicitly re-scope; do not bypass ZAR-213's prerequisite with a reviewed PR or close ZAR-212 as Done.

## Owner decision record

| Decision | Current record |
| --- | --- |
| Technical recommendation | **HOLD**, for the material identity/replay/recovery/detail gaps above. |
| Owner-reviewed GO/NO-GO | **PENDING**; no owner capability decision supplied. |
| Decision attribution/date | Not supplied; no signature or approval inferred from delivery authorization. |
| ZAR-212 / ZAR-213 | In Progress / blocked; no issue mutation performed here. |
| PR delivery | Owner authorized normal Squire evidence PR delivery while review remains pending. A reviewed PR is not gate acceptance, merge or downstream authority. |
| Reconsideration | Supply the gap evidence, reassess feasibility, obtain explicit owner-reviewed decision with provenance; preserve later offline, exact-order, supervised execution and acceptance gates. |
