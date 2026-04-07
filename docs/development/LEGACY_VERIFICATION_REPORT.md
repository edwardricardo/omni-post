# Legacy Audit Verification Report

**Date:** 2026-04-03

---

## Verification Results

| Claim                                     | Status    | Evidence                                                  |
| ----------------------------------------- | --------- | --------------------------------------------------------- |
| EventStore $queryRaw fixed (12 usages)    | CONFIRMED | 0 template literal $queryRaw, 17 Prisma.sql instances     |
| Billing services use DB queries           | CONFIRMED | SubscriptionStatsService uses accountSubscription.groupBy |
| 3 billing use cases in DI                 | CONFIRMED | setupBillingUseCases.ts exists, called from setup.ts:72   |
| DashboardService uses AccountSubscription | CONFIRMED | Returns plan field, includes accountSubscription          |
| Tests 7,146 passing                       | CONFIRMED | Verified at session start                                 |

---

## Deferred Work Completed

### D1 — Remove SubscriptionTier (47 → 0 references)

| File                             | Refs Removed |
| -------------------------------- | ------------ |
| accountRoutes.ts                 | 8            |
| TrialManagementService.ts        | 8            |
| SubscriptionManagementService.ts | 7            |
| AccountMapper.ts                 | 4            |
| dashboardService.ts              | 4            |
| PrismaAccountRepository.ts       | 3            |
| ExecutiveAccountHandlers.ts      | 3            |
| Account.ts entity                | 2            |
| SubscriptionPlanService.ts       | 2            |
| ExecutiveComplianceHandlers.ts   | 2            |
| executiveSchemas.ts              | 1            |
| db-prisma AccountRepository.ts   | 3            |
| **Total**                        | **47**       |

**Schema migration:** Removed `subscription SubscriptionTier @default(BASIC)` from Account model + removed `enum SubscriptionTier { BASIC PRO ENTERPRISE }`. Applied via `prisma db push`.

**Shared types:** Removed `subscription` from Account, CreateAccountInput, UpdateAccountInput types. Marked SubscriptionTier type as @deprecated.

**Prisma client exports:** Removed SubscriptionTier from client.ts and vitest-entry.ts re-exports.

**Tests updated:** 8 test files (43 tests removed/updated): AccountMapper, EventStore, subscriptionService, entities, customerAuth, accountRoutes, subscriptionRoutes.plans, dashboardRoutes.

### D2 — RegisterCustomerUseCase Architecture Fix

- Created `AccountSubscriptionPort` interface in `domain/repositories/`
- Created `PrismaAccountSubscriptionAdapter` in `infrastructure/repositories/`
- Injected port via constructor — removed `import { prisma } from "@infra/prisma"` from application layer
- Updated DI registration in `setupCustomerAuthUseCases.ts`

### D3 — EventStore N+1 Fix

- Replaced for-loop with individual `$executeRaw` INSERTs with single batch INSERT using `Prisma.join()` to combine multiple VALUES tuples
- N events now = 1 query instead of N queries

### D4 — Register 10 Orphan Use Cases

**AI Repurpose (4):**

- Created adapters: PrismaApproveVariantAdapter, PrismaRejectVariantAdapter, PrismaRepurposeDetectionAdapter, PrismaRepurposeVariantAdapter, BullMQRepurposeJobDispatcher
- Created `setupRepurposeUseCases.ts`

**Referral (4):**

- Created adapters: PrismaConvertReferralRepository, PrismaGrantRewardRepository, PrismaReferralRepository, PrismaReferralCodeRepository
- Created `setupReferralUseCases.ts`

**Inbox Triage (1):**

- Created adapters: PrismaTriageMessageAdapter, PrismaTriageCrmAdapter
- Added TriageInboxMessageUseCase to `setupInboxUseCases.ts`

**Trend Scoring (1):**

- Created adapter: PrismaScoreTrendContextAdapter
- Created `setupTrendUseCases.ts`

**All 10 registered with proper Prisma adapters via hexagonal architecture.**

### D5 — Password Reset Email

- Injected `EmailPort` into `RequestPasswordResetUseCase` constructor
- Sends reset email via `emailPort.send()` AFTER transaction (not inside)
- Uses ResendEmailAdapter (already registered as TOKENS.EmailPort)

---

## Final State

| Metric                                                  | Value            | Target |
| ------------------------------------------------------- | ---------------- | ------ |
| SubscriptionTier references in production               | 0                | 0      |
| $queryRaw template literals                             | 0                | 0      |
| Orphan use cases (0 DI registrations)                   | 0                | 0      |
| Architecture violations (@infra imports in application) | 0                | 0      |
| N+1 in EventStore                                       | 0 (batch insert) | 0      |
| Password reset sends email                              | Yes              | Yes    |

---

## Build: 0 errors, 9/9 tasks | Tests: 351 files, 7,128 passing | 0 failures
