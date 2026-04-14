# OmniPost -- Admin Portal API Reference

## Overview

The admin portal is a Next.js application (`apps/admin/`) providing platform operators with account management, subscription oversight, analytics dashboards, security controls (MFA + RBAC), compliance management, webhook monitoring, queue maintenance, pricing configuration, audit logging, and billing gateway switch management. All pages use CSS custom-property design tokens, i18n via `next-intl`, and TanStack Query hooks for server state. Pages enforce RBAC with `AccessDenied` fallback.

---

## Pages

### Dashboard Home

**File:** `apps/admin/app/(dashboard)/page.tsx`
**Type:** page
**Description:** Main admin dashboard displaying key metrics: account counts, plan distribution (DonutChart), revenue breakdown (HorizontalBarChart), stat cards (total accounts, active trials, total revenue, today logins), and quick-action navigation links. Uses `useDashboardStats` hook.

**Has JSDoc:** Yes

### Accounts Management

**File:** `apps/admin/app/(dashboard)/accounts/page.tsx`
**Type:** page
**Description:** Full account management page with search, status/plan filtering, sort options, paginated table with expandable billing detail rows, inline editing (name, email, phone, trial settings, auto-renewal), bulk actions (suspend, activate, CSV export), create account form, and password reset dialog. Uses `useAccounts`, `useUpdateAccount`, `useResetAccountPassword` hooks.

**Has JSDoc:** Yes

### Analytics

**File:** `apps/admin/app/(dashboard)/analytics/page.tsx`
**Type:** page
**Description:** Analytics dashboard with time-range selector (7d/30d/90d) showing business metrics (revenue, MRR, LTV, churn), operational metrics (uptime, error rate, security score), growth metrics (new customers, trial conversion, CSAT), platform overview (accounts, projects, channels, posts), subscription distribution (DonutChart), channel distribution by provider, and revenue/user growth trend charts (TrendAreaChart). Uses `useAnalytics` hook.

**Has JSDoc:** Yes

### Subscriptions

**File:** `apps/admin/app/(dashboard)/subscriptions/page.tsx`
**Type:** page
**Description:** Subscription management page listing subscribers, trials, and revenue. Supports filtering, change-plan dialog, and CSV export.

**Has JSDoc:** Yes

### Security Overview

**File:** `apps/admin/app/(dashboard)/security/page.tsx`
**Type:** page
**Description:** Security overview with stats cards (security status, MFA adoption rate, active roles), role distribution visualization with progress bars, embedded RbacManager, quick-action links to MFA settings and compliance audit, and inline change-password form with validation (12+ chars, uppercase, number). Uses `useSecurityOverview` and `useChangePassword` hooks.

**Has JSDoc:** Yes

### MFA Settings

**File:** `apps/admin/app/(dashboard)/security/mfa/page.tsx`
**Type:** page
**Description:** MFA settings page rendering `MfaManager` (admin TOTP management for all users) and `MfaSelfService` (admin self-enrollment) components.

**Has JSDoc:** Yes

### RBAC Management

**File:** `apps/admin/app/(dashboard)/security/rbac/page.tsx`
**Type:** page
**Description:** Dedicated RBAC management page rendering the `RbacManager` component.

**Has JSDoc:** Yes

### Compliance

**File:** `apps/admin/app/(dashboard)/compliance/page.tsx`
**Type:** page
**Description:** Compliance dashboard with five tabs: Overview (metrics cards with scores + checklist), GDPR (settings form + DSAR table), Security (settings form), Breaches (report table), Audit (paginated activity logs with result badges). Shows overall compliance score with color-coded progress bar. Uses `useCompliance` and `useComplianceScore` hooks.

**Has JSDoc:** Yes

### Webhooks

**File:** `apps/admin/app/(dashboard)/webhooks/page.tsx`
**Type:** page
**Description:** Webhook dashboard with tabbed views: Overview (timeline + metrics), Events (list), Subscriptions, Analytics (provider performance + event type breakdown), and Dead-Letter Queue. Includes provider and time-range filters, stat cards (total events, success rate, avg processing time, failed events). Uses `useWebhookMetrics` hook.

**Has JSDoc:** Yes

### Maintenance

**File:** `apps/admin/app/(dashboard)/maintenance/page.tsx`
**Type:** page
**Description:** System maintenance page with queue overview stats (active, waiting, completed, failed, delayed), scheduled jobs panel, failed jobs table with retry actions, and queue health panel. Uses `useQueueStats`, `useFailedJobs`, `useRetryJob` hooks.

**Has JSDoc:** Yes

### Pricing

**File:** `apps/admin/app/(dashboard)/pricing/page.tsx`
**Type:** page
**Description:** Admin pricing management with live provider tiers, account tiers, bundles (CRUD), and MRR dashboard. Delegates to tab components `ProviderTiersTab` and `AccountTiersTab`.

**Has JSDoc:** Yes

### Billing -- Gateway Switches

**File:** `apps/admin/app/(dashboard)/billing/gateway-switches/page.tsx`
**Type:** page
**Description:** Gateway switch management (Stripe/Paddle transitions). Lists switch events with stats, status tabs (SCHEDULED, PENDING_CHECKOUT, COMPLETED, SUSPENDED, CANCELLED), detail dialog with timeline, extend deadline dialog (12/24/48/72h options), force-complete and force-suspend actions. Uses `useGatewaySwitches`, `useGatewaySwitchDetail`, `useExtendSwitchDeadline`, `useForceCompleteSwitch`, `useForceSuspendSwitch` hooks.

**Has JSDoc:** Yes

### Audit Logs

**File:** `apps/admin/app/(dashboard)/logs/page.tsx`
**Type:** page
**Description:** Audit logs page showing admin activity records with client-side filtering (search, action, result, user, dates), auto-refresh, CSV export, and server-side statistics.

**Has JSDoc:** Yes

### Admin Users

**File:** `apps/admin/app/(dashboard)/users/page.tsx`
**Type:** page
**Description:** Admin user management. Lists admin users with role badges, status indicators. Actions: invite, activate, deactivate, edit roles. Permission-gated via `useCurrentUser`.

**Has JSDoc:** Yes

### Help

**File:** `apps/admin/app/(dashboard)/help/page.tsx`
**Type:** page
**Description:** Help and documentation page with accordion-style expandable sections explaining every feature of the admin portal.

**Has JSDoc:** Yes

### Login

**File:** `apps/admin/app/(auth)/login/page.tsx`
**Type:** page
**Description:** Admin login page with split layout. Left: OmniPost branding on dark background. Right: LoginForm component.

**Has JSDoc:** Yes

---

## Components

### Accounts

#### AccountEditForm

**File:** `apps/admin/components/accounts/AccountEditForm.tsx`
**Type:** component
**Description:** Inline edit form for account properties (name, email, phone, active status, trial settings, auto-renewal).

| Export            | Type      | Description                 |
| ----------------- | --------- | --------------------------- |
| `AccountEditForm` | component | Inline account editing form |

**Has JSDoc:** No (file name implies)

#### AccountStatusBadge

**File:** `apps/admin/components/accounts/AccountStatusBadge.tsx`
**Type:** component
**Description:** Renders a status badge for an account (Active, Suspended, Trial) with appropriate color coding.

| Export               | Type      | Description                      |
| -------------------- | --------- | -------------------------------- |
| `AccountStatusBadge` | component | Color-coded account status badge |

**Has JSDoc:** No

#### AccountBillingPanel

**File:** `apps/admin/components/accounts/AccountBillingPanel.tsx`
**Type:** component
**Description:** Expandable billing detail panel for an account showing subscription, usage, session, and billing history.

| Export                | Type      | Description                   |
| --------------------- | --------- | ----------------------------- |
| `AccountBillingPanel` | component | Account billing details panel |

**Has JSDoc:** No

#### exportAccountsToCSV

**File:** `apps/admin/components/accounts/exportAccountsToCSV.ts`
**Type:** utility
**Description:** Exports selected accounts to a CSV file download.

| Export                | Type     | Description                     |
| --------------------- | -------- | ------------------------------- |
| `exportAccountsToCSV` | function | CSV export utility for accounts |

**Has JSDoc:** No

### Charts

**File:** `apps/admin/components/charts/index.ts`
**Type:** barrel export
**Description:** Re-exports all chart components.

#### DonutChart

**File:** `apps/admin/components/charts/DonutChart.tsx`
**Type:** component
**Description:** Recharts-based donut chart with configurable data, height, and empty message.

| Export            | Type      | Description                           |
| ----------------- | --------- | ------------------------------------- |
| `DonutChart`      | component | Donut/pie chart visualization         |
| `DonutChartDatum` | type      | Data point shape (name, value, color) |

**Has JSDoc:** No

#### TrendAreaChart

**File:** `apps/admin/components/charts/TrendAreaChart.tsx`
**Type:** component
**Description:** Recharts-based area chart for trend visualization with configurable color and value formatting.

| Export           | Type      | Description               |
| ---------------- | --------- | ------------------------- |
| `TrendAreaChart` | component | Area chart for trend data |

**Has JSDoc:** No

#### HorizontalBarChart

**File:** `apps/admin/components/charts/HorizontalBarChart.tsx`
**Type:** component
**Description:** Horizontal bar chart for revenue and comparison data.

| Export               | Type      | Description          |
| -------------------- | --------- | -------------------- |
| `HorizontalBarChart` | component | Horizontal bar chart |

**Has JSDoc:** No

#### StackedBarChart

**File:** `apps/admin/components/charts/StackedBarChart.tsx`
**Type:** component
**Description:** Stacked bar chart for multi-series data.

| Export            | Type      | Description                     |
| ----------------- | --------- | ------------------------------- |
| `StackedBarChart` | component | Stacked bar chart visualization |

**Has JSDoc:** No

#### ChartEmptyState

**File:** `apps/admin/components/charts/ChartEmptyState.tsx`
**Type:** component
**Description:** Empty state placeholder for charts when no data is available.

| Export            | Type      | Description            |
| ----------------- | --------- | ---------------------- |
| `ChartEmptyState` | component | Empty state for charts |

**Has JSDoc:** No

### Compliance

#### GdprSettingsForm

**File:** `apps/admin/components/compliance/GdprSettingsForm.tsx`
**Type:** component
**Description:** GDPR settings form for configuring data retention, consent management, and privacy controls.

| Export             | Type      | Description             |
| ------------------ | --------- | ----------------------- |
| `GdprSettingsForm` | component | GDPR configuration form |

**Has JSDoc:** No

#### DsarTable

**File:** `apps/admin/components/compliance/DsarTable.tsx`
**Type:** component
**Description:** Data Subject Access Request (DSAR) table listing and management.

| Export      | Type      | Description                |
| ----------- | --------- | -------------------------- |
| `DsarTable` | component | DSAR request listing table |

**Has JSDoc:** No

#### SecuritySettingsForm

**File:** `apps/admin/components/compliance/SecuritySettingsForm.tsx`
**Type:** component
**Description:** Security compliance settings form (session timeout, login protection).

| Export                 | Type      | Description                  |
| ---------------------- | --------- | ---------------------------- |
| `SecuritySettingsForm` | component | Security compliance settings |

**Has JSDoc:** No

#### BreachTable

**File:** `apps/admin/components/compliance/BreachTable.tsx`
**Type:** component
**Description:** Security breach report table.

| Export        | Type      | Description                   |
| ------------- | --------- | ----------------------------- |
| `BreachTable` | component | Breach incident listing table |

**Has JSDoc:** No

### Maintenance

#### FailedJobsTable

**File:** `apps/admin/components/maintenance/FailedJobsTable.tsx`
**Type:** component
**Description:** Table of failed BullMQ jobs with retry action buttons.

| Export            | Type      | Description                  |
| ----------------- | --------- | ---------------------------- |
| `FailedJobsTable` | component | Failed jobs table with retry |

**Has JSDoc:** No

#### QueueHealthPanel

**File:** `apps/admin/components/maintenance/QueueHealthPanel.tsx`
**Type:** component
**Description:** Queue health status panel showing queue metrics and status indicators.

| Export             | Type      | Description                |
| ------------------ | --------- | -------------------------- |
| `QueueHealthPanel` | component | Queue health metrics panel |

**Has JSDoc:** No

#### ScheduledJobsPanel

**File:** `apps/admin/components/maintenance/ScheduledJobsPanel.tsx`
**Type:** component
**Description:** Panel showing currently scheduled/delayed jobs.

| Export               | Type      | Description            |
| -------------------- | --------- | ---------------------- |
| `ScheduledJobsPanel` | component | Scheduled jobs listing |

**Has JSDoc:** No

### Pricing

#### AccountTiersTab

**File:** `apps/admin/components/pricing/AccountTiersTab.tsx`
**Type:** component
**Description:** Account pricing tier management tab.

| Export            | Type      | Description       |
| ----------------- | --------- | ----------------- |
| `AccountTiersTab` | component | Account tier CRUD |

**Has JSDoc:** No

#### ProviderTiersTab

**File:** `apps/admin/components/pricing/ProviderTiersTab.tsx`
**Type:** component
**Description:** Provider pricing tier management tab.

| Export             | Type      | Description        |
| ------------------ | --------- | ------------------ |
| `ProviderTiersTab` | component | Provider tier CRUD |

**Has JSDoc:** No

### Security

#### MfaManager

**File:** `apps/admin/components/security/MfaManager.tsx`
**Type:** component
**Description:** Admin MFA management for all platform users. Lists users with MFA status, enable/disable controls.

| Export       | Type                | Description                         |
| ------------ | ------------------- | ----------------------------------- |
| `MfaManager` | component (default) | Admin TOTP management for all users |

**Has JSDoc:** No

#### MfaSelfService

**File:** `apps/admin/components/security/MfaSelfService.tsx`
**Type:** component
**Description:** MFA self-service enrollment for the current admin user.

| Export           | Type      | Description                   |
| ---------------- | --------- | ----------------------------- |
| `MfaSelfService` | component | Admin self-enrollment for MFA |

**Has JSDoc:** No

#### RbacManager

**File:** `apps/admin/components/security/RbacManager.tsx`
**Type:** component
**Description:** Role-based access control management. Lists roles, shows permission grids, supports role creation and permission assignment.

| Export        | Type                | Description                         |
| ------------- | ------------------- | ----------------------------------- |
| `RbacManager` | component (default) | RBAC role and permission management |

**Has JSDoc:** No

#### PermissionGrid

**File:** `apps/admin/components/security/PermissionGrid.tsx`
**Type:** component
**Description:** Permission grid showing role-permission matrix with toggle controls.

| Export           | Type      | Description                   |
| ---------------- | --------- | ----------------------------- |
| `PermissionGrid` | component | Role-permission toggle matrix |

**Has JSDoc:** No

#### CreateRoleDialog

**File:** `apps/admin/components/security/CreateRoleDialog.tsx`
**Type:** component
**Description:** Dialog for creating new RBAC roles.

| Export             | Type      | Description              |
| ------------------ | --------- | ------------------------ |
| `CreateRoleDialog` | component | New role creation dialog |

**Has JSDoc:** No

### Subscriptions

#### ChangePlanDialog

**File:** `apps/admin/components/subscriptions/ChangePlanDialog.tsx`
**Type:** component
**Description:** Dialog for changing an account's subscription plan.

| Export             | Type      | Description                            |
| ------------------ | --------- | -------------------------------------- |
| `ChangePlanDialog` | component | Plan change dialog with plan selection |

**Has JSDoc:** No

### Settings

#### UsageMetricsPanel

**File:** `apps/admin/components/settings/UsageMetricsPanel.tsx`
**Type:** component
**Description:** Usage metrics panel showing resource utilization.

| Export              | Type      | Description                 |
| ------------------- | --------- | --------------------------- |
| `UsageMetricsPanel` | component | Usage metrics visualization |

**Has JSDoc:** No

### Webhooks

#### WebhookMetrics

**File:** `apps/admin/components/webhooks/WebhookMetrics.tsx`
**Type:** component
**Description:** Webhook metrics overview cards and charts.

| Export           | Type      | Description                 |
| ---------------- | --------- | --------------------------- |
| `WebhookMetrics` | component | Webhook performance metrics |

**Has JSDoc:** No

#### WebhookEventsList

**File:** `apps/admin/components/webhooks/WebhookEventsList.tsx`
**Type:** component
**Description:** Paginated list of webhook events with provider filter.

| Export              | Type      | Description            |
| ------------------- | --------- | ---------------------- |
| `WebhookEventsList` | component | Webhook events listing |

**Has JSDoc:** No

#### WebhookSubscriptions

**File:** `apps/admin/components/webhooks/WebhookSubscriptions.tsx`
**Type:** component
**Description:** Webhook subscription management.

| Export                 | Type      | Description               |
| ---------------------- | --------- | ------------------------- |
| `WebhookSubscriptions` | component | Webhook subscription CRUD |

**Has JSDoc:** No

#### WebhookTimeline

**File:** `apps/admin/components/webhooks/WebhookTimeline.tsx`
**Type:** component
**Description:** Timeline visualization of webhook activity.

| Export            | Type      | Description               |
| ----------------- | --------- | ------------------------- |
| `WebhookTimeline` | component | Webhook activity timeline |

**Has JSDoc:** No

#### DeadLetterQueue

**File:** `apps/admin/components/webhooks/DeadLetterQueue.tsx`
**Type:** component
**Description:** Dead-letter queue management for failed webhook deliveries.

| Export            | Type      | Description                  |
| ----------------- | --------- | ---------------------------- |
| `DeadLetterQueue` | component | DLQ listing with retry/purge |

**Has JSDoc:** No

### Shared UI Components

#### PageHeader

**File:** `apps/admin/components/ui/PageHeader.tsx`
**Type:** component
**Description:** Consistent page header with title, optional description, and actions slot.

| Export       | Type      | Description                        |
| ------------ | --------- | ---------------------------------- |
| `PageHeader` | component | Page header with title and actions |

**Has JSDoc:** No

#### StatCard

**File:** `apps/admin/components/ui/StatCard.tsx`
**Type:** component
**Description:** Metric stat card with label, value, optional trend indicator, and optional icon.

| Export     | Type      | Description                             |
| ---------- | --------- | --------------------------------------- |
| `StatCard` | component | Metric display card with optional trend |

**Has JSDoc:** No

#### ActionButton

**File:** `apps/admin/components/ui/ActionButton.tsx`
**Type:** component
**Description:** Button with loading state, variant support (primary, secondary, danger), and size options.

| Export         | Type      | Description                        |
| -------------- | --------- | ---------------------------------- |
| `ActionButton` | component | Action button with loading spinner |

**Has JSDoc:** No

#### Badge

**File:** `apps/admin/components/ui/Badge.tsx`
**Type:** component
**Description:** Status badge with variants (success, warning, error, neutral, info).

| Export  | Type      | Description              |
| ------- | --------- | ------------------------ |
| `Badge` | component | Color-coded status badge |

**Has JSDoc:** No

#### DataTable

**File:** `apps/admin/components/ui/DataTable.tsx`
**Type:** component
**Description:** Generic data table with configurable columns, row click handler, loading state, and empty message.

| Export      | Type      | Description                     |
| ----------- | --------- | ------------------------------- |
| `DataTable` | component | Generic configurable data table |

**Has JSDoc:** No

#### TabNav

**File:** `apps/admin/components/ui/TabNav.tsx`
**Type:** component
**Description:** Tab navigation bar with active state management.

| Export   | Type      | Description              |
| -------- | --------- | ------------------------ |
| `TabNav` | component | Tab navigation component |

**Has JSDoc:** No

#### Pagination

**File:** `apps/admin/components/ui/Pagination.tsx`
**Type:** component
**Description:** Pagination control with page/per-page selectors and item count display.

| Export       | Type      | Description                            |
| ------------ | --------- | -------------------------------------- |
| `Pagination` | component | Page navigation with per-page selector |

**Has JSDoc:** No

#### ConfirmDialog

**File:** `apps/admin/components/ui/ConfirmDialog.tsx`
**Type:** component
**Description:** Confirmation dialog for destructive actions.

| Export          | Type      | Description           |
| --------------- | --------- | --------------------- |
| `ConfirmDialog` | component | Confirm/cancel dialog |

**Has JSDoc:** No

#### InputDialog

**File:** `apps/admin/components/ui/InputDialog.tsx`
**Type:** component
**Description:** Dialog with text input field for collecting user input.

| Export        | Type      | Description             |
| ------------- | --------- | ----------------------- |
| `InputDialog` | component | Input collection dialog |

**Has JSDoc:** No

#### AdminToaster

**File:** `apps/admin/components/ui/AdminToaster.tsx`
**Type:** component
**Description:** Toast notification container for the admin app.

| Export         | Type      | Description                 |
| -------------- | --------- | --------------------------- |
| `AdminToaster` | component | Toast notification provider |

**Has JSDoc:** No

### Shared Layout Components

#### SidebarNav

**File:** `apps/admin/components/shared/SidebarNav.tsx`
**Type:** component
**Description:** Sidebar navigation for the admin dashboard with active-link highlighting.

| Export       | Type      | Description                  |
| ------------ | --------- | ---------------------------- |
| `SidebarNav` | component | Dashboard sidebar navigation |

**Has JSDoc:** No

#### LoadingSpinner

**File:** `apps/admin/components/shared/LoadingSpinner.tsx`
**Type:** component
**Description:** Configurable loading spinner with size and label support.

| Export           | Type      | Description                           |
| ---------------- | --------- | ------------------------------------- |
| `LoadingSpinner` | component | Loading indicator with optional label |

**Has JSDoc:** No

#### AccessDenied

**File:** `apps/admin/components/shared/AccessDenied.tsx`
**Type:** component
**Description:** Permission denied fallback component shown when RBAC check fails.

| Export         | Type      | Description                   |
| -------------- | --------- | ----------------------------- |
| `AccessDenied` | component | Permission denied placeholder |

**Has JSDoc:** No

### Auth Components

#### LoginForm

**File:** `apps/admin/components/auth/login-form.tsx`
**Type:** component
**Description:** Admin login form with email/password fields and error handling.

| Export      | Type      | Description               |
| ----------- | --------- | ------------------------- |
| `LoginForm` | component | Admin authentication form |

**Has JSDoc:** No

#### LogoutButton

**File:** `apps/admin/components/auth/logout-button.tsx`
**Type:** component
**Description:** Logout button that clears the admin session.

| Export         | Type      | Description         |
| -------------- | --------- | ------------------- |
| `LogoutButton` | component | Admin logout action |

**Has JSDoc:** No

---

## Hooks

### API Hooks

| File                                               | Hook                                            | Description                                         |
| -------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| `apps/admin/hooks/api/useDashboardStats.ts`        | `useDashboardStats`                             | Fetches dashboard home page metrics                 |
| `apps/admin/hooks/api/useAccounts.ts`              | `useAccounts`, `useUpdateAccount`               | Account CRUD operations                             |
| `apps/admin/hooks/api/useAccountSessions.ts`       | `useAccountSessions`                            | Account session management                          |
| `apps/admin/hooks/api/useAccountBilling.ts`        | `useAccountBilling`                             | Account billing details                             |
| `apps/admin/hooks/api/useSubscriptions.ts`         | `useSubscriptions`                              | Subscription listing                                |
| `apps/admin/hooks/api/useSubscriptionMutations.ts` | Subscription mutations                          | Plan changes, cancellations                         |
| `apps/admin/hooks/api/useAnalytics.ts`             | `useAnalytics`                                  | Analytics dashboard data by time range              |
| `apps/admin/hooks/api/useSecurity.ts`              | `useSecurityOverview`                           | Security stats, MFA adoption, role distribution     |
| `apps/admin/hooks/api/useChangePassword.ts`        | `useChangePassword`                             | Admin password change mutation                      |
| `apps/admin/hooks/api/useResetAccountPassword.ts`  | `useResetAccountPassword`                       | Reset account password for a user                   |
| `apps/admin/hooks/api/useAdminUsers.ts`            | `useAdminUsers`                                 | Admin user listing and management                   |
| `apps/admin/hooks/api/useAuditLogs.ts`             | `useAuditLogs`                                  | Audit log fetching                                  |
| `apps/admin/hooks/api/useAuditStats.ts`            | `useAuditStats`                                 | Audit log statistics                                |
| `apps/admin/hooks/api/useBillingStats.ts`          | `useBillingStats`                               | Billing statistics                                  |
| `apps/admin/hooks/api/useCompliance.ts`            | `useCompliance`, `useComplianceScore`           | Compliance metrics and score                        |
| `apps/admin/hooks/api/useGatewaySwitches.ts`       | Gateway switch hooks                            | List, detail, extend, force-complete, force-suspend |
| `apps/admin/hooks/api/usePricingTiers.ts`          | `usePricingTiers`                               | Pricing tier management                             |
| `apps/admin/hooks/api/useQueueManagement.ts`       | `useQueueStats`, `useFailedJobs`, `useRetryJob` | Queue monitoring and retry                          |
| `apps/admin/hooks/api/useUsageMetrics.ts`          | `useUsageMetrics`                               | Resource usage metrics                              |
| `apps/admin/hooks/api/useWebhooks.ts`              | `useWebhookMetrics`                             | Webhook metrics by time range and provider          |

### Utility Hooks

| File                                 | Hook             | Description                            |
| ------------------------------------ | ---------------- | -------------------------------------- |
| `apps/admin/hooks/useChartColors.ts` | `useChartColors` | CSS custom-property chart color tokens |
