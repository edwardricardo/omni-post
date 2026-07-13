# Verification Report — trackedlink-idor-fix (N-SEC-3)

- **Change**: `trackedlink-idor-fix` — close the live CWE-639 IDOR on TrackedLink
- **Mode**: Full SDD (proposal + spec + design + tasks) · Strict TDD · engram+openspec (hybrid inputs)
- **Branch**: `workstream/cluster-c-tenant-scoping`
- **Verdict**: **PASS** (0 CRITICAL · 0 WARNING · 1 SUGGESTION)
- **Date**: 2026-07-13

## Completeness (tasks.md)

| Phase             | Tasks         | State | Independently confirmed                                                                      |
| ----------------- | ------------- | ----- | -------------------------------------------------------------------------------------------- |
| 0 Pre-flight      | 0.1, 0.2      | `[x]` | CQRSIntegration zero source wiring; no sensitive-glob edit                                   |
| 1 RED test        | 1.1, 1.2      | `[x]` | Test file exists, 8 cases, node:test, `createApp()`+`app.inject`                             |
| 2 GREEN adapter   | 2.1, 2.2, 2.3 | `[x]` | `findById`+`delete` scoped via `findFirst`; public methods left unscoped                     |
| 3 Dead-code + doc | 3.1, 3.2      | `[x]` | 4 files deleted; doc Layer 3 corrected                                                       |
| 4 0-defect gate   | 4.1, 4.2, 4.3 | `[x]` | tsc 0, eslint 0, fitness #21/#23 = 0, test green                                             |
| 5 Harden pass     | 5.1–5.4       | `[x]` | `getClickStats` scoped; body-identity on stats+utm-url; UTM write guard; design refs partial |

All 18 tasks `[x]` and independently confirmed implemented (not merely checked).

## Build / Test / Static evidence

| Check                                                      | Command                                                                                      | Result                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Integration test                                           | `node --import tsx --conditions development --test --test-force-exit` on the isolation suite | **8 pass / 0 fail / 0 cancelled / 0 skipped** (duration ~4.8s) |
| Type-check                                                 | `pnpm exec tsc --noEmit` (apps/api)                                                          | **0 errors**                                                   |
| Lint                                                       | `eslint --max-warnings 0` on the 2 touched `.ts`                                             | **clean (exit 0)**                                             |
| Fitness #21 (no Prisma singleton outside composition root) | CLAUDE.md grep                                                                               | **0**                                                          |
| Fitness #23 (no raw queries outside guard)                 | CLAUDE.md grep                                                                               | **0**                                                          |
| Fitness #9 (`@file`)                                       | both touched files                                                                           | **present**                                                    |
| Fitness #10 (`@layer`)                                     | both touched files                                                                           | **`infrastructure` (valid)**                                   |

## Spec compliance matrix

| Req                                    | Type               | Covering evidence                                                                                                                                                                                                                   | Status            |
| -------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Ownership-scoped resolution            | **MERGE-BLOCKING** | `findFirst({ where:{ id, project:{ accountId: requireTenantContext().accountId } } })` on `findById`/`delete`/`getClickStats`; test "resolves the owner's own link" (2xx ×3) + "returns 404 for a foreign-account link id" (404 ×3) | **PASS (tested)** |
| Anti-enumeration                       | **MERGE-BLOCKING** | Foreign & nonexistent both miss the scoped query → same `EntityNotFoundError`; test "makes a foreign id indistinguishable" asserts byte-identical bodies via `normalizeBody` on GET, DELETE, `/stats`, `/utm-url`                   | **PASS (tested)** |
| No destructive cross-tenant effect     | **MERGE-BLOCKING** | `delete` returns `err` BEFORE `$transaction` on foreign id; test "does not remove tenant B's link or its click rows" confirms link + N `LinkClick` rows intact after foreign DELETE 404                                             | **PASS (tested)** |
| Account from bound context, not caller | requirement        | `accountId` sourced only from `requireTenantContext().accountId` in the `where`; port signature, `@core` use cases and routes unchanged — no omittable account arg exists                                                           | **PASS (source)** |
| CQRS publish primitive removed         | requirement        | `CQRSIntegration.ts` + 3 unit tests deleted; `grep CQRSIntegration` on `apps/*/src` + `packages/*/src` = 0; `CQRSBus.ts`/`PostCommandHandlers.ts`/`PostQueryHandlers.ts` preserved (saga path)                                      | **PASS (source)** |
| Documentation truth                    | doc requirement    | `MULTI_TENANT_GUARDS.md` Layer 3 (lines 91–101) now states #23 blocks raw `$queryRaw`/`$executeRaw` only and explicitly does NOT scan typed adapters for a missing join                                                             | **PASS (source)** |

## Design coherence

- **Seam A** (adapter resolves account internally) implemented exactly: `requireTenantContext()` imported apps/api→apps/api, no `@core` churn. ✓
- **NOT_FOUND, no FORBIDDEN branch**: confirmed — single `EntityNotFoundError` path, no "exists?" probe. ✓
- **TOP TRAP honored**: `findByShortCode` (public redirect) and `recordClick` left UNSCOPED — 0 `requireTenantContext` calls inside them; public no-auth `GET /r/:shortCode` → 302 passes. The adapter has exactly 1 import + 3 scoped call sites (`findById`, `delete`, `getClickStats`). ✓
- **getClickStats scoped by construction** (harden §1): confirmed — scoped `findFirst` returns empty stats before reading `linkClick`; repo-level RED→GREEN test with a plain (unguarded) client proves isolation rests solely on the transitive join. ✓

## Issues

### CRITICAL — none

### WARNING — none

### SUGGESTION

1. **design.md caller-safety table has stale route line-refs (documentation-only drift, non-blocking).** The use-case symbol refs are exact (`GetTrackedLinkUseCase.ts:34`, `GetLinkStatsUseCase.ts:30/44`, `DeleteTrackedLinkUseCase.ts:39/52`, `GenerateUTMLinksUseCase.ts:92` all verified). The route-registration refs are ~2–3 lines off: `linkRoutes.ts:243/251/259` vs actual `240-241/249/257`, and `utmRoutes.ts:174` vs actual `171-172`; the NOT_FOUND decision block cites `PrismaTrackedLinkRepository.ts:95,113` vs actual `105/123`. The harden pass (§5.4) fixed the UTM path/name, not the numeric route lines. No spec or behavior impact — the shipped code is correct and tested. Optional cleanup before archive.

## Verdict

**PASS.** All 3 MERGE-BLOCKING requirements are proven by a real-DB two-tenant integration test (8/8 green), the 3 non-blocking requirements (4/5/6) are confirmed at source, and the 0/0 gate holds (tsc 0, eslint 0, fitness #21/#23 = 0). The single SUGGESTION is documentation line-ref drift with no code impact and does not block archive.

**Next recommended**: `sdd-archive`.
