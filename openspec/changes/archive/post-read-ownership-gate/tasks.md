# Tasks: Post Read Ownership Gate

> Closes 4 live cross-tenant read IDOR surfaces (CWE-639) by threading a
> server-derived `callerAccountId` into the read use cases and scoping the Prisma
> WHERE via `project: { accountId }`. Design is FINAL (Option A signed off;
> content-sync + dead-code landmines + latent port methods DEFERRED). STRICT TDD:
> RED unit first, then GREEN, then the MERGE-BLOCKING integration proof.

## Review Workload Forecast

| Field                   | Value                                        |
| ----------------------- | -------------------------------------------- |
| Estimated changed lines | 150-250                                      |
| 400-line budget risk    | Low                                          |
| Chained PRs recommended | No                                           |
| Suggested split         | Single PR                                    |
| Delivery strategy       | single-pr                                    |
| Chain strategy          | pending (single sub-budget PR — no chaining) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                          | Likely PR | Focused test command                                                      | Runtime harness                                            | Rollback boundary                                                                          |
| ---- | --------------------------------------------- | --------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | Gate all 4 read surfaces by `callerAccountId` | PR 1      | `pnpm --filter @apps/api test:integration` (integration:tenant-isolation) | `bash apps/api/scripts/run-tests.sh` (TIER=pr-integration) | Single-revert PR — params thread over existing `project` FK; no migration/DI/schema change |

## Phase 1: RED — Failing unit tests (red-first)

- [x] 1.1 (R1) RED `GetPostUseCase.test.ts`: foreign `callerAccountId` → NOT_FOUND; owner returns post; assert `getById` called with scoped `AccountId`.
- [x] 1.2 (R1) RED `GetPostWithThreadQuery.test.ts`: foreign → NOT_FOUND; owner returns thread; assert `getByIdWithThread` called with `AccountId`.
- [x] 1.3 (R3) RED `ListPostsUseCase.test.ts`: foreign `projectId` → empty; owner returns own; assert `listByProject` called with `AccountId`.
- [x] 1.4 (R4) RED `ListPostsGlobalQuery.test.ts`: scoped to `callerAccountId`, returns only own; assert `listGlobal` called with `AccountId`.
- [x] 1.5 Update existing unit tests + ALL `PostQueryRepository` mocks/stubs to the new required signatures (compiler-enforced lockstep).

## Phase 2: GREEN — Implementation

- [x] 2.1 (R1,R3,R4) `PostRepository.ts`: add required `accountId: AccountId` param to `getById`, `getByIdWithThread`, `listByProject`, `listGlobal` on the `PostQueryRepository` port.
- [x] 2.2 (R1,R2,R3,R4) `PrismaPostQueryRepository.ts`: add `project: { accountId: accountId.value }` to the 4 WHEREs — single-get no-match → `EntityNotFoundError`; lists → empty page. Scope INSIDE the query, no separate existence lookup.
- [x] 2.3 (R1) `GetPostUseCase.ts` + `GetPostWithThreadQuery.ts`: required `callerAccountId` → `AccountId.fromString` → pass VO to repo.
- [x] 2.4 (R3,R4) `ListPostsUseCase.ts` + `ListPostsGlobalQuery.ts`: required `callerAccountId` → `AccountId` → pass to repo.
- [x] 2.5 (R5) `postRoutes.ts`: thread `request.customerUser.accountId` into `getPost`/`listPosts`; defensive 401 when `customerUser` absent (mirror `deletePost`). Never trust client `accountId`/`projectId` as a scope selector.

## Phase 3: Integration — MERGE-BLOCKING two-tenant proof

- [x] 3.1 Create `apps/api/tests/integration/postReadOwnership.test.ts`: seed tenants A + B (projects + posts); `app.inject` under `requireClientAuth` (node:test).
- [x] 3.2 (R1,R2) A cannot GET B's post (plain + thread) → NOT_FOUND; foreign id == nonexistent id (identical 404 status + body shape, never 403).
- [x] 3.3 (R3) A `GET /posts?projectId=<B's>` → 200 + `[]` (no B posts); owner sees own.
- [x] 3.4 (R4) A `GET /posts` (no projectId) → only A's posts, never B's.
- [x] 3.5 Wire `postReadOwnership.test.ts` into the `integration:tenant-isolation` batch in `apps/api/scripts/run-tests.sh` (lines 169-183).

## Phase 4: Gate (0/0)

- [x] 4.1 Unit suite green (`pnpm --filter @apps/api test`) + `integration:tenant-isolation` stable under contention (20/20).
- [x] 4.2 Full 0/0: `lint --max-warnings 0`, `tsc` (`NODE_OPTIONS=--max-old-space-size=6144`), the 24 fitness greps, tests.

## Apply notes — deviations beyond the design File Changes

Two production files not listed in the design's File Changes were touched because the
required port-signature change (getById/getByIdWithThread/listByProject/listGlobal now
take a required `accountId`) and the end-to-end gate demanded it:

1. **`apps/api/src/cqrs/handlers/PostQueryGetList.ts` + `PostQuerySearchAnalytics.ts`**
   (dead, unmounted CQRS query handlers — `new CQRSIntegration` appears nowhere; PR #110
   removes them). They call the port methods DIRECTLY (bypassing the use cases), so the
   signature change breaks their compile. Made them fail-closed with `AccountId.generate()`
   (ephemeral account owning nothing → NOT_FOUND/empty) rather than fabricating auth or
   leaving tsc broken. No test-assertion churn (mocks ignore the arg). SearchPostsQueryHandler
   is unaffected (`search` is the deferred, unchanged method).

2. **`apps/api/src/lib/cache/cacheConfig.ts`** — MERGE-BLOCKING. `autoCacheMiddleware`
   response-caches `GET /posts` and `GET /posts/:id` on the `onRequest` hook (before
   `requireClientAuth` parses the principal), and the key omitted the caller account for
   customer auth — the owner's cached 200 was served to a foreign caller (a second read-IDOR
   surface + auth-bypass-on-HIT that fully defeats the query-layer gate). Added
   `header:authorization` to both post cache configs (the only account-discriminating value
   available at onRequest; the existing pattern for `/projects`, `/users/me`, `/mfa/status`).
   The integration test proves the leak was real: adapter direct calls all pass, but the
   HTTP path leaked until this fix. Same latent pattern likely affects other customer read
   routes (`GET:/channels`, `/templates`, `/analytics/*`) — OUT of scope, flagged as follow-up.
