# Apply Progress — implementation-plan-revalidation

## Phase A · A1 — §2A Multi-tenant IDOR cluster (slice: IDOR-POSTS fix + cluster verification)

**Mode**: Strict TDD. **Branch**: `workstream/impl-revalidation`. **Budget**: this slice ≤~400 changed lines (held). No git ops performed (orchestrator commits + opens cluster PR).

### Completed

- [x] **1.1 — IDOR-POSTS FIXED (CONFIRMED defect closed)** via canon path (RED→GREEN→REFACTOR).
  - Use-case boundary owner gate (`DeletePostUseCase`): resolves owner via existing `postRepository.findOwnerAccountId(postId)`, rejects foreign caller with NOT_FOUND (anti-enumeration), mirroring the established `UpdatePostUseCase` pattern.
  - Query-repo joined filter (`GetPostUseCase`, `GetPostWithThreadQuery`, `ListPostsUseCase`, `ListPostsGlobalQuery`): thread optional `callerAccountId`; `PrismaPostQueryRepository` adds `where: { project: { accountId } }` (Post is transitively tenant-scoped via FK→Project, so `$extends` cannot auto-inject — MULTI_TENANT_GUARDS §Transitively-scoped).
  - Route (`postRoutes.ts`): `deletePost`, `getPost`, `listPosts` (project-scoped + global) now pass `customerUser.accountId`. The batch + update routes already threaded it.
- [x] **1.2 — IDOR-ACCOUNTS verified → CONFIRMED** (fix deferred).
- [x] **1.3 — IDOR-ANALYTICS verified → REFUTED / not-a-defect** (ownership gate present; residual purity smell is non-IDOR).
- [x] **1.4 — IDOR-COMMENTS / -NOTIFICATIONS / -RECURRING verified → CONFIRMED; -SCHEDULEDREPORT refuted at route boundary; -TRACKEDLINK unresolved (no surface found)** (fixes deferred).

### Per-lead verdicts (evidence)

| Lead                 | Verdict                  | Evidence                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR-POSTS           | CONFIRMED → **FIXED**    | `DeletePostUseCase.execute({postId})` had no `callerAccountId`; `PrismaPostQueryRepository.getById/getByIdWithThread/listByProject/listGlobal` had no `project.accountId` join; `listGlobal` enumerated all tenants. Route `requireClientAuth` gate evaporated at the use-case boundary. |
| IDOR-ACCOUNTS        | CONFIRMED (deferred)     | accountRoutes.ts L150-151/L241-242 lookup by URL `accountId` with no token-vs-URL check; L188 `listAccounts` unfiltered; L252-253 `maxProjects` from body = quota tamper. Route uses injected `this.prisma` directly.                                                                    |
| IDOR-ANALYTICS       | REFUTED (not-a-defect)   | analyticsRoutes.ts L1025 has `requireClientAuth`; L931-934 `getProjectAccess(user.accountId, projectId)` → 403; client `accountId` stripped (L87-89). No `getDashboard`; prisma DI-injected. Residual = read-not-via-query-port smell (NON-IDOR).                                        |
| IDOR-COMMENTS        | CONFIRMED (deferred)     | commentRoutes.ts L97 `authorId: body.authorId`, L183 `editorId: editBody.editorId`; `request.customerUser` (L89/L175) read but ignored = identity spoof.                                                                                                                                 |
| IDOR-NOTIFICATIONS   | CONFIRMED (deferred)     | notificationRoutes.ts L218/L246 `createNotification` takes body `recipientId` under `requireClientAuth` (not admin) = arbitrary recipient. User-facing mark-read handlers SAFE (`recipientId: user.id`, L109/L141/L191).                                                                 |
| IDOR-RECURRING       | CONFIRMED (deferred)     | recurringPostRoutes.ts L94 create body `projectId`, L135 list query `projectId`, L166 getOne raw `id` — none gated by `user.accountId` (contrast analytics `getProjectAccess`).                                                                                                          |
| IDOR-SCHEDULEDREPORT | REFUTED (route boundary) | customReportRoutes.ts threads token `accountId` via `getAccountId(request)` on all handlers incl. get/update/delete by `:id`; recipients stored on accountId-owned report. Confirm repo-level filter in own slice.                                                                       |
| IDOR-TRACKEDLINK     | UNRESOLVED               | no `tracked-link` route surface found in `apps/api/src`; needs deeper search (link-in-bio / campaign routes) before a verdict.                                                                                                                                                           |

### Files changed

| File                                                                    | Action   | What                                                                                                                 |
| ----------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/core/posts/src/DeletePostUseCase.ts`                          | Modified | `callerAccountId?` on input; owner gate via `findOwnerAccountId` → NOT_FOUND.                                        |
| `packages/core/posts/src/GetPostUseCase.ts`                             | Modified | `callerAccountId?`; thread `AccountId` to `getById`.                                                                 |
| `packages/core/posts/src/GetPostWithThreadQuery.ts`                     | Modified | `callerAccountId?`; thread to `getByIdWithThread`.                                                                   |
| `packages/core/posts/src/ListPostsUseCase.ts`                           | Modified | `callerAccountId?`; conditional 5th arg to `listByProject` (preserves 4-arg call for admin/internal).                |
| `packages/core/posts/src/ListPostsGlobalQuery.ts`                       | Modified | `callerAccountId?`; conditional 3rd arg to `listGlobal`.                                                             |
| `packages/core/domain/src/repositories/PostRepository.ts`               | Modified | `PostQueryRepository` reads accept optional `callerAccountId?: AccountId`.                                           |
| `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts` | Modified | `project: { accountId }` joined filter on getById/getByIdWithThread/listByProject (via buildWhereClause)/listGlobal. |
| `apps/api/src/posts/postRoutes.ts`                                      | Modified | delete/get/list/global pass `customerUser.accountId`.                                                                |
| `apps/api/tests/unit/application/postUseCasesTenantIsolation.test.ts`   | Created  | 10 cross-tenant denial tests (RED→GREEN) for the 5 use cases.                                                        |
| `apps/api/tests/unit/infrastructure/PrismaPostQueryRepository.test.ts`  | Modified | +6 joined-filter assertion tests (where.project.accountId present/absent).                                           |

### TDD Cycle Evidence

| Task          | Test File                             | Layer | Safety Net | RED                 | GREEN    | TRIANGULATE            | REFACTOR                             |
| ------------- | ------------------------------------- | ----- | ---------- | ------------------- | -------- | ---------------------- | ------------------------------------ |
| 1.1 use cases | `postUseCasesTenantIsolation.test.ts` | Unit  | N/A (new)  | ✅ 6 failed pre-fix | ✅ 10/10 | ✅ deny + allow per UC | ➖ matched UpdatePostUseCase pattern |
| 1.1 adapter   | `PrismaPostQueryRepository.test.ts`   | Unit  | ✅ 31/31   | ✅ Written          | ✅ 37/37 | ✅ present + absent    | ➖ none needed                       |

### Targeted verify (LXC-safe, all green)

- `vitest postUseCasesTenantIsolation.test.ts` → 10 passed
- `vitest postUseCases.test.ts` (regression) → 40 passed
- `vitest PrismaPostQueryRepository.test.ts` → 37 passed
- 3-file combined run → 87 passed
- `@core/posts test` → 6 passed
- typecheck `@core/domain` → 0; `@core/posts` → 0; `@apps/api` → 0 (heap 5.5GB; OOMs at 3GB — env constraint, not a type error)
- `eslint --max-warnings 0` on all 10 changed files → 0
- fitness greps on changed files: #1 (no prisma in routes)=0, #3 (no `any`)=0, #9 (@file)=present, #10 (@layer valid)=0

### Deferred to follow-up slice(s)

- **1.7 §2G CI gate** (CI-GAP-INTEGRATION + CI-GAP-RLS) — separate task per orchestrator instruction.
- **1.8 integration regression tests** (node:test, real DB+Redis, cross-tenant → 403/404) — this slice shipped unit-level RED→GREEN; integration net pairs with §2G.
- **IDOR-TRACKEDLINK** route-surface search.
- **IDOR-SCHEDULEDREPORT** repo-level accountId filter confirmation.
- Non-IDOR analytics purity smell (read via injected `this.prisma` instead of a query port) → §1 hexagonal cleanup.

---

## Phase A · A1 — §2A IDOR cluster (slice 2: fix the 4 CONFIRMED defects)

**Mode**: Strict TDD (RED→GREEN). **Branch**: `workstream/impl-revalidation`. No git ops (orchestrator commits + opens PR). Reference template: IDOR-POSTS fix `acb25880`.

### Completed — 1.5/1.6 fixes (all 4 CONFIRMED IDOR defects closed)

| Defect             | Verdict | Mechanism                                                                                                                                                                                                                                                                                                   | Tests                                                                                                       |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| IDOR-RECURRING     | FIXED   | Transitively scoped (FK→Project; `recurringPost` not in `TENANT_SCOPED_MODELS`). `callerAccountId?` on Get/List/Update/Deactivate; `findOwnerAccountId` + `findByProjectId(callerAccountId?)` joined filter; route threads `user.accountId` on list/getOne/update/deactivate. CREATE = documented residual. | `recurringPostUseCasesTenantIsolation.test.ts` 8 (RED→GREEN) + `recurringPostUseCases.test.ts` 9 regression |
| IDOR-COMMENTS      | FIXED   | Identity spoof (not relation-join). Dropped `authorId`/`editorId` from body schemas; route uses `user.id` (token). Domain author-only invariant now enforced.                                                                                                                                               | NEW `commentRoutesIdentityIsolation.test.ts` 3 + existing `commentRoutes.test.ts` 13 (1 fixed)              |
| IDOR-NOTIFICATIONS | FIXED   | Recipient injection. `callerAccountId?` on `CreateNotificationUseCase` + `NotificationRepository.findRecipientAccountId` (resolves recipient `CustomerUser.accountId`) → NOT_FOUND on cross-tenant/unknown. Route reads `customerUser` + threads it. System/event path correctly omits it.                  | NEW `notificationUseCasesTenantIsolation.test.ts` 4 + existing `notificationRoutes.test.ts` 20 (+1)         |
| IDOR-ACCOUNTS      | FIXED   | Tenant root (direct token-vs-URL). `assertOwnAccount(ctx, accountId)` → 404 on mismatch (get/update/delete); `listAccounts` scoped to `where:{id:caller.accountId}`; `maxProjects` removed from create+update (quota tamper).                                                                               | NEW `accountRoutesTenantIsolation.test.ts` 5 + existing `accountRoutes.test.ts` 23 (11 fixed)               |

### Caller sweeps (every customer route threads the gate)

- **RECURRING**: only customer route = `recurringPostRoutes.ts` (list/getOne/update/deactivate thread `user.accountId`). `findByProjectId` only called from `ListRecurringPostsQuery`. `ProcessRecurrenceUseCase` uses `findActiveByNextScheduled` (system path, no gate — correct).
- **COMMENTS**: only consumer = `commentRoutes.ts` (uses `user.id`). DI setup in `setupTeamUseCases.ts`. No other route passes body identity.
- **NOTIFICATIONS**: 2 callers of `CreateNotificationUseCase` — `notificationRoutes.ts` (customer, threads `callerAccountId`) and `NotificationDispatchAdapter`/`NotificationEventHandlers` (SYSTEM event path, correctly omits — reacts to domain events, no caller account). This is exactly why `callerAccountId` is optional.
- **ACCOUNTS**: account get/update/delete by URL id confined to `accountRoutes.ts`. No other customer route operates on accounts by URL id (repo adapters run under tenant context).

### Residual / intentionally-unthreaded

- **RECURRING create** (`POST /recurring-posts`): body `projectId` not gated. Gating create needs a Project-ownership resolver (different mechanism than `findOwnerAccountId` on a not-yet-created schedule). Left as residual — identical to how IDOR-POSTS left post-create. Low risk (create-only; no read/leak), but flagged for a future project-ownership-on-create slice.
- **Notification HTTP status**: cross-tenant create maps to 400 (route maps all use-case errors to 400). Anti-enumeration holds at the use-case (NOT_FOUND shape); HTTP-code normalization to 404 is a route-mapper polish, deferred.

### Files changed (slice 2)

| File                                                                           | Action                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `packages/core/domain/src/repositories/RecurringPostRepository.ts`             | Modified (`findOwnerAccountId`, `findByProjectId(callerAccountId?)`) |
| `packages/core/domain/src/repositories/NotificationRepository.ts`              | Modified (`findRecipientAccountId`)                                  |
| `packages/core/recurring/src/GetRecurringPostQuery.ts`                         | Modified (owner gate → null)                                         |
| `packages/core/recurring/src/ListRecurringPostsQuery.ts`                       | Modified (thread callerAccountId)                                    |
| `packages/core/recurring/src/UpdateRecurringPostUseCase.ts`                    | Modified (owner gate → NOT_FOUND)                                    |
| `packages/core/recurring/src/DeactivateRecurringPostUseCase.ts`                | Modified (owner gate → NOT_FOUND)                                    |
| `packages/core/notifications/src/CreateNotificationUseCase.ts`                 | Modified (recipient gate → NOT_FOUND)                                |
| `apps/api/src/infrastructure/repositories/PrismaRecurringPostRepository.ts`    | Modified (joined filter + findOwnerAccountId)                        |
| `apps/api/src/infrastructure/repositories/PrismaNotificationRepository.ts`     | Modified (findRecipientAccountId via CustomerUser.accountId)         |
| `apps/api/src/recurring/recurringPostRoutes.ts`                                | Modified (thread user.accountId ×4)                                  |
| `apps/api/src/comments/commentRoutes.ts`                                       | Modified (token-derived author/editor)                               |
| `apps/api/src/notifications/notificationRoutes.ts`                             | Modified (auth read + thread callerAccountId)                        |
| `apps/api/src/accounts/accountRoutes.ts`                                       | Modified (assertOwnAccount, scoped list, quota lock)                 |
| `apps/api/tests/unit/application/recurringPostUseCasesTenantIsolation.test.ts` | Already present (RED authored prior); now GREEN                      |
| `apps/api/tests/unit/application/notificationUseCasesTenantIsolation.test.ts`  | Created                                                              |
| `apps/api/tests/unit/comments/commentRoutesIdentityIsolation.test.ts`          | Created                                                              |
| `apps/api/tests/unit/accountRoutesTenantIsolation.test.ts`                     | Created                                                              |
| `apps/api/tests/unit/comments/commentRoutes.test.ts`                           | Modified (author=token contract)                                     |
| `apps/api/tests/unit/notifications/notificationRoutes.test.ts`                 | Modified (customer token + recipient; +1 cross-tenant test)          |
| `apps/api/tests/unit/accountRoutes.test.ts`                                    | Modified (auth-derived accountId; quota-lock contract)               |

### Verify (LXC-safe, all green)

- 9 affected api test files combined → **96 passed**.
- `@core/recurring` 4 + `@core/notifications` 4 package tests → green.
- ESLint `--max-warnings 0` on all 20 touched files → 0 (heap 4096; default OOMs under LXC cap).
- Fitness greps on changes: #1 (no prisma in routes)=0, #3 (no `any`)=0, #4 (no throw)=0, #6 (CQRS)=N/A, #9 (@file)=0 missing, #10 (@layer)=0 invalid, #23 (raw prisma)=0.
- Typecheck: `@core/domain`+`@core/recurring`+`@core/notifications`=0; `@apps/api`=0 (single heavy run, heap 6144).

---

## SLICE 3 — Write-side close: create-in-foreign-project (CWE-639)

Judgment-day dual-judge + orchestrator trace CONFIRMED the slice-2 read gates did
NOT cover the WRITE side. Closed four create/read write-path vectors, each strict
TDD RED→GREEN, all NOT_FOUND (anti-enumeration), `callerAccountId` optional so
genuine system/admin paths stay inert.

### Shared primitive — project-ownership resolver (REUSED existing port, added method)

`ProjectRepository.findOwnerAccountId(projectId): Promise<AccountId|null>` —
port `packages/core/domain/src/repositories/ProjectRepository.ts`, adapter
`apps/api/src/infrastructure/repositories/PrismaProjectRepository.ts`
(`project.findFirst({ where:{ id, deletedAt:null }, select:{ accountId } }})`).
DI already wires `TOKENS.ProjectRepository → PrismaProjectRepository`
(`setupRepositories.ts`); no new token. Mirrors `PostRepository.findOwnerAccountId`
(acb25880). The post-ownership resolver was REUSED as-is for COMMENTS-create.

### Gates

1. **POSTS-create** — `CreatePostUseCase` (+`projectRepository?`, +`callerAccountId?`)
   gate on `projectId`. Customer routes threading it: `zapierRoutes` +
   `makeRoutes` (`create-draft`, `schedule-post`) via `request.user.accountId`
   (+401 guard added). System callers (`PostCreationAdapter` ← recurrence/bulk)
   omit `callerAccountId` → gate inert. DI: `setupPostUseCases.ts`.
2. **RECURRING-create** — `CreateRecurringPostUseCase` (+`projectRepository?`, +`callerAccountId?`) gate on `command.projectId`; `recurringPostRoutes.create`
   threads `user.accountId` + maps NOT_FOUND→404. Closes the active vector
   (RecurrenceScheduler 60s tick fans posts into `projectId`). DI:
   `setupRecurringPostUseCases.ts`.
3. **COMMENTS-create** — `CreateCommentUseCase` (+`postRepository?`, +`callerAccountId?`) gate via `PostRepository.findOwnerAccountId(postId)`;
   `commentRoutes.createComment` threads `user.accountId` + NOT_FOUND→404. DI:
   `setupTeamUseCases.ts`.
4. **COMMENTS-read** — `GetPostCommentsQuery` (+`callerAccountId?`) threaded into
   `PostCommentRepository.findByPost`/`countByPost` (new optional `AccountId`
   param); `PrismaPostCommentRepository` adds `post:{ project:{ accountId } }`
   joined filter; `commentRoutes.listComments` threads `user.accountId`.

### Caller sweeps

- **CreatePostUseCase** customers: zapierRoutes + makeRoutes (threaded, +401).
  CQRS `/api/cqrs/posts/create` derives `projectId` from `request.user.projectId`
  (NOT customer-supplied foreign value) — not the IDOR vector; left as-is.
  System: PostCreationAdapter (recurrence/bulk) omits → inert.
- **CreateRecurringPostUseCase**: only `recurringPostRoutes` (threaded).
- **CreateCommentUseCase** / **GetPostCommentsQuery**: only `commentRoutes`
  (threaded). Only consumer.

### Fix #3 (ACCOUNTS comment) — premise corrected, not blindly applied

The delegate claimed "no maxProjects admin path exists". VERIFIED FALSE: an admin
override path DOES exist — `PUT /admin/accounts/:id/settings` →
`AnalyticsAccountHandlers.ts:82` sets `maxProjects` (admin-auth gated, registered
`index.ts:509`). Did NOT write the instructed false "no override path" comment;
instead corrected the three `accountRoutes.ts` `maxProjects` comments to cite the
real admin endpoint. The admin-quota path is therefore NOT a missing follow-up.

### Fix #4 (frontend dead field)

Removed dead `authorId` from the comment POST: `useComments.ts`
(`addComment`/`useAddComment`), `CommentThread.tsx` (dropped `authorId` prop +
mutate arg), `ReviewPanel.tsx` (dropped `authorId={reviewerId}`). `reviewerId`
kept on ReviewPanel (still used by approve/reject). Server already strips/ignores
`authorId` (identity gate, slice 2).

### Files (slice 3)

| File                                                                           | Change                                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `packages/core/domain/src/repositories/ProjectRepository.ts`                   | +findOwnerAccountId                                                                           |
| `packages/core/domain/src/repositories/PostCommentRepository.ts`               | findByPost/countByPost +callerAccountId?                                                      |
| `packages/core/posts/src/CreatePostUseCase.ts`                                 | +projectRepository?, +callerAccountId? gate                                                   |
| `packages/core/recurring/src/CreateRecurringPostUseCase.ts`                    | +projectRepository?, +callerAccountId? gate                                                   |
| `packages/core/comments/src/CreateCommentUseCase.ts`                           | +postRepository?, +callerAccountId? gate                                                      |
| `packages/core/comments/src/GetPostCommentsQuery.ts`                           | +callerAccountId? threaded to repo                                                            |
| `apps/api/src/infrastructure/repositories/PrismaProjectRepository.ts`          | +findOwnerAccountId                                                                           |
| `apps/api/src/infrastructure/repositories/PrismaPostCommentRepository.ts`      | joined filter on findByPost/countByPost                                                       |
| `apps/api/src/infrastructure/container/setupPostUseCases.ts`                   | inject ProjectRepository                                                                      |
| `apps/api/src/infrastructure/container/setupRecurringPostUseCases.ts`          | inject ProjectRepository                                                                      |
| `apps/api/src/infrastructure/container/setupTeamUseCases.ts`                   | inject PostRepository into CreateCommentUseCase                                               |
| `apps/api/src/recurring/recurringPostRoutes.ts`                                | thread callerAccountId + 404                                                                  |
| `apps/api/src/comments/commentRoutes.ts`                                       | thread callerAccountId (create + list) + 404                                                  |
| `apps/api/src/integrations/zapierRoutes.ts`                                    | thread callerAccountId + 401 (create-draft, schedule-post)                                    |
| `apps/api/src/integrations/makeRoutes.ts`                                      | thread callerAccountId + 401 (create-draft, schedule-post)                                    |
| `apps/api/src/accounts/accountRoutes.ts`                                       | corrected 3 maxProjects comments (cite real admin endpoint)                                   |
| `apps/client/hooks/api/useComments.ts`                                         | drop dead authorId                                                                            |
| `apps/client/components/comments/CommentThread.tsx`                            | drop authorId prop/usage                                                                      |
| `apps/client/components/approvals/ReviewPanel.tsx`                             | drop authorId={reviewerId}                                                                    |
| `apps/api/tests/unit/application/createPostUseCaseTenantIsolation.test.ts`     | Created (RED→GREEN, 4)                                                                        |
| `apps/api/tests/unit/application/createCommentUseCaseTenantIsolation.test.ts`  | Created (RED→GREEN, 3)                                                                        |
| `apps/api/tests/unit/application/getPostCommentsQueryTenantIsolation.test.ts`  | Created (RED→GREEN, 3)                                                                        |
| `apps/api/tests/unit/application/recurringPostUseCasesTenantIsolation.test.ts` | +CreateRecurringPostUseCase block (RED→GREEN, 3)                                              |
| `packages/core/posts/tests/unit/CreatePostUseCase.test.ts`                     | call sites +undefined projectRepository arg                                                   |
| `apps/api/tests/unit/unitOfWork.useCases.test.ts`                              | CreatePostUseCase positional uow → +undefined slot                                            |
| `apps/api/tests/unit/comments/commentRoutes.test.ts`                           | post→project mock resolver; customer token w/ owner accountId; removed dead admin-login chain |
| `apps/api/tests/unit/comments/commentRoutesIdentityIsolation.test.ts`          | post→project mock resolver; denormalized accountId                                            |

### Verify (slice 3, LXC-safe, all green)

- New gate tests: createPost 4 + createComment 3 + getPostComments 3 +
  recurring isolation 11 (incl. +3 create) + recurring regression 9 = 30 passed.
- Regressions: unitOfWork.useCases 4, CreatePostUseCase (core) 6,
  CreateCommentUseCase (core) 4, PrismaProjectRepository 18, commentRoutes 13,
  commentRoutesIdentityIsolation (with the rest of that batch) 16,
  accountRoutes + isolation 28 — all green.
- Lint `--max-warnings 0` (heap 4096) on all touched prod + test files → 0.
- Fitness on changes: #1=0, #3=0, #4=0, #6=N/A (no cqrs/handlers touched),
  #9=0 missing @file, #10=0 invalid @layer, #23=0 raw prisma.
- NO git ops; HEAD stays acb25880. Did NOT touch `.github/workflows/` or CLAUDE.md.

---

## SLICE 4 — §2B task 2.3/2.4 CACHE-XTENANT-HTTP (cross-tenant HTTP response cache leak, CWE-639)

Uncommitted in `workstream/impl-revalidation` (no git ops). Strict TDD RED→GREEN.

### The defect (re-confirmed by code read)

- `generateApiCacheKey` keyed only by `request.user?.id`. Client-portal routes
  authenticate via `requireClientAuth` → populate `request.customerUser`
  (.accountId), NEVER `request.user` (set only by the Zapier/Make
  `integrationAuthMiddleware`). So for every client-portal request the tenant
  segment was dropped and accountId never entered the key → cross-tenant
  collision on `GET /posts`, `GET /posts/:id`, `GET /analytics/dashboard`, etc.
- WORSE: the autoCache `onRequest` hook runs BEFORE the route `preHandler`
  (`requireClientAuth`), so a cache HIT served the body before any tenant gate
  ran (auth-bypass-on-hit; bypasses the §2A IDOR fixes).

### Fix approach: (b) resolve+verify tenant inside the cache hook

(a) was rejected: a Fastify GLOBAL `preHandler` hook runs BEFORE route-level
`preHandler`s (verified empirically), and the auth IS a route-level preHandler,
so a global cache plugin cannot cleanly run its serve AFTER per-route auth
without rewriting every route. Approach (b) reuses the canonical
`verifyCustomerToken` to resolve the VERIFIED accountId from the bearer token at
key-build time — no header trust, no auth duplication/loosening — and closes
BOTH halves: tenant collision AND auth-bypass-on-hit (a HIT now requires a
verifiable customer token; an invalid/missing/revoked token fails closed).

### Exact new cache-key composition

`generateApiCacheKey(method, route, params, query, headers, userId?, accountId?)`
builds `["api", method, route, (accountId ? "acct=<accountId>" : ∅), ...varyBy,
(userId ? "user=<userId>" : ∅)].join(":")`. The `acct=<accountId>` tenant
segment is injected by the middleware ONLY for tenant-scoped routes with a
verified tenant. Tenant-neutral routes pass no accountId → shared key unchanged.

### Fail-closed + scoping classification

- `RouteCacheOptions.tenantScoped?` (default = scoped, fail-safe) + new
  `isTenantScopedRoute(method, route)`.
- Tenant-NEUTRAL (explicit `tenantScoped:false`, 7 entries): provider catalog
  `GET:/providers`, `/providers/active`, `/providers/by-capability/:capability`,
  `/providers/:id`, `/providers/health/all`; RBAC catalog `GET:/rbac/roles`,
  `/rbac/permissions`. All other cached routes are tenant-scoped.
- Middleware `onRequest`: if route is tenant-scoped AND no verified tenant →
  BYPASS (no serve, no store). Never writes/reads a tenant-scoped key without
  `acct=`.

### AI cache untouched

`apps/api/src/ai/orchestrator.ts generateCacheKey` NOT modified (task 2.2
REFUTED — value is a deterministic transform of byte-identical task.data).

### Files

| File                                                                  | Change                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/cache/cacheConfig.ts`                               | +`tenantScoped?` on RouteCacheOptions; 7 catalog entries marked `tenantScoped:false`; +`isTenantScopedRoute()`; `generateApiCacheKey` +`accountId?` 7th param → `acct=` segment        |
| `apps/api/src/middleware/autoCacheMiddleware.ts`                      | +`resolveVerifiedTenant()` (reuses `verifyCustomerToken`); `onRequest` fail-closed bypass for tenant-scoped+no-tenant; key built with verified accountId only for tenant-scoped routes |
| `apps/api/tests/unit/cacheConfig.tenant-isolation.test.ts`            | Created (RED→GREEN, 10)                                                                                                                                                                |
| `apps/api/tests/unit/autoCacheMiddleware.tenant-isolation.test.ts`    | Created (RED→GREEN, 5) — real customer tokens via Fastify inject                                                                                                                       |
| `apps/api/tests/unit/autoCacheMiddleware.invalidation-config.test.ts` | POST-invalidation test now carries a valid customer token (tenant-scoped `/posts` requires verified tenant to cache)                                                                   |
| `apps/api/tests/cache.test.ts`                                        | stale AUTH_HEADER comment updated to reflect tenant-scoped keying                                                                                                                      |

### Verify (slice 4, LXC-safe, all green)

- New: cacheConfig.tenant-isolation 10 + autoCacheMiddleware.tenant-isolation 5
  = 15 passed (RED first, then GREEN).
- Regression (5 cache unit files together): 86 passed.
- Lint `--max-warnings 0` (heap 4096) on all 6 touched files → 0.
- Typecheck `@apps/api` (single run, heap 6144) → 0.
- Fitness on changes: #14=0 (no per-class Map), #3=0 (no any), #5=0 (no
  @ts-ignore), #9 both have @file, #10=0 invalid @layer.
- `cache.test.ts` is a node:test INTEGRATION file (DB+Redis) — not run here
  (LXC-safe); reviewed correct under the fix (uses a valid customer token, same
  account, so MISS/HIT/invalidation unchanged).
- NO git ops. Did NOT touch the AI cache, `.github/workflows/`, or CLAUDE.md.

---

## SLICE 5 — §2C task 3.1/3.2 AUTH-REGISTER-PRIVESC (CWE-269 public admin-registration privilege escalation) — uncommitted

### Defect (CONFIRMED CRITICAL)

The legacy `POST /auth/register` endpoint was **public/unauthenticated**, accepted
`role` from the request body, and minted an **ADMIN** user by default
(`registerAdmin(email, password, name, role || "ADMIN")`). Anyone reaching the
API could self-provision an ADMIN account — CWE-269 (Improper Privilege
Management).

Verified **DEAD**: zero frontend/api-client callers (`rg '/auth/register'` over
`apps/admin` + `apps/client` empty). The only references were the route def
itself (comment: "legacy admin registration endpoint"), tests, the audit-path
mapping, and the generated OpenAPI types. Edward authorized **REMOVAL** in
preference to hardening a dead endpoint.

### Fix approach — REMOVAL (not "strip role")

Because the endpoint is verified dead and Edward authorized removal, the priv-esc
surface is eliminated entirely rather than patched. Original task 3.2 ("strip
`role`, default non-priv role") is **superseded** — there is no payload left to
strip.

### registerAdmin disposition — KEPT (used elsewhere: test seeding)

`grep` of all production callers (`apps/` + `packages/`, excluding tests/reports)
shows the ONLY non-test caller of `authService.registerAdmin` was
`authRoutes.ts:71` — the removed route. However `registerAdmin` is the canonical
**seeding primitive** used by 18 test files to create admin/super-admin/support
users for RBAC, MFA, audit, dashboard, channel, notification, team, subscription,
approval, trend suites. Per the task rule ("if used elsewhere — seeding, an admin
tool — KEEP it, verify no other PUBLIC route exposes it, report every remaining
caller"), `registerAdmin` is **kept** in both `authService.ts` and
`authServiceCore.ts`. Verified: NO other route (public or gated) calls it after
removal. Remaining production references = the method definitions only
(`authServiceCore.ts:80`, `authService.ts:60/66`). All other callers are tests.

### dashboardRoutes / trendRoutes incidental references

Both used `POST /auth/register` only to SEED an admin/test user before logging in
to get a token — register was NOT the subject. Repointed to the kept service
seeding path `authSvc.registerAdmin(...)` (the pattern `dashboardRoutes.test.ts`
already used for its support user). `trendRoutes.test.ts` `createTestApp()` now
returns `{ app, authSvc }` so `beforeAll` can seed via the service. Both tests
still test their real subject (dashboard stats / trend analysis endpoints).

### 404 regression guard

Added to `authRoutes.test.ts` a `POST /auth/register (removed endpoint)` describe
asserting the route now returns **404** (route not registered) — the
"removal is real" guard.

### OpenAPI generated types — FLAGGED as required follow-up (NOT touched)

`packages/shared/src/api-generated/types.gen.ts` still lists `/auth/register`.
The file is AUTO-GENERATED ("NO editar a mano"). Regeneration
(`pnpm generate:api-types`) boots `createApp()` against PostgreSQL + Redis
(per the script's own precondition docstring) — heavy, NOT LXC-safe. Per the task
constraint, the generated file is left untouched and this is flagged as a
**required follow-up**: run `pnpm generate:api-types` (DB + Redis up) to drop the
dead `/auth/register` path from the generated types. Until then the generated
types transiently still list the dead route (harmless — it's a client type only;
the live route returns 404).

### Files

| File                                          | Change                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/auth/authRoutes.ts`             | Removed `POST /auth/register` route registration + `register` handler method + `RegisterSchema` + now-orphaned `UserRoleSchema`/`PasswordSchema` import; `@file` header de-scoped (drop "registration")                   |
| `apps/api/src/audit/auditMiddleware.ts`       | Removed the dead `/auth/register` → `USER_CREATED` path mapping (`AuditActions.USER_CREATED` enum kept — still used by `activityFeedService.ts`)                                                                          |
| `apps/api/tests/unit/authRoutes.test.ts`      | Removed the `POST /auth/register` describe (5 cases); seed `testEmail` via `authService.registerAdmin` in `beforeAll`; added 404 removal-regression test; dropped unused `_testUserId`                                    |
| `apps/api/tests/unit/authRateLimit.test.ts`   | Removed the `POST /auth/register — max 10 per 1 hour` describe + `postRegister` helper + `MOCK_REGISTER_SUCCESS`; repointed cross-route isolation case from register→refresh (still tests independent per-route counters) |
| `apps/api/tests/unit/auditMiddleware.test.ts` | Removed the `USER_CREATED from /auth/register POST` case                                                                                                                                                                  |
| `apps/api/tests/unit/dashboardRoutes.test.ts` | Admin user seeding repointed from `POST /auth/register` inject → `authSvc.registerAdmin`                                                                                                                                  |
| `apps/api/tests/unit/trendRoutes.test.ts`     | `createTestApp()` returns `{ app, authSvc }`; user seeding repointed from `POST /auth/register` inject → `authSvc.registerAdmin`                                                                                          |

### Verify (slice 5, LXC-safe, all green)

- `authRoutes.test.ts` → 19 passed (incl. new 404 regression).
- `auditMiddleware.test.ts` → 28 passed.
- `authRateLimit.test.ts` → 12 passed (was 16; -4 register-suite cases).
- `dashboardRoutes.test.ts` → 34 passed.
- `trendRoutes.test.ts` → 18 passed (Tier-1, ran against omnipost-infra LXC over Tailscale; localhost DB not used).
- Lint `--max-warnings 0` (heap 4096) on all 7 touched files → 0.
- Typecheck `@apps/api` (single run, heap 6144) → 0.
- Fitness on changes: #1=0 (no prisma in routes), #3=0 (no any), #5=0
  (no @ts-ignore), #8=0 (no sprint/phase refs), #9 @file present, #10=0
  invalid @layer. No orphaned imports left dangling.
- NO git ops. Did NOT touch `POST /auth/customer/register` / `RegisterCustomerUseCase`, any rate-limit production code (RATELIMIT-DEAD remains BLOCKED on canon-research), `.github/workflows/`, or CLAUDE.md.

---

## Phase A · A3 — §2C RATELIMIT-DEAD (slice 6: canon established + canonical-limiter fix)

**Mode**: Strict TDD (RED→GREEN). **Branch**: `workstream/impl-revalidation`. No git ops. Edward AUTHORIZED establishing the rate-limit canon + the fix (clears the A3.3 canon-gap stall).

### Defect (CONFIRMED — RATELIMIT-DEAD, §2C)

`@fastify/rate-limit@10.3.0` is a declared dependency but is NEVER registered in `apps/api/src` (no `app.register(fastifyRateLimit)`), so the auth routes' `config: { rateLimit: {...} }` declarations were DEAD CONFIG — Fastify silently ignores the unknown key. The actual limiter is the global `createHttpRateLimitPreHandler` (Redis token bucket via `RateLimiterPort`, cross-pod, fail-open), but its `STANDARD_ROUTE_RULES` table omitted every auth endpoint → they degraded to the STANDARD default (100/min); the `/accounts$` rule had a literal `$` that never matched under `startsWith`; and `trustProxy:true` made the IP key derive from a spoofable leftmost `X-Forwarded-For`. Customer login is already account-BF-protected (ADR-0015); admin `/auth/*` already uses a real preHandler; `/auth/register` was removed in slice 5 (NOT re-added).

### Decision (ADR-0019, Accepted 2026-06-28)

ONE canonical HTTP limiter (`RateLimiterPort` + `createHttpRateLimitPreHandler`). Kill the dead `@fastify/rate-limit` route-config path. Fail-OPEN + alerting (consistent with ADR-0015). Cites NIST 800-63B-4 §Rate Limiting, OWASP API4:2023, OWASP Auth Cheat Sheet, ADR-0015, ADR-0007.

### Completed

- [x] **ADR-0019** written: `docs/technical/ADR-0019-rate-limiting-canonical-limiter.md` (full repo ADR template, Status Accepted).
- [x] **SECURITY_CANON §Rate Limiting** added (after Audited-audit-ignores, before How-to-extend) + companion fitness bullet (#28) + new How-to-extend item ("New rate-limited endpoint"). Links ADR-0019.
- [x] **3a — AUTH rules** added to `STANDARD_ROUTE_RULES` via a new `AUTH_ROUTE_RULES` array (concatenated FIRST so an auth URL wins the first-`startsWith` match): customer `/auth/customer/login`, `/auth/customer/register`, `/auth/customer/refresh`, `/auth/customer/request-password-reset`, `/auth/customer/reset-password`; core `/auth/login`, `/auth/refresh`. All use `RateLimitConfigs.AUTH` (5 req / 15 min). `/auth/logout` deliberately NOT capped at AUTH (falls through to STANDARD). Matching semantics unchanged (`startsWith`).
- [x] **3b — dead `config.rateLimit` removed** from `authRoutes.ts` (login/refresh/logout) and `customerAuthRoutes.ts` (register/login/refresh/request-password-reset/reset-password). Comments explain the canonical limiter now enforces the cap.
- [x] **3c — broken `/accounts$` fixed** → `/accounts` (real prefix; account routes now get the AUTH preset instead of silently resolving to the default).
- [x] **3d — trustProxy hardening (env-configurable)**: new `TRUSTED_PROXY_HOP_COUNT` env (`config/env.ts`, `z.coerce.number().int().min(1).max(10).default(1)`); exported pure `resolveClientIp(forwarded, realIp, socketAddress, trustedHops)` keys off the `X-Forwarded-For` entry at `len - trustedHops` (trusted, non-forgeable hop), with clamp + `X-Real-IP` + socket fallbacks. `clientIp(req)` now delegates to it using `env.TRUSTED_PROXY_HOP_COUNT`. Documented in `.env.example`.
- [x] **3e — `authRateLimit.test.ts` rewritten** to drive the REAL preHandler path (`createHttpRateLimitPreHandler` + production `STANDARD_ROUTE_RULES` + `InMemoryTokenBucketRateLimiter`), NOT a self-registered `@fastify/rate-limit`. RED-FIRST: 11 failed on the no-AUTH-rules code (missing rules + un-exported `resolveClientIp`) → 13 passed after 3a/3d. Asserts: each AUTH endpoint 429s on the 6th request, per-route counters are isolated, a non-auth route gets STANDARD (6 requests all pass), trusted-hop keying picks the right entry for 1 and 2 hops, and the limiter fails OPEN (200, not 429) when the store throws.
- [x] **3f — fail-OPEN + alerting preserved/strengthened**: the catch block still returns `undefined` (request allowed); upgraded the log to a structured `logger.warn({ threat_type: "http_rate_limit_failopen", layer: "infrastructure", err }, ...)` so the silent-by-design fail-open path is alertable (ADR-0015 posture). NOT changed to fail-closed.
- [x] **Fitness #28 drafted** for `CLAUDE.md §Automated Compliance Checks`: `grep -rnE "config:\s*\{\s*rateLimit:" apps/api/src --include="*.ts" | grep -vE "/tests/|\.test\." | wc -l  # expect 0`. CI mirror (`.github/workflows/fitness.yml`) intentionally left to the orchestrator (sensitive path).

### TDD Cycle Evidence

| Task                           | RED (test first)                                                                           | GREEN (impl passes)                                      | REFACTOR                             |
| ------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------ |
| 3a AUTH rules + 3d trusted-hop | `authRateLimit.test.ts` rewritten → 11 failed (no AUTH rules; `resolveClientIp` undefined) | AUTH_ROUTE_RULES + resolveClientIp added → 13 passed     | comments + table ordering documented |
| 3f fail-open                   | fail-open test asserts 200 (not 429) on store throw → part of the RED 11                   | catch block returns undefined + structured WARN → passes | warning made structured/alertable    |

### Verify (slice 6, LXC-safe, all green)

- `authRateLimit.test.ts` (rewritten) → 13 passed.
- `security/httpRateLimitPreHandler.test.ts` (sibling) → 5 passed (signature change safe).
- `authRoutes.test.ts` → 19 passed (dead-config removal safe).
- `auditMiddleware.test.ts` + `dashboardRoutes.test.ts` → 62 passed (env addition safe).
- Lint `--max-warnings 0` (heap 4096) on the 5 touched code/test files → 0.
- Typecheck `@apps/api` (single run, heap 6144) → 0.
- Fitness on changes: #3=0 (no any), #5=0 (no @ts-ignore), #8=0 (no sprint/phase refs), #9 @file present, #10=0 invalid @layer, #16=0 (no raw process.env outside config/env.ts), #28=0 (no dead rateLimit config).

### Files (slice 6)

- `docs/technical/ADR-0019-rate-limiting-canonical-limiter.md` (created).
- `docs/security/SECURITY_CANON.md` (added §Rate Limiting + How-to-extend item + fitness bullet).
- `apps/api/src/security/httpRateLimitPreHandler.ts` (AUTH_ROUTE_RULES, `/accounts` fix, `resolveClientIp` export, env-keyed `clientIp`, structured fail-open WARN, @file de-scoped).
- `apps/api/src/config/env.ts` (`TRUSTED_PROXY_HOP_COUNT`).
- `apps/api/src/auth/authRoutes.ts` (removed dead `config.rateLimit`).
- `apps/api/src/auth/customerAuthRoutes.ts` (removed 5 dead `config.rateLimit`).
- `apps/api/tests/unit/authRateLimit.test.ts` (rewritten to drive the real preHandler path).
- `.env.example` (`TRUSTED_PROXY_HOP_COUNT`).
- `CLAUDE.md` (fitness #28 drafted).

### Out of scope / flagged

- **`@fastify/rate-limit` dependency removal**: FLAGGED follow-up (needs lockfile update; not removed in this slice to avoid install churn).
- **`.github/workflows/fitness.yml` #28 mirror**: left to the orchestrator (sensitive path).
- Did NOT touch the BruteForceProtectionPort / ADR-0015 code (customer login BF intact), did NOT re-add `/auth/register`, did NOT remove the `@fastify/rate-limit` dep, NO git ops.

**Still deferred (carry-over from prior slices)**: OpenAPI types regen (needs DB+Redis); full-CI 0-defect gate sign-off (2.5/3.7); 1.7 §2G CI gate; 1.8 integration cross-tenant 403/404; IDOR-TRACKEDLINK/SCHEDULEDREPORT surfaces; analytics purity smell; A4 §2F write-path.

## SLICE 6b — §2C RATELIMIT-DEAD dual-judge rework (Track 2 §2C)

The dual-judge adversarial review of slice 6 surfaced 3 CODE issues; the orchestrator
applied the 3 code fixes to `httpRateLimitPreHandler.ts`. This slice adds the test
coverage + an ADR note + verifies. No change to the fixes themselves (one keying line
was temporarily reverted ONLY to prove RED-first, then restored).

### The 3 already-applied code fixes (confirmed present via `git diff`)

- **Query-immune keying** — `const path = req.url.split("?")[0] ?? req.url;` is now used for BOTH `findConfig` AND the bucket key (previously keyed on the full `req.url`, so `/auth/login?x=1`, `?x=2`, ... rotated buckets and evaded the AUTH cap; CWE-307).
- **`/accounts` → STANDARD** — the old `/accounts$` AUTH rule was removed; account routes resolve to the STANDARD default (NOT re-added; a real `/accounts` AUTH prefix would over-cap the client SPA's account GET reads at 5/15min).
- **`/auth/mfa/verify` → AUTH** — added to `AUTH_ROUTE_RULES` (TOTP / backup-code guessing surface with no per-account counter).

### Done (this slice)

- [x] **`authRateLimit.test.ts` — production rule concat**: `buildApp` now wires `[...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES]` (the prior rewrite wired only `STANDARD_ROUTE_RULES` — a Judge A LOW finding; `index.ts` L422 uses the concat). Routes registered for BOTH GET+POST (the limiter is method-agnostic).
- [x] **Query-immune keying test (THE regression guard)**: `POST /auth/login?x=1` … `?x=6` (distinct query strings) → the 6th returns 429, proving the query string does NOT rotate the bucket. **RED-FIRST CONFIRMED**: temporarily reverting the source keying back to the full `req.url` made the 6th return 200 (not 429) — each distinct query minted a fresh bucket — then the source was restored.
- [x] **`/accounts` → STANDARD test**: `GET /accounts/acct-123/projects` survives 6 requests with no 429 (STANDARD 100/min, not AUTH 5/15min).
- [x] **`/auth/mfa/verify` → AUTH test**: the 6th `POST` request 429s.
- [x] **ADR-0019 note**: added a References-section line noting that ADR-0015's §Risks "Fastify route rate-limit fallback (5/15min)" referred to the dead `config.rateLimit` removed by this change; the real fallback during a Redis BF outage is the HTTP preHandler AUTH cap, which itself fails open. ADR-0015 NOT edited.

### Verify (slice 6b, LXC-safe, all green)

- `authRateLimit.test.ts` → 16 passed (was 13, +3 new).
- `security/httpRateLimitPreHandler.test.ts` (sibling) → 5 passed.
- Lint `--max-warnings 0` (heap 4096) on `authRateLimit.test.ts` → 0.
- Typecheck `@apps/api` (`tsc --noEmit`, single run, heap 6144) → 0.

### Files (slice 6b)

- `apps/api/tests/unit/authRateLimit.test.ts` (3 new tests + `buildApp` production-concat fix + `EXPENSIVE_ENDPOINT_RULES` import).
- `docs/technical/ADR-0019-rate-limiting-canonical-limiter.md` (References note).
- `openspec/changes/implementation-plan-revalidation/tasks.md` (3.7 `[x]`).

### Constraints honored

- NO git ops; did NOT touch `.github/workflows/**` (fitness #28 CI mirror = orchestrator); did NOT re-add the `/accounts` AUTH rule; did NOT change the fail-open posture. Canon respected (Result, no `any`, typed `env`, JSDoc).
