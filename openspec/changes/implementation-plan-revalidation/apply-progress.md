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
