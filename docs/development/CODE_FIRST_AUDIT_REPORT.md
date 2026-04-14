# Code-First Audit Report

Date: 2026-04-10
Method: Direct code reading + grep verification + API calls + DB queries
Branch: Genesis

---

## 1. API State

### Endpoints (actual count from code)

- Total route files: 69
- Total endpoints (method+path): 428
- Responding with 200: 15/15 core admin endpoints tested
- Responding with 404: 3 (path prefix mismatch -- see note below)

Tested endpoints:

| Endpoint                            | Status |
| ----------------------------------- | ------ |
| GET /admin/dashboard/stats          | 200    |
| GET /admin/accounts/summary         | 200    |
| GET /admin/subscriptions/summary    | 200    |
| GET /admin/billing/stats            | 200    |
| GET /admin/pricing/tiers            | 200    |
| GET /admin/users                    | 200    |
| GET /admin/rbac/status              | 200    |
| GET /admin/rbac/hierarchy           | 200    |
| GET /admin/audit/logs               | 200    |
| GET /admin/audit/stats              | 200    |
| GET /admin/queue/stats              | 200    |
| GET /admin/billing/trials/expiring  | 200    |
| GET /api/admin/analytics/metrics    | 200    |
| GET /api/admin/compliance/metrics   | 200    |
| GET /api/webhooks/dashboard/metrics | 200    |

**Path prefix inconsistency:** Most admin routes use `/admin/*`, but analytics uses `/api/admin/analytics/*`, compliance uses `/api/admin/compliance/*`, and webhook dashboard uses `/api/webhooks/dashboard/*`. This complicates proxy/gateway rules.

### RBAC Migration

| Metric                                                                  | Count         | Target    |
| ----------------------------------------------------------------------- | ------------- | --------- |
| `requireAdmin` in route preHandlers                                     | 0             | 0         |
| `requireSuperAdmin` in route preHandlers                                | 0             | 0         |
| `requireAdminAuth` only (no Permission check)                           | 28 endpoints  | see below |
| Permission-based preHandlers (`requireAdminAuth` + `requirePermission`) | ~72 endpoints | --        |

**13 endpoints missing Permission checks** (only have `requireAdminAuth`):

| File                  | Lines           | Endpoints               | Should require              |
| --------------------- | --------------- | ----------------------- | --------------------------- |
| `dashboardRoutes.ts`  | 59,69,79,89     | 4 stats/summary routes  | `DASHBOARD_VIEW` or similar |
| `schedulingRoutes.ts` | 24,33,42        | 3 scheduling routes     | `POST_MANAGE`               |
| `samlRoutes.ts`       | 206,215,224,233 | 4 SAML config routes    | `SYSTEM_CONFIGURE`          |
| `oidcRoutes.ts`       | 235,244,253,262 | 4 OIDC config routes    | `SYSTEM_CONFIGURE`          |
| `mfaRoutes.ts`        | 452,462         | 2 admin MFA mgmt routes | `USER_MANAGE`               |

Remaining 15 `requireAdminAuth`-only endpoints are self-service auth operations (`/me`, `/logout`, `/refresh`, `/mfa/*`, `/auth/permissions`) -- acceptable without Permission checks.

**DB Roles:**

| Role          | Level | System | Permissions |
| ------------- | ----- | ------ | ----------- |
| SUPER_ADMIN   | 100   | true   | 15          |
| ADMIN         | 50    | true   | 14          |
| ROL_DE_PRUEBA | 50    | false  | 3           |
| EDITOR        | 30    | false  | **0**       |
| SUPPORT       | 10    | true   | 5           |

**FINDING:** EDITOR role has 0 permissions -- an admin user with EDITOR role can authenticate but will get 403 on every permission-guarded endpoint. They CAN access the 13 unguarded endpoints above.

### Subscription Summary

- Returns plan data: **YES** (evidence: `dashboardService.ts:129-137` -- plan object with type, name, status, providers, pricePerMonth)
- Returns revenue stats: **YES** (evidence: `dashboardService.ts:264-289` -- totalRevenue, monthlyRevenue, conversionRate)
- API response includes: subscriptions array with `plan` objects, trials array with `plan` objects, stats with revenue/conversion

### Client Routes in Admin

- Active client routes in admin directory: **0** (target: 0)
- Scheduling client routes properly separated in `scheduling/schedulingClientRoutes.ts` with `/api/scheduling/*` paths and `requireClientAuth`
- NOTE: `schedulingClientRoutes.ts` imports a handler from `../admin/SchedulingSlotHandlers.js` -- shared handler, not a security issue (different auth middleware)

---

## 2. API Contamination

### Admin code in apps/api shared routes

**CLEAN** -- 0 findings.

- No `AdminUser`, `adminUser`, `AdminRole`, `adminAuth` references in client-facing route files
- Exception: `channels/channelRoutes.ts:428` has ONE admin-only hard-delete endpoint guarded by `requireAdminAuth + requirePermission(Permission.ACCOUNT_MANAGE)` -- intentional dual-purpose file

### Admin concepts in customer auth

**CLEAN** -- 0 references to admin concepts in `apps/api/src/application/customer-auth/` or `packages/`

### Route registration

**PROPERLY SCOPED** with caveats:

- Admin routes registered with explicit `/admin/*` path prefixes
- Client routes use `/api/*` or root paths
- Auth properly separated: admin uses `requireAdminAuth`, client uses `requireClientAuth`
- No scoped prefix plugin wrapping (each route defines its own full path)

### Data isolation

| Check                                  | Result              | Evidence                            |
| -------------------------------------- | ------------------- | ----------------------------------- |
| Admin accesses CustomerUser data       | **NO**              | 0 findings in `apps/api/src/admin/` |
| Admin accesses customer posts/channels | **YES (by design)** | Aggregate stats for monitoring      |

Admin-specific data access (all legitimate monitoring):

- `SchedulingPostHandlers.ts:88,98,226,322` -- `prisma.post.*` (manage scheduled posts)
- `SchedulingSlotHandlers.ts:68,163,242,324,405` -- `prisma.project.*` (scheduling lookup)
- `dashboardService.ts:42` -- `prisma.project.count()` (aggregate stats)
- `AnalyticsDashboardHandlers.ts:70,73,76,82,88` -- project/post/channel counts and groupBy

Assessment: These are aggregate monitoring operations. No per-customer personal data (CustomerUser profiles, credentials, private settings) is accessed.

---

## 3. Frontend State

### Pages

| Metric                     | Count                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| Total pages                | 14                                                                          |
| Pages in sidebar           | 12                                                                          |
| Pages NOT in sidebar       | 2 (`/security/rbac`, `/security/mfa` -- sub-routes, accessible from parent) |
| Sidebar links with no page | **0**                                                                       |

All 12 sidebar href values have matching `page.tsx` files.

### Hooks

| Metric                | Count |
| --------------------- | ----- |
| Total hook files      | 19    |
| Orphan hooks (unused) | 3     |

Orphan hooks:

- `useStartTrial` (from `useSubscriptionMutations.ts`) -- 0 imports in app/components
- `useEndTrial` (from `useSubscriptionMutations.ts`) -- 0 imports in app/components
- `useConvertTrial` (from `useSubscriptionMutations.ts`) -- 0 imports in app/components

All three are trial lifecycle mutations that exist but are never imported. The subscriptions page handles trial operations via inline fetch calls instead.

### Recent Sprint Fixes (code-verified)

| Fix                         | Code Evidence                                                                                            | Status |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| parseApiError exists        | `lib/parseApiError.ts` (207 lines), 90+ import usages                                                    | PASS   |
| AccessDenied used in pages  | 9 pages import it: /, accounts, webhooks, pricing, compliance, subscriptions, security, analytics, users | PASS   |
| No raw error.message toasts | 0 matches for `toast.error(err.message)` or `toast.error(error.message)`                                 | PASS   |
| Token refresh in proxy      | `route.ts:18` attemptTokenRefresh defined, `:104` TOKEN_EXPIRED check, `:116` refresh+retry              | PASS   |
| No hardcoded grays          | 0 matches for `bg-gray-`, `text-gray-`, `border-gray-` in app/components                                 | PASS   |
| No native dialogs           | 0 matches for `alert(`, `confirm(`, `prompt(` in app/components                                          | PASS   |
| next-intl messages          | en.json: 1354 lines, es.json: 1360 lines, `useTranslations` in 36 files (108 calls)                      | PASS   |

**7/7 fixes verified.**

---

## 4. Admin Code in apps/client (PRIMARY CONCERN)

| Check                        | Findings | Status           |
| ---------------------------- | -------- | ---------------- |
| AdminUser references         | 0 found  | CLEAN            |
| Admin auth cookies           | 0 found  | CLEAN            |
| Admin API endpoints called   | 5 found  | **CONTAMINATED** |
| Admin component imports      | 0 found  | CLEAN            |
| SUPER_ADMIN role checks      | 0 found  | CLEAN            |
| Pricing tier management      | 0 found  | CLEAN            |
| Admin-level subscription ops | 0 found  | CLEAN            |
| Compliance/audit features    | 19 found | **CONTAMINATED** |
| Webhook management (admin)   | 0 found  | CLEAN            |

### Overall client status: CONTAMINATED (2 categories)

### Contamination Details

#### Finding 1: Admin queue endpoints in client (CRITICAL)

**File: `apps/client/components/queue/useQueueManager.ts`**

- Line 147: `fetch("/api/backend/admin/queue/jobs?types=waiting,active,failed,delayed,completed&start=0&end=99")`
- Line 166: `fetch("/api/backend/admin/queue/stats")`
- Line 251: `fetch("/api/backend/admin/queue/jobs/${jobId}/retry", { method: "POST" })`
- Line 264: `fetch("/api/backend/admin/queue/jobs/${jobId}/remove", { method: "POST" })`

**File: `apps/client/components/publishing/publishingDashboardApi.ts`**

- Line 213: `fetch("${API_URL}/admin/queue?projectId=${projectId}")`

**File: `apps/client/app/dashboard/queue/page.tsx`**

- Line 4: JSDoc says "admin users to monitor, retry, and remove publishing jobs"
- Line 19: Renders `PublishingQueueManager` which uses `useQueueManager`

**Verdict: GENUINE CONTAMINATION.** The client app's queue page relies entirely on admin-only `/admin/queue/*` endpoints. Regular client users should not have access to retry/remove BullMQ jobs or view raw queue stats. These endpoints are protected by `requireAdminAuth` on the backend, so calls will fail with 401/403 for customer users. The page is non-functional for actual client users.

**Action needed:** Either create customer-scoped queue endpoints (user can see their own publishing jobs) or remove the queue page from client.

#### Finding 2: Admin compliance hook in client (DEAD CODE)

**File: `apps/client/hooks/api/useCompliance.ts`**

- Line 93: `fetch("/api/backend/api/admin/compliance/metrics")`
- Line 94: `fetch("/api/backend/api/admin/compliance/audit-logs")`

**Verdict: CONTAMINATION (dead code).** The hook fetches admin-only compliance endpoints but is NOT imported by any page or component in the client app (0 usages). Should be removed.

#### Finding 3: Admin references in comments (COSMETIC)

- `apps/client/app/dashboard/queue/page.tsx:4` -- "admin users to monitor" in JSDoc
- `apps/client/app/dashboard/settings/notifications/page.tsx:3` -- "@description ... /admin/settings/notifications"
- `apps/client/app/dashboard/settings/notifications/page.tsx:11` -- `title: "Notification Preferences - OmniPost Admin"`
- `apps/client/app/dashboard/instagram/upload/page.tsx:514` -- commented-out admin title

**Verdict: NOT functional contamination.** Stale comments and metadata. The notification page title saying "OmniPost Admin" is misleading to users but not a security issue.

---

## 5. Gaps Found

### Endpoints with no frontend (from actual code)

| Endpoint                         | Hook?   | Page usage?                        |
| -------------------------------- | ------- | ---------------------------------- |
| `admin/billing/trials/expiring`  | NO      | NO                                 |
| `admin/audit/export`             | NO      | NO                                 |
| `admin/analytics/overview`       | NO      | NO (only in test file)             |
| `admin/billing/export`           | No hook | Inline fetch in subscriptions page |
| `admin/accounts/bulk/suspend`    | No hook | Inline fetch in accounts page      |
| `admin/accounts/bulk/reactivate` | No hook | Inline fetch in accounts page      |

3 endpoints have zero frontend coverage. 3 endpoints have inline fetches without dedicated hooks.

### Orphan hooks

- `useStartTrial` -- defined in `useSubscriptionMutations.ts`, 0 imports
- `useEndTrial` -- defined in `useSubscriptionMutations.ts`, 0 imports
- `useConvertTrial` -- defined in `useSubscriptionMutations.ts`, 0 imports

### Potential crashes (unsafe access)

| File                 | Line | Code                                                | Risk                                                                                                                                                                        |
| -------------------- | ---- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analytics/page.tsx` | 314  | `summary.growthMetrics.trialConversions.toFixed(1)` | HIGH -- missing `Number()` wrapper. Same field on line 185 correctly uses `Number()`. If trialConversions is a Prisma Decimal string, `.toFixed()` may behave unexpectedly. |

### i18n gaps

- `useTranslations` used in 36 files (108 total calls) -- good coverage
- **2 pages missing i18n:**
  - `security/rbac/page.tsx:16-17` -- hardcoded "Role-Based Access Control" title/description
  - `security/mfa/page.tsx:17-18` -- hardcoded "Multi-Factor Authentication" title/description

---

## 6. Recommended Actions

Priority order based on actual findings:

### P0 -- Security

1. **Remove or replace client queue page** (`apps/client/app/dashboard/queue/page.tsx` + `components/queue/useQueueManager.ts`). It calls admin-only endpoints that will fail for customer users. Either create user-scoped queue endpoints or remove the page entirely.

2. **Delete dead compliance hook** (`apps/client/hooks/api/useCompliance.ts`). Unused code that references admin endpoints.

3. **Add Permission checks to 13 admin endpoints** currently only protected by `requireAdminAuth`:
   - `dashboardRoutes.ts` (4 routes) -- add `DASHBOARD_VIEW`
   - `schedulingRoutes.ts` (3 routes) -- add `POST_MANAGE`
   - `samlRoutes.ts` (4 routes) -- add `SYSTEM_CONFIGURE`
   - `oidcRoutes.ts` (4 routes) -- add `SYSTEM_CONFIGURE`
   - `mfaRoutes.ts` (2 routes) -- add `USER_MANAGE`

### P1 -- Data integrity

4. **Fix Prisma Decimal crash** in `analytics/page.tsx:314` -- wrap `trialConversions` with `Number()`.

5. **Assign permissions to EDITOR role** or document that EDITOR is intentionally restricted to the 13 unguarded endpoints only.

6. **Clean up stale admin references** in client comments/metadata (queue page JSDoc, notification page title).

### P2 -- Quality

7. **Wire orphan hooks** (`useStartTrial`, `useEndTrial`, `useConvertTrial`) into the subscriptions page, replacing inline fetch calls. Or remove them if the inline approach is preferred.

8. **Add i18n** to `security/rbac/page.tsx` and `security/mfa/page.tsx`.

9. **Create hooks** for endpoints currently using inline fetch: `admin/billing/export`, `admin/accounts/bulk/suspend`, `admin/accounts/bulk/reactivate`.

10. **Build frontend** for 3 endpoints with zero coverage: `admin/billing/trials/expiring`, `admin/audit/export`, `admin/analytics/overview`.

11. **Normalize admin route prefixes** -- standardize on `/admin/*` instead of mixing `/admin/*` and `/api/admin/*`.
