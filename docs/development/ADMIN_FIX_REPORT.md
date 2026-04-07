# Admin Fix Report

**Date:** 2026-04-04

---

## Summary

| Fix                     | Status          | Verification                                  |
| ----------------------- | --------------- | --------------------------------------------- |
| P0 Token refresh        | DONE            | curl refresh endpoint returns new accessToken |
| P1a PUT /settings       | PENDING RESTART | Route exists in source, needs API restart     |
| P1b Analytics 404       | DONE            | Dead link replaced with /webhooks             |
| P2a Native modals       | DONE            | 0 native calls remaining (was 23)             |
| P2b TeamMemberRow tests | DONE            | 13/13 tests passing                           |
| P3 System health        | DONE            | Shows "No Data" when 0 events                 |

---

## Fixes Applied

### P0 — Token Refresh

**Problem:** Access token expires in 15 min. Cookie lives 24h. No refresh logic existed.

**Files modified:**

1. `apps/admin/app/actions/auth.ts` — Store 3 cookies on login (admin-session, admin-refresh, admin-csrf). Delete all 3 on logout.

2. `apps/admin/app/api/backend/[...path]/route.ts` — Proxy intercepts 401 TOKEN_EXPIRED, attempts refresh using stored cookies, retries original request with new token. Body is cached before first attempt to support retry on POST/PUT.

3. `apps/admin/app/(dashboard)/layout.tsx` — On page load, if token verification fails, redirects to `/api/auth/refresh?returnTo=/` instead of immediately clearing session.

4. `apps/admin/app/api/auth/refresh/route.ts` (NEW) — Server-side refresh route handler. Reads refresh/csrf cookies, calls backend refresh endpoint, updates session cookie, redirects back. Falls back to login if refresh fails.

5. `apps/admin/app/api/clear-session/route.ts` — Deletes all 3 cookies.

**Verification:**

```
RefreshToken exists: YES
CsrfToken exists: YES
Refresh OK - new token: eyJhbGciOiJIUzI1NiIsInR5cCI6Ik...
```

---

### P1a — PUT /admin/accounts/:id/settings

**Status:** Route exists in source (`executiveRoutes.ts:72-79`). Requires API server restart to load. Code was added in previous session but API was running old code.

---

### P1b — Analytics 404

**Problem:** Dashboard Quick Actions linked to `/analytics` which doesn't exist.

**File modified:** `apps/admin/app/(dashboard)/page.tsx:237-240`

**Change:** Replaced `{ href: "/analytics", title: "Analytics" }` with `{ href: "/webhooks", title: "Webhooks" }`.

---

### P2a — Native Browser Modals

**Problem:** 23 native `alert()`, `confirm()`, `prompt()` calls across 4 files.

**New components created:**

- `apps/admin/components/ui/ConfirmDialog.tsx` — Reusable confirm/cancel dialog using AlertDialog from @packages/ui
- `apps/admin/components/ui/InputDialog.tsx` — Dialog with text input using Dialog from @packages/ui

**Files modified:**

| File                     | alert→toast | confirm→ConfirmDialog | prompt→InputDialog |
| ------------------------ | ----------- | --------------------- | ------------------ |
| `accounts/page.tsx`      | 3           | 0                     | 0                  |
| `subscriptions/page.tsx` | 12          | 4                     | 0                  |
| `RbacManager.tsx`        | 3           | 0                     | 1                  |
| `MfaManager.tsx`         | 2           | 0                     | 1                  |
| **Total**                | **20**      | **4**                 | **2**              |

**Verification:** `grep "alert(\|confirm(\|prompt(" apps/admin` → 0 results.

---

### P2b — TeamMemberRow Security Tests

**Problem:** 13 role-based security tests were deleted during Layer 3 cleanup.

**File created:** `apps/client/components/team/TeamMemberRow.test.tsx`

**13 tests covering:**

| #   | Test                                         | Result |
| --- | -------------------------------------------- | ------ |
| 1   | OWNER sees role select for non-OWNER members | PASS   |
| 2   | OWNER sees remove button for other members   | PASS   |
| 3   | OWNER cannot change own role (isSelf)        | PASS   |
| 4   | OWNER cannot remove self                     | PASS   |
| 5   | OWNER cannot change another OWNER's role     | PASS   |
| 6   | MANAGER does not see role select             | PASS   |
| 7   | MANAGER does not see remove button           | PASS   |
| 8   | MEMBER does not see role select              | PASS   |
| 9   | MEMBER does not see remove button            | PASS   |
| 10  | VIEWER does not see role select              | PASS   |
| 11  | VIEWER does not see remove button            | PASS   |
| 12  | Displays member name and email               | PASS   |
| 13  | Displays role badge for non-editable roles   | PASS   |

---

### P3 — System Health Edge Case

**Problem:** Shows "Critical" when `totalEvents === 0` (0/0 = 0% success rate).

**File modified:** `apps/admin/app/(dashboard)/webhooks/page.tsx`

**Change:** Added `totalEvents` parameter to `getHealthLabel()` and `getHealthBadgeVariant()`. Returns "No Data" (neutral badge) when `totalEvents === 0`.

---

## Deferred (separate session)

- Grandfathering test data creation (code works, needs DB seed)
- Bundle CRUD POST/DELETE endpoints + UI
- Subscription "Change Plan" dialog

---

## Build: 0 errors, 9/9 tasks | Tests: 13/13 TeamMemberRow | Native modals: 0 remaining
