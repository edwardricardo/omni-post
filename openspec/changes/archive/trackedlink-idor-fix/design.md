# Design: TrackedLink IDOR Fix (N-SEC-3 primary)

## Technical Approach

Close the live CWE-639 IDOR (exploration §4) by adding the sanctioned transitive
ownership join — `where: { id, project: { accountId } }` — to the ONLY two repository
methods reachable by an authenticated owner-by-id path: `PrismaTrackedLinkRepository.findById`
and `.delete`. The `accountId` is resolved INSIDE the adapter from `requireTenantContext()`
(`apps/api/src/security/tenantContext.ts:102`), never from client input. Port signature,
the five `@core/links` use cases, and every route stay UNCHANGED. This mirrors how the
50 tenant-scoped models are already scoped and the documented pattern in
`MULTI_TENANT_GUARDS.md:147-158`.

## Architecture Decisions

### Decision: Seam A — adapter resolves the account internally

| Option                                                            | Touches `@core`?                    | Matches house pattern                       | Verdict    |
| ----------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- | ---------- |
| **A — repo calls `requireTenantContext()`**                       | No (`@core` stays free of apps/api) | Yes — same as the 50 scoped models          | **CHOSEN** |
| B — thread `accountId` through port + use-case + route signatures | Yes — port, 3 use cases, 2 routes   | No; adds an omittable arg (spec req 4 risk) | Rejected   |

**Rationale**: `requireTenantContext` lives in `apps/api`; the ADAPTER (also `apps/api`)
may import it, a `@core` use case may NOT (hexagonal — `@core` never imports `apps/api`).
Seam A is a 2-method adapter-local change with zero signature churn and no
caller-suppliable account arg (satisfies spec req 4 by construction). Seam B spreads an
optional param across layers — the exact "omit re-opens the hole" hazard the proposal Risks
call out.

### Decision: NOT_FOUND (anti-enumeration), no FORBIDDEN branch

Foreign id and nonexistent id both miss the scoped `findFirst` → both return the SAME
`EntityNotFoundError` (`PrismaTrackedLinkRepository.ts:105,123`) → use case wraps as
`USE_CASE_ERRORS.NOT_FOUND` (`GetTrackedLinkUseCase.ts:37`, `GetLinkStatsUseCase.ts:33`,
`DeleteTrackedLinkUseCase.ts:42`) → route `sendError(ctx, 404, …)` (`linkRoutes.ts:111,136,163`).
No new FORBIDDEN branch, no pre-`findFirst` "exists?" probe. The `not found: ${id}` message
echoes the requested id identically in both cases — no distinguishable signal (spec req 2).

### Decision: delete the unwired CQRS route outright

`CQRSIntegration.ts` is instantiated ONLY in tests (`rg 'new CQRSIntegration'` → 3 test files,
zero src). No src file imports it (`rg import CQRSIntegration apps/api/src` → 0). Its
handlers/bus (`CQRSBus.ts`, `handlers/PostCommandHandlers.ts`, `PostQueryHandlers.ts`) have
INDEPENDENT live consumers via the saga bus in `index.ts:632,659` + `SagaIntegration.ts:40` —
so deleting `CQRSIntegration.ts` orphans nothing. Delete file + its 3 tests.

## MANDATORY caller-safety analysis

Seam A only breaks a caller if it invokes a NEWLY-scoped method (`findById`/`delete`) WITHOUT
a bound TenantContext. Full enumeration of every caller of every repo method:

| Method                          | Caller (`file:line`)                                                                                                            | Under bound context?                                       | Treatment                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `findById`                      | `GetTrackedLinkUseCase.ts:34` ← `GET /links/:id` `linkRoutes.ts:240-241` (`requireClientAuth`)                                  | YES                                                        | **SCOPE**                                       |
| `findById`                      | `GetLinkStatsUseCase.ts:30` ← `GET /links/:id/stats` `linkRoutes.ts:249`                                                        | YES                                                        | **SCOPE**                                       |
| `findById`                      | `DeleteTrackedLinkUseCase.ts:39` ← `DELETE /links/:id` `linkRoutes.ts:257`                                                      | YES                                                        | **SCOPE**                                       |
| `findById`                      | `@core/utm/GenerateUTMLinksUseCase.ts:92` ← `POST /links/:id/utm` `apps/api/src/utm/utmRoutes.ts:171-172` (`requireClientAuth`) | YES                                                        | **SCOPE** (bonus: closes latent UTM write IDOR) |
| `delete`                        | `DeleteTrackedLinkUseCase.ts:52` ← same as above                                                                                | YES                                                        | **SCOPE**                                       |
| `findByShortCode`               | `RedirectAndTrackClickUseCase.ts:30` ← **public** `GET /r/:shortCode` `linkRoutes.ts:266-270` (NO preHandler)                   | **NO**                                                     | **LEAVE UNSCOPED — the trap**                   |
| `recordClick`                   | `RedirectAndTrackClickUseCase.ts:65` ← same public path                                                                         | **NO**                                                     | LEAVE UNSCOPED                                  |
| `getClickStats`                 | `@core/links/GetLinkStatsUseCase.ts:44` (after the scoped `findById:30` gate) + any future direct caller                        | YES                                                        | **SCOPE (scoped by construction)**              |
| `isShortCodeAvailable` / `save` | `CreateTrackedLinkUseCase.ts:48`, `GenerateUTMLinksUseCase.ts:106` — resolve by slug/after scoped read                          | YES                                                        | out of scope (not id-IDOR surface)              |
| any                             | `apps/workers/**`                                                                                                               | none — `rg` on workers for TrackedLink/LinkClick → 0 files | n/a                                             |

**TOP TRAP (verdict):** the public redirect resolves a link by short code for an
UNAUTHENTICATED visitor with NO account. Scoping `findByShortCode` would throw
`TenantContextMissingError` on EVERY public click. Seam A must scope ONLY the two
owner-by-id methods and leave short-code resolution + `recordClick` untouched. Confirmed:
no owner-by-id caller runs without context; no public/worker caller touches `findById`/`delete`.

## Data Flow

    Owner:  requireClientAuth → enterTenantContext({accountId})  ─┐
      GET/DELETE /links/:id → UseCase → repo.findById/delete      │→ where:{id, project:{accountId}}
                                          requireTenantContext() ─┘   miss → NOT_FOUND(404)

    Public: GET /r/:shortCode (no auth) → RedirectUseCase → repo.findByShortCode  (UNSCOPED — resolves for anyone)

## Exact code diff shape (`PrismaTrackedLinkRepository.ts`)

Add `import { requireTenantContext } from "../../security/tenantContext.js";` (apps/api→apps/api, hexagonal-clean).

- **`findById` (89-99)**: `findUnique({ where: { id } })` → `findFirst({ where: { id: id.value, project: { accountId: requireTenantContext().accountId } } })`. `findUnique` CANNOT take a relation filter (unique-fields only) — the switch to `findFirst` is required, matching `MULTI_TENANT_GUARDS.md:149`.
- **`delete` (147-164)**: the existence pre-check `findUnique({ where: { id } })` (148-150) → `findFirst({ where: { id: id.value, project: { accountId: requireTenantContext().accountId } } })`. Foreign → `null` → `err(EntityNotFoundError)` returns BEFORE the `$transaction` (157-164), so the `linkClick.deleteMany` cascade never runs (spec req 3). The `$transaction` body is unchanged (deletes by `id.value`; ownership already proven by the scoped pre-check).
- **`getClickStats` (~225)**: the unscoped `findUnique({ where: { id }, select: { clicks } })` (inside the original `Promise.all`) → scoped `findFirst({ where: { id: id.value, project: { accountId: requireTenantContext().accountId } } })`. Foreign/nonexistent → return the empty `{ totalClicks: 0, clicksByCountry: {} }` BEFORE reading `linkClick` (the `Promise.all` is split into a sequential lookup-then-clicks so no click row is read for a link the caller does not own). Scoped by construction — closes the latent IDOR-reopener for any future direct caller (harden pass §1).

Unchanged: port `TrackedLinkRepository.ts` (no signature change), all `@core` use cases, all routes, DI wiring (`setupLinkUseCases.ts`, `setupRepositories.ts:222-224`).

## File Changes

| File                                                                        | Action | Description                                                                               |
| --------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/repositories/PrismaTrackedLinkRepository.ts`   | Modify | Scope `findById` + `delete` pre-check + `getClickStats` via `requireTenantContext()` join |
| `apps/api/src/cqrs/CQRSIntegration.ts`                                      | Delete | Dead `/api/cqrs/*` route (zero src wiring)                                                |
| `apps/api/tests/unit/CQRSIntegration.test.ts`                               | Delete | Test of deleted file                                                                      |
| `apps/api/tests/unit/cqrsIntegration.system-errors-cache-shutdown.test.ts`  | Delete | Test of deleted file                                                                      |
| `apps/api/tests/unit/cqrsIntegration.init-commands-queries.test.ts`         | Delete | Test of deleted file                                                                      |
| `docs/security/MULTI_TENANT_GUARDS.md`                                      | Modify | Correct Layer 3 lines 86-100 (fitness #23 scope)                                          |
| `apps/api/tests/integration/trackedLinkTenantIsolation.integration.test.ts` | Create | Two-tenant real-DB IDOR proof                                                             |

## Doc correction (`MULTI_TENANT_GUARDS.md` Layer 3, lines 86-100)

Replace the false claim that #23 "catches the antipattern of a Prisma adapter … that doesn't
include `accountId` in its `where`" with the truth: **fitness #23 blocks raw
`$queryRaw`/`$executeRaw` outside the tenant-guard exceptions only; it does NOT scan
typed-Prisma adapters for a missing transitive join. Enforcement of the compensating join on
transitively-scoped tables rests on adapter code + integration tests, not a CI grep.**

## Testing Strategy

| Layer                            | What                  | Approach                                                                                                                                                                    |
| -------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration (node:test, real DB) | 3 MERGE-BLOCKING reqs | One LXC-safe file, two-tenant fixture (accounts A+B, project+link+N LinkClicks each), `signCustomerAccessToken`/`bearerFor(accountId)` harness (`linkRoutes.test.ts:19,29`) |

Cases: (1) owner A → 2xx on `GET/:id`, `GET/:id/stats`, `DELETE/:id`; (2) A → 404 on all three
against B's link id; (3) 404 for a random nonexistent id is byte-identical to (2); (4) after
foreign `DELETE`, B's link AND all N `LinkClick` rows still present (regression proof the
cascade did not fire); (5) **public `GET /r/:shortCode` with NO auth header still 302-redirects
for B's link** — the regression proof Seam A did not break public links. Mock unit tests cannot
catch a missing WHERE (stub returns regardless) — real DB is mandatory (spec Verification note).

## Fitness matrix

| #   | Concern                                   | Status after change                                                                                                                       |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #21 | Prisma singleton only in composition root | Unchanged — adapter still receives `PrismaClient` by ctor (`setupRepositories.ts:224`); imports `requireTenantContext`, not the singleton |
| #23 | No raw queries outside guard              | Typed `findFirst`/`$transaction(deleteMany,delete)` only — no `$queryRaw`; stays hard-zero                                                |
| #3  | No `any`                                  | New code uses typed `where`; no `any`                                                                                                     |
| #9  | `@file` header                            | Files retain headers; no new source file except the test (gets `@file`/`@layer infrastructure`)                                           |
| #10 | Valid `@layer`                            | Adapter stays `@layer infrastructure`                                                                                                     |

## Migration / Rollout

No schema change, no migration, no feature flag. Three independently revertible edits
(adapter diff, CQRS deletion, doc edit). Restoring `CQRSIntegration.ts` from git history
re-adds the dead route if ever needed.

## Open Questions

- [x] None blocking. (Resolved in the harden pass: `getClickStats` is now scoped by
      construction with the same transitive `project.accountId` join. Rather than relying on
      the preceding `findById` gate — safe-by-convention — the method refuses foreign ids
      directly, so a future direct caller cannot re-open the IDOR.)
