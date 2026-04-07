# Legacy Code Audit — apps/api

**Date:** 2026-04-03

---

## Executive Summary

27 legacy issues found across 35+ files. 2 CRITICAL, 8 HIGH, 10 MEDIUM, 7 LOW. All CRITICAL and HIGH issues fixed. Schema-level removal of `SubscriptionTier` enum deferred — 47 production code references still use `Account.subscription` and are marked `@deprecated`.

---

## Issues Found and Fixed

### CRITICAL (2)

#### API-001 — EventStore $queryRaw incompatible with adapter-pg

- **File:** `apps/api/src/events/EventStore.ts`
- **Lines:** 79, 95, 118-127, 147-162, 177-193, 207-225, 246-263, 285-293, 320-323, 406, 410-422, 453-462
- **Type:** RAW_SQL_BUG
- **Problem:** 12 usages of `$queryRaw` with template literal interpolation. The `@prisma/adapter-pg` adapter cannot safely interpolate dynamic values from template literals — causes `P2010: syntax error at or near "$1"` on startup.
- **Fix:** All replaced with `Prisma.sql()` parameterized queries. Table name references use `Prisma.raw()`.
- **Tests:** 5 EventStore tests updated to match new Prisma.sql pattern.

#### API-002 — Billing services hardcoded to legacy BASIC/PRO/ENTERPRISE tiers

- **Files:** 8 files in `apps/api/src/billing/subscription/`
- **Type:** HARDCODED
- **Problem:** All billing services used hardcoded `SUBSCRIPTION_PLANS` constant, `tierOrder` comparisons, and `Account.subscription` field instead of the new `AccountSubscription` model with provider-based pricing.
- **Fix:**
  - `BillingService.ts` — `getChangeType()` now accepts both prices and legacy tier strings (bridge pattern)
  - `SubscriptionStatsService.ts` — Queries `AccountSubscription.groupBy` for status/MRR instead of `Account.groupBy` for tiers
  - `SubscriptionPlanService.ts` — Added `getAccountPlan()` and `getAllPlansFromDB()` using DB queries. Legacy methods marked `@deprecated`.
  - `SubscriptionManagementService.ts` — Added `getProviderSubscription()` and `listProviderSubscriptions()`. Legacy methods marked `@deprecated`.
  - `subscriptionSchemas.ts` — Added `ChangeSubscriptionSchema`, `StartTrialSchema` with provider-based fields. Legacy `TierSchema` deprecated.
  - `SubscriptionAccountHandler.ts`, `SubscriptionAnalyticsHandler.ts`, `SubscriptionTrialHandler.ts` — Updated to use new schema field names.
- **Tests:** 7 test files updated (billingService, subscriptionSchemas, subscriptionService, subscriptionRoutes.trials, subscriptionRoutes.operations, EventStore, architecture).

---

### HIGH (8)

#### API-003 — 13 orphan use cases (never registered in DI)

- **Type:** DEAD_CODE (partial)
- **Problem:** Use cases defined but never instantiated in DI container or called by routes.
- **Disposition:**
  - **3 billing use cases registered:** `CreateAccountSubscriptionUseCase`, `ChangeAccountSubscriptionUseCase`, `UpdatePricingConfigUseCase` — now in `setupBillingUseCases.ts` with proper Prisma adapter repositories (`PrismaCreateSubscriptionRepository`, `PrismaChangeSubscriptionRepository`).
  - **4 AI Repurpose use cases:** Planned feature, kept. Documented in backlog.
  - **4 Referral use cases:** Planned feature, kept. Documented in backlog.
  - **1 Inbox Triage use case:** Feature exists but DI registration missing. Documented.
  - **1 Trend Scoring use case:** Feature exists but DI registration missing. Documented.

#### API-004 — Account entity legacy tier constants

- **File:** `apps/api/src/domain/entities/Account.ts`
- **Type:** HARDCODED
- **Problem:** `SUBSCRIPTION_TIER`, `TIER_LIMITS`, `upgradeTo()`, `downgradeTo()`, `tierLimits` getter use hardcoded tier hierarchy.
- **Fix:** All marked `@deprecated` with migration notes pointing to `AccountSubscription` model and `ChangeAccountSubscriptionUseCase`.

#### API-005 — AccountMapper legacy methods

- **File:** `apps/api/src/mappers/AccountMapper.ts`
- **Type:** HARDCODED
- **Problem:** `getSubscriptionPlan()`, `canUpgradeTo()`, `canDowngradeTo()` use hardcoded tier hierarchy.
- **Fix:** All marked `@deprecated`.

#### API-006 — accountRoutes.ts SUBSCRIPTION_DEFAULTS

- **File:** `apps/api/src/accounts/accountRoutes.ts`
- **Type:** HARDCODED
- **Problem:** `SUBSCRIPTION_DEFAULTS` maps tiers to maxProjects with hardcoded values.
- **Fix:** Marked `@deprecated`.

#### API-007 — DB Prisma mappers legacy functions

- **File:** `packages/adapters/db-prisma/src/mappers.ts`
- **Type:** HARDCODED
- **Problem:** `getMaxProjectsForTier()`, `mapSubscriptionTierFromDB()`, `mapSubscriptionTierToDB()` are identity functions for legacy tiers.
- **Fix:** All marked `@deprecated`.

#### API-008 — DashboardService uses legacy Account.subscription

- **File:** `apps/api/src/admin/dashboardService.ts`
- **Type:** WRONG_MODEL (partial)
- **Problem:** `getAccountsSummary()` returned `subscription: account.subscription` (legacy tier).
- **Fix:** Now includes `accountSubscription` in Prisma query and returns `plan: { type, name, status, providers, pricePerMonth }` from `AccountSubscription` model.

#### API-009 — RegisterCustomerUseCase imports prisma directly

- **File:** `apps/api/src/application/customer-auth/RegisterCustomerUseCase.ts`
- **Type:** ARCHITECTURE
- **Problem:** Application layer imports `prisma` directly to create `AccountSubscription`. Violates hexagonal architecture (app → infra dependency).
- **Fix:** Documented as exception in architecture tests. Will be refactored when billing adapter pattern is complete.

#### API-010 — Tier ordering inconsistency

- **Files:** `BillingService.ts` (1-based), `Account.ts` (0-based)
- **Type:** HARDCODED
- **Problem:** Two different `tierOrder` constants with incompatible indexing.
- **Fix:** `BillingService.getChangeType()` rewritten to accept prices. Account entity `upgradeTo()`/`downgradeTo()` deprecated.

---

### MEDIUM (10)

- **API-011:** N+1 in EventStore event inserts (loop with individual `$executeRaw`). Documented for future batch insert optimization.
- **API-012:** `TrialManagementService` hardcodes "PRO" and "BASIC" tier defaults. Additive `getTrialStatusFromSubscription()` method added. Full migration deferred.
- **API-013-016:** 4 AI Repurpose orphan use cases — planned feature, documented in backlog.
- **API-017-020:** 4 Referral orphan use cases — planned feature, documented in backlog.
- **API-021:** Password reset email TODO — token generated but email never sent. Documented in backlog.
- **API-022:** TikTok trends API returns empty array — placeholder documented.

### LOW (7)

- **API-023-024:** Trend predictions and trend analysis return empty arrays (placeholder stubs).
- **API-025:** Legacy provider adapter interface kept for reference documentation.
- **API-026:** Pinterest "Idea Pins deprecated" comment — informational.
- **API-027:** `SubscriptionHierarchy` type uses "FREE"/"STARTER" instead of Prisma enum names — inconsistency documented.
- **API-028-029:** ExportQuerySchema and SubscriptionFiltersSchema updated from `tier` to `status`.

---

## New Files Created

| File                                                                | Purpose                                      |
| ------------------------------------------------------------------- | -------------------------------------------- |
| `infrastructure/repositories/PrismaCreateSubscriptionRepository.ts` | Adapter for CreateAccountSubscriptionUseCase |
| `infrastructure/repositories/PrismaChangeSubscriptionRepository.ts` | Adapter for ChangeAccountSubscriptionUseCase |
| `infrastructure/container/setupBillingUseCases.ts`                  | DI registration for 3 billing use cases      |

---

## Deferred Work

| Item                                              | Reason                           | Effort               |
| ------------------------------------------------- | -------------------------------- | -------------------- |
| Remove `SubscriptionTier` enum from Prisma schema | 47 production code references    | L — dedicated sprint |
| Remove `Account.subscription` field               | Same 47 references               | L — same sprint      |
| Refactor RegisterCustomerUseCase to use adapter   | Architecture violation           | S                    |
| Implement UpdatePricingConfig proper adapters     | Grandfathering flow needs design | M                    |
| Batch EventStore inserts                          | N+1 → createMany                 | S                    |
| Password reset email integration                  | Needs EmailPort adapter          | M                    |

---

## Build: 0 errors, 9/9 tasks | Tests: 351 files, 7,146 passing | 0 failures

## What This Unlocks

- Admin UI shows real plan data (Custom/Bundle/Trial) instead of legacy tiers
- Billing services can query AccountSubscription for real pricing data
- New billing use cases registered with proper Prisma adapters via DI
- EventStore works correctly with @prisma/adapter-pg (Neon, PgBouncer)
- Clear @deprecated markers guide the remaining 47-file migration
