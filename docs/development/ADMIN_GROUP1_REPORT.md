# Admin Group 1 Fixes Report

**Date:** 2026-04-04

---

## Summary

| Fix                   | Status | Verified                                                        |
| --------------------- | ------ | --------------------------------------------------------------- |
| Trial display bug     | DONE   | isOnTrial=false in DB, billing endpoint condition correct       |
| Provider tier CRUD    | DONE   | POST + PATCH /status endpoints created                          |
| Account tier CRUD     | DONE   | POST + PATCH /status endpoints created                          |
| AdminUser CRUD        | DONE   | 6 endpoints: list, create, detail, update, deactivate, activate |
| AdminUser page        | DONE   | /users page + sidebar link + invite dialog                      |
| RBAC editing          | DONE   | Permissions displayed grouped, toggleable for SUPER_ADMIN       |
| MFA self-service      | DONE   | MfaSelfService component: setup QR + verify + disable           |
| Spacing reduced       | DONE   | PageHeader mb-6→mb-4, layout py-6→py-4, page gaps reduced       |
| Audit log date filter | DONE   | datetime-local From/To inputs in filter bar                     |

---

## Fix 1 — Trial Display Bug

**Problem:** Account showed "10 days remaining" even when not on trial.

**Root cause:** Demo Account had `isOnTrial=true` by default from seed. Billing endpoint condition was already correct (`isOnTrial && trialEndDate`).

**Fix:**

- `infra/prisma/seed.ts` — Updated Demo Account upsert to set `isOnTrial: false`
- DB already had correct value (`isOnTrial=false`)
- `AccountBillingPanel.tsx` — Verified trial guard at line 109 is correct

---

## Fix 2 — Pricing Tier CRUD

**File:** `apps/api/src/admin/pricingRoutes.ts` (522 lines)

4 new endpoints:

| Method | Path                                       | Handler                      |
| ------ | ------------------------------------------ | ---------------------------- |
| POST   | `/admin/pricing/provider-tiers`            | `createProviderTier()`       |
| POST   | `/admin/pricing/account-tiers`             | `createAccountTier()`        |
| PATCH  | `/admin/pricing/provider-tiers/:id/status` | `toggleProviderTierStatus()` |
| PATCH  | `/admin/pricing/account-tiers/:id/status`  | `toggleAccountTierStatus()`  |

**Frontend:**

- Extracted `ProviderTiersTab.tsx` and `AccountTiersTab.tsx` from pricing page
- "New Tier" dialog in each tab with validation
- Clickable status badge per row (Active/Inactive toggle)
- 3 new hooks: `useCreateProviderTier()`, `useCreateAccountTier()`, `useToggleTierStatus()`
- Pricing page reduced from 801 to 485 lines

---

## Fix 3 — AdminUser CRUD

**New file:** `apps/api/src/admin/adminUserRoutes.ts` (472 lines)

6 endpoints:

| Method | Path                          | Auth                                        |
| ------ | ----------------------------- | ------------------------------------------- |
| GET    | `/admin/users`                | requireAdmin                                |
| POST   | `/admin/users`                | requireSuperAdmin                           |
| GET    | `/admin/users/:id`            | requireAdmin                                |
| PUT    | `/admin/users/:id`            | requireAdmin (SUPER_ADMIN for role changes) |
| POST   | `/admin/users/:id/deactivate` | requireSuperAdmin                           |
| POST   | `/admin/users/:id/activate`   | requireSuperAdmin                           |

Safety: Cannot create SUPER_ADMIN via API. Cannot deactivate last SUPER_ADMIN. Cannot deactivate self.

**Frontend:**

- New page: `apps/admin/app/(dashboard)/users/page.tsx`
- StatCards: Total Users, Active, Admins, Support
- DataTable: Name, Email, Role Badge, Last Login, Status, Actions
- "Invite User" dialog with temporary password display after creation
- Deactivate via ConfirmDialog, Activate inline
- New hook: `apps/admin/hooks/api/useAdminUsers.ts`
- Sidebar: Added "Admin Users" link with UserCog icon under Operations

---

## Fix 4 — Security: RBAC + MFA

**RBAC (`RbacManager.tsx`):**

- Permissions displayed grouped by category with readable labels
- SUPER_ADMIN users see toggle switches per permission
- Non-SUPER_ADMIN see read-only Yes/No badges
- Fixed `any` type on user mapping

**MFA:**

- New component: `apps/admin/components/security/MfaSelfService.tsx`
- Setup flow: POST `/auth/mfa/setup` → QR code → verify TOTP → backup codes
- Disable flow: enter TOTP code → POST `/auth/mfa/disable`
- Rendered above admin MFA management table in MfaManager

---

## Fix 5 — UX: Spacing + Audit Log Date Filter

**Spacing:**

- `PageHeader.tsx`: `mb-6` → `mb-4`
- `layout.tsx`: `py-6` → `py-4`
- All dashboard pages: wrapper gaps `mb-6`/`gap-6` → `mb-4`/`gap-4`
- Security components: spacing reduced
- WebhookMetrics: grid gap reduced

**Audit Log Date Filter:**

- `logs/page.tsx`: Added `startDate` and `endDate` to filters state
- datetime-local inputs in filter bar (From / To)
- Passed as ISO strings to `useAuditLogs(queryFilters)` which already supports them

---

## Build: 0 errors, 9/9 tasks | Tests: 7127 passing (1 pre-existing timeout)
