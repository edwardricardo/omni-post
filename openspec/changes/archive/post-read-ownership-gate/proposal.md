# Proposal: Post Read Ownership Gate

## Intent

Live cross-tenant **read** IDOR (CWE-639) on main. Post has no direct `accountId` and is NOT in `TENANT_SCOPED_MODELS` (Slice 8 pending), so neither the Prisma `$extends` guard nor any where-clause scopes these reads. Slice 0 (#112) gated only DELETE; reads stayed open. Confirmed customer-reachable (all under `requireClientAuth`) unscoped surfaces:

- **`GET /posts/:id`** → `getPostWithThreadQuery` → `PrismaPostQueryRepository.getByIdWithThread` (`where: { id, deletedAt: null }`) — id-only, any tenant reads any post/thread.
- **`GET /posts` (no projectId)** → `ListPostsGlobalQuery.listGlobal` (`where: { deletedAt: null }`) — returns **ALL posts across ALL accounts**. Bulk cross-tenant dump.
- **`GET /posts?projectId=<foreign>`** → `ListPostsUseCase` — projectId is **client-supplied and unverified** (`ListPostsQuerySchema.projectId`, route line ~160). NOT safe: a customer reads any account's project by guessing its id.
- `GetPostUseCase.getById` (`where: { id, deletedAt: null }`) — same id-only gap; gate for parity.

Interim app-level gate until Slice 8 enrolls Post structurally.

## Scope

### In Scope

- Thread server-derived `callerAccountId` (from `request.customerUser.accountId`, never client input) into the read use cases/queries above.
- Scope query WHERE by transitive `project: { accountId: caller }` on `getById`, `getByIdWithThread`, the global list (or restrict admin-only), and verify `projectId` ownership on the by-project list.
- Foreign/nonexistent → NOT_FOUND (anti-enumeration); keep CQRS read-side discipline (single scoped query, no separate lookup).
- Unit + two-tenant integration tests.

### Out of Scope

- **Slice 8** structural Post enrollment (accountId column / guard relation-scoping) — the durable fix.
- **PR #97 wholesale** — bundles this with superseded tenant-guard work + §2F provider-classifier (flagged DO-NOT-SHIP). Extract ONLY the clean read gate.
- §2F work; UPDATE-post authz (already gated at `updatePost`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `post-tenant-isolation`: extend caller-account ownership gating from mutations to customer-facing post **read** surfaces.

## Approach

Push `caller.accountId` into the query WHERE via the `project.accountId` relation so foreign rows never match → repo returns `EntityNotFoundError` → use case maps to NOT_FOUND naturally (no FORBIDDEN, no enumeration). Mirrors Slice 0's server-derived-accountId + NOT_FOUND discipline, adapted to the read side.

## Affected Areas

| Area                                                                                                                       | Impact       | Description                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------- |
| `packages/core/posts/src/GetPostUseCase.ts`, `GetPostWithThreadQuery.ts`, `ListPostsGlobalQuery.ts`, `ListPostsUseCase.ts` | Modified     | Add required `callerAccountId`, pass to repo |
| `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts`                                                    | Modified     | `project: { accountId }` in scoped WHEREs    |
| `apps/api/src/posts/postRoutes.ts`                                                                                         | Modified     | Pass `request.customerUser.accountId`        |
| `apps/api/tests/{unit,integration}/`                                                                                       | New/Modified | Gate + two-tenant IDOR-closure tests         |

## Risks

| Risk                                        | Likelihood  | Mitigation                                                  |
| ------------------------------------------- | ----------- | ----------------------------------------------------------- |
| Transitive `project` join adds read latency | Low         | Indexed FK; single query, no N+1                            |
| A customer-reachable read surface missed    | Med         | Enumerate every `requireClientAuth` post-read route in spec |
| Global-list still leaks if left unscoped    | High→closed | Scope by accountId OR flip to admin-only preHandler         |

## Rollback Plan

Single revert of the change commit. No schema/DI/migration changes; params thread through existing DTOs.

## Dependencies

None. `customerUser.accountId` already bound by `requireClientAuth`; `project.accountId` relation exists.

## Success Criteria

- [ ] Foreign `GET /posts/:id`, thread, global list, and by-project list return 404/empty identical to nonexistent.
- [ ] Owner reads unchanged.
- [ ] Slicing: one focused PR (~150–250 lines). Unit + integration + lint/tsc/fitness at 0/0.
