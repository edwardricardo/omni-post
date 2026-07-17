# Proposal: GeneratedImage Tenant Guard (Slice 4)

## Intent

Slice 4 of the `project-scoped-tenant-guard` rollout. `GeneratedImage` (`schema.prisma:2462`) is `projectId`-only and enrolled in NEITHER isolation layer (absent from `TENANT_SCOPED_MODELS` — 55 models, `tenantGuard.ts:90-146` — and from RLS). LIVE cross-tenant IDOR (CWE-639): `GET /ai/generated-images?projectId={B}` returns tenant B's images to tenant A — prompt text, revised prompts, and image URLs leak (prompts routinely carry brand/business context). The generate path additionally plants rows into a foreign project. Apply the established Approach-A recipe.

## Verification (all orchestrator-brief claims checked at source)

| Claim                                                                 | Verdict                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean model: `projectId` NOT NULL, Cascade, no accountId, no children | CONFIRMED — `schema.prisma:2462-2476`; only other schema ref is the `Project` back-relation (`:639`). No soft-delete, no child/join tables                                                                                            |
| Generate + list are the ONLY routes                                   | CONFIRMED — `aiImageRoutes.ts:149,159`; DI tokens (`GeneratedImageRepository`, `GenerateImageUseCase`, `ListGeneratedImagesQuery_AIImage`) resolve nowhere else; `prisma.generatedImage.*` appears ONLY in the adapter (`:32`, `:74`) |
| Zero out-of-context callers; synchronous generate flow                | CONFIRMED — inventory below; the AI call is awaited in-request (`GenerateImageUseCase.ts:57`), no worker/queue path                                                                                                                   |
| Create path lacks projectId ownership check                           | CONFIRMED — `GenerateImageUseCase.ts:46-95` validates only prompt non-emptiness; route Zod validates UUID shape only                                                                                                                  |
| SURPRISE 1: route maps ownership NOT_FOUND to 500                     | `aiImageRoutes.ts:85` — `VALIDATION_FAILED ? 400 : 500`; Requirement 3's 404-never-403/500 needs an explicit mapping fix                                                                                                              |
| SURPRISE 2: client-supplied `accountId` in generate body              | `aiImageRoutes.ts:23,90-94` — optional body `accountId` drives the `aiCallsMade` usage increment (see Open Questions)                                                                                                                 |

## Route-surface audit (reads AND writes — obs 285 rule)

Both routes in `aiImageRoutes.ts`, both behind `requireClientAuth` → `enterTenantContext` (`customerAuthMiddleware.ts:70`):

| Route                              | Line | Data path                                                        | Status / gap class                                                                                                 |
| ---------------------------------- | ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| POST /ai/generate-image            | 149  | `GenerateImageUseCase` → AI provider call → `repo.save` (create) | Create-path ownership gap (client `projectId`) + NOT_FOUND→500 mapping gap; check must run BEFORE the paid AI call |
| GET /ai/generated-images?projectId | 159  | `ListGeneratedImagesQuery` → `findByProjectId` (trusts client)   | LIVE list IDOR → guard-natural close (foreign projectId → 200 + [])                                                |

No id-only routes, no update/delete surface, no join/child-table traversal (the obs-285 gap class does NOT apply — first slice where it is structurally absent).

## Out-of-tenant-context caller inventory (source-verified: EMPTY)

Search run: repo-wide grep `GeneratedImage|generatedImage` over `**/*.{ts,tsx,prisma}` (15 files, every one accounted: schema, generated API types, DI token/setup, routes, core use case/query/port/barrel, Prisma adapter, unit test, frontend HTTP consumers) + accessor grep `.generatedImage.` (adapter only). **Zero** references in `apps/workers`, seeds, scripts, or sagas; generate is synchronous. → NO `withSystemContext()` wraps needed. First slice since Slice 1 with a truly empty inventory.

## Scope

### In Scope

- Schema: `accountId` nullable ADD → backfill from `Project.accountId` over the NOT NULL `projectId` FK → assert 0 NULL → `SET NOT NULL` → `Account` relation (`onDelete: Cascade`) + `@@index([accountId, projectId])` (dominant guarded read is project-filtered; keep `@@index([projectId, createdAt])`).
- Guard flip: append `generatedImage` to `TENANT_SCOPED_MODELS` (55 → 56).
- NEW forward RLS migration pair (+down.sql), timestamps after the latest Slice-3 migration on `8bf3e7e2`, column-before-RLS.
- accountId threading: `GeneratedImageData` port DTO + Prisma adapter mapping.
- Create-path ownership: inject `ProjectRepositoryPort` into `GenerateImageUseCase` (Slice-2 pattern, `CreateCampaignUseCase.ts:38,66`); guarded `findById(projectId)` BEFORE the AI-provider call → NOT_FOUND on miss (no AI spend, no persist). Route error mapping: NOT_FOUND → 404 (never 403/500).
- Two-tenant real-DB integration suite covering BOTH routes: foreign generate → 404, no row persisted, AI port sentinel NOT invoked (+ positive control that the sentinel fires on own-project happy path); foreign-projectId list → 200 + []; own generate persists `accountId == project.accountId` (per-row invariant); no `TenantContextMissingError` on own flows. Guard unit tests for `generatedImage`.
- `MULTI_TENANT_GUARDS.md` enrollment docs (3-step canon checklist).

### Out of Scope

- Remaining rollout models (ProjectMember, Channel, Post); N-SEC-4; `IncrementUsageUseCase`/`usageMetric` internals (already enrolled); frontend `apps/client` AI-image consumers (HTTP-level, unaffected).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `multi-tenant-isolation`: append `GeneratedImage` rows to Requirement 1 (enrolled models) and Requirement 3 (create paths: `POST /ai/generate-image` → `GenerateImageUseCase`); add one model-scoped Requirement-2 block (foreign list returns empty — prompt/URL leak closed; foreign generate 404s before AI call and persist).

## Approach

Slice-1 recipe verbatim — no deltas needed (no secrets, no children, no out-of-context callers, no system-context wraps). Enablers verified: both routes bind tenant context; DI hands the guarded `TOKENS.PrismaClient` to the adapter; guard injects `accountId` on create and validates explicit mismatches.

## Affected Areas

| Area                                                                | Impact   | Description                                              |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `infra/prisma/schema.prisma` + 2 migrations (+down.sql)             | Mod/New  | accountId column + backfill; RLS policy — SENSITIVE      |
| `infra/prisma/src/extensions/tenantGuard.ts`                        | Modified | append `generatedImage` — SENSITIVE                      |
| `packages/core/domain/src/repositories/GeneratedImageRepository.ts` | Modified | accountId on `GeneratedImageData`                        |
| `packages/core/ai-image/src/GenerateImageUseCase.ts`                | Modified | project-ownership check before AI call; NOT_FOUND result |
| `apps/api/src/ai-image/aiImageRoutes.ts`                            | Modified | NOT_FOUND → 404 error mapping                            |
| `apps/api/src/infrastructure/{repositories,container}/**`           | Modified | adapter threading; DI injects ProjectRepositoryPort      |
| `apps/api/tests/{unit,integration}/**`                              | New/Mod  | guard unit + two-tenant suite (both routes)              |
| `docs/security/MULTI_TENANT_GUARDS.md`                              | Modified | enrollment docs                                          |

## Risks (overall: LOW — the clean slice)

| Risk                                                    | Likelihood     | Mitigation                                                                       |
| ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| Ownership rejection surfaces as 500 (route mapping gap) | Med if unfixed | Mapping fix in scope; integration test pins 404                                  |
| NOT NULL flip before new code boots → generate fails    | Low            | Migration + flip + code in SAME PR/deploy (single deployable)                    |
| Backfill misses rows                                    | Low            | `projectId` NOT NULL + FK → orphan-free; assert 0 NULL before flip               |
| Guard-flip regression on own flows                      | Low            | Both routes bind context; inventory empty; suite exercises own-tenant happy path |
| Migration timestamp collision with the stacked chain    | Low            | Timestamps after Slice-3's latest; column-before-RLS                             |

## Rollback

Revert branch (no merge until green). Post-merge: down.sql drops the RLS policy; remove `generatedImage` from `TENANT_SCOPED_MODELS`; `accountId` column is additive/harmless and removable by a later down migration. No data loss.

## Dependencies

- Stacked on `workstream/cluster-c-recurringpost-trackedlink-guard` @ `8bf3e7e2` (guard = 55). New branch: `workstream/cluster-c-generatedimage-guard`.
- `omnipost-allow sensitive-edit` token at APPLY (`infra/prisma/**`); `pnpm db:up` for migration + integration tests.
- Delivery: single atomic PR (migration + flip + code + tests are one deploy unit), `size:exception` if > 400 changed lines.

## Success Criteria

- [ ] Three legs present (static): schema accountId NOT NULL + relation + accountId-led index; `generatedImage` in guard set; RLS policy.
- [ ] Two-tenant suite green over BOTH routes: foreign list → 200 + []; foreign generate → 404 (never 403/500), zero rows persisted, AI sentinel not invoked (with positive control); own generate → `accountId == project.accountId`.
- [ ] Zero NULL `accountId` post-backfill; row counts preserved.
- [ ] 0-defect gate (tsc, eslint --max-warnings 0, fitness #21/#23, full regression).

## Open Questions (proposal question round)

1. **Client-supplied `accountId` in the generate body** (`aiImageRoutes.ts:23,90-94`): the optional body field drives the `aiCallsMade` usage increment. `usageMetric` is guard-enrolled, so a foreign increment is defused only INDIRECTLY (composite-unique `where` nests `accountId` out of the guard's mismatch check; the create branch then throws, swallowed by the best-effort catch). The clean fix — derive `accountId` from the authenticated context — changes billing semantics (counter would ALWAYS increment, today it increments only when the client sends the field). Product call: fix in-slice or backlog? **Recommendation: backlog (SMELL entry)** — it is `usageMetric`-adjacent, not a GeneratedImage isolation gap, and the semantic change deserves its own review.
2. No other open questions — assumptions otherwise match the signed rollout recipe (Approach A, 404-anti-enumeration, per-row consistency invariant, all-routes coverage).
