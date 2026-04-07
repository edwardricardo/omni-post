# Account Improvements Report

**Date:** 2026-04-04

---

## Summary

| Improvement                    | Status | API Verified                                | UI Complete                         |
| ------------------------------ | ------ | ------------------------------------------- | ----------------------------------- |
| Switch plan from billing panel | DONE   | Reuses existing PUT subscription            | Edit Plan button + ChangePlanDialog |
| Extend/reduce grandfathering   | DONE   | PENDING RESTART (new PATCH endpoint)        | Adjust button + date input          |
| Add/remove providers on bundle | DONE   | Covered by ChangePlanDialog                 | Custom/Bundle tabs in dialog        |
| Trial days remaining           | DONE   | PENDING RESTART (billing response extended) | Shows only when isOnTrial=true      |

**Note:** Backend changes (PATCH grandfathering + trial in billing response) require API restart.

---

## Improvement 1 — Switch Plan from Billing Panel

**File:** `apps/admin/components/accounts/AccountBillingPanel.tsx`

Added "Edit Plan" button (Pencil icon) in the billing header row. Opens the existing `ChangePlanDialog` component (reused from subscriptions page). On success, invalidates billing query cache to refresh data.

No new API endpoints needed — reuses `PUT /admin/billing/accounts/:id/subscription`.

---

## Improvement 2 — Extend/Reduce Grandfathering Window

### Backend

**File:** `apps/api/src/admin/accountLifecycleRoutes.ts`

New endpoint: `PATCH /admin/accounts/:accountId/grandfathering`

- Validates `{ effectiveAt: z.string().datetime() }` body
- Checks date is in the future
- Finds AccountSubscription with `status = GRANDFATHERED`
- Updates (or creates) `SubscriptionPriceHistory.effectiveAt`
- Auth: `requireAdminAuth + requireAdmin`

### Frontend

**File:** `apps/admin/components/accounts/AccountBillingPanel.tsx`

When `isGrandfathered`, shows an "Adjust" button (CalendarDays icon) next to the grandfathering detail. Clicking opens an inline date input with Save/Cancel. Calls `PATCH /admin/accounts/:accountId/grandfathering` and shows toast feedback.

---

## Improvement 3 — Add/Remove Providers on Bundle Plan

Already handled by the `ChangePlanDialog` reused in Improvement 1. The dialog has:

- **Custom Plan** tab: 11 provider checkboxes for full control
- **Bundle Plan** tab: selectable bundle cards

The `ChangeAccountSubscriptionUseCase` handles switching between custom and bundle plans, including provider changes.

---

## Improvement 4 — Trial Days Remaining

### Backend

**File:** `apps/api/src/admin/accountLifecycleRoutes.ts`

Extended `getAccountBilling` response (around line 762) with conditional trial info:

```typescript
...(account.isOnTrial && account.trialEndDate && {
  trial: {
    isOnTrial: true,
    trialEndDate: account.trialEndDate.toISOString(),
    daysRemaining: Math.max(0, Math.ceil(
      (account.trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )),
  },
}),
```

### Frontend

**File:** `apps/admin/hooks/api/useAccountBilling.ts`

Added `trial` optional field to `BillingData` interface.

**File:** `apps/admin/components/accounts/AccountBillingPanel.tsx`

Trial info block renders only when `data.trial?.isOnTrial`. Shows:

- Clock icon + "Trial: N days remaining"
- End date formatted on the right

When not on trial: nothing renders (no "0 days" or "expired").

---

## Test Data Status

The Demo Account has:

- `isOnTrial = true`, `trialEndDate = NOW() + 10 days`
- `AccountSubscription.status = GRANDFATHERED`, `pricePerMonth = 25.00`
- `SubscriptionPriceHistory.effectiveAt = 2026-06-03`

After API restart, the billing endpoint will return both `trial` and `grandfathering` fields.

---

## Build: 0 errors, 9/9 tasks
