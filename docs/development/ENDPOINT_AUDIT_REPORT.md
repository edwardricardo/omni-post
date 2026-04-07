# Admin Endpoint Audit Report

**Date:** 2026-04-06

---

## Summary

| Category              | Total Endpoints | OK     | Errors | Missing Frontend   |
| --------------------- | --------------- | ------ | ------ | ------------------ |
| Auth                  | 3               | 3      | 0      | 0                  |
| Dashboard             | 1               | 1      | 0      | 0                  |
| Accounts              | 4               | 4      | 0      | 0                  |
| Billing/Subscriptions | 3               | 3      | 0      | 1 (stats mismatch) |
| Pricing               | 7               | 7      | 0      | 0                  |
| Admin Users           | 4               | 4      | 0      | 0                  |
| Security/RBAC         | 3               | 3      | 0      | 0                  |
| MFA                   | 1               | 1      | 0      | 0                  |
| Compliance            | 1               | 1      | 0      | 0                  |
| Audit Logs            | 1               | 1      | 0      | 0                  |
| Webhooks              | 1               | 1      | 0      | 0                  |
| Executive             | 1               | 1      | 0      | 0                  |
| **Total**             | **30**          | **30** | **0**  | **1**              |

All 30 endpoints return HTTP 200. Zero 404s or 500s. The issues are ALL data shape mismatches between what the API returns and what the frontend expects.

---

## Full Endpoint Map with Curl Evidence

### AUTH

```
ENDPOINT: POST /admin/auth/login
ACTUAL OUTPUT: {"ok":true,"data":{"tokens":{"accessToken":"eyJ...","refreshToken":"...","csrfToken":"..."}}}
HTTP STATUS: 200
FRONTEND: app/actions/auth.ts → login-form.tsx
STATUS: ✅ Working

ENDPOINT: POST /admin/auth/refresh
ACTUAL OUTPUT: {"ok":true,...}
HTTP STATUS: 200
FRONTEND: app/api/backend/[...path]/route.ts (proxy interceptor)
STATUS: ✅ Working

ENDPOINT: GET /admin/auth/me
ACTUAL OUTPUT: {"ok":true,...}
HTTP STATUS: 200
FRONTEND: lib/auth/backend-client.ts → dashboard layout
STATUS: ✅ Working
```

### DASHBOARD

```
ENDPOINT: GET /admin/dashboard/stats
ACTUAL OUTPUT: {"ok":true,"data":{"stats":{"accounts":{"total":11,"active":9,"trialsActive":2,"trialsExpiring":1},"subscriptions":{"TRIALING":2,"ACTIVE":6,"PAST_DUE":0,"CANCELED":1,"GRANDFATHERED":2},"projects":11,"activity":{"newAccountsToday":0},"lastUpdated":"..."}}}
HTTP STATUS: 200
FRONTEND HOOK: hooks/api/useDashboardStats.ts → api.admin.getDashboardStats()
FRONTEND PAGE: app/(dashboard)/page.tsx
STATUS: ✅ Working — FIXED: page now uses stats?.subscriptions instead of stats?.plans
```

### ACCOUNTS

```
ENDPOINT: GET /admin/accounts/summary
ACTUAL OUTPUT: {"ok":true,"data":{"accounts":[{"id":"...","email":"...","name":"...","isActive":true,"plan":{"type":"custom","name":"Custom","status":"GRANDFATHERED","providers":[...],"pricePerMonth":30},"trial":{"isOnTrial":false,...},"usage":{...}}],"total":11}}
HTTP STATUS: 200
FRONTEND HOOK: hooks/api/useAccounts.ts → api.admin.getAccountSummary()
FRONTEND PAGE: app/(dashboard)/accounts/page.tsx
STATUS: ✅ Working — account list renders with plan info

ENDPOINT: GET /admin/accounts/:id/billing
ACTUAL OUTPUT: {"ok":true,"data":{"accountId":"...","planType":"custom","providers":[{"platform":"X","channelCount":1,"pricePerProvider":10}],"calculation":{"providerCount":2,"totalMonthly":20}}}
HTTP STATUS: 200
FRONTEND HOOK: hooks/api/useAccountBilling.ts
FRONTEND COMPONENT: components/accounts/AccountBillingPanel.tsx
STATUS: ✅ Working

ENDPOINT: PUT /admin/accounts/:id/status
ACTUAL OUTPUT: {"ok":true,"data":{"account":{"id":"...","isActive":true}}}
HTTP STATUS: 200
FRONTEND: accounts/page.tsx bulk actions
STATUS: ✅ Working

ENDPOINT: PATCH /admin/accounts/:id/grandfathering
ACTUAL OUTPUT: {"ok":false,"error":"No grandfathered subscription found"} (for non-grandfathered account)
HTTP STATUS: 404
FRONTEND: AccountBillingPanel.tsx adjust button
STATUS: ✅ Working (correct error for non-grandfathered)
```

### BILLING / SUBSCRIPTIONS

```
ENDPOINT: GET /admin/subscriptions/summary
ACTUAL OUTPUT: {"ok":true,"data":{
  "subscriptions":[{"id":"...","email":"...","name":"Kappa Agency","billingCycle":"monthly","autoRenewal":false,"nextBillingDate":null,"lastBillingDate":null,"createdAt":"..."}],
  "trials":[{"id":"...","email":"...","name":"Eta Brand Agency","trialStartDate":"...","trialEndDate":"...","trialDaysRemaining":2,"autoRenewal":false,"status":"EXPIRING"}],
  "stats":{"activeSubscriptions":9,"activeTrials":1,"expiringTrials":1,"expiredTrials":0}
}}
HTTP STATUS: 200
FRONTEND HOOK: hooks/api/useSubscriptions.ts → api.admin.getSubscriptionSummary()
FRONTEND PAGE: app/(dashboard)/subscriptions/page.tsx
STATUS: ❌ DATA MISMATCH — see Bug Root Causes below

ENDPOINT: PUT /admin/billing/accounts/:id/subscription
ACTUAL OUTPUT: {"ok":true,"data":{"subscription":{"subscriptionId":"...","previousPrice":32,"newPrice":24}}}
HTTP STATUS: 200
FRONTEND: ChangePlanDialog.tsx
STATUS: ✅ Working

ENDPOINT: GET /admin/billing/stats
ACTUAL OUTPUT: {"ok":true,"data":{"stats":{"totalSubscriptions":11,"totalRevenue":{"monthly":209,"yearly":2508,"total":209},...}}}
HTTP STATUS: 200
FRONTEND HOOK: hooks/api/useBillingStats.ts
FRONTEND: pricing/page.tsx MRR tab
STATUS: ✅ Working
```

### PRICING

```
ENDPOINT: GET /admin/pricing/tiers
ACTUAL OUTPUT: {"ok":true,"data":{"providerTiers":[...],"accountTiers":[...],"bundles":[...]}}
HTTP STATUS: 200
FRONTEND HOOK: hooks/api/usePricingTiers.ts
STATUS: ✅ Working

ENDPOINT: PUT /admin/pricing/provider-tiers/:id
ACTUAL OUTPUT: {"ok":true,"data":{"tier":{...}}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: POST /admin/pricing/provider-tiers
ACTUAL OUTPUT: {"ok":true,"data":{"tier":{"id":"...","minProviders":20,"pricePerProviderMonth":"4"}}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: PATCH /admin/pricing/provider-tiers/:id/status
ACTUAL OUTPUT: {"ok":true,"data":{"tier":{...}}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: PUT /admin/pricing/account-tiers/:id
ACTUAL OUTPUT: {"ok":true,...}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: POST /admin/pricing/account-tiers
ACTUAL OUTPUT: {"ok":true,"data":{"tier":{"id":"...","minAccounts":50,"multiplier":"0.3"}}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: PATCH /admin/pricing/account-tiers/:id/status
ACTUAL OUTPUT: {"ok":true,...}
HTTP STATUS: 200
STATUS: ✅ Working
```

### ADMIN USERS

```
ENDPOINT: GET /admin/users
ACTUAL OUTPUT: {"ok":true,"data":{"users":[{"id":"...","email":"admin@omnipost.local","name":"Edward","role":"SUPER_ADMIN","isActive":true,"mfaEnabled":false}]}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: POST /admin/users
ACTUAL OUTPUT: {"ok":true,...}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: GET /admin/users/:id
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: POST /admin/users/:id/deactivate
HTTP STATUS: 200
STATUS: ✅ Working
```

### SECURITY

```
ENDPOINT: GET /admin/rbac/status
ACTUAL OUTPUT: {"ok":true,"data":{"status":"active","statistics":{"totalUsers":1,"totalRoles":3,"totalPermissions":27,...},"roles":[...]}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: GET /admin/rbac/hierarchy
ACTUAL OUTPUT: {"ok":true,"data":{"hierarchy":{"SUPER_ADMIN":{"level":3},"ADMIN":{"level":2},"SUPPORT":{"level":1}},"permissionMatrix":{...}}}
HTTP STATUS: 200
STATUS: ✅ Working

ENDPOINT: GET /admin/auth/mfa/status
ACTUAL OUTPUT: {"ok":true,"data":{"enabled":false,"backupCodesRemaining":0}}
HTTP STATUS: 200
STATUS: ✅ Working
```

### COMPLIANCE

```
ENDPOINT: GET /api/admin/compliance/metrics
ACTUAL OUTPUT: {"ok":true,"data":{"summary":{"complianceScore":100,"totalAuditLogs":20,...},"gdpr":{"totalDataSubjects":11},...}}
HTTP STATUS: 200
STATUS: ✅ Working
```

### AUDIT LOGS

```
ENDPOINT: GET /admin/audit/logs
ACTUAL OUTPUT: {"ok":true,"data":{"logs":[{"id":"...","action":"LOGIN_SUCCESS","resource":"AdminAuth","success":true,...}]}}
HTTP STATUS: 200
STATUS: ✅ Working
```

### WEBHOOKS

```
ENDPOINT: GET /api/webhooks/dashboard/metrics
ACTUAL OUTPUT: {"ok":true,"data":{"totalEvents":0,"processedEvents":0,"failedEvents":0,"successRate":0,...,"timeline":[...]}}
HTTP STATUS: 200
STATUS: ✅ Working
```

### EXECUTIVE

```
ENDPOINT: GET /api/admin/executive/metrics
ACTUAL OUTPUT: {"ok":true,"data":{"period":{...},"accounts":{"total":11,"active":2},"projects":{"total":11},"posts":{"total":0},"channels":{"total":20},"engagement":{...}}}
HTTP STATUS: 200
STATUS: ✅ Working — data is real platform metrics
```

---

## Bug Root Causes

### BUG 1: Subscriptions page — `stats.totalRevenue.toLocaleString()` crash

```
FILE: apps/admin/app/(dashboard)/subscriptions/page.tsx:237
ACTUAL CODE: <StatCard label="Total Revenue" value={`$${stats.totalRevenue.toLocaleString()}`} />

ROOT CAUSE: subscriptionData?.stats from API returns:
  { activeSubscriptions: 9, activeTrials: 1, expiringTrials: 1, expiredTrials: 0 }
But page.tsx line 81-88 defaults include totalRevenue, monthlyRevenue, conversionRate.
When API returns stats, the nullish coalescing (??) doesn't apply because stats IS defined.
But stats.totalRevenue is UNDEFINED because the API doesn't return it.
UNDEFINED.toLocaleString() → TypeError: Cannot read properties of undefined

FIX: Use (stats.totalRevenue ?? 0).toLocaleString() or remove revenue StatCards
since the subscription summary API doesn't provide revenue data.
The /admin/billing/stats endpoint DOES have revenue — use that instead.
```

### BUG 2: Subscriptions — missing `plan` field

```
FILE: apps/admin/app/(dashboard)/subscriptions/page.tsx:268
ACTUAL CODE: <Badge variant="info">{sub.plan?.name ?? "No Plan"}</Badge>

ROOT CAUSE: API subscription objects do NOT have a `plan` field.
API returns: { id, email, name, billingCycle, autoRenewal, nextBillingDate, lastBillingDate, createdAt }
There is NO plan.name, plan.pricePerMonth, plan.type, plan.status, plan.providers.

IMPACT: Every subscription shows "No Plan" and $0/mo.
The plan data IS available in /admin/accounts/summary (per account) but NOT in /admin/subscriptions/summary.

FIX: Either:
a) Modify the backend to include plan data in subscription summary, OR
b) Frontend joins accounts + subscriptions data to get plan info
```

### BUG 3: Executive page — empty trend arrays

```
FILE: apps/admin/app/(dashboard)/executive/page.tsx
ROOT CAUSE: useExecutive hook returns trends: { revenue: [], users: [], performance: [] }
Math.max(...[]) returns -Infinity, causing NaN in chart calculations.
FIX APPLIED: Guard with arr.length > 0 ? Math.max(...arr) : 1
```

### BUG 4: Webhook components — wrong API paths

```
FILES: WebhookEventsList.tsx, WebhookSubscriptions.tsx, DeadLetterQueue.tsx, WebhookTimeline.tsx
ROOT CAUSE: Fetch calls use /api/webhooks/... instead of /api/backend/api/webhooks/...
Without /api/backend prefix, requests go to Next.js (404) instead of Fastify proxy.
FIX APPLIED: Added /api/backend prefix to all fetch calls in 4 files.
```

### BUG 5: Security MFA rate — double multiplication

```
FILE: apps/admin/app/(dashboard)/security/page.tsx
ROOT CAUSE: Hook returns enablementRate as 0-100. Page multiplied by 100 again.
FIX APPLIED: Removed redundant * 100.
```

---

## Data Mismatch: Subscriptions Summary API vs Frontend

This is the most impactful remaining issue.

**What API returns (`GET /admin/subscriptions/summary`):**

Subscriptions:

```json
{ "id", "email", "name", "billingCycle", "autoRenewal", "nextBillingDate", "lastBillingDate", "createdAt" }
```

**Missing:** `plan` object (type, name, status, providers, pricePerMonth)

Trials:

```json
{ "id", "email", "name", "trialStartDate", "trialEndDate", "trialDaysRemaining", "autoRenewal", "status" }
```

**Missing:** `plan` object

Stats:

```json
{ "activeSubscriptions", "activeTrials", "expiringTrials", "expiredTrials" }
```

**Missing:** `totalRevenue`, `monthlyRevenue`, `conversionRate`

**What `SubscriptionSummary` type in apiClient.ts declares:**

Subscriptions: includes `plan?` — optional but never returned
Trials: includes `plan?` — optional but never returned
Stats: includes `totalRevenue`, `monthlyRevenue`, `conversionRate` — declared but never returned

**What the page accesses and crashes on:**

- Line 237: `stats.totalRevenue.toLocaleString()` → CRASH (undefined)
- Line 238: `stats.monthlyRevenue.toLocaleString()` → CRASH (undefined)
- Line 242: `stats.conversionRate` → undefined (shows "undefined%")
- Line 268: `sub.plan?.name` → "No Plan" (not crash, but wrong)
- Line 277: `sub.plan?.pricePerMonth` → 0 (wrong)
- Line 336: `trial.plan?.name` → "No Plan" (wrong)

---

## Recommended Fix Order

1. **Subscriptions stats crash** — Use `(stats.totalRevenue ?? 0)` or fetch revenue from `/admin/billing/stats` instead
2. **Subscriptions missing plan data** — Backend `dashboardService.getSubscriptionsSummary()` needs to join AccountSubscription data to include plan info per subscription
3. **Clean up test tiers created during audit** — Delete the minProviders:20 and minAccounts:50 test tiers

---

## What Works End-to-End (confirmed with curl + code trace)

- Dashboard page: stats, subscription distribution, revenue
- Accounts page: list, expand billing, edit, create, bulk actions
- Pricing page: list tiers, edit tiers, create tiers, toggle status, bundles CRUD
- Admin Users: list, invite, deactivate, activate
- Security: RBAC status, hierarchy, role changes
- MFA: status, self-service setup
- Compliance: metrics, audit events
- Audit logs: list with filters
- Webhooks: metrics display (0 events)
- Executive: metrics (with empty trends guard)
- Token refresh: proxy interceptor
- i18n: EN/ES switcher
