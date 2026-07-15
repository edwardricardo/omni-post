# Design: RecurringPost + TrackedLink Tenant Guard (Slice 3)

## Technical Approach

Apply the Slice-1/2 Approach-A recipe to `RecurringPost` and `TrackedLink` in ONE change: per model an ordered column/backfill + RLS migration pair, guard-list enrollment (53 → 55), explicit `accountId` threading, and create-path parent-ownership assertions. Slice 3 additionally ESTABLISHES the rollout's first three `withSystemContext()` wraps — the public redirect, the recurrence sweep, and the short-code uniqueness probe — all genuine out-of-tenant-context callers verified at source. The public redirect (`GET /r/:shortCode`) is a DELIBERATE, canon-verified guard bypass (engram obs 297) shipping WITH a mandatory compensating control: namespace-keyed rate limiting, absent today. Stacked on the Slice-2 branch (guard=53, migrations through `20260714030300`).

## Architecture Decisions

### D1 — Four migrations, per-model pairs, order-asserted, timestamps > `20260714030300`

**Choice**: `add_recurring_post_account_id` → `add_rls_recurring_post` → `add_tracked_link_account_id` → `add_rls_tracked_link`. Column SQL copies the reference shape (ADD nullable → `UPDATE ... FROM "Project"` over NOT-NULL `projectId` FK → in-tx `RAISE EXCEPTION` on residual NULL → `SET NOT NULL` → FK Cascade → index); RLS SQL copies the `tenant_isolation` policy (`app.account_id` GUC + `__system__` bypass) + `down.sql`. Assert every timestamp > `20260714030300` and each column migration lexicographically before its RLS migration.
**Verified**: both models have NOT-NULL `projectId` and no soft-delete column (schema.prisma:2475, :806) — the backfill JOIN is orphan-free by construction; no recipe adaptation.
**Index**: `@@index([accountId, projectId])` on BOTH (dominant guarded read is project-filtered: `findByProjectId`). Existing `@@index([projectId, isActive])` fronts projectId reads; the composite satisfies spec Req-1's accountId-led rule. TrackedLink keeps `shortCode @unique` GLOBAL (cross-tenant) intentionally — that global namespace IS what the public redirect resolves against (D6). **Note (verified `schema.prisma:808-809`)**: ONLY `shortCode` is `@unique`; `vanitySlug` is `String?` with a plain `@@index([vanitySlug])` — the entropy/collision consequence is scoped in D7.

### D2 — accountId threading diverges by persistence style (source-verified)

**D2a — TrackedLink = entity-carried** (Slice-2 style). `TrackedLink` is a rich entity persisted via getters in a hand-rolled `findUnique`→`create`/`update` adapter (`PrismaTrackedLinkRepository.save:59`). Add `accountId` to `TrackedLinkProps` / create factory / getter / `fromPersistence`; adapter `create` branch + `toDomain` carry it. The `update` branch never touches `accountId`.
**D2b — RecurringPost = DTO-carried, entity round-trip, AND create-factory threaded** (divergence from the brief's "mirror Slice 2"). The repo contract is a FLAT `RecurringPostData` DTO, not a rich entity (`RecurringPostRepository.save(post: RecurringPostData)`), persisted via `upsert` (`PrismaRecurringPostRepository:53`). Once `accountId` is required on `RecurringPostProps`, the FULL compile-time threading surface (all sites re-verified at source) is:

- **Entity / factory**: add `accountId` to `RecurringPostProps` (:131), to `RecurringPostCreateProps` (:152, currently MISSING it), to the `create()` internal `new RecurringPost({...})` literal (:275), and a getter; `fromPersistence` flows it through. **Without the `CreateProps`+`create()` extension, `new RecurringPost({...})` will NOT type-check and there is no path to feed `project.accountId` into a newly created recurrence** — the exact fix D2a made for TrackedLink but the first draft dropped here.
- **Data DTO + adapter**: add `accountId` to `RecurringPostData`, `PrismaRecurringPostRow`, `toData`, and the `upsert.create` branch.
- **FOUR save-literal sites** each add `accountId: entity.accountId` — `CreateRecurringPostUseCase:115`, `UpdateRecurringPostUseCase:135`, `ProcessRecurrenceUseCase:126`, `DeactivateRecurringPostUseCase:82`.
- **THREE `fromPersistence` sites** each pass `accountId: data.accountId` — `Update:85`, `Process:96`, `Deactivate:57`.

`CreateRecurringPostUseCase` threads the guard-resolved `project.accountId` (D3) into `RecurringPost.create({ ..., accountId })`; the three reconstitute→re-save use cases round-trip it. Runtime guard injection cannot satisfy tsc once the column is NOT NULL (the D2 lesson). Client-facing `toJSON()`/output DTOs stay unchanged — `accountId` is never client-supplied or exposed.

### D3 — Create-path ownership: TrackedLink single, RecurringPost TRIPLE

**TrackedLink**: inject `ProjectRepositoryPort` into `CreateTrackedLinkUseCase`; guarded `findById(projectId)` (foreign → `EntityNotFoundError`); thread `project.accountId`.
**RecurringPost — three foreign parent refs** (`projectId` + `templatePostId` + `channels[]`, verified `CreateRecurringPostUseCase.ts:83`, unvalidated). Inject `ProjectRepositoryPort` + `PostRepository` + `ChannelRepository`: (1) guarded `projectRepository.findById(projectId)` → own `accountId` (THIS is guard-scoping); (2) `postRepository.findById(templatePostId)` then assert `post.projectId === projectId`; (3) per channel assert `channel.projectId === projectId`. Any foreign/missing ref → `err(NOT_FOUND)` BEFORE `doWork`.
**Rationale**: `Post`/`Channel` are UNENROLLED (later slices), so their `findById` is NOT guard-scoped — the child controls are app-level **project-consistency** checks against the already-guard-validated `projectId`, which is sufficient because a confirmed-own project's children are transitively own. This closes the two escalations: foreign `templatePostId` → content-exfil clone (`CreatePostFromRecurrenceUseCase:116`); foreign `channels[]` → cross-tenant publish targeting. The PATCH channel-repoint path applies the same channel-consistency assertion.

### D3a — 404-not-500 conformance (verified route deltas)

`linkRoutes.createLink:85` ALREADY maps `NOT_FOUND → 404` — no route change. `recurringPostRoutes.create:107` maps only `VALIDATION_FAILED?400:500` — **add a `NOT_FOUND → 404` branch**, else the ownership probe 500s (conformance failure). The MERGE-BLOCKING suite asserts foreign create → 404 never 403/500.

### D4 — Guard enrollment 53 → 55

Append `"recurringPost"` and `"trackedLink"` alphabetically to `TENANT_SCOPED_MODELS`; header JSDoc 53 → 55. `LinkClick` stays OUT (no `accountId`; gated transitively via guarded parent lookups — same policy as `campaignPost`).

### D5 — Child/join gap: stats is SUITE-PINNED, not a code change (verified)

`GetLinkStatsUseCase:30` ALREADY resolves `repository.findById(linkId)` BEFORE `getClickStats` → `linkClick.findMany` (`repo:214`). Once `trackedLink` is enrolled, foreign `findById` → `NOT_FOUND` → the child-table traversal never runs. DELETE is likewise gated (`repo.delete:148` does `findUnique` first). **No code change** — but the suite MUST pin `GET :id/stats` with a foreign id (positive exfil-sentinel control). RecurringPost has no join/child-table traversal on its own routes → N/A.

### D6 — Public redirect: deliberate system-context bypass (FIRST of the rollout)

Wrap the redirect use-case call in the route handler: `withSystemContext("public-link-redirect", () => this.redirectAndTrackClickUseCase.execute(...))` (handler is apps/api; core cannot import the wrap). Covers `findByShortCode` AND the fire-and-forget `recordClick`'s guarded `trackedLink.update` (ALS store is captured at call time and propagates to the non-awaited continuation).
**Justification (inline, cite obs 297)**: OWASP A01:2025 exempts public resources from deny-by-default; the shortCode is a global-namespace CAPABILITY TOKEN served to anonymous visitors. Without the wrap the guard flip throws `TenantContextMissingError` on EVERY published short link. The redirect response is `302 → originalUrl` ONLY (verified `linkRoutes.ts:208`) — zero tenant/accountId/analytics leakage (control #5 satisfied, the one that decides it is NOT IDOR). The management surface (create/get/stats/delete/utm) stays 100% tenant-scoped.

### D7 — MANDATORY compensating control: namespace-keyed rate limit on `/r/:shortCode`

**Choice**: a dedicated route-scoped preHandler on `/r/:shortCode` that consumes from the `RateLimiterPort` token bucket keyed by `redirect:{clientIp}` — a NAMESPACE key, NOT the global limiter's `ip:url` key.
**Rationale (verified flaw)**: the existing global `createHttpRateLimitPreHandler` keys buckets by `ip:req.url` (`httpRateLimitPreHandler.ts:132`). Enumeration hits a DIFFERENT url per shortCode → a fresh 100/min bucket each → the global limiter does NOT throttle namespace enumeration (canon control #1, obs 297, is namespace-level). A dedicated IP-namespace bucket makes ALL `/r/*` hits from one IP share one bucket → true anti-enumeration. Add a `REDIRECT` preset (e.g. 60/min); resolve `TOKENS.HttpRateLimiter` in the linkRoutes plugin and attach the preHandler to the `/r/:shortCode` registration only.
**Sizing (auto-generated shortCodes ONLY)**: obs 297 REFUTED any fixed entropy floor — dimension against the limit. The AUTO-GENERATED shortCode keyspace is ~7.2e13 (46 bits, `randomInt` CSPRNG, verified `ShortCode.ts`); at ≤60/min/IP a brute-force is astronomically infeasible, so a modest cap is defensible. **The entropy argument does NOT extend to user-chosen `vanitySlug`s** (min 3 chars, guessable): vanity slugs are a first-come GLOBAL public namespace whose unguessability is NOT guaranteed. That is acceptable because the redirect leaks nothing (302 → destination only, D6); the namespace rate limit is the anti-enumeration control for BOTH code classes. Response leaks nothing (D6).
**Known pre-existing issue (out of tenant-guard scope → backlog SMELL-57)**: `vanitySlug` has NO global unique constraint (`schema.prisma:809`), yet `findByShortCode` and `isShortCodeAvailable` resolve `OR:[{shortCode},{vanitySlug}]` (`PrismaTrackedLinkRepository:106-110,236-241`). Two tenants CAN register the same vanitySlug → the public redirect resolves it nondeterministically (`findFirst`), and `isShortCodeAvailable` has a check-then-insert TOCTOU with no DB constraint to catch a vanity collision. The guard flip does NOT worsen this (pre-existing, unrelated to tenant isolation). A proper fix needs a global `@@unique` on `vanitySlug` PLUS a dedup migration — OUT of this slice's tenant-guard scope. Documented + backlogged as **SMELL-57** (next id after the SMELL-53..56 tenant-guard deferrals); NOT fixed here.

### D8 — Remaining out-of-context callers

- **RecurrenceScheduler.tick** → wrap the body in `withSystemContext("recurrence-sweep")` (scheduler is apps/api; `RecurrenceScheduler.ts:74`). The sweep's `findActiveByNextScheduled` is cross-account by design. NOTE: the template-clone exfil is closed at CREATE (D3), NOT by this wrap — the wrap only prevents `TenantContextMissingError` on the tick.
- **isShortCodeAvailable probe** → wrap the query INSIDE the adapter method `PrismaTrackedLinkRepository.isShortCodeAvailable` in `withSystemContext("shortcode-uniqueness-probe")` (adapter is apps/api; core use case cannot import the wrap). Under the caller's tenant context the guarded `findFirst` would miss foreign codes → false-available → P2002 500. System context restores the GLOBAL uniqueness semantics the public namespace requires. Returns a boolean only — zero data exposure.

### D9 — TrackedLink #109 divergence fold-in (implementation-agnostic)

The app-level `trackedlink-idor-fix` (PR #109) is NOT on this chain — read/delete IDOR is LIVE here (`PrismaTrackedLinkRepository.findById:90`/`delete:148` use UNSCOPED `findUnique`, zero `requireTenantContext`). The STRUCTURAL guard supersedes it. If #109 arrives via rebase/merge: keep the guard authoritative, simplify redundant app-level scoping on `findById`/`delete`, preserve anti-enumeration (foreign == nonexistent == 404). **CRITICAL reconciliation invariant**: `findByShortCode` MUST remain guard-BYPASSED (system context, D6) — if #109 added `requireTenantContext` to it, the public redirect breaks; the fold-in must exclude the public path from tenant scoping. Merge-conflict risk is confined to `PrismaTrackedLinkRepository.ts`; the two-tenant suite is implementation-agnostic and remains the arbiter.

## Data Flow

    Create (both) ─→ CreateXUseCase
       ─→ projectRepository.findById(projectId)     [guarded: foreign → NOT_FOUND → 404]
       ─→ (RecurringPost) post.projectId === projectId AND ∀ channel.projectId === projectId  [else NOT_FOUND]
       ─→ thread accountId = project.accountId       [parent-consistent by construction]
       ─→ UoW tx ─→ save (create carries accountId)  [layer 1 guard · layer 2 RLS WITH CHECK]

    Redirect (public, anonymous) ─→ [rate-limit preHandler: redirect:{ip} bucket]
       ─→ withSystemContext("public-link-redirect")
             ─→ findByShortCode (guard bypassed) ─→ recordClick (bypass propagates)
       ─→ 302 → originalUrl ONLY   [no tenant/analytics leakage]

## File Changes

| File                                                                                 | Action                 | Description                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                                         | Modify — **SENSITIVE** | Both models: `accountId String` + `account Account @relation(onDelete: Cascade)` + `@@index([accountId, projectId])`; `Account` back-relations `recurringPosts`, `trackedLinks`                          |
| `infra/prisma/migrations/20260714040000_add_recurring_post_account_id/migration.sql` | Create — **SENSITIVE** | Recipe A (column/backfill/assert/NOT NULL/FK/index)                                                                                                                                                      |
| `infra/prisma/migrations/20260714040100_add_rls_recurring_post/{migration,down}.sql` | Create — **SENSITIVE** | Recipe B (RLS policy + down.sql)                                                                                                                                                                         |
| `infra/prisma/migrations/20260714040200_add_tracked_link_account_id/migration.sql`   | Create — **SENSITIVE** | Recipe A for TrackedLink                                                                                                                                                                                 |
| `infra/prisma/migrations/20260714040300_add_rls_tracked_link/{migration,down}.sql`   | Create — **SENSITIVE** | Recipe B for TrackedLink                                                                                                                                                                                 |
| `infra/prisma/src/extensions/tenantGuard.ts`                                         | Modify — **SENSITIVE** | Append `recurringPost`, `trackedLink`; count 53 → 55                                                                                                                                                     |
| `packages/core/domain/src/entities/RecurringPost.ts`                                 | Modify                 | `accountId` in `RecurringPostProps` + `RecurringPostCreateProps` + `create()` literal (:275) + getter + `fromPersistence` (D2b — factory threading, NOT just round-trip)                                 |
| `packages/core/domain/src/repositories/RecurringPostRepository.ts`                   | Modify                 | `RecurringPostData.accountId`                                                                                                                                                                            |
| `packages/core/domain/src/entities/TrackedLink.ts`                                   | Modify                 | `accountId` in props/create/getter/`fromPersistence` (D2a)                                                                                                                                               |
| `packages/core/recurring/src/CreateRecurringPostUseCase.ts`                          | Modify                 | Triple ownership (project guarded + template/channel consistency); thread `project.accountId` into `create()` + save literal (:115); ctor gains `ProjectRepository`+`PostRepository`+`ChannelRepository` |
| `packages/core/recurring/src/UpdateRecurringPostUseCase.ts`                          | Modify                 | Channel-repoint consistency check; round-trip `accountId` (`fromPersistence:85` + save literal `:135`)                                                                                                   |
| `packages/core/recurring/src/ProcessRecurrenceUseCase.ts`                            | Modify                 | Round-trip `accountId` — sweep reconstitute→re-save (`fromPersistence:96` + save literal `:126`)                                                                                                         |
| `packages/core/recurring/src/DeactivateRecurringPostUseCase.ts`                      | Modify                 | Round-trip `accountId` — reconstitute→re-save (`fromPersistence:57` + save literal `:82`)                                                                                                                |
| `packages/core/links/src/CreateTrackedLinkUseCase.ts`                                | Modify                 | Project ownership + threading; ctor gains `ProjectRepository`                                                                                                                                            |
| `apps/api/src/infrastructure/repositories/PrismaRecurringPostRepository.ts`          | Modify                 | Row iface + `toData` + `upsert.create` carry `accountId`                                                                                                                                                 |
| `apps/api/src/infrastructure/repositories/PrismaTrackedLinkRepository.ts`            | Modify                 | `create` + `toDomain` carry `accountId`; `isShortCodeAvailable` wrapped in `withSystemContext` (D8)                                                                                                      |
| `apps/api/src/links/linkRoutes.ts`                                                   | Modify — **SENSITIVE** | Redirect wrapped in `withSystemContext` (D6); resolve `HttpRateLimiter` + attach namespace rate-limit preHandler on `/r/:shortCode` (D7)                                                                 |
| `apps/api/src/security/httpRateLimitPreHandler.ts`                                   | Modify — **SENSITIVE** | Add `REDIRECT` preset (D7)                                                                                                                                                                               |
| `apps/api/src/recurring/recurringPostRoutes.ts`                                      | Modify                 | Create handler: add `NOT_FOUND → 404` branch (D3a)                                                                                                                                                       |
| `apps/api/src/recurring/RecurrenceScheduler.ts`                                      | Modify                 | `tick()` body wrapped in `withSystemContext("recurrence-sweep")` (D8)                                                                                                                                    |
| `apps/api/src/infrastructure/container/setupLinkUseCases.ts`                         | Modify                 | Inject `ProjectRepository` into Create                                                                                                                                                                   |
| `apps/api/src/infrastructure/container/setupRecurringPostUseCases.ts`                | Modify                 | Inject `ProjectRepository`+`PostRepository`+`ChannelRepository` into Create                                                                                                                              |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                                   | Modify                 | Enrollment + inject/validate/missing-context for both models                                                                                                                                             |
| `apps/api/tests/unit/application/*` (recurring, links create)                        | Modify                 | Ctor updates; foreign-ref → NOT_FOUND; threading                                                                                                                                                         |
| `apps/api/tests/integration/recurringPostTenantIsolation.test.ts`                    | Create                 | Two-tenant suite, all 5 routes                                                                                                                                                                           |
| `apps/api/tests/integration/trackedLinkTenantIsolation.test.ts`                      | Create                 | Two-tenant suite, all 7 routes incl. redirect + rate-limit                                                                                                                                               |
| `openspec/specs/multi-tenant-isolation/spec.md`                                      | Modify                 | Req-1/Req-3 rows + 2 Req-2 blocks + system-context precedent under "No caller regression"                                                                                                                |
| `docs/security/MULTI_TENANT_GUARDS.md`                                               | Modify                 | Enroll both; document the `withSystemContext` precedent + redirect rate-limit control                                                                                                                    |

## Interfaces / Contracts

```typescript
// RecurringPost: DTO + entity both carry accountId (D2b)
interface RecurringPostData { accountId: string; /* ...existing */ }
interface RecurringPostProps extends EntityProps { accountId: string; /* ... */ }

// CreateRecurringPostUseCase ctor delta (UoW stays last)
constructor(
  recurringPostRepo: RecurringPostRepository,
  projectRepository: ProjectRepositoryPort,   // guarded ownership
  postRepository: PostRepository,             // template consistency
  channelRepository: ChannelRepository,       // channel consistency
  unitOfWork?: UnitOfWork
)
```

## Testing Strategy

| Layer                                        | What to Test                                                                                                                                                                                                                                                                                                                                                                             | Approach                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit (vitest)                                | Guard decision matrix for `recurringPost` + `trackedLink`; Create: foreign project → NOT_FOUND (both); foreign templatePostId / foreign channel → NOT_FOUND (recurring); own refs thread `accountId`                                                                                                                                                                                     | Mock ports; `tenantGuardCheck` (no Prisma)                     |
| Integration — RecurringPost (MERGE-BLOCKING) | Cross-tenant get/list/patch/deactivate → 404/empty; foreign create refs (project, templatePostId, channels[]) → **404 never 403/500**; own create persists `accountId == Project.accountId`; scheduler `tick()` completes under system context (no `TenantContextMissingError`); zero NULL + row count preserved                                                                         | node:test, real DB, two tenants                                |
| Integration — TrackedLink (MERGE-BLOCKING)   | Cross-tenant get/delete/utm → 404; **`GET :id/stats` foreign → 404 before any `linkClick` read** (child-table sentinel, D5); foreign create projectId → 404; anonymous `/r/:shortCode` still 302 + records click (positive control); **redirect response body carries NO tenant/accountId/analytics** (leaks-nothing); **namespace rate-limit engages after N `/r/*` from one IP → 429** | node:test, real DB, two tenants + anonymous                    |
| Gate                                         | 0-defect                                                                                                                                                                                                                                                                                                                                                                                 | tsc, eslint --max-warnings 0, fitness #21/#23, full regression |

## Threat Matrix

The git/shell/subprocess/PR/executable-classification rows are **N/A** — no VCS automation, no shell/subprocess, no executable-file classification. The change DOES introduce a routing/authorization boundary (a public unauthenticated redirect under a deliberate guard bypass), captured below:

| Boundary                      | Adversarial case                                                 | Applicability | Design response                                                                                         | Planned RED test                              |
| ----------------------------- | ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Public redirect authZ bypass  | Anonymous `GET /r/:shortCode` after guard flip                   | Applicable    | `withSystemContext("public-link-redirect")` read-path only; management surface stays tenant-scoped (D6) | Anonymous redirect → 302 + click recorded     |
| Namespace enumeration         | Attacker sweeps shortCode space from one IP                      | Applicable    | IP-namespace token bucket, NOT `ip:url` (D7)                                                            | N `/r/*` from one IP → 429                    |
| Redirect data leakage         | Response reveals tenant/analytics/accountId                      | Applicable    | 302 → `originalUrl` only; body asserted empty of tenant data (D6)                                       | Redirect body carries no tenant identifier    |
| Cross-tenant clone via create | Foreign `templatePostId`/`channels[]` persisted, cloned by sweep | Applicable    | Create-path project-consistency checks → NOT_FOUND before persist (D3)                                  | Foreign template/channel create → 404, no row |

Every Applicable row carries its case unchanged into `tasks.md` as a RED test.

## Migration / Rollout

Single atomic PR, `size:exception` (migration + guard flip + wraps + rate-limit + tests are one deploy unit). Single-deployable target: `nullable → backfill → SET NOT NULL` is downtime-safe here (Slice-1 caveat inherited; a rolling deploy would need the nullable-through-rollout variant). `pnpm db:up` + `omnipost-allow sensitive-edit` at apply. Rollback: revert branch pre-merge; post-merge run per-model `down.sql` (drop policy, disable RLS), drop columns, remove both guard entries; wraps + rate-limit are harmless without the flip.

## Open Questions

- [ ] **Redirect rate-limit cap** — design proposes ≤60/min/IP on the `/r` namespace; exact preset value is a product/security tuning call (obs 297 refuted any fixed floor; dimension against the ~46-bit keyspace). Non-blocking.
- [ ] **#109 rebase vs merge-time reconciliation** — orchestrator verifies `origin/main` before apply; the fold-in (D9) covers either path. Non-blocking.
