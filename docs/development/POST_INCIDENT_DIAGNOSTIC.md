# Post-Incident Diagnostic Report

**Date:** 2026-04-06

---

## Summary

| Area               | Status       | Detail                                                    |
| ------------------ | ------------ | --------------------------------------------------------- |
| Build              | OK           | 0 TS errors, FULL TURBO cache                             |
| DB                 | OK           | 11 accounts, 98 tables                                    |
| SidebarNav         | CONTAMINATED | Calls `/api/backend/inbox/unread-count` (client endpoint) |
| Dashboard layout   | CONTAMINATED | Wraps children with `ProjectProvider` (client provider)   |
| Dashboard page     | CLEAN        | Uses admin-specific useDashboardStats                     |
| Executive page     | CONTAMINATED | Displays posts/channels/projects (client metrics)         |
| Accounts page      | CLEAN        | Admin-correct AccountSummary type                         |
| Subscriptions page | CLEAN        | Admin-correct data model                                  |
| Pricing page       | CLEAN        | Admin pricing tiers and bundles                           |
| Security page      | CLEAN        | RBAC + MFA admin endpoints                                |
| Compliance page    | CLEAN        | Audit logs + compliance metrics                           |
| Webhook components | CONTAMINATED | All 5 use @packages/ui instead of admin design system     |
| UsageMetricsPanel  | CONTAMINATED | Shows client usage (posts, AI calls, storage)             |
| useExecutive hook  | CONTAMINATED | References projects, posts, channels                      |
| AdminUser CRUD     | OK           | Page + 6 API endpoints intact                             |
| Token refresh      | OK           | Proxy interceptor + refresh route intact                  |
| Pricing CRUD       | OK           | POST/PATCH endpoints intact                               |
| Help page          | OK           | 9 sections, exists                                        |
| i18n               | OK           | next-intl 4.9.0, 528 keys EN+ES                           |

---

## Contamination Found

### CRITICAL — 3 issues that break functionality

#### 1. ProjectProvider in dashboard layout

- **File:** `apps/admin/app/(dashboard)/layout.tsx`
- **Line 12:** `import { ProjectProvider } from "@/providers/ProjectProvider";`
- **Line 37:** `<ProjectProvider>{children}</ProjectProvider>`
- **Impact:** ProjectProvider is a client-app provider for managing project selection context. Admin has no projects to select. This is the likely cause of "No projects found" error.
- **Fix:** Remove ProjectProvider wrapper entirely.

#### 2. SidebarNav calls client inbox endpoint

- **File:** `apps/admin/components/shared/SidebarNav.tsx`
- **Line 217:** `fetch("/api/backend/inbox/unread-count", { cache: "no-store" })`
- **Lines 237-238:** useQuery with `queryKey: ["inbox", "unread-count"]`
- **Line 319:** Attempts to add badge to "inbox" nav item
- **Impact:** Makes a request to a client endpoint that doesn't exist in admin API. Fails silently but pollutes query cache.
- **Fix:** Remove all inbox/unread-count logic (lines 215-245, 319).

#### 3. useExecutive hook references client data models

- **File:** `apps/admin/hooks/api/useExecutive.ts`
- **Line 45:** `projects: { total: number }`
- **Lines 46-51:** `posts: { total, published, scheduled, draft, successRate }`
- **Line 53:** `channels: { total: number; byProvider: Record<string, number> }`
- **Line 155:** `projects: m.projects.total`
- **Impact:** Admin has no concept of "posts" or "channels" — these are client publishing features. The executive dashboard displays meaningless data.
- **Fix:** Remove projects/posts/channels from the hook's type definition and data mapping. Executive should show: accounts, subscriptions, revenue, churn, MRR.

### HIGH — 6 files with wrong design system

#### 4-8. Webhook components use @packages/ui instead of admin design system

All 5 files import from `@packages/ui` (Card, Button, Badge, Table, etc.):

- `apps/admin/components/webhooks/DeadLetterQueue.tsx`
- `apps/admin/components/webhooks/WebhookEventsList.tsx`
- `apps/admin/components/webhooks/WebhookSubscriptions.tsx`
- `apps/admin/components/webhooks/WebhookMetrics.tsx`
- `apps/admin/components/webhooks/WebhookTimeline.tsx`
- **Impact:** Inconsistent theming — @packages/ui components use shadcn tokens (`bg-background`) while admin uses CSS vars (`var(--bg-surface)`).
- **Fix:** Replace @packages/ui Card/Button/Badge/Table with admin components (ActionButton, Badge, DataTable).

#### 9. UsageMetricsPanel shows client usage

- **File:** `apps/admin/components/settings/UsageMetricsPanel.tsx`
- **Lines 103-111:** Displays "Posts Published", "AI Calls", "Storage", "Team Members"
- **Impact:** These are client product features, not admin metrics.
- **Fix:** Redesign to show admin-relevant usage (accounts used, API calls, storage, etc.) or remove from admin.

---

## Admin Features Intact (not contaminated)

| Feature                       | File                                     | Status                                                            |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| Root layout                   | `app/layout.tsx`                         | ThemeProvider + NextIntlClientProvider + GeistSans + AdminToaster |
| Dashboard home                | `app/(dashboard)/page.tsx`               | Admin stats (accounts, plans, revenue)                            |
| Accounts page                 | `app/(dashboard)/accounts/page.tsx`      | AccountSummary, billing panel                                     |
| Subscriptions page            | `app/(dashboard)/subscriptions/page.tsx` | Subscription management                                           |
| Pricing page                  | `app/(dashboard)/pricing/page.tsx`       | Tier + bundle management                                          |
| Security page                 | `app/(dashboard)/security/page.tsx`      | RBAC + MFA overview                                               |
| Compliance page               | `app/(dashboard)/compliance/page.tsx`    | Audit + GDPR                                                      |
| Help page                     | `app/(dashboard)/help/page.tsx`          | 9 accordion sections                                              |
| Users page                    | `app/(dashboard)/users/page.tsx`         | AdminUser CRUD                                                    |
| Login form                    | `components/auth/login-form.tsx`         | CSS vars, MFA support                                             |
| RbacManager                   | `components/security/RbacManager.tsx`    | Admin API calls                                                   |
| MfaManager                    | `components/security/MfaManager.tsx`     | Admin API calls                                                   |
| LoadingSpinner                | `components/shared/LoadingSpinner.tsx`   | CSS vars                                                          |
| Error page                    | `app/error.tsx`                          | CSS vars + ActionButton                                           |
| Not Found page                | `app/not-found.tsx`                      | CSS vars                                                          |
| Token refresh                 | `app/api/backend/[...path]/route.ts`     | Proxy interceptor                                                 |
| Clear session                 | `app/api/clear-session/route.ts`         | Cookie cleanup                                                    |
| Auth refresh                  | `app/api/auth/refresh/route.ts`          | Server-side refresh                                               |
| All hooks except useExecutive | `hooks/api/*.ts`                         | Admin-specific endpoints                                          |
| i18n config                   | `i18n/request.ts` + messages             | next-intl 4.9.0, 528 keys                                         |
| All UI components             | `components/ui/*.tsx`                    | Design system intact                                              |

---

## API Verification

All admin API endpoints verified working:

| Endpoint                                         | Status | Verified                   |
| ------------------------------------------------ | ------ | -------------------------- |
| `POST /admin/auth/login`                         | OK     | Returns tokens             |
| `GET /admin/dashboard/stats`                     | OK     | Returns account/plan stats |
| `GET /admin/accounts/summary`                    | OK     | Returns 11 accounts        |
| `GET /admin/users`                               | OK     | Returns AdminUser list     |
| `GET /admin/pricing/tiers`                       | OK     | Returns tiers + bundles    |
| `POST /admin/pricing/provider-tiers`             | OK     | Creates tier               |
| `PATCH /admin/pricing/provider-tiers/:id/status` | OK     | Toggles active             |
| `PUT /admin/billing/accounts/:id/subscription`   | OK     | Changes plan               |
| `PATCH /admin/accounts/:id/grandfathering`       | OK     | Adjusts expiry             |

---

## Recommended Fix Order

1. **Remove ProjectProvider from dashboard layout** — Fixes "No projects found", restores admin data isolation
2. **Remove inbox/unread logic from SidebarNav** — Stops calling nonexistent endpoint
3. **Fix useExecutive hook** — Remove posts/channels/projects references, use admin-only metrics
4. **Replace @packages/ui in webhook components** — Consistent admin design system (or accept as-is if theming works)
5. **Redesign UsageMetricsPanel** — Show admin-relevant metrics instead of client features

---

## Extent of Recovery

### Successfully restored:

- Root layout with full provider chain
- All dashboard pages with PageHeader, ActionButton, Badge, CSS vars
- Security components with admin design system
- Error/NotFound pages with CSS vars
- Login form with CSS vars
- LoadingSpinner with CSS vars
- i18n integration with useTranslations

### Recovery introduced incorrectly:

- **ProjectProvider** was re-added to dashboard layout (not in the original pre-session code, but the recovery agent added it)
- **SidebarNav** got inbox/unread-count logic (not in original, agent added client-app code)
- **useExecutive** kept client data model references (posts, channels, projects)
- **Webhook components** stayed with @packages/ui components instead of being migrated to admin design system
- **UsageMetricsPanel** kept client usage metrics

### Root cause of recovery issues:

The recovery agent (react-frontend-specialist) was told to "re-apply all session work" but was not told what the ORIGINAL pre-session code looked like vs what the session had changed. Without a diff to follow, the agent made assumptions and introduced client-app patterns.
