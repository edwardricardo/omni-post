# Design: Post Read Ownership Gate

## Technical Approach

Close the four confirmed cross-tenant read IDOR surfaces (CWE-639) by threading a
server-derived `callerAccountId` (from `request.customerUser.accountId`, never client
input) into each read use case and pushing it into the Prisma WHERE via the transitive
`project: { accountId }` relation (Post has no direct `accountId`). Foreign/nonexistent
rows never match, so single-gets return `EntityNotFoundError` → `NOT_FOUND` (anti-enumeration,
no `FORBIDDEN`) and lists close guard-naturally (`200` + `[]`). This mirrors the merged Slice 0
DELETE gate's server-derived-accountId + NOT_FOUND discipline, adapted to the read side.

## Architecture Decisions

### Decision: Scope in the query repository WHERE, not the use case

**Choice**: Add `project: { accountId: accountId.value }` to the WHERE of `getById`,
`getByIdWithThread`, `listByProject`, `listGlobal` in `PrismaPostQueryRepository`.
**Alternatives**: A separate `findOwnerAccountId` lookup in the use case (Slice 0 DELETE style).
**Rationale**: CQRS read discipline — one scoped query, no second round-trip / N+1. Foreign row
simply never matches. DELETE uses `findOwnerAccountId` because it loads the aggregate anyway
(command side); reads must not add a lookup query.

### Decision: `callerAccountId` is REQUIRED on all four read inputs

**Choice**: Required `callerAccountId: string`; each use case converts via `AccountId.fromString`
and passes the VO to the repo.
**Alternatives**: Optional param (UpdatePostUseCase style) or a `customer | system` discriminated
union (DeletePostUseCase style).
**Rationale**: The only callers are `postRoutes` + tests — no system/internal read caller exists
(verified). A required param is fail-closed by construction (no call site can silently omit) and
simpler than a union with an unused `system` arm. If a system read caller ever appears, promote to
a `ReadCaller` discriminated union then.

### Decision (LOAD-BEARING — user sign-off): global list `GET /posts` → Option A (scope by accountId)

**Choice (A)**: `listGlobal(accountId, filter?, pagination?)` scoped by `project: { accountId }`.
**Alternative (B)**: Flip the route to `requireAdminAuth` + permission, keep it truly global for admins.
**Rationale / evidence (premise corrected by the adversarial design gate)**: `GET /posts` is under
`requireClientAuth`, which **rejects admin tokens** (customer-only). The global (no-`projectId`) path
IS live-used in production by apps/client dashboard pages (`dashboard/page.tsx`,
`dashboard/posts/page.tsx` via `usePosts()` with no `projectId`) — which today receive **all
accounts' posts** (the live leak). Those callers want "all MY posts across MY projects"
(cross-project, within-account), never cross-account. So Option A (scope by the caller's `accountId`)
is not merely safe — it is **REQUIRED**: flipping to admin-only (Option B) would break the client
dashboard entirely and serves no one (admin tokens are rejected here; no consumer relies on
cross-account results). Option A closes the IDOR with a WHERE change consistent with the other
surfaces. **SIGNED OFF by Edward (Option A).** A genuine cross-account admin list, if ever needed,
belongs on a new `/admin/posts` route (`requireAdminAuth`) — out of scope.

### Decision: projectId list (surface 3) closes guard-naturally

**Choice**: Add `project: { accountId }` to `listByProject`; a foreign `projectId` returns `200` + `[]`.
**Alternative**: Explicit up-front project-ownership check → NOT_FOUND.
**Rationale**: Consistent with the repo-side pattern; matches the merged `GeneratedImage` precedent
(A listing B's projectId → 200 + []); avoids a second query.

## Data Flow

    Route (customerUser.accountId) ──→ Use case (required callerAccountId → AccountId VO)
         │                                    │
         └── 401 if no principal              ▼
                              PostQueryRepository WHERE { project: { accountId } }
                                    │                         │
                          single-get: no match          list: no match
                          → EntityNotFoundError          → empty page (200 + [])
                          → NOT_FOUND (404)

## File Changes

| File                                                                                                                       | Action | Description                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/domain/src/repositories/PostRepository.ts`                                                                  | Modify | Add required `accountId: AccountId` to `getById`, `getByIdWithThread`, `listByProject`, `listGlobal` on `PostQueryRepository` port |
| `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts`                                                    | Modify | Add `project: { accountId: accountId.value }` to the four scoped WHEREs                                                            |
| `packages/core/posts/src/GetPostUseCase.ts`, `GetPostWithThreadQuery.ts`, `ListPostsUseCase.ts`, `ListPostsGlobalQuery.ts` | Modify | Required `callerAccountId`; convert to `AccountId`, pass to repo                                                                   |
| `apps/api/src/posts/postRoutes.ts`                                                                                         | Modify | Thread `request.customerUser.accountId` into `getPost`/`listPosts`; add defensive 401 when principal absent (mirror `deletePost`)  |
| `apps/api/tests/unit/application/*`                                                                                        | Modify | Update existing tests to pass `callerAccountId`; add foreign-account → NOT_FOUND cases                                             |
| `apps/api/tests/integration/postReadOwnership.test.ts`                                                                     | Create | Two-tenant read IDOR closure                                                                                                       |
| `apps/api/scripts/run-tests.sh`                                                                                            | Modify | Wire the new test into the `integration:tenant-isolation` batch                                                                    |

## Interfaces / Contracts

```typescript
// PostQueryRepository (port) — required accountId added
getById(id: PostId, accountId: AccountId): Promise<Result<PostReadModel, EntityNotFoundError>>;
getByIdWithThread(id: PostId, accountId: AccountId): Promise<Result<PostReadModelWithThread, EntityNotFoundError>>;
listByProject(projectId: ProjectId, accountId: AccountId, pagination?, sort?, filter?): Promise<PaginatedResult<PostReadModel>>;
listGlobal(accountId: AccountId, filter?: GlobalPostFilter, pagination?): Promise<PaginatedResult<PostReadModel>>;

// Read use-case inputs — required callerAccountId
interface GetPostInput            { postId: string; callerAccountId: string; }
interface GetPostWithThreadInput  { postId: string; callerAccountId: string; }
interface ListPostsInput          { projectId: string; callerAccountId: string; /* …existing */ }
interface ListPostsGlobalInput    { callerAccountId: string; status?; page?; limit?; }
```

## Testing Strategy

| Layer       | What to Test                                                                                                                                 | Approach                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Unit        | Each read use case rejects a foreign `callerAccountId` → NOT_FOUND (get/thread) / empty (lists); owner path unchanged                        | Vitest + mock `PostQueryRepository`; assert repo called with scoped `accountId`                             |
| Integration | Two-tenant: account A cannot get/thread/list account B's post; foreign == nonexistent parity; global list as customer returns only A's posts | node:test, seed 2 tenants, `app.inject` under `requireClientAuth`; wire into `integration:tenant-isolation` |
| E2E         | N/A                                                                                                                                          | Covered by integration `app.inject`                                                                         |

## Threat Matrix

N/A — no routing table, shell command, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary. This is an authorization/data-scoping change.

## Migration / Rollout

No migration required. No schema/DI/token/relation changes — params thread through existing DTOs
over the existing `project` FK. Single-revert rollback.

## Open Questions / Deferred follow-ups

- [x] Global-list decision A vs B → **A (scope by accountId), SIGNED OFF by Edward.**
- Deferred to tracked follow-ups (surfaced by the adversarial design gate, engram obs 366 — NOT fixed here):
  - **`POST /content/sync/:postId`** — a 5th LIVE post cross-tenant surface: `SyncEngineImpl` reads
    `prisma.post.findUnique({ where: { id: postId } })` with no account scoping — an existence oracle
    (foreign→200 / nonexistent→500) + a cross-tenant sync ACTION; becomes body disclosure once the
    `detectChanges`/`detectConflicts` stubs are implemented. Needs its own focused slice.
  - **Dead-code IDOR landmines** (not mounted — instant IDOR if ever registered): `optimizedPostsRoutes.ts`
    (client-supplied `accountId` + raw `$queryRaw`, bypasses the guard + fitness #23) and
    `CQRSIntegration.ts` (no `requireClientAuth`, client-supplied `projectId` — removed by PR #110).
  - **Latent unscoped port methods**: `PostQueryRepository.search` / `getUpcoming` / `getRecentlyPublished`
    (projectId-only) — no customer route reaches them today; scope or mark internal-only when next touched.
- Out of scope (do not fix here): Slice 8 structural Post enrollment; §2F provider-classifier; rest
  of PR #97. UPDATE-post authz is already gated at `updatePost` — no action.
