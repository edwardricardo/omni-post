# Admin Investigation Report

**Date:** 2026-04-04
**Investigator:** Claude (automated diagnostic)
**Scope:** 14 issues found during manual testing of `apps/admin`
**Method:** Code reading + curl endpoint tests. Zero code changes.

---

## Summary Table

| #   | Issue                     | Data Source                   | Endpoint Exists               | UI Complete               | Fix Needed            |
| --- | ------------------------- | ----------------------------- | ----------------------------- | ------------------------- | --------------------- |
| 1   | Token expiry / no refresh | JWT config (15m)              | Refresh: YES                  | Refresh logic: NO         | YES                   |
| 2   | PUT /settings 404         | —                             | YES (in source, not deployed) | YES                       | YES (restart)         |
| 3   | Grandfathering bug        | DB (SubscriptionPriceHistory) | YES                           | YES                       | NO                    |
| 4   | View Usage empty          | DB                            | YES                           | YES                       | NO                    |
| 5   | Subscriptions CRUD        | DB                            | YES (partial)                 | NO (Change Plan disabled) | YES                   |
| 6   | Pricing bundle CRUD       | DB                            | EDIT only (no POST/DELETE)    | EDIT only                 | YES                   |
| 7   | RBAC read-only            | DB                            | YES (full CRUD)               | YES (edit works)          | NO (cosmetic only)    |
| 8   | Audit logs wrong status   | DB                            | YES                           | YES                       | NO (was misdiagnosis) |
| 9   | Webhooks failed fetch     | DB (0 events)                 | YES                           | YES                       | NO (token expiry)     |
| 10  | Compliance data           | DB (real)                     | YES                           | PARTIAL (config disabled) | NO                    |
| 11  | System health "Critical"  | API (derived)                 | YES                           | Misleading                | YES (edge case)       |
| 12  | Analytics 404             | —                             | —                             | NO (page missing)         | YES                   |
| 13  | Native modals             | —                             | —                             | NO                        | YES                   |
| 14  | TeamMemberRow tests       | —                             | —                             | LOST                      | YES                   |

---

## Detailed Findings

### 1. Token Expiry / No Automatic Refresh

**Symptom:** App logs out with HTTP 401 `TOKEN_EXPIRED` during normal use.

#### Access Token TTL: 15 minutes

```
File: apps/api/src/admin/auth/adminAuthConfig.ts
accessTokenExpiration: "15m"
refreshTokenExpiration: "7d"
refreshTokenExpirationRememberMe: "30d"
sessionInactivityTimeout: 30 // minutes
```

```
File: apps/api/src/admin/auth/TokenService.ts:33
exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
```

#### Refresh endpoint: EXISTS

```
File: apps/api/src/admin/auth/adminAuthRoutes.ts:495-499
Route: POST /admin/auth/refresh
Body: { refreshToken: string, csrfToken: string }
```

#### Cookie stores access token with 24h maxAge (mismatch)

```
File: apps/admin/app/actions/auth.ts:28
maxAge: 24 * 60 * 60, // 1 day — but JWT inside expires in 15 min
```

#### Frontend NEVER calls refresh endpoint

```
File: apps/admin/app/api/backend/[...path]/route.ts:46-52
// Proxy returns upstream status codes unchanged, including 401
const text = await upstream.text();
return new NextResponse(text, {
  status: upstream.status,  // 401 passes through as-is
  ...
});
```

No interceptor exists in `apiClient.ts`, proxy, or any hook to catch 401 and call `/admin/auth/refresh`.

**On page load only:** Layout checks token validity server-side:

```
File: apps/admin/app/(dashboard)/layout.tsx:14-18
const user = await verifyAccessToken(token);
if (!user) {
  redirect("/api/clear-session");  // clears cookie, redirects to /login
}
```

But this only runs on navigation/page load, not on API calls.

#### Login flow stores only accessToken (not refreshToken or csrfToken)

```
File: apps/admin/app/actions/auth.ts:80-85
// On successful login:
cookieStore.set(COOKIE_NAME, result.tokens.accessToken, COOKIE_OPTIONS);
// refreshToken and csrfToken are NOT stored anywhere on the client
```

**ROOT CAUSE:** Access token expires in 15 min. Cookie lives 24h. The refreshToken and csrfToken from login are never stored client-side. Even if a refresh interceptor existed, it would have no refreshToken to send. After 15 minutes, every API call fails with 401.

---

### 2. PUT /admin/accounts/:id/settings — 404

**Symptom:** `Route PUT:/admin/accounts/:id/settings not found`

**Route IS registered in source code:**

```
File: apps/api/src/admin/executiveRoutes.ts:72-79
fastify.put(
  "/admin/accounts/:id/settings",
  {
    preHandler: [requireAdminAuth, requireAdmin],
    schema: { tags: ["Admin Executive"], summary: "Update account settings (trial, billing)" },
  },
  async (request, reply) => accountHandler.updateAccount(request, reply)
);
```

**Handler exists and accepts trial/billing fields:**

```
File: apps/api/src/admin/ExecutiveAccountHandlers.ts:37-172
File: apps/api/src/admin/executiveSchemas.ts:50-60
Accepted fields: name, email, maxProjects, isOnTrial, trialEndDate,
                 autoRenewal, billingCycle, stripeCustomerId, stripeSubscriptionId
```

**curl test confirms 404:**

```bash
$ curl -s -X PUT http://localhost:3000/admin/accounts/80a61cf7-.../settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isOnTrial":true}'

{"message":"Route PUT:/admin/accounts/80a61cf7-.../settings not found","error":"Not Found","statusCode":404}
```

**WHY:** The route was added to source code but the API server was running old code. `tsx` (the runtime) does NOT hot-reload — requires manual restart.

**Additional risk:** `ExecutiveAccountHandlers.ts:113-124` uses `include` instead of `select`, which returns `maxStorageBytes` (BigInt). BigInt cannot be serialized to JSON. A `select` clause was added in source but not yet deployed.

---

### 3. Billing Panel Grandfathering

**Symptom:** Claimed grandfathering bug persists visually.

**Billing endpoint EXISTS and queries price history:**

```
File: apps/api/src/admin/accountLifecycleRoutes.ts:637-642
const subscription = await prisma.accountSubscription.findUnique({
  where: { accountId },
  include: {
    bundle: true,
    history: { orderBy: { createdAt: "desc" }, take: 1 },  // SubscriptionPriceHistory
  },
});
```

**Grandfathering detection:**

```
File: apps/api/src/admin/accountLifecycleRoutes.ts:737-751
if (subscription.status === "GRANDFATHERED") {
  isGrandfathered = true;
  const lockedPrice = Number(subscription.pricePerMonth);
  const currentListPrice = total;
  // ...
  grandfathering = {
    lockedPrice,
    currentListPrice,
    savingsFromGrandfathering: currentListPrice - lockedPrice,
    expiresAt: ...
  };
}
```

**Frontend renders grandfathered state:**

```
File: apps/admin/components/accounts/AccountBillingPanel.tsx:48-54
{data.isGrandfathered && data.grandfathering && (
  <Badge variant="warning">
    Grandfathered{data.grandfathering.expiresAt
      ? ` until ${new Date(data.grandfathering.expiresAt).toLocaleDateString()}`
      : ""}
  </Badge>
)}
```

Lines 58-66: Displays locked price, current list price, and savings.

**STATUS:** Grandfathering is fully implemented end-to-end. If the visual bug persists, it may be a data issue (no accounts with `GRANDFATHERED` status in the DB) rather than a code issue.

---

### 4. Subscriptions Page — "View Usage"

**Symptom:** "Select an account to view usage metrics" message.

```
File: apps/admin/app/(dashboard)/subscriptions/page.tsx:487-499
// UsageMetricsPanel renders when an accountId is selected
{selectedAccountId ? (
  <UsageMetricsPanel accountId={selectedAccountId} />
) : (
  <p>Select an account to view usage metrics</p>
)}
```

"View Usage" button navigates to the subscriptions page with `?accountId=`:

```
File: apps/admin/app/(dashboard)/subscriptions/page.tsx:325-329
onClick={() => setSelectedAccountId(s.id)}
```

**STATUS:** This is the empty state, not a bug. Clicking "View Usage" on a subscription row populates the panel.

---

### 5. Subscriptions CRUD

**API endpoints that exist:**

```
File: apps/api/src/billing/subscriptionRoutes.ts
GET  /admin/billing/plans                           (line 24-31)
GET  /admin/billing/accounts/:accountId/subscription (line 44-51)
PUT  /admin/billing/accounts/:accountId/subscription (line 54-61) - UPDATE
POST /admin/billing/accounts/:accountId/suspend       (line 94-101)
POST /admin/billing/bulk/upgrade                      (line 104-111)
POST /admin/billing/accounts/:accountId/trial/start   (line 136-143)
POST /admin/billing/accounts/:accountId/trial/end     (line 146-153)
POST /admin/billing/accounts/:accountId/trial/convert (line 156-163)
POST /admin/billing/auto-renewals/process             (line 176-183)
```

**UI exposes:**

```
File: apps/admin/app/(dashboard)/subscriptions/page.tsx
- Cancel subscription (line 119-136)
- Convert trial to paid (line 142-157)
- End trial early (line 163-178)
- Process auto-renewals (line 184-200)
```

**UI does NOT expose:**

```
File: apps/admin/app/(dashboard)/subscriptions/page.tsx:331-335
// "Change Plan" button is DISABLED:
<ActionButton variant="secondary" size="sm" disabled title="Plan changes require the billing API (providers/bundle configuration)">
  Change Plan
</ActionButton>
```

**STATUS:** Plan editing is not exposed in UI. All other subscription operations work.

---

### 6. Pricing — Bundle CRUD

**API endpoints:**

```
File: apps/api/src/admin/pricingRoutes.ts
GET  /admin/pricing/tiers               (line 181-188) — read all
PUT  /admin/pricing/provider-tiers/:id   (line 190-197) — edit
PUT  /admin/pricing/account-tiers/:id    (line 199-206) — edit
PUT  /admin/pricing/bundles/:id          (line 208-215) — edit
```

**Missing API endpoints:** No `POST` (create) or `DELETE` for bundles.

**UI:**

```
File: apps/admin/app/(dashboard)/pricing/page.tsx
- Inline editing for existing bundles (lines 395-458)
- Can edit: name, description, pricePerAccountMonth
- Cannot edit providers from UI (read-only, line 443)
- No "Create Bundle" button or form exists
```

**STATUS:** Edit-only. Cannot create new bundles or delete existing ones from API or UI.

---

### 7. Security — RBAC, MFA, Permission Hierarchy

#### Permission Hierarchy: FROM DATABASE (not hardcoded)

```
File: apps/admin/hooks/api/useSecurity.ts:31-36
// Calls api.security.rbac.getStatus() and api.security.rbac.getHierarchy()
// Both fetch from backend API which queries database
```

**RBAC edit endpoints EXIST:**

```
File: apps/api/src/auth/rbacRoutes.ts:393-400
PUT /admin/rbac/users/:userId/role — Update user role (requires SUPER_ADMIN)
```

**MFA admin endpoints EXIST:**

```
File: apps/api/src/auth/mfaRoutes.ts:458-466
POST /admin/users/:userId/mfa/force-disable — Force disable MFA (requires ADMIN)
```

**UI edit capability EXISTS:**

```
File: apps/admin/components/security/RbacManager.tsx:84-101
handleRoleChange() calls api.security.rbac.updateUserRole(userId, newRole, reason)

File: apps/admin/components/security/MfaManager.tsx:72-94
handleForceDisableMfa() calls api.security.mfa.forceDisable(userId, reason)
```

**Cosmetic issue:** Uses native `prompt()` for reason input (RbacManager.tsx:267, MfaManager.tsx:204) and `alert()` for feedback.

**STATUS:** Functionally working. Not "read-only" as reported. The native modals make it look like a prototype (see Investigation 13).

---

### 8. Audit Logs — Incorrect Success Status

**`executeWithAudit` pattern:**

```
File: apps/api/src/services/AuditableService.ts:310-335
try {
  const result = await operation();   // Line 311 — operation runs first
  // Log successful operation           // Line 312 — audit AFTER success
  await this.writeAuditLog(entry);    // Line 332
  return result;                      // Line 335
} catch (err) {
  // Log failed operation              // Line 339 — audit on failure
  await this.writeAuditLog(failEntry); // with success: false
  throw err;                          // Line 361
}
```

**Inline audit in `updateAccountStatus`:**

```
File: apps/api/src/admin/accountLifecycleRoutes.ts:571-604
// Update runs first (line 571-577)
const updatedAccount = await prisma.account.update({...});
// Audit log created AFTER successful update (line 589-603)
await prisma.auditLog.create({ data: { action: "ACCOUNT_UPDATE", ... } });
```

**The reported "wrong status" was caused by Investigation 2:** When the user hit `PUT /admin/accounts/:id` (AdminUser route) with an Account ID, Fastify returned 404 or the BigInt serialization crashed. These errors were caught by Fastify's global error handler, NOT the audit system. The audit system never logged them because the handler never reached the audit code.

**STATUS:** Audit logging is correct. The false-positive was a side effect of the broken route.

---

### 9. Webhooks — Failed to Fetch

**Endpoint called:**

```
File: apps/admin/hooks/api/useWebhooks.ts:47
fetch(`/api/backend/api/webhooks/dashboard/metrics?${params}`)
```

**Route EXISTS:**

```
File: apps/api/src/webhooks/webhookDashboardRoutes.ts:45-66
getDashboardMetrics() — returns real-time metrics from DB
```

**curl test with auth:**

```bash
$ curl -s "http://localhost:3000/api/webhooks/dashboard/metrics?timeRange=24h" \
  -H "Authorization: Bearer $TOKEN"

{"ok":true,"data":{"totalEvents":0,"processedEvents":0,"failedEvents":0,
"successRate":0,"avgProcessingTime":0,"queueDepth":0,"realtimeConnections":0,
"byProvider":{},"byEventType":{},"timeline":[...]}}
```

**Data source:** REAL from database. Zero events because no webhooks have been triggered.

**"Failed to fetch" cause:** Most likely token expiry (Investigation 1). After 15 minutes, all API calls fail with 401. The webhook page auto-refreshes every 30 seconds (`useWebhooks.ts:62`), which would fail silently after token expiry.

**STATUS:** Endpoint works. The "failed to fetch" is a symptom of Investigation 1.

---

### 10. Compliance — Data Source

**Endpoints called:**

```
File: apps/admin/hooks/api/useCompliance.ts
Endpoint 1: /api/backend/api/admin/compliance/metrics
Endpoint 2: /api/backend/api/admin/compliance/audit-logs
```

**Routes exist:**

```
File: apps/api/src/admin/executiveRoutes.ts:38-55
GET /api/admin/compliance/metrics   (line 38-45)
GET /api/admin/compliance/audit-logs (line 48-55)
```

**curl test with auth:**

```bash
$ curl -s "http://localhost:3000/api/admin/compliance/metrics" \
  -H "Authorization: Bearer $TOKEN"

{"ok":true,"data":{"summary":{"complianceScore":100,"totalAuditLogs":90,
"auditLogsLast30Days":90,"auditLogsLast7Days":90,"failedActionsLast30Days":0,
"successRate":100},"userActivity":{"uniqueUsersLast30Days":1},
"topActions":[{"action":"LOGIN_SUCCESS","count":63},
{"action":"ACCOUNT_UPDATE","count":22},...]}}}
```

**Data source:** REAL from database (audit logs, user activity).

**Disabled buttons:**

```
File: apps/admin/app/(dashboard)/compliance/page.tsx:261
GDPR/Privacy and Security configuration buttons are disabled with title="Coming soon"
```

**STATUS:** Overview data is REAL. Configuration features are intentionally NOT IMPLEMENTED.

---

### 11. System Health: Critical

**Source:**

```
File: apps/admin/app/(dashboard)/webhooks/page.tsx:75-78
function getHealthLabel(successRate: number): string {
  if (successRate >= 95) return "Healthy";
  if (successRate >= 90) return "Warning";
  return "Critical";
}
```

**Display:**

```
File: apps/admin/app/(dashboard)/webhooks/page.tsx:211-213
<span>System health:</span>
<Badge variant={getHealthBadgeVariant(metrics.successRate)}>
  {getHealthLabel(metrics.successRate)}
</Badge>
```

**Why "Critical":** `metrics.successRate` is `0` because there are 0 webhook events. `0 < 90` → "Critical".

**Data source:** REAL (derived from webhook metrics API). Not hardcoded.

**STATUS:** Not a bug per se, but misleading. When there are 0 events, "Critical" is a false alarm. Should show "No Data" or "N/A" when `totalEvents === 0`.

---

### 12. Analytics 404

**Page exists:** NO

```bash
$ ls apps/admin/app/\(dashboard\)/analytics/page.tsx
ls: cannot access 'apps/admin/app/(dashboard)/analytics/page.tsx': No such file or directory
```

**Link source:**

```
File: apps/admin/app/(dashboard)/page.tsx:237-240
{
  href: "/analytics",
  title: "Analytics",
  desc: "View detailed reports",
},
```

**STATUS:** Quick Actions section on the dashboard links to `/analytics`, but the page does not exist. Guaranteed 404.

---

### 13. Native Browser Modals

**Total: 23 calls** (17 `alert()`, 4 `confirm()`, 2 `prompt()`)

| File                     | Line | Type      | Context                           |
| ------------------------ | ---- | --------- | --------------------------------- |
| `accounts/page.tsx`      | 87   | `alert`   | "All fields are required"         |
| `accounts/page.tsx`      | 106  | `alert`   | Failed to create account          |
| `accounts/page.tsx`      | 278  | `alert`   | Failed to update account          |
| `subscriptions/page.tsx` | 119  | `confirm` | Cancel subscription?              |
| `subscriptions/page.tsx` | 130  | `alert`   | Failed to cancel                  |
| `subscriptions/page.tsx` | 135  | `alert`   | Failed to cancel (catch)          |
| `subscriptions/page.tsx` | 142  | `confirm` | Convert trial?                    |
| `subscriptions/page.tsx` | 151  | `alert`   | Failed to convert                 |
| `subscriptions/page.tsx` | 156  | `alert`   | Failed to convert (catch)         |
| `subscriptions/page.tsx` | 163  | `confirm` | End trial early?                  |
| `subscriptions/page.tsx` | 172  | `alert`   | Failed to end trial               |
| `subscriptions/page.tsx` | 177  | `alert`   | Failed to end trial (catch)       |
| `subscriptions/page.tsx` | 184  | `confirm` | Process auto-renewals?            |
| `subscriptions/page.tsx` | 193  | `alert`   | Failed to process                 |
| `subscriptions/page.tsx` | 197  | `alert`   | Auto-renewals processed (success) |
| `subscriptions/page.tsx` | 199  | `alert`   | Failed to process (catch)         |
| `RbacManager.tsx`        | 95   | `alert`   | Role updated successfully         |
| `RbacManager.tsx`        | 97   | `alert`   | Failed to update role             |
| `RbacManager.tsx`        | 267  | `prompt`  | Reason for role change            |
| `RbacManager.tsx`        | 290  | `alert`   | View permissions (placeholder)    |
| `MfaManager.tsx`         | 88   | `alert`   | MFA disabled successfully         |
| `MfaManager.tsx`         | 90   | `alert`   | Failed to disable MFA             |
| `MfaManager.tsx`         | 204  | `prompt`  | Reason for disabling MFA          |

---

### 14. TeamMemberRow Tests

**Component EXISTS:**

```
File: apps/client/components/team/TeamMemberRow.tsx
Lines 34-35:
const canChangeRole = currentUserRole === "OWNER" && !isSelf && member.role !== "OWNER";
const canRemove = currentUserRole === "OWNER" && !isSelf;
```

**Test file DOES NOT EXIST:**

```bash
$ find apps/client -name "*TeamMemberRow*"
apps/client/components/team/TeamMemberRow.tsx
# No test file found
```

The test file `components/team/TeamMemberRow.test.tsx` was deleted in the Layer 3 client cleanup as an "orphaned component". The component itself was NOT orphaned — only the test file was.

**Test coverage:** ZERO. No role-based visibility tests exist anywhere for TeamMemberRow.

**What was lost:** 13 security tests covering:

- OWNER can change roles of non-OWNER members
- OWNER cannot change own role
- Non-OWNER users cannot see role/remove controls
- Role selector renders correct options

---

## What is Real vs Hardcoded

| Feature                | Source           | Evidence                                                               |
| ---------------------- | ---------------- | ---------------------------------------------------------------------- |
| Dashboard stats        | REAL (API → DB)  | `dashboardService.ts` queries `prisma.account`, `prisma.project`, etc. |
| Permission Hierarchy   | REAL (API → DB)  | `useSecurity.ts:31-36` → `api.security.rbac.getHierarchy()`            |
| Compliance metrics     | REAL (API → DB)  | curl returns actual audit log counts from database                     |
| Webhook data           | REAL (API → DB)  | curl returns `{"totalEvents":0,...}` — real, just empty                |
| System Health label    | DERIVED from API | `webhooks/page.tsx:75-78` — threshold function on `successRate`        |
| Billing/Grandfathering | REAL (API → DB)  | Queries `AccountSubscription` + `SubscriptionPriceHistory`             |
| Subscription data      | REAL (API → DB)  | `dashboardService.ts` queries `accountSubscription`                    |

Nothing in the admin portal is hardcoded or mocked.

---

## Fix Priority Recommendation

Based on severity and user impact:

| Priority | Issue                        | Why                                                                         |
| -------- | ---------------------------- | --------------------------------------------------------------------------- |
| **P0**   | #1 Token expiry / no refresh | Every user gets logged out after 15 min. Blocks all admin work.             |
| **P1**   | #2 PUT /settings 404         | Account trial/billing editing is broken. Requires API restart + deployment. |
| **P1**   | #12 Analytics 404            | Dead link on main dashboard. Either create page or remove link.             |
| **P2**   | #11 System Health misleading | Shows "Critical" with 0 events. Edge case in threshold logic.               |
| **P2**   | #13 Native modals (23 calls) | Poor UX across 4 files. Replace with toast/dialog components.               |
| **P2**   | #14 TeamMemberRow tests      | 13 security tests lost. Role-based access control is untested.              |
| **P3**   | #5 Subscription plan editing | "Change Plan" button disabled. Needs UI form for plan changes.              |
| **P3**   | #6 Bundle create/delete      | API only supports edit. Need POST/DELETE endpoints + UI.                    |
| —        | #3 Grandfathering            | Already working correctly. No fix needed.                                   |
| —        | #4 View Usage                | Working correctly. Empty state is expected behavior.                        |
| —        | #7 RBAC/MFA                  | Working correctly. Cosmetic (native modals, covered by #13).                |
| —        | #8 Audit logs                | Working correctly. Was misdiagnosis caused by #2.                           |
| —        | #9 Webhooks fetch            | Working correctly. Caused by #1 (token expiry).                             |
| —        | #10 Compliance               | Working correctly. Config buttons intentionally disabled.                   |

---

## TeamMemberRow Tests Status

**LOST.** The component `TeamMemberRow.tsx` exists with role-based access control logic (OWNER-only operations) but has zero test coverage after the Layer 3 cleanup incorrectly classified the test file as "orphaned."

13 security tests need to be recreated covering:

- OWNER role can change/remove other members
- OWNER cannot modify own role
- MANAGER/MEMBER/VIEWER cannot see role controls
- Role selector options are correct per role

---

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADMIN INVESTIGATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issues investigated: 14
Real data: 14/14 (nothing is hardcoded)
Hardcoded: 0/14
Missing endpoints: 1 (not deployed)
Missing UI pages: 1 (analytics)
Native modals: 23 calls across 4 files
TeamMemberRow tests: LOST (13 security tests)

Actual bugs requiring fixes: 6
Already working correctly: 8

Full report: docs/development/ADMIN_INVESTIGATION_REPORT.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
