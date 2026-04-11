# Sprint B — Gateway Switching Report

**Date:** 2026-04-10
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Enable OmniPost accounts to switch between payment gateways (Stripe and Paddle) with a managed lifecycle: schedule switch, wait for billing period end, checkout on new gateway, complete or suspend. Payment tokens are NOT transferable between gateways (PCI DSS restriction) — the customer must re-enter their card on the new gateway.

---

## Architecture Decision: GatewayAdapterRegistry

The existing `paymentAdapterFactory.ts` creates ONE adapter based on `PAYMENT_PROVIDER` env var. Gateway switching requires BOTH adapters simultaneously (cancel on Stripe, checkout on Paddle). Solution: a **Registry** pattern that lazily instantiates and caches both adapter instances.

```
IGatewayAdapterRegistry.getAdapter("stripe") -> StripePaymentAdapter
IGatewayAdapterRegistry.getAdapter("paddle") -> PaddlePaymentAdapter
```

The existing factory remains for backward compatibility.

---

## Schema Changes

### New Enums

- `GatewayProvider` — STRIPE, PADDLE
- `SwitchStatus` — SCHEDULED, PENDING_CHECKOUT, COMPLETED, CANCELLED, SUSPENDED, EXPIRED

### Modified Models

**Account** (+5 fields):

- `gatewayProvider` (GatewayProvider, default STRIPE)
- `gatewayCustomerId` (String?)
- `pendingGatewayProvider` (GatewayProvider?)
- `pendingGatewaySwitch` (Boolean, default false)
- `gatewaySwitchAt` (DateTime?)

**AccountSubscription** (+2 fields):

- `gatewayProvider` (GatewayProvider, default STRIPE)
- `gatewaySubscriptionId` (String?, unique)

### New Model: GatewaySwitchEvent

Full lifecycle tracking with: accountId, fromGateway, toGateway, requestedAt, scheduledFor, completedAt, cancelledAt, reminderSentAt, suspendedAt, extendedUntil, extendedBy, status, metadata. Indexed on accountId, status, scheduledFor.

### Migration

- File: `infra/prisma/migrations/20260410000000_add_gateway_switching/migration.sql`
- Applied via direct SQL + `prisma migrate resolve --applied`

---

## Port Interface Changes (IPaymentAdapter)

Three new methods added to `packages/ports/src/PaymentAdapter.ts`:

| Method                                               | Purpose                                          |
| ---------------------------------------------------- | ------------------------------------------------ |
| `cancelAtPeriodEnd({ externalSubscriptionId })`      | Schedule subscription cancellation at period end |
| `reactivateSubscription({ externalSubscriptionId })` | Undo cancel-at-period-end                        |
| `getSubscriptionDetails({ externalSubscriptionId })` | Get currentPeriodEnd, status, cancelAtPeriodEnd  |

New exported types: `GatewayProviderType`, `SubscriptionDetails`

Implemented in both `StripePaymentAdapter.ts` and `PaddlePaymentAdapter.ts`.

---

## New Files (10)

| File                                                            | Lines | Layer          | Purpose                                                                                                                                |
| --------------------------------------------------------------- | ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/billing/GatewayAdapterRegistry.ts` | 93    | Infrastructure | Dual-adapter registry with lazy init                                                                                                   |
| `apps/api/src/billing/GatewayBillingService.ts`                 | 628   | Application    | Core switch lifecycle (8 methods, Result type)                                                                                         |
| `apps/api/src/billing/GatewaySwitchJobService.ts`               | 129   | Infrastructure | BullMQ queue management (start/cancel/reschedule)                                                                                      |
| `apps/api/src/billing/gatewaySwitchProcessor.ts`                | 156   | Infrastructure | Worker for reminder + suspend jobs                                                                                                     |
| `apps/api/src/billing/clientBillingRoutes.ts`                   | 113   | Infrastructure | 3 client endpoints (GET status, POST switch, DELETE switch)                                                                            |
| `apps/api/src/billing/adminBillingRoutes.ts`                    | 241   | Infrastructure | 5 admin endpoints (list, detail, extend, force-complete, force-suspend)                                                                |
| `apps/api/src/billing/gatewaySwitchSchemas.ts`                  | 41    | Infrastructure | Zod validation schemas                                                                                                                 |
| `apps/client/hooks/api/useBilling.ts`                           | 128   | Client         | React Query hooks (useGatewayStatus, useInitiateGatewaySwitch, useCancelGatewaySwitch)                                                 |
| `apps/admin/hooks/api/useGatewaySwitches.ts`                    | 209   | Admin          | React Query hooks (useGatewaySwitches, useGatewaySwitchDetail, useExtendSwitchDeadline, useForceCompleteSwitch, useForceSuspendSwitch) |
| `apps/admin/app/(dashboard)/billing/gateway-switches/page.tsx`  | 674   | Admin          | Dashboard with stats, table, filters, detail/extend dialogs                                                                            |

## Modified Files (11)

| File                                                            | Changes                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                    | +2 enums, +5 Account fields, +2 AccountSubscription fields, +GatewaySwitchEvent model |
| `packages/ports/src/PaymentAdapter.ts`                          | +3 methods to interface, +2 exported types                                            |
| `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts`   | +3 method implementations                                                             |
| `apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts`   | +3 method implementations                                                             |
| `apps/api/src/infrastructure/container/types.ts`                | +3 DI tokens (GatewayAdapterRegistry, GatewayBillingService, GatewaySwitchJobService) |
| `apps/api/src/infrastructure/container/setupBillingUseCases.ts` | +3 service registrations                                                              |
| `packages/adapters/queue-bullmq/src/constants.ts`               | +GATEWAY_SWITCH queue name                                                            |
| `apps/api/src/index.ts`                                         | +2 route registrations                                                                |
| `apps/admin/components/shared/SidebarNav.tsx`                   | +1 nav item (Gateway Switches with ArrowRightLeft icon)                               |
| `apps/admin/messages/en.json`                                   | +nav key + gatewaySwitches section (50+ translation keys)                             |
| `apps/admin/messages/es.json`                                   | +nav key + gatewaySwitches section (50+ translation keys, Spanish)                    |

Also modified:

- `apps/api/src/domain/repositories/ReadModelDtos.ts` — added GatewayProviderKind type + 5 gateway fields to AccountDto
- `apps/client/app/dashboard/settings/billing/page.tsx` — added 3-state gateway selector UI

---

## API Endpoints

### Client (requireClientAuth)

| Method | Path                          | Purpose                               |
| ------ | ----------------------------- | ------------------------------------- |
| GET    | `/api/billing/gateway/status` | Current gateway + pending switch info |
| POST   | `/api/billing/gateway/switch` | Initiate gateway switch               |
| DELETE | `/api/billing/gateway/switch` | Cancel pending switch                 |

### Admin (requireAdminAuth + BILLING_MANAGE)

| Method | Path                                                     | Purpose                            |
| ------ | -------------------------------------------------------- | ---------------------------------- |
| GET    | `/api/admin/billing/gateway-switches`                    | List with pagination + stats       |
| GET    | `/api/admin/billing/gateway-switches/:id`                | Detail view                        |
| POST   | `/api/admin/billing/gateway-switches/:id/extend`         | Extend checkout deadline (max 72h) |
| POST   | `/api/admin/billing/gateway-switches/:id/force-complete` | Force-complete switch              |
| POST   | `/api/admin/billing/gateway-switches/:id/force-suspend`  | Force-suspend switch               |

---

## GatewayBillingService Methods

| Method                                                   | Returns                                      | Purpose                                 |
| -------------------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `initiateGatewaySwitch(accountId, newProvider, userId?)` | `Result<SwitchInitiatedResult, SwitchError>` | Schedule switch at period end           |
| `cancelPendingSwitch(accountId)`                         | `Result<{cancelled}, SwitchError>`           | Revert scheduled switch                 |
| `extendSwitchDeadline(accountId, hours, adminId)`        | `Result<ExtendResult, SwitchError>`          | Extend 48h checkout window              |
| `handleSubscriptionCanceled(accountId)`                  | `Result<void, SwitchError>`                  | Webhook: detect switch vs normal cancel |
| `handleCheckoutCompleted(accountId, custId, subId)`      | `Result<void, SwitchError>`                  | Webhook: complete switch on new gateway |
| `forceComplete(switchEventId, adminId)`                  | `Result<void, SwitchError>`                  | Admin: force-complete                   |
| `forceSuspend(switchEventId, adminId)`                   | `Result<void, SwitchError>`                  | Admin: force-suspend                    |
| `getAccountSwitchStatus(accountId)`                      | `Result<StatusData, SwitchError>`            | Client: current state for UI rendering  |

All methods use `Result<T, SwitchError>` pattern. Zero `throw`, zero `any`.

---

## BullMQ Jobs

Queue: `gateway-switch`

| Job                                   | Delay                | Action                                      |
| ------------------------------------- | -------------------- | ------------------------------------------- |
| `gateway-switch-reminder-{accountId}` | 24h after period end | Send reminder email, update reminderSentAt  |
| `gateway-switch-suspend-{accountId}`  | 48h after period end | Suspend account, update status to SUSPENDED |

Jobs are idempotent — check `PENDING_CHECKOUT` status before processing. Extended deadlines are respected (re-check before suspend).

---

## Switch Lifecycle

```
SCHEDULED ──(period ends)──> PENDING_CHECKOUT ──(checkout done)──> COMPLETED
    |                              |
    |                              +──(48h expired)──> SUSPENDED
    |                              |
    |                              +──(admin force)──> COMPLETED / SUSPENDED
    |
    +──(client cancels)──> CANCELLED
```

---

## Client UI (3 States)

- **State A** (no subscription): Gateway selector (Stripe/Paddle radio buttons) with descriptions
- **State B** (active subscription, no switch): Current gateway display + "Switch" button with confirmation dialog showing PCI DSS warning
- **State C** (switch pending): Status banner with countdown (SCHEDULED: shows date, PENDING_CHECKOUT: shows deadline)

## Admin UI

- **Page**: `/billing/gateway-switches` with sidebar nav link
- **Stats**: 4 StatCards (Scheduled, Pending Checkout, Suspended, Completed 30d)
- **Table**: Account, From/To (colored chips: Stripe=#635BFF, Paddle=#05E27B), dates, status badges, actions
- **Filters**: TabNav by status
- **Detail Dialog**: Timeline of events + action buttons
- **Extend Dialog**: Hour selector (12/24/48/72) with deadline preview
- **i18n**: Full EN/ES translations

---

## Quality Gates

| Check                            | Result                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| TypeScript build                 | 9/9 tasks, 0 errors                                                        |
| ESLint                           | 0 errors, 0 warnings (22 pre-existing warnings also fixed)                 |
| `any` count in new files         | 0                                                                          |
| `throw` in GatewayBillingService | 0                                                                          |
| Max file length                  | 674 lines (gateway-switches page) — under 800 limit                        |
| New Prisma models                | GatewaySwitchEvent verified in DB                                          |
| DI tokens registered             | 3 (GatewayAdapterRegistry, GatewayBillingService, GatewaySwitchJobService) |
| Route registration               | clientBillingRoutes + adminBillingRoutes in index.ts                       |

---

## Known Limitations

1. **No webhook integration yet**: `handleSubscriptionCanceled` and `handleCheckoutCompleted` are implemented but not wired into the webhook handler pipeline. This requires webhook route modifications to detect gateway switch context.
2. **Email templates**: Emails use plain text. HTML templates with branding should be added in a follow-up.
3. **Client checkout flow**: The client UI shows the switch lifecycle but the actual Stripe/Paddle checkout integration (Stripe Checkout Session, Paddle Overlay) is not yet implemented.
4. **Pre-existing lint warnings**: 22 warnings that existed in other admin files were also fixed as part of this sprint (react-hooks/exhaustive-deps, unused vars).
