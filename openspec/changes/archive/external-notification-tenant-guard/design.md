# Design: External Notification Tenant Guard (Slice 1 — Reference Implementation)

> HOW for `proposal.md` + `specs/multi-tenant-isolation/spec.md`. Every claim below was
> verified at source (guard code, schema, RLS migration, adapters, DTO mappings, log paths).

## Technical Approach

Enroll `ExternalNotificationConfig` in both isolation layers by construction: non-null
`accountId` backfilled from `Project` over the NOT-NULL `projectId` FK, guard-list flip,
new forward RLS migration. The one control the data layer cannot provide — parent–child
consistency on WRITE — becomes a project-ownership assertion in
`ConfigureExternalNotificationUseCase`. Reads/deletes need no code change: guard scoping
makes foreign ids resolve to `EntityNotFoundError`, which the routes already map to 404.

## Architecture Decisions

### D1: Two migrations, ORDER-MANDATED — column/backfill FIRST, RLS SECOND

**Choice**: migration A (`prisma migrate dev --create-only`, hand-edited):
`ADD COLUMN "accountId" TEXT` (nullable) → `UPDATE ... SET "accountId" = p."accountId" FROM "Project" p` →
in-tx `DO $$ ... RAISE EXCEPTION` if any NULL remains → `SET NOT NULL` → FK to `Account`
(`ON DELETE CASCADE`) → `CREATE INDEX`. Migration B (separate, with operator `down.sql`):
RLS enrollment, copying the `tenant_isolation` policy shape (USING + WITH CHECK on the
`app.account_id` GUC, `__system__` bypass) from `20260527000000` — which is NEVER edited.
**ORDERING IS LOAD-BEARING**: migration B's `CREATE POLICY ... USING ("accountId" = current_setting(...))`
hard-references the column A adds. Prisma applies migrations in lexicographic timestamp order,
so A's timestamp MUST precede B's. The apply phase MUST assert `A.timestamp < B.timestamp`
(reversed order → `CREATE POLICY` runs before the column exists → deploy aborts). Two
migrations, not one, because the deployed convention is a dedicated RLS migration with its own
rollback script; keeping that split is worth the ordering assertion.
**Alternatives**: expand/contract split (zero-downtime) — rejected here (single deployable,
dev stage, one PR; Prisma runs migration A in a single tx so backfill → `SET NOT NULL` is
atomic) but see the recipe's deploy-target caveat for later slices. RLS folded into migration
A — rejected: loses the standalone rollback script.
**Index (corrected)**: `SchedulingRule` does NOT use `@@index([accountId])` — it uses a
composite `@@index([accountId, isActive])` and RETAINS `@@index([projectId, isActive])`.
After guard injection this model's list read is `findMany({ where: { projectId, accountId } })`.
The existing `@@index([projectId, isActive])` already fronts every projectId-prefixed read, so
the honest minimum that also satisfies spec Req-1 (an index led by `accountId`) is a plain
`@@index([accountId])`. **Inherited rule**: add at minimum an index whose LEADING column is
`accountId`; if a model's dominant guarded read is parent-filtered, prefer the composite
`@@index([accountId, <parentId>])` instead — do NOT blindly copy a plain single-column index.
**Facts**: model has no `@@unique` (only two `@@index`) — no constraint interplay; back-relation
list field added on `Account`.

### D2: `accountId` flows explicitly — use case → data → adapter; no ambient reads

Once required, Prisma's generated create types demand `accountId` at compile time; the
guard's runtime injection cannot satisfy tsc.
**Choice**: the use case resolves the project via guard-scoped `ProjectRepositoryPort.findById`
(this IS the ownership check — foreign/nonexistent → `EntityNotFoundError`), threads
`project.accountId` into `ExternalNotificationConfigData.accountId`; the adapter passes it in
`upsert.create`. The guard then VALIDATES it equals the bound context (mismatch throws
`TenantContextMismatchError`).
**Alternatives**: `requireTenantContext()` inside the adapter — rejected: ambient read whose
only precedent is the two audited raw-SQL repos. Type cast to omit the field — rejected:
zero-`any`/zero-cast canon.
**Invariant (orchestrator confirmation #2)**: `row.accountId === Project.accountId` holds by
construction — backfill copies over the FK join; create threads from the guard-scoped parent;
the `upsert.update` branch never touches `accountId`/`projectId`.

### D3: Ownership assertion is a WRITE-path control; LIST keeps guard-natural `200 + []`

**Choice** (against the suggested lean, argued): `GET ?projectId={foreign}` returns 200 with
an empty array, NOT 404.
**Rationale**: (1) Security-equivalent and enumeration-safe — foreign and nonexistent
projectIds behave identically (both empty); nothing leaks either way. (2) Doctrine: this
rollout REPLACES per-route ownership checks with data-layer scoping (spec Req 1: "NO
per-route ownership check SHALL be required for read paths"); 404-ing list reintroduces
app-level probes on every parent-filtered read route across Slices 2–8, doubling reads and
diff size for zero security delta. (3) REST semantic: a filtered collection is a scoped
subset of YOUR data — possibly empty. Spec Req-2 list scenario stays as written.
**Inherited rule for Slices 2–8**: assert parent ownership exactly where a client-supplied
parent id is PERSISTED (create/move/repoint) → reject **NOT_FOUND 404, never 403**
(anti-enumeration). Read paths rely on guard scoping alone.

### D3a: Foreign-project create MUST resolve to 404, not 500 (conformance trap)

Spec Req-3 demands a foreign-project create → **404 NOT_FOUND** (anti-enumeration). The
"obvious" wiring produces **500**: `ConfigureExternalNotificationUseCase`'s `catch` flattens
ANY thrown error to `USE_CASE_ERRORS.INTERNAL_ERROR`, and the create route maps only
`VALIDATION_FAILED ? 400 : 500` — there is NO `NOT_FOUND → 404` branch (verified at source).
**Choice**: the reference implementation MUST (a) translate the ownership probe's
`EntityNotFoundError` into `USE_CASE_ERRORS.NOT_FOUND` explicitly — as a returned `err(...)`
BEFORE `doWork`, so the catch-all never flattens it (mirrors `TestExternalNotificationUseCase`,
which already returns `NOT_FOUND` on repo miss); (b) add a `result.error.code === "NOT_FOUND"
? 404 : ...` branch to the create route handler; (c) the MERGE-BLOCKING integration test
asserts the foreign-project create returns **404, never 500 or 403**. `USE_CASE_ERRORS.NOT_FOUND`
exists (`@core/application/UseCase.ts`). **Inherited rule**: any slice adding a write-path
ownership probe MUST verify the error survives as `NOT_FOUND` through BOTH the use case's
catch and the route's status map — a probe that 500s is a conformance failure, not a pass.

### D4: No shared ownership helper — the primitive is the pattern plus a mandated test

The check is ~4 lines against a port each context already imports. A shared helper would
need a cross-context home; tripwire #3 only whitelists `@core/domain` and
`@core/application/UseCase`, and a probe-injection helper saves ~2 lines while adding
indirection. **Enforcement** = the spec's foreign-parent-create scenario (404 + no row) is
MERGE-BLOCKING in every slice, and the recipe step lands in `MULTI_TENANT_GUARDS.md`.
Revisit (ADR) if ≥3 slices show drift. **Residual (on the record)**: the per-slice integration
test is the ONLY enforcement — there is no static/fitness guard, so a future write path (an
update/move route repointing `projectId`, or a bulk `createMany`) could persist
`accountId ≠ Project.accountId` with no test catching it; a grep-based fitness function
("create/upsert on a `projectId`-bearing model without a preceding guarded parent resolution")
is a backlog candidate if drift appears.

## Data Flow (create path)

    POST /external-notifications  (requireClientAuth → enterTenantContext)
      → ConfigureExternalNotificationUseCase.execute        [UoW tx → RLS GUC bound]
          → projectRepository.findById(projectId)           [guard injects accountId;
                                                             foreign → NotFound → 404]
          → data.accountId = project.accountId              [parent-consistent by construction]
          → repository.save(data)                           [adapter passes accountId;
                                                             guard validates == ctx or throws]
      → RLS layer 2 re-checks the row against app.account_id

## File Changes

| File                                                                                           | Action | Description                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                                                   | Modify | `accountId` + relation + index on model; back-relation on `Account`. **SENSITIVE**                                                                                                                                   |
| `infra/prisma/migrations/<ts>_add_external_notification_config_account_id/migration.sql`       | Create | D1: column → backfill → NULL assert → NOT NULL → FK → index. **SENSITIVE**                                                                                                                                           |
| `infra/prisma/migrations/<ts>_add_rls_external_notification_config/migration.sql` + `down.sql` | Create | RLS policy (copied shape) + operator rollback. **SENSITIVE**                                                                                                                                                         |
| `infra/prisma/src/extensions/tenantGuard.ts`                                                   | Modify | Append `externalNotificationConfig`; header count 50 → 51. **SENSITIVE**                                                                                                                                             |
| `packages/core/domain/src/repositories/ExternalNotificationConfigRepository.ts`                | Modify | `ExternalNotificationConfigData` gains `accountId: string`                                                                                                                                                           |
| `packages/core/external-notifications/src/ConfigureExternalNotificationUseCase.ts`             | Modify | Ownership check + accountId threading; ctor gains `ProjectRepositoryPort` (UoW stays last); foreign/missing project → return `err(NOT_FOUND)` BEFORE `doWork` so the catch-all never flattens it to `INTERNAL_ERROR` |
| `apps/api/src/infrastructure/repositories/PrismaExternalNotificationConfigRepository.ts`       | Modify | `upsert.create` passes `accountId`; `toData` maps it                                                                                                                                                                 |
| `apps/api/src/external-notifications/externalNotificationRoutes.ts`                            | Modify | create handler: add `NOT_FOUND → 404` branch (currently `VALIDATION_FAILED?400:500` only)                                                                                                                            |
| `apps/api/src/infrastructure/container/setupExternalNotificationUseCases.ts`                   | Modify | Wire `TOKENS.ProjectRepository` into Configure                                                                                                                                                                       |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                                             | Modify | Enrollment + inject/validate/missing-context cases                                                                                                                                                                   |
| `apps/api/tests/unit/application/externalNotificationUseCase.test.ts`                          | Modify | Ctor updates; foreign-project → NOT_FOUND; threading                                                                                                                                                                 |
| `apps/api/tests/unit/infrastructure/PrismaExternalNotificationConfigRepository.test.ts`        | Modify | accountId in create data + mapping                                                                                                                                                                                   |
| `apps/api/tests/unit/infrastructure/container/setupExternalNotificationUseCases.test.ts`       | Modify | Wiring assertion                                                                                                                                                                                                     |
| `apps/api/tests/integration/externalNotificationTenantIsolation.test.ts`                       | Create | Two-tenant HTTP suite (node:test, real DB)                                                                                                                                                                           |
| `docs/security/MULTI_TENANT_GUARDS.md`                                                         | Modify | Enroll model; fix stale counts; add create-path recipe step                                                                                                                                                          |

## Interfaces / Contracts

```typescript
// packages/core/domain — ExternalNotificationConfigData
accountId: string;                       // new required field, mirrors the row

// ConfigureExternalNotificationUseCase
constructor(
  repository: ExternalNotificationConfigRepository,
  projectRepository: ProjectRepositoryPort,   // narrow-injection variant, findById only
  unitOfWork?: UnitOfWork                     // last, per UoW canon
)
```

Output DTOs are mapped field-by-field (verified) — `accountId` is NOT exposed over HTTP.

## Testing Strategy

| Layer                                                       | What to Test                                                                                                                                                                                                                                                                                                   | Approach                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Unit (vitest)                                               | Guard decision matrix for `externalNotificationConfig`: where-injection, `upsert.create` injection, mismatch throw, missing-context throw, `getTenantScopedModels` membership                                                                                                                                  | Extend `tenantGuard.test.ts` via `tenantGuardCheck` (no Prisma client)                      |
| Unit (vitest)                                               | Configure: foreign project → `NOT_FOUND`; own project threads `project.accountId`; validation regressions                                                                                                                                                                                                      | Mock `ProjectRepositoryPort` factory                                                        |
| Integration (node:test, real DB, two tenants, through HTTP) | Spec scenarios: foreign list → 200 `[]`, no B secret in body; foreign delete/test-fire → 404, B's row persists, B's webhook sink gets ZERO hits (local HTTP sink as B's webhook); foreign create → 404 (never 500/403), no row; own-tenant CRUD regression; `accountId == Project.accountId` on persisted rows | New suite; pattern from `rls-tenant-isolation.test.ts`; LXC-safe single-file runs           |
| Migration                                                   | Zero NULL `accountId` after backfill                                                                                                                                                                                                                                                                           | Enforced by the migration's own in-tx `RAISE EXCEPTION` (fails the deploy, not just a test) |

## Runtime enforcement per route — honest layering

This slice is NOT uniformly two-layer at runtime, and the framing must not pretend it is.
Verified: `ListExternalNotificationsQuery` (ctor = repository only) and
`TestExternalNotificationUseCase` (ctor = repository + notifier) run OUTSIDE any UoW, so
`PrismaUnitOfWork` never sets the `app.account_id` GUC and RLS (layer 2) is INERT for exactly
the two routes that DECRYPT the webhook secret. Delete and Create run inside a UoW and keep
the RLS backstop. So **List and Test-fire are guarded by LAYER 1 (the Prisma `$extends` guard)
ALONE at runtime.** This is a pre-existing repo-wide property (single-statement reads outside a
tx always depend on layer 1; documented in `MULTI_TENANT_GUARDS.md`), NOT something introduced
here. Consequence: the enforcement that catches a guard-list regression on the decrypting reads
is the MERGE-BLOCKING integration test, not RLS. RLS remains defense-in-depth for the two
UoW-wrapped mutations.

## Secret Boundary (orchestrator confirmation #1) — verified at source

No log path carries the decrypted webhook URL: use cases and dispatcher log nothing;
Slack/Teams adapter errors embed only reason/upstream status+body (verified both);
`BaseRouteHandler.logInfo` logs route/method/url/meta, never request bodies. The decrypted
URL leaves the process ONLY via owner-scoped response DTOs and the outbound webhook POST —
both tenant-bound once the guard is on. The integration suite asserts both.

## Threat Matrix

N/A — data-layer authorization change; no routing, shell, subprocess, VCS/PR automation,
executable-file classification, or process-integration boundary.

## Migration / Rollout

Single PR, single deployable: schema migration → RLS migration → guard flip + code, applied
together (`pnpm db:up` first). Rollback: revert guard/code commit (column stays, harmless);
drop RLS via `down.sql`; column removable by a later down migration.

## Recipe for Slices 2–8 — copy vs adapt

**Copy verbatim**: D1 two-migration shape with the MANDATED order (column/backfill migration
FIRST, RLS migration SECOND — assert `A.timestamp < B.timestamp`); guard-list append; NEW
forward RLS migration + `down.sql` (never edit deployed migrations); D2 explicit accountId
threading; D3 write-path ownership rule (foreign parent = 404, never 403); D3a 404-not-500
conformance (probe error must survive as `NOT_FOUND` through the use-case catch AND the route
status map); index rule (leading column `accountId`; composite `[accountId, <parentId>]` when
the guarded read is parent-filtered); two-tenant integration template; docs 3-step checklist +
count updates.

**Deploy-target caveat (expand/contract)**: the `nullable → backfill → SET NOT NULL` shape is
downtime-safe ONLY for a single-deployable target (this slice's dev reality). On a ROLLING
deploy, after `SET NOT NULL` but before every pod carries the new guard-list + threading, an
OLD pod's create inserts without `accountId` → NOT NULL violation. For non-downtime targets a
slice MUST keep the column nullable-writable through the rollout, backfill, then tighten to NOT
NULL in a follow-up migration. This is a per-slice deploy-target decision, NOT a Slice-1 change.
**Adapt per model**: backfill JOIN source and soft-delete semantics (soft-deleted parents
still have rows, so the FK join covers them; a NULLABLE parent FK needs an explicit NULL
strategy and makes the assert load-bearing); the guarded parent may be `Post`/`Channel`
(ownership probe = that model's guarded repository); out-of-context callers (workers, seeds,
sagas, scripts) need `withSystemContext()` wraps — this slice verified ZERO, later slices
MUST enumerate theirs; models with `@@unique` constraints must check interplay with the new
column; create paths using nested writes adapt the threading. **Honest caveat**: RLS binds
only inside a UoW transaction (GUC set by `PrismaUnitOfWork`) — single-statement reads
outside a tx rely on layer 1 (the guard) alone.

## Open Questions

- None blocking. Migration timestamps are assigned at apply time (`--create-only`); the apply
  phase MUST assign the column/backfill migration an EARLIER timestamp than the RLS migration
  and assert that ordering (D1).
