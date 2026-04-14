# Sprint M-011 — Migrate Deprecated Billing Methods

**Date:** 2026-04-13
**Status:** Completed
**Build:** 9/9, 0 TS errors
**Tests:** 357/357 files, 7190/7190 tests, 0 failures

---

## Objective

Remove 5 deprecated billing methods that were stubs returning empty data or errors, breaking production endpoints at runtime. Migrate all callers to the provider-based billing model (AccountSubscription + ProviderBundle).

---

## Task 1: Migrate Callers (6 handlers)

| Handler                      | Method                 | Migration                                  |
| ---------------------------- | ---------------------- | ------------------------------------------ |
| SubscriptionAccountHandler   | getAccountSubscription | `getProviderSubscription()`                |
| SubscriptionAccountHandler   | listSubscriptions      | `listProviderSubscriptions()`              |
| SubscriptionAccountHandler   | bulkUpgrade            | `changeSubscriptionUseCase.execute()` loop |
| SubscriptionPlanHandler      | getAllPlans            | `getAllPlansFromDB()`                      |
| SubscriptionPlanHandler      | getSpecificPlan        | `getAllPlansFromDB()` + slug match         |
| SubscriptionAnalyticsHandler | exportSubscriptions    | `listProviderSubscriptions()`              |

---

## Task 2: Eliminate Deprecated Code

### Deleted from SubscriptionManagementService

| Method                   | Reason                                |
| ------------------------ | ------------------------------------- |
| `getAccountSubscription` | Replaced by `getProviderSubscription` |

### Deleted from SubscriptionPlanService

| Method                             | Reason                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `validateSubscriptionLimits`       | Moved to SubscriptionManagementService (reads AccountSubscription directly) |
| `mapAccountToSubscriptionInfo`     | Replaced by `buildTrialResponse` in TrialManagementService                  |
| `calculateUsage` (private)         | No longer needed                                                            |
| `extractBillingInfo` (private)     | No longer needed                                                            |
| `calculateStorageUsedGB` (private) | Inlined in new validateSubscriptionLimits                                   |

### Deleted from types.ts

| Item                        | Type                                      |
| --------------------------- | ----------------------------------------- |
| `SubscriptionPlan`          | interface                                 |
| `AccountSubscriptionInfo`   | interface                                 |
| `SubscriptionHierarchy`     | type                                      |
| `SUBSCRIPTION_PLANS`        | constant (hardcoded BASIC/PRO/ENTERPRISE) |
| `PrismaAccountWhereInput`   | interface                                 |
| `PrismaAccountOrderByInput` | interface                                 |

### Created

| Item                                       | Location                      | Purpose                                                |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------ |
| `AccountTrialResponse`                     | types.ts                      | Replaces `AccountSubscriptionInfo` — uses real DB data |
| `buildTrialResponse()`                     | TrialManagementService        | Builds response from Account + AccountSubscription     |
| `validateSubscriptionLimits()` (rewritten) | SubscriptionManagementService | Reads maxProjects from AccountSubscription directly    |

---

## Test Changes

38 tests removed (tested deleted methods), 0 new failures.

| Test File                             | Tests Removed                                                                                 | Tests Updated                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| subscriptionPlanService.test.ts       | 28 (getSubscriptionPlan, getAllPlans, validateUpgrade, validateDowngrade, SUBSCRIPTION_PLANS) | 0                                                          |
| subscriptionService.test.ts           | 10 (getAccountSubscription, listAccountSubscriptions, updateSubscription, plan management)    | 4 (validateSubscriptionLimits mocks, trial response shape) |
| subscriptionRoutes.operations.test.ts | 0                                                                                             | 1 (accountSubscription mock)                               |
| subscriptionRoutes.plans.test.ts      | 0                                                                                             | 3 (providerBundle mock, slug assertions)                   |

---

## Verification

```
pnpm build                    # 9/9 tasks, 0 errors
pnpm --filter @apps/api test  # 357/357 files, 7190/7190 tests, 0 failures
grep @deprecated               # 0 in SubscriptionManagementService, 0 in SubscriptionPlanService
```

---

## Post-Sprint: Documentation Audit

After M-011, a full audit of `docs/api/` (16 files, ~8,900 lines) was performed:

- **Deleted** `intelligent-caching.md` (893 lines documenting a non-existent system)
- **Updated** `billing.md` to remove all deprecated method references
- **Marked** `integration-examples.md` fictional sections as "Proposed, Not Implemented"
- **Moved** `client-portal.md` and `admin-portal.md` to `docs/frontend/`
- **Condensed** `saga.md` from 1,172 to 256 lines
- **Updated** `CLAUDE.md` with `/docs/` directory structure and REACT_STANDARDS reference
