# Reverse Engineering Audit — Admin Portal

**Date:** 2026-04-06
**Method:** Start from backend route files, map forward to frontend hooks, pages, and sidebar.

---

## Summary

| Status                                             | Count |
| -------------------------------------------------- | ----- |
| Total backend endpoints                            | 102   |
| Fully connected (endpoint → hook → page → sidebar) | ~30   |
| Partially connected (hook exists, not fully wired) | ~5    |
| Not connected (no frontend at all)                 | ~45   |
| Internal/system (no UI needed)                     | ~22   |

---

## Master Endpoint List (102 endpoints)

### Dashboard Routes (`apps/api/src/admin/dashboardRoutes.ts`)

| #   | Method | Endpoint                     | Auth             | Frontend Hook     | Page                   | Status                      |
| --- | ------ | ---------------------------- | ---------------- | ----------------- | ---------------------- | --------------------------- |
| 001 | GET    | /admin/dashboard/stats       | requireAdminAuth | useDashboardStats | page.tsx               | ✅ CONNECTED                |
| 002 | GET    | /admin/accounts/summary      | requireAdminAuth | useAccounts       | accounts/page.tsx      | ✅ CONNECTED                |
| 003 | GET    | /admin/subscriptions/summary | requireAdminAuth | useSubscriptions  | subscriptions/page.tsx | ⚠️ PARTIAL (stats mismatch) |
| 004 | GET    | /admin/analytics/overview    | requireAdminAuth | ❌ NONE           | ❌ NONE                | ❌ NOT CONNECTED            |

### Account Lifecycle Routes (`apps/api/src/admin/accountLifecycleRoutes.ts`)

| #   | Method | Endpoint                                   | Auth              | Frontend Hook                       | Page                | Status                                    |
| --- | ------ | ------------------------------------------ | ----------------- | ----------------------------------- | ------------------- | ----------------------------------------- |
| 005 | POST   | /admin/accounts                            | requireSuperAdmin | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED (admin account creation) |
| 006 | GET    | /admin/accounts                            | requireAdmin      | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED (filtered list)          |
| 007 | GET    | /admin/accounts/stats                      | requireAdmin      | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED                          |
| 008 | GET    | /admin/accounts/:accountId                 | requireAdmin      | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED (detail view)            |
| 009 | PUT    | /admin/accounts/:accountId                 | requireAdmin      | useUpdateAccount (ORPHAN)           | ❌ NONE             | ⚠️ PARTIAL (hook exists, unused)          |
| 010 | PUT    | /admin/accounts/:accountId/status          | requireAdmin      | Direct fetch in accounts/page.tsx   | accounts/page.tsx   | ✅ CONNECTED                              |
| 011 | GET    | /admin/accounts/:accountId/billing         | requireAdmin      | useAccountBilling                   | AccountBillingPanel | ✅ CONNECTED                              |
| 012 | POST   | /admin/accounts/:accountId/suspend         | requireAdmin      | Direct fetch in accounts/page.tsx   | accounts/page.tsx   | ✅ CONNECTED                              |
| 013 | POST   | /admin/accounts/:accountId/reactivate      | requireAdmin      | Direct fetch in accounts/page.tsx   | accounts/page.tsx   | ✅ CONNECTED                              |
| 014 | POST   | /admin/accounts/:accountId/reset-password  | requireAdmin      | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED                          |
| 015 | DELETE | /admin/accounts/:accountId                 | requireSuperAdmin | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED                          |
| 016 | GET    | /admin/accounts/:accountId/sessions        | requireAdmin      | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED                          |
| 017 | POST   | /admin/accounts/:accountId/revoke-sessions | requireAdmin      | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED                          |
| 018 | PATCH  | /admin/accounts/:accountId/grandfathering  | requireAdmin      | Direct fetch in AccountBillingPanel | AccountBillingPanel | ✅ CONNECTED                              |
| 019 | POST   | /admin/accounts/bulk/suspend               | requireSuperAdmin | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED (bulk action)            |
| 020 | POST   | /admin/accounts/bulk/reactivate            | requireSuperAdmin | ❌ NONE                             | ❌ NONE             | ❌ NOT CONNECTED (bulk action)            |

### Pricing Routes (`apps/api/src/admin/pricingRoutes.ts`)

| #   | Method | Endpoint                                 | Auth         | Frontend Hook         | Page             | Status       |
| --- | ------ | ---------------------------------------- | ------------ | --------------------- | ---------------- | ------------ |
| 021 | GET    | /admin/pricing/tiers                     | requireAdmin | usePricingTiers       | pricing/page.tsx | ✅ CONNECTED |
| 022 | PUT    | /admin/pricing/provider-tiers/:id        | requireAdmin | useUpdateProviderTier | ProviderTiersTab | ✅ CONNECTED |
| 023 | PUT    | /admin/pricing/account-tiers/:id         | requireAdmin | useUpdateAccountTier  | AccountTiersTab  | ✅ CONNECTED |
| 024 | PUT    | /admin/pricing/bundles/:id               | requireAdmin | useUpdateBundle       | pricing/page.tsx | ✅ CONNECTED |
| 025 | POST   | /admin/pricing/bundles                   | requireAdmin | useCreateBundle       | pricing/page.tsx | ✅ CONNECTED |
| 026 | DELETE | /admin/pricing/bundles/:id               | requireAdmin | useDeleteBundle       | pricing/page.tsx | ✅ CONNECTED |
| 027 | POST   | /admin/pricing/provider-tiers            | requireAdmin | useCreateProviderTier | ProviderTiersTab | ✅ CONNECTED |
| 028 | POST   | /admin/pricing/account-tiers             | requireAdmin | useCreateAccountTier  | AccountTiersTab  | ✅ CONNECTED |
| 029 | PATCH  | /admin/pricing/provider-tiers/:id/status | requireAdmin | useToggleTierStatus   | ProviderTiersTab | ✅ CONNECTED |
| 030 | PATCH  | /admin/pricing/account-tiers/:id/status  | requireAdmin | useToggleTierStatus   | AccountTiersTab  | ✅ CONNECTED |

### Admin User Routes (`apps/api/src/admin/adminUserRoutes.ts`)

| #   | Method | Endpoint                    | Auth              | Frontend Hook          | Page           | Status           |
| --- | ------ | --------------------------- | ----------------- | ---------------------- | -------------- | ---------------- |
| 031 | GET    | /admin/users                | requireAdmin      | useAdminUsers          | users/page.tsx | ✅ CONNECTED     |
| 032 | POST   | /admin/users                | requireSuperAdmin | useCreateAdminUser     | users/page.tsx | ✅ CONNECTED     |
| 033 | GET    | /admin/users/:id            | requireAdmin      | ❌ NONE (hook unused)  | ❌ NONE        | ❌ NOT CONNECTED |
| 034 | PUT    | /admin/users/:id            | requireAdmin      | ❌ NONE                | ❌ NONE        | ❌ NOT CONNECTED |
| 035 | POST   | /admin/users/:id/deactivate | requireSuperAdmin | useDeactivateAdminUser | users/page.tsx | ✅ CONNECTED     |
| 036 | POST   | /admin/users/:id/activate   | requireSuperAdmin | useActivateAdminUser   | users/page.tsx | ✅ CONNECTED     |

### Admin Auth Routes (`apps/api/src/admin/auth/adminAuthRoutes.ts`)

| #   | Method | Endpoint                           | Auth              | Frontend                    | Status           |
| --- | ------ | ---------------------------------- | ----------------- | --------------------------- | ---------------- |
| 037 | POST   | /admin/auth/login                  | rateLimit         | loginAction (server action) | ✅ CONNECTED     |
| 038 | POST   | /admin/auth/refresh                | Public            | Proxy interceptor           | ✅ CONNECTED     |
| 039 | POST   | /admin/auth/password/reset         | rateLimit         | ❌ NONE                     | ❌ NOT CONNECTED |
| 040 | POST   | /admin/auth/password/reset/confirm | Public            | ❌ NONE                     | ❌ NOT CONNECTED |
| 041 | POST   | /admin/auth/password/validate      | Public            | ❌ NONE                     | ❌ NOT CONNECTED |
| 042 | GET    | /admin/auth/me                     | requireAdminAuth  | verifyAccessToken           | ✅ CONNECTED     |
| 043 | POST   | /admin/auth/logout                 | requireAdminAuth  | logoutAction                | ✅ CONNECTED     |
| 044 | POST   | /admin/auth/password/change        | requireAdminAuth  | ❌ NONE                     | ❌ NOT CONNECTED |
| 045 | POST   | /admin/auth/mfa/setup              | requireAdminAuth  | MfaSelfService (direct)     | ✅ CONNECTED     |
| 046 | POST   | /admin/auth/mfa/verify             | requireAdminAuth  | MfaSelfService (direct)     | ✅ CONNECTED     |
| 047 | POST   | /admin/auth/mfa/disable            | requireAdminAuth  | MfaSelfService (direct)     | ✅ CONNECTED     |
| 048 | GET    | /admin/auth/mfa/status             | requireAdminAuth  | MfaSelfService (direct)     | ✅ CONNECTED     |
| 049 | GET    | /admin/auth/sessions               | requireAdminAuth  | ❌ NONE                     | ❌ NOT CONNECTED |
| 050 | POST   | /admin/auth/sessions/revoke        | requireAdminAuth  | ❌ NONE                     | ❌ NOT CONNECTED |
| 051 | POST   | /admin/auth/sessions/revoke-all    | requireSuperAdmin | ❌ NONE                     | ❌ NOT CONNECTED |

### Executive/Compliance Routes (`apps/api/src/admin/executiveRoutes.ts`)

| #   | Method | Endpoint                         | Auth             | Frontend Hook | Page                | Status           |
| --- | ------ | -------------------------------- | ---------------- | ------------- | ------------------- | ---------------- |
| 052 | GET    | /api/admin/executive/metrics     | requireAdminAuth | useExecutive  | executive/page.tsx  | ✅ CONNECTED     |
| 053 | GET    | /api/admin/compliance/metrics    | requireAdminAuth | useCompliance | compliance/page.tsx | ✅ CONNECTED     |
| 054 | GET    | /api/admin/compliance/audit-logs | requireAdminAuth | useCompliance | compliance/page.tsx | ✅ CONNECTED     |
| 055 | GET    | /api/admin/compliance/gdpr       | requireAdminAuth | ❌ NONE       | ❌ NONE             | ❌ NOT CONNECTED |
| 056 | PUT    | /admin/accounts/:id/settings     | requireAdmin     | ❌ NONE       | ❌ NONE             | ❌ NOT CONNECTED |

### Queue Management Routes

| #   | Method | Endpoint                     | Auth         | Frontend | Status           |
| --- | ------ | ---------------------------- | ------------ | -------- | ---------------- |
| 057 | GET    | /admin/queue/stats           | requireAdmin | ❌ NONE  | ❌ NOT CONNECTED |
| 058 | GET    | /admin/queue/jobs            | requireAdmin | ❌ NONE  | ❌ NOT CONNECTED |
| 059 | GET    | /admin/queue/jobs/:id        | requireAdmin | ❌ NONE  | ❌ NOT CONNECTED |
| 060 | POST   | /admin/queue/jobs/:id/retry  | requireAdmin | ❌ NONE  | ❌ NOT CONNECTED |
| 061 | POST   | /admin/queue/jobs/:id/remove | requireAdmin | ❌ NONE  | ❌ NOT CONNECTED |

### Scheduling Routes

| #   | Method | Endpoint                     | Auth             | Frontend | Status           |
| --- | ------ | ---------------------------- | ---------------- | -------- | ---------------- |
| 062 | GET    | /admin/posts/scheduled       | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 063 | POST   | /admin/posts/:id/cancel      | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 064 | POST   | /admin/posts/:id/reschedule  | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 065 | GET    | /api/scheduling/slots        | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 066 | GET    | /api/analytics/optimal-times | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 067 | GET    | /api/scheduling/rules        | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 068 | POST   | /api/scheduling/slots        | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |
| 069 | POST   | /api/scheduling/slots/bulk   | requireAdminAuth | ❌ NONE  | ❌ NOT CONNECTED |

### Audit Routes (`apps/api/src/audit/auditRoutes.ts`)

| #   | Method | Endpoint                              | Auth              | Frontend Hook | Page          | Status           |
| --- | ------ | ------------------------------------- | ----------------- | ------------- | ------------- | ---------------- |
| 070 | GET    | /admin/audit/logs                     | requireAdminAuth  | useAuditLogs  | logs/page.tsx | ✅ CONNECTED     |
| 071 | GET    | /admin/audit/stats                    | requireAdminAuth  | ❌ NONE       | ❌ NONE       | ❌ NOT CONNECTED |
| 072 | GET    | /admin/audit/users/:userId/logs       | requireAdminAuth  | ❌ NONE       | ❌ NONE       | ❌ NOT CONNECTED |
| 073 | GET    | /admin/audit/resources/:resource/logs | requireAdminAuth  | ❌ NONE       | ❌ NONE       | ❌ NOT CONNECTED |
| 074 | POST   | /admin/audit/logs                     | requireSuperAdmin | ❌ NONE       | ❌ NONE       | 🔧 INTERNAL      |
| 075 | POST   | /admin/audit/cleanup                  | requireSuperAdmin | ❌ NONE       | ❌ NONE       | 🔧 INTERNAL      |
| 076 | GET    | /admin/audit/my-logs                  | requireAdminAuth  | ❌ NONE       | ❌ NONE       | ❌ NOT CONNECTED |
| 077 | GET    | /admin/audit/export                   | requireSuperAdmin | ❌ NONE       | ❌ NONE       | ❌ NOT CONNECTED |

### Billing/Subscription Routes (`apps/api/src/billing/subscriptionRoutes.ts`)

| #   | Method | Endpoint                                           | Auth              | Frontend Hook             | Page                   | Status           |
| --- | ------ | -------------------------------------------------- | ----------------- | ------------------------- | ---------------------- | ---------------- |
| 078 | GET    | /admin/billing/plans                               | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 079 | GET    | /admin/billing/plans/:tier                         | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 080 | GET    | /admin/billing/accounts/:accountId/subscription    | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 081 | PUT    | /admin/billing/accounts/:accountId/subscription    | requireAdminAuth  | ChangePlanDialog (direct) | subscriptions/page.tsx | ✅ CONNECTED     |
| 082 | GET    | /admin/billing/subscriptions                       | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 083 | GET    | /admin/billing/stats                               | requireAdminAuth  | useBillingStats (ORPHAN)  | ❌ NONE                | ⚠️ PARTIAL       |
| 084 | POST   | /admin/billing/accounts/:accountId/validate-limits | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 085 | POST   | /admin/billing/accounts/:accountId/suspend         | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 086 | POST   | /admin/billing/bulk/upgrade                        | requireSuperAdmin | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 087 | GET    | /admin/billing/health                              | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | 🔧 INTERNAL      |
| 088 | GET    | /admin/billing/export                              | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 089 | POST   | /admin/billing/accounts/:accountId/trial/start     | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 090 | POST   | /admin/billing/accounts/:accountId/trial/end       | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 091 | POST   | /admin/billing/accounts/:accountId/trial/convert   | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 092 | GET    | /admin/billing/trials/expiring                     | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 093 | POST   | /admin/billing/auto-renewals/process               | requireSuperAdmin | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |
| 094 | GET    | /admin/billing/trials/stats                        | requireAdminAuth  | ❌ NONE                   | ❌ NONE                | ❌ NOT CONNECTED |

### RBAC Routes (`apps/api/src/auth/rbacRoutes.ts`)

| #   | Method | Endpoint                       | Auth              | Frontend             | Status            |
| --- | ------ | ------------------------------ | ----------------- | -------------------- | ----------------- | ------------ |
| 095 | GET    | /auth/permissions              | requireAdminAuth  | ❌ NONE              | ❌ NOT CONNECTED  |
| 096 | GET    | /admin/rbac/roles              | requireAdmin      | RbacManager (direct) | ✅ CONNECTED      |
| 097 | GET    | /admin/rbac/roles/:role        | requireAdmin      | ❌ NONE              | ❌ NOT CONNECTED  |
| 098 | GET    | /admin/rbac/roles/:role/users  | requireAdmin      | RbacManager (direct) | ✅ CONNECTED      |
| 099 | PUT    | /admin/rbac/users/:userId/role | requireSuperAdmin | RbacManager (direct) | ✅ CONNECTED      |
| 100 | POST   | /auth/permissions/check        | requireAdminAuth  | ❌ NONE              | 🔧 INTERNAL       |
| 101 | GET    | /admin/rbac/hierarchy          | requireAdmin      | useSecurityOverview  | security/page.tsx | ✅ CONNECTED |
| 102 | GET    | /admin/rbac/status             | requireAdmin      | useSecurityOverview  | security/page.tsx | ✅ CONNECTED |

### MFA Routes (`apps/api/src/auth/mfaRoutes.ts`)

Endpoints 045-048 covered above in Admin Auth.

Additional admin MFA endpoints:

| #   | Method | Endpoint                               | Auth         | Frontend            | Status       |
| --- | ------ | -------------------------------------- | ------------ | ------------------- | ------------ |
| —   | GET    | /admin/users/:userId/mfa/status        | requireAdmin | MfaManager (direct) | ✅ CONNECTED |
| —   | POST   | /admin/users/:userId/mfa/force-disable | requireAdmin | MfaManager (direct) | ✅ CONNECTED |

### Webhook Dashboard Routes (`apps/api/src/webhooks/webhookDashboardRoutes.ts`)

| #   | Method | Endpoint                                           | Auth         | Frontend                      | Status            |
| --- | ------ | -------------------------------------------------- | ------------ | ----------------------------- | ----------------- | ------------ |
| 095 | GET    | /api/webhooks/dashboard/metrics                    | requireAdmin | useWebhookMetrics             | webhooks/page.tsx | ✅ CONNECTED |
| 096 | GET    | /api/webhooks/dashboard/events                     | requireAdmin | WebhookEventsList (direct)    | webhooks/page.tsx | ✅ CONNECTED |
| 097 | GET    | /api/webhooks/dashboard/events/:eventId            | requireAdmin | WebhookEventsList (direct)    | webhooks/page.tsx | ✅ CONNECTED |
| 098 | GET    | /api/webhooks/dashboard/subscriptions              | requireAdmin | WebhookSubscriptions (direct) | webhooks/page.tsx | ✅ CONNECTED |
| 099 | GET    | /api/webhooks/dashboard/dead-letter                | requireAdmin | DeadLetterQueue (direct)      | webhooks/page.tsx | ✅ CONNECTED |
| 100 | POST   | /api/webhooks/dashboard/dead-letter/:eventId/retry | requireAdmin | DeadLetterQueue (direct)      | webhooks/page.tsx | ✅ CONNECTED |
| 101 | GET    | /api/webhooks/dashboard/stream                     | requireAdmin | WebhookTimeline (SSE)         | webhooks/page.tsx | ✅ CONNECTED |
| 102 | GET    | /api/webhooks/dashboard/export                     | requireAdmin | ❌ NONE                       | ❌ NOT CONNECTED  |

---

## Orphan Hooks (2)

| Hook               | File                            | Endpoint                 | Status                                  |
| ------------------ | ------------------------------- | ------------------------ | --------------------------------------- |
| `useUpdateAccount` | hooks/api/useAccounts.ts:44     | PUT /admin/accounts/:id  | Never imported by any page or component |
| `useBillingStats`  | hooks/api/useBillingStats.ts:22 | GET /admin/billing/stats | Never imported by any page or component |

---

## Endpoints NOT Connected — By Priority

### Must Connect (business-critical)

| Endpoint                                       | Purpose                             | Recommendation                               |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| POST /admin/billing/accounts/:id/trial/start   | Start trial for account             | Add button in accounts page or billing panel |
| POST /admin/billing/accounts/:id/trial/end     | End trial early                     | Wire to subscriptions page trial tab         |
| POST /admin/billing/accounts/:id/trial/convert | Convert trial to paid               | Wire to subscriptions page trial tab         |
| POST /admin/billing/auto-renewals/process      | Process auto-renewals               | Add button in subscriptions page             |
| PUT /admin/users/:id                           | Edit admin user (name, email, role) | Add edit dialog in users page                |
| POST /admin/auth/password/change               | Change own password                 | Add to security/MFA page or user profile     |

### Should Connect (useful admin oversight)

| Endpoint                                 | Purpose                 | Recommendation                      |
| ---------------------------------------- | ----------------------- | ----------------------------------- |
| GET /admin/accounts/:id                  | Account detail view     | Add detail panel or modal           |
| GET /admin/accounts/:id/sessions         | View active sessions    | Add to account detail               |
| POST /admin/accounts/:id/revoke-sessions | Revoke all sessions     | Add action button in account detail |
| POST /admin/accounts/:id/reset-password  | Reset customer password | Add action in accounts page         |
| GET /admin/audit/stats                   | Audit statistics        | Add stat cards to logs page         |
| GET /admin/audit/export                  | Export audit logs       | Add export button to logs page      |
| GET /admin/billing/export                | Export billing data     | Add export to subscriptions         |
| GET /api/admin/compliance/gdpr           | GDPR compliance data    | Wire to compliance page GDPR tab    |
| GET /admin/billing/trials/expiring       | Expiring trials list    | Add to subscriptions page           |

### Can Defer (nice to have)

| Endpoint                         | Purpose               | Reason to defer             |
| -------------------------------- | --------------------- | --------------------------- |
| GET /admin/queue/stats           | Queue monitoring      | System ops feature          |
| GET /admin/queue/jobs            | Job management        | System ops feature          |
| POST /admin/queue/jobs/:id/retry | Retry failed job      | System ops feature          |
| GET /admin/posts/scheduled       | Scheduled posts       | Customer feature, not admin |
| GET /api/scheduling/slots        | Scheduling slots      | Customer feature            |
| GET /api/analytics/optimal-times | Optimal posting times | Customer feature            |
| POST /admin/billing/bulk/upgrade | Bulk plan upgrade     | Low priority                |

### Don't Need in Admin (customer features or internal)

| Endpoint                           | Purpose              | Reason             |
| ---------------------------------- | -------------------- | ------------------ |
| POST /admin/audit/logs             | Manual audit entry   | System internal    |
| POST /admin/audit/cleanup          | Cleanup old logs     | System maintenance |
| GET /admin/billing/health          | Billing health check | System internal    |
| POST /auth/permissions/check       | Permission check     | Internal API       |
| POST /admin/auth/password/validate | Password strength    | Internal API       |

---

## Sprint Feature Verification

| Feature             | Backend Endpoint                             | Admin Hook                                        | Admin Page             | Status           |
| ------------------- | -------------------------------------------- | ------------------------------------------------- | ---------------------- | ---------------- |
| Grandfathering      | PATCH /admin/accounts/:id/grandfathering     | AccountBillingPanel direct                        | Billing panel          | ✅ Connected     |
| Bundle management   | POST/PUT/DELETE /admin/pricing/bundles       | useCreateBundle, useUpdateBundle, useDeleteBundle | pricing/page.tsx       | ✅ Connected     |
| Tier management     | POST/PUT/PATCH provider-tiers, account-tiers | All hooks wired                                   | Pricing tabs           | ✅ Connected     |
| Change plan         | PUT /admin/billing/accounts/:id/subscription | ChangePlanDialog direct                           | subscriptions/page.tsx | ✅ Connected     |
| Admin user CRUD     | GET/POST /admin/users, deactivate, activate  | All hooks wired                                   | users/page.tsx         | ✅ Connected     |
| MFA self-service    | POST /admin/auth/mfa/setup,verify,disable    | MfaSelfService direct                             | security/mfa/page.tsx  | ✅ Connected     |
| Referral program    | ❌ No admin endpoint                         | ❌                                                | ❌                     | NOT IN ADMIN     |
| Repurpose proposals | ❌ No admin endpoint                         | ❌                                                | ❌                     | NOT IN ADMIN     |
| Trend radar         | ❌ No admin endpoint                         | ❌                                                | ❌                     | NOT IN ADMIN     |
| Trial management    | POST trial/start, end, convert               | ❌ No frontend wiring                             | ❌                     | ❌ NOT CONNECTED |

---

## Data Shape Mismatches (Critical Bugs)

| Endpoint                                            | What API Returns                                                             | What Frontend Expects                                                        | Impact                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| GET /admin/subscriptions/summary `.stats`           | `{ activeSubscriptions, activeTrials, expiringTrials, expiredTrials }`       | `{ totalRevenue, monthlyRevenue, conversionRate, activeSubscriptions, ... }` | **CRASH** — `stats.totalRevenue.toLocaleString()` on undefined |
| GET /admin/subscriptions/summary `.subscriptions[]` | `{ id, email, name, billingCycle, autoRenewal, nextBillingDate, ... }`       | `{ ..., plan?: { name, pricePerMonth, ... } }`                               | Shows "No Plan" and $0/mo for all subscriptions                |
| GET /admin/subscriptions/summary `.trials[]`        | `{ id, email, name, trialStartDate, trialEndDate, trialDaysRemaining, ... }` | `{ ..., plan?: { name, ... } }`                                              | Shows "No Plan" for all trials                                 |

---

## Final Connectivity Score

| Category             | Connected | Partial | Not Connected | Internal | Total        |
| -------------------- | --------- | ------- | ------------- | -------- | ------------ |
| Dashboard            | 3         | 1       | 0             | 0        | 4            |
| Accounts             | 5         | 1       | 10            | 0        | 16           |
| Pricing              | 10        | 0       | 0             | 0        | 10           |
| Admin Users          | 4         | 0       | 2             | 0        | 6            |
| Auth                 | 6         | 0       | 6             | 3        | 15           |
| Executive/Compliance | 3         | 0       | 2             | 0        | 5            |
| Queue                | 0         | 0       | 5             | 0        | 5            |
| Scheduling           | 0         | 0       | 0             | 0        | 8 (customer) |
| Audit                | 1         | 0       | 5             | 2        | 8            |
| Billing              | 1         | 1       | 13            | 2        | 17           |
| Webhooks             | 7         | 0       | 1             | 0        | 8            |
| **Total**            | **~40**   | **~3**  | **~44**       | **~7**   | **102**      |

~8 endpoints are customer-feature routes registered on the admin port (scheduling/analytics).
