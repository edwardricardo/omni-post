# Sprint T — Tests Retroactivos Report

**Date:** 2026-04-12
**Branch:** Genesis
**Status:** COMPLETE

---

## Final Result

```
Test Files  357 passed (357)
     Tests  7228 passed (7228)
  Duration  193.12s
```

---

## Part 1 — New Tests (7 files, 143 tests)

| File                                | Tests   | Coverage                                                                           |
| ----------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `GatewayBillingService.test.ts`     | 35      | initiateSwitch, cancelSwitch, handleCanceled, handleCompleted, extend, checkout    |
| `ComplianceService.test.ts`         | 38      | DPO validation, 11-check scoring, DSAR deadlines, rate limiting, security settings |
| `billingWebhookIdempotency.test.ts` | 8       | resolveAccountId, idempotency check/upsert, mark processed/error                   |
| `DlqArchivalService.test.ts`        | 10      | archive resolved, flag stale, idempotency, cutoff calculations                     |
| `DataRetentionService.test.ts`      | 12      | safety guard (4 tests), active cleanup (8 tests), boundary cutoffs                 |
| `snapchatWebhookProcessor.test.ts`  | 20      | signature verify, CREATIVE events, error handling                                  |
| `telegramWebhookProcessor.test.ts`  | 20      | token header verify, message/channel/callback events                               |
| **Total**                           | **143** |                                                                                    |

### Mock Strategy

Constructor injection mocks — no `vi.mock()` for Prisma. All services receive `PrismaClient` via constructor (Sprint DI refactor). Type casting via `as unknown as PrismaClient` — zero `any`.

---

## Part 2 — Pre-existing Test Repairs (12 files)

### Root Cause 1: Missing permissions in mockPrisma seed data

**File:** `tests/unit/helpers/mockPrisma.ts`

The mock seed data for SUPER_ADMIN and ADMIN roles was missing `dashboard:view` and `post:manage` permissions. Additionally, the `findFirst` implementation crashed with `Object.entries(undefined)` when called without a `where` clause.

**Fix:** Added missing permissions to both role arrays and added a null guard on `findFirst`.

**Files fixed directly:** All 12 (shared dependency)
**Files fixed indirectly:** `dashboardRoutes.test.ts`, `schedulingRoutes.test.ts` (only needed this fix)

---

### Root Cause 2: RBAC migration from role-based to permission-based checks

**Impact:** 5 files, 13 tests

Sprint DI changed endpoints from `requireSuperAdmin` to `requirePermission()`. Tests expected HTTP 403 for ADMIN users, but ADMIN now has write permissions via the new middleware. The correct user for 403 tests is SUPPORT (which lacks write permissions).

| File                                    | Tests changed | Fix                                                  |
| --------------------------------------- | ------------- | ---------------------------------------------------- |
| `accountLifecycleRoutes.test.ts`        | 3             | Added `supportToken`, use SUPPORT for reject tests   |
| `rbacRoutes.test.ts`                    | 3             | Changed to verify SUPPORT users correctly get/denied |
| `subscriptionRoutes.operations.test.ts` | 2             | Added `supportToken`, use SUPPORT for 403 tests      |
| `subscriptionRoutes.trials.test.ts`     | 2             | Use SUPPORT for 403 tests                            |
| `subscriptionRoutes.test-helpers.ts`    | —             | Added SUPPORT user creation to shared helper         |

---

### Root Cause 3: Missing RbacService in test DI containers

**Impact:** 3 files

The `requirePermission` middleware resolves `RbacService` from the Fastify container. Tests that created a bare `Container()` without registering `RbacService` received HTTP 500 "RBAC service unavailable" instead of the expected response.

| File                             | Fix                                                      |
| -------------------------------- | -------------------------------------------------------- |
| `mfaRoutes.test.ts`              | Registered `RbacService` in test container               |
| `queueRoutes.test.ts`            | Added auth middleware mock, container, and `RbacService` |
| `webhookDashboardRoutes.test.ts` | Added Prisma mock, logger mock, and `RbacService`        |

---

### Root Cause 4: Outdated Permission enum values

**Impact:** 2 files, 12 tests

Several `Permission` enum values were renamed or removed in earlier sprints but test files still referenced the old names.

| File                     | Old values                                                                                                           | Replaced with                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `rbacMiddleware.test.ts` | `USER_UPDATE`, `MANAGE_USERS`                                                                                        | `USER_MANAGE`                             |
| `rbacService.test.ts`    | `USER_CREATE`, `SYSTEM_BACKUP`, `USER_DELETE`, `CONTENT_CREATE`, `CONTENT_READ`, `CONTENT_UPDATE`, `CONTENT_PUBLISH` | Current enum values from `rbacService.ts` |

---

### Root Cause 5: Missing compliance mock models for analytics

**Impact:** 1 file, 1 test

Sprint DI changed `AnalyticsDashboardHandler` to delegate compliance score to `ComplianceService`. The analytics route test mock lacked `gdprSettings` and `securitySettings` models, causing `ComplianceService.getComplianceScore()` to fail.

| File                      | Fix                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `analyticsRoutes.test.ts` | Added `gdprSettings` and `securitySettings` mock models with seeded singleton data |

---

## Quality Gates

| Check                        | Result                |
| ---------------------------- | --------------------- |
| Total test files             | 357 passed, 0 failed  |
| Total tests                  | 7228 passed, 0 failed |
| New tests (Sprint T)         | 143/143 passing       |
| Pre-existing tests fixed     | 12/12 files repaired  |
| Zero `any` in new test files | Confirmed             |
| Zero `.skip()` or `.todo()`  | Confirmed             |
| Zero production code changes | Confirmed             |
| Zero regressions             | Confirmed             |
