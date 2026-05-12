---
title: Admin app inventory — full-repo audit input
description: File-by-file inventory of apps/admin/ surface for cross-reference with API endpoints, client app counterparts, and feature mapping.
generated: 2026-05-10
auditor: claude-code
---

# Admin app inventory

> Surface: `apps/admin/`. Generated as input to the full-repo audit.
> 153 files inventoried. Veredictos preliminares: VÁLIDO=130, REDUNDANTE=4, DEAD=12, FORGOTTEN-FEATURE=1, MISMATCH=2, UNKNOWN=4.

## Summary by Tipo

| Tipo          |   Count |  VÁLIDO | REDUNDANTE |   DEAD | FORGOTTEN-FEATURE | MISMATCH | UNKNOWN |
| ------------- | ------: | ------: | ---------: | -----: | ----------------: | -------: | ------: |
| page          |      24 |      23 |          0 |      0 |                 0 |        1 |       0 |
| layout        |       3 |       3 |          0 |      0 |                 0 |        0 |       0 |
| route-handler |       2 |       2 |          0 |      0 |                 0 |        0 |       0 |
| server-action |       2 |       2 |          0 |      0 |                 0 |        0 |       0 |
| component     |      62 |      56 |          1 |      4 |                 1 |        0 |       0 |
| hook          |      35 |      27 |          0 |      5 |                 0 |        1 |       2 |
| lib           |      22 |      17 |          2 |      1 |                 0 |        0 |       2 |
| store         |       1 |       0 |          1 |      0 |                 0 |        0 |       0 |
| provider      |       3 |       3 |          0 |      0 |                 0 |        0 |       0 |
| types         |       1 |       0 |          0 |      1 |                 0 |        0 |       0 |
| barrel        |       6 |       6 |          0 |      0 |                 0 |        0 |       0 |
| **Total**     | **161** | **139** |      **4** | **11** |             **1** |    **2** |   **4** |

(Subtypes overlap: hook submodules `api.ts`/`queries.ts`/`mutations.ts`/`types.ts` are counted under hook; `index.ts` re-exporters under barrel.)

## By directory

### apps/admin/app/

#### audit-A-001 — Login server action with MFA

- **Path:** [apps/admin/app/actions/auth.ts](apps/admin/app/actions/auth.ts)
- **Surface:** admin
- **Tipo:** server-action
- **Propósito real:** Server Actions for admin login (incl. MFA two-step) and logout. Writes httpOnly session cookies via shared `sessionCookie` helpers; logs via `ConsoleLoggerAdapter`.
- **Exports / endpoints / handlers:** `loginAction(prevState, formData)`, `logoutAction()`.
- **Imports significativos:** `next/navigation`, `next/headers`, `@observability/browser-logger`, `@/lib/auth/backend-client`, `@/lib/auth/sessionCookie`.
- **API endpoints consumed:** Indirectly via `authenticateAdmin` and `logoutFromBackend` (backend-client) → `POST {API_URL}/admin/auth/login`, `POST /admin/auth/logout`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Single source of truth for cookie-bound login. Used by `components/auth/login-form.tsx` and `components/shared/SidebarNav.tsx` (logoutAction).

#### audit-A-002 — Locale server action

- **Path:** [apps/admin/app/actions/locale.ts](apps/admin/app/actions/locale.ts)
- **Surface:** admin
- **Tipo:** server-action
- **Propósito real:** Persists `NEXT_LOCALE` cookie and revalidates root layout when admin switches en/es.
- **Exports / endpoints / handlers:** `setLocaleAction(locale)`.
- **Imports significativos:** `next/headers`, `next/cache`.
- **API endpoints consumed:** None (cookie write only).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Used by SidebarNav language switcher.

#### audit-A-003 — Token refresh route handler

- **Path:** [apps/admin/app/api/auth/refresh/route.ts](apps/admin/app/api/auth/refresh/route.ts)
- **Surface:** admin
- **Tipo:** route-handler
- **Propósito real:** GET handler that exchanges the refresh+csrf cookies for a fresh access token (`POST /admin/auth/refresh`), updates session cookie, and 302-redirects to `returnTo`. Used when dashboard layout detects expired token.
- **Exports / endpoints / handlers:** `GET /api/auth/refresh?returnTo=...`.
- **Imports significativos:** `next/headers`, `next/server`, `@/lib/auth/sessionCookie`, `../../../../lib/env`.
- **API endpoints consumed:** `POST {API_URL}/admin/auth/refresh` — exists in `apps/api/src/admin/auth/adminAuthRoutes.ts`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-004 — Universal backend proxy

- **Path:** [apps/admin/app/api/backend/[...path]/route.ts](apps/admin/app/api/backend/[...path]/route.ts)
- **Surface:** admin
- **Tipo:** route-handler
- **Propósito real:** Catch-all proxy that forwards `GET/POST/PUT/PATCH/DELETE /api/backend/<path>` to `{API_URL}/<path>` injecting the admin session JWT. Implements transparent token refresh on 401.
- **Exports / endpoints / handlers:** Catch-all `[...path]` for every admin client-side API call. Sole carrier of admin → API HTTP traffic.
- **Imports significativos:** `next/headers`, `next/server`, `../../../../lib/env`.
- **API endpoints consumed:** All backend endpoints (path-passthrough). Token refresh path: `POST {API_URL}/admin/auth/refresh`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Critical infrastructure. JSDoc lacks `@layer` (file header is `@file`/`@description` only) — minor compliance gap.

#### audit-A-005 — Auth layout (passthrough)

- **Path:** [apps/admin/app/(auth)/layout.tsx](<apps/admin/app/(auth)/layout.tsx>)
- **Surface:** admin
- **Tipo:** layout
- **Propósito real:** Trivial passthrough wrapper for the `(auth)` route group. No chrome, no auth checks.
- **Exports / endpoints / handlers:** `AuthLayout` (default).
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-006 — Admin login page

- **Path:** [apps/admin/app/(auth)/login/page.tsx](<apps/admin/app/(auth)/login/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Split-screen branding+`LoginForm` page at `/login`.
- **Exports / endpoints / handlers:** `LoginPage` (default) — serves `/login`.
- **Imports significativos:** `@/components/auth/login-form`.
- **API endpoints consumed:** Indirectly via `LoginForm` → `loginAction` Server Action.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-007 — Accounts listing page

- **Path:** [apps/admin/app/(dashboard)/accounts/page.tsx](<apps/admin/app/(dashboard)/accounts/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Tenant-account management page (list, filter, sort, edit, reset password, billing panel, CSV export).
- **Exports / endpoints / handlers:** default page → `/accounts`.
- **Imports significativos:** `@packages/api-errors`, `@packages/ui`, `@tanstack/react-query`.
- **API endpoints consumed:** `useAccounts`, `useUpdateAccount`, `useResetAccountPassword`, `exportAccountsToCSV` → `/admin/accounts/*`, `/admin/accounts/export`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-008 — Analytics dashboard page

- **Path:** [apps/admin/app/(dashboard)/analytics/page.tsx](<apps/admin/app/(dashboard)/analytics/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** High-level business/operational/growth metrics with donut + trend charts.
- **Exports / endpoints / handlers:** default page → `/analytics`.
- **Imports significativos:** `@/hooks/api/useAnalytics`, `@/components/charts`.
- **API endpoints consumed:** `useAnalytics` (aggregates analytics + dashboard + billing endpoints).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-009 — Announcements CRUD page

- **Path:** [apps/admin/app/(dashboard)/announcements/page.tsx](<apps/admin/app/(dashboard)/announcements/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** CRUD for admin-to-client broadcast announcements (info/warning/maintenance/critical).
- **Exports / endpoints / handlers:** default page → `/announcements`.
- **Imports significativos:** Inline `useQuery`/`useMutation` (no per-domain hook module).
- **API endpoints consumed:** `fetch("/api/backend/admin/announcements*")` — exists in `apps/api/src/announcements/announcementRoutes.ts` (mounted as admin endpoints).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Uses inline TanStack instead of a dedicated `useAnnouncements` hook — minor inconsistency with the rest of admin's hook style.

#### audit-A-010 — Gateway switches page

- **Path:** [apps/admin/app/(dashboard)/billing/gateway-switches/page.tsx](<apps/admin/app/(dashboard)/billing/gateway-switches/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Lists Stripe↔Paddle switch events with stats, filtering, and admin actions (extend, force-complete, suspend).
- **Exports / endpoints / handlers:** default page → `/billing/gateway-switches`.
- **Imports significativos:** `@/hooks/api/useGatewaySwitches`.
- **API endpoints consumed:** `useGatewaySwitches`, `useExtendSwitchDeadline`, `useForceCompleteSwitch`, `useForceSuspendSwitch` → `/admin/billing/gateway-switches*` (handled by `apps/api/src/billing/adminBillingRoutes.ts`).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-011 — Compliance dashboard page

- **Path:** [apps/admin/app/(dashboard)/compliance/page.tsx](<apps/admin/app/(dashboard)/compliance/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Five-tab compliance UI (overview/GDPR/security/breaches/audit).
- **Exports / endpoints / handlers:** default page → `/compliance`.
- **Imports significativos:** `@/hooks/api/useCompliance`.
- **API endpoints consumed:** `useCompliance`, `useComplianceScore` → `/compliance/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-012 — Help/docs page

- **Path:** [apps/admin/app/(dashboard)/help/page.tsx](<apps/admin/app/(dashboard)/help/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Static accordion with i18n help text for every admin feature.
- **Exports / endpoints / handlers:** default page → `/help`.
- **Imports significativos:** `lucide-react`, `next-intl`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Pure docs.

#### audit-A-013 — Dashboard layout (auth gate)

- **Path:** [apps/admin/app/(dashboard)/layout.tsx](<apps/admin/app/(dashboard)/layout.tsx>)
- **Surface:** admin
- **Tipo:** layout
- **Propósito real:** Server-side token verification, sidebar render, AuthProvider/QueryProvider wiring; redirects to `/login` (or `/api/auth/refresh`) on bad token.
- **Exports / endpoints / handlers:** `DashboardLayout` (default).
- **Imports significativos:** `next/headers`, `next/navigation`, `@/providers/*`, `@/lib/auth/backend-client`.
- **API endpoints consumed:** `verifyAccessToken` → backend-client → `POST {API_URL}/admin/auth/me` (or whichever is canonical).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-014 — Audit logs page

- **Path:** [apps/admin/app/(dashboard)/logs/page.tsx](<apps/admin/app/(dashboard)/logs/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Audit-log table with filter, search, CSV export, auto-refresh.
- **Exports / endpoints / handlers:** default page → `/logs`.
- **Imports significativos:** `@/hooks/api/useAuditLogs`, `@/hooks/api/useAuditStats`, `@/hooks/api/useAdminUsers`.
- **API endpoints consumed:** `/admin/audit/*`, `/admin/audit/stats`, `/admin/users`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-015 — Maintenance page (queue health)

- **Path:** [apps/admin/app/(dashboard)/maintenance/page.tsx](<apps/admin/app/(dashboard)/maintenance/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Queue stats, failed-jobs table, queue health panel, scheduled-jobs panel.
- **Exports / endpoints / handlers:** default page → `/maintenance`.
- **Imports significativos:** `@/hooks/api/useQueueManagement`.
- **API endpoints consumed:** `useQueueStats`, `useFailedJobs`, `useRetryJob` → `/admin/queues/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-016 — Dashboard home page

- **Path:** [apps/admin/app/(dashboard)/page.tsx](<apps/admin/app/(dashboard)/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Admin landing page with account/subscription/revenue stats and SetupBanner.
- **Exports / endpoints / handlers:** default page → `/`.
- **Imports significativos:** `@/hooks/api/useDashboardStats`, `@/components/charts`, `@/components/dashboard/SetupBanner`.
- **API endpoints consumed:** `useDashboardStats` → `/admin/dashboard`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-017 — Pricing tiers + bundles page

- **Path:** [apps/admin/app/(dashboard)/pricing/page.tsx](<apps/admin/app/(dashboard)/pricing/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Tabbed pricing UI: provider tiers, account tiers, bundles (CRUD), MRR.
- **Exports / endpoints / handlers:** default page → `/pricing`.
- **Imports significativos:** `@/hooks/api/usePricingTiers`, `@/components/pricing/*`.
- **API endpoints consumed:** `/admin/pricing/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-018 — Admin API-key rotation page

- **Path:** [apps/admin/app/(dashboard)/security/apikeys/page.tsx](<apps/admin/app/(dashboard)/security/apikeys/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Single-field form to rotate an ApiKey across tenants; raw key shown once.
- **Exports / endpoints / handlers:** default page → `/security/apikeys`.
- **Imports significativos:** `@/hooks/api/useApiKeyAdminRotate`.
- **API endpoints consumed:** `POST /admin/security/api-keys/:id/rotate` (apiKeysAdminClient.rotate).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-019 — Admin force-channel-reauth page

- **Path:** [apps/admin/app/(dashboard)/security/channels/page.tsx](<apps/admin/app/(dashboard)/security/channels/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Form to force a single channel into NEEDS_REAUTH.
- **Exports / endpoints / handlers:** default page → `/security/channels`.
- **Imports significativos:** `@/hooks/api/useChannelForceReauth`.
- **API endpoints consumed:** `channelsAdminClient.forceReauth` → `POST /admin/channels/:id/force-reauth`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-020 — MFA page (manager + self-service)

- **Path:** [apps/admin/app/(dashboard)/security/mfa/page.tsx](<apps/admin/app/(dashboard)/security/mfa/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Composes `MfaSelfService` + `MfaManager`.
- **Exports / endpoints / handlers:** default page → `/security/mfa`.
- **Imports significativos:** `@/components/security/*`.
- **API endpoints consumed:** Indirect through MFA components.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-021 — OIDC secret-replace page

- **Path:** [apps/admin/app/(dashboard)/security/oidc/page.tsx](<apps/admin/app/(dashboard)/security/oidc/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Form to paste a new OIDC client_secret with discovery handshake verification.
- **Exports / endpoints / handlers:** default page → `/security/oidc`.
- **Imports significativos:** `@/hooks/api/useOidcReplaceClientSecret`.
- **API endpoints consumed:** `oidcAdminClient.replaceClientSecret`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-022 — Security overview page

- **Path:** [apps/admin/app/(dashboard)/security/page.tsx](<apps/admin/app/(dashboard)/security/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Security stats + MFA adoption + RBAC manager.
- **Exports / endpoints / handlers:** default page → `/security`.
- **Imports significativos:** `@/hooks/api/useSecurity`, `@/components/security/RbacManager`.
- **API endpoints consumed:** `useSecurityOverview` → `/admin/security/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-023 — Provider mass-reauth page

- **Path:** [apps/admin/app/(dashboard)/security/providers/page.tsx](<apps/admin/app/(dashboard)/security/providers/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Cross-tenant force-reauth on a Provider after platform-level OAuth client_secret rotation; soft-delete tier gated by typed confirmation.
- **Exports / endpoints / handlers:** default page → `/security/providers`.
- **Imports significativos:** `@/hooks/api/useProviderForceMassReauth`.
- **API endpoints consumed:** `providersAdminClient.forceMassReauth`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-024 — RBAC page

- **Path:** [apps/admin/app/(dashboard)/security/rbac/page.tsx](<apps/admin/app/(dashboard)/security/rbac/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Thin wrapper around `RbacManager`.
- **Exports / endpoints / handlers:** default page → `/security/rbac`.
- **Imports significativos:** `@/components/security/RbacManager`.
- **API endpoints consumed:** Indirect via RbacManager → `api.security.rbac.*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Memory flag noted: "RBAC management, may have unwired permissions (T4-V deferred)." Permissions surface looks wired but completeness of the permission catalog vs backend canon needs independent review.

#### audit-A-025 — Secrets rotation status page

- **Path:** [apps/admin/app/(dashboard)/security/secrets/page.tsx](<apps/admin/app/(dashboard)/security/secrets/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Read-only dashboard with one row per secret (last rotated, next due, status).
- **Exports / endpoints / handlers:** default page → `/security/secrets`.
- **Imports significativos:** `@/hooks/api/useSecretRotationStatus`.
- **API endpoints consumed:** `secretsClient.getRotationStatus` → `GET /admin/security/secrets/rotation-status` — exists in `apps/api/src/admin/secretsRotationRoutes.ts`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-026 — Webhook secret rotation page

- **Path:** [apps/admin/app/(dashboard)/security/webhooks/page.tsx](<apps/admin/app/(dashboard)/security/webhooks/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Form to rotate a WebhookSubscription.secretKey with grace window.
- **Exports / endpoints / handlers:** default page → `/security/webhooks`.
- **Imports significativos:** `@/hooks/api/useWebhookRotateSecret`.
- **API endpoints consumed:** `webhooksAdminClient.rotateSecret`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Note: this `/security/webhooks` is different from `/webhooks` (the dashboard). Two distinct features at adjacent URLs — flag for IA review.

#### audit-A-027 — Settings page

- **Path:** [apps/admin/app/(dashboard)/settings/page.tsx](<apps/admin/app/(dashboard)/settings/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Tabbed superadmin settings UI (overview/gateways/email/ai/storage/social/platform/monitoring/security).
- **Exports / endpoints / handlers:** default page → `/settings`.
- **Imports significativos:** `@/hooks/api/useSettings`, `@/components/settings/*`.
- **API endpoints consumed:** `/admin/settings/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-028 — Subscriptions page

- **Path:** [apps/admin/app/(dashboard)/subscriptions/page.tsx](<apps/admin/app/(dashboard)/subscriptions/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Subscriptions table + trial workflow (start/end/convert) + UsageMetricsPanel.
- **Exports / endpoints / handlers:** default page → `/subscriptions`.
- **Imports significativos:** `@/hooks/api/useSubscriptions`, `@/hooks/api/useSubscriptionMutations`, `@/hooks/api/useBillingStats`.
- **API endpoints consumed:** `/admin/subscriptions/*`, `/admin/billing/stats`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-029 — Admin users page

- **Path:** [apps/admin/app/(dashboard)/users/page.tsx](<apps/admin/app/(dashboard)/users/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Manages admin (internal) users — invite, activate/deactivate, change role, reset password.
- **Exports / endpoints / handlers:** default page → `/users`.
- **Imports significativos:** `@/hooks/api/useAdminUsers`, `@/lib/apiClient`.
- **API endpoints consumed:** `/admin/users/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-030 — Webhook dashboard page

- **Path:** [apps/admin/app/(dashboard)/webhooks/page.tsx](<apps/admin/app/(dashboard)/webhooks/page.tsx>)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Tabbed webhook dashboard (metrics/events/subscriptions/timeline/DLQ).
- **Exports / endpoints / handlers:** default page → `/webhooks`.
- **Imports significativos:** `@/hooks/api/useWebhooks`, `@/components/webhooks/*`.
- **API endpoints consumed:** `/admin/webhooks/*`. Subscriptions tab indirectly uses `useProjectsForSubscriptionForm` → `/api/backend/projects` (does not exist — see MISMATCH).
- **Veredicto preliminar:** MISMATCH
- **Notas:** Subscriptions tab uses a hook that fetches a non-existent endpoint (PR-15 — confirmed). Page renders but the project picker in WebhookSubscriptions silently fails.

#### audit-A-031 — Root error boundary page

- **Path:** [apps/admin/app/error.tsx](apps/admin/app/error.tsx)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Next.js root error boundary — shows error digest and uses `unstable_retry` (Next 16.2+) to refetch on retry.
- **Exports / endpoints / handlers:** default export consumed by Next.
- **Imports significativos:** `@observability/browser-logger`, `@/components/ui/ActionButton`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`. Contains `process.env.NODE_ENV` — allowed exception per fitness #17.

#### audit-A-032 — Root layout

- **Path:** [apps/admin/app/layout.tsx](apps/admin/app/layout.tsx)
- **Surface:** admin
- **Tipo:** layout
- **Propósito real:** Root HTML+`<body>`, GeistSans/Mono font CSS vars, `NextIntlClientProvider`, `LoggerProvider`, `ThemeProvider`, `AdminToaster`.
- **Exports / endpoints / handlers:** `RootLayout` (default), `metadata`.
- **Imports significativos:** `geist/font/*`, `next-intl`, `@observability/browser-logger`, `@/providers/ThemeProvider`, `@/components/ui/AdminToaster`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-033 — Loading skeleton

- **Path:** [apps/admin/app/loading.tsx](apps/admin/app/loading.tsx)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Animated skeleton screen for dashboard pages during streaming.
- **Exports / endpoints / handlers:** default consumed by Next.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-034 — Not-found page

- **Path:** [apps/admin/app/not-found.tsx](apps/admin/app/not-found.tsx)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** 404 page with i18n strings and home link.
- **Exports / endpoints / handlers:** default consumed by Next.
- **Imports significativos:** `next-intl`, `next/link`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-035 — Public password-reset page

- **Path:** [apps/admin/app/reset-password/page.tsx](apps/admin/app/reset-password/page.tsx)
- **Surface:** admin
- **Tipo:** page
- **Propósito real:** Public page consumed via email link. Collects new password + Turnstile token and submits.
- **Exports / endpoints / handlers:** default page → `/reset-password`.
- **Imports significativos:** `@marsidev/react-turnstile`, `@packages/api-errors`.
- **API endpoints consumed:** `GET /api/backend/settings/public` (Turnstile site key fetch). Plus the password-reset POST (assumed `/api/backend/admin/auth/password/reset` or similar).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Raw `fetch` calls inline rather than via a hook — minor inconsistency.

### apps/admin/components/

#### audit-A-036 — Account billing panel

- **Path:** [apps/admin/components/accounts/AccountBillingPanel.tsx](apps/admin/components/accounts/AccountBillingPanel.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Account-level billing breakdown (plan, grandfathering, trial, provider pricing, active sessions, Change Plan).
- **Exports / endpoints / handlers:** `AccountBillingPanel`.
- **Imports significativos:** `@/hooks/api/useAccountBilling`, `@/hooks/api/useAccountSessions`, `@/components/subscriptions/ChangePlanDialog`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-037 — Account edit form

- **Path:** [apps/admin/components/accounts/AccountEditForm.tsx](apps/admin/components/accounts/AccountEditForm.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Inline-edit form for account fields (name/email/phone/trial/auto-renewal).
- **Exports / endpoints / handlers:** `AccountEditForm`.
- **Imports significativos:** `next-intl`, `@/components/ui/ActionButton`.
- **API endpoints consumed:** None (controlled by parent).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-038 — Account status badge

- **Path:** [apps/admin/components/accounts/AccountStatusBadge.tsx](apps/admin/components/accounts/AccountStatusBadge.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Tri-state badge (Active/Suspended/Trial) for an account.
- **Exports / endpoints / handlers:** `AccountStatusBadge`.
- **Imports significativos:** `@/lib/apiClient` (type only).
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-039 — Export accounts to CSV helper

- **Path:** [apps/admin/components/accounts/exportAccountsToCSV.ts](apps/admin/components/accounts/exportAccountsToCSV.ts)
- **Surface:** admin
- **Tipo:** component (helper)
- **Propósito real:** Triggers a CSV download via `/api/backend/admin/accounts/export`.
- **Exports / endpoints / handlers:** `exportAccountsToCSV(selectedIds)`.
- **Imports significativos:** —
- **API endpoints consumed:** `GET /api/backend/admin/accounts/export?ids=...&format=csv`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Raw fetch (acceptable here — file-download flow returns Blob, not JSON envelope).

#### audit-A-040 — Login form

- **Path:** [apps/admin/components/auth/login-form.tsx](apps/admin/components/auth/login-form.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** React 19 `useActionState` form with two-step MFA flow (email/pass → optional TOTP).
- **Exports / endpoints / handlers:** `LoginForm`.
- **Imports significativos:** `@/app/actions/auth`, `@/lib/auth/types`.
- **API endpoints consumed:** Indirect via `loginAction` Server Action.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** File is `login-form.tsx` (kebab) while the rest of admin components are PascalCase — minor naming drift.

#### audit-A-041 — Chart empty state

- **Path:** [apps/admin/components/charts/ChartEmptyState.tsx](apps/admin/components/charts/ChartEmptyState.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Placeholder rendered inside chart components when there's no data.
- **Exports / endpoints / handlers:** `ChartEmptyState`.
- **Imports significativos:** `lucide-react`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Intentionally not re-exported via the barrel (per barrel JSDoc).

#### audit-A-042 — Donut chart

- **Path:** [apps/admin/components/charts/DonutChart.tsx](apps/admin/components/charts/DonutChart.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Reusable Recharts donut with custom legend.
- **Exports / endpoints / handlers:** `DonutChart`, `DonutChartDatum`.
- **Imports significativos:** `recharts`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-043 — Horizontal bar chart

- **Path:** [apps/admin/components/charts/HorizontalBarChart.tsx](apps/admin/components/charts/HorizontalBarChart.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Recharts horizontal-bar wrapper with per-bar colors.
- **Exports / endpoints / handlers:** `HorizontalBarChart`.
- **Imports significativos:** `recharts`, `@/hooks/useChartColors`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-044 — Charts barrel

- **Path:** [apps/admin/components/charts/index.ts](apps/admin/components/charts/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports the public chart components.
- **Exports / endpoints / handlers:** `DonutChart`, `TrendAreaChart`, `StackedBarChart`, `HorizontalBarChart`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-045 — Stacked bar chart

- **Path:** [apps/admin/components/charts/StackedBarChart.tsx](apps/admin/components/charts/StackedBarChart.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Recharts stacked vertical-bar wrapper.
- **Exports / endpoints / handlers:** `StackedBarChart`.
- **Imports significativos:** `recharts`, `@/hooks/useChartColors`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-046 — Trend area chart

- **Path:** [apps/admin/components/charts/TrendAreaChart.tsx](apps/admin/components/charts/TrendAreaChart.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Recharts time-series area chart with gradient fill (unique gradient ID per instance).
- **Exports / endpoints / handlers:** `TrendAreaChart`.
- **Imports significativos:** `recharts`, `@/hooks/useChartColors`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-047 — Breach reports table

- **Path:** [apps/admin/components/compliance/BreachTable.tsx](apps/admin/components/compliance/BreachTable.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Data-breach reports table + report dialog with severity + notification.
- **Exports / endpoints / handlers:** `BreachTable`.
- **Imports significativos:** `@/hooks/api/useCompliance`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-048 — DSAR requests table

- **Path:** [apps/admin/components/compliance/DsarTable.tsx](apps/admin/components/compliance/DsarTable.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** DSAR requests table with acknowledge/complete/reject actions and deadline indicators.
- **Exports / endpoints / handlers:** `DsarTable`.
- **Imports significativos:** `@/hooks/api/useCompliance`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-049 — GDPR settings form

- **Path:** [apps/admin/components/compliance/GdprSettingsForm.tsx](apps/admin/components/compliance/GdprSettingsForm.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** GDPR/privacy-settings form (DPO, retention, DSAR deadlines, jurisdictions).
- **Exports / endpoints / handlers:** `GdprSettingsForm`.
- **Imports significativos:** `@/hooks/api/useCompliance`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-050 — Security settings form

- **Path:** [apps/admin/components/compliance/SecuritySettingsForm.tsx](apps/admin/components/compliance/SecuritySettingsForm.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Compliance security-settings form (2FA enforcement, timeouts, password policy, IP allowlist).
- **Exports / endpoints / handlers:** `SecuritySettingsForm`.
- **Imports significativos:** `@/hooks/api/useCompliance`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-051 — Setup banner

- **Path:** [apps/admin/components/dashboard/SetupBanner.tsx](apps/admin/components/dashboard/SetupBanner.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** First-run banner warning that critical settings (gateway/email/AI/platform) are unconfigured.
- **Exports / endpoints / handlers:** `SetupBanner`.
- **Imports significativos:** `@/hooks/api/useSettings`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-052 — Failed jobs table

- **Path:** [apps/admin/components/maintenance/FailedJobsTable.tsx](apps/admin/components/maintenance/FailedJobsTable.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Table of failed BullMQ jobs with per-row retry button.
- **Exports / endpoints / handlers:** `FailedJobsTable`.
- **Imports significativos:** `@/providers/AuthProvider`, `@/hooks/api/useQueueManagement` (type only).
- **API endpoints consumed:** None (delegated to parent).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-053 — Queue health panel

- **Path:** [apps/admin/components/maintenance/QueueHealthPanel.tsx](apps/admin/components/maintenance/QueueHealthPanel.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Lists all 15 BullMQ queues with color-coded health dot.
- **Exports / endpoints / handlers:** `QueueHealthPanel`.
- **Imports significativos:** `@/hooks/api/useQueueManagement` (type).
- **API endpoints consumed:** None (data via parent).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Queue list is a hardcoded array — drift risk vs `packages/adapters/queue-bullmq/src/constants.ts`. Worth a small refactor to import the canonical list.

#### audit-A-054 — Scheduled jobs panel

- **Path:** [apps/admin/components/maintenance/ScheduledJobsPanel.tsx](apps/admin/components/maintenance/ScheduledJobsPanel.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Scheduled-job rows with last-run info, manual-trigger, cron-edit.
- **Exports / endpoints / handlers:** `ScheduledJobsPanel`.
- **Imports significativos:** `@packages/api-errors`, `@/providers/AuthProvider`.
- **API endpoints consumed:** Hits raw fetch endpoints (`/api/backend/admin/scheduled-jobs*`) — verify presence in `apps/api/src/admin/schedulingRoutes.ts`.
- **Veredicto preliminar:** UNKNOWN
- **Notas:** Couldn't quickly confirm every endpoint corresponds to a real admin route. Worth a follow-up check against `schedulingRoutes.ts` + audit-log endpoint for last-run lookups.

#### audit-A-055 — Account-tiers tab

- **Path:** [apps/admin/components/pricing/AccountTiersTab.tsx](apps/admin/components/pricing/AccountTiersTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Editable table for account-tier records.
- **Exports / endpoints / handlers:** `AccountTiersTab`.
- **Imports significativos:** `@/hooks/api/usePricingTiers`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-056 — Provider-tiers tab

- **Path:** [apps/admin/components/pricing/ProviderTiersTab.tsx](apps/admin/components/pricing/ProviderTiersTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Editable table for provider-tier records.
- **Exports / endpoints / handlers:** `ProviderTiersTab`.
- **Imports significativos:** `@/hooks/api/usePricingTiers`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-057 — Queue manager hook (dead)

- **Path:** [apps/admin/components/queue/useQueueManager.tsx](apps/admin/components/queue/useQueueManager.tsx)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Hook that fetches BullMQ jobs+stats via `/api/backend/queue` proxy and exposes filter/mutation state.
- **Exports / endpoints / handlers:** `useQueueManager`, `QueueItem`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** `/api/backend/queue` (verify — `useQueueManagement` already covers maintenance page; this hook has no callers).
- **Veredicto preliminar:** DEAD
- **Notas:** Zero callers under app/, components/, hooks/. Mis-located too (a hook under `components/queue/`). Looks like leftover from a previous queue-dashboard design replaced by `useQueueManagement.ts` + `/maintenance`.

#### audit-A-058 — Create-role dialog

- **Path:** [apps/admin/components/security/CreateRoleDialog.tsx](apps/admin/components/security/CreateRoleDialog.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Dialog for creating a custom RBAC role.
- **Exports / endpoints / handlers:** `CreateRoleDialog`.
- **Imports significativos:** `@packages/ui`, `../../lib/apiClient` (api.security.rbac).
- **API endpoints consumed:** `api.security.rbac.createRole` → `/admin/security/rbac/roles`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-059 — Admin MFA manager

- **Path:** [apps/admin/components/security/MfaManager.tsx](apps/admin/components/security/MfaManager.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Manager that lists admin users + force-disable MFA.
- **Exports / endpoints / handlers:** `MfaManager` (default).
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** `api.security.mfa.forceDisable`, `api.security.mfa.getUserStatus`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-060 — MFA self-service

- **Path:** [apps/admin/components/security/MfaSelfService.tsx](apps/admin/components/security/MfaSelfService.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Self-service MFA setup panel (TOTP secret + verify + disable).
- **Exports / endpoints / handlers:** `MfaSelfService`.
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** `api.security.mfa.*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-061 — Permission grid

- **Path:** [apps/admin/components/security/PermissionGrid.tsx](apps/admin/components/security/PermissionGrid.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Checkbox grid that maps roles to permissions by category.
- **Exports / endpoints / handlers:** `PermissionGrid`.
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** `api.security.rbac.setRolePermissions`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Permission catalog is hardcoded in `CATEGORY_KEYS`. Risk of drift vs backend permission registry — memory flag (T4-V) suggests this completeness is the unwired part.

#### audit-A-062 — RBAC manager

- **Path:** [apps/admin/components/security/RbacManager.tsx](apps/admin/components/security/RbacManager.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Top-level RBAC panel — roles list, role detail, permission editing, users-per-role.
- **Exports / endpoints / handlers:** `RbacManager` (default).
- **Imports significativos:** `../../lib/apiClient`, `./PermissionGrid`, `./CreateRoleDialog`.
- **API endpoints consumed:** `api.security.rbac.*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-063 — AI tab

- **Path:** [apps/admin/components/settings/AiTab.tsx](apps/admin/components/settings/AiTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Settings tab that renders `CredentialForm` for AI credentials.
- **Exports / endpoints / handlers:** `AiTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect via CredentialForm.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-064 — Settings constants

- **Path:** [apps/admin/components/settings/constants.ts](apps/admin/components/settings/constants.ts)
- **Surface:** admin
- **Tipo:** lib (constants)
- **Propósito real:** Frontend mirror of credential group keys + which fields are secrets.
- **Exports / endpoints / handlers:** `buildFieldDefs`, `SOCIAL_GROUPS`, `TAB_GROUP_MAP`, `FieldDef`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Drift risk: hardcoded keys must mirror `apps/api/src/settings/`. Worth a single source of truth in `@shared/types`.

#### audit-A-065 — Credential form

- **Path:** [apps/admin/components/settings/CredentialForm.tsx](apps/admin/components/settings/CredentialForm.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Reusable form for a credential group with masked placeholders and test-connection action.
- **Exports / endpoints / handlers:** `CredentialForm`.
- **Imports significativos:** `@/hooks/api/useSettings`.
- **API endpoints consumed:** Indirect via useSettings.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-066 — Email tab

- **Path:** [apps/admin/components/settings/EmailTab.tsx](apps/admin/components/settings/EmailTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Resend email credentials tab.
- **Exports / endpoints / handlers:** `EmailTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-067 — Gateways tab

- **Path:** [apps/admin/components/settings/GatewaysTab.tsx](apps/admin/components/settings/GatewaysTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Stripe + Paddle credential tab.
- **Exports / endpoints / handlers:** `GatewaysTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-068 — Monitoring tab

- **Path:** [apps/admin/components/settings/MonitoringTab.tsx](apps/admin/components/settings/MonitoringTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Sentry credentials tab.
- **Exports / endpoints / handlers:** `MonitoringTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-069 — Overview tab

- **Path:** [apps/admin/components/settings/OverviewTab.tsx](apps/admin/components/settings/OverviewTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Configuration-health dashboard with per-group status cards.
- **Exports / endpoints / handlers:** `OverviewTab`.
- **Imports significativos:** `@/hooks/api/useSettings` (type), `./constants`.
- **API endpoints consumed:** Data via parent.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-070 — Platform tab

- **Path:** [apps/admin/components/settings/PlatformTab.tsx](apps/admin/components/settings/PlatformTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Platform identity credentials tab.
- **Exports / endpoints / handlers:** `PlatformTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-071 — Security tab

- **Path:** [apps/admin/components/settings/SecurityTab.tsx](apps/admin/components/settings/SecurityTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Encryption-key rotation UI with confirmation dialog.
- **Exports / endpoints / handlers:** `SecurityTab`.
- **Imports significativos:** `@/hooks/api/useSettings`.
- **API endpoints consumed:** Indirect (`useRotateEncryption`).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-072 — Social tab

- **Path:** [apps/admin/components/settings/SocialTab.tsx](apps/admin/components/settings/SocialTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** OAuth credential forms for 11 social platforms, each in its own collapsible.
- **Exports / endpoints / handlers:** `SocialTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-073 — Storage tab

- **Path:** [apps/admin/components/settings/StorageTab.tsx](apps/admin/components/settings/StorageTab.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** S3-compatible object-storage credentials tab.
- **Exports / endpoints / handlers:** `StorageTab`.
- **Imports significativos:** `./CredentialForm`, `./constants`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-074 — Usage metrics panel

- **Path:** [apps/admin/components/settings/UsageMetricsPanel.tsx](apps/admin/components/settings/UsageMetricsPanel.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Per-account usage bars (posts/AI calls/storage/team) for the current billing period.
- **Exports / endpoints / handlers:** Default export `UsageMetricsPanel`.
- **Imports significativos:** `@/hooks/api/useUsageMetrics`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Used by subscriptions page.

#### audit-A-075 — Access-denied screen

- **Path:** [apps/admin/components/shared/AccessDenied.tsx](apps/admin/components/shared/AccessDenied.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Full-block 403 UI shown when a query returns permission-denied.
- **Exports / endpoints / handlers:** `AccessDenied`.
- **Imports significativos:** `lucide-react`, `next-intl`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-076 — Error boundary (dead)

- **Path:** [apps/admin/components/shared/ErrorBoundary.tsx](apps/admin/components/shared/ErrorBoundary.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** React class error-boundary with optional logger prop.
- **Exports / endpoints / handlers:** `ErrorBoundary`.
- **Imports significativos:** `@observability/browser-logger`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** DEAD
- **Notas:** Zero callers in app/ or components/. App relies on Next's built-in `app/error.tsx` instead. Either remove or wire it in a place that pure-Next error boundary doesn't cover (e.g., individual feature subtrees).

#### audit-A-077 — Loading spinner

- **Path:** [apps/admin/components/shared/LoadingSpinner.tsx](apps/admin/components/shared/LoadingSpinner.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** ARIA-live accessible spinner used across pages.
- **Exports / endpoints / handlers:** `LoadingSpinner`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** REDUNDANTE
- **Notas:** Near-twin: `apps/client/components/shared/LoadingSpinner.tsx`. Cross-app duplication: should be hoisted to `packages/ui/src/components/`.

#### audit-A-078 — Sidebar nav

- **Path:** [apps/admin/components/shared/SidebarNav.tsx](apps/admin/components/shared/SidebarNav.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Collapsible sidebar with i18n, theme toggle, locale switcher, and route links. Uses Server Action for logout.
- **Exports / endpoints / handlers:** `SidebarNav`.
- **Imports significativos:** `next/link`, `next-intl`, `@/app/actions/locale`, `@/app/actions/auth`.
- **API endpoints consumed:** None directly (uses Server Actions).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-079 — Skip-link (dead)

- **Path:** [apps/admin/components/shared/SkipLink.tsx](apps/admin/components/shared/SkipLink.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** WCAG "Skip to main content" link.
- **Exports / endpoints / handlers:** `SkipLink`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** DEAD
- **Notas:** No callers. Dashboard layout sets `id="main-content"` for it but no `<SkipLink>` is rendered. Wire into layout to honor accessibility, or remove.

#### audit-A-080 — Visually-hidden (dead)

- **Path:** [apps/admin/components/shared/VisuallyHidden.tsx](apps/admin/components/shared/VisuallyHidden.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Screen-reader-only wrapper.
- **Exports / endpoints / handlers:** `VisuallyHidden`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** DEAD
- **Notas:** No callers. Same a11y story as SkipLink — either standardize on this primitive or remove.

#### audit-A-081 — Change-plan dialog

- **Path:** [apps/admin/components/subscriptions/ChangePlanDialog.tsx](apps/admin/components/subscriptions/ChangePlanDialog.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Dialog to change an account's subscription plan (Custom checkboxes vs Bundle cards).
- **Exports / endpoints / handlers:** `ChangePlanDialog`.
- **Imports significativos:** `@packages/ui`, `@tanstack/react-query`.
- **API endpoints consumed:** Likely `/admin/billing/*` (inline mutations).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-082 — Action button

- **Path:** [apps/admin/components/ui/ActionButton.tsx](apps/admin/components/ui/ActionButton.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Variant/size/loading button.
- **Exports / endpoints / handlers:** `ActionButton`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Admin uses this as the primary button instead of `Button` from `@packages/ui`. Consider hoisting to packages/ui to reduce divergence with client.

#### audit-A-083 — Admin toaster

- **Path:** [apps/admin/components/ui/AdminToaster.tsx](apps/admin/components/ui/AdminToaster.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Top-center toast container wrapping `@packages/ui` Toast primitives.
- **Exports / endpoints / handlers:** `AdminToaster`.
- **Imports significativos:** `@packages/ui`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-084 — Badge

- **Path:** [apps/admin/components/ui/Badge.tsx](apps/admin/components/ui/Badge.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Semantic-color pill badge.
- **Exports / endpoints / handlers:** `Badge`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Admin uses this instead of `Badge` from `@packages/ui`. Hoist candidate.

#### audit-A-085 — Data table

- **Path:** [apps/admin/components/ui/DataTable.tsx](apps/admin/components/ui/DataTable.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Generic table with sticky header, loading skeleton, empty state.
- **Exports / endpoints / handlers:** `DataTable<T>`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-086 — Page header

- **Path:** [apps/admin/components/ui/PageHeader.tsx](apps/admin/components/ui/PageHeader.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Title + optional description + actions slot.
- **Exports / endpoints / handlers:** `PageHeader`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-087 — Pagination

- **Path:** [apps/admin/components/ui/Pagination.tsx](apps/admin/components/ui/Pagination.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Compact pagination + per-page selector.
- **Exports / endpoints / handlers:** `Pagination`.
- **Imports significativos:** `next-intl`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-088 — Stat card

- **Path:** [apps/admin/components/ui/StatCard.tsx](apps/admin/components/ui/StatCard.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Compact stat card with label + value + optional trend + icon.
- **Exports / endpoints / handlers:** `StatCard`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-089 — Tab nav

- **Path:** [apps/admin/components/ui/TabNav.tsx](apps/admin/components/ui/TabNav.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Horizontal tab navigation with ARIA roles.
- **Exports / endpoints / handlers:** `TabNav`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Coexists with `Tabs` from `@packages/ui` (used by `/webhooks` page). Two tab abstractions — consolidate.

#### audit-A-090 — Change-password dialog (admin self)

- **Path:** [apps/admin/components/users/ChangePasswordDialog.tsx](apps/admin/components/users/ChangePasswordDialog.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Dialog for the current admin user to change their own password.
- **Exports / endpoints / handlers:** `ChangePasswordDialog`.
- **Imports significativos:** `@/hooks/api/useChangePassword`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Lives in `users/` but is for the current user, not the table of admin users — slightly misleading directory placement.

#### audit-A-091 — Dead-letter queue panel

- **Path:** [apps/admin/components/webhooks/DeadLetterQueue.tsx](apps/admin/components/webhooks/DeadLetterQueue.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** DLQ management for failed webhook events (filter, inspect, retry, bulk).
- **Exports / endpoints / handlers:** `DeadLetterQueue`.
- **Imports significativos:** `@/hooks/api/useWebhooks`.
- **API endpoints consumed:** Indirect (`/admin/webhooks/dlq*`).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-092 — Webhook events list

- **Path:** [apps/admin/components/webhooks/WebhookEventsList.tsx](apps/admin/components/webhooks/WebhookEventsList.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Paginated webhook-events list with inspection + export.
- **Exports / endpoints / handlers:** `WebhookEventsList`.
- **Imports significativos:** `@/hooks/api/useWebhooks`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-093 — Webhook metrics card

- **Path:** [apps/admin/components/webhooks/WebhookMetrics.tsx](apps/admin/components/webhooks/WebhookMetrics.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Webhook performance dashboard (success rate, processing time, per-provider).
- **Exports / endpoints / handlers:** `WebhookMetrics`.
- **Imports significativos:** `@/components/charts`.
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-094 — Webhook subscriptions panel

- **Path:** [apps/admin/components/webhooks/WebhookSubscriptions.tsx](apps/admin/components/webhooks/WebhookSubscriptions.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** CRUD for webhook subscriptions (URL, event types, provider, project picker).
- **Exports / endpoints / handlers:** `WebhookSubscriptions`.
- **Imports significativos:** `@/hooks/api/useWebhooks`.
- **API endpoints consumed:** Indirect; project picker calls `useProjectsForSubscriptionForm` → `GET /api/backend/projects` (does NOT exist in `apps/api/src/projects/projectRoutes.ts` for the admin surface).
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** PR-15 confirmed. Project selector is functionally broken (silent empty list). Either expose a cross-tenant `/admin/projects` endpoint, or drop the project association from admin webhook subscriptions.

#### audit-A-095 — Webhook timeline chart

- **Path:** [apps/admin/components/webhooks/WebhookTimeline.tsx](apps/admin/components/webhooks/WebhookTimeline.tsx)
- **Surface:** admin
- **Tipo:** component
- **Propósito real:** Real-time event-throughput chart with optional live SSE stream.
- **Exports / endpoints / handlers:** `WebhookTimeline`.
- **Imports significativos:** `@/components/charts`.
- **API endpoints consumed:** SSE (mentioned by JSDoc, not implemented inline here).
- **Veredicto preliminar:** UNKNOWN
- **Notas:** Component receives `data` as a prop — the SSE wiring is somewhere upstream. JSDoc says "real-time webhook event timeline chart that visualizes event throughput, success vs failure rates over time, with optional live-streaming via server-sent events"; couldn't verify the SSE endpoint without deeper trace.

### apps/admin/hooks/

#### audit-A-096 — useAccountBilling

- **Path:** [apps/admin/hooks/api/useAccountBilling.ts](apps/admin/hooks/api/useAccountBilling.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Fetches account billing breakdown.
- **Exports / endpoints / handlers:** `useAccountBilling(accountId)`, `BillingData`.
- **Imports significativos:** `@shared/types`, `@packages/api-errors`.
- **API endpoints consumed:** Raw fetch `/api/backend/admin/accounts/:id/billing`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-097 — useAccountSessions

- **Path:** [apps/admin/hooks/api/useAccountSessions.ts](apps/admin/hooks/api/useAccountSessions.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** List/revoke active sessions for a given account.
- **Exports / endpoints / handlers:** `useAccountSessions`, `useRevokeAccountSessions`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** Raw fetch `/api/backend/admin/accounts/:id/sessions`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-098 — useAccounts

- **Path:** [apps/admin/hooks/api/useAccounts.ts](apps/admin/hooks/api/useAccounts.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Account summary list + update mutation.
- **Exports / endpoints / handlers:** `useAccounts`, `useUpdateAccount`.
- **Imports significativos:** `../../lib/apiClient` (api.admin).
- **API endpoints consumed:** `/admin/accounts/summary`, `/admin/accounts/:id`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-099 — useAdminPasswordReset

- **Path:** [apps/admin/hooks/api/useAdminPasswordReset.ts](apps/admin/hooks/api/useAdminPasswordReset.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Trigger password-reset email for an admin user.
- **Exports / endpoints / handlers:** `useAdminPasswordReset`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `POST /api/backend/admin/users/:id/password-reset` — exists in `apps/api/src/admin/adminUserRoutes.ts`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-100 — useAdminUsers (barrel)

- **Path:** [apps/admin/hooks/api/useAdminUsers/index.ts](apps/admin/hooks/api/useAdminUsers/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports the admin-users hook submodule.
- **Exports / endpoints / handlers:** `useAdminUsers`, `useActivateAdminUser`, `useCreateAdminUser`, `useDeactivateAdminUser`, `useUpdateAdminUser`, `AdminUser`.
- **Imports significativos:** —
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-101 — useAdminUsers (api)

- **Path:** [apps/admin/hooks/api/useAdminUsers/api.ts](apps/admin/hooks/api/useAdminUsers/api.ts)
- **Surface:** admin
- **Tipo:** hook (helper module)
- **Propósito real:** Fetch helpers for `/admin/users/*`.
- **Exports / endpoints / handlers:** `fetchAdminUsers`, `createAdminUser`, `activateAdminUser`, `deactivateAdminUser`, `updateAdminUser`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/users`, `/admin/users/:id`, etc.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-102 — useAdminUsers (mutations)

- **Path:** [apps/admin/hooks/api/useAdminUsers/mutations.ts](apps/admin/hooks/api/useAdminUsers/mutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** TanStack mutation hooks wrapping the api.ts helpers.
- **Exports / endpoints / handlers:** `useCreateAdminUser`, `useActivateAdminUser`, `useDeactivateAdminUser`, `useUpdateAdminUser`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-103 — useAdminUsers (queries)

- **Path:** [apps/admin/hooks/api/useAdminUsers/queries.ts](apps/admin/hooks/api/useAdminUsers/queries.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Read-only hook for admin-user listing.
- **Exports / endpoints / handlers:** `useAdminUsers`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-104 — useAdminUsers (types)

- **Path:** [apps/admin/hooks/api/useAdminUsers/types.ts](apps/admin/hooks/api/useAdminUsers/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Public types for the admin-users hook.
- **Exports / endpoints / handlers:** `AdminUser`, `AdminUsersResponse`, `CreateAdminUserInput`, `CreateAdminUserResponse`, `UpdateAdminUserData`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-105 — useAnalytics

- **Path:** [apps/admin/hooks/api/useAnalytics.ts](apps/admin/hooks/api/useAnalytics.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Aggregates analytics + dashboard + billing endpoints into one summary.
- **Exports / endpoints / handlers:** `useAnalytics`, `AnalyticsSummary`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** `/admin/analytics`, `/admin/dashboard`, `/admin/billing/stats` (inferred).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-106 — useApiKeyAdminRotate

- **Path:** [apps/admin/hooks/api/useApiKeyAdminRotate.ts](apps/admin/hooks/api/useApiKeyAdminRotate.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Cross-tenant ApiKey rotation mutation.
- **Exports / endpoints / handlers:** `useApiKeyAdminRotate`.
- **Imports significativos:** `apiKeysAdminClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-107 — useAuditLogs

- **Path:** [apps/admin/hooks/api/useAuditLogs.ts](apps/admin/hooks/api/useAuditLogs.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Audit log list with filters + 30s polling.
- **Exports / endpoints / handlers:** `useAuditLogs`.
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** Indirect (`api.audit.getLogs`).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-108 — useAuditStats

- **Path:** [apps/admin/hooks/api/useAuditStats.ts](apps/admin/hooks/api/useAuditStats.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Aggregated audit-log stats (total/today/unique users/failure rate).
- **Exports / endpoints / handlers:** `useAuditStats`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** Raw fetch `/api/backend/admin/audit/stats`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-109 — useBillingStats

- **Path:** [apps/admin/hooks/api/useBillingStats.ts](apps/admin/hooks/api/useBillingStats.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** MRR + total revenue + active subscriptions.
- **Exports / endpoints / handlers:** `useBillingStats`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** Raw fetch `/api/backend/admin/billing/stats`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-110 — useChangePassword

- **Path:** [apps/admin/hooks/api/useChangePassword.ts](apps/admin/hooks/api/useChangePassword.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Admin user changes own password.
- **Exports / endpoints / handlers:** `useChangePassword`.
- **Imports significativos:** `@packages/ui` (toast), `@packages/api-errors`.
- **API endpoints consumed:** Raw fetch `POST /api/backend/admin/auth/password/change`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-111 — useChannelForceReauth

- **Path:** [apps/admin/hooks/api/useChannelForceReauth.ts](apps/admin/hooks/api/useChannelForceReauth.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Force channel re-auth mutation.
- **Exports / endpoints / handlers:** `useChannelForceReauth`.
- **Imports significativos:** `channelsAdminClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-112 — useCompliance submodule (barrel)

- **Path:** [apps/admin/hooks/api/useCompliance/index.ts](apps/admin/hooks/api/useCompliance/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports compliance hooks.
- **Exports / endpoints / handlers:** `useCompliance`, `useComplianceScore`, `useGdprSettings`, `useUpdateGdprSettings`, `useSecuritySettings`, etc.
- **Imports significativos:** —
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-113 — useCompliance (api)

- **Path:** [apps/admin/hooks/api/useCompliance/api.ts](apps/admin/hooks/api/useCompliance/api.ts)
- **Surface:** admin
- **Tipo:** hook (helper)
- **Propósito real:** Fetch helpers for compliance endpoints (metrics, GDPR/security settings, DSAR, breaches).
- **Exports / endpoints / handlers:** `fetchComplianceOverview`, `fetchComplianceScore`, etc.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/compliance/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-114 — useCompliance (mutations)

- **Path:** [apps/admin/hooks/api/useCompliance/mutations.ts](apps/admin/hooks/api/useCompliance/mutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Update GDPR/security settings, DSAR workflow, breach reports.
- **Exports / endpoints / handlers:** `useUpdateGdprSettings`, `useUpdateSecuritySettings`, `useAcknowledgeDsar`, `useCompleteDsar`, `useRejectDsar`, `useCreateBreachReport`, `useSendBreachNotification`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-115 — useCompliance (queries)

- **Path:** [apps/admin/hooks/api/useCompliance/queries.ts](apps/admin/hooks/api/useCompliance/queries.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Read-only compliance hooks (overview, score, GDPR, security, DSAR list, breaches).
- **Exports / endpoints / handlers:** `useCompliance`, `useComplianceScore`, `useGdprSettings`, `useSecuritySettings`, `useDsarRequests`, `useBreachReports`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-116 — useCompliance (types)

- **Path:** [apps/admin/hooks/api/useCompliance/types.ts](apps/admin/hooks/api/useCompliance/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Types for the compliance hook surface.
- **Exports / endpoints / handlers:** `BreachReport`, `CreateBreachInput`, `DsarRequest`, `GdprSettings`, `SecuritySettings`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-117 — useContentLibrary (dead)

- **Path:** [apps/admin/hooks/api/useContentLibrary.ts](apps/admin/hooks/api/useContentLibrary.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Lists posts via `/api/backend/posts` with pagination.
- **Exports / endpoints / handlers:** `useContentLibrary`, `UseContentLibraryOptions`, `ListPostsResponse`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** `GET /api/backend/posts`.
- **Veredicto preliminar:** DEAD
- **Notas:** No UI consumer in admin (only `tests/unit/hooks/useContentLibrary.test.tsx`). Looks like a leftover from the admin/client merger — the post-listing feature belongs to client. Drop both the hook and its test.

#### audit-A-118 — useDashboardStats

- **Path:** [apps/admin/hooks/api/useDashboardStats.ts](apps/admin/hooks/api/useDashboardStats.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Admin dashboard stats with auto-refresh.
- **Exports / endpoints / handlers:** `useDashboardStats`.
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** Indirect (`api.admin.getDashboardStats`).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-119 — useGatewaySwitches submodule (barrel)

- **Path:** [apps/admin/hooks/api/useGatewaySwitches/index.ts](apps/admin/hooks/api/useGatewaySwitches/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports gateway-switches hooks.
- **Exports / endpoints / handlers:** `useGatewaySwitches`, `useGatewaySwitchDetail`, `useExtendSwitchDeadline`, `useForceCompleteSwitch`, `useForceSuspendSwitch`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-120 — useGatewaySwitches (api)

- **Path:** [apps/admin/hooks/api/useGatewaySwitches/api.ts](apps/admin/hooks/api/useGatewaySwitches/api.ts)
- **Surface:** admin
- **Tipo:** hook (helper)
- **Propósito real:** Fetch helpers for gateway-switches.
- **Exports / endpoints / handlers:** `fetchGatewaySwitches`, `fetchGatewaySwitchDetail`, `extendSwitchDeadline`, `forceCompleteSwitch`, `forceSuspendSwitch`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/billing/gateway-switches/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-121 — useGatewaySwitches (mutations)

- **Path:** [apps/admin/hooks/api/useGatewaySwitches/mutations.ts](apps/admin/hooks/api/useGatewaySwitches/mutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Admin actions on gateway-switch events.
- **Exports / endpoints / handlers:** `useExtendSwitchDeadline`, `useForceCompleteSwitch`, `useForceSuspendSwitch`.
- **Imports significativos:** `@packages/ui`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-122 — useGatewaySwitches (queries)

- **Path:** [apps/admin/hooks/api/useGatewaySwitches/queries.ts](apps/admin/hooks/api/useGatewaySwitches/queries.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Read-only hooks for the gateway-switch listing.
- **Exports / endpoints / handlers:** `useGatewaySwitches`, `useGatewaySwitchDetail`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-123 — useGatewaySwitches (types)

- **Path:** [apps/admin/hooks/api/useGatewaySwitches/types.ts](apps/admin/hooks/api/useGatewaySwitches/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Types for gateway-switch hook submodule.
- **Exports / endpoints / handlers:** `GatewaySwitchEvent`, `GatewaySwitchListData`, `GatewaySwitchFilters`, etc.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-124 — useMultiPlatformScheduling (dead)

- **Path:** [apps/admin/hooks/api/useMultiPlatformScheduling.ts](apps/admin/hooks/api/useMultiPlatformScheduling.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Multi-platform scheduling: list slots, optimal times, rules, create slot single/bulk.
- **Exports / endpoints / handlers:** `useScheduleSlots`, `useOptimalTimes`, `useSchedulingRules`, `useCreateSlot`, `useBulkCreateSlots`.
- **Imports significativos:** `@/types/multi-platform-scheduling`.
- **API endpoints consumed:** `/api/backend/scheduling/slots`, `/api/backend/analytics/optimal-times`, `/api/backend/scheduling/rules`. The endpoints exist in `apps/api/src/scheduling/schedulingClientRoutes.ts` but they are CLIENT-tenant routes, not admin cross-tenant.
- **Veredicto preliminar:** DEAD
- **Notas:** No UI caller in admin (only `tests/unit/hooks/useMultiPlatformScheduling.test.tsx`). Belongs to the client surface; leftover from the merger.

#### audit-A-125 — useOidcReplaceClientSecret

- **Path:** [apps/admin/hooks/api/useOidcReplaceClientSecret.ts](apps/admin/hooks/api/useOidcReplaceClientSecret.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** OIDC client-secret replace mutation.
- **Exports / endpoints / handlers:** `useOidcReplaceClientSecret`.
- **Imports significativos:** `oidcAdminClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-126 — usePerformanceInsights (dead)

- **Path:** [apps/admin/hooks/api/usePerformanceInsights.ts](apps/admin/hooks/api/usePerformanceInsights.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Performance-insights view (engagement, time series, top posts, optimal timing, hashtags).
- **Exports / endpoints / handlers:** `usePerformanceInsights`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** `/api/backend/admin/analytics/overview?projectId=...` (route exists in `apps/api/src/admin/analyticsRoutes.ts` — but no UI caller).
- **Veredicto preliminar:** DEAD
- **Notas:** No caller in app/ or components/. Either wire to a dashboard page or remove.

#### audit-A-127 — usePosts (dead)

- **Path:** [apps/admin/hooks/api/usePosts.ts](apps/admin/hooks/api/usePosts.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Lists/creates/deletes posts via `api.listPosts/createPost/deletePost`.
- **Exports / endpoints / handlers:** `usePosts`, `useCreatePost`, `useDeletePost`.
- **Imports significativos:** `@/lib/apiClient`.
- **API endpoints consumed:** `/posts` via `postsClient`.
- **Veredicto preliminar:** DEAD
- **Notas:** Zero UI callers in admin (only `tests/`). Leftover from the merger — posts are a client-app concept.

#### audit-A-128 — usePricingTiers submodule (barrel)

- **Path:** [apps/admin/hooks/api/usePricingTiers/index.ts](apps/admin/hooks/api/usePricingTiers/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports pricing-tiers hooks.
- **Exports / endpoints / handlers:** `usePricingTiers`, `useCreateAccountTier`, `useCreateBundle`, `useCreateProviderTier`, `useUpdateAccountTier`, `useUpdateBundle`, `useUpdateProviderTier`, `useDeleteBundle`, `useToggleTierStatus`.
- **Imports significativos:** —
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-129 — usePricingTiers (api)

- **Path:** [apps/admin/hooks/api/usePricingTiers/api.ts](apps/admin/hooks/api/usePricingTiers/api.ts)
- **Surface:** admin
- **Tipo:** hook (helper)
- **Propósito real:** Fetch helpers for pricing-tier admin endpoints.
- **Exports / endpoints / handlers:** `fetchPricingTiers`, `createAccountTier`, `createBundle`, `createProviderTier`, etc.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/pricing/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-130 — usePricingTiers (mutations)

- **Path:** [apps/admin/hooks/api/usePricingTiers/mutations.ts](apps/admin/hooks/api/usePricingTiers/mutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Create/update/delete/toggle pricing tiers and bundles.
- **Exports / endpoints / handlers:** Mutation hooks.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-131 — usePricingTiers (queries)

- **Path:** [apps/admin/hooks/api/usePricingTiers/queries.ts](apps/admin/hooks/api/usePricingTiers/queries.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Read-only pricing-tiers fetch.
- **Exports / endpoints / handlers:** `usePricingTiers`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-132 — usePricingTiers (types)

- **Path:** [apps/admin/hooks/api/usePricingTiers/types.ts](apps/admin/hooks/api/usePricingTiers/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Types for pricing-tier hooks.
- **Exports / endpoints / handlers:** `AccountTier`, `PricingBundle`, `ProviderTier`, `CreateAccountTierInput`, `CreateBundleInput`, `CreateProviderTierInput`, `TierType`, `PricingData`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-133 — useProviderForceMassReauth

- **Path:** [apps/admin/hooks/api/useProviderForceMassReauth.ts](apps/admin/hooks/api/useProviderForceMassReauth.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Cross-tenant mass-force-reauth mutation.
- **Exports / endpoints / handlers:** `useProviderForceMassReauth`.
- **Imports significativos:** `providersAdminClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-134 — useQueueManagement

- **Path:** [apps/admin/hooks/api/useQueueManagement.ts](apps/admin/hooks/api/useQueueManagement.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Queue stats + failed jobs + retry mutation for the maintenance page.
- **Exports / endpoints / handlers:** `useQueueStats`, `useFailedJobs`, `useRetryJob`, `QueueStats`, `FailedJob`.
- **Imports significativos:** `@packages/ui`, `@packages/api-errors`.
- **API endpoints consumed:** `/admin/queues/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-135 — useResetAccountPassword

- **Path:** [apps/admin/hooks/api/useResetAccountPassword.ts](apps/admin/hooks/api/useResetAccountPassword.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Reset customer account password (admin action).
- **Exports / endpoints / handlers:** `useResetAccountPassword`.
- **Imports significativos:** `@packages/ui`, `@packages/api-errors`.
- **API endpoints consumed:** `/admin/accounts/:id/reset-password` (inferred).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-136 — useSecretRotationStatus

- **Path:** [apps/admin/hooks/api/useSecretRotationStatus.ts](apps/admin/hooks/api/useSecretRotationStatus.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Secret rotation status list.
- **Exports / endpoints / handlers:** `useSecretRotationStatus`, `SecretRotationStatusDTO` (type re-export).
- **Imports significativos:** `secretsClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-137 — useSecurity

- **Path:** [apps/admin/hooks/api/useSecurity.ts](apps/admin/hooks/api/useSecurity.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Security overview = stats + MFA adoption + RBAC hierarchy.
- **Exports / endpoints / handlers:** `useSecurityOverview`.
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-138 — useSettings submodule (barrel)

- **Path:** [apps/admin/hooks/api/useSettings/index.ts](apps/admin/hooks/api/useSettings/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports platform-settings hooks.
- **Exports / endpoints / handlers:** `useGroupSettings`, `useSettingsStatus`, `useUpdateGroupSettings`, `useDeleteCredential`, `useTestConnection`, `useRotateEncryption`.
- **Imports significativos:** —
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-139 — useSettings (api)

- **Path:** [apps/admin/hooks/api/useSettings/api.ts](apps/admin/hooks/api/useSettings/api.ts)
- **Surface:** admin
- **Tipo:** hook (helper)
- **Propósito real:** Fetch helpers for `/admin/settings/*`.
- **Exports / endpoints / handlers:** `fetchGroupSettings`, `fetchSettingsStatus`, `updateGroupSettings`, `deleteCredential`, `testConnection`, `rotateEncryption`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/settings/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-140 — useSettings (mutations)

- **Path:** [apps/admin/hooks/api/useSettings/mutations.ts](apps/admin/hooks/api/useSettings/mutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Update/delete credentials, test connection, rotate encryption.
- **Exports / endpoints / handlers:** `useUpdateGroupSettings`, `useDeleteCredential`, `useTestConnection`, `useRotateEncryption`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-141 — useSettings (queries)

- **Path:** [apps/admin/hooks/api/useSettings/queries.ts](apps/admin/hooks/api/useSettings/queries.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Read-only fetch hooks.
- **Exports / endpoints / handlers:** `useGroupSettings`, `useSettingsStatus`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-142 — useSettings (types)

- **Path:** [apps/admin/hooks/api/useSettings/types.ts](apps/admin/hooks/api/useSettings/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Types for the settings hook submodule.
- **Exports / endpoints / handlers:** `SettingsStatus`, `TestResult`, `GroupCredentials`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-143 — useSubscriptionMutations

- **Path:** [apps/admin/hooks/api/useSubscriptionMutations.ts](apps/admin/hooks/api/useSubscriptionMutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Start/end/convert trial mutations.
- **Exports / endpoints / handlers:** `useStartTrial`, `useEndTrial`, `useConvertTrial`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/subscriptions/*` (raw fetch likely).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-144 — useSubscriptions

- **Path:** [apps/admin/hooks/api/useSubscriptions.ts](apps/admin/hooks/api/useSubscriptions.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Subscription summary list for the admin /subscriptions page.
- **Exports / endpoints / handlers:** `useSubscriptions`.
- **Imports significativos:** `../../lib/apiClient`.
- **API endpoints consumed:** `api.admin.getSubscriptionSummary` → `/admin/subscriptions/summary`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer`.

#### audit-A-145 — useUniversalAnalytics (dead)

- **Path:** [apps/admin/hooks/api/useUniversalAnalytics.ts](apps/admin/hooks/api/useUniversalAnalytics.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Unified per-project analytics dashboard data.
- **Exports / endpoints / handlers:** `useUniversalAnalytics`, plus several interfaces.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** `/api/backend/dashboard?...` — a non-admin client endpoint shape.
- **Veredicto preliminar:** DEAD
- **Notas:** No UI caller. Same legacy origin as `useContentLibrary`/`useMultiPlatformScheduling`.

#### audit-A-146 — useUsageMetrics

- **Path:** [apps/admin/hooks/api/useUsageMetrics.ts](apps/admin/hooks/api/useUsageMetrics.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Account usage metrics (posts/AI/storage/team) per billing period.
- **Exports / endpoints / handlers:** `useUsageMetrics`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/accounts/:id/usage` (raw fetch).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-147 — useWebhookRotateSecret

- **Path:** [apps/admin/hooks/api/useWebhookRotateSecret.ts](apps/admin/hooks/api/useWebhookRotateSecret.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Webhook secret rotation mutation (with grace window).
- **Exports / endpoints / handlers:** `useWebhookRotateSecret`.
- **Imports significativos:** `webhooksAdminClient`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-148 — useWebhooks submodule (barrel)

- **Path:** [apps/admin/hooks/api/useWebhooks/index.ts](apps/admin/hooks/api/useWebhooks/index.ts)
- **Surface:** admin
- **Tipo:** barrel
- **Propósito real:** Re-exports webhook dashboard hooks.
- **Exports / endpoints / handlers:** `useDlqMetrics`, `useOutboxDeadLetter`, `useProjectsForSubscriptionForm`, `useWebhookDeadLetterEvents`, `useWebhookMetrics`, `useWebhookEvents`, `useWebhookSubscriptions`, ...
- **Imports significativos:** —
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Re-exports the broken `useProjectsForSubscriptionForm` (see audit-A-150).

#### audit-A-149 — useWebhooks (api)

- **Path:** [apps/admin/hooks/api/useWebhooks/api.ts](apps/admin/hooks/api/useWebhooks/api.ts)
- **Surface:** admin
- **Tipo:** hook (helper)
- **Propósito real:** Fetch helpers for the webhook dashboard endpoints; includes the broken `fetchProjectsForSubscriptionForm` (`/api/backend/projects`).
- **Exports / endpoints / handlers:** Many `fetch*` helpers.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** `/admin/webhooks/*`, plus `/api/backend/projects` (does not exist) — JSDoc already admits "route `GET /api/backend/projects` does not currently exist."
- **Veredicto preliminar:** MISMATCH
- **Notas:** Self-acknowledged orphan endpoint. Either expose `/admin/projects` cross-tenant or remove the project filter from subscriptions.

#### audit-A-150 — useWebhooks (queries)

- **Path:** [apps/admin/hooks/api/useWebhooks/queries.ts](apps/admin/hooks/api/useWebhooks/queries.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Read-only hooks for webhook dashboard; defines `useProjectsForSubscriptionForm`.
- **Exports / endpoints / handlers:** `useDlqMetrics`, `useWebhookMetrics`, `useWebhookEvents`, `useWebhookSubscriptions`, `useProjectsForSubscriptionForm`, `useWebhookEventDetail`, `useWebhookDeadLetterEvents`, `useOutboxDeadLetter`.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-151 — useWebhooks (mutations)

- **Path:** [apps/admin/hooks/api/useWebhooks/mutations.ts](apps/admin/hooks/api/useWebhooks/mutations.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** CRUD + retry mutations for subscriptions, events DLQ, outbox DLQ.
- **Exports / endpoints / handlers:** Mutation hooks for subscriptions + DLQ + export.
- **Imports significativos:** `@tanstack/react-query`.
- **API endpoints consumed:** Indirect.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-152 — useWebhooks (types)

- **Path:** [apps/admin/hooks/api/useWebhooks/types.ts](apps/admin/hooks/api/useWebhooks/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Types for the webhook dashboard hook surface.
- **Exports / endpoints / handlers:** Many types.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-153 — useChartColors

- **Path:** [apps/admin/hooks/useChartColors.ts](apps/admin/hooks/useChartColors.ts)
- **Surface:** admin
- **Tipo:** hook
- **Propósito real:** Resolves CSS custom properties (color tokens) to concrete values for Recharts SVG attributes; re-runs when theme changes.
- **Exports / endpoints / handlers:** `useChartColors`, `ChartColors`.
- **Imports significativos:** `@/providers/ThemeProvider`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

### apps/admin/i18n/

#### audit-A-154 — next-intl request config

- **Path:** [apps/admin/i18n/request.ts](apps/admin/i18n/request.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** next-intl `getRequestConfig` — picks locale from `NEXT_LOCALE` cookie or Accept-Language.
- **Exports / endpoints / handlers:** Default `getRequestConfig`.
- **Imports significativos:** `next-intl/server`, `next/headers`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

### apps/admin/lib/

#### audit-A-155 — apiKeysAdminClient

- **Path:** [apps/admin/lib/api/clients/apiKeysAdminClient.ts](apps/admin/lib/api/clients/apiKeysAdminClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Admin client for cross-tenant ApiKey rotation.
- **Exports / endpoints / handlers:** `apiKeysAdminClient.rotate`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `POST /admin/security/api-keys/:id/rotate`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-156 — auditClient

- **Path:** [apps/admin/lib/api/clients/auditClient.ts](apps/admin/lib/api/clients/auditClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Audit log list + stats client.
- **Exports / endpoints / handlers:** `auditClient.getLogs`, `auditClient.getStats`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `/admin/audit/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-157 — authClient

- **Path:** [apps/admin/lib/api/clients/authClient.ts](apps/admin/lib/api/clients/authClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Raw `/admin/auth/login` for legacy paths bypassing the Server Action.
- **Exports / endpoints / handlers:** `authClient.login`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `POST /admin/auth/login`.
- **Veredicto preliminar:** UNKNOWN
- **Notas:** Most login goes via the Server Action — verify no consumer still imports this raw client. If unused, mark DEAD.

#### audit-A-158 — channelsAdminClient

- **Path:** [apps/admin/lib/api/clients/channelsAdminClient.ts](apps/admin/lib/api/clients/channelsAdminClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Admin force-channel-reauth client.
- **Exports / endpoints / handlers:** `channelsAdminClient.forceReauth`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `POST /admin/channels/:id/force-reauth`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-159 — dashboardClient

- **Path:** [apps/admin/lib/api/clients/dashboardClient.ts](apps/admin/lib/api/clients/dashboardClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Dashboard + accounts + subscriptions endpoints used by the dashboard, accounts, and subscriptions pages.
- **Exports / endpoints / handlers:** `dashboardClient.getDashboardStats`, `.getAccountSummary`, `.getAccountList`, `.getAccountProject`, `.updateAccount`, `.getSubscriptionSummary`.
- **Imports significativos:** `./http`, `../types`.
- **API endpoints consumed:** `/admin/dashboard`, `/admin/accounts*`, `/admin/subscriptions*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-160 — healthClient

- **Path:** [apps/admin/lib/api/clients/healthClient.ts](apps/admin/lib/api/clients/healthClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Backend `/health` ping via admin proxy.
- **Exports / endpoints / handlers:** `healthClient.health`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `GET /health`.
- **Veredicto preliminar:** UNKNOWN
- **Notas:** Couldn't confirm a UI caller in admin (no `/maintenance` health badge that maps directly). Possibly dead; verify before deletion.

#### audit-A-161 — http transport

- **Path:** [apps/admin/lib/api/clients/http.ts](apps/admin/lib/api/clients/http.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Shared `fetch` wrapper that prepends `/api/backend`, sends credentials, unwraps the `{ok, data}` envelope, and throws structured `ApiError`s.
- **Exports / endpoints / handlers:** `http<T>(path, init)`.
- **Imports significativos:** `@packages/api-errors`.
- **API endpoints consumed:** All (transport-level).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Critical.

#### audit-A-162 — mfaClient

- **Path:** [apps/admin/lib/api/clients/mfaClient.ts](apps/admin/lib/api/clients/mfaClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Self-service + admin-only MFA endpoints.
- **Exports / endpoints / handlers:** `mfaClient.setup`, `.verify`, `.disable`, `.regenerateBackupCodes`, `.getUserStatus`, `.forceDisable`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `/admin/mfa/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-163 — oidcAdminClient

- **Path:** [apps/admin/lib/api/clients/oidcAdminClient.ts](apps/admin/lib/api/clients/oidcAdminClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** OIDC client-secret replace (with discovery handshake).
- **Exports / endpoints / handlers:** `oidcAdminClient.replaceClientSecret`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `POST /admin/security/oidc/replace-client-secret`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-164 — postsClient (dead)

- **Path:** [apps/admin/lib/api/clients/postsClient.ts](apps/admin/lib/api/clients/postsClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Legacy posts endpoints (list/read/create/publish/delete/listLogs).
- **Exports / endpoints / handlers:** `postsClient.{listPosts, readPost, createPost, publishPost, deletePost, listLogs}`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `/posts/*`.
- **Veredicto preliminar:** DEAD
- **Notas:** Exposed through `api` facade but the only callers (`usePosts`) are themselves dead. Delete chain: `postsClient` → `usePosts` → `useContentLibrary`. JSDoc already self-flags as legacy.

#### audit-A-165 — providersAdminClient

- **Path:** [apps/admin/lib/api/clients/providersAdminClient.ts](apps/admin/lib/api/clients/providersAdminClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Cross-tenant provider mass-force-reauth.
- **Exports / endpoints / handlers:** `providersAdminClient.forceMassReauth`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `POST /admin/security/providers/:provider/force-mass-reauth`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-166 — rbacClient

- **Path:** [apps/admin/lib/api/clients/rbacClient.ts](apps/admin/lib/api/clients/rbacClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** RBAC roles + permissions + hierarchy + stats endpoints.
- **Exports / endpoints / handlers:** `rbacClient.{getPermissions, getRoles, getRole, getUsersByRole, updateUserRole, assignPermission, revokePermission, createRole, updateRole, setRolePermissions, deleteRole, checkPermissions, getHierarchy, getStatus}`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `/admin/security/rbac/*`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-167 — secretsClient

- **Path:** [apps/admin/lib/api/clients/secretsClient.ts](apps/admin/lib/api/clients/secretsClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Secret rotation status list.
- **Exports / endpoints / handlers:** `secretsClient.getRotationStatus`, `SecretRotationStatusDTO`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `GET /admin/security/secrets/rotation-status`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-168 — webhooksAdminClient

- **Path:** [apps/admin/lib/api/clients/webhooksAdminClient.ts](apps/admin/lib/api/clients/webhooksAdminClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Webhook subscription rotate-secret client.
- **Exports / endpoints / handlers:** `webhooksAdminClient.rotateSecret`.
- **Imports significativos:** `./http`.
- **API endpoints consumed:** `POST /admin/security/webhooks/:id/rotate-secret`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-169 — apiClient facade

- **Path:** [apps/admin/lib/apiClient.ts](apps/admin/lib/apiClient.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Composes per-domain clients into the single `api` object used across the admin app.
- **Exports / endpoints / handlers:** `api` (with `.admin`, `.audit`, `.security.*`, `.listPosts`, etc.), plus type re-exports.
- **Imports significativos:** All `lib/api/clients/*`.
- **API endpoints consumed:** All admin endpoints.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Re-exports `postsClient` methods that are DEAD (`api.listPosts`, `api.createPost`, `api.deletePost`, `api.listLogs`). Drop those entries when removing `postsClient`.

#### audit-A-170 — api types

- **Path:** [apps/admin/lib/api/types.ts](apps/admin/lib/api/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Shared types for the admin API surface — dashboard, accounts, subscriptions, audit, MFA, RBAC.
- **Exports / endpoints / handlers:** Many types.
- **Imports significativos:** `@shared/types`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-171 — Backend client (server-only)

- **Path:** [apps/admin/lib/auth/backend-client.ts](apps/admin/lib/auth/backend-client.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Server-side proxy fns for admin auth flows: authenticate, verify token, refresh, logout, health.
- **Exports / endpoints / handlers:** `authenticateAdmin`, `verifyAccessToken`, `refreshAccessToken`, `logoutFromBackend`, `healthCheck`.
- **Imports significativos:** `@observability/browser-logger`, `../../lib/env`.
- **API endpoints consumed:** `POST /admin/auth/login`, `POST /admin/auth/refresh`, `GET /admin/auth/me`, `POST /admin/auth/logout`, `GET /health`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Server-only module. Critical.

#### audit-A-172 — Session cookie helpers (server-only)

- **Path:** [apps/admin/lib/auth/sessionCookie.ts](apps/admin/lib/auth/sessionCookie.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Single source of truth for admin auth-cookie lifecycle (names, TTLs, set/clear helpers).
- **Exports / endpoints / handlers:** `SESSION_COOKIE_NAME`, `REFRESH_COOKIE_NAME`, `CSRF_COOKIE_NAME`, `setAuthTokens`, `setSessionCookie`, `clearAuthCookies`.
- **Imports significativos:** `next/headers`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-173 — Auth types

- **Path:** [apps/admin/lib/auth/types.ts](apps/admin/lib/auth/types.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Types for admin auth (`AdminUserProfile`, `TokenPair`, `AuthenticateAdminResult`, `AdminAuthState`).
- **Exports / endpoints / handlers:** Several types.
- **Imports significativos:** `@shared/types`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-174 — Typed env

- **Path:** [apps/admin/lib/env.ts](apps/admin/lib/env.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Zod-validated env constant via `@t3-oss/env-nextjs` enforcing server/client split.
- **Exports / endpoints / handlers:** `env` constant.
- **Imports significativos:** `@t3-oss/env-nextjs`, `zod`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-175 — notificationStore (Zustand, dead)

- **Path:** [apps/admin/lib/stores/notificationStore.ts](apps/admin/lib/stores/notificationStore.ts)
- **Surface:** admin
- **Tipo:** store
- **Propósito real:** Zustand store for in-app notifications (unread count + list + SSE status).
- **Exports / endpoints / handlers:** `useNotificationStore`, `NotificationItem`.
- **Imports significativos:** `zustand`.
- **API endpoints consumed:** None.
- **Veredicto preliminar:** REDUNDANTE
- **Notas:** No UI caller in admin (only its own test). Near-twin exists in `apps/client/lib/stores/notificationStore.ts` — appears to be a duplicate inherited from the merger. Admin has no notification bell/SSE wiring; either build the UI or remove the store (and the test).

#### audit-A-176 — Tailwind safelist

- **Path:** [apps/admin/lib/ui-safelist.ts](apps/admin/lib/ui-safelist.ts)
- **Surface:** admin
- **Tipo:** lib
- **Propósito real:** Tailwind v4 `@source` workaround — declares every utility used by `@packages/ui` classes so the scanner generates them.
- **Exports / endpoints / handlers:** Several `_*` named exports of class strings.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Header missing `@layer` (file ends just after `@description`). Fitness #10 trip — minor. Also a candidate for `packages/ui` (admin + client both need it).

### apps/admin/providers/

#### audit-A-177 — AuthProvider

- **Path:** [apps/admin/providers/AuthProvider.tsx](apps/admin/providers/AuthProvider.tsx)
- **Surface:** admin
- **Tipo:** provider
- **Propósito real:** React context exposing current admin user (name/role/permissions). Fetches permissions on mount, caches, exposes `hasPermission()`.
- **Exports / endpoints / handlers:** `AuthProvider`, `useCurrentUser`, `useHasPermission` (likely).
- **Imports significativos:** `@observability/browser-logger`.
- **API endpoints consumed:** `/api/backend/admin/security/rbac/users/:id/permissions` (inferred).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Used by dashboard layout + several pages.

#### audit-A-178 — QueryProvider

- **Path:** [apps/admin/providers/QueryProvider.tsx](apps/admin/providers/QueryProvider.tsx)
- **Surface:** admin
- **Tipo:** provider
- **Propósito real:** TanStack QueryClient provider; uses `createAppQueryClient` from `@packages/query-client` so admin + client share defaults + global error handler.
- **Exports / endpoints / handlers:** `QueryProvider`.
- **Imports significativos:** `@tanstack/react-query`, `@packages/ui`, `@observability/browser-logger`, `@packages/query-client`.
- **API endpoints consumed:** None directly.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-A-179 — ThemeProvider

- **Path:** [apps/admin/providers/ThemeProvider.tsx](apps/admin/providers/ThemeProvider.tsx)
- **Surface:** admin
- **Tipo:** provider
- **Propósito real:** Dark/light theme toggle persisted to localStorage, applied as class on `<html>`. Default: dark.
- **Exports / endpoints / handlers:** `ThemeProvider`, `useTheme`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

### apps/admin/types/

#### audit-A-180 — Multi-platform scheduling types (dead)

- **Path:** [apps/admin/types/multi-platform-scheduling.ts](apps/admin/types/multi-platform-scheduling.ts)
- **Surface:** admin
- **Tipo:** types
- **Propósito real:** Type definitions for the multi-platform scheduling hook (`useMultiPlatformScheduling`).
- **Exports / endpoints / handlers:** `AvailableSlot`, `OptimalTime`, `SchedulingRule`, `CreatedSlot`, `CreateScheduleInput`, `BulkCreateScheduleInput`.
- **Imports significativos:** —
- **API endpoints consumed:** None.
- **Veredicto preliminar:** DEAD
- **Notas:** Only imported by the dead `useMultiPlatformScheduling.ts`. Delete with that hook.

## Cross-surface signals

### Likely duplicates with apps/client/

- `apps/admin/components/shared/LoadingSpinner.tsx` vs `apps/client/components/shared/LoadingSpinner.tsx` — near-identical accessible spinner. Hoist to `packages/ui`.
- `apps/admin/lib/stores/notificationStore.ts` vs `apps/client/lib/stores/notificationStore.ts` — Zustand store duplicated post-merger. Admin's copy has no UI consumer; client's may. Either share via `packages/ui` (state-store package) or delete admin's.
- `apps/admin/lib/auth/sessionCookie.ts` vs `apps/client/lib/auth/sessionCookie.ts` — both apps split out the cookie helpers separately. Worth comparing in detail to share constants (`SESSION_COOKIE_NAME` etc.) via shared package if names differ only by `admin-`/`client-` prefix.
- `apps/admin/components/ui/{Badge, ActionButton, DataTable, Pagination, StatCard, TabNav, PageHeader}.tsx` overlap conceptually with `@packages/ui` primitives. Admin has its own bespoke versions; client may use `@packages/ui` directly. Worth a horizontal pass to either standardize on `@packages/ui` or hoist admin's variants there.

### Likely forgotten features (endpoint missing)

- `useProjectsForSubscriptionForm` (`apps/admin/hooks/api/useWebhooks/api.ts`) → fetches `GET /api/backend/projects` which does not exist as an admin endpoint. Used by `WebhookSubscriptions.tsx` project picker — silently empty in production. (PR-15.)

### Stale endpoint references (non-existent routes)

- `GET /api/backend/projects` — referenced by `apps/admin/hooks/api/useWebhooks/api.ts` (line 92); JSDoc self-acknowledges absence. No matching route in `apps/api/src/projects/projectRoutes.ts` (which mounts under `/projects` but requires a client tenant context — admin scope was never wired).
- `GET /api/backend/scheduling/slots`, `/api/backend/scheduling/rules`, `/api/backend/analytics/optimal-times`, `POST /api/backend/scheduling/slots[/bulk]` — referenced by `apps/admin/hooks/api/useMultiPlatformScheduling.ts`. The backend routes exist (`apps/api/src/scheduling/schedulingClientRoutes.ts`) but are CLIENT-tenant only; admin should not be calling them directly. Symptom of the merger: admin inherited a client-app hook. The hook is DEAD anyway (no UI caller).
- `GET /api/backend/posts` — referenced by `apps/admin/hooks/api/useContentLibrary.ts`. The post routes exist for the client tenant. Same merger-leftover signature. Hook DEAD.
- `GET /api/backend/dashboard` — referenced by `apps/admin/hooks/api/useUniversalAnalytics.ts`. This is a client-app endpoint name, not the admin's `/admin/dashboard`. Hook DEAD.
- `GET /api/backend/admin/analytics/overview` — referenced by `apps/admin/hooks/api/usePerformanceInsights.ts`. The route exists in `apps/api/src/admin/analyticsRoutes.ts` BUT no UI caller — the feature was wired half-way and never reached the dashboard. Could be quickly resurrected by mounting a new page, or removed.

## Methodology + caveats

- Each file was read with `head -25` to capture the JSDoc header and the first import block; for files where the purpose wasn't obvious from the head, the head was extended to ~50 lines. No deep dives.
- Veredicto rules: (1) DEAD = symbol exported but `grep -rn "<name>" apps/admin/{app,components,hooks,lib,stores}` returned zero non-test hits; (2) REDUNDANTE = a near-twin filename or near-identical purpose found at the same relative path under `apps/client/`; (3) FORGOTTEN-FEATURE / MISMATCH = the file references a backend route that does not exist in `apps/api/src/**Routes.ts`, or the JSDoc itself admits it is broken; (4) UNKNOWN = couldn't confirm callers/endpoints in the time budget; needs Edward's confirmation before deletion.
- Cross-app comparisons were structural only (`ls apps/client/<path>`), not a full text diff. Edward should run `diff -r` between any flagged pair before consolidation.
- Endpoint existence was verified by `grep` against `apps/api/src/**/*Routes.ts` only — Fastify dynamic prefixes (e.g. routes registered via `register(prefix, ...)`) may shift the on-the-wire path. False-negative risk: a route may exist but mounted under a different prefix than expected. Manual confirmation is warranted for every FORGOTTEN-FEATURE / MISMATCH veredicto.
- JSDoc compliance: I noted several files whose `@file` header lacks `@layer` (or has `@layer` outside the canonical set), particularly under `app/` (layouts, error/loading/not-found). These are CI fitness #9/#10 candidates but were not modified — flagged for the audit.
- The `apps/admin/components/queue/useQueueManager.tsx` file is a hook misclassified as a component by directory — kept the "hook" tipo to match its actual nature.
- No `middleware.ts` exists at `apps/admin/middleware.ts`. Per scope, that's a confirmed absence rather than an oversight.
- No `Sprint`/`Phase`/`T0-A` references found in admin source — fitness #8 clean.
