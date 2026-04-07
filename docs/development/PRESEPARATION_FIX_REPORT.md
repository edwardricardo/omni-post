# Pre-Separation Fix Report

**Date:** 2026-04-02
**Reference:** `docs/development/PRESEPARATION_AUDIT.md`

---

## Fixes Applied

### Fix 1 -- ProjectProvider (S10)

**File:** `apps/client/providers/ProjectProvider.tsx`
**Change:** Replaced `fetchAccounts()` which called `/api/backend/admin/accounts` (admin-only endpoint, rejected customer tokens) with a call to `/api/backend/auth/customer/me`. The new implementation extracts `accountId` from the authenticated customer's profile and returns a single-entry array to preserve the provider's interface contract.
**Customer endpoint used:** `GET /auth/customer/me` (returns `{ user: { id, accountId, role } }`)
**Result:** `accountId` and `projectId` now resolve correctly for authenticated customers.

### Fix 2 -- useAnalytics + analytics page (S6)

**File:** `apps/client/hooks/api/useAnalytics.ts`
**Change:** Completely rewritten. Removed import from admin `apiClient` (which called `/admin/analytics/overview` bypassing the proxy). Now fetches from `/api/backend/analytics/dashboard` through the Next.js proxy with customer authentication. Accepts `projectId` and `timeRange` parameters.
**Customer endpoint used:** `GET /analytics/dashboard?projectId=X&timeRange=30d`

**File:** `apps/client/app/dashboard/analytics/page.tsx`
**Change:** Completely rewritten. The old page was a system-level admin dashboard (Total Users, MRR, Churn Rate, Subscriptions, Geographic, Feature Usage). Replaced with a customer analytics dashboard showing: Total Posts, Total Engagement, Total Reach, Avg Engagement Rate, Performance Score, platform-level engagement chart, and platform breakdown table.
**Result:** Analytics page loads customer-scoped data correctly.

### Fix 3 -- Dead files deleted (S1, S2-S5, S7-S9, S11)

**Files deleted:** 9

| #   | File                                         | Lines    |
| --- | -------------------------------------------- | -------- |
| 1   | `apps/client/lib/apiClient.ts`               | 388      |
| 2   | `apps/client/hooks/api/useDashboardStats.ts` | 30       |
| 3   | `apps/client/hooks/api/useSubscriptions.ts`  | 27       |
| 4   | `apps/client/hooks/api/useAuditLogs.ts`      | 33       |
| 5   | `apps/client/hooks/api/useAccounts.ts`       | 69       |
| 6   | `apps/client/hooks/api/useSecurity.ts`       | 60       |
| 7   | `apps/client/hooks/api/useExecutive.ts`      | 40       |
| 8   | `apps/client/hooks/api/usePosts.ts`          | 40       |
| 9   | `apps/client/hooks/api/useWebhooks.ts`       | 60       |
|     | **TOTAL**                                    | **~747** |

**Build after deletion:** 0 errors, 9/9 tasks.

### Fix 4 -- Test fixtures (S12)

**File:** `apps/client/tests/e2e/fixtures/test-data.ts`
**Change:** Removed `adminUser` entry (lines 14-20) from `TestUsers`. Client E2E tests now only contain customer user fixtures.

### Fix 5 -- JSDoc (S13)

**File:** `apps/api/src/auth/authRoutes.ts`
**Change:** Updated misleading JSDoc from "Register new admin user" to "Register new user (legacy admin registration endpoint at /auth/register)".

---

## Build: 0 errors, 9/9 tasks

## Verification

- No admin imports remaining in `apps/client`: 0 matches
- ProjectProvider resolves `accountId`/`projectId` via customer endpoint: `GET /auth/customer/me`
- Analytics hook uses customer endpoint: `GET /analytics/dashboard`
- Dead files deleted: 9/9
- Build passes: 9/9 tasks, 0 TS errors
