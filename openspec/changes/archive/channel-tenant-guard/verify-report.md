# Verification Report — channel-tenant-guard (Slice 7, N-SEC-3)

> Hybrid-store file mirror of engram topic `sdd/channel-tenant-guard/verify-report`
> (observation #425). Authored at archive time because the verify executor was
> instructed not to write report `.md` files; content is the verify artifact, not a
> re-verification. Wide markdown tables are rendered as lists so `prettier -c` stays
> green without hand-computed column padding.

- **Change**: `channel-tenant-guard`
- **Mode**: hybrid (openspec files + engram mirror)
- **Verified against**: `main` @ `9da39082` (clean tree)
- **PRs merged**: **#152** (merge `ce00d7ac` — structural + API + the RLS pair) and **#164** (merge `9da39082` — worker reconciliation)
- **Verdict**: **PASS WITH WARNINGS** — 0 CRITICAL · 5 WARNING · 3 SUGGESTION
- **Artifacts read**: `proposal.md`, `design.md`, `tasks.md`, both delta specs, engram apply-progress #421

## 1. Task completion gate

`tasks.md`: **35** checked (`- [x]`), **0** unchecked. Every checked claim was spot-checked
against code; each matched the code state on `main`.

## 2. Runtime evidence (verbatim)

1. `pnpm --filter @apps/api exec vitest run tests/unit/security/tenantGuard.test.ts` → `Test Files 1 passed (1)` / `Tests 61 passed (61)`
2. `pnpm --filter @apps/workers exec vitest run` → `Test Files 16 passed (16)` / `Tests 122 passed (122)`
3. `pnpm --filter @adapters/db-prisma exec vitest run` → `Test Files 3 passed (3)` / `Tests 61 passed (61)`
4. INT `tests/integration/channelTenantIsolation.test.ts` → `tests 16` / `pass 16` / `fail 0` / `cancelled 0`
5. INT `tests/integration/publishWorkerTenantIsolation.test.ts` → `tests 7` / `pass 7` / `fail 0` / `cancelled 0`
6. INT `tests/integration/rls-tenant-isolation.test.ts` → `tests 12` / `pass 12` / `fail 0` / `cancelled 0`
7. (extra, closes the typecheck blind spot) `pnpm --filter @apps/api exec vitest run` → `Test Files 523 passed (523)` / `Tests 8154 passed (8154)`

**Typecheck** `tsc --noEmit` exit 0: `@apps/api`, `@apps/workers`, `@adapters/db-prisma`, `@ports/core`.

**Fitness** (re-run on `main`): #3 = 0 · #8 = 0 · #9 = 0 · #10 = 0 · #21 = 0 · #23 = 0.

**Live DB** (`psql $DATABASE_URL`; `prisma migrate status` = "Database schema is up to date!", 67 migrations):

```
null_accountid|0            total_channels|21          mismatch_vs_project|0
channel_rls_enabled|true    channel_policy|1           total_tenant_isolation_policies|58
role_bypassrls|true/super=true    current_user|postgres
channel_accountid_index|1   channel_accountid_fk|1
```

## 3. Enrollment (three legs) — SATISFIED

- **Leg 1 — `accountId`**: `Channel_accountId_fkey` (1) and `Channel_accountId_projectId_idx` (1) present in the live DB; `null_accountid = 0`, `mismatch_vs_project = 0` over 21 rows (soft-deleted included — the `UPDATE ... FROM Project` covers them over the NOT-NULL `projectId` FK).
- **Leg 2 — guard**: `infra/prisma/src/extensions/tenantGuard.ts:105` carries `"channel"` between `"campaign"` and `"consentRecord"`; the JSDoc header says **58** and `TENANT_SCOPED_MODELS` has **58** members. Header, set, and DB all agree.
- **Leg 3 — RLS**: `20260723000100_add_rls_channel/{migration.sql,down.sql}` both present; `relrowsecurity = true`; the `tenant_isolation` policy on `Channel` carries the `__system__` bypass; `down.sql` drops the policy and disables RLS.
- **Migrations**: `20260723000000_add_channel_account_id` (A) < `20260723000100_add_rls_channel` (B), both after the tip `20260717000200`, both applied. A carries the in-transaction `RAISE EXCEPTION` on residual NULL before `SET NOT NULL`.
- **Guard↔RLS parity**: `total_tenant_isolation_policies` = 58 = guard membership; suite 6 asserts the 1:1 mapping and the count equality — 12/12 green.

## 4. API-side IDOR closure — SATISFIED

- The two-tenant suite `apps/api/tests/integration/channelTenantIsolation.test.ts` exists, is wired into the `integration:tenant-isolation` batch (`apps/api/scripts/run-tests.sh:180`), and is 16/16 green.
- **OAuth callback** (`providerOAuthFlow.ts:155-263`): the body is wrapped in `withTenantContext({ accountId: record.accountId })` from the consumed server-side state; the guarded `projectRepository.findById(projectId)` probe at `:175` yields `AppError.notFound("Project")` at `:177`; `Channel.create({ ..., accountId })` at `:232-234`. The probe runs **before** `provider.validateCode` (`:181`). The test spies on `validateCode` and asserts `exchangeCalls === 0`, a 302 with `error=` in `Location`, no `status=connected`, and an unchanged row count — a discriminating instrument, not a status-code tautology.
- **Bluesky connect** (`channelRoutes.ts:458,493`): `assertCallerOwnsProject` returns 404 (`:198`, `:204` — 404 not 403, anti-enumeration) and `upsert.create.accountId = ownedProject.accountId` threads the ownership-verified tenant.
- **Admin ops under system context**: hard-delete `channelRoutes.ts:582` `withSystemContext('system:channel-hard-delete:${channelId}')`; force-reauth `admin/channelReauthRoutes.ts:55-56` `withSystemContext('system:channel-force-reauth:...')`. Hard-delete has a passing regression test (cascades children, no `TenantContextMissingError`).
- **No credential crosses the boundary**: the test at `:263-291` drives GET/PUT/DELETE/list cross-tenant, asserts 404 on each, and asserts that neither `tok-B` nor B's handle appears in any payload.

## 5. Worker-side credential closure — SATISFIED

Every worker-side `Channel` query in the repo (exhaustive grep over `apps/workers/src` and
`packages/adapters/db-prisma/src`) is one of exactly four, all scoped:

- `ChannelRepository.ts:72-77` `getChannelsByIds` — `$transaction` → `setTenantGuc(tx, accountId)` → `findMany({ id: { in: ids }, accountId })`; a blank `accountId` returns `err("DATABASE_ERROR")`.
- `ChannelRepository.ts:118-124` `getChannelOwnerAccountId` — `$transaction` → `setTenantGuc(tx, SYSTEM_TENANT_SCOPE)` → primary-key `findUnique` with `select: { accountId: true }` only, never the credential envelope; a blank id returns `ok(null)` (terminal, not retryable).
- `mentionIngestWorker.ts:165-171` `resolveChannelAdapter` — `$transaction` → `setTenantGuc(tx, accountId)` → `findFirst({ id, accountId, deletedAt: null })`; invalid-scope guard at `:155` plus `worker_mention_channel_unresolved_total{reason}`.
- `ChannelAuthFailureRecorder.ts:91-98` `record` — `setTenantGuc(tx, accountId)` first, then `update({ where: { id, accountId } })`; P2025 is swallowed as a no-op with a WARN carrying `{ channelId, accountId, provider }` and deliberately NOT `reason`.

- **Saga fails closed**: `packages/shared/src/saga.ts:617-623` — a missing or blank `context.metadata.accountId` returns `{ success: false, error: "Saga metadata carries no accountId: refusing to enqueue an unscoped publish job" }`; the payload field at `:637` is unconditional. A fresh job can never land on the deploy-compat fallback.
- **Bounded fallback + observability**: `publishHandler.ts:123-146` `resolveJobAccountId` emits `publishJobAccountIdSource{source=payload|fallback}` on both paths and WARNs on the fallback; the two failure causes are split (`owner.value === null` → terminal `channel-missing`; `owner.ok === false` → recoverable `lookup-failed`) and neither is reported as AUTH. `recordTenantScopeFailure` writes the ERR `publish_log` row before throwing. The **removal condition** is stated at `:112-118` as a canon-legal `TODO(2026-07-28|platform-engineering)` anchor tied to the counter.
- **Cache anti-poisoning**: `cached.ts:433` key = `generateKey("channels", [accountId, ...[...ids].sort()])`.
- **Publish stays green, foreign fails closed**: suite 5, 7/7 — the own tenant decrypts and publishes; a foreign `(channelId, accountId)` returns `err("AUTH")` with a **zero-decryption counter assertion** (`decryptionsBefore === decryptions`) and no provider credential materialized; a legacy payload resolves the owner and publishes; the recorder is a no-op for a foreign scope.

## 6. MERGE-BLOCKING requirement matrix

- **MTI — Channel IDOR routes closed, no decrypted credential crosses**: SATISFIED. Suite 4 tests at `:211`, `:222`, `:237`, `:248`, `:263`; Bluesky literal 404 at `:311`; OAuth 302 + no exchange + no row at `:333`.
- **MTI — worker credential/reconciliation tenant-safe, GUC bound**: SATISFIED. 4/4 worker sites scoped with the GUC bound (§5); suite 5 is 7/7 including the zero-decryption assertion.
- **MTI — child-table reads resolve channelId in tenant scope, gaps escalated**: PARTIAL. The `[static]` scenario is satisfied (the D10 table plus the "Escalated to backlog (open, tracked)" section, items 1-4). The `[integration]` scenario has **no covering test** — but it is unsatisfiable by construction: no analytics route accepts a client-supplied `channelId`, and `TOKENS.GetHistoricalAnalyticsQuery` is registered by NO route (dead wiring, verified empirically). See WARNING-3 for the one audited path missing from the table.
- **MTI — structural isolation by construction (3 legs, 57 → 58)**: SATISFIED (§3).
- **MTI — create paths validate parent ownership (both Channel paths)**: SATISFIED (§4); own-create consistency test at `:386` plus the DB invariant `mismatch_vs_project = 0`.
- **MTI — backfill integrity, zero NULL accountId (soft-deleted included)**: SATISFIED. `null_accountid = 0` over 21 rows; in-transaction RAISE in Migration A step 3.
- **MTI — no caller regression from the guard flip**: SATISFIED. 8154/8154 apps/api unit, 16/16 channel INT, plus the hard-delete and force-reauth system-context regressions, all green.
- **TCB — A8 OAuth callback binds context from OAuth state**: SATISFIED (`providerOAuthFlow.ts:155`); both the `[static]` and `[integration]` scenarios are covered.
- **TCB — Channel worker seams declare their context (Class D preview)**: SATISFIED in code (4/4 sites, §5) — but the requirement was never mirrored into the living spec (WARNING-1).
- **TCB — every pre-auth boundary binds a context (A8 row modified)**: SATISFIED. The living `tenant-context-boundaries/spec.md` carries the updated A8 row.

## 7. Findings

### CRITICAL — none

### WARNING-1 — three of four delta `ADDED` requirements were never mirrored into the living capability specs

The living `openspec/specs/multi-tenant-isolation/spec.md` carried exactly ONE Channel
requirement (the route-IDOR one). **Absent**: "Channel worker credential and reconciliation
paths are tenant-safe under both DB-role postures, with the account GUC bound" and "Channel
child-table reads resolve channelId within tenant scope". The living
`tenant-context-boundaries/spec.md` (7 requirements, none Channel-worker) was **missing**
"Channel worker seams declare their context (Class D preview)".

Root cause is a **tasks-plan omission, not a false checkbox**: task 7.2 was scoped to
"mirror the _Phase-0 reconciled_ deltas" (the OAuth 302 amendments — those ARE mirrored),
and PR2 had no corresponding mirror task; Phase 13 covers docs and the gate only.

**Impact**: Slice 8 (Post enrollment) reads the living spec, not the archived delta. If
archive does not merge these, three MERGE-BLOCKING worker requirements silently leave the
living capability. **Action for `sdd-archive`**: merge the three requirements before
archiving the delta.

### WARNING-2 — living spec carried a stale, now-false PR-seam statement

`openspec/specs/multi-tenant-isolation/spec.md` said "its RLS policy (leg 3) lands in the
slice's **PR2** (Migration B)" and "**PR2** adds the RLS policy (layer 2, Migration B)". The
D5 amendment moved Migration B into **PR1** (`fb0d2361`, shipped in merge `ce00d7ac`)
because the `rls-tenant-isolation` parity suite blocks enrollment-without-RLS by
construction. Both PRs are now merged, so the sentence was doubly stale — future tense about
completed work, and wrong about which PR shipped it. `tasks.md:114` already records the
amendment; the living spec did not.

### WARNING-3 — `AnalyticsAggregationQuery` is named in a MERGE-BLOCKING requirement but had no row in the documented audit table

The child-table requirement names four paths that SHALL be audited:
`PrismaAnalyticsReadRepository`, **`AnalyticsAggregationQuery`**, `analyticsRoutes`,
`AnalyticsDashboardHandlers` — and defines "Confirmed" as _documented in
`docs/security/MULTI_TENANT_GUARDS.md`_. That file had zero occurrences of
`AnalyticsAggregationQuery`.

**Independently verified SAFE** (no isolation gap):
`apps/api/src/infrastructure/repositories/PrismaAnalyticsAggregationQuery.ts:17-25`
`findChannelIdsByAccount(accountId)` resolves the channelId set via
`channel.findMany({ where: { project: { accountId, deletedAt: null } } })` — a guarded read
on the now-enrolled model plus an explicit parent filter — before `:34-36`
`analyticsDailySummary.findMany({ channelId: { in: params.channelIds } })`. So this is
documentation incompleteness on a MERGE-BLOCKING requirement, not an exposure. One-row fix.

### WARNING-4 — the escalated review item "other packages may share the typecheck blind spot" lived ONLY in engram

Not in `docs/reports/roadmap-detected-smells-backlog.md`, not in `MULTI_TENANT_GUARDS.md`.
The project's own backlog policy routes out-of-scope smells to that living file.

**The blind spot is real and far broader than db-prisma**: a sweep of every workspace package
that has a `tests/` dir and an `include` without `tests` returns **60+ packages** — including
`packages/core/domain` (`include: ["src/**/*"]` with `tests/unit/*.test.ts` present) and
**`apps/api` itself** (`tsconfig.json:8-13` includes `src` plus package `src` globs, never
`tests`). `apps/api` is the largest instance: 523 test files / 8154 tests outside
`tsc --noEmit`. Only `apps/workers` and (post-fix) `packages/adapters/db-prisma` use
`include: ["src", "tests"]`. The PR2 arity break's root cause is repo-wide.

### WARNING-5 — "no DB constraint ties `Channel.accountId` to `Project.accountId`" was stated as a fact but not filed as a tracked item

`docs/security/MULTI_TENANT_GUARDS.md` recorded "nothing at the database level constrains the
two denormalized columns to agree", but it did not appear in that file's "Escalated to backlog
(open, tracked)" list (items 1-4) nor in the smells backlog. The actionable form (a
CHECK/trigger or a reparenting guard to make the alignment structural rather than
conventional) survived only in engram apply-progress #421. The W3(c) production alignment IS
done and is pinned by a fixture that seeds a deliberately diverged `project.accountId`.

### SUGGESTION-1 — test-count drift in docs

`docs/security/MULTI_TENANT_GUARDS.md` said the isolation suite has "(15 tests)"; the suite
reports `tests 16`.

### SUGGESTION-2 — spec scenario wording described behavior the code does not have (harmlessly)

"listing with a foreign projectId returns empty ... **with no per-route ownership check**" —
the list route DOES have a per-route gate: `channelRoutes.ts:351` `assertCallerOwnsProject`
→ 404. `git log -L 351,352` shows it predates this slice (`4730470a`, "close 14 cross-tenant
vulnerabilities"). The security property is satisfied more strictly than specified, and the
guard-natural-empty claim is separately proven at the data layer (test `:433`). Wording drift
only.

### SUGGESTION-3 — the credential-leak test asserts response bodies, not logs

The requirement names "not in a response body, not in an error message, **not in a log**, and
not through an outbound provider API call". The test at `:263` asserts payloads only. This is
largely vacuous on the API side (no row resolves, so nothing decrypts), and the two strongest
clauses ARE covered elsewhere: the zero-decryption counter (suite 5) and `exchangeCalls === 0`
(OAuth test). Optional hardening: assert against a captured log sink.

## 8. Deferred scope — genuinely deferred, not dropped

- **Post enrollment (Slice 8)** — proposal "Out of Scope" plus the rollout plan. Deferred, tracked.
- **Child-table enrollment (confirm-only here)** — proposal "Out of Scope" plus `MULTI_TENANT_GUARDS.md` §"Child-table reads keyed by channelId". Deferred, audited.
- **WEBHOOK-INGEST wiring (A7 seam as-is)** — proposal "Out of Scope". Deferred.
- **(1) analytics daily/monthly summary raw channelId with dead wiring** — `MULTI_TENANT_GUARDS.md` §"Escalated to backlog (open, tracked)" item 1. DOCUMENTED.
- **(2) initiate-time OAuth ownership probe** — same section, item 2. DOCUMENTED.
- **(3) NOBYPASSRLS role plus the mentionIngest Mention-write GUC** — same section, item 3. DOCUMENTED.
- **(4) fitness #23 misses the tagged-template raw form** — same section, item 4, plus the blind-spot note enumerating the 7 audited-benign hits. DOCUMENTED.
- **(5) no DB constraint `Channel.accountId` ↔ `Project.accountId`** — fact in `MULTI_TENANT_GUARDS.md`; actionable form only in engram #421. **WARNING-5**.
- **(6) typecheck blind-spot sweep across packages** — engram #421 only. **WARNING-4**.

## 9. Verdict

**PASS WITH WARNINGS.** Every MERGE-BLOCKING behavioral requirement is proven green by
runtime evidence on the merged `main`; the security posture of the slice is intact and
independently re-verified (enrollment, both create paths, all four worker Channel seams,
backfill integrity, guard↔RLS parity, no-caller-regression). No CRITICAL. All five warnings
are artifact/documentation-propagation gaps, three of which (W1, W2, W3) are naturally
`sdd-archive`'s work.

**Recommended next**: `sdd-archive`, explicitly mandated to (a) merge the three unmirrored
requirements into the living specs, (b) correct the stale "PR2 adds the RLS policy"
sentences, (c) add the `AnalyticsAggregationQuery` row to the D10 table, and (d) file
WARNING-4 and WARNING-5 into `docs/reports/roadmap-detected-smells-backlog.md`.
