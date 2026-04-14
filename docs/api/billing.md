# OmniPost — Billing API Reference

## Overview

The billing domain manages payment processing through dual gateways (Stripe and Paddle), subscription lifecycle (plans, trials, upgrades, suspensions), and gateway switching. It spans three route plugins (admin subscription management, admin gateway switch management, and client-facing billing) backed by a modularized service layer.

---

## API Layer (`apps/api/`)

### GatewayBillingService

**File:** `apps/api/src/billing/GatewayBillingService.ts`
**Layer:** application
**Description:** Manages the full lifecycle of payment gateway switches (Stripe <-> Paddle), including initiation, cancellation, extension, webhook-driven state transitions, admin force-actions, checkout session creation, and billing portal URLs. All public methods return `Result<T, SwitchError>`.

#### Methods

| Method                         | Signature                                                                                                                 | Returns                                                            | Description                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `initiateGatewaySwitch`        | `(accountId: string, newProvider: GatewayProviderType, requestedByUserId?: string)`                                       | `Promise<Result<SwitchInitiatedResult, SwitchError>>`              | Schedules a gateway switch at end of billing period        |
| `cancelPendingSwitch`          | `(accountId: string)`                                                                                                     | `Promise<Result<{ cancelled: true }, SwitchError>>`                | Cancels a SCHEDULED switch, reactivates subscription       |
| `extendSwitchDeadline`         | `(accountId: string, extraHours: number, adminUserId: string)`                                                            | `Promise<Result<ExtendResult, SwitchError>>`                       | Extends checkout window (max 72h)                          |
| `handleSubscriptionCanceled`   | `(accountId: string)`                                                                                                     | `Promise<Result<void, SwitchError>>`                               | Webhook handler: transitions SCHEDULED -> PENDING_CHECKOUT |
| `handleCheckoutCompleted`      | `(accountId: string, newGatewayCustomerId: string, newGatewaySubscriptionId: string)`                                     | `Promise<Result<void, SwitchError>>`                               | Webhook handler: completes switch on new gateway checkout  |
| `forceComplete`                | `(switchEventId: string, adminUserId: string)`                                                                            | `Promise<Result<void, SwitchError>>`                               | Admin action to force-complete a PENDING_CHECKOUT switch   |
| `forceSuspend`                 | `(switchEventId: string, adminUserId: string)`                                                                            | `Promise<Result<void, SwitchError>>`                               | Admin action to force-suspend a PENDING_CHECKOUT switch    |
| `getAccountSwitchStatus`       | `(accountId: string)`                                                                                                     | `Promise<Result<{ gatewayProvider, pendingSwitch }, SwitchError>>` | Returns current gateway + pending switch info              |
| `createCheckoutSession`        | `(accountId: string, gatewayProvider: GatewayProviderType, successUrl: string, cancelUrl: string)`                        | `Promise<Result<{ url: string }, SwitchError>>`                    | Creates checkout session on the specified gateway          |
| `getBillingPortalUrl`          | `(accountId: string, returnUrl: string)`                                                                                  | `Promise<Result<{ url: string }, SwitchError>>`                    | Returns gateway billing portal URL                         |
| `resolveAccountIdByCustomer`   | `(gatewayCustomerId: string, provider: GatewayProviderType)`                                                              | `Promise<string \| null>`                                          | Looks up accountId from gateway customer ID                |
| `checkBillingEventIdempotency` | `(eventId: string, provider: GatewayProviderType, eventType: string, domainEvent: string, data: Record<string, unknown>)` | `Promise<{ skip: boolean; recordId: string \| null }>`             | Idempotency check for billing webhook events               |
| `markBillingEventProcessed`    | `(recordId: string)`                                                                                                      | `Promise<void>`                                                    | Marks a BillingEvent as processed                          |
| `markBillingEventError`        | `(recordId: string, error: string)`                                                                                       | `Promise<void>`                                                    | Records processing error on BillingEvent                   |
| `getAvailablePlans`            | `()`                                                                                                                      | `Promise<Array<{ id, name, slug, ... }>>`                          | Returns active provider bundles                            |
| `listGatewaySwitches`          | `(filters: { status?, page, limit })`                                                                                     | `Promise<{ events, total, page, limit, stats }>`                   | Lists gateway switch events with pagination and stats      |
| `getGatewaySwitchById`         | `(id: string)`                                                                                                            | `Promise<GatewaySwitchEvent \| null>`                              | Returns a single gateway switch event                      |

**Has JSDoc:** ✅ All public methods have `@method` and `@description` tags.

---

### GatewaySwitchJobService

**File:** `apps/api/src/billing/GatewaySwitchJobService.ts`
**Layer:** infrastructure
**Description:** Manages BullMQ delayed jobs for the gateway switch lifecycle: enqueues reminder (24h) and suspend (48h) jobs, supports cancellation and rescheduling.

#### Methods

| Method                | Signature                                    | Returns         | Description                                                         |
| --------------------- | -------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `startCheckoutWindow` | `(accountId: string, switchEventId: string)` | `Promise<void>` | Enqueues reminder (24h) and suspend (48h) delayed jobs              |
| `cancelJobs`          | `(accountId: string)`                        | `Promise<void>` | Cancels both reminder and suspend jobs                              |
| `rescheduleJobs`      | `(accountId: string, newDeadline: Date)`     | `Promise<void>` | Cancels existing jobs and creates new ones with recalculated delays |
| `close`               | `()`                                         | `Promise<void>` | Gracefully closes the queue connection                              |

**Has JSDoc:** ✅

---

### GatewaySwitchProcessor

**File:** `apps/api/src/billing/gatewaySwitchProcessor.ts`
**Layer:** infrastructure
**Description:** BullMQ worker that processes gateway switch reminder and suspend jobs. Sends email reminders at 24h and auto-suspends accounts at 48h if checkout window expires.

#### Methods

| Method     | Signature | Returns         | Description                  |
| ---------- | --------- | --------------- | ---------------------------- |
| `shutdown` | `()`      | `Promise<void>` | Gracefully closes the worker |

**Has JSDoc:** ⚠️ File-level JSDoc only; no `@method` tags on private methods.

---

### BillingService

**File:** `apps/api/src/billing/subscription/BillingService.ts`
**Layer:** application
**Description:** Handles billing event logging, change type detection (UPGRADE/DOWNGRADE/LATERAL via price comparison), and billing date/amount calculations.

#### Methods

| Method                     | Signature                                                                          | Returns         | Description                                                |
| -------------------------- | ---------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `getChangeType`            | `(from: number \| string, to: number \| string)`                                   | `ChangeType`    | Determines change type by comparing prices or legacy tiers |
| `logBillingEvent`          | `(event: Omit<BillingEvent, "id" \| "timestamp">)`                                 | `Promise<void>` | Logs billing event with audit trail                        |
| `calculateNextBillingDate` | `(billingCycle: "monthly" \| "yearly", fromDate?: Date)`                           | `Date`          | Calculates next billing date                               |
| `calculateBillingAmount`   | `(monthlyPrice: number, yearlyPrice: number, billingCycle: "monthly" \| "yearly")` | `number`        | Returns billing amount based on cycle                      |

**Has JSDoc:** ⚠️ Has method descriptions but no `@method` tags.

---

### SubscriptionManagementService

**File:** `apps/api/src/billing/subscription/SubscriptionManagementService.ts`
**Layer:** application
**Description:** Core subscription lifecycle operations: get, list, validate limits, suspend. Uses the AccountSubscription + ProviderBundle model.

#### Methods

| Method                       | Signature                                                         | Returns                                                        | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `getProviderSubscription`    | `(accountId: string)`                                             | `Promise<AccountSubscription \| null>`                         | Get subscription from AccountSubscription model                   |
| `listProviderSubscriptions`  | `(filters?, page?, limit?)`                                       | `Promise<{ subscriptions, total, page, limit }>`               | List subscriptions with filtering (status, planType, search)      |
| `validateSubscriptionLimits` | `(accountId: string, operation: string, amount?: number)`         | `Promise<Result<{ allowed, limit, current, remaining }, ...>>` | Validates operation against AccountSubscription limits (DB-based) |
| `suspendSubscription`        | `(accountId: string, reason: string, suspendedByUserId?: string)` | `Promise<Result<void, "NOT_FOUND" \| "DATABASE_ERROR">>`       | Suspends an account subscription                                  |

**Has JSDoc:** ✅ All public methods have `@method` and `@description` tags.

---

### SubscriptionPlanService

**File:** `apps/api/src/billing/subscription/SubscriptionPlanService.ts`
**Layer:** application
**Description:** Manages subscription plans from AccountSubscription + ProviderBundle DB models. Provides plan info and trial calculations.

#### Methods

| Method               | Signature                  | Returns                                                                        | Description                                  |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| `getAccountPlan`     | `(accountId: string)`      | `Promise<{ id, planType, bundleName, providers, pricePerMonth, ... } \| null>` | Get plan info from AccountSubscription model |
| `getAllPlansFromDB`  | `()`                       | `Promise<ProviderBundle[]>`                                                    | Get all active bundles from DB               |
| `calculateTrialInfo` | `(account: PrismaAccount)` | `TrialInfo`                                                                    | Calculate trial status from account fields   |

**Has JSDoc:** ✅

---

### SubscriptionStatsService

**File:** `apps/api/src/billing/subscription/SubscriptionStatsService.ts`
**Layer:** application
**Description:** Subscription analytics: calculates MRR, plan distribution, status breakdown, churn risk (based on post activity), and growth metrics from the provider-based billing model.

#### Methods

| Method                 | Signature | Returns                                                | Description                                                                 |
| ---------------------- | --------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `getSubscriptionStats` | `()`      | `Promise<Result<SubscriptionStats, "DATABASE_ERROR">>` | Comprehensive stats: totalMRR, statusDistribution, churnRisk, growthMetrics |

**Has JSDoc:** ⚠️ Has method descriptions but no `@method` tags.

---

### TrialManagementService

**File:** `apps/api/src/billing/subscription/TrialManagementService.ts`
**Layer:** infrastructure
**Description:** Manages trial lifecycle: start, end, convert to paid, auto-renewals, and expiring trial queries.

#### Methods

| Method                           | Signature                                                | Returns                                                               | Description                                       |
| -------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| `getTrialStatusFromSubscription` | `(accountId: string)`                                    | `Promise<{ isTrialing, trialEndsAt, daysRemaining, status } \| null>` | Reads trial status from AccountSubscription model |
| `startTrial`                     | `(request: StartTrialRequest, startedByUserId?: string)` | `Promise<Result<AccountTrialResponse, ...>>`                          | Starts trial period with configurable duration    |
| `endTrial`                       | `(accountId, reason, endedByUserId?)`                    | `Promise<Result<AccountTrialResponse, ...>>`                          | Ends trial period                                 |
| `getExpiringTrials`              | `(daysBeforeExpiration?: number)`                        | `Promise<Result<AccountTrialResponse[], "DATABASE_ERROR">>`           | Gets accounts with expiring trials                |
| `convertTrialToPaid`             | `(accountId, billingCycle?, convertedByUserId?)`         | `Promise<Result<AccountTrialResponse, ...>>`                          | Converts trial to paid subscription               |
| `processAutoRenewals`            | `()`                                                     | `Promise<Result<{ processed, failed, details }, "DATABASE_ERROR">>`   | Processes auto-renewals for expired trials        |

**Has JSDoc:** ✅ Has `@method` tag on `getTrialStatusFromSubscription`.

---

## REST Endpoints

### Admin Subscription Routes (`subscriptionRoutes.ts`)

| Method | Path                                                 | Auth  | Permission       | Description                 |
| ------ | ---------------------------------------------------- | ----- | ---------------- | --------------------------- |
| GET    | `/admin/billing/plans`                               | Admin | BILLING_READ     | Get all subscription plans  |
| GET    | `/admin/billing/plans/:tier`                         | Admin | BILLING_READ     | Get specific plan           |
| GET    | `/admin/billing/accounts/:accountId/subscription`    | Admin | BILLING_READ     | Get account subscription    |
| PUT    | `/admin/billing/accounts/:accountId/subscription`    | Admin | BILLING_MANAGE   | Update account subscription |
| GET    | `/admin/billing/subscriptions`                       | Admin | BILLING_READ     | List all subscriptions      |
| GET    | `/admin/billing/stats`                               | Admin | BILLING_READ     | Subscription statistics     |
| POST   | `/admin/billing/accounts/:accountId/validate-limits` | Admin | BILLING_READ     | Validate limits             |
| POST   | `/admin/billing/accounts/:accountId/suspend`         | Admin | BILLING_MANAGE   | Suspend subscription        |
| POST   | `/admin/billing/bulk/upgrade`                        | Admin | BILLING_MANAGE   | Bulk upgrade                |
| GET    | `/admin/billing/health`                              | Admin | BILLING_READ     | Subscription health check   |
| GET    | `/admin/billing/export`                              | Admin | ANALYTICS_EXPORT | Export CSV (injection-safe) |
| POST   | `/admin/billing/accounts/:accountId/trial/start`     | Admin | BILLING_MANAGE   | Start trial                 |
| POST   | `/admin/billing/accounts/:accountId/trial/end`       | Admin | BILLING_MANAGE   | End trial                   |
| POST   | `/admin/billing/accounts/:accountId/trial/convert`   | Admin | BILLING_MANAGE   | Convert trial to paid       |
| GET    | `/admin/billing/trials/expiring`                     | Admin | BILLING_READ     | Get expiring trials         |
| POST   | `/admin/billing/auto-renewals/process`               | Admin | BILLING_MANAGE   | Process auto-renewals       |
| GET    | `/admin/billing/trials/stats`                        | Admin | BILLING_READ     | Trial statistics            |

### Admin Gateway Switch Routes (`adminBillingRoutes.ts`)

| Method | Path                                                     | Auth  | Permission     | Description               |
| ------ | -------------------------------------------------------- | ----- | -------------- | ------------------------- |
| GET    | `/api/admin/billing/gateway-switches`                    | Admin | BILLING_MANAGE | List switches (paginated) |
| GET    | `/api/admin/billing/gateway-switches/:id`                | Admin | BILLING_MANAGE | Get switch detail         |
| POST   | `/api/admin/billing/gateway-switches/:id/extend`         | Admin | BILLING_MANAGE | Extend checkout deadline  |
| POST   | `/api/admin/billing/gateway-switches/:id/force-complete` | Admin | BILLING_MANAGE | Force-complete switch     |
| POST   | `/api/admin/billing/gateway-switches/:id/force-suspend`  | Admin | BILLING_MANAGE | Force-suspend switch      |

### Client Billing Routes (`clientBillingRoutes.ts`)

| Method | Path                          | Auth          | Description                         |
| ------ | ----------------------------- | ------------- | ----------------------------------- |
| GET    | `/api/billing/gateway/status` | Client JWT    | Get gateway + pending switch status |
| POST   | `/api/billing/gateway/switch` | Client JWT    | Initiate gateway switch             |
| DELETE | `/api/billing/gateway/switch` | Client JWT    | Cancel pending switch               |
| GET    | `/api/billing/plans`          | None (public) | Get available billing plans         |
| POST   | `/api/billing/checkout`       | Client JWT    | Create checkout session             |
| GET    | `/api/billing/portal`         | Client JWT    | Get billing portal URL              |

### Billing Webhook Routes (`billingWebhookRoutes.ts`)

| Method | Path               | Auth             | Description             |
| ------ | ------------------ | ---------------- | ----------------------- |
| POST   | `/webhooks/stripe` | Stripe signature | Stripe webhook receiver |
| POST   | `/webhooks/paddle` | Paddle signature | Paddle webhook receiver |

---

## Key Types (`subscription/types.ts`)

| Type                   | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `AccountTrialResponse` | Trial operation response with Account + AccountSubscription data |
| `SubscriptionStats`    | Analytics: totals, revenue, churn risk, growth                   |
| `BillingEvent`         | Audit event: UPGRADE, DOWNGRADE, TRIAL_START, etc.               |
| `TrialInfo`            | Trial status: isOnTrial, dates, daysRemaining, expired           |
| `StartTrialRequest`    | Trial initiation params                                          |
| `SwitchError`          | Union of gateway switch error codes                              |

---

## Admin Portal (`apps/admin/`)

| File                                                | Type      | Description                                    |
| --------------------------------------------------- | --------- | ---------------------------------------------- |
| `app/(dashboard)/subscriptions/page.tsx`            | Page      | Subscription management dashboard              |
| `app/(dashboard)/billing/gateway-switches/page.tsx` | Page      | Gateway switch management                      |
| `app/(dashboard)/pricing/page.tsx`                  | Page      | Pricing tier configuration                     |
| `components/subscriptions/ChangePlanDialog.tsx`     | Component | Plan change dialog                             |
| `components/accounts/AccountBillingPanel.tsx`       | Component | Account billing details panel                  |
| `components/pricing/ProviderTiersTab.tsx`           | Component | Provider bundle tier editor                    |
| `components/pricing/AccountTiersTab.tsx`            | Component | Account tier management                        |
| `hooks/api/useSubscriptions.ts`                     | Hook      | TanStack Query hook for subscription summaries |
| `hooks/api/useSubscriptionMutations.ts`             | Hook      | Mutation hooks for subscription changes        |
| `hooks/api/useGatewaySwitches.ts`                   | Hook      | Gateway switch list/detail hooks               |
| `hooks/api/useBillingStats.ts`                      | Hook      | Billing statistics hook                        |
| `hooks/api/useAccountBilling.ts`                    | Hook      | Account billing detail hook                    |
| `hooks/api/usePricingTiers.ts`                      | Hook      | Pricing tier management hooks                  |

---

## Client Portal (`apps/client/`)

| File                                      | Type | Description                                                      |
| ----------------------------------------- | ---- | ---------------------------------------------------------------- |
| `app/dashboard/settings/billing/page.tsx` | Page | Client billing settings (gateway status, plans)                  |
| `hooks/api/useBilling.ts`                 | Hook | Gateway status, switch initiation/cancellation, checkout, portal |
| `hooks/api/useUsage.ts`                   | Hook | Usage metrics for current subscription                           |
