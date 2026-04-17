# Pre-Separation Code Artifacts Audit

**Date:** 2026-04-02
**Scope:** Read-only diagnostic. Zero code changes.
**Reference:** Sprint 0C app separation (admin/client split)

---

## Executive Summary

The audit found **13 issues** in the client app — vestiges from the pre-separation era when `apps/admin` contained all features. The admin app and API layer are cleanly separated. The client app contains **~770 lines of dead admin code** (a copied apiClient + 8 unused hooks) and **2 broken integrations** (analytics page and ProjectProvider). No security exposure was found — admin endpoints reject unauthenticated requests with 401.

| Severity  | Count  |
| --------- | ------ |
| CRITICAL  | 1      |
| HIGH      | 10     |
| MEDIUM    | 1      |
| LOW       | 1      |
| **TOTAL** | **13** |

---

## Clean Apps

### apps/admin — No Issues Found

The admin app is correctly separated:

- Uses `admin-session` httpOnly cookie for authentication
- All API calls route through Next.js proxy at `/api/backend/` which injects Bearer token
- All endpoints are admin-scoped (`/admin/*`)
- Types are admin-specific: `AdminRole`, `AdminUserProfile`
- Zero references to `CustomerUser`, `customerUser`, or `customer-session`
- Zero cross-app imports from `apps/client`

### apps/api — No Issues Found

The API auth layer is properly isolated:

- `authMiddleware.ts` (old generic middleware) confirmed deleted
- Zero references to `authenticateMiddleware` in production code
- All admin routes use `requireAdminAuth` from `admin/auth/adminAuthMiddleware.ts`
- All customer routes use `requireClientAuth` from `auth/customerAuthMiddleware.ts`
- JWT secrets properly isolated: `ADMIN_JWT_SECRET` vs `CUSTOMER_JWT_SECRET`
- Type discriminators prevent token confusion: `type: "access"` (admin) vs `type: "customer"` (customer)

---

## Issues Found

### CRITICAL (1)

#### S1 — Admin apiClient copied to client app

| Field              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/lib/apiClient.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Lines**          | 1-388 (entire file)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Classification** | WRONG_APP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Problem**        | Complete copy of the admin app's API client. Line 3 JSDoc: _"Typed HTTP client and API facade for the **admin** dashboard"_. Line 7: `const API_URL = process.env.NEXT_PUBLIC_API_URL \|\| "http://localhost:3000"` — calls backend directly, bypassing the Next.js proxy that injects the `customer-session` Bearer token. Contains: `api.admin.*` (dashboard stats, accounts, subscriptions, analytics at lines 196-268), `api.audit.*` (admin audit logs at lines 270-290), admin MFA endpoints (lines 335-342: `/admin/users/${userId}/mfa/status`, `/admin/users/${userId}/mfa/force-disable`), and admin RBAC endpoints (lines 349-384: `/admin/rbac/roles`, user role updates, permission assign/revoke). |
| **Impact**         | 9 hooks in `apps/client/hooks/api/` import from this file. All API calls fail with 401 because the proxy is bypassed. Confuses developers who see "admin" code in the client app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Severity**       | CRITICAL — source of 10 downstream issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Fix Needed**     | Delete the entire file. The client already has its own correct API client at `apps/client/lib/api/client.ts` (class `ApiClient`, customer-scoped, uses proxy).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

### HIGH (10)

#### S2 — Dead hook: useDashboardStats

| Field              | Value                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **File**           | `apps/client/hooks/api/useDashboardStats.ts`                                               |
| **Lines**          | 7 (import), 17 (call)                                                                      |
| **Classification** | WRONG_APP / DEAD                                                                           |
| **Problem**        | Imports `api, DashboardStats` from admin apiClient. Calls `api.admin.getDashboardStats()`. |
| **Impact**         | Dead code — not imported by any client page.                                               |
| **Fix Needed**     | Delete file.                                                                               |

#### S3 — Dead hook: useSubscriptions

| Field              | Value                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useSubscriptions.ts`                                     |
| **Lines**          | 7 (import), 16 (call)                                                           |
| **Classification** | WRONG_APP / DEAD                                                                |
| **Problem**        | Imports `api` from admin apiClient. Calls `api.admin.getSubscriptionSummary()`. |
| **Impact**         | Dead code — not imported by any client page.                                    |
| **Fix Needed**     | Delete file.                                                                    |

#### S4 — Dead hook: useAuditLogs

| Field              | Value                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useAuditLogs.ts`                                                     |
| **Lines**          | 7 (import), 20 (call)                                                                       |
| **Classification** | WRONG_APP / DEAD                                                                            |
| **Problem**        | Imports `api, AuditLog, AuditLogFilters` from admin apiClient. Calls `api.audit.getLogs()`. |
| **Impact**         | Dead code — not imported by any client page.                                                |
| **Fix Needed**     | Delete file.                                                                                |

#### S5 — Dead hook: useAccounts

| Field              | Value                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useAccounts.ts`                                                                                                                              |
| **Lines**          | 7 (import), 16 (call), 49 (direct fetch)                                                                                                                            |
| **Classification** | WRONG_APP / DEAD                                                                                                                                                    |
| **Problem**        | Imports `api` from admin apiClient. Calls `api.admin.getAccountSummary()`. Line 49: `fetch('/api/backend/admin/accounts/${id}')` — admin account mutation endpoint. |
| **Impact**         | Dead code — not imported by any client page.                                                                                                                        |
| **Fix Needed**     | Delete file.                                                                                                                                                        |

#### S6 — Broken hook: useAnalytics (USED by analytics page)

| Field              | Value                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useAnalytics.ts`                                                                                                                                                                                            |
| **Lines**          | 7 (import), 16 (call)                                                                                                                                                                                                              |
| **Classification** | WRONG_APP / BROKEN                                                                                                                                                                                                                 |
| **Problem**        | Imports `api` from admin apiClient. Calls `api.admin.getAnalyticsOverview()` which hits `/admin/analytics/overview` directly (bypassing proxy). **This hook IS used** by `apps/client/app/dashboard/analytics/page.tsx` at line 9. |
| **Impact**         | **Analytics page is broken.** Renders the page shell but data fetch fails with 401 (no auth token, bypasses proxy). User sees loading spinner or error state.                                                                      |
| **Fix Needed**     | Rewrite hook to use `ApiClient` from `lib/api/client.ts` with a customer-scoped analytics endpoint.                                                                                                                                |

#### S7 — Dead hook: useSecurity

| Field              | Value                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useSecurity.ts`                                                                                                                                                                              |
| **Lines**          | 7 (import), 27 (call), 33 (call)                                                                                                                                                                                    |
| **Classification** | WRONG_APP / DEAD                                                                                                                                                                                                    |
| **Problem**        | Imports `api, SecurityStats, RbacHierarchy` from admin apiClient. Calls admin RBAC endpoints: `api.security.rbac.getStatus()` → `/admin/rbac/status`, `api.security.rbac.getHierarchy()` → `/admin/rbac/hierarchy`. |
| **Impact**         | Dead code — not imported by any client page. Customer app should not access global RBAC hierarchy.                                                                                                                  |
| **Fix Needed**     | Delete file.                                                                                                                                                                                                        |

#### S8 — Dead hook: useExecutive

| Field              | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useExecutive.ts`                   |
| **Lines**          | 7 (import)                                                |
| **Classification** | WRONG_APP / DEAD                                          |
| **Problem**        | Imports `DashboardStats` type from admin apiClient.       |
| **Impact**         | Dead code — hook defined but not used by any client page. |
| **Fix Needed**     | Delete file.                                              |

#### S9 — Dead hook: usePosts (shadowed by correct version)

| Field              | Value                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/usePosts.ts`                                                                                       |
| **Lines**          | 7 (import)                                                                                                                |
| **Classification** | WRONG_APP / DEAD                                                                                                          |
| **Problem**        | Imports `api` from admin apiClient. The client dashboard pages use the correct `usePosts` from `@/lib/api/hooks` instead. |
| **Impact**         | Dead code — shadowed by the correct implementation.                                                                       |
| **Fix Needed**     | Delete file.                                                                                                              |

#### S10 — Broken ProjectProvider: calls admin endpoint

| Field              | Value                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/providers/ProjectProvider.tsx`                                                                                                                                                                                                                                                                                              |
| **Lines**          | 102                                                                                                                                                                                                                                                                                                                                      |
| **Classification** | BROKEN                                                                                                                                                                                                                                                                                                                                   |
| **Problem**        | `fetchAccounts()` at line 102 calls `/api/backend/admin/accounts?page=1&limit=100&isActive=true`. This is an admin-only endpoint protected by `requireAdminAuth`. The request goes through the proxy (which injects a customer token), but the backend rejects it because a customer token cannot authenticate against admin middleware. |
| **Impact**         | **ProjectProvider silently fails.** Returns empty array, so `accountId` and `projectId` are never set. Any feature relying on `useProject()` context receives empty strings.                                                                                                                                                             |
| **Fix Needed**     | Replace with a customer-scoped endpoint (e.g., the customer's own account data from `/auth/customer/me` or a dedicated `/accounts/me` endpoint).                                                                                                                                                                                         |

#### S11 — Dead hook: useWebhooks

| Field              | Value                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/hooks/api/useWebhooks.ts`                                                                                                                                                       |
| **Lines**          | 47                                                                                                                                                                                           |
| **Classification** | WRONG_APP / DEAD                                                                                                                                                                             |
| **Problem**        | Fetches from `/api/webhooks/dashboard/metrics` — a webhook admin dashboard endpoint. Does NOT route through the proxy (uses bare `/api/webhooks/` path instead of `/api/backend/webhooks/`). |
| **Impact**         | Dead code — not imported by any client page.                                                                                                                                                 |
| **Fix Needed**     | Delete file.                                                                                                                                                                                 |

---

### MEDIUM (1)

#### S12 — Test fixtures contain admin user

| Field              | Value                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/client/tests/e2e/fixtures/test-data.ts`                                                             |
| **Lines**          | 14-20                                                                                                     |
| **Classification** | LEGACY                                                                                                    |
| **Problem**        | Contains `adminUser` fixture with `role: "admin"`. Client E2E tests should only test customer user flows. |
| **Impact**         | Tests may attempt admin operations. Confusing for future developers.                                      |
| **Fix Needed**     | Remove `adminUser` entry from `TestUsers`.                                                                |

---

### LOW (1)

#### S13 — Misleading JSDoc in auth register route

| Field              | Value                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**           | `apps/api/src/auth/authRoutes.ts`                                                                                                                                                                                           |
| **Lines**          | 47-48                                                                                                                                                                                                                       |
| **Classification** | COSMETIC                                                                                                                                                                                                                    |
| **Problem**        | JSDoc says _"Register new admin user"_ but the route is at `/auth/register` (not under `/admin/` prefix). The route IS functional and calls `authService.registerAdmin()`. The naming mismatch is confusing but not broken. |
| **Impact**         | Developer confusion. No runtime impact.                                                                                                                                                                                     |
| **Fix Needed**     | Update JSDoc to clarify the endpoint's purpose, or move route to `/admin/auth/register`.                                                                                                                                    |

---

## Safe to Delete

Files that can be deleted with **zero functional impact** (all are dead code):

| #   | File                                         | Lines    | Reason                                                |
| --- | -------------------------------------------- | -------- | ----------------------------------------------------- |
| 1   | `apps/client/lib/apiClient.ts`               | 388      | Admin apiClient copy; no client page uses it directly |
| 2   | `apps/client/hooks/api/useDashboardStats.ts` | ~30      | Dead hook, not imported by any page                   |
| 3   | `apps/client/hooks/api/useSubscriptions.ts`  | ~27      | Dead hook                                             |
| 4   | `apps/client/hooks/api/useAuditLogs.ts`      | ~33      | Dead hook                                             |
| 5   | `apps/client/hooks/api/useAccounts.ts`       | ~69      | Dead hook                                             |
| 6   | `apps/client/hooks/api/useSecurity.ts`       | ~60      | Dead hook                                             |
| 7   | `apps/client/hooks/api/useExecutive.ts`      | ~40      | Dead hook                                             |
| 8   | `apps/client/hooks/api/usePosts.ts`          | ~40      | Dead hook (shadowed by `@/lib/api/hooks` version)     |
| 9   | `apps/client/hooks/api/useWebhooks.ts`       | ~60      | Dead hook                                             |
|     | **TOTAL**                                    | **~770** |                                                       |

**Note:** `useAnalytics.ts` (S6) is NOT safe to delete — it is actively used by `app/dashboard/analytics/page.tsx`. It must be rewritten, not deleted.

---

## Fix Priority Order

| Priority | Issue(s)              | Action                                                                  | Risk                                                           | Effort |
| -------- | --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| 1        | S1, S2-S5, S7-S9, S11 | Delete `apiClient.ts` and 8 dead hooks                                  | None (dead code)                                               | 5 min  |
| 2        | S10                   | Fix `ProjectProvider.tsx` line 102 to use customer endpoint             | Medium — must verify backend exposes customer account endpoint | 30 min |
| 3        | S6                    | Rewrite `useAnalytics` hook to use `ApiClient` from `lib/api/client.ts` | Medium — need customer analytics endpoint                      | 1 hr   |
| 4        | S12                   | Remove `adminUser` from test fixtures                                   | Low                                                            | 5 min  |
| 5        | S13                   | Update JSDoc in `authRoutes.ts`                                         | Low                                                            | 5 min  |

---

## Honest Assessment

### 4a — How bad is the situation?

I found 13 issues, all concentrated in `apps/client`. The admin app and API layer are cleanly separated — the Sprint 0C migration did its job there. The client app, however, carries ~770 lines of dead admin code that was clearly copied from admin during the initial scaffolding and never cleaned up. Two features are actively broken (analytics page and ProjectProvider). The good news: this is fixable in a single focused session. Priority 1 (deleting dead code) takes 5 minutes. Priorities 2-3 (fixing broken integrations) require verifying backend endpoint availability but are straightforward once confirmed.

### 4b — What is the single most dangerous artifact?

**`apps/client/providers/ProjectProvider.tsx` line 102.** It calls `/api/backend/admin/accounts` — an admin endpoint that rejects customer tokens. This silently fails and returns an empty array, which means `projectId` and `accountId` are never resolved. Every feature in the client dashboard that depends on project context (posts, channels, analytics, publishing, scheduling) receives empty IDs. This is likely the root cause of multiple "no data" issues in the client app.

### 4c — Are there any patterns that indicate deeper problems?

Yes. The existence of `apps/client/lib/apiClient.ts` (a complete admin apiClient copy) and 8 dead hooks that import from it suggests the client app was initially scaffolded by copying admin files and renaming them, rather than being built from scratch with customer-scoped architecture. This "copy-paste-then-adapt" pattern means any new feature added to admin could accidentally be replicated in client if the same pattern is followed. The client DOES have its own proper API client (`lib/api/client.ts`), but the coexistence of both creates confusion about which to use.

### 4d — What is safe to delete entirely?

9 files totaling ~770 lines:

- `apps/client/lib/apiClient.ts` (388 lines) — the admin apiClient copy
- 8 hooks in `apps/client/hooks/api/`: `useDashboardStats`, `useSubscriptions`, `useAuditLogs`, `useAccounts`, `useSecurity`, `useExecutive`, `usePosts`, `useWebhooks`

None of these are imported by any client page or component. Deleting them has zero functional impact and removes a significant source of confusion.
