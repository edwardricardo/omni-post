# Code-First Audit Fixes Report

Date: 2026-04-10
Audit Reference: `docs/development/CODE_FIRST_AUDIT_REPORT.md`

---

## Summary

| Fix                          | Finding                             | Status | Proof                                                        |
| ---------------------------- | ----------------------------------- | ------ | ------------------------------------------------------------ |
| B1 — Permission checks       | 9 unguarded admin endpoints         | DONE   | 0 unguarded remaining (9 self-service auth correctly exempt) |
| B2 — Test roles cleanup      | EDITOR + ROL_DE_PRUEBA (0 users)    | DONE   | Deleted from DB, 3 roles remain                              |
| F1 — Remove queue/compliance | Client contamination (5 admin refs) | DONE   | 0 admin refs in client                                       |
| F2 — Client backlog          | Queue feature deferred              | DONE   | `docs/development/CLIENT_BACKLOG.md`                         |
| F3 — Decimal fix             | analytics/page.tsx:314              | DONE   | `Number()` wrapper added                                     |
| F4 — Trial hooks wired       | 3 orphan hooks + no action buttons  | DONE   | Buttons added, hooks imported                                |
| F5 — Security i18n           | 2 pages missing i18n                | DONE   | `useTranslations` in both pages                              |
| F6 — Stale comments          | "OmniPost Admin" in client          | DONE   | 0 stale refs remain                                          |

---

## Backend Fixes

### B1 — Permission Checks Added to 9 Endpoints

New permissions added to enum (`rbacService.ts`):

- `DASHBOARD_VIEW = "dashboard:view"`
- `POST_MANAGE = "post:manage"`

DB: 6 RolePermission rows inserted (2 perms x SUPER_ADMIN, ADMIN, SUPPORT).

| File                             | Endpoints                                     | Permission Added |
| -------------------------------- | --------------------------------------------- | ---------------- |
| `dashboardRoutes.ts:61,71,81,91` | 4 (stats, accounts, subscriptions, analytics) | `DASHBOARD_VIEW` |
| `schedulingRoutes.ts:26,35,44`   | 3 (scheduled posts, cancel, reschedule)       | `POST_MANAGE`    |
| `mfaRoutes.ts:454,464`           | 2 (admin MFA status, force-disable)           | `USER_MANAGE`    |

Remaining `[requireAdminAuth]` without Permission: 9 — all in `adminAuthRoutes.ts` (self-service: /me, /logout, /refresh, MFA self-service, sessions). Correctly exempt.

### B2 — Test Roles Cleaned

| Role          | Users | Action                          |
| ------------- | ----- | ------------------------------- |
| EDITOR        | 0     | Deleted (3 permissions removed) |
| ROL_DE_PRUEBA | 0     | Deleted (0 permissions)         |

Remaining roles:

| Role        | Level | System | Permissions |
| ----------- | ----- | ------ | ----------- |
| SUPER_ADMIN | 100   | true   | 17          |
| ADMIN       | 50    | true   | 16          |
| SUPPORT     | 10    | true   | 7           |

---

## Frontend Fixes

### F1 — Client Contamination Removed

Files deleted:

- `apps/client/app/dashboard/queue/page.tsx`
- `apps/client/components/queue/` (entire directory — useQueueManager.ts + 9 related components)
- `apps/client/hooks/api/useCompliance.ts`

Files modified:

- `apps/client/components/publishing/publishingDashboardApi.ts` — removed `fetchPublishingQueue` function
- `apps/client/components/publishing/UnifiedPublishingDashboard.tsx` — removed import/call

Verification: 0 admin endpoint references remaining in `apps/client/`.

### F2 — Client Backlog Created

`docs/development/CLIENT_BACKLOG.md` — Publishing Queue Monitor feature spec for customer-scoped queue view.

### F3 — Decimal Crash Fixed

`apps/admin/app/(dashboard)/analytics/page.tsx:314`:

- Before: `summary.growthMetrics.trialConversions.toFixed(1)`
- After: `Number(summary.growthMetrics.trialConversions ?? 0).toFixed(1)`

Line 185 already had correct `Number()` wrapping.

### F4 — Trial Hooks Wired + Action Buttons Added

`apps/admin/app/(dashboard)/subscriptions/page.tsx`:

- Imported `useEndTrial`, `useConvertTrial` from `@/hooks/api/useSubscriptionMutations`
- Added "End Trial" and "Convert to Paid" action buttons per trial row
- Toast feedback on success/error using existing page patterns
- i18n keys added to `en.json` and `es.json`: endTrial, convertToPaid, endTrialSuccess, endTrialError, convertTrialSuccess, convertTrialError, actions

### F5 — Security Sub-Pages i18n

| Page                     | Change                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `security/rbac/page.tsx` | Added `useTranslations("security")`, replaced 2 hardcoded strings with `ts("rbac.title")`, `ts("rbac.description")` |
| `security/mfa/page.tsx`  | Added `useTranslations("security")`, replaced 2 hardcoded strings with `ts("mfa.title")`, `ts("mfa.description")`   |

Keys already existed in `en.json:539-602` and `es.json`.

### F6 — Stale Admin Comments Cleaned

- `apps/client/app/dashboard/settings/notifications/page.tsx:11` — "OmniPost Admin" changed to "OmniPost"
- `apps/client/app/dashboard/settings/notifications/page.tsx:4` — JSDoc path fixed

Verification: 0 "OmniPost Admin" references in `apps/client/`.

---

## Additional Fix

- SuperAdmin name updated from "Edward" to "SuperAdmin" in DB and `infra/prisma/seed.ts:431`

---

## Build: 9/9 tasks successful, 0 TS errors
