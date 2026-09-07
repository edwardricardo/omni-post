# Tasks: Tenant Isolation by Construction — Composite FK over Unique Constraint (A′)

> Strict-TDD, dependency-ordered. Derived from the **four delta specs** (the requirement source)
> and **`design.md`** (the mechanism source). The proposal is STALE in two adjudicated cells and
> is NOT a source here: (a) its affected-areas row promising a `.github/workflows/fitness.yml`
> step — **no fitness.yml step is created for the RLS coverage gate**; the gate lives in the
> INTEGRATION tier (D-S0-4, and the amended `rls-enforcement` delta says the same; adding one is
> drift); (b) its slicing table putting the query contract wholly under Transversal — the
> **trio's** collection-port conversion ships INSIDE Slice 1, same PR as the data-layer
> enrollment (`tenant-scoped-query-contract` same-slice rule).
>
> Branch `workstream/tenant-isolation`. Delivery: **auto-chain**, **stacked-to-main** — every
> link below merges green to main in order. Every new gate ships with its RED demonstrated
> (repo canon, CLAUDE.md §Automated Compliance Checks step 3).
>
> **Slice 0 is a BLOCKING precondition.** No link past PR 3 merges while the zero-rows proof is
> red. The composite FK (PR 5) is the ONE guarantee exempt from that dependency — referential
> integrity always bypasses row security — and that exemption is STATED wherever the two are
> reported together (task 14.4), never used to imply RLS is fixed.

## Unrepeatable captures — do these FIRST, irreversible if skipped

| Capture                                                                                                                                                        | Task          | Must precede             | Why it cannot be redone later                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current-posture zero-rows RED (`postgres`, `BYPASSRLS`) → `docs/reports/RLS_POSTURE_RED_BASELINE.md`                                                           | **1.1 → 1.2** | the role migration (2.1) | Once `omnipost_app` exists and is cut over, the historical posture is gone; a proof never observed red does not satisfy the requirement                                                      |
| Pre-migration `EXPLAIN` baseline (hot `Post` listings **and** the `PostContent`/`PostMedia` child reads) → `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §Before | **7.2 → 7.3** | migration file 1 (9.2)   | The "before" plan is unrecoverable after the column, index, and policy land; without 7.3 the shape-1b index exemption's revisit trigger has no evidence source for the two tables it governs |

## Sensitive-edit gate

**Token REQUIRED: YES — `omnipost-allow sensitive-edit`.** Sensitive paths in this change:
`infra/prisma/**` (schema, all 7 migration files, `tenantGuard.ts`, `prisma.config.ts`,
`seed.ts`) and `apps/api/src/config/env.ts`. Author these under an active token.

## Orchestrator-owned work units (writers never touch these)

| Unit                                                                             | Task(s)    | Why                                                              |
| -------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `CLAUDE.md` §Automated Compliance Checks pointer note                            | **5.4**    | Gated file — orchestrator-applied under a `sensitive-edit` token |
| `CLAUDE.md` + `.github/workflows/fitness.yml` #38 `DBPRISMA_BASELINE` re-measure | **11.3b**  | Same gated file; the ratchet value may fall, never rise          |
| All git: branch, commit, push, PR creation/retarget                              | every link | Writers never run git                                            |
| RDD lifecycle (review START → capture → acknowledge) per link                    | every link | Orchestrator owns the transaction                                |

## Command legend (LXC-safe, single-file — heap 3072, never the full local suite)

- **DBUP**: `pnpm db:up` (before any migration or integration test)
- **VITEST `<file>`**: `NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @apps/api exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=3072 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **MIGRATE**: author `prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply `pnpm db:up && pnpm db:migrate`
- **CLIENT-REGEN**: `pnpm --filter @infra/prisma build`
- **TSC**: `pnpm typecheck` (turbo) or `pnpm --filter @apps/api exec tsc -b`

## Review Workload Forecast

| Field                   | Value                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Estimated changed lines | PR1 ~420 · PR2 ~250 · PR3 ~200 · PR4 ~290 · PR5 ~1000–1150 · PR6 ~220 · PR7 ~280 · PR8 ~350 · **total ~3010–3160** |
| 400-line budget risk    | High                                                                                                               |
| Chained PRs recommended | Yes                                                                                                                |
| Suggested split         | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 → PR 8 (stacked to main, in order)                                  |
| Delivery strategy       | auto-chain                                                                                                         |
| Chain strategy          | stacked-to-main                                                                                                    |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**`Decision needed before apply: No`** because auto-chain starts at PR 1, which is inside
budget. **A separate decision IS needed before PR 5**, and it is flagged here rather than
buried: PR 5 is **irreducible at ~1000–1150 lines** and needs an accepted **`size:exception`**.
One honest slicing pass was made; four independent couplings forbid a cohesive split:
(1) the generated Prisma client types `accountId` as required the moment the schema changes, so
every writer must compile in the same commit; (2) fitness **#39** turns red the instant an
`accountId`-bearing model exists without `TENANT_SCOPED_MODELS` enrollment; (3) the existing
policy↔guard **1:1** integration test forbids half-enrollment (guard without policy, or the
reverse); (4) the `tenant-scoped-query-contract` **same-slice rule** forbids the data-layer
enrollment shipping ahead of its query-layer counterpart, and the `scope.accountId` the ports
take has no column to filter on until the migration lands. Splitting at the FK boundary would
require reordering the six migration timestamps against D-S1-3 — drift from the design, not a
slice. Budget is never met by deleting tests, docs, or comments.

### Suggested Work Units

| Unit | Goal                                                                                                                                                            | Likely PR               | Focused test command                                                                                                                                             | Runtime harness                                                                                                                       | Rollback boundary                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | RLS posture: one-shot historical red captured, `omnipost_app` provisioned, role/ownership/zero-rows/index-scan proofs green as the real role, ADR-0022 recorded | PR 1                    | INT `tests/integration/rls-tenant-isolation.test.ts`                                                                                                             | DBUP + two-tenant real-DB run as `omnipost_app` with GUC bound; planted `BYPASSRLS` and planted ownership both observed non-zero-exit | revert branch pre-merge; post-merge `DROP ROLE omnipost_app` down-migration; test file reverts to `rls_test_role` independently                                                                           |
| 2    | pg-catalog coverage gate: three partial states caught and NAMED, red demonstrated for each, gate pointed to from CLAUDE.md                                      | PR 2                    | INT `tests/integration/rls-tenant-isolation.test.ts`                                                                                                             | DBUP + plant/restore each of the three partial states in turn                                                                         | remove the coverage block from the suite + the CLAUDE.md note; no schema state involved                                                                                                                   |
| 3    | Runtime cutover: `MIGRATE_DATABASE_URL` split, app-role `DATABASE_URL`, superuser seed client in the harness                                                    | PR 3                    | INT `integration:tenant-isolation` batch under the app-role URL                                                                                                  | DBUP + full batch run with `DATABASE_URL` pointed at `omnipost_app`                                                                   | revert `prisma.config.ts` + `env.ts` + harness seed client; env values revert per environment                                                                                                             |
| 4    | Unrepeatable pre-migration evidence (hot listings + child reads) + Prisma shared-scalar spike decided                                                           | PR 4                    | `pnpm exec tsx scripts/rls-ab-measurement.ts --phase before`                                                                                                     | DBUP + seeded 2 tenants × ≥100 projects × ≥10k posts, ANALYZE, run as `omnipost_app`                                                  | docs + one script only; delete both, nothing else moves                                                                                                                                                   |
| 5    | Structural enrollment: trio columns + 6 migrations + guard 58→61 + RLS + write-path threading + trio query contract + FK/isolation suites                       | PR 5 (`size:exception`) | INT `tests/integration/tenant-composite-fk.test.ts` and `tests/integration/post-trio-tenant-isolation.test.ts`; VITEST `tests/unit/security/tenantGuard.test.ts` | DBUP + MIGRATE apply (0 NULL, row count preserved, VALIDATE passes) + two-tenant run over every trio surface                          | down-migrations in reverse file order (drop RLS, drop `NOT VALID` FK without rewrite, drop uniques independently of the partial uniques, drop columns → fitness #39 green again); guard set reverts to 58 |
| 6    | Post-migration plans, child-read adjudication, A′-vs-B′ on three shapes, Slice 1 completion report                                                              | PR 6                    | `pnpm exec tsx scripts/rls-ab-measurement.ts --phase after`                                                                                                      | DBUP + both policy arms measured on identical queries, 3 runs each                                                                    | report sections + (conditional) one index migration, individually revertible                                                                                                                              |
| 7    | Buffer-discriminator triage of the keyless models — classification, counts, zero migrations                                                                     | PR 7                    | `rg -c '^model ' infra/prisma/schema.prisma` cross-check against the deliverable's row set                                                                       | N/A — documentation deliverable; the requirement forbids any migration in this slice                                                  | delete `docs/security/TENANT_KEY_TRIAGE.md`                                                                                                                                                               |
| 8    | Transversal: ADR-0023, enrolled-queries table + counted residual, remaining collection queries converted                                                        | PR 8                    | TSC (compile-time contract) + VITEST touched unit set                                                                                                            | DBUP + affected integration suites re-run to prove results unchanged for scoped callers                                               | revert per-port signature change; ADR + table removable independently                                                                                                                                     |

---

# PR 1 — Slice 0a: posture red, app role, enforcement proofs

## Phase 0: Spec editorial (lowest priority, do first — later links mirror this file)

- [x] 0.1 `openspec/changes/tenant-isolation-composite-fk/specs/multi-tenant-isolation/spec.md` L61-66: repair the dangling leg-1 sentence — the exemption clause currently interrupts "the table carries a non-null `accountId` column with an accountId-led index … **plus a referential anchor in ONE of the two admissible shapes**". Move the exemption + its revisit trigger to a trailing sentence so the anchor clause attaches to leg 1's main clause. Editorial only: no requirement, scenario, or normative keyword changes.

## Phase 1: UNREPEATABLE — the historical red (blocks Phase 2)

- [x] 1.1 [RED · ONE-SHOT · IRREVERSIBLE IF SKIPPED] With two tenants seeded, run the wrong-tenant read against **today's** posture (connect as `postgres`, `BYPASSRLS`, no `FORCE ROW LEVEL SECURITY`) on an RLS-covered model with `app.account_id` bound to tenant B while A's rows exist. Observe rows RETURNED — the proof FAILS.
- [x] 1.2 [ONE-SHOT] Capture 1.1 verbatim into `docs/reports/RLS_POSTURE_RED_BASELINE.md`: exact command, `rolsuper`/`rolbypassrls` of the connecting role, `relrowsecurity`/`relforcerowsecurity`/owner of the queried table, the returned rows, and re-run instructions. **Blocks 2.1 — nothing in Phase 2 starts before this file exists.**

## Phase 2: Role provisioning [SENSITIVE — token] (dep: 1.2)

- [x] 2.1 [SENSITIVE · applied by orchestrator under token] Create `infra/prisma/migrations/<ts>_create_omnipost_app_role/migration.sql`: idempotent `DO $$ … EXCEPTION WHEN duplicate_object` `CREATE ROLE omnipost_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`; `GRANT SELECT/INSERT/UPDATE/DELETE` on all tables + `USAGE` on sequences + `ALTER DEFAULT PRIVILEGES` so later-created tables stay covered. **No password in SQL** (CWE-798 — security canon, no exception).
- [x] 2.2 Create `scripts/db/enable-app-role-login.sh`: dev init hook reading `.env` to run `ALTER ROLE omnipost_app LOGIN PASSWORD …`. Secret comes from the environment's own channel, never from VCS.
- [x] 2.3 `docker-compose.yml` + `.github/workflows/ci.yml`: enable login per environment (CI uses a deterministic non-production value of the same class as the existing `password123`). [ADJUDICATED DEVIATION: compose deliberately unchanged — an initdb hook runs at cluster creation, before any migration can create the role, and compose is no longer the dev DB lifecycle owner; both dev paths and CI enable login via `pnpm db:app-role` after migrate. ci.yml carries the two steps.]
- [x] 2.4 DBUP + MIGRATE apply; assert `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='omnipost_app'` returns `false, false`.

## Phase 3: RED → GREEN enforcement proofs (integration, MERGE-BLOCKING)

- [x] 3.1 [RED] `apps/api/tests/integration/rls-tenant-isolation.test.ts`: retarget the suite from the synthetic `rls_test_role` to `SET LOCAL ROLE omnipost_app` and DELETE the synthetic role + its grants (rework, not a parallel proof). Add the role-attribute gate (`rolsuper`/`rolbypassrls` both false) and the ownership gate (zero enrolled tables with `relowner = 'omnipost_app'::regrole`).
- [x] 3.2 [RED] Same file: two-tenant zero-rows proof as `omnipost_app` with the GUC bound — **symmetric**: A-bound returns only A's rows with a NON-ZERO count, B-bound only B's. An empty fixture SHALL NOT pass as the proof.
- [x] 3.3 [GREEN] Run INT `tests/integration/rls-tenant-isolation.test.ts` (dep: 2.4) → green, 0 cancelled.
- [x] 3.4 [RED-PROOF — permanent regression red] Plant `ALTER ROLE omnipost_app BYPASSRLS` → suite exits NON-ZERO (an annotation alone proves nothing) → revert → green. Plant `ALTER TABLE "Project" OWNER TO omnipost_app` → non-zero exit → revert → green. Both demonstrations recorded in 4.1.
- [x] 3.5 [evidence] Index-scan proof in the same suite: `EXPLAIN (ANALYZE, FORMAT JSON)` on a `Project` read filtered `{ accountId, deletedAt: null }` with `SET LOCAL enable_seqscan = off`, as `omnipost_app` with the GUC bound; assert no `Seq Scan` node. Record the full plan, exact query, and data shape in `docs/reports/RLS_POSTURE_RED_BASELINE.md` §Index-scan — a seq scan is a RECORDED finding with its adjudication, never a silent pass. Red demonstrated by pointing the query at a column with no index.

## Phase 4: Decision record + PR1 gate

- [x] 4.1 Create `docs/technical/ADR-0022-rls-enforcement-posture.md` (re-verify the number at apply): per-environment role audit table (dev / test / CI / staging / prod as applicable — connecting role, `BYPASSRLS`, `SUPERUSER`, ownership of covered tables; **no environment inferred from another**), the non-owner-vs-`FORCE ROW LEVEL SECURITY` decision with its reason, the recorded red demonstrations from 3.4, and the revisit-if (a deployment whose migrations run as a non-superuser owner → adopt `FORCE` there plus the `set_config('app.account_id','__system__', true)` opening line in every backfill).
- [x] 4.2 **0-defect gate (PR1)**: TSC = 0; `eslint --max-warnings 0` on touched files = 0; fitness #8/#9/#10/#15/#16/#23 = 0; `prisma validate` + `migrate status` up to date; INT suite green, 0 cancelled; prettier clean.

---

# PR 2 — Slice 0b: pg-catalog coverage gate (dep: PR 1)

## Phase 5: The gate, its three named failures, and its red

- [x] 5.1 [RED] Extend `apps/api/tests/integration/rls-tenant-isolation.test.ts`: for every model from `getTenantScopedModels()`, read `pg_class.relrowsecurity`, `pg_class.relforcerowsecurity`, the table owner, and `pg_policies`. COVERED only when RLS is on **and** ≥1 policy exists **and** (the app role does not own the table **or** `relforcerowsecurity` is true).
- [x] 5.2 [RED] Same block: the failure message NAMES which partial state was found — policy-without-RLS (**leaks**), RLS-without-policy (**denies**), owner-without-FORCE (**owner-exempt leak**). A generic "RLS not covered" does not satisfy the scenario. Add the role gates (`rolsuper`/`rolbypassrls` false; zero enrolled tables owned by `omnipost_app`).
- [x] 5.3 [RED-PROOF] Plant each state in turn — `ALTER TABLE … DISABLE ROW LEVEL SECURITY`; `DROP POLICY tenant_isolation ON …`; `ALTER TABLE … OWNER TO omnipost_app` — and observe a REAL non-zero suite exit each time; restore the database and re-confirm green. Record the demonstration in `docs/technical/ADR-0022-rls-enforcement-posture.md` §Coverage-gate red.
- [x] 5.4 [ORCHESTRATOR · applied under token; header count untouched, prettier clean] `CLAUDE.md` §Automated Compliance Checks: add the **pointer note** naming this integration-tier gate — the suite file, its `run_batch`, and the Integration Tests job that runs it. A **note, not a numbered workflow step**; the gate inventory stays complete without pretending a grep can read `pg_class`.
- [x] 5.5 Confirm (do not add) the wiring: `apps/api/scripts/run-tests.sh` already names `rls-tenant-isolation.test.ts` in a `run_batch` (fitness #30 — an unwired suite never executes), and ci.yml's Integration Tests job runs that batch on every PR against the migrated Postgres service. **Create NO `.github/workflows/fitness.yml` step** — D-S0-4 and the amended spec place this gate in the integration tier; a fitness step here is drift.
- [x] 5.6 **0-defect gate (PR2)**: TSC = 0; eslint 0; fitness suite hard-zero; INT green + all three planted reds recorded; prettier clean.

---

# PR 3 — Slice 0c: runtime cutover (dep: PR 2)

## Phase 6: URL split + superuser seed harness

- [x] 6.1 [SENSITIVE] `infra/prisma/prisma.config.ts:22`: `url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? ""` — the owner/superuser channel for migrate + seed. [The pre-edit hook did NOT gate this path; applied directly. Precedence proven, not asserted: with `MIGRATE_DATABASE_URL` pointed at an unreachable host the CLI targets that host (`P1001` on `127.0.0.1:1`), and with it unset `migrate status` reports 74 migrations up to date.]
- [x] 6.2 [SENSITIVE] `apps/api/src/config/env.ts`: add `MIGRATE_DATABASE_URL` as an OPTIONAL server-schema entry so the pair is schema-visible, not ambient (fitness #16 chokepoint honored). [Hook did NOT gate this path either; applied directly. `parseApiEnv` smoke + config unit tests green, 44/44.]
- [x] 6.3 Integration harness: add a superuser seed client bound to `MIGRATE_DATABASE_URL` (the existing suites seed "as superuser" through the raw `@infra/prisma` singleton and fail closed under the app role); point `DATABASE_URL` at `omnipost_app` in `.env`, `.env.test`, `docker-compose.yml`, and ci.yml. The runtime singleton needs no code change — the value under it changes. [Harness half DONE: `createSeedPrismaClient()` + all 18 batch suites converted. `docker-compose.yml` verified to need NO change — it defines only infrastructure containers and holds no `DATABASE_URL` key. ci.yml is GATED (prepared, 3 hunks). **The `DATABASE_URL` flip itself is DELIBERATELY NOT APPLIED** — measured blocker, see 6.5 and ADR-0022 §Runtime cutover.]
- [x] 6.4 [CHECKPOINT — D-S0-2] Measure the harness split's changed lines and record the number in the PR body. It already ships as its own link; if it had fit inside PR 1 the checkpoint would say so. [**242 changed lines** for the harness split alone (18 suites = 169; new `seedPrismaClient.ts` = 73). Already over the ~200 the forecast gave the whole of PR 3 — recommend `size:exception` for this link.]
- [ ] 6.5 Run the `integration:tenant-isolation` batch under the app-role URL (DBUP first) → green, 0 cancelled. **Slice 0 exit condition: the zero-rows proof is GREEN — nothing past this line merges until it is.** [**PARTIAL — BLOCKED, not skipped.** The exit-condition clause is MET: `rls-tenant-isolation.test.ts` is 21/21 green with `DATABASE_URL` pointing at `omnipost_app`, as are all 15 dedicated `*TenantIsolation` suites. The batch as a whole is `177 tests · pass 170 · fail 7 · cancelled 0` on that channel and `177/177` on the owner channel. The 7 are the APPLICATION, not the harness: `app.account_id` is bound only inside `PrismaUnitOfWork.executeInTransaction`, so every read outside a unit of work fails closed under a non-bypassing role, and the post ownership gate resolves ownership through a JOIN into RLS-covered `Project`. Proved at the database, recorded in ADR-0022 §Runtime cutover. Unblocking it is a design decision (request-scoped tenant binding), not writer work.] [ADJUDICATED 2026-09-07, owner-signed: **deferred to Slice 0d** (new slice between PR3 and PR4 — request-scoped GUC binding via Prisma extension, then the flip). The 170/177 measurement IS 0d-3's demonstrated red. ci.yml hunks + .env.example key applied (orchestrator under token / owner); the 6.3 note's "flip" clause transfers to 0d-3.]
- [x] 6.6 **0-defect gate (PR3)**: TSC = 0; eslint 0; fitness #15/#16/#23 = 0; batch green; prettier clean. [Run over the applied set: TSC 0 · ESLint 0/0 · prettier clean · #8/#9/#10/#15/#16/#23/#31A/#32/#38-swept/#39 = 0 · #30 ratchet 21 unchanged · #38 db-prisma ratchet 11 unchanged · `prisma validate` + `migrate status` green · batch 177/177 on the channel this PR merges with. "Batch green" on the app-role channel is the 6.5 blocker above, reported rather than absorbed.]

---

# PR 4 — Slice 1a: unrepeatable pre-migration evidence + Prisma spike (dep: PR 3)

## Phase 7: Capture BEFORE anything schema-shaped exists

- [ ] 7.1 Create `scripts/rls-ab-measurement.ts` (standalone — evidence, not a gate, outside the fitness and test tiers): seed 2 tenants × ≥100 projects × ≥10k posts, `ANALYZE`, connect as `omnipost_app` with the GUC bound, capture `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`; `--phase before|after` writes into the report.
- [ ] 7.2 [ONE-SHOT · IRREVERSIBLE IF SKIPPED · must precede 9.2] Capture the PRE-migration plans for the hot `Post` listing paths into `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §Before — plan, exact query text, row counts, timings, data shape, and the re-runnable command.
- [ ] 7.3 [ONE-SHOT · IRREVERSIBLE IF SKIPPED · must precede 9.2] Capture the PRE-migration `postId`-led child reads for **`PostContent` and `PostMedia`** into the same §Before. This is the evidence source the leg-1 shape-1b index exemption's revisit trigger governs; without it, 14.2 has nothing to compare against for those two tables.
- [ ] 7.4 Prisma shared-scalar spike (throwaway schema in the scratchpad, half-day cap): (1) `prisma validate` + `prisma migrate diff` on a model whose `accountId` appears in TWO relations' `fields` lists; (2) generated-client typecheck of `create` / nested-create inputs; (3) `db pull` round-trip. Record the outcome and the decision in `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §Spike. Any failure → **fallback = the Post pattern** (composite parent relation only, `Account` navigation through the parent). The raw-SQL-constraint fallback is REJECTED — `migrate dev` drift detection schedules its DROP.
- [ ] 7.5 **0-defect gate (PR4)**: docs + one script only, no schema change; TSC = 0; eslint 0; fitness #9/#10/#16 = 0 on the new script; prettier clean.

---

# PR 5 — Slice 1b: structural enrollment `size:exception` (dep: PR 4)

## Phase 8: RED first — every gate's defect is written before its fix

- [ ] 8.1 [RED] `apps/api/tests/unit/security/tenantGuard.test.ts`: trio membership + where-injection (find/update/delete) + create-injection + explicit-mismatch throw + missing-context (`TenantContextMissingError`); bump the size assertion **58 → 61**. Red until 10.1.
- [ ] 8.2 [RED] Create `apps/api/tests/integration/tenant-composite-fk.test.ts` (node:test, real DB, `@file`/`@description`/`@layer infrastructure` header — fitness #9/#10). Assert: divergent `accountId` INSERT fails with an FK violation raised by **PostgreSQL** via (a) the raw Prisma client, (b) an explicit transaction, (c) direct SQL; a consistent write succeeds; a NULL referencing column fails on `NOT NULL` (MATCH SIMPLE escape closed, verified for THIS table); the refusal still holds with `BYPASSRLS` present on the connecting role; a child survives its parent being soft-deleted; the pre-existing partial soft-delete uniques (`Account.email`, `Project(accountId,name)`) still reject live duplicates and still allow reuse after soft delete; **"project accountId update is refused while posts reference it"** (the `ON UPDATE NO ACTION` pin — red under Prisma's default Cascade).
- [ ] 8.3 [RED] Create `apps/api/tests/integration/post-trio-tenant-isolation.test.ts`: A cannot read, list (incl. with B's `projectId` and unfiltered global), update, archive, duplicate, or delete B's posts through the guarded client; **direct** `PostContent` / `PostMedia` reads return ZERO of B's rows; a no-context read raises `TenantContextMissingError`; a foreign `projectId` on every create/duplicate path returns **404** (never 403, never 500 — no raw FK violation reaches the client, no row persisted); the `withSystemContext("recurrence-sweep")` writer derives the tenant from the source recurrence's ownership chain; child rows inherit `Post.accountId` and a client-supplied tenant value has no effect; A's own create/read/list/update/duplicate/archive/delete surfaces work unchanged; the existing `postDeleteOwnership.test.ts` and `postReadOwnership.test.ts` still pass (the app-level gate is RETAINED, not replaced).
- [ ] 8.4 [RED · compile-time] Add the `@ts-expect-error` type test pinning that a trio collection query invoked without `scope` does not compile — deleting the parameter later turns the suppression into a compile error (a self-red gate).
- [ ] 8.5 Run VITEST 8.1 + INT 8.2/8.3 → RED for the right reasons (no column, no constraint, no enrollment).

## Phase 9: Schema + the six migrations [SENSITIVE — token]

- [ ] 9.1 [SENSITIVE] `infra/prisma/schema.prisma` per D-S1-1: `Project @@unique([id, accountId])` (**TOTAL**, no `where:` — coexists with the partial `@@unique([accountId,name])`); `Post.accountId String` + composite relation to `Project` on `[projectId, accountId] → [id, accountId]` with `onDelete: Cascade, onUpdate: NoAction` + `@@unique([id, accountId])` + the ONE new index `@@index([accountId, projectId], where: { deletedAt: null })`; `PostContent.accountId` / `PostMedia.accountId` + composite relations to `Post`. NO direct `Account` relation, NO `Account.posts` back-relation, NO new index on the children. Post's 7 existing indexes untouched.
- [ ] 9.2 [SENSITIVE] Migration 1 `<ts>_add_post_trio_tenant_columns`: `ADD COLUMN "accountId" TEXT` (nullable) ×3. `SET lock_timeout='5s'` / `SET statement_timeout='30s'`.
- [ ] 9.3 [SENSITIVE] Migration 2 `<ts>_backfill_post_trio_tenant_columns`: idempotent **keyset-BATCHED** backfill (`DO $$` loop, 10k rows per pass in id order) — Post←Project, then PostContent←Post, PostMedia←Post; **NO `deletedAt` filter** (soft-deleted rows must satisfy the coming NOT NULL — stated in an in-file comment); closes with an in-transaction `RAISE EXCEPTION` if any NULL remains. A single-pass whole-table `UPDATE` SHALL NOT be used, in ANY environment. `lock_timeout='5s'` / `statement_timeout='10min'`.
- [ ] 9.4 [SENSITIVE] Migration 3 `<ts>_post_trio_tenant_not_null_and_uniques`: `SET NOT NULL` ×3; `ADD CONSTRAINT … UNIQUE (id, "accountId")` on `Project` and `Post`. Document in-file that `lock_timeout` bounds the WAIT, not the AccessExclusive HOLD, and name the live-path variants (CHECK-NOT-VALID → VALIDATE → SET NOT NULL; `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT … USING INDEX`).
- [ ] 9.5 [SENSITIVE] Migration 4 `<ts>_post_trio_composite_fk_not_valid`: per child, `DROP CONSTRAINT` (old single-column FK) + `ADD CONSTRAINT … FOREIGN KEY (parentFk, "accountId") REFERENCES parent(id, "accountId") ON UPDATE NO ACTION ON DELETE CASCADE NOT VALID`. Turns 8.2 green for new writes.
- [ ] 9.6 [SENSITIVE] Migration 5 `<ts>_post_trio_composite_fk_validate`: `VALIDATE CONSTRAINT` ×3 in its own file (own transaction → `SHARE UPDATE EXCLUSIVE` only). It must RUN and PASS before the slice is reported complete.
- [ ] 9.7 [SENSITIVE] Migration 6 `<ts>_add_rls_post_trio` + its `down.sql`: `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (local-column form COPIED from `20260527000000`, which is never edited) ×3. Timestamps strictly ascending 1→6; names `<timestamp>_<snake_case>` with no phase-marker prefix.
- [ ] 9.8 Verify each stage reverts only itself in reverse order (drop policy → drop `NOT VALID` FK without a table rewrite → drop uniques independently of the partial uniques → drop columns), and that dropping the columns leaves fitness **#39** green.
- [ ] 9.9 CLIENT-REGEN + `prisma validate`; DBUP + MIGRATE apply → 0 NULL `accountId`, pre-migration row count preserved (soft-deleted included), `VALIDATE CONSTRAINT` passes. On an aborted migration follow `docs/architecture/schema-conventions.md` §Recovering a failed migration (`migrate resolve --rolled-back`) — aborted migrations are NOT simply re-run.

## Phase 10: Enrollment [SENSITIVE — token] → turns 8.1 green

- [ ] 10.1 [SENSITIVE][GREEN] `infra/prisma/src/extensions/tenantGuard.ts`: append `post`, `postContent`, `postMedia` to `TENANT_SCOPED_MODELS`; header JSDoc count **58 → 61**. Run VITEST 8.1 → GREEN. Flip the existing "`Post` (transitively scoped) does NOT have RLS enabled" assertion in `rls-tenant-isolation.test.ts` to positive — that flip is the visible proof the boundary moved.
- [ ] 10.2 `docs/security/MULTI_TENANT_GUARDS.md`: the 3-step enrollment record for all three models; bump 58 → 61 at L46/L51/L111/L410/L460 (re-verify the sites at apply); and record **here** the per-table shape-1b index exemption for `PostContent` / `PostMedia` — parent-key-led guarded reads, index cost paid by demonstration not in bulk — with its revisit trigger verbatim (a policy-qual-induced seq scan in Slice 1's `EXPLAIN` evidence adds the accountId-led index in the SAME slice).

## Phase 11: Write-path threading (compile-forced by the required column)

- [ ] 11.1 ENUMERATE every production write path that persists a `Post`, `PostContent`, or `PostMedia` — routes, use cases, workers, sagas, seeds, scripts — and record the enumeration in `docs/security/MULTI_TENANT_GUARDS.md`. Known members: `CreatePostUseCase`, `DuplicatePostsBatchUseCase`, `CreatePostFromRecurrenceUseCase`. A subset audit does not satisfy the requirement.
- [ ] 11.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaPostRepository.ts` (+ nested content/media) and `PrismaPostQueryRepository.ts`: thread `project.accountId` from a guard-scoped parent resolution into `Post` creates; children take `post.accountId` (nested creates included) — never caller-supplied. The builders' fitness #38 file-exception status is unchanged.
- [ ] 11.3 [GREEN] `packages/adapters/db-prisma/**` post/project factories: compile-forced `accountId` threading (live-wired — SMELL-87 territory).
- [ ] 11.3b [ORCHESTRATOR · SENSITIVE token] RE-MEASURE fitness **#38** `DBPRISMA_BASELINE` in the SAME commit and update `CLAUDE.md` + `.github/workflows/fitness.yml` only if it FELL. It may fall; it must never rise.
- [ ] 11.4 [GREEN] `infra/prisma/seed.ts` [SENSITIVE] + test factories/harnesses: thread `accountId` at every trio create site (`tsc` enumerates them).
- [ ] 11.5 [GREEN] Create/duplicate paths: a foreign `projectId` resolves to NOT_FOUND (404) BEFORE persisting — the composite FK is a BACKSTOP, not a replacement; a raw FK violation reaching the client as a 500 fails the requirement even though no row was written.

## Phase 12: Trio query contract — SAME slice as the data-layer enrollment

- [ ] 12.1 Create `packages/core/domain/src/repositories/TenantScope.ts`: `export interface TenantScope { readonly accountId: string }` — non-nullable by construction, VO-validated non-empty, `@file`/`@layer domain` header.
- [ ] 12.2 `packages/core/domain/src/repositories/PostRepository.ts`: `countByProjectId` (L86), `countByStatus` (L91), `PostQueryRepository.search` (L251), `getUpcoming` (L260), `getRecentlyPublished` (L265) gain `scope: TenantScope` as the FIRST REQUIRED parameter; `listByProject` (L240) normalized to scope-first (already carries a required `accountId`); `listGlobal` (L285) unchanged. **Enumerate the FULL trio collection surface** — the design's table is a design-time snapshot, not a sample. No optional variant, no default, no overload or wrapper reaching the same query without `scope`.
- [ ] 12.3 [GREEN] Adapters pass `scope.accountId` into `where` explicitly (the guard then VALIDATES it against the bound context; the composite FK and RLS re-check underneath); every call site derives `scope` from the authenticated `TenantContext` or an explicit `withSystemContext(reason)` — never from request body, query string, path param, or header. Turns 8.4 green.
- [ ] 12.4 [RED-PROOF · compile-time] Delete the `scope` argument at one call site → TSC FAILS; restore the tree byte-exact (verify with `cmp`). Widen the parameter to optional → call sites and implementation stop type-checking; restore. Record both in the PR body — a regex is documented as a secondary signal only, never as the mechanism.

## Phase 13: Wiring + PR5 gate

- [ ] 13.1 `apps/api/scripts/run-tests.sh`: add `tenant-composite-fk.test.ts` and `post-trio-tenant-isolation.test.ts` to the `integration:tenant-isolation` `run_batch` (fitness #30 — a suite no batch names never executes).
- [ ] 13.2 Run INT both suites + VITEST `tests/unit/security/tenantGuard.test.ts` + the existing post-ownership suites → GREEN, 0 cancelled, 0 skipped.
- [ ] 13.3 **0-defect gate (PR5)**: TSC (@apps/api, @core/domain, @adapters/db-prisma, @infra/prisma build) = 0; `eslint --max-warnings 0` = 0; fitness **#3/#8/#9/#10/#21/#23/#30/#32/#38/#39 = 0** (db-prisma ratchet re-measured, never raised); `prisma validate` + `migrate status` up to date; policy↔guard 1:1 parity green; prettier clean.

---

# PR 6 — Slice 1c: after-plans, adjudication, A′-vs-B′, completion report (dep: PR 5)

## Phase 14: Evidence closes the slice

- [ ] 14.1 [evidence] `scripts/rls-ab-measurement.ts --phase after`: capture the POST-migration plans for the hot `Post` listings into `docs/reports/TENANT_RLS_AB_MEASUREMENT.md` §After, against the SAME data shape as §Before. A regression appears in the artifact with its adjudication (index added / query reshaped / accepted with a stated reason) — the artifact SHALL NOT contain only the favorable comparisons.
- [ ] 14.2 [evidence] Capture the POST-migration `PostContent` / `PostMedia` child-read plans against 7.3's baseline. **Conditional, same slice:** if either degrades to a sequential scan under the RLS policy qual, author the accountId-led index migration **in this PR** and update the exemption record in `docs/security/MULTI_TENANT_GUARDS.md`; if neither does, record that the exemption stands with the measurement that justifies it.
- [ ] 14.3 [evidence] A′-vs-B′ on the three shapes that matter — point read by ID, `projectId`-filtered listing, listing with no selective predicate — under (arm 1) the shipped local-column policy and (arm 2) a transaction-scoped swap to the decorrelated set-membership policy. Identical queries, three runs each, medians + plan node types + data shape (rows, projects per account) recorded. Record whatever it says: if B′ wins on a shape, record it plainly together with the note that the structural integrity guarantee is A′-only and is not something B′ provides at any speed, plus the revisit trigger (B′ measures well AND Slice 2 classifies many more than three tenant-owned tables → the per-table choice reopens; A′ and B′ are not mutually exclusive per table).
- [ ] 14.4 Slice 1 **completion report** (PR body + `TENANT_RLS_AB_MEASUREMENT.md` §Completion), carrying the independence statement as a deliverable: the composite FK is enforced **independently of RLS configuration**; `VALIDATE CONSTRAINT` ran and passed, so the guarantee covers historical rows (if it had not, the report says forward-only, never retroactive); RLS enforcement status is stated per environment and any environment whose role audit was deferred is still red — the FK's strength is never reported as RLS being fixed.
- [ ] 14.5 **0-defect gate (PR6)**: TSC = 0; eslint 0; fitness hard-zero; any conditional index migration applies clean with `migrate status` up to date; prettier clean.

---

# PR 7 — Slice 2: keyless-model triage (dep: PR 6; may run in parallel with PR 8)

## Phase 15: Classification — a triage, not a sweep

- [ ] 15.1 Enumerate every model in `infra/prisma/schema.prisma` carrying no tenant key and assert the set matches the deliverable's rows EXACTLY — no model unclassified, none classified twice.
- [ ] 15.2 Create `docs/security/TENANT_KEY_TRIAGE.md`: one row per model — model / ownership path / Buffer discriminator ("can it exist before its container, or be orphaned from its ownership path?") / nullable-parent? / any access path that skips the parent? / verdict (**needs its own key** | **covered by composite-FK inheritance** | **legitimately global**) / evidence line. **The count per class is the document's first line** — the actionable number the follow-up work is sized by.
- [ ] 15.3 For every "covered by composite-FK inheritance" verdict, ENUMERATE its access paths and name them in the rationale — the classification SHALL NOT rest on the assumption that no parent-skipping path exists.
- [ ] 15.4 Assert the PR diff contains NO schema migration for the classified models (a sweep disguised as a triage fails the requirement).
- [ ] 15.5 **0-defect gate (PR7)**: fitness hard-zero; prettier clean; docs only.

---

# PR 8 — Transversal: the rest of the query contract (dep: PR 6)

## Phase 16: Canon + residual + remaining surface

- [ ] 16.1 Create `docs/technical/ADR-0023-tenant-scoped-query-contract.md` (re-verify the number at apply; config rule: new canon-affecting decisions require an ADR): the required-non-nullable-tenant-argument pattern as canon, the compiler-not-grep enforcement rule, and the server-derived-provenance rule.
- [ ] 16.2 Publish the **enrolled-queries table** (trio = Slice 1; remaining application-layer collection queries = Transversal) and state the RESIDUAL COUNT of collection queries still outside the contract; file the remainder as a tracked entry in `docs/reports/roadmap-detected-smells-backlog.md`. A partial rollout reported as complete is the failure mode this table exists to prevent.
- [ ] 16.3 Convert the remaining application-layer collection queries to a required `scope: TenantScope` first parameter; trace each call site's provenance to the bound `TenantContext` or an explicit `withSystemContext(reason)` — never an empty, placeholder, or sentinel tenant value.
- [ ] 16.4 [RED-PROOF · compile-time] Repeat the 12.4 plant on one newly enrolled query (delete the argument → TSC fails; widen to optional → call sites break); restore byte-exact and verify with `cmp`.
- [ ] 16.5 Mirror the four reconciled deltas into the living `openspec/specs/**` capabilities (`multi-tenant-isolation` plus the three new ones), keeping the leg-1 repair from 0.1.
- [ ] 16.6 **0-defect gate (PR8)**: TSC = 0; `eslint --max-warnings 0` = 0; every fitness check hard-zero; affected integration suites green (scoped callers' results unchanged), 0 cancelled; prettier clean.
