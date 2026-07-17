# Design: ScheduledReport + Campaign Tenant Guard (Slice 2)

## Technical Approach

Apply the Slice-1 reference recipe (engram `sdd/external-notification-tenant-guard/design`, obs 275) verbatim to `ScheduledReport` and `Campaign`, in ONE change: per model, an ordered column/backfill + RLS migration pair, guard-list enrollment, explicit `accountId` threading, create-path parent-ownership assertion (404-not-500), and a MERGE-BLOCKING two-tenant integration test. Stacked on the Slice-1 branch (guard=51, migrations `20260714020035`/`20260714020135` present).

## Architecture Decisions

### D1 — Four migrations, per-model pairs, order-asserted

**Choice**: 2 migrations per model, planned names: `add_scheduled_report_account_id` → `add_rls_scheduled_report` → `add_campaign_account_id` → `add_rls_campaign`. Constraints (assert at apply): every timestamp **> `20260714020135`** (Slice-1 RLS); each column migration lexicographically **before** its RLS migration.
**Alternatives**: combined column migration + combined RLS migration (2 files).
**Rationale**: per-model pairs copy the reference SQL shape verbatim, keep `down.sql` rollback granular per model, and keep each migration self-describing. Column SQL copies `20260714020035` exactly (ADD nullable → `UPDATE ... FROM "Project"` over NOT-NULL `projectId` FK → in-tx `RAISE EXCEPTION` on NULL → `SET NOT NULL` → FK Cascade → index); RLS SQL copies `20260714020135` (`ENABLE ROW LEVEL SECURITY` → `DROP POLICY IF EXISTS` → `CREATE POLICY tenant_isolation` with `__system__` bypass + companion `down.sql`). **No recipe adaptation needed**: both models have NOT-NULL `projectId` and no soft-delete column — the backfill join is orphan-free by construction.

### D2 — Entity-carried accountId (model-specific delta from Slice 1)

**Choice**: add `accountId: string` to `ScheduledReportProps`/`CampaignProps`, create-factory inputs, getters, and `fromPersistence`; adapters add it to the row interface, `toDomain`, and the upsert `create` branch.
**Alternatives**: repo-signature param `save(entity, accountId)`; ambient `requireTenantContext()` in adapter (rejected in Slice 1).
**Rationale**: Slice 1 threaded a flat data record; these are rich domain entities. The sibling convention is entity-carried plain-string `accountId` (13 existing entities, e.g. `CustomReport.ts:36,229`). Since both adapters persist via `upsert`, the entity carrying `accountId` makes the SAME `save()` serve create AND update paths with one threading point — compile-time mandatory once the Prisma column is required. DTO doctrine unchanged: `toDto`/`toJSON` do **NOT** expose `accountId`.

### D3 — Create-path ownership; routes need NO change (verified delta)

**Choice**: inject `ProjectRepositoryPort` as 2nd ctor param into `CreateScheduledReportUseCase` + `CreateCampaignUseCase` (mirrors `ConfigureExternalNotificationUseCase`); resolve guarded `findById(projectId)`; on miss return `err(USE_CASE_ERRORS.NOT_FOUND)` **before** `doWork` (so the catch-all cannot flatten to INTERNAL_ERROR); thread `project.accountId.toString()`.
**Verified**: unlike Slice 1, **both create routes already map NOT_FOUND → 404** via `mapErrorCode` (`reportRoutes.ts:75-84,119`; `campaignRoutes.ts:100-109,145`) — the D3a route branch exists; only the use-case leg is missing. No route file changes.
**Rationale**: anti-enumeration (404 never 403); write-path-only control — list with foreign `projectId` stays `200 + []` (Slice-1 D3). MOST of the 6 ScheduledReport / 8 Campaign id-only routes close by construction via guard enrollment (auto-injected `accountId` → `EntityNotFoundError` → existing 404 mapping) **because they resolve the model via a guarded `findById` before mutating**. The **untag** route is the exception — see D5.

### D4 — Guard enrollment + dead code untouched

**Choice**: append `"campaign"` and `"scheduledReport"` alphabetically to `TENANT_SCOPED_MODELS`; header JSDoc count 51 → 53. `campaign.delete()` (0 use-case callers) and `findDueReports` (0 callers) are enrolled but NOT wired — no `withSystemContext` anywhere (proposal verified **zero** out-of-context callers for both models).
**Rationale**: enrolling is the security control; wiring dead code adds untested paths. A future `findDueReports` caller must decide its context (UoW vs system) then.

### D5 — Untag join-table IDOR (second systematic gap class; source-verified CRITICAL)

**Choice**: add a guarded `campaignRepository.findById(campaignId)` at the TOP of `UntagPostFromCampaignUseCase.execute`, mirroring `TagPostWithCampaignUseCase.ts:51` exactly — a foreign/missing campaign returns `err(USE_CASE_ERRORS.NOT_FOUND)` **before** `removePost`, so B's join row is untouched and the response is 404, not a P2025 500. No route change (untag route already maps `NOT_FOUND → 404` via `mapErrorCode`).
**Alternatives**: enroll `campaignPost` in `TENANT_SCOPED_MODELS` (rejected — the join table has no `accountId` column; it would need its own denormalization migration, out of this slice's scope and the proposal's exclusion); trust guard enrollment (rejected — proven false).
**Verified**: `UntagPostFromCampaignUseCase.execute` (`UntagPostFromCampaignUseCase.ts:34`) validates ID shapes then calls `removePost` at `:52` with **no `findById`**. `removePost` (`PrismaCampaignRepository.ts:167-182`) deletes on `prisma.campaignPost` — a JOIN table absent from `TENANT_SCOPED_MODELS` (guard bypasses it) with no RLS. Exploit: tenant A with B's `campaignId` + a `postId` calls `DELETE /api/campaigns/{B_id}/posts/{postId}` → deletes B's tag (destructive CWE-639) or 500s. Enrolling `Campaign` does nothing because untag never queries `Campaign`. Tag/Update/Archive are safe — each resolves via guarded `findById` first (`TagPostWithCampaignUseCase.ts:51`, Update `:46`, Archive `:50`).
**Generalized recipe note (Slices 3-8)**: guard enrollment closes routes that QUERY the enrolled model. It does NOT close a route that mutates a RELATED / JOIN / CHILD table (like `campaignPost`) or that BYPASSES the model's guarded `findById`. This is a SECOND systematic gap class alongside the create-path one (obs 273). Every slice MUST audit its model's write routes for (a) join/child-table mutations and (b) missing parent resolution, and add an app-level guarded parent `findById` where either is found.

## Data Flow (create path, per model)

    Route (payload projectId) ──→ CreateXUseCase
        ──→ ProjectRepositoryPort.findById  [guarded: foreign → NOT_FOUND → 404]
        ──→ X.create({ ..., accountId: project.accountId })   [explicit thread]
        ──→ UoW tx ──→ PrismaXRepository.save (upsert.create carries accountId)
              [layer 1: guard validates accountId == ctx · layer 2: RLS WITH CHECK]

Reads outside UoW (lists/queries) are layer-1-only at runtime — same honest-layering note as Slice 1; carried into the RLS migration comments.

## File Changes

| File                                                                          | Action                 | Description                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `infra/prisma/schema.prisma`                                                  | Modify — **SENSITIVE** | Both models: `accountId String` + `account Account @relation(..., onDelete: Cascade)` + `@@index([accountId])` (honest minimum — existing `[projectId, *]` indexes front guarded list reads, per Slice-1 index rule); `Account`: back-relations `campaigns Campaign[]`, `scheduledReports ScheduledReport[]` |
| `infra/prisma/migrations/*_add_scheduled_report_account_id/migration.sql`     | Create — **SENSITIVE** | Recipe A (column/backfill/assert/NOT NULL/FK/index)                                                                                                                                                                                                                                                          |
| `infra/prisma/migrations/*_add_rls_scheduled_report/{migration,down}.sql`     | Create — **SENSITIVE** | Recipe B (RLS policy + operator down.sql)                                                                                                                                                                                                                                                                    |
| `infra/prisma/migrations/*_add_campaign_account_id/migration.sql`             | Create — **SENSITIVE** | Recipe A for Campaign                                                                                                                                                                                                                                                                                        |
| `infra/prisma/migrations/*_add_rls_campaign/{migration,down}.sql`             | Create — **SENSITIVE** | Recipe B for Campaign                                                                                                                                                                                                                                                                                        |
| `infra/prisma/src/extensions/tenantGuard.ts`                                  | Modify — **SENSITIVE** | Append 2 names; count 51→53                                                                                                                                                                                                                                                                                  |
| `packages/core/domain/src/entities/ScheduledReport.ts`                        | Modify                 | `accountId` in props/create/getter/`fromPersistence`                                                                                                                                                                                                                                                         |
| `packages/core/domain/src/entities/Campaign.ts`                               | Modify                 | Same                                                                                                                                                                                                                                                                                                         |
| `packages/core/reports/src/CreateScheduledReportUseCase.ts`                   | Modify                 | Ownership check + threading (D3)                                                                                                                                                                                                                                                                             |
| `packages/core/campaigns/src/CreateCampaignUseCase.ts`                        | Modify                 | Same                                                                                                                                                                                                                                                                                                         |
| `packages/core/campaigns/src/UntagPostFromCampaignUseCase.ts`                 | Modify                 | Add guarded `findById(campaignId)` before `removePost` — closes join-table IDOR (D5); mirror `TagPostWithCampaignUseCase.ts:51`                                                                                                                                                                              |
| `apps/api/src/infrastructure/repositories/PrismaScheduledReportRepository.ts` | Modify                 | Row iface + `toDomain` + upsert `create` carry `accountId`                                                                                                                                                                                                                                                   |
| `apps/api/src/infrastructure/repositories/PrismaCampaignRepository.ts`        | Modify                 | Same                                                                                                                                                                                                                                                                                                         |
| `apps/api/src/infrastructure/container/setupCrisisUseCases.ts`                | Modify                 | Inject `TOKENS.ProjectRepository` (line ~121)                                                                                                                                                                                                                                                                |
| `apps/api/src/infrastructure/container/setupAnalyticsUseCases.ts`             | Modify                 | Inject `TOKENS.ProjectRepository` (line ~145)                                                                                                                                                                                                                                                                |
| `apps/api/tests/integration/scheduledReportTenantIsolation.test.ts`           | Create                 | Two-tenant test (template: `externalNotificationTenantIsolation.test.ts`)                                                                                                                                                                                                                                    |
| `apps/api/tests/integration/campaignTenantIsolation.test.ts`                  | Create                 | Two-tenant test                                                                                                                                                                                                                                                                                              |
| `openspec/specs/multi-tenant-isolation/spec.md`                               | Modify                 | Req-1/Req-3 tables + 2 Req-2-shaped blocks                                                                                                                                                                                                                                                                   |
| `docs/security/MULTI_TENANT_GUARDS.md`                                        | Modify                 | Enroll both models                                                                                                                                                                                                                                                                                           |

Routes: **no changes** (D3). Existing unit suites for both create use cases gain a mocked `ProjectRepositoryPort`.

## Interfaces / Contracts

```typescript
// Entity props delta (both models) — sibling convention, plain string
export interface CampaignProps extends EntityProps {
  accountId: string; // NEW — threaded from guarded Project, never client-supplied
  // ...existing
}

// Use case ctor delta (both) — mirrors ConfigureExternalNotificationUseCase
constructor(
  private readonly campaignRepository: CampaignRepository,
  private readonly projectRepository: ProjectRepositoryPort, // NEW, 2nd
  private readonly unitOfWork?: UnitOfWork
) {}
```

Client-facing inputs/DTOs unchanged — `accountId` is derived server-side only.

## Testing Strategy

| Layer                                   | What to Test                                                                                                                                                                                                                                                                                                                                                                                                                                  | Approach                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Unit                                    | Foreign/missing project → NOT_FOUND before tx (both creates); foreign/missing campaign → NOT_FOUND before `removePost` (untag); own project threads accountId                                                                                                                                                                                                                                                                                 | Vitest, mocked `ProjectRepositoryPort` + mocked `CampaignRepository.findById` |
| Integration (per model, MERGE-BLOCKING) | Cross-tenant get/list/update/delete/generate → empty/404; foreign-projectId create → **404 never 403/500**; **Campaign: foreign untag → 404 AND B's campaign-post tag set unchanged (join row survives)**; ScheduledReport: foreign-projectId `listReports` → **200 + []** (guard-scoped `findByProjectId`, closed but must be covered); own create persists `accountId == Project.accountId`; zero NULL + row count preserved post-migration | node:test, real DB, two tenants                                               |
| Gate                                    | 0-defect                                                                                                                                                                                                                                                                                                                                                                                                                                      | tsc, eslint, fitness #21/#23, full regression                                 |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary (DB migrations + app-layer code only).

## Migration / Rollout

Single-deployable target (Slice-1 caveat inherited): nullable→backfill→SET NOT NULL is downtime-safe here; a rolling deploy would need a nullable-through-rollout variant — not this target. Rollback: revert branch pre-merge; post-merge run per-model `down.sql` (drop policy, disable RLS), drop columns, remove guard entries.

## Open Questions

None.
