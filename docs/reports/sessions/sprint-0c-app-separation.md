# Sprint 0C Report — App Separation

Date: 2026-03-29

## Summary

| Metric                        | Before | After                                           |
| ----------------------------- | ------ | ----------------------------------------------- |
| apps/admin pages              | 37     | 12                                              |
| apps/client pages             | 9      | 31                                              |
| Admin component dirs          | 17     | 4 (auth, security, shared, webhooks + settings) |
| Client component dirs         | 4      | 18 (full product)                               |
| Customer pages in correct app | 0%     | 100%                                            |

## Batch 1 — Components + Hooks + Shared

Copied 13 component groups (145 files) + 27 hooks + types + lib utilities from admin to client.
Fixed: missing npm deps (cronstrue, zustand, papaparse, recharts, radix-ui), tsconfig paths, implicit any types in notification store.

## Batch 2 — Pages

Copied 22 pages from admin `(dashboard)/` to client `dashboard/`.
Kept existing client posts pages (more modern with virtual scroll).
Updated dashboard layout sidebar with full navigation (11 items).
Converted 4 server component pages to client components (removed admin-session cookie checks).
Added ProjectProvider to dashboard layout.

## Batch 3 — Admin Cleanup

Removed 26 customer pages from admin.
Removed 13 customer component groups.
Removed 19 unused hooks (kept 9 admin-specific).
Updated admin sidebar to show only Platform + Operations groups.
Fixed broken imports (NotificationBell, UsageMetricsPanel, useAIContentGenerator).

## Batch 4 — CustomerUser Auth Wiring

Updated all client auth flows:

- Login: `/auth/login` → `/auth/customer/login`
- Register: `/auth/register` → `/auth/customer/register` (with accountName, firstName, lastName)
- Cookie: `session` → `customer-session`
- Refresh: `client-refresh` → `customer-refresh`
- Me: `/auth/me` → `/auth/customer/me`
- Proxy: all auth path constants updated
- E2E tests: endpoints updated
- Zero `admin-session` references in client app

## Auth Architecture (Final State)

| App         | User Table   | Login Endpoint            | Cookie           | JWT Secret          |
| ----------- | ------------ | ------------------------- | ---------------- | ------------------- |
| apps/admin  | AdminUser    | POST /admin/auth/login    | admin-session    | ADMIN_JWT_SECRET    |
| apps/client | CustomerUser | POST /auth/customer/login | customer-session | CUSTOMER_JWT_SECRET |

## apps/admin — Final Pages (owner portal)

1. `/` — Root landing
2. `/(auth)/login` — Admin login with MFA
3. `/(dashboard)` — Revenue dashboard (MRR, accounts, trials)
4. `/(dashboard)/accounts` — Customer account management
5. `/(dashboard)/subscriptions` — Billing management
6. `/(dashboard)/executive` — Business KPIs
7. `/(dashboard)/compliance` — GDPR, audit score
8. `/(dashboard)/security` — MFA adoption, RBAC
9. `/(dashboard)/security/mfa` — MFA settings
10. `/(dashboard)/security/rbac` — Role management
11. `/(dashboard)/logs` — System audit logs
12. `/(dashboard)/webhooks` — Webhook dashboard

## apps/client — Final Pages (customer product)

9 existing + 22 migrated = 31 total. Covering:

- Posts (4 pages), Templates (1), Dashboard (1)
- Inbox, Approvals, Analytics (3), Scheduling (4), Queue
- AI (4), Content Library, Channels
- Settings (3), Instagram (2)

## Build and Test

| Check                      | Result                           |
| -------------------------- | -------------------------------- |
| TypeScript build           | 0 errors, 9/9 tasks              |
| All tests                  | 330 files, 6995 passed, 0 failed |
| admin-session in client    | 0 references                     |
| customer-session in client | 6 references                     |
| Admin auth unchanged       | Confirmed                        |
