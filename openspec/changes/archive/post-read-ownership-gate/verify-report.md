# Verification Report — post-read-ownership-gate

**Change**: `post-read-ownership-gate`
**Mode**: OpenSpec (file artifacts) · Strict TDD (apply phase)
**Branch**: `workstream/post-read-ownership-gate` (uncommitted working tree)
**Verdict**: **PASS**
**Executive summary**: 0 CRITICAL · 0 WARNING · 3 SUGGESTION. All 4 MERGE-BLOCKING
read surfaces are account-scoped, both apply-phase deviations are sound (cache fix
gives per-token isolation; dead CQRS handlers are genuinely unmounted and fail-closed),
and the full gate is green (unit 8030/8030, tsc 0, integration 10/10, fitness 0).

---

## Completeness

| Dimension                                | Status                                                    |
| ---------------------------------------- | --------------------------------------------------------- |
| Proposal / spec / design / tasks present | Yes (full artifact set)                                   |
| Tasks complete                           | 17/17 checked, match code state                           |
| Runtime evidence                         | Unit + typecheck + 10x integration executed independently |

## Build / Tests / Fitness evidence

| Check | Command | Result |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Unit suite | `pnpm --filter @apps/api test` | 510 files / **8030 pass / 0 fail**, exit 0 |
| Typecheck | `tsc -p apps/api/tsconfig.json --noEmit` (6144MB) | **0 errors**, exit 0 |
| Integration (10 consecutive) | `postReadOwnership.test.ts` (node:test, `--conditions development`, real Postgres+Redis @ omnipost-infra) | **10/10 runs, 6/6 subtests each, 0 fail, 0 cancel** |
| Fitness #3 (`any`) | grep domain/app/infra | 0 (note: `apps/api/src/domain                       | application`moved to`packages/core`; changed core files independently grep-clean) |
| Fitness #4 (raw throw) | grep domain/app | 0 |
| Fitness #8 (sprint/phase refs) | grep repo | 0 |
| Fitness #9 (@file header) | grep repo | 0 |
| Fitness #10 (@layer values) | grep repo | 0 |
| Fitness #23 (raw prisma) | grep api/workers | 0 |

## Spec compliance matrix

| Req | Requirement                                                         | Evidence                                                                                                                                                  | Status |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Ownership-scoped single read (plain + thread) → foreign = NOT_FOUND | `PrismaPostQueryRepository.getById`/`getByIdWithThread` WHERE `project:{accountId}`; use cases require `callerAccountId`; integration subtests 1-2        | PASS   |
| R2  | Anti-enum parity: foreign id == nonexistent id, never 403           | `EntityNotFoundError` → `USE_CASE_ERRORS.NOT_FOUND` → 404; no FORBIDDEN in read paths; integration `assert.deepEqual(foreign, nonexistent)` byte-identity | PASS   |
| R3  | Ownership-scoped by-project list; foreign projectId → empty         | `listByProject`/`buildWhereClause` WHERE `project:{accountId}`; integration subtest 4 (200 + [])                                                          | PASS   |
| R4  | Global unfiltered list not cross-tenant reachable (Option A)        | `listGlobal(accountId, ...)` WHERE `project:{accountId}`; route threads `customerUser.accountId`; integration subtest 6 (only A's posts)                  | PASS   |
| R5  | Read account derived from authenticated principal                   | `postRoutes` uses `request.customerUser.accountId`, defensive 401 when absent; `projectId` validated-not-trusted                                          | PASS   |

**REQUIRED `callerAccountId`**: all four use-case inputs declare `callerAccountId: string`
(non-optional) and the port declares `accountId: AccountId` as a required positional param.
A missed call site is a tsc error (proven: mocks/stubs updated in lockstep, tsc = 0). Not a
silent skip.

## Deviation review

### DEVIATION A — HTTP cache fix (`apps/api/src/lib/cache/cacheConfig.ts`) — SOUND

`autoCacheMiddleware` reads the response cache on the `onRequest` hook, before
`requireClientAuth` binds the principal. Pre-fix, `GET:/posts` and `GET:/posts/:id`
keyed without any account discriminator → owner's cached 200 served to a foreign caller
(second read-IDOR + auth-bypass-on-HIT). Fix adds `header:authorization` to both `varyBy`
lists. `generateApiCacheKey` appends `authorization=<raw bearer>` to the key, so account B
(distinct token) computes a DIFFERENT key than account A and can never HIT A's entry.
Verified sufficient for **per-token isolation**: to HIT A's entry you must present A's exact
token, which is itself A's auth credential — no cross-tenant bypass. Integration subtest
ordering proves the live regression is closed (B populates cache first, then A's read of the
same id still returns 404, not B's cached 200). Consistent with the existing
`/projects`, `/users/me`, `/mfa/status` pattern.

### DEVIATION B — dead CQRS handlers (`PostQueryGetList.ts`, `PostQuerySearchAnalytics.ts`) — SOUND

Confirmed genuinely DEAD: `new CQRSIntegration(` occurs nowhere in `apps/api/src`;
`createPostQueryHandlers` is called only inside `CQRSIntegration` (itself never
instantiated/registered). `AccountId.generate()` → `EntityId.generateUUID()` →
`randomUUID()` — a random valid UUID owning nothing, so the port query fails closed
(NOT_FOUND / empty page), never leaks. Not a tripwire (comments read "fails closed" /
"ephemeral account"; none of the 20 blocked words). Because the path is unmounted, the
ephemeral account cannot make any MOUNTED path fail. PR #110 removes these files.

## Design coherence

| Design decision                                  | Code state                                   | Coherent? |
| ------------------------------------------------ | -------------------------------------------- | --------- |
| Scope in query WHERE, not use case               | 4 WHEREs carry `project:{accountId}`         | Yes       |
| `callerAccountId` REQUIRED on 4 inputs           | Non-optional string; tsc-enforced            | Yes       |
| Global list Option A (scope by accountId)        | `listGlobal` scoped; route threads principal | Yes       |
| projectId list closes guard-naturally (200 + []) | `listByProject` returns empty page           | Yes       |
| No migration / DI / schema change                | Params thread over existing `project` FK     | Yes       |

## Issues

**CRITICAL** — none.

**WARNING** — none.

**SUGGESTION**

1. Cache-read runs before auth on `onRequest`; a HIT is served without re-validating the
   bearer, so a revoked token could still receive a cached response for up to TTL (5 min).
   Bounded and pre-existing (same for `/projects`, `/users/me`, `/mfa/status`); not
   cross-tenant. Consider documenting or shortening TTL for post reads.
2. The cache-HIT leak is guarded implicitly by integration subtest ordering (owner reads
   the target id first, foreign reads it second). Consider an explicit double-read assertion
   so the regression guard is order-independent and self-evident.
3. Latent unscoped port methods `search` / `getUpcoming` / `getRecentlyPublished` remain
   projectId-only. Verified unreachable by any mounted customer route today (`search` only
   via the dead CQRS handler; the other two have no callers). Scope or mark internal-only
   when next touched, per the design's deferred follow-ups. Same latent cache pattern on
   other customer read routes (`/channels`, `/templates`, `/analytics/*`) is flagged in the
   apply notes — out of scope here.

## Verdict

**PASS** — ready for archive. All 4 MERGE-BLOCKING requirements proven by a real-DB
two-tenant HTTP integration test (10/10 stable), both deviations are safe and fail-closed,
and the 0/0 gate holds.
