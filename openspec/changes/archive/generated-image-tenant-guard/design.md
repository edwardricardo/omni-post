# Design: GeneratedImage Tenant Guard (Slice 4)

## Technical Approach

Apply the Slice-1 Approach-A recipe verbatim to `GeneratedImage` (`schema.prisma:2462-2476`): one ordered column/backfill + RLS migration pair, guard enrollment (55 → 56), explicit `accountId` threading, create-path project-ownership BEFORE the paid AI-provider call, and the 404 route mapping. Plus the SIGNED in-slice billing fix (engram obs 306): derive the `aiCallsMade` accountId from the authenticated context, never from the request body. No `withSystemContext()` wraps — the out-of-context caller inventory is EMPTY (proposal, source-verified). Stacked on `workstream/cluster-c-recurringpost-trackedlink-guard` @ `8bf3e7e2` (guard = 55, migrations through `20260714040300_add_rls_recurring_post` — verified on disk).

## Architecture Decisions

### D1 — Migration pair, order-asserted, timestamps > `20260714040300`

`add_generated_image_account_id` → `add_rls_generated_image` (+`down.sql`), timestamps `20260715…` (today > Slice-3's latest). Column SQL copies the reference shape: ADD nullable → `UPDATE … FROM "Project"` over the NOT-NULL `projectId` FK (verified `:2464`, orphan-free, no soft-delete) → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT NULL` → FK `Account` Cascade → index. RLS SQL copies the `tenant_isolation` policy (`app.account_id` GUC + `__system__` bypass). **Index**: composite `@@index([accountId, projectId])` — the dominant guarded read is `findByProjectId` (adapter `:74`); keep `@@index([projectId, createdAt])` (`:2475`). No `@@unique` on the model — no constraint interplay. `Account` gains back-relation `generatedImages`.

### D2 — Guard enrollment 55 → 56

Insert `"generatedImage"` between `gatewaySwitchEvent` (`tenantGuard.ts:115`) and `glossary` (`:116`); header JSDoc count 55 → 56.

### D3 — DTO-carried threading; NO entity exists (brief divergence, verified)

The brief's "entity props/create/getter/fromPersistence" mirroring is **N/A**: `packages/core/domain/src/entities/` has no `GeneratedImage` — `GeneratedImageData` (`GeneratedImageRepository.ts:13-23`) is the sole carrier, constructed at exactly ONE site (`GenerateImageUseCase.ts:71-81`). Making `accountId: string` required on the DTO forces tsc-complete coverage: the use-case literal, adapter `create.data` (`:33-43`), and both output mappings (`:46-56`, `:81-91`). Simplest threading of the rollout; runtime guard injection cannot satisfy tsc once the column is NOT NULL (Slice-1 D2 lesson).

### D4 — Ownership check BEFORE the paid AI call

Inject `ProjectRepositoryPort` (`@core/domain/repositories/ProjectRepository.js`) as 2nd ctor param. Execute order becomes: prompt validation → `ProjectId.fromString` → guarded `projectRepository.findById` → foreign/missing → `err(NOT_FOUND)` → ONLY THEN `imageGenerator.generateImage` (today `:57`) → `save` with `accountId = project.accountId.toString()`. A foreign `projectId` burns **zero AI spend and persists nothing**. Copies `CreateCampaignUseCase.ts:36-71` (Slice 2) exactly. Note: this use case has NO `doWork`/catch-all — each step returns `Result`, so `NOT_FOUND` survives to the route without D3a's flattening trap; the route map is still the missing piece (D5).

### D5 — Route: NOT_FOUND → 404, and accountId is stripped from responses

`aiImageRoutes.ts:85` maps only `VALIDATION_FAILED ? 400 : 500` (verified) — add `NOT_FOUND → 404` (never 403/500, anti-enumeration). **Second verified gap**: both handlers return the DTO RAW (`sendSuccess(ctx, result.value…)` `:96`, `:130`), so D3's threading would expose `accountId` over HTTP, breaking the rollout convention ("accountId never client-supplied or exposed", Slice-3 D2b). Strip at the route edge in both handlers before `sendSuccess`, minding the shape difference: the generate handler returns a SINGLE DTO (`:96`) → `const { accountId: _a, ...rest } = result.value`; the list handler returns a DTO ARRAY (`ListGeneratedImagesQuery.execute` → `GeneratedImageData[]`, sent raw at `:130`) → `result.value.map(({ accountId: _a, ...rest }) => rest)`. A literal object-destructure on the array would strip nothing and re-leak `accountId` on every element — the two-tenant suite pins "response items carry NO accountId key" to catch a wrong implementation. Alternatives rejected: expose additively (deviates from the signed convention for zero benefit); split read/write DTOs (indirection for one field).

### D6 — Billing fix (SIGNED, obs 306): accountId from `request.customerUser`, not the body

**Accessor**: `request.customerUser.accountId` (`CustomerRequestUser`, `customerAuthMiddleware.ts:17-24`) — set at `:59-65` from the SAME verified JWT payload whose `accountId` binds `enterTenantContext` at `:70`, so it equals the tenant context by construction; the generate handler already holds it null-checked (`aiImageRoutes.ts:70-73`). Change: increment `aiCallsMade` unconditionally on success with `user.accountId`; delete `accountId` from `GenerateImageBodySchema` (`:23`) and the `if (body.accountId)` gate (`:90-94`). **Backward-compat mechanism CONFIRMED**: `validateRequest` calls `schema.parse` (`BaseRouteHandler.ts:149`) and default `z.object` STRIPS unknown keys — old clients still sending `accountId` get it silently ignored, no 400. Semantic change (signed): the counter now increments on EVERY successful generate (today only when the client sent the field). Alternative `requireTenantContext()` in the handler rejected: ambient ALS read where the route-canonical accessor already carries the provably-equal value.

### D7 — No UoW retrofit (documented, verified)

`GenerateImageUseCase` has no `UnitOfWork` (ctor `:35-38`). Rejected in-slice: (a) out of proposal scope; (b) **verified**: enrolled sibling adapters don't join the UoW tx — `PrismaCampaignRepository` never calls `PrismaUnitOfWork.getTransactionClient()` (only 8 repos do), so a use-case-level UoW alone would NOT bind the RLS GUC to this adapter's statements; real layer-2 coverage needs an adapter tx-join too; (c) layer 1 fully injects+validates on create regardless. Honest layering: both GeneratedImage paths run under **layer 1 alone** at runtime (pre-existing repo-wide property); RLS is structural depth. Backlog candidate (SMELL): UoW + tx-join retrofit.

### D8 — List closes guard-naturally; nothing else exists (verified)

`findByProjectId` (`:74`, `where:{projectId}`) → guard AND-injects `accountId` → foreign projectId → `200 + []`. No id-only routes, no update/delete, no child/join tables (obs-285 class structurally absent), no out-of-context callers. Only change on the list path is D5's response strip.

## Data Flow (generate)

    POST /ai/generate-image  (requireClientAuth → enterTenantContext(jwt.accountId))
      → GenerateImageUseCase.execute
          → projectRepository.findById(projectId)   [guarded; foreign → err(NOT_FOUND) → 404
                                                     — BEFORE any AI spend]
          → imageGenerator.generateImage(...)        [paid call, own project only]
          → repository.save({ ..., accountId: project.accountId })  [guard validates == ctx]
      → route: strip accountId → 201
      → usage: incrementUsage({ accountId: request.customerUser.accountId })  [server-derived]

## File Changes

| File                                                                             | Action                 | Description                                                                                                             |
| -------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                                     | Modify — **SENSITIVE** | `accountId` + `Account` relation (Cascade) + `@@index([accountId, projectId])`; `Account.generatedImages` back-relation |
| `infra/prisma/migrations/20260715…_add_generated_image_account_id/migration.sql` | Create — **SENSITIVE** | Recipe A (column/backfill/assert/NOT NULL/FK/index)                                                                     |
| `infra/prisma/migrations/20260715…_add_rls_generated_image/{migration,down}.sql` | Create — **SENSITIVE** | Recipe B (RLS policy + rollback)                                                                                        |
| `infra/prisma/src/extensions/tenantGuard.ts`                                     | Modify — **SENSITIVE** | Insert `generatedImage`; count 55 → 56 (D2)                                                                             |
| `packages/core/domain/src/repositories/GeneratedImageRepository.ts`              | Modify                 | `GeneratedImageData.accountId: string` (D3)                                                                             |
| `packages/core/ai-image/src/GenerateImageUseCase.ts`                             | Modify                 | `ProjectRepositoryPort` ctor param; ownership before AI call; thread accountId (D4)                                     |
| `apps/api/src/infrastructure/repositories/PrismaGeneratedImageRepository.ts`     | Modify                 | `create.data` + both output mappings carry `accountId` (D3)                                                             |
| `apps/api/src/ai-image/aiImageRoutes.ts`                                         | Modify                 | `NOT_FOUND → 404`; response accountId strip; billing from `customerUser.accountId`; drop body `accountId` (D5, D6)      |
| `apps/api/src/infrastructure/container/setupAIImageUseCases.ts`                  | Modify                 | Wire `TOKENS.ProjectRepository` (`types.ts:31`) into Generate                                                           |
| `packages/core/ai-image/tests/unit/GenerateImageUseCase.test.ts`                 | Modify                 | Ctor; foreign → NOT_FOUND; AI-port-not-called sentinel; threading                                                       |
| `apps/api/tests/unit/application/generateImageUseCase.test.ts`                   | Modify                 | Same deltas (duplicate suite site, verified)                                                                            |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                               | Modify                 | Enrollment + inject/validate/missing-context matrix                                                                     |
| `apps/api/tests/integration/generatedImageTenantIsolation.test.ts`               | Create                 | Two-tenant HTTP suite (node:test, real DB)                                                                              |
| `openspec/specs/multi-tenant-isolation/spec.md`                                  | Modify                 | Req-1 row, Req-2 GeneratedImage block, Req-3 row                                                                        |
| `docs/security/MULTI_TENANT_GUARDS.md`                                           | Modify                 | 3-step enrollment + counts                                                                                              |

## Interfaces / Contracts

```typescript
// GeneratedImageData — new required field (D3); HTTP responses strip it (D5)
accountId: string;

// GenerateImageUseCase — no UoW (pre-existing shape, D7)
constructor(
  repository: GeneratedImageRepository,
  projectRepository: ProjectRepositoryPort,   // guarded ownership probe
  imageGenerator: ImageGenerationPort
)
```

## Testing Strategy

| Layer                                                         | What to Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Approach                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit (vitest)                                                 | Guard matrix for `generatedImage` (membership, where-injection, create-injection, mismatch throw, missing-context throw); Generate: foreign project → `NOT_FOUND` with `imageGenerator` AND `save` NOT called; own project threads `project.accountId`; prompt-validation regression                                                                                                                                                                                                                                                                                                                | Mock ports; `tenantGuardCheck` (no Prisma)                     |
| Integration (MERGE-BLOCKING, node:test, real DB, two tenants) | Foreign generate → **404 never 403/500**, zero rows persisted, AI sentinel NOT invoked (override `TOKENS.ImageGenerationPort` with a sentinel fake) + positive control: own generate → 201, sentinel fires, row `accountId == project.accountId`; foreign list → 200 + `[]`; own list → own rows only, response items carry NO `accountId` key (D5 pin); **billing**: own generate WITHOUT body accountId → caller's `aiCallsMade` +1; body carrying a FOREIGN `accountId` → still 201, foreign tenant's `usageMetric` UNCHANGED, caller's incremented; no `TenantContextMissingError` on own flows | New suite; pattern from `campaignTenantIsolation.test.ts`      |
| Migration                                                     | Zero NULL post-backfill; row count preserved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | In-tx `RAISE EXCEPTION` (fails the deploy)                     |
| Gate                                                          | 0-defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | tsc, eslint --max-warnings 0, fitness #21/#23, full regression |

## Threat Matrix

N/A — data-layer authorization + route status mapping only; no routing/shell/subprocess/VCS/PR-automation/executable-classification/process-integration boundary. Unlike Slice 3, no public bypass is introduced.

## Migration / Rollout

Single atomic PR, single deployable (migrations + guard flip + code + tests are one deploy unit; `size:exception` if > 400 lines). `pnpm db:up` + `omnipost-allow sensitive-edit` at apply. Assert column-migration timestamp < RLS-migration timestamp, both > `20260714040300`. Rollback: revert branch pre-merge; post-merge `down.sql` drops the policy, remove the guard entry, column is additive/harmless. Rolling-deploy caveat inherited from Slice 1 (single-deployable target here).

## Open Questions

- [ ] None blocking. Migration timestamps assigned at apply (`--create-only`), ordering asserted per D1.
- [ ] Backlog (non-blocking, next SMELL id): UoW + adapter tx-join retrofit for the generate save (D7) so RLS layer 2 covers the write.
