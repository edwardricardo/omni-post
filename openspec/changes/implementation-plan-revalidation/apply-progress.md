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

- **1.5/1.6 fixes** for CONFIRMED IDOR-ACCOUNTS, IDOR-COMMENTS, IDOR-NOTIFICATIONS, IDOR-RECURRING (budget — keep ≤~400 lines/slice).
- **1.7 §2G CI gate** (CI-GAP-INTEGRATION + CI-GAP-RLS) — separate task per orchestrator instruction.
- **1.8 integration regression tests** (node:test, real DB+Redis, cross-tenant → 403/404) — this slice shipped unit-level RED→GREEN; integration net pairs with §2G.
- **IDOR-TRACKEDLINK** route-surface search.
- **IDOR-SCHEDULEDREPORT** repo-level accountId filter confirmation.
- Non-IDOR analytics purity smell (read via injected `this.prisma` instead of a query port) → §1 hexagonal cleanup.
