# Design: Tenant Isolation by Construction — Composite FK over Unique Constraint (A′)

> HOW for `proposal.md` (decision A′ is signed — this document stages it, it does not re-argue it).
> Every repo claim below was verified at source this session (schema models, RLS migration, the
> existing integration suite, run-tests.sh wiring, ci.yml services, schema-conventions).
> Corrective pass applied (gate adjudications C1–C4, W1–W10): where this design diverged from
> its delta specs, the divergence is now resolved by explicit amendment — in the spec where the
> design won the merits (coverage-gate tier, child-index exemption), in this document where the
> spec won (batched backfill everywhere, trio query-contract inside Slice 1).
> Addendum 2026-09-07 — **Slice 0d (request-scoped tenant binding)**, the slice the owner
> signed after PR3's cutover measurement (ADR-0022 §Runtime cutover: owner 177/177, app role
> 170/177): decisions D-S0d-1…D-S0d-4, rollout re-staged, falsifiable claims 13–19, and a new
> `rls-enforcement` requirement (request-scoped binding) added to the delta spec.
> Slice 0d corrective pass (2026-09-07, re-gate): the marker's adoption rule re-classed to
> EVERY extended-client transaction (19-site snapshot through one shared helper), the
> raw-singleton surface re-scoped to the measured 12 composition-root files / 30 handoffs
> (per-file verdicts; the falsified DI-coverage sentence deleted), both reds re-named to
> their classes, forecasts re-derived, claims 20–24 added. Claims 13–19 stand unchanged.

## Technical Approach

Three staged slices plus one transversal capability, merging stacked-to-main in dependency
order. **Slice 0** turns RLS from decoration into a proven, permanently-gated boundary: a
migration-provisioned `omnipost_app` role (NOSUPERUSER NOBYPASSRLS), the zero-rows and
index-scan proofs run AS that role, and pg-catalog gates that keep failing if anyone re-grants
`BYPASSRLS`, transfers table ownership, or disables RLS on an enrolled table. **Slice 0d**
(signed 2026-09-07 after PR3's measurement) makes the tenant GUC REQUEST-scoped — today it is
bound only inside `PrismaUnitOfWork`/saga transactions, so under the app role every read
outside a unit of work fails closed against the application itself (measured: 170/177) — and
then lands the withheld `DATABASE_URL` flip as this slice's proof. **Slice 1**
retrofits the `Post`/`PostContent`/`PostMedia` trio with denormalized `accountId` backed by
composite FKs over `UNIQUE (id, accountId)`, staged as six hand-shaped migrations
(column → backfill → NOT NULL + uniques → FK `NOT VALID` → `VALIDATE` → RLS enrollment), then
enrolls the trio in both isolation layers. **Transversal** makes the tenant a required,
non-nullable argument of collection-query ports (unscoped inexpressible at compile time) and
completes the coverage gate. **Slice 2** delivers the classified list of the 65 keyless models
— a document, not a sweep.

A load-bearing corrective to the proposal's baseline: the "app_test_role integration test"
promised by the RLS migration header EXISTS as `apps/api/tests/integration/rls-tenant-isolation.test.ts`
(wired in `run-tests.sh`), using a synthetic `rls_test_role` via `SET LOCAL ROLE`. It already
proves zero-rows fail-closed, tenant scoping, `__system__` bypass, `WITH CHECK` rejection, and
guard↔policy 1:1. What it does NOT prove — and what Slice 0 adds — is anything about the role
the application actually connects as, table ownership, `relrowsecurity` drift, or index-scan
survival. Slice 0 is therefore an extension and consolidation of that suite, not a new proof
built beside it (rework over patches: `rls_test_role` is replaced by the real role).

## Architecture Decisions

### D-S0-1: Non-owner app role, NOT `FORCE ROW LEVEL SECURITY`

**Choice**: enforcement rests on the app role being (a) NOSUPERUSER, (b) NOBYPASSRLS, and
(c) not the OWNER of any RLS-enabled table. No `FORCE ROW LEVEL SECURITY` anywhere.
**Alternatives**: `FORCE` on all 60+ tables — rejected for now. `FORCE` only bites when the
table OWNER queries; our owner is `postgres` (superuser), which bypasses RLS regardless of
`FORCE`, so in every current environment `FORCE` is untestable dead configuration. Worse, it
plants a trap for future managed-prod migrations run by a non-superuser owner: every backfill
would silently see zero rows unless it binds the `__system__` GUC.
**Rationale**: the ownership hole `FORCE` closes is closed equivalently, and testably, by gate
(c): the permanent gate asserts `omnipost_app` owns none of the enrolled tables
(`pg_class.relowner`), so "someone runs the app as the owner role" is a red CI, not a silent
bypass. An operator with owner credentials is outside RLS's threat model. **Durable home**: the
per-environment role audit and this FORCE-vs-non-owner decision are recorded in
`docs/technical/ADR-0022-rls-enforcement-posture.md` — a Slice 0 deliverable, the infra ADR the
archived `api-guarded-client-injection` decision already deferred (0022 = next free number at
design time; re-verify at apply — the 0020 collision stays out of scope). **Revisit-if**
(recorded in that ADR): a deployment appears where migrations run as a non-superuser owner —
adopt `FORCE` there plus the `set_config('app.account_id','__system__', true)` opening line in
every backfill.

### D-S0-2: The role is provisioned by MIGRATION; login credentials are provisioned by ENVIRONMENT; the runtime cutover is a bounded, separately-shippable unit

**Choice**: a new migration creates `omnipost_app` idempotently
(`DO $$ ... EXCEPTION WHEN duplicate_object` — roles are cluster-global and the shadow DB
re-runs migrations) as `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, grants
`SELECT/INSERT/UPDATE/DELETE` on all tables + `USAGE` on sequences, and sets
`ALTER DEFAULT PRIVILEGES` so tables created by later migrations are covered forever. NO
password in SQL (CWE-798, security canon: no exception): each environment enables login
(`ALTER ROLE omnipost_app LOGIN PASSWORD ...`) from its own secret channel — docker-compose
init script reading `.env` for dev, a psql step with a deterministic non-production value for
CI (same class as the existing `password123`), the runbook for future prod.
**Runtime cutover** (the app's connection actually using the role): the URL split does NOT
exist yet — it is designed here. `infra/prisma/prisma.config.ts:22` (CLI) and
`infra/prisma/src/client.ts:160` (runtime) both read the SAME `process.env.DATABASE_URL`, and
the runtime client is a SELF-READING singleton: `createPrismaClient()` reads the env var
itself inside `infra/prisma` (it is not fed `env.DATABASE_URL` by the composition root). The
split: `prisma.config.ts` gains `url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? ""`
(superuser/owner channel for migrate/seed); `DATABASE_URL` becomes the app-role URL per
environment (the singleton needs NO code change — the value under it changes at cutover); and
`apps/api/src/config/env.ts` gains `MIGRATE_DATABASE_URL` as an optional server schema entry so
the pair is schema-visible rather than ambient. **Blast radius, stated honestly**: integration
tests seed via the raw `@infra/prisma` singleton "as superuser" (verbatim comment in the
existing suite); under the app role those seeds fail closed. So the cutover requires a
superuser-URL seed client in the test harness, and it ships as Slice 0's LAST work unit with a
measured checkpoint — if the harness split exceeds the slice budget, S0.4 becomes the next PR
in the chain. **Slice 1 is NOT blocked by the cutover**: A′'s guarantee is referential
integrity, which bypasses row security by rule — only the proofs and gates (S0.1–S0.3) block.

### D-S0-3: Proof mechanics — `SET LOCAL ROLE omnipost_app`, deterministic plans via `enable_seqscan`

**Choice**: the zero-rows/`WITH CHECK`/EXPLAIN proofs run inside a Prisma transaction that does
`SET LOCAL ROLE omnipost_app` + `set_config('app.account_id', ..., true)` — the existing
suite's mechanism, retargeted from the synthetic role to the real one (the synthetic
`rls_test_role` and its grants are deleted). The index-scan proof runs
`EXPLAIN (ANALYZE, FORMAT JSON)` on a `Project` read filtered `{ accountId, deletedAt: null }`
(matching the partial index) with `SET LOCAL enable_seqscan = off`, asserting no Seq Scan node.
**Rationale**: with test-sized tables the planner seq-scans everything regardless of policy;
`enable_seqscan = off` tests the actual claim — that the policy qual does not make index access
impossible — instead of the planner's cost model on 4 rows. Volume-realistic plans belong to
the A′-vs-B′ measurement protocol (below), not to a merge-blocking test.

### D-S0-4: The coverage gate lives in the INTEGRATION tier, not fitness.yml

**Choice**: the pg-catalog audit is an integration test (extending
`rls-tenant-isolation.test.ts`, which is already in `run-tests.sh` — no new fitness #30
wiring for the gate itself): for every model in `getTenantScopedModels()`, read
`pg_class.relrowsecurity`, `pg_class.relforcerowsecurity`, the table owner, and `pg_policies`;
pass ONLY full coverage (RLS on + a `tenant_isolation` policy + non-owner app role OR
`relforcerowsecurity` true). The failure output DISTINGUISHES the three partial states, which
fail in opposite directions — policy-without-RLS (**leaks**), RLS-without-policy (**denies**),
owner-without-FORCE (**owner-exempt leak**) — never a generic "not covered". Plus the role
gates: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'omnipost_app'` both
false, and zero enrolled tables with `relowner = 'omnipost_app'::regrole`.
**Alternatives**: a fitness.yml step (the proposal's affected-areas table assumed this) —
rejected: the invariant is DATABASE STATE, and the fitness workflow has no Postgres service;
a grep cannot observe `relrowsecurity`. The `rls-enforcement` delta spec is AMENDED to this
placement (this corrective pass): the gate's mechanism is the integration tier, the red-proof
obligation is retained in full, and the former "mirrored in fitness.yml verbatim" obligation
re-frames onto the integration suite (run-tests.sh wiring + the Integration Tests job) plus a
CLAUDE.md pointer note — a note, not a step. The STATIC arm already exists as fitness #39
(schema ↔ guard ↔ denylist).
**Named failure mode covered**: policy present but RLS disabled (`ALTER TABLE ... DISABLE ROW
LEVEL SECURITY`) — exactly what an "is RLS on?" check misses; red-proof plants precisely that.

### D-S0d-1: Binding mechanism — per-operation implicit-transaction binding via `$extends` (Candidate A)

**The evidence this decision answers**: ADR-0022 §Runtime cutover — same 18-suite batch, same
concurrency, only the role differing: `postgres` 177/177, `omnipost_app` 170/177, exit 1. The
7 failures (`postDeleteOwnership` ×3, `postReadOwnership` ×4) are the application: the GUC is
bound ONLY in `PrismaUnitOfWork.executeInTransaction` (L85-87) and `sagaTenant.ts`, so every
statement outside a unit of work runs unbound and RLS fails closed against the app.

**Choice**: a new `tenantGucBindingExtension(provider)` in
`infra/prisma/src/extensions/tenantGucBinding.ts`, applied in the API composition root
(`apps/api/src/infrastructure/container/setup.ts`) chained with the existing guard and reusing
the SAME `TenantContextProvider`. For every model operation where a scope exists
(`getSystemContext()` → `__system__`, else `getTenantContext()` → `accountId`) and no ambient
GUC-adjudicated transaction is marked (D-S0d-2), it runs the documented Prisma RLS pattern:
`client.$transaction([$executeRaw set_config('app.account_id', scope, true), query(args)])` —
the operation executes inside a two-statement batch transaction with the GUC bound first. No
scope → pass through unwrapped (loud by construction — D-S0d-3). **ALL models bind,
deliberately**: skipping non-enrolled roots would leave `findOwnerAccountId` (root `post`,
unenrolled until Slice 1, JOIN into RLS-covered `Project`) unbound — the exact measured
failure. Stated because it is load-bearing, not decoration: with a scope bound, layer 2 now
also filters NESTED includes on out-of-UoW reads — the guard's known nested-include hole gets
its first engine-level cover.

**Alternatives rejected, with the math**: **(B) request-boundary interactive tx** (a Fastify
hook opening a tx per request): pins one pooled connection per in-flight request for the
request's whole life. The pool is `min(cpu+2, 8)` dev / `max(2·cpu, 10)` prod
(`infra/prisma/src/client.ts getConnectionPoolConfig`, `DB_POOL_SIZE` override), itx defaults
`maxWait` 5000 / `timeout` 30000 — so the (pool+1)-th concurrent request queues 5 s then fails
`P2028`, any slow request hits the 30 s cap, and every external provider call would sit inside
a DB transaction, which the UoW canon forbids verbatim. **(C) session-scoped
`set_config(..., false)` with reset-on-release**: `PrismaPg`'s pool exposes no checkout/release
seam to app code, and one missed reset hands tenant A's scope to tenant B's next borrowed
connection — a cross-tenant LEAK class strictly worse than the fail-closed defect being fixed.
**Candidate A's cost, bounded**: BEGIN + `set_config` + COMMIT framing per out-of-tx operation
— 2-3 round trips, sub-ms on the same-host LXC/CI topologies; connection hold grows by the
same ε, so pool demand keeps today's shape. The empirical check is free: the two-channel batch
re-run (D-S0d-4) records wall time per channel in ADR-0022 beside the pass counts.

**Spike (hour-boxed, 0d-1's first task)**: Prisma's RLS example proves batch enlistment of
`query(args)` for a single extension; here it chains with the guard, so the spike proves
enlistment through the chained `$extends` and pins the working order with a unit test.
One alternative is REJECTED up front and recorded here so the spike does not re-litigate
it: binding on the ambient itx client instead of marker + pass-through (Prisma 7 allows a
nested `$transaction` on the tx client, executed as a SAVEPOINT) does not work —
`SET LOCAL` / `set_config(..., true)` applied inside the savepoint REVERTS when the
subtransaction ends, so the binding evaporates instead of covering the enclosing
transaction's statements.
**Named fallback**: if enlistment through the chain misbehaves, fold the binding into
`tenantGuardCheck`'s wrapper — one extension doing guard-then-bind, same seam, no third
pattern.

### D-S0d-2: One GUC seam — and a correction: pass-through is about CONNECTIONS, not precedence

The signed brief assumed "SET LOCAL inside the UoW tx already wins". Verified: that is NOT the
semantics that holds. A batch transaction opened from the ROOT client inside a UoW callback
checks out a DIFFERENT pooled connection — GUCs are connection-scoped — so a naive wrapper
would not lose to the UoW's binding; it would run the operation unbound AND outside the UoW's
atomicity (an escaped write commits even when the UoW rolls back). The hazard is escape, not
precedence, and it is closed by construction:

**Choice**: `infra/prisma/src/extensions/tenantGuc.ts` (already the GUC's home) gains an
`AsyncLocalStorage` marker — `runWithBoundGuc(scope, fn)` + `isGucBound()` — whose semantics
is "the ambient transaction OWNS GUC adjudication; do not wrap".

**Adoption rule (corrected by the re-gate — the class is wider than "GUC-adjudicating")**:
the marker MUST be held by **every site that opens an interactive or batch transaction on
the extended client**, whether or not that site binds the GUC — a transaction that never
heard of the GUC still owns its connection, and its inner operations still fire the
extension and would escape. Adoption is **in all branches, including the deliberate-unbound
one** (a tx opened with neither context binds nothing on purpose; the marker still prevents
inner escape). Named seams adopt directly: `PrismaUnitOfWork.executeInTransaction` (wraps
`txStorage.run`; the same touch corrects that file's stale L71 comment — "the 51
tenant-scoped tables" against a 58-model guard Set — to the count-free wording the archived
`api-guarded-client-injection` change adjudicated but never landed), `sagaTenant`'s
`runSagaTenantTransaction` / `runSagaSystemTransaction`, and the worker/db-prisma GUC-bound
tx sites.

**Mechanism for the unnamed sites — one shared helper, not 19 hand-rolled adoptions**: no
shared non-UoW transaction seam exists today (verified: every unnamed site calls
`.$transaction` directly; the only shared seams are the UoW and `sagaTenant`).
`tenantGuc.ts` gains `withGucBoundTransaction(client, scope, fn)` — opens the tx, binds via
`set_config` when a scope exists, sets the marker in ALL branches — and the API composition
curries it with the SAME provider the extension reads; workers/db-prisma pass scope
explicitly (their existing convention). Tradeoff weighed and decided: intercepting
`$transaction` itself (zero per-site adoption via a Proxy or method override on the extended
client) is REJECTED — overriding a built-in client method is unsanctioned API, and
batch-form enlistment under an ALS set at array-creation time is exactly the ambiguity the
0d-1 spike exists to avoid multiplying. Routing 19 sites through one helper is a bounded
mechanical rewrite and leaves a single seam for future sites; the residual — a FUTURE
`.$transaction` call that skips the helper — is a NAMED drift risk (see Risks), not "closed
by construction".

**The 19-site snapshot** (re-measured this pass with `\.\$transaction\(` minus the named
seams, `ChannelRepository.ts`, workers, and tests — the gate's 14 plus 5 the wider pattern
surfaces: three UoW-aware ternary FALLBACK arms and two line-wrapped calls). Batch sites
convert to the helper's interactive form — same atomicity, none of the batch-enlistment
ambiguity. Interactive (14): `PrismaPostRepository.ts:453` (create) / `:507` (update) /
`:156` (hard-delete fallback arm), `PrismaProjectRepository.ts:376` and
`PrismaAccountRepository.ts:402` (same fallback shape), `EventStore.ts:79`,
`SchedulingPostHandlers.ts:246` + `:342`, `SchedulingSlotHandlers.ts:412`,
`PrismaMediaAssetRepository.ts:216`, `PrismaApprovalWorkflowRepository.ts:121`,
`PrismaApprovalRequestRepository.ts:153`, `PrismaAnalyticsWriteRepository.ts:57`,
`db-prisma/PostRepository.ts:94` (raw client today — no escape hazard, but the helper gives
it binding + marker in one move). Batch (5): `OutboxClaimService.ts:141`,
`outboxAdminRoutes.ts:60` (resolves `TOKENS.PrismaClient` — extended),
`gatewaySwitchProcessor.ts:113`, `PrismaTrackedLinkRepository.ts:159` + `:176`. The
enumeration is the design-time snapshot, not the rule — apply re-runs the pattern.

The binding extension passes through when the marker is set, so inside an adopted
transaction the operation stays on that transaction's connection, bound at most once. Layer agreement needs no
protocol: guard injection (layer 1) and GUC binding (layer 2) read the SAME provider in the
same synchronous chain; if they ever diverged, composition is intersection
(`WHERE accountId = X` AND policy `= Y`) — zero rows, fail closed, never a leak.

### D-S0d-3: Reads with no tenant context — every class either binds deliberately or fails LOUDLY

| Class                                                                                                | Binding                                                                                                                                                                                                                                  | Loud-failure story                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authed customer HTTP (`enterTenantContext` ALS)                                                      | extension binds `accountId`                                                                                                                                                                                                              | n/a — bound                                                                                                                                                                                |
| Admin/system flows (`withSystemContext`)                                                             | extension binds `__system__`                                                                                                                                                                                                             | the grep-able reason constant is the audit                                                                                                                                                 |
| Pre-auth routes (login, inbound webhooks, billing webhooks)                                          | no scope → pass through unbound                                                                                                                                                                                                          | guard throws `TenantContextMissingError` on any enrolled model (the 15 preAuth/tenant suites pin this); global tables carry no policy                                                      |
| Health/boot (`SELECT 1`, `verifyDatabaseAuth`)                                                       | none needed                                                                                                                                                                                                                              | raw non-table statements, unaffected                                                                                                                                                       |
| In-process consumers (repurpose/triage/trend/bulk-schedule)                                          | bind `withTenantContext`/`withSystemContext` from job payload (existing convention)                                                                                                                                                      | guard throw if a consumer forgets; the full-tier green under the flip is the sweep                                                                                                         |
| Saga engine                                                                                          | already explicit on BOTH layers (`sagaTenant.ts`)                                                                                                                                                                                        | discriminated skip outcomes; 0d only adds the D-S0d-2 marker                                                                                                                               |
| Workers + live-wired `db-prisma` repos + api raw-singleton consumers (`index.ts`, `healthRoutes.ts`) | NO implicit binding — explicit GUC-bound tx per read, the SHIPPED `ChannelRepository` pattern (tenant-bound; `__system__` ONLY for narrow tenant-DISCOVERY selects with in-file justification, the `getChannelOwnerAccountId` precedent) | 0d-2 converts the remaining live-wired read sites; an unconverted site fails closed and CI's worker readiness gate + full tier turn red                                                    |
| API composition-root raw-singleton wiring (12 setup files / 30 handoffs — 0d-2's re-scoped surface)  | CONVERT to the container's guarded client — the `prisma: PrismaClient` param the type-only-import setup siblings already model; per-file verdicts in D-S0d-4                                                                             | today these sites VIOLATE no-context-stays-loud (silent zero rows under the app role, no guard throw); conversion is what brings them under it — pinned by 0d-2's brandKit fail-closed red |
| Migrations / seeds / test fixtures                                                                   | owner channel: `MIGRATE_DATABASE_URL` + `createSeedPrismaClient()`                                                                                                                                                                       | a NAMED channel at every call site — never a silent fallback (PR3's named-factory decision stands)                                                                                         |
| Raw ops (fitness #23's four-file inventory)                                                          | audited per site: `EventStore` is a global table (no policy); the pgvector UPDATEs and the UoW's own `set_config` are in-tx                                                                                                              | #23's exception list IS the inventory — no new mechanism                                                                                                                                   |

The client-swap rejection is SCOPED to code shared with the workers (`db-prisma`, the
`index.ts` repo-adapter feed, `healthRoutes.ts`): there, no ALS exists — one explicit
pattern per package beats a per-consumer split, and the package already ships it. It does
NOT extend to the 12 API-only composition-root setup files (the re-gate falsified the
coverage claim that hid them): for those, the client swap IS the verdict — their repos serve
ALS-carrying flows and are stateless over the client handle (D-S0d-4's per-file table). Two closures stated precisely: (a) because the policy↔guard 1:1 gate holds, "RLS-
covered but not guard-enrolled" is EMPTY, so on the guarded+bound client an unbound statement
that RLS would silently zero-row is instead a THROWN error — silence survives only on the
raw-singleton class, which is exactly what 0d-2 converts. (b) Residual, honest: a NO-context
read rooted at a global model that `include`s a covered relation passes the guard (the known
nested-include doctrinal hole) and, unbound, loses nested rows silently; such paths must
declare `withSystemContext`, and the hole itself stays with its existing backlog owner rather
than growing a new gate here.

### D-S0d-4: The 7-failure class, `findOwnerAccountId`, the flip, and the staging

**The class, covered by mechanism — coverage stated against the MEASURED wiring, not the
assumed one**: the 7 failures are one class — guarded-client reads outside any UoW — and the
extension covers every repository that actually RECEIVES the container client. The re-gate
FALSIFIED the previous "every repository resolved from DI shares the container client"
claim: 12 composition-root setup files hand the raw `@infra/prisma` singleton into 30
handoff lines (27 `new Prisma*(prisma)` constructions + the two trend adapters at
`setupTrendUseCases.ts:59-60` + the `setupSamlUseCases.ts:72` constructor-arg pass), so
those repositories are DI-resolved yet UNGUARDED and UNBOUND — under the app role they
zero-row SILENTLY, violating the new no-context-stays-loud requirement today; 0d-2's
conversion is what brings them under it. After conversion, the only reads outside the
mechanism are the worker-shared explicit class (D-S0d-3) and the #23 raw-op inventory
(audited rows, no new mechanism).

**0d-2's re-scoped surface — per-file verdicts** (all 12 CONVERT; the explicit-GUC-tx
verdict is reserved for the worker-shared class, and none of these files is worker-shared.
Mechanical shape: each setup fn gains the `prisma: PrismaClient` param its type-only-import
siblings — `setupPostUseCases`, `setupProjectUseCases`, … — already use; `setup.ts` passes
`guardedPrisma`):

| Setup file (handoffs)                                                                          | Verdict                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setupAssetUseCases.ts:34-36` (3)                                                              | Convert — authed tenant flows; repos stateless over the client                                                                                         |
| `setupCrmUseCases.ts:29-32` (4)                                                                | Convert — tenant flows; CRM sync consumers bind from job payload (existing convention)                                                                 |
| `setupReferralUseCases.ts:37-49` (4)                                                           | Convert — signup-time code lookup is tenant DISCOVERY → declared `__system__` narrow select with in-file justification                                 |
| `setupLocalizedGenerationUseCases.ts:45-55` (3)                                                | Convert — call paths already `requireTenantContext()`; their raw pgvector ops stay in #23's audited inventory (the extension does not adjudicate raw)  |
| `setupBrandKitUseCases.ts:23` (1)                                                              | Convert — the 0d-2 fail-closed red's NAMED site (`brandKit` is guard-enrolled)                                                                         |
| `setupBrandVoiceUseCases.ts:23` (1)                                                            | Convert — tenant flows                                                                                                                                 |
| `setupCustomReportUseCases.ts:26-28` (2)                                                       | Convert — tenant flows                                                                                                                                 |
| `setupInboxUseCases.ts:258,307,311` (3)                                                        | Convert — in-process consumers bind from payload (D-S0d-3 row)                                                                                         |
| `setupTrendUseCases.ts:50,59,60,68,120` (5)                                                    | Convert — trend consumers bind from payload                                                                                                            |
| `setupWebhookAdminUseCases.ts:21` (1)                                                          | Convert — admin flows declare `withSystemContext`                                                                                                      |
| `setupSecretsRotationUseCases.ts:20` (1)                                                       | Convert — admin surface, system scope                                                                                                                  |
| `setupSamlUseCases.ts:39,72` (2)                                                               | Convert — pre-auth SSO discovery reads DECLARE `__system__` (the `getChannelOwnerAccountId` precedent); conversion is what forces the declaration loud | **`findOwnerAccountId`** (`PrismaPostRepository.ts:437`, finding 8) |
| is additionally fixed properly NOW: the `row.project` dereference becomes a null-checked       |
| NotFound-shaped return. ADR-0022 deferred that fix to "whoever takes the request-scoped-       |
| binding decision" precisely because fixing it earlier would mask the cutover red; with binding |
| landed the masking objection is gone.                                                          |

**The flip (0d-3, last)**: `DATABASE_URL` → `omnipost_app` in `.env` + `.env.test`
(owner-applied) and ci.yml (token surface, orchestrator-applied); `MIGRATE_DATABASE_URL`
keeps the owner channel and stays its ONLY consumer besides the harness seed factory. **Exit
condition = task 6.5, proved**: the same batch 177/177 on the app-role channel (red already
on record: 170/177), the FULL integration tier green under the flipped `.env.test`, CI's
worker readiness gate green, and the two-channel table in ADR-0022 §Runtime cutover re-run
and updated from "blocked" to "landed" with wall times per channel.

**Staging — three stacked PRs between PR 3 and PR 4, STRICT TDD reds named per piece**:

| PR   | Scope                                                                                                                                                                                                                                                                                                                                      | RED (observed first)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Forecast                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0d-1 | spike + `tenantGucBinding.ts` + `tenantGuc.ts` marker + `withGucBoundTransaction` helper + adoption at UoW/saga seams AND the 19-site snapshot (batch sites → interactive helper form) + stale-L71 comment fix + `findOwnerAccountId` null-check + composition in `setup.ts`                                                               | the MEASURED 170/177 app-role channel (`postReadOwnership`/`postDeleteOwnership` go green on this PR); plus the ESCAPE red, named on a NON-UoW site so it can fail for its class: `PrismaPostRepository.create` (:453) — force the nested `postContent.create` to fail on the extended client; a `Post` row SURVIVING the failure proves an inner operation escaped onto a second connection and committed; red while :453 lacks the helper, green once routed (the spec's UoW atomicity scenario stays pinned separately) | re-derived: ~380-420 authored lines — EXCEEDS the 400 budget; tasks phase splits adoption-first (0d-1a: helper + 19 sites + marker seams) then extension (0d-1b: binding + composition + `findOwnerAccountId`); NEVER extension-first — composing the extension before full adoption arms the escape hazard |
| 0d-2 | conversion of the 12 composition-root setup files (30 raw-singleton handoffs → guarded client, per-file verdicts in D-S0d-4) + explicit GUC-bound-tx conversion of the worker-shared class (`db-prisma` read sites, `index.ts` repo-adapter feed, `healthRoutes.ts`); #38 db-prisma ratchet re-measured same commit (may fall, never rise) | the FAIL-CLOSED red, named on a raw-singleton-wired ENROLLED model: a `brandKit` row seeded on the owner channel, read through the still-raw-wired repository as `omnipost_app` with tenant context bound at request scope → ZERO rows, silently (no guard throw — the silence IS the defect); red before the file converts, green after (row returned; a no-context read now throws)                                                                                                                                      | re-derived: ~250-350 lines, Medium-High — the 12 files' param threading is mechanical; the per-file system-scope declarations (saml, referral, webhook-admin) are judgement                                                                                                                                 |
| 0d-3 | harness sweep (per Finding 9's ~65-file measurement) + the flip + 6.5 proof + ADR-0022 update                                                                                                                                                                                                                                              | the full integration tier on the app-role URL BEFORE the sweep — fails on fail-closed seeds; green after sweep + flip                                                                                                                                                                                                                                                                                                                                                                                                      | re-derived: ~300 lines, High — the honest split per Finding 9, NOT a "mechanical majority": 28 no-arg `createTestPrismaClient` conversions are mechanical 2-liners, the ~20 raw-singleton seeders are per-file JUDGEMENT (which channel each seed belongs to); tasks phase re-forecasts                     |

### D-S1-1: Schema deltas — refined against the CURRENT models

**Choice** (verified against `schema.prisma` lines 640–777):

```prisma
model Project {                                  // existing fields unchanged
  @@unique([id, accountId])                      // NEW — TOTAL unique (no where:), FK target.
}                                                // Coexists with the partial
                                                 // @@unique([accountId, name], where: {deletedAt: null})
model Post {
  accountId String                               // NEW
  project   Project @relation(fields: [projectId, accountId],
                              references: [id, accountId],
                              onDelete: Cascade, onUpdate: NoAction)  // was single-column
  @@unique([id, accountId])                      // NEW — FK target for the children
  @@index([accountId, projectId], where: { deletedAt: null })  // NEW — the ONE new index
}
model PostContent {
  accountId String                               // NEW
  post      Post @relation(fields: [postId, accountId],
                           references: [id, accountId],
                           onDelete: Cascade, onUpdate: NoAction)
}
model PostMedia {
  accountId String                               // NEW
  post      Post @relation(fields: [postId, accountId],
                           references: [id, accountId],
                           onDelete: Cascade, onUpdate: NoAction)
}
```

The uniques are TOTAL on purpose: children referencing soft-deleted parents keep FK integrity
because the rows still exist (partial uniques cannot be FK targets — "non-partial unique
index" is a hard Postgres rule). `ON DELETE CASCADE` is INHERITED from the adjudicated
convention (`docs/architecture/schema-conventions.md` §Choosing the `ON DELETE` action — its
Project-aggregate worked example names all three trio relations as required-FK owned-child
Cascades; soft delete is the product path, Cascade fires only on admin hard-delete).
`ON UPDATE` is pinned to **NoAction**, NOT the Prisma-default Cascade: under Cascade,
re-pointing `Project.accountId` would silently rewrite every child's tenant key — exactly the
quiet Project-move the proposal's non-goal keeps noisy. Under NoAction that UPDATE is refused
while children reference the row; pinned by the named test "project accountId update is
refused while posts reference it" in `tenant-composite-fk.test.ts`. The `MATCH SIMPLE` escape
stays foreclosed independently: every referencing column is `NOT NULL`.
**Index discipline (Lane's rule, adopted verbatim)**: ONE new index —
`(accountId, projectId) WHERE deletedAt IS NULL` on `Post`. It serves the RLS policy's tenant
qual AND tenant-wide listings; hard-delete cascades are already served by the existing
`projectId`-led partials. Post's 7 existing indexes are untouched. `PostContent`/`PostMedia`
get NO new index: their reads are `postId`-led (equality is LEAKPROOF, so the caller's filter
still index-scans ahead of the policy qual), and tenant-wide child listings are not a product
query. This is a DECIDED tradeoff, not silence: it is recorded as the amended
`multi-tenant-isolation` leg-1 exemption (a shape-1b child with parent-key-led guarded reads
MAY omit the accountId-led index — index cost paid by demonstration, not in bulk), with the
revisit trigger verbatim: if Slice 1's `EXPLAIN ANALYZE` evidence shows the RLS policy qual
degrading either table to a sequential scan, the accountId-led index is added in the SAME
slice.

### D-S1-2: Prisma spike — protocol, decision criteria, and the named fallback

The trio itself DODGES the shared-scalar question by design: `Post.accountId` participates in
exactly one relation (the composite one to `Project`; deliberately NO direct `Account`
relation and no `Account.posts` back-relation), likewise the children toward `Post`. The spike
exists because Slice 2 models that already carry a direct `Account` relation will hit it, and
the pattern must be decided before any of them migrate.
**Protocol** (throwaway schema in the scratchpad, half a day cap): (1) `prisma validate` +
`prisma migrate diff` on a model whose `accountId` appears in TWO relations' `fields` lists;
(2) generated-client type check of `create`/nested-create inputs; (3) `db pull` round-trip.
**Decision rule**: any of the three fails → **fallback = the Post pattern**: drop the direct
`Account` relation, keep ONLY the composite parent relation; `Account` navigation goes through
the parent. **Explicitly rejected fallback**: declaring the composite FK in raw SQL while the
schema keeps a single-column relation — `prisma migrate dev`'s drift detection would schedule
the constraint's DROP in the next generated migration; a guarantee the toolchain keeps trying
to delete is not a guarantee.

### D-S1-3: Migration sequence — six files, budgets, P3009 posture

All hand-shaped from `--create-only`, each opening with `SET lock_timeout` /
`SET statement_timeout` (squawk `require-timeout-settings` is active). Timestamps strictly
ascending in this order (the migration-ordering assertion from the archived
`external-notification-tenant-guard` design applies: RLS last, columns first —
`openspec/changes/archive/external-notification-tenant-guard/design.md`). Names follow
`<timestamp>_<snake_case_description>` per `docs/architecture/schema-conventions.md`
§Migration naming — no phase-marker prefixes.

| #   | File (`infra/prisma/migrations/<ts>_...`) | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Budgets                                                  |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `add_post_trio_tenant_columns`            | `ADD COLUMN "accountId" TEXT` (nullable) ×3 — catalog-only in PG11+                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | lock 5s / stmt 30s                                       |
| 2   | `backfill_post_trio_tenant_columns`       | Idempotent keyset-BATCHED backfill (`DO $$` loop, 10k rows per pass in id order — bounds per-statement work and memory): `UPDATE ... SET "accountId" = src."accountId" FROM ... WHERE "accountId" IS NULL` — Post←Project, then PostContent←Post, PostMedia←Post — followed by an in-tx `DO $$ RAISE EXCEPTION` if any NULL remains. **Batched in EVERY environment** (spec: single-pass whole-table UPDATE SHALL NOT be used — Citus warns against it explicitly; one migration shape everywhere, so the deploy path needs no variant). **NO `deletedAt` filter, deliberately**: soft-deleted rows must satisfy the coming NOT NULL; commented in-file (fitness #38 does not scan SQL, but the discipline is stated). Honest limit: still ONE transaction (P3009 posture), so row locks accumulate to commit — batching bounds statements, not lock lifetime | lock 5s / stmt 10min; row locks only, no AccessExclusive |
| 3   | `post_trio_tenant_not_null_and_uniques`   | `SET NOT NULL` ×3; `ADD CONSTRAINT ... UNIQUE (id, "accountId")` on `Project` and `Post`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | lock 5s / stmt 10min                                     |
| 4   | `post_trio_composite_fk_not_valid`        | Per child: `DROP CONSTRAINT` (old single-column FK) + `ADD CONSTRAINT ... FOREIGN KEY (parentFk, "accountId") REFERENCES parent(id, "accountId") ON UPDATE NO ACTION ON DELETE CASCADE NOT VALID` — squawk `adding-foreign-key-constraint` satisfied; constraint fully live for new writes immediately                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | lock 5s / stmt 30s                                       |
| 5   | `post_trio_composite_fk_validate`         | `VALIDATE CONSTRAINT` ×3 — separate file = separate tx = `SHARE UPDATE EXCLUSIVE` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | lock 5s / stmt 10min                                     |
| 6   | `add_rls_post_trio` + `down.sql`          | `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (local-column form COPIED from `20260527000000`, which is never edited) ×3; operator `down.sql` per convention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | lock 5s / stmt 30s                                       |

**File 3's lock, characterized honestly**: `SET NOT NULL` ×3 and `ADD CONSTRAINT UNIQUE` ×2
each take `AccessExclusive` and HOLD it through the full-table scan / index build —
`lock_timeout` bounds only the WAIT to acquire, never the hold. Acceptable for today's single
deployable (dev/CI, no prod). Live-path variants, NAMED for the runbook: `SET NOT NULL` via
`ADD CONSTRAINT ... CHECK ("accountId" IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT` →
`SET NOT NULL` (PG12+ skips the scan by using the validated CHECK) → `DROP CONSTRAINT`; the
uniques via `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT ... UNIQUE USING INDEX`.
**P3009**: every file is transactional (no CONCURRENTLY), so an abort (a `lock_timeout` hit
queueing behind a reader) leaves a clean rollback + a failed ledger row; the recovery verb is
`migrate resolve --rolled-back`, per the runbook in `docs/architecture/schema-conventions.md`
§Recovering a failed migration — the design adds nothing to that runbook and must not
contradict it (aborted migrations can NOT "simply be re-run").

### D-S1-4: Enrollment + threading — what the guard injects vs. what becomes explicit

**Enrollment (same slice as the columns — fitness #39 forces it):** append `post`,
`postContent`, `postMedia` to `TENANT_SCOPED_MODELS` (58 → 61, header count updated); RLS
policies via file 6; `MULTI_TENANT_GUARDS.md` 3-step checklist + the 58→61 count updated at
the five verified sites — L46, L51, L111, L410, L460 at review time (re-verify at apply). The existing
1:1 policy↔guard integration test makes a half-enrollment (guard without policy, or policy
without guard) an automatic red. The existing assertion "`Post` (transitively scoped) does NOT
have RLS enabled" FLIPS to positive in this slice — that flip is the visible proof the
boundary moved.
**Reads**: no hand-written `where.accountId` on trio reads — the layer-1 guard injects it for
enrolled models exactly as it does for the other 58. **Creates become explicit by type**: once
`accountId` is required, Prisma's create inputs demand it at compile time (the guard's runtime
injection cannot satisfy `tsc`). Per the parent-resolution threading precedent (archived
`external-notification-tenant-guard` design, same path as cited in D-S1-3): thread
`project.accountId` from a guard-scoped parent resolution into `Post` creates; children take
`post.accountId` (nested creates included). Touched writers: `PrismaPostRepository` (+ nested content/media),
`PrismaPostQueryRepository` builders (already seed `deletedAt: null` above the window — their
#38 file-exception status is unchanged), the live-wired `packages/adapters/db-prisma` post/
project factories (SMELL-87 territory — compile-forced, and the #38 db-prisma ratchet baseline
must be RE-MEASURED in the same commit, never raised), and `infra/prisma` seed paths. The
guard then VALIDATES the explicit value against the bound context (mismatch → throw), and the
composite FK is the final, engine-owned check — three layers, each catching the one above.
**UoW**: no structural change; `PrismaUnitOfWork`'s existing `set_config` starts protecting
three more tables for free.

### D-T1: `tenant-scoped-query-contract` — the concrete TypeScript shape

**Choice**: a domain-level scope type plus a signature convention, applied to the trio's
collection ports as the reference implementation:

```typescript
// packages/core/domain — TenantScope.ts (new)
export interface TenantScope {
  readonly accountId: string; // non-nullable by construction; VO-validated non-empty
}
```

The REAL port surface (verified this session — both ports live in
`packages/core/domain/src/repositories/PostRepository.ts`):

| Port method (line)                                                                                              | Today                                              | Slice-1 action                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PostRepository.countByProjectId(projectId)` (L86)                                                              | `projectId`-only                                   | gains required `scope: TenantScope` as first param                                                                 |
| `PostRepository.countByStatus(projectId, status)` (L91)                                                         | `projectId`-only                                   | same                                                                                                               |
| `PostQueryRepository.search(projectId, text, pagination?)` (L251)                                               | `projectId`-only — the uncovered listing           | same                                                                                                               |
| `PostQueryRepository.getUpcoming(projectId, limit?)` (L260) / `.getRecentlyPublished(projectId, limit?)` (L265) | `projectId`-only collection reads                  | same — the slice enumerates the FULL trio collection surface; this table is the design-time snapshot, not a sample |
| `PostQueryRepository.listByProject(projectId, accountId, ...)` (L240)                                           | already carries a REQUIRED `accountId` (2nd param) | conforms in substance; normalized to the scope-first convention                                                    |
| `PostQueryRepository.listGlobal(accountId, ...)` (L285)                                                         | already conforms                                   | unchanged                                                                                                          |

"Unscoped is inexpressible" is achieved positionally and structurally: `scope` is the first
REQUIRED parameter — a call without a tenant does not type-check; there is no overload without
it, no optional variant, and `exactOptionalPropertyTypes` forbids smuggling `undefined`. The
adapter passes `scope.accountId` into `where` explicitly; the guard validates it; RLS
re-checks it. A `@ts-expect-error` type-test pins the inexpressibility (deleting the parameter
turns the suppression into a compile error — a self-red gate). **Scope boundary, explicit
(spec wins — same-slice rule)**: the TRIO's collection-port conversion ships INSIDE Slice 1,
the same slice as its data-layer enrollment — the `tenant-scoped-query-contract` spec forbids
data-layer enrollment shipping ahead of its query-layer counterpart. The Transversal slice
keeps the REST of the surface: the enrolled-queries/residual table, the pattern-as-canon ADR
(`docs/technical/ADR-0023-tenant-scoped-query-contract.md`, number re-verified at apply,
required by config rule "new canon-affecting decisions require an ADR"), and the remaining
application-layer collection queries. Sweeping those is follow-up sized by Slice 2's output —
not silently absorbed here.

### D-S2: Triage deliverable shape (bounded)

`docs/security/TENANT_KEY_TRIAGE.md`: one row per keyless model — columns: model / ownership
path / Buffer discriminator ("can it exist before its container or be orphaned of its
ownership path?") / nullable-parent? / any access path that skips the parent? / verdict
(**own key** | **composite-FK inheritance suffices** | **legitimately global**) / evidence
line. The actionable number ("how many of the 65 are tenant-owned") is the document's first
line. No migrations in this slice.

## Data Flow (Slice 1 write path)

    CreatePostUseCase (UoW tx → GUC bound by PrismaUnitOfWork)
      → projectRepository.findById(projectId)      [guard injects accountId; foreign → NotFound]
      → post.accountId = project.accountId          [threaded, never caller-supplied]
      → PrismaPostRepository.save                   [guard VALIDATES accountId == ctx]
      → INSERT Post(projectId, accountId)           [composite FK: engine rejects divergence]
      → nested PostContent/PostMedia rows            [inherit post.accountId; own composite FKs]
      → RLS layer 2 re-checks vs app.account_id     [now enforced: omnipost_app, no BYPASSRLS]

## File Changes

| File                                                                                                | Action        | Slice | Description                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/reports/RLS_POSTURE_RED_BASELINE.md`                                                          | Create        | 0     | S0.0 — the one-shot historical red: failing zero-rows run captured against the CURRENT posture (`postgres`, `BYPASSRLS`) BEFORE the role migration lands.                                     |
| `infra/prisma/migrations/<ts>_create_omnipost_app_role/migration.sql`                               | Create        | 0     | D-S0-2 role + grants + default privileges (idempotent). **SENSITIVE**                                                                                                                         |
| `infra/prisma/prisma.config.ts`                                                                     | Modify        | 0     | CLI channel of the URL split: `url: MIGRATE_DATABASE_URL ?? DATABASE_URL ?? ""` (D-S0-2).                                                                                                     |
| `apps/api/src/config/env.ts`                                                                        | Modify        | 0     | Optional `MIGRATE_DATABASE_URL` server entry; `DATABASE_URL` becomes the app-role URL at cutover. **SENSITIVE**                                                                               |
| `docker-compose.yml`, `.github/workflows/ci.yml`                                                    | Modify        | 0     | Enable login for `omnipost_app` per environment (password from env, never SQL).                                                                                                               |
| `scripts/db/` init hook (app-role login)                                                            | Create        | 0     | Dev init script reading `.env` to enable login — new file, not an edit.                                                                                                                       |
| `docs/technical/ADR-0022-rls-enforcement-posture.md`                                                | Create        | 0     | Per-environment role audit + FORCE-vs-non-owner decision (the infra ADR `api-guarded-client-injection` deferred).                                                                             |
| `apps/api/tests/integration/rls-tenant-isolation.test.ts`                                           | Modify        | 0,1   | Consolidate onto `omnipost_app` (delete `rls_test_role`); add attribute/ownership/`relrowsecurity`+`relforcerowsecurity` gates + EXPLAIN proof (S0); flip the Post-has-no-RLS assertion (S1). |
| `infra/prisma/schema.prisma`                                                                        | Modify        | 1     | D-S1-1 deltas. **SENSITIVE**                                                                                                                                                                  |
| `infra/prisma/migrations/<ts>_*` (6 files + 1 `down.sql`, names per D-S1-3)                         | Create        | 1     | D-S1-3 sequence. **SENSITIVE**                                                                                                                                                                |
| `infra/prisma/src/extensions/tenantGuard.ts`                                                        | Modify        | 1     | Enroll trio; 58 → 61. **SENSITIVE**                                                                                                                                                           |
| `docs/security/MULTI_TENANT_GUARDS.md`                                                              | Modify        | 1     | 3-step enrollment record + 58→61 at L46, L51, L111, L410, L460 (re-verify at apply).                                                                                                          |
| `apps/api/src/infrastructure/repositories/PrismaPostRepository.ts` / `PrismaPostQueryRepository.ts` | Modify        | 1     | Thread `accountId` in creates/nested creates; builders unchanged in exception status.                                                                                                         |
| `packages/adapters/db-prisma/**` (post/project factories)                                           | Modify        | 1     | Compile-forced `accountId` threading; re-measure #38 `DBPRISMA_BASELINE` same commit.                                                                                                         |
| `packages/core/domain/src/repositories/PostRepository.ts` (+ query port, + new `TenantScope.ts`)    | Modify/Create | 1     | D-T1 trio signatures; callers updated (same-slice rule — moved from T).                                                                                                                       |
| `apps/api/tests/integration/tenant-composite-fk.test.ts`                                            | Create        | 1     | FK-violation proof, access-path matrix, `ON UPDATE NoAction` pin, NOT NULL / MATCH SIMPLE scenarios.                                                                                          |
| `apps/api/tests/integration/post-trio-tenant-isolation.test.ts`                                     | Create        | 1     | Trio isolation scenarios from the `multi-tenant-isolation` delta (guarded reads, direct child reads, 404 create paths).                                                                       |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                                                  | Modify        | 1     | Decision-matrix extension for the trio enrollment.                                                                                                                                            |
| `apps/api/scripts/run-tests.sh`                                                                     | Modify        | 1     | Wire the two NEW integration suites into a `run_batch` (fitness #30 — an unwired suite never executes).                                                                                       |
| `docs/technical/ADR-0023-tenant-scoped-query-contract.md`                                           | Create        | T     | Canon addition per config rule (number re-verified at apply).                                                                                                                                 |
| `scripts/rls-ab-measurement.ts` + `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                       | Create        | 1     | Pre-migration baseline (§Before) + A′-vs-B′ protocol + recorded evidence.                                                                                                                     |
| `docs/security/TENANT_KEY_TRIAGE.md`                                                                | Create        | 2     | D-S2 classified list.                                                                                                                                                                         |

## A′-vs-B′ measurement protocol (opportunistic, Slice 1)

**Pre-migration baseline first (owner: the Slice 1 executor; moment: Slice 1 work unit 0,
BEFORE migration file 1 is authored or applied; artifact:
`docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §Before)**: capture
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the hot `Post` listing paths against the
pre-change schema — the after-plans and both policy arms append to the SAME report, so
before/after is one document, not an assertion.

Standalone script (outside fitness/test tiers — evidence, not a gate): seed 2 tenants ×
representative volume (≥100 projects, ≥10k posts, ANALYZE), run as `omnipost_app` with GUC
bound, capture `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the three research-§5 shapes —
point-by-ID, `projectId`-filtered listing, unfiltered listing — under (arm 1) the shipped
local-column policy and (arm 2) a tx-scoped policy swap to the decorrelated set-membership
form. Both arms identical queries, three runs, medians recorded in the report with plan node
types. The report states the revisit trigger verbatim: if B′ measures well AND Slice 2
classifies many more than 3 tables, the per-table decision reopens (A′ and B′ are not mutually
exclusive per table).

## Testing Strategy (strict TDD — each red is the reintroduced defect)

| Gate / test                                                     | Red =                                                  | Red proof mechanism                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role attribute gate (integration)                               | app role can bypass RLS again                          | Written first → red while role absent; plant `ALTER ROLE omnipost_app BYPASSRLS` → red → revert                                                                                                                                                               |
| Ownership gate                                                  | app role owns enrolled tables                          | Plant `ALTER TABLE ... OWNER TO omnipost_app` on one table → red → revert                                                                                                                                                                                     |
| `relrowsecurity` coverage gate                                  | RLS silently disabled on an enrolled table             | Plant `DISABLE ROW LEVEL SECURITY` → red → re-enable                                                                                                                                                                                                          |
| Zero-rows proof (as `omnipost_app`)                             | wrong-tenant reads return rows                         | TWO reds, distinct: the one-shot HISTORICAL red — captured FIRST (S0.0) against the current posture into `docs/reports/RLS_POSTURE_RED_BASELINE.md` BEFORE S0.1 lands; and the PERMANENT regression red — the `ALTER ROLE omnipost_app BYPASSRLS` plant above |
| Index-scan proof                                                | policy qual forces seq scan                            | `enable_seqscan=off` + no-SeqScan-node assert; red demonstrated by pointing the query at a column with no index                                                                                                                                               |
| FK-violation proof (integration, `tenant-composite-fk.test.ts`) | cross-tenant child row writable                        | Written BEFORE file 4 → red (mismatched insert succeeds) → FK lands → green                                                                                                                                                                                   |
| `ON UPDATE NoAction` pin (integration, same file)               | a Project account move silently cascades into children | "project accountId update is refused while posts reference it" — red under the Prisma-default Cascade, green once file 4 pins NO ACTION                                                                                                                       |
| Guard membership/injection (vitest, `tenantGuard.test.ts`)      | trio unenrolled                                        | Extend decision-matrix cases; red before the Set append                                                                                                                                                                                                       |
| Policy↔guard 1:1 (existing)                                     | half-enrollment                                        | Already permanent; goes red automatically on drift                                                                                                                                                                                                            |
| `@ts-expect-error` scope test (unit)                            | unscoped collection query expressible                  | Compiler-owned: suppression errors when the defect returns                                                                                                                                                                                                    |
| Backfill NULL-assert (migration)                                | rows escaped backfill                                  | In-tx `RAISE EXCEPTION` fails the DEPLOY, not just a test                                                                                                                                                                                                     |

CI: all DB-state gates run in ci.yml's Integration Tests job (pgvector/pg16 service, migrate →
seed → run-tests.sh; `rls-tenant-isolation.test.ts` is already in a `run_batch`, so the
coverage gate itself needs zero new wiring; the two NEW Slice 1 suites are added to a
`run_batch` in the same slice — fitness #30, an unwired suite never executes). LXC locally:
single-file runs only.

## Threat Matrix

N/A — data-layer authorization/integrity change; no routing, shell, subprocess, VCS/PR
automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Stacked-to-main, auto-chain: **S0.0 FIRST — capture the current-posture red**: run the
wrong-tenant read against today's posture (`postgres`, `BYPASSRLS`) and commit the failing
output as `docs/reports/RLS_POSTURE_RED_BASELINE.md` BEFORE the role migration lands — the
one-shot HISTORICAL red this area has never had; the planted `ALTER ROLE omnipost_app
BYPASSRLS` in the gate suite stays the PERMANENT regression red → S0.1–0.3 (role + proofs +
gates + ADR-0022) → S0.4 (cutover MECHANISM — shipped as PR 3; the flip itself was withheld on
the measured 170/177) → **Slice 0d** (request-scoped binding; three stacked PRs per
D-S0d-4's staging table — 0d-1 helper + 19-site adoption + extension (adoption never lands
AFTER the extension), 0d-2 composition-root conversion (12 files) + the worker-shared
explicit class, 0d-3 harness sweep + the `DATABASE_URL` flip + the 6.5 exit proof; the flip
ships in NO earlier PR) → PR 4 (Slice 1 work unit 0 — the
unrepeatable pre-migration §Before baseline) → Slice 1
(schema/migrations/enrollment/threading + the trio's query-contract port conversion per D-T1 —
data-layer enrollment never ships ahead of its query-layer counterpart; will exceed the
400-line budget on migrations alone; tasks phase forecasts the internal split) → Transversal
(remaining collection-query surface + ADR-0023) ∥ Slice 2.

**Slice 1's completion report carries the independence statement as a deliverable** (the
`rls-enforcement` delta's "stated, not implied" requirement): the composite FK holds
independently of RLS configuration; RLS stays INERT for the RUNNING app until S0.4's cutover
lands; and any environment whose role audit was deferred is still red — the FK's strength is
never reported as RLS being fixed.

Rollback is per-slice revert + paired down-migration, in reverse file
order (drop FK `NOT VALID` without rewrite; drop uniques independently of the partial uniques;
drop columns restores fitness #39 green because bearing status leaves with the enrollment).

## Risks (decided mitigations)

| Risk                                                                              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Index bloat on `projectId`-led tables                                             | ONE new index, children get none; EXPLAIN evidence in-slice decides any additions (D-S1-1).                                                                                                                                                                                                                                                                                                                                                                           |
| Migration locks (GoCardless 15 s class)                                           | 5 s `lock_timeout` everywhere (bounds the WAIT, not the HOLD — file 3's AccessExclusive persists through its scans/builds; live-path variants named in D-S1-3), two-phase FK, VALIDATE in its own tx; abort → P3009 runbook, `--rolled-back` verb (D-S1-3).                                                                                                                                                                                                           |
| Prisma expressiveness (shared scalar)                                             | Spike first; fallback = Post pattern (composite-only relation); raw-SQL constraint REJECTED (drift-delete) (D-S1-2).                                                                                                                                                                                                                                                                                                                                                  |
| Cutover breaks test seeding                                                       | Superuser seed client in harness; S0.4 checkpointed, splittable, non-blocking for Slice 1 (D-S0-2).                                                                                                                                                                                                                                                                                                                                                                   |
| db-prisma live-wired creates break compile                                        | Named in File Changes; #38 ratchet re-measured same commit, may fall never rise.                                                                                                                                                                                                                                                                                                                                                                                      |
| Squawk on `ADD CONSTRAINT UNIQUE` in-tx                                           | Verify active ruleset at apply; if the unique-constraint rule is enforced, use `USING INDEX` shape with the CONCURRENTLY runbook noted for live envs.                                                                                                                                                                                                                                                                                                                 |
| Batch-tx enlistment through the chained extension misbehaves                      | Hour-boxed spike FIRST (0d-1); named fallback = fold binding into the guard's wrapper — one extension, same seam (D-S0d-1).                                                                                                                                                                                                                                                                                                                                           |
| Global `.env.test` flip breaks unswept suites                                     | The harness sweep is a NAMED 0d-3 work unit sized from Finding 9's ~65-file measurement, never a silent client default; the flip ships only with the full tier green (D-S0d-4).                                                                                                                                                                                                                                                                                       |
| An extended-client transaction's inner operation escapes onto a second connection | Closed at ADOPTED sites only — the D-S0d-2 marker at the named seams plus the 19-site snapshot routed through one helper; pinned by the non-UoW escape red (`PrismaPostRepository.create:453` forced-failure) and the spec's transactional-atomicity scenario. NOT closed by construction: a future `.$transaction` that skips the helper re-opens it — a named residual; the helper makes the correct pattern the cheap one, and apply re-runs the site enumeration. |
| A raw-singleton-wired repository stays silent under the app role                  | NOT covered by the extension (the falsified DI-coverage claim) — covered only by 0d-2's per-file conversion, pinned by the brandKit fail-closed red. Until a file converts, its defect is SILENT (zero rows, no gate turns red on its own) — which is why 0d-2 is merge-ordered BEFORE the 0d-3 flip.                                                                                                                                                                 |

## Open Questions

- None blocking. Migration timestamps assigned at apply time; the D1 ordering assertion
  (columns < RLS) is an apply-phase check.

## What the gatekeeper should check (falsifiable claims)

1. `apps/api/tests/integration/rls-tenant-isolation.test.ts` exists, creates `rls_test_role`
   (not `app_test_role`), asserts `Post` has NO RLS, and is listed in
   `apps/api/scripts/run-tests.sh` (~line 291).
2. `infra/prisma/schema.prisma`: `Project` has partial `@@unique([accountId, name])` and NO
   `@@unique([id, accountId])`; `Post` has 7 indexes, all `projectId`-led or single-column,
   plus `version Int`; `datasource db` block has NO `url` line.
3. `docs/architecture/schema-conventions.md` contains the P3009 runbook, the two-file
   `NOT VALID`/`VALIDATE` convention, and names squawk rules `require-timeout-settings`,
   `constraint-missing-not-valid`, `adding-foreign-key-constraint` as active.
4. `TENANT_SCOPED_MODELS` currently holds 58 entries; `getTenantScopedModels` is exported and
   consumed by the existing integration test.
5. ci.yml Integration Tests job: `pgvector/pgvector:pg16` service, `POSTGRES_USER: postgres`,
   per-step env for migrate/seed — consistent with D-S0-2's split.
6. `PrismaUnitOfWork` binds the GUC via `set_config('app.account_id', ..., true)`
   (`apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts:85-87`).
7. The design adds NO fitness.yml step (D-S0-4 places the DB-state gate in the integration
   tier, and the `rls-enforcement` delta is AMENDED to say the same) — if tasks later add one,
   that is drift from this design AND from the amended spec.
8. `infra/prisma/prisma.config.ts:22` reads `process.env.DATABASE_URL ?? ""` and
   `infra/prisma/src/client.ts:160` reads `process.env.DATABASE_URL` inside
   `createPrismaClient()` — the URL split is NEW work, and the runtime client is a
   self-reading singleton, not composition-root-fed.
9. Port surface in `packages/core/domain/src/repositories/PostRepository.ts`:
   `countByProjectId` L86, `countByStatus` L91, `listByProject` L240 (required `accountId`
   2nd param), `search` L251, `getUpcoming` L260, `getRecentlyPublished` L265, `listGlobal`
   L285 (`accountId` first) — matches the D-T1 table.
10. `docs/security/MULTI_TENANT_GUARDS.md` count sites: L46, L51, L111, L410, L460.
11. Migration file 4 declares `ON UPDATE NO ACTION`; file 2 is keyset-batched; no phase-marker
    prefix (`tif0_`/`tif1_`) appears in any migration name.
12. The amended `rls-enforcement` delta places the coverage gate in the integration tier
    (its former fitness-framed requirement body and two scenarios rewritten), and the amended
    `multi-tenant-isolation` leg 1 carries the shape-1b index exemption with its revisit
    trigger.

Slice 0d claims (addendum):

13. `apps/api/src/infrastructure/container/setup.ts:61-63` applies ONLY `tenantGuardExtension`
    (no GUC-binding extension exists) and registers the extended client as
    `TOKENS.PrismaClient`; its comment states raw-singleton importers get the UNWRAPPED
    client.
14. `PrismaUnitOfWork.executeInTransaction` binds the GUC via `tx.$queryRaw set_config` at
    L85-87 and wraps `txStorage.run(tx, fn)` — no "GUC adjudicated" marker exists anywhere.
15. `infra/prisma/src/extensions/tenantGuc.ts` exports `setTenantGuc` + `SYSTEM_TENANT_SCOPE`;
    consumers today: `apps/api/src/saga/sagaTenant.ts`,
    `apps/workers/src/mentionIngestWorker.ts:163`,
    `apps/workers/src/services/ChannelAuthFailureRecorder.ts:91`, and
    `packages/adapters/db-prisma/src/ChannelRepository.ts` (both the tenant-bound and the
    system-bound tenant-discovery forms) — the explicit worker pattern D-S0d-3 completes.
16. `apps/api/src/infrastructure/repositories/PrismaPostRepository.ts:437` dereferences
    `row.project.accountId` on a select whose relation can come back null (finding 8).
17. ADR-0022 §Runtime cutover records the two-channel measurement (177/177 owner vs 170/177
    app role, exit 1) with the 7 failures confined to `postDeleteOwnership.test.ts` (3) +
    `postReadOwnership.test.ts` (4), and its Revisit-if names request-scoped binding as the
    flip's precondition.
18. Zero `tenantGuardExtension` references exist under `apps/workers/` — workers run
    unguarded on layer 1 and rely on explicit predicates + GUC-bound transactions, which is
    why 0d gives them the explicit leg, not the ALS extension.
19. Pool config in `infra/prisma/src/client.ts`: dev `max = min(cpu+2, 8)`, prod
    `max = max(2·cpu, 10)`, `DB_POOL_SIZE` override; itx defaults `maxWait: 5000`,
    `timeout: 30000` — the numbers behind Candidate B's rejection.

Slice 0d corrective-pass claims (2026-09-07 — the re-gate executes these against the
corrected coverage statements):

20. Value imports of the raw singleton (`import { prisma } from "@infra/prisma"`) in
    `apps/api/src/infrastructure/container/`: exactly 12 files — the asset, brand-kit,
    brand-voice, crm, custom-report, inbox, localized-generation, referral, saml,
    secrets-rotation, trend, and webhook-admin setup files — handing `prisma` into 30
    lines: 27 `new Prisma*(prisma)` constructions, the two trend adapters at
    `setupTrendUseCases.ts:59-60`, and the `setupSamlUseCases.ts:72` constructor-arg pass.
    Every other setup file imports `PrismaClient` type-only and receives the client by
    parameter.
21. Extended-client/`db-prisma` `.$transaction(` sites outside `PrismaUnitOfWork`,
    `sagaTenant.ts`, `db-prisma/ChannelRepository.ts`, workers, and tests: the 19 named in
    D-S0d-2 — including the three UoW-aware ternary fallback arms
    (`PrismaPostRepository.ts:156`, `PrismaProjectRepository.ts:376`,
    `PrismaAccountRepository.ts:402`) and `outboxAdminRoutes.ts:60`, whose `prisma`
    resolves `TOKENS.PrismaClient` (L26/L50 — extended, not raw) — and NO shared non-UoW
    transaction helper exists anywhere in `apps/api/src`.
22. `PrismaUnitOfWork.ts:71`'s comment still reads "the 51 tenant-scoped tables" — stale
    against the 58-model guard Set (the archived `api-guarded-client-injection` count-free
    rewording never landed); 0d-1's marker-adoption task fixes the comment.
23. `PrismaPostRepository.create` (L446-457) is a UoW-aware ternary whose fallback arm at
    :453 opens `this.prisma.$transaction` writing `post` + `postContent` + `postMedia`
    (+ outbox) — the escape red's named site.
24. `setupBrandKitUseCases.ts:23` constructs `PrismaBrandKitRepository(prisma)` from the
    raw-singleton import at :10, and `brandKit` IS in `TENANT_SCOPED_MODELS`
    (`tenantGuard.ts:102`) — the fail-closed red's named site (enrolled, yet its repo
    bypasses the guard today).
