# Tasks: TrackedLink IDOR Fix (N-SEC-3)

## Review Workload Forecast

| Field                   | Value                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| Estimated changed lines | ~2340 raw (~180 review-bearing logic + ~2160 pure dead-code deletion)   |
| 400-line budget risk    | High (raw, deletion-dominated) — Low for the security logic             |
| Chained PRs recommended | Yes                                                                     |
| Suggested split         | PR 1 security fix (~180 lines) → PR 2 dead-code purge (~2160 deletions) |
| Delivery strategy       | ask-on-risk                                                             |
| Chain strategy          | stacked-to-main (two independent slices)                                |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

> The >400 raw count is ENTIRELY the CQRSIntegration dead-code deletion (2160 lines, zero non-test wiring). It carries near-zero review cognitive load. The security-bearing diff is ~180 lines. Splitting keeps the MERGE-BLOCKING security review clean; the two units are orthogonal (order-independent). A single PR with `size:exception` is also acceptable if the maintainer prefers.

### Suggested Work Units

| Unit | Goal                                                        | Likely PR | Notes                                                       |
| ---- | ----------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| 1    | TrackedLink ownership scoping + integration proof + doc fix | PR 1      | base = tracker branch; MERGE-BLOCKING; tests + doc included |
| 2    | Delete unwired `/api/cqrs/*` + its 3 tests                  | PR 2      | independent of PR 1; pure dead-code removal                 |

### Sensitive-edit token

No sensitive-edit token required. Edited paths — `infrastructure/repositories/PrismaTrackedLinkRepository.ts`, `cqrs/CQRSIntegration.ts` (delete), `tests/unit/*`, `tests/integration/*`, `docs/security/MULTI_TENANT_GUARDS.md` — are NONE of `apps/api/src/auth/**`, `admin/auth/**`, `apps/api/src/security/**`, `infra/prisma/**`. The adapter IMPORTS `../../security/tenantContext.js` but does not EDIT it (importing ≠ editing). The doc is markdown under `docs/`, not a `security/**` source path.

## Phase 0: Pre-flight (no code)

- [x] 0.1 (R5) Confirm CQRSIntegration has ZERO non-test wiring: `rg "CQRSIntegration" apps/api/src` returns only the file itself; `rg "new CQRSIntegration" apps/api/src` → 0. Abort deletion if any src consumer appears.
- [x] 0.2 Confirm no edited file is under a sensitive glob (see table above) → record "no sensitive-edit token required".

## Phase 1: RED — failing cross-tenant integration test

- [x] 1.1 (R1,R2,R3 + public-redirect regression) Create `apps/api/tests/integration/trackedLinkTenantIsolation.integration.test.ts` (`@file`/`@layer infrastructure`, node:test). Boot in-process via `createApp()` (`../../src/index.js`) + `app.inject`, headers `{ authorization: bearerFor(accountId) }` (harness `signCustomerAccessToken`, mirror `linkRoutes.test.ts:19,29`). Do NOT use the `checkApiAvailable`/live-server fetch pattern — it silently SKIPS (false green). Two-tenant fixture: accounts A+B, one project+link+N `LinkClick` each. Assert: (a) owner A → 2xx on `GET /links/:id`, `/stats`, `DELETE /links/:id`; (b) A → 404 on all 3 vs B's id; (c) B's id 404 is byte-identical to a random nonexistent id; (d) after foreign DELETE, B's link + all N clicks intact; (e) UNAUTHENTICATED `GET /r/:shortCode` still 302 for B's link.
- [x] 1.2 Run RED: `pnpm db:up` then `cd apps/api && node --import tsx --conditions development --test --test-force-exit tests/integration/trackedLinkTenantIsolation.integration.test.ts`. Expect FAIL on (b)/(c)/(d) — no ownership filter yet; owner (a) and public (e) already pass.

## Phase 2: GREEN — adapter scoping (`PrismaTrackedLinkRepository.ts`)

- [x] 2.1 (R1,R2,R4) Add `import { requireTenantContext } from "../../security/tenantContext.js";`. `findById` (89-99): `findUnique({ where:{ id } })` → `findFirst({ where:{ id: id.value, project:{ accountId: requireTenantContext().accountId } } })`. Foreign/nonexistent both miss → same `EntityNotFoundError`.
- [x] 2.2 (R3,R4) `delete` (147-164): existence pre-check `findUnique` (148-150) → same scoped `findFirst`; foreign → `null` → `err(EntityNotFoundError)` returned BEFORE the `$transaction` cascade. `$transaction` body unchanged. Leave `findByShortCode`/`recordClick` UNSCOPED (public path). Port + `@core/links` use cases + routes UNCHANGED (W2: `GetTrackedLinkUseCase` is also consumed by `GET /links/:id/utm-url` `utmRoutes.ts:183` under `requireClientAuth` — scoping closes that latent UTM IDOR too; no extra edit needed).
- [x] 2.3 Run GREEN: same command as 1.2 → all assertions pass, public 302 preserved.

## Phase 3: Dead-code + doc

- [x] 3.1 (R5) Delete `apps/api/src/cqrs/CQRSIntegration.ts` + `tests/unit/CQRSIntegration.test.ts` + `tests/unit/cqrsIntegration.system-errors-cache-shutdown.test.ts` + `tests/unit/cqrsIntegration.init-commands-queries.test.ts`.
- [x] 3.2 (R6) Correct `docs/security/MULTI_TENANT_GUARDS.md` lines 86-100: #23 blocks raw `$queryRaw`/`$executeRaw` outside guard exceptions ONLY; it does NOT scan typed-Prisma adapters for a missing join.

## Phase 4: 0-defect gate

- [x] 4.1 `cd apps/api && pnpm exec tsc --noEmit` (0 errors; `@core/links` untouched) + `pnpm exec eslint --max-warnings 0` on changed files.
- [x] 4.2 Fitness #21 + #23 hard-zero (typed Prisma only; adapter still receives `PrismaClient` by ctor, imports `requireTenantContext` not the singleton).
- [x] 4.3 Integration test green including public-redirect regression (e); LXC-safe run per 1.2.

## Phase 5: Harden pass (post-adversarial-gate, folded into slice 1)

The adversarial gate PASSED (0 CRITICAL, 0 confirmed WARNING) and surfaced 4 security/test SUGGESTIONs, all on the slice-1 surface.

- [x] 5.1 (harden §1) Scope `getClickStats` by construction: unscoped `findUnique` → scoped `findFirst` on `project.accountId`, returning the empty stats result before reading `linkClick`. RED→GREEN proven at the repository level (a plain test client so isolation rests solely on the join): foreign context leaked B's clicks (`1 !== 0`) before, returns empty after; owner path still reads B's rows. Update `design.md` — row is now "scoped by construction".
- [x] 5.2 (harden §2) Extend the byte-identical anti-enumeration body assertion (not just statusCode) to `GET /links/:id/stats` and `GET /links/:id/utm-url` via `normalizeBody`.
- [x] 5.3 (harden §3) Add the mutating UTM write-path regression guard: tenant A `POST /links/{B_id}/utm` → 404 AND tenant B's UTM fields unchanged (DB compared before/after; `updatedAt` excluded — the public redirect records clicks fire-and-forget).
- [x] 5.4 (harden §4) Correct `design.md` caller-safety table: UTM route is `apps/api/src/utm/utmRoutes.ts`, use case `@core/utm/GenerateUTMLinksUseCase.js`; line refs verified against shipped files.

## Post-merge: SMELL-53 regression fix (caught by CI, not a task phase)

Not part of the original 18-task plan — a CI-caught regression fixed as part of PR #109 before
merge (see Verification Report + archive-report `## Delivery` for full detail): the preexisting
unit test `apps/api/tests/unit/infrastructure/TrackedLinkRepository.test.ts` called
`findById`/`delete`/`getClickStats` without a bound TenantContext and mocked `findUnique` where
the change moved to `findFirst`. CI (pull_request, shard 2) caught 8 red tests; fixed by binding
`withTenantContext` in all 8 cases + updating the mocks to `findFirst` + adding a scoped-`where`
assertion. 23/23 green after the fix; full shard 3921/3921 green.
