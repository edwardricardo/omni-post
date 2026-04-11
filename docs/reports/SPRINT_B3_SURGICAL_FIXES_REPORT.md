# Sprint B.3 — Two Surgical Fixes Report

**Date:** 2026-04-11
**Branch:** Genesis
**Status:** COMPLETE
**Depends on:** Sprint B.2 (Webhook Receiver + Client Checkout)

---

## Objective

Fix two P0 issues from Sprint B.2: (1) billing page silently showing obsolete hardcoded prices when API fails, and (2) webhook events processed without deduplication, risking state corruption on Stripe retries.

---

## Fix 1 — Remove Hardcoded Billing Fallback

**File:** `apps/client/app/dashboard/settings/billing/page.tsx`

### Problem

Line 558 used `remotePlans ?? BUNDLES` where `BUNDLES` was a hardcoded array with prices ($25, $32, $55). If `/api/billing/plans` failed, the page silently showed stale prices — the customer could not tell the difference and might subscribe to a price that no longer exists.

### Changes

1. **Deleted `BUNDLES` constant** (22 lines removed, was lines 49-71) — confirmed only used in this file
2. **Replaced `(remotePlans ?? BUNDLES).map(...)` with explicit states:**
   - `plansError` (isError) — red error card with "Retry" button calling `refetchPlans()`
   - `!remotePlans?.length` — neutral card with "No plans available at this time"
   - `remotePlans` has data — maps `BillingPlan[]` directly (no union type needed)
3. **Simplified map type** — removed `BillingPlan | (typeof BUNDLES)[number]` union, now just `BillingPlan`
4. **Extracted `isError` and `refetch`** from `useAvailablePlans()` hook

### Behavior After Fix

| Scenario          | Before                      | After                        |
| ----------------- | --------------------------- | ---------------------------- |
| API returns plans | Shows real plans            | Shows real plans (unchanged) |
| API fails         | Shows hardcoded $25/$32/$55 | Shows error + Retry button   |
| API returns empty | Shows hardcoded plans       | Shows "No plans available"   |
| API loading       | Shows skeleton              | Shows skeleton (unchanged)   |

---

## Fix 2 — Webhook Idempotency

### Problem

Stripe retries webhooks for up to 3 days on timeout. Without deduplication, `handleSubscriptionCanceled` or `handleCheckoutCompleted` could execute multiple times for the same event, corrupting `GatewaySwitchEvent` status transitions.

### Changes (4 files + schema)

**Step 1: Added `id` to `WebhookEvent` type**

`packages/ports/src/PaymentAdapter.ts`:

```typescript
export interface WebhookEvent {
  id: string; // gateway event ID for idempotency
  type: string;
  data: Record<string, unknown>;
}
```

**Step 2: Pass event ID in adapters**

- `StripePaymentAdapter.ts` — returns `event.id` from Stripe event object (format: `evt_xxxx`)
- `PaddlePaymentAdapter.ts` — returns `raw.eventId ?? raw.event_id ?? raw.notificationId` from Paddle event

**Step 3: Created `BillingEvent` model**

`infra/prisma/schema.prisma`:

```prisma
model BillingEvent {
  id              String          @id @default(cuid())
  accountId       String?
  gatewayProvider GatewayProvider
  gatewayEventId  String          @unique
  eventType       String
  rawEventType    String
  payload         Json
  processed       Boolean         @default(false)
  processedAt     DateTime?
  error           String?
  createdAt       DateTime        @default(now())

  account Account? @relation(fields: [accountId], references: [id])

  @@index([gatewayProvider, createdAt])
}
```

Migration: `infra/prisma/migrations/20260411000000_add_billing_event/migration.sql`

**Step 4: Idempotency check in `routeBillingEvent`**

`apps/api/src/billing/billingWebhookRoutes.ts`:

1. Added `eventId: string` parameter to `routeBillingEvent`
2. At function start: `prisma.billingEvent.findUnique({ where: { gatewayEventId } })`
3. If `processed: true` — log and return (skip duplicate)
4. Upsert record with `processed: false` before processing
5. After successful processing — update `processed: true, processedAt: new Date()`
6. On error — update `error: result.error` (NOT marked processed, allows manual reprocessing)
7. Both Stripe and Paddle handlers now pass `event.id` to `routeBillingEvent`

### Deduplication Flow

```
Webhook arrives with gatewayEventId
  -> findUnique by gatewayEventId
  -> IF processed=true: skip (log "Duplicate — skipping")
  -> IF not found: upsert with processed=false
  -> Process event via GatewayBillingService
  -> IF success: update processed=true, processedAt=now
  -> IF error: update error=message (allows manual retry)
```

---

## Files Summary

### New (1)

| File                                                                     | Lines | Purpose                     |
| ------------------------------------------------------------------------ | ----- | --------------------------- |
| `infra/prisma/migrations/20260411000000_add_billing_event/migration.sql` | 28    | BillingEvent table creation |

### Modified (5)

| File                                                          | Changes                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/client/app/dashboard/settings/billing/page.tsx`         | Removed BUNDLES constant, added error/empty states, simplified types |
| `packages/ports/src/PaymentAdapter.ts`                        | Added `id: string` to `WebhookEvent` interface                       |
| `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts` | Returns `event.id` in `parseWebhookEvent`                            |
| `apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts` | Returns event ID in `parseWebhookEvent`                              |
| `apps/api/src/billing/billingWebhookRoutes.ts`                | Added idempotency check with BillingEvent upsert/update              |
| `infra/prisma/schema.prisma`                                  | Added BillingEvent model + relation on Account                       |

---

## Quality Gates

| Check                                  | Result                                              |
| -------------------------------------- | --------------------------------------------------- |
| TypeScript build                       | 9/9 tasks, 0 errors                                 |
| ESLint                                 | 0 errors, 0 warnings                                |
| BUNDLES fallback grep                  | 0 matches                                           |
| Idempotency keywords in webhook routes | 16 matches                                          |
| BillingEvent model in schema           | Present with `gatewayEventId @unique`               |
| Migration applied                      | Via direct SQL + `prisma migrate resolve --applied` |
