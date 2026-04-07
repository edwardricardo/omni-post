# Admin Billing Fix Report

**Date:** 2026-04-02

---

## Fix 1 -- Suspend Account

**Root cause:** The accounts page displays customer `Account` records (via `GET /admin/accounts/summary` → `dashboardService.getAccountsSummary()` → `prisma.account.findMany()`), but the suspend action called `PUT /admin/accounts/:id` which updated `prisma.adminUser.isActive` -- a completely different table for internal staff. The `isActive` field shown in the UI was derived (`!trialExpired`), not persisted.

**Fix:**

1. **Schema migration:** Added `isActive Boolean @default(true)` to `Account` model in Prisma schema. Applied via `prisma db push`.
2. **New endpoint:** `PUT /admin/accounts/:accountId/status` in `accountLifecycleRoutes.ts` -- operates on `prisma.account.update()` (not `prisma.adminUser`). Creates audit log with `resource: "Account"`.
3. **Dashboard service:** Changed `dashboardService.ts:121` from `isActive: !trialExpired` (derived) to `isActive: account.isActive` (real DB field).
4. **Frontend:** Changed `updateAccountStatus()` URL from `/admin/accounts/:id` to `/admin/accounts/:id/status`.
5. **DTO:** Added `isActive: boolean` to `AccountDto` in `ReadModelDtos.ts`.

**Table now updated:** `Account` (not `AdminUser`)
**Audit log resource:** `"Account"`

---

## Fix 2 -- Provider Billing View

**Endpoint:** `GET /admin/accounts/:accountId/billing`

Registered in `accountLifecycleRoutes.ts` with `requireAdminAuth` + `requireAdmin`.

The endpoint:

1. Loads account by ID from `prisma.account`
2. Loads channels grouped by provider via `prisma.channel.findMany({ where: { project: { accountId } } })`
3. Loads active `ProviderPricingTier`, `AccountPricingTier`, and `ProviderBundle` records
4. Calls `PricingCalculator.calculateCustomPrice()` with real provider count and pricing tiers
5. Calls `PricingCalculator.findCheaperBundle()` to suggest cheaper alternatives
6. Returns full billing breakdown

**Component:** `apps/admin/components/accounts/AccountBillingPanel.tsx`

Shows:

- Provider Breakdown table (Platform, Channels, Price/Provider)
- Monthly Billing Calculation (provider count, base price, savings, total)
- Bundle suggestion if a cheaper option exists

**Hook:** `apps/admin/hooks/api/useAccountBilling.ts` -- TanStack Query hook with 2-minute stale time.

**Integrated in:** Account detail expanded row in `apps/admin/app/(dashboard)/accounts/page.tsx`. Clicking "View" on any account shows the billing panel below account details.

---

## Build: 0 errors, 9/9 tasks | Tests: 7,145 passing | 0 failures
