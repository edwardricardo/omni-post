# Proposal: TrackedLink IDOR Fix (N-SEC-3 primary)

## Intent

A LIVE cross-tenant IDOR is exploitable in production TODAY. An authenticated tenant A, using A's own valid JWT, can call `DELETE /links/{tenantB_link_id}` and delete tenant B's tracked link plus every `LinkClick` row (cascade). The same hole reads B's data via `GET /links/:id` (originalUrl/target) and `GET /links/:id/stats` (click analytics). `requireClientAuth` binds a TenantContext but is INERT because `TrackedLink` is in neither tenant-isolation layer (Prisma `$extends` guard nor RLS — exploration §1, §3). The handlers pass `params.id` straight to use cases that take `{ linkId }` only and hit `findUnique({ where: { id } })` / `delete({ where: { id } })` with no ownership filter (verified: `linkRoutes.ts:108,133,158`; `PrismaTrackedLinkRepository.ts:90,148,161`). CWE-639. Blast radius: cross-tenant link-data read, click-analytics read, and a destructive cross-tenant delete. This slice ships ahead of the larger `accountId` denormalization because the hole is live and cheap to close now.

## Scope

### In Scope

- Ownership filter on the 3 TrackedLink operations (`GetTrackedLinkUseCase`, `GetLinkStatsUseCase`, `DeleteTrackedLinkUseCase` in `packages/core/links/src/` + `PrismaTrackedLinkRepository`) via the documented transitive join `where: { id, project: { accountId } }`, sourced from the sanctioned `requireTenantContext()` path.
- A foreign link id MUST resolve to NOT_FOUND (404) — never leaked, never deleted (anti-enumeration; do not return FORBIDDEN).
- Delete the unwired `/api/cqrs/*` route (`apps/api/src/cqrs/CQRSIntegration.ts`) — dead code (zero non-test wiring, verified) and a latent cross-tenant PUBLISH primitive.
- Correct the phantom-control paragraph in `MULTI_TENANT_GUARDS.md` Layer 3 (lines 86-100): fitness #23 does NOT scan typed-Prisma adapters for missing joins; it only blocks raw queries.

### Out of Scope

- `accountId` denormalization on the 9 projectId-only models → separate `project-scoped-tenant-guard` change.
- The AI response-cache cross-tenant leak (N-SEC-4) → its own slice.
- The other 8 projectId-only adapters (Channel, Post, Campaign, etc.). This slice is TrackedLink-only plus the two bundled decisions.

## Capabilities

### New Capabilities

- `trackedlink-tenant-isolation`: every TrackedLink read/delete resolves only within the caller's account; foreign ids return 404.

### Modified Capabilities

None.

## Approach

Compensating transitive join, applied now (exploration §6). The invariant: **no link operation resolves a TrackedLink without an accountId ownership filter.** The repository queries `where: { id, project: { accountId: requireTenantContext().accountId } }` (MULTI_TENANT_GUARDS.md §Transitively-scoped pattern). The design phase picks the exact seam — thread `accountId` through use case + repo signatures, OR resolve inside the repo via `requireTenantContext()` — but the account MUST come from the bound TenantContext (already present via `requireClientAuth`), never a caller-suppliable param. The `/api/cqrs/*` route is deleted outright; fallback if deletion snags is to gate it (preference: delete). The doc paragraph is corrected to state #23's real scope.

## Affected Areas

| Area                                                                      | Impact   | Description                                              |
| ------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `packages/core/links/src/{Get,GetLinkStats,Delete}TrackedLinkUseCase.ts`  | Modified | Add accountId ownership to the resolve/delete path       |
| `apps/api/src/infrastructure/repositories/PrismaTrackedLinkRepository.ts` | Modified | `findById`/`delete` gain `project: { accountId }` filter |
| `packages/core/domain/src/repositories/TrackedLinkRepository.ts`          | Modified | Port signature if accountId is threaded (design decides) |
| `apps/api/src/links/linkRoutes.ts`                                        | Modified | Wire account context to use cases if threaded            |
| `apps/api/src/cqrs/CQRSIntegration.ts`                                    | Removed  | Delete dead route + its 3 unit tests                     |
| `docs/security/MULTI_TENANT_GUARDS.md`                                    | Modified | Correct phantom fitness-#23 claim (lines 86-100)         |
| `apps/api/tests/integration/`                                             | New      | Cross-tenant 404 proof across all 3 routes               |

## Risks

| Risk                                                              | Likelihood | Mitigation                                                                                                                               |
| ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled accountId param a caller could omit re-opens the hole | Med        | Use the SANCTIONED `requireTenantContext()` path (`tenantContext.ts:102`); no optional/caller-suppliable account arg on the guarded path |
| Deleting `/api/cqrs/*` breaks a real consumer                     | Low        | Pre-apply check: `new CQRSIntegration` has ZERO non-test matches (verified); only 3 test files reference it — delete those too           |
| Owner path regresses (legit reads return 404)                     | Med        | Integration test: same-account owner still succeeds on all 3 routes                                                                      |
| Fitness #23 hard-zero regressed by the join change                | Low        | Change touches typed Prisma only (no raw `$queryRaw`); #23/#21 stay hard-zero                                                            |

## Rollback Plan

Single change, no migration, no schema change. Revert the commit(s): use-case/repo diff, the CQRS file deletion, and the doc edit are independent and individually revertible. No data migration to unwind. Restoring `CQRSIntegration.ts` from git history re-adds the dead route if ever needed.

## Dependencies

- Shared security exploration `openspec/changes/project-scoped-tenant-guard/exploration.md` (§4 confirms the IDOR, §6 settles this approach).
- `requireTenantContext()` (`apps/api/src/security/tenantContext.ts:102`) — already in the codebase.

## Success Criteria

- [x] Integration test: tenant A gets 404 (not the link body, not a delete) for tenant B's link id on `GET /links/:id`, `GET /links/:id/stats`, and `DELETE /links/:id`.
- [x] Same-account owner still succeeds on all 3 routes.
- [x] Foreign `DELETE` does NOT trigger the `LinkClick` cascade (B's clicks intact).
- [x] `/api/cqrs/*` returns 404 (route gone; CQRSIntegration + its 3 tests removed; zero non-test wiring confirmed pre-apply).
- [x] `MULTI_TENANT_GUARDS.md` Layer 3 paragraph corrected (no longer claims #23 scans typed adapters).
- [x] Ownership filter uses `requireTenantContext()`, not a caller-suppliable accountId arg.
- [x] 0-defect gate: `tsc` clean, `eslint --max-warnings 0`, fitness #21 + #23 hard-zero, LXC-safe test runs.
