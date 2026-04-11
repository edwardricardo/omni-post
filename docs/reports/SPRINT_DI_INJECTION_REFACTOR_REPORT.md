# Sprint DI — Constructor Injection Refactor Report

**Date:** 2026-04-11
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Refactor 4 service classes and 3 route files from module-level `import { prisma } from "@infra/prisma"` to proper constructor injection via `PrismaClient`. This unblocks Sprint T (unit tests with factory mocks) and aligns with the established DI pattern used by 50+ other registrations in the container.

---

## Problem

Services created in Sprints B-D used a module-level singleton import:

```typescript
// Before — untestable without vi.mock(), violates DI pattern
import { prisma } from "@infra/prisma";
class MyService {
  async doWork() {
    await prisma.model.find();
  }
}
```

The correct pattern (used by orchestration, analytics, etc.):

```typescript
// After — injectable, mockable, testable
import type { PrismaClient } from "@infra/prisma";
class MyService {
  constructor(private readonly prisma: PrismaClient) {}
  async doWork() {
    await this.prisma.model.find();
  }
}
```

---

## Changes

### 4 Services Refactored

| Service                 | Constructor Before                        | Constructor After                                 |
| ----------------------- | ----------------------------------------- | ------------------------------------------------- |
| `GatewayBillingService` | `(registry, switchJobService, emailPort)` | `(prisma, registry, switchJobService, emailPort)` |
| `ComplianceService`     | `(emailPort)`                             | `(prisma, emailPort)`                             |
| `DataRetentionService`  | none                                      | `(prisma)`                                        |
| `DlqArchivalService`    | none                                      | `(prisma)`                                        |

All `prisma.xxx` calls replaced with `this.prisma.xxx` — mechanical, zero logic changes.

### 3 Route Files: Prisma Removed

| Route File                | Prisma Usage Before                                               | After                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billingWebhookRoutes.ts` | `prisma.account.findFirst`, `prisma.billingEvent.*` (idempotency) | Delegated to `GatewayBillingService` methods: `resolveAccountIdByCustomer`, `checkBillingEventIdempotency`, `markBillingEventProcessed`, `markBillingEventError` |
| `clientBillingRoutes.ts`  | `prisma.providerBundle.findMany` (plans query)                    | Delegated to `GatewayBillingService.getAvailablePlans()`                                                                                                         |
| `adminBillingRoutes.ts`   | `prisma.gatewaySwitchEvent.*` (list, detail, stats)               | Delegated to `GatewayBillingService.listGatewaySwitches()` and `getGatewaySwitchById()`                                                                          |

### New Methods on GatewayBillingService

| Method                                             | Purpose                                    |
| -------------------------------------------------- | ------------------------------------------ |
| `resolveAccountIdByCustomer(customerId, provider)` | Lookup accountId from gateway customer ID  |
| `checkBillingEventIdempotency(eventId, ...)`       | BillingEvent dedup check + upsert          |
| `markBillingEventProcessed(recordId)`              | Mark event as successfully processed       |
| `markBillingEventError(recordId, error)`           | Record processing error                    |
| `getAvailablePlans()`                              | Query active ProviderBundle records        |
| `listGatewaySwitches(filters)`                     | Paginated list + stats for admin dashboard |
| `getGatewaySwitchById(id)`                         | Single switch event with account relation  |

### DI Container Updates

| File                      | Change                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `setupBillingUseCases.ts` | Added `container.resolve<PrismaClient>(TOKENS.PrismaClient)` as first arg to GatewayBillingService |
| `setupServices.ts`        | Added PrismaClient resolution for ComplianceService, DataRetentionService, DlqArchivalService      |

### Other

| File                            | Change                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| `AnalyticsDashboardHandlers.ts` | Updated `new ComplianceService(...)` to pass `this.prisma` as first arg |

---

## Files Modified (10)

| File                                                            | Type                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/billing/GatewayBillingService.ts`                 | Service — constructor injection + 7 new query methods |
| `apps/api/src/compliance/ComplianceService.ts`                  | Service — constructor injection                       |
| `apps/api/src/compliance/DataRetentionService.ts`               | Service — constructor injection                       |
| `apps/api/src/webhooks/DlqArchivalService.ts`                   | Service — constructor injection                       |
| `apps/api/src/billing/billingWebhookRoutes.ts`                  | Route — removed prisma, delegates to service          |
| `apps/api/src/billing/clientBillingRoutes.ts`                   | Route — removed prisma, delegates to service          |
| `apps/api/src/billing/adminBillingRoutes.ts`                    | Route — removed prisma, delegates to service          |
| `apps/api/src/infrastructure/container/setupBillingUseCases.ts` | DI — PrismaClient resolved                            |
| `apps/api/src/infrastructure/container/setupServices.ts`        | DI — PrismaClient resolved for 3 services             |
| `apps/api/src/admin/AnalyticsDashboardHandlers.ts`              | Updated ComplianceService instantiation               |

---

## Quality Gates

| Check                                 | Result                                       |
| ------------------------------------- | -------------------------------------------- |
| TypeScript build                      | 9/9 tasks, 0 errors                          |
| ESLint                                | 0 errors, 0 warnings                         |
| `import { prisma }` in 7 target files | 0 (all removed)                              |
| Constructor with prisma in 4 services | 4/4 confirmed                                |
| PrismaClient resolved in DI           | setupBillingUseCases (1) + setupServices (3) |
| Zero behavior changes                 | Confirmed — mechanical replacement only      |
