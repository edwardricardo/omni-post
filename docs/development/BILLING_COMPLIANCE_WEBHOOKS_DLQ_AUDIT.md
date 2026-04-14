# Audit Report: Billing / Compliance / Webhooks / DLQ

Date: 2026-04-10
Method: Direct code reading + grep + curl verification
Type: Read-only discovery audit

---

## 1. BILLING

### Schema

6 models found in `infra/prisma/schema.prisma`:

| Model                      | Key Fields                                                                       | Purpose                       |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| `ProviderPricingTier`      | minProviders, maxProviders, pricePerProviderMonth, isActive                      | Per-provider pricing tiers    |
| `AccountPricingTier`       | minAccounts, maxAccounts, multiplier, isActive                                   | Volume discount tiers         |
| `ProviderBundle`           | slug, name, providers[], pricePerAccountMonth, isActive                          | Pre-packaged provider bundles |
| `BundleFeatureFlag`        | bundleId, featureKey, featureValue, isEnabled                                    | Feature flags per bundle      |
| `AccountSubscription`      | accountId, planType, providers[], billingCycle, status, pricePerMonth, isOnTrial | Active subscription records   |
| `SubscriptionPriceHistory` | subscriptionId, oldPrice, newPrice, reason, changedBy                            | Price change audit trail      |

Enums: `SubscriptionStatus` (TRIALING, ACTIVE, PAST_DUE, CANCELED, GRANDFATHERED), `BillingCycle` (MONTHLY, YEARLY)

**Missing:** No `Invoice`, `Payment`, `PaymentMethod`, `Gateway`, or `BillingEvent` models. No payment provider integration schema.

### API Endpoints

29 endpoints across 2 route files:

**`apps/api/src/billing/subscriptionRoutes.ts`** (19 endpoints):

| Method | Path                                       | Status | Purpose                               |
| ------ | ------------------------------------------ | ------ | ------------------------------------- |
| GET    | /admin/billing/stats                       | 200    | Subscription statistics (MRR, counts) |
| GET    | /admin/billing/subscriptions               | 200    | Paginated subscription list           |
| GET    | /admin/billing/plans                       | 200    | Available plans                       |
| GET    | /admin/billing/export                      | 200    | CSV export                            |
| GET    | /admin/billing/trials/expiring             | 200    | Expiring trials list                  |
| GET    | /admin/billing/trials/stats                | 200    | Trial statistics                      |
| POST   | /admin/billing/accounts/:id/subscribe      | --     | Create subscription                   |
| POST   | /admin/billing/accounts/:id/trial/start    | --     | Start trial                           |
| POST   | /admin/billing/accounts/:id/trial/end      | --     | End trial                             |
| POST   | /admin/billing/accounts/:id/trial/convert  | --     | Convert trial to paid                 |
| POST   | /admin/billing/accounts/:id/suspend        | --     | Suspend subscription                  |
| POST   | /admin/billing/accounts/:id/reactivate     | --     | Reactivate subscription               |
| PATCH  | /admin/billing/accounts/:id/grandfathering | --     | Toggle grandfathering                 |
| POST   | /admin/billing/auto-renewals/process       | --     | Process auto-renewals                 |
| POST   | /admin/billing/bulk/upgrade                | --     | Bulk upgrade accounts                 |

**`apps/api/src/admin/pricingRoutes.ts`** (10 endpoints):

| Method | Path                              | Status | Purpose                   |
| ------ | --------------------------------- | ------ | ------------------------- |
| GET    | /admin/pricing/tiers              | 200    | All tiers + bundles       |
| POST   | /admin/pricing/provider-tiers     | --     | Create provider tier      |
| PATCH  | /admin/pricing/provider-tiers/:id | --     | Update provider tier      |
| POST   | /admin/pricing/account-tiers      | --     | Create account tier       |
| PATCH  | /admin/pricing/account-tiers/:id  | --     | Update account tier       |
| POST   | /admin/pricing/bundles            | --     | Create bundle             |
| PATCH  | /admin/pricing/bundles/:id        | --     | Update bundle             |
| DELETE | /admin/pricing/bundles/:id        | --     | Delete bundle             |
| PATCH  | /admin/pricing/tiers/:id/status   | --     | Toggle tier active status |

### Frontend (Admin)

| Page/Component      | File                                                       | Data Source                                            | Interaction                                                      |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Pricing page        | `apps/admin/app/(dashboard)/pricing/page.tsx`              | `usePricingTiers` hook (real API)                      | Full CRUD: create/edit/delete bundles, edit tiers, toggle status |
| Subscriptions page  | `apps/admin/app/(dashboard)/subscriptions/page.tsx`        | `useSubscriptions`, `useBillingStats` hooks (real API) | Trial actions (end/convert), CSV export, auto-renewals           |
| ProviderTiersTab    | `apps/admin/components/pricing/ProviderTiersTab.tsx`       | Props from parent                                      | Inline edit, create dialog, status toggle                        |
| AccountTiersTab     | `apps/admin/components/pricing/AccountTiersTab.tsx`        | Props from parent                                      | Inline edit, create dialog, status toggle                        |
| AccountBillingPanel | `apps/admin/components/accounts/AccountBillingPanel.tsx`   | `useAccountBilling` hook                               | View billing details per account                                 |
| ChangePlanDialog    | `apps/admin/components/subscriptions/ChangePlanDialog.tsx` | Props + tier data                                      | Plan change with bundle/custom selection                         |

### Frontend (Client)

| Page/Component   | File                                                  | Data Source                        | Interaction                                           |
| ---------------- | ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Billing settings | `apps/client/app/dashboard/settings/billing/page.tsx` | **HARDCODED** bundles/tiers/prices | CTA buttons show `alert("Please contact support...")` |

**CRITICAL:** Client billing page does NOT fetch real data from the API. All pricing information is hardcoded. No self-service checkout flow exists.

### Service Layer

15 files under `apps/api/src/billing/`:

| File                                       | Purpose                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `BillingService.ts`                        | Core billing operations                              |
| `SubscriptionManagementService.ts`         | Subscription lifecycle (create, suspend, reactivate) |
| `SubscriptionPlanService.ts`               | Plan management and pricing calculation              |
| `SubscriptionStatsService.ts`              | MRR, stats computation                               |
| `TrialManagementService.ts`                | Trial start/end/convert logic                        |
| `subscriptionService.ts`                   | Legacy subscription operations                       |
| `handlers/SubscriptionPlanHandler.ts`      | Route handler for plan operations                    |
| `handlers/SubscriptionAccountHandler.ts`   | Route handler for account billing                    |
| `handlers/SubscriptionTrialHandler.ts`     | Route handler for trial operations                   |
| `handlers/SubscriptionAnalyticsHandler.ts` | Route handler for billing analytics + CSV export     |

### BILLING SUMMARY

| Layer           | Status      | Notes                                              |
| --------------- | ----------- | -------------------------------------------------- |
| Schema          | ✅ Exists   | 6 models for subscription/pricing management       |
| API endpoints   | ✅ Complete | 29 endpoints, all functional                       |
| Admin UI        | ✅ Complete | Full CRUD pricing, subscription management, export |
| Client checkout | ❌ Missing  | Hardcoded data, no real checkout, `alert()` CTAs   |
| Service logic   | ✅ Complete | 15 files covering full subscription lifecycle      |
| Payment gateway | ❌ Missing  | No Stripe/Paddle/etc. No Invoice/Payment models    |

---

## 2. COMPLIANCE

### Schema

**NO DEDICATED SCHEMA FOUND.**

Compliance metrics are computed at query time from the `AuditLog` model:

| Model      | Key Fields                                                              | Purpose                                      |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| `AuditLog` | action, resource, userId, success, error, details, ipAddress, userAgent | Audit trail (used as compliance data source) |

No `SecurityConfig`, `ComplianceScore`, `DataRetentionPolicy`, `GdprRequest`, or `ConsentRecord` models exist.

### API Endpoints

3 endpoints in `apps/api/src/analytics/analyticsRoutes.ts` (admin analytics section):

| Method | Path                             | Status | Purpose                                                 |
| ------ | -------------------------------- | ------ | ------------------------------------------------------- |
| GET    | /api/admin/compliance/metrics    | 200    | Computed compliance score, GDPR stats, security metrics |
| GET    | /api/admin/compliance/audit-logs | 200    | Paginated audit logs with filters                       |
| GET    | /api/admin/compliance/gdpr       | 200    | Data subject listing with export/deletion counts        |

Handler: `AnalyticsComplianceHandler` in `apps/api/src/analytics/AnalyticsComplianceHandlers.ts`

### Frontend (Admin)

| Page/Component  | File                                             | Data Source                     | Interaction                                                                      |
| --------------- | ------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------- |
| Compliance page | `apps/admin/app/(dashboard)/compliance/page.tsx` | `useCompliance` hook (real API) | 4 tabs: overview (metric cards), audit (log table), gdpr (stub), security (stub) |

**GDPR tab:** Shows "Coming Soon" placeholder with non-functional "Configure Settings" button.
**Security tab:** Shows "Coming Soon" placeholder with non-functional "Configure Settings" button.
**Overview tab:** Real data — compliance score, total events, failed events, unique users.
**Audit tab:** Real data — paginated audit log table with filters.

### Frontend (Client)

**NO COMPLIANCE UI FOUND.** No data export/deletion request flow for end users. No consent management.

### Service Layer

No dedicated compliance service. Logic is split:

| File                                       | Purpose                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| `analytics/AnalyticsComplianceHandlers.ts` | Computes compliance metrics from AuditLog aggregation |
| `analytics/AnalyticsDashboardHandlers.ts`  | Dashboard metrics that include some compliance data   |

### COMPLIANCE SUMMARY

| Layer            | Status     | Notes                                     |
| ---------------- | ---------- | ----------------------------------------- |
| Schema           | ❌ Missing | No dedicated models; relies on AuditLog   |
| API endpoints    | ⚠️ Partial | 3 read-only endpoints; no DSAR workflow   |
| Admin UI         | ⚠️ Partial | 2 of 4 tabs are stubs ("Coming Soon")     |
| Client DSAR flow | ❌ Missing | No data export/deletion for end users     |
| Service logic    | ⚠️ Partial | Computed on-the-fly, no dedicated service |

---

## 3. WEBHOOKS (OUTBOUND)

### Schema

3 models + 1 outbox model in `infra/prisma/schema.prisma`:

| Model                 | Key Fields                                                                                                            | Purpose                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `WebhookEvent`        | eventType, provider, status, payload, retryCount, maxRetries, lastRetryAt, processingTime                             | Full event lifecycle tracking              |
| `WebhookSubscription` | accountId, url, eventTypes[], provider, isActive, secret, successCount, failureCount                                  | Per-account webhook endpoint subscriptions |
| `WebhookDeadLetter`   | originalEventId, provider, eventType, payload, headers, failureReason, finalError, retryCount, resolvedAt, resolvedBy | Failed events that exhausted retries       |
| `OutboxEvent`         | eventType, aggregateId, payload, status, retryCount, maxRetries                                                       | Reliable event publishing pattern          |

Enum: `WebhookProcessingStatus` (PENDING, PROCESSING, DELIVERED, FAILED, DEAD_LETTER)

### API Endpoints

8 endpoints in `apps/api/src/webhooks/webhookDashboardRoutes.ts`:

| Method | Path                                               | Status | Purpose                                                    |
| ------ | -------------------------------------------------- | ------ | ---------------------------------------------------------- |
| GET    | /api/webhooks/dashboard/metrics                    | 200    | Dashboard metrics (totals, success rate, by provider/type) |
| GET    | /api/webhooks/dashboard/events                     | 200    | Paginated event list                                       |
| GET    | /api/webhooks/dashboard/events/:id                 | 200    | Single event detail                                        |
| GET    | /api/webhooks/dashboard/subscriptions              | 200    | Subscription list                                          |
| GET    | /api/webhooks/dashboard/dead-letter                | 200    | Dead letter queue listing                                  |
| POST   | /api/webhooks/dashboard/dead-letter/:eventId/retry | 200    | Retry single dead letter event                             |
| GET    | /api/webhooks/dashboard/stream                     | 200    | SSE real-time event stream                                 |
| GET    | /api/webhooks/dashboard/export                     | 200    | CSV export of events                                       |

Additional webhook management in `webhookManager.ts`: create/update/delete/verify subscriptions (internal service, not exposed as separate routes).

### Frontend (Admin)

| Page/Component       | File                                                      | Data Source                         | Interaction                     |
| -------------------- | --------------------------------------------------------- | ----------------------------------- | ------------------------------- |
| Webhooks page        | `apps/admin/app/(dashboard)/webhooks/page.tsx`            | `useWebhookMetrics` hook (real API) | 5 tabs with filters             |
| WebhookMetrics       | `apps/admin/components/webhooks/WebhookMetrics.tsx`       | Props from parent                   | Display-only metrics            |
| WebhookEventsList    | `apps/admin/components/webhooks/WebhookEventsList.tsx`    | Internal fetch                      | Paginated event table           |
| WebhookSubscriptions | `apps/admin/components/webhooks/WebhookSubscriptions.tsx` | Internal fetch                      | Subscription management         |
| WebhookTimeline      | `apps/admin/components/webhooks/WebhookTimeline.tsx`      | Props from parent                   | Timeline chart                  |
| DeadLetterQueue      | `apps/admin/components/webhooks/DeadLetterQueue.tsx`      | Internal fetch                      | DLQ with retry, search, filters |

### Frontend (Client)

| Page/Component              | File                                                                   | Data Source | Interaction                          |
| --------------------------- | ---------------------------------------------------------------------- | ----------- | ------------------------------------ |
| AddWebhookForm              | `apps/client/components/webhooks/AddWebhookForm.tsx`                   | Local state | Slack/Teams notification config only |
| ExternalNotificationConfigs | `apps/client/components/notifications/ExternalNotificationConfigs.tsx` | Local state | Notification webhook management      |

Client webhook UI is for outbound notifications TO external services (Slack/Teams), NOT for managing webhook subscriptions to receive platform events.

### Service Layer

7 files under `apps/api/src/webhooks/`:

| File                         | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| `webhookManager.ts`          | Subscription CRUD, event dispatching, verification |
| `webhookHandler.ts`          | Inbound webhook processing (from providers)        |
| `webhookHandlerCore.ts`      | Core processing logic, moves failed events to DLQ  |
| `webhookJobProcessor.ts`     | BullMQ processor for async webhook delivery        |
| `webhookDashboardService.ts` | Dashboard metrics, queries, DLQ operations         |
| `webhookDashboardRoutes.ts`  | Route registration for dashboard endpoints         |
| `webhookTypes.ts`            | Type definitions                                   |

Plus `apps/api/src/outbox/OutboxRelay.ts` for reliable event publishing via outbox pattern.

### WEBHOOKS SUMMARY

| Layer         | Status      | Notes                                          |
| ------------- | ----------- | ---------------------------------------------- |
| Schema        | ✅ Complete | 3 models + OutboxEvent, full lifecycle support |
| API endpoints | ✅ Complete | 8 dashboard endpoints, all functional          |
| Admin UI      | ✅ Complete | 5 tabs, real data, DLQ management              |
| Client UI     | ⚠️ Limited  | Notification webhooks only (Slack/Teams)       |
| Service logic | ✅ Complete | Full dispatch + retry + DLQ pipeline           |

---

## 4. DEAD LETTER QUEUE

### Schema

Covered by `WebhookDeadLetter` model (see Webhooks section):

| Model               | Key Fields                                                                                                                                        | Purpose                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `WebhookDeadLetter` | originalEventId, provider, eventType, payload, headers, failureReason, finalError, retryCount, firstFailedAt, lastRetryAt, resolvedAt, resolvedBy | Failed webhook events that exhausted retries |

`OutboxEvent` has `retryCount`/`maxRetries` but no separate DLQ model for outbox failures.

### API Endpoints

| Method | Path                                               | Status      | Purpose                                  |
| ------ | -------------------------------------------------- | ----------- | ---------------------------------------- |
| GET    | /api/webhooks/dashboard/dead-letter                | 200         | Paginated DLQ listing with search/filter |
| POST   | /api/webhooks/dashboard/dead-letter/:eventId/retry | 200         | Retry single dead letter event           |
| POST   | /api/webhooks/dashboard/dead-letter/retry-all      | **MISSING** | Bulk retry all dead letter events        |

**BUG:** `DeadLetterQueue.tsx` component calls `POST /api/webhooks/dashboard/dead-letter/retry-all` for the "Retry All" button, but this endpoint does NOT exist in `webhookDashboardRoutes.ts`. Will produce a 404 at runtime.

### Frontend (Admin)

| Component       | File                                                             | Data Source                                             | Interaction                                                                                                                  |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| DeadLetterQueue | `apps/admin/components/webhooks/DeadLetterQueue.tsx` (547 lines) | Internal fetch to `/api/webhooks/dashboard/dead-letter` | Search, provider filter, event detail dialog (payload/headers/error), per-event retry, bulk "Retry All" (broken), pagination |

### Service Layer

DLQ logic distributed across:

| File                         | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `webhookDashboardService.ts` | `getDeadLetterQueue()`, `retryDeadLetterEvent()` methods |
| `webhookHandlerCore.ts`      | Moves failed events to DLQ after retry exhaustion        |
| `webhookJobProcessor.ts`     | Handles retry exhaustion in BullMQ processor             |
| `outbox/EventPublisher.ts`   | Redis-based dead letter queue support for domain events  |

**Missing:** No `retryAllDeadLetterEvents()` method in service. No DLQ cleanup/archival service. No retention policy.

### DLQ SUMMARY

| Layer         | Status      | Notes                                                              |
| ------------- | ----------- | ------------------------------------------------------------------ |
| Schema        | ✅ Exists   | WebhookDeadLetter model with full tracking                         |
| API endpoints | ⚠️ Partial  | Single retry works; bulk retry-all endpoint MISSING (frontend bug) |
| Admin UI      | ✅ Complete | Full-featured 547-line component                                   |
| Service logic | ⚠️ Partial  | No bulk retry, no cleanup/archival                                 |

---

## GLOBAL IMPLEMENTATION GAPS

| #   | Gap                                                                                 | Domain     | Severity     |
| --- | ----------------------------------------------------------------------------------- | ---------- | ------------ |
| 1   | Missing `POST /dead-letter/retry-all` endpoint — frontend calls it, API returns 404 | DLQ        | **P0 (BUG)** |
| 2   | No payment gateway integration (Stripe/Paddle) — billing is tracking-only           | Billing    | **P1**       |
| 3   | Client billing page uses hardcoded data — no real pricing from API                  | Billing    | **P1**       |
| 4   | No `Invoice`, `Payment`, `PaymentMethod` models                                     | Billing    | **P1**       |
| 5   | Compliance GDPR tab is a stub ("Coming Soon")                                       | Compliance | **P2**       |
| 6   | Compliance Security tab is a stub ("Coming Soon")                                   | Compliance | **P2**       |
| 7   | No DSAR flow for end users (data export/deletion requests)                          | Compliance | **P2**       |
| 8   | No dedicated compliance schema (scores computed on-the-fly)                         | Compliance | **P2**       |
| 9   | No DLQ cleanup/archival policy                                                      | DLQ        | **P3**       |
| 10  | OutboxEvent has no separate DLQ — events stop at maxRetries                         | DLQ        | **P3**       |
| 11  | Client webhook UI limited to Slack/Teams notifications only                         | Webhooks   | **P3**       |

---

## SPRINT RECOMMENDATION

### Sprint A: Quick Fixes (hours)

1. Add `POST /api/webhooks/dashboard/dead-letter/retry-all` endpoint + service method (P0 bug fix)

### Sprint B: Billing Gateway (3-5 days)

1. Add `Invoice`, `Payment`, `PaymentMethod` Prisma models + migration
2. Integrate Stripe (or Paddle) — webhook receiver, checkout session, subscription sync
3. Refactor client billing page to fetch real pricing from API
4. Build client checkout flow (plan selection -> payment -> confirmation)

### Sprint C: Compliance (2-3 days)

1. Add `GdprRequest`, `DataRetentionPolicy` models
2. Build GDPR tab: DSAR request workflow (export/deletion)
3. Build Security tab: security config management
4. Add client-facing data export/deletion request page

### Sprint D: DLQ Lifecycle (1 day)

1. Add DLQ cleanup/archival service with configurable retention
2. Add OutboxEvent DLQ handling (separate from just stopping retries)
3. Add DLQ metrics to monitoring dashboard
