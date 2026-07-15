# Tasks: GeneratedImage Tenant Guard (Slice 4)

> Strict-TDD, dependency-ordered. RED precedes each GREEN. The two-tenant
> integration suite is the overarching **MERGE-BLOCKING RED** — it goes green only
> after every phase lands. One clean model (Approach-A recipe) + the SIGNED in-slice
> billing fix (D6, obs 306). Stacked on `workstream/cluster-c-recurringpost-trackedlink-guard`
> @ `8bf3e7e2` (guard = 55, latest migration `20260714040300`).

## Sensitive-edit gate

**Sensitive-edit token REQUIRED: YES — `infra/prisma/**`ONLY.** Every`[SENSITIVE]`task (schema, 2 migrations,`tenantGuard.ts`) is BLOCKED without an active
`omnipost-allow sensitive-edit`token. Acquire it before Phase 2. This slice touches
NO`apps/api/src/security/\*\*` (the rate-limit file was Slice 3) — no other surface is sensitive.

## Command legend (LXC-safe, single-file)

- **DBUP**: `pnpm db:up` (Postgres + Redis; before any migration or integration test)
- **VITEST-API `<file>`**: `NODE_OPTIONS=--max-old-space-size=7168 pnpm --filter @apps/api exec vitest run <file>`
- **VITEST-AI `<file>`**: `NODE_OPTIONS=--max-old-space-size=7168 pnpm --filter @core/ai-image exec vitest run <file>`
- **INT `<file>`** (from `apps/api`, DBUP first): `NODE_OPTIONS=--max-old-space-size=7168 node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test <file>`
- **MIGRATE**: author `pnpm --filter @infra/prisma exec prisma migrate dev --create-only --name <name>` (hand-edit SQL); apply (apply phase) `pnpm db:up && pnpm db:migrate`
- **CLIENT-REGEN**: `pnpm --filter @infra/prisma build`

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~380–450 (2 migrations ~90, schema ~8, guard ~2, DTO ~1, use-case ownership+thread ~28, adapter ~4, route 404+2 strips+billing rewrite ~18, DI ~3, unit deltas ~75, new integration ~200, docs ~20, spec ~15, SMELL-58 ~8) |
| 400-line budget risk    | Medium                                                                                                                                                                                                                     |
| Chained PRs recommended | No                                                                                                                                                                                                                         |
| Suggested split         | Single atomic PR (NOT-NULL column + guard flip + threading + billing fix ship together or dev boot / billing regress)                                                                                                      |
| Delivery strategy       | ask-on-risk                                                                                                                                                                                                                |
| Chain strategy          | size-exception (only if apply measures > 400)                                                                                                                                                                              |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

Rationale: near the 400 line. A NOT-NULL column with a flipped guard + the signed
billing rewrite are a single atomic invariant — cannot split across PRs without a live
IDOR or a broken create. The bulk of lines is the goldens-like integration suite (low
review risk). If apply measures > 400, take `size:exception`; do NOT split.

### Suggested Work Units

| Unit | Goal                                                                                                                              | Likely PR                        | Focused test command                                          | Runtime harness                      | Rollback boundary                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1    | Full slice (atomic): enroll `GeneratedImage` + create-ownership-before-AI + response strip + billing fix + two-tenant suite green | PR 1 (`size:exception` if > 400) | INT `tests/integration/generatedImageTenantIsolation.test.ts` | DBUP + two-tenant real-DB HTTP suite | revert branch pre-merge; post-merge `down.sql` drops RLS, remove guard entry, column additive/harmless |

## Phase 1: RED — unit tests (fast, no DB)

- [x] 1.1 [RED] `apps/api/tests/unit/security/tenantGuard.test.ts`: add `generatedImage` membership + where-injection (find/update/delete) + `create` injection + explicit-mismatch throw + missing-context (`TenantContextMissingError`) cases; assert `TENANT_SCOPED_MODELS` size **56** (RED until 3.1).
- [x] 1.2 [RED] `packages/core/ai-image/tests/unit/GenerateImageUseCase.test.ts`: ctor becomes `(repository, projectRepository, imageGenerator)`; mocked `ProjectRepositoryPort`; foreign/missing `projectId` → `err(NOT_FOUND)` with `imageGenerator.generateImage` AND `repository.save` NEVER called (spy sentinel); own project threads `project.accountId` onto saved DTO (per-row `accountId === project.accountId` invariant); empty-prompt regression still `VALIDATION_FAILED`.
- [x] 1.3 [RED] `apps/api/tests/unit/application/generateImageUseCase.test.ts`: same ctor + ownership + sentinel + threading deltas (duplicate suite site, verified in design D-file changes).
- [x] 1.4 Run VITEST-API 1.1/1.3 + VITEST-AI 1.2 — expect RED (compile/assert fail pre-flip).

## Phase 2: Schema + migrations (foundation) — [SENSITIVE] token REQUIRED

- [x] 2.1 [SENSITIVE] `infra/prisma/schema.prisma` (model @2462): add `accountId String` + `account Account @relation(..., onDelete: Cascade)` + `@@index([accountId, projectId])`; KEEP `@@index([projectId, createdAt])` (:2475); add back-relation `generatedImages GeneratedImage[]` on `Account`. No `@@unique` interplay.
- [x] 2.2 [SENSITIVE] Author **Migration A** `20260715…_add_generated_image_account_id/migration.sql` — Recipe A: `ADD COLUMN "accountId"` nullable → `UPDATE ... FROM "Project"` over NOT-NULL `projectId` FK → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT NULL` → FK to `Account` `ON DELETE CASCADE` → `CREATE INDEX` on `(accountId, projectId)`. Timestamp **> 20260714040300**.
- [x] 2.3 [SENSITIVE] Author **Migration B** `20260715…_add_rls_generated_image/{migration,down}.sql` — Recipe B: ENABLE RLS → `DROP POLICY IF EXISTS` → `CREATE POLICY tenant_isolation` on `app.account_id` GUC + `__system__` bypass (copied from `20260527000000`, NOT edited); `down.sql` drops the policy. Timestamp **> 2.2**.
- [x] 2.4 **Assert ordering**: A.timestamp < B.timestamp, both > `20260714040300` (B's `CREATE POLICY` references A's column). Column-before-RLS.
- [x] 2.5 CLIENT-REGEN — Prisma client regenerated so `accountId` is present in generated create/row types.
- [x] 2.6 DBUP then MIGRATE apply — assert both apply clean, zero NULL `accountId` (RAISE assert holds), row count preserved.

## Phase 3: Guard flip — [SENSITIVE] token REQUIRED → turns 1.1 GREEN

- [x] 3.1 [SENSITIVE] [GREEN] `infra/prisma/src/extensions/tenantGuard.ts`: insert `"generatedImage"` alphabetically between `"gatewaySwitchEvent"` (:115) and `"glossary"` (:116); header JSDoc count **55 → 56**. Run VITEST-API 1.1 → GREEN.

## Phase 4: GREEN — DTO threading + adapter

- [x] 4.1 [GREEN] `packages/core/domain/src/repositories/GeneratedImageRepository.ts`: add required `accountId: string` to `GeneratedImageData` (:13-23).
- [x] 4.2 [GREEN] `apps/api/src/infrastructure/repositories/PrismaGeneratedImageRepository.ts`: add `accountId: image.accountId` to `create.data` (:33-43) and `accountId: created.accountId` / `accountId: img.accountId` to BOTH output-mapping literals (save :46-56, findMany :80-91) — required by the now-mandatory DTO field.

## Phase 5: GREEN — use case (ownership BEFORE paid AI call) + DI → turns 1.2/1.3 GREEN

- [x] 5.1 [GREEN] `packages/core/ai-image/src/GenerateImageUseCase.ts`: ctor gains `projectRepository: ProjectRepositoryPort` (`@core/domain/repositories/ProjectRepository.js`) as **2nd** param (imageGenerator → 3rd). After prompt validation (:52) and BEFORE `imageGenerator.generateImage` (:57): parse `ProjectId.fromString(projectId)` (invalid → VALIDATION_FAILED), guarded `projectRepository.findById(projectId)` → foreign/missing → `err(USE_CASE_ERRORS.NOT_FOUND)`. Thread `accountId: project.accountId.toString()` into the `imageData` literal (:71-81). Zero AI spend, nothing persisted for a foreign project.
- [x] 5.2 [GREEN] `apps/api/src/infrastructure/container/setupAIImageUseCases.ts`: inject `TOKENS.ProjectRepository` (`types.ts:31`) as 2nd arg into `GenerateImageUseCase`. Run VITEST-AI 1.2 + VITEST-API 1.3 → GREEN.

## Phase 6: Route — 404 mapping + response strip + billing fix (D5, D6)

- [x] 6.1 [GREEN] `apps/api/src/ai-image/aiImageRoutes.ts:85`: add `NOT_FOUND → 404` to the error map (`VALIDATION_FAILED ? 400 : NOT_FOUND ? 404 : 500`) — never 403/500 (anti-enumeration).
- [x] 6.2 [GREEN] Strip `accountId` from responses: generate handler (single DTO, :96) `const { accountId: _a, ...rest } = result.value; sendSuccess(ctx, rest, 201)`; list handler (ARRAY, :130) `sendSuccess(ctx, result.value.map(({ accountId: _a, ...rest }) => rest))` — a literal destructure on the array would re-leak every element (D5 pin).
- [x] 6.3 [GREEN] Billing fix (D6, SIGNED): delete `accountId` from `GenerateImageBodySchema` (:23, + its JSDoc :22) and the `if (body.accountId)` gate (:90-94). Increment `aiCallsMade` UNCONDITIONALLY on success using `user.accountId` (`request.customerUser.accountId`, already null-checked :70-73) — best-effort `void ... .catch(() => void 0)`. `z.object` strips the now-unknown body `accountId` → old clients get no 400.

## Phase 7: RED→GREEN — two-tenant integration (MERGE-BLOCKING)

- [x] 7.1 Create `apps/api/tests/integration/generatedImageTenantIsolation.test.ts` (node:test, real DB, two tenants, in-process `app.inject`, guarded client wired like production; override `TOKENS.ImageGenerationPort` with a **sentinel spy fake**). Assert: (a) A `GET /ai/generated-images?projectId={B}` → **200 + []**, no B prompt/revisedPrompt/imageUrl in body; (b) A `POST /ai/generate-image` with B's projectId → **404 never 403/500**, AI sentinel NEVER invoked, ZERO rows persisted in B's project; (c) positive control: own generate → 201, sentinel fires, row `accountId == Project.accountId`; (d) EVERY response item (single generate + list array) carries **NO `accountId` key** (D5 pin); (e) billing: own generate WITHOUT body accountId → caller's `aiCallsMade` +1; body carrying a FOREIGN `accountId` → still 201, foreign tenant's `usageMetric` UNCHANGED, caller's incremented (unconditional-on-success); (f) no `TenantContextMissingError` on own flows; (g) NULL-accountId count = 0, row count preserved.
- [x] 7.2 Run INT `tests/integration/generatedImageTenantIsolation.test.ts` (DBUP first) — expect GREEN, 0 cancelled.

## Phase 8: Regression (SMELL-53) + docs + backlog + spec + 0-defect gate

- [x] 8.1 Regression: `rg -l "generatedImage|GeneratedImage|GenerateImageUseCase|ListGeneratedImagesQuery|GeneratedImageRepository|aiCallsMade|incrementUsage.*aiImage"` across `apps/api/tests packages/**/tests infra/prisma` — update ctor mocks + `accountId` fixtures; **NOTE: the billing semantic change (unconditional-on-success) may break an existing generate/route test asserting the opt-in increment** — update those assertions. RUN the FULL affected set (VITEST-API + VITEST-AI).
- [x] 8.2 Docs `docs/security/MULTI_TENANT_GUARDS.md`: enroll `GeneratedImage` (3-step canon checklist), bump guard/RLS counts, note create-ownership-before-paid-AI precedent. (spec Req-1/Req-2/Req-3 rows carried by the delta at `openspec/specs/multi-tenant-isolation/spec.md`.)
- [x] 8.3 Backlog `docs/reports/roadmap-detected-smells-backlog.md`: add **SMELL-58** — `GenerateImageUseCase` is a mutating use case that does NOT use UoW → RLS layer-2 inert on the create (layer-1 guard still protects it; ARCHITECTURE_CANON "every mutating use case MUST use UoW"). Pre-existing; retrofit UoW + adapter tx-join as canon-debt, OUT of this slice's isolation scope (D7).
- [x] 8.4 **0-defect gate (0/green)**: `tsc` (@apps/api, @core/ai-image, @core/domain, @infra/prisma client), `eslint --max-warnings 0` on all touched files, fitness **#21 = 0** + **#23 = 0**, migrations apply clean + backfill zero-NULLs, FULL affected test set + MERGE-BLOCKING integration suite green, 0 cancelled.
