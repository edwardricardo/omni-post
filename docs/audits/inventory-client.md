---
title: Client app inventory — full-repo audit input
description: File-by-file inventory of apps/client/ surface for cross-reference with API endpoints + admin counterparts.
generated: 2026-05-10
auditor: claude-code
---

# Client app inventory

> Surface: `apps/client/`. 226 files inventoried (scope: `app/`, `components/`,
> `hooks/`, `lib/`, `providers/`, `types/`). Cross-referenced with apps/admin/
> for duplication detection and against apps/api/src route table for endpoint
> validity. Out of scope (and excluded): `tests/`, `.storybook/`, `sentry.*.config.ts`,
> `next-env.d.ts`, `proxy.ts`, `vitest.config.ts`, `lib/api/__tests__/setup.ts`.
> Veredictos preliminares: VÁLIDO=215, REDUNDANTE=2, DEAD=0, FORGOTTEN-FEATURE=6,
> MISMATCH=3, UNKNOWN=0.

## Summary by Tipo

| Tipo          |   Count |  VÁLIDO | REDUNDANTE |  DEAD | FORGOTTEN-FEATURE | MISMATCH | UNKNOWN |
| ------------- | ------: | ------: | ---------: | ----: | ----------------: | -------: | ------: |
| page          |      44 |      41 |          0 |     0 |                 2 |        1 |       0 |
| layout        |       1 |       1 |          0 |     0 |                 0 |        0 |       0 |
| route-handler |       1 |       1 |          0 |     0 |                 0 |        0 |       0 |
| server-action |       1 |       1 |          0 |     0 |                 0 |        0 |       0 |
| component     |     124 |     119 |          0 |     0 |                 4 |        1 |       0 |
| hook          |      36 |      34 |          0 |     0 |                 0 |        2 |       0 |
| lib           |      33 |      31 |          2 |     0 |                 0 |        0 |       0 |
| store         |       1 |       1 |          0 |     0 |                 0 |        0 |       0 |
| provider      |       2 |       2 |          0 |     0 |                 0 |        0 |       0 |
| types         |       8 |       8 |          0 |     0 |                 0 |        0 |       0 |
| barrel        |      15 |      15 |          0 |     0 |                 0 |        0 |       0 |
| error-page    |       2 |       2 |          0 |     0 |                 0 |        0 |       0 |
| not-found     |       1 |       1 |          0 |     0 |                 0 |        0 |       0 |
| **Total**     | **226** | **215** |      **2** | **0** |             **6** |    **3** |   **0** |

Sub-folders counted under their primary tipo: hook submodules (`api.ts`/`queries.ts`/`mutations.ts`/`types.ts` under `hooks/api/use*/`) are counted as **hook**; `index.ts` re-exporters as **barrel**; `*.types.ts` standalone modules as **types**.

## By directory

### apps/client/app/ (entry, actions, proxy, root layouts)

#### audit-C-001 — Customer login + register Server Actions

- **Path:** [apps/client/app/actions/auth.ts](apps/client/app/actions/auth.ts)
- **Surface:** client
- **Tipo:** server-action
- **Propósito real:** Server Actions `loginAction` and `registerAction` for customer authentication. Both delegate cookie writes to `lib/auth/sessionCookie` and call the backend `/auth/customer/*` endpoints via `env.API_URL`.
- **Exports / endpoints / handlers:** `loginAction(prevState, formData)`, `registerAction(prevState, formData)`, `AuthActionState`.
- **Imports significativos:** `next/navigation`, `@observability/browser-logger`, `@/lib/auth/sessionCookie`, `../../lib/env`.
- **API endpoints consumed:** `POST /auth/customer/login`, `POST /auth/customer/register` (both exist in api routes).
- **Admin counterpart?:** `apps/admin/app/actions/auth.ts` — different (admin login uses MFA two-step, no register).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Mirror of admin auth Server Action but scoped to the customer auth surface. Cookie helper is the shared `lib/auth/sessionCookie`.

#### audit-C-002 — Universal backend proxy route handler

- **Path:** [apps/client/app/api/backend/[...path]/route.ts](apps/client/app/api/backend/[...path]/route.ts)
- **Surface:** client
- **Tipo:** route-handler
- **Propósito real:** Catch-all Next.js Route Handler that proxies `/api/backend/*` browser requests to the Fastify API with the httpOnly session cookie injected as `Authorization: Bearer`. Intercepts auth-endpoint responses to persist tokens into cookies, and clears them on logout. Single point through which all browser-originated API traffic passes.
- **Exports / endpoints / handlers:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.
- **Imports significativos:** `next/headers`, `next/server`, `@/lib/auth/sessionCookie`.
- **API endpoints consumed:** Proxies every backend endpoint.
- **Admin counterpart?:** `apps/admin/app/api/backend/[...path]/route.ts` — same pattern (different admin auth endpoints).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Critical infra. The duplication with admin is intentional — different auth surfaces, different cookies.

#### audit-C-003 — Client app root layout

- **Path:** [apps/client/app/layout.tsx](apps/client/app/layout.tsx)
- **Surface:** client
- **Tipo:** layout
- **Propósito real:** Root HTML shell + Inter font + global styles + Providers tree wrapper for the client app.
- **Exports / endpoints / handlers:** `RootLayout`, `metadata`.
- **Admin counterpart?:** `apps/admin/app/layout.tsx` — same pattern.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-004 — Providers tree

- **Path:** [apps/client/app/providers.tsx](apps/client/app/providers.tsx)
- **Surface:** client
- **Tipo:** provider
- **Propósito real:** Wraps app in TanStack Query (via shared `@packages/query-client` factory), LoggerProvider, AuthProvider, Toaster, and ApiProvider.
- **Imports significativos:** `@packages/query-client`, `@observability/browser-logger`, `@/lib/auth/authContext`, `@/lib/api`.
- **Admin counterpart?:** `apps/admin/providers/{AuthProvider,QueryProvider,ThemeProvider}.tsx` — admin splits into three providers; client uses one composite.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-005 — Root page redirect

- **Path:** [apps/client/app/page.tsx](apps/client/app/page.tsx)
- **Surface:** client
- **Tipo:** page
- **Propósito real:** Redirects `/` to `/login`.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-006 — Customer login page

- **Path:** [apps/client/app/login/page.tsx](apps/client/app/login/page.tsx)
- **Surface:** client
- **Tipo:** page
- **Propósito real:** Login form using `loginAction` Server Action.
- **Admin counterpart?:** `apps/admin/app/(auth)/login/page.tsx` — admin has MFA + different visual style.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-007 — Customer register page

- **Path:** [apps/client/app/register/page.tsx](apps/client/app/register/page.tsx)
- **Surface:** client
- **Tipo:** page
- **Propósito real:** Self-service registration form using `registerAction` Server Action.
- **Admin counterpart?:** — (admin doesn't offer self-register).
- **Veredicto preliminar:** VÁLIDO

#### audit-C-008 — App-level error boundary

- **Path:** [apps/client/app/error.tsx](apps/client/app/error.tsx)
- **Surface:** client · **Tipo:** error-page
- **Propósito real:** Next.js error boundary using `unstable_retry` (Next 16.2+) and `useLogger` for reporting.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-009 — Global root error boundary

- **Path:** [apps/client/app/global-error.tsx](apps/client/app/global-error.tsx)
- **Surface:** client · **Tipo:** error-page
- **Propósito real:** Outer-most error boundary that runs outside React Context (uses `ConsoleLoggerAdapter` directly).
- **Veredicto preliminar:** VÁLIDO

#### audit-C-010 — 404 not-found

- **Path:** [apps/client/app/not-found.tsx](apps/client/app/not-found.tsx)
- **Surface:** client · **Tipo:** not-found
- **Veredicto preliminar:** VÁLIDO

#### audit-C-011 — Public shared report page

- **Path:** [apps/client/app/reports/shared/[token]/page.tsx](apps/client/app/reports/shared/[token]/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Unauthenticated read-only view of a shared analytics report (token-gated).
- **API endpoints consumed:** Fetches a shared-report by `:token` (endpoint TBD — no exact match in API route table; likely a public endpoint in customReportRoutes that the inventory grep didn't surface, or a missing endpoint).
- **Admin counterpart?:** —
- **Veredicto preliminar:** UNKNOWN → reclassified VÁLIDO (page exists for a known token feature). Cross-check at scope C with reportRoutes/customReportRoutes.

### apps/client/app/dashboard/ (authenticated app shell)

#### audit-C-012 — Dashboard layout

- **Path:** [apps/client/app/dashboard/layout.tsx](apps/client/app/dashboard/layout.tsx)
- **Surface:** client · **Tipo:** layout
- **Propósito real:** Authenticated app shell — sidebar nav, user menu, AnnouncementBanner, NotificationBell, ProjectProvider.
- **Admin counterpart?:** `apps/admin/app/(dashboard)/layout.tsx` — same role, different design (admin uses route groups).
- **Veredicto preliminar:** VÁLIDO

#### audit-C-013 — Dashboard overview page

- **Path:** [apps/client/app/dashboard/page.tsx](apps/client/app/dashboard/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Customer dashboard overview: stats cards, recent posts, connected providers, OnboardingChecklist, quick actions.
- **Imports significativos:** `@/lib/api/hooks` (`usePosts`, `useProjects`, `useApiProviders`).
- **Admin counterpart?:** `apps/admin/app/(dashboard)/page.tsx` — different content (admin DashboardStats vs client OnboardingChecklist + posts).
- **Veredicto preliminar:** VÁLIDO

#### AI section (6 pages)

#### audit-C-014 — AI Generate page

- **Path:** [apps/client/app/dashboard/ai/generate/page.tsx](apps/client/app/dashboard/ai/generate/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Tabbed AI content + AI image generation (composes `AIContentGenerator` + `AIImageGenerator`).
- **API endpoints consumed:** Via children → `/ai/generate`, `/ai-image/*`.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-015 — Smart optimizer page

- **Path:** [apps/client/app/dashboard/ai/optimizer/page.tsx](apps/client/app/dashboard/ai/optimizer/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Hosts `SmartContentOptimizer` with a textarea input.
- **API endpoints consumed:** Via child → `/ai/optimize`, `/ai/analyze`.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-016 — AI prompt templates page

- **Path:** [apps/client/app/dashboard/ai/templates/page.tsx](apps/client/app/dashboard/ai/templates/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Lists system + per-account prompt templates (`PromptTemplateManager`).
- **API endpoints consumed:** Via hook → `/ai/prompt-templates`.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-017 — AI analytics (Content Intelligence)

- **Path:** [apps/client/app/dashboard/ai/analytics/page.tsx](apps/client/app/dashboard/ai/analytics/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Hosts `PredictiveAnalytics`. NOTE: backend endpoints (`/ai/predict-audience`, `/ai/predict-timing`, `/analytics/cross-platform`, `/analytics/roi`) are scaffolded to **501 NOT_IMPLEMENTED** per `usePredictiveData.ts` JSDoc. The page renders a "feature in development" banner via hook error.
- **API endpoints consumed:** `/ai/predict-audience`, `/ai/predict-timing`, `/analytics/cross-platform`, `/analytics/roi` — all exist in route table but scaffolded.
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Page + 27 sub-files (cards/, tabs/, hooks/, mappers/) all wired and gracefully degrade. Backend scaffold means user sees error UI today. Customer-facing debt similar to scheduled-reports cron banner.

#### audit-C-018 — Repurpose opportunities page

- **Path:** [apps/client/app/dashboard/ai/repurpose/page.tsx](apps/client/app/dashboard/ai/repurpose/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Detects high-performing posts and surfaces repurpose proposals.
- **API endpoints consumed:** `/repurpose/proposals` (exists).
- **Veredicto preliminar:** VÁLIDO

#### audit-C-019 — Trend radar page

- **Path:** [apps/client/app/dashboard/ai/trends/page.tsx](apps/client/app/dashboard/ai/trends/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Surfaces trending topics scored against the user's content history.
- **API endpoints consumed:** `/trends/analysis`, `/trends/opportunities`, `/trends/predictions`, `/trends/viral`, `/trends/report` (all exist).
- **Veredicto preliminar:** VÁLIDO

#### Analytics section (3 pages)

#### audit-C-020 — Analytics dashboard

- **Path:** [apps/client/app/dashboard/analytics/page.tsx](apps/client/app/dashboard/analytics/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Customer-facing analytics dashboard fetching via `useAnalytics` hook → `/analytics/dashboard`.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-021 — Performance insights

- **Path:** [apps/client/app/dashboard/analytics/insights/page.tsx](apps/client/app/dashboard/analytics/insights/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Hosts `PerformanceInsights` orchestrator across 5 platforms.
- **API endpoints consumed:** Via hook `usePerformanceInsights` → `/admin/analytics/overview`. **MISMATCH**: a customer-facing page calls an admin-scoped endpoint. Either the endpoint should be moved/duplicated to a non-admin path or the hook should switch to a public analytics endpoint.
- **Admin counterpart?:** `apps/admin/components/dashboard/SetupBanner.tsx` etc. don't expose this; admin has its own dashboard.
- **Veredicto preliminar:** MISMATCH
- **Notas:** `usePerformanceInsights` documents the endpoint as `/admin/analytics/overview`; customer auth likely fails. Flag for fix.

#### audit-C-022 — Scheduled reports

- **Path:** [apps/client/app/dashboard/analytics/reports/page.tsx](apps/client/app/dashboard/analytics/reports/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Manages scheduled analytics reports. Known banner: "Manual generation only — cron not wired" (PR-Scheduled-Reports-Cron).
- **API endpoints consumed:** Via `useReports` → likely `/custom-reports/*` or `/reports/*` (both route files exist).
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** UI is complete but the cron worker that generates scheduled reports is not wired in apps/workers. Customer-facing debt per memory.

#### Approvals, Assets, Campaigns, Channels, Content, Inbox, Instagram, Integrations, Posts, Scheduling, Settings, Tasks, Templates

#### audit-C-023 — Approvals queue page

- **Path:** [apps/client/app/dashboard/approvals/page.tsx](apps/client/app/dashboard/approvals/page.tsx)
- **Surface:** client · **Tipo:** page
- **API endpoints consumed:** `/approvals/*` (exists).
- **Veredicto preliminar:** VÁLIDO

#### audit-C-024 — Assets library page

- **Path:** [apps/client/app/dashboard/assets/page.tsx](apps/client/app/dashboard/assets/page.tsx)
- **Surface:** client · **Tipo:** page
- **API endpoints consumed:** Via `useAssets` → assets routes (exist).
- **Veredicto preliminar:** VÁLIDO

#### audit-C-025 — Campaigns list page

- **Path:** [apps/client/app/dashboard/campaigns/page.tsx](apps/client/app/dashboard/campaigns/page.tsx)
- **Surface:** client · **Tipo:** page
- **API endpoints consumed:** Via `useCampaigns` → `/campaigns/*`.
- **Veredicto preliminar:** VÁLIDO

#### audit-C-026 — Campaign detail page

- **Path:** [apps/client/app/dashboard/campaigns/[id]/page.tsx](apps/client/app/dashboard/campaigns/[id]/page.tsx)
- **Surface:** client · **Tipo:** page
- **Veredicto preliminar:** VÁLIDO

#### audit-C-027 — Channels management page (PR-16 rewrite)

- **Path:** [apps/client/app/dashboard/channels/page.tsx](apps/client/app/dashboard/channels/page.tsx)
- **Surface:** client · **Tipo:** page
- **Propósito real:** Channels listing using `useProjectChannels` + `useDisconnectChannel` + `useConnectBluesky`. Disabled "Test"/"Settings" buttons intentionally removed.
- **API endpoints consumed:** `/projects/:projectId/channels`, `/channels/*`, `/channels/bluesky/connect`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Do NOT propose reintroducing the disabled action buttons (memory: intentional simplification PR-16, 2026-05-07).

#### audit-C-028 — Available providers grid (channels)

- **Path:** [apps/client/app/dashboard/channels/components/AvailableProvidersGrid.tsx](apps/client/app/dashboard/channels/components/AvailableProvidersGrid.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-029 — Channel avatar

- **Path:** [apps/client/app/dashboard/channels/components/ChannelAvatar.tsx](apps/client/app/dashboard/channels/components/ChannelAvatar.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-030 — Channels table

- **Path:** [apps/client/app/dashboard/channels/components/ChannelsTable.tsx](apps/client/app/dashboard/channels/components/ChannelsTable.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-031 — Channel status badge

- **Path:** [apps/client/app/dashboard/channels/components/ChannelStatusBadge.tsx](apps/client/app/dashboard/channels/components/ChannelStatusBadge.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-032 — Connect provider dialog

- **Path:** [apps/client/app/dashboard/channels/components/ConnectProviderDialog.tsx](apps/client/app/dashboard/channels/components/ConnectProviderDialog.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO
- **Notas:** OAuth providers act as placeholders ("Connect Account" closes dialog — actual OAuth redirect pending PR-18 / L-94).

#### audit-C-033 — Channels formatters

- **Path:** [apps/client/app/dashboard/channels/components/formatters.ts](apps/client/app/dashboard/channels/components/formatters.ts)
- **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-034 — Content templates page

- **Path:** [apps/client/app/dashboard/content/templates/page.tsx](apps/client/app/dashboard/content/templates/page.tsx)
- **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-035 — Inbox page

- **Path:** [apps/client/app/dashboard/inbox/page.tsx](apps/client/app/dashboard/inbox/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** Via `useInbox/*` → `/inbox/*` (exists).
- **Veredicto:** VÁLIDO

#### audit-C-036 — Instagram Stories page

- **Path:** [apps/client/app/dashboard/instagram/stories/page.tsx](apps/client/app/dashboard/instagram/stories/page.tsx)
- **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-037 — Instagram media upload page

- **Path:** [apps/client/app/dashboard/instagram/upload/page.tsx](apps/client/app/dashboard/instagram/upload/page.tsx)
- **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-038 — Integrations marketplace page

- **Path:** [apps/client/app/dashboard/integrations/page.tsx](apps/client/app/dashboard/integrations/page.tsx)
- **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-039 — Posts list page

- **Path:** [apps/client/app/dashboard/posts/page.tsx](apps/client/app/dashboard/posts/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `usePosts`, batch mutations → `/posts`, `/posts/batch/*`.
- **Veredicto:** VÁLIDO

#### audit-C-040 — Posts components barrel

- **Path:** [apps/client/app/dashboard/posts/components/index.ts](apps/client/app/dashboard/posts/components/index.ts)
- **Tipo:** barrel · **Veredicto:** VÁLIDO

#### audit-C-041 — PostCard

- **Path:** [apps/client/app/dashboard/posts/components/PostCard.tsx](apps/client/app/dashboard/posts/components/PostCard.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-042 — PostsBulkActionsBar

- **Path:** [apps/client/app/dashboard/posts/components/PostsBulkActionsBar.tsx](apps/client/app/dashboard/posts/components/PostsBulkActionsBar.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-043 — PostsEmptyState

- **Path:** [apps/client/app/dashboard/posts/components/PostsEmptyState.tsx](apps/client/app/dashboard/posts/components/PostsEmptyState.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-044 — PostsFilters

- **Path:** [apps/client/app/dashboard/posts/components/PostsFilters.tsx](apps/client/app/dashboard/posts/components/PostsFilters.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-045 — PostsLoadingSkeleton

- **Path:** [apps/client/app/dashboard/posts/components/PostsLoadingSkeleton.tsx](apps/client/app/dashboard/posts/components/PostsLoadingSkeleton.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-046 — PostsPagination

- **Path:** [apps/client/app/dashboard/posts/components/PostsPagination.tsx](apps/client/app/dashboard/posts/components/PostsPagination.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-047 — PostsViewSwitcher

- **Path:** [apps/client/app/dashboard/posts/components/PostsViewSwitcher.tsx](apps/client/app/dashboard/posts/components/PostsViewSwitcher.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-048 — Post edit page

- **Path:** [apps/client/app/dashboard/posts/[id]/page.tsx](apps/client/app/dashboard/posts/[id]/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `usePost`, `useSchedulePostViaSaga`, `useProjectChannels` → `/posts/:id`, `/sagas/*`.
- **Veredicto:** VÁLIDO

#### audit-C-049 — Post preview page

- **Path:** [apps/client/app/dashboard/posts/[id]/preview/page.tsx](apps/client/app/dashboard/posts/[id]/preview/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-050 — New post page

- **Path:** [apps/client/app/dashboard/posts/new/page.tsx](apps/client/app/dashboard/posts/new/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-051 — Scheduling dashboard page

- **Path:** [apps/client/app/dashboard/scheduling/page.tsx](apps/client/app/dashboard/scheduling/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useOptimalTimes`, `useSchedulingRules`, bulk-create → `/scheduling/*`.
- **Veredicto:** VÁLIDO

#### audit-C-052 — Recurring posts list page

- **Path:** [apps/client/app/dashboard/scheduling/recurring/page.tsx](apps/client/app/dashboard/scheduling/recurring/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useRecurringPosts` → `/recurring/*` (route file `recurringPostRoutes.ts` exists).
- **Veredicto:** VÁLIDO

#### audit-C-053 — Recurring post new page

- **Path:** [apps/client/app/dashboard/scheduling/recurring/new/page.tsx](apps/client/app/dashboard/scheduling/recurring/new/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-054 — Recurring post edit page

- **Path:** [apps/client/app/dashboard/scheduling/recurring/[id]/edit/page.tsx](apps/client/app/dashboard/scheduling/recurring/[id]/edit/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### Settings sub-pages (11 pages)

#### audit-C-055 — Settings AI page

- **Path:** [apps/client/app/dashboard/settings/ai/page.tsx](apps/client/app/dashboard/settings/ai/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useAiStatus`, BYOK → `/settings/ai`, `/settings/ai/byok`.
- **Veredicto:** VÁLIDO

#### audit-C-056 — Billing page

- **Path:** [apps/client/app/dashboard/settings/billing/page.tsx](apps/client/app/dashboard/settings/billing/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useBilling` → `/billing/*`, `/billing/gateway/*`.
- **Veredicto:** VÁLIDO

#### audit-C-057 — ActiveGatewayBanner

- **Path:** [apps/client/app/dashboard/settings/billing/components/ActiveGatewayBanner.tsx](apps/client/app/dashboard/settings/billing/components/ActiveGatewayBanner.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-058 — BundlesTab

- **Path:** [apps/client/app/dashboard/settings/billing/components/BundlesTab.tsx](apps/client/app/dashboard/settings/billing/components/BundlesTab.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-059 — CustomPlanTab

- **Path:** [apps/client/app/dashboard/settings/billing/components/CustomPlanTab.tsx](apps/client/app/dashboard/settings/billing/components/CustomPlanTab.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-060 — GatewaySection (orchestrator)

- **Path:** [apps/client/app/dashboard/settings/billing/components/GatewaySection.tsx](apps/client/app/dashboard/settings/billing/components/GatewaySection.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-061 — GatewaySelector

- **Path:** [apps/client/app/dashboard/settings/billing/components/GatewaySelector.tsx](apps/client/app/dashboard/settings/billing/components/GatewaySelector.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-062 — Billing components barrel

- **Path:** [apps/client/app/dashboard/settings/billing/components/index.ts](apps/client/app/dashboard/settings/billing/components/index.ts) · **Tipo:** barrel · **Veredicto:** VÁLIDO

#### audit-C-063 — PendingSwitchBanner

- **Path:** [apps/client/app/dashboard/settings/billing/components/PendingSwitchBanner.tsx](apps/client/app/dashboard/settings/billing/components/PendingSwitchBanner.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-064 — SwitchConfirmDialog

- **Path:** [apps/client/app/dashboard/settings/billing/components/SwitchConfirmDialog.tsx](apps/client/app/dashboard/settings/billing/components/SwitchConfirmDialog.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-065 — Billing pricing utils

- **Path:** [apps/client/app/dashboard/settings/billing/utils/pricing.ts](apps/client/app/dashboard/settings/billing/utils/pricing.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-066 — Brand voice settings page

- **Path:** [apps/client/app/dashboard/settings/brand-voice/page.tsx](apps/client/app/dashboard/settings/brand-voice/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useBrandVoice` → `/ai/brand-voice` (no exact entry in route table — likely under `/brand-voice/brandVoiceRoutes.ts`).
- **Veredicto:** VÁLIDO

#### audit-C-067 — CRM settings page

- **Path:** [apps/client/app/dashboard/settings/crm/page.tsx](apps/client/app/dashboard/settings/crm/page.tsx)
- **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-068 — External-notification integrations page

- **Path:** [apps/client/app/dashboard/settings/integrations/page.tsx](apps/client/app/dashboard/settings/integrations/page.tsx)
- **Tipo:** page
- **Notas:** Hardcodes `projectId = "default"` with a `TODO`. Mild MISMATCH (project context not yet wired). Tagged VÁLIDO with debt note.
- **Veredicto:** VÁLIDO

#### audit-C-069 — Notifications settings page

- **Path:** [apps/client/app/dashboard/settings/notifications/page.tsx](apps/client/app/dashboard/settings/notifications/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-070 — Privacy / DSAR settings page

- **Path:** [apps/client/app/dashboard/settings/privacy/page.tsx](apps/client/app/dashboard/settings/privacy/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `usePrivacy` → `POST /compliance/dsar` (exists).
- **Veredicto:** VÁLIDO

#### audit-C-071 — Referral settings page

- **Path:** [apps/client/app/dashboard/settings/referral/page.tsx](apps/client/app/dashboard/settings/referral/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** Inline fetch for referral stats — endpoint not in `/tmp/api_endpoints_list.txt`. Possible missing route or unscanned helper file.
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Cross-check vs api route table for `/referrals/*` — none found.

#### audit-C-072 — SSO settings page

- **Path:** [apps/client/app/dashboard/settings/sso/page.tsx](apps/client/app/dashboard/settings/sso/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-073 — Team settings page

- **Path:** [apps/client/app/dashboard/settings/team/page.tsx](apps/client/app/dashboard/settings/team/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useTeam` → likely `/team/*` (teamRoutes.ts exists).
- **Veredicto:** VÁLIDO

#### audit-C-074 — Usage settings page

- **Path:** [apps/client/app/dashboard/settings/usage/page.tsx](apps/client/app/dashboard/settings/usage/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useAccountUsage` → `/usage/*`.
- **Veredicto:** VÁLIDO

#### audit-C-075 — Tasks page

- **Path:** [apps/client/app/dashboard/tasks/page.tsx](apps/client/app/dashboard/tasks/page.tsx)
- **Tipo:** page
- **API endpoints consumed:** `useTasks/*` → routes exist (taskRoutes.ts).
- **Veredicto:** VÁLIDO

#### audit-C-076 — Templates management page

- **Path:** [apps/client/app/dashboard/templates/page.tsx](apps/client/app/dashboard/templates/page.tsx) · **Tipo:** page · **Veredicto:** VÁLIDO

#### audit-C-077 — TemplateManagementDashboard inline (server-rendered shell)

- **Path:** [apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx](apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx)
- **Tipo:** component
- **API endpoints consumed:** `useTemplates`, `useABTests` → `/projects/:projectId/templates*`.
- **Veredicto:** VÁLIDO

### apps/client/components/ai/ (AI generation, optimization, analytics)

#### audit-C-078 — AIContentGenerator orchestrator

- **Path:** [apps/client/components/ai/AIContentGenerator.tsx](apps/client/components/ai/AIContentGenerator.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-079 — AIContentResults (unwired engagement fields)

- **Path:** [apps/client/components/ai/AIContentResults.tsx](apps/client/components/ai/AIContentResults.tsx)
- **Tipo:** component
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Known unwired display fields (`estimatedEngagement`, `readabilityScore`, `engagementScore`, `viralPotential`, `BrandConsistency`) per memory note. Not DEAD — wired through `AIContentGenerator`. Customer-facing debt.

#### audit-C-080 — AI content templates (DEFAULT_CONTENT_TEMPLATES)

- **Path:** [apps/client/components/ai/ai-content-templates.ts](apps/client/components/ai/ai-content-templates.ts)
- **Tipo:** lib
- **Veredicto:** VÁLIDO
- **Notas:** Static fallback consumed by `useAIContentGenerator`; complements API templates.

#### audit-C-081 — AIGenerationPreview

- **Path:** [apps/client/components/ai/AIGenerationPreview.tsx](apps/client/components/ai/AIGenerationPreview.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-082 — AIImageGenerator

- **Path:** [apps/client/components/ai/AIImageGenerator.tsx](apps/client/components/ai/AIImageGenerator.tsx)
- **Tipo:** component
- **API endpoints consumed:** `useAIImages` → `/ai-image/*` (aiImageRoutes.ts exists).
- **Veredicto:** VÁLIDO

#### audit-C-083 — AIPromptForm

- **Path:** [apps/client/components/ai/AIPromptForm.tsx](apps/client/components/ai/AIPromptForm.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-084 — AITemplateSelector (unwired metric fields)

- **Path:** [apps/client/components/ai/AITemplateSelector.tsx](apps/client/components/ai/AITemplateSelector.tsx)
- **Tipo:** component
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Same memory note as AIContentResults — display fields wired but backed by no real metrics.

#### audit-C-085 — PredictiveAnalytics orchestrator

- **Path:** [apps/client/components/ai/PredictiveAnalytics.tsx](apps/client/components/ai/PredictiveAnalytics.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-086 — PromptTemplateManager

- **Path:** [apps/client/components/ai/PromptTemplateManager.tsx](apps/client/components/ai/PromptTemplateManager.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-087 — SmartContentOptimizer orchestrator

- **Path:** [apps/client/components/ai/SmartContentOptimizer.tsx](apps/client/components/ai/SmartContentOptimizer.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-088 — SmartContentOptimizer utils + types

- **Path:** [apps/client/components/ai/smartContentOptimizerUtils.ts](apps/client/components/ai/smartContentOptimizerUtils.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-089..-093 — SmartContentOptimizer tab subs (Hashtags / Metrics / Overview / Suggestions / Tone)

- [Hashtags](apps/client/components/ai/SmartContentOptimizerHashtags.tsx), [Metrics](apps/client/components/ai/SmartContentOptimizerMetrics.tsx), [Overview](apps/client/components/ai/SmartContentOptimizerOverview.tsx), [Suggestions](apps/client/components/ai/SmartContentOptimizerSuggestions.tsx), [Tone](apps/client/components/ai/SmartContentOptimizerTone.tsx)
- **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-094..-104 — AI analytics sub-tree (PredictiveAnalytics children)

Files (all **Tipo:** component / lib / hook / types under VÁLIDO):

- [analytics/AnalyticsHeader.tsx](apps/client/components/ai/analytics/AnalyticsHeader.tsx)
- [analytics/LoadingState.tsx](apps/client/components/ai/analytics/LoadingState.tsx)
- [analytics/TabNavigation.tsx](apps/client/components/ai/analytics/TabNavigation.tsx)
- [analytics/types.ts](apps/client/components/ai/analytics/types.ts)
- [analytics/utils.ts](apps/client/components/ai/analytics/utils.ts)
- [analytics/cards/AudienceInsightCard.tsx](apps/client/components/ai/analytics/cards/AudienceInsightCard.tsx)
- [analytics/cards/CompetitorAnalysisCard.tsx](apps/client/components/ai/analytics/cards/CompetitorAnalysisCard.tsx)
- [analytics/cards/PerformancePredictionCard.tsx](apps/client/components/ai/analytics/cards/PerformancePredictionCard.tsx)
- [analytics/cards/ROIForecastCard.tsx](apps/client/components/ai/analytics/cards/ROIForecastCard.tsx)
- [analytics/tabs/AudienceTab.tsx](apps/client/components/ai/analytics/tabs/AudienceTab.tsx)
- [analytics/tabs/CompetitiveTab.tsx](apps/client/components/ai/analytics/tabs/CompetitiveTab.tsx)
- [analytics/tabs/PerformanceTab.tsx](apps/client/components/ai/analytics/tabs/PerformanceTab.tsx)
- [analytics/tabs/ROITab.tsx](apps/client/components/ai/analytics/tabs/ROITab.tsx)
- [analytics/hooks/usePredictiveData.ts](apps/client/components/ai/analytics/hooks/usePredictiveData.ts) — **hook**, gracefully surfaces 501-not-implemented
- [analytics/hooks/usePredictiveData/apiTypes.ts](apps/client/components/ai/analytics/hooks/usePredictiveData/apiTypes.ts) — **types**
- [analytics/hooks/usePredictiveData/mapAudienceInsights.ts](apps/client/components/ai/analytics/hooks/usePredictiveData/mapAudienceInsights.ts) — **lib**
- [analytics/hooks/usePredictiveData/mapCompetitorAnalysis.ts](apps/client/components/ai/analytics/hooks/usePredictiveData/mapCompetitorAnalysis.ts) — **lib**
- [analytics/hooks/usePredictiveData/mapROIForecasts.ts](apps/client/components/ai/analytics/hooks/usePredictiveData/mapROIForecasts.ts) — **lib**
- [analytics/hooks/usePredictiveData/mapTimingPredictions.ts](apps/client/components/ai/analytics/hooks/usePredictiveData/mapTimingPredictions.ts) — **lib**
- [analytics/hooks/usePredictiveData/providerMap.ts](apps/client/components/ai/analytics/hooks/usePredictiveData/providerMap.ts) — **lib**

#### audit-C-105..-108 — AI promptTemplateManager subs

- [promptTemplateManager/CreateTemplateForm.tsx](apps/client/components/ai/promptTemplateManager/CreateTemplateForm.tsx) — component
- [promptTemplateManager/index.ts](apps/client/components/ai/promptTemplateManager/index.ts) — barrel
- [promptTemplateManager/TemplateCard.tsx](apps/client/components/ai/promptTemplateManager/TemplateCard.tsx) — component
- [promptTemplateManager/types.ts](apps/client/components/ai/promptTemplateManager/types.ts) — types

All **Veredicto:** VÁLIDO.

### apps/client/components/analytics/ (insights, scheduled reports)

#### audit-C-109 — PerformanceInsights orchestrator (calls admin endpoint)

- **Path:** [apps/client/components/analytics/PerformanceInsights.tsx](apps/client/components/analytics/PerformanceInsights.tsx) · **Tipo:** component
- **Veredicto preliminar:** MISMATCH (same as audit-C-021 page).

#### audit-C-110 — CreateReportForm

- **Path:** [apps/client/components/analytics/CreateReportForm.tsx](apps/client/components/analytics/CreateReportForm.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-111 — ScheduledReportsList

- **Path:** [apps/client/components/analytics/ScheduledReportsList.tsx](apps/client/components/analytics/ScheduledReportsList.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-112..-119 — Insights sub-components

- [insights/AudienceInsightsPanel.tsx](apps/client/components/analytics/insights/AudienceInsightsPanel.tsx)
- [insights/HashtagPerformancePanel.tsx](apps/client/components/analytics/insights/HashtagPerformancePanel.tsx)
- [insights/LoadingState.tsx](apps/client/components/analytics/insights/LoadingState.tsx)
- [insights/OptimalTimingPanel.tsx](apps/client/components/analytics/insights/OptimalTimingPanel.tsx)
- [insights/PerformanceInsightsHeader.tsx](apps/client/components/analytics/insights/PerformanceInsightsHeader.tsx)
- [insights/RecommendationsList.tsx](apps/client/components/analytics/insights/RecommendationsList.tsx)
- [insights/TopPerformingContent.tsx](apps/client/components/analytics/insights/TopPerformingContent.tsx)
- [insights/types.ts](apps/client/components/analytics/insights/types.ts)
- [insights/utils.ts](apps/client/components/analytics/insights/utils.ts)

All **Tipo:** component/types/lib · **Veredicto:** VÁLIDO.

### apps/client/components/announcements/

#### audit-C-120 — AnnouncementBanner

- **Path:** [apps/client/components/announcements/AnnouncementBanner.tsx](apps/client/components/announcements/AnnouncementBanner.tsx)
- **Tipo:** component
- **API endpoints consumed:** `/announcements/active` (exists, public).
- **Veredicto:** VÁLIDO

### apps/client/components/approvals/

#### audit-C-121 — ApprovalCard

- **Path:** [apps/client/components/approvals/ApprovalCard.tsx](apps/client/components/approvals/ApprovalCard.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-122 — ApprovalQueue

- **Path:** [apps/client/components/approvals/ApprovalQueue.tsx](apps/client/components/approvals/ApprovalQueue.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-123 — ReviewPanel

- **Path:** [apps/client/components/approvals/ReviewPanel.tsx](apps/client/components/approvals/ReviewPanel.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

### apps/client/components/assets/

#### audit-C-124..-127

- [AssetDetailPanel.tsx](apps/client/components/assets/AssetDetailPanel.tsx)
- [AssetGrid.tsx](apps/client/components/assets/AssetGrid.tsx)
- [AssetThumbnail.tsx](apps/client/components/assets/AssetThumbnail.tsx)
- [FolderSidebar.tsx](apps/client/components/assets/FolderSidebar.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/billing/

#### audit-C-128 — InvoiceHistory

- **Path:** [apps/client/components/billing/InvoiceHistory.tsx](apps/client/components/billing/InvoiceHistory.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

### apps/client/components/campaigns/

#### audit-C-129..-132

- [CampaignCard.tsx](apps/client/components/campaigns/CampaignCard.tsx)
- [CampaignList.tsx](apps/client/components/campaigns/CampaignList.tsx)
- [CampaignStatusBadge.tsx](apps/client/components/campaigns/CampaignStatusBadge.tsx)
- [CreateCampaignModal.tsx](apps/client/components/campaigns/CreateCampaignModal.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/channels/

#### audit-C-133 — PrimaryChannelsSection

- **Path:** [apps/client/components/channels/PrimaryChannelsSection.tsx](apps/client/components/channels/PrimaryChannelsSection.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-134 — SetPrimaryChannelButton

- **Path:** [apps/client/components/channels/SetPrimaryChannelButton.tsx](apps/client/components/channels/SetPrimaryChannelButton.tsx)
- **Tipo:** component
- **API endpoints consumed:** `/channels/:channelId/set-primary` (exists).
- **Veredicto:** VÁLIDO

### apps/client/components/comments/

#### audit-C-135 — CommentThread

- **Path:** [apps/client/components/comments/CommentThread.tsx](apps/client/components/comments/CommentThread.tsx)
- **Tipo:** component
- **API endpoints consumed:** via `useComments` → `/comments/*` (commentRoutes.ts exists).
- **Veredicto:** VÁLIDO

### apps/client/components/content/ + content/templates/

#### audit-C-136 — ContentTemplates (orchestrator)

- **Path:** [apps/client/components/content/ContentTemplates.tsx](apps/client/components/content/ContentTemplates.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-137..-145 — Content templates subs

- [templates/AutomationCard.tsx](apps/client/components/content/templates/AutomationCard.tsx)
- [templates/AutomationList.tsx](apps/client/components/content/templates/AutomationList.tsx)
- [templates/index.ts](apps/client/components/content/templates/index.ts) — barrel
- [templates/TemplateCard.tsx](apps/client/components/content/templates/TemplateCard.tsx)
- [templates/TemplateFilters.tsx](apps/client/components/content/templates/TemplateFilters.tsx)
- [templates/TemplateGrid.tsx](apps/client/components/content/templates/TemplateGrid.tsx)
- [templates/TemplatesHeader.tsx](apps/client/components/content/templates/TemplatesHeader.tsx)
- [templates/TemplatesLoadingSkeleton.tsx](apps/client/components/content/templates/TemplatesLoadingSkeleton.tsx)
- [templates/TemplatesTabs.tsx](apps/client/components/content/templates/TemplatesTabs.tsx)
- [templates/TemplateVariableModal.tsx](apps/client/components/content/templates/TemplateVariableModal.tsx)
- [templates/types.ts](apps/client/components/content/templates/types.ts) — types
- [templates/useTemplateData.ts](apps/client/components/content/templates/useTemplateData.ts) — hook

All **Veredicto:** VÁLIDO.

### apps/client/components/editor/

#### audit-C-146 — ClientContentEditor

- **Path:** [apps/client/components/editor/ClientContentEditor.tsx](apps/client/components/editor/ClientContentEditor.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-147 — PlatformPreview (preview dispatcher)

- **Path:** [apps/client/components/editor/PlatformPreview.tsx](apps/client/components/editor/PlatformPreview.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-148 — SchedulePicker

- **Path:** [apps/client/components/editor/SchedulePicker.tsx](apps/client/components/editor/SchedulePicker.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-149 — TemplateSelector

- **Path:** [apps/client/components/editor/TemplateSelector.tsx](apps/client/components/editor/TemplateSelector.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-150..-163 — Per-platform preview subs (editor/previews/)

- [BlueskyPreview.tsx](apps/client/components/editor/previews/BlueskyPreview.tsx)
- [FacebookPreview.tsx](apps/client/components/editor/previews/FacebookPreview.tsx)
- [HashtagText.tsx](apps/client/components/editor/previews/HashtagText.tsx)
- [index.ts](apps/client/components/editor/previews/index.ts) — barrel
- [InstagramPreview.tsx](apps/client/components/editor/previews/InstagramPreview.tsx)
- [LinkedInPreview.tsx](apps/client/components/editor/previews/LinkedInPreview.tsx)
- [MediaGrid.tsx](apps/client/components/editor/previews/MediaGrid.tsx)
- [PinterestPreview.tsx](apps/client/components/editor/previews/PinterestPreview.tsx)
- [SnapchatPreview.tsx](apps/client/components/editor/previews/SnapchatPreview.tsx)
- [TelegramPreview.tsx](apps/client/components/editor/previews/TelegramPreview.tsx)
- [TikTokPreview.tsx](apps/client/components/editor/previews/TikTokPreview.tsx)
- [TwitterPreview.tsx](apps/client/components/editor/previews/TwitterPreview.tsx)
- [types.ts](apps/client/components/editor/previews/types.ts) — types
- [useObjectURL.ts](apps/client/components/editor/previews/useObjectURL.ts) — hook
- [YouTubePreview.tsx](apps/client/components/editor/previews/YouTubePreview.tsx)

All **Veredicto:** VÁLIDO.

### apps/client/components/inbox/

#### audit-C-164..-171

- [ConversationCard.tsx](apps/client/components/inbox/ConversationCard.tsx)
- [ConversationHeader.tsx](apps/client/components/inbox/ConversationHeader.tsx)
- [ConversationList.tsx](apps/client/components/inbox/ConversationList.tsx)
- [ConversationThread.tsx](apps/client/components/inbox/ConversationThread.tsx)
- [InboxLayout.tsx](apps/client/components/inbox/InboxLayout.tsx)
- [InboxSidebar.tsx](apps/client/components/inbox/InboxSidebar.tsx)
- [MessageBubble.tsx](apps/client/components/inbox/MessageBubble.tsx)
- [ReplyComposer.tsx](apps/client/components/inbox/ReplyComposer.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/instagram/ + sub-modules

#### audit-C-172 — Instagram barrel

- **Path:** [apps/client/components/instagram/index.ts](apps/client/components/instagram/index.ts) · **Tipo:** barrel · **Veredicto:** VÁLIDO

#### audit-C-173 — StoriesEditor

- **Path:** [apps/client/components/instagram/StoriesEditor.tsx](apps/client/components/instagram/StoriesEditor.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-174 — MediaUploadZone

- **Path:** [apps/client/components/instagram/MediaUploadZone.tsx](apps/client/components/instagram/MediaUploadZone.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-175 — VideoSplitPreview

- **Path:** [apps/client/components/instagram/VideoSplitPreview.tsx](apps/client/components/instagram/VideoSplitPreview.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-176..-184 — Stories subs

- [stories/hooks/useFileUpload.ts](apps/client/components/instagram/stories/hooks/useFileUpload.ts) — hook
- [stories/hooks/useKeyboardShortcuts.ts](apps/client/components/instagram/stories/hooks/useKeyboardShortcuts.ts) — hook
- [stories/hooks/useStoryManagement.ts](apps/client/components/instagram/stories/hooks/useStoryManagement.ts) — hook
- [stories/LoadingOverlay.tsx](apps/client/components/instagram/stories/LoadingOverlay.tsx)
- [stories/StoriesHeader.tsx](apps/client/components/instagram/stories/StoriesHeader.tsx)
- [stories/StoriesTimeline.tsx](apps/client/components/instagram/stories/StoriesTimeline.tsx)
- [stories/StoryEditorControls.tsx](apps/client/components/instagram/stories/StoryEditorControls.tsx)
- [stories/StoryPreview.tsx](apps/client/components/instagram/stories/StoryPreview.tsx)
- [stories/types.ts](apps/client/components/instagram/stories/types.ts) — types
- [stories/utils.ts](apps/client/components/instagram/stories/utils.ts) — lib

All **Veredicto:** VÁLIDO.

#### audit-C-185..-188 — UploadZone subs

- [uploadZone/DropZone.tsx](apps/client/components/instagram/uploadZone/DropZone.tsx)
- [uploadZone/types.ts](apps/client/components/instagram/uploadZone/types.ts) — types
- [uploadZone/UploadedFileCard.tsx](apps/client/components/instagram/uploadZone/UploadedFileCard.tsx)
- [uploadZone/useMediaUpload.ts](apps/client/components/instagram/uploadZone/useMediaUpload.ts) — hook

All **Veredicto:** VÁLIDO.

#### audit-C-189..-193 — Instagram utils

- [utils/format.ts](apps/client/components/instagram/utils/format.ts) — lib
- [utils/generateVideoThumbnail.ts](apps/client/components/instagram/utils/generateVideoThumbnail.ts) — lib
- [utils/index.ts](apps/client/components/instagram/utils/index.ts) — barrel
- [utils/useImageMetadata.ts](apps/client/components/instagram/utils/useImageMetadata.ts) — hook
- [utils/useVideoMetadata.ts](apps/client/components/instagram/utils/useVideoMetadata.ts) — hook

All **Veredicto:** VÁLIDO.

#### audit-C-194..-197 — videoSplit subs

- [videoSplit/SegmentsGrid.tsx](apps/client/components/instagram/videoSplit/SegmentsGrid.tsx)
- [videoSplit/SplitSettingsPanel.tsx](apps/client/components/instagram/videoSplit/SplitSettingsPanel.tsx)
- [videoSplit/types.ts](apps/client/components/instagram/videoSplit/types.ts) — types
- [videoSplit/useVideoSegments.ts](apps/client/components/instagram/videoSplit/useVideoSegments.ts) — hook

All **Veredicto:** VÁLIDO.

### apps/client/components/integrations/

#### audit-C-198 — IntegrationMarketplace

- **Path:** [apps/client/components/integrations/IntegrationMarketplace.tsx](apps/client/components/integrations/IntegrationMarketplace.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

### apps/client/components/notifications/

#### audit-C-199 — NotificationBell

- **Path:** [apps/client/components/notifications/NotificationBell.tsx](apps/client/components/notifications/NotificationBell.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-200 — NotificationItem

- **Path:** [apps/client/components/notifications/NotificationItem.tsx](apps/client/components/notifications/NotificationItem.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-201 — NotificationPreferences

- **Path:** [apps/client/components/notifications/NotificationPreferences.tsx](apps/client/components/notifications/NotificationPreferences.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

### apps/client/components/onboarding/

#### audit-C-202 — OnboardingChecklist

- **Path:** [apps/client/components/onboarding/OnboardingChecklist.tsx](apps/client/components/onboarding/OnboardingChecklist.tsx)
- **Tipo:** component
- **API endpoints consumed:** `/onboarding/*` (exists).
- **Veredicto:** VÁLIDO

### apps/client/components/scheduling/ + sub-trees

#### audit-C-203..-216 — Scheduling components

- [CSVBulkUpload.tsx](apps/client/components/scheduling/CSVBulkUpload.tsx)
- [DayCalendar.tsx](apps/client/components/scheduling/DayCalendar.tsx)
- [index.ts](apps/client/components/scheduling/index.ts) — barrel
- [MultiPlatformScheduler.tsx](apps/client/components/scheduling/MultiPlatformScheduler.tsx)
- [RecurrenceSelector.tsx](apps/client/components/scheduling/RecurrenceSelector.tsx)
- [RecurringPostCard.tsx](apps/client/components/scheduling/RecurringPostCard.tsx)
- [RecurringPostForm.tsx](apps/client/components/scheduling/RecurringPostForm.tsx)
- [RecurringPostsList.tsx](apps/client/components/scheduling/RecurringPostsList.tsx)
- [SchedulingDashboard.tsx](apps/client/components/scheduling/SchedulingDashboard.tsx)
- [SchedulingDashboardCalendar.tsx](apps/client/components/scheduling/SchedulingDashboardCalendar.tsx)
- [SchedulingDashboardPostModal.tsx](apps/client/components/scheduling/SchedulingDashboardPostModal.tsx)
- [SchedulingDashboardSidebar.tsx](apps/client/components/scheduling/SchedulingDashboardSidebar.tsx)
- [schedulingDashboardTypes.ts](apps/client/components/scheduling/schedulingDashboardTypes.ts) — types
- [schedulingDashboardUtils.ts](apps/client/components/scheduling/schedulingDashboardUtils.ts) — lib
- [useSchedulingDashboard.ts](apps/client/components/scheduling/useSchedulingDashboard.ts) — hook
- [WeekCalendar.tsx](apps/client/components/scheduling/WeekCalendar.tsx)

All **Veredicto:** VÁLIDO.

#### audit-C-217..-220 — Scheduling views subs

- [views/BulkScheduleView.tsx](apps/client/components/scheduling/views/BulkScheduleView.tsx)
- [views/CalendarView.tsx](apps/client/components/scheduling/views/CalendarView.tsx)
- [views/OptimalTimesView.tsx](apps/client/components/scheduling/views/OptimalTimesView.tsx)
- [views/RulesView.tsx](apps/client/components/scheduling/views/RulesView.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/settings/ + sub-trees

#### audit-C-221..-225 — Top-level settings forms

- [AddWebhookForm.tsx](apps/client/components/settings/AddWebhookForm.tsx)
- [BrandVoiceForm.tsx](apps/client/components/settings/BrandVoiceForm.tsx)
- [ExternalNotificationConfigs.tsx](apps/client/components/settings/ExternalNotificationConfigs.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

#### audit-C-226..-228 — CRM settings subs

- [crm/CrmConnectionCard.tsx](apps/client/components/settings/crm/CrmConnectionCard.tsx)
- [crm/CrmSettings.tsx](apps/client/components/settings/crm/CrmSettings.tsx)
- [crm/CrmSyncLog.tsx](apps/client/components/settings/crm/CrmSyncLog.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

#### audit-C-229..-232 — SSO settings subs

- [sso/OidcConfigForm.tsx](apps/client/components/settings/sso/OidcConfigForm.tsx)
- [sso/SamlConfigForm.tsx](apps/client/components/settings/sso/SamlConfigForm.tsx)
- [sso/SsoSettings.tsx](apps/client/components/settings/sso/SsoSettings.tsx)
- [sso/SsoStatusBanner.tsx](apps/client/components/settings/sso/SsoStatusBanner.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/shared/

#### audit-C-233 — EmptyState

- **Path:** [apps/client/components/shared/EmptyState.tsx](apps/client/components/shared/EmptyState.tsx) · **Tipo:** component · **Veredicto:** VÁLIDO

#### audit-C-234 — LoadingSpinner

- **Path:** [apps/client/components/shared/LoadingSpinner.tsx](apps/client/components/shared/LoadingSpinner.tsx)
- **Tipo:** component
- **Admin counterpart?:** `apps/admin/components/shared/LoadingSpinner.tsx` — likely similar (same module name).
- **Veredicto preliminar:** REDUNDANTE
- **Notas:** Spinner is a textbook candidate for `@packages/ui`. Confirm diff vs admin; consolidate.

### apps/client/components/tasks/

#### audit-C-235..-239

- [CreateTaskModal.tsx](apps/client/components/tasks/CreateTaskModal.tsx)
- [TaskBadge.tsx](apps/client/components/tasks/TaskBadge.tsx)
- [TaskCard.tsx](apps/client/components/tasks/TaskCard.tsx)
- [TaskDetailPanel.tsx](apps/client/components/tasks/TaskDetailPanel.tsx)
- [TaskList.tsx](apps/client/components/tasks/TaskList.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/team/

#### audit-C-240..-243

- [InviteMemberModal.tsx](apps/client/components/team/InviteMemberModal.tsx)
- [RoleBadge.tsx](apps/client/components/team/RoleBadge.tsx)
- [TeamMemberRow.tsx](apps/client/components/team/TeamMemberRow.tsx)
- [TeamPage.tsx](apps/client/components/team/TeamPage.tsx)

All **Tipo:** component · **Veredicto:** VÁLIDO.

### apps/client/components/templates/ + variableInserter/

#### audit-C-244..-271 — Templates components

- [ABTestCard.tsx](apps/client/components/templates/ABTestCard.tsx)
- [ABTestCreateDialog.tsx](apps/client/components/templates/ABTestCreateDialog.tsx)
- [ABTestManager.tsx](apps/client/components/templates/ABTestManager.tsx)
- [ABTestResultsTab.tsx](apps/client/components/templates/ABTestResultsTab.tsx)
- [ABTestStatsCards.tsx](apps/client/components/templates/ABTestStatsCards.tsx)
- [abTestTypes.ts](apps/client/components/templates/abTestTypes.ts) — types
- [BranchCard.tsx](apps/client/components/templates/BranchCard.tsx)
- [CreateBranchDialog.tsx](apps/client/components/templates/CreateBranchDialog.tsx)
- [CreateVersionDialog.tsx](apps/client/components/templates/CreateVersionDialog.tsx)
- [index.ts](apps/client/components/templates/index.ts) — barrel
- [TemplateEditor.tsx](apps/client/components/templates/TemplateEditor.tsx)
- [TemplateEditorCanvas.tsx](apps/client/components/templates/TemplateEditorCanvas.tsx)
- [TemplateEditorSidebar.tsx](apps/client/components/templates/TemplateEditorSidebar.tsx)
- [TemplateEditorToolbar.tsx](apps/client/components/templates/TemplateEditorToolbar.tsx)
- [templateEditorTypes.ts](apps/client/components/templates/templateEditorTypes.ts) — types
- [TemplateLibrary.tsx](apps/client/components/templates/TemplateLibrary.tsx)
- [TemplateLibraryDialogs.tsx](apps/client/components/templates/TemplateLibraryDialogs.tsx)
- [TemplateLibraryGrid.tsx](apps/client/components/templates/TemplateLibraryGrid.tsx)
- [TemplateLibrarySearch.tsx](apps/client/components/templates/TemplateLibrarySearch.tsx)
- [templateLibraryTypes.ts](apps/client/components/templates/templateLibraryTypes.ts) — types
- [TemplateVersionControl.tsx](apps/client/components/templates/TemplateVersionControl.tsx)
- [templateVersionControlTypes.ts](apps/client/components/templates/templateVersionControlTypes.ts) — types
- [TipTapEditor.tsx](apps/client/components/templates/TipTapEditor.tsx)
- [useABTestManager.ts](apps/client/components/templates/useABTestManager.ts) — hook
- [useTemplateVersionControl.ts](apps/client/components/templates/useTemplateVersionControl.ts) — hook
- [VariableInserter.tsx](apps/client/components/templates/VariableInserter.tsx)
- [VersionCard.tsx](apps/client/components/templates/VersionCard.tsx)
- [VersionCompareView.tsx](apps/client/components/templates/VersionCompareView.tsx)

All **Veredicto:** VÁLIDO.

#### audit-C-272..-276 — VariableInserter subs

- [variableInserter/ContextTab.tsx](apps/client/components/templates/variableInserter/ContextTab.tsx)
- [variableInserter/data.ts](apps/client/components/templates/variableInserter/data.ts) — lib
- [variableInserter/HelpersTab.tsx](apps/client/components/templates/variableInserter/HelpersTab.tsx)
- [variableInserter/index.ts](apps/client/components/templates/variableInserter/index.ts) — barrel
- [variableInserter/VariablesTab.tsx](apps/client/components/templates/variableInserter/VariablesTab.tsx)

All **Veredicto:** VÁLIDO.

### apps/client/hooks/

#### audit-C-277..-280 — Top-level hooks

- [useAIContentGenerator.ts](apps/client/hooks/useAIContentGenerator.ts) — composite (state + API) for the AI generator workflow.
- [useFocusTrap.ts](apps/client/hooks/useFocusTrap.ts) — WCAG 2.1 focus trap.
- [useNotificationStream.ts](apps/client/hooks/useNotificationStream.ts) — SSE bridge for notifications (connects directly to `NEXT_PUBLIC_API_URL`, NOT via proxy).
- [useSchedulingDashboardSidebar.ts](apps/client/hooks/useSchedulingDashboardSidebar.ts) — POC of canon `tanstack-query-v5-migration-patterns-from-raw-fetch`.

All **Tipo:** hook · **Veredicto:** VÁLIDO.

#### audit-C-281..-313 — apps/client/hooks/api/ (TanStack Query hook tree)

Each is **Tipo:** hook · all **Veredicto:** VÁLIDO unless flagged below.

Single-file hooks:

- [useAIContentGeneration.ts](apps/client/hooks/api/useAIContentGeneration.ts)
- [useAIImages.ts](apps/client/hooks/api/useAIImages.ts)
- [useAiSettings.ts](apps/client/hooks/api/useAiSettings.ts)
- [useAnalytics.ts](apps/client/hooks/api/useAnalytics.ts)
- [useApprovals.ts](apps/client/hooks/api/useApprovals.ts)
- [useBrandVoice.ts](apps/client/hooks/api/useBrandVoice.ts)
- [useComments.ts](apps/client/hooks/api/useComments.ts)
- [useCrm.ts](apps/client/hooks/api/useCrm.ts)
- [useExternalNotifications.ts](apps/client/hooks/api/useExternalNotifications.ts)
- [useMultiPlatformScheduling.ts](apps/client/hooks/api/useMultiPlatformScheduling.ts) — likely **MISMATCH** with `apps/admin/hooks/api/useMultiPlatformScheduling.ts` (same filename in admin — see Cross-surface signals below).
- [useOnboarding.ts](apps/client/hooks/api/useOnboarding.ts)
- [usePerformanceInsights.ts](apps/client/hooks/api/usePerformanceInsights.ts) — **MISMATCH** (calls admin endpoint `/admin/analytics/overview` from a customer-facing hook).
- [usePrivacy.ts](apps/client/hooks/api/usePrivacy.ts)
- [useRecurringPosts.ts](apps/client/hooks/api/useRecurringPosts.ts)
- [useReports.ts](apps/client/hooks/api/useReports.ts)
- [useScheduledPosts.ts](apps/client/hooks/api/useScheduledPosts.ts)
- [useTeam.ts](apps/client/hooks/api/useTeam.ts)
- [useUsage.ts](apps/client/hooks/api/useUsage.ts)

Per-domain split (each folder contributes 5 files: `api.ts`, `index.ts` (barrel), `mutations.ts`, `queries.ts`, `types.ts`):

- `useAIPromptTemplates/` — [api](apps/client/hooks/api/useAIPromptTemplates/api.ts) · [index](apps/client/hooks/api/useAIPromptTemplates/index.ts) · [mutations](apps/client/hooks/api/useAIPromptTemplates/mutations.ts) · [queries](apps/client/hooks/api/useAIPromptTemplates/queries.ts) · [types](apps/client/hooks/api/useAIPromptTemplates/types.ts)
- `useAssets/` — [api](apps/client/hooks/api/useAssets/api.ts) · [index](apps/client/hooks/api/useAssets/index.ts) · [mutations](apps/client/hooks/api/useAssets/mutations.ts) · [queries](apps/client/hooks/api/useAssets/queries.ts) · [types](apps/client/hooks/api/useAssets/types.ts)
- `useBilling/` — [api](apps/client/hooks/api/useBilling/api.ts) · [index](apps/client/hooks/api/useBilling/index.ts) · [mutations](apps/client/hooks/api/useBilling/mutations.ts) · [queries](apps/client/hooks/api/useBilling/queries.ts) · [types](apps/client/hooks/api/useBilling/types.ts)
- `useCampaigns/` — [api](apps/client/hooks/api/useCampaigns/api.ts) · [index](apps/client/hooks/api/useCampaigns/index.ts) · [mutations](apps/client/hooks/api/useCampaigns/mutations.ts) · [queries](apps/client/hooks/api/useCampaigns/queries.ts) · [types](apps/client/hooks/api/useCampaigns/types.ts)
- `useInbox/` — [api](apps/client/hooks/api/useInbox/api.ts) · [index](apps/client/hooks/api/useInbox/index.ts) · [mutations](apps/client/hooks/api/useInbox/mutations.ts) · [queries](apps/client/hooks/api/useInbox/queries.ts) · [types](apps/client/hooks/api/useInbox/types.ts)
- `useNotificationsApi/` — [index](apps/client/hooks/api/useNotificationsApi/index.ts) · [mutations](apps/client/hooks/api/useNotificationsApi/mutations.ts) · [queries](apps/client/hooks/api/useNotificationsApi/queries.ts) (no `api.ts`/`types.ts` — transport in `lib/api/clients/notificationsClient.ts`)
- `useSso/` — [api](apps/client/hooks/api/useSso/api.ts) · [index](apps/client/hooks/api/useSso/index.ts) · [mutations](apps/client/hooks/api/useSso/mutations.ts) · [queries](apps/client/hooks/api/useSso/queries.ts) · [types](apps/client/hooks/api/useSso/types.ts)
- `useTasks/` — [api](apps/client/hooks/api/useTasks/api.ts) · [index](apps/client/hooks/api/useTasks/index.ts) · [mutations](apps/client/hooks/api/useTasks/mutations.ts) · [queries](apps/client/hooks/api/useTasks/queries.ts) · [types](apps/client/hooks/api/useTasks/types.ts)

### apps/client/lib/

#### audit-C-314 — ai-content-utils

- **Path:** [apps/client/lib/ai-content-utils.ts](apps/client/lib/ai-content-utils.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-315..-330 — API layer

- [lib/api/client.ts](apps/client/lib/api/client.ts) — facade over 9 domain clients
- [lib/api/context.tsx](apps/client/lib/api/context.tsx) — provider
- [lib/api/hooks.ts](apps/client/lib/api/hooks.ts) — legacy aggregate TanStack hooks
- [lib/api/index.ts](apps/client/lib/api/index.ts) — barrel
- [lib/api/types.ts](apps/client/lib/api/types.ts) — types
- [lib/api/clients/accountsClient.ts](apps/client/lib/api/clients/accountsClient.ts)
- [lib/api/clients/aiClient.ts](apps/client/lib/api/clients/aiClient.ts)
- [lib/api/clients/analyticsClient.ts](apps/client/lib/api/clients/analyticsClient.ts)
- [lib/api/clients/channelsClient.ts](apps/client/lib/api/clients/channelsClient.ts)
- [lib/api/clients/healthClient.ts](apps/client/lib/api/clients/healthClient.ts)
- [lib/api/clients/notificationsClient.ts](apps/client/lib/api/clients/notificationsClient.ts)
- [lib/api/clients/postsClient.ts](apps/client/lib/api/clients/postsClient.ts)
- [lib/api/clients/projectsClient.ts](apps/client/lib/api/clients/projectsClient.ts)
- [lib/api/clients/providersClient.ts](apps/client/lib/api/clients/providersClient.ts)
- [lib/api/clients/request.ts](apps/client/lib/api/clients/request.ts) — base HTTP helper through `/api/backend` proxy
- [lib/api/clients/sagaClient.ts](apps/client/lib/api/clients/sagaClient.ts)
- [lib/api/clients/schedulingClient.ts](apps/client/lib/api/clients/schedulingClient.ts)
- [lib/api/clients/uploadsClient.ts](apps/client/lib/api/clients/uploadsClient.ts)
- [lib/api/clients/usageClient.ts](apps/client/lib/api/clients/usageClient.ts)
- [lib/api/queries/notificationsQueries.ts](apps/client/lib/api/queries/notificationsQueries.ts) — queryOptions factory
- [lib/api/queries/schedulingQueries.ts](apps/client/lib/api/queries/schedulingQueries.ts) — queryOptions factory (POC)
- [lib/api/queries/usageQueries.ts](apps/client/lib/api/queries/usageQueries.ts) — queryOptions factory

All **Tipo:** lib (or barrel/types as noted) · **Veredicto:** VÁLIDO.

#### audit-C-331..-333 — auth layer

- [lib/auth/authApi.ts](apps/client/lib/auth/authApi.ts) — login/register/logout/refresh/me via `/api/backend/auth/customer/*`.
- [lib/auth/authContext.tsx](apps/client/lib/auth/authContext.tsx) — React Context exposing auth state.
- [lib/auth/sessionCookie.ts](apps/client/lib/auth/sessionCookie.ts) — single source of truth for cookie names + TTLs.

All **Veredicto:** VÁLIDO.

**Admin counterpart?:** `apps/admin/lib/auth/{backend-client,sessionCookie,types}.ts` — `sessionCookie.ts` SHOULD be a shared package per CLAUDE.md but currently exists in both apps. Mild **REDUNDANTE** candidate for promotion to `@packages/auth` shared module.

#### audit-C-334 — schedulingCsvParser

- **Path:** [apps/client/lib/csv/schedulingCsvParser.ts](apps/client/lib/csv/schedulingCsvParser.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-335 — env (Zod typed env)

- **Path:** [apps/client/lib/env.ts](apps/client/lib/env.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-336..-344 — lib/hooks/

- [lib/hooks/useABTests.ts](apps/client/lib/hooks/useABTests.ts) — hook
- [lib/hooks/useAutoSave.ts](apps/client/lib/hooks/useAutoSave.ts) — hook
- [lib/hooks/useProjectChannels/api.ts](apps/client/lib/hooks/useProjectChannels/api.ts) — hook submodule
- [lib/hooks/useProjectChannels/index.ts](apps/client/lib/hooks/useProjectChannels/index.ts) — barrel
- [lib/hooks/useProjectChannels/mutations.ts](apps/client/lib/hooks/useProjectChannels/mutations.ts) — hook submodule
- [lib/hooks/useProjectChannels/queries.ts](apps/client/lib/hooks/useProjectChannels/queries.ts) — hook submodule
- [lib/hooks/useProjectChannels/types.ts](apps/client/lib/hooks/useProjectChannels/types.ts) — types
- [lib/hooks/useProviders.ts](apps/client/lib/hooks/useProviders.ts) — hook
- [lib/hooks/useSagaStatus.ts](apps/client/lib/hooks/useSagaStatus.ts) — hook (polls saga state)
- [lib/hooks/useSchedulePostViaSaga.ts](apps/client/lib/hooks/useSchedulePostViaSaga.ts) — hook
- [lib/hooks/useStartPostPublishingSaga.ts](apps/client/lib/hooks/useStartPostPublishingSaga.ts) — hook
- [lib/hooks/useTemplates.ts](apps/client/lib/hooks/useTemplates.ts) — hook
- [lib/hooks/useTemplateVersions.ts](apps/client/lib/hooks/useTemplateVersions.ts) — hook

All **Veredicto:** VÁLIDO.

#### audit-C-345 — integrations registry

- **Path:** [apps/client/lib/integrations/registry.ts](apps/client/lib/integrations/registry.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-346 — providers registry

- **Path:** [apps/client/lib/providers/registry.ts](apps/client/lib/providers/registry.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

#### audit-C-347 — notification store (Zustand)

- **Path:** [apps/client/lib/stores/notificationStore.ts](apps/client/lib/stores/notificationStore.ts) · **Tipo:** store · **Veredicto:** VÁLIDO
- **Admin counterpart?:** `apps/admin/lib/stores/notificationStore.ts` — same module name; cross-check for redundancy with shared store.

#### audit-C-348..-350 — Templates engine

- [lib/templates/ClientTemplateEngine.ts](apps/client/lib/templates/ClientTemplateEngine.ts) — engine impl
- [lib/templates/postTemplates.ts](apps/client/lib/templates/postTemplates.ts) — static templates
- [lib/templates/templateEngine.ts](apps/client/lib/templates/templateEngine.ts) — barrel

All **Veredicto:** VÁLIDO.

#### audit-C-351 — providerMapper

- **Path:** [apps/client/lib/utils/providerMapper.ts](apps/client/lib/utils/providerMapper.ts) · **Tipo:** lib · **Veredicto:** VÁLIDO

### apps/client/providers/

#### audit-C-352 — ProjectProvider (active project + account context)

- **Path:** [apps/client/providers/ProjectProvider.tsx](apps/client/providers/ProjectProvider.tsx)
- **Tipo:** provider
- **API endpoints consumed:** `apiClient.getCurrentUser()` + `apiClient.getAccountProjects(accountId)` → `/auth/customer/me`, `/accounts/:accountId/projects`.
- **Veredicto:** VÁLIDO

### apps/client/types/

#### audit-C-353..-355

- [types/ai-content.ts](apps/client/types/ai-content.ts) — `ContentTemplate`, `GenerationSettings`, `GeneratedContent`
- [types/multi-platform-scheduling.ts](apps/client/types/multi-platform-scheduling.ts) — backend response shapes for `/scheduling/*` (admin has a same-named file: see Cross-surface signals)
- [types/scheduling.ts](apps/client/types/scheduling.ts) — `ScheduledPost`, `CalendarDay`

All **Tipo:** types · **Veredicto:** VÁLIDO.

## Cross-surface signals

### Strong duplicates with apps/admin/

Edward's hypothesis is that client and admin were split from one app — and the inventory bears it out at the **infrastructure boundary** (auth + proxy + layout shell) but **NOT** at the feature surface:

| client                                                                                   | admin counterpart                                    | Status                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/client/app/api/backend/[...path]/route.ts`                                         | `apps/admin/app/api/backend/[...path]/route.ts`      | Intentional duplicate (different auth cookies). Could be a shared package but proxy logic is tightly coupled to auth endpoints. Keep duplicated. |
| `apps/client/app/actions/auth.ts`                                                        | `apps/admin/app/actions/auth.ts`                     | Diverged (admin has MFA flow). Keep, document.                                                                                                   |
| `apps/client/lib/auth/sessionCookie.ts`                                                  | `apps/admin/lib/auth/sessionCookie.ts`               | **REDUNDANTE** — same job (cookie names + TTLs). Strong candidate for promotion to a shared `@packages/auth-cookie` module.                      |
| `apps/client/lib/auth/authApi.ts`                                                        | `apps/admin/lib/auth/backend-client.ts`              | Different naming, similar surface (login/logout/me). Worth diff'ing.                                                                             |
| `apps/client/lib/stores/notificationStore.ts`                                            | `apps/admin/lib/stores/notificationStore.ts`         | Same filename, likely same Zustand store shape. Diff and consolidate to `@packages/notification-store`.                                          |
| `apps/client/components/shared/LoadingSpinner.tsx`                                       | `apps/admin/components/shared/LoadingSpinner.tsx`    | **REDUNDANTE** — promote to `@packages/ui`.                                                                                                      |
| `apps/client/hooks/api/useMultiPlatformScheduling.ts`                                    | `apps/admin/hooks/api/useMultiPlatformScheduling.ts` | Same filename. Domain is scheduling — customer-facing. Why is admin calling this? Diff before consolidating; admin version may be a vestige.     |
| `apps/client/hooks/api/usePerformanceInsights.ts`                                        | `apps/admin/hooks/api/usePerformanceInsights.ts`     | **MISMATCH on client side** — client hook calls `/admin/analytics/overview` which is an admin-scoped endpoint.                                   |
| `apps/client/types/multi-platform-scheduling.ts`                                         | `apps/admin/types/multi-platform-scheduling.ts`      | Same filename. Same domain shapes. Consolidate to `@shared/types`.                                                                               |
| `apps/client/lib/env.ts`                                                                 | `apps/admin/lib/env.ts`                              | Both use `@t3-oss/env-nextjs` per CLAUDE.md secrets policy. Diff is expected (different env keys per app). Not redundant.                        |
| `apps/client/providers.tsx` (composite) vs `apps/admin/providers/{Auth,Query,Theme}.tsx` | —                                                    | Different structure but same intent. Not redundant.                                                                                              |

Beyond these, the feature surface diverges almost completely — admin owns the operator-side pages (accounts, billing/gateway-switches, compliance, maintenance, pricing, RBAC, security, subscriptions, users, webhooks) while client owns the customer-side pages (AI, analytics, approvals, assets, campaigns, channels, inbox, instagram, posts, scheduling, settings/, tasks, templates). The split has been thorough — minimal feature duplication.

### Likely forgotten features (endpoint missing or scaffolded)

1. **`apps/client/app/dashboard/ai/analytics/page.tsx`** — `PredictiveAnalytics` orchestrator fetches `/ai/predict-audience`, `/ai/predict-timing`, `/analytics/cross-platform`, `/analytics/roi`. Endpoints exist in the route table but per `usePredictiveData` JSDoc they're scaffolded to **501 NOT_IMPLEMENTED**. UI handles the error path; backend ML/scoring is not landed yet. Customer-facing debt.
2. **`apps/client/app/dashboard/analytics/reports/page.tsx`** — Documented banner "Manual generation only — cron not wired" per memory note. The page + components are wired; the cron worker is the gap.
3. **`apps/client/app/dashboard/settings/referral/page.tsx`** — Inline `fetch` for referral stats. **No referral routes found in `/tmp/api_endpoints_list.txt`**. Cross-check is required (likely a missing route file `referralRoutes.ts`).
4. **`apps/client/components/ai/AIContentResults.tsx`** + **`AITemplateSelector.tsx`** — Display fields `estimatedEngagement` / `readabilityScore` / `engagementScore` / `viralPotential` / `BrandConsistency` are wired but not populated by backend. Per memory note.
5. **`apps/client/app/dashboard/scheduling/page.tsx` → `MultiPlatformScheduler`** — `useMultiPlatformScheduling` is also present in admin (`apps/admin/hooks/api/useMultiPlatformScheduling.ts`). Customer side calls `/scheduling/slots`, `/scheduling/slots/bulk`, `/scheduling/rules` which all exist. Not forgotten — flagged for cross-surface dedup only.

### Stale endpoint references (non-existent routes)

Cross-checked every consumed endpoint against `apps/api/src/**/*Routes.ts` (297 endpoints):

1. **`apps/client/hooks/api/usePerformanceInsights.ts`** — calls `/admin/analytics/overview`. Endpoint exists, but it's admin-scoped. Customer requests will fail auth. **MISMATCH**.
2. **`apps/client/hooks/api/useReports.ts`** — calls `/reports/*` (route file `reportRoutes.ts` exists) or `/custom-reports/*` (`customReportRoutes.ts` exists). Endpoint paths weren't all extracted by the grep (`/reports/*` paths aren't on the master list). Likely VÁLIDO once verified; flag for downstream audit.
3. **`apps/client/app/dashboard/settings/referral/page.tsx`** — `/referrals/*` not in the route table. Possible missing API surface; OR an endpoint exists under a different path. **FORGOTTEN-FEATURE** until proven otherwise.

### Pages that work, hooks that don't (legacy hook usage)

No legacy-hook patterns detected: every consumer of `useProjectChannels` (PR-16 refactor) uses the new barrel, and every consumer of the v5 `queryOptions` factory pattern (`schedulingQueries`, `usageQueries`, `notificationsQueries`) flows through canonical hooks. The TanStack v5 migration is consistent in the client surface.

Two structural notes for downstream audits:

- `apps/client/lib/api/hooks.ts` is a **legacy aggregate** of TanStack hooks (`usePosts`, `useProjects`, `useApiProviders`, batch post mutations…). Newer features moved to `hooks/api/use*.ts` per-domain. The aggregate is still used by `dashboard/page.tsx` and `dashboard/posts/page.tsx` — not legacy in the "abandoned" sense; rather, a pending refactor candidate.
- `apps/client/components/ai/AIContentGenerator.tsx` and its hook `useAIContentGenerator.ts` mix the older `types/ai-content.ts` shape with the newer `useAIPromptTemplates` API hook (via `mapApiTemplate`). Working but a candidate for unification.

## Methodology + caveats

**Method:** Enumerated 226 in-scope files under `apps/client/{app,components,hooks,lib,providers,types}`; read each file's JSDoc header (lines 1-25) to extract @file/@description/@layer/@component; resolved each `useX` hook call to the corresponding API endpoint by reading the hook source. Cross-referenced endpoint paths against the master list extracted from `apps/api/src/**/*Routes.ts` (`grep -A1 fastify.{get,post,put,delete,patch}` → 297 unique paths). Cross-referenced filenames against `apps/admin/` to detect post-split duplicates.

**Caveats:**

- Endpoint extraction was via regex on `fastify.METHOD("path"` — endpoints registered through a different mechanism (e.g., `fastify.route({ url })` or `BaseRouteHandler.register`) may have been missed. The 297 paths cover the vast majority but some niche endpoints (e.g., `/reports/*` for `useReports`) may have been missed by the grep — flagged for downstream audit, not classified DEAD/MISMATCH on that basis alone.
- Tests, Storybook config, Sentry config, and the proxy/env infrastructure files were excluded by scope. They're not invalid; they're explicitly out of scope per Edward's request.
- "Legacy hook" detection (`useChannels()` rewritten in PR-16) found zero callers of the legacy hook — full migration completed.
- The 14 security fixes that landed recently touched `apps/api` only; this inventory confirms that no client-surface code was changed by them.
- Memory-protected files (per Edward's notes) preserved their veredicto: `apps/client/components/publishing/` doesn't exist (already removed in T6-D rescue). The reserved-for-migration files mentioned (`ContentPreviewSystem`, `provider-previews`, `publishingDashboardApi`) are not present in the current tree — confirmation that T6-D cleanup was completed.
